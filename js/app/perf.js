// Dev-only performance HUD — establishes a perf baseline (FPS, frame-time
// spread, startup + WASM load) without touching the render loop. It runs its
// own requestAnimationFrame loop (rAF fires once per rendered frame regardless
// of who schedules it, so this measures true frame cadence) and is off by
// default. Turn it on with `?perf` in the URL or Alt+P; state persists.
//
// Baseline targets (see MASTER_PLAN perf budget): 60fps sustained on a 9th-gen
// iPad through a full lesson; Rapier WASM is the first big load on Upload.
//
// `window.__perf.mark(label)` records a one-shot timing (ms since page start) —
// main.js marks 'rapier' around the physics-engine load.

const KEY = 'sbl-perf';
const marks = {};

function on() {
  try { return new window.URLSearchParams(window.location.search).has('perf') || localStorage.getItem(KEY) === '1'; }
  catch { return false; }
}

export function initPerf() {
  // expose the API immediately, even when the HUD is hidden, so callers
  // (main.js) never need to null-check. `_render` is filled in only when the
  // HUD is actually visible.
  window.__perf = {
    _render: null,
    mark(label) { marks[label] = performance.now(); this._render?.(); },
    show(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } window.location.reload(); },
  };

  // Alt+P toggles the HUD for the next load.
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'p' || e.key === 'P')) window.__perf.show(!on());
  });

  if (!on()) return;

  const el = document.createElement('div');
  el.id = 'perf-hud';
  el.style.cssText =
    'position:fixed;bottom:8px;left:8px;z-index:9999;padding:6px 9px;' +
    'font:11px/1.45 "JetBrains Mono",monospace;color:#8dffce;' +
    'background:rgba(6,10,14,.82);border:1px solid #1c3a2e;border-radius:6px;' +
    'pointer-events:none;white-space:pre;';
  document.body.appendChild(el);

  let frames = 0, acc = 0, fps = 0, worst = 0, last = performance.now();
  const startup = performance.now();  // main.js runs at module load, so ~app boot

  function render() {
    const rapier = marks.rapier ? `\nrapier  ${(marks.rapier - startup) | 0}ms` : '';
    el.textContent =
      `fps ${fps.toString().padStart(3)}  worst ${worst.toFixed(1)}ms\n` +
      `boot ${startup | 0}ms${rapier}`;
  }
  window.__perf._render = render;

  function tick(now) {
    const dt = now - last; last = now;
    if (dt > worst && frames > 3) worst = dt;   // ignore the first noisy frames
    acc += dt; frames++;
    if (acc >= 500) { fps = Math.round(frames / (acc / 1000)); frames = 0; acc = 0; worst = 0; render(); }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  render();
}
