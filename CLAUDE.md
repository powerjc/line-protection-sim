# Line Protection Simulator

Distance and differential protection training simulator (React + Vite + Tailwind, pure client-side). Spec: `SPEC.md` (start with § Status & backlog). App code: `app/`. Briefing for the separate IEC 61850 (GOOSE/SV) simulator: `docs/iec61850-interface.md` (dividing line, engine facts, portability; no data exchange between the two).

## Architecture

Pure simulation logic lives in `app/src/lib/` (no React — keep it that way so it stays testable):

| File | Role |
|------|------|
| `schema.js` | Config schema (v15), defaults, `migrateConfig()` (v1→v15, one step per version), `coordinationConfig()` (single-line A–B unless the adjacent-lines feature is on), `withInfeed()` (A/B become sources with the infeed feature; also applied by the Fault Study) |
| `network.js` | Chain topology: positions (cumulative pu), relay geometry/direction, `activeTap()` (the line tap, feature `tap`), fault position (tap faults sit at T) (geometry is used for layout and assessment ground truth, not for measurement) |
| `solver.js`, `complex.js` | V2 phasor solver (`solveFault`): three-phase nodal analysis, optional prefault load (source angles; fault component = total − healthy network with same breakers, used for carrying / phase selection / live sources; memory = prefault V; `Zload`), (balanced elements from Z1/Z0), source SIR, 3Ø / A–G faults with Rf, breaker states → per-relay V/I, phase selection + loop measurement (ground loops with k0), memory-polarized direction, live sources, fault current. `faultSpec()` gates fault type/Rf by feature |
| `instruments.js` | Instrument layer between the solver and each relay: CT polarity, ratio-setting error, VT fuse as scenario entries (`instrumentFaults()` collects them); identity when ideal. Typical display base for the Bay tab (`BAY_BASE`: 138 kV, line A–B = 20 Ω) and `bayQuantities` (primary / secondary / relay-computed) |
| `waveforms.js` | Bay-tab oscillography: instantaneous waves synthesized from each event's phasors (`buildTrace`, `valueAt`), DC offset at inception (τ from the line X/R), poles interrupting at current zeros, 16 samples/cycle and a full-cycle DFT estimate (`dftAt`). Illustrative; display only, never feeds the engine |
| `protection.js` | MHO comparator, quadrilateral (`quadContains`/`quadPolygon`, `relayShape` gating), zone assertion on the measured Z + direction (`zoneAsserts`, forward + reverse), `activeZones()` (feature gating), static `assessRelay()` |
| `timeline.js` | Discrete-event fault-clearing engine (`simulateFault`): pickups, timers, trips, breakers, phasor re-solve after each opening, pilot schemes (keying, channel, DCB timer, DCUB unblock), 87L on A–B (feature `diff`), outcome verdict. Emits events, each with a full state snapshot |
| `study.js` | Fault Study runner (static assessment + pilot time-domain result) |
| `coordination.js` | Static setting checks drawn as red hatching (Z1 overreach, Z2 race < CTI, DCB reverse-reach gap) |
| `differential.js` | Line current differential (87L) on A–B: per-phase percentage differential from solver currents, charging current, CT error; `runDifferential` for the Differential tab |
| `busdiff.js` | Bus differential (87B) on bus B: `busZone()` (module + adjacent lines, B not a source), `busDiffElement()` (Σ I into the bus from line-side CTs, `bus:<rid>` instruments) |
| `consequences.js` | What a run cost: fault time vs critical clearing time, relative fault duty (∫I²dt) and arc energy (∫I dt) vs a fast clear, outage extent (`costsAt`, `outageExtent`) |
| `levels.js` | Learner levels (feature groups), track → level labels, per-browser level / welcome prefs |
| `lessons.js` | Lesson content (data) |
| `faults.js`, `units.js`, `colors.js` | F1–F6 suite; cycles/seconds display; per-relay colors |

Data flow: `useSimulation` (config + Fault Study) → `coordinationConfig(config)` → `useCoordination` (fault, failures, playback; lives in `App` so lessons can drive it) → `simulateFault` → events/snapshots → `CoordinationDiagram` (one-line + coverage lanes), `TimingChart` (logic-analyzer), `EventLog`, `PhasorPanel` (V/I per relay from `state.meas`; only with the `sir` feature on). The Bay tab (`BayView`, always on) shows one terminal of the same `useCoordination` run: `BayDiagram`, `RelayView`, `Oscillography`, `ChainView`; with 87B, also `BusDiffCard` and a bus view (`bus:B` in the terminal picker: `BusDiagram`, bus-mode `Oscillography`). Coordination is the default tab.

## Conventions

- **Units:** impedances in pu of base line AB; zone reach = % of the relay's *own* line; **all stored times in cycles** (`delayCycles`, `relayCycles`, `breakerCycles`, `ctiCycles`, pilot timers). Engine converts to seconds internally. Display unit (cycles/seconds) is a per-browser UI preference
- **Relay ids** `<own bus><far bus>` (`AB` = at A looking to B); breaker shares the id (`52-AB`)
- **Schema changes:** bump `version`, add a migration step, add a migration test
- **Progressive disclosure:** new features go behind `config.features.*` toggles in ⚙ Settings; gate them centrally (`activeZones`, `coordinationConfig`) rather than in each component. With a feature off the app must behave exactly as before
- **Engine invariants:** zone assertion stays separate from trip decisions (schemes sit between); every state change is logged as an event with a snapshot; a breaker-open event's snapshot is refreshed after the network re-solve; `events[0]` is the prefault event (t < 0), the fault is at t = 0 (find it by `kind === 'fault'`). With `loc = { kind: 'none' }` (Foundations) there is no power-system fault: that t = 0 event marks the instrument failure instead, and the verdict is `secure` or `misoperation`
- **Fault spec:** fault type + Rf (`{ type: '3PH' | 'AG', rf }`) travel separately from the location: `simulateFault(config, loc, scenario, spec)`, `runSimulation(…, spec)`, lesson `faultSpec`
- **Lessons:** every Coordination and Bay lesson declares `expect.verdict` (Bay lessons also `expect.measured`); tests run all lessons. If a lesson's text claims a "try this" outcome, add a spot-check test
- **Measurement:** relays see only what their instruments give them (the solver's V, I at their CT/VT, through `instruments.js`; `meas.prim` keeps the primary truth). Don't reintroduce geometric shortcuts for zone assertion; geometry (`fwd`) is for display text and the assessment's ground truth
- Line A–B is the fixed 1.0 pu base; F6 needs line BY, so the Fault Study always uses the full network

## Verifying changes

1. `npm test` in `app/` (Vitest, `app/src/lib/sim.test.js`, every lesson included)
2. `npm run build`
3. UI changes: screenshot with headless Chromium (Playwright); check desktop, phone (390×844) and ultrawide (3440×1440) when layout changes
4. Docs: SPEC § Status & backlog, and README (feature list, model notes and limits, lesson count; retake `docs/*.png` when the view they show changes)

## Run

```bash
cd app
npm install
npm run dev        # http://localhost:5173
npm test
npm run build      # → app/dist (static)
```

Machine-specific setup (source/test copies, remote access, git remote) lives in `CLAUDE.local.md` (git-ignored) when present.
Private planning context (audiences, internal decisions behind the public design) lives in `PLANNING.local.md` (git-ignored) when present. Keep audience/organization specifics out of SPEC.md and other tracked files: the repo is publicly readable.

## Deploy

GitHub Pages: `.github/workflows/pages.yml` (tests, build with `VITE_BASE=/line-protection-sim/`, deploy) → https://powerjc.github.io/line-protection-sim/. Keep asset paths relative to Vite's `base` (no hard-coded `/…` URLs). Docker (self-hosting): `docker-compose.yml` at the repo root, `app/Dockerfile` (Node build → unprivileged nginx serving `dist/` on 127.0.0.1:8080), `app/deploy/nginx.conf`. The target server runs nginx: the host nginx does TLS (certbot) and optional basic auth and proxies to the container (`app/deploy/nginx-host.conf.example`). Runbook and verification in SPEC.md § Deployment → Docker. `app/deploy.sh` (rsync `dist/`) is the no-Docker fallback. Never expose the Vite dev server publicly.
