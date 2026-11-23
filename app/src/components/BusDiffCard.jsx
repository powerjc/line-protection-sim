import { abs, arg } from '../lib/complex'
import { busDiffElement, busCtId } from '../lib/busdiff'
import { instrumentFaults, baseAmps, withGains, CT_SAT_OPTIONS, satShare } from '../lib/instruments'

// Bus differential (87B): every current into the bus, from the 87B CTs on the
// line side of each breaker, and their sum. What goes in must come out.

const DEG = 180 / Math.PI
const amps = x => (x >= 1000 ? `${(x / 1000).toFixed(2)} kA` : `${x.toFixed(0)} A`)

export default function BusDiffCard({ config, state, scenario, zone, coord }) {
  const s = { pickupPu: 0.2, slopePct: 50, ...config.busdiff }
  const el = busDiffElement(state.meas, zone, withGains(instrumentFaults(config, scenario), state), s)
  const Ib = baseAmps()
  const lineOf = rid => { const r = config.relays[rid]; const l = config.network.lines.find(x => x.id === r.line); return `${l.from}–${l.to}` }
  const tripped = zone.feeders.some(id => state.tripped?.[id]?.logic === '87B')
  const ph = el.phases[0]

  return (
    <section id="chain-bus87" className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2 transition" aria-label="Bus differential">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Bus differential 87B — bus {zone.bus}: what goes in must come out</h2>
          <p className="text-xs text-gray-400">
            Currents into the bus from the 87B CTs on the line side of each breaker. For a fault outside the zone they cancel; for a bus fault they add up.
            Operates when |Σ I| &gt; {amps(s.pickupPu * Ib)} and &gt; {s.slopePct}% of Σ|I|.
          </p>
        </div>
        <span className={`text-xs font-bold rounded px-2 py-0.5 border ${tripped ? 'bg-red-100 text-red-800 border-red-300' : el.op ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
          {tripped ? 'TRIPPED' : el.op ? 'OPERATE' : 'restrain'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr className="text-gray-500 border-b border-gray-200">
              <th className="text-left font-semibold py-1 pr-2">87B CT</th>
              <th className="text-left font-semibold py-1 px-2">Ia into the bus <span className="font-normal text-gray-400">(as the relay sees it)</span></th>
              <th className="text-left font-semibold py-1 px-2">Polarity</th>
              <th className="text-left font-semibold py-1 px-2">Saturation</th>
            </tr>
          </thead>
          <tbody>
            {el.feeders.map(f => (
              <tr key={f.rid} className="border-b border-gray-50">
                <th scope="row" className="text-left font-semibold text-gray-600 py-1 pr-2 whitespace-nowrap">52-{f.rid} <span className="font-normal text-gray-400">(line {lineOf(f.rid)})</span></th>
                <td className="py-1 px-2 font-mono whitespace-nowrap">{amps(abs(f.I[0]) * Ib)} <span className="text-gray-400">∠{Math.round(arg(f.I[0]) * DEG)}°</span>
                  {satShare(state, busCtId(f.rid)) && <span className="ml-1 font-sans text-amber-700">saturated: {Math.round(satShare(state, busCtId(f.rid)).share * 100)}%</span>}</td>
                <td className="py-1 px-2">
                  <select value={scenario.ctReversed?.[busCtId(f.rid)] ?? ''} onChange={e => coord.setInstrument('ctReversed', busCtId(f.rid), e.target.value || null)}
                    className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white">
                    <option value="">Correct</option>
                    <option value="abc">Reversed</option>
                  </select>
                </td>
                <td className="py-1 px-2">
                  <select value={scenario.ctSat?.[busCtId(f.rid)] ?? ''} onChange={e => coord.setInstrument('ctSat', busCtId(f.rid), e.target.value || null)}
                    aria-label={`Saturation of the 87B CT on 52-${f.rid}`} className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white">
                    {CT_SAT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            <tr className="border-b border-gray-50">
              <th scope="row" className="text-left font-semibold text-gray-700 py-1 pr-2">Σ I (operate)</th>
              <td className={`py-1 px-2 font-mono font-semibold ${ph.operate ? 'text-red-700' : ''}`}>{amps(ph.Iop * Ib)}</td>
              <td></td><td></td>
            </tr>
            <tr>
              <th scope="row" className="text-left font-semibold text-gray-700 py-1 pr-2">Σ |I| (restraint)</th>
              <td className="py-1 px-2 font-mono">{amps(ph.Ires * Ib)} <span className="text-gray-400">· operate / restraint = {ph.Ires > 1e-9 ? Math.round((ph.Iop / ph.Ires) * 100) : 0}%</span></td>
              <td></td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
