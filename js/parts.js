// Part factories — each returns a THREE.Group with userData:
//   { type, label, pins: [{ name, obj }] }
// Units: 1 unit = 1 cm.
import * as THREE from 'three';
import { makeFlatLabel } from './labels.js';

const PIN_RADIUS = 0.09;
const PIN_HEIGHT = 0.28;

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1, ...opts });

const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.35, metalness: 0.8 });
const blackMat = mat(0x1a1a1a);
const silverMat = new THREE.MeshStandardMaterial({ color: 0xb0b4bc, roughness: 0.45, metalness: 0.7 });

function addPin(group, name, x, y, z, labelSide = 1) {
  const pin = new THREE.Mesh(
    new THREE.CylinderGeometry(PIN_RADIUS, PIN_RADIUS, PIN_HEIGHT, 8),
    goldMat
  );
  pin.position.set(x, y + PIN_HEIGHT / 2, z);
  pin.userData.pinName = name;
  group.add(pin);

  const label = makeFlatLabel(name, 0.32, { color: '#e8eef5' });
  label.position.set(x, y + 0.02, z + 0.34 * labelSide);
  group.add(label);

  group.userData.pins.push({ name, obj: pin });
  return pin;
}

function board(w, t, d, color) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), mat(color));
  b.castShadow = true;
  b.receiveShadow = true;
  return b;
}

// ── 1. Arduino Uno ───────────────────────────────────────────────
export function makeArduino() {
  const g = new THREE.Group();
  g.userData = { type: 'arduino', label: 'Arduino Uno', pins: [] };

  const pcb = board(6.9, 0.16, 5.4, 0x1e7a3c);
  pcb.position.y = 0.5;
  g.add(pcb);

  // USB port nub
  const usb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.2), silverMat);
  usb.position.set(-3.0, 0.5 + 0.08 + 0.55, 1.35);
  g.add(usb);

  // ATmega chip
  const chip = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 0.9), blackMat);
  chip.position.set(0.4, 0.75, 0.6);
  g.add(chip);

  // pin header strips (black plastic) along front and back edges
  for (const z of [-2.35, 2.35]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.5, 0.55), blackMat);
    strip.position.set(0.4, 0.83, z);
    g.add(strip);
  }

  const topY = 0.5 + 0.08 + 0.5; // pcb top + header height

  // Digital pins along back edge (z = -2.35), labels toward center
  const dPins = ['D2', 'D6', 'D9', 'D10', 'D11'];
  dPins.forEach((name, i) => addPin(g, name, -1.9 + i * 1.15, topY, -2.35, 1));

  // Analog / power pins along front edge (z = +2.35), labels toward center
  const aPins = ['A4', 'A5', '5V', 'VIN', 'GND'];
  aPins.forEach((name, i) => addPin(g, name, -1.9 + i * 1.15, topY, 2.35, -1));

  const title = makeFlatLabel('ARDUINO UNO', 0.42, { color: '#cfe8d8' });
  title.position.set(0.4, 0.5 + 0.09, -0.6);
  g.add(title);

  return g;
}

// ── 2. MPU6050 IMU ───────────────────────────────────────────────
export function makeMPU6050() {
  const g = new THREE.Group();
  g.userData = { type: 'mpu6050', label: 'MPU6050 IMU', pins: [] };

  const pcb = board(3.2, 0.14, 2.1, 0x1c4f9c);
  pcb.position.y = 0.4;
  g.add(pcb);

  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.8), blackMat);
  chip.position.set(0, 0.58, 0.25);
  g.add(chip);

  const strip = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.4, 0.45), blackMat);
  strip.position.set(0, 0.67, -0.75);
  g.add(strip);

  const topY = 0.4 + 0.07 + 0.4;
  const pins = ['VCC', 'GND', 'SCL', 'SDA', 'INT', 'AD0'];
  pins.forEach((name, i) => addPin(g, name, -1.25 + i * 0.5, topY, -0.75, 1));

  const title = makeFlatLabel('MPU6050', 0.34, { color: '#cfe0f5' });
  title.position.set(0, 0.4 + 0.08, 0.85);
  g.add(title);

  return g;
}

// ── 3. L298N motor driver ────────────────────────────────────────
export function makeL298N() {
  const g = new THREE.Group();
  g.userData = { type: 'l298n', label: 'L298N Driver', pins: [] };

  const pcb = board(4.3, 0.16, 4.3, 0xa32222);
  pcb.position.y = 0.5;
  g.add(pcb);

  // big heatsink
  const heatsink = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 1.5), blackMat);
    fin.position.set(-0.5 + i * 0.25, 0, 0);
    heatsink.add(fin);
  }
  const hsBase = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.0, 0.15), blackMat);
  hsBase.position.z = -0.8;
  heatsink.add(hsBase);
  heatsink.position.set(0, 0.5 + 1.1, 0.4);
  g.add(heatsink);

  // blue screw terminal blocks
  const termMat = mat(0x2255cc);
  const termL = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.6), termMat);
  termL.position.set(-1.85, 1.0, 0.9);
  g.add(termL);
  const termR = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.6), termMat);
  termR.position.set(1.85, 1.0, 0.9);
  g.add(termR);
  const termPwr = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.9), termMat);
  termPwr.position.set(-1.0, 1.0, -1.75);
  g.add(termPwr);

  const topY = 0.5 + 0.08;

  // logic input header (back edge)
  const strip = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.4, 0.45), blackMat);
  strip.position.set(0.6, topY + 0.2, 1.9);
  g.add(strip);
  const logic = ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'];
  logic.forEach((name, i) => addPin(g, name, -0.75 + i * 0.55, topY + 0.4, 1.9, -1));

  // power terminals
  addPin(g, '12V', -1.5, topY + 0.9, -1.75, -1);
  addPin(g, 'GND', -1.0, topY + 0.9, -1.75, -1);
  addPin(g, '5V',  -0.5, topY + 0.9, -1.75, -1);

  // motor output terminals (left = motor A, right = motor B)
  addPin(g, 'OUT1', -1.85, topY + 0.9, 0.55, -1);
  addPin(g, 'OUT2', -1.85, topY + 0.9, 1.25, 1);
  addPin(g, 'OUT3',  1.85, topY + 0.9, 0.55, -1);
  addPin(g, 'OUT4',  1.85, topY + 0.9, 1.25, 1);

  const title = makeFlatLabel('L298N', 0.4, { color: '#f5d5d5' });
  title.position.set(1.2, 0.5 + 0.09, -1.6);
  g.add(title);

  return g;
}

// ── 4. DC geared motor + wheel ───────────────────────────────────
// side: -1 = left motor (wheel on -x), +1 = right motor (wheel on +x)
export function makeMotor(side = 1) {
  const g = new THREE.Group();
  g.userData = { type: side < 0 ? 'motorL' : 'motorR', label: 'DC Gear Motor', pins: [] };

  const bodyMat = mat(0xf0c020);

  // gearbox block
  const gearbox = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.9, 3.6), bodyMat);
  gearbox.position.y = 1.0;
  g.add(gearbox);

  // motor can (cylinder, axis along z, sticking out the back)
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.6, 20), silverMat);
  can.rotation.x = Math.PI / 2;
  can.position.set(0, 1.0, 3.0);
  g.add(can);

  // shaft along x, pointing outward to `side`
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 10), silverMat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(side * 1.7, 1.0, -0.6);
  g.add(shaft);

  // wheel: tire + hub
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 1.3, 28), mat(0x22252c, { roughness: 0.9 }));
  tire.rotation.z = Math.PI / 2;
  tire.position.set(side * 3.1, 1.0, -0.6);
  g.add(tire);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.35, 20), mat(0xe8b400));
  hub.rotation.z = Math.PI / 2;
  hub.position.set(side * 3.1, 1.0, -0.6);
  g.add(hub);
  g.userData.wheelMeshes = [tire, hub];

  // solder-tab terminals on the motor can
  const topY = 2.0;
  addPin(g, 'M+', -0.4, topY, 3.0, side);
  addPin(g, 'M-',  0.4, topY, 3.0, side);

  return g;
}

// ── 5. 7.4V LiPo battery ─────────────────────────────────────────
export function makeBattery() {
  const g = new THREE.Group();
  g.userData = { type: 'battery', label: '7.4V LiPo', pins: [] };

  const pack = new THREE.Mesh(new THREE.BoxGeometry(7.0, 1.8, 3.5), mat(0x2b3a55));
  pack.position.y = 0.9;
  pack.castShadow = true;
  g.add(pack);

  // yellow shrink-wrap bands
  for (const x of [-2.6, 2.6]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.86, 3.56), mat(0xd9b02a));
    band.position.set(x, 0.9, 0);
    g.add(band);
  }

  // terminal tabs
  const tabR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.7), mat(0xcc3333));
  tabR.position.set(-1.0, 1.9, -1.2);
  g.add(tabR);
  const tabB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.7), blackMat);
  tabB.position.set(1.0, 1.9, -1.2);
  g.add(tabB);

  addPin(g, '+', -1.0, 2.0, -1.2, -1);
  addPin(g, '-',  1.0, 2.0, -1.2, -1);

  const title = makeFlatLabel('7.4V LiPo 2S', 0.5, { color: '#dfe8f5' });
  title.position.set(0, 1.82, 0.4);
  title.rotation.z = 0;
  g.add(title);

  return g;
}

// ── registry ─────────────────────────────────────────────────────
export const PART_DEFS = [
  {
    type: 'arduino', name: 'Arduino Uno', swatch: '#2ea04f', count: 1,
    make: makeArduino,
    desc: 'Microcontroller board',
    help: 'Runs your firmware — reads the IMU, computes PID, drives the motors. Unit 2: Microcontrollers.',
  },
  {
    type: 'mpu6050', name: 'MPU6050', swatch: '#2f6fd0', count: 1,
    make: makeMPU6050,
    desc: '6-axis IMU sensor',
    help: 'Measures tilt angle — core of Unit 4: PID Control.',
  },
  {
    type: 'l298n', name: 'L298N Driver', swatch: '#c23131', count: 1,
    make: makeL298N,
    desc: 'Dual H-bridge motor driver',
    help: 'Amplifies Arduino signals into motor current. Unit 3: Motors & Drivers.',
  },
  {
    type: 'motor', name: 'DC Gear Motor', swatch: '#f0c020', count: 2,
    make: null, // handled specially — makeMotor(side)
    desc: 'Geared motor + wheel',
    help: 'Torque source for balancing. Two needed — one per wheel. Unit 3: Motors & Drivers.',
  },
  {
    type: 'battery', name: '7.4V LiPo', swatch: '#3d5a8f', count: 1,
    make: makeBattery,
    desc: '2S battery pack',
    help: 'Powers the whole robot: 7.4V to the L298N and Arduino VIN. Unit 1: Electronics Basics.',
  },
];

// ── chassis slots (positions on the chassis plate, y = plate top) ─
export const SLOTS = [
  { id: 'slot-arduino', accepts: 'arduino', x: 0,    z: 4.5,  ry: 0,           w: 7.5,  d: 6.0 },
  { id: 'slot-mpu',     accepts: 'mpu6050', x: 0,    z: -0.4, ry: 0,           w: 3.8,  d: 2.7 },
  { id: 'slot-l298n',   accepts: 'l298n',   x: 0,    z: -6.0, ry: 0,           w: 5.0,  d: 5.0 },
  { id: 'slot-battery', accepts: 'battery', x: 0,    z: 10.0, ry: 0,           w: 7.6,  d: 4.1 },
  { id: 'slot-motorL',  accepts: 'motorL',  x: -6.9, z: -0.4, ry: 0,           w: 4.6,  d: 7.5, side: -1 },
  { id: 'slot-motorR',  accepts: 'motorR',  x: 6.9,  z: -0.4, ry: 0,           w: 4.6,  d: 7.5, side: 1 },
];
