// Patch layer — the ONLY way the document mutates.
//
// A Patch is a small declarative op. `apply(doc, patches)` returns a NEW doc
// (never mutates the input) plus the list of applied patches, so the caller can
// push an entry onto the undo stack. Everything above this — the API, the UI,
// eventually Jarvis — funnels through here, which is what makes undo/redo and
// dry-run universal rather than per-feature.
//
// Patch ops:
//   { op:'add-component',    component }
//   { op:'remove-component', id }
//   { op:'set-param',        id, key, value }
//   { op:'set-transform',    id, transform }
//   { op:'add-edge',         edge:[epA, epB] }
//   { op:'remove-edge',      edge:[epA, epB] }
//   { op:'set-name',         name }
//   { op:'set-code',         code }

import { cloneDoc, rebuildNets, netsToEdges, splitEndpoint, getComponent } from './doc.js';

const canon = (edge) => [...edge].sort();
const sameEdge = (a, b) => { const x = canon(a), y = canon(b); return x[0] === y[0] && x[1] === y[1]; };

// Apply one patch to a (freshly cloned) doc, in place on that clone.
function applyOne(doc, p, colorFor) {
  switch (p.op) {
    case 'add-component': {
      doc.components.push(cloneDoc(p.component));
      break;
    }
    case 'remove-component': {
      doc.components = doc.components.filter(c => c.id !== p.id);
      // drop any edges touching that component, then rederive nets
      const edges = netsToEdges(doc.nets).filter(
        ([a, b]) => splitEndpoint(a).compId !== p.id && splitEndpoint(b).compId !== p.id);
      doc.nets = rebuildNets(edges, colorFor);
      break;
    }
    case 'set-param': {
      const c = getComponent(doc, p.id);
      if (c) { c.params = { ...c.params, [p.key]: p.value }; }
      break;
    }
    case 'set-transform': {
      const c = getComponent(doc, p.id);
      if (c) c.transform = cloneDoc(p.transform);
      break;
    }
    case 'add-edge': {
      const edges = netsToEdges(doc.nets);
      if (!edges.some(e => sameEdge(e, p.edge))) edges.push(canon(p.edge));
      doc.nets = rebuildNets(edges, colorFor);
      break;
    }
    case 'remove-edge': {
      const edges = netsToEdges(doc.nets).filter(e => !sameEdge(e, p.edge));
      doc.nets = rebuildNets(edges, colorFor);
      break;
    }
    case 'set-name': { doc.name = p.name; break; }
    case 'set-code': { doc.code = p.code ? cloneDoc(p.code) : null; break; }
    default: throw new Error(`Unknown patch op: ${p.op}`);
  }
  return doc;
}

// Pure: returns a brand-new document with all patches applied. `colorFor` lets
// callers assign net colors (defaults to a neutral red).
export function apply(doc, patches, colorFor = () => '#e33') {
  const next = cloneDoc(doc);
  for (const p of patches) applyOne(next, p, colorFor);
  next.meta = { ...next.meta, revision: (next.meta?.revision || 0) + 1 };
  return next;
}

// A transactional history around a mutable "current doc". This is what the API
// holds. Each commit is one undoable step regardless of how many patches it
// bundled, so `undo` after a multi-patch transaction restores the exact prior
// document.
export class DocHistory {
  constructor(doc, { colorFor, onChange } = {}) {
    this.colorFor = colorFor || (() => '#e33');
    this.onChange = onChange || (() => {});
    this.doc = doc;
    this.past = [];     // snapshots before each committed transaction
    this.future = [];   // snapshots undone, available to redo
  }

  get() { return this.doc; }

  // Apply patches as one atomic, undoable transaction. dryRun computes the next
  // doc and returns it WITHOUT committing (no history, no onChange).
  commit(patches, { dryRun = false } = {}) {
    const next = apply(this.doc, patches, this.colorFor);
    if (dryRun) return next;
    this.past.push(this.doc);
    this.doc = next;
    this.future = [];
    this.onChange(this.doc);
    return next;
  }

  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }

  undo() {
    if (!this.past.length) return false;
    this.future.push(this.doc);
    this.doc = this.past.pop();
    this.onChange(this.doc);
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push(this.doc);
    this.doc = this.future.pop();
    this.onChange(this.doc);
    return true;
  }

  // Replace the whole document (load / share import). Clears history.
  reset(doc) {
    this.doc = doc;
    this.past = [];
    this.future = [];
    this.onChange(this.doc);
  }
}
