// Guided lessons — pure data, no React.
//
// Starting a lesson resets settings to defaults, then applies `setup`
// (mutates a fresh config), switches to `tab`, and sets the fault:
//   study: `faultId` (+ optional `studyChannel` for the A–B pilot channel)
//   coord: `fault` location + optional `scenario` (failures, channels)
//   diff:  Differential tab (uses `faultSpec`)
// Coordination lessons may set `showConsequences` to open the consequences details.
//   station: Station tab: like coord, plus `station` (the bus shown, default B)
//   bay:   Bay tab: like coord (`fault`, `scenario`), plus
//          `bayRelay` (the terminal shown, default AB). Bay lessons also state
//          `expect.measured`: { rid, zOhm, dir } — what the relay measures at the
//          fault (primary ohms, +1 forward / -1 reverse / 0 none)
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

export const TRACKS = ['Foundations', 'Why protection matters', 'Basics', 'Coordination', 'Pilot schemes', 'Sources & phasors', 'Ground faults & Rf', 'Tapped lines', 'Current differential', 'Bus differential']

// Line tap on A–B (feature 'tap') with lesson-specific sizes
const tap = (cfg, t) => { cfg.features.tap = true; Object.assign(cfg.network.lines.find(l => l.id === 'AB').tap, t) }

// Why protection matters: adjacent lines (so remote backup and outages
// exist) and a pilot scheme on A–B. These lessons open the consequences details (`showConsequences`).
const why = (cfg, scheme) => { adjacent(cfg); pilot(cfg, scheme) }

// Bus differential: the Foundations setup plus the 87B module on bus B
const busdiff = cfg => { foundations(cfg); cfg.features.busdiff = true }

// Foundations: the Bay tab, the full chain (so remote backup exists) and
// source impedance behind X and Y (so bus voltage sags as it does in a real
// fault). Display values: typical 138 kV, 20 Ω line, CT 1200:5, VT 1200:1.
const foundations = cfg => {
  adjacent(cfg)
  sources(cfg, { X: 0.5, Y: 0.5 })
}

export const LESSONS = [
  // ───────────── Foundations ─────────────
  {
    id: 'f-cannot-see',
    track: 'Foundations',
    title: 'The relay cannot see the line',
    tab: 'bay',
    setup: foundations,
    fault: { kind: 'line', line: 'AB', frac: 0.5 },
    expect: { verdict: 'selective', measured: { rid: 'AB', zOhm: 10, dir: 1 } },
    intro: 'Relay 21-AB sits in the control house at station A. Line A–B runs off toward station B; the relay can’t see it, and it can’t see the fault. Everything it knows arrives on wires: three currents from the CT, three voltages from the VT, the breaker’s 52a contact saying whether the breaker is closed, and, with a pilot scheme, a signal from the other end. This tab draws one terminal as a station bay so you can follow each of those inputs.',
    watch: [
      'Step once to the fault (0 ms). On the drawing, 1.99 kA flows from the bus toward the line. The CT turns it into 8.3 A on its secondary wiring, and the VT turns the collapsed 19.9 kV phase voltage into 16.6 V.',
      'What the relay sees: the same quantities three ways: on the line, at the relay terminals, and as the relay computes them back. Here they agree, so there are no ≠ marks.',
      'From V and I the relay works out Z = 10.0 Ω forward: half of the 20 Ω line. Zone 1 trips at 17 ms; 52-AB opens at 67 ms, its 52a contact goes open and the current stops.',
    ],
    tryIt: [
      'In the Protection chain, set the VT fuse to All blown and step to the fault. Nothing changed on the line, but the relay’s voltage is zero: Z reads 0 Ω with no direction, so 21-AB can’t decide and never trips. 21-BA clears its end; station A keeps feeding the fault, and in this model it is never cleared.',
      'Put the fuse back and pick terminal BA: the same fault from the other end. Its bus voltage is 24.9 kV and its current 2.49 kA, and it also measures 10.0 Ω from its own end.',
    ],
    takeaway: 'A relay only knows what its inputs tell it: currents, voltages, breaker status and, with a scheme, the remote end. If an input is missing or wrong, the relay makes the wrong decision about a perfectly real fault. The rest of this track takes those inputs one at a time.',
  },
  {
    id: 'f-ct',
    track: 'Foundations',
    title: 'CTs create the current view',
    tab: 'bay',
    setup: foundations,
    fault: { kind: 'line', line: 'AB', frac: 0.95 },
    expect: { verdict: 'selective', measured: { rid: 'AB', zOhm: 19, dir: 1 } },
    intro: 'A current transformer (CT) has the line conductor as its primary. A 1200:5 CT makes 5 A on its secondary when 1200 A flows on the line. The relay multiplies the secondary current back up by the ratio it is set to, so that setting has to match the CT that is actually installed.',
    watch: [
      'Fault at 95% of A–B: 1.63 kA on the line, 6.8 A at the relay terminals, and the relay computes 1.63 kA back.',
      'Z = 19.0 Ω: 95% of the 20 Ω line, past Zone 1’s 80% reach (16 Ω). 21-BA trips Zone 1 at its end; 21-AB waits for Zone 2 and trips at 317 ms.',
    ],
    tryIt: [
      'In the CT card, set the ratio to 1500:5 (the CT is still 1200:5). The relay multiplies by 300 instead of 240 and computes 2.03 kA for the same 1.63 kA. Z reads 15.2 Ω and Zone 1 trips at 17 ms. Faster here, but Zone 1 now reaches 100% of the line instead of 80%: no safety margin left.',
      'Set it to 2000:5 and move the fault to line B–Y at 10%, outside this line. The relay computes 12.7 Ω instead of 21.2 Ω and trips Zone 1 for a fault on the next line: a miscoordination from one wrong number in a settings file.',
    ],
    takeaway: 'The relay’s current is the secondary current times its ratio setting. A ratio error scales every impedance the relay measures, so it moves every zone reach. That is why CT ratios are verified at commissioning and checked against the settings.',
  },
  {
    id: 'f-polarity',
    track: 'Foundations',
    title: 'Direction is part of the measurement',
    tab: 'bay',
    setup: foundations,
    fault: { kind: 'line', line: 'AB', frac: 0.1 },
    scenario: { ctReversed: { AB: 'abc' } },
    expect: { verdict: 'backup', measured: { rid: 'AB', zOhm: 2, dir: -1 } },
    intro: 'A CT’s polarity marks (the two dots on the drawing) define which way is “into the line”: current entering the marked primary side, here the bus side, leaves the marked secondary lead, and the relay calls that forward. Swap the secondary leads and the relay gets exactly the right amount of current, pointing the wrong way. Here the CT itself is fine, but its leads are swapped at the terminal block in front of 21-AB, a classic commissioning miss.',
    watch: [
      'Step to the fault, 10% from A. On the line, 2.49 kA flows from bus A into the line. At the relay terminals the current is turned around (180° from the line current), and the relay computes the fault as reverse.',
      'Magnitudes, voltage and |Z| = 2.0 Ω are all correct; only the direction is wrong, and that is enough. 21-AB believes the fault is behind it and stays quiet.',
      'Station A’s end is cleared by remote backup: 21-XA’s Zone 2 at 317 ms, so line X–A goes out too. Cleared at 367 ms.',
    ],
    tryIt: [
      'Set the polarity to Reversed (phase A): only one phase swapped. The relay now sees residual current (3I0 = 4.98 kA) that isn’t on the line, picks a ground loop (AG) for a three-phase fault, and measures 0.86 Ω instead of 2.0 Ω, still reverse.',
      'Back to Reversed (all), move the fault behind the relay to line X–A at 90%. Now 21-AB sees a fault behind it as forward and trips Zone 1 at 17 ms for a fault that isn’t on its line: a miscoordination.',
      'Set the polarity to Correct and replay the fault at 10%: 21-AB trips Zone 1 at 17 ms and line X–A stays in service.',
    ],
    takeaway: 'Direction is not a separate input: the relay derives it from the angle of the current against the voltage. Reverse the polarity and the relay fails both ways: it won’t trip for faults on its line, and it trips for faults behind it. Polarity checks with load current at commissioning catch this before a fault does.',
  },
  {
    id: 'f-samples',
    track: 'Foundations',
    title: 'A phasor takes a cycle to measure',
    tab: 'bay',
    setup: foundations,
    fault: { kind: 'line', line: 'AB', frac: 0.5 },
    expect: { verdict: 'selective', measured: { rid: 'AB', zOhm: 10, dir: 1 } },
    intro: 'The relay never sees a smooth wave either. Its inputs are sampled (here 16 times a cycle; real relays sample faster) and turned into numbers, and the protection works on phasors, magnitude and angle, estimated from the last cycle of samples. When the fault starts, that estimate needs time to catch up. The Oscillography panel on this tab is the relay’s event report.',
    watch: [
      'In Oscillography choose Fault inception and step through. At 0 ms the line current jumps to 1.99 kA and the voltage at A collapses to 19.9 kV. The current carries a DC offset that dies away in a few cycles (τ ≈ 10 ms, from the line’s X/R).',
      'On CT secondary, the dots are the relay’s samples. The black line is the magnitude the relay estimates from its last cycle of samples (the shaded window): it climbs in 16 steps as fault samples replace pre-fault ones, and reaches the true magnitude (dashed) after one cycle, 16.7 ms. The offset makes it wobble a little on the way; VT secondary shows the same for the voltage, falling.',
      'Zone 1 picks up at 17 ms, once the estimate has settled: the model’s 1-cycle relay time stands for this filtering. 21-AB trips, and when 52-AB opens at 67 ms each phase stops at its own current zero.',
    ],
    tryIt: [
      'Press Play at 0.05× speed: the shaded window slides along the samples and the estimate follows it. Whole event shows the full record; Around cursor follows the playback.',
      'Pick terminal BA: the same fault from the other end, with its own samples and its own estimate.',
      'Think of the samples as data: in a digital substation, a merging unit in the yard samples the CTs and VTs and sends these same numbers over the network as IEC 61850 sampled values. Lose the stream and the relay has nothing to estimate from.',
    ],
    takeaway: 'Relays work on numbers, not waves: samples, then phasor estimates. Filtering a clean phasor out of a fault waveform takes about a cycle, which is a large part of why even an “instantaneous” zone takes time. It is also the bridge to digital substations, where those samples arrive as network messages.',
  },
  {
    id: 'f-vt',
    track: 'Foundations',
    title: 'VTs create the voltage view',
    tab: 'bay',
    setup: foundations,
    fault: { kind: 'line', line: 'AB', frac: 0.1 },
    expect: { verdict: 'selective', measured: { rid: 'AB', zOhm: 2, dir: 1 } },
    intro: 'A voltage transformer (VT) steps the 79.7 kV phase voltage down to 66.4 V (1200:1; 115 V line-to-line). During a fault the voltage at the relay collapses, and the closer the fault, the deeper it goes. The angle matters as much as the magnitude: the relay compares each current with its voltage.',
    watch: [
      'Step back to before the fault (−50 ms): 79.7 kV on the line, 66.4 V at the relay, three phases 120° apart.',
      'At the fault, 10% from A, station A’s voltage collapses to 4.98 kV (4.1 V secondary): the relay is electrically close to the fault.',
    ],
    tryIt: [
      'Move the fault to 50%, then 90%: Va at the relay recovers to 19.9 kV, then 29.9 kV. Pick terminal BA to see the same faults from the other end.',
      'With the fault at 95%, set the VT ratio to 1000:1 (the VT is still 1200:1). The relay computes 0.83× the real voltage, Z reads 15.8 Ω instead of 19.0 Ω, and Zone 1 trips: an overreach, the same kind of reach error as a wrong CT ratio.',
      'Set the ratio back, move the fault to 50% and blow the phase-A fuse only. Va reads 0 V and the AB loop voltage the relay computes is wrong: Z reads 5.8 Ω instead of 10.0 Ω.',
    ],
    takeaway: 'The relay’s voltage is the VT secondary times its ratio setting, through a fuse and wiring that can fail. Distance protection needs that voltage: a voltage error is an impedance error, and losing the voltage leaves the relay blind.',
  },
  {
    id: 'f-z',
    track: 'Foundations',
    title: 'Distance needs both voltage and current',
    tab: 'bay',
    setup: cfg => { foundations(cfg); cfg.features.load = true },
    fault: { kind: 'line', line: 'AB', frac: 0.5 },
    expect: { verdict: 'selective', measured: { rid: 'AB', zOhm: 10, dir: 1 } },
    intro: 'A distance relay divides the voltage by the current at its terminals: Z = V / I. On a healthy line that is the load impedance: large. During a fault it is the line impedance between the relay and the fault: small, and in proportion to the distance. That one number is why it is called distance protection.',
    watch: [
      'Before the fault (−50 ms) the line carries 384 A of load: the relay sees about 204 Ω (Load Z row), far outside any zone.',
      'At the fault at 50%: 19.9 kV ÷ 1.99 kA = 10.0 Ω at 75°, exactly half the 20 Ω line. Zone 1 (80%, 16 Ω) trips at 17 ms.',
      'The secondary column shows the same thing in relay units: 16.6 V ÷ 8.3 A = 2.0 Ω. Settings are often written in secondary ohms: this whole line is 4 Ω secondary.',
    ],
    tryIt: [
      'Move the fault to 10% and to 90%: Z reads 2.0 Ω and 18.0 Ω. The current alone hardly tells you where the fault is (2.49 kA vs 1.66 kA); the ratio V / I does.',
      'Move the fault to line B–Y at 10%: Z = 21.2 Ω, beyond the 20 Ω line. Zone 1 doesn’t reach it; only Zone 2 (24 Ω) does, after its time delay, and B–Y’s own relays clear it first.',
    ],
    takeaway: 'Neither input is enough on its own: the current says something is wrong, the voltage says how close it is, and Z = V / I combines them into a distance. That is why a distance relay needs both its CTs and its VTs, and why an error in either one is a reach error.',
  },
  {
    id: 'f-lop',
    track: 'Foundations',
    title: 'Loss of potential is not a power-system fault',
    tab: 'bay',
    setup: cfg => { foundations(cfg); cfg.features.load = true },
    fault: { kind: 'none' },
    scenario: { vtFuse: { AB: 'abc' } },
    expect: { verdict: 'secure', measured: { rid: 'AB', zOhm: 0, dir: 1 } },
    intro: 'A VT fuse (or the small breaker in the VT secondary wiring) can blow on a perfectly healthy line. Nothing changes on the power system, but the relay’s voltage drops to zero, and to a distance element zero volts with current flowing looks like a bolted fault right at the relay. Loss-of-potential (LOP) logic tells the two apart: in a real fault the current changes too; when a fuse blows, it doesn’t.',
    watch: [
      'At 0 ms there is no fault: the line still carries 384 A of load and the voltage at bus A is still 78.5 kV. Only the VT fuse at 21-AB blows, and the relay’s voltage drops to 0 V.',
      'What the relay sees: Z = V / I = 0 Ω, and its memory voltage says forward. That is exactly what a bolted fault at its own terminals would look like.',
      '21-AB’s LOP logic sees the voltage collapse with no change in current: not a power-system fault. It blocks distance and raises an alarm. Verdict: no trip (secure).',
    ],
    tryIt: [
      'In the chain, untick LOP blocking on the relay card and replay: Zone 1 trips 52-AB at 17 ms on load current. Line A–B goes out of service because of a blown fuse: a misoperation.',
      'Tick LOP blocking back on and set the fuse to Phase A blown. The AB loop still has Vb, so Z moves to about 118 Ω, outside every zone at this load, and LOP asserts anyway.',
      'With all three fuses blown, give the system a real fault: fault location Line A–B, then 10%. The fuse was already gone, so 21-AB is blind. 21-BA trips its own end and station A’s end waits for 21-XA’s Zone 2: cleared at 367 ms. That is why LOP alarms: until someone replaces the fuse, the line has lost part of its protection.',
    ],
    takeaway: 'A failed measurement is not a power-system fault, and the relay can only tell them apart by their signatures: a real fault changes the current; a blown fuse only removes the voltage. LOP logic blocks the elements that need voltage and raises an alarm so the VT gets fixed before a real fault arrives. Current-only protection (87L, overcurrent) keeps protecting meanwhile.',
  },
  {
    id: 'f-trip',
    track: 'Foundations',
    title: 'A trip command is not an open breaker',
    tab: 'bay',
    setup: foundations,
    fault: { kind: 'line', line: 'AB', frac: 0.1 },
    scenario: { breakerFail: ['AB'] },
    expect: { verdict: 'backup', measured: { rid: 'AB', zOhm: 2, dir: 1 } },
    intro: 'Relay decision, output contact, trip coil, breaker mechanism, current interruption: five separate steps, and the relay controls only the first two. Here 52-AB’s mechanism is stuck.',
    watch: [
      '21-AB decides at 17 ms: Zone 1 TRIP. The trip wire to the trip coil (TC) lights up: the command was delivered.',
      'The breaker never opens. Its 52a contact still says closed and 2.49 kA keeps flowing through the CT. The relay did its job; the fault is still there.',
      'Remote backup clears it: 21-XA’s Zone 2 at 317 ms from station X, cleared at 367 ms, and line X–A goes out with it.',
    ],
    tryIt: [
      'In the chain, tick Opens when tripped back on and untick Trip circuit Intact instead. 21-AB still trips at 17 ms, but the dashed wire shows the command never reaches the coil. Same result, a different broken link.',
      'Restore both and replay: 52-AB opens at 67 ms, and the 52a contact and the current agree.',
    ],
    takeaway: 'A trip is a request. Whether the current stops depends on the trip circuit, the DC supply, the breaker mechanism and the arc being interrupted. Breaker-failure protection (not modelled here) watches the current, not the 52a contact, because only the current proves the breaker opened.',
  },

  // ───────────── Why protection matters ─────────────
  {
    id: 'why-cost',
    track: 'Why protection matters',
    showConsequences: true,
    title: 'What a fault costs',
    tab: 'coord',
    setup: cfg => why(cfg, 'DCB'),
    fault: { kind: 'line', line: 'AB', frac: 0.1 },
    expect: { verdict: 'selective' },
    intro: 'A fault is a short circuit: very high current, an arc, and nearby generators pushed off balance until protection removes it. Line A–B has a fault 10% from A. Everything is working, and Consequences (right, under the outcome) adds up what the fault costs as it plays.',
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
    showConsequences: true,
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
      'Back at 10% with DC restored, break a different link in the protection chain on the Bay tab (terminal AB): untick Trip circuit Intact. 21-AB still trips at 17 ms, but the trip never reaches 52-AB, and the result is the same 367 ms remote-backup clear.',
    ],
    takeaway: 'Protection is a chain. Standards call it a Protection System (NERC Glossary): relays, communications, voltage and current sensing, station DC supply, and control circuitry through the trip coils. Everything protecting one line together is its Composite Protection System; remote backup from another line’s protection, like 21-XA here, is not part of it. A failure nobody sees is found by the next fault, which is why batteries are alarmed and trip circuits supervised.',
  },
  {
    id: 'why-channel',
    track: 'Why protection matters',
    showConsequences: true,
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
  },  {
    id: 'why-latency',
    track: 'Why protection matters',
    showConsequences: true,
    title: 'Latency is a setting',
    tab: 'coord',
    setup: cfg => { why(cfg, 'DCB'); cfg.pilot.channelCycles = 3 },
    fault: { kind: 'line', line: 'BY', frac: 0.1 },
    expect: { verdict: 'miscoordination' },
    intro: 'Line A–B uses DCB: an end trips on its overreaching Zone 2 after a short coordination timer, unless the other end sends a block saying the fault is behind it. The timer is 2 cycles (33 ms), sized for a fast channel. Here the channel has been rerouted over a slower path: 3 cycles (50 ms) one way. Nothing is broken; it is just slower.',
    watch: [
      'The fault is on line B–Y, outside A–B. 21-BA sees it behind it and keys a block at 17 ms.',
      '21-AB’s timer runs out at 50 ms with no block received yet (it arrives at 67 ms), so 21-AB trips DCB and opens line A–B for a fault on the next line. A miscoordination, caused by a healthy but slower channel.',
    ],
    tryIt: [
      'In ⚙ Settings → Individual features, set the channel delay to 0.5 cycles and replay: the block arrives at 25 ms, inside the timer, and line A–B stays in.',
      'Back to 3 cycles, raise the DCB coordination timer to 4 cycles: the external fault is secure again. Now move the fault to line A–B at 90% and look at Consequences details. The clearing-time bar shows 67 ms of channel (the DCB timer waiting for a block): every internal fault now clears in 133 ms instead of 100 ms.',
    ],
    takeaway: 'Channel latency is part of the protection design. A slower path doesn’t just add its own delay: it forces a longer timer (DCB) or a slower trip (POTT), and that cost lands on every fault. Rerouting a protection channel is a protection change and needs the protection engineer’s sign-off.',
  },
  {
    id: 'why-asymmetry',
    track: 'Why protection matters',
    showConsequences: true,
    title: 'A switched path can trip 87L',
    tab: 'coord',
    setup: cfg => { why(cfg, 'step'); cfg.features.diff = true },
    fault: { kind: 'line', line: 'XA', frac: 0.9 },
    scenario: { diffChannel: 'asym3' },
    expect: { verdict: 'miscoordination' },
    intro: 'Line A–B has line current differential (87L): each end sends its current samples to the other, and the zone trips if what goes in doesn’t come out. To compare the two ends, each relay must line up samples taken at the same instant. Without a time source like GPS, it measures the round-trip delay over the channel and assumes each direction takes half. Here the network has rerouted one direction of the A–B channel over a longer path: +3 ms one way, the other direction unchanged.',
    watch: [
      'At inception the log spells it out: each end assumes half the round trip, so the remote samples are 1.5 ms out of step, which is 32° at 60 Hz.',
      'The fault is on line X–A, outside A–B: 2.34 kA flows straight through line A–B. Lined up correctly, the two ends’ currents cancel. Rotated by 32°, they leave 0.33 pu (1.3 kA) of false differential, above the 0.3 pu pickup and the 30% slope.',
      '87L trips both ends of line A–B at 28 ms for a fault that isn’t on it: a miscoordination. (The 3 ms also delays the data, so even this trip comes 3 ms later than usual.)',
    ],
    tryIt: [
      'Under Failures → 87L channel A–B, choose Path switched: +1 ms one way: 0.5 ms out of step, 11°, about 19% false differential, and 87L restrains.',
      'Back to +3 ms and move the fault onto line A–B at 50%: a real internal fault still trips. Asymmetry hurts when current flows through the line, not when it flows in from both ends.',
    ],
    takeaway: 'For 87L the channel is not just in the trip path, it is in the measurement. A path that is fine for data can be wrong for differential protection if the two directions differ. Utilities control this by pinning protection channels to fixed paths, alarming on a change in channel delay, or aligning samples with GPS time instead of the channel; the separate IEC 61850 simulator covers time synchronization in detail.',
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

  // ───────────── Bus differential ─────────────
  {
    id: 'bus-basics',
    track: 'Bus differential',
    title: 'Bus differential: what goes in must come out',
    tab: 'station',
    station: 'B',
    setup: busdiff,
    fault: { kind: 'bus', bus: 'B' },
    expect: { verdict: 'selective', measured: { rid: 'BA', zOhm: 0, dir: -1 } },
    intro: 'Bus B joins two lines. A fault on the bus itself is behind both line relays at B (they look out along their lines), so without bus protection only the far ends’ Zone 2 clears it, slowly, and both lines go out anyway. A bus differential zone (87B) measures every current into the bus through a CT on each feeder: what goes in must come out, unless the fault is on the bus.',
    watch: [
      'Step to the fault. In the 87B card, 1.59 kA comes in from line A–B and 3.62 kA from line B–Y. Nothing goes out, so the sum (operate) is about 5.2 kA: 100% of the restraint.',
      '87B operates and trips both bus breakers at 17 ms; the fault is cleared at 67 ms.',
      'On the station drawing, each feeder has the line relay’s CT on the bus side of its breaker and the 87B CT on the line side. Each zone reaches past the breaker to the other’s CT, so the zones overlap and there is no gap at the breaker. 21-BA sees this fault behind it (reverse) and stays out.',
    ],
    tryIt: [
      'Move the fault to line B–Y at 10%. Current from line A–B flows through the bus and out to B–Y: the two 87B currents (1.56 kA each) cancel, the sum is 0, and 87B restrains. B–Y’s own relays clear the fault.',
      'Back at bus B, untick ⚙ Settings → Modules → Bus differential and replay: the far ends’ Zone 2 (21-AB and 21-YB) clears the bus fault at 367 ms instead of 67 ms.',
    ],
    takeaway: 'Bus differential is Kirchhoff’s current law used as protection: around a healthy node the currents sum to zero. It is fast and selective, and it depends on every CT around the bus being right, which is the next lesson.',
  },
  {
    id: 'bus-polarity',
    track: 'Bus differential',
    title: 'One reversed CT trips the bus',
    tab: 'station',
    station: 'B',
    setup: cfg => { busdiff(cfg); cfg.features.load = true },
    fault: { kind: 'line', line: 'BY', frac: 0.1 },
    scenario: { ctReversed: { 'bus:BY': 'abc' } },
    expect: { verdict: 'miscoordination', measured: { rid: 'BA', zOhm: 1.2, dir: -1 } },
    intro: 'The 87B CT on 52-BY was wired backwards (or replaced and never polarity-checked). Nothing has tripped yet, but the bus differential has been seeing it all along: with load flowing through the bus, a reversed CT reports load leaving as load arriving. The Station tab shows the whole bus: every feeder, its CTs, and the 87B relay adding them up.',
    watch: [
      'Step back to before the fault (−50 ms): 384 A of load comes in from line A–B and leaves to line B–Y. The reversed CT reports it as coming in, so 87B sees 769 A of operate current with no fault anywhere: 100% of restraint, just under the 797 A pickup. On the oscillography the two CT secondaries add instead of cancelling, and the operate trace sits just under the pickup line.',
      'Then a fault on line B–Y at 10%, outside the zone: 1.56 kA in and the same out, reported as 3.11 kA of differential. 87B trips both bus breakers at 17 ms: bus B goes dark and line A–B is lost for a fault on line B–Y, a miscoordination. 21-YB’s Zone 2 clears the far end at 367 ms.',
    ],
    tryIt: [
      'Set 52-BY’s polarity to Correct in the 87B card: before the fault the operate trace is flat at zero, and at the fault the currents cancel and 87B restrains.',
      'Leave it reversed, choose fault location No fault, and lower ⚙ Settings → Modules → 87B pickup to 0.15 pu (598 A). The bus trips on load at 17 ms with no fault anywhere: a misoperation. (In a no-fault run the instrument failure starts at t = 0: here, the zone goes into service with the CT reversed.)',
      'Pickup back to 0.20 pu, move the fault onto bus B, inside the zone. The reversed CT now subtracts: operate is 2.19 kA against about 5.2 kA of restraint (42%), under the 50% slope. 87B fails to trip a real bus fault, and remote Zone 2 clears it at 367 ms.',
    ],
    takeaway: 'A reversed bus CT shows itself under load long before a fault: a standing differential of twice the load current through that feeder. That is what in/out load checks at commissioning, and a differential-current alarm in service, look for. Miss it, and the bus trips for the next external fault (or on load, once the load grows) and can fail to trip for a real bus fault.',
  },


]

export const lessonById = id => LESSONS.find(l => l.id === id)

// ── Paths ──
// One ordered path through the lessons per welcome-card audience. Prev/next in
// a lesson follow the learner's path; a lesson opened from the menu that isn't
// on it falls back to menu order. The Lessons menu stays grouped by track.
const inTrack = t => LESSONS.filter(l => l.track === t).map(l => l.id)
export const PATHS = {
  // Everything: what the relay sees, then protection track by track, then why it matters
  learning: [
    ...inTrack('Foundations'),
    ...TRACKS.filter(t => t !== 'Foundations' && t !== 'Why protection matters').flatMap(inTrack),
    ...inTrack('Why protection matters'),
  ],
  // A short path for people who work around protection: enough of what the relay
  // sees and how zones and backup work to read the busier Why lessons
  around: [
    'f-cannot-see', 'f-ct', 'f-polarity', 'f-samples', 'f-z', 'f-trip',
    'z1-basics', 'z2-time', 'remote-backup',
    ...inTrack('Why protection matters'),
  ],
}

export function lessonNeighbours(id, audience = 'learning') {
  const path = PATHS[audience] ?? PATHS.learning
  const byId = x => LESSONS.find(l => l.id === x) ?? null
  const k = path.indexOf(id)
  if (k >= 0) return { prev: byId(path[k - 1]), next: byId(path[k + 1]) }
  const i = LESSONS.findIndex(l => l.id === id)
  return { prev: LESSONS[i - 1] ?? null, next: LESSONS[i + 1] ?? null }
}
