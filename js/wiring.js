// Wiring system: click-to-connect, 3D bezier tube wires, validation, checklist.
import * as THREE from 'three';

// Required connections. Key form: "compType.pin". `kind` picks wire color.
// motorL/motorR endpoints are optional-but-nice; the REQUIRED set drives the
// checklist and Upload gating.
export const REQUIRED = [
  { a: 'mpu6050.SDA', b: 'arduino.A4',  kind: 'data',   label: 'MPU SDA → A4' },
  { a: 'mpu6050.SCL', b: 'arduino.A5',  kind: 'data',   label: 'MPU SCL → A5' },
  { a: 'mpu6050.INT', b: 'arduino.D2',  kind: 'data',   label: 'MPU INT → D2' },
  { a: 'mpu6050.VCC', b: 'arduino.5V',  kind: 'power',  label: 'MPU VCC → 5V' },
  { a: 'mpu6050.GND', b: 'arduino.GND', kind: 'ground', label: 'MPU GND → GND' },
  { a: 'l298n.IN1',   b: 'arduino.D6',  kind: 'data',   label: 'L298N IN1 → D6' },
  { a: 'l298n.IN2',   b: 'arduino.D9',  kind: 'data',   label: 'L298N IN2 → D9' },
  { a: 'l298n.IN3',   b: 'arduino.D10', kind: 'data',   label: 'L298N IN3 → D10' },
  { a: 'l298n.IN4',   b: 'arduino.D11', kind: 'data',   label: 'L298N IN4 → D11' },
  { a: 'l298n.12V',   b: 'battery.+',   kind: 'power',  label: 'L298N 12V → Bat +' },
  { a: 'l298n.GND',   b: 'battery.-',   kind: 'ground', label: 'L298N GND → Bat −' },
  { a: 'arduino.VIN', b: 'battery.+',   kind: 'power',  label: 'Arduino VIN → Bat +' },
  { a: 'arduino.GND', b: 'battery.-',   kind: 'ground', label: 'Arduino GND → Bat −' },
];

const KIND_COLOR = { power: 0xff4d4d, ground: 0x2a2f3a, data: 0xffd166 };
const HOVER_OK = 0x3ddc84;
const HOVER_BAD = 0xff5d5d;

// Build a canonical endpoint pair key regardless of order.
function pairKey(a, b) { return [a, b].sort().join('|'); }

// Look up whether a pair of endpoint IDs is a valid required connection.
function findRequired(idA, idB) {
  const key = pairKey(idA, idB);
  return REQUIRED.find(r => pairKey(r.a, r.b) === key);
}

// Suggest the correct target for a source endpoint (for error tooltips).
export function suggestFor(id) {
  const r = REQUIRED.find(r => r.a === id || r.b === id);
  if (!r) return null;
  const other = r.a === id ? r.b : r.a;
  return other;
}

export class WiringManager {
  constructor(scene, camera, renderer, onChange) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.onChange = onChange;
    this.wires = [];          // { req, idA, idB, mesh, kind }
    this.endpoints = new Map(); // id -> { obj (pin mesh), compType, pin, worldPos() }
    this.pending = null;       // first-clicked endpoint id
    this.enabled = false;
  }

  // Register all pins of a placed component instance.
  registerComponent(group, compType) {
    for (const p of group.userData.pins) {
      const id = `${compType}.${p.name}`;
      this.endpoints.set(id, {
        obj: p.obj,
        compType,
        pin: p.name,
        group,
      });
      p.obj.userData.endpointId = id;
    }
  }

  unregisterComponent(compType) {
    // remove wires touching this comp + its endpoints
    this.wires = this.wires.filter(w => {
      if (w.idA.startsWith(compType + '.') || w.idB.startsWith(compType + '.')) {
        this.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        return false;
      }
      return true;
    });
    for (const id of [...this.endpoints.keys()]) {
      if (id.startsWith(compType + '.')) this.endpoints.delete(id);
    }
    if (this.pending && this.pending.startsWith(compType + '.')) this.pending = null;
    this.onChange();
  }

  worldPosOf(id) {
    const ep = this.endpoints.get(id);
    if (!ep) return null;
    const v = new THREE.Vector3();
    ep.obj.getWorldPosition(v);
    v.y += 0.15;
    return v;
  }

  // Called by main on canvas click when a pin was hit.
  handlePinClick(id) {
    if (!this.pending) {
      this.pending = id;
      this.highlightPin(id, true);
      return { state: 'armed', id };
    }
    if (this.pending === id) {
      this.highlightPin(id, false);
      this.pending = null;
      return { state: 'cancelled' };
    }
    const from = this.pending;
    this.highlightPin(from, false);
    this.pending = null;
    return this.tryConnect(from, id);
  }

  tryConnect(idA, idB) {
    // prevent duplicates
    const dup = this.wires.find(w => pairKey(w.idA, w.idB) === pairKey(idA, idB));
    if (dup) return { state: 'duplicate' };

    const req = findRequired(idA, idB);
    const kind = req ? req.kind : 'data';
    const mesh = this.buildWire(idA, idB, kind, !!req);
    this.scene.add(mesh);
    const wire = { req, idA, idB, mesh, kind, valid: !!req };
    this.wires.push(wire);
    mesh.userData.wire = wire;
    this.onChange();

    if (req) {
      return { state: 'valid', label: req.label };
    }
    const want = suggestFor(idA) || suggestFor(idB);
    return { state: 'invalid', idA, idB, suggestion: want };
  }

  buildWire(idA, idB, kind, valid) {
    const pA = this.worldPosOf(idA);
    const pB = this.worldPosOf(idB);
    const mid = pA.clone().add(pB).multiplyScalar(0.5);
    const lift = Math.max(2.5, pA.distanceTo(pB) * 0.35);
    mid.y += lift;
    const c1 = pA.clone().lerp(mid, 0.5); c1.y += lift * 0.3;
    const c2 = pB.clone().lerp(mid, 0.5); c2.y += lift * 0.3;
    const curve = new THREE.CubicBezierCurve3(pA, c1, c2, pB);
    const geo = new THREE.TubeGeometry(curve, 32, 0.14, 8, false);
    const baseColor = valid ? KIND_COLOR[kind] : HOVER_BAD;
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: valid ? 0x000000 : 0x300000,
      roughness: 0.4, metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.baseColor = baseColor;
    return mesh;
  }

  highlightPin(id, on) {
    const ep = this.endpoints.get(id);
    if (!ep) return;
    if (on) {
      ep.obj.material = ep.obj.material.clone();
      ep.obj.material.emissive = new THREE.Color(0x4da3ff);
      ep.obj.material.emissiveIntensity = 1.5;
      ep.obj.scale.setScalar(1.6);
    } else {
      ep.obj.material.emissive = new THREE.Color(0x000000);
      ep.obj.scale.setScalar(1);
    }
  }

  // Hover feedback: recolor wire green (valid) / red (invalid).
  setWireHover(mesh, on) {
    const w = mesh.userData.wire;
    if (!w) return;
    if (on) {
      mesh.material.color.setHex(w.valid ? HOVER_OK : HOVER_BAD);
      mesh.material.emissive.setHex(w.valid ? 0x0a2a18 : 0x300000);
    } else {
      mesh.material.color.setHex(mesh.userData.baseColor);
      mesh.material.emissive.setHex(w.valid ? 0x000000 : 0x300000);
    }
  }

  removeWire(mesh) {
    const i = this.wires.findIndex(w => w.mesh === mesh);
    if (i < 0) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    this.wires.splice(i, 1);
    this.onChange();
  }

  // Which required connections are satisfied.
  status() {
    const done = new Set();
    for (const w of this.wires) {
      if (w.req) done.add(w.req.label);
    }
    return REQUIRED.map(r => ({ label: r.label, done: done.has(r.label), kind: r.kind }));
  }

  allRequiredDone() {
    return this.status().every(s => s.done);
  }

  wireMeshes() {
    return this.wires.map(w => w.mesh);
  }

  setVisible(v) {
    for (const w of this.wires) w.mesh.visible = v;
  }
}
