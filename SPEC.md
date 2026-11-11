# Line Protection Simulator — Specification

**Status:** feature-complete for a first public release (2026-10-29): distance protection (V1–V2), pilot schemes, line current differential, 25 guided lessons. Next: target-audience testing, then public GitHub.
**Purpose:** Web-based training tool for transmission line protection: distance zone reach and coordination, pilot schemes, source strength, ground faults, fault resistance, infeed, load, and line current differential. Pure client-side; all simulation math runs in the browser.

The sections after § Status are the design record, written as each version was planned and built; later versions supersede details in earlier ones (e.g. V2 replaced V1's geometric impedance model with a phasor solver).

---

## Status & backlog (as of 2026-10-29)

**Built**
- **Coordination tab** (default): one-line with breakers, CTs and fault-current paths; zone coverage lanes with static setting checks; logic-analyzer timing chart; sequence of events; outcome verdict; 3-cycle prefault period; failure scenarios (relay out of service, stuck breaker, channel failures); sidebar with labelled fault presets and Z1/Z2 reach controls
- **Fault Study tab:** six-fault suite against Relay A/B, R-X plane (MHO or quadrilateral, load point), results table
- **Differential tab:** line A–B 87L, Iop–Ires characteristic, charging current, CT error
- **Engine:** three-phase phasor network solver (Z1/Z0, source SIR, infeed, prefault load, 3Ø / A–G faults with Rf); relays measure V/I through a phase selector and ground (k0) / phase loops with memory polarization; discrete-event clearing with pilot schemes (DCB, POTT, DCUB) and 87L
- **Progressive disclosure:** eight ⚙ feature toggles, all off by default; with a feature off the app behaves exactly as before it existed. Learner levels (Basic / Intermediate / Advanced) switch the seven distance features in groups; 87L is a separate module toggle (built 2026-11-11)
- **First run:** welcome card on the Coordination tab (how to read the screen, level picker, first lesson for the level); reopen from Lessons (built 2026-11-11)
- **Lessons:** 31 in eight tracks; every Coordination lesson's outcome and every "Try this" claim is checked by the test suite
- **Consequences module** (V3 § A, built 2026-11-11): ⚙ Modules → Consequences; a card beside the outcome fills in during playback: fault time vs critical clearing time (12 cyc, illustrative), relative fault duty and arc energy, outage extent
- **Line tap** (V4 step 1, built 2026-11-11): unprotected load tap on A–B (Advanced level); tap-section and tap LV-bus faults, tap transformer protection, true vs measured distance on the coverage lanes; *Tapped lines* track
- **Quality:** config schema v12 with migrations from v1; 130 Vitest tests
- **Deploy:** Docker image (unprivileged nginx) behind the host's nginx, verified locally (§ Deployment)

**Next: V3, protection for the people around it** (design draft, § Roadmap → V3): consequences panel, protection chain view, the channel as a protection setting (latency, 87L asymmetry), digital substation (SV/GOOSE links).

**Before / during audience testing**
- **Complexity: simplify, separate, or guide** (raised 2026-11-11). The Coordination tab now carries a one-line, zone coverage, timing chart, sequence of events, outcome, consequences card, protection chain, phasors and settings. Options, cheapest first:
  1. **Guided orientation (spotlight tour):** a step-through that dims everything except one area, with a callout that says what it is, how to read it, and what to look for, and drives the sim as it goes (place the fault, step to the Z1 trip, point at the TRIP badge, the timing trace, the event, the verdict). Data-driven like lessons: steps of `{ target, title, text, action }`, with `data-tour` anchors on the panels; skippable, keyboard-friendly, scrolls the target into view on phones. Offered from the welcome card and the Lessons menu; one short tour per audience.
  2. **Lesson focus mode:** a lesson declares the panels it needs; the rest collapse to a one-line header (one click to expand). Each lesson shows only what its story uses: *What a fault costs* = one-line, events, consequences; the chain lessons add the chain.
  3. **Separation:** split the Coordination tab into views (e.g. *Clearing*: one-line, timing, events, outcome; *Settings & coverage*: coverage lanes, reaches, relay settings; *Why it matters*: consequences, chain), or move the Why material into its own tab. Bigger change: lessons and the tour must switch views, and part of the value is seeing cause and effect on one screen.
  - Recommendation: watch the first test sessions before choosing; where people get lost decides it. Likely order: tour first (helps every audience, touches no engine code), focus mode next (reuses lesson data), separation only if those don't settle it.
- Fault Study vs Coordination overlap (the R-X plane could move into Coordination)

**Backlog**
- **Tapped lines** (V4): step 1 (unprotected load tap) built; source tap and protected (three-terminal) tap outlined
- "Predict, then step" quiz mode on top of lesson data
- Import/export and share links (the schema is serializable and migrated; see § Import / Export), for this app's own use (e.g. an instructor sending a scenario). Build only if testers ask; lessons cover most of it
- Load encroachment is shown (load point) but not simulated as a trip (zones are evaluated from fault inception); load blinders, tilted reactance lines, negative-sequence polarizing
- Memory-polarized MHO expansion overlay; 87L alpha plane, separate channel delay, CT ratio mismatch, charging compensation
- SIR controls on the one-line source symbols (currently ⚙ Settings)
- Lessons can't set Fault Study UI state such as the R-X Relay A/B selection

---

## V1 — Base Simulator

### Simulated System

- Two stations: Station A, Station B
- One protected line between them
- Bus at each station
- One adjacent outgoing line per station (provides out-of-section fault locations for Zone 2 coordination testing)
- Distance relay at each terminal: Relay A (Station A), Relay B (Station B)
- Relays independently configurable
- No source impedance modeling in V1 — reaches expressed as % of line impedance only

### Protection Model

Two zones per relay, forward-looking:

| Zone | Direction | Timing           | Default reach |
|------|-----------|------------------|---------------|
| Z1   | Forward   | Instantaneous    | 80%           |
| Z2   | Forward   | Adjustable delay | 120%          |

Controls per relay:
- Zone 1 reach: slider 0–300% of line impedance
- Zone 2 reach: slider 0–300% of line impedance
- Zone 2 time delay: numeric input (seconds, default 0.3s)
- Enable/disable toggle per zone

### Fault Test Suite

Three-phase faults only. Six predefined locations:

| ID | Location              | Expected behavior (default settings)                  |
|----|-----------------------|-------------------------------------------------------|
| F1 | Bus A                 | Relay A: no forward operation; Relay B: Z2 (remote-bus backup) |
| F2 | Close-in A (5%)       | Relay A: Z1 trip; Relay B: Z2 trip                    |
| F3 | Midline (50%)         | Relay A: Z1 trip; Relay B: Z1 trip (Z1 reach > 50%)   |
| F4 | Close-in B (95%)      | Tests Z1 reach boundary; Relay A: Z2 trip             |
| F5 | Bus B                 | Relay B: no forward operation; Relay A: no trip       |
| F6 | Adjacent beyond B     | Tests Z2 overreach; should not trip Z1 either relay   |

### Feedback per Fault

For each fault × each relay:
- Zone(s) asserted (Z1, Z2, or none)
- Trip time (instantaneous or T2 delay)
- Assessment tag: **Correct trip** / **Correct no-op** / **Overreach** / **Underreach** / **Coordination failure**
- R-X plane: fault impedance plotted as a point against MHO zone circles (equal R/X scaling, auto-fit to largest reach), updates live as sliders move; reverse faults plot in quadrant III
- Assessment rules: remote bus with no operation = Underreach; Z2 operating beyond the remote bus with T2 < CTI = Coordination failure

### UI Layout

- **Left panel:** Zone reach sliders, time delay input, enable/disable toggles — one column per relay
- **Center:** R-X impedance plane diagram; Relay A / Relay B tab switcher; zones rendered as polygons, fault point as a marker
- **Bottom/right:** Results table — rows = fault locations, columns = Relay A / Relay B, cells show zone + time + assessment tag

### Progressive Disclosure

Out-of-the-box experience is intentionally minimal. A **Settings / Complexity panel** (gear icon or collapsible drawer) lets users unlock additional features as they're ready. Features not yet built are absent from the panel entirely — they appear when the corresponding version ships.

**Default (out of box):**
- Coordination tab: single line A–B (sources at both buses, two relays); failure scenarios collapsed under **Failures** (opens itself while any failure is active)
- Zone 1 + Zone 2 only, reasonable preset reaches (Z1: 80%, Z2: 120%, T2: 0.3s)
- All six fault locations active
- R-X plane + results table

**User-unlockable features (per version shipped):**

| Toggle | Added in | Unlocks |
|--------|----------|---------|
| Adjacent lines (X–A–B–Y) | V1.6 ✅ | Coordination tab grows from the single line A–B (default) to the 3-line chain |
| Zone 3 reverse + pilot schemes | V1.5 ✅ | Z3 reverse, DCB / POTT / DCUB per line, channel in service / out / lost |
| Zone 3 forward | V2 | Third forward backup zone |
| Zone 4 | V2 | Fourth zone (configurable direction) |
| Infeed simulation | V2+ | Second source line per bus; apparent Z shift |
| Current differential | V2+ | Separate protection type module |

**Learner levels** (built 2026-11-11, `lib/levels.js`): ⚙ Settings opens with a Basic / Intermediate / Advanced picker; the individual toggles sit below it in a collapsed "Individual features" list (open when the mix matches no level, shown as Custom).

| Level | Features on | First lesson |
|-------|-------------|--------------|
| Basic | none (= defaults) | Zone 1: instantaneous, but short |
| Intermediate | adjacent, pilot | Zone 2 coordinates by time |
| Advanced | adjacent, pilot, sir, ground, rf, load, infeed (all of distance) | first Ground faults & Rf lesson |

**87L is a separate protection module**, not a level: its toggle has its own ⚙ section (Protection modules), no level switches it, and the level is judged without it (Advanced + 87L still reads Advanced). The Lessons menu labels its track "87L module". The Sources & phasors lessons stay labelled Intermediate in the menu; they switch SIR on themselves.

A level only switches its own features (`LEVEL_FEATURES`); other settings are untouched. The chosen level is a per-browser preference (`lps.level`): it seeds the config at start and on Reset. Lessons still start from the plain defaults and switch on what they need (the level then reads Custom until another level is picked). The Lessons menu labels each track with its level.

**First run** (built 2026-11-11): until dismissed (`lps.welcomed`), the Coordination tab shows a welcome card in the lesson-card slot: three steps (pick a fault, play or step, read the verdict), the level picker, and buttons for the level's first lesson or "Explore on my own". Starting any lesson dismisses it; Lessons → "Welcome & how to read the screen" brings it back.

Settings panel is a V1 architecture decision. Features appear in it as they are built — users never get a new app, they get new toggles in the same panel.

### Architecture Constraints (for forward compatibility)

- **Separate zone assertion from trip decision.** V1.5 scheme logic (DCB/DCU) inserts between them without touching the relay model.
- **Express all impedances in per-unit of line.** Phasor display and infeed modeling in V2+ add on without recalculating the base model.
- **Fault engine returns V and I at each terminal in V1** — don't render them yet. V2 adds the phasor panel on top of existing data.

---

## V1.1 — Coordination View (built 2026-10-29)

The default (first) tab — the app's centerpiece and main settings screen; the Fault Study is the second tab. Shows *how* a fault gets cleared over time, including the adjacent lines, so Z2 overreach and timing coordination can be demonstrated.

### System

- Full spec topology: Bus X — Line XA — Bus A — Line AB — Bus B — Line BY — Bus Y
- Sources at the outer buses (X, Y) only → no infeed; apparent Z = line impedance between relay and fault
- Six terminals, each a 21 relay + 52 breaker: XA, AX, AB, BA, BY, YB (id = own bus + far bus). 21-AB / 21-BA are Relay A / Relay B of the Fault Study
- Adjacent line lengths adjustable (0.3–3.0 pu of AB); AB is the 1.0 pu base. Reach is % of each relay's own line
- Built as a chain of N lines: adding a line = one bus + one line + two relays in config. Branched networks would replace the feed-path interval logic in `lib/network.js` with a path search

### Display

- **Sidebar** (left): fault location with labelled preset chips (F1 Bus A … F6 Adjacent beyond B, active one highlighted), fault type / Rf when unlocked, **Failures** (since 2026-11-11 directly under the fault, so it stays above the fold when adjacent lines add six terminals of reach sliders; a lesson whose *Try this* uses Failures opens it and outlines it in indigo), **Zone reach** (compact Z1 / Z2 reach sliders + Z2 delay per terminal, so the basic settings don't require the Fault Study tab or the full settings panel)
- **One-line** — station layout per terminal: bus → CT (relay connection) → breaker → line. Line 0%–100% starts at the line side of each breaker; line pixel length ∝ impedance, station areas are fixed width. Dynamic: breaker state (red = closed, green = open, X = failed), fault-current paths in orange, relay PU/TRIP badges, fault marker. Click a line or bus to place a fault
- **Zone coverage** (directly below; same bus positions, own axis) — one lane per relay (grouped looking right / looking left), one row per zone so nothing overlaps. Since 2026-11-11 every zone starts at the relay's own bus: on the coverage axis each line spans bus to bus (0% at one bus, 100% at the other, no station gaps), so all zones of the relays at a bus start on that bus's gridline, forward and reverse, and reaches past a bus continue without a jump. The fault's dashed line sits on this axis, with a faint connector to the one-line marker. Bars track settings live, brighten while a zone is picked up; ✓ when operated. A label that would run off the chart sits inside the bar's visible end with ▸ / ◂ (the bar continues off-chart)
- **Static coordination checks** hatched in red on the lanes: Z1 reaching past its remote bus; a relay's Z2 overlapping a downstream relay's Z2-only territory with less than CTI separation
- **Playback controls** (Reset, Step, Play, speed, time scrubber) sit under the **Timing** heading, above the timing chart, since 2026-11-11: below the distance-scaled one-line and coverage they read as a distance slider
- **Timing chart** (logic-analyzer style) — x = time (ms + cycles), digital traces per active terminal: Zn PU, TRIP, 52 closed, plus FAULT. Delayed zones show a ramp as their timer builds toward trip. Traces draw only up to the current sim time; click to jump. Idle terminals hidden unless "show idle terminals"
- Diagrams are capped by viewport height as well as width, so wide monitors don't force vertical scrolling

### Time simulation (`lib/timeline.js`)

Discrete-event engine: fault → zone pickup (relay operate time) → zone timers → trip → breaker open (interrupt time) → network re-solved → zones that lose current reset → … until cleared or nothing pending.

- Runs start with a 3-cycle healthy prefault period (`PREFAULT_CYCLES`, t < 0, shaded on the timing chart); the fault is applied at t = 0 and every later time is unchanged. Reset returns to the start of the prefault
- Controls: Reset, Step back/forward (event to event), Play/Pause at 0.05–1× speed, time scrubber; sequence-of-events log (click to jump)
- Scenario toggles per terminal: relay out of service, breaker fails to open
- Outcome: Selective / Cleared — tight margin (Z2 reset with < CTI to spare) / Cleared by backup / Miscoordination (out-of-section breaker opened while its side's primary breaker also opened) / Not cleared
- Bus faults: bus differential not modeled; remote Z2 backup is the expected clearing
- Timing settings (gear panel): 50/60 Hz, relay operate time (default 1 cyc), breaker interrupt time (default 3 cyc), CTI (default 0.2 s)
- Delay display unit (gear panel): cycles (default) or seconds — applies to relay delay inputs, coverage labels and Fault Study trip times. Preference remembered per browser
- All times in config are stored in **cycles** (zone `delayCycles`, `relayCycles`, `breakerCycles`, `ctiCycles`), as relay settings are usually written. Changing frequency keeps the cycle count and changes the duration (18 cyc = 300 ms @ 60 Hz, 360 ms @ 50 Hz)
- Zone assertion (`protection.zoneAsserts`) stays separate from trip decisions (made in the engine), so V1.5 DCB/DCU logic can insert channel events between them

---

## Roadmap

### V1.5 — Pilot Schemes (built 2026-10-29)

Unlocked by the Settings toggle **"Zone 3 reverse + pilot schemes"** (off by default; with it off the app behaves exactly as V1.1).

**Elements**
- Zone 3 reverse per relay (default 50% of own line, behind the relay). A fault on the relay's own bus counts as reverse. Used only by scheme logic — never trips
- Pilot zone = Z2 (forward overreaching)

**Schemes** (selectable per line; default A–B = DCB, adjacent lines = step distance). Corrected from the original spec wording:
- **DCB** (directional comparison blocking): send BLOCK while the reverse zone sees the fault and Z2 doesn't. Trip = Z2 + coordination timer expired + no block received. Accelerates Z2 for internal faults; the step-distance Z2 timer remains as backup
- **POTT** (permissive overreaching transfer trip): send PERMISSIVE while Z2 picks up. Trip = Z2 + permissive received
- **DCUB** (directional comparison unblocking): POTT plus unblock logic — if the channel is lost at the fault, trip on Z2 alone for an unblock window (~150 ms), then lock out to step distance

**Channel scenarios** (per line): In service / Out of service (failed before the fault) / Lost at fault (e.g. carrier attenuated by the fault)
- DCB channel failure → no blocks → **overtrips** for external faults (dependability over security)
- POTT channel failure → no permissive → falls back to step distance (slow)
- DCUB lost at fault → trips in the unblock window; out before the fault → already locked out

**Pilot timing** (Settings, cycles): channel delay 0.5, DCB coordination timer 2, DCUB unblock window 9. A DCB coordination timer shorter than the channel delay overtrips — a deliberate teaching case

**Display**
- One-line: channel drawn between the line's two relays with scheme + state (OUT / LOST); TX/RX signal badges at each end; trip badge shows the logic (TRIP DCB)
- Coverage: Z3R lanes (dashed, drawn behind the relay). New red-hatch check: under DCB, the remote reverse zone must reach further behind its bus than the local Z2 overreaches past it
- Timing chart: Z3R PU, TX and RX rows per terminal on a pilot line
- Fault Study: scheme selector + A–B channel state; each cell adds the time-domain result (⚡ DCB trip · 3 cyc / DCB blocked / Step Z2); pilot trip for a fault outside the line → **Pilot overtrip**
- Relay out of service: its coverage lanes are removed ("no coverage")

**Engine**: scheme logic sits between zone assertion and trip decision in `lib/timeline.js` (keying, channel delay, DCB coordination timer, DCUB unblock window/lockout). Tested in `sim.test.js`.

---

### Lessons (built 2026-10-29)

Guided scenarios behind a **Lessons** button in the header. Starting a lesson resets settings to defaults, applies the lesson's setup (features, settings, topology), switches tab, and places the fault and any failures. The lesson card (above the workspace, collapsible) gives the goal, *Watch for*, *Try this* experiments, and a key point, with previous/next and restart. Opened lessons get a ✓ (per browser).

| Track | Lessons |
|-------|---------|
| Basics | Zone 1: instantaneous, but short · Why Zone 1 stops short of 100% · Reading the R-X plane · Zone 2 and the end-zone problem |
| Coordination | Zone 2 coordinates by time · Zone 2 as remote backup · Zone 2 overreach race · When a relay is out of service |
| Pilot schemes | DCB fixes the end-zone problem · DCB on an external fault: the block · DCB channel failure overtrips · Coordination timer vs channel time · POTT: secure, but needs the channel · DCUB: riding through loss of channel |
| Sources & phasors (V2) | SIR: same impedance, very different voltage · Zero volts: direction from memory · Infeed: why remote backup underreaches |
| Ground faults & Rf (V2) | Ground distance needs k0 · Fault resistance vs the MHO · Quadrilateral: room for resistance · Load + Rf: the sending end overreaches · Load encroachment |

Content is data in `app/src/lib/lessons.js`. Every Coordination lesson declares the outcome its setup produces (`expect.verdict`) and the test suite runs each one, plus spot-checks of the "Try this" claims — engine changes that would break a lesson's story fail the tests.

---

### V2 — Realism Layer (built 2026-10-29: phases 1–5 + quadrilateral)

**Scope (agreed 2026-10-29):** source impedance (SIR), phasor display, single line-to-ground faults, **fault resistance** (added to the original scope).

**Why it's a new foundation:** today a relay's apparent impedance is the geometric distance to the fault — exact only with zero source impedance, bolted faults and no infeed. Every V2 feature breaks that assumption, so V2 replaces it with a **phasor network solver**: complex V and I at every terminal (this also completes the V1 architecture constraint "fault engine returns V and I at each terminal"), and each relay element measures Z = V/I.

**Phases (each shippable on its own):**
1. **Phasor solver, 3Ø only.** Positive-sequence network with source impedances; relays measure V/I. Acceptance: with source impedance → 0 and Rf = 0 it reproduces today's results exactly — the existing test suite and lessons must pass unchanged. The time-domain engine re-solves the network after each breaker opening (replacing `feedPaths`; "carrying" = non-negligible current through the CT, direction from the phasors)
2. **Phasor panel + SIR.** V and I phasors per relay for the selected fault/time; fault point on the R-X plane drawn from measured V/I. SIR lessons (close-in faults → near-zero relay voltage)
3. **Single line-to-ground faults.** Zero-sequence network (line Z0, source Z0), sequence-network connection for SLG, ground distance elements with residual compensation k0 (Z = V / (I + k0·3I0)), phase vs ground loops
4. **Fault resistance.** Rf slider; resistive faults move off the line-angle diagonal and can fall outside the MHO circle (worse with remote infeed). Quadrilateral characteristic as an option afterwards
5. **Infeed** (was V2+) largely falls out of phase 1 once intermediate buses can carry sources

#### V2 design (design pass 2026-10-29 — phase 1 built, phases 2–5 for review)

**System model**
- Prefault: no load. Every source EMF is E = 1∠0°, so every bus sits at 1∠0° before the fault. That makes the prefault voltage the memory polarizer, with no load flow to solve. Load and angle spread across the system come later (V2+)
- Homogeneous system: source impedances use the line angle (`lineAngleDeg`), so all fault currents lag E by the same angle. A separate source angle can come later
- All impedances stay in pu of line AB. Zline = length∠θ. Zs = SIR × 1.0∠θ, so a source's SIR is quoted against AB. The phasor panel also shows each relay's SIR against its own line (Zs behind it ÷ own line Z)

**Solver (`lib/solver.js`, complex helpers in `lib/complex.js`)**
- Nodal analysis per solve. Nodes are the buses, plus a fault node F when the fault is inside a line. That line splits into two segments, F→from and F→to. A fault within 10⁻⁶ of a line end snaps to the bus, which is also how today's geometry treats it
- A branch is in service unless the breaker at one of its bus ends is open. A failed breaker counts as closed
- Fixed-voltage nodes: the fault node when bolted (V = 0), and stiff sources (Zs = 0, V = E). A bolted fault on a stiff source's own bus pins V = 0 and the source current is infinite. A source with Zs > 0 is a Norton injection E/Zs in parallel with 1/Zs. Fault resistance (phase 4) puts a 1/Rf shunt at F instead of pinning it to 0
- Unknown nodes with no path to a fixed node or a shunt are dead: V = 0 and they are left out of the matrix, so the matrix is never singular. Complex Gaussian elimination with partial pivoting is plenty at this size (≤ 10 nodes)
- Output: V at every bus, and per relay the CT current I flowing from the bus into its line (0 if its breaker is open). Also: each source's injection, the total fault current, and `cleared` (fault current below threshold)
- **Carrying** = |I| > 10⁻⁶ pu. Live sources are those whose injection is above threshold; the one-line draws these as source→fault paths, as before
- The engine re-solves after every breaker opening. A zone resets whenever its assertion drops: because the current is gone, or (once infeed or Rf exist) because the measured Z left the zone

**Relay measurement (`protection.js`)**
- Apparent impedance Z = V / I, with V the relay's bus voltage
- Directional element: memory-polarized. Forward if Re(Vmem · conj(I·1∠θ)) > 0, with Vmem the prefault voltage. This settles the V ≈ 0 case: a bolted fault on the relay's own bus has Z = 0, but current flows from the line into the bus, so the element reads reverse. That is today's "own bus counts as reverse" rule, now derived from the phasors
- MHO reach: a self-polarized circle through the origin, tested with the standard comparator Re(Z · conj(Zr − Z)) ≥ 0, where Zr = reach∠θ. Forward zones need direction forward and |Z| > 0. Reverse zones need direction reverse and either Z = 0 or −Z inside the circle. The dynamic expansion that memory polarization gives a MHO (it grows back toward the source by Zs) is deferred. It would be a good V2+ teaching overlay, but it changes reach with SIR, and that should be a deliberate step
- Equivalence: with sources only at the chain ends there is no infeed, so measured Z equals the geometric impedance to the fault for **any** SIR. SIR changes the V and I magnitudes, not the trips. The phase 1 tests check both points: Zs = 0 reproduces every existing result and lesson, and Zs > 0 changes no verdict

**Inputs & defaults (resolves the open questions)**
- *Source impedance:* SIR per source bus, stored as `network.buses[].sir` (pu of AB, so it equals SIR relative to AB). The default is 0 (stiff), which leaves every basic lesson unchanged. Single-line mode uses the A and B values and the full chain uses X and Y, so each topology keeps its own sources. Slider 0–10 with presets: Strong 0.2 · Medium 1 · Weak 4 (short-line) · Very weak 10
- *Zero sequence (phase 3):* per line, Z0/Z1 magnitude ratio (default 3.0) and Z0 angle (default = line angle). Per source, Z0/Z1 ratio (default 1.0). Each relay's k0 setting defaults to **Auto** (matches its line: k0 = (Z0 − Z1)/3Z1) and can be overridden with a magnitude and angle. A mis-set k0 then becomes a teaching case: ground elements under- or overreach while phase elements stay on target
- *Close-in V ≈ 0:* handled by the memory-polarized directional element above (phase 1). An optional realism switch for phase 2: a minimum relay voltage (e.g. 1% Vnom) below which the MHO becomes unreliable without memory. Not planned unless asked
- *Progressive disclosure* — new ⚙ toggles, each off by default, so the app behaves exactly as before with them off:

  | Toggle | Phase | Controls appear |
  |--------|-------|-----------------|
  | Source impedance & phasors | 2 | SIR slider at each source symbol on the one-line (tap the source); phasor panel under the timing chart; R-X fault point drawn from measured V/I |
  | Ground faults | 3 | Fault type selector (3Ø / AG) beside the fault location; line Z0/Z1 in ⚙ Line data; k0 per relay in the relay settings |
  | Fault resistance | 4 | Rf slider (0–2 pu) beside the fault type; quadrilateral characteristic option per relay comes after |
  | Infeed sources | 5 | "Source" checkbox + SIR on the intermediate buses A and B (full chain) |

- *Fault Study:* keeps the six-fault suite as the backbone. With ground faults or fault resistance on, its header gains the same fault type and Rf selectors, and the whole table re-runs for the selected type and Rf. The R-X plane plots the loop the relay actually uses for that fault (phase loop for 3Ø, the faulted phase's ground loop for AG)

**Phase 2 — phasor panel (sketch)**
- One small phasor diagram per relay (the selected one by default, both on a wide screen): Va/Ia phase quantities for 3Ø, with V, I, |Z|∠, and the relay's SIR. It follows the scrubber, so you can watch the current collapse when the remote end opens
- Lessons: "SIR and relay voltage" (close-in fault, SIR 0.2 vs 10: V drops toward zero while Z stays the same), "Why memory polarization", and a note on CVT transients (not modeled)

**Phase 3 — SLG (sketch)**
- Sequence networks: positive and negative (identical, homogeneous) plus zero, using each line's Z0 and the sources' Z0. An AG fault connects the three sequence networks in series at F (with 3Rf). The solver runs the same nodal routine once per sequence, using the Thevenin impedances at F
- Ground elements: Z = Va / (Ia + k0·3I0). Phase elements: Z = Vab / Iab, etc. Each zone asserts if its ground loop (AG faults) or phase loop (3Ø faults) is inside the characteristic. Zone settings stay one reach per zone for both loops at first; a separate ground reach can come later

**Phase 4 — Rf (sketch)**
- A 3Ø fault puts Rf in each phase; an AG fault puts 3Rf in the sequence loop. With remote infeed, the apparent resistance Rf·(1 + I_remote/I_local) tilts, and the fault can fall out of the MHO. Teaching cases: a Z1 MHO that misses a resistive fault, then the quadrilateral that catches it

**Prefault load flow — built 2026-10-29:** ⚙ "Prefault load" with a power-transfer angle δ (0–60°, default 20°): source EMF angles spread linearly along the chain, left end leading (single-line: A leads B). The solver splits into a core network solve plus measurement: relays measure total V/I (load + fault), while "sees fault current" (carrying, TRIP traces, live source paths, resets), and the phase selector use the **fault component** = total − the healthy network with the same breakers open (superposition). The memory polarizer is the true prefault bus voltage. Relays also report their prefault load impedance (`Zload`): on the phasor cards and as a grey ◆ on the Fault Study R-X plane. Bolted 3Ø results are unchanged by load (tested; no infeed → measured Z stays exact). The quad directional boundary moved from 15° to 22° below the R axis (typical setting): at 15°, a close-in resistive fault at a heavily loaded sending end, tilted down by load plus remote infeed, fell outside. Schema v9 (`loadAngleDeg`, `features.load`). Lessons: *Load + Rf: the sending end overreaches* (Coordination), *Load encroachment* (Fault Study)

**Phase 5 (infeed) — built 2026-10-29:** ⚙ "Infeed sources" with a source checkbox + SIR per intermediate bus (A, B). `withInfeed()` (schema.js) turns flagged buses into sources centrally (Coordination with adjacent lines, and the Fault Study); infeed SIR applies even without the SIR feature, and switching an infeed on starts at SIR 1 (a stiff infeed would hold the bus at 1 pu and starve the upstream line). Intermediate sources draw below their bus on the one-line. Schema v8 (`bus.infeed`, `features.infeed`). Lesson: 21-AB reads 148% for a fault 112% away (B at SIR 1), so Z2 loses remote backup; a stuck 52-BY is never cleared because B's own source can't be isolated remotely (breaker-failure protection not modeled)

**Quadrilateral — built 2026-10-29:** per relay Shape MHO / Quad (offered with the Fault resistance feature; gated by `relayShape`). Quad zone = reactance line at the reach point's X, resistive blinders parallel to the line angle at ±R reach (per zone, % of own line; defaults Z1 100, Z2 150, Z3R 75), directional boundary 15° below the R axis, plus the memory-polarized direction element. Bolted faults trip exactly as MHO (tested). Fault Study R-X draws the polygons. Schema v7 (`relay.shape`, `zone.rReach`)

**Phases 3–4 — built 2026-10-29:**
- Solver rewritten in the phase domain: three-phase nodal analysis where every element is balanced and built from its Z1/Z0 (self = (2Y1+Y0)/3, mutual = (Y0−Y1)/3). One routine covers 3Ø and A–G, bolted (faulted phases pinned to 0 V) or through Rf (shunt per faulted phase). Sequence-network results are reproduced (tested: A–G fault current = 3E/(Z1+Z2+Z0))
- Relay measurement through a simple phase selector: 3I0 > 10% of the largest phase current → ground fault → ground loop of the highest-current phase, Z = Vp/(Ip + k0·3I0); otherwise the phase-pair loop with the most current. Memory polarization per loop (the loop's prefault voltage). 3Ø results are identical to phase 1 (AB loop = positive sequence)
- Schema v6: line `z0Ratio` (default 3) + `z0AngleDeg` (null = line angle), source bus `z0Ratio` (default 1), relay `k0` (null = auto from its line, number = magnitude override); features `ground`, `rf`. Source Z0/Z1 (⚙ under Ground faults) and line Z0 angle (Relay & line settings) have controls since 2026-10-29
- UI: ⚙ toggles "Ground faults (A–G)" and "Fault resistance"; 3Ø / A–G buttons + Rf slider (0–2 pu) under the fault location (Coordination) and in the Fault Results header (Fault Study, applies to all six faults); Z0/Z1 per line and Ground k0 (auto / override) per relay in the settings panels; phasor cards show Va, Ia, 3I0 and the measuring loop, e.g. Z(AG)
- Rf with no load: the apparent-resistance multiplier I_fault/I_relay is real (homogeneous system), so resistive faults slide straight right on the R-X plane. The classic tilt needs prefault load (backlog)

**Phase 2 — built 2026-10-29:** schema v5 (`network.buses[].sir`), ⚙ "Source impedance & phasors", phasor panel, two lessons.

**Phase 1 — built 2026-10-29:** solver, measured V/I and directional element in place of geometric distance. Every snapshot carries V/I per relay for phase 2. No schema or UI change: buses without `sir` count as stiff.

---

### V2+ — Advanced Effects

**Current differential module — built 2026-10-29** (⚙ "Current differential (87L)" → Differential tab; `lib/differential.js`, `DifferentialView.jsx`):
- Separate module on top of the phasor solver: reads both A–B CT currents (into the line), per phase Iop = |IA + IB|, Ires = (|IA| + |IB|)/2, operate when Iop > pickup and Iop > slope·Ires. Reported phase = closest to / furthest past operating
- Conditions: line charging current (∝ local voltage, leading 90°, half from each end) appears as false differential; CT error at B (magnitude under-reporting, e.g. through-fault saturation)
- Rows: Healthy (load + charging) plus the six-fault suite; shares the Fault Study's fault type / Rf and full network (incl. infeed / load). Assessment: Correct trip / Fails to trip (internal), Correct restraint / Misoperation (external; bus faults are external to the CTs)
- Display: Iop–Ires chart with the dual-segment characteristic and every fault plotted (click to select), results table, settings sliders (pickup, slope, charging, CT error)
- Lessons (Current differential track): *Differential: what goes in must come out* (selectivity; trips through Rf 1.0 3Ø / 2.0 A–G where distance fails), *CT error and charging: why slope and pickup*
- **In the Coordination engine** (built 2026-10-29): with the feature on, line A–B has 87L as primary alongside distance (backup). On every network solve the engine evaluates the differential from both ends' phase currents (`update87` in timeline.js); when it operates, both ends trip "87L" after relay time + channel time (pilot channel delay) unless it drops out first; it drops out with the fault current. Failures: "87L channel A–B" in service / out (out → blocked, distance only). Timing chart: 87L OP row at both A–B terminals; one-line badge TRIP 87L. Lesson *87L in the clearing sequence*: end-zone fault, A trips 87L at 25 ms instead of Z2 at 317 ms; channel out → step distance; external fault restrains; CT error 80% → out-of-section 87L trip (miscoordination)
- Not modeled yet: separate 87L channel delay, alpha-plane view, CT ratio mismatch, line-charging compensation

**Infeed modeling:** built as V2 phase 5 (sources at the intermediate buses A and B; see V2 above). Tapped lines (a source or load part-way along a line) are the next step: see V4.

---

### V3 — Protection for the people around it (design draft 2026-11-11)

**Who it's for.** People who work on or around the protection system without being protection engineers. **Networking and SCADA staff** own the **station-to-station communications path** (teleprotection channels: pilot schemes, 87L) and, in digital substations, the **in-station network**, where sampled values (SV) and GOOSE replace copper: the network *is* the protection circuit, CT/VT wiring becomes SV streams and trip wires become GOOSE messages. **Commissioning, planning and controls staff** need the same fundamentals.

**The gap.** The simulator answers *how* protection works. This audience first needs *why it matters* and *what has to work for it to work*:
1. **A fault has a cost, and the cost grows with time.** Clearing time is the product. A slow clear damages equipment, endangers people and can make the grid unstable.
2. **Protection is a chain.** Instrument transformers → relay → logic → communications → DC supply → trip circuit → breaker. Any link failing turns a 4-cycle clear into a backup clear, a wider outage or a misoperation.
3. **Your network is one of those links.** Today it is the teleprotection channel between stations. Tomorrow it is also the process bus and station bus inside the fence.

**Why here, not a separate app or slideshow.** The engine already produces clearing times, fault currents, channel signals and failure outcomes. "Break this link and watch the clearing sequence change" is the lesson, and a slideshow can't do it. This module adds what each outcome costs and a way to break the links this audience owns.

**Design principles**
- **Typical published values only.** Where a number is needed, use a typical industry or standard value and label it "typical".
- **Critical clearing time default: 12 cycles, illustrative.** There is no general industry CCT: it comes from a transient-stability study of a specific system (a few cycles near large generators on EHV, much longer on remote systems). 12 cycles sits mid-range for transmission and puts Zone 1 / pilot clears inside and step-distance Zone 2 beyond. Labelled "illustrative" in the app.
- **Few new knobs.** Network effects are fixed-value **scenario presets** (e.g. "path switched: +3 ms one way"), not new settings. Add a knob only when a lesson can't be told without it.
- **Detailed network modelling belongs to the separate IEC 61850 sim:** latency distributions, retransmission, subscriber supervision, time-sync holdover, redundancy (PRP/HSR). This app shows only basic, illustrative cause → protection consequence and mentions the detail in lesson text.
- **Audience replaces level on the welcome card** (see *Audience path*); the learner level stays in ⚙ Settings.

#### A. Consequences panel (*what clearing time costs*) — built 2026-11-11
A card beside the verdict that turns the run into costs, from data the engine already has (fault current through each element vs time, clearing time):
- **Clearing time against the critical clearing time** (default 12 cyc, **illustrative**), drawn as a margin bar: inside CCT / beyond CCT ("generators near this line could lose synchronism"). A static threshold, not a dynamic model.
- **Through-fault duty (I²t)** on line A–B as a multiple of the primary-clear value ("backup clear: 6.2× the I²t of a primary clear"). Relative, so no conductor data is needed.
- **Arc energy:** relative scale only (∝ I·t at the fault), labelled as relative. Not an arc-flash study.
- **Outage extent:** which buses and lines lost supply (from the breakers that opened). A remote backup or miscoordination drops more of the system.
- Every existing lesson gains the panel automatically.

**As built** (`lib/consequences.js`, `ConsequencesCard.jsx`; ⚙ Modules → Consequences, schema v11 `features.consequences` + `consequences.cctCycles`, default 12):
- The engine records the fault current magnitude (`faultI`, max phase, from each network solve) in every event snapshot. `costsAt(sim, config, t)` integrates it piecewise between events, from inception to min(t, clearing): duty = ∫I²dt and arc = ∫I dt, each divided by the "fast clear" reference = inception current × (relay + breaker time). A Zone 1 clear at both ends is exactly ×1.0.
- The card sits under the outcome on the Coordination tab and fills in as the run plays. Meters are green up to the reference tick (CCT, fast clear) and red past it. Once cleared: inside / beyond the CCT, and the outage.
- Outage (`outageExtent`): a line is out when either breaker opened (a stuck breaker counts as closed); a bus is dark when no source reaches it through in-service lines. Reported beyond what clearing the fault must take out (the faulted line, or the faulted bus and its lines).
- Teaching nuance the card states: in an end-zone step-distance clear the near end opens first and takes most of the current with it, so I²t barely grows (×1.0, stiff sources) while the clear is far beyond the CCT. The cost there is time (stability, the arc stays lit), not heating. A stuck breaker keeps the full current flowing (×5.5 for a 22-cycle backup clear).
- Uncleared runs show "not cleared" and no outage. A bolted fault at a stiff source has unbounded model current, so duty and arc aren't shown.
- Not built yet: the latency stacked bar (§ C).

#### B. Protection chain view (*every link must work*) — built 2026-11-11

*Terminology:* "chain" is teaching shorthand for the defined **Protection System**. NERC Glossary of Terms (verified wording, 2026-11-11; <https://www.nerc.com/glossary-of-terms>, e.g. `?alpha=C` for Composite Protection System):

> **Protection System**
> - Protective relays which respond to electrical quantities,
> - Communications systems necessary for correct operation of protective functions
> - Voltage and current sensing devices providing inputs to protective relays,
> - Station dc supply associated with protective functions (including station batteries, battery chargers, and non-battery-based dc supply), and
> - Control circuitry associated with protective functions through the trip coil(s) of the circuit breakers or other interrupting devices.
>
> **Composite Protection System**: The total complement of Protection System(s) that function collectively to protect an Element. Backup protection provided by a different Element's Protection System(s) is excluded.

The chain view's links map onto it (VT/CT = sensing, relay, channel = communications, DC supply, trip circuit = control circuitry through the trip coil); the breaker card sits just outside the definition, as the interrupting device it operates. Remote backup (e.g. 21-XA's Zone 2 for a line A–B fault) is excluded from line A–B's Composite Protection System. The app quotes both definitions in the chain view header tooltip, links the glossary, and names them in *The chain: one dead battery*.

Zoom into one terminal: a horizontal chain of link cards, each with a state that maps onto the engine.

| Link | States (teaching) | Engine effect | Engine status |
|------|------------------|---------------|---------------|
| CT | OK / polarity reversed (later: saturated) | reversed: direction flips (DCB sends a false block, 87L misoperates on through-faults) | new (CT error exists for 87L at B) |
| VT | OK / fuse failed (later) | loss of potential: distance blocked at that terminal, 87L unaffected | new |
| Relay | in service / out | existing relay OOS | built |
| Channel | in service / out / lost at fault + presets (§ C) | existing channel states | built |
| DC supply | OK / lost | relay dead **and** breaker can't trip: backup clears | new (= relay OOS + breaker fail at that terminal) |
| Trip circuit | OK / open coil | existing breaker fail | built (re-labelled) |
| Breaker | OK / stuck | existing breaker fail | built |

- Each link card has a one-paragraph note on the field check that catches its failure: CT polarity and ratio tests, VT fuse supervision, DC battery monitoring, trip-circuit supervision, channel monitoring and alarms, end-to-end testing.
- Implementation: chain failures are **scenario** entries (like `relayOos`, `breakerFail`, `channels`), not config, so they never leak into settings or lessons that don't set them. The zone assertion / trip decision split is unchanged; new effects sit at measurement (CT/VT) or at the trip output (DC, trip circuit).

**As built** (`ChainView.jsx`, part of the Consequences module, now "Consequences & protection chain" in ⚙ Modules, so no extra toggle or schema change): a section under the Coordination workspace with a terminal picker (every relay) and seven link cards: CT, VT, relay, channel, DC supply, trip circuit, breaker. Each card shows a status tag (OK / FAILED / NO DC / N/A), a live reading from the current playback snapshot (|Ia| and |Va|, zone pickup / TRIP, TX / RX, breaker state), its failure control, and the field check that catches the failure.
- Failure controls write the same scenario entries as the Failures panel: relay in service (`relayOos`), channel state (`channels` for the line's pilot scheme, or `diffChannel` for 87L on A–B; N/A for step distance), station DC (`dcLost`), breaker opens (`breakerFail`), and new **trip circuit open** (`scenario.tripOpen: [rid]`): the relay trips but the breaker never receives it, logged at trip time ("Trip circuit 52-AB open — the trip never reaches the breaker"), outcome note "trip circuit open", breaker stays closed. The Failures panel counts it and points to the chain.
- CT and VT have no failure modes yet (polarity, saturation, fuse failure are phase 4).
- *The chain: one dead battery* gains a try-this: DC restored, trip circuit open at AB → 21-AB trips at 17 ms, never delivered, same 367 ms remote-backup clear (spot-checked).

#### C. The channel in the trip path (station-to-station, *today*)
Builds on the pilot schemes and 87L that already exist, and on the existing ⚙ channel delay. No new settings; illustrative presets only.
- **Latency is part of clearing time:** clearing = relay + channel + breaker, shown as a stacked bar on the consequences card. Existing lessons already show the effects: POTT slows down one-for-one, and DCB **overtrips** once channel delay exceeds the coordination timer (*Coordination timer vs channel time*, reframed for this audience).
- **87L asymmetry, one preset:** "path switched: +3 ms one way". With channel-based (ping-pong) alignment each relay assumes the delay is half the round trip, so the alignment error is Δ = (t_AB − t_BA)/2 and the phase error θ = 360°·f·Δ. A through current I then shows a false differential 2·sin(θ/2)·I. At 60 Hz, 3 ms one way → Δ = 1.5 ms → θ ≈ 32° → Iop ≈ 0.56·I, above a 30% slope, so 87L misoperates on load or a through-fault. (1 ms one way → θ ≈ 11°, Iop ≈ 0.19·I, still restrains.) Needs a separate 87L channel delay internally (already on the backlog) and `differential.js` rotating the remote current by θ. Lesson text mentions GPS-synchronized alignment as the usual remedy, and the 61850 sim for detail.

#### D. The network is the protection circuit (in-station, *next*)
Behind a ⚙ "Digital substation (IEC 61850)" module, the chain view swaps copper for network links. Each link has only basic, illustrative states, with fixed typical values:
- CT/VT → **merging unit → SV** → relay. States: OK / **stream lost**. Effect: the relay blocks the functions that use the stream after a short supervision delay (typical: about 1 cycle, labelled illustrative), so backup clears. Lesson text mentions stale samples, latency and time sync, and points to the 61850 sim.
- Relay trip → **GOOSE → breaker IED** → trip coil. States: OK / **not received** (lost, or a misconfigured subscriber: the commissioning miss). Effect: the relay "trips" but the breaker never hears it; remote backup clears. Typical trip-message transfer time (IEC 61850-5, trip messages: 3 ms) is shown as a fixed figure, not a setting.
- **Not modelled here** (61850 sim, mentioned in lesson text): retransmission timing, latency budgets beyond the fixed figure, time-sync loss and holdover, PRP/HSR vs RSTP recovery.
- **Boundary with the IEC 61850 sim** (full briefing: `docs/iec61850-interface.md`): this app abstracts each link to a state and shows the protection consequence. The 61850 sim models the messages themselves. No data exchange between the two (decided 2026-11-11): each simulator generates its own scenarios; static fixtures from this engine are the fallback if realism is ever needed.

#### Audience path and lessons
- **Built 2026-11-11:** the welcome card asks *Which describes you?* (`AUDIENCES` in `lib/levels.js`, per-browser `lps.audience`); choosing switches the consequences module live, and the choice also seeds the config at start and on Reset. **Station DC supply lost** (`scenario.dcLost: [bus]`, Failures panel with the consequences module on): every relay at that bus is out of service and its breakers can't trip; logged at inception, named in the outcome notes, shown in the coverage lanes and on the one-line (DC LOST badge on the bus, greyed relays marked NO DC, breakers ringed: no trip supply). Out-of-service relays are greyed on the one-line too (OUT).
- The welcome card's level picker is **replaced** by an audience question:
  - **"I'm learning protection"** → Basic level and *Zone 1: instantaneous, but short* (today's flow).
  - **"I work around protection: networks, SCADA, commissioning"** → Basic level with the consequences panel and chain view on, opening the **Why protection matters** track.
  - The level stays in ⚙ Settings (and remains per-browser).
- Gating: consequences, chain and digital substation are modules, like 87L: own ⚙ section, no learner level switches them. With them off the app behaves exactly as before.
- Draft track:
  1. **What a fault costs** (built): fault 10% from A, DCB on A–B; cleared in 100 ms (6 cyc). Try: 52-AB stuck → 21-XA Z2 remote backup at 367 ms (22 cyc), past the CCT, ~3× duty, ~4× arc energy, line X–A and bus A lost.
  2. **The chain: one dead battery** (built): the same fault with station A's DC lost (`scenario.dcLost`): 21-AX/21-AB dead, 52-AX/52-AB can't trip; B still trips DCB at 50 ms (a dead end sends no block), X's Z2 clears at 367 ms and bus A goes dark. Try: DC back → 100 ms; fault at 50% → never cleared in this model.
  3. **Your channel is in the trip path** (built): POTT, fault at 90%; cleared at 75 ms. Try: channel out → 367 ms, past the CCT; channel delay 3 cyc → slower by the added 2.5 cyc.
  4. **Latency is a setting:** DCB coordination timer vs channel delay; too much delay and the scheme overtrips an external fault.
  5. **Asymmetry and 87L:** the path-switched preset; 87L misoperates on a through-fault.
  6. **When the network is the CT** (digital substation): SV stream lost at A, so the relay blocks and backup clears.
  7. **When the network is the trip wire** (digital substation): GOOSE trip not received; the relay tripped but the breaker never heard it.
  8. **Commissioning catches it** (later): CT polarity reversed at B, so DCB sends a false block or 87L trips on a through-fault.

#### Phasing (communications-path material first)
1. **Consequences panel + chain view on existing failures:** CCT (12 cyc, illustrative)/I²t/outage card; chain view with relay, DC, trip circuit, breaker and channel; audience question on the welcome card; lessons 1–3. Mostly UI plus a small scenario addition (DC loss). Schema bump for the CCT setting.
2. **Channel presets:** separate internal 87L channel delay, the asymmetry preset → `differential.js`; latency stacked bar; lessons 4–5.
3. **Digital substation module:** SV stream lost and GOOSE not received; lessons 6–7.
4. **Later:** CT polarity and VT fuse failure as chain states (lesson 8); CT saturation.

#### Open questions
- CCT: is a single default enough, or do some lessons want a per-scenario value ("weak system, CCT 8 cyc")? Default for now: single setting, 12 cyc.
- **Backup clearing limit (backlog):** a second reference on the fault-time meter for the maximum clearing time allowed for backup protection (equipment thermal / through-fault limits; commonly on the order of 1 s for backup overcurrent). Distinct from the CCT, which is a stability limit. Would make a remote-backup or uncleared run show both limits.
- Exact typical figures to cite in lesson text (SV supervision delay, teleprotection channel times): confirm from published standards / vendor-neutral sources when the lessons are written.

---

### V4 — Tapped lines (design draft 2026-11-11, for review)

**Scope.** Station infeed (a source at an intermediate bus) is built (V2 phase 5). A **tap** is a connection part-way along a line, with no station breaker of its own on the line. It changes what the line's own relays measure and what the line's 87L sees. Three steps, each building on the last:
1. **Unprotected load tap** on line A–B (this design: build first)
2. **Unprotected source tap** (outlined below)
3. **Protected source tap = three-terminal line** (outlined below)

#### Physics, honestly stated
- **Load tap and distance:** for a fault between the tap T and B, relay 21-AB measures Z_AT + Z_TF·(1 − I_tap/I_A). Current leaving into the tap (outfeed) makes the relay **overreach** slightly. But during the fault the tap's voltage collapses, so a constant-impedance load draws little current, and for bolted faults the effect is small. The lessons say so rather than overselling it; it grows with fault resistance and with heavy tap load.
- **Load tap and 87L:** the tap's current is not measured, so the line's 87L sees the tap load as standing differential current: Iop = I_tap in normal operation (and during external faults). The pickup must sit above the tapped load. This falls out of the existing solver and `differential.js` with no special-casing, because the A and B currents simply no longer sum to zero.
- **Faults on the tap section — underreach even with a load tap:** for a fault on the tap lead (T toward the tap transformer), *both* line terminals feed the fault through T. Relay 21-AB measures Z_AT + Z_lead·(1 + I_B/I_A): the remote terminal's current is infeed at T. This is independent of what the tap carries; the infeed comes from the far line terminal, not the tap. An unprotected tap section is inside the line's protection zone, so the line's relays (or its pilot scheme) must clear tap-section faults, and the multiplier shrinks their coverage of it.
- **Faults behind the tap transformer** (on the tap's low-voltage bus): the same infeed multiplier applies to the transformer impedance, Z_AT + (Z_lead + Z_t)·(1 + I_B/I_A). The tap transformer's impedance is large compared with the line, so Zone 1 should not reach these faults (and setting rules make sure it doesn't); the infeed pushes them further out. Zone 2 may or may not reach them depending on the infeed: where it does, its time must coordinate with the tap transformer's own protection (fuse or relay), which clears those faults.
- **Voltage in the model:** the solver is a full phasor nodal solve (sources = EMF behind source impedance), so bus voltages sag with the fault and the tap's constant-impedance load draws current at the sagged voltage (the first shunt load in the model). With stiff sources (SIR 0) the source buses themselves stay at 1 pu (infinite bus); the tap node and lead sag regardless.
- **Ground faults:** a tap transformer with a grounded-wye high-voltage winding (delta low side) is a **zero-sequence source** even when it only feeds load: for a line ground fault it supplies 3I0 at the tap, so ground distance underreaches and 87L sees zero-sequence differential. Noted here; modelled in a later step (below).

#### Step 1 — Unprotected load tap — built 2026-11-11
- **Model:** line A–B gets an optional tap: `line.taps: [{ id: 'T', at, lead, zt, load }]`, with `at` = position from A (fraction of the line, default 0.4), `lead` = tap section length (pu of line A–B impedance, default 0.2, illustrative), `zt` = tap transformer impedance (multiple of line A–B's impedance, default 2.0, illustrative), `load` = load current at nominal voltage (pu, default 0.1, illustrative), constant impedance. No relay or breaker at T. Schema bump with migration.
- **Solver:** a tap is an internal node on A–B (the line splits into A–T and T–B, each with its share of Z1/Z0) plus a branch T → tap section (lead, line impedance) → tap transformer (zt) → tap LV bus → load to ground. Nodal analysis needs no new concepts. The tap load flows even without the Prefault load feature (it is load), so the healthy network carries current; the fault-component split already handles that.
- **Fault locations:** anywhere on A–B (still a fraction from A; the solver places it on A–T or T–B), anywhere on the **tap section** (`{ kind: 'tap', tap: 'T', frac }`, fraction from T), and the **tap LV bus** (`{ kind: 'tapLV', tap: 'T' }`).
- **Tap transformer protection:** a fixed clearing time for faults on the tap LV bus (illustrative, e.g. 6 cycles), logged as its own event, so the line's Zone 2 has something to coordinate with. A setting only if a lesson needs one.
- **Gating:** a distance feature in the Advanced level ("Line tap"), gated centrally (`coordinationConfig`, like `withInfeed`). With it off nothing changes.
- **Display:** one-line: a branch dropping from the line at T with a transformer symbol and a load arrow; clicking the LV bus places the fault there. Coverage lanes: a tick at T on the A–B span. Differential tab: the Healthy row now shows Iop = tap load. Fault Study: tap faults added only if the lessons need them.
- **Lessons (draft):**
  1. *The tap section is inside your zone:* fault at the end of the tap section. 21-AB and 21-BA each see the other end's current as infeed at T and measure it further away than it is: Zone 1 may not reach it from either end, so it clears on Zone 2 (step distance) unless a pilot scheme accelerates it. Make B's source weaker (SIR) and watch A's apparent impedance come back toward the true value.
  2. *A tap the 87L can't see:* healthy line, Differential tab: Iop equals the tap load. Lower the pickup below it and the line trips on load. Why pickups sit above tapped load, and why tap CTs or larger pickups are used.
  3. *Fault behind the tap:* LV-bus fault: Z1 doesn't reach it (transformer impedance plus infeed); whether Z2 does depends on the infeed from the far end. Where it does, Z2 picks up and resets when the tap protection clears at 6 cycles. Shorten Z2 time or lengthen the tap clearing and the line trips for a fault that wasn't on it.
  4. *Outfeed is small here:* fault just past T: compare 21-AB's measured reach with and without the tap; small for a bolted fault, larger with Rf. (Sets up the source tap, where the effect is large.)
- **Tests:** solver equivalence (tap load 0 and no tap fault → identical to today), tap-section fault apparent impedance = Z_AT + Z_lead·(1 + I_B/I_A) from the solved currents, 87L Healthy Iop = tap current, LV-bus fault not in Z1, lesson outcomes and every "try this" figure spot-checked as usual.

**Step 1 as built:**
- Schema v12: `network.lines[AB].tap = { at: 0.4, lead: 0.2, zt: 2.0, load: 0.1, clearCycles: 6 }` (illustrative, pu of line A–B) and `features.tap` (Advanced level, ⚙ Individual features → "Line tap (A–B)" with two sliders: tap position 15–85% and tap section 0.05–1.0 pu of line A–B — the section is the variable the underreach scales with, so it earns a knob; transformer and load stay lesson presets). `activeTap(net, config)` in `network.js` is the single gate.
- Solver: line A–B splits at T (and at F for a line fault; a fault exactly at T sits on T); end segments open with their breakers, middle segments have none. Tap branch T → tap section (line impedance and Z0 ratio) → TH → tap transformer (`zt` at the line angle) → TLV, with a constant-impedance load at TLV (power factor ≈ 0.95 lagging). Transformer and load pass no zero sequence (tiny admittance keeps the mode solvable). With a tap the healthy network carries current, so the fault-component split (as with prefault load) is always on.
- Fault locations `{ kind: 'tap', frac }` (from T) and `{ kind: 'tapLV' }`: fault picker (Tap T group, section slider), clickable on the one-line branch. Chain position = T. Tap-section faults: primary = line A–B's breakers. LV-bus faults: the tap transformer protection opens the transformer at `clearCycles` (event "Tap T transformer protection clears the fault"); any line breaker opening for it is miscoordination.
- Display: tap branch under the line at T (section, transformer circles, LV bus, load arrow; greyed when the tap protection has opened); coverage tick "T". For tap faults the single fault line is replaced by per-relay markers: ◇ true electrical distance (to T + down the section [+ transformer]), labelled below the lane, and ◆ measured |Z| while the fault is on, labelled above (pinned to the chart edge with an arrow when off-chart).
- Verified physics (tests): tap-section measured Z = Z_AT + Z_lead·(1 + I_other/I_own) from the solved currents; feature off → identical outcome; a line fault beyond the tap reads ~1.6% short (outfeed, slight overreach) — small, as stated.
- Lessons (*Tapped lines* track, Advanced): *The tap section is inside your zone* (tap at 50%, section 0.3: true 80% from both ends, measured 110% → Z2 at 317 ms; POTT → 75 ms; weak B → A reads 83%, B 350%, 433 ms; section 0.5 → true 100%, measured 150%; main-line fault reads true), *Fault behind the tap transformer* (tap at 30%, zt 0.3: A reads 101% → Z2 picks up, tap protection clears at 100 ms; Z2 3 cyc → line trips at 67 ms, miscoordination; 6 cyc → tight), *A tap the 87L can't see* (Differential tab: tap load → healthy Iop 0.35 > 0.3 pickup, misoperation; pickup 0.5 restrains, F2–F4 still trip; tap off → 0.05). The outfeed lesson folded into the first lesson's try-this. Every quoted figure is spot-checked.

#### Step 2 — Unprotected source tap (outline)
What changes from step 1: the tap branch gets a source behind the transformer (EMF + SIR), plus the transformer's grounding.
- **Distance:** positive-sequence infeed at T. For faults beyond T, both 21-AB and 21-BA **underreach** by (1 + I_tap/I_relay): Zone 1 coverage shrinks, Zone 2 may no longer cover the remote end. Same multiplier as station infeed, but inside the protected line.
- **Pilot schemes:** with a strong tap, an internal fault can draw current *out* of one terminal (outfeed): that end sees the fault as reverse, so POTT gets no permissive from it and DCB receives a block. The scheme fails to trip fast for an internal fault: the classic tapped-line pilot problem. Weak-infeed / echo logic is the usual remedy (would need modelling).
- **87L:** for external faults the tap's fault contribution leaves through A or B and appears as differential current, so an unmeasured source tap can **misoperate** 87L for external faults unless the pickup/slope covers it or the tap current is measured.
- **Zero sequence:** transformer grounding as a setting (grounded-wye HV = zero-sequence source; delta or ungrounded = none). Covers the ground-source load tap from step 1 as a special case.
- **Engine work:** small on top of step 1 (a source node instead of a load; the solver already handles sources and SIR). Most of the work is lessons, the outfeed/direction display, and possibly weak-infeed logic.

#### Step 3 — Protected source tap = three-terminal line (outline)
What changes from step 2: a breaker and relays at T, so the line has three terminals.
- **Topology:** the network stops being a chain. `network.js` assumes buses in a row (positions, relay direction, feed paths, the coverage axis); a T branch needs a path search instead of interval logic, and a coverage view that shows the third leg (e.g. one lane group per leg).
- **Distance settings:** each terminal's reach is a percentage of which leg? Typical practice: Zone 1 underreaches the nearest remote terminal *without* infeed; Zone 2 overreaches the farthest remote terminal *with* infeed. Both conditions need to be visible in the coverage view.
- **Pilot schemes:** three-terminal logic: POTT trips on permissive from *all* other terminals; DCB holds on a block from *any*. More ends, more channel paths, more channel failure cases (good material for the comms audience).
- **87L:** three-terminal differential, Iop = |IA + IB + IT|, with a channel per pair (or a ring) and the channel-failure and alignment cases that come with it.
- **Breaker failure and outages:** opening T matters for isolating the tap source; the consequences card's outage extent needs the branched topology too.
- **Effort:** the largest of the three. It touches the network model, the one-line and coverage layouts, the schemes and 87L. Worth doing only once steps 1–2 have shown the tap lessons land.

#### Open questions
- Tap position and sizes as fixed lesson presets only, or user settings (position slider, transformer Z, load)? Default for now: lesson presets plus a position slider.
- Tap transformer protection as a fixed clearing time (fuse-like) or a small time-overcurrent curve?
- Fault Study tab: add the tap LV-bus fault to the six-fault suite, or keep the suite fixed and use Coordination only?

---

## Tech Stack

**React + Vite + Tailwind CSS**

- React: component model maps cleanly to relay/zone/fault structure; V1.5 scheme logic adds a component, not a rewrite
- Vite: fast dev loop, small production bundle
- Tailwind CSS: responsive utilities built in from day one; mobile layout is a class change, not a structural refactor
- SVG for the R-X plane (not Canvas, not D3) — zone polygons and fault point computed from reach % via simple math; `viewBox` scales to any screen size automatically

---

## Mobile / Tablet

Not an immediate concern for V1 but designed for future transition:

- Tailwind responsive prefixes (`md:`, `lg:`) used from the start
- Desktop layout: left panel (controls) | center (R-X plane) | right (results table)
- Narrow screen: left panel stacks above R-X diagram; results table scrolls horizontally
- SVG `viewBox` handles diagram scaling automatically — no pixel math required later
- Native range inputs work well on mobile without modification

---

## Import / Export

Not built yet. All settings live in one serializable config object (`lib/schema.js`, `DEFAULT_CONFIG`, schema v12): network (buses with source SIR / Z0 / infeed, lines with length and Z0), relays (zones with reach, resistive reach, delay; k0; shape), timing in cycles, pilot settings and schemes, 87L settings, feature toggles. `migrateConfig()` upgrades any older version step by step (v1 → v12), so saved files stay loadable.

Not tied to the IEC 61850 simulator: the two stay independent (`docs/iec61850-interface.md` § 4).

Planned: export = `JSON.stringify(config)` (+ fault, fault spec and scenario) → file download or share link; import = file picker / URL → `JSON.parse` → `migrateConfig` → load.

---

## Deployment

**Architecture:** static app (Vite build → `app/dist/`: HTML + JS + CSS). No backend; every visitor's state lives in their own browser tab. Never expose the Vite dev server publicly.

**Without Docker:** `app/deploy.sh <ssh-host> [web-root]` builds and rsyncs `dist/` to a web root served by the host's nginx (see the comment at the end of `app/deploy/nginx-host.conf.example`).

### Docker (preferred for public hosting — built 2026-10-29, reworked for nginx)

Never run Vite (dev or `vite preview`) in public. The target server already runs **nginx**, so the container is nginx too and sits behind the host's nginx, which does TLS and access control the same way as the server's other sites.

**Files:** `app/Dockerfile` (two-stage: `node:20-alpine` builds, `nginxinc/nginx-unprivileged:1.27-alpine` serves `dist/` only, 74 MB), `app/deploy/nginx.conf` (container), `app/deploy/nginx-host.conf.example` (host vhost), `app/.dockerignore`, `docker-compose.yml` at the repo root.

**Split of responsibilities:**
- **Container** (plain HTTP, `127.0.0.1:8080`): static files, SPA fallback, caching (`index.html` `expires -1` → no-cache; hashed `assets/*` 1 year; missing assets 404), gzip, security headers (CSP `default-src 'self'` with scripts self only and inline style attributes allowed, `frame-ancestors 'none'`, `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy no-referrer`, `Permissions-Policy`), `server_tokens off`, `/healthz`
- **Host nginx** (example vhost): HTTP → HTTPS redirect, TLS via certbot, HSTS, optional `auth_basic` (htpasswd), `proxy_pass http://127.0.0.1:8080`. A comment shows the no-Docker variant (host nginx serving `dist/` from `app/deploy.sh` directly)

**Hardening:** non-root (uid 101, unprivileged nginx image), read-only root filesystem (tmpfs `/tmp` for pid/temp files), `cap_drop: ALL`, `no-new-privileges`, `restart: unless-stopped`, published on loopback only, healthcheck on `/healthz`.

**Runbook (on the VPS):**
```bash
git clone <repo-url> line-protection-sim && cd line-protection-sim   # or git pull
IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d --build
docker compose ps                                   # healthy?
sudo cp app/deploy/nginx-host.conf.example /etc/nginx/sites-available/line-protection-sim
# edit server_name / cert paths, optionally enable auth_basic (htpasswd -c /etc/nginx/.htpasswd-sim trainee)
sudo ln -s ../sites-available/line-protection-sim /etc/nginx/sites-enabled/
sudo certbot --nginx -d sim.example.com && sudo nginx -t && sudo systemctl reload nginx
```
Update: `git pull && IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d --build`. Change the loopback port with `BIND=127.0.0.1:8090` if 8080 is taken (and match `proxy_pass`).

**Verified locally (2026-10-29):** container healthy as uid 101 on a read-only FS; headers, caching, gzip, SPA fallback, asset 404; the example host vhost (ports shifted, self-signed cert, auth enabled) passes `nginx -t`, redirects HTTP → HTTPS, 401 without / 200 with credentials over HTTP/2, adds HSTS and passes the container headers through; full app in Chromium through TLS + auth + proxy with every feature on and no CSP violations. Real certificate issuance needs the DNS name on the VPS.

`app/deploy.sh` (rsync of `dist/` to a web root) remains as the no-Docker fallback.
