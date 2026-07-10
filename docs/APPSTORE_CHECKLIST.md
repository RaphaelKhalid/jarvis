# iOS ship checklist (Phase 6)

## User-supplied prerequisites (blockers — do these first)
- [ ] Apple Developer Program membership ($99/yr) under your name/company
- [ ] A Mac with Xcode (Capacitor iOS builds require Xcode; cannot build on Windows)
- [ ] Decide the bundle id (proposed: `com.gyro.lab`)

## Capacitor setup (run on the Mac)
```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios
npm i @capacitor/haptics @capacitor/status-bar @capacitor/app
npx cap init "GYRO Lab" com.gyro.lab --web-dir .
npx cap add ios
npx cap open ios
```
Note `--web-dir .` — the app is zero-build static files; the whole repo root is the bundle
(add `ios/`, `node_modules/`, `tests/`, `docs/` to `.capacitorignore`-equivalent via
`server: { }` config and Xcode target membership, or introduce a small copy step that
stages only index.html + css/ + js/ + assets/ into `www/`). **Prefer the staging step**:
CDN deps (import map) must be vendored locally for offline + review reliability —
download three.js, Rapier wasm, CodeMirror, fonts into `vendor/` and swap the import map
when building the iOS bundle.

## App behavior requirements
- [ ] Pause the sim on `appStateChange` → background (clamp accumulated dt on resume — the fixed-timestep loop in sim.js will otherwise fast-forward)
- [ ] Audio unlock on first touch (already handled by pointerdown resume)
- [ ] Safe-area insets (touch controls already use env(safe-area-inset-*))
- [ ] Orientation: allow both on iPad; prefer landscape in sim
- [ ] Haptics: bump on landing, buzz on wipeout, tick on lesson complete

## Store listing
- [ ] Screenshots: 6.7" iPhone + 13" iPad (assembly, wiring glow, sim jump, lesson card)
- [ ] Preview video ≤30s: auto-wire → upload → balance → ramp jump
- [ ] Age rating 4+; category Education
- [ ] Privacy nutrition labels per docs/COMPLIANCE.md (no tracking)
- [ ] Sign in with Apple IF any other social login is offered (magic-link-only avoids this)
- [ ] TestFlight external beta (≥10 testers) before review submission
