// Exercises the MCP tool layer directly — no transport, no network, no deps.
// This is the same code path server.js registers, so it covers the real solver
// rather than a mock of it.
//
//   node --test mcp/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, runTool, TOOLS } from './workspace.js';

const call = (ws, name, input) => runTool(ws, name, input);

test('every tool has a description and a usable schema', () => {
  for (const t of TOOLS) {
    assert.ok(t.description.length > 20, `${t.name} needs a real description`);
    assert.equal(t.schema.type, 'object', `${t.name} schema must be an object`);
    for (const req of t.schema.required || []) {
      assert.ok(t.schema.properties[req], `${t.name} requires "${req}" but doesn't define it`);
    }
  }
});

test('list_components exposes pins the model needs to wire anything', () => {
  const ws = createWorkspace();
  const { components, endpointFormat } = call(ws, 'list_components');
  const battery = components.find(c => c.type === 'battery');
  assert.ok(battery, 'battery must be listed');
  assert.deepEqual(battery.pins, ['+ (power+)', '- (power-)']);
  assert.match(endpointFormat, /componentId\.pin/);
  // an LED is polar and its pins are NOT A/B — the exact thing a model guesses wrong
  assert.deepEqual(components.find(c => c.type === 'led').pins, ['A (power+)', 'K (power-)']);
});

test('a closed battery→motor loop solves to real current and torque', () => {
  const ws = createWorkspace();
  const bat = call(ws, 'place_component', { type: 'battery', id: 'bat1' });
  const motor = call(ws, 'place_component', { type: 'motor', id: 'motor1' });
  assert.equal(bat.ok, true);
  assert.equal(motor.id, 'motor1');

  // one leg only: no loop, so no current, and both loose pins are flagged
  call(ws, 'connect', { from: 'bat1.+', to: 'motor1.A' });
  const open = call(ws, 'read_electrical');
  assert.equal(open.current.motor1.amps, 0, 'an open circuit must not pass current');
  assert.ok(open.violations.some(v => v.code === 'floating-pin'));

  // close the loop
  const closed = call(ws, 'connect', { from: 'bat1.-', to: 'motor1.B' });
  assert.equal(closed.ok, true);
  // 7.4V across 2.0Ω armature + 0.4Ω internal ≈ 3.08A
  const amps = closed.current.motor1.amps;
  assert.ok(amps > 3 && amps < 3.2, `expected ~3.08A through the motor, got ${amps}`);
  assert.ok(closed.current.motor1.torqueNm > 0, 'a powered motor must make torque');
  assert.equal(closed.violations.length, 0, `expected a clean circuit, got ${closed.violations}`);
});

test('a series resistor cuts the current, and the solver tracks the change', () => {
  const ws = createWorkspace();
  call(ws, 'place_component', { type: 'battery', id: 'bat1' });
  call(ws, 'place_component', { type: 'motor', id: 'motor1' });
  call(ws, 'place_component', { type: 'resistor', id: 'resistor1' });
  call(ws, 'connect', { from: 'bat1.+', to: 'resistor1.A' });
  call(ws, 'connect', { from: 'resistor1.B', to: 'motor1.A' });
  const withR = call(ws, 'connect', { from: 'bat1.-', to: 'motor1.B' });
  // 100Ω in series dominates: ~7.4/102.4 ≈ 0.072A
  assert.ok(withR.current.motor1.amps < 0.1, `100R should choke it, got ${withR.current.motor1.amps}`);

  // drop the resistance and the current must rise ~10x
  const lower = call(ws, 'set_param', { id: 'resistor1', key: 'resistance', value: 10 });
  assert.equal(lower.ok, true);
  assert.ok(lower.current.motor1.amps > withR.current.motor1.amps * 5,
    'lowering resistance must raise current');
});

test('shorting the battery is reported as an error, not silently solved', () => {
  const ws = createWorkspace();
  call(ws, 'place_component', { type: 'battery', id: 'bat1' });
  const shorted = call(ws, 'connect', { from: 'bat1.+', to: 'bat1.-' });
  const issues = call(ws, 'validate');
  assert.equal(issues.ok, false, 'a dead short must not validate');
  assert.ok(
    [...shorted.violations, ...issues.issues.map(i => i.message)]
      .some(v => /short|over-?current/i.test(typeof v === 'string' ? v : v.message)),
    `expected a short/over-current violation, got ${JSON.stringify(issues.issues)}`,
  );
});

test('an LED only conducts the right way round', () => {
  const ws = createWorkspace();
  call(ws, 'place_component', { type: 'battery', id: 'bat1' });
  call(ws, 'place_component', { type: 'resistor', id: 'resistor1' });
  call(ws, 'place_component', { type: 'led', id: 'led1' });
  call(ws, 'set_param', { id: 'resistor1', key: 'resistance', value: 220 });
  // backwards: + → cathode
  call(ws, 'connect', { from: 'bat1.+', to: 'resistor1.A' });
  call(ws, 'connect', { from: 'resistor1.B', to: 'led1.K' });
  const reversed = call(ws, 'connect', { from: 'bat1.-', to: 'led1.A' });
  assert.ok(Math.abs(reversed.current.led1.amps) < 1e-6,
    `a reverse-biased LED must not conduct, got ${reversed.current.led1.amps}`);

  // flip it
  call(ws, 'disconnect', { from: 'resistor1.B', to: 'led1.K' });
  call(ws, 'disconnect', { from: 'bat1.-', to: 'led1.A' });
  call(ws, 'connect', { from: 'resistor1.B', to: 'led1.A' });
  const forward = call(ws, 'connect', { from: 'bat1.-', to: 'led1.K' });
  assert.ok(forward.current.led1.amps > 0.01,
    `a forward-biased LED must light, got ${forward.current.led1.amps}`);
});

test('a switch opens and closes the loop', () => {
  const ws = createWorkspace();
  call(ws, 'place_component', { type: 'battery', id: 'bat1' });
  call(ws, 'place_component', { type: 'motor', id: 'motor1' });
  call(ws, 'place_component', { type: 'switch', id: 'switch1' });
  call(ws, 'connect', { from: 'bat1.+', to: 'switch1.A' });
  call(ws, 'connect', { from: 'switch1.B', to: 'motor1.A' });
  const open = call(ws, 'connect', { from: 'bat1.-', to: 'motor1.B' });
  assert.ok(Math.abs(open.current.motor1.amps) < 1e-6, 'default switch is open');

  const closed = call(ws, 'set_param', { id: 'switch1', key: 'closed', value: 1 });
  assert.ok(closed.current.motor1.amps > 3, `closing the switch must pass current, got ${closed.current.motor1.amps}`);
});

test('bad input comes back as a readable error, never a throw', () => {
  const ws = createWorkspace();
  assert.equal(call(ws, 'place_component', { type: 'flux_capacitor' }).ok, false);
  assert.match(call(ws, 'connect', { from: 'nope.+', to: 'alsonope.-' }).error, /Unknown endpoint/);
  assert.match(call(ws, 'remove_component', { id: 'ghost' }).error, /No component/);
  assert.match(call(ws, 'no_such_tool', {}).error, /Unknown tool/);
});

test('undo reverses the last edit, and new_build clears everything', () => {
  const ws = createWorkspace();
  call(ws, 'place_component', { type: 'battery', id: 'bat1' });
  call(ws, 'place_component', { type: 'motor', id: 'motor1' });
  assert.equal(call(ws, 'undo').components.length, 1);

  const fresh = call(ws, 'new_build', { name: 'clean' });
  assert.deepEqual(fresh.components, []);
  assert.deepEqual(fresh.nets, []);
  // the reset must swap the workspace's live api, not just its document
  assert.deepEqual(call(ws, 'get_build').components, []);
});
