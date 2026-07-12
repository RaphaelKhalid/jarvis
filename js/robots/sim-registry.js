// Sim-body registry — maps a RobotDef's `simKey` to the physics body/controller
// it drives. This is the M4 seam that lets a second robot vary its sim without
// main.js hard-coding `new BalanceSim`. Today only the self-balancer exists
// ('balance'); the rover ('rover') / line-follower ('line') sim bodies land here
// when those robots are built. Adding a robot's physics = adding a case here.
import { BalanceSim } from '../sim.js';

const BUILDERS = {
  balance: (scene) => new BalanceSim(scene),
};

// Resolve and construct the sim body for a robot's simKey. Unknown keys fall
// back to the balance body so a half-declared robot can't crash the boot.
export function createSimBody(simKey, scene) {
  const build = BUILDERS[simKey] || BUILDERS.balance;
  return build(scene);
}
