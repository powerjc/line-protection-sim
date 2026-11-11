import { relayColor } from '../lib/colors'
import { impedanceBehind } from '../lib/solver'

// Phasor panel (V2): V and I at every relay for the current snapshot.
// V is drawn against the prefault voltage (1 pu circle, the memory
// polarizer); I is scaled to the largest relay current in the whole run, so
// stepping shows currents collapse as breakers open.

const S = 120 // svg size
const R = 50  // radius for 1 pu V / max I
const abs = c => Math.hypot(c.re, c.im)
const deg = c => (Math.atan2(c.im, c.re) * 180) / Math.PI
const fmtAng = c => `${Math.round(deg(c)) || 0}°` // || 0 avoids "-0°"
const fmtMag = m => (m >= 10 ? m.toFixed(1) : m >= 0.1 ? m.toFixed(2) : m.toFixed(3))
const I_COLOR = '#ea580c' // fault-current orange, as on the one-line

function Arrow({ c, scale, color, dash, label }) {
  const m = abs(c)
  if (m * scale < 1) return null
  const x = S / 2 + c.re * scale, y = S / 2 - c.im * scale
  const a = Math.atan2(-(c.im), c.re)
  const h = 7, w = 0.45
  const p1 = [x - h * Math.cos(a - w), y - h * Math.sin(a - w)]
  const p2 = [x - h * Math.cos(a + w), y - h * Math.sin(a + w)]
  const lx = S / 2 + c.re * scale * 1.18, ly = S / 2 - c.im * scale * 1.18
  return (
    <g>
      <line x1={S / 2} y1={S / 2} x2={x} y2={y} stroke={color} strokeWidth={2} strokeDasharray={dash} />
      <polygon points={`${x},${y} ${p1} ${p2}`} fill={color} />
      <text x={lx} y={ly} fontSize={10} fontWeight={600} fill={color} textAnchor="middle" dominantBaseline="middle">{label}</text>
    </g>
  )
}

function PhasorCard({ rid, m, iScale, lineLength, zBehind }) {
  const color = relayColor(rid)
  const carrying = m && m.dir !== 0 // sees fault current (load alone doesn't count)
  const hasI = m && abs(m.I) > 1e-6
  const v = m ? abs(m.V) : 1
  const sir = zBehind / lineLength
  return (
    <div className={`rounded-lg border p-2 flex gap-2 items-center ${carrying ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="shrink-0">
        <line x1={4} y1={S / 2} x2={S - 4} y2={S / 2} stroke="#e5e7eb" />
        <line x1={S / 2} y1={4} x2={S / 2} y2={S - 4} stroke="#e5e7eb" />
        {/* Prefault voltage: the memory polarizer */}
        <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke="#d1d5db" strokeDasharray="3 3" />
        <line x1={S / 2} y1={S / 2} x2={S / 2 + R} y2={S / 2} stroke="#9ca3af" strokeDasharray="3 3" />
        {m && <Arrow c={m.V} scale={R} color={color} label="Va" />}
        {hasI && <Arrow c={m.I} scale={iScale} color={I_COLOR} label="Ia" />}
      </svg>
      <div className="text-xs font-mono leading-5 min-w-0">
        <div className="font-sans font-semibold" style={{ color }}>21-{rid}</div>
        <div><span className="text-gray-400">Va </span>{fmtMag(v)}∠{m ? fmtAng(m.V) : '0°'}</div>
        <div><span className="text-gray-400">Ia </span>{hasI ? `${fmtMag(abs(m.I))}∠${fmtAng(m.I)}` : '0'}</div>
        {carrying && m.I0x3 && abs(m.I0x3) > 1e-6 && (
          <div><span className="text-gray-400">3I0 </span>{fmtMag(abs(m.I0x3))}∠{fmtAng(m.I0x3)}</div>
        )}
        <div><span className="text-gray-400">Z{carrying && m.loop ? `(${m.loop})` : ''} </span>{carrying && m.Z
          ? `${(Math.hypot(m.Z.R, m.Z.X) / lineLength * 100).toFixed(0)}% ∠${fmtAng({ re: m.Z.R, im: m.Z.X })}`
          : '—'}</div>
        {m?.Zload && (
          <div><span className="text-gray-400">Zload </span>{(Math.hypot(m.Zload.R, m.Zload.X) / lineLength * 100).toFixed(0)}% ∠{fmtAng({ re: m.Zload.R, im: m.Zload.X })}</div>
        )}
        <div className="font-sans">
          {carrying ? (
            <span className={m.dir > 0 ? 'text-blue-600' : 'text-rose-600'}>
              {m.dir > 0 ? 'Forward' : 'Reverse'}{v < 0.05 ? ' (memory)' : ''}
            </span>
          ) : <span className="text-gray-400">{hasI ? 'load only' : 'no current'}</span>}
        </div>
        <div className="font-sans text-gray-400">SIR {!Number.isFinite(sir) ? '∞' : sir === 0 ? '0 (stiff)' : fmtMag(sir)}</div>
      </div>
    </div>
  )
}

export default function PhasorPanel({ config, sim, state }) {
  const relayIds = Object.keys(config.relays)
  // One current scale for the whole run (finite currents only)
  let iMax = 0
  for (const e of sim.events) for (const id of relayIds) {
    const I = e.state.meas?.[id]?.I
    if (I && Number.isFinite(abs(I))) iMax = Math.max(iMax, abs(I))
  }
  const iScale = iMax > 0 ? R / iMax : R
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-700">Phasors at the relays</h2>
        <span className="text-xs text-gray-400">
          pu · dashed circle = prefault V (memory polarizer) · <span style={{ color: I_COLOR }}>I</span> scaled to the largest current in this run ({fmtMag(iMax)} pu) · Z as % of own line
        </span>
      </div>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {relayIds.map(id => (
          <PhasorCard key={id} rid={id} m={state.meas?.[id]} iScale={iScale}
            lineLength={sim.net.lines[config.relays[id].line].length}
            zBehind={impedanceBehind(sim.net, config, id)} />
        ))}
      </div>
    </section>
  )
}
