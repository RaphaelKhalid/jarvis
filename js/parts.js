// Part factories — each returns a THREE.Group with userData:
//   { type, label, pins: [{ name, obj }] }
// Units: 1 unit = 1 cm.
//
// What's left here are the two detailed meshes the creator bench reuses (see
// FACTORY in js/app/creator-assembly.js, which builds the rest procedurally).
// The Arduino / IMU / L298N factories, the PART_DEFS tray registry and the
// fixed chassis SLOTS belonged to the pre-pivot self-balancer and are gone with
// it — the creator bench has no fixed mount points and no microcontroller.
import * as THREE from 'three';
import { makeFlatLabel } from './labels.js';
import { partMat } from './app/part-materials.js';

const PIN_RADIUS = 0.09;
const PIN_HEIGHT = 0.28;

const mat = (color, opts = {}) =>
  partMat({ color, roughness: 0.65, metalness: 0.1, ...opts });

const goldMat = partMat({ color: 0xd4af37, roughness: 0.35, metalness: 0.8 });
const blackMat = mat(0x1a1a1a);
const silverMat = partMat({ color: 0xb0b4bc, roughness: 0.45, metalness: 0.7 });

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
  pin.userData.labelMesh = label;
  pin.userData.labelPos = { x, y, z, side: labelSide };

  group.userData.pins.push({ name, obj: pin });
  return pin;
}

// ── DC geared motor + wheel ───────────────────────────────────
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
  // rubber is genuinely matte — opt out of the gloss clamp, keep the env map
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 1.3, 28),
    mat(0x22252c, { roughness: 0.9, finish: 'rough' }));
  tire.rotation.z = Math.PI / 2;
  tire.position.set(side * 3.1, 1.0, -0.6);
  g.add(tire);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.35, 20), mat(0xe8b400));
  hub.rotation.z = Math.PI / 2;
  hub.position.set(side * 3.1, 1.0, -0.6);
  g.add(hub);
  // bright cross-spokes on the tyre faces so the wheel's rotation is *visible*
  // when it spins (a smooth cylinder looks static). Children of the tyre, so
  // they inherit its spin. Tyre local Y = axle; faces sit at local y = ±0.65.
  const spokeMat = mat(0xff7a3c);
  spokeMat.emissive = new THREE.Color(0xff3a10);
  spokeMat.emissiveIntensity = 0.5;
  for (const fy of [0.68, -0.68]) {
    for (let s = 0; s < 2; s++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.28, 0.7), spokeMat);
      spoke.position.y = fy;
      spoke.rotation.y = s * Math.PI / 2;
      tire.add(spoke);
    }
  }
  g.userData.wheelMeshes = [tire, hub];

  // solder-tab terminals on the motor can
  const topY = 2.0;
  addPin(g, 'M+', -0.4, topY, 3.0, side);
  addPin(g, 'M-',  0.4, topY, 3.0, side);

  return g;
}

// ── 7.4V LiPo battery ─────────────────────────────────────────
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
