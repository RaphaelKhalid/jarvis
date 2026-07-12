// Wiring system: click-to-connect, 3D bezier tube wires, validation, checklist.
import * as THREE from 'three';
import { activeRobot } from './robots/index.js';

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
  // driver outputs to the two motors — completes the loop so the wheels turn
  { a: 'l298n.OUT1',  b: 'motorL.M+',   kind: 'power',  label: 'L298N OUT1 → L Motor +' },
  { a: 'l298n.OUT2',  b: 'motorL.M-',   kind: 'power',  label: 'L298N OUT2 → L Motor −' },
  { a: 'l298n.OUT3',  b: 'motorR.M+',   kind: 'power',  label: 'L298N OUT3 → R Motor +' },
  { a: 'l298n.OUT4',  b: 'motorR.M-',   kind: 'power',  label: 'L298N OUT4 → R Motor −' },
];

const KIND_COLOR = { power: 0xff4d4d, ground: 0x2a2f3a, data: 0xffd166 };
const HOVER_OK = 0x3ddc84;
const HOVER_BAD = 0xff5d5d;

// Build a canonical endpoint pair key regardless of order.
function pairKey(a, b) { return [a, b].sort().join('|'); }

// Module-level suggestion over the default (self-balancer) required set, kept
// for callers that don't hold a WiringManager instance. Instance code should
// prefer `wiring.suggestFor` (scoped to the active robot's required set).
export function suggestFor(id, required = REQUIRED) {
  const r = required.find(r => r.a === id || r.b === id);
  if (!r) return null;
  return r.a === id ? r.b : r.a;
}

export class WiringManager {
  constructor(scene, camera, renderer, onChange, required = activeRobot().required) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.onChange = onChange;
    this.required = required;  // the active robot's REQUIRED set (validation source)
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
        this._disposeCharges(w);
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

  // Look up whether a pair of endpoint IDs is a valid required connection.
  findRequired(idA, idB) {
    const key = pairKey(idA, idB);
    return this.required.find(r => pairKey(r.a, r.b) === key);
  }

  // Suggest the correct target for a source endpoint (for error tooltips).
  suggestFor(id) {
    return suggestFor(id, this.required);
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

    const req = this.findRequired(idA, idB);
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
    const want = this.suggestFor(idA) || this.suggestFor(idB);
    return { state: 'invalid', idA, idB, suggestion: want };
  }

  // bezier arc between two pin positions (shared by build + refresh)
  _curveFor(pA, pB) {
    const mid = pA.clone().add(pB).multiplyScalar(0.5);
    const lift = Math.max(2.5, pA.distanceTo(pB) * 0.35);
    mid.y += lift;
    const c1 = pA.clone().lerp(mid, 0.5); c1.y += lift * 0.3;
    const c2 = pB.clone().lerp(mid, 0.5); c2.y += lift * 0.3;
    return new THREE.CubicBezierCurve3(pA, c1, c2, pB);
  }

  // Re-anchor every wire to its pins' CURRENT world positions. Needed because
  // parts animate (drop-in) after placement — wires connected mid-animation
  // would otherwise stay baked to the airborne pin positions.
  refreshPositions() {
    for (const w of this.wires) {
      const pA = this.worldPosOf(w.idA);
      const pB = this.worldPosOf(w.idB);
      if (!pA || !pB) continue;
      const curve = this._curveFor(pA, pB);
      const geo = new THREE.TubeGeometry(curve, 32, 0.14, 8, false);
      geo.userData = { curve };
      w.mesh.geometry.dispose();
      w.mesh.geometry = geo;
      w.mesh.userData.curve = curve;
    }
  }

  buildWire(idA, idB, kind, valid) {
    const pA = this.worldPosOf(idA);
    const pB = this.worldPosOf(idB);
    const curve = this._curveFor(pA, pB);
    const geo = new THREE.TubeGeometry(curve, 32, 0.14, 8, false);
    geo.userData = { curve };
    const baseColor = valid ? KIND_COLOR[kind] : HOVER_BAD;
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: valid ? 0x000000 : 0x300000,
      roughness: 0.4, metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.baseColor = baseColor;
    mesh.userData.curve = curve;
    return mesh;
  }

  // ── animated current flow: glowing charges travel along completed wires ──
  ensureCharges(w) {
    if (w.charges) return;
    w.charges = [];
    const color = w.valid ? (KIND_COLOR[w.kind] ?? 0xffffff) : 0x888888;
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 10, 10),
        new THREE.MeshBasicMaterial({ color }));
      c.visible = false;
      this.scene.add(c);
      w.charges.push(c);
    }
  }
  animateFlow(dt, on) {
    this._flowT = ((this._flowT || 0) + dt * 0.5) % 1;
    for (const w of this.wires) {
      this.ensureCharges(w);
      const curve = w.mesh.userData.curve;
      const show = on && w.valid && w.mesh.visible && !!curve;
      w.charges.forEach((c, i) => {
        c.visible = show;
        if (show) c.position.copy(curve.getPointAt((this._flowT + i / w.charges.length) % 1));
      });
    }
  }
  _disposeCharges(w) {
    for (const c of w.charges || []) { this.scene.remove(c); c.geometry.dispose(); }
    w.charges = null;
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
    this._disposeCharges(this.wires[i]);
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
    return this.required.map(r => ({ label: r.label, done: done.has(r.label), kind: r.kind }));
  }

  allRequiredDone() {
    return this.status().every(s => s.done);
  }

  wireMeshes() {
    return this.wires.map(w => w.mesh);
  }

  setVisible(v) {
    for (const w of this.wires) {
      w.mesh.visible = v;
      if (!v) for (const c of w.charges || []) c.visible = false;
    }
  }
}
