// Funnel instrumentation — the activation path GTM cares about:
//   load → place → connect_ok → circuit_ok → run_enter   (+ share)
//
// CIRCUIT_OK is the activation metric ("first working circuit"): the first time
// the solver reports a valid circuit with real current flowing through a load.
// It's the moment the product's whole premise pays off, and unlike "reached RUN"
// it can't be hit by mashing buttons.
//
// Privacy-safe by construction: no PII, no external network calls today. Events
// go to a no-op sink (console in dev + an in-page ring buffer at window.__gyroFunnel).
// The instrumentation exists now so an onboarding redesign is measured, not vibes;
// flip on a real destination later via setAnalyticsSink() (Plausible/PostHog/
// serverless) without touching any call sites.

export const EVENTS = Object.freeze({
  LOAD: 'load',
  PLACE: 'place',
  CONNECT_OK: 'connect_ok',       // a wire the API accepted
  CONNECT_FAIL: 'connect_fail',   // a rejected pin pair — where users get stuck
  CIRCUIT_OK: 'circuit_ok',       // ★ activation: first solved circuit with current
  RUN_ENTER: 'run_enter',         // entered the RUN physics sim
  JARVIS_MSG: 'jarvis_msg',       // user sent the assistant a message
  JARVIS_TOOL: 'jarvis_tool',     // the assistant mutated the build
  SHARE: 'share',                 // virality signal — copied a shareable build link
});

const buffer = [];
const fired = new Set();
let sink = (evt) => { void evt; };  // no-op destination

/** Attach a real analytics destination later. */
export function setAnalyticsSink(fn) { if (typeof fn === 'function') sink = fn; }

/** Record an event with optional non-PII properties. */
export function track(event, props = {}) {
  const entry = { event, props, t: Date.now() };
  buffer.push(entry);
  if (buffer.length > 200) buffer.shift();
  window.__gyroFunnel = buffer;
  const dev = /[?&]debug\b/.test(window.location.search) || window.location.hostname === 'localhost';
  if (dev) console.debug('[GYRO:funnel]', event, props);
  try { sink(entry); } catch { /* a broken sink must never break the app */ }
}

/** Fire a one-time funnel milestone (idempotent across the session). */
export function trackOnce(event, props = {}) {
  if (fired.has(event)) return;
  fired.add(event);
  track(event, props);
}

// ── PostHog destination (privacy-locked for an app used by minors) ──
// Publishable project key — safe client-side. Loaded from the CDN import map
// and attached as the sink; a load failure is swallowed (analytics is optional).
const POSTHOG_KEY = 'phc_ycRR256Tj6aiwzgrng3pHmsZ7pNaLxZioej4sCvVuANo';
const POSTHOG_HOST = 'https://us.i.posthog.com';

export async function initAnalytics() {
  if (!POSTHOG_KEY) return;
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      persistence: 'localStorage',       // cookieless
      autocapture: false,                // no incidental DOM/PII capture
      capture_pageview: false,           // we send an explicit LOAD event
      capture_pageleave: false,
      disable_session_recording: true,   // never record minors' screens
      person_profiles: 'identified_only',// we never identify → anonymous events only
    });
    setAnalyticsSink((entry) => { try { posthog.capture(entry.event, entry.props); } catch { /* ignore */ } });
    // replay anything captured before the async import resolved (e.g. LOAD)
    for (const e of buffer) posthog.capture(e.event, e.props);
  } catch { /* CDN blocked / offline — stay on the no-op sink */ }
}
