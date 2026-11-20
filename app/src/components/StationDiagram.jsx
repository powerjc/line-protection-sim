import { abs } from '../lib/complex'
import { relayColor } from '../lib/colors'
import { baseAmps, BAY_BASE, instrumentFaults } from '../lib/instruments'
import { busZone, busDiffElement, busCtId } from '../lib/busdiff'
import { zoneLabel } from '../lib/protection'
import { CtSymbol, TerminalBlock } from './Symbols'

// One substation: its bus and every bay hanging off it. Each feeder bay has the
// line relay's CT (bus side, polarity mark toward the bus), its breaker and the
// line it feeds, with the relay's status beside its CT. A source bay where the
// bus is a source. The station battery feeds every relay and trip circuit (click
// it to fail it). With bus differential (87B) on this bus: the 87B CTs on the
// line side of each breaker, wired to the 87B relay that adds them up.

const W = 760
const BUS_Y = 46
const CT_Y = 92, BKR_Y = 132, BCT_Y = 172, END_Y = 214
const RLY = { x: 230, y: 258, w: 300, h: 60 }

const C = { wire: '#9ca3af', fault: '#ea580c', bad: '#dc2626', zone: '#7c3aed', text: '#374151', dim: '#9ca3af', closed: '#dc2626', open: '#16a34a', dc: '#d97706' }
const amps = x => (x >= 1000 ? `${(x / 1000).toFixed(2)} kA` : `${x.toFixed(0)} A`)

function Bolt({ x, y }) {
  return <path d={`M ${x - 5} ${y} l 9 13 l -6 2 l 8 15 l -13 -14 l 6 -2 z`} fill={C.fault} />
}

export default function StationDiagram({ config, sim, state, scenario, bus, faultLoc, onToggleDc }) {
  const z = busZone(sim.net, config)
  const zone = z && z.bus === bus ? z : null
  const H = zone ? 330 : 262
  const Ib = baseAmps()
  // Feeders: lines to the left first, then to the right
  const feeders = Object.keys(config.relays).filter(id => config.relays[id].bus === bus)
    .sort((a, b) => lineDir(a) - lineDir(b))
  function lineDir(rid) {
    const l = sim.net.lines[config.relays[rid].line]
    const far = l.from === bus ? l.to : l.from
    return Math.sign(sim.net.buses[far].pos - sim.net.buses[bus].pos)
  }
  const source = !!sim.net.buses[bus]?.source
  const bays = [...feeders.map(rid => ({ rid })), ...(source ? [{ source: true }] : [])]
  const n = bays.length
  const xs = bays.map((_, i) => (n === 1 ? W / 2 : 180 + (i * (W - 400)) / (n - 1)))
  const el = zone ? busDiffElement(state.meas, zone, instrumentFaults(config, scenario), config.busdiff) : null
  const op = state.bus87?.op
  const tripped87 = zone && zone.feeders.some(id => state.tripped?.[id]?.logic === '87B')
  const ph = el?.phases.reduce((w, p) => (p.Iop > w.Iop ? p : w))
  const s = { pickupPu: 0.2, slopePct: 50, ...config.busdiff }
  const dcLost = !!scenario.dcLost?.includes(bus)
  const faultOnBus = faultLoc.kind === 'bus' && faultLoc.bus === bus && state.faultEnergized
  const lineTo = rid => { const l = sim.net.lines[config.relays[rid].line]; return l.from === bus ? l.to : l.from }
  const relayX = i => RLY.x + 40 + i * ((RLY.w - 80) / Math.max(1, (zone?.feeders.length ?? 1) - 1))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label={`Station ${bus}: its bus, feeder breakers, CTs and relays`}>
      {zone && <>
        {/* The 87B zone: from the bus out to each 87B CT */}
        <rect x={60} y={BUS_Y - 22} width={W - 120} height={BCT_Y + 16 - (BUS_Y - 22)} rx={8} fill={op ? '#fee2e2' : 'none'} fillOpacity={0.4}
          stroke={op || tripped87 ? C.bad : C.zone} strokeDasharray="6 4" />
        <text x={W - 64} y={BUS_Y - 8} textAnchor="end" fontSize={11} fontWeight={700} fill={op || tripped87 ? C.bad : C.zone}>87B zone</text>
      </>}

      {/* Bus */}
      <line x1={80} y1={BUS_Y} x2={W - 80} y2={BUS_Y} stroke={faultOnBus ? C.fault : '#111827'} strokeWidth={6} />
      <text x={80} y={BUS_Y - 10} fontSize={12} fontWeight={700} fill={C.text}>Bus {bus}</text>
      {faultOnBus && <Bolt x={W / 2} y={BUS_Y - 24} />}

      {bays.map((bay, i) => {
        const x = xs[i]
        if (bay.source) {
          return (
            <g key="source">
              <line x1={x} y1={BUS_Y} x2={x} y2={END_Y - 26} stroke="#6b7280" strokeWidth={3} />
              <circle cx={x} cy={END_Y - 12} r={14} fill="#fff" stroke="#374151" strokeWidth={2} />
              <path d={`M ${x - 8} ${END_Y - 12} q 4 -8 8 0 t 8 0`} fill="none" stroke="#374151" strokeWidth={1.6} />
              <text x={x} y={END_Y + 20} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.text}>source</text>
              <text x={x} y={END_Y + 33} textAnchor="middle" fontSize={10} fill={C.dim}>no breaker in this model</text>
            </g>
          )
        }
        const rid = bay.rid
        const r = config.relays[rid]
        const m = state.meas?.[rid]
        const Itrue = m?.prim ? abs(m.prim.Iabc[0]) : 0
        const lineRev = !!scenario.ctReversed?.[rid]
        const busRev = !!scenario.ctReversed?.[busCtId(rid)]
        const bkr = state.breakers[rid]
        const live = Itrue * Ib > 1
        // Actual direction: a correctly wired relay's directional call during a fault (forward = out of
        // the bus into the line); on load, the power-flow sense of the current against the bus voltage
        const V = m?.prim?.Vabc[0], I = m?.prim?.Iabc[0]
        const out = m?.prim?.dir ? m.prim.dir > 0 : V && I && abs(V) > 1e-6 ? (V.re * I.re + V.im * I.im) > 0 : null
        const flowColor = state.faultEnergized && live ? C.fault : '#6b7280'
        // Relay status beside its CT
        const oos = scenario.relayOos?.includes(rid) || dcLost
        const t = state.tripped?.[rid]
        const picked = r.zones.filter(zz => ['picked', 'operated'].includes(state.zones[rid]?.[zz.id]?.status))
        const status = dcLost ? 'NO DC' : oos ? 'OUT' : t ? (t.logic === '87B' ? 'TRIP 87B' : `TRIP ${t.logic && t.logic !== 'step' ? t.logic : `Z${t.zoneId}`}`) : state.lop?.[rid] ? 'LOP' : picked.length ? `${picked.map(zoneLabel).join(' ')} PU` : ''
        const faultOnLine = faultLoc.kind === 'line' && faultLoc.line === r.line && state.faultEnergized
        const fi = zone ? zone.feeders.indexOf(rid) : -1
        const f = fi >= 0 ? el.feeders[fi] : null
        return (
          <g key={rid}>
            <line x1={x} y1={BUS_Y} x2={x} y2={END_Y} stroke={flowColor} strokeWidth={3} />
            {/* Line relay CT, bus side: polarity mark toward the bus; the relay's tag beside it */}
            <CtSymbol x={x} y={CT_Y} orient="v" side={1} dot={-1} />
            <g>
              <rect x={x + 20} y={CT_Y - 11} width={92} height={20} rx={4} fill={oos ? '#f3f4f6' : '#fff'} stroke={relayColor(rid)} strokeWidth={1.5} />
              <text x={x + 26} y={CT_Y + 3} fontSize={10.5} fontWeight={700} fill={relayColor(rid)}>21-{rid}</text>
              <text x={x + 106} y={CT_Y + 3} textAnchor="end" fontSize={9.5} fontWeight={700} fill={t ? C.bad : '#b45309'}>{status}</text>
            </g>
            {lineRev && <text x={x + 20} y={CT_Y + 22} fontSize={10} fontWeight={700} fill={C.bad}>CT leads swapped</text>}
            {/* Breaker */}
            <rect x={x - 14} y={BKR_Y - 12} width={28} height={24} fill={bkr === 'open' ? '#fff' : C.closed} stroke={bkr === 'open' ? C.open : C.closed} strokeWidth={2.5} />
            {bkr === 'failed' && <circle cx={x} cy={BKR_Y} r={20} fill="none" stroke={C.bad} strokeWidth={2} strokeDasharray="4 3" />}
            <text x={x + 18} y={BKR_Y + 4} fontSize={11} fontWeight={700} fill={C.text}>52-{rid}</text>
            {/* Feeder end + actual current */}
            <text x={x + 8} y={END_Y + 4} fontSize={11} fontWeight={700} fill={relayColor(rid)}>line to {lineTo(rid)}</text>
            {faultOnLine && <><Bolt x={x - 2} y={END_Y + 8} /><text x={x + 8} y={END_Y + 18} fontSize={10} fill={C.fault}>fault on this line</text></>}
            {live && out !== null && (
              <g>
                <path d={out ? `M ${x - 26} ${CT_Y + 40} v 18 l -4 -7 m 4 7 l 4 -7` : `M ${x - 26} ${CT_Y + 58} v -18 l -4 7 m 4 -7 l 4 7`} stroke={flowColor} strokeWidth={2} fill="none" />
                <text x={x - 32} y={CT_Y + 52} textAnchor="end" fontSize={10} fontWeight={600} fill={flowColor}>{amps(Itrue * Ib)} {out ? 'out' : 'in'}</text>
              </g>
            )}
            {f && <>
              {/* 87B CT, line side: polarity mark toward the line (current into the bus is positive) */}
              <CtSymbol x={x} y={BCT_Y} orient="v" side={-1} dot={1} color={C.zone} />
              <text x={x + 10} y={BCT_Y + 4} fontSize={10} fill={C.zone}>87B CT</text>
              <line x1={x - 8} y1={BCT_Y} x2={x - 30} y2={BCT_Y} stroke={C.zone} />
              <polyline points={`${x - 30},${BCT_Y} ${x - 30},${BCT_Y + 8}`} fill="none" stroke={C.zone} />
              <TerminalBlock x={x - 30} y={BCT_Y + 8} orient="v" crossed={busRev} color={C.zone} />
              {busRev && <text x={x - 40} y={BCT_Y + 24} textAnchor="end" fontSize={10} fontWeight={700} fill={C.bad} stroke="#fff" strokeWidth={3} paintOrder="stroke">leads swapped</text>}
              <polyline points={`${x - 30},${BCT_Y + 32} ${x - 30},${RLY.y - 14} ${relayX(fi)},${RLY.y - 14} ${relayX(fi)},${RLY.y}`}
                fill="none" stroke={busRev ? C.bad : C.zone} strokeDasharray="3 2" />
              <text x={relayX(fi) + 4} y={RLY.y - 18} fontSize={10} fill={busRev ? C.bad : C.text}>
                {amps(abs(f.I[0]) * Ib)} ∠{Math.round(Math.atan2(f.I[0].im, f.I[0].re) * 180 / Math.PI)}° ({(abs(f.I[0]) * Ib / BAY_BASE.ctRatio).toFixed(1)} A sec)
              </text>
            </>}
            <title>52-{rid}: the line relay’s CT on the bus side of the breaker{zone ? ', the 87B CT on the line side: the zones overlap across the breaker' : ''}</title>
          </g>
        )
      })}

      {/* Station battery: feeds every relay and trip circuit here */}
      <g onClick={onToggleDc ? () => onToggleDc(bus) : undefined} className={onToggleDc ? 'cursor-pointer' : undefined}>
        <title>Station {bus} DC supply: every relay and breaker trip circuit here runs on it. Click to {dcLost ? 'restore' : 'fail'} it.</title>
        {/* Bottom left, clear of the bays */}
        {[0, 1, 2, 3].map(k => <line key={k} x1={24 + k * 8} y1={k % 2 ? H - 30 : H - 34} x2={24 + k * 8} y2={k % 2 ? H - 22 : H - 18} stroke={dcLost ? C.bad : C.dc} strokeWidth={2} />)}
        <text x={20} y={H - 42} fontSize={10} fontWeight={700} fill={dcLost ? C.bad : C.dc}>{dcLost ? 'DC LOST' : '125 V DC'}</text>
        <text x={58} y={H - 22} fontSize={9} fill={C.dim}>station battery (click)</text>
      </g>

      {zone && <>
        {/* 87B relay */}
        <rect x={RLY.x} y={RLY.y} width={RLY.w} height={RLY.h} rx={8} fill="#fff" stroke={op || tripped87 ? C.bad : C.zone} strokeWidth={2} />
        <text x={RLY.x + 10} y={RLY.y + 18} fontSize={13} fontWeight={700} fill={C.zone}>87B bus {bus}</text>
        <text x={RLY.x + RLY.w - 10} y={RLY.y + 18} textAnchor="end" fontSize={11} fontWeight={700} fill={tripped87 || op ? C.bad : C.dim}>
          {dcLost ? 'NO DC' : tripped87 ? 'TRIP all bus breakers' : op ? 'OPERATE' : 'restrain'}
        </text>
        <text x={RLY.x + 10} y={RLY.y + 36} fontSize={11} fill={C.text}>Σ I = {amps(ph.Iop * Ib)} (operate) · Σ|I| = {amps(ph.Ires * Ib)} (restraint)</text>
        <text x={RLY.x + 10} y={RLY.y + 52} fontSize={10} fill={C.dim}>
          trips above {amps(s.pickupPu * Ib)} and {s.slopePct}% of restraint · now {ph.Ires * Ib > 1 ? Math.round((ph.Iop / ph.Ires) * 100) : 0}%
        </text>
      </>}
    </svg>
  )
}
