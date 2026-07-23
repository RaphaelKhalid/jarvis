// Dev-only performance HUD — establishes a perf baseline (FPS, frame-time
// spread, startup + WASM load) without touching the render loop. It runs its
// own requestAnimationFrame loop (rAF fires once per rendered frame regardless
// of who schedules it, so this measures true frame cadence) and is off by
// default. Turn it on with `?perf` in the URL or Alt+P; state persists.
//
// Baseline targets (see MASTER_PLAN perf budget): 60fps sustained on a 9th-gen
// iPad through a full lesson; Rapier WASM is the first big load on Upload.
//
// Public API on `window.__perf` (always present after initPerf, even hidden):
//   mark(label)          record a one-shot timing (ms since page start).
//   show(v)              persist HUD on/off for the next load, then reload.
//   stats()              latest sampled metrics, or null when the HUD is off.
//   suggestedTier()      'low' | null — set when FPS is sustained under budget
//                        (auto-downgrade hint for main.js; null when off/OK).
//   onSuggestDowngrade(fn) subscribe to that hint firing once; returns an
//                        unsubscribe fn. main.js can wire this to
//                        quality.applySuggestedTier(...) — see report.
//   setRenderer(r)       optional: hand in the THREE.WebGLRenderer so the HUD
//                        can show draw-call / triangle / geometry counts from
//                        r.info (cheap: THREE already tracks these per frame).
//
// Everything is zero-cost when the HUD is disabled: no rAF loop, no watchdog,
// no renderer polling run unless `?perf`/Alt+P turned it on.

const KEY = 'sbl-perf';
const marks = {};

// Auto-downgrade thresholds: if effective FPS stays under BUDGET for
// SUSTAIN_MS of continuous running, we surface a 'low' suggestion once.
const BUDGET_FPS = 45;
const SUSTAIN_MS = 4000;

function on() {
  try { return new window.URLSearchParams(window.location.search).has('perf') || localStorage.getItem(KEY) === '1'; }
  catch { return false; }
}

export function initPerf() {
  let renderer = null;            // optional THREE renderer for r.info counts
  let latest = null;              // last sampled stats object (or null)
  let suggested = null;           // 'low' once the FPS watchdog trips
  const downgradeSubs = new Set();

  // expose the API immediately, even when the HUD is hidden, so callers
  // (main.js) never need to null-check. `_render` is filled in only when the
  // HUD is actually visible.
  window.__perf = {
    _render: null,
    mark(label) { marks[label] = performance.now(); this._render?.(); },
    show(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } window.location.reload(); },
    stats() { return latest; },
    suggestedTier() { return suggested; },
    setRenderer(r) { renderer = r || null; },
    onSuggestDowngrade(fn) {
      if (typeof fn !== 'function') return () => {};
      downgradeSubs.add(fn);
      if (suggested) { try { fn(suggested); } catch { /* ignore */ } }
      return () => downgradeSubs.delete(fn);
    },
  };

  // Alt+P toggles the HUD for the next load.
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'p' || e.key === 'P')) window.__perf.show(!on());
  });

  if (!on()) return;             // zero-cost when disabled — nothing below runs

  const el = document.createElement('div');
  el.id = 'perf-hud';
  el.style.cssText =
    'position:fixed;bottom:8px;left:8px;z-index:9999;padding:6px 9px;' +
    'font:11px/1.45 "JetBrains Mono",monospace;color:#8dffce;' +
    'background:rgba(6,10,14,.82);border:1px solid #1c3a2e;border-radius:6px;' +
    'pointer-events:none;white-space:pre;min-width:150px;';
  document.body.appendChild(el);

  let frames = 0, acc = 0, fps = 0, worst = 0, last = performance.now();
  const startup = performance.now();  // main.js runs at module load, so ~app boot

  // Rolling ring of recent frame times for avg + p95 across the last ~2s.
  const RING = 120;
  const ring = new Float32Array(RING);
  let ringN = 0, ringI = 0;

  // Continuous time (ms) spent below the FPS budget, for the downgrade watchdog.
  let underBudgetMs = 0;

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[i];
  }

  function sample() {
    const n = Math.min(ringN, RING);
    let sum = 0;
    const buf = new Array(n);
    for (let k = 0; k < n; k++) { const v = ring[k]; buf[k] = v; sum += v; }
    buf.sort((a, b) => a - b);
    const avg = n ? sum / n : 0;
    const p95 = percentile(buf, 95);

    // Memory (Chromium only): used / limit heap in MB.
    let mem = null;
    const pm = performance.memory;
    if (pm && pm.usedJSHeapSize) {
      mem = { used: pm.usedJSHeapSize / 1048576, limit: pm.jsHeapSizeLimit / 1048576 };
    }

    // Renderer counts (cheap — THREE maintains these on r.info each frame).
    let gpu = null;
    if (renderer && renderer.info) {
      const ri = renderer.info;
      gpu = {
        calls: ri.render ? ri.render.calls : 0,
        tris: ri.render ? ri.render.triangles : 0,
        geometries: ri.memory ? ri.memory.geometries : 0,
        textures: ri.memory ? ri.memory.textures : 0,
      };
    }

    latest = { fps, avg, p95, worst, mem, gpu, marks: { ...marks } };
    return latest;
  }

  function fmtMarks() {
    let out = '';
    for (const k of Object.keys(marks)) out += `\n${k.padEnd(7)}${(marks[k] - startup) | 0}ms`;
    return out;
  }

  function render() {
    const s = latest;
    let txt = `fps ${fps.toString().padStart(3)}   avg ${(s ? s.avg : 0).toFixed(1)}ms\n`;
    txt += `p95 ${(s ? s.p95 : 0).toFixed(1)}ms  worst ${worst.toFixed(1)}ms`;
    if (s && s.gpu) txt += `\ncalls ${s.gpu.calls}  tris ${(s.gpu.tris / 1000).toFixed(1)}k`;
    if (s && s.gpu) txt += `\ngeo ${s.gpu.geometries}  tex ${s.gpu.textures}`;
    if (s && s.mem) txt += `\nheap ${s.mem.used.toFixed(0)}/${s.mem.limit.toFixed(0)}MB`;
    txt += `\nboot ${startup | 0}ms${fmtMarks()}`;
    if (suggested) txt += `\n⚠ suggest quality:low`;
    el.textContent = txt;
  }
  window.__perf._render = render;

  function trip() {
    if (suggested) return;
    suggested = 'low';
    for (const fn of downgradeSubs) { try { fn(suggested); } catch { /* ignore */ } }
    render();
  }

  function tick(now) {
    const dt = now - last; last = now;
    if (dt > worst && frames > 3) worst = dt;   // ignore the first noisy frames
    if (frames > 3) { ring[ringI] = dt; ringI = (ringI + 1) % RING; ringN++; }
    acc += dt; frames++;

    // Watchdog: accumulate continuous time under the FPS budget on a per-frame
    // basis so a sustained slump (not a single hitch) trips the suggestion.
    const instFps = dt > 0 ? 1000 / dt : 999;
    if (instFps < BUDGET_FPS) { underBudgetMs += dt; if (underBudgetMs >= SUSTAIN_MS) trip(); }
    else { underBudgetMs = 0; }

    if (acc >= 500) {
      fps = Math.round(frames / (acc / 1000));
      frames = 0; acc = 0; worst = 0;
      sample(); render();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  sample(); render();
}
