// RobotDoc v2 — the single source of truth for a build.
//
// Shape:
//   { v:2, robotId, name, components[], nets[], code?, sim, meta }
//   component = { id, type, params, transform:{pos,rot}, slot? }
//   net       = { id, endpoints:[ "compId.pin", ... ], color }
//
// Endpoint ids are "compId.pin". Nets are the connectivity graph; a wire is
// just an edge, and nets are the connected components (union-find) of those
// edges. This module is pure — no THREE, no DOM — so it is trivially testable
// and is the exact schema a Jarvis tool call will emit.

export const DOC_VERSION = 2;

// ── construction ────────────────────────────────────────────────
// `robotId` is vestigial: it identified which pre-pivot RobotDef a build
// belonged to, and that registry is gone. It stays in the schema (and keeps its
// old default) only so documents saved by earlier versions round-trip unchanged.
export function emptyDoc(robotId = 'self-balancer', name = 'Untitled build') {
  return {
    v: DOC_VERSION,
    robotId,
    name,
    components: [],
    nets: [],
    code: null,
    sim: { gravity: -9.81, seed: 42 },
    meta: { createdBy: 'user', revision: 0 },
  };
}

// Structured clone that works without the global (older runtimes / jsdom).
export function cloneDoc(doc) {
  return JSON.parse(JSON.stringify(doc));
}

// ── endpoint helpers ────────────────────────────────────────────
export function splitEndpoint(ep) {
  const dot = ep.indexOf('.');
  if (dot < 0) return { compId: ep, pin: '' };
  return { compId: ep.slice(0, dot), pin: ep.slice(dot + 1) };
}

export function getComponent(doc, id) {
  return doc.components.find(c => c.id === id) || null;
}

// The net (if any) that a given endpoint currently belongs to.
export function netForEndpoint(doc, ep) {
  return doc.nets.find(n => n.endpoints.includes(ep)) || null;
}

// ── nets: union-find over the edge list ─────────────────────────
// Given a flat list of wire edges [ [epA, epB], ... ], collapse them into
// canonical nets (connected components). Used after any wire add/remove so the
// net list is always the minimal derived form.
export function rebuildNets(edges, colorFor = () => '#e33') {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    // path compression
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => { parent.set(find(a), find(b)); };

  for (const [a, b] of edges) { find(a); find(b); union(a, b); }

  const groups = new Map();   // root -> Set(endpoints)
  for (const ep of parent.keys()) {
    const r = find(ep);
    if (!groups.has(r)) groups.set(r, new Set());
    groups.get(r).add(ep);
  }

  let i = 0;
  const nets = [];
  for (const set of groups.values()) {
    if (set.size < 2) continue;   // a lone endpoint is not a net
    const endpoints = [...set].sort();
    nets.push({ id: `n${++i}`, endpoints, color: colorFor(endpoints) });
  }
  return nets;
}

// Flatten a doc's nets back into an edge list (a spanning chain per net) so a
// round-trip through rebuildNets is stable.
export function netsToEdges(nets) {
  const edges = [];
  for (const n of nets) {
    const eps = n.endpoints;
    for (let i = 1; i < eps.length; i++) edges.push([eps[0], eps[i]]);
  }
  return edges;
}

// ── validation ──────────────────────────────────────────────────
// Returns Diag[] : { level:'error'|'warn', code, message, ref? }. An empty
// array means the document is structurally sound (electrical violations are a
// separate concern, handled by the circuit solver).
export function validate(doc) {
  const diags = [];
  const err = (code, message, ref) => diags.push({ level: 'error', code, message, ref });
  const warn = (code, message, ref) => diags.push({ level: 'warn', code, message, ref });

  if (!doc || typeof doc !== 'object') { err('doc', 'Document is not an object'); return diags; }
  if (doc.v !== DOC_VERSION) err('version', `Expected doc v${DOC_VERSION}, got v${doc.v}`);

  const ids = new Set();
  for (const c of doc.components || []) {
    if (!c.id) { err('component', 'Component missing id'); continue; }
    if (ids.has(c.id)) err('duplicate-id', `Duplicate component id "${c.id}"`, c.id);
    ids.add(c.id);
    if (!c.type) err('component-type', `Component "${c.id}" missing type`, c.id);
  }

  const netIds = new Set();
  for (const n of doc.nets || []) {
    if (netIds.has(n.id)) err('duplicate-net', `Duplicate net id "${n.id}"`, n.id);
    netIds.add(n.id);
    if (!Array.isArray(n.endpoints) || n.endpoints.length < 2) {
      warn('net-degenerate', `Net "${n.id}" has fewer than 2 endpoints`, n.id);
    }
    for (const ep of n.endpoints || []) {
      const { compId } = splitEndpoint(ep);
      if (!ids.has(compId)) err('dangling-endpoint', `Net "${n.id}" references unknown component "${compId}"`, ep);
    }
  }
  return diags;
}
