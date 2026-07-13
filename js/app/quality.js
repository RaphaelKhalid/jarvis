// Device quality tier: shed the most expensive rendering on weak devices
// (iPads, low-memory laptops) so the sim holds near 60fps — the MASTER_PLAN bar
// is 60fps on a 9th-gen iPad. Resolved once at boot. Override with
// ?quality=low|high in the URL, or the persisted 'sbl-quality' key.
//
// Consumers: scene.js caps pixel ratio (which drives the bloom pass resolution)
// and softens bloom on 'low'; sim.js drops terrain mesh/collider density.

const KEY = 'sbl-quality';

function detect() {
  try {
    const forced = new window.URLSearchParams(window.location.search).get('quality');
    if (forced === 'low' || forced === 'high') return forced;
    const saved = localStorage.getItem(KEY);
    if (saved === 'low' || saved === 'high') return saved;
  } catch { /* private mode / blocked storage — fall through to heuristic */ }
  // heuristic: little memory, few cores, or a coarse (touch) pointer
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return (mem <= 4 || cores <= 4 || coarse) ? 'low' : 'high';
}

let cached = null;

/** 'low' | 'high' — resolved once per session. */
export function quality() { return cached || (cached = detect()); }

/** Convenience predicate for the render/physics hot paths. */
export function isLowQuality() { return quality() === 'low'; }

/** Persist an explicit choice (takes effect on next load). */
export function setQuality(v) {
  if (v !== 'low' && v !== 'high') return;
  try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
}
