import { describe, it, expect } from 'vitest'
import { defaultConfig, migrateConfig, coordinationConfig } from './schema'
import { buildNetwork, faultPosition, relayGeometry, forwardDistance } from './network'
import { zoneReachPu, zoneRReachPu } from './protection'
import { solveFault, impedanceBehind } from './solver'
import { abs } from './complex'
import { faultImpedance, quadContains, quadPolygon } from './protection'
import { runSimulation } from './study'
import { simulateFault } from './timeline'
import { findConflicts } from './coordination'
import { FAULTS } from './faults'
import { LESSONS, TRACKS } from './lessons'
import { LEVELS, AUDIENCES, LEVEL_FEATURES, trackLabel, levelOf, levelFeatures, withLevel, configForLevel } from './levels'
import { runDifferential } from './differential'
import { costsAt, outageExtent } from './consequences'

const ms = t => Math.round(t * 10000) / 10 // s → ms, 0.1 ms resolution
const zone = (cfg, rid, zid) => cfg.relays[rid].zones.find(z => z.id === zid)
const trips = run => run.events.filter(e => e.kind === 'trip').map(e => [e.rid, ms(e.t)])
const opened = run => run.events.filter(e => e.kind === 'bkrOpen').map(e => e.rid).sort()
const BY10 = { kind: 'line', line: 'BY', frac: 0.1 }
const atFault = run => run.events.find(e => e.kind === 'fault').state

describe('network', () => {
  it('lays the chain out by cumulative impedance', () => {
    const net = buildNetwork(defaultConfig().network)
    expect(net.buses.X.pos).toBe(0)
    expect(net.buses.A.pos).toBe(1)
    expect(net.buses.B.pos).toBe(2)
    expect(net.buses.Y.pos).toBeCloseTo(2.6)
    expect(faultPosition(net, BY10)).toBeCloseTo(2.06)
  })

  it('finds the CTs carrying current from each source to the fault', () => {
    const cfg = defaultConfig()
    const sol = solveFault(buildNetwork(cfg.network), cfg, BY10)
    const carrying = Object.keys(sol.relays).filter(id => sol.relays[id].carrying).sort()
    expect(carrying).toEqual(['AB', 'AX', 'BA', 'BY', 'XA', 'YB'])
    expect(sol.sources.X.live && sol.sources.Y.live).toBe(true)
  })

  it('gives each relay its forward direction', () => {
    const cfg = defaultConfig()
    const net = buildNetwork(cfg.network)
    expect(relayGeometry(net, cfg.relays.AB).dir).toBe(1)
    expect(relayGeometry(net, cfg.relays.BA).dir).toBe(-1)
  })
})

describe('Fault Study (static)', () => {
  const row = (cfg, id) => runSimulation(FAULTS, cfg).find(r => r.fault.id === id)

  it('assesses the default six-fault suite', () => {
    const got = runSimulation(FAULTS, defaultConfig()).map(r => [r.fault.id, r.A.assessment, r.B.assessment])
    expect(got).toEqual([
      ['F1', 'Correct no-op', 'Backup (Z2)'],
      ['F2', 'Correct trip', 'Correct trip'],
      ['F3', 'Correct trip', 'Correct trip'],
      ['F4', 'Correct trip', 'Correct trip'],
      ['F5', 'Backup (Z2)', 'Correct no-op'],
      ['F6', 'Backup (Z2)', 'Correct no-op'],
    ])
  })

  it('converts stored cycles to trip time in seconds', () => {
    expect(row(defaultConfig(), 'F4').A.tripTime).toBeCloseTo(0.3)
  })

  it('flags Z1 overreach past the remote bus', () => {
    const cfg = defaultConfig()
    zone(cfg, 'AB', 1).reach = 115
    expect(row(cfg, 'F6').A.assessment).toBe('Overreach (Z1)')
  })

  it('flags a remote bus nobody covers as underreach', () => {
    const cfg = defaultConfig()
    zone(cfg, 'AB', 2).enabled = false
    expect(row(cfg, 'F5').A.assessment).toBe('Underreach')
  })

  it('flags Z2 faster than CTI beyond the remote bus as coordination failure', () => {
    const cfg = defaultConfig()
    zone(cfg, 'AB', 2).delayCycles = 6 // < 12 cyc CTI
    expect(row(cfg, 'F6').A.assessment).toBe('Coordination failure')
  })
})

describe('time-domain engine', () => {
  it('clears an adjacent-line fault selectively (sequential)', () => {
    const run = simulateFault(defaultConfig(), BY10)
    expect(run.outcome.verdict).toBe('selective')
    expect(trips(run)).toEqual([['BY', 16.7], ['YB', 316.7]])
    expect(ms(run.clearedAt)).toBe(366.7)
    const reset = run.events.find(e => e.kind === 'reset' && e.rid === 'AB')
    expect(ms(reset.margin)).toBe(250) // AB Z2 reset when 52-BY opened
  })

  it('falls back to remote Z2 when the primary breaker fails', () => {
    const run = simulateFault(defaultConfig(), BY10, { breakerFail: ['BY'] })
    expect(run.outcome.verdict).toBe('backup')
    expect(opened(run)).toEqual(['AB', 'YB'])
    expect(run.events.some(e => e.kind === 'bkrFail' && e.rid === 'BY')).toBe(true)
  })

  it('treats a trip as backup when the primary relay is out of service', () => {
    const run = simulateFault(defaultConfig(), BY10, { relayOos: ['BY'] })
    expect(run.outcome.verdict).toBe('backup')
    expect(opened(run)).toEqual(['AB', 'YB'])
  })

  it('detects Z2 overreach racing the downstream Z2', () => {
    const cfg = defaultConfig()
    zone(cfg, 'AB', 2).reach = 200
    const run = simulateFault(cfg, { kind: 'line', line: 'BY', frac: 0.9 })
    expect(run.outcome.verdict).toBe('miscoordination')
    expect(opened(run)).toEqual(['AB', 'BY', 'YB'])
  })

  it('clears a bus fault by remote backup', () => {
    const run = simulateFault(defaultConfig(), { kind: 'bus', bus: 'B' })
    expect(run.outcome.verdict).toBe('backup')
    expect(opened(run)).toEqual(['AB', 'YB'])
  })

  it('reports a fault nothing can see as not cleared', () => {
    const cfg = defaultConfig()
    for (const id of Object.keys(cfg.relays)) zone(cfg, id, 2).enabled = false
    const run = simulateFault(cfg, { kind: 'bus', bus: 'B' })
    expect(run.outcome.verdict).toBe('uncleared')
    expect(run.clearedAt).toBeNull()
  })

  it('keeps cycle counts when frequency changes', () => {
    const cfg = defaultConfig()
    cfg.timing.freqHz = 50
    const run = simulateFault(cfg, BY10)
    expect(trips(run)).toEqual([['BY', 20], ['YB', 380]]) // 1 cyc pickup + 18 cyc Z2 @ 50 Hz
  })

  it('snapshots which relays carry fault current', () => {
    const run = simulateFault(defaultConfig(), BY10)
    expect(atFault(run).carrying.sort()).toEqual(['AB', 'AX', 'BA', 'BY', 'XA', 'YB'])
    const afterBY = run.events.find(e => e.kind === 'bkrOpen' && e.rid === 'BY')
    expect(afterBY.state.carrying).toEqual(['YB'])
  })
})

describe('static coordination checks', () => {
  const relaysOf = cfg => {
    const net = buildNetwork(cfg.network)
    return Object.entries(cfg.relays).map(([id, r]) => ({ id, ...r, ...relayGeometry(net, r) }))
  }

  it('finds no problems with default settings', () => {
    const cfg = defaultConfig()
    expect(findConflicts(relaysOf(cfg), cfg.timing.ctiCycles)).toEqual([])
  })

  it('flags Z2 overlapping a downstream Z2 with less than CTI', () => {
    const cfg = defaultConfig()
    zone(cfg, 'AB', 2).reach = 200
    const c = findConflicts(relaysOf(cfg), cfg.timing.ctiCycles)
    expect(c.map(x => [x.rid, x.zoneId])).toEqual([['AB', 2]])
  })

  it('clears the flag once Z2 is slowed by a CTI', () => {
    const cfg = defaultConfig()
    zone(cfg, 'AB', 2).reach = 200
    zone(cfg, 'AB', 2).delayCycles = 30
    expect(findConflicts(relaysOf(cfg), cfg.timing.ctiCycles)).toEqual([])
  })

  it('flags Z1 overreach', () => {
    const cfg = defaultConfig()
    zone(cfg, 'BA', 1).reach = 110
    expect(findConflicts(relaysOf(cfg), cfg.timing.ctiCycles).map(x => [x.rid, x.zoneId])).toEqual([['BA', 1]])
  })
})

describe('schema migration', () => {
  it('upgrades v1 (Relay A/B, seconds @ 60 Hz)', () => {
    const v1 = {
      version: 1, lineAngleDeg: 70,
      relays: {
        A: { zones: [{ id: 1, reach: 85, delay: 0, enabled: true }, { id: 2, reach: 130, delay: 0.35, enabled: true }] },
        B: { zones: [{ id: 1, reach: 80, delay: 0, enabled: true }, { id: 2, reach: 120, delay: 0.3, enabled: true }] },
      },
    }
    const m = migrateConfig(v1)
    expect(m.lineAngleDeg).toBe(70)
    expect(m.version).toBe(12)
    expect(m.relays.AB.zones[1]).toEqual({ direction: 'forward', id: 2, reach: 130, rReach: 150, delayCycles: 21, enabled: true })
    expect(m.relays.AB.zones[2].direction).toBe('reverse')
  })

  it('upgrades v2 (seconds) using its own frequency', () => {
    const v2 = defaultConfig()
    v2.version = 2
    v2.timing = { freqHz: 50, relayCycles: 1, breakerCycles: 3, cti: 0.2 }
    delete v2.features; delete v2.pilot; delete v2.schemes
    for (const r of Object.values(v2.relays)) r.zones = r.zones.filter(z => z.direction !== 'reverse').map(({ delayCycles, direction, ...z }) => ({ ...z, delay: delayCycles / 60 }))
    const m = migrateConfig(v2)
    expect(m.version).toBe(12)
    expect(m.schemes).toEqual({ XA: 'step', AB: 'step', BY: 'step' })
    expect(m.timing.ctiCycles).toBe(10)
    expect(m.relays.AB.zones[1].delayCycles).toBe(15)
    expect('delay' in m.relays.AB.zones[1]).toBe(false)
  })

  it('upgrades v4 (stiff sources) and v5 (positive sequence) to v6 defaults', () => {
    const v5 = defaultConfig()
    v5.version = 5
    delete v5.features.ground
    delete v5.features.rf
    v5.network.buses = v5.network.buses.map(({ z0Ratio, ...b }) => b)
    v5.network.lines = v5.network.lines.map(({ z0Ratio, z0AngleDeg, ...l }) => l)
    for (const r of Object.values(v5.relays)) delete r.k0
    expect(migrateConfig(structuredClone(v5))).toEqual(defaultConfig())

    const v4 = structuredClone(v5)
    v4.version = 4
    delete v4.features.sir
    v4.network.buses = v4.network.buses.map(({ sir, ...b }) => b)
    const next = migrateConfig(v4)
    expect(next.features.sir).toBe(false)
    expect(next.network.buses.map(b => b.sir)).toEqual([0, 0, 0, 0])
    expect(next).toEqual(defaultConfig())
  })

  it('upgrades v10 (no consequences module) to current defaults', () => {
    const v10 = defaultConfig()
    v10.version = 10
    delete v10.consequences
    delete v10.features.consequences
    v10.features.diff = true
    const m = migrateConfig(v10)
    expect(m.version).toBe(12)
    expect(m.consequences).toEqual({ cctCycles: 12 })
    expect(m.features.consequences).toBe(false)
    expect(m.features.diff).toBe(true)
  })

  it('upgrades v11 (no line tap) to v12: tap defaults on line A–B, feature off', () => {
    const v11 = defaultConfig()
    v11.version = 11
    delete v11.features.tap
    v11.network.lines = v11.network.lines.map(({ tap, ...l }) => l)
    const m = migrateConfig(v11)
    expect(m.version).toBe(12)
    expect(m.features.tap).toBe(false)
    expect(m.network.lines.find(l => l.id === 'AB').tap).toEqual({ at: 0.4, lead: 0.2, zt: 2.0, load: 0.1, clearCycles: 6 })
    expect(m.network.lines.filter(l => l.tap)).toHaveLength(1)
    expect(m).toEqual(defaultConfig())
  })

  it('passes v12 through and rejects unknown versions', () => {
    const cfg = defaultConfig()
    expect(migrateConfig(cfg)).toBe(cfg)
    expect(() => migrateConfig({ version: 99 })).toThrow()
  })
})

describe('pilot schemes (V1.5)', () => {
  const withScheme = (scheme, tweak = c => c) => {
    const cfg = defaultConfig()
    cfg.features.pilot = true
    cfg.schemes.AB = scheme
    return tweak(cfg)
  }
  const AB95 = { kind: 'line', line: 'AB', frac: 0.95 }
  const tripOf = (run, rid) => run.events.find(e => e.kind === 'trip' && e.rid === rid)

  it('leaves step distance unchanged while the feature is off', () => {
    const cfg = defaultConfig() // schemes.AB = DCB but features.pilot = false
    const run = simulateFault(cfg, AB95)
    expect(tripOf(run, 'AB').logic).toBe('step')
    expect(ms(tripOf(run, 'AB').t)).toBe(316.7)
  })

  it('DCB accelerates Z2 for an internal fault (pickup + coordination timer)', () => {
    const run = simulateFault(withScheme('DCB'), AB95)
    expect(tripOf(run, 'AB').logic).toBe('DCB')
    expect(ms(tripOf(run, 'AB').t)).toBe(50) // 1 cyc + 2 cyc
    expect(run.outcome.verdict).toBe('selective')
  })

  it('DCB holds for an external fault when the remote reverse zone blocks', () => {
    const run = simulateFault(withScheme('DCB'), BY10)
    expect(run.events.some(e => e.kind === 'tx' && e.rid === 'BA')).toBe(true)
    expect(run.events.some(e => e.kind === 'blocked' && e.rid === 'AB')).toBe(true)
    expect(tripOf(run, 'AB')).toBeUndefined()
    expect(run.outcome.verdict).toBe('selective')
  })

  it('DCB holds for a remote bus fault (reverse zone sees its own bus)', () => {
    const run = simulateFault(withScheme('DCB'), { kind: 'bus', bus: 'B' })
    expect(tripOf(run, 'AB').logic).toBe('step')
  })

  it('DCB overtrips for an external fault when the channel is out', () => {
    const run = simulateFault(withScheme('DCB'), BY10, { channels: { AB: 'out' } })
    expect(tripOf(run, 'AB').logic).toBe('DCB')
    expect(run.outcome.verdict).toBe('miscoordination')
  })

  it('DCB overtrips when the coordination timer is shorter than the channel', () => {
    const run = simulateFault(withScheme('DCB', c => { c.pilot.dcbCoordCycles = 0.25; return c }), BY10)
    expect(tripOf(run, 'AB').logic).toBe('DCB')
    expect(run.outcome.verdict).toBe('miscoordination')
  })

  it('POTT trips on Z2 + permissive after the channel delay', () => {
    const run = simulateFault(withScheme('POTT'), AB95)
    expect(tripOf(run, 'AB').logic).toBe('POTT')
    expect(ms(tripOf(run, 'AB').t)).toBe(25) // 1 cyc pickup + 0.5 cyc channel
  })

  it('POTT falls back to step distance when the channel is out', () => {
    const run = simulateFault(withScheme('POTT'), AB95, { channels: { AB: 'out' } })
    expect(tripOf(run, 'AB').logic).toBe('step')
    expect(ms(tripOf(run, 'AB').t)).toBe(316.7)
  })

  it('DCUB trips in the unblock window when the channel is lost at the fault', () => {
    const run = simulateFault(withScheme('DCUB'), AB95, { channels: { AB: 'lost' } })
    expect(tripOf(run, 'AB').logic).toBe('DCUB')
    expect(ms(tripOf(run, 'AB').t)).toBe(16.7)
  })

  it('DCUB is locked out when the channel failed before the fault', () => {
    const run = simulateFault(withScheme('DCUB'), AB95, { channels: { AB: 'out' } })
    expect(tripOf(run, 'AB').logic).toBe('step')
  })

  it('Fault Study reports pilot logic and flags pilot overtrips', () => {
    const cfg = withScheme('DCB')
    const rows = runSimulation(FAULTS, cfg, { channels: { AB: 'out' } })
    const f4 = rows.find(r => r.fault.id === 'F4')
    const f6 = rows.find(r => r.fault.id === 'F6')
    expect(f4.A.pilot.logic).toBe('DCB')
    expect(f6.A.assessment).toBe('Pilot overtrip')
  })
})

describe('phasor solver (V2 phase 1)', () => {
  const withSir = (cfg, sir) => {
    for (const b of cfg.network.buses) b.sir = sir
    cfg.features.sir = true
    return cfg
  }
  const LOCS = [
    { kind: 'bus', bus: 'X' }, { kind: 'bus', bus: 'A' }, { kind: 'bus', bus: 'B' }, { kind: 'bus', bus: 'Y' },
    ...['XA', 'AB', 'BY'].flatMap(line => [0.05, 0.5, 0.8, 0.95].map(frac => ({ kind: 'line', line, frac }))),
  ]

  it.each([0, 0.2, 4])('measured Z = geometric impedance to the fault (no infeed, SIR %s)', sir => {
    const cfg = withSir(defaultConfig(), sir)
    const net = buildNetwork(cfg.network)
    for (const loc of LOCS) {
      const pf = faultPosition(net, loc)
      const sol = solveFault(net, cfg, loc)
      for (const [rid, r] of Object.entries(cfg.relays)) {
        const m = sol.relays[rid]
        const fwd = forwardDistance(net, r, pf)
        const want = faultImpedance(fwd, cfg.lineAngleDeg)
        expect(m.carrying).toBe(true)
        expect(m.Z.R).toBeCloseTo(want.R, 9)
        expect(m.Z.X).toBeCloseTo(want.X, 9)
        if (Math.abs(fwd) > 1e-9) expect(m.dir).toBe(Math.sign(fwd))
      }
    }
  })

  it('reads a bolted fault on the relay\'s own bus as reverse (memory polarization)', () => {
    const cfg = defaultConfig()
    const m = solveFault(buildNetwork(cfg.network), cfg, { kind: 'bus', bus: 'A' }).relays.AB
    expect(Math.hypot(m.V.re, m.V.im)).toBe(0)
    expect(m.dir).toBe(-1)
  })

  it('SIR sets the relay voltage for a close-in fault, not the impedance', () => {
    const vAt = sir => {
      const cfg = coordinationConfig(withSir(defaultConfig(), sir))
      const m = solveFault(buildNetwork(cfg.network), cfg, { kind: 'line', line: 'AB', frac: 0.05 }).relays.AB
      return { v: Math.hypot(m.V.re, m.V.im), z: Math.hypot(m.Z.R, m.Z.X) }
    }
    expect(vAt(0).v).toBeCloseTo(1, 9)
    expect(vAt(10).v).toBeCloseTo(0.05 / 10.05, 9)
    expect(vAt(10).z).toBeCloseTo(0.05, 9)
  })

  it('an open breaker carries nothing; opening both ends clears the fault', () => {
    const cfg = coordinationConfig(defaultConfig())
    const net = buildNetwork(cfg.network)
    const loc = { kind: 'line', line: 'AB', frac: 0.5 }
    const one = solveFault(net, cfg, loc, { AB: 'open' })
    expect(one.relays.AB.carrying).toBe(false)
    expect(one.energized).toBe(true)
    expect(solveFault(net, cfg, loc, { AB: 'open', BA: 'open' }).energized).toBe(false)
    expect(solveFault(net, cfg, loc, { AB: 'open', BA: 'failed' }).energized).toBe(true)
  })

  it('a stiff source on the faulted bus keeps feeding it', () => {
    const cfg = coordinationConfig(defaultConfig())
    const sol = solveFault(buildNetwork(cfg.network), cfg, { kind: 'bus', bus: 'A' }, { AB: 'open', BA: 'open' })
    expect(sol.sources.A.mag).toBe(Infinity)
    expect(sol.energized).toBe(true)
  })

  it('ignores SIR while the feature is off', () => {
    const cfg = coordinationConfig(withSir(defaultConfig(), 10))
    cfg.features.sir = false
    const m = solveFault(buildNetwork(cfg.network), cfg, { kind: 'line', line: 'AB', frac: 0.05 }).relays.AB
    expect(Math.hypot(m.V.re, m.V.im)).toBeCloseTo(1, 9)
  })

  it('fault impedance limits the fault current', () => {
    const cfg = coordinationConfig(defaultConfig())
    const net = buildNetwork(cfg.network)
    const loc = { kind: 'line', line: 'AB', frac: 0.5 }
    const bolted = solveFault(net, cfg, loc).faultI
    cfg.features.rf = true
    const resistive = solveFault(net, cfg, loc, {}, { rf: 0.5 }).faultI
    expect(resistive).toBeLessThan(bolted)
    expect(resistive).toBeGreaterThan(0)
  })

  it('source impedance changes no trip, timing or verdict (sources only at the ends)', () => {
    const runAll = sir => {
      const out = []
      for (const adjacent of [false, true]) for (const pilot of [false, true]) {
        const c = withSir(defaultConfig(), sir)
        c.features = { ...c.features, adjacent, pilot }
        const cfg = coordinationConfig(c)
        for (const loc of LOCS) {
          if (!cfg.network.lines.some(l => l.id === loc.line) && !cfg.network.buses.some(b => b.id === loc.bus)) continue
          const run = simulateFault(cfg, loc)
          out.push([trips(run), run.outcome.verdict])
        }
      }
      return out
    }
    expect(runAll(2)).toEqual(runAll(0))
  })

  it('opens with a healthy prefault period before the fault at t = 0', () => {
    const run = simulateFault(defaultConfig(), BY10)
    const [pre, fault] = run.events
    expect(pre.kind).toBe('prefault')
    expect(ms(pre.t)).toBe(-50) // 3 cycles @ 60 Hz
    expect(run.startT).toBe(pre.t)
    expect(pre.state.faultEnergized).toBe(false)
    expect(pre.state.carrying).toEqual([])
    expect(Math.hypot(pre.state.meas.AB.V.re - 1, pre.state.meas.AB.V.im)).toBeLessThan(1e-12)
    expect(fault.kind).toBe('fault')
    expect(fault.t).toBe(0)
    expect(fault.state.faultEnergized).toBe(true)
  })

  it('snapshots carry V and I per relay for the phasor panel', () => {
    const run = simulateFault(defaultConfig(), BY10)
    const m = atFault(run).meas.AB
    expect(m.V).toBeDefined()
    expect(m.I).toBeDefined()
    expect(m.dir).toBe(1)
  })
})

describe('ground faults and fault resistance (V2 phases 3–4)', () => {
  const AB50 = { kind: 'line', line: 'AB', frac: 0.5 }
  const mag = c => Math.hypot(c.re, c.im)
  const withFeatures = (cfg, f) => { cfg.features = { ...cfg.features, ...f }; return cfg }
  const LOCS = [
    { kind: 'bus', bus: 'A' }, { kind: 'bus', bus: 'B' },
    ...['XA', 'AB', 'BY'].flatMap(line => [0.05, 0.5, 0.95].map(frac => ({ kind: 'line', line, frac }))),
  ]

  it('A–G fault current matches the sequence-network formula 3E / (Z1 + Z2 + Z0)', () => {
    const cfg = coordinationConfig(withFeatures(defaultConfig(), { ground: true, sir: true }))
    for (const b of cfg.network.buses) b.sir = 1
    const sol = solveFault(buildNetwork(cfg.network), cfg, AB50, {}, { type: 'AG' })
    // Z1th = 1.5 ∥ 1.5 = 0.75, Z0th = (1 + 1.5) ∥ (1 + 1.5) = 1.25 (source Z0/Z1 = 1, line 3)
    expect(sol.faultI).toBeCloseTo(3 / (0.75 + 0.75 + 1.25), 9)
  })

  it.each([0, 1])('ground loops with auto k0 measure the true impedance (SIR %s)', sir => {
    const cfg = withFeatures(defaultConfig(), { ground: true, sir: true })
    for (const b of cfg.network.buses) b.sir = sir
    const net = buildNetwork(cfg.network)
    for (const loc of LOCS) {
      const pf = faultPosition(net, loc)
      const sol = solveFault(net, cfg, loc, {}, { type: 'AG' })
      for (const [rid, r] of Object.entries(cfg.relays)) {
        const m = sol.relays[rid]
        const want = faultImpedance(forwardDistance(net, r, pf), cfg.lineAngleDeg)
        expect(m.loop).toBe('AG')
        expect(m.Z.R).toBeCloseTo(want.R, 9)
        expect(m.Z.X).toBeCloseTo(want.X, 9)
      }
    }
  })

  it('3Ø faults use a phase loop; A–G is ignored while ground faults are off', () => {
    const cfg = defaultConfig()
    const net = buildNetwork(cfg.network)
    expect(solveFault(net, cfg, AB50, {}, { type: 'AG' }).relays.AB.loop).toBe('AB')
    withFeatures(cfg, { ground: true })
    expect(solveFault(net, cfg, AB50, {}, { type: 'AG' }).relays.AB.loop).toBe('AG')
    expect(solveFault(net, cfg, AB50, {}, { type: '3PH' }).relays.AB.loop).toBe('AB')
  })

  it('source Z0 changes the A–G fault current but not auto-k0 reach; a Z0 angle makes k0 complex and still exact', () => {
    const cfg = coordinationConfig(withFeatures(defaultConfig(), { ground: true, sir: true }))
    for (const b of cfg.network.buses) b.sir = 1
    const If = z0 => { for (const b of cfg.network.buses) b.z0Ratio = z0; return solveFault(buildNetwork(cfg.network), cfg, AB50, {}, { type: 'AG' }) }
    // Z0th = (z0 + 1.5) ∥ (z0 + 1.5) with line Z0 = 3 × 0.5 each side
    expect(If(3).faultI).toBeCloseTo(3 / (0.75 + 0.75 + 2.25), 9)
    expect(If(3).faultI).toBeLessThan(If(1).faultI)
    const z = If(3).relays.AB.Z
    expect(Math.hypot(z.R, z.X)).toBeCloseTo(0.5, 9)
    cfg.network.lines[0].z0AngleDeg = 70
    const z70 = solveFault(buildNetwork(cfg.network), cfg, AB50, {}, { type: 'AG' }).relays.AB.Z
    expect(z70.R).toBeCloseTo(faultImpedance(0.5, 75).R, 9)
    expect(z70.X).toBeCloseTo(faultImpedance(0.5, 75).X, 9)
  })

  it('k0 set to zero makes a ground element underreach', () => {
    const cfg = coordinationConfig(withFeatures(defaultConfig(), { ground: true }))
    const net = buildNetwork(cfg.network)
    const loc = { kind: 'line', line: 'AB', frac: 0.5 }
    const auto = solveFault(net, cfg, loc, {}, { type: 'AG' }).relays.AB.Z
    cfg.relays.AB.k0 = 0
    const none = solveFault(net, cfg, loc, {}, { type: 'AG' }).relays.AB.Z
    expect(Math.hypot(none.R, none.X)).toBeGreaterThan(Math.hypot(auto.R, auto.X) * 1.2)
  })

  it('Rf adds resistance to the apparent impedance (X unchanged); ignored while the feature is off', () => {
    const cfg = coordinationConfig(defaultConfig())
    const net = buildNetwork(cfg.network)
    const bolted = solveFault(net, cfg, AB50).relays.AB.Z
    expect(solveFault(net, cfg, AB50, {}, { rf: 0.3 }).relays.AB.Z.R).toBeCloseTo(bolted.R, 9)
    withFeatures(cfg, { rf: true })
    const z = solveFault(net, cfg, AB50, {}, { rf: 0.3 }).relays.AB.Z
    // Two equal stiff sources feed equal currents: apparent Rf doubles at each end
    expect(z.R).toBeCloseTo(bolted.R + 0.6, 9)
    expect(z.X).toBeCloseTo(bolted.X, 9)
  })

  it('a resistive fault drops out of Z1, then out of every MHO zone', () => {
    const cfg = coordinationConfig(withFeatures(defaultConfig(), { rf: true }))
    const loc = { kind: 'line', line: 'AB', frac: 0.5 }
    expect(trips(simulateFault(cfg, loc))).toEqual([['AB', 16.7], ['BA', 16.7]])
    // Midline Z = 0.5∠75° + 2·Rf: Rf 0.25 leaves Z1 (80%) but stays in Z2 (120%)
    const run = simulateFault(cfg, loc, {}, { rf: 0.25 })
    expect(trips(run)).toEqual([['AB', 316.7], ['BA', 316.7]])
    expect(run.events[1].text).toMatch(/Rf = 0.25 pu/)
    // Rf 0.6 falls outside both MHO circles: nothing sees it
    expect(simulateFault(cfg, loc, {}, { rf: 0.6 }).outcome.verdict).toBe('uncleared')
  })
})

describe('quadrilateral characteristic', () => {
  const AB50 = { kind: 'line', line: 'AB', frac: 0.5 }
  const quadCfg = (rf = true) => {
    const cfg = coordinationConfig(defaultConfig())
    cfg.features.rf = rf
    for (const r of Object.values(cfg.relays)) r.shape = 'quad'
    return cfg
  }

  it('polygon vertices lie on the boundary the zone test uses', () => {
    const poly = quadPolygon(0.8, 1.0, 75)
    const c = { R: poly.reduce((s, v) => s + v.R, 0) / poly.length, X: poly.reduce((s, v) => s + v.X, 0) / poly.length }
    for (const v of poly) {
      expect(quadContains(v.R, v.X, 0.8, 1.0, 75)).toBe(true)
      const d = Math.hypot(v.R - c.R, v.X - c.X) // nudge each vertex outward, away from the centroid
      expect(quadContains(v.R + 0.02 * (v.R - c.R) / d, v.X + 0.02 * (v.X - c.X) / d, 0.8, 1.0, 75)).toBe(false)
    }
  })

  it('covers resistive faults the MHO misses (Rf 0.25 → Z1, 0.6 → Z2)', () => {
    const cfg = quadCfg()
    expect(trips(simulateFault(cfg, AB50, {}, { rf: 0.25 }))).toEqual([['AB', 16.7], ['BA', 16.7]])
    const run = simulateFault(cfg, AB50, {}, { rf: 0.6 })
    expect(trips(run)).toEqual([['AB', 316.7], ['BA', 316.7]])
    expect(run.outcome.verdict).toBe('selective')
  })

  it('bolted faults trip exactly as with MHO; quad is ignored while fault resistance is off', () => {
    const mho = coordinationConfig(defaultConfig())
    for (const frac of [0.05, 0.5, 0.79, 0.81, 0.95]) {
      const loc = { kind: 'line', line: 'AB', frac }
      expect(trips(simulateFault(quadCfg(), loc))).toEqual(trips(simulateFault(mho, loc)))
    }
    expect(trips(simulateFault(quadCfg(false), AB50, {}, { rf: 0.25 }))).toEqual(trips(simulateFault(mho, AB50)))
  })
})

describe('single-line base system', () => {
  it('reduces to line A–B with a source at each bus unless adjacent lines are on', () => {
    const cfg = coordinationConfig(defaultConfig())
    expect(cfg.network.lines.map(l => l.id)).toEqual(['AB'])
    expect(cfg.network.buses).toEqual([{ id: 'A', source: true, sir: 0, z0Ratio: 1, infeed: false }, { id: 'B', source: true, sir: 0, z0Ratio: 1, infeed: false }])
    expect(Object.keys(cfg.relays)).toEqual(['AB', 'BA'])
    const full = defaultConfig(); full.features.adjacent = true
    expect(coordinationConfig(full)).toBe(full)
  })

  it('clears an end-zone fault sequentially: remote Z1 fast, local Z2 slow', () => {
    const run = simulateFault(coordinationConfig(defaultConfig()), { kind: 'line', line: 'AB', frac: 0.9 })
    expect(trips(run)).toEqual([['BA', 16.7], ['AB', 316.7]])
    expect(run.outcome.verdict).toBe('selective')
  })
})

describe('lessons', () => {
  const setupOf = lesson => { const cfg = defaultConfig(); lesson.setup?.(cfg); return cfg }

  it.each(LESSONS.filter(l => l.tab === 'coord').map(l => [l.id, l]))('%s produces its stated outcome', (_, lesson) => {
    const cfg = coordinationConfig(setupOf(lesson))
    const run = simulateFault(cfg, lesson.fault, lesson.scenario ?? {}, lesson.faultSpec)
    expect(run.outcome.verdict).toBe(lesson.expect.verdict)
  })

  it('lessons that send you to Failures are Coordination lessons (the panel opens and is outlined there)', () => {
    const uses = LESSONS.filter(l => l.tryIt.some(t => t.includes('Failures')))
    expect(uses.length).toBeGreaterThan(0)
    for (const l of uses) expect(l.tab).toBe('coord')
  })

  it('study lessons point at a real fault', () => {
    for (const l of LESSONS.filter(l => l.tab === 'study')) expect(FAULTS.some(f => f.id === l.faultId)).toBe(true)
  })

  // Spot-check the "try this" claims that lessons make
  describe('Tapped lines', () => {
    const pct = (sim, id) => {
      const net = buildNetwork(sim.cfg.network)
      const m = solveFault(net, sim.cfg, sim.loc, {}, {}).relays[id]
      return Math.round(Math.hypot(m.Z.R, m.Z.X) * 1000) / 10
    }
    const tapRun = (id, patch = {}, cfgPatch) => {
      const l = LESSONS.find(x => x.id === id)
      const cfg = setupOf(l)
      cfgPatch?.(cfg)
      const cc = coordinationConfig(cfg)
      const loc = patch.fault ?? l.fault
      const sim = simulateFault(cc, loc, {}, {})
      return { sim, cfg: cc, loc, at: rid => msOf(sim.events.at(-1).state.tripped[rid]?.t) }
    }
    const msOf = t => (t === undefined ? undefined : Math.round(t * 1000))

    it('tap section inside your zone: 110% from both ends, Z2 at 317 / cleared 367; POTT 75 ms; weak B 83% / 350%, 433 ms; main line unaffected', () => {
      const r = tapRun('tap-underreach')
      expect(pct({ cfg: r.cfg, loc: r.loc }, 'AB')).toBeCloseTo(110, 0)
      expect(pct({ cfg: r.cfg, loc: r.loc }, 'BA')).toBeCloseTo(110, 0)
      expect([r.at('AB'), r.at('BA')]).toEqual([317, 317])
      expect(msOf(r.sim.outcome.clearedAt)).toBe(367)
      const pott = tapRun('tap-underreach', {}, c => { c.schemes.AB = 'POTT' })
      expect([pott.at('AB'), pott.at('BA')]).toEqual([25, 25])
      expect(msOf(pott.sim.outcome.clearedAt)).toBe(75)
      const weak = tapRun('tap-underreach', {}, c => { c.network.buses.find(b => b.id === 'B').sir = 4 })
      expect(Math.round(pct({ cfg: weak.cfg, loc: weak.loc }, 'AB'))).toBe(83)
      expect(Math.round(pct({ cfg: weak.cfg, loc: weak.loc }, 'BA'))).toBe(350)
      expect(weak.sim.events.at(-1).state.tripped.BA.zoneId).toBe(1)
      expect(msOf(weak.sim.outcome.clearedAt)).toBe(433)
      const long = tapRun('tap-underreach', {}, c => { c.network.lines.find(l => l.id === 'AB').tap.lead = 0.5 })
      expect(Math.round(pct({ cfg: long.cfg, loc: long.loc }, 'AB'))).toBe(150)
      expect(Math.round(pct({ cfg: long.cfg, loc: long.loc }, 'BA'))).toBe(150)
      const main = { kind: 'line', line: 'AB', frac: 0.55 }
      const ml = tapRun('tap-underreach', { fault: main })
      expect(Math.round(pct({ cfg: ml.cfg, loc: main }, 'AB'))).toBe(55)
      expect(Math.round(pct({ cfg: ml.cfg, loc: main }, 'BA'))).toBe(45)
      const nearB = { kind: 'line', line: 'AB', frac: 0.9 }
      const short = 90 - pct({ cfg: tapRun('tap-underreach', { fault: nearB }).cfg, loc: nearB }, 'AB')
      expect(short).toBeGreaterThan(0.5); expect(short).toBeLessThan(2.5)
    })

    it('measured Z on the tap section = Z to T + Z_lead·(1 + I_other/I_own), from the solved currents', () => {
      const cfg = defaultConfig()
      cfg.features.tap = true // at 0.4, lead 0.2
      const cc = coordinationConfig(cfg)
      const net = buildNetwork(cc.network)
      const m = solveFault(net, cc, { kind: 'tap', frac: 1 }, {}, {}).relays
      const ratio = abs(m.BA.I) / abs(m.AB.I)
      expect(Math.hypot(m.AB.Z.R, m.AB.Z.X)).toBeCloseTo(0.4 + 0.2 * (1 + ratio), 3)
      expect(Math.hypot(m.BA.Z.R, m.BA.Z.X)).toBeCloseTo(0.6 + 0.2 * (1 + 1 / ratio), 3)
    })

    it('with the tap feature off nothing changes; with it, a fault beyond the tap overreaches slightly (outfeed)', () => {
      const base = defaultConfig(), off = defaultConfig()
      off.network.lines.find(l => l.id === 'AB').tap.load = 0.5 // ignored while the feature is off
      const loc = { kind: 'line', line: 'AB', frac: 0.9 }
      expect(simulateFault(coordinationConfig(off), loc, {}, {}).outcome).toEqual(simulateFault(coordinationConfig(base), loc, {}, {}).outcome)
      const on = defaultConfig(); on.features.tap = true
      const cc = coordinationConfig(on), net = buildNetwork(cc.network)
      // Outfeed: the tap draws current out at T, so a fault beyond it reads slightly
      // closer (overreach) — small for a load tap (~1.6% here)
      const z = solveFault(net, cc, loc, {}, {}).relays.AB.Z
      expect(Math.hypot(z.R, z.X)).toBeLessThan(0.9)
      expect(Math.hypot(z.R, z.X)).toBeGreaterThan(0.87)
    })

    it('fault behind the tap transformer: 101% / 237%, tap protection at 100 ms; Z2 3 cyc → line trips at 67 ms (miscoordination); 6 cyc → tight', () => {
      const r = tapRun('tap-behind')
      expect(Math.round(pct({ cfg: r.cfg, loc: r.loc }, 'AB'))).toBe(101)
      expect(Math.round(pct({ cfg: r.cfg, loc: r.loc }, 'BA'))).toBe(237)
      expect(msOf(r.sim.outcome.clearedAt)).toBe(100)
      expect(r.sim.events.some(e => e.kind === 'pickup' && e.rid === 'AB' && e.zid === 2)).toBe(true)
      expect(r.sim.events.some(e => e.kind === 'pickup' && e.zid === 1)).toBe(false)
      expect(r.sim.events.some(e => e.kind === 'pickup' && e.rid === 'BA')).toBe(false)
      const fast = tapRun('tap-behind', {}, c => { c.relays.AB.zones[1].delayCycles = 3 })
      expect(fast.sim.outcome.verdict).toBe('miscoordination')
      expect(fast.at('AB')).toBe(67)
      expect(tapRun('tap-behind', {}, c => { c.relays.AB.zones[1].delayCycles = 6 }).sim.outcome.verdict).toBe('tight')
    })

    it('a tap the 87L can’t see: healthy Iop ≈ 0.35 > 0.3 (misoperation); pickup 0.5 restrains, F2–F4 trip ≥ 1.6; tap off → 0.05', () => {
      const l = LESSONS.find(x => x.id === 'tap-87l')
      const cfg = setupOf(l)
      const rows = runDifferential(FAULTS, cfg, {})
      expect(rows[0].worst.Iop).toBeCloseTo(0.35, 2)
      expect(rows[0].assessment).toBe('Misoperation')
      cfg.diff.pickupPu = 0.5
      const raised = runDifferential(FAULTS, cfg, {})
      expect(raised[0].assessment).toBe('Correct restraint')
      for (const id of ['F2', 'F3', 'F4']) {
        const row = raised.find(r => r.fault.id === id)
        expect(row.assessment).toBe('Correct trip')
        expect(row.worst.Iop).toBeGreaterThanOrEqual(1.55)
      }
      cfg.features.tap = false
      expect(runDifferential(FAULTS, cfg, {})[0].worst.Iop).toBeCloseTo(0.05, 2)
    })
  })

  describe('Why protection matters', () => {
    const lessonRun = (id, patch = {}, cfgPatch) => {
      const l = LESSONS.find(x => x.id === id)
      const cfg = setupOf(l)
      cfgPatch?.(cfg)
      const sc = { relayOos: [], breakerFail: [], channels: {}, diffChannel: 'ok', dcLost: [], ...l.scenario, ...patch.scenario }
      const loc = patch.fault ?? l.fault
      const cc = coordinationConfig(cfg)
      const sim = simulateFault(cc, loc, sc, l.faultSpec)
      return { sim, c: costsAt(sim, cfg), out: outageExtent(sim, cc, loc) }
    }
    const msOf = t => Math.round(t * 1000)

    it('what a fault costs: 100 ms clear, then a stuck 52-AB costs 22 cycles, ~3× duty, ~4× arc, X–A and bus A', () => {
      const ok = lessonRun('why-cost')
      expect(msOf(ok.sim.outcome.clearedAt)).toBe(100)
      expect(ok.c.beyondCct).toBe(false)
      expect(ok.out.extraLines).toEqual([])
      const stuck = lessonRun('why-cost', { scenario: { breakerFail: ['AB'] } })
      expect(stuck.sim.outcome.verdict).toBe('backup')
      expect(msOf(stuck.sim.outcome.clearedAt)).toBe(367)
      expect(stuck.c.beyondCct).toBe(true)
      expect(stuck.c.duty).toBeGreaterThan(2.5); expect(stuck.c.duty).toBeLessThan(3.2)
      expect(stuck.c.arc).toBeGreaterThan(3.5); expect(stuck.c.arc).toBeLessThan(4)
      expect(stuck.out.extraLines).toEqual(['XA'])
      expect(stuck.out.extraBuses).toEqual(['A'])
    })

    it('one dead battery: B trips DCB at 50 ms, X clears at 367 ms; DC back → 100 ms; at 50% never cleared', () => {
      const dead = lessonRun('why-dc')
      const trips = Object.fromEntries(Object.entries(dead.sim.events.at(-1).state.tripped).map(([id, t]) => [id, msOf(t.t)]))
      expect(trips).toEqual({ BA: 50, XA: 317 })
      expect(msOf(dead.sim.outcome.clearedAt)).toBe(367)
      expect(dead.out.extraBuses).toEqual(['A'])
      expect(dead.sim.events.some(e => e.text.startsWith('Station A DC supply lost'))).toBe(true)
      expect(msOf(lessonRun('why-dc', { scenario: { dcLost: [] } }).sim.outcome.clearedAt)).toBe(100)
      expect(lessonRun('why-dc', { fault: { kind: 'line', line: 'AB', frac: 0.5 } }).sim.outcome.verdict).toBe('uncleared')
      // open trip circuit at AB instead: 21-AB trips at 17 ms, never delivered → same remote-backup clear
      const coil = lessonRun('why-dc', { scenario: { dcLost: [], tripOpen: ['AB'] } })
      expect(msOf(coil.sim.events.at(-1).state.tripped.AB.t)).toBe(17)
      expect(coil.sim.events.at(-1).state.breakers.AB).toBe('closed')
      expect(coil.sim.events.some(e => e.text.startsWith('Trip circuit 52-AB open'))).toBe(true)
      expect(msOf(coil.sim.outcome.clearedAt)).toBe(367)
      expect(coil.sim.outcome.notes.some(n => n.text.includes('trip circuit open'))).toBe(true)
    })

    it('your channel is in the trip path: 75 ms with the channel, 367 ms without; latency adds one-for-one', () => {
      const ok = lessonRun('why-channel')
      expect(msOf(ok.sim.outcome.clearedAt)).toBe(75)
      const out = lessonRun('why-channel', { scenario: { channels: { AB: 'out' } } })
      expect(msOf(out.sim.outcome.clearedAt)).toBe(367)
      expect(out.c.beyondCct).toBe(true)
      const slow = lessonRun('why-channel', {}, cfg => { cfg.pilot.channelCycles = 3 })
      expect(slow.sim.outcome.clearedAt - ok.sim.outcome.clearedAt).toBeCloseTo(2.5 / 60, 6)
    })
  })

  it('z2-time: a 2-cycle Z2 miscoordinates, 12 cycles is tight', () => {
    const base = setupOf(LESSONS.find(l => l.id === 'z2-time'))
    const at = cyc => { const c = structuredClone(base); zone(c, 'AB', 2).delayCycles = cyc; return simulateFault(coordinationConfig(c), BY10).outcome.verdict }
    expect(at(2)).toBe('miscoordination')
    expect(at(12)).toBe('tight')
  })

  it('dcb-external: a short reverse zone overtrips at 25% of B–Y', () => {
    const c = setupOf(LESSONS.find(l => l.id === 'dcb-external'))
    zone(c, 'BA', 3).reach = 10
    expect(simulateFault(coordinationConfig(c), { kind: 'line', line: 'BY', frac: 0.25 }).outcome.verdict).toBe('miscoordination')
  })

  it('relay-oos: at 50% of B–Y nothing clears the A side', () => {
    const l = LESSONS.find(l => l.id === 'relay-oos')
    expect(simulateFault(coordinationConfig(setupOf(l)), { kind: 'line', line: 'BY', frac: 0.5 }, l.scenario).outcome.verdict).toBe('uncleared')
  })

  it('sir-voltage: SIR 10 drops V at A to ~0.005 pu, Z and trips unchanged', () => {
    const l = LESSONS.find(l => l.id === 'sir-voltage')
    const at = sirA => {
      const c = setupOf(l); c.network.buses.find(b => b.id === 'A').sir = sirA
      const run = simulateFault(coordinationConfig(c), l.fault)
      const m = atFault(run).meas.AB
      return { v: Math.hypot(m.V.re, m.V.im), z: Math.hypot(m.Z.R, m.Z.X), trips: trips(run) }
    }
    expect(at(0.2).v).toBeCloseTo(0.2, 6)
    expect(at(10).v).toBeCloseTo(0.05 / 10.05, 6)
    expect(at(10).z).toBeCloseTo(0.05, 6)
    expect(at(0).v).toBeCloseTo(1, 6)
    expect(at(10).trips).toEqual(at(0.2).trips)
  })

  it('memory-polarization: own-bus fault reads reverse at V = 0; 5% onto A–B trips Z1', () => {
    const l = LESSONS.find(l => l.id === 'memory-polarization')
    const run = simulateFault(coordinationConfig(setupOf(l)), l.fault)
    const m = atFault(run).meas.AB
    expect(Math.hypot(m.V.re, m.V.im)).toBe(0)
    expect(m.dir).toBe(-1)
    expect(run.events.some(e => e.kind === 'trip' && e.rid === 'AB')).toBe(false)
    const near = simulateFault(coordinationConfig(setupOf(l)), { kind: 'line', line: 'AB', frac: 0.05 })
    expect(near.events.find(e => e.kind === 'trip' && e.rid === 'AB').zid).toBe(1)
  })

  it('reports the source impedance behind each relay', () => {
    const c = coordinationConfig(setupOf(LESSONS.find(l => l.id === 'memory-polarization')))
    const net = buildNetwork(c.network)
    expect(impedanceBehind(net, c, 'AB')).toBeCloseTo(2, 9) // X SIR 1 + line XA 1.0
    expect(impedanceBehind(net, c, 'XA')).toBeCloseTo(1, 9)
  })

  const runLesson = (l, cfg, loc = l.fault, spec = l.faultSpec) => simulateFault(coordinationConfig(cfg), loc, l.scenario ?? {}, spec)
  const firstTrip = (run, rid) => run.events.find(e => e.kind === 'trip' && e.rid === rid)

  it('ground-k0: k0 = 0 underreaches to Z2; 1.5 overreaches Z1 at 95%; 3Ø uses a phase loop', () => {
    const l = LESSONS.find(l => l.id === 'ground-k0')
    expect(firstTrip(runLesson(l, setupOf(l)), 'AB').zid).toBe(1)
    const none = setupOf(l); none.relays.AB.k0 = 0
    expect(firstTrip(runLesson(l, none), 'AB').zid).toBe(2)
    const over = setupOf(l); over.relays.AB.k0 = 1.5
    const at95 = { kind: 'line', line: 'AB', frac: 0.95 }
    expect(firstTrip(runLesson(l, setupOf(l), at95), 'AB').zid).toBe(2)
    expect(firstTrip(runLesson(l, over, at95), 'AB').zid).toBe(1)
    expect(atFault(runLesson(l, setupOf(l), l.fault, { type: '3PH' })).meas.AB.loop).toBe('AB')
  })

  it('rf-mho: Rf 0.15 is back in Z1, 0.6 is never cleared', () => {
    const l = LESSONS.find(l => l.id === 'rf-mho')
    expect(firstTrip(runLesson(l, setupOf(l)), 'AB').zid).toBe(2)
    expect(firstTrip(runLesson(l, setupOf(l), l.fault, { rf: 0.15 }), 'AB').zid).toBe(1)
    expect(runLesson(l, setupOf(l), l.fault, { rf: 0.6 }).outcome.verdict).toBe('uncleared')
  })

  it('quad: Rf 0.6 clears on Z2; MHO at A clears sequentially once B opens; Z1 R reach 40% trips sequentially', () => {
    const l = LESSONS.find(l => l.id === 'quad')
    expect(firstTrip(runLesson(l, setupOf(l)), 'AB').zid).toBe(1)
    expect(trips(runLesson(l, setupOf(l), l.fault, { rf: 0.6 }))).toEqual([['AB', 316.7], ['BA', 316.7]])
    const mhoA = setupOf(l); mhoA.relays.AB.shape = 'mho'
    const seq = runLesson(l, mhoA, l.fault, { rf: 0.6 })
    expect(trips(seq)).toEqual([['BA', 316.7], ['AB', 683.3]]) // B opens 366.7 + pickup + Z2 timer
    expect(seq.outcome.verdict).not.toBe('uncleared')
    const narrow = setupOf(l); zone(narrow, 'AB', 1).rReach = 40
    expect(trips(runLesson(l, narrow))).toEqual([['BA', 16.7], ['AB', 83.3]]) // after 52-BA opens at 66.7
  })

  it('infeed: 21-AB reads 148% for a fault 112% away; Z2 sees it without infeed; stuck 52-BY is never cleared', () => {
    const l = LESSONS.find(l => l.id === 'infeed')
    const run = runLesson(l, setupOf(l))
    const pct = r => { const m = atFault(r).meas.AB; return Math.round(Math.hypot(m.Z.R, m.Z.X) * 100) }
    expect(pct(run)).toBe(148)
    expect(run.events.some(e => e.kind === 'pickup' && e.rid === 'AB' && e.zid === 2)).toBe(false)
    const off = setupOf(l); off.network.buses.find(b => b.id === 'B').infeed = false
    const noInfeed = runLesson(l, off)
    expect(pct(noInfeed)).toBe(112)
    expect(noInfeed.events.some(e => e.kind === 'pickup' && e.rid === 'AB' && e.zid === 2)).toBe(true)
    const weak = setupOf(l); weak.network.buses.find(b => b.id === 'B').sir = 4
    expect(pct(runLesson(l, weak))).toBe(121)
    expect(simulateFault(coordinationConfig(setupOf(l)), l.fault, { breakerFail: ['BY'] }).outcome.verdict).toBe('uncleared')
  })

  it('infeed is gated: without the feature, bus A/B flags change nothing', () => {
    const l = LESSONS.find(l => l.id === 'infeed')
    const c = setupOf(l); c.features.infeed = false
    const m = atFault(runLesson(l, c)).meas.AB
    expect(Math.round(Math.hypot(m.Z.R, m.Z.X) * 100)).toBe(112)
  })

  it('load-rf: δ 40° makes 21-AB trip Z1 for a 90% fault; δ 0° or MHO waits for Z2', () => {
    const l = LESSONS.find(l => l.id === 'load-rf')
    const run = runLesson(l, setupOf(l))
    expect(firstTrip(run, 'AB').zid).toBe(1)
    const pre = run.events[0].state.meas
    expect(pre.AB.Zload.R).toBeGreaterThan(0)   // load flows forward out of A
    expect(pre.BA.Zload.R).toBeLessThan(0)      // and into B (reverse for 21-BA)
    const noLoad = setupOf(l); noLoad.loadAngleDeg = 0
    const m = atFault(runLesson(l, noLoad)).meas.AB
    expect(Math.round(Math.hypot(m.Z.R, m.Z.X) * 100)).toBe(151)
    expect(firstTrip(runLesson(l, noLoad), 'AB').zid).toBe(2)
    const mho = setupOf(l); mho.relays.AB.shape = 'mho'
    expect(firstTrip(runLesson(l, mho), 'AB').zid).toBe(2)
  })

  it('load-encroachment: the load point is inside the Z2 quad, outside MHO, and out at δ 40° / R reach 100%', () => {
    const l = LESSONS.find(l => l.id === 'load-encroachment')
    const loadZ = cfg => runSimulation(FAULTS, cfg).find(r => r.fault.id === 'F3').A.Zload
    const z2 = cfg => zone(cfg, 'AB', 2)
    const inQuad = (cfg, Z) => quadContains(Z.R, Z.X, zoneReachPu(z2(cfg), 1), zoneRReachPu(z2(cfg), 1), cfg.lineAngleDeg)
    const c = setupOf(l), Z = loadZ(c)
    expect(Math.round(Math.hypot(Z.R, Z.X) * 100)).toBe(147)
    expect(inQuad(c, Z)).toBe(true)
    const narrow = setupOf(l); z2(narrow).rReach = 100
    expect(inQuad(narrow, Z)).toBe(false)
    const light = setupOf(l); light.loadAngleDeg = 40
    expect(inQuad(light, loadZ(light))).toBe(false)
    // MHO Z2 (120%) doesn't reach a point near the R axis at 1.46 pu
    expect(Math.hypot(Z.R, Z.X)).toBeGreaterThan(1.2)
  })

  it('prefault load changes no bolted 3Ø result (no infeed: measured Z stays exact)', () => {
    const LOCS = [{ kind: 'bus', bus: 'B' }, ...['XA', 'AB', 'BY'].flatMap(line => [0.05, 0.5, 0.95].map(frac => ({ kind: 'line', line, frac })))]
    const runAll = load => LOCS.map(loc => {
      const c = defaultConfig(); c.features.adjacent = true; c.features.load = load; c.loadAngleDeg = 40
      const run = simulateFault(coordinationConfig(c), loc)
      return [trips(run), run.outcome.verdict]
    })
    expect(runAll(true)).toEqual(runAll(false))
  })

  const diffRows = (cfg, spec) => Object.fromEntries(runDifferential(FAULTS, cfg, spec).map(r => [r.fault.id, r]))

  it('diff-basics: internal faults operate (even through Rf), external restrain; distance loses them', () => {
    const l = LESSONS.find(l => l.id === 'diff-basics')
    for (const spec of [{}, { rf: 1.0 }, { type: 'AG', rf: 2.0 }]) {
      const r = diffRows(setupOf(l), spec)
      expect(['N', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6'].map(id => r[id].assessment)).toEqual([
        'Correct restraint', 'Correct restraint', 'Correct trip', 'Correct trip', 'Correct trip', 'Correct restraint', 'Correct restraint'])
    }
    const study = runSimulation(FAULTS, setupOf(l), {}, { rf: 1.0 }).find(r => r.fault.id === 'F3')
    expect(study.A.trippedZone).toBe(null)
  })

  it('diff-security: CT error 50% misoperates F1 at slope 30%, slope 80% restrains; charging above pickup trips the healthy line', () => {
    const l = LESSONS.find(l => l.id === 'diff-security')
    const r = diffRows(setupOf(l))
    expect(r.F1.assessment).toBe('Misoperation')
    expect(r.F1.worst.Iop).toBeCloseTo(0.32, 2)
    const steep = setupOf(l); steep.diff.slopePct = 80
    const r80 = diffRows(steep)
    expect(r80.F1.assessment).toBe('Correct restraint')
    for (const id of ['F2', 'F3', 'F4']) expect(r80[id].assessment).toBe('Correct trip')
    const charging = setupOf(l); charging.diff.ctErrorPct = 0; charging.diff.chargingPu = 0.4
    expect(diffRows(charging).N.assessment).toBe('Misoperation')
  })

  it('diff-coord: 87L trips A at 25 ms (B Z1 first); channel out → step distance; external restrains; 80% CT error misoperates', () => {
    const l = LESSONS.find(l => l.id === 'diff-coord')
    const run = runLesson(l, setupOf(l))
    const t87 = run.events.filter(e => e.kind === 'trip' && e.logic === '87L').map(e => [e.rid, ms(e.t)])
    expect(t87).toEqual([['AB', 25]])
    expect(trips(run)).toEqual([['BA', 16.7], ['AB', 25]]) // B's Z1 is faster than 87L
    expect(run.outcome.verdict).toBe('selective')
    expect(run.events.find(e => e.kind === 'fault').state.diff.op).toBe(true)
    expect(run.events.find(e => e.kind === 'cleared').state.diff.op).toBe(false)
    const out = simulateFault(coordinationConfig(setupOf(l)), l.fault, { diffChannel: 'out' })
    expect(trips(out)).toEqual([['BA', 16.7], ['AB', 316.7]])
    const ext = simulateFault(coordinationConfig(setupOf(l)), BY10)
    expect(ext.events.some(e => e.logic === '87L')).toBe(false)
    const noDiff = setupOf(l); noDiff.features.diff = false
    expect(trips(ext)).toEqual(trips(simulateFault(coordinationConfig(noDiff), BY10)))
    const ct = setupOf(l); ct.diff.ctErrorPct = 80
    const mis = simulateFault(coordinationConfig(ct), BY10)
    expect(mis.events.some(e => e.logic === '87L')).toBe(true)
    expect(mis.outcome.verdict).toBe('miscoordination')
  })

  it('dcub: a 0.5-cycle window closes before Z2 picks up', () => {
    const l = LESSONS.find(l => l.id === 'dcub')
    const c = setupOf(l); c.pilot.unblockCycles = 0.5
    const run = simulateFault(coordinationConfig(c), l.fault, l.scenario)
    expect(run.events.find(e => e.kind === 'trip' && e.rid === 'AB').logic).toBe('step')
  })
})

describe('learner levels', () => {
  it('Basic is exactly the default config', () => {
    expect(configForLevel('basic')).toEqual(defaultConfig())
    expect(levelOf(defaultConfig().features)).toBe('basic')
  })

  it('each level round-trips, levels are nested, and they only use known features', () => {
    const known = Object.keys(defaultConfig().features)
    let prev = []
    for (const l of LEVELS) {
      expect(levelOf(levelFeatures(l.id))).toBe(l.id)
      for (const f of l.features) expect(known).toContain(f)
      for (const f of prev) expect(l.features).toContain(f)
      prev = l.features
    }
    // Advanced = every distance feature; 87L is a separate module no level touches
    expect(new Set(LEVELS.at(-1).features)).toEqual(new Set(known.filter(f => !['diff', 'consequences'].includes(f))))
    expect(LEVEL_FEATURES).not.toContain('diff')
  })

  it('a mix that matches no level is custom; switching level leaves other settings alone', () => {
    const cfg = defaultConfig()
    cfg.features.ground = true
    cfg.relays.AB.zones[0].reach = 70
    expect(levelOf(cfg.features)).toBe('custom')
    const next = withLevel(cfg, 'intermediate')
    expect(levelOf(next.features)).toBe('intermediate')
    expect(next.relays.AB.zones[0].reach).toBe(70)
  })

  it('every lesson track has a label, and each level’s and audience’s first lesson exists', () => {
    for (const t of TRACKS) expect(trackLabel(t)).toBeTruthy()
    for (const l of [...LEVELS, ...AUDIENCES]) expect(LESSONS.some(x => x.id === l.firstLesson)).toBe(true)
  })

  it('the “around protection” audience starts at Basic with the consequences module on', () => {
    const cfg = configForLevel('basic', 'around')
    expect(cfg.features.consequences).toBe(true)
    expect(levelOf(cfg.features)).toBe('basic')
    expect(configForLevel('basic', 'learning')).toEqual(defaultConfig())
  })

  it('station DC lost = every relay at that bus out of service and its breakers unable to trip', () => {
    const cfg = defaultConfig()
    cfg.features.adjacent = true
    const loc = { kind: 'line', line: 'AB', frac: 0.1 }
    const dc = simulateFault(coordinationConfig(cfg), loc, { dcLost: ['A'] }, {})
    const manual = simulateFault(coordinationConfig(cfg), loc, { relayOos: ['AX', 'AB'], breakerFail: ['AX', 'AB'] }, {})
    expect(dc.outcome.clearedAt).toBe(manual.outcome.clearedAt)
    expect(dc.outcome.verdict).toBe(manual.outcome.verdict)
    expect(dc.outcome.notes.some(n => n.text.includes('station DC lost'))).toBe(true)
  })

  it('levels leave 87L alone and are judged without it', () => {
    const cfg = withLevel(defaultConfig(), 'advanced')
    cfg.features.diff = true
    expect(levelOf(cfg.features)).toBe('advanced')
    expect(withLevel(cfg, 'basic').features.diff).toBe(true)
    expect(withLevel(defaultConfig(), 'advanced').features.diff).toBe(false)
  })

  it('every level runs the default Coordination fault and the Fault Study', () => {
    for (const l of LEVELS) {
      const cfg = configForLevel(l.id)
      const sim = simulateFault(coordinationConfig(cfg), { kind: 'line', line: 'AB', frac: 0.9 }, { relayOos: [], breakerFail: [], channels: {}, diffChannel: 'ok' }, { type: '3PH', rf: 0 })
      expect(sim.outcome.clearedAt).not.toBeNull()
      expect(runSimulation(FAULTS, cfg, { channels: { AB: 'ok' } }, { type: '3PH', rf: 0 })).toHaveLength(FAULTS.length)
    }
  })
})

describe('consequences', () => {
  const NONE = { relayOos: [], breakerFail: [], channels: {}, diffChannel: 'ok' }
  const BOLTED = { type: '3PH', rf: 0 }
  const run = (cfg, loc, scenario = NONE) => simulateFault(coordinationConfig(cfg), loc, scenario, BOLTED)
  const mid = { kind: 'line', line: 'AB', frac: 0.5 }

  it('a Zone 1 clear at both ends is the fast-clear reference', () => {
    const cfg = defaultConfig()
    const sim = run(cfg, mid)
    const c = costsAt(sim, cfg)
    expect(c.elapsed * 60).toBeCloseTo(4, 6) // relay 1 + breaker 3 cycles
    expect(c.duty).toBeCloseTo(1, 6)
    expect(c.arc).toBeCloseTo(1, 6)
    expect(c.beyondCct).toBe(false)
    expect(c.cct * 60).toBeCloseTo(12, 6)
    const out = outageExtent(sim, coordinationConfig(cfg), mid)
    expect(out.linesOut).toEqual(['AB'])
    expect(out.extraLines).toEqual([])
    expect(out.extraBuses).toEqual([])
  })

  it('an end-zone Z2 clear: past the CCT, but the slow end adds little duty (its current is small)', () => {
    const cfg = defaultConfig()
    const sim = run(cfg, { kind: 'line', line: 'AB', frac: 0.9 })
    const c = costsAt(sim, cfg)
    expect(c.beyondCct).toBe(true)
    // B (near the fault) opened at 4 cyc and took most of the current with it:
    // the cost of the slow end is time (stability, the arc stays lit), not heating
    expect(c.duty).toBeGreaterThan(1)
    expect(c.duty).toBeLessThan(1.2)
    expect(c.arc).toBeGreaterThan(c.duty)
    // a stuck breaker keeps the full current flowing: duty grows with time
    cfg.features.adjacent = true
    const stuck = costsAt(run(cfg, { kind: 'line', line: 'AB', frac: 0.1 }, { ...NONE, breakerFail: ['AB'] }), cfg)
    expect(stuck.duty).toBeGreaterThan(4)
  })

  it('accumulates during playback: zero before inception, growing, then fixed at clearing', () => {
    const cfg = defaultConfig()
    const sim = run(cfg, { kind: 'line', line: 'AB', frac: 0.9 })
    expect(costsAt(sim, cfg, -0.01).duty).toBe(0)
    const a = costsAt(sim, cfg, 0.05), b = costsAt(sim, cfg, 0.2), end = costsAt(sim, cfg)
    expect(a.duty).toBeLessThan(b.duty)
    expect(b.duty).toBeLessThan(end.duty)
    expect(b.done).toBe(false)
    expect(costsAt(sim, cfg, end.clearedAt + 1).duty).toBeCloseTo(end.duty, 9)
  })

  it('a stuck breaker takes out the adjacent line and leaves a bus without supply', () => {
    const cfg = defaultConfig()
    cfg.features.adjacent = true
    const near = { kind: 'line', line: 'AB', frac: 0.1 } // within 21-XA's Zone 2 (remote backup)
    const sim = run(cfg, near, { ...NONE, breakerFail: ['AB'] })
    expect(sim.outcome.verdict).toBe('backup')
    const out = outageExtent(sim, coordinationConfig(cfg), near)
    expect(out.extraLines).toEqual(['XA'])
    expect(out.extraBuses).toEqual(['A'])
    expect(costsAt(sim, cfg).duty).toBeGreaterThan(costsAt(run(cfg, near), cfg).duty)
  })

  it('an uncleared fault reports no outage and is flagged', () => {
    const cfg = defaultConfig()
    cfg.features.adjacent = true
    const sim = run(cfg, mid, { ...NONE, relayOos: ['AB'] }) // nothing else reaches mid-line
    expect(sim.outcome.clearedAt).toBeNull()
    expect(outageExtent(sim, coordinationConfig(cfg), mid)).toBeNull()
    expect(costsAt(sim, cfg).uncleared).toBe(true)
  })

  it('the CCT setting moves the threshold', () => {
    const cfg = defaultConfig()
    cfg.consequences.cctCycles = 30
    expect(costsAt(run(cfg, { kind: 'line', line: 'AB', frac: 0.9 }), cfg).beyondCct).toBe(false)
  })

  it('reports no duty when the model current is unbounded (bolted fault at a stiff source)', () => {
    const cfg = defaultConfig()
    const sim = run(cfg, { kind: 'bus', bus: 'A' })
    if (!Number.isFinite(sim.events.find(e => e.kind === 'fault').state.faultI)) {
      expect(costsAt(sim, cfg).duty).toBeNull()
    }
  })
})
