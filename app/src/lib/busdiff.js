// Bus differential (87B) for bus B — no React.
//
// A low-impedance percentage differential around bus B. Its CTs sit on the
// LINE side of each feeder breaker (52-BA, 52-BY), while the line relays' CTs
// sit on the bus side, so the bus zone and the line zones overlap across the
// breakers. Per phase, with every feeder current measured INTO the bus:
//   Iop  = |Σ I|        (zero for anything outside the zone, by Kirchhoff)
//   Ires = Σ |I|
//   operate when Iop > pickup and Iop > slope · Ires
// Each bus CT is its own instrument (`bus:<rid>` in the instrument faults), so a
// reversed bus CT doesn't touch the line relay on the same breaker.
//
// Active with the 'busdiff' module and adjacent lines on, and only while bus B
// is not itself a source: an infeed source has no breaker in this model, so a
// bus trip couldn't isolate it.

import { EPS } from './network'
import { relayInstruments, senseI } from './instruments'
import { add, abs, scale, ZERO } from './complex'

export const BUS_DIFF_BUS = 'B'
export const DEFAULT_BUSDIFF = { pickupPu: 0.2, slopePct: 50 }
export const busCtId = rid => `bus:${rid}`

// The zone in force: { bus, feeders: [rid] } or null
export function busZone(net, config) {
  if (!config.features?.busdiff || !config.features?.adjacent) return null
  const bus = net.buses[BUS_DIFF_BUS]
  if (!bus || bus.source) return null
  const feeders = Object.keys(config.relays).filter(id => config.relays[id].bus === BUS_DIFF_BUS)
  return feeders.length >= 2 ? { bus: BUS_DIFF_BUS, feeders } : null
}

// meas: the solver's per-relay measurements (with prim: the true current into each line)
export function busDiffElement(meas, zone, inst = {}, settings = DEFAULT_BUSDIFF) {
  const s = { ...DEFAULT_BUSDIFF, ...settings }
  const feeders = zone.feeders.map(rid => {
    const into = (meas[rid]?.prim?.Iabc ?? [ZERO, ZERO, ZERO]).map(I => scale(I, -1)) // into the bus
    return { rid, I: senseI(into, relayInstruments(inst, busCtId(rid))) }
  })
  const phases = [0, 1, 2].map(p => {
    const Iop = abs(feeders.reduce((sum, f) => add(sum, f.I[p]), ZERO))
    const Ires = feeders.reduce((sum, f) => sum + abs(f.I[p]), 0)
    const operate = Iop > s.pickupPu + EPS && Iop > (s.slopePct / 100) * Ires + EPS
    return { phase: 'ABC'[p], Iop, Ires, operate }
  })
  return { feeders, phases, op: phases.some(ph => ph.operate) }
}
