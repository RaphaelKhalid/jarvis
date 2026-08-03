# YC application — working doc

Synthesis of a three-way founder review (product/market, traction/GTM, tech/risk) run 2026-08-03. Where the three disagreed, the disagreement is recorded rather than smoothed over.

---

## 1. What we're building (the one-liner)

> **JARVIS is an AI-native electronics and robotics lab in the browser — describe what you want and watch it get built, wired, and simulated on a real circuit solver and real physics.**

Rejected alternatives and why:

- *"Tinkercad Circuits with real physics and an AI copilot"* — anchors us to a free Autodesk product and frames us as a clone with extras. Losing frame in a 10-minute interview.
- *"A browser sandbox where you build real electronics with a true circuit solver and rigid-body physics"* — accurate, but leads with a feature list and doesn't explain why this couldn't have been built in 2021.

The chosen line leads with the only genuinely novel asset: one typed mutation authority that the human and the model both drive.

## 2. Beachhead

**US high-school / early-college intro electronics and engineering teachers — CTE and Project Lead The Way / Principles of Engineering classrooms.** Per-class site license.

Ruled out, with reasons:

| Wedge | Why not |
|---|---|
| Hobbyist makers | Don't pay for simulators; they buy $12 of parts. "No hardware needed" is a *classroom* value. |
| K-12 / homeschool parents | Our own user test: "maybe a small amount… right now it feels like a toy demo." That's a $5/mo maybe. |
| University intro EE | Already on LTspice/Falstad; won't accept a 16-component library. |
| Competition teams | Locked to VEX/FIRST toolchains. |
| District B2B | The end state, not the wedge — 9-month cycles, and we have no DPA. |

The wedge is real because an intro-electronics lab is the most budget- and time-constrained thing in a CTE department: consumable parts, fried components, eight raised hands a minute.

**Pricing: $149/teacher/yr, up to 35 seats.** Raised from the $99 in `GTM.md` — $99 reads as toy and sits below the threshold where some districts even bother; $149 is still under most teachers' no-PO limit and doubles ARPA.

**Do not build Stripe before applying.** Take money by invoice. "Three schools paid us $447 by invoice" is a stronger application line than "we integrated Stripe," and building checkout for zero customers reads as avoidance. The entitlement rails (`profiles.tier`) already exist; flip five rows by hand.

## 3. Why now

1. **Tool-calling LLMs became reliable and cheap enough to be a UI, not a chatbot.** "Build me a circuit that blinks an LED" is now a ~$0.0002 action against a validated document that rejects invalid ops. In 2023 you'd have gotten a hallucinated netlist. AI is what removes the wiring wall — the exact place both test users nearly quit.
2. **The browser became a real simulation target.** Rapier via WASM + WebGL2 = rigid-body physics at 60fps on a school iPad, zero install — the only distribution a locked-down district actually allows.
3. **1:1 device saturation + Perkins V CTE funding.** Every student has a Chromebook and no lab bench.

## 4. Competition — honest version

**Where we win:**
- *Tinkercad Circuits* (the real incumbent — free, Autodesk, already on district approved-tool lists): no mechanical physics, no AI. You can't drive what you built.
- *Wokwi / Falstad / CircuitVerse*: engineer tools. MCU-emulation-first, 2D analog, digital-logic-only respectively. No 3D, no physics, no teacher layer.
- *VEXcode VR / CoSpaces / Roblox*: robots with fake electronics. We're the only one where reversed polarity actually reverses the motor and a short raises a violation.

**Where we're behind — say it out loud before they find it:**
- **No microcontroller.** Tinkercad and Wokwi execute real Arduino firmware. We don't execute anything. Half of "intro to electronics" is code. This is the largest product gap, not a rounding error.
- **16 components** vs. Tinkercad's hundreds. No ICs, no breadboard.
- **Free vs. free.** Tinkercad is free forever from Autodesk. We have to be worth $149 *because of the teacher layer*, not the sim.
- **We are not on any approved-tools list**, and we have never confirmed the app loads through a school content filter.

## 5. The technical story

**What's genuinely hard:** the MNA solver (`js/sim/circuit.js`) — proper stamping, an internal node synthesized so a source stays ideal while modelling its internal resistance, piecewise-linear diodes resolved by state iteration, motor back-EMF entering as a known source, and `motorTorque()` closing the loop back into physics. Writing that once is a week; keeping it correct while the document mutates from three different mutators is the hard part. Plus purity as a discipline: the solver and model import no THREE and touch no DOM, which is why `mcp/` runs the *identical* code server-side instead of a second implementation that drifts.

**What's a weekend:** the tray/drag/wire UI, the bezier wires, the Inspector fields, the Edge proxy, and the MCP server itself.

**The right answer to "why can't Tinkercad ship this in a month?"** — reframe it. Tinkercad has a *better* solver; it runs actual AVR firmware. What they can't ship in a month is an **agent-writable design document**. Their edit surface is a UI event stream, not a typed, undoable, dry-runnable API whose tool schemas are a mechanical transform of its method signatures. Retrofitting a single mutation authority into a decade-old codebase is a rewrite, not a sprint.

**The sharpest version of the architecture claim** (and it is one function call from being true):

> Every LLM-driven design tool has the same failure mode: the model proposes an edit, the edit is wrong, and nobody knows until a human looks. JARVIS makes wrongness machine-checkable in the same turn. `dryRun` computes the post-edit document without committing it, and because `solveCircuit` is pure, we can solve the counterfactual. The agent can ask "if I wire this, does it short?" and get *physics* back, before the user sees anything.

Today the loop is act-then-check. Propose-verify-commit is the moat. That gap is the 30-day build (§7).

## 6. Top risks

1. **DC-only, and firmware is not executed.** The moment a user builds anything with a microcontroller — i.e. actual robotics — the simulation is a lie. *Mitigation: don't chase AC/transients; chase firmware execution* (an interpreted subset or an AVR8js-class emulator whose GPIO writes become `set_param` calls through the same API — a natural extension of the mutation-authority bet, not a separate system).
2. **Silent numerical wrongness.** `solveLinear` is dense Gaussian and `continue`s on a singular column instead of flagging it; the diode loop can exhaust its iteration cap and return the last state with no violation raised. *Cheap fix: emit a `code:'unsolvable'` violation on singular pivots and non-convergence.* Turns silent wrongness into a UI message.
3. **Gemini dependency + unbounded cost.** The free-tier quota gate is client-side localStorage — clear storage and it's gone. One motivated classroom exhausts the shared key and Jarvis dies for everyone. *Move the gate server-side into `api/jarvis.js` before any real traffic.*
4. **Perf on school iPads.** Two Rapier worlds, a bloom composer, a 400ms Inspector poll, and an O(n³) re-solve. *Memoize the solve on `doc.meta.revision`.*
5. **CDN fragility.** Zero build step means one CDN outage is total downtime, with no integrity pinning. *Vendor the import map to a self-hosted `/vendor` — keeps zero-build, removes the third-party runtime dependency.*

## 7. The plan

### The 30-day build (one thing)

**`propose(patches) → { doc, solve, violations, diff }` — dry-run *plus solve*, exposed as an agent tool, with the proposed wiring rendered as a ghost the user accepts or rejects.**

Roughly a day of solver work (`history.commit` already returns the uncommitted doc; `solveCircuit` is already pure); the rest is the tool schema, the ghost render in `sync()`, and a spec asserting a proposed short is caught *before* commit.

Why this one: in an interview you type "wire the LED straight to the battery," and Jarvis answers *"that draws 0.6 A through a 30 mA part — I'd add a 220 Ω resistor,"* having actually solved the counterfactual without touching the build. No other education-sim or LLM-CAD tool can do that. It converts the architecture from a claim into a live demo.

### The 30-day GTM (one thing)

**Ten live classroom sessions.** Not a launch. Direct outbound to middle/high-school STEM and CTE teachers via r/ScienceTeachers, CSTA local chapters, and cold email to FIRST/VEX mentors with public roster emails. The ask: *"Your class has 25 minutes of dead time. Send them this URL. No install, no login. I'll be on Zoom watching. In exchange, 20 minutes after."*

Not a Show HN — that's a spike of anonymous bounces and one number you can't defend. Ten classrooms is ~250 real users *plus* the thing YC actually weights pre-launch: "we talked to 30 teachers, here's what they said, here's what we changed."

### The number

**First Working Circuit (FWC) rate** — % of first-time visitors who reach a solved circuit with real current through a load, in their first session. Now instrumented as `circuit_ok` (shipped 2026-08-03).

- < 15% — embarrassing; wiring is still the wall.
- 25–35% — normal-good.
- \> 45% unassisted — genuinely quotable.

**The killer secondary stat is the split: FWC with Jarvis vs. without.** If Jarvis takes 20% → 60%, that single chart *is* the application.

### 30 / 60 / 90

**Day 30**
- [x] `connect_ok` / `circuit_ok` / `run_enter` / `jarvis_*` events shipped; funnel live
- [ ] **Confirm the app loads on ≥3 real district networks / school iPads** — kill-criterion; if WebGL is filtered, the school GTM is dead and we need to know before applying, not after
- [ ] Jarvis quota enforced server-side
- [ ] `propose()` shipped with the ghost-preview demo
- [ ] 50 teacher emails sent; 10 sessions run; ≥200 unique first-time users
- [ ] Baseline FWC measured; 20 teacher interviews logged verbatim

**Day 60**
- [ ] Top-2 FWC drop-offs fixed from real data
- [ ] FWC ≥ 35%; Jarvis-assisted vs. unassisted delta quantified
- [ ] 3 teachers return unprompted (retention — the only signal that matters)
- [ ] **First money, by invoice** — 2 classrooms at $149
- [ ] Share-loop k-factor measured; consumer thread kept or killed on that number

**Day 90**
- [ ] 25 classrooms, ~600 students, ≥8 paying (~$1,200 ARR)
- [ ] ≥10 weekly-active teachers
- [ ] Privacy policy + DPA template (hard gate on district deals)
- [ ] Stripe *only if* ≥5 have asked to self-serve

## 8. The question they will actually ask

> "You have zero users after a year. Your one real user test said the *curriculum* was the strongest part and the sandbox felt like a toy demo — and you responded by deleting the curriculum and keeping the unmonetized sandbox. You also shelved the classroom layer, which is the one thing your prospective buyer said he'd write a PO for. You deleted the value and shelved the revenue. Why is this not a founder building the fun part?"

**The honest answer:** partly right. What we actually learned is that the curriculum was strong *content* on a build surface so rigid it made exactly one robot — 20 hand-authored lessons is a ceiling, not an engine. A solver plus a tool-calling API generates infinite correct builds *and can check them*, which is the machinery a teacher's assignment/assessment layer needs anyway. But the sequencing was wrong: curriculum should have been ported onto the sandbox, not deleted ahead of it. The fix, in order: (1) verify the app survives a school network, (2) rebuild the roster + dashboard on the solver as an assignment-and-autograde layer, (3) get 5 paid pilot classrooms before adding a single new component. If we can't get one teacher to pay $149 in a semester, the thesis is wrong and we'll know in 90 days, not two years.

## 9. Where the reviewers disagreed

- **Is the one-API bet a moat?** Tech said yes *conditionally* — only once `propose()` makes wrongness checkable pre-commit; until then it's a nice-to-have with good rhetoric. Product treated it as already load-bearing. Resolve by shipping §7.
- **MCP as a second product** (a verification backend other agents call). Tech: real, but a year-two wedge that needs AC/transient to be credible outside a classroom — mention it as *why the architecture is shaped this way*, don't lead with it. GTM didn't rate it at all.
- **Consumer vs. schools.** GTM wants the share-loop k-factor measured and the consumer thread killed on the number. Product would kill it now. Cheap to measure; measure it.
