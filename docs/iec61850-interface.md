# Line Protection Simulator ↔ IEC 61850 simulator: interface briefing

Status: **briefing (2026-11-11, revised the same day: no data exchange planned).** It brings a separate IEC 61850 (GOOSE / Sampled Values) simulator up to speed on what this project does and where the dividing line between the two sits. The two simulators stay independent: no shared code, no export/import contract (§ 4).

## 1. The two projects

**Line Protection Simulator** (this repository): what the power system and the protection *do* during a fault. A three-phase phasor network solver, distance and differential relays that measure only the V and I at their own CT/VT, pilot schemes over a teleprotection channel, breakers, and a discrete-event engine that plays out the clearing sequence and judges the outcome. Everything is in per unit. MIT licence. React + Vite UI on top of a pure JavaScript engine.

**IEC 61850 simulator** (planned, separate repository): how the *signals* get there in a digital substation. Sampled Values streams from merging units, GOOSE publications and subscriptions, the station and process bus that carry them, and what goes wrong with each. Audience: anyone who wants to get familiar with the pieces of a digital substation and how they interact.

The two are complementary. This project answers "the relay tripped at 17 ms, and here is why"; the 61850 simulator answers "and here is how that trip, and the measurements behind it, travelled over the network."

## 2. The dividing line

| Topic | Line Protection Simulator | IEC 61850 simulator |
|---|---|---|
| Fault physics (currents, voltages, sag, infeed, fault resistance) | **Owns** (phasor solver) | Consumes, as input to SV |
| Relay measurement and decisions (zones, directionality, pilot logic, 87L) | **Owns** | Consumes the outcomes as GOOSE content |
| Clearing sequence and its timing (relay, channel, breaker times) | **Owns** (discrete events) | Consumes as the trigger timeline |
| Consequences (clearing time vs critical clearing time, outage) | **Owns** | — |
| Sampled Values: sampling, stream structure, datasets, supervision | — | **Owns** |
| GOOSE: datasets, state/sequence numbers, retransmission, subscriber supervision, quality | — | **Owns** |
| Network: VLANs and priority, multicast, latency and jitter, loss, redundancy (PRP/HSR), time sync (PTP) | — | **Owns** |
| Configuration and commissioning errors (wrong APPID/VLAN/dataset, missing subscription) | — | **Owns** |
| **Overlap:** a link's *effect* on protection | Abstract states only: SV stream lost (relay blocks), GOOSE trip not received (breaker never opens), fixed typical figures. Planned in SPEC § V3-D | The *cause*, modelled in detail |

The overlap is deliberate and small. This project will show "the stream was lost, so the relay blocked and backup cleared" without modelling why. The 61850 simulator models why. Each side states the other's part in its lesson text rather than computing it.

## 3. What the engine produces today (*exists*)

Entry point: `simulateFault(config, loc, scenario, spec)` in `app/src/lib/timeline.js`. Pure function, deterministic, no I/O, no randomness.

**Inputs**
- `config`: the full settings object, schema **v12** (`app/src/lib/schema.js`; `migrateConfig()` upgrades any older version). Network (buses with source impedance, lines with Z1/Z0, an optional line tap), relays (zones, reach, delays, k0, shape), timing in cycles (`freqHz`, relay and breaker times, CTI), pilot schemes and channel timing, 87L settings, feature toggles.
- `loc`: fault location: `{ kind: 'line', line, frac }`, `{ kind: 'bus', bus }`, `{ kind: 'tap', frac }`, `{ kind: 'tapLV' }`.
- `scenario`: injected failures: `relayOos`, `breakerFail`, `channels` (per line: ok / out / lost), `diffChannel`, `dcLost` (per station), `tripOpen`.
- `spec`: fault type (`3PH` / `AG`) and fault resistance.

**Outputs**
- `events`: time-ordered list. `t` in seconds; the fault is applied at `t = 0`; `events[0]` is a prefault event 3 cycles before. Each event has `kind`, human-readable `text`, often `rid` (relay id, e.g. `AB` = the relay at bus A looking toward B; its breaker is `52-AB`), and a full `state` snapshot.
  - kinds: `prefault`, `fault`, `pickup` (zone picks up), `operate` (zone timer expires), `trip`, `tx` / `rx` (pilot signal keyed / received), `blocked`, `channel` (channel condition), `diff` (87L operates), `reset`, `bkrOpen`, `bkrFail`, `cleared`, `uncleared`.
- `state` snapshot (per event): breaker states, per-zone status, trips (`{ t, zoneId, logic }`), pilot TX/RX per relay, 87L operate, fault energized and fault current magnitude, and per-relay measurement: phase A voltage and current phasors, 3I0, the measured loop impedance, direction.
- `outcome`: verdict (selective, tight, backup, miscoordination, uncleared), clearing time, notes.

**Phasor conventions**
- Complex numbers as `{ re, im }`. Per unit, RMS phasors: nominal voltage = 1 pu; impedance base = line A–B (1.0 pu); current base = nominal voltage / |Z of line A–B|.
- Angle reference: phase A of the source EMF (with prefault load, source angles spread by the load angle).
- Currents at a relay are measured from its bus *into* its line.
- The network is solved once per state change (fault inception and each breaker opening), so phasors are **piecewise constant** between events.

## 4. Data exchange: not planned

**Decision (2026-11-11):** no export/import contract between the two simulators. Each generates its own scenarios.

**Why.** A shared format would need versioning on both sides, three-phase snapshots, real base values and a signal vocabulary added here for a single consumer, and coordinated releases, for a slim benefit:
- GOOSE content for teaching is a short, generic sequence (fault → distance start → trip → breaker open, perhaps a pilot signal). The 61850 simulator can script it directly; solver-accurate timing adds nothing for its learners.
- SV waveforms built from this engine's phasors would be stepped between events anyway (no DC offset, no transients, breakers opening exactly at event times), so their realism beyond "a fault looks like a fault" is limited. A few magnitudes and angles per scenario are enough, and can be written by hand.

**Fallback if realism is ever wanted: static fixtures.** Run this engine once from a small script, save a handful of runs as JSON (e.g. end-zone fault, stuck breaker, channel failure) and commit them to the 61850 repository as plain data. No live contract: if they go stale nobody is affected until someone chooses to regenerate them. Notes for whoever does it:
- Event snapshots keep only phase A (plus 3I0) per relay; the solver computes all three phases, so a fixture script should call `solveFault` per state (or extend the snapshot) to get Va–Vc and Ia–Ic.
- Everything is per unit (§ 3); pick illustrative bases (system kV, line ohms, CT/VT ratios) in the script, not in this app.
- Signal names can borrow IEC 61850 logical-node names (PDIS start/operate, PTRC trip, PSCH pilot TX/RX, PDIF operate, XCBR position) as a vocabulary, without claiming a conforming data model.

**Not affected:** this app's own share links / config export (SPEC § Import / Export) stay in the backlog for their own sake, independent of the 61850 simulator.

## 5. Portability notes

- **Engine is plain ES modules** in `app/src/lib/` with no runtime dependencies. Exception: `units.js` uses a React context (display units); everything else is pure and can run in Node or a browser.
- **Determinism:** the same inputs always produce the same events and phasors, so any generated fixture is reproducible.
- **Versioning:** the config carries `version` (currently 12) and `migrateConfig()` upgrades old files one step at a time.
- **Tests as the spec:** `app/src/lib/sim.test.js` (Vitest) pins down the physics and every lesson's quoted figures; it is the most precise description of behaviour.
- **UI pieces** (e.g. the logic-analyzer timing chart, `TimingChart.jsx`) are React + SVG + Tailwind; copy and adapt rather than share early.
- **Licence:** MIT.
