// RobotDoc v2 persistence: localStorage + shareable #build= URL, with a v1→v2
// migration (the old placedCount/wires save loads as a doc). This is the same
// forward-compatible JSON a cloud document holds.
import { DOC_VERSION, emptyDoc } from '../model/doc.js';

const DOC_KEY = 'gyro-doc-v2';
const LEGACY_PREFIX = 'sbl-save-v1';   // old placedCount-based slots

function encode(obj) {
  const b64 = window.btoa(window.unescape(encodeURIComponent(JSON.stringify(obj))));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(window.escape(window.atob(b64))));
  } catch { return null; }
}

// Old save { placedCount:{type:n}, wires:[[a,b]], robotId } → a RobotDoc. Old
// endpoint ids were "compType.pin"; single instances map to compId === type.
function migrateV1(old) {
  if (!old || !old.placedCount) return null;
  const doc = emptyDoc(old.robotId || 'self-balancer');
  for (const [type, n] of Object.entries(old.placedCount)) {
    if (type === 'motor' && n >= 1) {
      // two sided motors under one card in the old model
      if (n >= 1) doc.components.push(comp('motorL', 'motorL'));
      if (n >= 2) doc.components.push(comp('motorR', 'motorR'));
    } else {
      doc.components.push(comp(type, type));
    }
  }
  // rebuild nets from wire edges via a quick union (reuse patch layer indirectly)
  const edges = (old.wires || []).map(([a, b]) => [a, b]);
  doc.nets = edgesToNets(edges);
  if (typeof old.sketch === 'string') doc.code = { sketch: old.sketch, target: 'arduino-uno' };
  return doc;
}
function comp(id, type) {
  return { id, type, params: {}, transform: { pos: [0, 1, 0], rot: [0, 0, 0] } };
}
function edgesToNets(edges) {
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const [a, b] of edges) parent.set(find(a), find(b));
  const groups = new Map();
  for (const k of parent.keys()) { const r = find(k); (groups.get(r) || groups.set(r, []).get(r)).push(k); }
  let i = 0; const nets = [];
  for (const eps of groups.values()) if (eps.length >= 2) nets.push({ id: `n${++i}`, endpoints: [...new Set(eps)].sort(), color: '#e33' });
  return nets;
}

function readLegacy() {
  try {
    for (const key of [`${LEGACY_PREFIX}:self-balancer`, LEGACY_PREFIX]) {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    }
  } catch {}
  return null;
}

// Wire the API to persistence. Returns { shareUrl }.
export function initDocSave(api, { onFlash } = {}) {
  // 1) incoming shared build (#build=) wins
  const sharedRaw = (window.location.hash.match(/build=([^&#]+)/) || [])[1];
  const shared = sharedRaw ? decode(sharedRaw) : null;

  // 2) else stored v2 doc
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(DOC_KEY) || 'null'); } catch {}

  // 3) else migrate a legacy v1 save
  const migrated = (!shared && !stored) ? migrateV1(readLegacy()) : null;

  const initial = (shared && shared.v === DOC_VERSION && shared) ||
                  (stored && stored.v === DOC_VERSION && stored) ||
                  migrated;
  if (initial) {
    api.loadDocument(initial);
    if (shared) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch {}
      onFlash?.('Loaded a shared build', 'ok');
    }
  }

  // persist on every doc change (debounced)
  let timer = null;
  api.getHistory().onChange = (doc) => {
    clearTimeout(timer);
    timer = setTimeout(() => { try { localStorage.setItem(DOC_KEY, JSON.stringify(doc)); } catch {} }, 200);
  };

  function shareUrl() {
    const doc = api.get_document();
    return `${window.location.origin}${window.location.pathname}#build=${encode(doc)}`;
  }
  return { shareUrl };
}
