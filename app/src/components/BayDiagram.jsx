import { abs } from '../lib/complex'
import { relayGeometry, faultPosition, isTapFault } from '../lib/network'
import { zoneLabel } from '../lib/protection'
import { relayColor } from '../lib/colors'
import { BAY_BASE, baseAmps, relayInstruments } from '../lib/instruments'
import { busZone, busCtId } from '../lib/busdiff'
import { CtSymbol, VtSymbol, TerminalBlock } from './Symbols'

// One terminal drawn as a station bay: bus → bus VT tap → CT → breaker 52
// (trip coil, 52a) → line. The line relay's CT sits on the bus side of the
// breaker, so a bus zone using CTs on the line side would overlap it across
// the breaker. The VT is a bus VT (the engine measures voltage at the bus), and the relay with its inputs (CT and
// VT secondaries, 52a), its output (trip → trip coil), station DC and the
// channel to the remote terminal. Live from the playback snapshot; each
// device scrolls to its chain card when clicked.

const W = 760, H = 318
const OL = 70            // conductor y
const BUS_X = 56
const BKR_X = 236        // breaker centre
const CT_X = 156         // bus side of the breaker
const TB_X = 252          // CT secondary terminal block, in front of the relay
const BCT_X = 296        // 87B CT: line side of the breaker (when bus differential covers this bus)
const VT_X = 96           // bus VT: tapped between the bus and the breaker
const VTW_X = 400         // where the VT secondary enters the relay
const LINE_X0 = 450, LINE_X1 = 700
const RLY = { x: 290, y: 196, w: 250, h: 84 }
const TRIP_Y = 250, AUX_Y = 270, CTW_Y = 214

const C = {
  wire: '#9ca3af', ok: '#6b7280', fault: '#ea580c', trip: '#dc2626', bad: '#dc2626',
  dc: '#d97706', ch: '#4f46e5', closed: '#dc2626', open: '#16a34a', text: '#374151', dim: '#9ca3af',
}

const go = id => () => {
  const el = document.getElementById(`chain-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  el.classList.add('ring-2', 'ring-indigo-400')
  setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-400'), 1200)
}

function Neq({ x, y, title }) {
  return (
    <g>
      <title>{title}</title>
      <circle cx={x} cy={y} r={8} fill="#fee2e2" stroke={C.bad} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={C.bad}>≠</text>
    </g>
  )
}

function Arrow({ x, y, dir, color, len = 26 }) {
  const x2 = x + dir * len
  return (
    <g stroke={color} fill={color}>
      <line x1={x} y1={y} x2={x2} y2={y} strokeWidth={2} />
      <path d={`M ${x2} ${y} l ${-dir * 7} -4.5 v 9 z`} stroke="none" />
    </g>
  )
}

const kA = i => `${(i * baseAmps() / 1000).toFixed(2)} kA`

export default function BayDiagram({ config, sim, state, scenario, faultLoc, rid }) {
  const r = config.relays[rid]
  const net = sim.net
  const bzAll = busZone(net, config)
  const bz = bzAll && bzAll.feeders.includes(rid) ? bzAll : null
  const g = relayGeometry(net, r)
  const farBus = g.farBus
  const remote = Object.keys(config.relays).find(id => id !== rid && config.relays[id].line === r.line)
  const m = state.meas?.[rid]
  const ri = relayInstruments(scenario, rid)
  const fuse = scenario.vtFuse?.[rid]
  const ctRev = scenario.ctReversed?.[rid]
  const ratioBad = ri.ct !== 1 || ri.vt !== 1

  const carrying = state.carrying?.includes(rid)
  const primI = m?.prim ? Math.max(...m.prim.Iabc.map(abs)) : 0
  const live = primI > 1e-6
  const bkr = state.breakers[rid]
  const dcLost = scenario.dcLost?.includes(r.bus)
  const oos = scenario.relayOos.includes(rid) || dcLost
  const tripOpen = scenario.tripOpen?.includes(rid)
  const tripped = state.tripped[rid]
  const delivered = tripped && !tripOpen && !dcLost
  const lop = !!state.lop?.[rid]
  const picked = r.zones.filter(z => ['picked', 'operated'].includes(state.zones[rid]?.[z.id]?.status))

  // Fault in this relay's frame: on its line (fraction from this end), beyond the far bus, or behind
  const pf = faultPosition(net, faultLoc) ?? g.pos // null: no power-system fault (nothing is drawn for it)
  const fwd = (pf - g.pos) * g.dir
  const onLine = !isTapFault(faultLoc) && faultLoc.kind === 'line' && faultLoc.line === r.line
  const fx = onLine ? LINE_X0 + (fwd / g.lineLength) * (LINE_X1 - LINE_X0)
    : fwd > g.lineLength - 1e-9 ? LINE_X1 + 24 : fwd < 1e-9 ? BUS_X - 30 : LINE_X0 + (fwd / g.lineLength) * (LINE_X1 - LINE_X0)
  const faultOn = state.faultEnergized
  const where = onLine ? `${Math.round((fwd / g.lineLength) * 100)}% of the line` : fwd > g.lineLength - 1e-9 ? `beyond bus ${farBus}` : fwd < 1e-9 ? 'behind this bus' : 'on the line'

  // Directions: actual (ideal instruments) vs what the relay believes
  const dirTrue = m?.prim?.dir ?? 0
  const dirRelay = m?.dir ?? 0
  const dirWord = d => (d > 0 ? 'forward' : d < 0 ? 'reverse' : 'none')
  const Zr = m?.Z, Zt = m?.prim?.Z
  const zOhm = Z => (Z ? Math.hypot(Z.R, Z.X) * BAY_BASE.zOhm : null)
  const zNeq = Zr && Zt ? Math.hypot(Zr.R - Zt.R, Zr.X - Zt.X) > 0.02 * Math.hypot(Zt.R, Zt.X) : !!Zr !== !!Zt
  const showNeq = live && (dirTrue !== dirRelay || zNeq)

  const conductor = faultOn && live ? C.fault : C.ok
  const bkrFill = bkr === 'open' ? '#fff' : C.closed
  const bkrStroke = bkr === 'open' ? C.open : C.closed
  const color = relayColor(rid)
  const lineName = `Line ${net.lines[r.line].from}–${net.lines[r.line].to}`

  const ctSec = carrying || live
  const vtDead = fuse === 'abc'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img"
      aria-label={`Bay one-line for 52-${rid}: breaker, CT, VT, relay 21-${rid}`}>
      {/* Bus */}
      <line x1={BUS_X} y1={30} x2={BUS_X} y2={150} stroke="#111827" strokeWidth={6} />
      <text x={BUS_X} y={22} textAnchor="middle" fontSize={12} fontWeight={700} fill={C.text}>Bus {r.bus}</text>

      {/* Conductor: bus → breaker → CT → VT tap → line */}
      <line x1={BUS_X} y1={OL} x2={LINE_X1} y2={OL} stroke={conductor} strokeWidth={3} />
      {/* Line section */}
      <line x1={LINE_X0} y1={OL - 10} x2={LINE_X0} y2={OL + 10} stroke={C.dim} strokeDasharray="2 2" />
      <text x={LINE_X1} y={OL + 50} textAnchor="end" fontSize={11} fill={C.dim}>{lineName} ({BAY_BASE.zOhm * g.lineLength} Ω, typical)</text>
      <text x={LINE_X1 + 4} y={OL + 4} fontSize={11} fontWeight={700} fill={C.text}>→ {farBus}</text>

      {/* Bus differential CT on the line side of the breaker: the bus zone reaches past
          the breaker to here, the line zone back to the line CT — they overlap across it */}
      {bz && (() => {
        const rev = scenario.ctReversed?.[busCtId(rid)]
        const op = state.bus87?.op
        const tripped87 = state.tripped[rid]?.logic === '87B'
        const c = rev ? C.bad : '#7c3aed'
        return (
          <g onClick={go('bus87')} className="cursor-pointer">
            <title>87B CT on 52-{rid}: on the line side of the breaker, so the bus zone overlaps the line zone across the breaker. Polarity mark toward the line: current into the bus is positive.{rev ? ' Its leads are swapped at the terminal block.' : ''}</title>
            <CtSymbol x={BCT_X} y={OL} orient="h" side={-1} dot={1} color="#7c3aed" />
            <text x={BCT_X + 14} y={OL + 20} textAnchor="middle" fontSize={10} fill="#7c3aed">87B CT</text>
            <line x1={BCT_X} y1={OL - 8} x2={BCT_X} y2={58} stroke="#7c3aed" />
            <TerminalBlock x={BCT_X} y={34} orient="v" crossed={!!rev} color="#7c3aed" />
            <line x1={BCT_X} y1={30} x2={BCT_X} y2={34} stroke="#7c3aed" />
            {rev && <text x={BCT_X + 12} y={50} fontSize={10} fontWeight={700} fill={C.bad}>leads swapped</text>}
            <rect x={BCT_X - 40} y={8} width={80} height={22} rx={5} fill={op ? '#fee2e2' : '#fff'} stroke={op || tripped87 ? C.trip : '#7c3aed'} strokeWidth={1.5} />
            <text x={BCT_X} y={23} textAnchor="middle" fontSize={11} fontWeight={700} fill={op || tripped87 ? C.trip : '#7c3aed'}>
              87B bus {bz.bus}{tripped87 ? ' TRIP' : op ? ' OP' : ''}
            </text>
          </g>
        )
      })()}

      {/* Primary current: magnitude and its actual direction */}
      {live && (
        <g>
          <Arrow x={bz ? 340 : 300} y={OL - 22} dir={dirTrue >= 0 ? 1 : -1} color={faultOn ? C.fault : C.ok} />
          <text x={(bz ? 340 : 300) + (dirTrue >= 0 ? 32 : -32)} y={OL - 18} textAnchor={dirTrue >= 0 ? 'start' : 'end'} fontSize={11} fontWeight={600} fill={faultOn ? C.fault : C.ok}>
            {kA(primI)} {faultOn ? (dirTrue > 0 ? '(toward the line)' : dirTrue < 0 ? '(toward the bus)' : '') : 'load'}
          </text>
        </g>
      )}

      {/* Fault */}
      {faultOn && (
        <g>
          <path d={`M ${fx - 5} ${OL - 22} l 9 13 l -6 2 l 8 15 l -13 -14 l 6 -2 z`} fill={C.fault} />
          <text x={fx} y={OL + 34} textAnchor="middle" fontSize={10} fill={C.fault}>fault: {where}</text>
        </g>
      )}

      {/* Breaker 52 */}
      <g onClick={go('bkr')} className="cursor-pointer">
        <title>Breaker 52-{rid}: {bkr}</title>
        <rect x={BKR_X - 16} y={OL - 12} width={32} height={24} fill={bkrFill} stroke={bkrStroke} strokeWidth={2.5} />
        {bkr === 'failed' && <circle cx={BKR_X} cy={OL} r={22} fill="none" stroke={C.bad} strokeWidth={2} strokeDasharray="4 3" />}
        <text x={BKR_X} y={OL - 18} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.text}>52-{rid}</text>
      </g>
      {/* Trip coil + 52a */}
      <g onClick={go('trip')} className="cursor-pointer">
        <line x1={BKR_X} y1={OL + 12} x2={BKR_X} y2={112} stroke={C.wire} />
        <rect x={BKR_X - 13} y={112} width={26} height={16} rx={3} fill="#fff" stroke={tripOpen ? C.bad : C.ok} />
        <text x={BKR_X} y={124} textAnchor="middle" fontSize={10} fontWeight={700} fill={tripOpen ? C.bad : C.text}>TC</text>
      </g>

      {/* CT on the conductor */}
      <g onClick={go('ct')} className="cursor-pointer">
        <title>CT {BAY_BASE.ctLabel} on the bus side of the breaker (a bus zone using CTs on the line side overlaps this line zone across the breaker). Polarity mark toward the bus: current from the bus into the line is positive, which the relay calls forward.{ctRev ? ' Its leads are swapped at the terminal block.' : ''}</title>
        <CtSymbol x={CT_X} y={OL} orient="h" side={1} dot={-1} />
        <text x={CT_X} y={OL - 14} textAnchor="middle" fontSize={10} fill={C.text}>CT {BAY_BASE.ctLabel}</text>
      </g>
      {/* CT secondary → terminal block → relay */}
      <polyline points={`${CT_X},${OL + 8} ${CT_X},${CTW_Y} ${TB_X},${CTW_Y}`} fill="none"
        stroke={ctSec ? (faultOn ? C.fault : C.ok) : C.wire} strokeWidth={ctSec ? 2 : 1} />
      <g onClick={go('ct')} className="cursor-pointer">
        <TerminalBlock x={TB_X} y={CTW_Y} crossed={!!ctRev} />
        {ctRev && <text x={TB_X + 22} y={CTW_Y + 18} textAnchor="end" fontSize={10} fontWeight={700} fill={C.bad} stroke="#fff" strokeWidth={3} paintOrder="stroke">leads swapped{ctRev !== 'abc' ? ` (${ctRev.toUpperCase()})` : ''}</text>}
      </g>
      <line x1={TB_X + 24} y1={CTW_Y} x2={RLY.x} y2={CTW_Y} stroke={ctSec ? (faultOn ? C.fault : C.ok) : C.wire} strokeWidth={ctSec ? 2 : 1} />
      {m && live && <text x={CT_X - 6} y={CTW_Y - 6} textAnchor="end" fontSize={10} fill={C.text}>{(primI * baseAmps() / BAY_BASE.ctRatio).toFixed(1)} A sec</text>}

      {/* VT: tap off the line side, through its fuse, to the relay */}
      <g onClick={go('vt')} className="cursor-pointer">
        <title>VT {BAY_BASE.vtLabel}{fuse ? ' — fuse blown' : ''}</title>
        <line x1={VT_X} y1={OL} x2={VT_X} y2={OL + 16} stroke="#111827" strokeWidth={1.5} />
        <VtSymbol x={VT_X} y={OL + 16} />
        <text x={VT_X + 12} y={OL + 32} fontSize={10} fill={C.text}>bus VT</text>
        <text x={VT_X + 12} y={OL + 44} fontSize={10} fill={C.text}>{BAY_BASE.vtLabel}</text>
        {/* Fuse */}
        <line x1={VT_X} y1={OL + 30} x2={VT_X} y2={150} stroke={C.wire} />
        <rect x={VT_X - 5} y={150} width={10} height={20} fill="#fff" stroke={fuse ? C.bad : C.ok} />
        {fuse ? <line x1={VT_X - 8} y1={154} x2={VT_X + 8} y2={166} stroke={C.bad} strokeWidth={2} />
          : <line x1={VT_X} y1={150} x2={VT_X} y2={170} stroke={C.ok} />}
        <text x={VT_X + 10} y={164} fontSize={10} fill={fuse ? C.bad : C.text}>fuse{fuse ? ` blown${fuse !== 'abc' ? ` (${fuse.toUpperCase()})` : ''}` : ''}</text>
      </g>
      <polyline points={`${VT_X},170 ${VT_X},184 ${VTW_X},184 ${VTW_X},${RLY.y}`} fill="none" stroke={vtDead ? C.wire : C.ok} strokeWidth={vtDead ? 1 : 2} strokeDasharray={vtDead ? '3 3' : undefined} />
      {m && <text x={VTW_X + 6} y={RLY.y - 4} fontSize={10} fill={C.text}>
        {(abs(m.Vabc[0]) / ri.vt * BAY_BASE.kV * 1000 / Math.sqrt(3) / BAY_BASE.vtRatio).toFixed(1)} V sec
      </text>}

      {/* Trip output → trip coil */}
      <polyline points={`${RLY.x},${TRIP_Y} ${BKR_X},${TRIP_Y} ${BKR_X},128`} fill="none"
        stroke={delivered ? C.trip : C.wire} strokeWidth={delivered ? 2.5 : 1}
        strokeDasharray={tripOpen ? '6 4' : undefined} />
      <text x={BKR_X + 8} y={TRIP_Y - 5} fontSize={10} fill={tripped ? C.trip : C.dim}>
        trip{tripped ? (tripOpen ? ' — not delivered' : dcLost ? ' — no DC' : ' →') : ''}
      </text>
      {tripOpen && <text x={(BKR_X + RLY.x) / 2 + 20} y={TRIP_Y + 4} textAnchor="middle" fontSize={14} fontWeight={700} fill={C.bad}>✕</text>}

      {/* 52a status back to the relay */}
      <polyline points={`${BKR_X - 30},${OL + 12} ${BKR_X - 30},${AUX_Y} ${RLY.x},${AUX_Y}`} fill="none" stroke={C.wire} strokeDasharray="2 3" />
      <text x={BKR_X - 26} y={AUX_Y - 5} fontSize={10} fill={C.dim}>52a: {bkr === 'open' ? 'open' : 'closed'}</text>

      {/* Station DC */}
      <g onClick={go('dc')} className="cursor-pointer">
        <title>Station {r.bus} DC supply{dcLost ? ' — lost' : ''}</title>
        {[0, 1, 2].map(i => <line key={i} x1={64 + i * 10} y1={i % 2 ? 300 : 296} x2={64 + i * 10} y2={i % 2 ? 308 : 312} stroke={dcLost ? C.bad : C.dc} strokeWidth={2} />)}
        <text x={58} y={290} fontSize={10} fill={dcLost ? C.bad : C.dc}>{dcLost ? 'DC LOST' : '125 V DC'}</text>
        <polyline points={`94,304 ${RLY.x + 20},304 ${RLY.x + 20},${RLY.y + RLY.h}`} fill="none" stroke={dcLost ? C.bad : C.dc} strokeDasharray={dcLost ? '4 3' : undefined} />
      </g>

      {/* Relay */}
      <g onClick={go('relay')} className="cursor-pointer">
        <rect x={RLY.x} y={RLY.y} width={RLY.w} height={RLY.h} rx={8} fill={oos ? '#f3f4f6' : '#fff'} stroke={color} strokeWidth={2} />
        <text x={RLY.x + 10} y={RLY.y + 18} fontSize={13} fontWeight={700} fill={color}>21-{rid}</text>
        <text x={RLY.x + RLY.w - 10} y={RLY.y + 18} textAnchor="end" fontSize={11} fontWeight={700}
          fill={tripped ? C.trip : lop ? '#b45309' : picked.length ? '#b45309' : C.dim}>
          {dcLost ? 'NO DC' : oos ? 'OUT' : lop && !tripped ? 'LOP — distance blocked' : tripped ? `TRIP ${tripped.logic && tripped.logic !== 'step' ? tripped.logic : `Z${tripped.zoneId}`}` : picked.length ? `${picked.map(zoneLabel).join(' ')} PU` : 'watching'}
        </text>
        <text x={RLY.x + 10} y={RLY.y + 38} fontSize={11} fill={C.text}>
          sees: {Zr ? `Z = ${zOhm(Zr).toFixed(1)} Ω pri, ${dirWord(dirRelay)}` : live ? 'no impedance' : 'no fault current'}
        </text>
        {live && Zt && (
          <text x={RLY.x + 10} y={RLY.y + 55} fontSize={11} fill={C.dim}>
            actual: {zOhm(Zt).toFixed(1)} Ω, {dirWord(dirTrue)}
          </text>
        )}
        {ratioBad && <text x={RLY.x + 10} y={RLY.y + 72} fontSize={10} fill={C.bad}>ratio setting ≠ installed CT/VT</text>}
        {showNeq && <Neq x={RLY.x + RLY.w - 14} y={RLY.y + 48} title="The relay's picture differs from the power system" />}
      </g>

      {/* Channel to the remote terminal */}
      {remote && (
        <g onClick={go('ch')} className="cursor-pointer">
          <line x1={RLY.x + RLY.w} y1={RLY.y + 40} x2={LINE_X1} y2={RLY.y + 40} stroke={C.ch} strokeDasharray="6 4" />
          <text x={LINE_X1 + 4} y={RLY.y + 44} fontSize={11} fontWeight={700} fill={relayColor(remote)}>21-{remote}</text>
          <text x={RLY.x + RLY.w + 8} y={RLY.y + 34} fontSize={10} fill={C.ch}>
            channel{state.tx?.[rid] ? ' · TX →' : ''}{state.rx?.[rid] ? ' · ← RX' : ''}
          </text>
        </g>
      )}
    </svg>
  )
}
