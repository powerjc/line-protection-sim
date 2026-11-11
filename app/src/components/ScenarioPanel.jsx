import { useState, useEffect } from 'react'
import { FAULTS } from '../lib/faults'
import { relayColor } from '../lib/colors'
import { SCHEMES } from '../lib/schema'

const SCHEME_LABEL = { step: 'Step distance', DCB: 'DCB', POTT: 'POTT', DCUB: 'DCUB' }

export function SchemeSelect({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="text-sm border border-gray-300 rounded-lg px-2 py-1 bg-white">
      {SCHEMES.map(s => <option key={s} value={s}>{SCHEME_LABEL[s]}</option>)}
    </select>
  )
}

export function ChannelSelect({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="text-xs border border-gray-300 rounded px-1.5 py-0.5 bg-white">
      <option value="ok">In service</option>
      <option value="out">Out of service</option>
      <option value="lost">Lost at fault</option>
    </select>
  )
}

// Fault type (A–G with the ground-faults feature) and fault resistance (with
// the Rf feature). Renders nothing while both features are off.
export function FaultSpecPicker({ config, spec, onChange }) {
  const ground = !!config.features?.ground, rf = !!config.features?.rf
  if (!ground && !rf) return null
  return (
    <div className="flex flex-col gap-2">
      {ground && (
        <div className="flex rounded border border-gray-200 overflow-hidden text-sm w-fit">
          {[['3PH', '3Ø'], ['AG', 'A–G']].map(([t, text]) => (
            <button key={t} onClick={() => onChange({ ...spec, type: t })}
              className={`px-3 py-0.5 ${spec.type === t ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {text}
            </button>
          ))}
        </div>
      )}
      {rf && (
        <label className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-6">Rf</span>
          <input type="range" min={0} max={2} step={0.05} value={spec.rf}
            onChange={e => onChange({ ...spec, rf: Number(e.target.value) })} className="flex-1 h-2" />
          <span className="text-sm font-mono w-16 text-right">{spec.rf.toFixed(2)} pu</span>
        </label>
      )}
    </div>
  )
}

// tap: activeTap() result when the line-tap feature is on (adds tap fault locations)
export function FaultPicker({ net, faultLoc, onChange, tap = null }) {
  const value = faultLoc.kind === 'bus' ? `bus:${faultLoc.bus}` : faultLoc.kind === 'tap' ? 'tap:T' : faultLoc.kind === 'tapLV' ? 'tapLV:T' : `line:${faultLoc.line}`

  function handleSelect(v) {
    const [kind, id] = v.split(':')
    if (kind === 'bus') onChange({ kind: 'bus', bus: id })
    else if (kind === 'tap') onChange({ kind: 'tap', frac: 1 })
    else if (kind === 'tapLV') onChange({ kind: 'tapLV' })
    else onChange({ kind: 'line', line: id, frac: faultLoc.kind === 'line' ? faultLoc.frac : 0.5 })
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Fault location</h3>
      <select value={value} onChange={e => handleSelect(e.target.value)}
        className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white">
        <optgroup label="Lines">
          {net.lineOrder.map(id => <option key={id} value={`line:${id}`}>Line {net.lines[id].from}–{net.lines[id].to}</option>)}
        </optgroup>
        <optgroup label="Buses">
          {net.busOrder.map(id => <option key={id} value={`bus:${id}`}>Bus {id}</option>)}
        </optgroup>
        {tap && (
          <optgroup label={`Tap T (line ${net.lines[tap.line].from}–${net.lines[tap.line].to})`}>
            <option value="tap:T">Tap section</option>
            <option value="tapLV:T">Tap low-voltage bus</option>
          </optgroup>
        )}
      </select>
      {faultLoc.kind === 'tap' && (
        <div className="flex items-center gap-2">
          <input type="range" min={0} max={100} step={5} value={Math.round(faultLoc.frac * 100)}
            onChange={e => onChange({ ...faultLoc, frac: Number(e.target.value) / 100 })}
            className="flex-1 h-2" aria-label="Position on the tap section" />
          <span className="text-sm font-mono w-24 text-right">{Math.round(faultLoc.frac * 100)}% from T</span>
        </div>
      )}
      {faultLoc.kind === 'line' && (
        <div className="flex items-center gap-2">
          <input type="range" min={1} max={99} step={1} value={Math.round(faultLoc.frac * 100)}
            onChange={e => onChange({ ...faultLoc, frac: Number(e.target.value) / 100 })}
            className="flex-1 h-2" />
          <span className="text-sm font-mono w-24 text-right">{Math.round(faultLoc.frac * 100)}% from {net.lines[faultLoc.line].from}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1">
        {FAULTS.filter(f => (f.loc.kind === 'bus' ? f.loc.bus in net.buses : f.loc.line in net.lines)).map(f => {
          const active = f.loc.kind === faultLoc.kind && (f.loc.kind === 'bus'
            ? f.loc.bus === faultLoc.bus
            : f.loc.line === faultLoc.line && Math.abs(f.loc.frac - faultLoc.frac) < 1e-9)
          return (
            <button key={f.id} onClick={() => onChange(f.loc)} title={f.description}
              className={`text-xs px-2 py-1 rounded border text-left leading-tight ${active
                ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 text-gray-600 hover:border-gray-500'}`}>
              <span className={active ? 'text-gray-300' : 'text-gray-400'}>{f.id}</span> {f.label}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-gray-400">Or click a line or bus on the one-line.</p>
    </div>
  )
}

// Failure scenarios, collapsed by default so basic runs stay uncluttered.
// Opens itself while any failure is active so it's never hidden in effect.
// diffLine: show the 87L channel (A–B) when the differential feature is on
// dcBuses: stations offered a "DC supply lost" failure (consequences module)
// lessonHint: id of an open lesson whose "try this" uses Failures → open + outline
export function ScenarioPanel({ relayIds, scenario, onToggleOos, onToggleBreakerFail, pilotLines = [], onSetChannel, diffLine = false, onSetDiffChannel, dcBuses = [], onToggleDc, lessonHint = null }) {
  const active = scenario.relayOos.filter(id => relayIds.includes(id)).length
    + scenario.breakerFail.filter(id => relayIds.includes(id)).length
    + pilotLines.filter(l => (scenario.channels?.[l.id] ?? 'ok') !== 'ok').length
    + (diffLine && scenario.diffChannel === 'out' ? 1 : 0)
    + dcBuses.filter(b => scenario.dcLost?.includes(b)).length
    + (scenario.tripOpen ?? []).filter(id => relayIds.includes(id)).length
  const [openRaw, setOpen] = useState(!!lessonHint)
  // Each lesson that points here opens the panel once; it can still be collapsed
  useEffect(() => { if (lessonHint) setOpen(true) }, [lessonHint])
  const open = openRaw || active > 0
  return (
    <div className={`flex flex-col gap-2 ${lessonHint ? 'rounded-lg ring-2 ring-indigo-300 bg-indigo-50/40 p-2 -m-2' : ''}`}
      title={lessonHint ? 'The lesson’s “Try this” uses these controls' : undefined}>
      <button onClick={() => setOpen(o => !o)} disabled={active > 0}
        className="flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wider">
        <span>Failures{active > 0 && <span className="ml-2 normal-case text-xs font-bold text-red-600">{active} active</span>}</span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {!open && <p className="text-xs text-gray-400">Relay out of service, stuck breaker{pilotLines.length || diffLine ? ', channel failure' : ''}{dcBuses.length ? ', station DC lost' : ''}</p>}
      {open && <>
      <table className="text-xs">
        <thead>
          <tr className="text-gray-400">
            <th className="text-left font-medium pb-1">Terminal</th>
            <th className="font-medium pb-1">Relay in service</th>
            <th className="font-medium pb-1">Breaker fails</th>
          </tr>
        </thead>
        <tbody>
          {relayIds.map(id => (
            <tr key={id}>
              <td className="py-0.5 font-semibold" style={{ color: relayColor(id) }}>{id}</td>
              <td className="text-center">
                <input type="checkbox" checked={!scenario.relayOos.includes(id)} onChange={() => onToggleOos(id)} />
              </td>
              <td className="text-center">
                <input type="checkbox" checked={scenario.breakerFail.includes(id)} onChange={() => onToggleBreakerFail(id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(scenario.tripOpen ?? []).some(id => relayIds.includes(id)) && (
        <p className="text-xs text-red-700">Trip circuit open: {scenario.tripOpen.filter(id => relayIds.includes(id)).map(id => `52-${id}`).join(', ')} <span className="text-gray-400">(set in Protection chain)</span></p>
      )}
      {dcBuses.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-xs text-gray-400 font-medium" title="Station battery / DC supply: relays and breaker trip circuits at that station run on it">Station DC supply</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {dcBuses.map(b => (
              <label key={b} className="flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" checked={!scenario.dcLost?.includes(b)} onChange={() => onToggleDc(b)} aria-label={`Station ${b} DC supply in service`} />
                <span><b>{b}</b></span>
              </label>
            ))}
          </div>
        </div>
      )}
      {diffLine && (
        <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
          <span>87L channel A–B</span>
          <select value={scenario.diffChannel ?? 'ok'} onChange={e => onSetDiffChannel(e.target.value)}
            className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white">
            <option value="ok">In service</option>
            <option value="out">Out of service</option>
          </select>
        </label>
      )}
      {pilotLines.length > 0 && (
        <div className="flex flex-col gap-1 mt-2">
          <span className="text-xs text-gray-400 font-medium">Pilot channels</span>
          {pilotLines.map(l => (
            <label key={l.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-gray-600"><b>{l.from}–{l.to}</b> {l.scheme}</span>
              <ChannelSelect value={scenario.channels?.[l.id] ?? 'ok'} onChange={v => onSetChannel(l.id, v)} />
            </label>
          ))}
        </div>
      )}
      </>}
    </div>
  )
}
