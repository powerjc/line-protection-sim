// Static coordination checks on relay settings — no React dependencies.
import { EPS } from './network'
import { zoneReachPu, isReverse } from './protection'

// relays: [{ id, zones, pos, dir, lineLength }] (config relay + relayGeometry)
// Checks drawn as hatched regions on the coverage lanes:
//  • Z1 reaching past its remote bus (instantaneous overreach)
//  • A relay's Z2 reaching past a downstream relay's Z1 into territory that
//    the downstream relay only covers with its own Z2, with less than CTI
//    of time separation — the two delayed zones race.
//  • DCB: the remote reverse zone must reach further behind its bus than
//    the local Z2 overreaches past it, or faults in the gap get no block.
// Times compared in cycles (stored settings).
export function findConflicts(relays, ctiCycles, fmtCyc = c => `${c} cyc`, config = null) {
  const out = []
  const zone = (r, id) => r.zones.find(z => z.id === id && !isReverse(z) && z.enabled && z.reach > 0)
  const reverseZone = r => r.zones.find(z => isReverse(z) && z.enabled && z.reach > 0)
  const reachEnd = (r, z) => r.pos + r.dir * zoneReachPu(z, r.lineLength)

  for (const r of relays) {
    const z1 = zone(r, 1)
    if (z1 && zoneReachPu(z1, r.lineLength) > r.lineLength + EPS) {
      out.push({ rid: r.id, zoneId: 1, s0: r.pos + r.dir * r.lineLength, s1: reachEnd(r, z1),
        text: `21-${r.id} Z1 overreaches its remote bus — instantaneous trips for faults on the next line` })
    }

    const z2 = zone(r, 2)
    if (!z2) continue
    for (const s of relays) {
      if (s === r || s.dir !== r.dir || (s.pos - r.pos) * r.dir <= EPS) continue
      const sz1 = zone(s, 1), sz2 = zone(s, 2)
      if (!sz2) continue
      const from = sz1 ? reachEnd(s, sz1) : s.pos
      const to = (Math.min(reachEnd(r, z2) * r.dir, reachEnd(s, sz2) * r.dir)) * r.dir
      if ((to - from) * r.dir <= EPS) continue
      if (z2.delayCycles - sz2.delayCycles < ctiCycles - EPS) {
        out.push({ rid: r.id, zoneId: 2, s0: from, s1: to,
          text: `21-${r.id} Z2 overlaps 21-${s.id} Z2 beyond ${s.id}'s Z1 reach with ${fmtCyc(Math.max(0, z2.delayCycles - sz2.delayCycles))} separation (< CTI ${fmtCyc(ctiCycles)}) — miscoordination risk` })
      }
    }
  }
  if (config?.features?.pilot) {
    for (const r of relays) {
      if (config.schemes?.[r.line] !== 'DCB') continue
      const z2 = zone(r, 2)
      const remote = relays.find(s => s !== r && s.line === r.line)
      if (!z2 || !remote) continue
      const over = zoneReachPu(z2, r.lineLength) - r.lineLength // past the remote bus
      if (over <= EPS) continue
      const rev = reverseZone(remote)
      const covered = rev ? zoneReachPu(rev, remote.lineLength) : 0
      if (covered >= over - EPS) continue
      out.push({ rid: r.id, zoneId: 2, s0: remote.pos + r.dir * covered, s1: reachEnd(r, z2),
        text: `DCB: 21-${remote.id} reverse zone ${rev ? 'reaches too short' : 'is off'} — 21-${r.id} Z2 overreaches past the remote bus where no block is sent; external faults there trip via DCB` })
    }
  }
  return out
}
