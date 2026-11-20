// The screen tour and Explain mode: what each panel is — pure data, no React.
//
// Every panel the tour can point at is a target with an id (`<screen>.<panel>`).
// Components mark themselves with useExplain()(id); the text lives here, next
// to the others, and may depend on what is switched on (ctx.config: the config
// the screen shows). The tour for a screen is whatever targets are on it right
// now, in screen order, so panels that a setting hides never appear and new
// ones join by being marked.

const f = (ctx, k) => !!ctx.config?.features?.[k]

export const EXPLAIN = {
  // ── Header (every screen) ──
  'header.tabs': {
    title: 'Screens, from big to small',
    text: () => 'Coordination is the whole system: every line, relay and breaker, and how a fault is cleared. Station zooms in on one substation: its bus and every bay. Bay zooms in further, to one relay terminal and what it measures. Fault Study tests settings against a fixed set of faults; Differential (with the 87L module) shows the line differential’s characteristic.',
  },
  'header.chips': {
    title: 'What is switched on',
    text: () => 'The learner level, any feature on beyond it, and the protection modules (87L, 87B). Click any of them to open ⚙ Settings.',
  },
  'header.lessons': {
    title: 'Lessons',
    text: () => 'Guided lessons: each sets up a situation, tells you what to watch for, and gives you something to try. ◀ / ▶ follow your path through them; the welcome card is here too.',
  },
  'header.settings': {
    title: 'Settings',
    text: () => 'Learner level (which features are on), timing, display units, and the modules. Switching something on that needs something else switches that on too, and says so.',
  },

  // ── Coordination ──
  'coord.fault': {
    title: 'Where the fault is',
    text: ctx => `Pick a line or bus and slide the fault along it, or use a preset; you can also click the one-line.${f(ctx, 'ground') || f(ctx, 'rf') ? ' Fault type and fault resistance are set here too.' : ''} “No fault” keeps the system healthy, for an instrument failure on its own.`,
  },
  'coord.failures': {
    title: 'Failures',
    text: ctx => `Break something and replay: a relay out of service, a breaker that won’t open, a station’s DC supply${f(ctx, 'pilot') ? ', a pilot channel' : ''}${f(ctx, 'diff') ? ', the 87L channel (including a switched, asymmetric path)' : ''}. CT and VT failures, and the trip circuit, are in the protection chain on the Bay tab.`,
  },
  'coord.reach': {
    title: 'Zone reach',
    text: () => 'How far each relay’s zones reach along its own line (in % of the line) and Zone 2’s time delay. Drag and replay; the coverage lanes and setting checks update at once.',
  },
  'coord.oneline': {
    title: 'One-line and zone coverage',
    text: ctx => `Top: the system as a one-line: sources, buses, breakers (red closed, green open), CTs and relays, with fault current in orange as the run plays.${f(ctx, 'busdiff') ? ' The dashed box at bus B is the bus differential zone.' : ''} Below: each relay’s zones drawn as lanes along the same distance axis, with red hatching where a setting check fails.`,
  },
  'coord.timing': {
    title: 'Timing chart',
    text: ctx => `A logic-analyzer view: time runs left to right, one trace per signal: zone pickups (the shaded ramp is a delayed zone’s timer), trips and breaker contacts${f(ctx, 'pilot') ? ', pilot signals sent and received' : ''}${f(ctx, 'diff') ? ', 87L operate' : ''}. Play, Step, or click the chart to move through the run.`,
  },
  'coord.outcome': {
    title: 'The outcome',
    text: () => 'Once the run has played: was the fault cleared selectively, by backup, with a miscoordination, or not at all, and when. The notes say which breakers should have opened and why they didn’t.',
  },
  'coord.consequences': {
    title: 'Consequences',
    text: () => 'What the clearing cost: fault time against an illustrative critical clearing time, and what was lost beyond the faulted element. Details add the clearing time piece by piece (relay, channel, delay, breaker) and relative fault duty and arc energy.',
  },
  'coord.events': {
    title: 'Sequence of events',
    text: () => 'Every pickup, timer, signal, trip and breaker operation with its time, like a substation event log. Click one to jump to that moment.',
  },
  'coord.phasors': {
    title: 'Phasors',
    text: ctx => (f(ctx, 'sir')
      ? 'Voltage and current phasors at every relay as the run plays: magnitude and angle, as the relays measure them.'
      : 'Phasors at every relay. They need source impedance switched on (the button turns it on), because with stiff sources the bus voltages never sag.'),
  },
  'coord.settings': {
    title: 'Relay and line settings',
    text: () => 'Every terminal’s zones, line lengths and, as features come on, k0, characteristic shape and pilot schemes. Shared with the Fault Study.',
  },

  // ── Station ──
  'station.picker': {
    title: 'Which station',
    text: () => 'One substation at a time. The fault, failures and playback are the same run as the Coordination tab.',
  },
  'station.fault': {
    title: 'Where the fault is',
    text: () => 'The same fault as the Coordination tab: pick a line or bus and slide the fault along it, or use a preset. “No fault” keeps the system healthy, for an instrument failure on its own.',
  },
  'station.drawing': {
    title: 'The station',
    text: ctx => `The bus and every bay off it: each line relay’s CT on the bus side of its breaker (dots mark polarity: current from the bus into the line is forward), the relay’s status, the breaker, and the actual current in or out of the bus.${f(ctx, 'busdiff') ? ' On bus B the bus differential adds its own CTs on the line side of each breaker, wired to the 87B relay, so the bus and line zones overlap across every breaker.' : ''} Click the station battery to fail it.`,
  },
  'station.events': {
    title: 'Events at this station',
    text: () => 'The run’s events for the breakers and relays at this station, and the outcome.',
  },
  'station.bus87': {
    title: 'Bus differential',
    text: ctx => (f(ctx, 'busdiff')
      ? 'What goes in must come out: every 87B CT’s current into the bus, their sum (operate) against the sum of their sizes (restraint). Set a CT’s polarity here to see what a wiring error does.'
      : 'A differential zone around bus B. It needs the 87B module and Adjacent lines; the button turns them on.'),
  },
  'station.osc': {
    title: 'The station’s event report',
    text: ctx => `Each feeder’s current into the bus on one time axis${f(ctx, 'busdiff') ? '; on bus B, the 87B CT secondaries, their sum, and operate against restraint' : ''}; then every feeder breaker. Click to move the cursor.`,
  },

  // ── Bay ──
  'bay.picker': {
    title: 'Which terminal',
    text: () => 'One relay terminal at a time: the relay, its breaker, CT and VT. Same run as the other tabs.',
  },
  'bay.fault': {
    title: 'Where the fault is',
    text: () => 'The same fault as the Coordination tab: pick a line or bus and slide the fault along it, or use a preset. “No fault” keeps the system healthy, for an instrument failure on its own.',
  },
  'bay.drawing': {
    title: 'The bay',
    text: () => 'One terminal as a station drawing: bus, bus VT through its fuse, CT, breaker with its trip coil and 52a contact, the relay and what it sees, station DC and the channel to the far end. Click a device to jump to its card in the protection chain.',
  },
  'bay.events': {
    title: 'Events at this terminal',
    text: () => 'This relay’s events and its far end’s, with the outcome.',
  },
  'bay.relayview': {
    title: 'What the relay sees',
    text: () => 'The same quantities three ways: on the line, at the relay terminals (CT and VT secondaries), and as the relay computes them back. A ≠ marks every place the relay’s picture differs from what is really on the line.',
  },
  'bay.osc': {
    title: 'The relay’s event report',
    text: () => 'Waveforms on the line and at the relay, the relay’s samples, the magnitude it estimates from its last cycle of samples, and its logic. Synthesized from the phasor model: illustrative.',
  },
  'bay.chain': {
    title: 'Protection chain',
    text: () => 'Every link this terminal needs to clear a fault: CT, VT, relay, channel, DC supply, trip circuit, breaker. Each shows its state, a way to break it, and the field check that catches that failure.',
  },

  // Details (not separate stops on the screen tour; lessons point at them)
  'coord.controls': { detail: true, title: 'Playback', text: () => 'Reset, Step back, Play and Step forward through the run, the speed, and the time slider. Step jumps from one event to the next.' },
  'station.controls': { detail: true, title: 'Playback', text: () => 'Reset, Step back, Play and Step forward through the run, the speed, and the time slider. Step jumps from one event to the next.' },
  'bay.controls': { detail: true, title: 'Playback', text: () => 'Reset, Step back, Play and Step forward through the run, the speed, and the time slider. Step jumps from one event to the next.' },
  'bay.chain.ct': { detail: true, title: 'The CT', text: () => 'The current transformer: its reading on the line and at the relay, its polarity (correct, or leads swapped), and the ratio the relay is set to against the CT installed.' },
  'bay.chain.vt': { detail: true, title: 'The VT', text: () => 'The voltage transformer: its reading, its fuse (intact, one phase or all blown), and the ratio the relay is set to against the VT installed.' },
  'bay.chain.relay': { detail: true, title: 'Relay', text: () => 'The relay’s state (watching, picked up, tripped), in or out of service, and loss-of-potential blocking.' },
  'bay.chain.ch': { detail: true, title: 'Channel', text: () => 'The communications channel to the far end for a pilot scheme or 87L: in service, out, lost at the fault, or (87L) a switched, asymmetric path.' },
  'bay.chain.dc': { detail: true, title: 'Station DC', text: () => 'The station battery that every relay and trip circuit here runs on. Lose it and nothing at this station can trip.' },
  'bay.chain.trip': { detail: true, title: 'Trip circuit', text: () => 'The wiring from the relay’s trip output to the breaker’s trip coil. Open it and the relay trips but the breaker never hears it.' },
  'bay.chain.bkr': { detail: true, title: 'Breaker', text: () => 'The breaker itself: open or closed, or stuck (receives the trip, doesn’t open).' },

  // ── Fault Study ──
  'study.relays': {
    title: 'Relay settings',
    text: () => 'Zones of the two line relays A and B, tested against the fault suite on the right.',
  },
  'study.rx': {
    title: 'R-X plane',
    text: () => 'Impedance as the relay measures it: each zone is a shape, each fault a point. A point inside a zone means that zone picks up. Click a fault in the table to highlight it.',
  },
  'study.results': {
    title: 'Fault results',
    text: () => 'The six-fault suite: where each fault is, what each relay measured, which zone tripped, and whether that was right.',
  },

  // ── Differential ──
  'diff.settings': {
    title: '87L settings and conditions',
    text: () => 'Pickup and slope of the line differential, line charging current, a CT error, and the fault type.',
  },
  'diff.chart': {
    title: 'Operating characteristic',
    text: () => 'Operate current |IA + IB| against restraint (|IA| + |IB|)/2: above the line it trips. Every fault is a point; faults outside the line should sit near zero operate.',
  },
  'diff.results': {
    title: '87L results',
    text: () => 'For each fault: operate and restraint, and whether the differential tripped or restrained correctly.',
  },
}

// What is switched off right now: each with what it would add (Explain mode)
export const OFF_FEATURES = [
  { feature: 'adjacent', label: 'Adjacent lines', adds: 'stations X and Y, remote backup and the Station tab’s two-feeder bus' },
  { feature: 'pilot', label: 'Pilot schemes', adds: 'DCB, POTT and DCUB over a channel between the line’s two ends' },
  { feature: 'sir', label: 'Source impedance', adds: 'bus voltages that sag in a fault, and the phasor panel' },
  { feature: 'ground', label: 'Ground faults', adds: 'phase-to-ground faults and k0' },
  { feature: 'rf', label: 'Fault resistance', adds: 'resistive faults and the quadrilateral characteristic' },
  { feature: 'load', label: 'Prefault load', adds: 'load flowing before the fault' },
  { feature: 'infeed', label: 'Infeed', adds: 'sources at buses A and B (remote infeed)' },
  { feature: 'tap', label: 'Line tap', adds: 'an unprotected load tap on line A–B' },
  { feature: 'diff', label: 'Current differential (87L)', adds: 'line differential on A–B and the Differential tab' },
  { feature: 'busdiff', label: 'Bus differential (87B)', adds: 'a differential zone around bus B (Station tab)' },
]
export const offFeatures = config => OFF_FEATURES.filter(o => !config?.features?.[o.feature])

export function explain(id, ctx = {}) {
  const e = EXPLAIN[id]
  return e ? { id, title: e.title, text: e.text(ctx), detail: !!e.detail } : null
}
