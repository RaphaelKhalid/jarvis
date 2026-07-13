// Resilience + observability: a friendly fatal fallback for the two things that
// silently kill a WebGL/WASM app on unknown devices (no WebGL, boot crash), plus
// a global error/rejection reporter. Reporting is a no-op sink today (console +
// an in-page ring buffer) with a single hook point to attach a real backend
// (Sentry-equivalent) later — deliberately dependency-free.

const MAX_BUFFER = 50;

/** In-page ring buffer of captured errors — inspect via window.__gyroErrors. */
export const errorBuffer = [];

/** The single hook point a real reporter attaches to later. */
let sink = (entry) => { /* no-op sink; console logging happens in report() */ void entry; };

/** Swap the no-op sink for a real reporter (e.g. Sentry) when one is wired up. */
export function setErrorSink(fn) { if (typeof fn === 'function') sink = fn; }

function report(kind, err) {
  const entry = {
    kind,
    message: String((err && (err.stack || err.message)) || err),
    t: Date.now(),
  };
  errorBuffer.push(entry);
  if (errorBuffer.length > MAX_BUFFER) errorBuffer.shift();
  console.error(`[GYRO:${kind}]`, err);
  try { sink(entry); } catch { /* a broken sink must never cascade */ }
}

/** Install global handlers. Call once, as early as possible in boot. */
export function installErrorBoundary() {
  window.__gyroErrors = errorBuffer;
  window.addEventListener('error', (e) => report('error', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => report('rejection', e.reason));
  const reload = document.getElementById('fatal-reload');
  if (reload) reload.addEventListener('click', () => window.location.reload());
}

/** True if the browser/GPU can actually create a WebGL context. */
export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch { return false; }
}

/** Show the blocking friendly fallback and stop pretending the app booted. */
export function showFatal(message) {
  const el = document.getElementById('fatal');
  if (!el) return;
  if (message) {
    const msg = document.getElementById('fatal-msg');
    if (msg) msg.textContent = message;
  }
  el.classList.remove('hidden');
  report('fatal', message || 'fatal boot failure');
}
