import { useState } from 'react'
import { LEVELS, LEVEL_FEATURES, levelOf } from '../lib/levels'

function NumberSetting({ label, value, min, max, step, unit, onChange }) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="flex items-center gap-1">
        <input type="number" min={min} max={max} step={step} value={value}
          onChange={e => {
            const n = Number(e.target.value)
            if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n)
          }}
          className="w-16 text-sm border border-gray-200 rounded px-1.5 py-0.5" />
        <span className="text-xs text-gray-400 w-6">{unit}</span>
      </span>
    </label>
  )
}

// Source strength presets (SIR = Zs / Z of line A–B)
const SIR_PRESETS = [['Stiff', 0], ['Strong', 0.2], ['Medium', 1], ['Weak', 4], ['Very weak', 10]]

function SirSetting({ bus, value, note, onChange }) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-sm text-gray-600">Source {bus} <span className="text-xs text-gray-400">{note}</span></span>
      <span className="flex items-center gap-1">
        <select value={SIR_PRESETS.some(([, v]) => v === value) ? value : ''} onChange={e => e.target.value !== '' && onChange(Number(e.target.value))}
          className="text-xs border border-gray-200 rounded px-1 py-0.5">
          {SIR_PRESETS.map(([name, v]) => <option key={name} value={v}>{name}</option>)}
          {!SIR_PRESETS.some(([, v]) => v === value) && <option value="">Custom</option>}
        </select>
        <input type="number" min={0} max={30} step={0.1} value={value}
          onChange={e => {
            const n = Number(e.target.value)
            if (e.target.value !== '' && Number.isFinite(n) && n >= 0 && n <= 30) onChange(n)
          }}
          className="w-14 text-sm border border-gray-200 rounded px-1.5 py-0.5" />
      </span>
    </label>
  )
}

export default function SettingsPanel({ config, onLevel, onUpdateTap, onUpdate, onUpdateTiming, onUpdateFeature, onUpdatePilot, onUpdateSir, onUpdateInfeed, onUpdateBus, onReset, timeUnit, onTimeUnit }) {
  const sirOf = id => config.network.buses.find(b => b.id === id)?.sir ?? 0
  const [open, setOpen] = useState(false)
  const level = levelOf(config.features)
  // Individual toggles: collapsed under a level, open when the mix is custom (null = follow that)
  const [showFeaturesRaw, setShowFeatures] = useState(null)
  const showFeatures = showFeaturesRaw ?? level === 'custom'
  const featuresOn = LEVEL_FEATURES.filter(f => config.features?.[f]).length

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition"
        title="Settings"
      >
        ⚙
      </button>

      {open && (
        <div className="fixed inset-x-4 top-16 max-h-[80vh] overflow-y-auto sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-72 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-gray-800">Settings</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          </div>

          <div className="mb-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Learner level
            </div>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm" role="radiogroup" aria-label="Learner level">
              {LEVELS.map(l => (
                <button key={l.id} role="radio" aria-checked={level === l.id} onClick={() => onLevel(l.id)} title={l.blurb}
                  className={`flex-1 px-1.5 py-1 ${level === l.id ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {l.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {level === 'custom' ? 'Custom mix of features (set below).' : LEVELS.find(l => l.id === level).blurb}
            </p>
          </div>

          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">
              Line Impedance Angle
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={60}
                max={90}
                step={1}
                value={config.lineAngleDeg}
                onChange={e => onUpdate('lineAngleDeg', Number(e.target.value))}
                className="flex-1 min-w-0 w-full h-2"
              />
              <span className="text-sm font-mono w-10 text-right">{config.lineAngleDeg}°</span>
            </div>
          </div>

          <div className="mb-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Timing
            </div>
            <label className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-sm text-gray-600">System frequency</span>
              <select value={config.timing.freqHz} onChange={e => onUpdateTiming('freqHz', Number(e.target.value))}
                className="text-sm border border-gray-200 rounded px-1.5 py-0.5">
                <option value={60}>60 Hz</option>
                <option value={50}>50 Hz</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-sm text-gray-600">Show delays in</span>
              <span className="flex rounded border border-gray-200 overflow-hidden text-sm">
                {[['cyc', 'cycles'], ['s', 'seconds']].map(([u, text]) => (
                  <button key={u} onClick={() => onTimeUnit(u)}
                    className={`px-2 py-0.5 ${timeUnit === u ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {text}
                  </button>
                ))}
              </span>
            </label>
            <NumberSetting label="Relay operate time" value={config.timing.relayCycles} min={0.25} max={5} step={0.25} unit="cyc"
              onChange={v => onUpdateTiming('relayCycles', v)} />
            <NumberSetting label="Breaker interrupt time" value={config.timing.breakerCycles} min={1} max={10} step={0.5} unit="cyc"
              onChange={v => onUpdateTiming('breakerCycles', v)} />
            <NumberSetting label="Coordination interval (CTI)" value={config.timing.ctiCycles} min={1} max={60} step={1} unit="cyc"
              onChange={v => onUpdateTiming('ctiCycles', v)} />
          </div>

          <div className="mb-4">
            <button onClick={() => setShowFeatures(!showFeatures)} aria-expanded={showFeatures}
              className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 hover:text-gray-800">
              <span>Individual features <span className="normal-case font-normal text-gray-400">({featuresOn} on)</span></span>
              <span className="text-gray-400">{showFeatures ? '▲' : '▼'}</span>
            </button>
            {showFeatures && <>
            <div className="text-[11px] text-indigo-500 font-semibold mt-1">Intermediate</div>
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!config.features?.adjacent}
                onChange={e => onUpdateFeature('adjacent', e.target.checked)} />
              <span>
                <span className="text-sm text-gray-700 font-medium">Adjacent lines (X–A–B–Y)</span>
                <span className="block text-xs text-gray-400">Coordination tab: add a line beyond each station for Zone 2 coordination and remote backup</span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!config.features?.pilot}
                onChange={e => onUpdateFeature('pilot', e.target.checked)} />
              <span>
                <span className="text-sm text-gray-700 font-medium">Zone 3 reverse + pilot schemes</span>
                <span className="block text-xs text-gray-400">DCB, POTT, DCUB per line, with channel failure scenarios</span>
              </span>
            </label>
            {config.features?.pilot && (
              <div className="mt-1 pl-6">
                <NumberSetting label="Channel delay" value={config.pilot.channelCycles} min={0} max={10} step={0.25} unit="cyc"
                  onChange={v => onUpdatePilot('channelCycles', v)} />
                <NumberSetting label="DCB coordination timer" value={config.pilot.dcbCoordCycles} min={0} max={10} step={0.25} unit="cyc"
                  onChange={v => onUpdatePilot('dcbCoordCycles', v)} />
                <NumberSetting label="DCUB unblock window" value={config.pilot.unblockCycles} min={0.5} max={30} step={0.5} unit="cyc"
                  onChange={v => onUpdatePilot('unblockCycles', v)} />
              </div>
            )}
            <div className="text-[11px] text-indigo-500 font-semibold mt-1">Advanced</div>
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!config.features?.sir}
                onChange={e => onUpdateFeature('sir', e.target.checked)} />
              <span>
                <span className="text-sm text-gray-700 font-medium">Source impedance &amp; phasors</span>
                <span className="block text-xs text-gray-400">Source strength behind each bus, SIR = Zs / Z of line A–B. Shows V and I phasors at each relay on the Coordination tab</span>
              </span>
            </label>
            {config.features?.sir && (
              <div className="mt-1 pl-6">
                {/* Single-line Coordination uses A/B as sources; the full chain and the Fault Study use X/Y */}
                {(config.features?.adjacent ? [['X', ''], ['Y', '']]
                  : [['A', ''], ['B', ''], ['X', 'Fault Study'], ['Y', 'Fault Study']]).map(([id, note]) => (
                  <SirSetting key={id} bus={id} note={note} value={sirOf(id)} onChange={v => onUpdateSir(id, v)} />
                ))}
              </div>
            )}
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!config.features?.ground}
                onChange={e => onUpdateFeature('ground', e.target.checked)} />
              <span>
                <span className="text-sm text-gray-700 font-medium">Ground faults (A–G)</span>
                <span className="block text-xs text-gray-400">Fault type selector, line Z0/Z1, ground elements with k0 residual compensation</span>
              </span>
            </label>
            {config.features?.ground && (
              <div className="mt-1 pl-6">
                <div className="text-xs text-gray-500 mb-0.5" title="Zero-sequence source impedance as a multiple of the positive-sequence source impedance. Only matters when the source has impedance (SIR > 0).">
                  Source Z0 / Z1 <span className="text-gray-400">(with SIR &gt; 0)</span>
                </div>
                {config.network.buses.map(b => (
                  <NumberSetting key={b.id} label={`Source ${b.id}`} value={b.z0Ratio ?? 1} min={0.1} max={10} step={0.1} unit=""
                    onChange={v => onUpdateBus(b.id, 'z0Ratio', v)} />
                ))}
              </div>
            )}
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!config.features?.rf}
                onChange={e => onUpdateFeature('rf', e.target.checked)} />
              <span>
                <span className="text-sm text-gray-700 font-medium">Fault resistance</span>
                <span className="block text-xs text-gray-400">Rf slider beside the fault location — resistive faults move off the line angle</span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!config.features?.load}
                onChange={e => onUpdateFeature('load', e.target.checked)} />
              <span>
                <span className="text-sm text-gray-700 font-medium">Prefault load</span>
                <span className="block text-xs text-gray-400">Power flows left → right before the fault (source angle spread δ). Load current, load point on the R-X plane, load + Rf tilt</span>
              </span>
            </label>
            {config.features?.load && (
              <label className="flex items-center gap-2 mt-1 pl-6">
                <span className="text-xs text-gray-500 w-6">δ</span>
                <input type="range" min={0} max={60} step={5} value={config.loadAngleDeg ?? 20}
                  onChange={e => onUpdate('loadAngleDeg', Number(e.target.value))} className="flex-1 min-w-0 w-full h-2" />
                <span className="text-sm font-mono w-10 text-right">{config.loadAngleDeg ?? 20}°</span>
              </label>
            )}
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!config.features?.infeed}
                onChange={e => onUpdateFeature('infeed', e.target.checked)} />
              <span>
                <span className="text-sm text-gray-700 font-medium">Infeed sources</span>
                <span className="block text-xs text-gray-400">Sources at the intermediate buses A and B (with adjacent lines, and in the Fault Study): remote infeed makes distance relays underreach</span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!config.features?.tap}
                onChange={e => onUpdateFeature('tap', e.target.checked)} />
              <span>
                <span className="text-sm text-gray-700 font-medium">Line tap (A–B)</span>
                <span className="block text-xs text-gray-400">An unprotected load tap part-way along A–B: tap section, tap transformer, load. Tap-section faults underreach; the tap load is invisible to 87L</span>
              </span>
            </label>
            {config.features?.tap && (() => {
              const ab = config.network.lines.find(l => l.id === 'AB')
              return (
                <div className="mt-1 pl-6 flex flex-col gap-1">
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-[4.5rem] shrink-0">Tap at</span>
                    <input type="range" min={0.15} max={0.85} step={0.05} value={ab.tap.at}
                      onChange={e => onUpdateTap('at', Number(e.target.value))} className="flex-1 min-w-0 w-full h-2" aria-label="Tap position" />
                    <span className="text-sm font-mono w-10 shrink-0 text-right">{Math.round(ab.tap.at * 100)}%</span>
                  </label>
                  <label className="flex items-center gap-2" title="Tap section length = its impedance, in pu of line A–B (same impedance per unit length as the line)">
                    <span className="text-xs text-gray-500 w-[4.5rem] shrink-0">Tap section</span>
                    <input type="range" min={0.05} max={1} step={0.05} value={ab.tap.lead}
                      onChange={e => onUpdateTap('lead', Number(e.target.value))} className="flex-1 min-w-0 w-full h-2" aria-label="Tap section length" />
                    <span className="text-sm font-mono w-10 shrink-0 text-right">{ab.tap.lead.toFixed(2)}</span>
                  </label>
                  <p className="text-xs text-gray-400">Position along A–B; tap section in pu of line A–B.</p>
                </div>
              )
            })()}
            {config.features?.infeed && (
              <div className="mt-1 pl-6">
                {['A', 'B'].map(id => {
                  const bus = config.network.buses.find(b => b.id === id)
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <input type="checkbox" checked={!!bus?.infeed} onChange={e => onUpdateInfeed(id, e.target.checked)}
                        aria-label={`Infeed source at bus ${id}`} />
                      <div className={`flex-1 ${bus?.infeed ? '' : 'opacity-40 pointer-events-none'}`}>
                        <SirSetting bus={id} value={sirOf(id)} onChange={v => onUpdateSir(id, v)} />
                      </div>
                    </div>
                  )
                })}
                {!config.features?.adjacent && <p className="text-xs text-gray-400">Coordination needs Adjacent lines on to show infeed; the Fault Study always uses the full network.</p>}
              </div>
            )}
            </>}
          </div>

          <div className="mb-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Modules
            </div>
            <p className="text-xs text-gray-400 mb-1">Separate from the learner level, combine with any of them.</p>
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!config.features?.consequences}
                onChange={e => onUpdateFeature('consequences', e.target.checked)} />
              <span>
                <span className="text-sm text-gray-700 font-medium">Consequences &amp; protection chain</span>
                <span className="block text-xs text-gray-400">Coordination tab: what the clearing time cost (critical clearing time, fault duty, arc energy, outage) and the chain of links each terminal depends on, with failures to inject</span>
              </span>
            </label>
            {config.features?.consequences && (
              <div className="mt-1 pl-6">
                <NumberSetting label="Critical clearing time" value={config.consequences?.cctCycles ?? 12} min={3} max={60} step={1} unit="cyc"
                  onChange={v => onUpdate('consequences', { ...config.consequences, cctCycles: v })} />
                <p className="text-xs text-gray-400">Illustrative. A real CCT comes from a stability study of the actual system: a few cycles near large generators on EHV, much longer on remote systems.</p>
              </div>
            )}
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!config.features?.diff}
                onChange={e => onUpdateFeature('diff', e.target.checked)} />
              <span>
                <span className="text-sm text-gray-700 font-medium">Current differential (87L)</span>
                <span className="block text-xs text-gray-400">Adds a Differential tab: line A–B percentage differential, charging current, CT error</span>
              </span>
            </label>
          </div>

          <button
            onClick={() => { onReset(); setOpen(false) }}
            className="w-full text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg py-1.5 hover:bg-gray-50 transition"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  )
}
