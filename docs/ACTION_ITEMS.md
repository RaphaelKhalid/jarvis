# Action items — assets, fidelity, and codebase

From three research streams run 2026-08-03 (browser learning sims / professional robotics + electronics simulators / web 3D asset pipelines) plus a direct audit of the repo. Every item names a specific tool, API or file. Effort is in engineer-hours.

Sources are cited inline; the full research memos are summarized here rather than duplicated.

---

## The one-paragraph diagnosis

**The room is a photograph and the parts on it are programmer art.** We ship 52 MB of uncompressed decorative assets — potted plants, a laptop, cable bundles — while all 16 electronic components, the things the user actually manipulates, are flat-shaded `CylinderGeometry` and `BoxGeometry` with `roughness ≥ 0.6, metalness: 0`. At those material values they **cannot reflect the HDRI environment we already load**, which is precisely why they read as CG. The cheapest large win in this document is not new models: it's giving the existing procedural parts materials that can see the light we already paid for.

The second diagnosis: **we are the only product in the category with 3D + mechanical physics driven by a real circuit solve, and the only one with an LLM that mutates the build rather than the code.** Nobody has shipped the latter — Arduino Cloud's Claude assistant writes sketches, not wiring. That is the white space. The gaps against the field are part count (16 vs. Tinkercad ~40 / Wokwi 120+), touch input, and the dormant classroom layer.

---

## A. Visual fidelity — do these first (10 h, no new assets, no pipeline)

| # | Action | Where | Hrs |
|---|---|---|---|
| A1 | **Make part materials respond to the environment.** Non-metals to `roughness 0.35–0.5`, metal leads/pins to `metalness 0.9, roughness 0.25`, and set `envMapIntensity`. This is the single highest-impact change in the document — the parts currently can't see `scene.environment`. | `creator-assembly.js` FACTORY | 2 |
| A2 | **One shared CC0 grunge `roughnessMap` + subtle `normalMap`** across all part plastics via a `partMaterial()` helper. Constant roughness is *the* CG tell; ~50 KB breaks it. | new helper in `room-assets.js`, ambientCG | 3 |
| A3 | **Contact-shadow blobs under each placed part**, scaled to footprint, opacity by height. "Part sits on the desk" is the strongest grounding cue there is; a `CanvasTexture` radial gradient is enough — skip SSAO/N8AO entirely on iPad. | `creator-assembly.js` | 2 |
| A4 | **Bump procedural cylinder segments 8/16 → 24–32 and add micro-bevels.** Silhouettes are where low-poly reads as cheap. | FACTORY | 3 |
| A5 | **Clearcoat pass on LED lenses** (`MeshPhysicalMaterial`, `clearcoat: 1`, `clearcoatRoughness: 0.15`, `transmission` on the dome only — one or two objects max, it's expensive). Keep `emissive` so bloom still works. | FACTORY | 2 |

## B. Asset pipeline — 52 MB → ~12 MB

The measured first-visit payload today is roughly **42 MB** of room assets: 17.5 MB of PBR texture sets, 23 MB of glTF props, 1.6 MB HDRI. It is deferred behind `whenIdle()`, which is the right instinct, but on shared school wifi (~5 Mbps) it is still minutes. **This is a hard dependency of the "does it survive a school network" kill-criterion in `YC_APPLICATION.md`.**

| # | Action | Tool | Hrs |
|---|---|---|---|
| B1 | Stand up `npm run assets` → `gltf-transform optimize --compress meshopt --texture-compress ktx2 --texture-size 1024`, outputs committed. **This stays a dev-time CLI, not a build step** — zero-build is preserved. | `@gltf-transform/cli` | 3 |
| B2 | Wire the two runtime decoders into the shared loader: `MeshoptDecoder` (an ES module, goes straight in the import map) and `KTX2Loader.setTranscoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/basis/')`. Both resolve through the existing `three/addons/` entry — no bundler. | `room-assets.js` | 2 |
| B3 | Re-encode the 8 Poly Haven props + confirm the HDRI is 1K everywhere. Verify 52 MB → ~12 MB. | pipeline from B1 | 2 |
| B4 | **Add a Playwright perf assertion on total transferred bytes and time-to-interactive.** Without this the budget silently regresses the first time someone adds a prop. | `tests/`, `perf.js` | 3 |

**Why meshopt over Draco:** Draco is ~10% smaller but decodes slower and only handles geometry; the meshopt decoder is ~25 KB of WASM, near-instant, and also does quantization. Draco only wins on high-poly organic meshes — we have none.

**Why KTX2 matters more than the byte count suggests:** it's a *VRAM* win. A 4K JPEG costs ~89 MB decoded; UASTC→ASTC costs ~22 MB. On an A13 iPad with ~2 GB usable that is the difference between smooth and being killed by jetsam.

## C. Component models — buy/download vs. keep procedural

**Recommendation: keep most parts procedural and upgrade their materials (§A). Only model the parts that *are* their texture.**

- **Keep procedural** — resistor, LED, diode, fuse, capacitor, photoresistor, thermistor, leads/pins. These genuinely are cylinders and domes; modeling buys ~5%, §A buys 90%.
- **Model or source** — microcontroller boards, breadboards, servos, relays, potentiometers, buzzers, push buttons. Silkscreen text, headers and irregular housings can't be faked procedurally.
- **Already fine** — battery and motor (hand-detailed in `parts.js`).

### Licensing — this ships in a paid education product, so this matters

| Source | Verdict |
|---|---|
| **Sketchfab CC0 electronics sets** | ✅ **Start here.** CC0, game-ready topology, already textured. Highest value per hour. |
| **SnapEDA / SnapMagic** | ✅ CC-BY-SA 4.0 + Design Exception 1.0 — commercial use OK, explicitly permits conveying the combined design under our own terms. Attribution in `CREDITS.md`. Cleanest path to manufacturer-accurate parts. |
| **KiCad packages3D** | ⚠️ Best geometry, but CC-BY-SA + library exception is grey when redistributing a *collection*. Individually-picked models are defensible. Needs STEP→mesh + heavy decimation (a STEP resistor tessellates to 50k+ tris). |
| **GrabCAD** | ❌ **Do not use.** Non-commercial by default; commercial use needs written permission per uploader. |
| **TraceParts / Ultra Librarian / DigiKey / Mouser** | ❌ Rights are account-bound to the exporting customer, no downstream redistribution grant. Visual reference only. |

| # | Action | Hrs |
|---|---|---|
| C1 | Download and vet the CC0 Sketchfab electronics set; extract resistor/cap/LED/breadboard as a quality bar | 2 |
| C2 | Add a per-type glTF override to the FACTORY table so modeled and procedural parts coexist (this is what the deleted `assets.js` `MODEL_OVERRIDES` was for — reinstate the idea, better placed) | 3 |
| C3 | Source servo, relay, potentiometer, buzzer, push button from SnapMagic; STEP→glTF via Blender | 6 |
| C4 | A microcontroller board + breadboard with real silkscreen texture — highest visual payoff for a robotics app | 6 |
| C5 | Extend `assets/CREDITS.md` with a license-provenance column and the SnapEDA/KiCad exception text | 1 |
| C6 | Target **≤80 KB and ≤3k tris per component** — 40 parts ≈ 3 MB | — |

## D. Interaction — the first-time-user gap

These come straight from the competitive teardown and map onto the `circuit_ok` activation metric. Ranked by impact-on-activation / cost.

| # | Action | Hrs |
|---|---|---|
| D1 | **PhET-style "Interactive Highlights" for pins** — a persistent high-contrast halo on every *valid* target the moment a wire drag starts, dimming everything invalid. Directly answers "which pin goes where," which is our known wall. ~30 lines. | 3 |
| D2 | **Screen-space magnetic snap with a radius that grows during the drag**, applied to the drag path and not just the click. Fixes tablets almost for free. | 4 |
| D3 | **Make Falstad's animated charge dots the loudest thing on screen** + per-wire voltage tint. We already compute current-scaled flow; Falstad's animation is the most-recognized teaching visual in the category and we own the solve. | 3 |
| D4 | **Live knob during RUN** — promote potentiometer scroll to a visible 3D knob with a value ring, finger-draggable while current animates. EveryCircuit's signature "oh, it's real" moment. | 4 |
| D5 | **Category tray + search.** Wokwi has 9 named categories. Do this *before* the library passes ~20 parts, not after. | 3 |
| D6 | **Violation event log** — a scrolling history of solver violations, not just current state. "You shorted it three seconds ago" is where the learning happens. | 3 |
| D7 | **Schematic ⇄ 3D toggle** from the same document (PhET does this). Teachers need schematic literacy, students need the 3D. | 8 |
| D8 | **`?embed=1` chromeless mode** for LMS/Google Sites iframes. Cheapest classroom feature that exists — no accounts needed. (CircuitVerse's growth channel.) | 2 |
| D9 | **Expose RobotDoc as pasteable text**, the way Wokwi exposes `diagram.json`. Makes Jarvis auditable, enables copy-paste sharing, lets other LLMs author builds. | 3 |

## E. Simulation credibility

| # | Action | Hrs |
|---|---|---|
| E1 | **Deterministic RUN sim + snapshot-hash CI test.** Rapier's JS/WASM build is *already* cross-platform deterministic (bit-level with `enhanced-determinism`), and the documented idiom is `world.createSnapshot()` → hash → compare. Highest credibility-per-hour available. Prereqs are all ours: pin the Rapier version in the import map (it currently floats), iterate the doc in stable sorted order in `sync()`, and step a fixed dt rather than `performance.now()` deltas. | 8 |
| E2 | **`api.step(n)` as the universal clock** — enables headless CI, pause/step, and a scrubbable timeline. Also collapses several poll-and-hope Playwright specs into one deterministic assertion. | 4 |
| E3 | **Seeded RNG** (`mulberry32` from `doc.sim.seed`); grep out every `Math.random()`. Trivial now, impossible to retrofit. | 2 |
| E4 | **Transient MNA — capacitors and inductors** via companion models (backward-Euler: a capacitor becomes conductance `C/h` in parallel with a current source), reusing the Newton loop the diode already needs. Unlocks RC blink timing, motor spin-up, debounce. **Highest pedagogical payoff per line in this document.** Add `dt` to the assembler defaulting to `Infinity` so today's DC solve — and every existing test — is reproduced exactly. | 24 |
| E5 | **Firmware execution via AVR8js** (MIT, the engine behind Wokwi). Pure JS, no WASM, cycle-accurate ATmega328p with GPIO/timers/ADC. The co-simulation pattern is exactly ours: GPIO pins become voltage sources in the net, ADC pins read back solved node voltages. Closes the app's biggest honesty gap. **Do E4 first** — PWM and timers are meaningless without continuous time. Spike the pin↔net bridge with a hardcoded `.hex` before touching compilation. | 80–120 |
| E6 | **Motor armature + gear-ratio params** folded into `motorTorque()`. Armature is the single parameter that stops small motors feeling twitchy. | 4 |
| E7 | **Gaussian sensor-noise wrapper** on telemetry, off by default. 30 lines, and it answers "why does my PID jitter?" | 2 |
| E8 | **Explicit units in the document** — `meta.units`, asserted in `patch.js`. Right now `1 unit = 1 cm` lives only in a comment, which is exactly how hand-rolled formats drift. | 2 |
| E9 | **MJCF-style default classes in `library.js`** so "all resistors" is one edit rather than an N-way edit as builds grow. | 6 |
| E10 | **ngspice-WASM as an offline test oracle** — a Node script that emits netlists from fixture docs and diffs our node voltages against ngspice. Credibility reference, *not* a runtime. | 8 |

## F. Codebase health

| # | Action | Hrs |
|---|---|---|
| F1 | **Split `creator-assembly.js` (1,151 lines, 11% of all JS).** It owns the tray, geometry factories, raycasting, wiring, the bench physics world, and the animation loop. Natural seams: `parts-factory.js` (FACTORY/CARD), `bench-physics.js` (the Rapier world), `wiring-view.js`. | 8 |
| F2 | **Pin the CDN import map to exact versions** and consider vendoring to a self-hosted `/vendor`. Today one CDN outage is total downtime, with no integrity pinning — and version float is also the enemy of E1's determinism. | 4 |
| F3 | **Move the Jarvis quota gate server-side** into `api/jarvis.js`. It's localStorage today: clearing storage bypasses it, and one motivated classroom exhausts the shared Gemini key for everyone. | 4 |
| F4 | **Memoize the circuit solve on `doc.meta.revision`.** The Inspector polls every 400 ms and re-runs an O(n³) dense solve each time. | 2 |
| F5 | ~~Emit a violation on singular pivots and diode non-convergence~~ — **done 2026-08-03** (`190412c`). | ✅ |
| F6 | ~~Delete assets orphaned by the pre-pivot removal~~ — **done 2026-08-03**, 7.5 MB. | ✅ |
| F7 | Provider abstraction behind Jarvis. `TOOL_SCHEMAS` is already Anthropic-shaped with `geminiFunctionDeclarations()` as a derived view, so a second backend is a small file — worth having before the Gemini free tier becomes load-bearing. | 6 |

## G. Deliberately NOT doing

1. **No SPICE/AC at runtime.** ngspice-WASM works in-browser but it's a multi-MB blob and a *batch* netlist-in/CSV-out tool — not a 60 Hz co-simulation partner for Rapier. It would destroy the zero-build story and make the product worse. Use it offline as a test oracle (E10) instead.
2. **No photoreal virtual breadboard.** Tinkercad's breadboard is its single biggest source of student failure (off-by-one rails, invisible internal connections) and it would obliterate 3D hit targets on touch. Our pin-to-pin abstraction is a feature — market it as one.
3. **No USD/Omniverse, Isaac Lab, MuJoCo-WASM, RL pipelines, domain randomization, or closed-loop kinematics.** Overkill for a classroom product.
4. **No multi-threaded WASM.** It needs SharedArrayBuffer + COOP/COEP headers, which break the CDN import map.
5. **No URDF as a native format** — JARVIS's document is a circuit plus a placement bench; URDF has no concept of a net, a resistance or a diode, and adopting it natively would be cargo-culting credibility. *Import* via `urdf-loader` (Apache-2.0, Three.js-native) is worth it later purely as chassis content. Export is worth nothing: nobody would consume a JARVIS URDF.
6. **Don't chase Wokwi on breadth of firmware targets.** They have a multi-year head start on AVR/ESP32/RP2040 accuracy. One well-integrated ATmega328p that talks to our solver beats five half-emulated cores.

---

## Suggested order

1. **§A entirely (10 h).** Biggest visible quality jump per hour in the document, needs no new assets and no pipeline.
2. **B1–B4 (10 h).** Unblocks the school-network kill-criterion, and B4 stops it regressing.
3. **D1–D3 (10 h).** Directly targets the `circuit_ok` activation metric the funnel now measures.
4. **E1–E3 (14 h).** Determinism is the cheapest credibility we can buy, and it makes the whole test suite faster and less flaky.
5. **E4 (24 h).** Transient analysis — the best pedagogy-per-line on the list.
6. **F1–F4**, opportunistically alongside the above.
7. **E5 (80–120 h)** only once there is evidence of teacher demand for it. It's the honest fix for "the sketch isn't executed," but it is a quarter of work and it competes with the differentiator.
