// Time-domain fault simulation — discrete-event engine, no React dependencies.
//
// Sequence: fault → zones see current and pick up (after relay op time) →
// zone timers run → trip → breaker opens (after breaker time) → phasor
// network is re-solved (lib/solver) → zones whose measured impedance no
// longer asserts (usually: current gone) reset → repeat until the fault has
// no source left (cleared) or nothing else is pending (not cleared).
//
// Zone assertion (protection.zoneAsserts) is kept separate from the trip
// decision made here. Pilot schemes (V1.5) sit between the two: they read
// zone states, exchange signals over a per-line channel, and can issue
// trips ahead of the step-distance timers.

import { buildNetwork, faultPosition, relayGeometry, describeLocation, activeTap, isTapFault, EPS } from './network'
import { solveFault, faultSpec, FAULT_TYPES } from './solver'
import { instrumentFaults, describeInstrumentFaults, ctSatK } from './instruments'
import { ctGain as ctGainAt } from './ctsat'
import { busZone, busDiffElement } from './busdiff'
import { diffElement, DEFAULT_DIFF, alignmentError } from './differential'
import { zoneAsserts, relayShape, zoneDelayS, ctiS, activeZones, isReverse, zoneLabel } from './protection'

const T_MAX = 10 // s — safety stop
export const PREFAULT_CYCLES = 3 // healthy system shown before the fault at t = 0

// What each scheme sends over the channel
const SIGNAL = { DCB: 'BLOCK', POTT: 'PERMISSIVE', DCUB: 'PERMISSIVE' }
const CHANNEL_TEXT = { out: 'out of service', lost: 'lost' }

// Zone status: idle → pending (seen, op time running) → picked (timer running)
// → operated (latched target). pending/picked fall back to 'reset' when the
// fault current through the relay goes away.
//
// scenario: { relayOos: [rid], breakerFail: [rid], channels: { lineId: 'ok' | 'out' | 'lost' }, diffChannel: 'ok' | 'out' | 'asym1' | 'asym3', dcLost: [busId], tripOpen: [rid],
//             ctReversed, ratioError, vtFuse (instrument faults, lib/instruments) }
//   tripOpen — trip circuit open (e.g. open trip coil): the relay trips but the
//              breaker never receives it (unlike breakerFail: received, didn't open)
//   dcLost — station DC supply lost: every relay at that bus is dead and its
//            breakers have no trip supply (= relay out of service + breaker that never opens)
//   out  — channel failed before the fault (DCUB already locked out)
//   lost — channel lost at fault inception (e.g. carrier attenuated by the fault)

// spec: { type: '3PH' | 'AG', rf: pu } — the fault itself (gated by faultSpec)
export function simulateFault(config, loc, scenario = {}, spec = {}) {
  const fault = faultSpec(config, spec)
  const net = buildNetwork(config.network)
  const { freqHz, relayCycles, breakerCycles } = config.timing
  const tRelay = relayCycles / freqHz
  const tBkr = breakerCycles / freqHz
  // loc { kind: 'none' }: no power-system fault. The t = 0 event is then the
  // instrument failure itself (e.g. a VT fuse blowing on a loaded line).
  const noFault = loc?.kind === 'none'
  const pf = faultPosition(net, loc)
  const relayIds = Object.keys(config.relays)
  const dcLost = new Set(scenario.dcLost ?? [])
  const dead = new Set(relayIds.filter(id => dcLost.has(config.relays[id].bus)))
  const oos = new Set([...(scenario.relayOos ?? []), ...dead])
  const stuck = new Set([...(scenario.breakerFail ?? []), ...dead])
  const tripOpen = new Set(scenario.tripOpen ?? [])
  // CT/VT faults (Foundations module): every solve measures through them
  const inst = instrumentFaults(config, scenario)
  // With no fault the instrument failure happens at t = 0: healthy before, memory intact after
  const instPre = noFault ? {} : inst
  const instNow = noFault ? { ...inst, memoryIntact: true } : inst
  // Loss-of-potential logic: voltage collapsed with no change in current →
  // distance blocked and alarmed. scenario.lopOff disables it. It only ever acts
  // on a relay whose VT input has failed (the voltage start), so runs without
  // instrument failures are unchanged.
  const lopOn = true
  const lopOff = new Set(scenario.lopOff ?? [])
  const lop = {}

  // CT saturation (lib/ctsat.js): a CT that can saturate is re-measured every
  // quarter cycle while the fault is on. Its relay sees the one-cycle DFT of the
  // chopped secondary, as a complex gain on its current; zones, 87L and 87B
  // follow. Without ctSat there are no ticks and nothing changes.
  const satIds = noFault ? [] : Object.keys(inst.ctSat ?? {}).filter(id => ctSatK(inst.ctSat[id]))
  const satCtx = { f: freqHz, tau: Math.tan((config.lineAngleDeg * Math.PI) / 180) / (2 * Math.PI * freqHz), tFault: 0, tStart: -PREFAULT_CYCLES / freqHz }
  const hist = {}     // breaker id → primary current segments [{ t0, I }]
  const satNow = {}   // CT id → saturating (for the onset / recovery events)
  const satAt = {}    // CT id → when its core first saturated
  const T_SAT_TICK = 1 / (4 * freqHz)
  const T_SAT_END = 30 / freqHz
  let curInst = instNow
  const brkOf = id => id.replace(/^bus:/, '')
  const instAt = t => {
    if (!satIds.length) return instNow
    const ctGain = {}
    for (const id of satIds) {
      const segs = hist[brkOf(id)]
      // Phase A stands for all three (it carries the full offset: ctsat.INCEPTION).
      // Per-phase gains would also invent residual current, which real relays
      // can see too but which would muddy every loop here
      const r = segs?.length ? ctGainAt(segs, ctSatK(inst.ctSat[id]), t, satCtx) : null
      ctGain[id] = r ? [r.g, r.g, r.g] : null
      if (r?.tSat != null && r.tSat >= 0 && satAt[id] == null) satAt[id] = r.tSat
    }
    return { ...instNow, ctGain }
  }
  const record = (t, relays) => {
    for (const id of satIds) {
      const rid = brkOf(id)
      const I = relays[rid]?.prim?.Iabc
      if (!I) continue
      const segs = (hist[rid] ??= [])
      const last = segs[segs.length - 1]
      // A new segment only when the primary current changed (re-measuring doesn't change it)
      if (last && I.every((x, p) => Math.abs(x.re - last.I[p].re) < 1e-12 && Math.abs(x.im - last.I[p].im) < 1e-12)) continue
      if (last && Math.abs(last.t0 - t) < 1e-12) segs[segs.length - 1] = { t0: t, I }
      else segs.push({ t0: t, I })
    }
  }

  const geo = Object.fromEntries(relayIds.map(id => [id, relayGeometry(net, config.relays[id])]))
  const fwd = Object.fromEntries(relayIds.map(id => [id, noFault ? NaN : (pf - geo[id].pos) * geo[id].dir]))
  const zonesOf = rid => activeZones(config.relays[rid], config)

  const breakers = Object.fromEntries(relayIds.map(id => [id, 'closed'])) // closed | open | failed
  // Line tap (feature 'tap'): its transformer protection clears faults on the
  // tap's low-voltage bus after a fixed time (illustrative); tap-section faults
  // are inside the line's zone and are the line relays' job
  const tap = activeTap(net, config)
  const tapFault = tap && isTapFault(loc) ? loc.kind : null
  if (tapFault === 'tapLV') breakers.tap = 'closed'
  const zones = {}
  for (const id of relayIds) {
    zones[id] = {}
    for (const z of zonesOf(id)) zones[id][z.id] = { status: 'idle', since: null, token: 0 }
  }
  const tripped = {} // relayId → { t, zoneId, logic }
  const opened = {}  // relayId → t breaker opened
  let paths = []
  let carrying = new Set() // relays with fault current through their CT
  let meas = {}            // rid → solver measurement { V, I, Z, dir, carrying }
  let faultI = 0           // fault current magnitude (pu, max phase) from the latest solve
  let clearedAt = null
  let faultOn = false // false during the prefault period

  // ── Pilot scheme state ──
  const pilotOn = !!config.features?.pilot
  const pilot = config.pilot ?? { channelCycles: 0.5, dcbCoordCycles: 2, unblockCycles: 9 }
  const tCh = pilot.channelCycles / freqHz // pilot and 87L channel
  const tCoord = pilot.dcbCoordCycles / freqHz
  const tUnblock = pilot.unblockCycles / freqHz
  const schemeOf = rid => (pilotOn ? config.schemes?.[config.relays[rid].line] ?? 'step' : 'step')
  const remoteOf = rid => relayIds.find(id => id !== rid && config.relays[id].line === config.relays[rid].line)
  const channelOf = rid => scenario.channels?.[config.relays[rid].line] ?? 'ok'
  const tx = Object.fromEntries(relayIds.map(id => [id, false]))
  const rx = Object.fromEntries(relayIds.map(id => [id, false]))
  const armed = {} // DCB: coordination timer expired while Z2 picked up

  // ── Line current differential (87L) on A–B, with the 'diff' feature ──
  // Evaluated on every network solve from both ends' phase currents; trips
  // both ends after relay time + channel time unless it drops out first.
  // Distance stays in service as backup. Channel out → blocked.
  const DIFF_LINE = 'AB'
  const diffIds = config.features?.diff ? relayIds.filter(id => config.relays[id].line === DIFF_LINE) : []
  const diffOn = diffIds.length === 2
  const diffSet = { ...DEFAULT_DIFF, ...config.diff }
  // 87L channel: 'ok' | 'out' | 'asym1' / 'asym3' (in service, path switched: +1 / +3 ms one way)
  const diffCh = scenario.diffChannel ?? 'ok'
  const align = alignmentError(diffCh, freqHz)
  const diff = { op: false, token: 0, blockedLogged: false }

  // ── Bus differential (87B) on bus B, with the 'busdiff' module ──
  // Evaluated on every network solve from its own (line-side) CTs; trips every
  // breaker at the bus after relay time unless it drops out first. Dead with
  // the station's DC supply.
  const bz = busZone(net, config)
  const busOn = !!bz && !dcLost.has(bz.bus)
  const bus87 = { op: false, token: 0 }

  const queue = []
  let seq = 0
  const schedule = (t, kind, data) => queue.push({ t, kind, seq: seq++, ...data })

  const events = []
  const snapshot = () => ({
    breakers: { ...breakers },
    zones: Object.fromEntries(relayIds.map(id => [id, Object.fromEntries(
      Object.entries(zones[id]).map(([zid, z]) => [zid, { status: z.status, since: z.since }])
    )])),
    tripped: { ...tripped },
    paths: paths.map(p => ({ ...p })),
    carrying: [...carrying],
    meas: Object.fromEntries(Object.entries(meas).map(([id, m]) => [id, { V: m.V, I: m.I, I0x3: m.I0x3, Z: m.Z, dir: m.dir, loop: m.loop, Zload: m.Zload, Vabc: m.Vabc, Iabc: m.Iabc, prim: m.prim }])),
    diff: diffOn ? { op: diff.op } : null,
    bus87: busOn ? { op: bus87.op } : null,
    tx: { ...tx },
    rx: { ...rx },
    faultEnergized: faultOn && clearedAt === null && !noFault,
    lop: { ...lop },
    faultI,
    ...(curInst.ctGain ? { ctGain: curInst.ctGain } : {}),
  })
  const log = (t, kind, text, extra = {}) => events.push({ t, kind, text, ...extra, state: snapshot() })

  const zoneCfg = (rid, zid) => config.relays[rid].zones.find(z => z.id === zid)
  const delayOf = z => zoneDelayS(z, freqHz)

  // A zone is "up" while picked up, or operated and still seeing current
  const zoneUp = (rid, zid) => {
    const st = zones[rid][zid]?.status
    return st === 'picked' || (st === 'operated' && carrying.has(rid))
  }
  const reverseUp = rid => zonesOf(rid).some(z => isReverse(z) && zoneUp(rid, z.id))

  function trip(t, rid, zid, logic, why) {
    tripped[rid] = { t, zoneId: zid, logic }
    const how = logic === 'step' ? `Z${zid}` : `${logic} (${why})`
    log(t, 'trip', logic === '87B' ? `87B (${why}) TRIP → 52-${rid}` : `21-${rid} ${how} TRIP → 52-${rid}`, { rid, zid, logic })
    if (tripOpen.has(rid) && !stuck.has(rid)) log(t, 'bkrFail', `Trip circuit 52-${rid} open — the trip never reaches the breaker`, { rid })
    else schedule(t + tBkr, stuck.has(rid) ? 'bkrFail' : 'bkrOpen', { rid })
  }

  // Pilot trip check — called whenever Z2, received signal, or timers change.
  function checkPilot(t, rid) {
    const scheme = schemeOf(rid)
    if (scheme === 'step' || tripped[rid] || clearedAt !== null || !zoneUp(rid, 2)) return
    if (scheme === 'DCB' && armed[rid] && !rx[rid]) trip(t, rid, 2, 'DCB', 'Z2 + timer, no block')
    else if ((scheme === 'POTT' || scheme === 'DCUB') && rx[rid]) trip(t, rid, 2, scheme, 'Z2 + permissive')
    else if (scheme === 'DCUB' && channelOf(rid) === 'lost' && t < tUnblock - EPS) trip(t, rid, 2, 'DCUB', 'Z2 + unblock window')
  }

  // Keying logic: what this terminal sends, given its zone states.
  //   DCB  — send BLOCK while the reverse zone sees the fault and Z2 doesn't
  //   POTT/DCUB — send PERMISSIVE while Z2 sees the fault
  function updateScheme(t, rid) {
    const scheme = schemeOf(rid)
    if (scheme === 'step') return
    const want = scheme === 'DCB' ? reverseUp(rid) && !zoneUp(rid, 2) : zoneUp(rid, 2)
    if (want !== tx[rid]) {
      tx[rid] = want
      const ch = channelOf(rid)
      const note = ch === 'ok' ? '' : ` — channel ${CHANNEL_TEXT[ch]}, not received`
      log(t, 'tx', `21-${rid} ${want ? 'keys' : 'stops'} ${SIGNAL[scheme]}${note}`, { rid })
      if (ch === 'ok') schedule(t + tCh, 'rx', { rid: remoteOf(rid), v: want, scheme })
    }
    if (!zoneUp(rid, 2)) armed[rid] = false
    checkPilot(t, rid)
  }

  function update87B(t) {
    const el = busDiffElement(meas, bz, curInst, config.busdiff)
    if (el.op === bus87.op) return
    bus87.op = el.op
    bus87.token++
    const ph = el.phases.reduce((w, p) => (p.Iop > w.Iop ? p : w))
    if (el.op) {
      log(t, 'diff', `87B bus ${bz.bus} differential ${ph.Iop.toFixed(2)} pu (restraint ${ph.Ires.toFixed(2)} pu) — trip every breaker at bus ${bz.bus} after relay time`)
      schedule(t + tRelay, 'trip87B', { token: bus87.token })
    } else if (!bz.feeders.some(id => tripped[id]?.logic === '87B')) {
      log(t, 'reset', `87B bus ${bz.bus} differential drops out`)
    }
  }

  function update87(t) {
    const [a, b] = diffIds
    const phases = diffElement(meas[a].Iabc, meas[b].Iabc, meas[a].Vabc, meas[b].Vabc, diffSet, align.theta)
    const op = phases.some(ph => ph.operate)
    if (op === diff.op) return
    diff.op = op
    diff.token++
    const name = `${net.lines[DIFF_LINE].from}–${net.lines[DIFF_LINE].to}`
    if (op) {
      const ph = phases.reduce((w, p) => (p.Iop > w.Iop ? p : w))
      if (diffCh === 'out') {
        if (!diff.blockedLogged) log(t, 'blocked', `87L ${name} sees ${ph.Iop.toFixed(2)} pu differential — channel out, blocked`)
        diff.blockedLogged = true
        return
      }
      log(t, 'diff', `87L ${name} differential ${ph.Iop.toFixed(2)} pu (restraint ${ph.Ires.toFixed(2)} pu) — trip after relay + channel time`)
      // The slower direction of an asymmetric path delays the data (and so the trip)
      schedule(t + tRelay + tCh + align.extraMs / 1000, 'trip87', { token: diff.token })
    } else if (!diffIds.some(id => tripped[id])) {
      log(t, 'reset', `87L ${name} differential drops out`)
    }
  }

  // Saturation onset and recovery, as the relay sees them (worst phase)
  function logSaturation(t) {
    for (const id of satIds) {
      const g = curInst.ctGain?.[id]
      if (!g) continue
      const worst = g.reduce((w, x) => (Math.hypot(x.re, x.im) < Math.hypot(w.re, w.im) ? x : w))
      const mag = Math.hypot(worst.re, worst.im)
      const name = id.startsWith('bus:') ? `the 87B CT on 52-${brkOf(id)}` : `21-${id}`
      // Reported once the core has actually saturated (the relay's estimate looks a cycle ahead)
      if (!satNow[id] && mag < 0.9 && satAt[id] != null && t >= satAt[id] - EPS) {
        satNow[id] = true
        const lead = Math.round((Math.atan2(worst.im, worst.re) * 180) / Math.PI)
        log(t, 'instrument', `CT at ${name} saturated ${(satAt[id] * 1000).toFixed(1)} ms into the fault — the relay sees ${Math.round(mag * 100)}% of the current${lead > 2 ? `, leading by ${lead}°` : ''}`, { rid: brkOf(id), ctSat: true })
      } else if (satNow[id] && mag > 0.97) {
        satNow[id] = false
        log(t, 'instrument', `CT at ${name} out of saturation — the relay sees the full current again`, { rid: brkOf(id), ctSat: true })
      }
    }
  }

  // Re-solve the phasor network and update zone pickups from the measurements.
  function evaluate(t) {
    // A CT that can saturate needs this instant's primary current first (which
    // no instrument changes), then the measurement through its core
    if (satIds.length) record(t, solveFault(net, config, loc, breakers, fault, instNow).relays)
    curInst = instAt(t)
    const sol = solveFault(net, config, loc, breakers, fault, curInst)
    meas = sol.relays
    faultI = sol.faultI
    // Live sources draw as source → fault paths on the one-line
    paths = net.sources.filter(id => sol.sources[id].live).map(source => {
      const ps = net.buses[source].pos
      return { source, lo: Math.min(ps, pf), hi: Math.max(ps, pf) }
    })
    for (const rid of relayIds) {
      if (lopOn && !lop[rid] && !oos.has(rid) && !lopOff.has(rid) && meas[rid].vStart) {
        lop[rid] = true
        log(t, 'lop', `21-${rid} LOSS OF POTENTIAL — voltage gone with no change in current: not a power-system fault. Distance blocked, alarm raised`, { rid })
      }
    }
    // A relay that started on a voltage collapse (failed VT, no LOP block) treats its load current as fault current
    carrying = new Set(relayIds.filter(id => meas[id].carrying || (meas[id].vStart && !lop[id])))

    for (const rid of relayIds) {
      for (const z of zonesOf(rid)) {
        const zs = zones[rid][z.id]
        const asserted = !oos.has(rid) && !lop[rid]
          && zoneAsserts(z, meas[rid], geo[rid].lineLength, config.lineAngleDeg, relayShape(config.relays[rid], config))
        if (asserted && (zs.status === 'idle' || zs.status === 'reset')) {
          zs.status = 'pending'
          zs.token++
          schedule(t + tRelay, 'pickup', { rid, zid: z.id, token: zs.token })
        } else if (!asserted && (zs.status === 'pending' || zs.status === 'picked')) {
          const wasPicked = zs.status === 'picked'
          const elapsed = t - zs.since
          zs.status = 'reset'
          zs.since = t
          zs.token++
          if (wasPicked) {
            // No timer race to report for reverse zones, or once the relay has tripped
            const delay = isReverse(z) || tripped[rid] ? 0 : delayOf(z)
            const margin = delay - elapsed
            const why = carrying.has(rid) ? 'fault left the zone' : 'fault current gone'
            const text = delay > 0
              ? `21-${rid} ${zoneLabel(z)} reset — ${why} after ${ms(elapsed)} of ${ms(delay)} timer (margin ${ms(margin)})`
              : `21-${rid} ${zoneLabel(z)} reset`
            log(t, 'reset', text, { rid, zid: z.id, elapsed, delay, margin })
          }
        }
      }
    }

    // Differential drops out with the fault current
    if (diffOn && clearedAt === null) { if (sol.energized) update87(t); else diff.op = false }
    // 87B also runs on a healthy system (no fault): a wrong CT shows up as differential on load
    if (busOn && clearedAt === null) { if (sol.energized || noFault) update87B(t); else bus87.op = false }

    if (!sol.energized && clearedAt === null && !noFault) {
      clearedAt = t
      log(t, 'cleared', `Fault cleared — all sources isolated`)
    }
    for (const rid of relayIds) updateScheme(t, rid)
  }

  // Prefault: healthy network (no load — every bus at E = 1∠0°, no current)
  meas = solveFault(net, config, null, breakers, {}, instPre).relays
  record(-PREFAULT_CYCLES / freqHz, meas)
  log(-PREFAULT_CYCLES / freqHz, 'prefault', config.features?.load && config.loadAngleDeg
    ? `Prefault: system healthy, carrying load (sources ${config.loadAngleDeg}° apart)`
    : 'Prefault: system healthy, no load — all buses at 1∠0° pu')

  faultOn = true
  const firstAtFault = events.length
  evaluate(0)
  events.splice(firstAtFault, 0, {
    t: 0,
    kind: 'fault',
    text: noFault ? 'No power-system fault: the line and its load are unchanged'
      : `${FAULT_TYPES[fault.type]} fault applied: ${describeLocation(net, loc)}${fault.rf > 0 ? ` through Rf = ${fault.rf} pu` : ''}`,
    state: snapshot(),
  })
  // Instrument failures (standing, or with no fault the t = 0 event itself) are
  // listed right after the fault event, before anything they cause
  events.splice(firstAtFault + 1, 0, ...describeInstrumentFaults(inst)
    .map(({ rid, text }) => ({ t: 0, kind: 'instrument', text, rid, state: events[firstAtFault].state })))

  for (const bus of net.busOrder) {
    const ids = relayIds.filter(id => dead.has(id) && config.relays[id].bus === bus)
    if (ids.length) log(0, 'channel', `Station ${bus} DC supply lost — ${ids.map(id => `21-${id}`).join(', ')} dead; ${ids.map(id => `52-${id}`).join(', ')} cannot trip`)
  }


  if (tapFault === 'tapLV') schedule(tap.clearCycles / freqHz, 'tapClear', {})
  if (satIds.length) schedule(T_SAT_TICK, 'ctTick', {})

  if (diffOn && diffCh === 'out') {
    log(0, 'channel', `87L channel ${net.lines[DIFF_LINE].from}–${net.lines[DIFF_LINE].to} out of service — differential blocked, distance only`)
  }
  if (diffOn && align.extraMs) {
    log(0, 'channel', `87L channel ${net.lines[DIFF_LINE].from}–${net.lines[DIFF_LINE].to} path switched: +${align.extraMs} ms one way. Each end assumes half the round trip, so remote samples are ${align.deltaMs} ms out of step: ${Math.round(align.theta * 180 / Math.PI)}° at ${freqHz} Hz`)
  }

  // Channel conditions for lines running a pilot scheme
  if (pilotOn) {
    for (const line of net.lineOrder) {
      const scheme = config.schemes?.[line] ?? 'step'
      const ch = scenario.channels?.[line] ?? 'ok'
      if (scheme === 'step' || ch === 'ok') continue
      const name = `${net.lines[line].from}–${net.lines[line].to}`
      if (ch === 'out') {
        log(0, 'channel', `Channel ${name} out of service — ${scheme} receives no signals${scheme === 'DCUB' ? ' (unblock already locked out)' : ''}`)
      } else if (scheme === 'DCUB') {
        log(0, 'channel', `Channel ${name} lost at fault — DCUB unblock window open for ${ms(tUnblock)}`)
        schedule(tUnblock, 'lockout', { line: name })
      } else {
        log(0, 'channel', `Channel ${name} lost at fault — ${scheme} receives no signals`)
      }
    }
  }

  let guard = 0
  while (queue.length && guard++ < 2000) {
    queue.sort((a, b) => (a.t - b.t) || (a.seq - b.seq))
    const e = queue.shift()
    if (e.t > T_MAX) break
    if (clearedAt !== null && e.kind !== 'bkrOpen' && e.kind !== 'bkrFail') continue

    if (e.kind === 'pickup') {
      const zs = zones[e.rid][e.zid]
      if (zs.token !== e.token || zs.status !== 'pending') continue
      const z = zoneCfg(e.rid, e.zid)
      zs.status = 'picked'
      zs.since = e.t
      if (isReverse(z)) {
        log(e.t, 'pickup', `21-${e.rid} ${zoneLabel(z)} picks up (reverse fault)`, { rid: e.rid, zid: e.zid })
      } else {
        const where = tapFault === 'tap' ? 'on the tap section'
          : tapFault === 'tapLV' ? 'behind the tap transformer'
          : `at ${Math.round(fwd[e.rid] / geo[e.rid].lineLength * 100)}% of its line`
        log(e.t, 'pickup', `21-${e.rid} Z${e.zid} picks up (${noFault ? 'no fault on the system: measured Z ≈ 0' : `fault ${where}`})${delayOf(z) > 0 ? ` — ${ms(delayOf(z))} timer starts` : ''}`, { rid: e.rid, zid: e.zid })
        schedule(e.t + delayOf(z), 'operate', { rid: e.rid, zid: e.zid, token: zs.token })
        if (e.zid === 2 && schemeOf(e.rid) === 'DCB') schedule(e.t + tCoord, 'coord', { rid: e.rid, token: zs.token })
      }
      updateScheme(e.t, e.rid)
    } else if (e.kind === 'operate') {
      const zs = zones[e.rid][e.zid]
      if (zs.token !== e.token || zs.status !== 'picked') continue
      zs.status = 'operated'
      if (!tripped[e.rid]) trip(e.t, e.rid, e.zid, 'step')
      else log(e.t, 'operate', `21-${e.rid} Z${e.zid} times out (trip already issued)`, { rid: e.rid, zid: e.zid })
    } else if (e.kind === 'coord') {
      if (zones[e.rid][2]?.token !== e.token || !zoneUp(e.rid, 2) || tripped[e.rid]) continue
      armed[e.rid] = true
      if (rx[e.rid]) log(e.t, 'blocked', `21-${e.rid} DCB timer expires — BLOCK received, trip held`, { rid: e.rid })
      checkPilot(e.t, e.rid)
    } else if (e.kind === 'rx') {
      if (rx[e.rid] === e.v) continue
      rx[e.rid] = e.v
      log(e.t, 'rx', `21-${e.rid} ${e.v ? 'receives' : 'loses'} ${SIGNAL[e.scheme]}`, { rid: e.rid })
      checkPilot(e.t, e.rid)
    } else if (e.kind === 'trip87') {
      if (e.token !== diff.token || !diff.op) continue
      for (const rid of diffIds) if (!tripped[rid]) trip(e.t, rid, 0, '87L', 'differential')
    } else if (e.kind === 'trip87B') {
      if (e.token !== bus87.token || !bus87.op) continue
      for (const rid of bz.feeders) if (!tripped[rid]) trip(e.t, rid, 0, '87B', `bus ${bz.bus} differential`)
    } else if (e.kind === 'ctTick') {
      // The saturation event goes before whatever it causes in the same instant
      const at = events.length
      evaluate(e.t)
      const caused = events.splice(at)
      logSaturation(e.t)
      events.push(...caused)
      if (e.t + T_SAT_TICK <= T_SAT_END + EPS) schedule(e.t + T_SAT_TICK, 'ctTick', {})
    } else if (e.kind === 'lockout') {
      log(e.t, 'channel', `Channel ${e.line} DCUB unblock window closes — pilot locked out, step distance only`)
    } else if (e.kind === 'bkrOpen') {
      breakers[e.rid] = 'open'
      opened[e.rid] = e.t
      log(e.t, 'bkrOpen', `52-${e.rid} opens`, { rid: e.rid })
      const openEvent = events[events.length - 1]
      evaluate(e.t)
      // Show the re-solved network (paths, carrying) at the moment of opening
      openEvent.state = snapshot()
    } else if (e.kind === 'tapClear') {
      breakers.tap = 'open'
      log(e.t, 'bkrOpen', `Tap T transformer protection clears the fault (${tap.clearCycles} cyc, illustrative)`, { tap: true })
      const openEvent = events[events.length - 1]
      evaluate(e.t)
      openEvent.state = snapshot()
    } else if (e.kind === 'bkrFail') {
      breakers[e.rid] = 'failed'
      log(e.t, 'bkrFail', `52-${e.rid} FAILS to open — fault still fed`, { rid: e.rid })
    }
  }

  const endT = events[events.length - 1].t
  if (clearedAt === null && !noFault) log(endT, 'uncleared', 'Fault NOT cleared — no remaining protection will operate')

  const outcome = noFault ? assessNoFault(tripped, lop)
    : assessOutcome(net, config, loc, pf, geo, { tripped, opened, breakers, clearedAt, oos, stuck, dead, tripOpen, tapFault, events, busZone: busOn ? bz : null })
  return { events, outcome, clearedAt, pf, net, tRelay, tBkr, startT: events[0].t, fault, noFault, scenario }
}

// No power-system fault: any trip is a misoperation; no trip is secure.
function assessNoFault(tripped, lop) {
  const notes = []
  const how = t => (t.logic && t.logic !== 'step' ? t.logic : `Z${t.zoneId}`)
  for (const [id, t] of Object.entries(tripped)) {
    notes.push({ level: 'bad', text: t.logic === '87B'
      ? `87B tripped 52-${id} at ${ms(t.t)} with no fault on the system: the differential it saw came from a wrong CT, not the bus.`
      : `21-${id} tripped (${how(t)} at ${ms(t.t)}) with no fault on the system: it took a failed measurement for a fault.` })
  }
  for (const id of Object.keys(lop)) {
    notes.push({ level: 'info', text: `21-${id} loss-of-potential logic blocked distance and raised an alarm. Until the VT is fixed, its distance zones can't protect the line.` })
  }
  return { verdict: Object.keys(tripped).length ? 'misoperation' : 'secure', clearedAt: null, notes }
}

// Judge the run: selective, backup clearing, miscoordination, or not cleared.
function assessOutcome(net, config, loc, pf, geo, run) {
  const { tripped, opened, breakers, clearedAt, oos, stuck, dead = new Set(), tripOpen = new Set(), tapFault = null, events, busZone: bz = null } = run
  const cti = ctiS(config.timing)
  const notes = []
  const relayIds = Object.keys(config.relays)

  // Primary breakers: both ends of the faulted line. Bus faults have none —
  // unless bus differential (87B) covers that bus: then its breakers are
  // primary; otherwise remote Z2 backup is the expected clearing.
  // A tap-section fault is inside the tapped line's zone (no breaker at the
  // tap); a fault behind the tap transformer belongs to the tap's own protection.
  const tapLine = tapFault ? Object.values(net.lines).find(l => l.tap)?.id : null
  const busPrimary = loc.kind === 'bus' && bz && loc.bus === bz.bus
  const primary = busPrimary ? bz.feeders
    : loc.kind === 'line' ? relayIds.filter(id => config.relays[id].line === loc.line)
    : tapFault === 'tap' ? relayIds.filter(id => config.relays[id].line === tapLine)
    : []
  const sideOf = id => Math.sign(pf - geo[id].pos) // relay sits left (+1) or right (-1) of fault
  const how = id => (tripped[id].logic && tripped[id].logic !== 'step' ? tripped[id].logic : `Z${tripped[id].zoneId}`)

  let verdict = clearedAt === null ? 'uncleared' : 'selective'
  if (loc.kind === 'bus' && !busPrimary) {
    notes.push({ level: 'info', text: `Bus fault — bus differential not modeled; clearing relies on remote line relays.` })
    if (verdict !== 'uncleared') verdict = 'backup'
  }

  for (const id of primary) {
    if (opened[id] !== undefined) continue
    const why = dead.has(id) ? 'station DC lost'
      : oos.has(id) ? 'relay out of service'
      : stuck.has(id) ? 'breaker failed'
      : tripOpen.has(id) && tripped[id] ? 'trip circuit open'
      : !tripped[id] ? 'no zone reached the fault' : 'breaker did not open'
    notes.push({ level: 'warn', text: `Primary 52-${id} did not open (${why}).` })
  }

  if (tapFault === 'tapLV' && clearedAt !== null && Object.keys(opened).length === 0) {
    notes.push({ level: 'info', text: `Tap transformer protection cleared the fault at ${ms(clearedAt)}; the line relays restrained.` })
  }

  for (const id of Object.keys(opened)) {
    if (tapFault === 'tapLV') {
      notes.push({ level: 'bad', text: `52-${id} tripped (${how(id)} at ${ms(tripped[id].t)}) for a fault behind the tap transformer — the tap's own protection clears that. Miscoordination.` })
      verdict = 'miscoordination'
      continue
    }
    if (primary.includes(id)) continue
    const primarySameSide = primary.find(p => sideOf(p) === sideOf(id))
    const justified = (loc.kind === 'bus' && !busPrimary) || !primarySameSide || opened[primarySameSide] === undefined
    if (justified) {
      notes.push({ level: 'info', text: `52-${id} cleared as remote backup (${how(id)} at ${ms(tripped[id].t)}).` })
      if (verdict === 'selective') verdict = 'backup'
    } else {
      notes.push({ level: 'bad', text: `52-${id} tripped out of section (${how(id)}) at ${ms(tripped[id].t)} — beat or tied primary 52-${primarySameSide}. Miscoordination.` })
      verdict = 'miscoordination'
    }
  }

  // Coordination margins on delayed zones that reset because a primary cleared
  for (const e of events) {
    if (e.kind !== 'reset' || !(e.delay > 0)) continue
    if (e.margin < cti - EPS) {
      notes.push({ level: 'warn', text: `21-${e.rid} Z${e.zid} reset with only ${ms(e.margin)} to spare (CTI ${ms(cti)}).` })
      if (verdict === 'selective') verdict = 'tight'
    }
  }

  // Breakers that never opened but sit on a still-faulted path
  for (const id of relayIds) {
    if (breakers[id] === 'failed' && clearedAt !== null) {
      notes.push({ level: 'info', text: `52-${id} stuck — remote backup isolated the fault instead.` })
    }
  }

  return { verdict, clearedAt, notes }
}

export function ms(t) {
  return `${(t * 1000).toFixed(1)} ms`
}

// Last event at or before time t (events are time-ordered).
export function stateAt(events, t) {
  let idx = 0
  for (let i = 0; i < events.length; i++) {
    if (events[i].t <= t + EPS) idx = i
    else break
  }
  return { idx, state: events[idx].state }
}
