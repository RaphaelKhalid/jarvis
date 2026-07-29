# JARVIS Circuits — MCP server

The [JARVIS](https://selfbalance-lab.vercel.app) circuit sandbox, exposed as MCP
tools. An agent can place components, wire their pins, and get back **real
solved current** — not an estimate, and not a language model guessing at Ohm's
law.

```
place_component battery → bat1
place_component motor   → motor1
connect bat1.+ → motor1.A
connect bat1.- → motor1.B
  → { motor1: { amps: 3.0833, torqueNm: 0.1542 }, violations: [] }
```

Wire only one leg and it reports `floating-pin` with 0 A. Wire a battery to
itself and it reports a short. Put a 100 Ω resistor in series and the current
drops to 72 mA. Reverse an LED and it stays dark, because the LED is a real
piecewise-linear diode resolved by iteration.

## Why this is not a reimplementation

`js/sim/circuit.js` (Modified Nodal Analysis), `js/model/*` (the RobotDoc) and
`js/api/index.js` (the app's single mutation authority) are pure data and maths
— no THREE, no DOM. This server imports them **unchanged**:

```js
import { createApi } from '../js/api/index.js';
import { motorTorque } from '../js/sim/circuit.js';
```

So the browser app and this server run the same solver over the same document
format. There is no second implementation to drift out of sync, and a fix to the
solver fixes both. `js/package.json` (`type: module`) is what lets Node import
the browser's ES modules directly.

## Tools

| Tool | |
|---|---|
| `list_components` | every placeable type, its pins and default params. **Call this first** — pin names differ per type (`+`/`-`, `A`/`B`, `A`/`K`) |
| `get_build` | current components, nets and solve |
| `place_component` / `remove_component` | add / remove, returns assigned id |
| `connect` / `disconnect` | wire two `componentId.pin` endpoints |
| `set_param` | resistance, voltsNominal, switch `closed`, … |
| `read_electrical` | the MNA solve: per-component amps, motor torque, violations |
| `validate` | structural + electrical diagnostics |
| `undo` / `new_build` | history and reset |

Every mutation returns the refreshed build **and** the new solve, so an agent
sees the consequence of an edit in the same turn rather than having to remember
to re-read.

## Run it

```bash
npm install
npm run test:mcp     # 9 tests, no network, no transport — exercises the solver
npm run mcp:dev      # inspector at http://localhost:3000/inspector
npm run mcp:start    # plain server on $PORT (default 3000), MCP at /mcp
npm run mcp:deploy   # → Manufact Cloud
```

Connect a client:

```bash
npx mcp-use client connect http://localhost:3000/mcp
```

## Scope and limits

Worth being straight about these:

- **One shared build per process.** There is no per-connection isolation, which
  is what makes "ask an agent to wire something, then go look at it" work — but
  two simultaneous clients would edit the same document. Multi-tenancy means
  keying the workspace by MCP session id.
- **No physics.** `run_sim` / `stop_sim` are deliberately *not* exposed. They
  drive a Rapier world that only exists in the browser; a server-side stub
  returning success would be a lie. The DC solve is the real and complete thing
  this process does — including motor torque, which is derived from the solved
  current, so it is meaningful on its own.
- **DC steady state.** The solver has no time domain: capacitors and inductors
  are not transient-simulated.
