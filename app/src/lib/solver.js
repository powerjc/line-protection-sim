// Phasor network solver — no React dependencies.
//
// Three-phase nodal analysis of the chain at one instant: buses (+ a fault
// node F when the fault is inside a line, splitting it into two segments).
// Every element is balanced, described by its sequence impedances Z1 and Z0:
// lines (Z0 = z0Ratio·Z1), sources (EMF 1∠0°/∠−120°/∠120° behind Zs1 = sir∠θ,
// Zs0 = z0Ratio·Zs1). Prefault is no-load, so every bus sits at the balanced
// EMF before the fault — that prefault voltage is the memory polarizer.
//
// Faults: 3Ø (all three phases to ground) or AG (phase A to ground), bolted
// (faulted phases pinned to 0 V) or through Rf. Stiff sources (sir = 0) pin
// their bus to the EMF; a bolted fault on a stiff source's own bus wins
// (infinite source current). Phase variables with no path to a pinned
// variable or a shunt are dead (0 V).
// Feature gating: SIR only with 'sir', AG only with 'ground', Rf only with 'rf'.

import { C, ZERO, ONE, add, sub, mul, div, inv, scale, conj, abs, polar, solveLinear } from './complex'
import { activeTap } from './network'

const DEG = Math.PI / 180
const SNAP = 1e-6       // fault this close to a line end sits on the bus
export const I_MIN = 1e-6 // pu — below this a CT "carries" no fault current
const PH = [0, 1, 2]
export const PHASE = ['A', 'B', 'C']
// Prefault (memory) phase voltages: balanced, no load
export const E_ABC = [ONE, polar(1, -120 * DEG), polar(1, 120 * DEG)]
export const FAULT_TYPES = { '3PH': '3Ø', AG: 'A–G' }
// Tap load power factor ≈ 0.95 lagging (illustrative)
const TAP_LOAD_ANGLE = 18 * Math.PI / 180
const GROUND_SHARE = 0.1 // phase selection: 3I0 above this share of the largest phase current → ground fault

// Source impedance counts with the SIR feature, and always for infeed sources
const sirApplies = (config, bus) => !!(config.features?.sir || (config.features?.infeed && bus.infeed))

// Balanced 3×3 element from sequence admittances: self (2y1 + y0)/3, mutual (y0 − y1)/3
const balanced = (y1, y0) => ({ s: scale(add(scale(y1, 2), y0), 1 / 3), m: scale(sub(y0, y1), 1 / 3) })
const entry = (el, p, q) => (p === q ? el.s : el.m)

// The fault actually simulated: type and Rf only count with their features on
export function faultSpec(config, spec = {}) {
  return {
    type: config.features?.ground && spec.type === 'AG' ? 'AG' : '3PH',
    rf: config.features?.rf ? Math.max(0, spec.rf ?? 0) : 0,
  }
}

// Line Z0/Z1 as a complex ratio (angle relative to the line angle)
export function z0Ratio(line, config) {
  const ang = line.z0AngleDeg ?? config.lineAngleDeg
  return polar(line.z0Ratio ?? 3, (ang - config.lineAngleDeg) * DEG)
}

// Residual compensation k0 = (Z0 − Z1) / 3Z1. Auto (relay.k0 == null) matches
// the relay's own line; a number overrides the magnitude, keeping the angle.
export function lineK0(line, config) {
  return scale(sub(z0Ratio(line, config), ONE), 1 / 3)
}
export function relayK0(net, config, rid) {
  const r = config.relays[rid]
  const auto = lineK0(net.lines[r.line], config)
  if (r.k0 == null) return auto
  const m = abs(auto)
  return m > 0 ? scale(auto, r.k0 / m) : C(r.k0)
}

// Prefault load flow (feature 'load'): source EMF angles spread linearly
// along the chain, left end leading the right by loadAngleDeg (single-line:
// A leads B). With the feature off every EMF is at 0° — no load.
export function sourceAngleDeg(net, config, id) {
  if (!config.features?.load) return 0
  return (config.loadAngleDeg ?? 0) * (0.5 - net.buses[id].pos / net.length)
}

// One network solve (fault or healthy). Returns node voltages, in-service
// branches and per-source injections; relay measurement happens in solveFault.
function solveCore(net, config, loc, breakers, spec) {
  const θ = config.lineAngleDeg * DEG
  const unit = polar(1, θ)
  const { type, rf } = faultSpec(config, spec)
  const Esrc = Object.fromEntries(net.sources.map(id => [id, E_ABC.map(e => mul(e, polar(1, sourceAngleDeg(net, config, id) * DEG)))]))
  const faulted = type === 'AG' ? [0] : PH

  // Breaker (relay) at each line end
  const relayAt = {}
  for (const [rid, r] of Object.entries(config.relays)) relayAt[`${r.bus}|${r.line}`] = rid
  const endClosed = (bus, line) => {
    const rid = relayAt[`${bus}|${line}`]
    return !rid || breakers[rid] !== 'open'
  }

  // Branches (balanced series elements). A line splits at its internal
  // points: the fault F and, with the tap feature, the tap point T.
  const tap = activeTap(net, config)
  let fnode
  const branches = []
  const lineEl = (l, len) => { const z1 = scale(unit, len); return balanced(inv(z1), inv(mul(z1, z0Ratio(l, config)))) }
  for (const id of net.lineOrder) {
    const l = net.lines[id]
    const pts = []
    if (tap?.line === id) pts.push({ n: 'T', f: tap.at })
    if (loc?.kind === 'line' && loc.line === id && loc.frac > SNAP && loc.frac < 1 - SNAP) {
      const atTap = tap?.line === id && Math.abs(loc.frac - tap.at) <= SNAP
      if (atTap) fnode = 'T'
      else { pts.push({ n: 'F', f: loc.frac }); fnode = 'F' }
    }
    pts.sort((a, b) => a.f - b.f)
    // End segments open with their breaker; middle segments have none
    const ends = [{ n: l.from, f: 0 }, ...pts, { n: l.to, f: 1 }]
    for (let i = 1; i < ends.length; i++) {
      const on = (i > 1 || endClosed(l.from, id)) && (i < ends.length - 1 || endClosed(l.to, id))
      branches.push({ a: ends[i - 1].n, b: ends[i].n, el: lineEl(l, l.length * (ends[i].f - ends[i - 1].f)), line: id, on })
    }
  }

  // Tap: T → tap section → TH → tap transformer → TLV (load). No breaker on
  // the line side; the tap transformer's protection opens the transformer
  // (breakers.tap). The transformer and the load pass no zero sequence
  // (a tiny admittance keeps that mode solvable).
  let loadEl
  if (tap) {
    const l = net.lines[tap.line]
    const onLead = loc?.kind === 'tap' && loc.frac > SNAP && loc.frac < 1 - SNAP
    if (onLead) {
      fnode = 'F'
      branches.push({ a: 'T', b: 'F', el: lineEl(l, tap.lead * loc.frac), line: 'tap', on: true })
      branches.push({ a: 'F', b: 'TH', el: lineEl(l, tap.lead * (1 - loc.frac)), line: 'tap', on: true })
    } else {
      branches.push({ a: 'T', b: 'TH', el: lineEl(l, tap.lead), line: 'tap', on: true })
      if (loc?.kind === 'tap') fnode = loc.frac <= SNAP ? 'T' : 'TH'
    }
    const yt = inv(scale(unit, tap.zt))
    branches.push({ a: 'TH', b: 'TLV', el: balanced(yt, scale(yt, 1e-6)), line: 'tapXfmr', on: breakers.tap !== 'open' })
    const yl = inv(polar(1 / tap.load, TAP_LOAD_ANGLE))
    loadEl = balanced(yl, scale(yl, 1e-6))
    if (loc?.kind === 'tapLV') fnode = 'TLV'
  }
  if (!fnode && loc) {
    if (loc.kind === 'bus') fnode = loc.bus
    else if (loc.kind === 'line') fnode = loc.frac <= SNAP ? net.lines[loc.line].from : net.lines[loc.line].to
  }
  const nodes = [...net.busOrder, ...(tap ? ['T', 'TH', 'TLV'] : []), ...(fnode === 'F' ? ['F'] : [])]
  const live = branches.filter(br => br.on)
  const key = (n, p) => `${n}:${p}`

  // Sources: stiff (pinned to the EMF) or Norton (Y·E in parallel with Y)
  const srcEl = {}
  const pinned = {} // variable → fixed voltage
  for (const id of net.sources) {
    const sir = sirApplies(config, net.buses[id]) ? net.buses[id].sir ?? 0 : 0
    if (sir > 0) {
      const zs1 = scale(unit, sir)
      srcEl[id] = balanced(inv(zs1), inv(scale(zs1, net.buses[id].z0Ratio ?? 1)))
    } else {
      for (const p of PH) pinned[key(id, p)] = Esrc[id][p]
    }
  }
  if (fnode && rf === 0) for (const p of faulted) pinned[key(fnode, p)] = ZERO

  // Assemble Y·V = I over the unpinned phase variables
  const vars = nodes.flatMap(n => PH.map(p => key(n, p))).filter(k => !(k in pinned))
  const Y = Object.fromEntries(vars.map(k => [k, {}]))
  const rhs = Object.fromEntries(vars.map(k => [k, ZERO]))
  const anchored = new Set() // variables tied to ground or to a pinned voltage
  const couple = (i, j, y) => {
    if (!(i in Y)) return
    if (j in pinned) { rhs[i] = sub(rhs[i], mul(y, pinned[j])); anchored.add(i) }
    else Y[i][j] = add(Y[i][j] ?? ZERO, y)
  }
  for (const br of live) {
    for (const p of PH) for (const q of PH) {
      const y = entry(br.el, p, q)
      couple(key(br.a, p), key(br.a, q), y)
      couple(key(br.a, p), key(br.b, q), scale(y, -1))
      couple(key(br.b, p), key(br.b, q), y)
      couple(key(br.b, p), key(br.a, q), scale(y, -1))
    }
  }
  for (const [id, el] of Object.entries(srcEl)) {
    for (const p of PH) {
      const i = key(id, p)
      if (!(i in Y)) continue
      anchored.add(i)
      for (const q of PH) {
        couple(i, key(id, q), entry(el, p, q))
        rhs[i] = add(rhs[i], mul(entry(el, p, q), Esrc[id][q]))
      }
    }
  }
  // Tap load: a shunt to ground at the tap's low-voltage bus
  if (loadEl) {
    for (const p of PH) {
      const i = key('TLV', p)
      if (!(i in Y)) continue
      anchored.add(i)
      for (const q of PH) couple(i, key('TLV', q), entry(loadEl, p, q))
    }
  }
  if (fnode && rf > 0) {
    for (const p of faulted) {
      const i = key(fnode, p)
      if (!(i in Y)) continue
      anchored.add(i)
      couple(i, i, C(1 / rf))
    }
  }

  // Solve each variable connected to an anchor; the rest are dead (0 V)
  const stack = [...anchored]
  while (stack.length) {
    const i = stack.pop()
    for (const j of Object.keys(Y[i])) if (!anchored.has(j)) { anchored.add(j); stack.push(j) }
  }
  const solved = vars.filter(k => anchored.has(k))
  const Vx = { ...pinned }
  if (solved.length) {
    const A = solved.map(i => solved.map(j => Y[i][j] ?? ZERO))
    solveLinear(A, solved.map(i => rhs[i])).forEach((v, n) => { Vx[solved[n]] = v })
  }
  const V = (n, p) => Vx[key(n, p)] ?? ZERO

  // Phase currents from node n into a branch
  const branchI = (br, n) => {
    const m = br.a === n ? br.b : br.a
    return PH.map(p => PH.reduce((s, q) => add(s, mul(entry(br.el, p, q), sub(V(n, q), V(m, q)))), ZERO))
  }
  const outOf = n => live.filter(br => br.a === n || br.b === n)
    .reduce((acc, br) => { const I = branchI(br, n); return acc.map((s, p) => add(s, I[p])) }, [ZERO, ZERO, ZERO])

  // Source injections; a stiff source on a bolted fault feeds the faulted phases directly (∞)
  const srcI = id => PH.map(p => PH.reduce((s, q) => add(s, mul(entry(srcEl[id], p, q), sub(Esrc[id][q], V(id, q)))), ZERO))
  const sources = {}
  for (const id of net.sources) {
    // I: per-phase injection, null when infinite (stiff source on a bolted fault)
    const I = srcEl[id] ? srcI(id) : id === fnode && rf === 0 ? null : outOf(id)
    sources[id] = { I, mag: I ? Math.max(...I.map(abs)) : Infinity }
  }

  // Fault current: through Rf, or everything flowing into the pinned phases
  let faultI = 0
  if (fnode && rf > 0) faultI = Math.max(...faulted.map(p => abs(V(fnode, p)) / rf))
  else if (fnode) {
    // Into F: source current at F (if any) minus what leaves through the branches
    const out = outOf(fnode)
    const isSource = net.sources.includes(fnode)
    if (isSource && !srcEl[fnode]) faultI = Infinity
    else {
      const inj = isSource ? srcI(fnode) : [ZERO, ZERO, ZERO]
      faultI = Math.max(...faulted.map(p => abs(sub(inj[p], out[p]))))
    }
  }

  // CT current from a relay's bus into its line
  const relayI = r => {
    const br = live.find(b => b.line === r.line && (b.a === r.bus || b.b === r.bus))
    return br ? branchI(br, r.bus) : [ZERO, ZERO, ZERO]
  }
  return { V, relayI, sources, faultI, fnode, type, rf }
}

const NO_CURRENT = [ZERO, ZERO, ZERO]

// net: buildNetwork(); breakers: { rid: 'closed' | 'open' | 'failed' }
// loc: fault location, or null for the healthy (prefault) network
// spec: { type: '3PH' | 'AG', rf: pu } (gated by faultSpec)
//
// With prefault load, CTs always carry load current. The fault component —
// total minus the healthy network with the same breakers (superposition) —
// decides whether a relay "sees" the fault, which sources feed it, and the
// phase selection; loop impedances use total V and I, as a relay does. The
// memory polarizer is the prefault (all breakers closed) bus voltage.
export function solveFault(net, config, loc, breakers = {}, spec = {}) {
  const unit = polar(1, config.lineAngleDeg * DEG)
  const sol = solveCore(net, config, loc, breakers, spec)
  // The healthy network carries current with prefault load, or with a tap (its load)
  const loaded = (!!config.features?.load && (config.loadAngleDeg ?? 0) !== 0) || !!activeTap(net, config)
  const now = loaded ? solveCore(net, config, null, breakers, spec) : null
  const pre = loaded ? solveCore(net, config, null, {}, spec) : null

  const relays = {}
  for (const [rid, r] of Object.entries(config.relays)) {
    const Iabc = sol.relayI(r)
    const Vabc = PH.map(p => sol.V(r.bus, p))
    const healthy = now ? now.relayI(r) : NO_CURRENT
    const dI = PH.map(p => sub(Iabc[p], healthy[p]))
    const mem = pre ? PH.map(p => pre.V(r.bus, p)) : E_ABC
    // Prefault (load) impedance, positive sequence = Va / Ia
    const Ipre = pre ? pre.relayI(r)[0] : ZERO
    const Zl = abs(Ipre) > I_MIN ? div(pre.V(r.bus, 0), Ipre) : null
    relays[rid] = {
      ...measure(Vabc, Iabc, dI, mem, relayK0(net, config, rid), unit),
      Vabc, Iabc, Zload: Zl && { R: Zl.re, X: Zl.im },
    }
  }

  const sources = {}
  for (const id of net.sources) {
    const { I, mag } = sol.sources[id]
    const h = now?.sources[id].I
    const fault = !I ? Infinity : h ? Math.max(...PH.map(p => abs(sub(I[p], h[p])))) : mag
    sources[id] = { mag, live: fault > I_MIN }
  }
  const { faultI, fnode, type, rf } = sol
  return { relays, sources, faultI, energized: faultI > I_MIN, fnode, type, rf }
}

// Distance measurement for one relay. A simple phase selector picks the
// loop: with significant residual current (3I0) it's a ground fault → the
// ground loop of the highest-current phase, Z = Vp / (Ip + k0·3I0);
// otherwise a phase fault → the phase-pair loop with the most current,
// Z = (Vp − Vq) / (Ip − Iq). Direction is memory-polarized: the loop's
// prefault voltage (mem) against its current rotated by the line angle.
// Selection and "carrying" use the fault component dI (= Iabc without load).
function measure(Vabc, Iabc, dI, mem, k0, unit) {
  const I3I0 = Iabc.reduce(add, ZERO)
  const mags = dI.map(abs)
  const iMax = Math.max(...mags)
  const base = { V: Vabc[0], I: Iabc[0], I0x3: I3I0, carrying: iMax > I_MIN }
  if (!base.carrying) return { ...base, Z: null, dir: 0, loop: null }

  const pick = (vals, cands) => {
    const top = Math.max(...vals)
    return cands[vals.findIndex(v => v >= top * (1 - 1e-9))]
  }
  let loop, Vl, Il, Vm
  if (abs(I3I0) > GROUND_SHARE * iMax) {
    const p = pick(mags, PH)
    loop = `${PHASE[p]}G`
    Vl = Vabc[p]
    Il = add(Iabc[p], mul(k0, I3I0))
    Vm = mem[p]
  } else {
    const pairs = [[0, 1], [1, 2], [2, 0]]
    const [p, q] = pick(pairs.map(([p, q]) => abs(sub(dI[p], dI[q]))), pairs)
    loop = `${PHASE[p]}${PHASE[q]}`
    Vl = sub(Vabc[p], Vabc[q])
    Il = sub(Iabc[p], Iabc[q])
    Vm = sub(mem[p], mem[q])
  }
  if (abs(Il) <= I_MIN) return { ...base, Z: null, dir: 0, loop }
  const Z = div(Vl, Il)
  const torque = mul(Vm, conj(mul(Il, unit))).re
  return { ...base, loop, Z: { R: Z.re, X: Z.im }, dir: torque > 0 ? 1 : -1 }
}

// Source impedance behind a relay (pu, magnitude — the system is homogeneous):
// everything on the far side of its bus from its own line, i.e. the bus's own
// source in parallel with the chain beyond. Infinity when nothing feeds it.
// SIR = this / the relay's own line impedance.
export function impedanceBehind(net, config, rid) {
  const r = config.relays[rid]
  const behind = (bus, fromLine) => {
    const paths = []
    if (net.buses[bus].source) paths.push(sirApplies(config, net.buses[bus]) ? net.buses[bus].sir ?? 0 : 0)
    for (const id of net.lineOrder) {
      const l = net.lines[id]
      if (id === fromLine || (l.from !== bus && l.to !== bus)) continue
      paths.push(l.length + behind(l.from === bus ? l.to : l.from, id))
    }
    if (paths.some(z => z === 0)) return 0
    const y = paths.reduce((s, z) => s + 1 / z, 0)
    return y > 0 ? 1 / y : Infinity
  }
  return behind(r.bus, r.line)
}
