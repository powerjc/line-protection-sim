// Oscillography for the Bay tab: instantaneous waveforms synthesized from the
// engine's phasors. No React. Illustrative, not a transient simulation.
//
// Each event snapshot holds steady-state phasors for its segment of time.
// A waveform is √2·|X|·cos(ωt + ∠X) within each segment. At fault inception
// the current can't jump (the system is inductive), so a decaying DC offset
// makes it continuous: D·e^(−(t−0)/τ) with τ = (X/R)/ω from the line angle.
// Later changes switch phasors directly, except where a phase's current
// stops (its breaker opened): each pole carries on until its own next current
// zero, as a real breaker interrupts.
//
// The relay's view is then sampled (SAMPLES_PER_CYCLE) and a one-cycle
// (full-cycle) DFT estimates each phasor, as a numerical relay does. That
// estimate needs a full cycle of post-fault samples to settle.

import { bayQuantities, relayInstruments, instrumentFaults } from './instruments'
import { busZone, busDiffElement } from './busdiff'

export const SAMPLES_PER_CYCLE = 16 // shown sparse for clarity; real relays sample faster
export const WINDOW_TAIL_CYCLES = 2  // shown after clearing
export const MAX_CYCLES = 30         // cut-off for runs that never clear

// Views: 'prim' (on the line, A / V), 'sec' (relay terminals, A / V), 'relay' (computed primary, A / V)
// Quantities: 'I' | 'V'; phase 0..2
export function buildTrace(sim, config, rid, scenario) {
  const ri = relayInstruments(scenario, rid)
  const f = config.timing.freqHz
  const w = 2 * Math.PI * f
  const tau = Math.tan((config.lineAngleDeg * Math.PI) / 180) / w
  const segs = []
  const evs = sim.events
  for (let i = 0; i < evs.length; i++) {
    const m = evs[i].state.meas?.[rid]
    if (!m?.prim) continue
    const q = bayQuantities(m, ri)
    const t0 = evs[i].t
    const last = segs[segs.length - 1]
    if (last && Math.abs(last.t0 - t0) < 1e-12) segs[segs.length - 1] = { t0, q, state: evs[i].state }
    else segs.push({ t0, q, state: evs[i].state })
  }
  const tFault = evs.find(e => e.kind === 'fault')?.t ?? 0
  const cleared = sim.outcome.clearedAt
  const lastT = evs[evs.length - 1].t
  // No power-system fault: show the last event plus a few cycles (nothing to clear)
  const end = sim.noFault ? Math.max(lastT, 4 / f) + WINDOW_TAIL_CYCLES / f
    : Math.min(cleared ?? lastT, MAX_CYCLES / f) + WINDOW_TAIL_CYCLES / f
  const cutOff = !sim.noFault && (cleared == null || cleared > MAX_CYCLES / f)
  const trace = { segs, f, w, tau, tFault, start: sim.startT, end, cutOff, ri }

  // DC offset per view/phase at inception: previous segment's instantaneous minus the new one's, at t = 0
  const fi = segs.findIndex(s => Math.abs(s.t0 - tFault) < 1e-12)
  trace.offset = {}
  if (fi > 0) {
    for (const view of ['prim', 'sec', 'relay']) {
      trace.offset[view] = [0, 1, 2].map(p => steady(segs[fi - 1].q.I[p][view], w, tFault) - steady(segs[fi].q.I[p][view], w, tFault))
    }
  }
  return trace
}

const steady = (X, w, t) => Math.SQRT2 * (X.re * Math.cos(w * t) - X.im * Math.sin(w * t))

export function segAt(trace, t) {
  const { segs } = trace
  let lo = 0, hi = segs.length - 1
  if (t < segs[0].t0) return segs[0]
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segs[mid].t0 <= t) lo = mid; else hi = mid - 1
  }
  return segs[lo]
}

// Instantaneous value (A or V) of one phase in one view
export function valueAt(trace, qty, view, p, t) {
  const s = segAt(trace, t)
  const X = s.q[qty][p][view]
  if (qty === 'I' && Math.hypot(X.re, X.im) <= 1e-6 && t > s.t0) {
    // Current just stopped: the pole interrupts at the next zero of the previous current
    const i = trace.segs.indexOf(s)
    const prev = i > 0 ? trace.segs[i - 1] : null
    if (prev && s.t0 > trace.tFault && t - s.t0 < 0.5 / trace.f) {
      const P = prev.q.I[p][view]
      const v0 = steady(P, trace.w, s.t0), v = steady(P, trace.w, t)
      if (Math.hypot(P.re, P.im) > 1e-6 && Math.sign(v) === Math.sign(v0)) return v
    }
    return 0
  }
  let v = steady(X, trace.w, t)
  if (qty === 'I' && t >= trace.tFault && trace.offset[view] && Math.hypot(X.re, X.im) > 1e-6) {
    v += trace.offset[view][p] * Math.exp(-(t - trace.tFault) / trace.tau)
  }
  return v
}

// The relay's samples: times on the sampling grid within [t0, t1]
export function sampleTimes(trace, t0, t1) {
  const dt = 1 / (trace.f * SAMPLES_PER_CYCLE)
  const out = []
  for (let k = Math.ceil(t0 / dt - 1e-9); k * dt <= t1 + 1e-12; k++) out.push(k * dt)
  return out
}

// Full-cycle DFT estimate (RMS magnitude) at time t from the last cycle of samples
export function dftAt(trace, qty, view, p, t) {
  const N = SAMPLES_PER_CYCLE
  const dt = 1 / (trace.f * N)
  const kEnd = Math.floor(t / dt + 1e-9)
  let re = 0, im = 0
  for (let n = 0; n < N; n++) {
    const k = kEnd - (N - 1) + n
    const x = valueAt(trace, qty, view, p, k * dt)
    const ang = (2 * Math.PI * k) / N
    re += x * Math.cos(ang)
    im -= x * Math.sin(ang)
  }
  // Peak = 2/N·|Σ|, RMS = peak/√2
  return (Math.SQRT2 / N) * Math.hypot(re, im)
}

// RMS of the steady-state phasor (the value the engine's phasor solver uses)
export function phasorRms(trace, qty, view, p, t) {
  const X = segAt(trace, t).q[qty][p][view]
  return Math.hypot(X.re, X.im)
}

// One station over the run: per event segment, each feeder's current into the
// bus (true primary) and, where bus differential (87B) covers this bus, each
// 87B CT's current as the relay sees it and the element's operate / restraint
// (worst phase). Instrument faults apply from the start, except in a no-fault
// run, where they happen at t = 0 (as in the engine).
export function stationTrace(sim, config, scenario, bus) {
  const z = busZone(sim.net, config)
  const zone = z && z.bus === bus ? z : null
  const feeders = Object.keys(config.relays).filter(id => config.relays[id].bus === bus)
  const inst = instrumentFaults(config, scenario)
  const s = { ...config.busdiff }
  const segs = []
  for (const e of sim.events) {
    if (!e.state.meas) continue
    const into = feeders.map(rid => (e.state.meas[rid]?.prim?.Iabc ?? []).map(I => ({ re: -I.re, im: -I.im })))
    const el = zone ? busDiffElement(e.state.meas, zone, sim.noFault && e.t < 0 ? {} : inst, s) : null
    const worst = el ? el.phases.reduce((w, p) => (p.Iop > w.Iop ? p : w)) : null
    const seg = { t0: e.t, into, el, Iop: worst?.Iop ?? 0, Ires: worst?.Ires ?? 0, state: e.state }
    const last = segs[segs.length - 1]
    if (last && Math.abs(last.t0 - e.t) < 1e-12) segs[segs.length - 1] = seg
    else segs.push(seg)
  }
  return { bus, zone, feeders, segs, pickup: s.pickupPu ?? 0.2, slope: (s.slopePct ?? 50) / 100 }
}

// The bus differential's station (null without 87B in force)
export function busTrace(sim, config, scenario) {
  const zone = busZone(sim.net, config)
  return zone ? stationTrace(sim, config, scenario, zone.bus) : null
}

export function busAt(bt, t) {
  const { segs } = bt
  let k = 0
  for (let i = 0; i < segs.length; i++) if (segs[i].t0 <= t) k = i
  return segs[k]
}
