import { useState } from 'react'
import { relayColor } from '../lib/colors'
import { useUnits } from '../lib/units'

// Compact Z1 / Z2 settings for the Coordination sidebar: reach sliders and
// the Z2 delay per terminal. The full settings (reverse zone, k0, shape,
// R reach) stay in "Relay & line settings" below the diagrams.
export default function QuickZones({ config, onUpdateZone }) {
  const [open, setOpen] = useState(true)
  const units = useUnits()
  const relayIds = Object.keys(config.relays)
  const zoneOf = (rid, id) => config.relays[rid].zones.find(z => z.id === id)
  return (
    <div className="flex flex-col gap-2">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wider">
        <span>Zone reach</span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {!open && <p className="text-xs text-gray-400">Z1 / Z2 reach and Z2 delay per relay</p>}
      {open && (
        <div className="flex flex-col gap-3">
          {relayIds.map(rid => (
            <div key={rid} className="flex flex-col gap-1">
              <span className="text-xs font-semibold" style={{ color: relayColor(rid) }}>21-{rid}</span>
              {[1, 2].map(id => {
                const z = zoneOf(rid, id)
                if (!z) return null
                return (
                  <div key={id} className={`flex items-center gap-2 ${z.enabled ? '' : 'opacity-50'}`}>
                    <span className={`text-xs font-semibold w-5 ${id === 1 ? 'text-blue-600' : 'text-amber-600'}`}>Z{id}</span>
                    <input type="range" min={0} max={300} step={5} value={z.reach} disabled={!z.enabled}
                      onChange={e => onUpdateZone(rid, id, 'reach', Number(e.target.value))}
                      className="flex-1 h-2 min-w-0" aria-label={`21-${rid} Zone ${id} reach`} />
                    <span className="text-xs font-mono w-9 text-right">{z.reach}%</span>
                    {id === 2 ? (
                      <input type="number" min={0} max={units.max} step={units.step}
                        value={Math.round(units.cycToDisplay(z.delayCycles) * 100) / 100} disabled={!z.enabled}
                        onChange={e => {
                          const n = Number(e.target.value)
                          if (e.target.value !== '' && Number.isFinite(n) && n >= 0) onUpdateZone(rid, id, 'delayCycles', units.displayToCyc(n))
                        }}
                        className="w-12 text-xs border border-gray-200 rounded px-1 py-0.5"
                        aria-label={`21-${rid} Zone 2 delay`} title={`Zone 2 delay (${units.label})`} />
                    ) : <span className="w-12 text-xs text-gray-400 text-center">inst</span>}
                  </div>
                )
              })}
            </div>
          ))}
          <p className="text-xs text-gray-400">Z2 delay in {units.label}. More settings: “Relay &amp; line settings” below.</p>
        </div>
      )}
    </div>
  )
}
