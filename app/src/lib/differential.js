// Line current differential (87L) for the base line A–B — no React.
//
// A separate protection module on top of the phasor solver: it reads the
// CT currents at both ends of A–B (both measured into the line) and applies
// a percentage-differential characteristic per phase:
//   Iop  = |IA + IB|            (zero for anything outside the zone)
//   Ires = (|IA| + |IB|) / 2
//   operate when Iop > pickup and Iop > slope · Ires
// Line charging current (leading the line voltage by 90°) flows into the
// line from both ends and so appears as false differential; a CT error at B
// (through-fault saturation) shrinks B's measured current.

import { buildNetwork, faultPosition, EPS } from './network'
import { solveFault, PHASE } from './solver'
import { withInfeed } from './schema'
import { C, add, mul, scale, abs } from './complex'

export const DEFAULT_DIFF = {
  pickupPu: 0.3,    // minimum operate current
  slopePct: 30,     // restraint slope
  chargingPu: 0.05, // line charging current at 1 pu voltage
  ctErrorPct: 0,    // CT at B under-reports by this much
}

const J = C(0, 1)

// One phase-by-phase evaluation from the two ends' phasors
export function diffElement(IA, IB, VA, VB, s) {
  const k = 1 - (s.ctErrorPct ?? 0) / 100
  return [0, 1, 2].map(p => {
    // Charging current, half supplied from each end, ∝ the local line voltage
    const ich = scale(mul(J, scale(add(VA[p], VB[p]), 0.5)), s.chargingPu ?? 0)
    const a = add(IA[p], scale(ich, 0.5))
    const b = scale(add(IB[p], scale(ich, 0.5)), k)
    const Iop = abs(add(a, b))
    const Ires = (abs(a) + abs(b)) / 2
    const operate = Iop > s.pickupPu + EPS && Iop > (s.slopePct / 100) * Ires + EPS
    return { phase: PHASE[p], Iop, Ires, operate }
  })
}

const HEALTHY = { id: 'N', label: 'Healthy', loc: null, description: 'No fault (load and charging only)' }

// Rows for the Differential tab: the healthy system, then each fault.
export function runDifferential(faults, rawConfig, spec = {}) {
  const config = withInfeed(rawConfig)
  const net = buildNetwork(config.network)
  const s = { ...DEFAULT_DIFF, ...config.diff }
  const AB = net.lines.AB
  return [HEALTHY, ...faults].map(fault => {
    const sol = solveFault(net, config, fault.loc, {}, spec)
    const A = sol.relays.AB, B = sol.relays.BA
    const phases = diffElement(A.Iabc, B.Iabc, A.Vabc, B.Vabc, s)
    // Reported phase: the one closest to (or furthest past) operating
    const margin = ph => ph.Iop / Math.max(s.pickupPu, (s.slopePct / 100) * ph.Ires, EPS)
    const worst = phases.reduce((w, ph) => (margin(ph) > margin(w) * (1 + 1e-9) ? ph : w)) // ties → earliest phase
    const operate = phases.some(ph => ph.operate)
    let internal = false
    if (fault.loc) {
      const pf = faultPosition(net, fault.loc)
      internal = pf > AB.p1 + EPS && pf < AB.p2 - EPS
    }
    const assessment = internal
      ? (operate ? 'Correct trip' : 'Fails to trip')
      : (operate ? 'Misoperation' : 'Correct restraint')
    return { fault, internal, phases, worst, operate, assessment, settings: s }
  })
}
