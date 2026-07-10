// Versioned save/load of assembly state (localStorage, schema v1).
// The same payload later becomes the cloud-sync document — keep it
// forward-compatible: ignore unknown keys, gate migrations on `v`.
import { PART_DEFS } from '../parts.js';
import { DEFAULT_SKETCH } from '../editor.js';

const KEY = 'sbl-save-v1';

// Placement is deterministic (first free slot per type), so per-type counts
// fully reproduce the board; wires are endpoint-id pairs.
export function captureState({ assemblyApi, wiring, getSketch }) {
  const placedCount = {};
  for (const { compType } of Object.values(assemblyApi.placed)) {
    // motorL/motorR both come from the single 'motor' tray card
    const type = compType.startsWith('motor') ? 'motor' : compType;
    placedCount[type] = (placedCount[type] || 0) + 1;
  }
  return {
    v: 1,
    ts: Date.now(),
    placedCount,
    wires: wiring.wires.filter(w => w.idA && w.idB).map(w => [w.idA, w.idB]),
    sketch: getSketch(),
  };
}

export function initSave({ assemblyApi, wiring, getSketch, setSketch }) {
  let timer = null;
  function persist() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const s = captureState({ assemblyApi, wiring, getSketch });
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {}
    }, 400);
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s.v !== 1) return null;   // future: version-gated migrations
      return s;
    } catch { return null; }
  }

  function isMeaningful(s) {
    if (!s) return false;
    const hasParts = Object.values(s.placedCount || {}).some(n => n > 0);
    const sketchChanged = typeof s.sketch === 'string' && s.sketch !== DEFAULT_SKETCH;
    return hasParts || (s.wires || []).length > 0 || sketchChanged;
  }

  function restore(s) {
    for (const def of PART_DEFS) {
      const n = Math.min(s.placedCount?.[def.type] || 0, def.count);
      for (let i = 0; i < n; i++) assemblyApi.placeByType(def.type);
    }
    for (const [a, b] of s.wires || []) {
      try { wiring.tryConnect(a, b); } catch {}
    }
    if (typeof s.sketch === 'string' && s.sketch !== getSketch()) setSketch(s.sketch);
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch {}
  }

  // resume / start-fresh prompt (only when a meaningful save exists)
  const saved = load();
  if (isMeaningful(saved)) {
    const bar = document.createElement('div');
    bar.id = 'resume-bar';
    bar.innerHTML = `
      <span>Welcome back — resume your build?</span>
      <button id="resume-yes">Resume</button>
      <button id="resume-no">Start fresh</button>`;
    document.body.appendChild(bar);
    document.getElementById('resume-yes').addEventListener('click', () => {
      restore(saved);
      bar.remove();
    });
    document.getElementById('resume-no').addEventListener('click', () => {
      clear();
      bar.remove();
    });
  }

  return { persist, clear };
}
