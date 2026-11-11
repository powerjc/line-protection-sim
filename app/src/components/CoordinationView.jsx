import { useState } from 'react'
import { BASE_LINE } from '../lib/schema'
import { activeTap } from '../lib/network'
import { relayColor } from '../lib/colors'
import CoordinationDiagram from './CoordinationDiagram'
import TimingChart from './TimingChart'
import SimControls from './SimControls'
import EventLog, { OutcomeCard } from './EventLog'
import { FaultPicker, FaultSpecPicker, ScenarioPanel } from './ScenarioPanel'
import RelayPanel, { k0Props, shapeProps } from './RelayPanel'
import PhasorPanel from './PhasorPanel'
import ConsequencesCard from './ConsequencesCard'
import ChainView from './ChainView'
import QuickZones from './QuickZones'
import { SchemeSelect } from './ScenarioPanel'
import { activeZones } from '../lib/protection'

// config: the Coordination system (coordinationConfig) — base line only unless adjacent lines are unlocked
export default function CoordinationView({ config, coord, failuresHint = null, onUpdateZone, onUpdateLineLength, onUpdateLine, onUpdateRelay, onUpdateScheme }) {
  const { sim, state } = coord
  const [showSettings, setShowSettings] = useState(false)
  const relayIds = Object.keys(config.relays)
  // Reveal the verdict once the last event has played
  const revealed = coord.time >= sim.events[sim.events.length - 1].t - 1e-9
  const pilotOn = !!config.features?.pilot
  const pilotLines = pilotOn
    ? config.network.lines.filter(l => config.schemes[l.id] !== 'step').map(l => ({ ...l, scheme: config.schemes[l.id] }))
    : []

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col lg:flex-row gap-4 min-h-0">
        {/* Left: fault + scenario */}
        <aside className="lg:w-64 flex flex-col gap-6 bg-white rounded-xl border border-gray-200 p-4 shrink-0">
          <FaultPicker net={sim.net} faultLoc={coord.faultLoc} onChange={coord.setFaultLoc} tap={activeTap(sim.net, config)} />
          <FaultSpecPicker config={config} spec={coord.spec} onChange={coord.setSpec} />
          <hr className="border-gray-100" />
          <ScenarioPanel relayIds={relayIds} scenario={coord.scenario}
            onToggleOos={coord.toggleOos} onToggleBreakerFail={coord.toggleBreakerFail}
            pilotLines={pilotLines} onSetChannel={coord.setChannel}
            diffLine={!!config.features?.diff} onSetDiffChannel={coord.setDiffChannel}
            lessonHint={failuresHint}
            dcBuses={config.features?.consequences ? [...new Set(relayIds.map(id => config.relays[id].bus))] : []} onToggleDc={coord.toggleDc} />
          <hr className="border-gray-100" />
          <QuickZones config={config} onUpdateZone={onUpdateZone} />
        </aside>

        {/* Center: one-line + time-distance */}
        <main className="flex-1 bg-white rounded-xl border border-gray-200 p-4 min-w-0 flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-700">One-line &amp; zone coverage</h2>
            <span className="text-xs text-gray-400 hidden md:inline">
              Breakers: <span className="text-red-600 font-semibold">■ closed</span> · <span className="text-green-600 font-semibold">□ open</span> · orange = fault current
            </span>
          </div>
          <div className="overflow-x-auto">
            {/* Width capped so the diagram stays ≲ half the viewport height (leaves room
                for the timing chart); 640px floor keeps it legible on phones (scrolls sideways) */}
            <div className="min-w-[640px] mx-auto" style={{ maxWidth: 'max(640px, calc(50vh * 2.5))' }}>
              <CoordinationDiagram config={config} sim={sim} state={state} scenario={coord.scenario} faultLoc={coord.faultLoc} onPickFault={coord.setFaultLoc} />
            </div>
          </div>
          <hr className="border-gray-100" />
          <TimingChart config={config} sim={sim} time={coord.time} endT={coord.endT} onSetTime={coord.setTime}
            controls={<SimControls coord={coord} freqHz={config.timing.freqHz} />} />
        </main>

        {/* Right: outcome + event log */}
        <section className="lg:w-96 bg-white rounded-xl border border-gray-200 overflow-hidden shrink-0 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Sequence of events</h2>
            <p className="text-xs text-gray-400">Step through, or click an event to jump to it</p>
          </div>
          <OutcomeCard outcome={sim.outcome} revealed={revealed} />
          {config.features?.consequences && <ConsequencesCard config={config} sim={sim} loc={coord.faultLoc} time={coord.time} />}
          <div data-scroll-box className="relative overflow-y-auto max-h-[28rem]">
            <EventLog events={sim.events} eventIdx={coord.eventIdx} onSelect={coord.setTime} />
          </div>
        </section>
      </div>

      {config.features?.consequences && <ChainView config={config} sim={sim} state={state} coord={coord} />}

      {config.features?.sir && <PhasorPanel config={config} sim={sim} state={state} />}

      {/* Relay + line settings (shared with Fault Study) */}
      <section className="bg-white rounded-xl border border-gray-200">
        <button onClick={() => setShowSettings(s => !s)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700">
          <span>Relay &amp; line settings — all terminals</span>
          <span className="text-gray-400">{showSettings ? '▲' : '▼'}</span>
        </button>
        {showSettings && (
          <div className="px-4 pb-4 flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {config.network.lines.map(line => (
                <div key={line.id} className="flex flex-col gap-3 rounded-lg border border-gray-100 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-700 w-20">Line {line.from}–{line.to}</span>
                    {line.id === BASE_LINE ? (
                      <span className="text-xs text-gray-400">1.00 pu (base line)</span>
                    ) : (
                      <>
                        <input type="range" min={0.3} max={3} step={0.05} value={line.length}
                          onChange={e => onUpdateLineLength(line.id, Number(e.target.value))} className="flex-1 h-2" />
                        <span className="text-xs font-mono w-14 text-right">{line.length.toFixed(2)} pu</span>
                      </>
                    )}
                  </div>
                  {config.features?.ground && (
                    <label className="flex items-center justify-between gap-2 text-xs text-gray-500"
                      title="Zero-sequence impedance as a multiple of the positive-sequence impedance (same angle)">
                      <span>Z0 / Z1</span>
                      <input type="number" min={1} max={6} step={0.1} value={line.z0Ratio ?? 3}
                        onChange={e => {
                          const n = Number(e.target.value)
                          if (e.target.value !== '' && Number.isFinite(n) && n >= 1 && n <= 6) onUpdateLine(line.id, 'z0Ratio', n)
                        }}
                        className="w-16 text-sm border border-gray-200 rounded px-1.5 py-0.5" />
                    </label>
                  )}
                  {config.features?.ground && (
                    <label className="flex items-center justify-between gap-2 text-xs text-gray-500"
                      title="Zero-sequence impedance angle. Different from the line angle → k0 becomes complex">
                      <span>Z0 angle{line.z0AngleDeg != null && (
                        <button className="ml-2 text-indigo-500" onClick={e => { e.preventDefault(); onUpdateLine(line.id, 'z0AngleDeg', null) }}>
                          = line angle
                        </button>)}</span>
                      <span className="flex items-center gap-1">
                        <input type="number" min={45} max={90} step={1} value={line.z0AngleDeg ?? config.lineAngleDeg}
                          onChange={e => {
                            const n = Number(e.target.value)
                            if (e.target.value !== '' && Number.isFinite(n) && n >= 45 && n <= 90) onUpdateLine(line.id, 'z0AngleDeg', n)
                          }}
                          className="w-16 text-sm border border-gray-200 rounded px-1.5 py-0.5" />°
                      </span>
                    </label>
                  )}
                  {pilotOn && (
                    <label className="flex items-center justify-between gap-2 text-xs text-gray-500">
                      <span>Pilot scheme</span>
                      <SchemeSelect value={config.schemes[line.id]} onChange={v => onUpdateScheme(line.id, v)} />
                    </label>
                  )}
                  {relayIds.filter(id => config.relays[id].line === line.id).map(id => (
                    <RelayPanel key={id} relayId={id} zones={activeZones(config.relays[id], config)} onUpdate={onUpdateZone}
                      outOfService={coord.scenario.relayOos.includes(id)}
                      title={`21-${id} · at ${config.relays[id].bus}`} color={relayColor(id)}
                      k0={k0Props(config, id, onUpdateRelay)} shape={shapeProps(config, id, onUpdateRelay)} />
                  ))}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400">Reach is % of each relay's own line. 21-AB / 21-BA are the Relay A / Relay B of the Fault Study tab.</p>
          </div>
        )}
      </section>
    </div>
  )
}
