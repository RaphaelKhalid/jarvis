# Pivot kickoff prompt (Milestone 1)

> Copy everything below into a fresh Claude Code session in this repo.

---

We are pivoting this repo. Read `CLAUDE.md` first, then this whole prompt before editing anything.

## New product vision

GYRO becomes a **browser robotics creator space**, not a lesson app. Users drag components into a 3D workspace, wire them with a **real simulated electrical model**, program them, and test them in physics. The headline feature is **Jarvis**: describe a robot in natural language and it gets scaffolded, wired, and programmed in the 3D space — and it can also explain, debug, and tune what you built. The fixed-robot, guided-curriculum product is over.

**Do not build Jarvis in this milestone.** Build the foundation it stands on.

## Milestone 1 — thin end-to-end vertical slice

**A battery, wired to a motor, spins the motor in 3D.** No MCU, no sketch, no PID. That's the whole milestone, but it must be genuinely end-to-end: document → electrical solve → physics → render → save/load → share URL → tests.

Concretely, a user can: drag a battery and a DC motor into the workspace; drag a wire from `bat1.+` to `motor1.A` and `bat1.-` to `motor1.B`; press Run; watch the motor shaft spin at a speed determined by the solved circuit; open the wire-less version and see it not spin; reload the page and get their build back.

Acceptance criteria:
- Circuit solver computes current through a closed battery→motor loop from real values (battery EMF + internal resistance, motor winding resistance, back-EMF). Not a lookup table.
- Motor angular velocity in the Rapier/Three scene is driven by solved torque. Open circuit → ω = 0. Reversed polarity → reverse spin. Short circuit → flagged as a violation, motor does not spin, user sees a diagnostic.
- `RobotDoc` v2 round-trips through localStorage and `#build=`.

## API-first ordering — non-negotiable

Build in this order. Do not write UI before the API it calls exists and is tested.

1. `js/model/doc.js` — the `RobotDoc` v2 schema (`components[] / nets[] / code? / sim / meta`), plus `validate(doc): Diag[]` and pure patch application.
2. `js/model/patch.js` — `Patch` type, `apply(doc, patches)`, transactional `undo`/`redo` stack. **Every mutation in the app goes through this. No exceptions.**
3. `js/sim/circuit.js` — DC nodal solver (MNA) over the net list. Returns per-net voltage, per-component current, and violations (short, open, floating pin, over-current).
4. `js/api/index.js` — the scriptable API: `place_component`, `remove_component`, `connect`, `disconnect`, `set_param`, `run_sim`, `stop_sim`, `reset_sim`, `undo`, `redo`, `get_document`, `read_telemetry`, `read_electrical`, `validate`. Every mutating function takes `{dryRun}` and returns `{ok, changed, errors}`. JSDoc-typed. Expose as `window.__api` for tests.
5. Physics binding — motor ω from solved torque, in `js/sim/`.
6. **Only then** the UI: rewire drag/drop, wiring, and the Run button to call `window.__api`. The DOM layer must contain zero mutation logic.

Milestone 2 (do not start) is `/api/jarvis` on Vercel Edge, streaming Claude with these tools as its tool schema. Design every signature so a JSON-schema tool definition is a mechanical transformation of it.

### RobotDoc v2 shape

```jsonc
{
  "v": 2, "robotId": "self-balancer", "name": "My bot",
  "components": [
    { "id": "bat1", "type": "battery",
      "params": {"voltsNominal": 7.4, "capacityMah": 800, "internalResistance": 0.4},
      "transform": {"pos":[0,1,0], "rot":[0,0,0]}, "slot": "deck-a" }
  ],
  "nets": [ { "id": "n1", "endpoints": ["bat1.+","motor1.A"], "color": "#e33" } ],
  "code": { "sketch": "...", "target": "arduino-uno" },
  "sim": { "gravity": -9.81, "seed": 42 },
  "meta": { "createdBy": "user", "revision": 17 }
}
```

Endpoint ids stay `"compId.pin"`. Nets are derived by union-find over wire edges.

### Motor/physics coupling

Motor = `R_a` + `L_a` in series with a back-EMF source `V = Ke·ω`, where ω is read from the Rapier joint at the start of the step. Solve circuit → armature current `i` → torque `τ = Kt·i − friction·sign(ω)` applied to the Rapier revolute motor as **torque, not target velocity** → Rapier integrates → new ω feeds the next electrical step. Run N≈8 electrical substeps per 1/60 physics step. Battery = ideal source + `R_int`, so sag falls out of `V_term = V_oc − i·R_int`.

## Files: keep, refactor, delete

**Delete** (a real deletion, not a feature flag):
- `js/curriculum/` entirely — `engine.js`, `lessons.js`
- `js/missions.js`
- `js/app/guide.js` (the Guide rail, incl. its lesson-browser hosts)
- `tests/curriculum.spec.js`
- All lesson/track/star/badge/progress code paths in `js/app/save.js`, `js/app/cloud.js` (`kind:'progress'`), `js/app/hud.js` (checklist, mission HUD), and `js/app/classroom.js` (drop the per-student lesson-progress roster; **keep the class/roster shell and the Supabase schema dormant** — teams/edu is the intended payer).
- Free/Pro lesson gating in `main.js` (`setTier` wiring). Keep the `profiles.tier` read; it'll gate Jarvis quota later.

**Keep, unchanged:**
- `js/glossary.js` and all hover **tooltips** — this is the explanation layer Jarvis will extend. Tooltips stay.
- `js/scene.js`, `js/labels.js`, `js/assets.js`, `js/audio.js`, `js/app/topbar.js`, `js/app/touch.js`, `js/app/perf.js`, `js/app/quality.js`, `js/app/errors.js`, `js/app/analytics.js`, `js/app/input.js`, `js/app/account.js`, `js/app/cloud.js` (auth + `kind:'save'` sync only).

**Refactor:**
- `js/parts.js` → factories gain **electrical descriptors**: each pin gets a role (`power+`, `power-`, `signal`, `gnd`); each component gets electrical params (`resistance`, `emf`, `kv`, `internalResistance`). Geometry stays.
- `js/wiring.js` → strip `REQUIRED` (there is no correct answer anymore). `WiringManager` becomes a *view* over `doc.nets`; it renders and raycasts, it does not own state.
- `js/app/assembly.js` → drag/drop calls `api.place_component`; pin-click calls `api.connect`. Delete slot-`REQUIRED` coupling. Free placement, with slot snapping as an optional convenience.
- `js/sim.js` → split. Arena/terrain/camera/telemetry stay; the hard-coded balance PID and `RoverSim` pendulum logic move behind the sim-body registry and are **not** used in M1.
- `js/robots/` → a "robot" is now just a starting `RobotDoc`, not a hard-coded def. Reduce to seed documents + `sim-registry.js`.
- `js/app/save.js` → v1→v2 migration (a v1 save loads as a v2 doc), `shareUrl()` encodes v2.
- `js/editor.js` → keep CodeMirror, inert in M1 (no MCU in the slice). Do not delete.

## Verification

- `npm run lint` clean.
- `npm test` green. Rewrite `tests/smoke.spec.js` and `tests/persistence.spec.js` against `window.__api`; delete `tests/curriculum.spec.js`.
- New `tests/circuit.spec.js`: open loop → 0 A; closed loop → expected current within tolerance; reversed polarity → negative current; short → violation raised, no spin.
- New `tests/api.spec.js`: every API function callable via `window.__api`; `dryRun` mutates nothing; `undo` after a multi-patch transaction restores the exact prior document (deep-equal); invalid `connect` returns `{ok:false}` and leaves the doc untouched.
- New `tests/vertical-slice.spec.js`: place battery + motor via the API, connect, run, poll until motor ω > 0 (poll — headless WebGL is slower than real time), reload, assert the build restored.
- Commit on a new branch off `master`. Do not push.

Ask me before starting if anything in the delete list is load-bearing in a way this prompt doesn't account for.
