// RobotDef — the Rover: a four-wheel driving robot. No balancing; it just sits
// flat on four wheels and cruises the terrain. This is the second buildable
// robot and the proof that the M4 seam holds — it's authored entirely here as
// data + a `simKey`, reusing the existing part factories, the wiring system, and
// (via a RoverSim that subclasses BalanceSim) the proven arcade-drive physics.
//
// Layout notes:
//  • Two L298N drivers (front + rear), each driving one axle's two motors. They
//    live in distinct endpoint namespaces (l298nF / l298nR) so their pins don't
//    collide; the tray still shows one "L298N" card (count 2) via the slots'
//    `card` field. Same trick puts the four motors under one "motor" card.
//  • The Arduino only breaks out D6/D9/D10/D11 for motor signals, so the two
//    drivers SHARE those lines: left channel (IN1/IN2) ← D6/D9, right channel
//    (IN3/IN4) ← D10/D11. That's a real skid-steer wiring (both left wheels get
//    the same command, both right wheels the same) and needs no extra pins.
//  • glossary.js maps the instanced comp types (l298nF/l298nR, motorF*/motorR*)
//    back to their base entries, so hover tooltips work without duplication.
import { makeArduino, makeL298N, makeBattery } from '../parts.js';

// Four-wheel BOM. `make:null` motors are sided (assembly calls makeMotor(side)).
const PARTS = [
  { type: 'arduino', name: 'Arduino Uno', swatch: '#2ea04f', count: 1, make: makeArduino,
    desc: 'Microcontroller board',
    help: 'Runs the drive firmware — reads the sticks and commands the two motor drivers.' },
  { type: 'l298n', name: 'L298N Driver', swatch: '#c23131', count: 2, make: makeL298N,
    desc: 'Dual H-bridge motor driver',
    help: 'One per axle: the front driver runs the front wheels, the rear driver the rear wheels.' },
  { type: 'battery', name: '7.4V LiPo', swatch: '#3d5a8f', count: 1, make: makeBattery,
    desc: '2S battery pack',
    help: 'Powers both drivers (12V) and the Arduino (VIN).' },
  { type: 'motor', name: 'DC Gear Motor', swatch: '#f0c020', count: 4, make: null,
    desc: 'Geared motor + wheel',
    help: 'Four of them — one per corner. Left pair and right pair are driven together (skid-steer).' },
];

// Chassis mount points. Deck footprint is x∈[-8,8], z∈[-13,13] (scene.js).
// `card` groups slots under one tray card; `side` mirrors sided motor geometry.
const SLOTS = [
  { id: 'slot-battery', accepts: 'battery', x: 0,    z: 9.0,  ry: 0, w: 7.6, d: 4.1 },
  { id: 'slot-arduino', accepts: 'arduino', x: 0,    z: 2.5,  ry: 0, w: 7.5, d: 6.0 },
  { id: 'slot-l298nF',  accepts: 'l298nF',  card: 'l298n', x: -3.6, z: -4.0, ry: 0, w: 5.0, d: 5.0 },
  { id: 'slot-l298nR',  accepts: 'l298nR',  card: 'l298n', x:  3.6, z: -4.0, ry: 0, w: 5.0, d: 5.0 },
  { id: 'slot-motorFL', accepts: 'motorFL', card: 'motor', x: -6.3, z:  5.5, ry: 0, w: 4.6, d: 7.5, side: -1 },
  { id: 'slot-motorFR', accepts: 'motorFR', card: 'motor', x:  6.3, z:  5.5, ry: 0, w: 4.6, d: 7.5, side: 1 },
  { id: 'slot-motorRL', accepts: 'motorRL', card: 'motor', x: -6.3, z: -5.5, ry: 0, w: 4.6, d: 7.5, side: -1 },
  { id: 'slot-motorRR', accepts: 'motorRR', card: 'motor', x:  6.3, z: -5.5, ry: 0, w: 4.6, d: 7.5, side: 1 },
];

// Required connections (checklist + Upload gating). Skid-steer: both drivers'
// left channel ← D6/D9, right channel ← D10/D11; each driver powers its axle.
const REQUIRED = [
  // Arduino + drivers power/ground off the battery
  { a: 'arduino.VIN', b: 'battery.+',  kind: 'power',  label: 'Arduino VIN → Bat +' },
  { a: 'arduino.GND', b: 'battery.-',  kind: 'ground', label: 'Arduino GND → Bat −' },
  { a: 'l298nF.12V',  b: 'battery.+',  kind: 'power',  label: 'Front 12V → Bat +' },
  { a: 'l298nF.GND',  b: 'battery.-',  kind: 'ground', label: 'Front GND → Bat −' },
  { a: 'l298nR.12V',  b: 'battery.+',  kind: 'power',  label: 'Rear 12V → Bat +' },
  { a: 'l298nR.GND',  b: 'battery.-',  kind: 'ground', label: 'Rear GND → Bat −' },
  // shared signal lines — left channel (D6/D9), right channel (D10/D11)
  { a: 'l298nF.IN1',  b: 'arduino.D6',  kind: 'data', label: 'Front IN1 → D6 (left)' },
  { a: 'l298nF.IN2',  b: 'arduino.D9',  kind: 'data', label: 'Front IN2 → D9 (left)' },
  { a: 'l298nF.IN3',  b: 'arduino.D10', kind: 'data', label: 'Front IN3 → D10 (right)' },
  { a: 'l298nF.IN4',  b: 'arduino.D11', kind: 'data', label: 'Front IN4 → D11 (right)' },
  { a: 'l298nR.IN1',  b: 'arduino.D6',  kind: 'data', label: 'Rear IN1 → D6 (left)' },
  { a: 'l298nR.IN2',  b: 'arduino.D9',  kind: 'data', label: 'Rear IN2 → D9 (left)' },
  { a: 'l298nR.IN3',  b: 'arduino.D10', kind: 'data', label: 'Rear IN3 → D10 (right)' },
  { a: 'l298nR.IN4',  b: 'arduino.D11', kind: 'data', label: 'Rear IN4 → D11 (right)' },
  // driver outputs → the four motors
  { a: 'l298nF.OUT1', b: 'motorFL.M+', kind: 'power', label: 'Front OUT1 → FL +' },
  { a: 'l298nF.OUT2', b: 'motorFL.M-', kind: 'power', label: 'Front OUT2 → FL −' },
  { a: 'l298nF.OUT3', b: 'motorFR.M+', kind: 'power', label: 'Front OUT3 → FR +' },
  { a: 'l298nF.OUT4', b: 'motorFR.M-', kind: 'power', label: 'Front OUT4 → FR −' },
  { a: 'l298nR.OUT1', b: 'motorRL.M+', kind: 'power', label: 'Rear OUT1 → RL +' },
  { a: 'l298nR.OUT2', b: 'motorRL.M-', kind: 'power', label: 'Rear OUT2 → RL −' },
  { a: 'l298nR.OUT3', b: 'motorRR.M+', kind: 'power', label: 'Rear OUT3 → RR +' },
  { a: 'l298nR.OUT4', b: 'motorRR.M-', kind: 'power', label: 'Rear OUT4 → RR −' },
];

const SKETCH = `/*
 * Rover — 4-wheel skid-steer drive (two L298N drivers)
 * Unit 3: Motors & Drivers
 *
 * No balancing here: left wheels and right wheels are each driven together.
 * Steer by driving the two sides at different speeds. Hit UPLOAD and drive
 * with WASD.
 */
const int L_IN1 = 6, L_IN2 = 9;    // left channel  → both drivers' IN1/IN2
const int R_IN3 = 10, R_IN4 = 11;  // right channel → both drivers' IN3/IN4

int cruiseSpeed = 200;   // 0..255 base PWM

void setup() {
  pinMode(L_IN1, OUTPUT); pinMode(L_IN2, OUTPUT);
  pinMode(R_IN3, OUTPUT); pinMode(R_IN4, OUTPUT);
}

void loop() {
  drive(throttle(), steer());   // press UPLOAD to simulate this loop
}

void drive(int fwd, int turn) {
  int left  = constrain(fwd + turn, -255, 255);
  int right = constrain(fwd - turn, -255, 255);
  side(L_IN1, L_IN2, left);
  side(R_IN3, R_IN4, right);
}

void side(int inA, int inB, int cmd) {
  analogWrite(inA, cmd > 0 ? cmd : 0);
  analogWrite(inB, cmd < 0 ? -cmd : 0);
}
`;

export const rover = {
  id: 'rover',
  name: 'Rover',
  blurb: 'A four-wheel driving robot — no balancing, just cruise the terrain.',
  difficulty: 'Driving',
  available: true,
  simKey: 'rover',
  sketchFile: 'rover_drive.ino',
  parts: PARTS,
  slots: SLOTS,
  required: REQUIRED,
  sketch: SKETCH,
};
