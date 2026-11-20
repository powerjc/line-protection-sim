// Instrument transformers: what a relay sees of the primary system. No React.
//
// The solver gives primary V and I at each relay's bus/CT. A relay never sees
// those directly: its CTs and VTs scale them down to secondary values, the
// wiring delivers them, and the relay converts back to primary with the
// ratios it has been *set* to. With ideal instruments (the default) that
// round trip is the identity, so nothing changes.
//
// Instrument faults are scenario entries (like relayOos, tripOpen), active
// only with the 'foundations' module on:
//   ctReversed: { rid: 'abc' | 'a' | 'b' | 'c' }  CT polarity reversed: all three
//               phases (leads swapped at the terminal block) or one (a wiring error)
//   ratioError: { rid: { ct, vt } }  configured ÷ actual ratio. The relay scales
//               I by ct and V by vt, so its Z is scaled by vt / ct (a reach error)
//   vtFuse:     { rid: 'abc' | 'a' | 'b' | 'c' }  VT fuse failed: that phase's
//               voltage (and the memory built from it) is gone
//
// Display base for the Bay tab: typical, illustrative values (not settings).

import { scale, ZERO } from './complex'

// Line A–B (1.0 pu) is 20 Ω primary, so 1 pu current ≈ 4.0 kA and the relay's
// secondary impedance is Z_pri × CTR / VTR = 4 Ω for the whole line.
export const BAY_BASE = {
  kV: 138,        // line-to-line
  zOhm: 20,       // line A–B impedance, primary ohms (= 1 pu)
  ctRatio: 240,   // 1200:5
  ctLabel: '1200:5',
  vtRatio: 1200,  // 1200:1 → 115 V secondary line-to-line
  vtLabel: '1200:1',
}
export const baseKVph = (b = BAY_BASE) => b.kV / Math.sqrt(3)              // 1 pu phase voltage, kV
export const baseAmps = (b = BAY_BASE) => (baseKVph(b) * 1e3) / b.zOhm     // 1 pu current, A
// Configured ratio choices (UI): label → ratio ÷ the actual ratio
export const CT_SETTINGS = [['1200:5', 1], ['1000:5', 1000 / 1200], ['1500:5', 1500 / 1200], ['2000:5', 2000 / 1200]]
export const VT_SETTINGS = [['1200:1', 1], ['1000:1', 1000 / 1200], ['1400:1', 1400 / 1200]]

export const INSTRUMENT_FAULTS = ['ctReversed', 'ratioError', 'vtFuse']

// The instrument faults that apply to this run (module gating lives here)
export function instrumentFaults(config, scenario = {}) {
  if (!config.features?.foundations) return {}
  const out = {}
  for (const k of INSTRUMENT_FAULTS) {
    if (scenario[k] && Object.keys(scenario[k]).length) out[k] = scenario[k]
  }
  return out
}

const phaseMask = sel => (sel === 'abc' ? [true, true, true] : ['a', 'b', 'c'].map(p => p === sel))

// One relay's instruments: per-phase CT polarity and VT presence, and the
// configured ÷ actual ratio factors
export function relayInstruments(inst = {}, rid) {
  const rev = inst.ctReversed?.[rid]
  const fuse = inst.vtFuse?.[rid]
  const ratio = inst.ratioError?.[rid] ?? {}
  return {
    ctSign: rev ? phaseMask(rev).map(m => (m ? -1 : 1)) : [1, 1, 1],
    vtLive: fuse ? phaseMask(fuse).map(m => !m) : [true, true, true],
    ct: ratio.ct ?? 1,
    vt: ratio.vt ?? 1,
  }
}

export const sameInstruments = ri =>
  ri.ct === 1 && ri.vt === 1 && ri.ctSign.every(x => x === 1) && ri.vtLive.every(Boolean)

// Primary → what the relay computes as primary, per phase
export const senseI = (Iabc, ri) => Iabc.map((I, p) => scale(I, ri.ctSign[p] * ri.ct))
export const senseV = (Vabc, ri) => Vabc.map((V, p) => (ri.vtLive[p] ? scale(V, ri.vt) : ZERO))

// Short descriptions for the event log
const ctName = rid => (rid.startsWith('bus:') ? `the 87B CT on 52-${rid.slice(4)}` : `21-${rid}`)

export function describeInstrumentFaults(inst) {
  const out = []
  for (const [rid, sel] of Object.entries(inst.ctReversed ?? {})) {
    out.push({ rid: rid.replace(/^bus:/, ''), text: `CT polarity reversed at ${ctName(rid)} (${sel === 'abc' ? 'all three phases' : `phase ${sel.toUpperCase()}`}) — the relay sees that current backwards` })
  }
  for (const [rid, r] of Object.entries(inst.ratioError ?? {})) {
    const k = (r.vt ?? 1) / (r.ct ?? 1)
    out.push({ rid, text: `Ratio setting error at 21-${rid} — measured impedance ×${k.toFixed(2)} of true` })
  }
  for (const [rid, sel] of Object.entries(inst.vtFuse ?? {})) {
    out.push({ rid, text: `VT fuse failed at 21-${rid} (${sel === 'abc' ? 'all three phases' : `phase ${sel.toUpperCase()}`}) — no voltage at the relay` })
  }
  return out
}

// ── Bay tab readings (display units) ──
// m: a relay's snapshot measurement (meas[rid], with prim); ri: relayInstruments().
// Per phase, three views of the same quantity:
//   prim  — what is on the line (A, V primary)
//   sec   — what the instrument delivers to the relay terminals (A, V secondary, actual ratios)
//   relay — what the relay computes as primary (secondary × its configured ratio)
export function bayQuantities(m, ri) {
  const Ib = baseAmps(), Vb = baseKVph() * 1000
  const c = (z, k) => ({ re: (z?.re ?? 0) * k, im: (z?.im ?? 0) * k })
  const I = [0, 1, 2].map(p => ({
    prim: c(m.prim.Iabc[p], Ib),
    sec: c(m.Iabc[p], Ib / (ri.ct * BAY_BASE.ctRatio)),
    relay: c(m.Iabc[p], Ib),
  }))
  const V = [0, 1, 2].map(p => ({
    prim: c(m.prim.Vabc[p], Vb),
    sec: c(m.Vabc[p], Vb / (ri.vt * BAY_BASE.vtRatio)),
    relay: c(m.Vabc[p], Vb),
  }))
  const sum = (rows, k) => rows.reduce((s, r) => ({ re: s.re + r[k].re, im: s.im + r[k].im }), { re: 0, im: 0 })
  const I0x3 = { prim: sum(I, 'prim'), sec: sum(I, 'sec'), relay: sum(I, 'relay') }
  const ohm = Z => Z && { R: Z.R * BAY_BASE.zOhm, X: Z.X * BAY_BASE.zOhm }
  const Zrelay = ohm(m.Z)
  // Secondary ohms at the relay terminals = relay primary ohms × CTR_set / VTR_set
  const k = (ri.ct * BAY_BASE.ctRatio) / (ri.vt * BAY_BASE.vtRatio)
  return {
    I, V, I0x3,
    Z: { prim: ohm(m.prim.Z), relay: Zrelay, sec: Zrelay && { R: Zrelay.R * k, X: Zrelay.X * k } },
    Zload: m.Zload && { prim: ohm(m.prim.Zload), relay: ohm(m.Zload), sec: { R: m.Zload.R * BAY_BASE.zOhm * k, X: m.Zload.X * BAY_BASE.zOhm * k } },
    dir: { prim: m.prim.dir, relay: m.dir },
    loop: { prim: m.prim.loop, relay: m.loop },
  }
}
