# Decision log

One line per irreversible/architectural decision, dated. Newest first.

- 2026-07-12 — Roadmap M3 P0 (RobotDef seam): added `js/robots/` (RobotDef registry; self-balancer bundles the parts/slots/required/sketch globals + metadata; rover & line-follower declared `available:false`), `state.activeRobotId`, a robot picker popover off the top-bar chip, and bumped the save schema to v2 (`robotId`, v1→v2 migration). Data-level only — assembly/wiring still import globals directly, zero behavior change; sim.js body/controller extraction (keyed by `simKey`) deferred to M4 when the rover needs it.

- 2026-07-12 — Roadmap M1 (Lab-Instrument identity): committed amber-phosphor (#ffb000) as the signature accent replacing the generic blue #56a8ff (green reserved for connected/success, red for fault); added Space Grotesk display font (`--display`); tokenized button gradients + `--accent-soft`; added a top-bar shell (`js/app/topbar.js`, brand + robot chip + theme toggle) and reworked the onboarding modal into a Build→Program→Play title screen. See memory `visual-identity-decision`.

- 2026-07-11 — Roadmap M0 (foundation hygiene): resynced `CLAUDE.md` to the real module set; added `tests/docs.spec.js` doc-drift guard (every `js/` module must be named in CLAUDE.md — docs are now part of DoD); added dev-only perf HUD `js/app/perf.js` (`?perf`/Alt+P). Follows the 2026-07-11 market/UX/architecture deep dive (5 Notion briefs).

- 2026-07-10 — `_diag.mjs` kept (not deleted): it is the headless Playwright verification harness; Phase 1B formalizes it into `tests/`.
- 2026-07-10 — Master roadmap adopted (`docs/MASTER_PLAN.md`): vanilla web + design tokens (no React), Supabase backend, Capacitor for iOS, RevenueCat for unified entitlements.
- 2026-07-09 — Unity port abandoned; web app is the single active codebase.
