// Rapier physics: inverted-pendulum self-balancing robot + JS PID loop.
// Rapier is loaded as an ES module (rapier3d-compat) and initialized once.
import * as THREE from 'three';

let RAPIER = null;

export async function loadRapier() {
  if (RAPIER) return RAPIER;
  const mod = await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0');
  await mod.init();
  RAPIER = mod;
  return RAPIER;
}

// Tunables chosen so that Kp~15, Ki~140, Kd~0.9 balances.
const TORQUE_SCALE = 0.85;   // PID output -> wheel torque impulse
const MAX_TORQUE = 30;
const FIXED_DT = 1 / 60;

export class BalanceSim {
  constructor(scene) {
    this.scene = scene;
    this.world = null;
    this.bodies = {};
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.running = false;

    // controller state
    this.integral = 0;
    this.prevError = 0;
    this.gains = { Kp: 15, Ki: 140, Kd: 0.9 };
    this.tiltDeg = 0;
    this.fallen = false;
    this.onTelemetry = null;
    this._accum = 0;
  }

  setGains(g) { this.gains = { ...g }; }

  build() {
    const g = 9.81;
    this.world = new RAPIER.World({ x: 0, y: -g * 3, z: 0 });
    this.group.clear();

    const RB = RAPIER.RigidBodyDesc;
    const CO = RAPIER.ColliderDesc;

    // ── ground ──
    const groundBody = this.world.createRigidBody(RB.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(
      CO.cuboid(40, 0.5, 40).setFriction(2.0).setRestitution(0), groundBody);
    const groundMesh = new THREE.Mesh(
      new THREE.BoxGeometry(80, 1, 80),
      new THREE.MeshStandardMaterial({ color: 0x161c28, roughness: 0.9 })
    );
    groundMesh.position.y = -0.5;
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);

    const wheelR = 3.0, wheelW = 1.2, wheelHalf = 5.5;
    const chassisH = 11, chassisW = 4, chassisD = 3;
    const startTilt = 15 * Math.PI / 180;

    // ── chassis (the inverted pendulum body) ──
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), startTilt);
    const chassisBody = this.world.createRigidBody(
      RB.dynamic()
        .setTranslation(0, wheelR + chassisH / 2, 0)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        // keep motion planar: no sideways drift, no yaw/roll
        .setEnabledTranslations(false, true, true)
        .setEnabledRotations(true, false, false)
    );
    this.world.createCollider(
      CO.cuboid(chassisW / 2, chassisH / 2, chassisD / 2).setDensity(1.0), chassisBody);
    this.bodies.chassis = chassisBody;

    const chassisMesh = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW, chassisH, chassisD),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5, metalness: 0.4 })
    );
    chassisMesh.castShadow = true;
    this.group.add(chassisMesh);
    // accent stripe so tilt is readable
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW + 0.05, 0.6, chassisD + 0.05),
      new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x123049 })
    );
    stripe.position.y = chassisH / 2 - 1;
    chassisMesh.add(stripe);
    this.bodies.chassisMesh = chassisMesh;

    // ── two wheels, revolute-jointed to chassis on the X axle ──
    this.bodies.wheels = [];
    for (const side of [-1, 1]) {
      const wx = side * wheelHalf;
      const wheelBody = this.world.createRigidBody(
        RB.dynamic()
          .setTranslation(wx, wheelR, 0)
          .setEnabledTranslations(false, true, true)
      );
      this.world.createCollider(
        CO.cylinder(wheelW / 2, wheelR)
          .setRotation(zToXQuat())     // cylinder axis -> X
          .setFriction(3.0).setRestitution(0).setDensity(0.8),
        wheelBody);

      const joint = RAPIER.JointData.revolute(
        { x: wx, y: 0, z: 0 },          // anchor on chassis (local)
        { x: 0, y: 0, z: 0 },           // anchor on wheel (local)
        { x: 1, y: 0, z: 0 }            // axle axis
      );
      this.world.createImpulseJoint(joint, chassisBody, wheelBody, true);

      const wheelMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 28),
        new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.9 })
      );
      wheelMesh.rotation.z = Math.PI / 2;
      wheelMesh.castShadow = true;
      // spoke marker to show spin
      const hub = new THREE.Mesh(
        new THREE.BoxGeometry(wheelW + 0.1, wheelR * 1.5, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xe8b400 })
      );
      wheelMesh.add(hub);
      this.group.add(wheelMesh);

      this.bodies.wheels.push({ body: wheelBody, mesh: wheelMesh });
    }

    this.integral = 0;
    this.prevError = 0;
    this.fallen = false;
    this.syncMeshes();
  }

  start() {
    if (!this.world) this.build();
    this.group.visible = true;
    this.running = true;
  }

  reset() {
    this.world = null;
    this.build();
    this.running = true;
    this.group.visible = true;
  }

  stop() { this.running = false; }

  nudge() {
    if (!this.bodies.chassis) return;
    this.bodies.chassis.applyImpulse({ x: 0, y: 0, z: 90 }, true);
  }

  // signed tilt about X axis, radians (top leaning +z is positive)
  currentTilt() {
    const rot = this.bodies.chassis.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    return Math.asin(THREE.MathUtils.clamp(up.z, -1, 1));
  }

  step(realDt) {
    if (!this.running) return;
    this._accum += Math.min(realDt, 0.05);
    while (this._accum >= FIXED_DT) {
      this._accum -= FIXED_DT;
      this.fixedStep();
    }
    this.syncMeshes();
  }

  fixedStep() {
    const theta = this.currentTilt();
    this.tiltDeg = theta * 180 / Math.PI;

    if (Math.abs(this.tiltDeg) > 55) this.fallen = true;

    const { Kp, Ki, Kd } = this.gains;
    const error = theta;                // setpoint = 0 (upright)

    if (!this.fallen) {
      this.integral += error * FIXED_DT;
      this.integral = THREE.MathUtils.clamp(this.integral, -1.5, 1.5);
    }
    const deriv = (error - this.prevError) / FIXED_DT;
    this.prevError = error;

    // PID output (Ki scaled down: integral term is naturally small)
    let output = Kp * error + Ki * 0.02 * this.integral + Kd * deriv;
    let torque = THREE.MathUtils.clamp(output * TORQUE_SCALE, -MAX_TORQUE, MAX_TORQUE);

    if (!this.fallen) {
      for (const w of this.bodies.wheels) {
        w.body.applyTorqueImpulse({ x: torque * FIXED_DT, y: 0, z: 0 }, true);
      }
    }

    this.world.step();

    if (this.onTelemetry) {
      this.onTelemetry({ tiltDeg: this.tiltDeg, fallen: this.fallen });
    }
  }

  syncMeshes() {
    const c = this.bodies.chassis;
    if (!c) return;
    const t = c.translation(), r = c.rotation();
    this.bodies.chassisMesh.position.set(t.x, t.y, t.z);
    this.bodies.chassisMesh.quaternion.set(r.x, r.y, r.z, r.w);
    for (const w of this.bodies.wheels) {
      const wt = w.body.translation(), wr = w.body.rotation();
      w.mesh.position.set(wt.x, wt.y, wt.z);
      const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      const rot = new THREE.Quaternion(wr.x, wr.y, wr.z, wr.w);
      w.mesh.quaternion.copy(rot.multiply(base));
    }
  }

  hide() { this.group.visible = false; this.running = false; }
}

function zToXQuat() {
  // rotate cylinder (default Y axis) so its axis points along X
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}
