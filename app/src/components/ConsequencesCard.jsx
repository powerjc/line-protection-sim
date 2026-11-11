import { costsAt, outageExtent } from '../lib/consequences'
import { ms } from '../lib/timeline'

const ratio = r => (r === null ? '—' : `×${r < 10 ? r.toFixed(1) : Math.round(r)}`)
const cyc = (t, f) => `${(t * f).toFixed(1)} cyc`
const CCT_TIP = 'A real critical clearing time comes from a transient-stability study of the actual system: from a few cycles near large generators on EHV to much longer on remote systems. 12 cycles is an illustrative default.'

// One horizontal meter: green up to the reference tick, red past it
function Meter({ value, max, mark, markLabel }) {
  const pct = v => `${Math.min(100, Math.max(0, (v / max) * 100))}%`
  return (
    <div className="mt-1 mb-1">
      <div className="relative h-2.5 rounded bg-gray-100 overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: pct(Math.min(value, mark)) }} />
        {value > mark && <div className="absolute inset-y-0 bg-red-500" style={{ left: pct(mark), width: pct(value - mark) }} />}
        <div className="absolute inset-y-0 w-px bg-gray-800" style={{ left: pct(mark) }} />
      </div>
      <div className="relative h-3.5">
        {/* Centred under the tick, or right-aligned to it near the end so it stays in the card */}
        <span className={`absolute text-[10px] leading-3 text-gray-500 whitespace-nowrap ${mark / max > 0.7 ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: pct(mark) }}>{markLabel}</span>
      </div>
    </div>
  )
}

// What the clearing time cost — fills in as the run plays.
// config/sim/loc: the Coordination run; time: playback time
export default function ConsequencesCard({ config, sim, loc, time }) {
  const f = config.timing.freqHz
  const c = costsAt(sim, config, time)
  const final = costsAt(sim, config)
  const out = c.done ? outageExtent(sim, config, loc) : null
  // Uncleared runs stop at their last event; past it the fault is simply still on
  const stillOn = c.uncleared && time >= sim.events[sim.events.length - 1].t
  const lineName = id => `${sim.net.lines[id].from}–${sim.net.lines[id].to}`

  // Scales fixed for the whole run so the bars grow rather than rescale
  const tMax = Math.max(final.elapsed, final.cct) * 1.15 || final.cct * 1.15
  const rMax = Math.max(final.duty ?? 1, final.arc ?? 1, 2) * 1.1

  return (
    <div className="px-4 py-3 border-b border-gray-100" aria-label="Consequences">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Consequences</h3>
        <span className="text-[10px] text-gray-400">relative · illustrative values</span>
      </div>

      <div className="mt-2 text-xs text-gray-700 flex justify-between">
        <span title={CCT_TIP}>Fault on the system <span className="text-gray-400">vs critical clearing time</span></span>
        <span className="font-mono">{stillOn ? <span className="text-red-700">not cleared</span> : <>{ms(c.elapsed)} <span className="text-gray-400">({cyc(c.elapsed, f)})</span></>}</span>
      </div>
      <Meter value={stillOn ? tMax : c.elapsed} max={tMax} mark={c.cct} markLabel={`CCT ${config.consequences?.cctCycles ?? 12} cyc (illustrative)`} />

      <div className="mt-1 text-xs text-gray-700 flex justify-between">
        <span title="∫I²dt at the fault: heating of conductors and equipment carrying fault current">Fault duty (I²t)</span>
        <span className="font-mono">{ratio(c.duty)} <span className="text-gray-400">a fast clear</span></span>
      </div>
      {c.duty !== null && <Meter value={c.duty} max={rMax} mark={1} markLabel="fast clear" />}

      <div className="mt-1 text-xs text-gray-700 flex justify-between">
        <span title="∫I dt at the fault (arc voltage roughly constant): burn damage and hazard to people nearby">Arc energy</span>
        <span className="font-mono">{ratio(c.arc)} <span className="text-gray-400">a fast clear</span></span>
      </div>
      {c.arc !== null && <Meter value={c.arc} max={rMax} mark={1} markLabel="fast clear" />}

      {c.duty === null && (
        <p className="text-[11px] text-gray-400">Bolted fault at a stiff source: the model's current is unbounded, so duty and arc energy aren't shown.</p>
      )}

      <p className="text-xs text-gray-600 mt-1">
        {c.done ? (
          c.beyondCct
            ? <><span className="font-semibold text-red-700">Beyond the critical clearing time.</span> Generators near this line could lose synchronism. Planners get the real limit from a stability study; it's why EHV lines are built to clear in 3–5 cycles.
                {c.duty !== null && c.duty < 1.2 && ' The slow end carried little current, so the cost here is time, not heating: the arc stayed lit and the system was disturbed for longer.'}</>
            : <><span className="font-semibold text-emerald-700">Inside the critical clearing time.</span> The system rides through.</>
        ) : stillOn
          ? <span className="font-semibold text-red-700">Fault not cleared: the cost keeps growing.</span>
          : 'A fast clear is relay + breaker time at both ends (Zone 1, no intentional delay).'}
      </p>

      {out && (
        <p className="text-xs text-gray-600 mt-1">
          {out.extraLines.length || out.extraBuses.length ? (
            <>
              <span className="font-semibold text-red-700">Also lost:</span>{' '}
              {[...out.extraLines.map(l => `line ${lineName(l)}`), ...out.extraBuses.map(b => `bus ${b} (no supply)`)].join(', ')}
            </>
          ) : (
            <><span className="font-semibold text-emerald-700">Outage:</span> only the faulted {loc.kind === 'tapLV' ? 'tap transformer' : loc.kind === 'bus' ? 'bus' : 'line'} is out of service.</>
          )}
        </p>
      )}
    </div>
  )
}
