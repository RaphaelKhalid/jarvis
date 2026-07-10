# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**SelfBalance Lab** — a zero-build, browser-based robotics *assembly* simulator. The user drags components onto a chassis, wires the pins, edits an Arduino PID sketch, and hits **Upload** to run a Rapier physics robot that balances on two wheels and drives with WASD. Everything is static files and ES modules; all deps load from CDN via the import map in `index.html`. There is no package.json, no build step, and no backend.

## Running

Serve the folder statically and open the printed URL (needs WebGL + WebAssembly):

```bash
npx serve .          # or: python -m http.server 8000
```

Verification: `npm test` runs the Playwright smoke suite (`tests/smoke.spec.js`) headlessly with software WebGL — run it before committing. `npm run lint` runs eslint. Manual verification is by loading the page and driving the sim. `window.__sim` is exposed in `main.js` as a debug hook onto the live `BalanceSim`. Deployed via Vercel (`.vercel/`).

## Architecture

Three phases share one Three.js scene. The `mode` flag (`'assembly'` | `'sim'`) that gates all pointer/keyboard handlers lives in `js/app/state.js` — a tiny pub/sub store (`state`, `set`, `subscribe`).

- **`js/main.js`** — thin orchestrator: creates scene/wiring/sim, initializes the app modules below, owns the editor callback, Upload → `enterSim()` / `exitSim()` transitions, chase-cam math, and the single `animate()` render loop (which calls `composer.render()`, not `renderer.render()`, and advances `floorUniforms.uTime`).
- **`js/app/state.js`** — observable store: `mode`, `booting`, `gains`. Write via `set()` so subscribers fire.
- **`js/app/assembly.js`** — parts tray, drag-to-slot placement, pin/wire raycasting + tooltips, drag-to-wire, auto-wire, clear board, tweezers cursor. Returns `{ group, placed, getPlacedCount, clearBoard }`.
- **`js/app/hud.js`** — tooltips, status flash, checklist, phase stepper, onboarding overlay, sound toggle, sim HUD + sparkline, mission HUD (`missionTick` is called from the render loop).
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
