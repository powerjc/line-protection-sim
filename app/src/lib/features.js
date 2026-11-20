// Feature dependencies, settled in one place — no React.
//
// Some toggles only work together. Rather than leave a switch that looks on
// but does nothing, every change goes through settleFeatures():
//   - Bus differential (87B) needs Adjacent lines (bus B needs two feeders) and
//     bus B not to be an infeed source (that source has no breaker in this
//     model, so a bus trip couldn't isolate it).
//   - Turning 87B ON is the user asking for it: its prerequisites follow
//     (Adjacent lines on, bus B's infeed off).
//   - Any other change that breaks a prerequisite turns 87B OFF.

const busB = cfg => cfg.network.buses.find(b => b.id === 'B')
const infeedAtB = cfg => !!cfg.features?.infeed && !!busB(cfg)?.infeed

// What keeps 87B from being in force, or null
export function busDiffBlocker(cfg) {
  if (!cfg.features?.adjacent) return 'adjacent'
  if (infeedAtB(cfg)) return 'infeedB'
  return null
}

// cfg: the config after a change; turnedOn: the feature the user just switched on (if any)
export function settleFeatures(cfg, turnedOn = null) {
  if (!cfg.features?.busdiff) return cfg
  if (turnedOn === 'busdiff') {
    let next = cfg
    if (!next.features.adjacent) next = { ...next, features: { ...next.features, adjacent: true } }
    if (infeedAtB(next)) {
      next = { ...next, network: { ...next.network, buses: next.network.buses.map(b => (b.id === 'B' ? { ...b, infeed: false } : b)) } }
    }
    return next
  }
  return busDiffBlocker(cfg) ? { ...cfg, features: { ...cfg.features, busdiff: false } } : cfg
}

// What settling changed, in words (shown as a note, so nothing flips silently).
// requested: the config as asked for; settled: settleFeatures(requested, …)
export function settledNotes(requested, settled) {
  const notes = []
  const was = requested.features ?? {}, now = settled.features ?? {}
  if (!was.adjacent && now.adjacent) notes.push('Adjacent lines turned on: bus differential (87B) needs two feeders at bus B.')
  if (infeedAtB(requested) && !busB(settled)?.infeed) notes.push('Bus B’s infeed turned off: in this model that source has no breaker or CT, so 87B could neither measure nor isolate it.')
  if (was.busdiff && !now.busdiff) {
    notes.push(busDiffBlocker(requested) === 'infeedB'
      ? 'Bus differential (87B) turned off: bus B’s infeed has no breaker or CT in this model, so 87B could neither measure nor isolate it.'
      : 'Bus differential (87B) turned off: it needs Adjacent lines (bus B needs two feeders).')
  }
  return notes
}
