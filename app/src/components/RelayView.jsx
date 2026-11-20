import { abs, arg } from '../lib/complex'
import { bayQuantities, relayInstruments, BAY_BASE } from '../lib/instruments'

// What is on the line, what the instruments deliver, and what the relay
// computes from it — side by side for one terminal at the current moment.
// A ≠ marks every quantity where the relay's picture differs from the truth.

const DEG = 180 / Math.PI
const mag = (z, unit) => {
  const x = abs(z)
  if (unit === 'A') return x >= 1000 ? `${(x / 1000).toFixed(2)} kA` : `${x.toFixed(x < 10 ? 2 : 0)} A`
  return x >= 1000 ? `${(x / 1000).toFixed(1)} kV` : `${x.toFixed(1)} V`
}
const phasor = (z, unit) => (abs(z) < 1e-6 ? <span className="text-gray-400">0</span>
  : <>{mag(z, unit)} <span className="text-gray-400">∠{Math.round(arg(z) * DEG)}°</span></>)
const differs = (a, b) => abs({ re: a.re - b.re, im: a.im - b.im }) > 0.01 * Math.max(abs(a), abs(b), 1)
const ohms = Z => (Z ? `${Math.hypot(Z.R, Z.X).toFixed(2)} Ω ∠${Math.round(Math.atan2(Z.X, Z.R) * DEG)}°` : '—')
const dirWord = d => (d > 0 ? 'forward' : d < 0 ? 'reverse' : 'none')

function Row({ label, prim, sec, relay, neq, note }) {
  return (
    <tr className="border-b border-gray-50">
      <th scope="row" className="text-left font-semibold text-gray-600 py-1 pr-2 whitespace-nowrap">{label}</th>
      <td className="py-1 px-2 font-mono whitespace-nowrap">{prim}</td>
      <td className="py-1 px-2 font-mono whitespace-nowrap">{sec}</td>
      <td className={`py-1 px-2 font-mono whitespace-nowrap ${neq ? 'text-red-700 font-semibold' : ''}`}>{relay}</td>
      <td className="py-1 pl-1 w-6 text-center">{neq && <span title={note ?? 'The relay’s value differs from the power system'} className="text-red-600 font-bold">≠</span>}</td>
    </tr>
  )
}

export default function RelayView({ config, state, scenario, rid }) {
  const m = state.meas?.[rid]
  if (!m?.prim) return null
  const ri = relayInstruments(config.features?.foundations ? scenario : {}, rid)
  const q = bayQuantities(m, ri)
  const live = q.I.some(r => abs(r.prim) > 1)
  const zNeq = !!q.Z.prim !== !!q.Z.relay || (q.Z.prim && q.Z.relay && Math.hypot(q.Z.prim.R - q.Z.relay.R, q.Z.prim.X - q.Z.relay.X) > 0.02 * Math.hypot(q.Z.prim.R, q.Z.prim.X))

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2" aria-label="Relay's view">
      <div>
        <h2 className="text-sm font-semibold text-gray-700">What the relay sees — 21-{rid}</h2>
        <p className="text-xs text-gray-400">
          The relay never sees the line. It sees the CT and VT secondaries and multiplies them back up by the ratios it is set to.
          Angles relative to the source voltage. Typical values: {BAY_BASE.kV} kV, CT {BAY_BASE.ctLabel}, VT {BAY_BASE.vtLabel}.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr className="text-gray-500 border-b border-gray-200">
              <th className="text-left font-semibold py-1 pr-2"></th>
              <th className="text-left font-semibold py-1 px-2">On the line <span className="font-normal text-gray-400">(primary)</span></th>
              <th className="text-left font-semibold py-1 px-2">At the relay terminals <span className="font-normal text-gray-400">(secondary)</span></th>
              <th className="text-left font-semibold py-1 px-2">Relay computes <span className="font-normal text-gray-400">(primary)</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {q.I.map((r, p) => (
              <Row key={`I${p}`} label={`I${'abc'[p]}`} prim={phasor(r.prim, 'A')} sec={phasor(r.sec, 'A')} relay={phasor(r.relay, 'A')}
                neq={differs(r.prim, r.relay)} />
            ))}
            <Row label="3I0" prim={phasor(q.I0x3.prim, 'A')} sec={phasor(q.I0x3.sec, 'A')} relay={phasor(q.I0x3.relay, 'A')}
              neq={differs(q.I0x3.prim, q.I0x3.relay)} note="Residual current that isn't on the line: a wiring or polarity error" />
            {q.V.map((r, p) => (
              <Row key={`V${p}`} label={`V${'abc'[p]}`} prim={phasor(r.prim, 'V')} sec={phasor(r.sec, 'V')} relay={phasor(r.relay, 'V')}
                neq={differs(r.prim, r.relay)} />
            ))}
            {live && <>
              <Row label="Loop" prim={q.loop.prim ?? '—'} sec="" relay={q.loop.relay ?? '—'} neq={q.loop.prim !== q.loop.relay} />
              <Row label="Z = V / I" prim={ohms(q.Z.prim)} sec={ohms(q.Z.sec)} relay={ohms(q.Z.relay)} neq={zNeq}
                note="The relay’s apparent impedance is not the true impedance to the fault" />
              <Row label="Direction" prim={dirWord(q.dir.prim)} sec="" relay={dirWord(q.dir.relay)} neq={q.dir.prim !== q.dir.relay} />
            </>}
            {q.Zload && (
              <Row label="Load Z (before the fault)" prim={ohms(q.Zload.prim)} sec={ohms(q.Zload.sec)} relay={ohms(q.Zload.relay)}
                neq={!!q.Zload.prim !== !!q.Zload.relay || (q.Zload.prim && q.Zload.relay && Math.hypot(q.Zload.prim.R - q.Zload.relay.R, q.Zload.prim.X - q.Zload.relay.X) > 0.02 * Math.hypot(q.Zload.prim.R, q.Zload.prim.X))} />
            )}
          </tbody>
        </table>
      </div>
      {live && <p className="text-[11px] text-gray-400">“On the line” Z and direction: what this relay would measure with correct instruments.</p>}
    </section>
  )
}
