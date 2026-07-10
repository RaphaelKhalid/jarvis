# SelfBalance Lab → GYRO: Master Product Plan

**Goal:** Take the current browser prototype (drag-and-drop robot assembly + Rapier physics balancing sim) to a polished, marketable educational product shipped as (1) a production web app and (2) a native-feeling iOS app, under the **GYRO** brand.

**How to use this document:** Each phase is a self-contained unit of work with explicit tasks, file-level guidance, and acceptance criteria. A Claude Code (Opus) session should execute one phase (or one task group) at a time, verify against the acceptance criteria by loading the app, then commit. Phases are dependency-ordered; do not start a phase before its "Depends on" phases are committed. Keep CLAUDE.md updated as architecture changes — that is part of every phase's definition of done.

**Non-negotiable constraints (carry through every phase):**
- The physics feel is the product. Never change `sim.js` tuning constants (`TORQUE_SCALE`, `CRUISE_SPEED`, `DRIVE_KV`, reference gains Kp 15 / Ki 140 / Kd 0.9) as a side effect of refactoring. Any physics change requires manual drive-testing.
- 1 unit = 1 cm; +Z is robot-forward; roll is locked.
- Emissive materials glow via `UnrealBloomPass`; all rendering goes through `composer.render()`.
- `wiring.js` `REQUIRED` array stays the single source of truth for valid connections.

---

## Phase 0 — Stabilize the baseline (1 session)

**Depends on:** nothing. **Do this first, before anything else.**

The working tree has uncommitted changes to `index.html`, `js/main.js`, `js/sim.js` (~136 lines, mostly sim). There's also stray `_diag.mjs`, and `node_modules`/`package.json` exist despite the zero-build claim in CLAUDE.md.

Tasks:
1. Review the uncommitted diff, drive-test the sim (balance, WASD, missions, sound), and commit it with an accurate message — or revert if broken.
2. Delete `_diag.mjs` if it's a leftover debug script (read it first).
3. Reconcile `package.json`/`node_modules` with the zero-build story: if they exist only for `serve`, add a `.gitignore` for `node_modules` and note in CLAUDE.md; if unused, remove.
4. Add `docs/` to the repo (this file), and a `docs/DECISIONS.md` log (one line per irreversible decision, dated).
5. Tag the commit `v0-prototype-baseline`.

**Acceptance:** clean `git status`, sim verified by driving it, tag pushed.

---

## Phase 1 — Codebase hardening & architecture for growth (2–4 sessions)

**Depends on:** Phase 0.

`main.js` is a god-module (tray, drag, wiring UI, stepper, HUD, camera, input, render loop). Before adding product features, split it so future phases touch small files. **This is a pure refactor: zero behavior change.**

Task group 1A — module split (keep ES modules, no bundler yet):
- `js/app/state.js` — a tiny observable store: `mode`, placed parts, wiring completeness, gains, mission state. Plain JS pub/sub (`subscribe(key, fn)`), no library.
- `js/app/assembly.js` — tray, drag-to-slot, pin raycasting, tooltips (moves out of main.js).
- `js/app/hud.js` — stepper, checklist, sparkline, overlays.
- `js/app/input.js` — keyboard/pointer, gated by `state.mode`. **Design the input layer now with an abstraction (`input.axis('drive')`, `input.axis('steer')`) so Phase 6 touch controls plug in without rewrites.**
- `js/main.js` shrinks to: createScene → wire modules → animate loop.
- After each extraction, reload and fully exercise the affected flow before the next extraction. Commit per extraction, not one mega-commit.

Task group 1B — quality infrastructure (still zero-build for the app itself):
- Add `eslint` (flat config) + `prettier` as devDependencies; `npm run lint`. Fix what it finds mechanically.
- Add **Playwright** smoke tests (`tests/smoke.spec.js`): page loads without console errors; parts tray renders; placing all parts + completing wiring enables Upload; Upload transitions to sim mode; robot stays upright for 10 simulated seconds (poll `window.__sim`); WASD produces displacement. This test suite is the regression net for everything after — invest here.
- GitHub Actions: lint + Playwright on push.
- Update CLAUDE.md: "Run `npm test` (Playwright) before committing; there is now a test suite."

Task group 1C — save/load foundation:
- Serialize assembly state (placed parts, wires, sketch text, gains) to a versioned JSON schema (`schemaVersion: 1`) in `localStorage`; auto-restore on load with a "Resume / Start fresh" prompt. This schema later becomes the cloud-sync payload (Phase 5), so keep it clean and forward-compatible (unknown keys ignored, version-gated migrations).

**Acceptance:** all Playwright tests green; manual drive-test unchanged in feel; `main.js` < ~300 lines; refresh mid-assembly restores state.

---

## Phase 2 — Design system & visual/UX polish (3–5 sessions)

**Depends on:** Phase 1.

Turn "impressive demo" into "product." Design framework choice: **stay vanilla + design tokens** (no React migration — the app is a canvas with a thin DOM shell; a framework buys little and risks the physics loop). Use:
- **CSS custom properties as the token layer** (`css/tokens.css`): color scales, spacing (4px grid), radii, type scale, elevation, motion durations. Both light and dark themes via `data-theme`; dark is default (matches the bloom aesthetic).
- **Web Components (plain, no library) for repeated UI**: `<gyro-panel>`, `<gyro-button>`, `<gyro-tooltip>`, `<gyro-stepper>`. Small, dependency-free, and they survive the iOS wrap unchanged.
- Typography: one variable font, self-hosted (required later by iOS offline mode anyway) — recommend Inter or Space Grotesk for the UI, JetBrains Mono for the code editor.
- Use the GYRO brand assets pipeline (Canva 2D + Kenney CC0 3D — see memory `gyro-assets`) for logo, icons, part illustrations.

Task groups:
- **2A Tokens + theming:** extract every hard-coded color/size from `css/` and inline styles into `tokens.css`. Acceptance: toggling `data-theme` reskins the whole shell with no per-component edits.
- **2B UI shell redesign:** parts tray as a proper dock with part cards (name, icon, count badge); phase stepper as a persistent top bar; checklist and glossary tooltips restyled with `<gyro-tooltip>`; code editor in a resizable side panel with theme-matched CodeMirror styling.
- **2C Onboarding rewrite:** replace the overlay with a driven 5-step interactive tutorial (place battery → place motor → wire one pin → edit Kp → Upload) using a spotlight/cutout pattern. Skippable, replayable from a Help menu. This is the single highest-leverage feature for an education product — a first-time 12-year-old must succeed unaided.
- **2D Sim-mode HUD:** speedometer, tilt gauge, gain readout, mission objectives panel; consistent with tokens. Add a photo-mode camera and a "reset robot" button.
- **2E Accessibility pass:** keyboard-navigable assembly (tab through slots, Enter to place), ARIA on all controls, `prefers-reduced-motion` disables bloom pulsing and camera shake, color choices pass 4.5:1 in both themes. Education buyers (schools/districts) require this — it's a sales gate, not a nicety.
- **2F Responsive layout:** the app must be usable at 768px width (iPad) — tray collapses to a bottom sheet, editor becomes a modal. This is the layout the iOS app ships with, so get it right here.

**Acceptance:** design-review pass on desktop + iPad viewport; tutorial completable by someone who has never seen the app; Lighthouse accessibility ≥ 95; Playwright suite still green.

---

## Phase 3 — Educational core: curriculum engine (4–6 sessions)

**Depends on:** Phase 2. **This is what makes it a product rather than a toy.**

The existing mission mode becomes a **level/lesson system** teaching real concepts: circuits → PID intuition → control tuning → robotics challenges.

Task group 3A — content engine:
- `js/curriculum/engine.js` + `content/lessons/*.json`: data-driven lessons. Each lesson = `{ id, track, title, concept, briefing (markdown), setup (pre-placed parts/wires/locked gains), objectives [{type, params, hint}], sandbox constraints, debrief }`.
- Objective types to implement as checkable predicates against `BalanceSim`/state: `wire-connection`, `place-part`, `edit-gain-to-range`, `stay-upright-for`, `reach-zone`, `follow-path`, `max-overshoot-below`, `settle-within`, `quiz-answer`.
- Lesson runner UI: briefing card → guided objectives with live checkmarks → debrief with a "what you learned" summary and a star rating (1–3 stars based on secondary criteria).

Task group 3B — curriculum content (write these lessons; ~20 total across 4 tracks):
1. **Circuits track (5 lessons):** what each component does; power vs signal; why the motor driver exists; wiring from schematic; debug-the-broken-wiring challenges (deliberately miswired boards the student must fix — requires adding a "fault injection" mode to `wiring.js`).
2. **Balance track (5 lessons):** open-loop failure (Kp=0, watch it fall) → P-only oscillation → adding D → adding I for drift → the tuning challenge (hit settle-time target). This track is pure gold pedagogically because the sim already visualizes it viscerally.
3. **Driving track (5 lessons):** lean-to-move intuition, heading hold, slalom course, hill climb (uses the hilly terrain), precision parking.
4. **Engineering track (5 lessons):** capstone challenges combining everything, including a timed obstacle run and a "tune for a payload" scenario (add mass to the chassis — new sim parameter, additive only).
- Each lesson's briefing written at a middle-school reading level with an optional "go deeper" section (the real math, for high-schoolers).

Task group 3C — instrumentation for learning:
- Real-time PID visualizer panel: plot setpoint vs actual tilt, and P/I/D term contributions as stacked live traces (extend the existing sparkline; use the dataviz skill when building it). This is the "aha" machine for control theory.
- Glossary grows into a searchable in-app encyclopedia (reuse `glossary.js` data, add long-form entries).

Task group 3D — progression & profiles (local-first):
- Progress stored per profile in localStorage (multiple named profiles for shared classroom devices), stars, unlock chain (linear within a track, tracks unlock in parallel), badges. Same versioned-schema discipline as Phase 1C.

**Acceptance:** a new user can go from zero to tuning PID gains through lessons alone; all 20 lessons completable; objective predicates covered by Playwright tests (run lesson 1 and the P-only lesson end-to-end headlessly).

---

## Phase 4 — Content depth & replayability (3–4 sessions)

**Depends on:** Phase 3.

- **4A Sandbox upgrade:** free-play mode with terrain presets, adjustable physics toys (payload mass, wheel friction zones — already have material zones), and a challenge-ghost (replay your best run as a translucent robot; record wheel/chassis transforms at 10 Hz).
- **4B More components:** ultrasonic sensor (distance readout + a "stop before wall" lesson), line sensor + line-following course, LED + buzzer as wiring-practice parts. Each part: `parts.js` factory + `glossary.js` entries + `REQUIRED` additions + at least one lesson using it. **Sensor behavior is simulated in `sim.js` (raycasts), surfaced as read-only values the sketch parser can reference** — extend `parseGains()` into a slightly richer (still non-executing) sketch scraper, e.g. recognizing `setCruiseSpeed(x)` and threshold constants. Do NOT build a real Arduino interpreter yet; that's Phase 8 (stretch).
- **4C Robot customization:** chassis colors/decals, wheel styles — cosmetic unlocks tied to stars (motivation loop, and it's cheap: material swaps).
- **4D Sound & juice pass:** per-lesson victory stingers, UI sounds through the existing synthesized sound design, particle burst on lesson complete, subtle camera work.

**Acceptance:** ≥ 3 new parts fully integrated (factory + glossary + wiring + lesson); ghost replay works; cosmetics persist per profile.

---

## Phase 5 — Backend: accounts, sync, and classroom (4–6 sessions)

**Depends on:** Phase 3 (schema), can run parallel with Phase 4.

Keep the app static; add a thin backend. **Recommendation: Supabase** (Postgres + Auth + Row Level Security) — no server code to maintain, generous free tier, works from a static site and from the iOS wrapper. The repo already deploys via Vercel; keep that for hosting.

- **5A Auth:** email magic-link + Sign in with Apple (required for iOS review if any third-party login exists) + Google. Under-13 handling: accounts optional — the app must remain fully usable logged-out with local profiles (this is also the COPPA-safe default). Class-code join flow for students (no email needed: teacher creates class → students join with code + display name, pseudonymous).
- **5B Sync:** push/pull the Phase 1C/3D schemas (assembly saves, progress, cosmetics) with last-write-wins per document; offline-first (queue writes, flush on reconnect) — mandatory for iOS anyway.
- **5C Teacher dashboard (separate route, `/teach`):** class roster, per-student progress matrix (lessons × stars), "assign lesson" (pins it on students' home screen), export CSV. Plain HTML+tokens, same design system. This dashboard is what schools pay for.
- **5D Privacy/compliance groundwork:** privacy policy + terms pages, data deletion endpoint, no third-party analytics for student accounts; a self-hosted or privacy-safe event pipeline (e.g. simple Supabase table of anonymized events) for product metrics. Document COPPA/FERPA posture in `docs/COMPLIANCE.md`. Get real legal review before selling to US schools — flag this to the user; Claude drafts, a lawyer signs off.

**Acceptance:** logged-out experience unchanged; login syncs progress across two browsers; teacher can create a class, student joins by code, dashboard reflects lesson completion within seconds; RLS tested (student A cannot read student B's data — write an explicit test).

---

## Phase 6 — iOS app (4–6 sessions)

**Depends on:** Phases 2 (responsive), 5B (offline).

**Framework decision: Capacitor.** The app is WebGL+WASM; a native rewrite (SwiftUI + RealityKit) would mean re-porting Rapier and the entire sim — months for no user-visible gain. Capacitor wraps the existing app in a WKWebView with native plugins, keeps one codebase, and WKWebView's WebGL2/WASM performance on modern iPads/iPhones is more than adequate for this scene complexity. (Fallback if perf disappoints on A12-era iPads: reduce bloom resolution and terrain trimesh density behind a device-tier check — build that toggle regardless as `quality: high|low`.)

- **6A Touch controls:** on-screen dual controls (left: drive stick, right: steer or tilt-assist buttons) feeding the Phase 1A input abstraction; drag-and-drop assembly verified with touch + Apple Pencil; pinch-orbit camera. Test on a real iPad — simulator WebGL lies about perf.
- **6B Capacitor shell:** `npm i @capacitor/core @capacitor/ios`; app id `com.gyro.lab` (confirm with user); local bundle (no remote URL — App Store requirement for offline + review reliability). Plugins: Haptics (bump/fall/success feedback), StatusBar, Filesystem (save exports), App (lifecycle → pause sim when backgrounded, critical for the fixed-timestep loop: clamp accumulated dt on resume).
- **6C iOS-specific polish:** safe-area insets via `env(safe-area-inset-*)` in tokens; prevent rubber-band scrolling; audio unlock on first touch (WebAudio autoplay policy); app icon + splash from GYRO brand assets; landscape-primary orientation lock for sim, both orientations for assembly on iPad.
- **6D Store readiness:** App Store screenshots (6.7", 13" iPad), preview video of the balance sim, age rating 4+, privacy nutrition labels matching Phase 5D, Sign in with Apple wired. Register as an education category app. TestFlight beta with ≥ 10 external testers before submission.
- **6E Monetization wiring (see Phase 7):** StoreKit via `capacitor-plugin-purchases` (RevenueCat) — RevenueCat recommended because it unifies web (Stripe) and iOS (StoreKit) entitlements, which the hybrid model needs.

**Acceptance:** app runs 60 fps on iPad (9th gen or later) through a full lesson; passes App Store review guidelines self-audit (`docs/APPSTORE_CHECKLIST.md` — write it); TestFlight build distributed. Note: user must supply an Apple Developer account ($99/yr) — flag early in this phase.

---

## Phase 7 — Productization & go-to-market (3–4 sessions + ongoing)

**Depends on:** Phases 5, 6 in flight.

**Market positioning:** "A virtual robotics lab — build, wire, code, and tune a real control system, no hardware required." Competitors/comparables: Tinkercad Circuits (free, no physics feel), Wokwi (hobbyist, not curricular), CoderZ / VEXcode VR (school robotics sims, subscription — proof the school market pays). GYRO's wedge: **the visceral physics of balancing** + genuine PID pedagogy, which none of the block-coding sims deliver.

Pricing model (recommendation — confirm with user before implementing):
- **Free:** full sandbox + Circuits track + first 2 Balance lessons. The free tier must be genuinely great; it's the marketing.
- **GYRO Plus (consumer):** $6.99/mo or $39.99/yr — all tracks, cosmetics, cloud sync. Same entitlement web (Stripe) and iOS (StoreKit) via RevenueCat.
- **GYRO Classroom:** $99/classroom/yr (up to 35 students) — teacher dashboard, assignments, class management. Sold web-only (avoids Apple's 30% and matches school procurement).

Task groups:
- **7A Paywall + entitlements:** entitlement checks in the curriculum engine (lesson `tier` field); graceful lock UI ("unlock with Plus") that never interrupts a free lesson mid-flow. Web checkout with Stripe; iOS with StoreKit. Restore purchases. Test every path.
- **7B Marketing site:** separate static site (`site/` folder or separate repo, also Vercel): landing page with an embedded live demo of the sim (the product demos itself — huge asset), pricing, educators page with curriculum-standards alignment (map lessons to NGSS MS-ETS1 / HS-ETS1 in `docs/STANDARDS_MAP.md`), privacy pages.
- **7C Launch content:** 60-second trailer (screen capture of the sim), teacher one-pager PDF (Canva pipeline), 3 blog-style lesson articles ("Teach PID with a robot that actually falls over") for SEO.
- **7D Distribution plan (document in `docs/GTM.md`, execution is on the user):** Product Hunt + Hacker News (the balance sim is HN-bait), r/arduino + r/Physics teacher communities, ISTE/CSTA teacher networks, App Store education category feature pitch, free classroom pilots with 5 teachers in exchange for testimonials + case studies.

**Acceptance:** a stranger can go landing page → try demo → buy Plus → use it on iOS with the same account; classroom purchase flow works; standards map reviewed by at least one real teacher (pilot program).

---

## Phase 8 — Stretch / post-launch backlog (unordered)

- **Real sketch execution:** compile-to-JS subset of Arduino C++ (or embed an AVR interpreter like avr8js) so student code actually runs the controller. The single biggest pedagogical upgrade, and the hardest — treat as its own project.
- **Bridge to real hardware:** export the student's tuned sketch as a genuine `.ino` for a physical kit (partner with a kit vendor — a physical GYRO kit is the long-term revenue expansion).
- Android app (Capacitor makes it nearly free once iOS ships).
- Multiplayer races / shared classroom leaderboards.
- Localization (i18n framework decision: keep strings in `content/i18n/*.json` from Phase 3 onward to make this cheap — retrofit rule added now: **no new user-facing string literals in JS after Phase 3; all via a `t()` helper**).
- More robots: 4-wheel rover, robot arm (new sim modules).
- AI tutor: hint system powered by Claude API — student's wiring/gains/telemetry as context, Socratic hints only. Gate behind teacher opt-in.

---

## Execution ground rules for future Claude Code sessions

1. Read this file and CLAUDE.md first; find the earliest incomplete phase; confirm scope with the user before starting a new phase.
2. One task group per session unless trivial. Commit per task group with the phase/group id in the message (e.g. `P3B: balance track lessons 1-3`).
3. After any change touching `sim.js` or input: manually drive-test (balance from rest, WASD figure-eight, a hill climb) before committing. After any change at all: run Playwright.
4. Update this file's checkboxes/status inline (append a `Status:` line under each phase header as phases complete) and log irreversible choices in `docs/DECISIONS.md`.
5. Anything requiring user action (Apple Developer account, Supabase project creation, Stripe account, legal review, pricing sign-off) — surface it at the *start* of the phase, not when blocked.
6. Never let the repo drift from zero-build for the core app until Phase 6 forces a Capacitor build step; even then the web app must keep working via `npx serve .`.

## Rough sequencing

Phases 0–2 are the foundation (~2–3 weeks of sessions). Phase 3 is the product core (~2 weeks). Phases 4/5 can interleave (~2–3 weeks). Phase 6 iOS (~2 weeks incl. review cycle). Phase 7 launch (~2 weeks). Total: roughly a 3-month path to a launched, monetized web + iOS educational product, with Phase 8 as the growth backlog.
