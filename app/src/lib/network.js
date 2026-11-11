// Network topology helpers — no React dependencies.
//
// The network is a chain of buses joined by lines, listed left to right.
// Positions are cumulative line impedance (pu of the base line) from the
// first bus. Geometry drives layout and the assessment's ground truth
// (where the fault really is); relays measure through lib/solver.js.
//
// Chain-only for now: a branched network needs a different layout and
// position model; the solver itself is general nodal analysis.

export const EPS = 1e-9

export function buildNetwork(network) {
  const pos = { [network.buses[0].id]: 0 }
  const lines = {}
  for (const line of network.lines) {
    if (!(line.from in pos)) throw new Error(`Line ${line.id} is out of chain order`)
    pos[line.to] = pos[line.from] + line.length
    lines[line.id] = { ...line, p1: pos[line.from], p2: pos[line.to] }
  }
  const buses = Object.fromEntries(network.buses.map(b => [b.id, { ...b, pos: pos[b.id] }]))
  const busOrder = network.buses.map(b => b.id)
  return {
    buses,
    lines,
    busOrder,
    lineOrder: network.lines.map(l => l.id),
    sources: network.buses.filter(b => b.source).map(b => b.id),
    length: pos[busOrder[busOrder.length - 1]],
  }
}

// Where a relay sits and which way it looks.
// dir: +1 looks toward increasing position (right), -1 toward decreasing.
export function relayGeometry(net, relay) {
  const line = net.lines[relay.line]
  const farBus = line.from === relay.bus ? line.to : line.from
  const pos = net.buses[relay.bus].pos
  return {
    pos,
    dir: Math.sign(net.buses[farBus].pos - pos),
    farBus,
    lineLength: line.length,
  }
}

// The line tap in force (feature 'tap'): an unprotected load tap part-way
// along its line. Returns { line, at, lead, zt, load, clearCycles, pos } or null.
// Gated here so every caller (solver, engine, display) agrees.
export function activeTap(net, config) {
  if (!config.features?.tap) return null
  const id = net.lineOrder.find(l => net.lines[l].tap)
  if (!id) return null
  const l = net.lines[id]
  return { line: id, ...l.tap, pos: l.p1 + l.tap.at * (l.p2 - l.p1) }
}

// Fault location → chain position.
// loc: { kind: 'bus', bus } | { kind: 'line', line, frac } (frac from line.from)
//    | { kind: 'tap', frac } (on the tap section, frac from the tap point T)
//    | { kind: 'tapLV' } (the tap transformer's low-voltage bus)
// Tap faults sit off the chain; their chain position is the tap point T.
export function faultPosition(net, loc) {
  if (loc.kind === 'bus') return net.buses[loc.bus].pos
  if (loc.kind === 'tap' || loc.kind === 'tapLV') {
    const id = net.lineOrder.find(l => net.lines[l].tap)
    const l = net.lines[id]
    return l.p1 + l.tap.at * (l.p2 - l.p1)
  }
  const l = net.lines[loc.line]
  return l.p1 + loc.frac * (l.p2 - l.p1)
}
export const isTapFault = loc => loc.kind === 'tap' || loc.kind === 'tapLV'

// Signed distance from relay to fault along its forward direction (pu).
// > 0 forward, 0 at the relay's own bus, < 0 behind it.
export function forwardDistance(net, relay, pf) {
  const g = relayGeometry(net, relay)
  return (pf - g.pos) * g.dir
}

export function describeLocation(net, loc) {
  if (loc.kind === 'bus') return `Bus ${loc.bus}`
  if (loc.kind === 'tap') return `Tap T section @ ${Math.round(loc.frac * 100)}% from T`
  if (loc.kind === 'tapLV') return 'Tap T low-voltage bus (behind the tap transformer)'
  const l = net.lines[loc.line]
  return `Line ${l.from}–${l.to} @ ${Math.round(loc.frac * 100)}% from ${l.from}`
}
