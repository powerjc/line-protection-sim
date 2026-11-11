import { useMemo, useState } from 'react'
import { FAULTS } from '../lib/faults'
import { runDifferential } from '../lib/differential'
import { FaultSpecPicker } from './ScenarioPanel'

// Differential tab (87L on line A–B): settings, the Iop–Ires operating
// characteristic with every fault plotted, and the results table.

const W = 460, H = 360, PAD_L = 44, PAD_B = 34, PAD_T = 12, PAD_R = 12
const GOOD = '#16a34a', BAD = '#dc2626'

function Setting({ label, value, min, max, step, unit, onChange, title }) {
  return (
    <label className="flex flex-col gap-1" title={title}>
      <span className="flex justify-between text-xs text-gray-600"><span>{label}</span><span className="font-mono">{value}{unit}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="h-2" />
    </label>
  )
}

function Characteristic({ rows, s, selected, onSelect }) {
  const slope = s.slopePct / 100
  const xMax = Math.max(1, ...rows.map(r => r.worst.Ires)) * 1.15
  const yMax = Math.max(2 * s.pickupPu, slope * xMax, ...rows.map(r => r.worst.Iop)) * 1.15
  const px = x => PAD_L + (x / xMax) * (W - PAD_L - PAD_R)
  const py = y => H - PAD_B - (y / yMax) * (H - PAD_B - PAD_T)
  const knee = slope > 0 ? Math.min(s.pickupPu / slope, xMax) : xMax
  const line = `${px(0)},${py(s.pickupPu)} ${px(knee)},${py(s.pickupPu)} ${px(xMax)},${py(Math.max(s.pickupPu, slope * xMax))}`
  const ticks = n => Array.from({ length: n + 1 }, (_, i) => i / n)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Differential operating characteristic">
      {/* Operate region above the characteristic */}
      <polygon points={`${px(0)},${py(yMax)} ${line} ${px(xMax)},${py(yMax)}`} fill="rgba(220,38,38,0.06)" />
      {ticks(4).map(f => (
        <g key={f}>
          <line x1={px(f * xMax)} y1={py(0)} x2={px(f * xMax)} y2={py(yMax)} stroke="#f0f1f3" />
          <text x={px(f * xMax)} y={H - PAD_B + 14} fontSize={10} textAnchor="middle" fill="#6b7280">{(f * xMax).toFixed(2)}</text>
          <line x1={px(0)} y1={py(f * yMax)} x2={px(xMax)} y2={py(f * yMax)} stroke="#f0f1f3" />
          <text x={PAD_L - 6} y={py(f * yMax) + 3} fontSize={10} textAnchor="end" fill="#6b7280">{(f * yMax).toFixed(2)}</text>
        </g>
      ))}
      <line x1={px(0)} y1={py(0)} x2={px(xMax)} y2={py(0)} stroke="#9ca3af" />
      <line x1={px(0)} y1={py(0)} x2={px(0)} y2={py(yMax)} stroke="#9ca3af" />
      <text x={(PAD_L + W) / 2} y={H - 4} fontSize={11} textAnchor="middle" fill="#374151">Ires = (|IA| + |IB|) / 2  (pu)</text>
      <text x={12} y={(H - PAD_B) / 2} fontSize={11} textAnchor="middle" fill="#374151" transform={`rotate(-90 12 ${(H - PAD_B) / 2})`}>Iop = |IA + IB|  (pu)</text>
      <polyline points={line} fill="none" stroke="#dc2626" strokeWidth={2} />
      <text x={px(xMax) - 4} y={py(Math.max(s.pickupPu, slope * xMax)) - 6} fontSize={10} textAnchor="end" fill="#dc2626">OPERATE</text>
      <text x={px(xMax) - 4} y={py(0) - 6} fontSize={10} textAnchor="end" fill="#6b7280">RESTRAIN</text>
      {(() => {
        // Points that coincide (e.g. F5/F6) get their labels fanned out around the point
        const placed = []
        const SPOTS = [[8, -6, 'start'], [8, 12, 'start'], [-8, -6, 'end'], [-8, 12, 'end'], [0, -12, 'middle'], [0, 20, 'middle']]
        return rows.map(r => {
          const ok = r.assessment.startsWith('Correct')
          const x = px(r.worst.Ires), y = py(r.worst.Iop), sel = r.fault.id === selected
          const [dx, dy, anchor] = SPOTS.find(([dx, dy]) => !placed.some(p => Math.abs(p[0] - (x + dx)) < 16 && Math.abs(p[1] - (y + dy)) < 11)) ?? SPOTS[0]
          placed.push([x + dx, y + dy])
          return (
            <g key={r.fault.id} className="cursor-pointer" onClick={() => onSelect(r.fault.id)}>
              <circle cx={x} cy={y} r={sel ? 7 : 5} fill={ok ? GOOD : BAD} stroke={sel ? '#111827' : 'white'} strokeWidth={2} />
              <text x={x + dx} y={y + dy} fontSize={10} fontWeight={600} textAnchor={anchor} fill={ok ? GOOD : BAD}>{r.fault.id}</text>
            </g>
          )
        })
      })()}
    </svg>
  )
}

export default function DifferentialView({ config, spec, onSpec, onUpdateDiff }) {
  const rows = useMemo(() => runDifferential(FAULTS, config, spec), [config, spec])
  const [selected, setSelected] = useState('F3')
  const s = rows[0].settings
  const row = rows.find(r => r.fault.id === selected) ?? rows[0]
  return (
    <div className="flex flex-col lg:flex-row gap-4 p-4">
      <aside className="lg:w-64 shrink-0 bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">87L settings · line A–B</h3>
        <Setting label="Pickup" value={s.pickupPu} min={0.05} max={1.5} step={0.05} unit=" pu"
          title="Minimum operate current" onChange={v => onUpdateDiff('pickupPu', v)} />
        <Setting label="Slope" value={s.slopePct} min={0} max={150} step={5} unit="%"
          title="Operate current must exceed this share of the restraint current" onChange={v => onUpdateDiff('slopePct', v)} />
        <hr className="border-gray-100" />
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Conditions</h3>
        <Setting label="Line charging current" value={s.chargingPu} min={0} max={1} step={0.05} unit=" pu"
          title="Capacitive current into the line at 1 pu voltage — seen as differential" onChange={v => onUpdateDiff('chargingPu', v)} />
        <Setting label="CT error at B" value={s.ctErrorPct} min={0} max={90} step={5} unit="%"
          title="B's CT under-reports (e.g. saturation on a through fault)" onChange={v => onUpdateDiff('ctErrorPct', v)} />
        <FaultSpecPicker config={config} spec={spec} onChange={onSpec} />
        <p className="text-xs text-gray-400">Same network and fault type / Rf as the Fault Study. Currents are both measured into the line, so an external fault sums to ≈ 0.</p>
      </aside>

      <main className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Operating characteristic</h2>
        <div className="mx-auto w-full" style={{ maxWidth: 'min(560px, max(320px, calc(100vh - 14rem)))' }}>
          <Characteristic rows={rows} s={s} selected={selected} onSelect={setSelected} />
        </div>
        <p className="text-xs text-gray-500">
          {row.fault.label} — {row.fault.description}: phase {row.worst.phase}, Iop {row.worst.Iop.toFixed(2)} pu,
          Ires {row.worst.Ires.toFixed(2)} pu → <b>{row.operate ? 'OPERATE' : 'restrain'}</b>
        </p>
      </main>

      <section className="lg:w-80 shrink-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">87L results</h2>
          <p className="text-xs text-gray-400">Click a row to highlight it on the chart</p>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-gray-400"><th className="text-left px-3 py-1 font-medium">Fault</th><th className="font-medium px-1">Iop</th><th className="font-medium px-1">Ires</th><th className="font-medium">Result</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const ok = r.assessment.startsWith('Correct')
              return (
                <tr key={r.fault.id} onClick={() => setSelected(r.fault.id)}
                  className={`cursor-pointer border-t border-gray-50 ${r.fault.id === selected ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-3 py-1.5"><span className="text-gray-400">{r.fault.id}</span> {r.fault.label}
                    <div className="text-gray-400">{r.internal ? 'internal' : 'external'}</div></td>
                  <td className="text-center font-mono px-1">{r.worst.Iop.toFixed(2)}</td>
                  <td className="text-center font-mono px-1">{r.worst.Ires.toFixed(2)}</td>
                  <td className="text-center px-1">
                    <span className={`inline-block px-1.5 py-0.5 rounded ${ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{r.assessment}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}
