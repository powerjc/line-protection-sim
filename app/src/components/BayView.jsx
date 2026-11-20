import { activeTap } from '../lib/network'
import { relayColor } from '../lib/colors'
import BayDiagram from './BayDiagram'
import RelayView from './RelayView'
import Oscillography from './Oscillography'
import BusDiffCard from './BusDiffCard'
import { busZone } from '../lib/busdiff'
import BusDiagram from './BusDiagram'
import ChainView from './ChainView'
import SimControls from './SimControls'
import EventLog, { OutcomeCard } from './EventLog'
import { FaultPicker, FaultSpecPicker } from './ScenarioPanel'

// Bay tab (Foundations module): one terminal of the same run the
// Coordination tab shows for the whole system — same fault, scenario and
// playback. config: the Coordination system (coordinationConfig).
export default function BayView({ config, coord, rid: ridRaw, onRid }) {
  const { sim, state } = coord
  const relayIds = Object.keys(config.relays)
  // With bus differential, the bus itself is a "terminal" too: 'bus:B'
  const zone = busZone(sim.net, config)
  const busId = zone ? `bus:${zone.bus}` : null
  const busMode = !!busId && ridRaw === busId
  const rid = busMode ? zone.feeders[0] : relayIds.includes(ridRaw) ? ridRaw : relayIds[0]
  const remote = busMode ? null : relayIds.find(id => id !== rid && config.relays[id].line === config.relays[rid].line)
  const revealed = coord.time >= sim.events[sim.events.length - 1].t - 1e-9
  // This terminal's events, its remote end's, and the system-wide ones (fault, cleared)
  const mine = sim.events.map((e, i) => [e, i]).filter(([e]) => !e.rid || (busMode ? zone.feeders.includes(e.rid) : e.rid === rid || e.rid === remote))
  const myIdx = mine.reduce((k, [, i], n) => (i <= coord.eventIdx ? n : k), -1)

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col lg:flex-row gap-4 min-h-0">
        <aside className="lg:w-64 flex flex-col gap-5 bg-white rounded-xl border border-gray-200 p-4 shrink-0">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Terminal</div>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Terminal">
              {relayIds.map(id => (
                <button key={id} role="radio" aria-checked={!busMode && id === rid} onClick={() => onRid(id)}
                  className={`px-2 py-0.5 rounded text-xs font-bold border ${!busMode && id === rid ? 'text-white' : 'bg-white'}`}
                  style={!busMode && id === rid ? { background: relayColor(id), borderColor: relayColor(id) } : { color: relayColor(id), borderColor: '#e5e7eb' }}>
                  {id}
                </button>
              ))}
              {busId && (
                <button role="radio" aria-checked={busMode} onClick={() => onRid(busId)}
                  className={`px-2 py-0.5 rounded text-xs font-bold border ${busMode ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-violet-600 border-gray-200'}`}>
                  Bus {zone.bus} (87B)
                </button>
              )}
            </div>
          </div>
          <FaultPicker net={sim.net} faultLoc={coord.faultLoc} onChange={coord.setFaultLoc} tap={activeTap(sim.net, config)} allowNone />
          <FaultSpecPicker config={config} spec={coord.spec} onChange={coord.setSpec} />
          <p className="text-xs text-gray-400">Same fault and playback as the Coordination tab. Break a link in the chain below (or click a device on the drawing) and replay.</p>
        </aside>

        <main className="flex-1 bg-white rounded-xl border border-gray-200 p-4 min-w-0 flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-700">{busMode ? `Bus ${zone.bus} — every feeder and its CTs` : `Bay one-line — 52-${rid}`}</h2>
            <span className="text-xs text-gray-400 hidden md:inline">
              <span className="text-red-600 font-semibold">■ closed</span> · <span className="text-green-600 font-semibold">□ open</span> · orange = fault current · ≠ relay’s picture is wrong
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[560px] mx-auto" style={{ maxWidth: 'max(560px, calc(55vh * 2.4))' }}>
              {busMode
                ? <BusDiagram config={config} sim={sim} state={state} scenario={coord.scenario} zone={zone} faultLoc={coord.faultLoc} />
                : <BayDiagram config={config} sim={sim} state={state} scenario={coord.scenario} faultLoc={coord.faultLoc} rid={rid} />}
            </div>
          </div>
          <SimControls coord={coord} freqHz={config.timing.freqHz} />
        </main>

        <section className="lg:w-96 bg-white rounded-xl border border-gray-200 overflow-hidden shrink-0 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">{busMode ? `Events at bus ${zone.bus}` : 'Events at this terminal'}</h2>
            <p className="text-xs text-gray-400">{busMode ? zone.feeders.map(f => `52-${f}`).join(', ') : `21-${rid}${remote ? ` and its remote end 21-${remote}` : ''}`}; click an event to jump to it</p>
          </div>
          <OutcomeCard outcome={sim.outcome} revealed={revealed} />
          <div data-scroll-box className="relative overflow-y-auto max-h-[24rem]">
            <EventLog events={mine.map(([e]) => e)} eventIdx={myIdx} onSelect={coord.setTime} />
          </div>
        </section>
      </div>

      {!busMode && <RelayView config={config} state={state} scenario={coord.scenario} rid={rid} />}
      {zone && (busMode || zone.feeders.includes(rid)) && <BusDiffCard config={config} state={state} scenario={coord.scenario} zone={zone} coord={coord} />}
      <Oscillography config={config} sim={sim} state={state} scenario={coord.scenario} rid={rid} bus={busMode} time={coord.time} onSetTime={coord.setTime} />
      {!busMode && <ChainView config={config} sim={sim} state={state} coord={coord} rid={rid} onRid={onRid} title={`Protection chain — 52-${rid}`} />}
    </div>
  )
}
