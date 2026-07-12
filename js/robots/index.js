// Robot registry — the single list the app reads to know which robots exist.
// The self-balancer is the only buildable one today; the rover and
// line-follower are declared here (available:false) so the picker can advertise
// the roadmap breadth (Brief 1's #1 gap) before the physics lands in M4.
import { selfBalancer } from './self-balancer.js';
import { rover } from './rover.js';
import { state } from '../app/state.js';

// "Coming soon" stub — enough metadata for the picker card; no parts/sim yet.
// (The rover is further along: it lives in its own scaffolded def, rover.js.)
const lineFollower = {
  id: 'line-follower', name: 'Line-Follower', blurb: 'A rover that reads a line sensor and steers to follow a track.',
  difficulty: 'Coming soon', available: false, simKey: 'line',
};

export const ROBOTS = [selfBalancer, rover, lineFollower];
export const DEFAULT_ROBOT_ID = selfBalancer.id;

export function getRobot(id) {
  return ROBOTS.find(r => r.id === id) || selfBalancer;
}

// the currently selected RobotDef, resolved from the observable store
export function activeRobot() {
  return getRobot(state.activeRobotId);
}

// ── runtime robot switch ──────────────────────────────────────────────────
// Assembly/wiring/scene/sim all resolve their RobotDef once at init (the tray,
// the baked slot-ghost meshes, the WiringManager's `required` set, the sim body
// keyed by simKey), so changing robots mid-session means a full re-init. In a
// zero-build vanilla app the clean, robust way to do that is to persist the
// choice and reload — the whole app then boots against the new def. `main.js`
// calls `bootActiveRobot()` before it builds the scene so the reload lands on
// the right robot.
const ACTIVE_KEY = 'sbl-active-robot';

// Read the persisted robot id into state before any module resolves a def.
// Ignores ids that aren't a real, buildable robot (stale/unknown → self-balancer).
export function bootActiveRobot() {
  let id = null;
  try { id = localStorage.getItem(ACTIVE_KEY); } catch { /* storage blocked */ }
  const robot = id && ROBOTS.find(r => r.id === id);
  state.activeRobotId = (robot && robot.available) ? robot.id : DEFAULT_ROBOT_ID;
  return state.activeRobotId;
}

// Switch to another robot: persist + reload so the app re-inits cleanly.
// No-op when already active. Callers (the picker) only pass buildable robots.
export function switchRobot(id) {
  if (id === state.activeRobotId) return;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* storage blocked */ }
  window.location.reload();
}
