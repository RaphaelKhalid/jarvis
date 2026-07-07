// Rapier physics: self-balancing robot on hilly terrain, drivable with WASD.
// A JS PID loop keeps it upright; WASD shifts the lean setpoint / yaws it.
import * as THREE from 'three';

let RAPIER = null;

export async function loadRapier() {
  if (RAPIER) return RAPIER;
  const mod = await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0');
  await mod.init();
  RAPIER = mod;
  return RAPIER;
}

// Tunables chosen so Kp~15, Ki~140, Kd~0.9 balances.
const TORQUE_SCALE = 60;    // PID output -> wheel torque (sized so Kp~15 balances)
const MAX_TORQUE = 520;
const FIXED_DT = 1 / 60;
const GRAVITY = 9.81;
const MAX_LEAN = 0.10;      // rad — max lean the velocity loop may command
const CRUISE_SPEED = 16;    // units/s target speed at full throttle
const K_LEAN = 0.019;       // velocity-error -> commanded lean (outer loop)
const TURN_TORQUE = 60;     // yaw torque per step at full A/D
const CHASSIS_DENSITY = 0.06;
const WHEEL_DENSITY = 0.08;

// Terrain height field — gentle hills, flatter near the spawn.
function terrainHeight(x, z) {
  const r = Math.sqrt(x * x + z * z);
  const flat = THREE.MathUtils.clamp((r - 26) / 30, 0, 1); // flat within r<26
  const h =
    1.5 * Math.sin(x * 0.045) * Math.cos(z * 0.04) +
    1.0 * Math.sin(x * 0.02 + z * 0.03) +
    0.8 * Math.cos(z * 0.06 - x * 0.015);
  return h * flat;
}

export class BalanceSim {
  constructor(scene) {
    this.scene = scene;
    this.world = null;
    this.bodies = {};
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.running = false;

    this.integral = 0;
    this.prevError = 0;
    this.gains = { Kp: 15, Ki: 140, Kd: 0.9 };
    this.tiltDeg = 0;
    this.fallen = false;
    this.onTelemetry = null;
    this._accum = 0;
    this.input = { fwd: 0, turn: 0 };
  }

  setGains(g) { this.gains = { ...g }; }

  buildTerrain() {
    const size = 200, seg = 90;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, terrainHeight(x, z));
    }
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x1a2233, roughness: 0.95, metalness: 0.0,
        flatShading: false, wireframe: false,
      })
    );
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // subtle wire overlay so the hills read clearly
    const wire = new THREE.Mesh(
      geo, new THREE.MeshBasicMaterial({ color: 0x2a3852, wireframe: true, transparent: true, opacity: 0.25 })
    );
    this.group.add(wire);

    // trimesh collider from the exact same vertices
    const verts = new Float32Array(pos.array);
    const idx = new Uint32Array(geo.index.array);
    const RB = RAPIER.RigidBodyDesc, CO = RAPIER.ColliderDesc;
    const body = this.world.createRigidBody(RB.fixed());
    this.world.createCollider(
      CO.trimesh(verts, idx).setFriction(2.2).setRestitution(0), body);
  }

  build() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.group.clear();
    this.buildTerrain();

    const RB = RAPIER.RigidBodyDesc, CO = RAPIER.ColliderDesc;

    const wheelR = 3.0, wheelW = 1.2, wheelHalf = 5.5;
    const chassisH = 11, chassisW = 4, chassisD = 3;
    const startTilt = 15 * Math.PI / 180;
    const baseY = terrainHeight(0, 0) + wheelR;
    this.home = { x: 0, z: 0 };

    // ── chassis (inverted pendulum body) ──
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), startTilt);
    const chassisBody = this.world.createRigidBody(
      RB.dynamic()
        .setTranslation(0, baseY + chassisH / 2, 0)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .enabledRotations(true, true, false)   // pitch + yaw free, roll locked
        .setCcdEnabled(true)
        .setAngularDamping(4.5)                 // physical rate damping (adds control margin)
        .setLinearDamping(0.5)
    );
    this.world.createCollider(
      CO.cuboid(chassisW / 2, chassisH / 2, chassisD / 2).setDensity(CHASSIS_DENSITY), chassisBody);
    this.bodies.chassis = chassisBody;

    const chassisMesh = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW, chassisH, chassisD),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5, metalness: 0.4 })
    );
    chassisMesh.castShadow = true;
    this.group.add(chassisMesh);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW + 0.05, 0.6, chassisD + 0.05),
      new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x123049 })
    );
    stripe.position.y = chassisH / 2 - 1;
    chassisMesh.add(stripe);
    // "front" nose marker so heading is visible while driving
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(chassisW * 0.6, 1.2, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x3ddc84, emissive: 0x0d3a22 })
    );
    nose.position.set(0, chassisH / 2 - 2.6, chassisD / 2);
    chassisMesh.add(nose);
    this.bodies.chassisMesh = chassisMesh;

    // ── two wheels on the local-X axle ──
    this.bodies.wheels = [];
    for (const side of [-1, 1]) {
      const wx = side * wheelHalf;
      const wheelBody = this.world.createRigidBody(
        RB.dynamic().setTranslation(wx, baseY, 0).setCcdEnabled(true));
      this.world.createCollider(
        CO.cylinder(wheelW / 2, wheelR)
          .setRotation(zToXQuat())
          .setFriction(3.2).setRestitution(0).setDensity(WHEEL_DENSITY),
        wheelBody);

      // chassis anchor is at the bottom of the chassis (the axle line)
      const joint = RAPIER.JointData.revolute(
        { x: wx, y: -chassisH / 2, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      this.world.createImpulseJoint(joint, chassisBody, wheelBody, true);

      const wheelMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 28),
        new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.9 })
      );
      wheelMesh.rotation.z = Math.PI / 2;
      wheelMesh.castShadow = true;
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
    this.input = { fwd: 0, turn: 0 };
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
  hide() { this.group.visible = false; this.running = false; }

  nudge() {
    if (!this.bodies.chassis) return;
    // push along the robot's current forward direction
    const f = this.forwardDir().multiplyScalar(110);
    this.bodies.chassis.applyImpulse({ x: f.x, y: 0, z: f.z }, true);
  }

  chassisPos() {
    const t = this.bodies.chassis.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  quat() {
    const r = this.bodies.chassis.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  forwardDir() {
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat());
    f.y = 0; return f.normalize();
  }

  // signed pitch from vertical, yaw-independent, monotonic through a fall (rad)
  currentTilt() {
    const q = this.quat();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwdH = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    fwdH.y = 0; fwdH.normalize();
    // component of the body's up-axis along the (horizontal) forward direction
    return Math.atan2(up.dot(fwdH), up.y);
  }

  step(realDt) {
    if (!this.running) return;
    this._accum += Math.min(realDt, 0.05);
    let n = 0;
    while (this._accum >= FIXED_DT && n < 5) {
      this._accum -= FIXED_DT;
      this.fixedStep();
      n++;
    }
    this.syncMeshes();
  }

  fixedStep() {
    const theta = this.currentTilt();
    this.tiltDeg = theta * 180 / Math.PI;
    if (Math.abs(this.tiltDeg) > 55) this.fallen = true;

    const { Kp, Ki, Kd } = this.gains;

    // ── outer loop: velocity error -> commanded lean angle ──
    const lv = this.bodies.chassis.linvel();
    const fwd = this.forwardDir();
    const baseVel = lv.x * fwd.x + lv.z * fwd.z;          // speed along heading
    let targetSpeed = this.input.fwd * CRUISE_SPEED;
    if (Math.abs(this.input.fwd) < 0.01) {
      // idle: hold station — null displacement from home along heading
      const t = this.bodies.chassis.translation();
      const along = (t.x - this.home.x) * fwd.x + (t.z - this.home.z) * fwd.z;
      targetSpeed = THREE.MathUtils.clamp(-0.5 * along, -7, 7);
    }
    const desiredLean = THREE.MathUtils.clamp(
      K_LEAN * (targetSpeed - baseVel), -MAX_LEAN, MAX_LEAN);

    // ── inner loop: PID on tilt about the commanded lean ──
    const error = theta - desiredLean;

    if (!this.fallen) {
      this.integral += error * FIXED_DT;
      this.integral = THREE.MathUtils.clamp(this.integral, -1.5, 1.5);
    }
    const deriv = (error - this.prevError) / FIXED_DT;
    this.prevError = error;

    let output = Kp * error + Ki * 0.02 * this.integral + Kd * deriv;
    let mag = THREE.MathUtils.clamp(output * TORQUE_SCALE, -MAX_TORQUE, MAX_TORQUE);

    if (!this.fallen) {
      const axle = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat()).normalize();
      const imp = { x: axle.x * mag * FIXED_DT, y: axle.y * mag * FIXED_DT, z: axle.z * mag * FIXED_DT };
      for (const w of this.bodies.wheels) w.body.applyTorqueImpulse(imp, true);

      // steering: yaw torque about world-up, eased off when leaning hard
      if (this.input.turn !== 0) {
        const lean = Math.min(1, Math.abs(theta) / 0.5);
        const ty = -this.input.turn * TURN_TORQUE * (1 - 0.7 * lean) * FIXED_DT;
        this.bodies.chassis.applyTorqueImpulse({ x: 0, y: ty, z: 0 }, true);
      }
    }

    this.world.step();
    if (this.onTelemetry) this.onTelemetry({ tiltDeg: this.tiltDeg, fallen: this.fallen });
  }

  syncMeshes() {
    const c = this.bodies.chassis;
    if (!c) return;
    const t = c.translation(), r = c.rotation();
    this.bodies.chassisMesh.position.set(t.x, t.y, t.z);
    this.bodies.chassisMesh.quaternion.set(r.x, r.y, r.z, r.w);
    const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    for (const w of this.bodies.wheels) {
      const wt = w.body.translation(), wr = w.body.rotation();
      w.mesh.position.set(wt.x, wt.y, wt.z);
      w.mesh.quaternion.copy(new THREE.Quaternion(wr.x, wr.y, wr.z, wr.w).multiply(base));
    }
  }
}

function zToXQuat() {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}
