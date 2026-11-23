// CT saturation — a small time-domain CT model. No React.
//
// A CT reproduces its primary current only while its core flux stays below the
// knee. The flux is the integral of the secondary current through the burden
// (here normalized: λ = ∫ i_s dt, in pu·s). An ideal-knee core: below the knee
// the secondary is the primary; at the knee the core saturates and the
// secondary collapses to zero until the primary reverses and drives the flux
// back down. That gives the classic chopped secondary.
//
// A DC offset at fault inception pushes the flux one way every cycle, so a CT
// that carries the symmetrical fault current comfortably can still saturate a
// few milliseconds in, and comes out again as the offset decays.
//
// Size: K = the symmetrical current (multiples of the CT's rated current) it
// carries without saturating at its connected burden. A well-applied C800
// 1200:5 CT with a short lead run is K ≈ 20 or more; an undersized CT, or long
// leads and an old electromechanical burden, can be a few times rated.
//
// The relay sees the one-cycle DFT of the sampled secondary. The engine uses
// ctGain(): that estimate divided by the DFT of a perfect CT on the same primary
// (so the DC offset's own filtering error, which the engine doesn't model,
// cancels), applied to the relay's phasor as a complex gain: smaller, and
// leading in angle.

import { baseAmps, BAY_BASE, CT_SAT, ctSatK } from './instruments'
import { C, div, abs } from './complex'

export { CT_SAT, ctSatK }

// The CT's rated primary current in pu of the display base (1200 A)
export const RATED_PU = () => (BAY_BASE.ctRatio * 5) / baseAmps()

export const SIM_PER_CYCLE = 64   // integration steps per cycle
export const DFT_PER_CYCLE = 16   // the relay's samples (as waveforms.js)

// Waveform phase at t = 0: the fault starts at a phase-A voltage zero, the
// textbook worst case for DC offset, so phase A (the phase every panel shows)
// carries the full offset. Shared with the oscillography (waveforms.js).
export const INCEPTION = -Math.PI / 2

// i(t) = √2·Re(X e^{j(ωt + INCEPTION)}) and its integral (centered: no DC)
export const inst = (X, w, t) => Math.SQRT2 * (X.re * Math.cos(w * t + INCEPTION) - X.im * Math.sin(w * t + INCEPTION))
const flux = (X, w, t) => (Math.SQRT2 / w) * (X.re * Math.sin(w * t + INCEPTION) + X.im * Math.cos(w * t + INCEPTION))

// Run the core from t0 to t1. primary(t): instantaneous primary current (any
// unit); kneeFlux in that unit × s; lambda0: flux at t0. Returns the
// secondary on the SIM grid t0 + n·dt.
export function simulateCt(primary, kneeFlux, t0, t1, dt, lambda0 = 0) {
  const n = Math.max(1, Math.round((t1 - t0) / dt) + 1)
  const out = new Float64Array(n)
  let lam = Math.max(-kneeFlux, Math.min(kneeFlux, lambda0))
  out.firstSat = null // time the core first saturated
  for (let k = 0; k < n; k++) {
    const ip = primary(t0 + k * dt)
    const sat = (lam >= kneeFlux && ip > 0) || (lam <= -kneeFlux && ip < 0)
    if (sat && out.firstSat === null && Math.abs(ip) > 1e-9) out.firstSat = t0 + k * dt
    const is = sat ? 0 : ip
    out[k] = is
    lam = Math.max(-kneeFlux, Math.min(kneeFlux, lam + is * dt))
  }
  return out
}

// Knee flux for K × rated, in pu·s: a symmetrical sinusoid of peak √2·K·rated
// swings the flux ±√2·K·rated/ω
export const kneeFluxPu = (K, w) => (Math.SQRT2 * K * RATED_PU()) / w

// Primary history for one breaker: segments [{ t0, I: [phasor ×3] }] (pu, from
// the solver's prim), the fault at tFault with a decaying DC offset (τ) that
// keeps each phase continuous, as in the oscillography
export function primaryFn(segs, p, { w, tau, tFault }) {
  const fi = segs.findIndex(s => Math.abs(s.t0 - tFault) < 1e-12)
  const D = fi > 0 ? inst(segs[fi - 1].I[p], w, tFault) - inst(segs[fi].I[p], w, tFault) : 0
  return t => {
    let s = segs[0]
    for (const x of segs) { if (x.t0 <= t + 1e-12) s = x; else break }
    let v = inst(s.I[p], w, t)
    if (D && t >= tFault && abs(s.I[p]) > 1e-9) v += D * Math.exp(-(t - tFault) / tau)
    return v
  }
}

// The relay's phasor estimate: a mimic (DC-removal) filter tuned to the line's
// X/R, y[k] = x[k] − a·x[k−1] with a = e^(−Δt/τ), which cancels a decaying
// offset of that time constant exactly, then a one-cycle DFT, scaled back by
// the mimic's gain at the fundamental. sample(k): the k-th sample on the
// relay's grid (Δt = 1/(f·N)). Complex, peak-scaled.
export function relayPhasor(sample, kEnd, f, tau, N = DFT_PER_CYCLE) {
  const dt = 1 / (f * N)
  const a = Math.exp(-dt / tau)
  let re = 0, im = 0
  for (let n = 0; n < N; n++) {
    const k = kEnd - (N - 1) + n
    const y = sample(k) - a * sample(k - 1)
    const ang = (2 * Math.PI * k) / N
    re += y * Math.cos(ang)
    im -= y * Math.sin(ang)
  }
  const wdt = (2 * Math.PI) / N
  return div(C((2 / N) * re, (2 / N) * im), C(1 - a * Math.cos(wdt), a * Math.sin(wdt)))
}

// relayPhasor of x (on the SIM grid from tStart) at time t
function dft(x, t, tStart, f, tau) {
  const step = SIM_PER_CYCLE / DFT_PER_CYCLE
  const dt = 1 / (f * SIM_PER_CYCLE)
  const kEnd = Math.floor((t - tStart) / (dt * step) + 1e-9)
  return relayPhasor(k => x(Math.max(0, k) * step), kEnd, f, tau)
}

// The relay's settled view of one phase at time t: { g, tSat }.
// g = relay estimate of the saturated secondary ÷ that of a perfect CT, as a
// complex gain. Like the rest of the engine (a zone decided at t is confirmed
// one relay time later), the measurement is the estimate a full cycle after
// the latest change in the primary current, the current carrying on as it is;
// earlier windows straddle the change and mean nothing. Until the core has
// actually saturated the CT is perfect (g = 1). tSat: when the core first
// saturated (null if it doesn't).
// segs: primary history up to t; K: CT size; ctx: { f, tau, tFault, tStart }
export function ctGain(segs, K, t, ctx, p = 0) {
  const { f, tStart } = ctx
  const w = 2 * Math.PI * f
  const dt = 1 / (f * SIM_PER_CYCLE)
  const last = segs.reduce((a, s) => (s.t0 <= t + 1e-12 ? s : a), segs[0])
  const tEval = last.t0 > tStart + 1e-12 ? Math.max(t, last.t0 + 1 / f) : t
  const prim = primaryFn(segs, p, { ...ctx, w })
  const sec = simulateCt(prim, kneeFluxPu(K, w), tStart, tEval, dt, flux(segs[0].I[p], w, tStart))
  const Xs = dft(n => sec[Math.min(n, sec.length - 1)], tEval, tStart, f, ctx.tau)
  const Xi = dft(n => prim(tStart + n * dt), tEval, tStart, f, ctx.tau)
  // Perfect until the core has actually saturated (and with no current to speak of)
  const tSat = sec.firstSat
  const g = abs(Xi) < 1e-6 || tSat === null || t < tSat - 1e-12 ? C(1) : div(Xs, Xi)
  return { g, tSat }
}

// For the oscillography: the saturated secondary of a waveform already in
// display units (A primary), sampled on the SIM grid from t0 to t1
export function saturatedWave(primaryA, K, f, t0, t1, lambda0A = 0) {
  const w = 2 * Math.PI * f
  const dt = 1 / (f * SIM_PER_CYCLE)
  const kneeA = kneeFluxPu(K, w) * baseAmps()
  const sec = simulateCt(primaryA, kneeA, t0, t1, dt, lambda0A)
  return t => {
    const x = (t - t0) / dt
    const k = Math.floor(x)
    if (k < 0) return primaryA(t)
    if (k >= sec.length - 1) return sec[sec.length - 1]
    // A collapse to zero is a real step: no interpolation across one
    const a = sec[k], b = sec[k + 1]
    return (a === 0) !== (b === 0) ? (x - k < 0.5 ? a : b) : a + (b - a) * (x - k)
  }
}

export { flux as centeredFlux }
