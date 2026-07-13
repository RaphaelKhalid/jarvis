# GYRO Round-Table Review #2 — after Phase A + B

> **Date:** 2026-07-13. Three role reviewers (SWE, PM, Designer) re-ran against the
> live codebase after Phase A (`364b78c`) and Phase B (`cfaf9de`) landed, to decide
> whether to begin Phase C (consumer monetization: Supabase accounts + entitlement
> + Vite). Follow-up to [roundtable-review.md](roundtable-review.md).

## Verdict: **GO on Phase C — but reorder it, and do two cheap things first**

All three agreed Phase A/B was a faithful implementation of the first review's plan.
Scorecard vs. the first review's per-lens top-5:

| Lens | Fully done | Partial | Deferred (correctly) |
|---|---|---|---|
| **SWE** | resilience/error boundary, SEO/PWA, quality tier | analytics (funnel bug, see below) | cloud/accounts (= Phase C) |
| **PM** | (hygiene pre-conditions) | first-run activation (instrumented, not *measured*) | paywall, `/teach`, rover lessons, share URLs |
| **Designer** | palette purge + de-hardcode, progressive disclosure + help consolidation | a11y (contrast + focus done; keyboard wiring not) | tablet/touch, light-theme decision |

**Launch-1 (desktop consumer) readiness:** all three say the *experience* is launch-grade;
the *business* still can't monetize (nothing to buy until Phase C). Design is desktop-ready;
open items (keyboard wiring, tablet reflow, light theme) are all Launch-2/classroom concerns.

## The load-bearing disagreement — sequencing

- **PM:** *Don't start Phase C code yet.* It's hard-blocked on the user creating Supabase, and
  Launch 1's real value is data + virality, not cash. Highest-leverage moves: **(1) make the
  analytics sink real** (Plausible/PostHog cloud — hours, no Supabase), **(2) ship shareable
  build URLs** (the only viral loop, save JSON already URL-encodable), **(3) 5 rover lessons** —
  all backend-free, all improving the metrics Launch 1 exists to gather. Phase C starts the
  moment Supabase exists, not before.
- **SWE:** *GO*, but front-load **Vite + the schema trigger** into Phase C's first sprint. The
  data layer (`save.js` v2 schema, `cloud.js` LWW) is ready; the true blockers are a `profiles`
  auto-provision trigger and the still-user-owned "create the Supabase project."
- **Designer:** Design is desktop-ready; only truly-cheap pre-launch wants are Lessons
  discoverability + the demoted-panel contrast dip.

**Synthesis:** these aren't in conflict. Supabase creation is a user action with lead time, so
the smart move is to **run backend-free work (analytics-real + share URLs + rover lessons) in
parallel while the user stands up Supabase**, then start Phase C — and when it starts, do
**Vite + the `profiles`/entitlements SQL trigger first**, before any client sync code.

## Concrete findings acted on immediately (this session)

- **SWE — DRIVE funnel bug (real regression from Phase A):** `DRIVE` fired inside `enterSim()`,
  which runs on the same click as `UPLOAD`, making UPLOAD→DRIVE a meaningless ~100%. **Fixed:**
  now fires on first real `sim.input` (WASD/touch) after boot.
- **Designer — demoted-panel contrast dip:** the 0.4 opacity demote pushed AA-compliant
  editor/serial text back below AA while demoted. **Fixed:** bumped to 0.55.

## Backlog surfaced for Phase C / later (not yet done)

- **SWE:** add `profiles` auto-provision trigger + entitlements table to `schema.sql` (first sync
  will FK-violate without it); build the **offline write queue** (`cloud.js` is fire-and-forget);
  refactor the `hud.refreshChecklist` monkey-patch (now `main.js`'s de-facto event bus) into a
  real `state` emitter before the lock UI subscribes too; add a `TUNE`/gain-change funnel milestone.
- **PM:** analytics real-sink is the cheapest high-leverage move; then share URLs; then rover lessons.
- **Designer:** keyboard-navigable wiring path (last real AA blocker + classroom unlock);
  tablet reflow ≤1024px (Launch-2 gate); decide light theme (elevate or cut); verify `#fw-hint`
  amber-on-tint AA in light mode; add a quality-tier override UI (mis-detected devices are stuck
  on `?quality=` today).

## Recommended next move
While the user creates the Supabase project: **(1) point the analytics sink at a hosted
privacy-first destination, (2) ship shareable build URLs, (3) add 5 rover lessons** — then begin
Phase C with **Vite + schema trigger first**.
