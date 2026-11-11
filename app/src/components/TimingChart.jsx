import { useEffect, useRef, useState } from 'react'
import { relayColor } from '../lib/colors'
import { zoneDelayS, activeZones, isReverse, zoneLabel } from '../lib/protection'

// Logic-analyzer style timing chart: time runs left → right, each signal is
// a digital trace. Traces are drawn only up to the current sim time so
// stepping reveals the sequence. Drawn in real pixels (ResizeObserver)
// so text stays a constant size at any width.

const LABEL_W = 84
const PAD_R = 14
const AXIS_H = 26
const ROW_H = 18
const GROUP_GAP = 8
const TICK_STEPS_MS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]

// Step function of a signal from the event snapshots: [{t0, t1, v, state}]
function segments(events, endT, valueFn) {
  const out = []
  for (let i = 0; i < events.length; i++) {
    const t0 = events[i].t
    const t1 = i + 1 < events.length ? events[i + 1].t : endT
    if (t1 <= t0 && i + 1 < events.length) continue
    const v = valueFn(events[i].state)
    const last = out[out.length - 1]
    if (last && last.v === v) last.t1 = t1
    else out.push({ t0, t1, v, state: events[i].state })
  }
  return out
}

export default function TimingChart({ config, sim, time, endT, onSetTime, controls = null }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(800)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { events } = sim
  const freqHz = config.timing.freqHz
  const relayIds = Object.keys(config.relays)
  const activeIds = new Set(events.filter(e => e.rid).map(e => e.rid))
  const shownIds = showAll ? relayIds : relayIds.filter(id => activeIds.has(id))

  // Signal rows
  const rows = [{ key: 'fault', label: 'FAULT', color: '#dc2626', fn: s => s.faultEnergized, group: null }]
  for (const rid of shownIds) {
    const color = relayColor(rid)
    const carrying = s => s.carrying.includes(rid)
    for (const z of activeZones(config.relays[rid], config)) {
      rows.push({
        key: `${rid}z${z.id}`, label: `${zoneLabel(z)} PU`, color, group: rid, rid, zone: z,
        delay: isReverse(z) ? 0 : zoneDelayS(z, freqHz),
        fn: s => {
          const st = s.zones[rid][z.id].status
          return st === 'picked' || (st === 'operated' && carrying(s))
        },
      })
    }
    const scheme = config.features?.pilot ? config.schemes?.[config.relays[rid].line] ?? 'step' : 'step'
    if (scheme !== 'step') {
      const sig = scheme === 'DCB' ? 'BLK' : 'PERM'
      rows.push({ key: `${rid}tx`, label: `TX ${sig}`, color: '#4f46e5', group: rid, fn: s => !!s.tx?.[rid] })
      rows.push({ key: `${rid}rx`, label: `RX ${sig}`, color: '#4f46e5', group: rid, fn: s => !!s.rx?.[rid] })
    }
    if (config.features?.diff && config.relays[rid].line === 'AB') {
      rows.push({ key: `${rid}87`, label: '87L OP', color: '#0891b2', group: rid, fn: s => !!s.diff?.op })
    }
    rows.push({ key: `${rid}trip`, label: 'TRIP', color, group: rid, fn: s => !!s.tripped[rid] && carrying(s) })
    rows.push({ key: `${rid}52`, label: '52 closed', color: '#6b7280', group: rid, breaker: rid, fn: s => s.breakers[rid] !== 'open' })
  }

  // Row y positions with a gap between terminal groups
  let y = AXIS_H
  let prevGroup
  const layout = rows.map(r => {
    const first = r.group !== prevGroup
    if (first) { y += GROUP_GAP; prevGroup = r.group }
    const top = y
    y += ROW_H
    return { ...r, top, first }
  })
  const H = y + 8

  const plotW = width - LABEL_W - PAD_R
  // The run starts with a short prefault period (startT < 0); the fault is at t = 0
  const startT = sim.startT
  const span = endT - startT
  const tx = t => LABEL_W + ((t - startT) / span) * plotW
  const now = Math.min(time, endT)

  // Ticks: ~8 across, on multiples of the step (so t = 0 always gets one)
  const stepMs = TICK_STEPS_MS.find(s => (span * 1000) / s <= 8) ?? 1000
  const ticks = []
  for (let i = Math.ceil((startT * 1000 - 1e-6) / stepMs); i * stepMs <= endT * 1000 + 1e-6; i++) ticks.push((i * stepMs) / 1000)

  function handleClick(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = startT + ((e.clientX - rect.left - LABEL_W) / plotW) * span
    if (t >= startT && t <= endT) onSetTime(t)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Timing</h3>
        <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          show idle terminals
        </label>
      </div>
      {/* Playback controls (time, not distance) sit under the Timing heading */}
      {controls && <div className="mb-2">{controls}</div>}
      <div ref={wrapRef} className="w-full">
        <svg width={width} height={H} className="select-none cursor-pointer" onClick={handleClick}
          role="img" aria-label="Logic analyzer timing chart">
          {/* Prefault period (t < 0) */}
          <rect x={tx(startT)} y={AXIS_H - 4} width={Math.max(0, tx(0) - tx(startT))} height={H - AXIS_H} fill="#f3f4f6" />
          <text x={(tx(startT) + tx(0)) / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="#9ca3af">prefault</text>

          {/* Time grid + axis */}
          {ticks.map(t => (
            <g key={t}>
              <line x1={tx(t)} y1={AXIS_H - 4} x2={tx(t)} y2={H - 4} stroke="#f0f1f3" />
              <text x={tx(t)} y={11} textAnchor="middle" fontSize={10} fill="#6b7280">{Math.round(t * 1000) || 0} ms</text>
              <text x={tx(t)} y={22} textAnchor="middle" fontSize={9} fill="#b0b5bd">{(t * freqHz + 0).toFixed(1)} cyc</text>
            </g>
          ))}

          {/* Event markers */}
          {[...new Set(events.map(e => e.t))].map(t => (
            <line key={t} x1={tx(t)} y1={AXIS_H - 4} x2={tx(t)} y2={AXIS_H + 2}
              stroke={t <= now + 1e-9 ? '#374151' : '#d1d5db'} strokeWidth={2} />
          ))}

          {layout.map(r => {
            const hi = r.top + 4, lo = r.top + ROW_H - 4
            const segs = segments(events, endT, r.fn)
              .filter(s => s.t0 <= now)
              .map(s => ({ ...s, t1: Math.min(s.t1, now) }))
            let d = ''
            segs.forEach((s, i) => {
              const yv = s.v ? hi : lo
              d += i === 0 ? `M ${tx(s.t0)} ${yv}` : ` L ${tx(s.t0)} ${yv}`
              d += ` L ${tx(s.t1)} ${yv}`
            })
            const failedAt = r.breaker ? events.find(e => e.kind === 'bkrFail' && e.rid === r.breaker && e.t <= now) : null
            return (
              <g key={r.key}>
                {r.group && r.first && (
                  <text x={6} y={r.top + 12} fontSize={11} fontWeight="700" fill={relayColor(r.group)}>21-{r.group}</text>
                )}
                <text x={LABEL_W - 6} y={r.top + 12} textAnchor="end" fontSize={10}
                  fill={r.key === 'fault' ? '#dc2626' : '#6b7280'} fontWeight={r.key === 'fault' ? 700 : 400}>{r.label}</text>
                <line x1={LABEL_W} y1={lo} x2={width - PAD_R} y2={lo} stroke="#f3f4f6" />

                {/* Zone timer ramps (delayed zones): time-to-trip building up */}
                {r.zone && r.delay > 0 && segs.filter(s => s.v && s.state.zones[r.rid][r.zone.id].since !== null).map((s, i) => {
                  const since = s.state.zones[r.rid][r.zone.id].since
                  const tEnd = Math.min(s.t1, since + r.delay)
                  const frac = Math.min(1, (tEnd - since) / r.delay)
                  return (
                    <path key={i} d={`M ${tx(since)} ${lo} L ${tx(tEnd)} ${lo - frac * (lo - hi)} L ${tx(tEnd)} ${lo} Z`}
                      fill={r.color} fillOpacity={0.18} />
                  )
                })}

                {/* High segments shaded for readability */}
                {segs.filter(s => s.v).map((s, i) => (
                  <rect key={i} x={tx(s.t0)} y={hi} width={Math.max(0, tx(s.t1) - tx(s.t0))} height={lo - hi}
                    fill={r.breaker ? '#dc2626' : r.color} fillOpacity={r.breaker ? 0.12 : 0.22} />
                ))}
                <path d={d} fill="none" stroke={r.color} strokeWidth={1.75} />
                {failedAt && (
                  <text x={tx(failedAt.t) + 4} y={hi + 8} fontSize={9} fontWeight="700" fill="#dc2626">FAIL</text>
                )}
              </g>
            )
          })}

          {/* Cursor */}
          <line x1={tx(now)} y1={AXIS_H - 4} x2={tx(now)} y2={H - 4} stroke="#111827" strokeWidth={1} strokeDasharray="4 3" />
        </svg>
      </div>
      <p className="text-xs text-gray-400">Shaded ramp = delayed-zone timer building toward trip. Click the chart to jump to a time.</p>
    </div>
  )
}
