// Learner levels — named groups of distance-protection feature toggles
// (progressive disclosure). Pure data + helpers, no React. A level only
// switches the features in LEVEL_FEATURES; every other setting is untouched.
// Basic = the defaults, so with Basic the app behaves exactly as it did
// before levels existed.
//
// Line current differential (87L, feature 'diff') is a separate protection
// module, not a rung on the distance ladder: no level switches it, and the
// level is judged without it.

import { defaultConfig } from './schema'

export const LEVELS = [
  {
    id: 'basic',
    label: 'Basic',
    who: 'New to distance protection',
    blurb: 'One line A–B, Zone 1 + Zone 2, step distance',
    features: [],
    firstLesson: 'z1-basics',
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    who: 'Know the zones, learning coordination',
    blurb: 'Adds adjacent lines, Zone 3 reverse + pilot schemes',
    features: ['adjacent', 'pilot'],
    firstLesson: 'z2-time',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    who: 'All of distance protection',
    blurb: 'Adds source impedance & phasors, ground faults, fault resistance, prefault load, infeed and a line tap',
    features: ['adjacent', 'pilot', 'sir', 'ground', 'rf', 'load', 'infeed', 'tap'],
    firstLesson: 'ground-k0',
  },
]

// Who the welcome card asks about. 'around' starts with the consequences
// module on and the Why protection matters track; the level stays Basic.
export const AUDIENCES = [
  {
    id: 'learning',
    label: 'I’m learning protection',
    who: 'New protection engineers and students',
    blurb: 'Start with distance zones, then coordination and pilot schemes. Raise the learner level in ⚙ Settings as you go.',
    firstLesson: 'z1-basics',
    features: { consequences: false },
  },
  {
    id: 'around',
    label: 'I work around protection',
    who: 'Networks, SCADA, commissioning, planning',
    blurb: 'Start with why protection matters: what a slow clear costs, and the links it depends on, including the communications channel.',
    firstLesson: 'why-cost',
    features: { consequences: true },
  },
]

// Which level a lesson track belongs to (shown in the Lessons menu);
// a module's track shows the module instead
export const TRACK_LEVEL = {
  'Why protection matters': 'Around protection',
  'Basics': 'basic',
  'Coordination': 'intermediate',
  'Pilot schemes': 'intermediate',
  'Sources & phasors': 'intermediate',
  'Ground faults & Rf': 'advanced',
  'Tapped lines': 'advanced',
  'Current differential': '87L module',
}
export const trackLabel = track => LEVELS.find(l => l.id === TRACK_LEVEL[track])?.label ?? TRACK_LEVEL[track]

// The features a level switches (the levels' union; anything else is left alone)
export const LEVEL_FEATURES = [...new Set(LEVELS.flatMap(l => l.features))]

export function levelFeatures(id) {
  const on = new Set(LEVELS.find(l => l.id === id)?.features ?? [])
  return Object.fromEntries(LEVEL_FEATURES.map(f => [f, on.has(f)]))
}

// The level whose feature set matches exactly, or 'custom'
export function levelOf(features = {}) {
  const match = LEVELS.find(l => LEVEL_FEATURES.every(f => !!features[f] === l.features.includes(f)))
  return match ? match.id : 'custom'
}

export function withLevel(config, id) {
  return { ...config, features: { ...config.features, ...levelFeatures(id) } }
}

export function configForLevel(id, audience = 'learning') {
  const cfg = withLevel(defaultConfig(), id)
  return { ...cfg, features: { ...cfg.features, ...AUDIENCES.find(a => a.id === audience)?.features } }
}

// Per-browser preferences — conveniences, safe to lose
const LEVEL_KEY = 'lps.level'
const WELCOME_KEY = 'lps.welcomed'
const AUDIENCE_KEY = 'lps.audience'

export function loadLevelPref() {
  try {
    const v = localStorage.getItem(LEVEL_KEY)
    return LEVELS.some(l => l.id === v) ? v : 'basic'
  } catch { return 'basic' }
}
export function saveLevelPref(id) {
  try { localStorage.setItem(LEVEL_KEY, id) } catch { /* storage unavailable */ }
}
export function loadAudiencePref() {
  try {
    const v = localStorage.getItem(AUDIENCE_KEY)
    return AUDIENCES.some(a => a.id === v) ? v : 'learning'
  } catch { return 'learning' }
}
export function saveAudiencePref(id) {
  try { localStorage.setItem(AUDIENCE_KEY, id) } catch { /* storage unavailable */ }
}
export function loadWelcomed() {
  try { return localStorage.getItem(WELCOME_KEY) === '1' } catch { return false }
}
export function saveWelcomed() {
  try { localStorage.setItem(WELCOME_KEY, '1') } catch { /* storage unavailable */ }
}
