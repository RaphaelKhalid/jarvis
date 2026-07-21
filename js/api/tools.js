// The Jarvis tool contract — the bridge between natural language and window.__api.
//
// This is the ONE place the API surface is described as Anthropic tool schemas.
// The Edge function (api/jarvis.js) sends TOOL_SCHEMAS to Claude; the client
// agent loop (js/app/jarvis.js) maps each returned tool_use back onto the live
// api via TOOL_EXECUTORS. Both import this, so the model can only ever call the
// functions the app actually exposes — no bespoke command language.
//
// Pure data + a thin dispatch table: no THREE, no DOM, importable server-side.
import { LIBRARY } from '../model/library.js';

const COMPONENT_TYPES = Object.keys(LIBRARY);

// Anthropic `tools` array. Kept deliberately small: the mutating verbs plus the
// two reads the model needs to reason about a live build. undo/redo and raw
// document access stay out — the model works forward from what it can see.
export const TOOL_SCHEMAS = [
  {
    name: 'place_component',
    description: 'Add a component to the build. Returns its assigned id.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: COMPONENT_TYPES, description: 'Component type to place.' },
        id: { type: 'string', description: 'Optional explicit id; auto-named if omitted.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'remove_component',
    description: 'Remove a component (and any wires touching it) by id.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'connect',
    description: 'Wire two pins together. Endpoints are "componentId.pin" (e.g. "bat1.+", "motor1.A").',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source endpoint "compId.pin".' },
        to: { type: 'string', description: 'Target endpoint "compId.pin".' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'disconnect',
    description: 'Remove the wire between two endpoints.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
  {
    name: 'set_param',
    description: 'Set a numeric parameter on a component (e.g. a battery\'s voltsNominal or a motor\'s resistance).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'number' },
      },
      required: ['id', 'key', 'value'],
    },
  },
  {
    name: 'run_sim',
    description: 'Start the physics simulation so the user can watch the current build run.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'stop_sim',
    description: 'Stop the simulation and return to the build view.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_electrical',
    description: 'Solve the circuit and read per-component current plus any violations (short, floating pin, over-current). Use this to check your work.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'validate',
    description: 'Return structural + electrical diagnostics for the current build.',
    input_schema: { type: 'object', properties: {} },
  },
];

export const TOOL_NAMES = TOOL_SCHEMAS.map(t => t.name);

// Gemini `functionDeclarations` shape: { name, description, parameters }, where
// parameters is an OpenAPI object schema. We derive them from the same canonical
// TOOL_SCHEMAS so the two backends can't drift. No-arg tools omit `parameters`
// entirely (Gemini rejects an empty properties object).
export function geminiFunctionDeclarations() {
  return TOOL_SCHEMAS.map((t) => {
    const props = t.input_schema.properties || {};
    const decl = { name: t.name, description: t.description };
    if (Object.keys(props).length > 0) {
      decl.parameters = {
        type: 'object',
        properties: props,
        ...(t.input_schema.required ? { required: t.input_schema.required } : {}),
      };
    }
    return decl;
  });
}

// Map a tool_use onto the live api. Every executor returns a JSON-serializable
// result that becomes the tool_result content the model sees on the next turn.
export const TOOL_EXECUTORS = {
  place_component: (api, i) => api.place_component({ type: i.type, id: i.id }),
  remove_component: (api, i) => api.remove_component({ id: i.id }),
  connect: (api, i) => api.connect({ from: i.from, to: i.to }),
  disconnect: (api, i) => api.disconnect({ from: i.from, to: i.to }),
  set_param: (api, i) => api.set_param({ id: i.id, key: i.key, value: i.value }),
  run_sim: (api) => api.run_sim(),
  stop_sim: (api) => api.stop_sim(),
  read_electrical: (api) => {
    const e = api.read_electrical();
    // trim to what the model needs (drop the raw node-voltage vector)
    return { ok: e.ok, current: e.current, violations: e.violations };
  },
  validate: (api) => api.validate(),
};

// Execute one tool_use block against the api. Never throws — a failure is fed
// back to the model as an error result so it can recover.
export function runTool(api, name, input) {
  const fn = TOOL_EXECUTORS[name];
  if (!fn) return { ok: false, errors: [`Unknown tool "${name}"`] };
  try {
    return fn(api, input || {});
  } catch (e) {
    return { ok: false, errors: [String(e && e.message || e)] };
  }
}

// The system prompt that frames Jarvis for the model. Kept here so the client
// and the Edge function agree on Jarvis's persona and guardrails.
export const SYSTEM_PROMPT = [
  'You are Jarvis, a hands-on robotics build assistant embedded in a browser',
  'circuit simulator. You help the user assemble and wire a robot by calling',
  'tools — you never invent a command syntax, you only call the provided tools.',
  '',
  'The world today is small: the component library is a battery and a DC motor.',
  'A battery has pins "+" and "-"; a motor has pins "A" and "B". Current through',
  'a closed battery→motor loop spins the motor; reversing the wires reverses it.',
  '',
  'Work in small steps. After wiring, call read_electrical or validate to confirm',
  'there are no violations (a short is a mistake — fix it). When the user asks to',
  '"run it" or "make it spin", call run_sim. Keep replies short and concrete;',
  'refer to components by the ids the tools return.',
].join('\n');
