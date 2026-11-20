import { abs } from '../lib/complex'
import { relayColor } from '../lib/colors'
import { baseAmps, BAY_BASE, instrumentFaults } from '../lib/instruments'
import { busDiffElement, busCtId } from '../lib/busdiff'
import { CtSymbol, TerminalBlock } from './Symbols'

// Bus B drawn as a station: every feeder bay hangs off the bus with its line
// relay's CT (bus side), breaker and 87B CT (line side). Each 87B CT's
// secondary runs to the 87B relay, which adds them up: what goes in must come
// out. Live from the playback snapshot; a reversed CT is drawn in red.

const W = 760, H = 330
const BUS_Y = 46
const CT_Y = 92, BKR_Y = 132, BCT_Y = 172, END_Y = 214
const RLY = { x: 230, y: 258, w: 300, h: 60 }

const C = { wire: '#9ca3af', fault: '#ea580c', bad: '#dc2626', zone: '#7c3aed', text: '#374151', dim: '#9ca3af', closed: '#dc2626', open: '#16a34a' }
const amps = x => (x >= 1000 ? `${(x / 1000).toFixed(2)} kA` : `${x.toFixed(0)} A`)


export default function BusDiagram({ config, sim, state, scenario, zone, faultLoc }) {
  const el = busDiffElement(state.meas, zone, instrumentFaults(config, scenario), config.busdiff)
  const Ib = baseAmps()
  const n = zone.feeders.length
  const xs = zone.feeders.map((_, i) => 160 + (i * (W - 320)) / Math.max(1, n - 1))
  const faultOnBus = faultLoc.kind === 'bus' && faultLoc.bus === zone.bus && state.faultEnergized
  const op = state.bus87?.op
  const tripped = zone.feeders.some(id => state.tripped?.[id]?.logic === '87B')
  const ph = el.phases.reduce((w, p) => (p.Iop > w.Iop ? p : w))
  const s = { pickupPu: 0.2, slopePct: 50, ...config.busdiff }
  const lineTo = rid => { const r = config.relays[rid]; const l = config.network.lines.find(x => x.id === r.line); return l.from === zone.bus ? l.to : l.from }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label={`Bus ${zone.bus} with its feeder breakers, CTs and bus differential relay`}>
      {/* The 87B zone: from the bus out to each 87B CT */}
      <rect x={60} y={BUS_Y - 22} width={W - 120} height={BCT_Y + 16 - (BUS_Y - 22)} rx={8} fill={op ? '#fee2e2' : 'none'} fillOpacity={0.4}
        stroke={op || tripped ? C.bad : C.zone} strokeDasharray="6 4" />
      <text x={W - 64} y={BUS_Y - 8} textAnchor="end" fontSize={11} fontWeight={700} fill={op || tripped ? C.bad : C.zone}>87B zone</text>

      {/* Bus */}
      <line x1={80} y1={BUS_Y} x2={W - 80} y2={BUS_Y} stroke={faultOnBus ? C.fault : '#111827'} strokeWidth={6} />
      <text x={80} y={BUS_Y - 10} fontSize={12} fontWeight={700} fill={C.text}>Bus {zone.bus}</text>
      {faultOnBus && <path d={`M ${W / 2 - 5} ${BUS_Y - 24} l 9 13 l -6 2 l 8 15 l -13 -14 l 6 -2 z`} fill={C.fault} />}

      {zone.feeders.map((rid, i) => {
        const x = xs[i]
        const f = el.feeders[i]
        const m = state.meas?.[rid]
        const Itrue = m?.prim ? abs(m.prim.Iabc[0]) : 0
        const lineRev = !!scenario.ctReversed?.[rid]
        const busRev = !!scenario.ctReversed?.[busCtId(rid)]
        const bkr = state.breakers[rid]
        const live = Itrue * Ib > 1
        // Actual direction: a correctly wired relay's directional call during a fault (forward = out of
        // the bus into the line); on load, the power-flow sense of the current against the bus voltage
        const V = m?.prim?.Vabc[0]
        const I = m?.prim?.Iabc[0]
        const out = m?.prim?.dir ? m.prim.dir > 0
          : V && I && abs(V) > 1e-6 ? (V.re * I.re + V.im * I.im) > 0 : null
        const flowColor = state.faultEnergized && live ? C.fault : '#6b7280'
        return (
          <g key={rid}>
            <line x1={x} y1={BUS_Y} x2={x} y2={END_Y} stroke={flowColor} strokeWidth={3} />
            {/* Line relay CT, bus side: polarity mark toward the bus */}
            <CtSymbol x={x} y={CT_Y} orient="v" side={1} dot={-1} />
            <text x={x + 20} y={CT_Y + 4} fontSize={10} fill={lineRev ? C.bad : C.text}>to 21-{rid}{lineRev ? ' (leads swapped)' : ''}</text>
            {/* Breaker */}
            <rect x={x - 14} y={BKR_Y - 12} width={28} height={24} fill={bkr === 'open' ? '#fff' : C.closed} stroke={bkr === 'open' ? C.open : C.closed} strokeWidth={2.5} />
            {bkr === 'failed' && <circle cx={x} cy={BKR_Y} r={20} fill="none" stroke={C.bad} strokeWidth={2} strokeDasharray="4 3" />}
            <text x={x + 18} y={BKR_Y + 4} fontSize={11} fontWeight={700} fill={C.text}>52-{rid}</text>
            {/* 87B CT, line side: polarity mark toward the line (current into the bus is positive) */}
            <CtSymbol x={x} y={BCT_Y} orient="v" side={-1} dot={1} color={C.zone} />
            <text x={x + 10} y={BCT_Y + 4} fontSize={10} fill={C.zone}>87B CT</text>
            {/* Feeder end + actual current */}
            <text x={x + 8} y={END_Y + 4} fontSize={11} fontWeight={700} fill={relayColor(rid)}>line to {lineTo(rid)}</text>
            {live && out !== null && (
              <g>
                <path d={out ? `M ${x - 26} ${CT_Y + 40} v 18 l -4 -7 m 4 7 l 4 -7` : `M ${x - 26} ${CT_Y + 58} v -18 l -4 7 m 4 -7 l 4 7`} stroke={flowColor} strokeWidth={2} fill="none" />
                <text x={x - 32} y={CT_Y + 52} textAnchor="end" fontSize={10} fontWeight={600} fill={flowColor}>{amps(Itrue * Ib)} {out ? 'out' : 'in'}</text>
              </g>
            )}
            {/* 87B CT secondary → relay, labelled with what the relay is told */}
            <line x1={x - 8} y1={BCT_Y} x2={x - 30} y2={BCT_Y} stroke={C.zone} />
            <polyline points={`${x - 30},${BCT_Y} ${x - 30},${BCT_Y + 8}`} fill="none" stroke={C.zone} />
            <TerminalBlock x={x - 30} y={BCT_Y + 8} orient="v" crossed={busRev} color={C.zone} />
            {busRev && <text x={x - 40} y={BCT_Y + 24} textAnchor="end" fontSize={10} fontWeight={700} fill={C.bad} stroke="#fff" strokeWidth={3} paintOrder="stroke">leads swapped</text>}
            <polyline points={`${x - 30},${BCT_Y + 32} ${x - 30},${RLY.y - 14} ${RLY.x + 40 + i * ((RLY.w - 80) / Math.max(1, n - 1))},${RLY.y - 14} ${RLY.x + 40 + i * ((RLY.w - 80) / Math.max(1, n - 1))},${RLY.y}`}
              fill="none" stroke={busRev ? C.bad : C.zone} strokeDasharray="3 2" />
            <text x={RLY.x + 40 + i * ((RLY.w - 80) / Math.max(1, n - 1)) + 4} y={RLY.y - 18} fontSize={10} fill={busRev ? C.bad : C.text}>
              {amps(abs(f.I[0]) * Ib)} in ({(abs(f.I[0]) * Ib / BAY_BASE.ctRatio).toFixed(1)} A sec)
            </text>
            <title>52-{rid}: line relay CT on the bus side, 87B CT on the line side; the zones overlap across the breaker</title>
          </g>
        )
      })}

      {/* 87B relay */}
      <rect x={RLY.x} y={RLY.y} width={RLY.w} height={RLY.h} rx={8} fill="#fff" stroke={op || tripped ? C.bad : C.zone} strokeWidth={2} />
      <text x={RLY.x + 10} y={RLY.y + 18} fontSize={13} fontWeight={700} fill={C.zone}>87B bus {zone.bus}</text>
      <text x={RLY.x + RLY.w - 10} y={RLY.y + 18} textAnchor="end" fontSize={11} fontWeight={700} fill={tripped ? C.bad : op ? C.bad : C.dim}>
        {tripped ? 'TRIP all bus breakers' : op ? 'OPERATE' : 'restrain'}
      </text>
      <text x={RLY.x + 10} y={RLY.y + 36} fontSize={11} fill={C.text}>Σ I = {amps(ph.Iop * Ib)} (operate) · Σ|I| = {amps(ph.Ires * Ib)} (restraint)</text>
      <text x={RLY.x + 10} y={RLY.y + 52} fontSize={10} fill={C.dim}>
        trips above {amps(s.pickupPu * Ib)} and {s.slopePct}% of restraint · now {ph.Ires * Ib > 1 ? Math.round((ph.Iop / ph.Ires) * 100) : 0}%
      </text>
    </svg>
  )
}
