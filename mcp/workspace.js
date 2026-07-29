// The JARVIS tool layer, headless.
//
// This is the whole point of the exercise: `js/api/index.js` (the app's single
// mutation authority), `js/model/*` (the RobotDoc) and `js/sim/circuit.js` (the
// Modified Nodal Analysis solver) are pure data + maths with no THREE and no
// DOM, so they import into Node unchanged. The browser build and this server run
// *the same solver over the same document* — there is no second implementation
// to drift.
//
// Kept separate from server.js so the tools can be exercised directly by
// mcp/tools.test.mjs without standing up a transport.
import { createApi } from '../js/api/index.js';
import { LIBRARY, pinsFor } from '../js/model/library.js';
import { motorTorque } from '../js/sim/circuit.js';
import { emptyDoc } from '../js/model/doc.js';

/**
 * One in-memory build.
 *
 * SCOPE: a workspace is a single shared build per server process — there is no
 * per-connection isolation. That is deliberate for a demo server (it is what
 * makes "ask Claude to wire a circuit, then look at the result" work), but it
 * means two simultaneous clients would edit the same document. Multi-tenancy
 * would key these by MCP session id.
 */
export function createWorkspace() {
  let api = createApi({ doc: emptyDoc('creator', 'MCP build') });
  return {
    get: () => api,
    reset(name = 'MCP build') {
      api = createApi({ doc: emptyDoc('creator', name) });
      return api;
    },
  };
}

// ── shaping helpers ────────────────────────────────────────────────────────
// A mutation returns {ok, changed, errors}. Surfacing that raw is a poor tool
// result: a model reads `ok:false` far more reliably when the reason is a
// sentence rather than an array it has to notice. Every mutation also returns
// the fresh electrical state, so the model sees the consequence of its edit in
// the same turn instead of having to remember to call read_electrical.
function shape(api, result, extra = {}) {
  if (!result.ok) {
    return { ok: false, error: (result.errors || []).join('; ') || 'failed', ...extra };
  }
  return { ok: true, changed: result.changed, ...extra, ...summarise(api) };
}

const round = (v, dp = 4) => (typeof v === 'number' && Number.isFinite(v)
  ? Number(v.toFixed(dp)) : v);

/** The compact "what does the build look like now" block returned after edits. */
function summarise(api) {
  const doc = api.get_document();
  const solve = api.read_electrical();
  return {
    components: doc.components.map(c => `${c.id} (${c.type})`),
    nets: doc.nets.map(n => n.endpoints.join(' — ')),
    current: currents(doc, solve),
    violations: (solve.violations || []).map(v => `${v.level}: ${v.message}`),
  };
}

/** Per-component solved current (A), plus torque for motors. */
function currents(doc, solve) {
  const out = {};
  for (const c of doc.components) {
    const i = solve.current?.[c.id];
    if (i === undefined) continue;
    out[c.id] = { amps: round(i) };
    if (c.type.startsWith('motor')) {
      out[c.id].torqueNm = round(motorTorque(c.id, solve, c.params, 0));
    }
  }
  return out;
}

// ── the tools ──────────────────────────────────────────────────────────────
// Shape mirrors js/api/tools.js (the browser's Gemini contract) so the two
// surfaces stay recognisably the same product. `schema` is described with plain
// JSON Schema here and converted to zod in server.js — keeping this file free of
// a zod import is what lets the test run with no dependencies installed.
//
// Deliberately NOT exposed: run_sim / stop_sim. Those drive a Rapier world that
// only exists in the browser; a server-side no-op that reported success would be
// a lie. The DC solve below is the real, complete thing this process can do.
export const TOOLS = [
  {
    name: 'list_components',
    description:
      'List every component type that can be placed, with its pins and default '
      + 'parameters. Call this first — pin names are needed to wire anything, and '
      + 'they differ per type (a battery has "+"/"-", an LED has "A"/"K").',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    handler: () => ({
      components: Object.entries(LIBRARY).map(([type, def]) => ({
        type,
        label: def.label,
        pins: def.pins.map(p => `${p.name} (${p.role})`),
        params: def.params,
      })),
      endpointFormat: 'componentId.pin — e.g. "bat1.+", "motor1.A", "led1.K"',
    }),
  },
  {
    name: 'get_build',
    description: 'Return the current build: components, wiring nets, and the solved circuit.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    handler: (api) => summarise(api),
  },
  {
    name: 'place_component',
    description: 'Add a component to the build. Returns its assigned id.',
    schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string', enum: Object.keys(LIBRARY),
          description: 'Component type to place.',
        },
        id: { type: 'string', description: 'Optional explicit id; auto-named if omitted.' },
      },
      required: ['type'],
    },
    handler: (api, { type, id }) => {
      const r = api.place_component({ type, id });
      return shape(api, r, r.ok ? { id: r.id } : {});
    },
  },
  {
    name: 'remove_component',
    description: 'Remove a component, and any wires touching it, by id.',
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: (api, { id }) => shape(api, api.remove_component({ id })),
  },
  {
    name: 'connect',
    description:
      'Wire two pins together. Endpoints are "componentId.pin" (e.g. "bat1.+" to '
      + '"motor1.A"). A circuit needs a complete loop before any current flows.',
    schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source endpoint "compId.pin".' },
        to: { type: 'string', description: 'Target endpoint "compId.pin".' },
      },
      required: ['from', 'to'],
    },
    handler: (api, { from, to }) => shape(api, api.connect({ from, to })),
  },
  {
    name: 'disconnect',
    description: 'Remove the wire between two endpoints.',
    schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
    handler: (api, { from, to }) => shape(api, api.disconnect({ from, to })),
  },
  {
    name: 'set_param',
    description:
      'Set a parameter on a component — a resistor\'s resistance, a battery\'s '
      + 'voltsNominal, a switch\'s closed state. Use list_components to see what '
      + 'each type exposes. Booleans go as 1 (true) / 0 (false).',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'number' },
      },
      required: ['id', 'key', 'value'],
    },
    handler: (api, { id, key, value }) => {
      // `closed` is the one boolean param in the library; the tool schema is
      // numeric because a JSON-schema union here confuses more models than it
      // helps, so coerce on the way in.
      const v = key === 'closed' ? Boolean(value) : value;
      return shape(api, api.set_param({ id, key, value: v }));
    },
  },
  {
    name: 'read_electrical',
    description:
      'Solve the circuit (Modified Nodal Analysis) and return per-component '
      + 'current in amps, motor torque, and any violations — short circuit, '
      + 'floating pin, over-current. This is the real solver, not an estimate.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    handler: (api) => {
      const doc = api.get_document();
      const solve = api.read_electrical();
      return {
        ok: solve.ok,
        current: currents(doc, solve),
        violations: (solve.violations || []).map(v => ({
          level: v.level, code: v.code, ref: v.ref, message: v.message,
        })),
      };
    },
  },
  {
    name: 'validate',
    description: 'Return structural and electrical diagnostics for the current build.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    handler: (api) => {
      const issues = api.validate();
      return {
        ok: !issues.some(v => v.level === 'error'),
        issues: issues.map(v => ({ level: v.level, code: v.code, ref: v.ref, message: v.message })),
      };
    },
  },
  {
    name: 'undo',
    description: 'Undo the last change to the build.',
    schema: { type: 'object', properties: {} },
    handler: (api) => shape(api, api.undo()),
  },
  {
    name: 'new_build',
    description: 'Discard the current build and start an empty one.',
    schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Optional name for the build.' } },
    },
    handler: (api, { name }, ws) => {
      const fresh = ws.reset(name || 'MCP build');
      return { ok: true, ...summarise(fresh) };
    },
  },
];

/**
 * Run one tool by name against a workspace. Never throws — a thrown error comes
 * back as `{ok:false, error}` so the model can read the failure and retry,
 * which is the same contract js/api/tools.js `runTool` gives the browser agent.
 */
export function runTool(ws, name, input = {}) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return { ok: false, error: `Unknown tool "${name}"` };
  try {
    return tool.handler(ws.get(), input || {}, ws);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

export { LIBRARY, pinsFor };
