// Pure simulation functions — no React dependencies.
// All impedances in per-unit of the base line (1.0 pu = 100% of line AB).

import { relayGeometry, EPS } from './network'

const DEG = Math.PI / 180

// Convert distance along the line angle (pu) to R+jX.
// Negative distance gives a reverse (third-quadrant) impedance.
export function faultImpedance(distance, lineAngleDeg) {
  const θ = lineAngleDeg * DEG
  return {
    R: distance * Math.cos(θ),
    X: distance * Math.sin(θ),
  }
}

// MHO circle geometry for SVG rendering.
// Returns center {R, X} and radius r, all in pu.
export function mhoCircle(reachPu, lineAngleDeg) {
  const θ = lineAngleDeg * DEG
  return {
    R: (reachPu / 2) * Math.cos(θ),
    X: (reachPu / 2) * Math.sin(θ),
    r: reachPu / 2,
  }
}

// Quadrilateral characteristic (V2): reactance line at the reach point's X,
// resistive blinders parallel to the line angle at ±rReach, and a
// directional boundary QUAD_DIR_DEG below the R axis through the origin.
// Directionality is also supervised by the memory-polarized element.
export const QUAD_DIR_DEG = 22 // typical quad directional tilt; lets sending-end resistive faults (tilted down by load) in
const quadDirTan = Math.tan(QUAD_DIR_DEG * DEG)

export function quadContains(R, X, reachPu, rReachPu, lineAngleDeg) {
  const θ = lineAngleDeg * DEG
  const cot = Math.cos(θ) / Math.sin(θ)
  const along = R - X * cot // horizontal offset from the line-angle diagonal
  return X <= reachPu * Math.sin(θ) + EPS
    && Math.abs(along) <= rReachPu + EPS
    && X >= -quadDirTan * Math.abs(R) - EPS
}

// Quad outline for drawing: [{R, X}], forward orientation
export function quadPolygon(reachPu, rReachPu, lineAngleDeg) {
  const θ = lineAngleDeg * DEG
  const cot = Math.cos(θ) / Math.sin(θ)
  const Xr = reachPu * Math.sin(θ)
  const t = quadDirTan
  const rightLow = rReachPu / (1 + t * cot), leftLow = -rReachPu / (1 - t * cot)
  return [
    { R: leftLow, X: t * leftLow },
    { R: 0, X: 0 },
    { R: rightLow, X: -t * rightLow },
    { R: rReachPu + Xr * cot, X: Xr },
    { R: -rReachPu + Xr * cot, X: Xr },
  ]
}

// Characteristic in use: quadrilateral only with the fault-resistance feature on
export const relayShape = (relay, config) => (config.features?.rf && relay.shape === 'quad' ? 'quad' : 'mho')

// Resistive reach in pu (zone.rReach is % of the relay's own line impedance)
export function zoneRReachPu(zone, lineLength) {
  return ((zone.rReach ?? zone.reach) / 100) * lineLength
}

// Zone reach in pu of base line (zone.reach is % of the relay's own line).
export function zoneReachPu(zone, lineLength) {
  return (zone.reach / 100) * lineLength
}

// Stored settings are in cycles; the simulation works in seconds.
export const zoneDelayS = (zone, freqHz) => zone.delayCycles / freqHz
export const ctiS = timing => timing.ctiCycles / timing.freqHz

export const isReverse = zone => zone.direction === 'reverse'
export const zoneLabel = zone => `Z${zone.id}${isReverse(zone) ? 'R' : ''}`

// Zones in play given the feature toggles: reverse zones exist only for
// pilot schemes, so they're hidden (and inert) until that feature is on.
export function activeZones(relay, config) {
  return config.features?.pilot ? relay.zones : relay.zones.filter(z => !isReverse(z))
}

// Zone assertion only — trip decisions live in the caller (static study or
// time-domain engine), so scheme logic can be inserted between the two.
//
// meas: the relay's measurement from the phasor solver — { Z: {R, X} | null,
// dir: +1 forward / -1 reverse / 0 no current }. The memory-polarized
// directional element supervises every zone, which settles Z = 0: a bolted
// fault on the relay's own bus (current flowing in from the line) is reverse.
// shape: 'mho' | 'quad' (relayShape).
export function zoneAsserts(zone, meas, lineLength, lineAngleDeg, shape = 'mho') {
  if (!zone.enabled || zone.reach <= 0 || !meas?.Z) return false
  const reach = zoneReachPu(zone, lineLength)
  const inside = shape === 'quad'
    ? (R, X) => quadContains(R, X, reach, zoneRReachPu(zone, lineLength), lineAngleDeg)
    : (R, X) => mhoContains(R, X, reach, lineAngleDeg)
  const { R, X } = meas.Z
  const atOrigin = Math.hypot(R, X) <= EPS
  if (isReverse(zone)) {
    if (meas.dir >= 0) return false
    return atOrigin || inside(-R, -X)
  }
  if (meas.dir <= 0 || atOrigin) return false
  return inside(R, X)
}

// MHO comparator: Z is inside when Re(Z · conj(Zr − Z)) ≥ 0, Zr = reach∠θ.
// (The angle between Z and Zr − Z is ≤ 90°.) Tolerant of float noise at the
// boundary, so a fault exactly at the reach point is inside.
export function mhoContains(R, X, reachPu, lineAngleDeg) {
  const θ = lineAngleDeg * DEG
  const dR = reachPu * Math.cos(θ) - R, dX = reachPu * Math.sin(θ) - X
  return R * dR + X * dX >= -EPS
}

// Static assessment of one relay against a fault (no time/breaker effects).
// meas: this relay's solver measurement for the fault (see zoneAsserts).
// Returns: { fwd, Z, dir, zones: [{id, asserted, delay}], trippedZone, tripTime, assessment }
//   fwd — geometric distance to the fault (ground truth for the assessment)
//   Z   — measured apparent impedance (null when the relay sees no current)
export function assessRelay(net, relay, pf, config, meas) {
  const g = relayGeometry(net, relay)
  const fwd = (pf - g.pos) * g.dir

  const zones = activeZones(relay, config).map(zone => ({
    id: zone.id,
    label: zoneLabel(zone),
    reverse: isReverse(zone),
    asserted: zoneAsserts(zone, meas, g.lineLength, config.lineAngleDeg, relayShape(relay, config)),
    delay: zoneDelayS(zone, config.timing.freqHz), // s
  }))

  // Fastest asserted forward zone determines trip (reverse zones only feed schemes)
  const trippedZone = zones
    .filter(z => z.asserted && !z.reverse)
    .reduce((best, z) => (best === null || z.delay < best.delay ? z : best), null)
  const tripTime = trippedZone ? trippedZone.delay : null

  const assessment = deriveAssessment(fwd, g.lineLength, trippedZone, ctiS(config.timing))
  return { fwd, Z: meas?.Z ?? null, Zload: meas?.Zload ?? null, dir: meas?.dir ?? 0, V: meas?.V, I: meas?.I, zones, trippedZone, tripTime, assessment }
}

function deriveAssessment(fwd, lineLength, trippedZone, cti) {
  // Behind the relay or at its own bus
  if (fwd <= EPS) return trippedZone ? 'Overreach' : 'Correct no-op'

  // On the protected line
  if (fwd < lineLength - EPS) return trippedZone ? 'Correct trip' : 'Underreach'

  // Remote bus: Z2 is expected to cover it as time-delayed backup
  if (Math.abs(fwd - lineLength) <= EPS) {
    if (!trippedZone) return 'Underreach'
    return trippedZone.id === 1 ? 'Overreach (Z1)' : 'Backup (Z2)'
  }

  // Beyond the remote bus: only a delayed zone should see it,
  // and slowly enough to let the adjacent line's relays clear first
  if (!trippedZone) return 'Correct no-op'
  if (trippedZone.id === 1) return 'Overreach (Z1)'
  if (trippedZone.delay < cti) return 'Coordination failure'
  return 'Backup (Z2)'
}
