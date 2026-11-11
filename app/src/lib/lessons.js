// Guided lessons — pure data, no React.
//
// Starting a lesson resets settings to defaults, then applies `setup`
// (mutates a fresh config), switches to `tab`, and sets the fault:
//   study: `faultId` (+ optional `studyChannel` for the A–B pilot channel)
//   coord: `fault` location + optional `scenario` (failures, channels)
//   diff:  Differential tab (uses `faultSpec`)
// Either tab: optional `faultSpec` { type: '3PH' | 'AG', rf } (fault type + resistance)
// Coordination lessons state the verdict their setup should produce in
// `expect`; sim.test.js runs every lesson to keep the story true.

const zone = (cfg, rid, id) => cfg.relays[rid].zones.find(z => z.id === id)
const adjacent = cfg => { cfg.features.adjacent = true }
const pilot = (cfg, scheme) => { cfg.features.pilot = true; cfg.schemes.AB = scheme }

// Turn on source impedance & phasors and set SIR per source bus: { A: 0.2, ... }
const sources = (cfg, sirs) => {
  cfg.features.sir = true
  for (const b of cfg.network.buses) if (b.id in sirs) b.sir = sirs[b.id]
}

export const TRACKS = ['Why protection matters', 'Basics', 'Coordination', 'Pilot schemes', 'Sources & phasors', 'Ground faults & Rf', 'Tapped lines', 'Current differential']

// Line tap on A–B (feature 'tap') with lesson-specific sizes
const tap = (cfg, t) => { cfg.features.tap = true; Object.assign(cfg.network.lines.find(l => l.id === 'AB').tap, t) }

// Why protection matters: adjacent lines (so remote backup and outages
// exist), a pilot scheme on A–B, and the consequences card on
const why = (cfg, scheme) => { adjacent(cfg); pilot(cfg, scheme); cfg.features.consequences = true }

export const LESSONS = [
  // ───────────── Why protection matters ─────────────
  {
    id: 'why-cost',
    track: 'Why protection matters',
    title: 'What a fault costs',
    tab: 'coord',
    setup: cfg => why(cfg, 'DCB'),
    fault: { kind: 'line', line: 'AB', frac: 0.1 },
    expect: { verdict: 'selective' },
    intro: 'A fault is a short circuit: very high current, an arc, and nearby generators pushed off balance until protection removes it. Line A–B has a fault 10% from A. Everything is working, and the Consequences card (right, under the outcome) adds up what the fault costs as it plays.',
    watch: [
      '21-AB trips on Zone 1 at 17 ms. 21-BA trips by its pilot scheme (DCB) at 50 ms, because no “block” came from A.',
      'The fault is cleared at 100 ms (6 cycles): inside the critical clearing time, fault duty and arc energy close to a fast clear, and only line A–B is out.',
    ],
    tryIt: [
      'Under Failures, tick “Breaker fails” for AB. 52-AB never opens, and nothing at station A can clear the fault. 21-XA at station X waits out its delayed Zone 2 and trips at 317 ms. The fault is cleared at 367 ms (22 cycles): past the critical clearing time, about 3× the fault duty and almost 4× the arc energy, and line X–A and bus A are lost as well.',
    ],
    takeaway: 'What protection delivers is time. The same fault costs little or a lot depending on how fast it is cleared and by whom: one failed link turned a 6-cycle clear of one line into a 22-cycle clear that left a whole station without supply.',
  },
  {
    id: 'why-dc',
    track: 'Why protection matters',
    title: 'The chain: one dead battery',
    tab: 'coord',
    setup: cfg => why(cfg, 'DCB'),
    fault: { kind: 'line', line: 'AB', frac: 0.1 },
    scenario: { dcLost: ['A'] },
    expect: { verdict: 'backup' },
    intro: 'A relay doesn’t trip anything on its own. It needs CTs and VTs to measure, the station battery to run on and to energize the breaker’s trip coil, and a breaker that opens. Here station A’s DC supply has failed (a battery or charger fault nobody caught) just as the same fault happens.',
    watch: [
      'At inception the log shows “Station A DC supply lost”: 21-AX and 21-AB are dead, and 52-AX and 52-AB cannot trip.',
      'B still trips at 50 ms. With A dead, no DCB block can arrive, so B’s scheme trips: DCB fails toward tripping.',
      'A’s side is cleared only by 21-XA’s delayed Zone 2 from station X: cleared at 367 ms, and bus A loses supply. That is remote backup: 21-XA protects line X–A, so it is not part of line A–B’s own protection.',
    ],
    tryIt: [
      'Under Failures → Station DC supply, tick A back on and replay: back to a 100 ms clear.',
      'With A’s DC off again, drag the fault to 50%. 21-XA’s Zone 2 doesn’t reach that far and nothing else sees the fault: in this model it is never cleared. Real systems add longer-reaching backup, but the point stands: every link has to work.',
      'Back at 10% with DC restored, break a different link in the Protection chain below (terminal AB): open the trip circuit. 21-AB still trips at 17 ms, but the trip never reaches 52-AB, and the result is the same 367 ms remote-backup clear.',
    ],
    takeaway: 'Protection is a chain. Standards call it a Protection System (NERC Glossary): relays, communications, voltage and current sensing, station DC supply, and control circuitry through the trip coils. Everything protecting one line together is its Composite Protection System; remote backup from another line’s protection, like 21-XA here, is not part of it. A failure nobody sees is found by the next fault, which is why batteries are alarmed and trip circuits supervised.',
  },
  {
    id: 'why-channel',
    track: 'Why protection matters',
    title: 'Your channel is in the trip path',
    tab: 'coord',
    setup: cfg => why(cfg, 'POTT'),
    fault: { kind: 'line', line: 'AB', frac: 0.9 },
    expect: { verdict: 'selective' },
    intro: 'Line A–B uses POTT: each end trips on its overreaching Zone 2 only when the other end confirms, over the teleprotection channel, that it sees the fault too. That channel is the communications path between the two stations.',
    watch: [
      'Both ends key PERMISSIVE at 17 ms; it arrives at the far end half a cycle later (the channel delay).',
      '21-AB trips POTT at 25 ms, and the fault is cleared at 75 ms (4.5 cycles).',
    ],
    tryIt: [
      'Under Failures → Pilot channels, set A–B to Out of service. 21-AB’s permissive never arrives, so it waits out its Zone 2 timer: trip at 317 ms, cleared at 367 ms (22 cycles), past the critical clearing time. Same fault, same relays; only the channel changed.',
      'Put the channel back and raise the channel delay in ⚙ Settings → Individual features → Channel delay (e.g. to 3 cycles). The clear slows down by the same amount: channel latency is part of the clearing time.',
    ],
    takeaway: 'For POTT, a dead channel costs speed, not security: the line still clears, just too slowly. Channel availability and latency are protection performance, which is why channels are monitored and their delay is part of the protection design.',
  },

  // ───────────── Basics ─────────────
  {
    id: 'z1-basics',
    track: 'Basics',
    title: 'Zone 1: instantaneous, but short',
    tab: 'coord',
    fault: { kind: 'line', line: 'AB', frac: 0.5 },
    expect: { verdict: 'selective' },
    intro: 'A fault in the middle of the line sits inside Zone 1 of both relays. Zone 1 has no intentional delay, so both ends trip as soon as the relay measures the fault.',
    watch: [
      'Both relays pick up Z1 at 1 cycle (relay operate time) and trip immediately.',
      'Both breakers open 3 cycles later — the fault is cleared in about 4 cycles (67 ms).',
      'On the coverage lanes, the red fault line falls inside both blue Z1 bars.',
    ],
    tryIt: [
      'Drag the fault slider to 85%. Relay A’s Z1 (80%) no longer reaches — which end is now slow, and by how much?',
      'Drag it to 15% and see the same thing happen at the other end.',
    ],
    takeaway: 'Zone 1 is the fast zone, but it deliberately covers only part of the line. Faults near either end are tripped instantly by one relay and slowly by the other.',
  },
  {
    id: 'z1-reach',
    track: 'Basics',
    title: 'Why Zone 1 stops short of 100%',
    tab: 'study',
    faultId: 'F5',
    intro: 'Zone 1 trips with no delay, so it must never see a fault beyond the remote bus — that fault belongs to another line’s relays. Errors in CTs, VTs and line impedance data can easily be 10–20%, so Zone 1 is set to about 80% of the line.',
    watch: [
      'F5 (Bus B) lands outside Relay A’s Z1 circle on the R-X plane, but inside Z2.',
      'The results table shows F5 and F6 as Backup (Z2) for Relay A — time-delayed, not instant.',
    ],
    tryIt: [
      'Raise Relay A Zone 1 reach to 110%. F5 and F6 turn into “Overreach (Z1)”: Relay A would trip instantly for faults that aren’t on its line.',
      'Set it back to 80% and confirm F4 (95%) is now cleared by Z2 at Relay A.',
    ],
    takeaway: 'Zone 1 trades coverage for security: an underreaching instantaneous zone never trips for an external fault, even with measurement error.',
  },
  {
    id: 'rx-plane',
    track: 'Basics',
    title: 'Reading the R-X plane',
    tab: 'study',
    faultId: 'F3',
    intro: 'A distance relay measures impedance (V/I) to the fault. With no fault resistance, faults land on the line-angle diagonal, at a distance proportional to how far away they are. Each zone is a MHO circle through the origin.',
    watch: [
      'Click the fault rows F1–F6: the red point walks out along the dashed line-angle line.',
      'A fault inside a circle asserts that zone; outside, it doesn’t.',
    ],
    tryIt: [
      'Switch the plane to Relay B and select F6. The fault is behind Relay B, so it lands in the opposite quadrant — outside every forward zone.',
      'In ⚙ Settings, change the line impedance angle and watch the circles and points rotate together.',
    ],
    takeaway: 'Zone reach is just the diameter of the MHO circle along the line angle. “Inside the circle” is the whole zone decision.',
  },
  {
    id: 'end-zone',
    track: 'Basics',
    title: 'Zone 2 and the end-zone problem',
    tab: 'coord',
    fault: { kind: 'line', line: 'AB', frac: 0.9 },
    expect: { verdict: 'selective' },
    intro: 'Zone 2 overreaches the line (120%) so the last 20% near the far end is still covered — but only after a delay (18 cycles), so it can coordinate with relays on the next line.',
    watch: [
      'Relay B sees the fault at 10% — Z1, instant trip. Its breaker opens at 67 ms.',
      'Relay A sees it at 90% — only Z2. Watch its timer ramp on the timing chart.',
      'The fault stays fed from Bus A for about 300 ms until Relay A’s Z2 times out.',
    ],
    tryIt: [
      'Move the fault to 50% — both ends fast again.',
      'Shorten Relay A’s Z2 delay in Relay & line settings. Faster here — but the Coordination track shows why you can’t just do that.',
    ],
    takeaway: 'Without communication between the ends, faults in the last ~20% of the line are cleared slowly at one end. Pilot schemes exist to fix exactly this.',
  },

  // ───────────── Coordination ─────────────
  {
    id: 'z2-time',
    track: 'Coordination',
    title: 'Zone 2 coordinates by time',
    tab: 'coord',
    setup: adjacent,
    fault: { kind: 'line', line: 'BY', frac: 0.1 },
    expect: { verdict: 'selective' },
    intro: 'Relay A’s Zone 2 reaches into the next line (B–Y). For a fault there it picks up too — and must wait long enough for the B–Y relays to clear their own fault first.',
    watch: [
      '21-AB Z2 picks up at 17 ms and starts its 18-cycle timer.',
      '21-BY trips on Z1; 52-BY opens at 67 ms, and 21-AB’s Z2 resets with 250 ms to spare.',
      'The far end (21-YB) clears its side on Z2 — sequential clearing on line B–Y.',
    ],
    tryIt: [
      'Drop 21-AB’s Z2 delay to 2 cycles. Now it times out before 52-BY opens — line A–B trips for a fault that isn’t on it.',
      'Set it to 12 cycles: it works, but the outcome warns the margin is less than the CTI.',
    ],
    takeaway: 'Overlapping zones are fine as long as the slower one waits at least one coordination interval (CTI) longer than the faster one needs to clear.',
  },
  {
    id: 'remote-backup',
    track: 'Coordination',
    title: 'Zone 2 as remote backup',
    tab: 'coord',
    setup: adjacent,
    fault: { kind: 'line', line: 'BY', frac: 0.1 },
    scenario: { breakerFail: ['BY'] },
    expect: { verdict: 'backup' },
    intro: '21-BY detects the fault and trips — but breaker 52-BY is stuck. Nothing at Station B removes the fault, so the remote relay at A has to.',
    watch: [
      '52-BY FAILS: the fault is still fed through Bus B.',
      '21-AB’s Z2 keeps timing (it never sees the current drop) and trips at about 317 ms.',
      'The outcome is “Cleared by backup” — but all of line A–B is now out too.',
    ],
    tryIt: [
      'Under Failures, clear the stuck breaker and compare the outage.',
      'Disable 21-AB’s Z2 with the breaker still stuck — now nothing clears the fault from the A side.',
    ],
    takeaway: 'Zone 2 doubles as remote backup for the next station. It works, but it’s slow and takes out more of the system than necessary.',
  },
  {
    id: 'z2-race',
    track: 'Coordination',
    title: 'Zone 2 overreach race',
    tab: 'coord',
    setup: cfg => { adjacent(cfg); zone(cfg, 'AB', 2).reach = 200 },
    fault: { kind: 'line', line: 'BY', frac: 0.9 },
    expect: { verdict: 'miscoordination' },
    intro: '21-AB’s Zone 2 has been stretched to 200% — past the end of 21-BY’s Zone 1, into territory that 21-BY only covers with its own Zone 2. Both Zone 2s have the same delay.',
    watch: [
      'The red hatching on 21-AB’s Z2 lane: the setting itself is flagged before any fault.',
      '21-AB Z2 and 21-BY Z2 both time out at 317 ms — a tie. 52-AB opens for a fault on line B–Y.',
    ],
    tryIt: [
      'Raise 21-AB’s Z2 delay to 30 cycles (18 + 12-cycle CTI). The hatching clears and 21-AB resets in time.',
      'Or pull its reach back to 120% — the other classic fix.',
    ],
    takeaway: 'Where two Zone 2s overlap, they must be separated in time by at least a CTI — or the upstream Zone 2 must be shortened.',
  },
  {
    id: 'relay-oos',
    track: 'Coordination',
    title: 'When a relay is out of service',
    tab: 'coord',
    setup: adjacent,
    fault: { kind: 'line', line: 'BY', frac: 0.1 },
    scenario: { relayOos: ['BY'] },
    expect: { verdict: 'backup' },
    intro: '21-BY is out of service (for testing, say). Its coverage lanes are gone: nothing at Station B protects line B–Y.',
    watch: [
      '21-YB still clears its end; the B side relies on 21-AB’s Z2, reaching through Bus B.',
      'Cleared by backup at about 367 ms.',
    ],
    tryIt: [
      'Move the fault to 50% of B–Y. 21-AB’s Z2 (1.2 pu) no longer reaches it — the fault is never cleared from the A side.',
    ],
    takeaway: 'Remote backup only covers as far as the upstream Zone 2 reaches. Long Zone 2 (or a Zone 3) buys backup coverage — at the cost of the coordination problems you just saw.',
  },

  // ───────────── Pilot schemes ─────────────
  {
    id: 'dcb-internal',
    track: 'Pilot schemes',
    title: 'DCB fixes the end-zone problem',
    tab: 'coord',
    setup: cfg => pilot(cfg, 'DCB'),
    fault: { kind: 'line', line: 'AB', frac: 0.9 },
    expect: { verdict: 'selective' },
    intro: 'Directional Comparison Blocking (DCB): each relay may trip on its overreaching Zone 2 after a short coordination timer — unless the far end sends a BLOCK saying “this fault is behind me.”',
    watch: [
      '21-AB Z2 picks up at 17 ms and starts the 2-cycle DCB coordination timer.',
      'No block arrives (the fault is in front of 21-BA), so 21-AB trips DCB at 50 ms instead of 317 ms.',
    ],
    tryIt: [
      'Change the A–B scheme to Step distance and replay — the same fault, about 270 ms slower.',
    ],
    takeaway: 'A pilot scheme lets the overreaching zone trip at high speed for internal faults — the whole line is now covered without delay.',
  },
  {
    id: 'dcb-external',
    track: 'Pilot schemes',
    title: 'DCB on an external fault: the block',
    tab: 'coord',
    setup: cfg => { pilot(cfg, 'DCB'); adjacent(cfg) },
    fault: { kind: 'line', line: 'BY', frac: 0.1 },
    expect: { verdict: 'selective' },
    intro: 'Now the fault is just past Bus B, on line B–Y. 21-AB’s Zone 2 sees it — so what stops a DCB trip at 50 ms?',
    watch: [
      '21-BA’s reverse Zone 3 (Z3R) sees the fault behind it and keys BLOCK at 17 ms.',
      'The block reaches 21-AB at 25 ms (channel delay); the coordination timer expires at 50 ms — trip held.',
      'Timing chart: TX BLK at 21-BA, RX BLK at 21-AB.',
    ],
    tryIt: [
      'Shorten 21-BA’s Z3 reverse reach to 10%. The coverage check hatches 21-AB’s Z2: past that point no block is sent. Move the fault to 25% of B–Y (inside that gap) to see it overtrip.',
    ],
    takeaway: 'In DCB, security comes from the remote end’s reverse zone. It must reach further behind its bus than the local Zone 2 overreaches past it.',
  },
  {
    id: 'dcb-channel',
    track: 'Pilot schemes',
    title: 'DCB channel failure overtrips',
    tab: 'coord',
    setup: cfg => { pilot(cfg, 'DCB'); adjacent(cfg) },
    fault: { kind: 'line', line: 'BY', frac: 0.1 },
    scenario: { channels: { AB: 'out' } },
    expect: { verdict: 'miscoordination' },
    intro: 'Same external fault — but the A–B channel is out of service. 21-BA keys its block, and nobody hears it.',
    watch: [
      '“21-BA keys BLOCK — channel out of service, not received.”',
      '21-AB trips DCB at 50 ms for a fault on another line: an overtrip.',
    ],
    tryIt: [
      'Set the channel to In service and replay.',
      'Switch the A–B scheme to POTT with the channel still out — no overtrip, but see what happens to internal faults in the next lesson.',
    ],
    takeaway: 'DCB fails toward tripping: losing the channel costs security, not dependability. That’s why DCB channels are monitored closely.',
  },
  {
    id: 'dcb-timer',
    track: 'Pilot schemes',
    title: 'Coordination timer vs channel time',
    tab: 'coord',
    setup: cfg => { pilot(cfg, 'DCB'); adjacent(cfg); cfg.pilot.dcbCoordCycles = 0.25 },
    fault: { kind: 'line', line: 'BY', frac: 0.1 },
    expect: { verdict: 'miscoordination' },
    intro: 'The DCB coordination timer has been set to 0.25 cycles — shorter than the 0.5-cycle channel delay. The block is sent correctly… and arrives too late.',
    watch: [
      '21-AB trips DCB at about 21 ms; the block arrives at 25 ms.',
    ],
    tryIt: [
      'In ⚙ Settings, raise the DCB coordination timer to 1 cycle and replay.',
    ],
    takeaway: 'The DCB coordination timer must cover the channel time plus any difference in how fast the two ends’ elements operate.',
  },
  {
    id: 'pott',
    track: 'Pilot schemes',
    title: 'POTT: secure, but needs the channel',
    tab: 'coord',
    setup: cfg => pilot(cfg, 'POTT'),
    fault: { kind: 'line', line: 'AB', frac: 0.9 },
    expect: { verdict: 'selective' },
    intro: 'Permissive Overreaching Transfer Trip (POTT): each end trips on Zone 2 only when the far end also sees the fault forward and sends PERMISSIVE.',
    watch: [
      'Both ends key permissive at 17 ms; 21-AB receives it and trips POTT at 25 ms.',
    ],
    tryIt: [
      'Under Failures, set the A–B channel to Out of service. No permissive — 21-AB falls back to step-distance Z2 at 317 ms.',
    ],
    takeaway: 'POTT fails toward not tripping fast: losing the channel costs speed (dependability), never security — the opposite trade from DCB.',
  },
  {
    id: 'dcub',
    track: 'Pilot schemes',
    title: 'DCUB: riding through loss of channel',
    tab: 'coord',
    setup: cfg => pilot(cfg, 'DCUB'),
    fault: { kind: 'line', line: 'AB', frac: 0.9 },
    scenario: { channels: { AB: 'lost' } },
    expect: { verdict: 'selective' },
    intro: 'Power-line carrier channels can be lost because of the fault itself. Directional Comparison Unblocking (DCUB) is POTT plus unblock logic: on sudden loss of channel, allow a Z2 trip for a short window (~150 ms), then lock out.',
    watch: [
      '“Channel lost at fault — DCUB unblock window open.”',
      '21-AB trips DCUB at 17 ms on Z2 alone, inside the window.',
    ],
    tryIt: [
      'Set the channel to Out of service (failed before the fault). The window has long since closed — 21-AB is locked out to step distance.',
      'Set the unblock window to 0.5 cycles in ⚙ Settings so it closes before Z2 picks up.',
    ],
    takeaway: 'DCUB keeps POTT’s security while recovering dependability for the classic case: a channel lost because of the fault it’s needed for.',
  },

  // ───────────── Sources & phasors (V2) ─────────────
  {
    id: 'sir-voltage',
    track: 'Sources & phasors',
    title: 'SIR: same impedance, very different voltage',
    tab: 'coord',
    setup: cfg => sources(cfg, { A: 0.2, B: 1 }),
    fault: { kind: 'line', line: 'AB', frac: 0.05 },
    expect: { verdict: 'selective' },
    intro: 'A relay measures Z = V / I. The source behind it doesn’t change where the fault is, so it doesn’t change Z. It does change how much voltage is left at the relay. SIR (source impedance ÷ line impedance) is the number that captures this.',
    watch: [
      'In the phasor panel, 21-AB sees about 0.20 pu voltage and Z = 5% of the line. The current lags the prefault voltage by the line angle.',
      'Z1 at A trips in 1 cycle; B, which sees the fault at 95%, clears it on Z2.',
    ],
    tryIt: [
      'In ⚙ Settings, set Source A to Very weak (SIR 10). 21-AB’s voltage falls to about 0.005 pu (half a percent). Z is still 5%, and the trip is unchanged.',
      'Set Source A to Stiff (SIR 0). An infinite bus holds A at 1 pu, so the relay sees full voltage and a huge current.',
    ],
    takeaway: 'With high SIR, a close-in fault leaves almost no voltage at the relay. The ideal relay modelled here still measures Z exactly. A real one is then at the mercy of VT/CVT error and transients, which is why Zone 1 accuracy is specified against SIR and why distance elements need memory polarization.',
  },
  {
    id: 'memory-polarization',
    track: 'Sources & phasors',
    title: 'Zero volts: direction from memory',
    tab: 'coord',
    setup: cfg => { adjacent(cfg); sources(cfg, { X: 1, Y: 1 }) },
    fault: { kind: 'bus', bus: 'A' },
    expect: { verdict: 'backup' },
    intro: 'For a bolted fault on its own bus, a relay measures V = 0, so Z = 0. That is right on the boundary of a MHO circle through the origin. Is the fault in front or behind? The relay can’t tell from a voltage that isn’t there, so it uses the voltage from just before the fault (memory polarization).',
    watch: [
      '21-AB: V = 0. The current comes in from line A–B, pointing away from the prefault reference, so it reads Reverse (memory). It does not trip.',
      '21-BA sees the same fault 100% away, forward, and clears it on Z2 as remote backup. 21-XA does the same from the other side.',
    ],
    tryIt: [
      'Move the fault 5% onto line A–B. 21-AB’s voltage comes back, its current reverses, and Z1 trips.',
      'Change the SIRs: V and I change size, but the directions don’t.',
    ],
    takeaway: 'Memory polarization gives a distance relay a reference that survives a close-in fault. Here it makes the own-bus fault unambiguously reverse. In a real relay it also keeps forward close-in faults inside Zone 1 when the voltage collapses.',
  },
  {
    id: 'infeed',
    track: 'Sources & phasors',
    title: 'Infeed: why remote backup underreaches',
    tab: 'coord',
    setup: cfg => {
      adjacent(cfg)
      sources(cfg, { X: 1, Y: 1, B: 1 })
      cfg.features.infeed = true
      cfg.network.buses.find(b => b.id === 'B').infeed = true
    },
    fault: { kind: 'line', line: 'BY', frac: 0.2 },
    expect: { verdict: 'selective' },
    intro: 'With a source at Bus B, fault current on line B–Y comes from two directions: through relay 21-AB from A, and straight in from B. Relay 21-AB only measures its own current, but the voltage at A includes the drop caused by B’s current too. The fault looks further away than it is.',
    watch: [
      'The fault is 112% of line A–B away from 21-AB, inside its 120% Zone 2. The phasor panel shows 21-AB measuring 148%.',
      '21-AB’s Z2 never picks up: there is no remote backup for this fault. B–Y’s own relays clear it.',
      'The one-line shows the infeed source under Bus B feeding the fault.',
    ],
    tryIt: [
      'In ⚙ Settings → Infeed sources, untick Bus B. 21-AB now reads 112% and Z2 picks up, standing by as backup.',
      'Tick it again and set B to Weak (SIR 4): less infeed, 121%, just outside Zone 2.',
      'Under Failures, make 52-BY fail to open. The fault is never cleared: opening 52-AB can’t isolate B’s own source. That is the job of local breaker-failure protection (not modeled).',
    ],
    takeaway: 'Infeed makes a remote relay underreach by the factor (1 + I_infeed / I_relay) on the far side of the infeed bus. That’s why Zone 2 needs margin, why remote backup coverage shrinks at strong buses, and why breaker-failure protection is local.',
  },

  // ───────────── Ground faults & Rf (V2) ─────────────
  {
    id: 'ground-k0',
    track: 'Ground faults & Rf',
    title: 'Ground distance needs k0',
    tab: 'coord',
    setup: cfg => { cfg.features.ground = true; sources(cfg, { A: 1, B: 1 }) },
    fault: { kind: 'line', line: 'AB', frac: 0.7 },
    faultSpec: { type: 'AG' },
    expect: { verdict: 'selective' },
    intro: 'For a phase-to-ground fault, the current returns partly through the ground (zero sequence, 3I0), and the line’s zero-sequence impedance is about 3× its positive-sequence impedance. Va/Ia alone would read the fault too far away. Ground elements compensate: Z = Va / (Ia + k0·3I0), with k0 = (Z0 − Z1) / 3Z1.',
    watch: [
      'In the phasor panel, both relays show 3I0 and measure on the AG loop: Z(AG) = 70% at A and 30% at B, which is the true distance.',
      'Both Z1 elements trip in 1 cycle.',
    ],
    tryIt: [
      'Open “Relay & line settings”, untick auto k0 on 21-AB and set it to 0 (no compensation). Z(AG) now reads beyond Z1’s 80% reach, and A clears on Z2 (slow).',
      'Set 21-AB’s k0 to 1.5 (overcompensated) and move the fault to 95%. Z1 at A now trips for a fault it shouldn’t reach.',
      'Switch the fault to 3Ø: no 3I0, a phase loop (AB) measures, and k0 doesn’t matter.',
    ],
    takeaway: 'A ground element is only as accurate as its k0. Under-compensation underreaches, over-compensation overreaches, and Z0 data is often the least reliable line parameter.',
  },
  {
    id: 'rf-mho',
    track: 'Ground faults & Rf',
    title: 'Fault resistance vs the MHO',
    tab: 'coord',
    setup: cfg => { cfg.features.rf = true; sources(cfg, {}) },
    fault: { kind: 'line', line: 'AB', frac: 0.5 },
    faultSpec: { rf: 0.25 },
    expect: { verdict: 'selective' },
    intro: 'Arcs, tower footings and trees put resistance in the fault path. The relay measures Z = Z_line·d + Rf·(I_fault / I_relay): the fault point slides to the right on the R-X plane, off the line-angle diagonal. A MHO circle is narrow in the R direction, so it covers little resistance.',
    watch: [
      'A midline fault would normally trip both Z1 elements in 1 cycle. With Rf = 0.25 pu it sits outside both Z1 circles: both ends clear on Z2 at 300 ms.',
      'In the phasor panel, Z’s angle has dropped well below the 75° line angle: the added resistance pulls it toward the R axis.',
    ],
    tryIt: [
      'Lower Rf to 0.15 pu: back inside Z1 at both ends.',
      'Raise Rf to 0.6 pu: outside every MHO zone. Nothing trips and the fault is never cleared.',
      'On the Fault Study tab, set Rf and watch every fault point slide right on the R-X plane.',
    ],
    takeaway: 'Remote infeed multiplies the apparent resistance (here both ends feed equally, so each relay sees 2·Rf). Resistive coverage is why ground elements are often quadrilateral, and why ground overcurrent backs up ground distance.',
  },
  {
    id: 'quad',
    track: 'Ground faults & Rf',
    title: 'Quadrilateral: room for resistance',
    tab: 'coord',
    setup: cfg => {
      cfg.features.rf = true
      sources(cfg, {})
      cfg.relays.AB.shape = 'quad'
      cfg.relays.BA.shape = 'quad'
    },
    fault: { kind: 'line', line: 'AB', frac: 0.5 },
    faultSpec: { rf: 0.25 },
    expect: { verdict: 'selective' },
    intro: 'A quadrilateral characteristic sets reactive and resistive reach independently: a reactance line at the zone’s reach, and resistive blinders parallel to the line angle. Resistive coverage no longer has to come from a bigger circle.',
    watch: [
      'The same midline fault with Rf = 0.25 pu that dropped to Z2 under MHO now trips Z1 at both ends in 1 cycle.',
      'Open “Relay & line settings”: each zone has an R reach as well as a reach. Z1 is 100%, Z2 is 150% of the line impedance.',
    ],
    tryIt: [
      'Raise Rf to 0.6 pu. MHO never cleared this fault; the quad’s Z2 does, at 300 ms.',
      'With Rf at 0.6, switch 21-AB back to MHO. B clears on Z2, then A’s apparent resistance halves because B’s infeed is gone, and A’s MHO Z2 picks up and clears the fault sequentially.',
      'Back at Rf 0.25, cut 21-AB’s Z1 R reach to 40%. A no longer sees the fault in Z1 until B opens; then, with B’s infeed gone, A’s apparent resistance halves and Z1 trips: sequential clearing at 83 ms.',
    ],
    takeaway: 'Quads buy resistive coverage, mostly for ground faults. The cost is security: a wide resistive reach on Z1 can overreach when load flow tilts the apparent impedance (not modeled here), so Z1’s R reach is set with care.',
  },
  {
    id: 'load-rf',
    track: 'Ground faults & Rf',
    title: 'Load + Rf: the sending end overreaches',
    tab: 'coord',
    setup: cfg => {
      cfg.features.rf = true
      cfg.features.load = true
      cfg.loadAngleDeg = 40
      sources(cfg, {})
      cfg.relays.AB.shape = 'quad'
      cfg.relays.BA.shape = 'quad'
    },
    fault: { kind: 'line', line: 'AB', frac: 0.9 },
    faultSpec: { rf: 0.1 },
    expect: { verdict: 'selective' },
    intro: 'Before the fault, power flows from A to B: A’s source leads B’s by δ = 40°. The two ends then feed a resistive fault with currents of different phase, so Rf·(I_fault / I_relay) is no longer a pure resistance. At the sending end the apparent impedance tilts down and looks closer; at the receiving end it tilts up and looks further.',
    watch: [
      'Prefault (t < 0): both relays carry load current. The phasor cards show the load impedance, 21-AB forward near the R axis and 21-BA in reverse.',
      'The fault is at 90%, beyond 21-AB’s 80% Zone 1, yet 21-AB trips Z1 in 1 cycle: its measured Z has dropped to about 90% at a low angle.',
    ],
    tryIt: [
      'In ⚙ Settings set δ to 0° (no load). 21-AB now measures about 151% and waits for Zone 2 at 300 ms.',
      'Back at 40°, switch 21-AB to MHO. The tilted point is outside the circle, and A waits for Zone 2.',
    ],
    takeaway: 'Load flow plus fault resistance makes the sending end overreach and the receiving end underreach. For a fault just beyond the remote bus, that overreach is an instantaneous misoperation. That’s why Zone 1 resistive reach is kept conservative, and why modern relays tilt the reactance line or use load-compensated (negative-sequence) polarizing.',
  },
  {
    id: 'load-encroachment',
    track: 'Ground faults & Rf',
    title: 'Load encroachment',
    tab: 'study',
    faultId: 'F3',
    setup: cfg => {
      cfg.features.rf = true
      cfg.features.load = true
      cfg.loadAngleDeg = 60
      for (const l of cfg.network.lines) if (l.id !== 'AB') l.length = 0.3
      cfg.relays.AB.shape = 'quad'
    },
    intro: 'Heavy power transfer is a low impedance seen by the relay: V / I_load. It sits near the R axis, far out when load is light and closer in as transfer grows. A characteristic with a wide resistive reach can reach it.',
    watch: [
      'A strong system (short lines out to the sources) is carrying a heavy transfer: δ = 60°. The grey ◆ Load point on Relay A’s R-X plane sits at about 147% near 5°: inside the Z2 quadrilateral (R reach 150%).',
      'A real relay would pick up Zone 2 on load alone and trip after 18 cycles with no fault on the system. (This simulator evaluates zones only during faults, so here it is a picture, not a trip.)',
    ],
    tryIt: [
      'Switch Relay A to MHO: the narrow circle stays clear of the load point.',
      'With the quad, cut Z2’s R reach to 100%, or lower δ to 40° in ⚙ Settings (load moves out to about 225%).',
    ],
    takeaway: 'Resistive coverage and load are in tension. Settings keep the zones clear of the heaviest expected load (with margin), or relays add load-encroachment blinders that cut the load region out of the characteristic.',
  },

  // ───────────── Tapped lines (V4 step 1: unprotected load tap) ─────────────
  {
    id: 'tap-underreach',
    track: 'Tapped lines',
    title: 'The tap section is inside your zone',
    tab: 'coord',
    setup: cfg => { tap(cfg, { at: 0.5, lead: 0.3 }); cfg.features.sir = true; cfg.features.pilot = true; cfg.schemes.AB = 'step' },
    fault: { kind: 'tap', frac: 1 },
    expect: { verdict: 'selective' },
    intro: 'Line A–B has an unprotected load tap at its midpoint: a 0.3 pu tap section runs from T down to a tap transformer, with no breaker. A fault at the end of the tap section is inside A–B’s zone, and it is 0.8 pu from each end (0.5 along the line plus 0.3 down the tap), inside an 80% Zone 1. Watch what each relay actually measures.',
    watch: [
      'Both relays measure 110%, not 80% (phasor cards, below). Each relay sees only its own current, but the other end’s current also flows into T and down the tap section: measured Z = Z to T + Z of the tap section × (1 + I_other / I_own) = 0.5 + 0.3 × 2.',
      'Neither Zone 1 picks up. Both Zone 2s do, and the fault is cleared at 367 ms (22 cycles) by step distance.',
    ],
    tryIt: [
      'In Relay & line settings (below), set line A–B’s pilot scheme to POTT: both ends trip at 25 ms and the fault clears at 75 ms. On a tapped line the pilot scheme covers what Zone 1 can’t.',
      'Back on step distance, make B’s source weak (⚙ Settings → Source impedance, B = Weak, SIR 4). A now measures 83%, close to the true 80%: a weak far end adds little infeed. B measures 350% and only trips on Zone 1 once A has opened: cleared at 433 ms.',
      'Lengthen the tap section (⚙ Settings → Line tap → Tap section) from 0.30 to 0.50: the true distance becomes 100% from each end, but each relay measures 150%. The longer the section, the bigger the gap, because the infeed multiplies the tap section’s impedance.',
      'Move the fault onto the main line at 55%: the relays read 55% and 45%, exactly as without the tap. A load tap barely affects line faults; the underreach comes from faults fed from both ends through T. (Near B the tap does draw some current out at T, and 21-AB reads 1–2% short: outfeed, a slight overreach.)',
    ],
    takeaway: 'A fault on an unprotected tap section is fed from both line terminals, so each relay sees the other end’s current as infeed at T and measures the fault further away than it is. Zone 1 may not cover the tap section from either end, which is why tapped lines lean on pilot schemes.',
  },
  {
    id: 'tap-behind',
    track: 'Tapped lines',
    title: 'Fault behind the tap transformer',
    tab: 'coord',
    setup: cfg => { tap(cfg, { at: 0.3, lead: 0.2, zt: 0.3 }); cfg.features.sir = true },
    fault: { kind: 'tapLV' },
    expect: { verdict: 'selective' },
    intro: 'This tap feeds a large load through a low-impedance tap transformer, 30% along A–B. A fault on the tap’s low-voltage bus is not on line A–B: the tap transformer’s own protection clears it (here a fixed 6 cycles, illustrative). The line relays must leave it alone, or at least wait.',
    watch: [
      '21-AB measures 101% (tap section and transformer, plus infeed from B): outside Zone 1, inside Zone 2. Its Zone 2 picks up and starts timing.',
      'The tap protection clears the fault at 100 ms and 21-AB’s Zone 2 resets. Only the tap is lost.',
      '21-BA measures 237%: its Zone 2 never sees the fault.',
    ],
    tryIt: [
      'In Zone reach (left), set 21-AB’s Z2 delay to 3 cycles. Its Zone 2 now trips at 67 ms, before the tap protection: line A–B is lost for a fault that wasn’t on it (miscoordination).',
      'Try 6 cycles: the tap protection still wins, but Zone 2 resets with only 17 ms to spare (tight).',
    ],
    takeaway: 'Zone 2 has to coordinate with the protection of everything it can reach, including transformers on unprotected taps. The tap transformer’s impedance keeps Zone 1 out; Zone 2’s time keeps it behind the tap’s own protection.',
  },
  {
    id: 'tap-87l',
    track: 'Tapped lines',
    title: 'A tap the 87L can’t see',
    tab: 'diff',
    setup: cfg => { tap(cfg, { zt: 0.5, load: 0.6 }); cfg.features.diff = true },
    intro: 'Line A–B’s current differential compares the currents at A and B. An unprotected tap has no CT in the scheme, so the current it draws looks exactly like current flowing into a fault on the line.',
    watch: [
      'The Healthy row (no fault): Iop ≈ 0.35 pu, the tap’s load current (slightly offset by the line’s charging current, which leads while the load lags). That is above the 0.3 pu pickup: Misoperation, the line trips on load.',
      'Faults on the line (F2–F4) still trip; faults outside it restrain.',
    ],
    tryIt: [
      'Raise Pickup to 0.5 pu: the healthy line restrains, and F2–F4 still trip with Iop of 1.6 pu and more.',
      'Switch the tap off (⚙ Settings → Individual features → Line tap): Iop drops to the charging current alone, 0.05 pu.',
    ],
    takeaway: 'Current drawn by an unmeasured tap is differential current. The pickup has to sit above the tapped load, with margin for load growth, or the tap needs its own CTs in the scheme: a trade between sensitivity and equipment.',
  },

  // ───────────── Current differential ─────────────
  {
    id: 'diff-basics',
    track: 'Current differential',
    title: 'Differential: what goes in must come out',
    tab: 'diff',
    setup: cfg => { cfg.features.diff = true; cfg.features.rf = true; cfg.features.ground = true },
    intro: 'A line differential relay compares the currents at both ends of the line (over a communication channel). For anything outside the line, what flows in at one end flows out at the other: IA + IB ≈ 0. A fault on the line draws current in from both ends: IA + IB is the fault current. No impedance, no reach, no zones.',
    watch: [
      'Internal faults F2, F3 and F4 sit high in the operate region. External faults F1, F5 and F6 sit on the floor: Iop ≈ 0 however large the through current.',
      'The Healthy row shows a small Iop that never goes away: the line’s charging current.',
    ],
    tryIt: [
      'Set Rf to 1.0 pu (3Ø). The internal points drop but stay above the characteristic. On the Fault Study tab, distance has lost these faults.',
      'Switch to A–G with Rf at 2.0 pu: still a trip. Differential sees resistive faults that distance can’t.',
    ],
    takeaway: 'Differential is inherently selective: its zone is exactly the line between the CTs, with no reach to set and nothing to coordinate. The price is a dependable channel, and attention to anything that makes the two ends disagree.',
  },
  {
    id: 'diff-security',
    track: 'Current differential',
    title: 'CT error and charging: why slope and pickup',
    tab: 'diff',
    setup: cfg => { cfg.features.diff = true; cfg.diff.ctErrorPct = 50 },
    intro: 'Differential only works if both ends measure the same current. A CT that saturates on a heavy through fault under-reports, and the difference looks like an internal fault. The line’s own charging current is a real difference that is always there.',
    watch: [
      'With B’s CT under-reporting by 50%, the Bus A fault (F1, external) shows Iop = 0.32 pu: above the 0.3 pu pickup and the 30% slope. A misoperation.',
      'The internal faults are far above the characteristic either way.',
    ],
    tryIt: [
      'Raise the slope to 80%. F1 drops into the restraint region; F2–F4 still operate. Restraint scales with the through current, which is exactly what CT error does.',
      'Set CT error back to 0 and line charging current to 0.4 pu: the Healthy line now “trips”. Pickup must sit above the charging current (or the relay must compensate for it).',
    ],
    takeaway: 'Slope buys security against CT error on heavy through faults; pickup buys security against charging current. Both cost a little sensitivity, which differential has plenty of.',
  },
  {
    id: 'diff-coord',
    track: 'Current differential',
    title: '87L in the clearing sequence',
    tab: 'coord',
    setup: cfg => { cfg.features.diff = true; adjacent(cfg) },
    fault: { kind: 'line', line: 'AB', frac: 0.9 },
    expect: { verdict: 'selective' },
    intro: 'Line A–B now has a current differential relay as primary protection, with distance kept as backup. This is the end-zone fault from the Basics track, the one where A could only clear on Zone 2.',
    watch: [
      'The 87L OP trace rises at both ends as soon as the fault is applied. A trips “87L” at 25 ms: one cycle of relay time plus half a cycle of channel time.',
      'B’s Zone 1 already sees the fault at 10% and trips first, at 17 ms. Distance and differential run side by side, and the first to operate wins. What matters is that A no longer waits 300 ms for Zone 2.',
    ],
    tryIt: [
      'Under Failures, set the 87L channel to Out of service. Differential is blocked and you’re back to step distance: B on Z1, A on Z2 at 317 ms.',
      'With the channel back in, move the fault onto line B–Y (10%). 87L restrains; B–Y’s own relays clear it.',
      'Open the Differential tab and set CT error at B to 80%, then place the fault on B–Y again: 87L misoperates and trips A–B out of section.',
    ],
    takeaway: 'Differential clears the whole line at high speed from both ends, with no end-zone problem and no coordination margin. Distance stays behind it for when the channel or the differential relay is lost.',
  },
]

export const lessonById = id => LESSONS.find(l => l.id === id)
