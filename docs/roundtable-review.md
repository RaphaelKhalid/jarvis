# GYRO Round-Table Review → Web Launch Plan

> **Source:** Claude Code session `b9cb3726` (bridge `cse_015qTkMx3FBWsErLdoLepYmo`,
> claude.ai/code/session_015qTkMx3FBWsErLdoLepYmo), 2026-07-13. Three role reviewers
> (SWE, PM, Designer) ran in the background against the real codebase + live site, followed
> by five personality-varied discussions and a synthesized go-to-market plan. Reconstructed
> here from the transcript so it isn't buried in session history.
>
> **State when reviewed:** branch `education-first-redesign` at `903369a` (rover buildable +
> tire-track fix). Production was on `bc3e180` (pre-track-fix). 14 Playwright tests green.

---

## Where the three reviewers agreed (load-bearing findings)

- **The experience is market-grade; the business and production layers are still a prototype.** All three said this independently.
- **Monetization spine is unbuilt:** no accounts, no `tier` field on any lesson, no paywall, no `/teach` dashboard. Today *there is nothing to buy* (PM + SWE).
- **Cross-device + accessibility is the biggest gap to "web-ready":** iPad layout occludes the scene, wiring is pointer-only, `--text-dim` fails WCAG AA (Designer + SWE + PM).
- **Cheap, high-value hygiene is simply missing:** no meta/OG/favicon/manifest, no error boundary, no WebGL fallback, no analytics (SWE).
- **The "content library" is one robot deep** — the rover is built but has zero lessons (PM).
- **Polish leaks betray the premium story:** the pre-rebrand blue palette still lives in the PID sparkline; `#resume-bar` ignores tokens (Designer).

---

## Individual reviews (top-5 priorities each)

### PM — product / market-readiness
Real, differentiated wedge (assemble → wire → tune a *genuine* PID → feel the physics; no competitor does the "wire an MPU6050, watch the pendulum fall at Kp=0" moment). Honest caveat: the sketch is **display/parse only** — `parseGains()` regex-scrapes Kp/Ki/Kd, the real controller is JS, so "learn to code robots" is capped until real sketch execution (avr8js) lands.

1. **Wire the free→paid boundary (accounts + paywall)** — High/High. Nothing is monetizable without it: Supabase auth (magic-link + class code), `tier` on lessons, graceful lock UI.
2. **Build the teacher dashboard (`/teach`)** — High/High. Classroom ($99/class) is the realistic revenue engine; schools pay for rosters/progress/assignments.
3. **Prove and harden first-run activation** — High/Medium. Finish Phase 2 (iPad responsive, a11y ≥95, unaided tutorial completion). Classroom devices are iPads → 768px usability is a sales gate.
4. **Give the rover a reason to exist — 5 rover lessons** — Medium/Medium. Built but content-orphaned; all 20 lessons assume the self-balancer.
5. **Ship shareable build URLs** — Med-High/Low-Med. Save schema is already clean forward-compatible JSON; encode into a URL for a viral loop.

*Verdict: the experience is a genuine product with a real wedge; the business is still a prototype.*

### SWE — engineering / web market-readiness
Architecture unusually healthy for a zero-build app (thin `main.js`, 22-line `state.js` pub/sub, well-cut RobotDef seam, versioned save schema `v:2`). Fragilities: `sim.js` is 970 lines (~20% of codebase, the untouchable crown jewel where all new robots/sensors land); robot switch = persist+reload (hard ceiling on live swapping); `main.js:87-90` monkey-patches `hud.refreshChecklist`; sketch is a parse-only facade.

1. **WebGL/WASM resilience + global error boundary** — S. Capability-check in `createScene`, friendly fallback, `onerror`/`unhandledrejection` reporting. Highest risk-to-effort ratio; currently silent crashes on unknown GPUs.
2. **SEO/meta/PWA-lite pass** — S. `meta description`, OG/Twitter cards, favicon, `manifest.json`. `index.html` has only charset+viewport today; HN/PH launch runs on link previews.
3. **Analytics + error observability** — S–M. Privacy-safe funnel (load→place→wire→upload→drive) + Sentry-equivalent. Zero analytics today.
4. **Device quality tier (`quality: high|low`)** — M. Toggle bloom resolution + terrain density behind a device check. Gates the "60fps on 9th-gen iPad" bar.
5. **Cloud sync + accounts to actually-working** — L. Supabase auth (magic link), offline write queue, local multi-profile. Largest unbuilt chunk; data layer (versioned save) is ready.

Also flagged: chromium-only CI (no cross-browser/error-path/PID-unit/visual tests), three-CDN fragility with no SRI, adopt **Vite** around the accounts milestone (low risk, already ES modules).

*Bottom line: the gap to market isn't refactoring; it's the unglamorous production layer + the large accounts/sync build. Do the three S-effort items before any launch push.*

### Designer — visual / UX / cross-device
"Lab Instrument" identity is coherent and disciplined (`css/tokens.css` is a real system: amber-phosphor `#ffb000` signature accent, green=connected, red=fault, three-font scale, 4px grid, named easings). Reads as product, not demo. The always-on Guide rail is a genuinely strong learnability pattern.

Rough edges / weakest axis = **cross-device + a11y**:
1. **Tablet/touch layout for the whole flow (not just driving)** — High/High. At ≤1024px the guide rail (`position:absolute; 312px`) + sim HUD occlude/collide over the 3D scene; assembly/wiring is 3D raycast pin-picking with no touch affordance. iPad is a stated target but not designed for.
2. **Accessibility pass to AA** — Low-Med/High. `--text-dim` (`#737f92` on `#0f131b`) is ~3.9:1 — below AA; no `:focus-visible` anywhere; wiring is pointer-only. Procurement-gated for schools.
3. **Purge legacy blue palette + de-hardcode `#resume-bar`** — Low/Med. PID sparkline legend (`style.css:530`) hardcodes the old pre-rebrand `#56a8ff/#3ddc84/#d686ff`; `#resume-bar` hardcodes hex instead of tokens (breaks light mode).
4. **Reduce cold-start load; progressively reveal the editor** — Med/High. Collapse the firmware panel until Wire completes; consolidate three "help" entry points (overlay tour + rail + help button) into one.
5. **Design the light theme as a true peer (or drop it)** — Med/Med. Light works but loses the bloom/phosphor brand soul.

---

## The five discussions (personality-varied)

1. **"What are we actually selling?"** (PM=Visionary · SWE=Skeptic · Designer=User-Advocate) →
   **Position as "feel how control systems work," not "learn Arduino."** Reframe the editor as a companion, not the headline. Real sketch execution (avr8js) becomes an upsell, not a launch obligation.
2. **"Will a stranger succeed in 60 seconds?"** (Designer=Perfectionist · PM=Analyst · SWE=Pragmatist) →
   **Analytics is the prerequisite for the onboarding rework, not a parallel task.** Then collapse the editor pre-Wire and consolidate to one help surface. Don't redesign blind.
3. **"What do we build first to make money?"** (PM=Hustler · SWE=Systems-Thinker · Designer=Diplomat) →
   **One entitlement layer, two products.** Consumer paywall ships first (faster cash, simpler); classroom is the fast-follow revenue engine. Vite adoption rides in with accounts. **User must create the Supabase project — it blocks everything.**
4. **"Is this usable on the devices schools own?"** (SWE=Devil's-Advocate · Designer=Pragmatist · PM=Risk-Averse) →
   **Tablet/touch is a gate for the classroom launch, not consumer.** Desktop consumer can launch without it; classroom cannot. Add `quality: high|low` device tier.
5. **"What is the actual MVP launch line?"** (PM=Closer · SWE=Minimalist · Designer=Idealist) →
   **Launch 1 = desktop consumer (hygiene + paywall). Launch 2 = classroom (accounts, dashboard, iPad, a11y, compliance). Never market Launch 1 to schools.**

---

## Synthesized plan — GYRO to market-ready web app

**Strategic frame:** the product *experience* is launch-quality. Sequence as
**hygiene → activation → monetization → classroom**, split across two launches to reach
revenue and real user data fast instead of stalling on the large classroom build.

### Phase A — Launch hygiene *(≈1–2 weeks, mostly S-effort, do first)*
| Item | Owner | Why |
|---|---|---|
| WebGL capability check + friendly fallback; global `onerror`/`unhandledrejection` reporting | SWE | Silent crashes on unknown GPUs is the #1 killer of WebGL apps |
| SEO/meta: `description`, OG/Twitter cards, favicon, `manifest.json` | SWE | Launch runs on HN/PH link previews; hours of work |
| Privacy-safe analytics funnel (`load→place→wire→upload→drive`) | SWE/PM | Can't tune a launch you can't measure — **prerequisite for Phase B** |
| Purge legacy blue palette (sparkline), de-hardcode `#resume-bar` onto tokens | Designer | The "one accent" identity must hold on the most-watched surface |
| A11y quick wins: `--text-dim` → 4.5:1, global `:focus-visible` amber ring | Designer | Cheap credibility; procurement-gated later |

### Phase B — Activation & device reach *(≈2–3 weeks)*
- Progressive disclosure: collapse the firmware editor until Wire completes; consolidate three help surfaces into one.
- **Reframe positioning** to "feel how control systems work" — hero the sliders + falling robot, demote the raw sketch.
- Device **quality tier** (`high|low`: bloom resolution + terrain density).
- Prove unaided first-run with the new analytics; iterate on the measured drop-off.

### Phase C — Monetization spine (consumer) *(≈3–5 weeks; **blocked on user: create Supabase project**)*
- Supabase **auth** (magic-link) + local **multi-profile** for shared devices.
- One **entitlement layer**: `tier` on lessons + graceful lock UI (never interrupts a free lesson mid-flow).
- Consumer **Stripe** checkout + restore. Offline write queue → sync (schema already clean/versioned).
- **Adopt Vite** here (secrets, code-split, SRI) — low risk, already ES modules.
- → **Launch 1: desktop consumer web.**

### Phase D — Classroom product *(≈3–5 weeks; the revenue engine)*
- **`/teach` dashboard:** roster, class-code join, progress matrix, assign-lesson, CSV export.
- **Tablet/touch is a gate here:** reposition guide+HUD ≤1024px so they don't occlude the scene; touch affordance (or a 2D pin-list fallback) for assembly/wiring.
- Full **a11y to AA** (keyboard wiring path), **compliance execution** (privacy policy, ToS, DPA, deletion endpoint — lawyer-reviewed), **standards map validated by a real teacher**.
- → **Launch 2: classroom.** (Never marketed to schools before this.)

### Phase E — Content & virality *(parallel / ongoing)*
- **5 rover lessons** — turn the built-but-orphaned rover into real breadth (doubles replayable content).
- **Shareable build URLs** — encode the existing save JSON into a link; cheapest viral loop.
- Retention: cosmetic unlocks + ghost replay (Phase-4 backlog).

### Cross-cutting / later bet
- **Real sketch execution (avr8js)** — strategic upsell, *not* a launch dependency. Refactor the 970-line `sim.js` before it becomes the bottleneck for sensors/new robots.

---

## The one thing to do this week
Ship **Phase A** (nearly free and entirely missing), and **create the Supabase project** —
the hard dependency gating all revenue work. That clock only starts when the project exists.
