import { activeTap } from '../lib/network'
import { busZone, BUS_DIFF_BUS } from '../lib/busdiff'
import { busDiffBlocker } from '../lib/features'
import StationDiagram from './StationDiagram'
import BusDiffCard from './BusDiffCard'
import Oscillography from './Oscillography'
import OffStrip from './OffStrip'
import SimControls from './SimControls'
import EventLog, { OutcomeCard } from './EventLog'
import { FaultPicker, FaultSpecPicker } from './ScenarioPanel'

// Station tab: one substation of the same run the Coordination tab shows for
// the whole system — its bus, every feeder bay (CTs, breaker, relay), the
// station battery, and bus differential (87B) where it covers this bus.
// config: the Coordination system (coordinationConfig).
export default function StationView({ config, coord, station: stationRaw, onStation, onEnableBus }) {
  const { sim, state } = coord
  const stations = sim.net.busOrder
  const bus = stations.includes(stationRaw) ? stationRaw : stations[0]
  const z = busZone(sim.net, config)
  const zone = z && z.bus === bus ? z : null
  const feeders = Object.keys(config.relays).filter(id => config.relays[id].bus === bus)
  const revealed = coord.time >= sim.events[sim.events.length - 1].t - 1e-9
  const mine = sim.events.map((e, i) => [e, i]).filter(([e]) => !e.rid || feeders.includes(e.rid))
  const myIdx = mine.reduce((k, [, i], n) => (i <= coord.eventIdx ? n : k), -1)
  const blocker = config.features?.busdiff ? busDiffBlocker(config) : null

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col lg:flex-row gap-4 min-h-0">
        <aside className="lg:w-64 flex flex-col gap-5 bg-white rounded-xl border border-gray-200 p-4 shrink-0">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Station</div>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Station">
              {stations.map(id => (
                <button key={id} role="radio" aria-checked={id === bus} onClick={() => onStation(id)}
                  className={`px-2.5 py-0.5 rounded text-xs font-bold border ${id === bus ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-700 border-gray-300'}`}>
                  {id}
                </button>
              ))}
            </div>
          </div>
          <FaultPicker net={sim.net} faultLoc={coord.faultLoc} onChange={coord.setFaultLoc} tap={activeTap(sim.net, config)} allowNone />
          <FaultSpecPicker config={config} spec={coord.spec} onChange={coord.setSpec} />
          <p className="text-xs text-gray-400">Same fault and playback as the Coordination tab. Click the station battery to fail it; the Bay tab shows one terminal in detail.</p>
        </aside>

        <main className="flex-1 bg-white rounded-xl border border-gray-200 p-4 min-w-0 flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-700">Station {bus} — every bay and its CTs</h2>
            <span className="text-xs text-gray-400 hidden md:inline">
              <span className="text-red-600 font-semibold">■ closed</span> · <span className="text-green-600 font-semibold">□ open</span> · orange = fault current
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[560px] mx-auto" style={{ maxWidth: 'max(560px, calc(55vh * 2.4))' }}>
              <StationDiagram config={config} sim={sim} state={state} scenario={coord.scenario} bus={bus} faultLoc={coord.faultLoc} onToggleDc={coord.toggleDc} />
            </div>
          </div>
          <SimControls coord={coord} freqHz={config.timing.freqHz} />
        </main>

        <section className="lg:w-96 bg-white rounded-xl border border-gray-200 overflow-hidden shrink-0 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Events at station {bus}</h2>
            <p className="text-xs text-gray-400">{feeders.map(f => `52-${f}`).join(', ')}; click an event to jump to it</p>
          </div>
          <OutcomeCard outcome={sim.outcome} revealed={revealed} />
          <div data-scroll-box className="relative overflow-y-auto max-h-[24rem]">
            <EventLog events={mine.map(([e]) => e)} eventIdx={myIdx} onSelect={coord.setTime} />
          </div>
        </section>
      </div>

      {zone ? <BusDiffCard config={config} state={state} scenario={coord.scenario} zone={zone} coord={coord} />
        : bus === BUS_DIFF_BUS && (
          <OffStrip title="Bus differential (87B)"
            what="A differential zone around this bus: every feeder’s current in, and what must come out."
            needs={blocker === 'infeedB' ? 'bus B’s infeed off' : blocker === 'adjacent' ? 'Adjacent lines (bus B needs two feeders)'
              : `the 87B module${config.features?.adjacent ? '' : ' and Adjacent lines (bus B needs two feeders)'}`}
            onEnable={onEnableBus} enableLabel="Turn on bus differential" />
        )}
      <Oscillography config={config} sim={sim} state={state} scenario={coord.scenario} rid={feeders[0]} station={bus} time={coord.time} onSetTime={coord.setTime} />
    </div>
  )
}
