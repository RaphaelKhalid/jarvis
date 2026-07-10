# Go-to-market plan (execution owner: Raphael; Claude drafts assets)

## Positioning
"A virtual robotics lab — build, wire, code, and tune a real control system, no hardware required."
Wedge vs Tinkercad/Wokwi/CoderZ: **visceral balancing physics + genuine PID pedagogy**.

## Pricing (implemented on the site; needs Stripe + RevenueCat accounts)
- Free: sandbox + Circuits + first Balance lessons (the free tier is the marketing)
- GYRO Plus: $6.99/mo or $39.99/yr (web via Stripe, iOS via StoreKit, unified by RevenueCat)
- Classroom: $99/class/yr, up to 35 students, **web-only checkout** (avoids Apple 30%, matches school procurement)

## Launch sequence
1. **Soft launch**: deploy app + site on Vercel; recruit 5 pilot teachers (free Classroom for a semester ⇄ testimonial + case study). Sources: r/Physics, r/ScienceTeachers, CSTA/ISTE communities, personal network.
2. **Product Hunt + Hacker News**: the sim demos itself — lead with a 60s GIF of wipeout→recovery. HN title idea: "Show HN: A browser sim where you wire and PID-tune a self-balancing robot".
3. **App Store**: submit after web validation; pitch for Education category featuring (Apple loves education + no-IAP-required apps).
4. **SEO content**: 3 articles — "Teach PID with a robot that actually falls over", "Wiring an MPU6050: interactive guide", "NGSS-aligned robotics without a robotics budget".

## Accounts the user must create (blockers)
- [ ] Stripe (web payments) — needed for Plus/Classroom
- [ ] RevenueCat (entitlement sync web+iOS)
- [ ] Supabase project (see supabase/schema.sql)
- [ ] Apple Developer Program (see docs/APPSTORE_CHECKLIST.md)
- [ ] Domain (gyro.app-style; check availability)

## Metrics that matter (first 90 days)
- Activation: % of new visitors who reach sim mode (target 40%+ — the tutorial's job)
- Lesson 1 completion rate; free→Plus conversion (target 2–4%)
- Teacher pilot → paid conversion (target 3 of 5)
