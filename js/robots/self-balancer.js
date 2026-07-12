// RobotDef — the self-balancer. The first entry in the robot registry and the
// template for every future robot. It bundles what used to be scattered module
// globals (parts, chassis slots, required wiring, starter sketch) into one
// object, so "adding a robot" becomes "adding a def" rather than editing the
// core modules. See js/robots/index.js and CLAUDE.md (multi-robot / RobotDef).
//
// M3 scope: this is the data-level generalization only, referencing the
// existing globals — assembly/wiring still import them directly, so behavior is
// byte-for-byte unchanged. M4 switches those modules onto `state.activeRobot`
// and moves the sim body/controller (currently hard-coded in sim.js, keyed by
// `simKey`) behind this def when the second robot (rover) needs to vary them.
import { PART_DEFS, SLOTS } from '../parts.js';
import { REQUIRED } from '../wiring.js';
import { DEFAULT_SKETCH } from '../editor.js';

export const selfBalancer = {
  id: 'self-balancer',
  name: 'Self-Balancer',
  blurb: 'A two-wheeled robot that balances on its own with a PID controller.',
  difficulty: 'Start here',
  available: true,
  simKey: 'balance',        // which sim.js body/controller this robot uses
  parts: PART_DEFS,
  slots: SLOTS,
  required: REQUIRED,
  sketch: DEFAULT_SKETCH,
};
