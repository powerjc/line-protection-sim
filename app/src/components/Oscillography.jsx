import { useEffect, useMemo, useRef, useState } from 'react'
import { activeZones, zoneLabel } from '../lib/protection'
import { buildTrace, valueAt, sampleTimes, dftAt, phasorRms, stationTrace, busAt, SAMPLES_PER_CYCLE } from '../lib/waveforms'
import { baseAmps } from '../lib/instruments'
import { INCEPTION } from '../lib/ctsat'
import { relayColor } from '../lib/colors'

// An event report for one terminal, on one time axis: what is on the line,
// what the CTs/VTs deliver, the relay's samples, its one-cycle phasor
// estimate, and its digital signals. Waveforms are synthesized from the
// engine's phasors (illustrative). Click to move the playback cursor.
//
// With bus differential (87B) on bus B: terminals at B add an operate /
// restraint panel. Station mode (station = a bus id, Station tab) shows the
// station instead: each feeder's current into the bus (or, with 87B on that
// bus, each 87B CT's secondary and their sum, and operate / restraint), and
// every feeder breaker.

const PH = [{ n: 'A', c: '#dc2626' }, { n: 'B', c: '#ca8a04' }, { n: 'C', c: '#2563eb' }]
const LABEL_W = 116, PAD_R = 10, AXIS_H = 22, H = 64, H_SEC = 84, GAP = 10, DIG_H = 15
const TICKS_MS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500]
const WINDOWS = [['all', 'Whole event'], ['fault', 'Fault inception'], ['cursor', 'Around cursor']]

const fmt = (x, unit) => {
  const a = Math.abs(x)
  if (unit === 'A') return a >= 1000 ? `${(x / 1000).toFixed(a >= 10000 ? 0 : 1)} kA` : `${x.toFixed(a >= 10 ? 0 : 1)} A`
  return a >= 1000 ? `${(x / 1000).toFixed(a >= 10000 ? 0 : 1)} kV` : `${x.toFixed(a >= 10 ? 0 : 1)} V`
}

export default function Oscillography({ config, sim, state, scenario, rid, time, onSetTime, station = null }) {
  const bus = !!station
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(800)
  const [win, setWin] = useState('all')
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const stBus = station ?? config.relays[rid]?.bus
  const bt = useMemo(() => stationTrace(sim, config, scenario, stBus), [sim, config, scenario, stBus])
  const showOp = !!bt.zone
  const traceRid = bus ? bt.feeders[0] : rid
  const trace = useMemo(() => buildTrace(sim, config, traceRid, scenario), [sim, config, traceRid, scenario])
  const cyc = 1 / trace.f
  const [t0, t1] = win === 'fault' ? [trace.tFault - cyc, trace.tFault + 4 * cyc]
    : win === 'cursor' ? (() => { // ±2 cycles around the cursor, kept inside the record
      const a = Math.min(Math.max(time - 2 * cyc, trace.start), trace.end - 4 * cyc)
      return [a, a + 4 * cyc]
    })()
    : [trace.start, trace.end]
  const plotW = width - LABEL_W - PAD_R
  const x = t => LABEL_W + ((t - t0) / (t1 - t0)) * plotW

  const panels = useMemo(() => {
    const n = Math.max(200, Math.round(plotW * 1.5))
    const ts = Array.from({ length: n + 1 }, (_, k) => t0 + ((t1 - t0) * k) / n)
    const wave = (qty, view) => {
      const ys = [0, 1, 2].map(p => ts.map(t => valueAt(trace, qty, view, p, t)))
      return { ys, max: Math.max(1e-9, ...ys.flat().map(Math.abs)) }
    }
    const st = sampleTimes(trace, t0, t1)
    // Secondary panels also carry the relay's samples (all phases) and its
    // one-cycle phasor estimate for phase A, drawn as a peak envelope (√2 × RMS)
    const sec = qty => {
      const w = wave(qty, 'sec')
      w.samples = [0, 1, 2].map(p => st.map(t => [t, valueAt(trace, qty, 'sec', p, t)]))
      w.est = ts.map(t => Math.SQRT2 * dftAt(trace, qty, 'sec', 0, t))
      w.act = ts.map(t => Math.SQRT2 * phasorRms(trace, qty, 'sec', 0, t))
      w.max = Math.max(w.max, ...w.est)
      return w
    }
    const out = { ts, nSamples: st.length }
    if (!bus) Object.assign(out, { primI: wave('I', 'prim'), primV: wave('V', 'prim'), secI: sec('I'), secV: sec('V') })
    const Ib = baseAmps()
    const segs = (showOp || bus) ? ts.map(t => busAt(bt, t)) : null
    if (bus && !showOp) {
      // Each feeder's current into the bus (phase A, primary) and their sum
      const w = trace.w
      const inst = (I, t) => Math.SQRT2 * Ib * (I.re * Math.cos(w * t + INCEPTION) - I.im * Math.sin(w * t + INCEPTION))
      const lines = bt.feeders.map((fid, j) => ({
        ys: ts.map((t, n) => (segs[n].into[j]?.[0] ? inst(segs[n].into[j][0], t) : 0)), color: relayColor(fid), w: Math.max(1.2, 3.6 - 1.4 * j), label: `52-${fid}`,
      }))
      out.busI = { lines, max: Math.max(1e-9, ...lines.flatMap(l => l.ys.map(Math.abs))), centered: true }
    }
    if (showOp) {
      // Operate vs restraint (worst phase, primary amps); steps at each event
      const op = segs.map(sg => sg.Iop * Ib), res = segs.map(sg => bt.slope * sg.Ires * Ib), pick = ts.map(() => bt.pickup * Ib)
      out.op = { lines: [{ ys: pick, color: '#9ca3af', dash: '2 3', w: 1 }, { ys: res, color: '#7c3aed', dash: '5 3', w: 1.4 }, { ys: op, color: '#dc2626', w: 2 }],
        max: Math.max(1, ...op, ...res, ...pick) * 1.1, centered: false }
      if (bus) {
        // Each 87B CT's secondary (phase A, into the bus, DC offset and saturation included) and their sum: the differential current
        const lines = bt.zone.feeders.map((fid, j) => ({
          // Wider underneath, narrower on top, so identical waves (a reversed CT on through load) both show
          ys: ts.map(t => bt.ctWave[j](t)), color: relayColor(fid), w: Math.max(1.2, 3.6 - 1.4 * j), label: `52-${fid}`,
        }))
        lines.push({ ys: ts.map((_, n) => lines.reduce((sum, l) => sum + l.ys[n], 0)), color: '#111827', w: 2.2, label: 'Σ (differential)' })
        out.busI = { lines, max: Math.max(1e-9, ...lines.flatMap(l => l.ys.map(Math.abs))), centered: true }
      }
    }
    return out
  }, [trace, bt, bus, showOp, t0, t1, plotW])
  const feeders = bus ? bt.feeders : []

  // Digital signals for this terminal (from the event snapshots)
  const r = config.relays[traceRid]
  const scheme = config.features?.pilot ? config.schemes?.[r.line] ?? 'step' : 'step'
  const digital = bus ? [
    ...(showOp ? [{ label: '87B OP', fn: s => !!s.bus87?.op, color: '#7c3aed' }] : []),
    ...feeders.flatMap(fid => [
      { label: `TRIP 52-${fid}`, fn: s => !!s.tripped[fid], color: '#dc2626' },
      { label: `52-${fid} closed`, fn: s => s.breakers[fid] !== 'open', color: '#374151' },
    ]),
  ] : [
    // A zone is up while picked up, or operated and still seeing current (as on the timing chart)
    ...activeZones(r, config).map(z => ({ label: `${zoneLabel(z)} PU`, fn: s => {
      const st = s.zones[rid]?.[z.id]?.status
      return st === 'picked' || (st === 'operated' && s.carrying.includes(rid))
    } })),
    ...(sim.events.some(e => e.kind === 'lop' && e.rid === rid) ? [{ label: 'LOP', fn: s => !!s.lop?.[rid], color: '#d97706' }] : []),
    ...(showOp ? [{ label: '87B OP', fn: s => !!s.bus87?.op, color: '#7c3aed' }] : []),
    { label: 'TRIP', fn: s => !!s.tripped[rid], color: '#dc2626' },
    { label: '52a closed', fn: s => s.breakers[rid] !== 'open', color: '#374151' },
    ...(scheme !== 'step' ? [{ label: 'TX', fn: s => !!s.tx?.[rid], color: '#4f46e5' }, { label: 'RX', fn: s => !!s.rx?.[rid], color: '#4f46e5' }] : []),
  ]

  // Layout
  const rows = bus ? [
    showOp ? { key: 'busI', title: '87B CT secondaries', sub: 'phase A, into the bus', kind: 'lines', unit: 'A', h: H_SEC }
      : { key: 'busI', title: 'Feeder currents', sub: 'phase A, into the bus', kind: 'lines', unit: 'A', h: H_SEC },
  ] : [
    { key: 'primI', title: 'Line current', sub: 'primary', kind: 'wave', unit: 'A', h: H },
    { key: 'primV', title: 'Line voltage', sub: 'primary', kind: 'wave', unit: 'V', h: H },
    { key: 'secI', title: 'CT secondary', sub: 'at the relay', kind: 'sec', unit: 'A', h: H_SEC },
    { key: 'secV', title: 'VT secondary', sub: 'at the relay', kind: 'sec', unit: 'V', h: H_SEC },
  ]
  if (showOp) rows.push({ key: 'op', title: '87B operate', sub: 'vs restraint, worst phase', kind: 'lines', unit: 'A', h: H })
  let y = 6
  for (const row of rows) { row.y = y; y += row.h + GAP }
  const digY = y
  const totalH = digY + digital.length * DIG_H + AXIS_H + 4

  const path = (ys, y0, h, max, centered = true) => panels.ts.map((t, k) => {
    const v = ys[k] / max
    const py = centered ? y0 + h / 2 - (v * (h / 2 - 3)) : y0 + h - 3 - v * (h - 6)
    return `${k ? 'L' : 'M'}${x(t).toFixed(1)},${py.toFixed(1)}`
  }).join('')

  // Time ticks
  const spanMs = (t1 - t0) * 1000
  const step = TICKS_MS.find(s => spanMs / s <= Math.max(3, plotW / 70)) ?? 1000
  const ticks = []
  for (let v = Math.ceil((t0 * 1000) / step) * step; v <= t1 * 1000 + 1e-9; v += step) ticks.push(v / 1000)

  const tc = Math.max(t0, Math.min(t1, time))
  const windowStart = time - cyc // DFT window ending at the cursor
  const dotsFit = plotW / Math.max(1, panels.nSamples) >= 3 // skip sample dots when they would merge
  const onClick = e => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * width
    if (px < LABEL_W) return
    onSetTime(t0 + ((px - LABEL_W) / plotW) * (t1 - t0))
  }

  // Digital step segments
  const evs = sim.events
  const stepSegs = fn => {
    const out = []
    for (let i = 0; i < evs.length; i++) {
      const a = evs[i].t, b = i + 1 < evs.length ? evs[i + 1].t : t1
      const v = fn(evs[i].state)
      const last = out[out.length - 1]
      if (last && last.v === v) last.b = b
      else out.push({ a, b, v })
    }
    if (out.length) out[0].a = Math.min(out[0].a, t0)
    return out
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2" aria-label="Oscillography">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Oscillography — {bus ? `station ${station}${showOp ? ' (87B)' : ''}` : `21-${rid}`}</h2>
          <p className="text-xs text-gray-400">
            {bus ? (showOp ? 'The bus differential’s view: each 87B CT, their sum, operate against restraint, and the bus breakers. ' : 'Every feeder’s current into the bus, and the feeder breakers. ')
              : 'Like a relay event report: the line, the instrument secondaries, the relay’s samples and its one-cycle phasor estimate, and its logic. '}
            Synthesized from the phasor model{bus ? '' : ' with a decaying DC offset at inception'}: illustrative. Click to move the cursor.
          </p>
        </div>
        <div className="flex gap-1" role="radiogroup" aria-label="Time window">
          {WINDOWS.map(([id, label]) => (
            <button key={id} role="radio" aria-checked={win === id} onClick={() => setWin(id)}
              className={`px-2 py-0.5 rounded text-xs font-semibold border ${win === id ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        {bus ? <>
          {feeders.map(fid => <span key={fid} className="font-semibold" style={{ color: relayColor(fid) }}>— 52-{fid}</span>)}
          {showOp && <span className="text-gray-900 font-semibold">━ Σ: differential current</span>}
        </> : <>
          {PH.map(p => <span key={p.n} className="font-semibold" style={{ color: p.c }}>— phase {p.n}</span>)}
          <span className="text-gray-500">• relay samples ({SAMPLES_PER_CYCLE}/cycle)</span>
          <span className="text-gray-900 font-semibold">━ relay’s magnitude, phase A</span>
          <span className="text-gray-500">┄ true magnitude</span>
        </>}
        {showOp && <>
          <span className="text-red-600 font-semibold">━ 87B operate |Σ I|</span>
          <span className="text-violet-600">┅ slope × restraint</span>
          <span className="text-gray-400">┈ pickup</span>
        </>}
      </div>
      <div ref={wrapRef} className="w-full">
        <svg width={width} height={totalH} className="block select-none cursor-crosshair" onClick={onClick} role="img" aria-label={`Oscillography for 21-${rid}`}>
          <defs>
            <clipPath id="osc-plot"><rect x={LABEL_W} y={0} width={plotW} height={totalH} /></clipPath>
          </defs>

          {/* Grid */}
          {ticks.map(t => <line key={t} x1={x(t)} y1={4} x2={x(t)} y2={totalH - AXIS_H} stroke="#f3f4f6" />)}
          {trace.tFault >= t0 && trace.tFault <= t1 && (
            <line x1={x(trace.tFault)} y1={4} x2={x(trace.tFault)} y2={totalH - AXIS_H} stroke="#fca5a5" strokeDasharray="3 3" />
          )}

          {rows.map(row => {
            const d = panels[row.key]
            return (
              <g key={row.key}>
                <text x={0} y={row.y + 14} fontSize={11} fontWeight={700} fill="#374151">{row.title}</text>
                <text x={0} y={row.y + 27} fontSize={10} fill="#9ca3af">{row.sub}</text>
                <text x={0} y={row.y + 40} fontSize={10} fill="#9ca3af">{d.centered === false ? `0–${fmt(d.max, row.unit)}` : `±${fmt(d.max, row.unit)}`}</text>
                <rect x={LABEL_W} y={row.y} width={plotW} height={row.h} fill="none" stroke="#e5e7eb" />
                <g clipPath="url(#osc-plot)">
                  {row.kind === 'lines' && <>
                    {d.centered && <line x1={LABEL_W} y1={row.y + row.h / 2} x2={LABEL_W + plotW} y2={row.y + row.h / 2} stroke="#e5e7eb" />}
                    {d.lines.map((l, k) => <path key={k} d={path(l.ys, row.y, row.h, d.max, d.centered)} fill="none" stroke={l.color} strokeWidth={l.w} strokeDasharray={l.dash} />)}
                  </>}
                  {row.kind === 'sec' && (
                    <rect x={x(windowStart)} y={row.y} width={Math.max(0, x(time) - x(windowStart))} height={row.h} fill="#e0e7ff" opacity={0.6} />
                  )}
                  {d.ys && <line x1={LABEL_W} y1={row.y + row.h / 2} x2={LABEL_W + plotW} y2={row.y + row.h / 2} stroke="#e5e7eb" />}
                  {d.ys && d.ys.map((ys, p) => <path key={p} d={path(ys, row.y, row.h, d.max)} fill="none" stroke={PH[p].c} strokeWidth={1.3} opacity={row.kind === 'sec' ? 0.55 : 1} />)}
                  {row.kind === 'sec' && <>
                    {dotsFit && d.samples.map((pts, p) => pts.map(([t, v]) => (
                      <circle key={`${p}-${t}`} cx={x(t)} cy={row.y + row.h / 2 - (v / d.max) * (row.h / 2 - 3)} r={1.9} fill={PH[p].c} />
                    )))}
                    <path d={path(d.act, row.y, row.h, d.max)} fill="none" stroke="#374151" strokeWidth={1.2} strokeDasharray="4 3" />
                    <path d={path(d.est, row.y, row.h, d.max)} fill="none" stroke="#111827" strokeWidth={2} />
                  </>}
                </g>
              </g>
            )
          })}

          {/* Digital */}
          {digital.map((sig, i) => {
            const yy = digY + i * DIG_H
            return (
              <g key={sig.label}>
                <text x={0} y={yy + 11} fontSize={10} fontWeight={600} fill="#374151">{sig.label}</text>
                <g clipPath="url(#osc-plot)">
                  <line x1={LABEL_W} y1={yy + DIG_H - 3} x2={LABEL_W + plotW} y2={yy + DIG_H - 3} stroke="#e5e7eb" />
                  {stepSegs(sig.fn).filter(s => s.v && s.b > t0 && s.a < t1).map((s, k) => (
                    <rect key={k} x={x(Math.max(s.a, t0))} y={yy + 2} width={Math.max(1, x(Math.min(s.b, t1)) - x(Math.max(s.a, t0)))} height={DIG_H - 5}
                      fill={sig.color ?? '#b45309'} opacity={0.85} rx={1} />
                  ))}
                </g>
              </g>
            )
          })}

          {/* Axis */}
          {ticks.map(t => (
            <text key={t} x={x(t)} y={totalH - 6} textAnchor="middle" fontSize={10} fill="#6b7280">{Math.round(t * 1000)} ms</text>
          ))}

          {/* Not yet played: dimmed; cursor */}
          {tc < t1 && <rect x={x(tc)} y={0} width={x(t1) - x(tc)} height={totalH - AXIS_H} fill="#fff" opacity={0.55} />}
          {time >= t0 && time <= t1 && <line x1={x(time)} y1={0} x2={x(time)} y2={totalH - AXIS_H} stroke="#111827" strokeWidth={1.2} />}
          {trace.cutOff && win === 'all' && (
            <text x={LABEL_W + plotW - 4} y={14} textAnchor="end" fontSize={11} fontWeight={700} fill="#b91c1c">not cleared — record cut off</text>
          )}
        </svg>
      </div>
      {bus ? <p className="text-[11px] text-gray-400">
        {showOp ? '' : 'Each feeder’s current into the bus, primary (no DC offset drawn). Kirchhoff: with no source at this bus they add up to zero unless the fault is on the bus. '}
        {showOp && <>Each 87B CT’s secondary as the relay is told it, all measured into the bus. Healthy: the waves cancel and the sum is flat (DC offset included).
        A saturating CT chops its wave, and the sum is no longer flat.
        A bus fault: they add. A reversed CT: it flips, and the sum appears even on load current. Operate is compared with slope × restraint and the pickup.</>}
      </p> : <p className="text-[11px] text-gray-400">
        On the secondaries: the dots are the relay’s samples; the black line is the phase-A magnitude the relay estimates from its last cycle of samples (shaded),
        drawn at peak height against the true magnitude (dashed). It takes about a cycle to settle and the DC offset makes it wobble; that is part of why relays need time.
        Samples are shown sparse for clarity; zoom in (Fault inception) to see them.
      </p>}
    </section>
  )
}
