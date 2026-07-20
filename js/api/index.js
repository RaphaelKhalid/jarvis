// The scriptable API — the one surface the UI, tests, and (Milestone 2) Jarvis
// all drive. Every signature is shaped so a JSON-schema tool definition is a
// mechanical transformation of it: flat named args, `{dryRun}` option, and a
// uniform `{ok, changed, errors}` return for mutations.
//
// The DOM layer contains NO mutation logic — it calls these functions and
// re-renders from the resulting document. Exposed as `window.__api` for tests.

import { emptyDoc, cloneDoc, validate as validateDoc, splitEndpoint, netForEndpoint } from '../model/doc.js';
import { DocHistory } from '../model/patch.js';
import { LIBRARY, defaultParams, pinsFor, isKnownType, baseType } from '../model/library.js';
import { solveCircuit } from '../sim/circuit.js';

const ok = (changed = true, extra = {}) => ({ ok: true, changed, errors: [], ...extra });
const fail = (...errors) => ({ ok: false, changed: false, errors });

// hooks: { onDocChange(doc), sim: { run, stop, reset, running() }, telemetry() }
export function createApi({ doc, hooks = {} } = {}) {
  const colorFor = () => pickColor();
  const history = new DocHistory(doc || emptyDoc(), {
    colorFor,
    onChange: (d) => hooks.onDocChange?.(d),
  });

  // sim-side dynamic state (motor ω), populated by the physics binding via
  // setSimState so read_electrical reflects the running machine.
  let simState = {};

  function endpointExists(ep) {
    const { compId, pin } = splitEndpoint(ep);
    const comp = history.get().components.find(c => c.id === compId);
    if (!comp) return false;
    return pinsFor(comp.type).some(p => p.name === pin);
  }

  function genId(type) {
    const base = baseType(type);
    const existing = new Set(history.get().components.map(c => c.id));
    let i = 1;
    while (existing.has(`${base}${i}`)) i++;
    return `${base}${i}`;
  }

  // ── mutations ──────────────────────────────────────────────────
  function place_component({ type, id, params, transform, slot } = {}, { dryRun = false } = {}) {
    if (!isKnownType(type)) return fail(`Unknown component type "${type}"`);
    const newId = id || genId(type);
    if (history.get().components.some(c => c.id === newId)) return fail(`Component id "${newId}" already exists`);
    const component = {
      id: newId,
      type,
      params: { ...defaultParams(type), ...(params || {}) },
      transform: transform || { pos: [0, 1, 0], rot: [0, 0, 0] },
      ...(slot ? { slot } : {}),
    };
    history.commit([{ op: 'add-component', component }], { dryRun });
    return ok(true, { id: newId });
  }

  function remove_component({ id } = {}, { dryRun = false } = {}) {
    if (!history.get().components.some(c => c.id === id)) return fail(`No component "${id}"`);
    history.commit([{ op: 'remove-component', id }], { dryRun });
    return ok();
  }

  function connect({ from, to } = {}, { dryRun = false } = {}) {
    if (!from || !to) return fail('connect needs `from` and `to` endpoints');
    if (from === to) return fail('Cannot connect an endpoint to itself');
    if (!endpointExists(from)) return fail(`Unknown endpoint "${from}"`);
    if (!endpointExists(to)) return fail(`Unknown endpoint "${to}"`);
    // already on the same net → no-op
    const net = netForEndpoint(history.get(), from);
    if (net && net.endpoints.includes(to)) return ok(false);
    history.commit([{ op: 'add-edge', edge: [from, to] }], { dryRun });
    return ok();
  }

  function disconnect({ from, to } = {}, { dryRun = false } = {}) {
    if (!from || !to) return fail('disconnect needs `from` and `to`');
    history.commit([{ op: 'remove-edge', edge: [from, to] }], { dryRun });
    return ok();
  }

  function set_param({ id, key, value } = {}, { dryRun = false } = {}) {
    const comp = history.get().components.find(c => c.id === id);
    if (!comp) return fail(`No component "${id}"`);
    if (!key) return fail('set_param needs a `key`');
    history.commit([{ op: 'set-param', id, key, value }], { dryRun });
    return ok();
  }

  function set_name({ name } = {}, { dryRun = false } = {}) {
    history.commit([{ op: 'set-name', name }], { dryRun });
    return ok();
  }

  // ── history ────────────────────────────────────────────────────
  function undo() { const changed = history.undo(); return ok(changed); }
  function redo() { const changed = history.redo(); return ok(changed); }

  // ── sim control (delegated to the physics binding) ─────────────
  function run_sim() { hooks.sim?.run?.(); return ok(true, { running: !!hooks.sim?.running?.() }); }
  function stop_sim() { hooks.sim?.stop?.(); return ok(true, { running: !!hooks.sim?.running?.() }); }
  function reset_sim() { hooks.sim?.reset?.(); simState = {}; return ok(); }

  // ── reads ──────────────────────────────────────────────────────
  function get_document() { return cloneDoc(history.get()); }

  function read_telemetry() {
    return hooks.telemetry?.() || {};
  }

  // Solve the circuit against the current doc + live sim state.
  function read_electrical() {
    return solveCircuit(history.get(), simState);
  }

  function validate() {
    const structural = validateDoc(history.get());
    const electrical = read_electrical().violations || [];
    return [...structural, ...electrical];
  }

  // ── binding helpers (not part of the tool schema) ──────────────
  function setSimState(s) { simState = s || {}; }
  function loadDocument(d) { history.reset(d); }
  function getHistory() { return history; }

  return {
    // tool-schema surface
    place_component, remove_component, connect, disconnect, set_param, set_name,
    run_sim, stop_sim, reset_sim, undo, redo,
    get_document, read_telemetry, read_electrical, validate,
    // internal wiring
    setSimState, loadDocument, getHistory,
  };
}

// small palette cycler for net colors
const NET_COLORS = ['#e33', '#39f', '#3c6', '#fb3', '#c6f', '#6cf'];
let _colorI = 0;
function pickColor() { return NET_COLORS[_colorI++ % NET_COLORS.length]; }
