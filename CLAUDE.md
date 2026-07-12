# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**SelfBalance Lab** (product brand: **GYRO**) — a zero-build, browser-based robotics *assembly* simulator. The user drags components onto a chassis, wires the pins, edits an Arduino PID sketch, and hits **Upload** to run a Rapier physics robot that balances on two wheels and drives with WASD. Everything is static files and ES modules; all deps load from CDN via the import map in `index.html`. There is no build step and no backend running by default. (`package.json`/`node_modules` exist only for dev tooling — Playwright, ESLint, the `serve` script — not for the app itself, which still runs via `npx serve .`.)

It has grown **education-first**: an always-visible **Guide rail** (`js/app/guide.js`) walks new users through Assemble → Wire → Program → Run, and a **curriculum engine** (`js/curriculum/`) hosts ~20 data-driven lessons across four tracks. Assembly state and lesson progress persist to `localStorage` (`js/app/save.js`), with a Supabase cloud-sync scaffold ready but inactive (`js/app/cloud.js`). The broader product roadmap lives in `docs/MASTER_PLAN.md` (phase statuses inline); a 2026-07-11 market/UX/architecture deep dive lives in Notion and re-prioritizes it (fix this doc-drift first, elevate multi-robot support, add shareable build URLs).

## Running

Serve the folder statically and open the printed URL (needs WebGL + WebAssembly):

```bash
npx serve .          # or: python -m http.server 8000
```

Verification: `npm test` runs the Playwright suite (`tests/smoke.spec.js`, `tests/persistence.spec.js`, `tests/curriculum.spec.js`) headlessly with software WebGL — run it before committing. `npm run lint` runs eslint. Manual verification is by loading the page and driving the sim. Two debug hooks are exposed in `main.js`: `window.__sim` (the live `BalanceSim`) and `window.__lab` (`{ assemblyApi, wiring, curriculum, hud }`) — tests drive both. Headless WebGL runs slower than real time, so tests must poll state, not use fixed waits. Deployed via Vercel (`.vercel/`).

## Architecture

Three phases share one Three.js scene. The `mode` flag (`'assembly'` | `'sim'`) that gates all pointer/keyboard handlers lives in `js/app/state.js` — a tiny pub/sub store (`state`, `set`, `subscribe`).

- **`js/main.js`** — thin orchestrator: creates scene/wiring/sim, initializes the app modules below, owns the editor callback, Upload → `enterSim()` / `exitSim()` transitions, chase-cam math, and the single `animate()` render loop (which calls `composer.render()`, not `renderer.render()`, and advances `floorUniforms.uTime`).
- **`js/app/state.js`** — observable store: `mode`, `booting`, `gains`. Write via `set()` so subscribers fire.
- **`js/app/assembly.js`** — parts tray, drag-to-slot placement, pin/wire raycasting + tooltips, drag-to-wire, auto-wire, clear board, tweezers cursor. Returns `{ group, placed, getPlacedCount, clearBoard }`.
- **`js/app/hud.js`** — tooltips, status flash, checklist, sound toggle, sim HUD + sparkline, mission HUD (`missionTick`/`simReadouts` are called from the render loop). **Note:** the old top phase-stepper + full-screen onboarding overlay were superseded by the always-on Guide rail (`guide.js`); `#overlay` in `index.html` is now just a first-visit welcome that hands off to the rail.
- **`js/app/guide.js`** — the always-visible, education-first **Guide rail** docked in the workspace (`initGuide`). Walks the four phases (Assemble → Wire → Program → Run), advancing automatically by observing real app state (placed count, `wiring.allRequiredDone()`, `state.mode`), and hosts the curriculum lesson browser + active-lesson card inline in the same panel. Collapsible; polls itself every 600ms to keep the live checklist honest.
- **`js/app/save.js`** — versioned (`schemaVersion` via `v: 1`) save/load of assembly state (per-type part counts, wire endpoint-id pairs, sketch text) to `localStorage`, debounced. Forward-compatible by design (ignore unknown keys, version-gated migrations) — this same payload is the future cloud-sync document. Shows a "resume / start fresh" bar when a meaningful save exists.
- **`js/app/cloud.js`** — Supabase cloud-sync scaffold, **inactive until keys are filled in** (`SUPABASE_URL`/`SUPABASE_ANON_KEY` blank; `cloudEnabled()` gates everything). Local-first: `localStorage` stays source of truth; `pushDocument`/`pullDocument` are last-write-wins per `kind` (`'save'`|`'progress'`). Enabling it needs a user-created Supabase project + `supabase/schema.sql` (has RLS).
- **`js/app/touch.js`** — touch driving controls (left-thumb virtual stick + JUMP button), only mounted on coarse-pointer devices, only visible in sim mode. Feeds the same `sim.input` channels as the keyboard.
- **`js/curriculum/engine.js`** — `initCurriculum`: interprets lesson data, applies each lesson's `setup`, evaluates objective predicates every frame (`tick`), awards stars, and persists progress to `localStorage` (`sbl-progress-v1`). Objective types: `place`, `placeAll`, `wire`, `wireAll`, `gain`, `sim`, `upright`, `speed`, `reach`, `material`, `airborne`, `fallen`, `recover`, `turns`, `jumps`, `odometer`. Renders into the Guide rail's hosts.
- **`js/curriculum/lessons.js`** — lesson content (data only): `TRACKS` (Circuits, Balance & PID, Driving, Engineering) and `LESSONS` (~20). Each lesson = `{ id, track, title, brief, setup, objectives, debrief, par }`. Add lessons here; the engine interprets them.
- **`js/serial.js`** — the Serial Monitor: a scripted power-on bring-up sequence on Upload, then a throttled live telemetry stream (tilt, P/I/D terms, PWM) while driving. Purely visual.
- **`js/audio.js`** — synthesized WebAudio sound design (oscillators + envelopes, no samples — CSP-safe). Singleton `audio`; must be `resume()`d from a user gesture. UI cues (`place`, `connect`, `error`, `boot`, `ui`) plus a continuous motor hum whose pitch/volume follow wheel speed. Mute persists to `localStorage`.
- **`js/missions.js`** — `makeMissions()`: optional driving-mode objectives (Free Drive, Stay Upright, Shake It Off, Distance Run). Each has an `update(sim, dt, ctx)` returning `{ progress, status, label }`; the sim-mode mission HUD in `hud.js` runs them.
- **`js/app/topbar.js`** — the top-bar shell (`initTopbar`): brand mark, active-robot chip (opens the robot picker; reflects build/drive via `state.mode` and the active robot's name), and a light/dark theme toggle (`data-theme` on `<html>`, persisted to `localStorage`). Part of the Lab-Instrument identity (`--display` font, amber accent).
- **`js/robots/`** — the **RobotDef** layer (M3 multi-robot seam). `self-balancer.js` bundles what were module globals (`PART_DEFS`, `SLOTS`, `REQUIRED`, `DEFAULT_SKETCH`) plus metadata (`id`, `name`, `blurb`, `difficulty`, `available`, `simKey`) into one def; `index.js` is the `ROBOTS` registry (`getRobot(id)`, `activeRobot()` resolved from `state.activeRobotId`) and also declares the not-yet-built `rover`/`line-follower` (`available:false`). **M3 is data-level only** — assembly/wiring still import the globals directly, so behavior is unchanged; M4 switches them onto `activeRobot()` and moves the sim body/controller (keyed by `simKey`) behind the def. Adding a robot = adding a def here.
- **`js/app/robotpicker.js`** — the robot picker popover (`initRobotPicker`), opened from the top-bar chip. Lists `ROBOTS` (self-balancer buildable; rover/line-follower "Coming soon"); selecting an available robot sets `state.activeRobotId`. The content-library surface that signals breadth.
- **`js/app/perf.js`** — dev-only performance HUD
- **`js/app/perf.js`** — dev-only performance HUD (`initPerf`), off by default; enable with `?perf` in the URL or Alt+P. Runs its own rAF loop to measure true FPS + worst frame-time without touching the render loop, and shows boot/Rapier-WASM load times. `window.__perf.mark(label)` records one-shot timings (main.js marks `'rapier'`). Establishes the MASTER_PLAN perf baseline (target: 60fps on a 9th-gen iPad).
- **`js/app/input.js`** — keyboard/pointer driving input behind a named-axis abstraction (`input.axis('drive'|'steer')`) so touch/gamepad schemes can plug in later; also owns chase-cam orbit state (`input.cam`).
- **`js/scene.js`** — `createScene(canvas)` returns `{ renderer, scene, camera, controls, slotMeshes, resize, composer, floorUniforms, assemblyDecor }`. Owns lights, the chassis plate, slot ghost planes, `RoomEnvironment` reflections, the `EffectComposer` bloom pipeline, and a custom `ShaderMaterial` energy-grid floor (`floorUniforms.uTime` is animated by main). `assemblyDecor` is the list of assembly-only meshes (grid, shader floor, chassis plate) that main hides while the sim arena is on screen. **Emissive materials glow because of the `UnrealBloomPass`** — that's why accents use `emissive`/`emissiveIntensity`.
- **`js/parts.js`** — `PART_DEFS` (tray registry), `SLOTS` (chassis mount points), and one `make*()` factory per component. Every factory returns a `THREE.Group` whose `userData` is `{ type, label, pins: [{ name, obj }] }`. Motors are special-cased: `makeMotor(side)` builds a left/right variant, and the single `motor` tray card (count 2) fills both `motorL`/`motorR` slots. **1 unit = 1 cm.**
- **`js/wiring.js`** — `WiringManager` (click-a-pin-then-click-target), plus the `REQUIRED` array that is the single source of truth for valid connections, wire colors, the checklist, and Upload gating. Endpoints are keyed `"compType.pin"` (e.g. `arduino.A4`). Wires are 3D bezier `TubeGeometry`. Adding/removing a connection requirement = editing `REQUIRED`.
- **`js/editor.js`** — CodeMirror 5 (loaded as classic `window.CodeMirror` globals in `index.html`, *not* via the import map). `DEFAULT_SKETCH` is the Arduino source; `parseGains()` regex-scrapes `Kp`/`Ki`/`Kd` live on every edit and pushes them into the sim. The sketch is display/parse only — it is **not** executed; the real controller is the JS PID in `sim.js`.
- **`js/sim.js`** — `BalanceSim` + `loadRapier()` (dynamic import of `rapier3d-compat` from CDN, so Upload is the first WASM load). This is the physics: builds the walled arena + trimesh hilly terrain, chassis-as-inverted-pendulum with two revolute-jointed wheels, and a fixed-timestep (`1/60`) control loop.
- **`js/labels.js`** — canvas-texture flat text labels used by parts.
- **`js/glossary.js`** — plain-language `COMPONENTS`/`PINS` dictionaries keyed by `type` and `"compType.pin"`. Drives the hover tooltips that explain what each part and pin (e.g. `IN2`) does. Add a pin here when you add one to `parts.js`.
- **`js/assets.js`** — optional custom-model workflow. `MODEL_OVERRIDES` (empty by default) maps a part `type` to a GLTF in `assets/models/`; `loadModelPart()` loads + caches it. Parts without an override stay procedural, so models can be migrated one at a time. Visual-only — pins/labels are still added by `parts.js`.

### Control loop (sim.js `fixedStep`)

Two nested controllers, the important design point:
1. **Inner PID** keeps the bot upright about a *commanded lean* setpoint, using the parsed `Kp/Ki/Kd`. Well-tuned reference gains: `Kp 15, Ki 140, Kd 0.9`.
2. **Outer behavior** sets that lean: when idle it's a station-hold that returns the bot home; when WASD-driving, a small feed-forward lean plus a **wheel-speed servo** that torques the wheels to a target ω, and a **yaw heading-hold PD** so it tracks straight. Tuning constants are the `const`s at the top of `sim.js` (`TORQUE_SCALE`, `CRUISE_SPEED`, `DRIVE_KV`, etc.) — the physics is deliberately sized so the reference gains balance; changing those constants will require re-tuning the "good" gains.

Tilt is measured by `currentTilt()` as a signed, yaw-independent pitch that stays monotonic through a fall. `step(realDt)` accumulates real time and runs up to 5 fixed sub-steps.

## Conventions

- Vanilla ES modules only — no framework, no bundler. Keep new deps on the CDN import map.
- Coordinates: +Z is "forward" for the robot; chassis rotations lock roll (`enabledRotations(pitch, yaw, false)`).
- When touching materials, remember the bloom pass: brightness of glows is driven by `emissiveIntensity`, and the whole scene renders through `composer`.

## Related (from persistent memory, not in this repo)

This web app is the single active codebase. A Unity port was explored and **abandoned (2026-07-09)**; branded "GYRO" asset pipelines are tracked separately — see the user's memory index if a task references them.
