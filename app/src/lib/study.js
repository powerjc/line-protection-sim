// Fault Study runner — static zone assessment (measured V/I, all breakers closed) for the base line's two
// relays, plus (when pilot schemes are enabled) the time-domain result so
// the table can show trip logic: step distance, pilot trip, or blocked.

import { buildNetwork, faultPosition, EPS } from './network'
import { assessRelay } from './protection'
import { solveFault } from './solver'
import { simulateFault } from './timeline'
import { withInfeed } from './schema'

// spec: { type, rf } applied to every fault in the suite
export function runSimulation(faults, rawConfig, scenario = {}, spec = {}) {
  const config = withInfeed(rawConfig)
  const net = buildNetwork(config.network)
  const pilotOn = !!config.features?.pilot
  return faults.map(fault => {
    const pf = faultPosition(net, fault.loc)
    const meas = solveFault(net, config, fault.loc, {}, spec).relays
    const A = assessRelay(net, config.relays.AB, pf, config, meas.AB)
    const B = assessRelay(net, config.relays.BA, pf, config, meas.BA)
    if (pilotOn) {
      const run = simulateFault(config, fault.loc, scenario, spec)
      A.pilot = pilotResult(run, 'AB')
      B.pilot = pilotResult(run, 'BA')
      for (const [r, cfg] of [[A, config.relays.AB], [B, config.relays.BA]]) {
        // A pilot trip for a fault outside the protected line is an overtrip
        const L = net.lines[cfg.line].length
        const external = r.fwd <= EPS || r.fwd >= L - EPS
        if (r.pilot.logic && r.pilot.logic !== 'step' && external) r.assessment = 'Pilot overtrip'
      }
    }
    return { fault, A, B }
  })
}

// How this relay behaved in the time-domain run.
// logic: 'step' | 'DCB' | 'POTT' | 'DCUB' | null (no trip); blocked: DCB held by a block
function pilotResult(run, rid) {
  const trip = run.events.find(e => e.kind === 'trip' && e.rid === rid)
  const blocked = run.events.some(e => e.kind === 'blocked' && e.rid === rid)
  return trip
    ? { logic: trip.logic, t: trip.t, zoneId: trip.zid, blocked }
    : { logic: null, t: null, zoneId: null, blocked }
}
