// RelayConfig schema — serializable for future import/export.
//
// v12: unprotected load tap on line A–B (`network.lines[AB].tap`: position,
//      tap section, tap transformer, load, tap protection time) and the 'tap' feature.
// v11: consequences module: `consequences` settings (critical clearing time,
//      cycles) and the 'consequences' feature.
// v10: current differential (87L) module: `diff` settings and the 'diff' feature.
// v9: prefault load flow: `loadAngleDeg` (EMF angle spread, left end leading)
//     and the 'load' feature toggle.
// v8: infeed (V2 phase 5): bus `infeed` flag (A/B become sources with the
//     'infeed' feature on; their `sir` applies even without the SIR feature).
// v7: quadrilateral option (V2): relay `shape` ('mho' | 'quad', quad only
//     with the 'rf' feature) and per-zone resistive reach `rReach` (% of own line).
// v6: zero sequence (V2 phase 3–4): line z0Ratio (|Z0/Z1|, default 3) and
//     z0AngleDeg (null = line angle), source bus z0Ratio (default 1), relay k0
//     (null = auto from its line, number = magnitude override), and the
//     'ground' (A–G faults) and 'rf' (fault resistance) feature toggles.
// v5: source impedance per bus (`network.buses[].sir`, pu of line AB) and the
//     'sir' feature toggle (V2). A bus's sir applies whenever it is a source:
//     X/Y in the full chain, A/B in single-line mode.
// v4: Zone 3 reverse per relay, per-line pilot scheme, pilot timing, and
//     feature toggles (progressive disclosure).
// v3: all times are stored in cycles of config.timing.freqHz (zone delays,
//     relay/breaker times, CTI), matching how relay settings are usually written.
// v2: the network (buses + lines) and every relay live in config.
//
// Relay ids are <own bus><far bus>: 'AB' sits at Bus A looking toward B.
// Zone reach is % of the relay's own line impedance.
// Line AB is the base line (1.0 pu); all impedances are pu of it.

export const SCHEMES = ['step', 'DCB', 'POTT', 'DCUB']

const zone3Reverse = () => ({ id: 3, reach: 50, rReach: 75, delayCycles: 0, enabled: true, direction: 'reverse' })

const defaultZones = () => [
  { id: 1, reach: 80,  rReach: 100, delayCycles: 0,  enabled: true, direction: 'forward' },
  { id: 2, reach: 120, rReach: 150, delayCycles: 18, enabled: true, direction: 'forward' },
  zone3Reverse(),
]

export const BASE_LINE = 'AB'

const DEFAULT_FEATURES = { pilot: false, adjacent: false, sir: false, ground: false, rf: false, infeed: false, load: false, diff: false, consequences: false, tap: false }
// Unprotected load tap on line A–B (feature 'tap'). Illustrative values, pu of line A–B:
// at = position from A (fraction), lead = tap section impedance, zt = tap transformer
// impedance, load = load current at nominal voltage, clearCycles = tap transformer
// protection clearing time for faults on the tap's low-voltage bus.
export const DEFAULT_TAP = { at: 0.4, lead: 0.2, zt: 2.0, load: 0.1, clearCycles: 6 }
const DEFAULT_CONSEQUENCES = { cctCycles: 12 } // critical clearing time — illustrative; system-specific in practice (stability study)
const DEFAULT_DIFF_SETTINGS = { pickupPu: 0.3, slopePct: 30, chargingPu: 0.05, ctErrorPct: 0 } // = differential.js DEFAULT_DIFF
const DEFAULT_PILOT = {
  channelCycles: 0.5,   // signal transit, sender → receiver
  dcbCoordCycles: 2,    // DCB: wait this long after Z2 pickup for a block
  unblockCycles: 9,     // DCUB: permissive window after loss of channel (~150 ms)
}
const DEFAULT_SCHEMES = { XA: 'step', AB: 'DCB', BY: 'step' }

export const DEFAULT_CONFIG = {
  version: 12,
  lineAngleDeg: 75,
  loadAngleDeg: 20, // prefault power-transfer angle (with the 'load' feature)
  features: DEFAULT_FEATURES,
  timing: {
    freqHz: 60,
    relayCycles: 1,    // zone pickup time
    breakerCycles: 3,  // trip to contact open
    ctiCycles: 12,     // coordination time interval
  },
  pilot: DEFAULT_PILOT,
  consequences: DEFAULT_CONSEQUENCES,
  schemes: DEFAULT_SCHEMES, // per line id
  diff: DEFAULT_DIFF_SETTINGS, // line A–B current differential
  network: {
    buses: [
      { id: 'X', source: true, sir: 0, z0Ratio: 1 },
      { id: 'A', sir: 0, z0Ratio: 1, infeed: false },
      { id: 'B', sir: 0, z0Ratio: 1, infeed: false },
      { id: 'Y', source: true, sir: 0, z0Ratio: 1 },
    ],
    lines: [
      { id: 'XA', from: 'X', to: 'A', length: 1.0, z0Ratio: 3, z0AngleDeg: null },
      { id: 'AB', from: 'A', to: 'B', length: 1.0, z0Ratio: 3, z0AngleDeg: null, tap: DEFAULT_TAP },
      { id: 'BY', from: 'B', to: 'Y', length: 0.6, z0Ratio: 3, z0AngleDeg: null },
    ],
  },
  relays: {
    XA: { bus: 'X', line: 'XA', zones: defaultZones(), k0: null, shape: 'mho' },
    AX: { bus: 'A', line: 'XA', zones: defaultZones(), k0: null, shape: 'mho' },
    AB: { bus: 'A', line: 'AB', zones: defaultZones(), k0: null, shape: 'mho' },
    BA: { bus: 'B', line: 'AB', zones: defaultZones(), k0: null, shape: 'mho' },
    BY: { bus: 'B', line: 'BY', zones: defaultZones(), k0: null, shape: 'mho' },
    YB: { bus: 'Y', line: 'BY', zones: defaultZones(), k0: null, shape: 'mho' },
  },
}

export function defaultConfig() {
  return structuredClone(DEFAULT_CONFIG)
}

// Accept any known schema version and return a current (v12) config.
// Each step upgrades one version, so old files walk forward in order.
export function migrateConfig(cfg) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(cfg.version)) throw new Error(`Unsupported config version: ${cfg.version}`)
  let next = cfg
  if (next.version === 1) next = v1to3(next)
  if (next.version === 2) next = v2to3(next)
  if (next.version === 3) next = v3to4(next)
  if (next.version === 4) next = v4to5(next)
  if (next.version === 5) next = v5to6(next)
  if (next.version === 6) next = v6to7(next)
  if (next.version === 7) next = v7to8(next)
  if (next.version === 8) next = v8to9(next)
  if (next.version === 9) next = v9to10(next)
  if (next.version === 10) next = v10to11(next)
  if (next.version === 11) next = v11to12(next)
  return next
}

const secToCyc = (s, freqHz) => Math.round(s * freqHz * 100) / 100

// v1: Relay A/B only, delays in seconds, 60 Hz implied
function v1to3(cfg) {
  const next = v3Defaults()
  next.lineAngleDeg = cfg.lineAngleDeg ?? next.lineAngleDeg
  const toV3 = zones => zones.map(({ delay, ...z }) => ({ ...z, delayCycles: secToCyc(delay, 60) }))
  next.relays.AB.zones = toV3(cfg.relays.A.zones)
  next.relays.BA.zones = toV3(cfg.relays.B.zones)
  return next
}

// v2: delays and CTI in seconds
function v2to3(cfg) {
  const next = structuredClone(cfg)
  const f = next.timing.freqHz
  for (const r of Object.values(next.relays)) {
    r.zones = r.zones.map(({ delay, ...z }) => ({ ...z, delayCycles: secToCyc(delay, f) }))
  }
  const { cti, ...timing } = next.timing
  next.timing = { ...timing, ctiCycles: secToCyc(cti, f) }
  next.version = 3
  return next
}

// v3: forward zones only, no schemes
function v3to4(cfg) {
  const next = structuredClone(cfg)
  for (const r of Object.values(next.relays)) {
    r.zones = r.zones.map(z => ({ direction: 'forward', ...z }))
    if (!r.zones.some(z => z.direction === 'reverse')) r.zones.push(zone3Reverse())
  }
  next.features = { ...DEFAULT_FEATURES, ...next.features }
  next.pilot = { ...DEFAULT_PILOT, ...next.pilot }
  next.schemes = Object.fromEntries(next.network.lines.map(l => [l.id, next.schemes?.[l.id] ?? 'step']))
  next.version = 4
  return next
}

// v4: no source impedance (stiff sources)
function v4to5(cfg) {
  const next = structuredClone(cfg)
  next.network.buses = next.network.buses.map(b => ({ ...b, sir: b.sir ?? 0 }))
  next.features = { ...DEFAULT_FEATURES, ...next.features }
  next.version = 5
  return next
}

// v5: positive sequence only
function v5to6(cfg) {
  const next = structuredClone(cfg)
  next.network.buses = next.network.buses.map(b => ({ ...b, z0Ratio: b.z0Ratio ?? 1 }))
  next.network.lines = next.network.lines.map(l => ({ ...l, z0Ratio: l.z0Ratio ?? 3, z0AngleDeg: l.z0AngleDeg ?? null }))
  for (const r of Object.values(next.relays)) r.k0 = r.k0 ?? null
  next.features = { ...DEFAULT_FEATURES, ...next.features }
  next.version = 6
  return next
}

// v6: MHO only
const DEFAULT_R_REACH = { 1: 100, 2: 150, 3: 75 }
function v6to7(cfg) {
  const next = structuredClone(cfg)
  for (const r of Object.values(next.relays)) {
    r.shape = r.shape ?? 'mho'
    r.zones = r.zones.map(z => ({ ...z, rReach: z.rReach ?? DEFAULT_R_REACH[z.id] ?? z.reach }))
  }
  next.version = 7
  return next
}

// v7: sources only at X/Y (or A/B in single-line mode)
function v7to8(cfg) {
  const next = structuredClone(cfg)
  next.network.buses = next.network.buses.map(b => (b.source ? b : { ...b, infeed: b.infeed ?? false }))
  next.features = { ...DEFAULT_FEATURES, ...next.features }
  next.version = 8
  return next
}

// v8: no load
function v8to9(cfg) {
  const next = structuredClone(cfg)
  next.loadAngleDeg = next.loadAngleDeg ?? 20
  next.features = { ...DEFAULT_FEATURES, ...next.features }
  next.version = 9
  return next
}

// v9: distance only
function v9to10(cfg) {
  const next = structuredClone(cfg)
  next.diff = { ...DEFAULT_DIFF_SETTINGS, ...next.diff }
  next.features = { ...DEFAULT_FEATURES, ...next.features }
  next.version = 10
  return next
}

// v10: no consequences module
function v10to11(cfg) {
  const next = structuredClone(cfg)
  next.consequences = { ...DEFAULT_CONSEQUENCES, ...next.consequences }
  next.features = { ...DEFAULT_FEATURES, ...next.features }
  next.version = 11
  return next
}

// v11: no line tap
function v11to12(cfg) {
  const next = structuredClone(cfg)
  next.network.lines = next.network.lines.map(l => (l.id === BASE_LINE ? { ...l, tap: { ...DEFAULT_TAP, ...l.tap } } : l))
  next.features = { ...DEFAULT_FEATURES, ...next.features }
  next.version = 12
  return next
}

// A v3-shaped default, used as the base when upgrading v1 files
function v3Defaults() {
  const next = defaultConfig()
  delete next.features
  delete next.pilot
  delete next.schemes
  delete next.loadAngleDeg
  delete next.diff
  delete next.consequences
  next.network.buses = next.network.buses.map(({ sir, z0Ratio, infeed, ...b }) => b)
  next.network.lines = next.network.lines.map(({ z0Ratio, z0AngleDeg, tap, ...l }) => l)
  for (const r of Object.values(next.relays)) { delete r.k0; delete r.shape }
  for (const r of Object.values(next.relays)) {
    r.zones = r.zones
      .filter(z => z.direction !== 'reverse')
      .map(z => ({ id: z.id, reach: z.reach, delayCycles: z.delayCycles, enabled: z.enabled }))
  }
  next.version = 3
  return next
}

// The system the Coordination tab simulates. Without the "adjacent lines"
// feature it's the base line alone (A–B, a source at each bus, two relays);
// with it, the full stored network. Settings for hidden lines are kept.
// With the infeed feature on, intermediate buses flagged `infeed` become
// sources (full network: Coordination with adjacent lines, and the Fault Study).
export function withInfeed(config) {
  if (!config.features?.infeed || !config.network.buses.some(b => b.infeed && !b.source)) return config
  return {
    ...config,
    network: { ...config.network, buses: config.network.buses.map(b => (b.infeed ? { ...b, source: true } : b)) },
  }
}

export function coordinationConfig(config) {
  if (config.features?.adjacent) return withInfeed(config)
  const base = config.network.lines.find(l => l.id === BASE_LINE)
  const relays = Object.fromEntries(Object.entries(config.relays).filter(([, r]) => r.line === BASE_LINE))
  return {
    ...config,
    network: {
      // A and B become the sources, keeping their own source settings (V2 SIR)
      buses: [base.from, base.to].map(id => ({ ...config.network.buses.find(b => b.id === id), source: true })),
      lines: [base],
    },
    relays,
    schemes: { [BASE_LINE]: config.schemes?.[BASE_LINE] ?? 'step' },
  }
}
