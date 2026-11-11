import { useState } from 'react'
import { mhoCircle, faultImpedance, activeZones, isReverse, zoneLabel, quadPolygon, relayShape } from '../lib/protection'

const W = 500, H = 500
const PAD = 0.15 // pu margin around plotted content

// Quadrilateral outline for a zone (% reach on the base line = pu); reverse flips through the origin
function zoneQuad(zone, lineAngleDeg) {
  const pts = quadPolygon(zone.reach / 100, (zone.rReach ?? zone.reach) / 100, lineAngleDeg)
  return isReverse(zone) ? pts.map(p => ({ R: -p.R, X: -p.X })) : pts
}

// Square viewport (equal pu-per-pixel on both axes) fitted to the enabled
// zone shapes, the line, and the fault point. Equal scaling keeps MHO
// circles circular and passing through the origin.
function computeView(zones, lineAngleDeg, faultZ, quad, loadZ) {
  let rMin = 0, rMax = 0, xMin = 0, xMax = 0
  const include = (R, X) => {
    rMin = Math.min(rMin, R); rMax = Math.max(rMax, R)
    xMin = Math.min(xMin, X); xMax = Math.max(xMax, X)
  }
  // Always show at least 1.2 pu of line (covers remote bus + adjacent fault)
  const line = faultImpedance(1.2, lineAngleDeg)
  include(line.R, line.X)
  if (faultZ) include(faultZ.R, faultZ.X)
  if (loadZ) include(loadZ.R, loadZ.X)
  for (const zone of zones) {
    if (!zone.enabled || zone.reach <= 0) continue
    if (quad) { for (const p of zoneQuad(zone, lineAngleDeg)) include(p.R, p.X); continue }
    const { R, X, r } = zoneCircle(zone, lineAngleDeg)
    include(R - r, X - r)
    include(R + r, X + r)
  }
  rMin -= PAD; rMax += PAD; xMin -= PAD; xMax += PAD
  const span = Math.max(rMax - rMin, xMax - xMin)
  // Center the shorter axis within the square
  const rc = (rMin + rMax) / 2, xc = (xMin + xMax) / 2
  return { rMin: rc - span / 2, rMax: rc + span / 2, xMin: xc - span / 2, xMax: xc + span / 2, span }
}

// MHO circle for a zone; reverse zones point back through quadrant III
function zoneCircle(zone, lineAngleDeg) {
  const c = mhoCircle(zone.reach / 100, lineAngleDeg)
  return isReverse(zone) ? { R: -c.R, X: -c.X, r: c.r } : c
}

function tickStep(span) {
  if (span <= 2.5) return 0.2
  if (span <= 5) return 0.5
  return 1
}

const ZONE_STROKE = { 1: '#2563eb', 2: '#d97706', 3: '#e11d48' }
const ZONE_FILL   = { 1: 'rgba(37,99,235,0.07)', 2: 'rgba(217,119,6,0.07)', 3: 'rgba(225,29,72,0.06)' }

export default function ImpedancePlane({ config, selectedResult }) {
  const [activeRelay, setActiveRelay] = useState('A')
  // Relay A / B are the base line's terminals (base line = 1.0 pu, so % reach = pu)
  const relay = config.relays[activeRelay === 'A' ? 'AB' : 'BA']
  const θ = config.lineAngleDeg

  // Fault point as seen by the selected relay (reverse faults land in quadrant III)
  const seen = selectedResult?.[activeRelay]
  const faultZ = seen ? seen.Z : null
  const reverse = seen ? seen.fwd <= 0 : false

  const zones = activeZones(relay, config)
  const quad = relayShape(relay, config) === 'quad'
  const VB = computeView(zones, θ, faultZ, quad, seen?.Zload)
  const scale = W / VB.span // px per pu, same on both axes
  const toSvg = (R, X) => [(R - VB.rMin) * scale, H - (X - VB.xMin) * scale]

  const [fx, fy] = faultZ ? toSvg(faultZ.R, faultZ.X) : [null, null]
  // Prefault load point (with the load feature): where the relay sits before the fault
  const loadZ = seen?.Zload
  const [lpx, lpy] = loadZ ? toSvg(loadZ.R, loadZ.X) : [null, null]

  // Grid lines and tick values (integer stepping avoids float drift)
  const step = tickStep(VB.span)
  const rTicks = [], xTicks = []
  for (let i = Math.ceil(VB.rMin / step); i * step <= VB.rMax; i++) rTicks.push(+(i * step).toFixed(2))
  for (let i = Math.ceil(VB.xMin / step); i * step <= VB.xMax; i++) xTicks.push(+(i * step).toFixed(2))

  const gridLines = []
  for (const r of rTicks) {
    const [x1] = toSvg(r, 0)
    gridLines.push(<line key={`gr${r}`} x1={x1} y1={0} x2={x1} y2={H} stroke="#e5e7eb" strokeWidth={0.5} />)
  }
  for (const x of xTicks) {
    const [, y1] = toSvg(0, x)
    gridLines.push(<line key={`gx${x}`} x1={0} y1={y1} x2={W} y2={y1} stroke="#e5e7eb" strokeWidth={0.5} />)
  }

  // Axes
  const [ax0] = toSvg(0, VB.xMin); const [ax1] = toSvg(0, VB.xMax)
  const [, ay0] = toSvg(VB.rMin, 0); const [, ay1] = toSvg(VB.rMax, 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {['A', 'B'].map(id => (
          <button
            key={id}
            onClick={() => setActiveRelay(id)}
            className={`px-4 py-1 text-sm font-semibold rounded-full border transition
              ${activeRelay === id
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'}`}
          >
            Relay {id}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400 self-center">R-X Plane (pu of line)</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full mx-auto border border-gray-200 rounded-lg bg-white"
        // Fit both viewport width and height (square), so wide screens don't force vertical scroll
        style={{ aspectRatio: '1', maxWidth: 'max(280px, calc(100vh - 13rem))' }}
      >
        {gridLines}

        {/* Axes */}
        <line x1={ax0} y1={0} x2={ax0} y2={H} stroke="#9ca3af" strokeWidth={1} />
        <line x1={0} y1={ay0} x2={W} y2={ay0} stroke="#9ca3af" strokeWidth={1} />

        {/* Axis labels */}
        {rTicks.filter(v => v > 0).map(v => {
          const [x] = toSvg(v, 0)
          return <text key={`lr${v}`} x={x} y={ay0 + 14} textAnchor="middle" fontSize={10} fill="#9ca3af">{v}</text>
        })}
        {xTicks.filter(v => v > 0).map(v => {
          const [, y] = toSvg(0, v)
          return <text key={`lx${v}`} x={ax0 - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
        })}
        <text x={W - 8} y={ay0 - 6} textAnchor="end" fontSize={11} fill="#6b7280">R (pu)</text>
        <text x={ax0 + 6} y={12} textAnchor="start" fontSize={11} fill="#6b7280">X (pu)</text>

        {/* Line impedance direction */}
        {(() => {
          const [lx, ly] = toSvg(Math.cos(θ * Math.PI / 180), Math.sin(θ * Math.PI / 180))
          const [ox, oy] = toSvg(0, 0)
          return (
            <line x1={ox} y1={oy} x2={lx} y2={ly}
              stroke="#d1d5db" strokeWidth={1} strokeDasharray="4 3" />
          )
        })()}

        {/* Zone characteristics: MHO circles or quadrilaterals */}
        {zones.map(zone => {
          if (!zone.enabled) return null
          if (quad) {
            const pts = zoneQuad(zone, θ).map(p => toSvg(p.R, p.X).join(',')).join(' ')
            return <polygon key={zone.id} points={pts} fill={ZONE_FILL[zone.id]} stroke={ZONE_STROKE[zone.id]} strokeWidth={2} strokeLinejoin="round" />
          }
          const { R, X, r } = zoneCircle(zone, θ)
          const [cx, cy] = toSvg(R, X)
          const rPx = r * scale
          return (
            <circle
              key={zone.id}
              cx={cx} cy={cy} r={rPx}
              fill={ZONE_FILL[zone.id]}
              stroke={ZONE_STROKE[zone.id]}
              strokeWidth={2}
            />
          )
        })}

        {/* Zone labels */}
        {zones.map(zone => {
          if (!zone.enabled) return null
          const { R, X } = zoneCircle(zone, θ)
          const off = isReverse(zone) ? -0.08 : 0.03
          const [lx, ly] = toSvg(R * 1.05 + off, X * 1.05 + off)
          return (
            <text key={zone.id} x={lx} y={ly} fontSize={12}
              fontWeight="600" fill={ZONE_STROKE[zone.id]}>
              {zoneLabel(zone)}
            </text>
          )
        })}

        {/* Load point */}
        {lpx !== null && (
          <g>
            <rect x={lpx - 6} y={lpy - 6} width={12} height={12} fill="#6b7280" stroke="white" strokeWidth={2} transform={`rotate(45 ${lpx} ${lpy})`} />
            <text x={lpx + 11} y={lpy + 4} fontSize={11} fill="#6b7280" fontWeight="600">Load</text>
          </g>
        )}

        {/* Fault point */}
        {fx !== null && (
          <g>
            <circle cx={fx} cy={fy} r={7} fill="#dc2626" stroke="white" strokeWidth={2} />
            <text x={fx + 11} y={fy + 4} fontSize={11} fill="#dc2626" fontWeight="600">
              {selectedResult?.fault.label}{reverse ? ' (reverse)' : ''}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
