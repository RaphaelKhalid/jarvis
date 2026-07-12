// Versioned save/load of assembly state (localStorage, schema v1).
// The same payload later becomes the cloud-sync document — keep it
// forward-compatible: ignore unknown keys, gate migrations on `v`.
import { DEFAULT_SKETCH } from '../editor.js';
import { activeRobot } from '../robots/index.js';
import { state } from './state.js';

const LEGACY_KEY = 'sbl-save-v1';           // pre-multi-robot single slot (self-balancer)
const keyFor = (robotId) => `sbl-save-v1:${robotId}`;   // per-robot slot (schema version is `v`)
const SCHEMA = 2;            // v2 adds robotId (M3); v1 saves migrate on load

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
    v: SCHEMA,
    ts: Date.now(),
    robotId: state.activeRobotId,
    placedCount,
    wires: wiring.wires.filter(w => w.idA && w.idB).map(w => [w.idA, w.idB]),
    sketch: getSketch(),
  };
}

export function initSave({ assemblyApi, wiring, getSketch, setSketch }) {
  // per-robot storage slot, resolved now that bootActiveRobot() has set the id.
  const KEY = keyFor(state.activeRobotId);
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

  function parse(raw) {
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      // version-gated migrations. v1 predates multi-robot → default robotId.
      if (s.v === 1) { s.robotId = 'self-balancer'; s.v = SCHEMA; }
      if (s.v !== SCHEMA) return null;   // unknown/newer schema: ignore
      return s;
    } catch { return null; }
  }

  function load() {
    try {
      let s = parse(localStorage.getItem(KEY));
      // migrate the legacy single slot into the self-balancer's per-robot slot
      if (!s && state.activeRobotId === 'self-balancer') {
        s = parse(localStorage.getItem(LEGACY_KEY));
        if (s) { try { localStorage.setItem(KEY, JSON.stringify(s)); localStorage.removeItem(LEGACY_KEY); } catch {} }
      }
      return s;
    } catch { return null; }
  }

  function isMeaningful(s) {
    if (!s) return false;
    // a save belongs to the robot it was built for — don't offer to restore one
    // robot's board onto another (parts/wiring wouldn't match the active def)
    if ((s.robotId || 'self-balancer') !== state.activeRobotId) return false;
    const hasParts = Object.values(s.placedCount || {}).some(n => n > 0);
    const sketchChanged = typeof s.sketch === 'string' && s.sketch !== DEFAULT_SKETCH;
    return hasParts || (s.wires || []).length > 0 || sketchChanged;
  }

  function restore(s) {
    for (const def of activeRobot().parts) {
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
