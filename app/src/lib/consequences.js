// Consequences of a fault-clearing run — what the clearing time cost.
// Pure functions over a simulateFault() result; no React.
//
// Teaching measures, all relative (no conductor or arc data needed):
//   - clearing time against a critical clearing time (CCT, config, cycles)
//   - fault duty ∫I²dt and arc energy ∫I dt (arc voltage roughly constant),
//     each as a multiple of a "fast clear": the inception current flowing for
//     relay + breaker time (Zone 1 at both ends, no intentional delay)
//   - outage extent: lines and buses out of service once the fault is cleared,
//     beyond the faulted element itself

import { EPS } from './network'

export const DEFAULT_CCT_CYCLES = 12

// Costs accumulated up to time t (default: the whole run).
export function costsAt(sim, config, t = Infinity) {
  const f = config.timing.freqHz
  const tFast = (config.timing.relayCycles + config.timing.breakerCycles) / f
  const cct = (config.consequences?.cctCycles ?? DEFAULT_CCT_CYCLES) / f
  const clearedAt = sim.outcome.clearedAt
  const lastT = sim.events[sim.events.length - 1].t
  const until = Math.min(t, clearedAt ?? Infinity, Math.max(lastT, 0))

  const atFault = sim.events.filter(e => e.t >= -EPS)
  const I0 = atFault.find(e => e.kind === 'fault')?.state.faultI ?? 0
  let i2t = 0, it = 0, bounded = Number.isFinite(I0) && I0 > 0
  for (let i = 0; i < atFault.length; i++) {
    const t0 = Math.max(atFault[i].t, 0)
    const t1 = Math.min(atFault[i + 1]?.t ?? until, until)
    if (t1 <= t0) continue
    const I = atFault[i].state.faultI ?? 0
    if (!Number.isFinite(I)) { bounded = false; continue }
    i2t += I * I * (t1 - t0)
    it += I * (t1 - t0)
  }

  const elapsed = Math.max(0, until)
  return {
    tFast, cct, clearedAt,
    uncleared: clearedAt === null,
    elapsed,                                     // fault duration so far
    done: clearedAt !== null && t >= clearedAt - EPS,
    beyondCct: elapsed > cct + EPS,
    // null when the model's current is unbounded (bolted fault at a stiff source)
    duty: bounded ? i2t / (I0 * I0 * tFast) : null,
    arc: bounded ? it / (I0 * tFast) : null,
  }
}

// Lines and buses out of service after the run, beyond the faulted element.
// A line is in service while both its breakers are closed (a stuck breaker
// stays closed); a bus has supply while a source reaches it through
// in-service lines. Returns null if the fault was never cleared.
export function outageExtent(sim, config, loc) {
  if (sim.outcome.clearedAt === null) return null
  const { net } = sim
  const breakers = sim.events[sim.events.length - 1].state.breakers
  const relayIds = Object.keys(config.relays)
  const inService = line => relayIds
    .filter(id => config.relays[id].line === line)
    .every(id => breakers[id] !== 'open')

  const linesOut = net.lineOrder.filter(l => !inService(l))
  const supplied = new Set(net.sources)
  for (let grew = true; grew;) {
    grew = false
    for (const l of net.lineOrder) {
      if (!inService(l)) continue
      const { from, to } = net.lines[l]
      if (supplied.has(from) !== supplied.has(to)) { supplied.add(from); supplied.add(to); grew = true }
    }
  }
  if (loc.kind === 'bus') supplied.delete(loc.bus)
  const busesDark = net.busOrder.filter(b => !supplied.has(b))

  // What clearing this fault has to take out anyway
  const faulted = loc.kind === 'line' ? [loc.line]
    : loc.kind === 'tap' ? net.lineOrder.filter(l => net.lines[l].tap) // inside the tapped line's zone
    : loc.kind === 'tapLV' ? [] // the tap's own protection; any line outage is extra
    : net.lineOrder.filter(l => net.lines[l].from === loc.bus || net.lines[l].to === loc.bus)
  return {
    linesOut,
    busesDark,
    extraLines: linesOut.filter(l => !faulted.includes(l)),
    extraBuses: busesDark.filter(b => !(loc.kind === 'bus' && b === loc.bus)),
  }
}
