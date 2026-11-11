import { useState } from 'react'
import { abs } from '../lib/complex'
import { relayColor } from '../lib/colors'
import { zoneLabel } from '../lib/protection'

// Protection chain for one terminal: every link between the fault and the
// breaker opening, each with its live state and the failure you can inject.
// Failures are the same scenario entries as the Failures panel.

const STYLE = {
  ok:   { box: 'border-emerald-300 bg-white', tag: 'bg-emerald-50 text-emerald-700', label: 'OK' },
  fail: { box: 'border-red-400 bg-red-50', tag: 'bg-red-100 text-red-700', label: 'FAILED' },
  nodc: { box: 'border-amber-400 bg-amber-50', tag: 'bg-amber-100 text-amber-800', label: 'NO DC' },
  na:   { box: 'border-gray-200 bg-gray-50', tag: 'bg-gray-100 text-gray-500', label: 'N/A' },
}

function Link({ name, status, live, control, check, last }) {
  const st = STYLE[status]
  return (
    <li className="flex items-stretch gap-1 min-w-0">
      <div className={`flex-1 min-w-0 rounded-lg border ${st.box} px-2.5 py-2 flex flex-col gap-1`}>
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-semibold text-gray-800">{name}</span>
          <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${st.tag}`}>{st.label}</span>
        </div>
        <div className="text-xs font-mono text-gray-600 min-h-[1rem]">{live}</div>
        {control && <div className="text-xs">{control}</div>}
        <p className="text-[11px] text-gray-500 leading-snug mt-auto"><span className="font-semibold text-gray-600">Field check: </span>{check}</p>
      </div>
      {!last && <span className="hidden xl:flex items-center text-gray-300 text-lg" aria-hidden>→</span>}
    </li>
  )
}

function Toggle({ checked, onChange, children }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer text-gray-700">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {children}
    </label>
  )
}

const pu = x => `${x.toFixed(2)} pu`

// NERC Glossary of Terms, quoted
const NERC_GLOSSARY = 'https://www.nerc.com/glossary-of-terms'
const NERC_TIP = 'Protection System (NERC Glossary): Protective relays which respond to electrical quantities; Communications systems necessary for correct operation of protective functions; Voltage and current sensing devices providing inputs to protective relays; Station dc supply associated with protective functions (including station batteries, battery chargers, and non-battery-based dc supply); and Control circuitry associated with protective functions through the trip coil(s) of the circuit breakers or other interrupting devices.\n\nComposite Protection System (NERC Glossary): The total complement of Protection System(s) that function collectively to protect an Element. Backup protection provided by a different Element’s Protection System(s) is excluded.'

export default function ChainView({ config, sim, state, coord }) {
  const relayIds = Object.keys(config.relays)
  const [ridRaw, setRid] = useState('AB')
  const rid = relayIds.includes(ridRaw) ? ridRaw : relayIds[0]
  const r = config.relays[rid]
  const sc = coord.scenario
  const m = state.meas?.[rid]
  const carrying = state.carrying?.includes(rid)

  const dcLost = sc.dcLost?.includes(r.bus)
  const oos = sc.relayOos.includes(rid)
  const tripOpen = sc.tripOpen?.includes(rid)
  const stuck = sc.breakerFail.includes(rid)
  const tripped = state.tripped[rid]
  const bkr = state.breakers[rid]
  const picked = config.relays[rid].zones.filter(z => ['picked', 'operated'].includes(state.zones[rid]?.[z.id]?.status))

  // Communications: the line's pilot scheme, else 87L on A–B, else none
  const scheme = config.features?.pilot ? config.schemes?.[r.line] ?? 'step' : 'step'
  const diff87 = !!config.features?.diff && r.line === 'AB'
  const lineName = `${sim.net.lines[r.line].from}–${sim.net.lines[r.line].to}`
  const chValue = scheme !== 'step' ? sc.channels?.[r.line] ?? 'ok' : diff87 ? sc.diffChannel ?? 'ok' : null
  const otherAtBus = relayIds.filter(id => id !== rid && config.relays[id].bus === r.bus)

  const links = [
    {
      name: 'CT (current)',
      status: 'ok',
      live: carrying && m ? `Ia ${pu(abs(m.I))}` : 'no fault current',
      check: 'Ratio and polarity tests at commissioning; secondary circuit grounded at one point.',
    },
    {
      name: 'VT (voltage)',
      status: 'ok',
      live: m ? `Va ${pu(abs(m.V))}` : '—',
      check: 'Fuse / MCB supervision raises a loss-of-potential alarm; secondary voltage checks.',
    },
    {
      name: `Relay 21-${rid}`,
      status: dcLost ? 'nodc' : oos ? 'fail' : 'ok',
      live: dcLost ? 'dead' : oos ? 'out of service' : tripped ? `TRIP ${tripped.logic && tripped.logic !== 'step' ? tripped.logic : `Z${tripped.zoneId}`}` : picked.length ? `${picked.map(zoneLabel).join(' ')} picked up` : 'watching',
      control: <Toggle checked={!oos} onChange={() => coord.toggleOos(rid)}>In service</Toggle>,
      check: 'Self-test alarm monitored by SCADA; settings checked against the approved file; periodic functional tests.',
    },
    {
      name: scheme !== 'step' ? `Channel ${lineName} (${scheme})` : diff87 ? `Channel ${lineName} (87L)` : 'Channel',
      status: chValue === null ? 'na' : chValue === 'ok' ? 'ok' : 'fail',
      live: chValue === null ? 'step distance: no channel' : `${state.tx?.[rid] ? 'TX ' : ''}${state.rx?.[rid] ? 'RX' : ''}` || 'quiet',
      control: chValue === null ? null : (
        <select value={chValue} onChange={e => (scheme !== 'step' ? coord.setChannel(r.line, e.target.value) : coord.setDiffChannel(e.target.value))}
          className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white w-full">
          <option value="ok">In service</option>
          <option value="out">Out of service</option>
          {scheme !== 'step' && <option value="lost">Lost at fault</option>}
        </select>
      ),
      check: 'Channel monitoring and alarms (loss of guard / signal, errors, delay); end-to-end scheme tests.',
    },
    {
      name: `DC supply (station ${r.bus})`,
      status: dcLost ? 'fail' : 'ok',
      live: dcLost ? `lost: ${[rid, ...otherAtBus].map(id => `21-${id}`).join(', ')} dead` : '125 V DC (typical)',
      control: <Toggle checked={!dcLost} onChange={() => coord.toggleDc(r.bus)}>In service</Toggle>,
      check: 'Battery and charger alarms, DC ground detection, battery load tests. Batteries, chargers and any non-battery DC supply are all part of the Protection System.',
    },
    {
      name: 'Trip circuit',
      status: dcLost ? 'nodc' : tripOpen ? 'fail' : 'ok',
      live: dcLost ? 'no DC to trip' : tripped ? (tripOpen ? 'trip not delivered' : 'trip delivered') : 'idle',
      control: <Toggle checked={!tripOpen} onChange={() => coord.toggleTripOpen(rid)}>Intact</Toggle>,
      check: 'Trip-circuit supervision alarms on an open coil or wiring; trip tests during maintenance.',
    },
    {
      name: `Breaker 52-${rid}`,
      status: dcLost ? 'nodc' : stuck ? 'fail' : 'ok',
      live: bkr === 'open' ? 'open' : bkr === 'failed' ? 'failed to open' : dcLost ? 'closed — cannot trip' : 'closed',
      control: <Toggle checked={!stuck} onChange={() => coord.toggleBreakerFail(rid)}>Opens when tripped</Toggle>,
      check: 'Timing and maintenance tests; breaker-failure protection (not modelled here) is the backstop. The defined Protection System ends at the trip coil; the breaker is the device it operates.',
    },
  ]

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3" aria-label="Protection chain">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Protection chain</h2>
          <p className="text-xs text-gray-400">
            Every link must work for this terminal to clear the fault. Break one and replay.{' '}
            <span title={NERC_TIP} className="underline decoration-dotted cursor-help">In standards terms, a Protection System</span>{' '}
            (<a href={NERC_GLOSSARY} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-700 underline">NERC Glossary</a>).
          </p>
        </div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Terminal">
          {relayIds.map(id => (
            <button key={id} role="radio" aria-checked={id === rid} onClick={() => setRid(id)}
              className={`px-2 py-0.5 rounded text-xs font-bold border ${id === rid ? 'text-white' : 'bg-white'}`}
              style={id === rid ? { background: relayColor(id), borderColor: relayColor(id) } : { color: relayColor(id), borderColor: '#e5e7eb' }}>
              {id}
            </button>
          ))}
        </div>
      </div>
      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
        {links.map((l, i) => <Link key={l.name} {...l} last={i === links.length - 1} />)}
      </ol>
    </section>
  )
}
