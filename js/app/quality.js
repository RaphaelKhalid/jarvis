// Device quality tier: shed the most expensive rendering on weak devices
// (iPads, low-memory laptops) so the sim holds near 60fps — the MASTER_PLAN bar
// is 60fps on a 9th-gen iPad. Resolved once at boot. Override with
// ?quality=low|high in the URL, or the persisted 'sbl-quality' key.
//
// Consumers: scene.js caps pixel ratio (which drives the bloom pass resolution)
// and softens bloom on 'low'; sim.js drops terrain mesh/collider density.
//
// Public API (kept back-compatible):
//   quality()        -> 'low' | 'high'   (resolved once per session)
//   isLowQuality()   -> boolean
//   setQuality(v)    -> persist an explicit choice for the next load
// New (optional, additive — no consumer is required to read these):
//   qualityInfo()    -> the full detection record (signals + reason)
//   applySuggestedTier(v) -> apply a runtime auto-downgrade suggestion in-memory

const KEY = 'sbl-quality';

// Read a stored/forced override without running the heuristic. Returns
// 'low' | 'high' | null.
function override() {
  try {
    const forced = new window.URLSearchParams(window.location.search).get('quality');
    if (forced === 'low' || forced === 'high') return forced;
    const saved = localStorage.getItem(KEY);
    if (saved === 'low' || saved === 'high') return saved;
  } catch { /* private mode / blocked storage — no override */ }
  return null;
}

// Best-effort screen refresh estimate. The browser gives us no direct API, so
// callers may seed this via qualityInfo() consumers later; at boot we only have
// static hints. A 90/120Hz panel needs *more* headroom per-frame, but we treat
// a high-refresh coarse-pointer device (recent iPad Pro / phone) as capable.
function coarsePointer() {
  try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
  catch { return false; }
}

// Sniff Apple mobile hardware. iPadOS 13+ masquerades as desktop Safari
// (Macintosh UA + touch), so the classic "iPad" token check misses modern
// iPads — detect the touch-capable Mac case too.
function detectApple(ua, plat) {
  const isIOS = /\b(iPad|iPhone|iPod)\b/.test(ua);
  const touchMac = /\bMac(intosh)?\b/.test(plat + ' ' + ua)
    && (navigator.maxTouchPoints || 0) > 1;
  return { isIOS, touchMac, apple: isIOS || touchMac };
}

// Resolve the tier from device signals. Returns a record so it can be
// inspected/logged, not just the bare string.
function detect() {
  const forced = override();
  if (forced) return { tier: forced, reason: 'override', forced };

  const nav = (typeof navigator !== 'undefined') ? navigator : {};
  const ua = nav.userAgent || '';
  const plat = nav.platform || '';
  const mem = nav.deviceMemory || 8;          // GiB (Chromium only; else 8)
  const cores = nav.hardwareConcurrency || 8; // logical cores (else 8)
  const coarse = coarsePointer();
  const { apple, isIOS, touchMac } = detectApple(ua, plat);
  const mobileUA = /\b(Android|Mobile|Silk|Kindle)\b/.test(ua);

  // Weight several weak-device signals rather than a flat OR, so one generous
  // default (e.g. deviceMemory unavailable) can't alone pin a machine to 'high'
  // and one stingy signal can't alone drop a real desktop to 'low'.
  let score = 0;
  const reasons = [];
  if (mem <= 2) { score += 2; reasons.push('mem<=2'); }
  else if (mem <= 4) { score += 1; reasons.push('mem<=4'); }
  if (cores <= 2) { score += 2; reasons.push('cores<=2'); }
  else if (cores <= 4) { score += 1; reasons.push('cores<=4'); }
  if (mobileUA) { score += 2; reasons.push('mobile-ua'); }
  // A touch iPad/iPhone: keep them on 'low' — they hit thermal/GPU limits under
  // sustained bloom + physics well before a desktop of the same core count.
  if (apple && coarse) { score += 2; reasons.push(isIOS ? 'ios' : 'ipad-touchmac'); }
  else if (coarse) { score += 1; reasons.push('coarse-pointer'); }
  if (touchMac && !isIOS) reasons.push('ipados-desktop-ua');

  const tier = score >= 2 ? 'low' : 'high';
  return {
    tier, reason: reasons.join(',') || 'defaults', forced: null,
    signals: { mem, cores, coarse, apple, isIOS, touchMac, mobileUA, score },
  };
}

let record = null;      // full detection record, resolved once
let runtime = null;     // in-memory auto-downgrade override (this session only)

function resolve() { return record || (record = detect()); }

/** 'low' | 'high' — resolved once per session (runtime downgrade wins). */
export function quality() { return runtime || resolve().tier; }

/** Convenience predicate for the render/physics hot paths. */
export function isLowQuality() { return quality() === 'low'; }

/**
 * Full detection record — signals, weighted score, and the human-readable
 * reason the tier was chosen. Optional/diagnostic; consumers may ignore it.
 */
export function qualityInfo() {
  const r = resolve();
  return { ...r, tier: quality(), runtime };
}

/** Persist an explicit choice (takes effect on next load). */
export function setQuality(v) {
  if (v !== 'low' && v !== 'high') return;
  try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
}

/**
 * Apply a runtime auto-downgrade suggestion (e.g. from perf.js sustained-FPS
 * watchdog) for the current session only. Only a downgrade to 'low' takes
 * effect in-memory; an explicit URL/localStorage override is never clobbered.
 * Does NOT persist — call setQuality() to make it stick across loads.
 * Returns true if the in-memory tier changed.
 */
export function applySuggestedTier(v) {
  if (v !== 'low') return false;             // only ever auto-downgrade
  if (resolve().forced) return false;        // respect explicit user override
  if (runtime === v || quality() === v) return false;
  runtime = v;
  return true;
}
