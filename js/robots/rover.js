// RobotDef — the Rover (SCAFFOLD, not yet buildable: `available: false`).
//
// A four-wheel driving robot: no balancing, just cruise the terrain. This is the
// first robot to exercise the M4 seam beyond the self-balancer, so it's the test
// of whether "adding a robot = adding a def" actually holds. It's scaffolded here
// — full metadata + the intended shape of its parts/slots/wiring — but stays off
// the buildable list until the pieces below exist. Flip `available: true` only
// once ALL of these land, or the picker will offer a robot that can't be built:
//
//   1. parts.js — a 4-wheel chassis layout: 4 motor slots (FL/FR/RL/RR) instead
//      of 2. Either a `roverSlots`/`roverParts` export or generalize SLOTS so a
//      def carries its own. No MPU6050 (the rover doesn't balance). Likely two
//      L298N drivers (2 motors each) — needs a second driver slot + accept-type.
//   2. wiring.js — a rover REQUIRED set (below is the intended shape as data):
//      Arduino → 2× L298N, both drivers → battery, 4 motor pairs → driver outs.
//   3. sim.js + robots/sim-registry.js — a `RoverSim` body (4 wheels, no inverted
//      pendulum / PID-upright loop; a differential- or skid-steer drive model) and
//      a `rover:` case in the registry. Do NOT reuse BalanceSim's control loop.
//   4. curriculum/lessons.js — at least one rover lesson (a Driving-track intro
//      that doesn't assume balancing).
//   5. A per-robot save slot (save.js currently shares one localStorage key), so
//      switching to the rover doesn't clobber a self-balancer build. See the M4
//      switchRobot() note in robots/index.js.
//
// Until then parts/slots/required/sketch are left empty: the def is structurally
// valid (so the picker card + sim-registry fallback can't crash) but describes no
// board. The `plannedRequired` field records the intended wiring as data now, so
// the build-out in step 2 is a copy, not a design exercise.

// The wiring the rover will need, kept as reference data (not yet wired into the
// checklist — that's `required`, which stays empty until parts/slots exist).
// Skid-steer: left pair (FL+RL) and right pair (FR+RR) driven together.
export const plannedRequired = [
  { a: 'arduino.VIN',  b: 'battery.+',   kind: 'power',  label: 'Arduino VIN → Bat +' },
  { a: 'arduino.GND',  b: 'battery.-',   kind: 'ground', label: 'Arduino GND → Bat −' },
  // front driver (left+right front motors)
  { a: 'l298nF.IN1',   b: 'arduino.D6',  kind: 'data',   label: 'Front IN1 → D6' },
  { a: 'l298nF.IN2',   b: 'arduino.D9',  kind: 'data',   label: 'Front IN2 → D9' },
  { a: 'l298nF.IN3',   b: 'arduino.D10', kind: 'data',   label: 'Front IN3 → D10' },
  { a: 'l298nF.IN4',   b: 'arduino.D11', kind: 'data',   label: 'Front IN4 → D11' },
  { a: 'l298nF.12V',   b: 'battery.+',   kind: 'power',  label: 'Front 12V → Bat +' },
  { a: 'l298nF.GND',   b: 'battery.-',   kind: 'ground', label: 'Front GND → Bat −' },
  { a: 'l298nF.OUT1',  b: 'motorFL.M+',  kind: 'power',  label: 'Front OUT1 → FL +' },
  { a: 'l298nF.OUT2',  b: 'motorFL.M-',  kind: 'power',  label: 'Front OUT2 → FL −' },
  { a: 'l298nF.OUT3',  b: 'motorFR.M+',  kind: 'power',  label: 'Front OUT3 → FR +' },
  { a: 'l298nF.OUT4',  b: 'motorFR.M-',  kind: 'power',  label: 'Front OUT4 → FR −' },
  // rear driver (left+right rear motors)
  { a: 'l298nR.IN1',   b: 'arduino.D3',  kind: 'data',   label: 'Rear IN1 → D3' },
  { a: 'l298nR.IN2',   b: 'arduino.D5',  kind: 'data',   label: 'Rear IN2 → D5' },
  { a: 'l298nR.IN3',   b: 'arduino.D7',  kind: 'data',   label: 'Rear IN3 → D7' },
  { a: 'l298nR.IN4',   b: 'arduino.D8',  kind: 'data',   label: 'Rear IN4 → D8' },
  { a: 'l298nR.12V',   b: 'battery.+',   kind: 'power',  label: 'Rear 12V → Bat +' },
  { a: 'l298nR.GND',   b: 'battery.-',   kind: 'ground', label: 'Rear GND → Bat −' },
  { a: 'l298nR.OUT1',  b: 'motorRL.M+',  kind: 'power',  label: 'Rear OUT1 → RL +' },
  { a: 'l298nR.OUT2',  b: 'motorRL.M-',  kind: 'power',  label: 'Rear OUT2 → RL −' },
  { a: 'l298nR.OUT3',  b: 'motorRR.M+',  kind: 'power',  label: 'Rear OUT3 → RR +' },
  { a: 'l298nR.OUT4',  b: 'motorRR.M-',  kind: 'power',  label: 'Rear OUT4 → RR −' },
];

export const rover = {
  id: 'rover',
  name: 'Rover',
  blurb: 'A four-wheel driving robot — no balancing, just cruise the terrain.',
  difficulty: 'Coming soon',
  available: false,        // ← flip to true only when the 5 build-out steps land
  simKey: 'rover',         // sim-registry falls back to the balance body until RoverSim exists
  parts: [],               // TODO(rover): 4-wheel BOM (arduino, 2× l298n, battery, 4 motors)
  slots: [],               // TODO(rover): FL/FR/RL/RR motor slots + arduino/driver/battery mounts
  required: [],            // TODO(rover): = plannedRequired once the parts/slots above exist
  sketch: '// Rover firmware — TODO(rover): differential-drive sketch (no PID balance loop)\n',
};
