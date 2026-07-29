// JARVIS as an MCP server — the circuit sandbox, callable as tools.
//
// Wire a battery to a motor and get back the actual solved current; forget the
// return leg and get back a floating-pin violation; short the battery and get
// told. The solver is js/sim/circuit.js, the same Modified Nodal Analysis code
// the browser app runs, imported unchanged (see workspace.js).
//
// Run locally:   npm run mcp:dev     → inspector on http://localhost:3000/inspector
// Deploy:        npm run mcp:deploy  → Manufact Cloud
import { MCPServer, object } from 'mcp-use/server';
import { z } from 'zod';
import { TOOLS, createWorkspace, runTool } from './workspace.js';

const server = new MCPServer({
  name: 'jarvis-circuits',
  title: 'JARVIS Circuits',
  version: '1.0.0',
  description:
    'Build and solve real DC circuits. Place components, wire their pins, and '
    + 'get back per-component current, motor torque, and violations from a '
    + 'Modified Nodal Analysis solver.',
  websiteUrl: 'https://selfbalance-lab.vercel.app',
});

const workspace = createWorkspace();

// The tool definitions in workspace.js are plain JSON Schema so that file stays
// dependency-free and testable; zod is mcp-use's input contract, so convert
// here. Only the shapes the tools actually use are handled — an unknown one
// throws at startup rather than silently registering a tool that rejects every
// call it receives.
function toZod(schema) {
  const shape = {};
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    let field;
    if (prop.enum) field = z.enum(prop.enum);
    else if (prop.type === 'string') field = z.string();
    else if (prop.type === 'number') field = z.number();
    else if (prop.type === 'boolean') field = z.boolean();
    else throw new Error(`toZod: unsupported property type "${prop.type}" for "${key}"`);
    if (prop.description) field = field.describe(prop.description);
    if (!(schema.required || []).includes(key)) field = field.optional();
    shape[key] = field;
  }
  return z.object(shape);
}

for (const tool of TOOLS) {
  server.tool(
    {
      name: tool.name,
      description: tool.description,
      schema: toZod(tool.schema),
      annotations: {
        readOnlyHint: !!tool.readOnly,
        // every mutation is undoable and the whole build is in memory, so no
        // tool here can destroy anything outside this process
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    // runTool never throws: a bad edit comes back as {ok:false, error} for the
    // model to read and correct, rather than as a transport-level failure.
    async (input) => object(runTool(workspace, tool.name, input)),
  );
}

const port = Number(process.env.PORT) || 3000;
await server.listen(port);
