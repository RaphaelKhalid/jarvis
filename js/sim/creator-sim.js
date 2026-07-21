// Creator sim (M1): the doc-driven physics body. For every motor component in
// the RobotDoc it spins a Rapier wheel on a revolute joint, driven by the SOLVED
// circuit torque — not a target velocity. Each 1/60 step:
//   read ω from the joint → solve circuit (back-EMF = Ke·ω) → τ = Kt·i − friction
//   → apply τ as a Rapier torque → world.step() integrates → new ω next step.
// Open circuit ⇒ τ≈0 ⇒ ω→0. Reversed polarity ⇒ i<0 ⇒ reverse spin. Short ⇒ the
// solver flags ok:false ⇒ motorTorque returns 0 ⇒ no spin.
import * as THREE from 'three';
import { loadRapier } from '../sim.js';
import { solveCircuit, motorTorque } from './circuit.js';
import { baseType } from '../model/library.js';

const AXLE = new THREE.Vector3(1, 0, 0);   // wheels spin about +x

export class CreatorSim {
  constructor(scene) {
    this.scene = scene;
    this.world = null;
    this.motors = [];        // { id, params, body, mesh }
    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);
    this.running = false;
    this.doc = null;
    this._onOmega = null;
  }

  // Build the physics scene from a RobotDoc. Requires Rapier already loaded.
  async build(doc) {
    const RAPIER = await loadRapier();
    this._teardown();
    this.doc = doc;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    const motors = doc.components.filter(c => baseType(c.type) === 'motor');
    let x = -((motors.length - 1) * 8) / 2;
    for (const c of motors) {
      // fixed anchor + dynamic wheel joined by a revolute about the axle.
      const anchor = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, 6, 0));
      const wheelBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 6, 0)
          .setAngularDamping(0)); // damping modeled in the coupling, not here
      const radius = 3.0, halfW = 0.7;
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(halfW, radius).setDensity(0.08).setRotation(
          quatFromAxleZ()), wheelBody);
      const jd = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, AXLE);
      this.world.createImpulseJoint(jd, anchor, wheelBody, true);

      // visual wheel: tire + a spoke so rotation is visible
      const mesh = new THREE.Group();
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, 1.3, 28),
        new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.9 }));
      tire.rotation.z = Math.PI / 2;
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, radius * 1.9, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xf0c020, emissive: 0x3a2a00, emissiveIntensity: 0.6 }));
      spoke.position.x = 0.9;
      mesh.add(tire, spoke);
      mesh.position.set(x, 6, 0);
      this.group.add(mesh);

      this.motors.push({ id: c.id, params: { ...c.params }, body: wheelBody, mesh });
      x += 8;
    }
    return this.motors.length;
  }

  // Scalar ω (rad/s about the axle) for one motor, or 0.
  omega(id) {
    const m = this.motors.find(mm => mm.id === id);
    if (!m) return 0;
    const w = m.body.angvel();
    return w.x * AXLE.x + w.y * AXLE.y + w.z * AXLE.z;
  }

  telemetry() {
    const out = {};
    for (const m of this.motors) out[m.id] = { omega: this.omega(m.id) };
    return out;
  }

  start() { this.group.visible = true; this.running = true; }
  hide() { this.group.visible = false; this.running = false; }

  // callback(stateOf) so main can push live ω into api.setSimState for the
  // Inspector's electrical readout.
  onOmega(cb) { this._onOmega = cb; }

  reset() {
    for (const m of this.motors) {
      m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      m.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
  }

  step(dt) {
    if (!this.running || !this.world) return;
    const stateOf = {};
    for (const m of this.motors) stateOf[m.id] = { omega: this.omega(m.id) };
    // solve once at the step's ω, then apply torque; Rapier integrates ω.
    const sol = solveCircuit(this.doc, stateOf);
    for (const m of this.motors) {
      const tau = motorTorque(m.id, sol, m.params, stateOf[m.id].omega);
      // torque about the axle; scale to the sim's cm units (1 unit = 1 cm).
      m.body.addTorque({ x: AXLE.x * tau * 1e4, y: 0, z: 0 }, true);
    }
    // fixed-step integrate (up to a few substeps of catch-up)
    const steps = Math.min(5, Math.max(1, Math.round(dt / (1 / 60))));
    for (let i = 0; i < steps; i++) this.world.step();

    // sync meshes
    for (const m of this.motors) {
      const r = m.body.rotation();
      m.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    this._onOmega?.(this.telemetry());
  }

  _teardown() {
    for (const m of this.motors) this.group.remove(m.mesh);
    this.motors = [];
    if (this.world) { this.world.free?.(); this.world = null; }
  }
}

// cylinder default axis is Y; rotate so its axis lies along X (the axle).
function quatFromAxleZ() {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}
