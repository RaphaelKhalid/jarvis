// Robot registry — the single list the app reads to know which robots exist.
// The self-balancer is the only buildable one today; the rover and
// line-follower are declared here (available:false) so the picker can advertise
// the roadmap breadth (Brief 1's #1 gap) before the physics lands in M4.
import { selfBalancer } from './self-balancer.js';
import { state } from '../app/state.js';

// "Coming soon" stubs — enough metadata for the picker card; no parts/sim yet.
const rover = {
  id: 'rover', name: 'Rover', blurb: 'A four-wheel driving robot — no balancing, just cruise the terrain.',
  difficulty: 'Coming soon', available: false, simKey: 'rover',
};
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
