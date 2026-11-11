import { useState, useEffect } from 'react'
import { useUnits } from '../lib/units'
import { isReverse } from '../lib/protection'
import { lineK0 } from '../lib/solver'

// k0 control props for a relay — only with the ground-faults feature on
export function k0Props(config, relayId, onUpdateK0) {
  if (!config.features?.ground) return undefined
  const r = config.relays[relayId]
  const k = lineK0(config.network.lines.find(l => l.id === r.line), config)
  return { auto: Math.hypot(k.re, k.im), value: r.k0, onChange: v => onUpdateK0(relayId, 'k0', v) }
}

// Characteristic selector props — offered with the fault-resistance feature on
export function shapeProps(config, relayId, onUpdateRelay) {
  if (!config.features?.rf) return undefined
  return { value: config.relays[relayId].shape ?? 'mho', onChange: v => onUpdateRelay(relayId, 'shape', v) }
}

// Residual compensation setting: Auto (matches the line) or a magnitude override
function K0Setting({ auto, value, onChange }) {
  const isAuto = value == null
  return (
    <div className="flex items-center gap-2 text-xs text-gray-600 px-1">
      <span className="font-semibold w-20" title="Residual compensation for ground elements: k0 = (Z0 − Z1) / 3Z1">Ground k0</span>
      <label className="flex items-center gap-1 cursor-pointer">
        <input type="checkbox" checked={isAuto} onChange={e => onChange(e.target.checked ? null : Math.round(auto * 100) / 100)} />
        auto
      </label>
      <input type="number" min={0} max={3} step={0.05} disabled={isAuto}
        value={isAuto ? auto.toFixed(2) : value}
        onChange={e => {
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(n) && n >= 0 && n <= 3) onChange(n)
        }}
        className="w-16 text-sm border border-gray-200 rounded px-1.5 py-0.5 disabled:bg-gray-50 disabled:text-gray-400" />
      {!isAuto && Math.abs(value - auto) > 0.005 && <span className="text-amber-600">line: {auto.toFixed(2)}</span>}
    </div>
  )
}

const ZONE_COLORS = { 1: 'text-blue-600', 2: 'text-amber-600', 3: 'text-rose-600' }
const ZONE_BG     = { 1: 'bg-blue-50 border-blue-200', 2: 'bg-amber-50 border-amber-200', 3: 'bg-rose-50 border-rose-200' }

// Numeric delay field that holds a local draft so clearing or mid-typing
// doesn't commit 0. Only valid non-negative numbers reach the config.
// value/onCommit are in display units (s or cycles).
function DelayInput({ value, disabled, onCommit, step, max }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])

  function handleChange(e) {
    const text = e.target.value
    setDraft(text)
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n) && n >= 0) onCommit(n)
  }

  return (
    <input
      type="number"
      min={0}
      max={max}
      step={step}
      value={draft}
      disabled={disabled}
      onChange={handleChange}
      onBlur={() => setDraft(String(value))}
      className="w-20 text-sm border border-amber-200 rounded px-2 py-0.5 bg-white"
    />
  )
}

// zones: the zones to show (activeZones — reverse zones only when pilot schemes are on)
// k0: optional K0Setting props (k0Props) — shown only with ground faults on
// shape: optional { value: 'mho' | 'quad', onChange } (shapeProps)
export default function RelayPanel({ relayId, zones, onUpdate, title, color, outOfService, k0, shape }) {
  const quad = shape?.value === 'quad'
  const units = useUnits()
  const shown = c => Math.round(units.cycToDisplay(c) * 100) / 100
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider" style={color ? { color } : undefined}>
        {title ?? `Relay ${relayId}`}
        {outOfService && <span className="ml-2 text-xs font-bold text-red-600 normal-case">out of service</span>}
      </h3>
      {shape && (
        <div className="flex items-center gap-2 text-xs text-gray-600 px-1">
          <span className="font-semibold w-20">Shape</span>
          <span className="flex rounded border border-gray-200 overflow-hidden text-sm">
            {[['mho', 'MHO'], ['quad', 'Quad']].map(([v, text]) => (
              <button key={v} onClick={() => shape.onChange(v)}
                className={`px-2 py-0.5 ${shape.value === v ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {text}
              </button>
            ))}
          </span>
        </div>
      )}
      {zones.map(zone => (
        <div
          key={zone.id}
          className={`rounded-lg border p-3 ${ZONE_BG[zone.id]} ${!zone.enabled ? 'opacity-50' : ''}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`font-semibold text-sm ${ZONE_COLORS[zone.id]}`}>
              Zone {zone.id}
              {isReverse(zone) ? ' — Reverse (scheme)'
                : zone.id === 1 ? ' — Instantaneous' : ` — ${units.fmtCyc(zone.delayCycles)} delay`}
            </span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={zone.enabled}
                onChange={e => onUpdate(relayId, zone.id, 'enabled', e.target.checked)}
                className="rounded"
              />
              <span className="text-xs text-gray-500">On</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-12">Reach</span>
            <input
              type="range"
              min={0}
              max={300}
              step={5}
              value={zone.reach}
              disabled={!zone.enabled}
              onChange={e => onUpdate(relayId, zone.id, 'reach', Number(e.target.value))}
              className="flex-1 h-2 accent-current"
            />
            <span className={`text-sm font-mono font-semibold w-12 text-right ${ZONE_COLORS[zone.id]}`}>
              {zone.reach}%
            </span>
          </div>
          {quad && (
            <div className="flex items-center gap-2 mt-1" title="Resistive reach: blinders at ± this much resistance, % of the line impedance">
              <span className="text-xs text-gray-500 w-12 whitespace-nowrap" title="Resistive reach">R reach</span>
              <input type="range" min={0} max={300} step={5} value={zone.rReach ?? zone.reach} disabled={!zone.enabled}
                onChange={e => onUpdate(relayId, zone.id, 'rReach', Number(e.target.value))}
                className="flex-1 h-2 accent-current" />
              <span className={`text-sm font-mono font-semibold w-12 text-right ${ZONE_COLORS[zone.id]}`}>
                {zone.rReach ?? zone.reach}%
              </span>
            </div>
          )}

          {zone.id !== 1 && !isReverse(zone) && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-500 w-12">Delay</span>
              <DelayInput
                value={shown(zone.delayCycles)}
                step={units.step}
                max={units.max}
                disabled={!zone.enabled}
                onCommit={v => onUpdate(relayId, zone.id, 'delayCycles', units.displayToCyc(v))}
              />
              <span className="text-xs text-gray-500">{units.label}</span>
            </div>
          )}
        </div>
      ))}
      {k0 && <K0Setting {...k0} />}
    </div>
  )
}
