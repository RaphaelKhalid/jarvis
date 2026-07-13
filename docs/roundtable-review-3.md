# Round-Table Review #3 — User-tested, pre-Phase-C

> **Date:** 2026-07-13. Five agents: two **users** (a 13-yo student on a laptop, a HS
> STEM teacher on a 9th-gen iPad) did a first-run, gave interviews to the **PM**, who
> synthesized them; the **SWE** and **Designer** re-reviewed the code. This round-table
> re-scopes Phase C off that real signal. Follows [#1](roundtable-review.md) and
> [#2](roundtable-review-2.md). State reviewed: `d4e25a9` (== master == production).

## The headline: two users, one wall

Both the solo kid and the buying teacher independently hit the **same failure point — wiring** —
and both exposed that **there is still nothing a school can buy.** That reorders the plan.

- **Maya (13):** build + drag + drive + PID-by-feel *delighted* her ("it's alive and it fights!",
  "NOW tuning PID makes sense, I FELT it"). But wiring was the **near-quit**: "tiny dots… I have
  NO idea which pin matches which… if I were alone I might quit here." Auto-wire rescued her but
  "I feel like I cheated and didn't learn anything. I wish the guide had told me the matches, like
  'connect the sensor's SDA to A4.'" Code panel intimidating; the "just hit Upload" line saved it.
  Parent would pay "a small amount if it clearly *teaches*… right now it feels like a toy demo."
- **Mr. Ortiz (teacher):** no login wall = relief; curriculum is the **strongest part** (properly
  sequenced, auto-checked, standards-mapped). But: wiring on an iPad = "fat-finger city… 8 raised
  hands per minute"; the Guide rail + HUD are absolutely-positioned **over the canvas** at 1024px;
  progress is **per-device localStorage** → stars vanish on non-1:1 iPad carts; **no accounts,
  roster, or dashboard** ("assessment visibility is the whole job"); compliance is a plan not a
  product; and the "networks may block WebGL" line is a **content-filter risk** he must test first.
  "Pilot free tomorrow: yes. Buy at $99/class today: no — I'm paying for the classroom layer, and
  it doesn't exist. Get me roster + dashboard + filter-check and I'll write the PO."

## What the round-table concluded

1. **Guided wiring is now the single highest-leverage problem** — it's the consumer *near-quit*
   AND the classroom *touch dealbreaker* at once. It jumps ahead of parts of Phase C. Auto-wire is
   a "false floor" that voids the learning both users came for. Fix = **guidance** (Guide rail
   names/highlights the next connection) + **fatter hit-targets/snap** + a **2D pin-list fallback**
   (which the Designer notes also closes review-#2's keyboard-a11y wiring blocker — two birds).
2. **Re-scope Phase C toward the classroom, not the consumer paywall.** The accounts/Supabase/sync
   spine review #2 framed as "consumer monetization" is *more valuable as* classroom persistence +
   roster (it kills the shared-cart localStorage dealbreaker). The teacher writes a concrete PO;
   the parent pays "maybe." Build the same rails, point them at the teacher layer first, and make
   **consumer Stripe a fast-follow** on the same entitlement rails.
3. **De-risk the WebGL content-filter this week** (~1 day) — it gates the entire classroom sell and
   is where "half his ed-tech died." Don't build the dashboard behind an app that won't load.
4. **Consumer legibility flips toy→class:** a visible progression/unlock spine + a "you learned X"
   beat is what turns Maya's "maybe I'd come back" and what a parent pays for.

## Engineering reality (SWE) feeding the plan
Cloud-sync gaps still open: `cloud.js` has **no auth/session, no call sites** (nothing calls
push/pull), keys are blank, `@supabase/supabase-js` isn't in the import map, no offline queue, no
`tier`/entitlements column, LWW is client-clock-trusted. Vite migration's biggest risk is **Rapier
WASM** (needs `vite-plugin-wasm` + top-level-await); PWA `sw.js` precache and the Playwright static
serving both need re-pointing. Gotchas: **auth session must survive the `switchRobot()` reload**;
the `hud.refreshChecklist` monkey-patch is now main.js's de-facto event bus and should become a
real `state` emitter *before* auth/lock subscribers pile on. The new `balPhi` PID is a **shadow 1-D
plant** decoupled from the Rapier body — document it before the next physics change.

## Design reality (Designer) feeding the plan
Review-#2 cheap debt is cleared (contrast, focus-visible, palette, rover-track browser). Phase C UI
should **reuse existing idioms**: magic-link modal from `.fatal-card`/`#resume-bar`; a
`.lt-lesson.pro` lock **visually distinct** from the prereq-lock (amber "PRO" pill, full opacity,
still clickable — aspirational not disabled); an **inline upgrade view** in the rail's view-stack so
it *can't interrupt a running free lesson* (entitlement checked only in `engine.start()`, never
`tick()`); an account chip cloned from `robotpicker.js`. Tablet: default the 312px guide to a
collapsed overlay ≤1024px, collapse the four absolute HUD corners into one bottom bar, and add the
2D pin-list wiring path. A11y: `aria-disabled` (not `disabled`) on Pro lessons, focus-trap/Esc on
modals, `aria-live` for auth/tier, verify the PRO pill contrast in light theme.

---

## Re-scoped plan → the to-do list (what Claude Code executes)

Ordered. Effort S/M/L. Owner **CC** = Claude Code, **You** = user action.

### Tier 0 — De-risk + measure (this week)
- **T0.1 (You, S)** Load-test the live URL through a real school/filtered network; record the result. *Gates the whole classroom sell.*
- **T0.2 (CC, S)** Instrument the **wiring step** in PostHog: first-wire-attempt, wrong-pin clicks, auto-wire usage, wiring abandonment — confirm the near-quit is systemic.

### Tier 1 — Guided wiring (highest leverage; serves BOTH launches)
- **T1.1 (CC, M)** Guidance layer: the Guide rail names the next required connection ("SDA → A4"), pulses the source pin and glows the correct target; demote auto-wire to "finish for me" after N manual connections.
- **T1.2 (CC, S–M)** Fatten pin hit-targets + snap-to-nearest-valid on pointer pick (kills most trackpad/fat-finger misses on both platforms).
- **T1.3 (CC, M–L)** **2D pin-list wiring fallback** off `wiring.js` `REQUIRED` (tap source → tap target rows) for coarse pointers; doubles as the **keyboard/a11y wiring path**.

### Tier 2 — Consumer legibility (flip toy→class for Launch 1)
- **T2.1 (CC, M)** Visible progression/unlock spine: stars gate lesson/cosmetic unlocks + a "you learned X" debrief beat after lessons.
- **T2.2 (CC, S)** Code-panel de-intimidation: inline "you don't need to read this — defaults balance" reassurance (extends the shipped progressive disclosure).

### Tier 3 — Classroom spine = re-scoped Phase C (Launch 2, the real PO)
- **T3.1 (CC, M)** Adopt **Vite**: npm-install three/posthog/supabase, `vite.config.js`, remove the import map, move all (publishable) keys to `import.meta.env.VITE_*`.
- **T3.2 (CC, M)** Make **Rapier work under Vite** (`vite-plugin-wasm` + top-level-await, self-host `rapier3d-compat`); verify Upload→WASM in `npm test`.
- **T3.3 (CC, M)** Re-point build/test/PWA: Vercel → `vite build`/`dist`; regenerate `sw.js` precache; Playwright serves `dist`.
- **T3.4 (CC, M)** Refactor the `hud.refreshChecklist` monkey-patch into a real `state` event emitter; move guide/save/funnel subscribers onto it *before* adding auth.
- **T3.5 (CC, S)** Migration `0002`: `profiles.tier` (+ entitlements) column + RLS; add `tier:'free'|'pro'` to every lesson in `lessons.js` (default free).
- **T3.6 (CC+You, M)** Magic-link **auth**: add `@supabase/supabase-js` + keys, sign-in flow, `persistSession:true`, `state.user`; **session survives the `switchRobot()` reload**. *(You: nothing new — keys already provided.)*
- **T3.7 (CC, M)** Auth **UI**: `#auth-card` magic-link modal (reuse `.fatal-card` tokens, real `<form>`) + account chip in `topbar.js` cloned from `robotpicker.js` (Free/Pro dot).
- **T3.8 (CC, M)** Wire **cloud sync**: `pushDocument` from `save.js:persist`, `pullDocument` on login, LWW for `save` + `progress`.
- **T3.9 (CC, M)** **Offline write queue** (localStorage-backed, flush on `online`/boot); make `updated_at` DB-authoritative to kill client-clock LWW bugs.
- **T3.10 (CC, M)** **Entitlement gate**: `engine.isUnlocked` → `starsUnlocked && tierUnlocked` (checked only in `start()`); `.lt-lesson.pro` lock idiom + inline upgrade view in the rail view-stack.
- **T3.11 (CC, M–L)** **Class-code join + roster** (teacher account).
- **T3.12 (CC, L)** **`/teach` dashboard**: progress matrix + CSV export (the teacher's buy trigger).
- **T3.13 (CC, M)** **iPad ≤1024px reflow**: default guide to collapsed overlay w/ scrim; collapse the four absolute HUD corners into one bottom action bar so nothing occludes the canvas.

### Tier 4 — A11y / cleanup / compliance / Stripe (parallel + fast-follow)
- **T4.1 (CC, S)** A11y hardening on the new auth/paywall surfaces: labels, focus-trap/restore/Esc, `aria-live` for auth+tier, `aria-disabled` (not `disabled`) on Pro lessons, light-theme PRO-pill contrast.
- **T4.2 (CC, S)** Cleanup: tokenize `#resume-yes`'s `#1b1303` → `--on-accent`; label the `#share-btn`; record the light-theme decision in `docs/DECISIONS.md`; document the `balPhi` shadow-plant in `sim.js`.
- **T4.3 (You/legal, M)** COPPA/FERPA + DPA + data-deletion endpoint + privacy policy + a11y statement (procurement gates).
- **T4.4 (CC, L)** **Consumer Stripe** checkout + webhook via a Vercel serverless fn writing `profiles.tier` with the **service-role key** (first real server component) — fast-follow *after* activation is proven.
- **T4.5 (You, ongoing)** Fill the unit gap (more lessons toward 3–4 weeks); validate the standards map via Ortiz's free pilot.

## One-line verdict
Experience is still market-grade; the business is still a prototype — but the users sharpened
*where to spend next*: **fix guided wiring first**, **de-risk the WebGL filter this week**, and
**re-scope Phase C's accounts work toward the classroom PO**, with consumer Stripe as a fast-follow
on the same rails.
