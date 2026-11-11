import { useRef } from 'react'
import { relayGeometry, activeTap, EPS } from '../lib/network'
import { zoneReachPu, activeZones, isReverse, zoneLabel } from '../lib/protection'
import { relayColor } from '../lib/colors'
import { useUnits } from '../lib/units'
import { findConflicts } from '../lib/coordination'

// One SVG, two stacked views sharing one distance axis:
//   top    — one-line: sources, buses, CTs + relays (21), breakers (52), fault
//   bottom — zone coverage: one lane per relay, one row per zone, drawn
//            from the relay's own bus out to its reach.
//
// One-line: each bus has a fixed-width "station" area (CT, breaker) on either
// side, and the line itself (0% to 100%) runs between the line-side breaker
// terminals, with pixel length proportional to its impedance.
// Coverage: its own axis with the same bus positions, but each line spans
// bus to bus (0% at one bus, 100% at the other), so every zone of every relay
// at a bus starts on that bus's gridline and reaches line up with the buses.

const W = 1000
const ML = 96, MR = 70          // relay labels on the left, source on the right
const GAP = 44                  // bus → line start (px): CT at 12, breaker at 28
const CT_OFF = 12
const BKR_OFF = 28
const OL_Y = 62                 // one-line conductor y

const COV_TOP = 162             // coverage area top
const CH_Y = OL_Y + 70          // pilot channel line
const TAP_LEAD = 26             // line tap: tap section drawn from OL_Y down this far, then transformer, LV bus, load
const TAP_LV_Y = OL_Y + 50
const ROW = 10, ROW_GAP = 3, LANE_GAP = 9, GROUP_HEAD = 16
const COV_L = ML - 2, COV_R = W - MR + 30 // coverage clip bounds (covClip)
const LABEL_CH = 5.4                      // approx. px per character of a 9px bold zone label

// Zone label placement: just past the bar's end, or — when that would run off
// the coverage area — inside the visible end of the bar with an arrow showing
// the bar continues off-chart.
function zoneLabelPos(end, dir, text) {
  const w = text.length * LABEL_CH
  if (dir > 0 && end + 4 + w > COV_R) return { x: Math.min(end, COV_R) - 4, anchor: 'end', text: `${text} ▸` }
  if (dir < 0 && end - 4 - w < COV_L) return { x: Math.max(end, COV_L) + 4, anchor: 'start', text: `◂ ${text}` }
  return { x: end + dir * 4, anchor: dir > 0 ? 'start' : 'end', text }
}

// Map chain position (pu) → x, skipping the station areas at each bus.
function makeScale(net) {
  const nLines = net.lineOrder.length
  const k = (W - ML - MR - 2 * GAP * nLines) / net.length // px per pu of line
  const busX = {}, lineX = {}
  let x = ML
  busX[net.busOrder[0]] = x
  for (const id of net.lineOrder) {
    const l = net.lines[id]
    const x0 = x + GAP, x1 = x0 + l.length * k
    lineX[id] = { x0, x1 }
    x = x1 + GAP
    busX[l.to] = x
  }
  const first = net.busOrder[0], last = net.busOrder[net.busOrder.length - 1]
  function xs(s) {
    if (s < -EPS) return busX[first] - GAP + s * k
    if (s > net.length + EPS) return busX[last] + GAP + (s - net.length) * k
    for (const id of net.busOrder) if (Math.abs(s - net.buses[id].pos) <= EPS) return busX[id]
    for (const id of net.lineOrder) {
      const l = net.lines[id]
      if (s > l.p1 && s < l.p2) return lineX[id].x0 + (s - l.p1) * k
    }
    return busX[last]
  }
  // Coverage axis: piecewise linear, each line from its from-bus to its to-bus
  const lines = net.lineOrder.map(id => net.lines[id])
  const seg = l => (busX[l.to] - busX[l.from]) / (l.p2 - l.p1)
  function covX(s) {
    if (s <= lines[0].p1) return busX[lines[0].from] + (s - lines[0].p1) * seg(lines[0])
    for (const l of lines) if (s <= l.p2 + EPS) return busX[l.from] + (s - l.p1) * seg(l)
    const l = lines[lines.length - 1]
    return busX[l.to] + (s - l.p2) * seg(l)
  }
  return { xs, covX, busX, lineX }
}

function coverageLayout(relays) {
  const right = relays.filter(r => r.dir > 0).sort((a, b) => a.pos - b.pos)
  const left = relays.filter(r => r.dir < 0).sort((a, b) => a.pos - b.pos)
  const lanes = {}
  const groups = []
  let y = COV_TOP
  for (const [label, list] of [['Looking right →', right], ['← Looking left', left]]) {
    groups.push({ label, y })
    y += GROUP_HEAD
    for (const r of list) {
      lanes[r.id] = {}
      r.zones.forEach((z, i) => { lanes[r.id][z.id] = y + i * (ROW + ROW_GAP) })
      y += r.zones.length * (ROW + ROW_GAP) - ROW_GAP + LANE_GAP
    }
  }
  return { lanes, groups, bottom: y }
}

const SIGNAL_SHORT = { DCB: 'BLK', POTT: 'PERM', DCUB: 'PERM' }
const CHANNEL_STYLE = {
  ok:   { stroke: '#9ca3af', text: '' },
  out:  { stroke: '#dc2626', text: ' · OUT' },
  lost: { stroke: '#ea580c', text: ' · LOST' },
}

export default function CoordinationDiagram({ config, sim, state, scenario, faultLoc, onPickFault }) {
  const svgRef = useRef(null)
  const units = useUnits()
  const { net, pf } = sim
  const { xs, covX, busX, lineX } = makeScale(net)

  const relays = Object.entries(config.relays)
    .map(([id, r]) => ({ id, ...r, zones: activeZones(r, config), ...relayGeometry(net, r) }))
  const { lanes, groups, bottom } = coverageLayout(relays)
  const H = bottom + 22
  const dcDead = new Set(relays.filter(r => scenario?.dcLost?.includes(r.bus)).map(r => r.id))
  const oos = new Set([...(scenario?.relayOos ?? []), ...dcDead])
  const boxXOf = r => busX[r.bus] + r.dir * 34

  // Pilot channels: one per line running a scheme
  const channels = config.features?.pilot
    ? net.lineOrder.filter(id => config.schemes?.[id] && config.schemes[id] !== 'step').map(id => {
        const ends = relays.filter(r => r.line === id)
        return { id, scheme: config.schemes[id], ends, status: scenario?.channels?.[id] ?? 'ok' }
      })
    : []

  const conflicts = findConflicts(relays.filter(r => !oos.has(r.id)), config.timing.ctiCycles, units.fmtCyc, config)

  function handleLineClick(e, line) {
    const svg = svgRef.current
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    const { x0, x1 } = lineX[line.id]
    const frac = Math.min(0.99, Math.max(0.01, Math.round(((p.x - x0) / (x1 - x0)) * 100) / 100))
    onPickFault({ kind: 'line', line: line.id, frac })
  }

  const fx = xs(pf)
  const faultLive = state.faultEnergized

  // Line tap (feature 'tap'): drawn below the line at T; tap faults sit on it
  const tap = activeTap(net, config)
  const tx = tap ? xs(tap.pos) : 0
  const tapOpen = state.breakers?.tap === 'open'
  const marker = faultLoc?.kind === 'tap' ? { x: tx, y: OL_Y + Math.max(6, faultLoc.frac * TAP_LEAD) }
    : faultLoc?.kind === 'tapLV' ? { x: tx, y: TAP_LV_Y }
    : { x: fx, y: OL_Y }
  // Tap faults sit off the line, so the chain position (T) isn't the electrical
  // distance. Per relay facing T: ◇ true distance (to T + down the tap section,
  // + transformer for the LV bus) and ◆ the measured |Z| while the fault is on.
  const tapMarks = tap && (faultLoc?.kind === 'tap' || faultLoc?.kind === 'tapLV') ? relays
    .filter(r => !oos.has(r.id) && Math.sign(tap.pos - r.pos) === r.dir)
    .map(r => {
      const trueDist = Math.abs(tap.pos - r.pos) + tap.lead * (faultLoc.kind === 'tap' ? faultLoc.frac : 1) + (faultLoc.kind === 'tapLV' ? tap.zt : 0)
      const m = state.meas?.[r.id]
      const meas = faultLive && m?.Z && m.dir > 0 ? Math.hypot(m.Z.R, m.Z.X) : null
      // Off the chart (e.g. 110% on a single line) → pinned to the edge with an arrow
      const raw = meas === null ? null : covX(r.pos + r.dir * meas)
      const measX = raw === null ? null : Math.min(COV_R - 6, Math.max(COV_L + 6, raw))
      return { r, trueX: covX(r.pos + r.dir * trueDist), measX, offChart: raw !== null && raw !== measX, trueDist, meas }
    })
    : []

  function handleTapClick(e) {
    const svg = svgRef.current
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    onPickFault({ kind: 'tap', frac: Math.min(1, Math.max(0, Math.round(((p.y - OL_Y) / TAP_LEAD) * 20) / 20)) })
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img"
      aria-label="One-line diagram and zone coverage">
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#dc2626" strokeWidth="2" />
        </pattern>
        <clipPath id="covClip">
          <rect x={COV_L} y={COV_TOP - 10} width={COV_R - COV_L} height={bottom - COV_TOP + 22} />
        </clipPath>
      </defs>

      {/* ───────────── One-line ───────────── */}

      {/* Conductors: bus → CT → breaker → line (0%…100%) → breaker → CT → bus */}
      {net.lineOrder.map(id => {
        const l = net.lines[id]
        const { x0, x1 } = lineX[id]
        return (
          <g key={id}>
            <line x1={busX[l.from]} y1={OL_Y} x2={busX[l.to]} y2={OL_Y} stroke="#9ca3af" strokeWidth={3} />
            <line x1={x0} y1={OL_Y - 5} x2={x0} y2={OL_Y + 5} stroke="#9ca3af" strokeWidth={1} />
            <line x1={x1} y1={OL_Y - 5} x2={x1} y2={OL_Y + 5} stroke="#9ca3af" strokeWidth={1} />
            <text x={(x0 + x1) / 2} y={OL_Y - 26} textAnchor="middle" fontSize={11} fill="#6b7280">
              Line {l.from}–{l.to} · {l.length.toFixed(2)} pu
            </text>
            <rect x={x0} y={OL_Y - 14} width={x1 - x0} height={28}
              fill="transparent" className="cursor-crosshair" onClick={e => handleLineClick(e, l)}>
              <title>Click to place a fault on line {l.from}–{l.to}</title>
            </rect>
          </g>
        )
      })}

      {/* Line tap: tap section, transformer, low-voltage bus, load */}
      {tap && (
        <g>
          <line x1={tx} y1={OL_Y} x2={tx} y2={OL_Y + TAP_LEAD} stroke="#9ca3af" strokeWidth={3} />
          {faultLive && faultLoc?.kind === 'tap' && (
            <line x1={tx} y1={OL_Y} x2={tx} y2={marker.y} stroke="#f97316" strokeWidth={6} strokeOpacity={0.75} pointerEvents="none" />
          )}
          <circle cx={tx} cy={OL_Y + TAP_LEAD + 6} r={6} fill="white" stroke={tapOpen ? '#d1d5db' : '#4b5563'} strokeWidth={1.5} />
          <circle cx={tx} cy={OL_Y + TAP_LEAD + 15} r={6} fill="white" fillOpacity={0.6} stroke={tapOpen ? '#d1d5db' : '#4b5563'} strokeWidth={1.5} />
          <line x1={tx - 12} y1={TAP_LV_Y} x2={tx + 12} y2={TAP_LV_Y} stroke={tapOpen ? '#d1d5db' : '#1f2937'} strokeWidth={3} />
          <line x1={tx} y1={TAP_LV_Y} x2={tx} y2={TAP_LV_Y + 10} stroke={tapOpen ? '#d1d5db' : '#9ca3af'} strokeWidth={2} />
          <path d={`M ${tx - 4} ${TAP_LV_Y + 9} L ${tx + 4} ${TAP_LV_Y + 9} L ${tx} ${TAP_LV_Y + 15} Z`} fill={tapOpen ? '#d1d5db' : '#6b7280'} />
          <text x={tx + 9} y={OL_Y + 16} fontSize={10} fontWeight="700" fill="#4b5563">Tap T</text>
          <text x={tx + 15} y={TAP_LV_Y + 4} fontSize={9} fill="#9ca3af">{tapOpen ? 'tap protection opened' : 'load'}</text>
          <rect x={tx - 9} y={OL_Y + 4} width={18} height={TAP_LEAD - 2} fill="transparent" className="cursor-crosshair" onClick={handleTapClick}>
            <title>Click to place a fault on the tap section (unprotected: inside line {net.lines[tap.line].from}–{net.lines[tap.line].to}'s zone)</title>
          </rect>
          <rect x={tx - 14} y={TAP_LV_Y - 6} width={28} height={12} fill="transparent" className="cursor-crosshair" onClick={() => onPickFault({ kind: 'tapLV' })}>
            <title>Click to place a fault on the tap's low-voltage bus (behind the tap transformer)</title>
          </rect>
        </g>
      )}

      {/* Fault current paths (source → fault) */}
      {state.paths.map(p => (
        <line key={p.source} x1={xs(p.lo)} y1={OL_Y} x2={xs(p.hi)} y2={OL_Y}
          stroke="#f97316" strokeWidth={6} strokeOpacity={0.75} pointerEvents="none" />
      ))}

      {/* Sources */}
      {net.sources.map(id => {
        const live = state.paths.some(p => p.source === id)
        // Infeed at an intermediate bus: source hangs below the bus
        if (id !== net.busOrder[0] && id !== net.busOrder[net.busOrder.length - 1]) {
          const x = busX[id], y1 = OL_Y + 52
          return (
            <g key={`src${id}`}>
              <line x1={x} y1={OL_Y + 24} x2={x} y2={y1 - 14} stroke={live ? '#f97316' : '#9ca3af'} strokeWidth={live ? 5 : 3} />
              <circle cx={x} cy={y1} r={14} fill="white" stroke="#374151" strokeWidth={2} />
              <path d={`M ${x - 8} ${y1} q 4 -8 8 0 t 8 0`} fill="none" stroke="#374151" strokeWidth={2} />
            </g>
          )
        }
        const out = net.buses[id].pos < net.length / 2 ? -1 : 1
        const x0 = busX[id], x1 = x0 + out * 40
        return (
          <g key={`src${id}`}>
            <line x1={x0} y1={OL_Y} x2={x1 - out * 14} y2={OL_Y} stroke={live ? '#f97316' : '#9ca3af'} strokeWidth={live ? 5 : 3} />
            <circle cx={x1} cy={OL_Y} r={14} fill="white" stroke="#374151" strokeWidth={2} />
            <path d={`M ${x1 - 8} ${OL_Y} q 4 -8 8 0 t 8 0`} fill="none" stroke="#374151" strokeWidth={2} />
          </g>
        )
      })}

      {/* Buses (clickable) */}
      {net.busOrder.map(id => (
        <g key={`bus${id}`} className="cursor-crosshair" onClick={() => onPickFault({ kind: 'bus', bus: id })}>
          <rect x={busX[id] - 4} y={OL_Y - 24} width={8} height={48} fill="#1f2937" rx={1} />
          <text x={busX[id]} y={OL_Y - 30} textAnchor="middle" fontSize={12} fontWeight="700" fill="#1f2937">Bus {id}</text>
          {scenario?.dcLost?.includes(id) && relays.some(r => r.bus === id) && (
            <g>
              <rect x={busX[id] - 26} y={OL_Y - 59} width={52} height={14} rx={7} fill="#fef3c7" stroke="#b45309" />
              <text x={busX[id]} y={OL_Y - 49} textAnchor="middle" fontSize={9} fontWeight="700" fill="#b45309">DC LOST</text>
            </g>
          )}
          <title>Click to place a fault on Bus {id}</title>
        </g>
      ))}

      {/* CTs + relays (bus side), breakers (line side) */}
      {relays.map(r => {
        const b = busX[r.bus]
        const ctx = b + r.dir * CT_OFF
        const bx = b + r.dir * BKR_OFF
        const boxX = b + r.dir * 34
        const bstate = state.breakers[r.id]
        const zs = state.zones[r.id]
        const picked = r.zones.filter(z => ['picked', 'operated'].includes(zs[z.id]?.status))
        const tripInfo = state.tripped[r.id]
        const trip = !!state.tripped[r.id]
        // Out of service, or dead with its station's DC: greyed relay, and a
        // breaker with no trip supply is marked
        const dead = dcDead.has(r.id)
        const out = oos.has(r.id)
        const color = out ? '#9ca3af' : relayColor(r.id)
        return (
          <g key={`r${r.id}`}>
            {/* CT, wired down to its relay */}
            <circle cx={ctx} cy={OL_Y} r={4.5} fill="white" stroke="#374151" strokeWidth={1.5} />
            <path d={`M ${ctx} ${OL_Y + 5} L ${ctx} ${OL_Y + 15} L ${boxX} ${OL_Y + 22}`} fill="none" stroke="#9ca3af" strokeDasharray="2 2" />

            {/* Breaker: red = closed, green = open (US convention) */}
            <rect x={bx - 7} y={OL_Y - 7} width={14} height={14} rx={2}
              fill={bstate === 'open' ? 'white' : '#dc2626'}
              stroke={bstate === 'open' ? '#16a34a' : '#7f1d1d'} strokeWidth={2.5} />
            {bstate === 'failed' && (
              <path d={`M ${bx - 5} ${OL_Y - 5} L ${bx + 5} ${OL_Y + 5} M ${bx + 5} ${OL_Y - 5} L ${bx - 5} ${OL_Y + 5}`}
                stroke="white" strokeWidth={2.5} />
            )}
            {dead && (
              <circle cx={bx} cy={OL_Y} r={11} fill="none" stroke="#b45309" strokeWidth={1.5} strokeDasharray="3 2">
                <title>No trip supply (station DC lost): 52-{r.id} cannot open</title>
              </circle>
            )}
            <text x={bx} y={OL_Y - 11 - (dead ? 3 : 0)} textAnchor="middle" fontSize={9} fill={dead ? '#b45309' : '#6b7280'} fontWeight={dead ? 700 : 400}>52</text>

            {/* Relay */}
            <rect x={boxX - 25} y={OL_Y + 22} width={50} height={20} rx={4}
              fill={trip ? color : out ? '#f3f4f6' : 'white'} stroke={color} strokeWidth={picked.length ? 3 : 1.5}
              strokeDasharray={out ? '3 2' : undefined} />
            <text x={boxX} y={OL_Y + 36} textAnchor="middle" fontSize={11} fontWeight="700"
              fill={trip ? 'white' : color}>21-{r.id}</text>
            <text x={boxX} y={OL_Y + 55} textAnchor="middle" fontSize={10} fontWeight="600" fill={dead ? '#b45309' : color}>
              {dead ? 'NO DC' : out ? 'OUT' : trip
                ? `TRIP ${tripInfo.logic && tripInfo.logic !== 'step' ? tripInfo.logic : `Z${tripInfo.zoneId}`}`
                : picked.map(zoneLabel).join(' ') + (picked.length ? ' PU' : '')}
            </text>
            <path d={`M ${boxX + r.dir * 29} ${OL_Y + 32} l ${-r.dir * 6} -4 v 8 z`} fill={color} />
          </g>
        )
      })}

      {/* Pilot channels (relay ↔ relay), with keyed / received signals */}
      {channels.map(ch => {
        const [a, b] = ch.ends
        const xa = boxXOf(a), xb = boxXOf(b)
        const style = CHANNEL_STYLE[ch.status]
        return (
          <g key={`ch${ch.id}`}>
            <line x1={xa} y1={CH_Y} x2={xb} y2={CH_Y} stroke={style.stroke} strokeWidth={1.5} strokeDasharray="6 4" />
            <circle cx={xa} cy={CH_Y} r={2.5} fill={style.stroke} />
            <circle cx={xb} cy={CH_Y} r={2.5} fill={style.stroke} />
            <rect x={(xa + xb) / 2 - 40} y={CH_Y - 8} width={80} height={16} rx={8} fill="white" stroke={style.stroke} />
            <text x={(xa + xb) / 2} y={CH_Y + 4} textAnchor="middle" fontSize={10} fontWeight="700" fill={ch.status === 'ok' ? '#4b5563' : style.stroke}>
              {ch.scheme}{style.text}
            </text>
            {[a, b].map(r => {
              const x = boxXOf(r) + r.dir * 30
              const anchor = r.dir > 0 ? 'start' : 'end'
              return (
                <g key={r.id}>
                  {state.tx?.[r.id] && (
                    <text x={x} y={CH_Y - 4} textAnchor={anchor} fontSize={9} fontWeight="700" fill={relayColor(r.id)}>
                      TX {SIGNAL_SHORT[ch.scheme]} {r.dir > 0 ? '→' : '←'}
                    </text>
                  )}
                  {state.rx?.[r.id] && (
                    <text x={x} y={CH_Y + 12} textAnchor={anchor} fontSize={9} fontWeight="700" fill="#4f46e5">
                      RX {SIGNAL_SHORT[ch.scheme]}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}

      {/* Fault marker */}
      <path pointerEvents="none"
        transform={`translate(${marker.x - fx} ${marker.y - OL_Y})`}
        d={`M ${fx + 3} ${OL_Y - 26} L ${fx - 6} ${OL_Y - 4} L ${fx + 1} ${OL_Y - 4} L ${fx - 4} ${OL_Y + 14} L ${fx + 8} ${OL_Y - 9} L ${fx + 1} ${OL_Y - 9} Z`}
        fill={faultLive ? '#dc2626' : '#9ca3af'} stroke="white" strokeWidth={1} />

      {/* ───────────── Zone coverage ───────────── */}

      <text x={8} y={COV_TOP - 12} fontSize={11} fontWeight="700" fill="#374151">Zone coverage</text>
      <text x={W - 8} y={COV_TOP - 12} textAnchor="end" fontSize={10} fill="#9ca3af">
        {tapMarks.length ? '◇ true distance to the fault · ◆ what the relay measures' : 'from each relay\'s bus · reach = % of own line, bus to bus'}
      </text>

      {/* Bus and line-terminal gridlines */}
      {net.busOrder.map(id => (
        <g key={`g${id}`}>
          <line x1={busX[id]} y1={COV_TOP} x2={busX[id]} y2={bottom} stroke="#d1d5db" strokeWidth={1} />
          <text x={busX[id]} y={H - 6} textAnchor="middle" fontSize={11} fontWeight="600" fill="#6b7280">{id}</text>
        </g>
      ))}

      {tap && (
        <g>
          <line x1={covX(tap.pos)} y1={COV_TOP} x2={covX(tap.pos)} y2={bottom} stroke="#d1d5db" strokeWidth={1} strokeDasharray="2 3" />
          <text x={covX(tap.pos)} y={H - 6} textAnchor="middle" fontSize={10} fontWeight="600" fill="#9ca3af">T</text>
        </g>
      )}

      {groups.map(g => (
        <text key={g.label} x={ML - 8} y={g.y + 10} textAnchor="end" fontSize={10} fontWeight="600" fill="#9ca3af">{g.label}</text>
      ))}

      {relays.map(r => {
        const color = relayColor(r.id)
        // Every zone starts at the relay's own bus (0% of its line); forward
        // zones run along the line, reverse zones back across the bus
        const origin = busX[r.bus]
        const firstY = lanes[r.id][r.zones[0].id]
        if (oos.has(r.id)) {
          return (
            <g key={`cov${r.id}`}>
              <text x={ML - 8} y={firstY + ROW + 4} textAnchor="end" fontSize={11} fontWeight="700" fill="#9ca3af">21-{r.id}</text>
              <text x={origin + r.dir * 6} y={firstY + ROW + 4} textAnchor={r.dir > 0 ? 'start' : 'end'}
                fontSize={10} fontStyle="italic" fill="#9ca3af">{dcDead.has(r.id) ? 'station DC lost — relay dead, breaker cannot trip' : 'relay out of service — no coverage'}</text>
            </g>
          )
        }
        return (
          <g key={`cov${r.id}`}>
            <text x={ML - 8} y={firstY + ROW + 4} textAnchor="end" fontSize={11} fontWeight="700" fill={color}>21-{r.id}</text>
            <g clipPath="url(#covClip)">
              {r.zones.map(z => {
                const rev = isReverse(z)
                const dir = rev ? -r.dir : r.dir
                const start = origin
                const y = lanes[r.id][z.id]
                if (y === undefined) return null
                const zs = state.zones[r.id][z.id]
                const on = z.enabled && z.reach > 0
                const end = on ? covX(r.pos + dir * zoneReachPu(z, r.lineLength)) : start
                const active = zs.status === 'picked' || zs.status === 'operated'
                const label = on
                  ? `${zoneLabel(z)} ${z.reach}%${rev ? ' reverse' : z.delayCycles > 0 ? ` · ${units.fmtCyc(z.delayCycles)}` : ''}`
                  : `${zoneLabel(z)} off`
                return (
                  <g key={z.id}>
                    {on && (
                      <rect x={Math.min(start, end)} y={y} width={Math.abs(end - start)} height={ROW} rx={2}
                        fill={color} fillOpacity={active ? 0.75 : z.id === 1 ? 0.45 : 0.2}
                        stroke={color} strokeWidth={active ? 2 : 1} strokeDasharray={rev ? '3 2' : undefined} />
                    )}
                    {(() => {
                      const lp = zoneLabelPos(end, dir, `${label}${zs.status === 'operated' ? ' ✓' : ''}`)
                      return (
                        <text x={lp.x} y={y + ROW - 1} textAnchor={lp.anchor}
                          fontSize={9} fontWeight="600" fill={on ? color : '#9ca3af'}>
                          {lp.text}
                        </text>
                      )
                    })()}
                  </g>
                )
              })}
              {conflicts.filter(c => c.rid === r.id).map((c, i) => (
                <rect key={i} x={Math.min(covX(c.s0), covX(c.s1))} y={lanes[r.id][c.zoneId] - 2}
                  width={Math.abs(covX(c.s1) - covX(c.s0))} height={ROW + 4}
                  fill="url(#hatch)" stroke="#dc2626" strokeWidth={1}>
                  <title>{c.text}</title>
                </rect>
              ))}
            </g>
          </g>
        )
      })}

      {/* Tap faults: true vs measured distance on each relay's lane */}
      <g clipPath="url(#covClip)" pointerEvents="none">
        {tapMarks.map(({ r, trueX, measX, offChart, trueDist, meas }) => {
          const ys = r.zones.map(z => lanes[r.id][z.id]).filter(y => y !== undefined)
          const top = Math.min(...ys) - 3, bot = Math.max(...ys) + ROW + 3
          const pctOf = d => `${Math.round(d / r.lineLength * 100)}%`
          // In the relay's own colour and named, so remote relays' markers
          // (e.g. 21-YB looking through B toward the tap) aren't misread
          const c = relayColor(r.id)
          return (
            <g key={`tm${r.id}`}>
              <line x1={trueX} y1={top} x2={trueX} y2={bot} stroke={c} strokeWidth={1.5} strokeDasharray="3 2" />
              {/* ◇ and its label below the lane, ◆ above: they never collide */}
              <path d={`M ${trueX} ${bot} l 4 4 l -4 4 l -4 -4 z`} fill="white" stroke={c} strokeWidth={1.5} />
              <text x={trueX + r.dir * -6} y={bot + 7} textAnchor={r.dir > 0 ? 'end' : 'start'} fontSize={9} fontWeight="600" fill={c}>21-{r.id} true {pctOf(trueDist)}</text>
              {measX !== null && (
                <g>
                  <line x1={measX} y1={top} x2={measX} y2={bot} stroke={c} strokeWidth={2} />
                  <path d={`M ${measX} ${top - 7} l 4 4 l -4 4 l -4 -4 z`} fill={c} />
                  <text x={measX + r.dir * (offChart ? -8 : 6)} y={top - 1} textAnchor={(r.dir > 0) !== offChart ? 'start' : 'end'} fontSize={9} fontWeight="700" fill={c}>
                    {offChart && r.dir < 0 ? '◂ ' : ''}21-{r.id} measured {pctOf(meas)}{offChart && r.dir > 0 ? ' ▸' : ''}
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </g>

      {/* Fault position through the coverage lanes */}
      {/* The coverage axis runs bus to bus, so the fault sits a little off the
          one-line marker: a faint connector ties the two together */}
{tapMarks.length === 0 && (
      <line x1={marker.x} y1={marker.y + 16} x2={covX(pf)} y2={COV_TOP} stroke="#dc2626" strokeWidth={1} strokeDasharray="2 3" opacity={0.35} pointerEvents="none" />
      )}
      {tapMarks.length === 0 && (
        <line x1={covX(pf)} y1={COV_TOP} x2={covX(pf)} y2={bottom} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.7} pointerEvents="none" />
      )}
    </svg>
  )
}
