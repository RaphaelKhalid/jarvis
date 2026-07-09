// Rapier physics: self-balancing robot on hilly terrain, drivable with WASD.
// A JS PID loop keeps it upright; WASD shifts the lean setpoint / yaws it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let RAPIER = null;

export async function loadRapier() {
  if (RAPIER) return RAPIER;
  const mod = await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0');
  await mod.init();
  RAPIER = mod;
  return RAPIER;
}

// Real CC0 robot model (RobotExpressive by Tomás Laulhé / Quaternius, via three.js
// examples). Loaded from our own /assets so it's same-origin. Falls back to the
// procedural sphere-bot if it fails to load.
let ROBOT = null, ROBOT_SIZE = null, ROBOT_MINY = 0, robotTried = false;
export async function loadRobotModel() {
  if (ROBOT || robotTried) return ROBOT;
  robotTried = true;
  try {
    const gltf = await new GLTFLoader().loadAsync('assets/models/robot.glb');
    const m = gltf.scene;
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    const bb = new THREE.Box3().setFromObject(m);
    ROBOT_SIZE = bb.getSize(new THREE.Vector3());
    ROBOT_MINY = bb.min.y;
    ROBOT = m;
  } catch (e) { ROBOT = null; }
  return ROBOT;
}

// Tunables chosen so Kp~15, Ki~140, Kd~0.9 balances.
const TORQUE_SCALE = 60;    // PID output -> wheel torque (sized so Kp~15 balances)
const MAX_TORQUE = 620;
const FIXED_DT = 1 / 60;
const GRAVITY = 9.81;
const MAX_LEAN = 0.20;      // rad — cap on the idle station-hold lean
const CRUISE_SPEED = 24;    // units/s target speed at full throttle (WASD is primary)
const K_LEAN = 0.030;       // idle station-hold: velocity error -> lean
const TURN_TORQUE = 95;     // yaw torque per step at full A/D
const CHASSIS_DENSITY = 0.06;
const WHEEL_DENSITY = 0.08;
const ARENA_HALF = 72;      // arena inner half-extent (walls at this distance)
const DRIVE_FF_LEAN = 0.06; // feed-forward lean into a drive (rad)
const DRIVE_KV = 46;        // wheel-speed servo gain
const DRIVE_MAX = 440;      // max drive torque from the servo

// Terrain height field — gentle rolling hills, flat near the spawn, flat at walls.
function terrainHeight(x, z) {
  const r = Math.sqrt(x * x + z * z);
  const flat = THREE.MathUtils.clamp((r - 26) / 26, 0, 1);   // flat within r<26
  const edge = THREE.MathUtils.clamp((ARENA_HALF - 4 - Math.max(Math.abs(x), Math.abs(z))) / 14, 0, 1);
  const h =
    1.6 * Math.sin(x * 0.045) * Math.cos(z * 0.04) +
    1.1 * Math.sin(x * 0.02 + z * 0.03) +
    0.8 * Math.cos(z * 0.06 - x * 0.015);
  return h * flat * edge;
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

  buildArena() {
    const RB = RAPIER.RigidBodyDesc, CO = RAPIER.ColliderDesc;
    const size = (ARENA_HALF + 8) * 2, seg = 100;

    // ── ground: bright rolling grass ──
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.72, metalness: 0.15 })
    );
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const groundBody = this.world.createRigidBody(RB.fixed());
    this.world.createCollider(
      CO.trimesh(new Float32Array(pos.array), new Uint32Array(geo.index.array))
        .setFriction(2.2).setRestitution(0), groundBody);

    // ── perimeter walls ──
    const WH = 11, WT = 3, L = ARENA_HALF;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b333d, roughness: 0.5, metalness: 0.35 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x0a2438, roughness: 0.35, metalness: 0.4, emissive: 0x18b6ff, emissiveIntensity: 2.4 });
    const walls = [
      { x: 0, z: L, sx: (L + WT) * 2, sz: WT },
      { x: 0, z: -L, sx: (L + WT) * 2, sz: WT },
      { x: L, z: 0, sx: WT, sz: (L + WT) * 2 },
      { x: -L, z: 0, sx: WT, sz: (L + WT) * 2 },
    ];
    for (const w of walls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w.sx, WH, w.sz), wallMat);
      wall.position.set(w.x, WH / 2, w.z);
      wall.castShadow = true; wall.receiveShadow = true;
      this.group.add(wall);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w.sx + 0.4, 0.7, w.sz + 0.4), capMat);
      cap.position.set(w.x, WH + 0.2, w.z);
      this.group.add(cap);
      const wb = this.world.createRigidBody(RB.fixed().setTranslation(w.x, WH / 2, w.z));
      this.world.createCollider(CO.cuboid(w.sx / 2, WH / 2, w.sz / 2).setFriction(0.4).setRestitution(0.1), wb);
    }
  }

  build() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.group.clear();
    this.buildArena();

    const RB = RAPIER.RigidBodyDesc, CO = RAPIER.ColliderDesc;

    const wheelR = 3.3, wheelW = 2.4, wheelHalf = 5.2;
    this.wheelR = wheelR;
    const chassisH = 11, chassisW = 4, chassisD = 3;
    const startTilt = 15 * Math.PI / 180;
    const baseY = terrainHeight(0, 0) + wheelR;
    this.home = { x: 0, z: 0 };
    this.heading = 0;   // target yaw (rad); +z forward => atan2(0,1)=0

    // ── chassis (inverted pendulum body) ──
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), startTilt);
    const chassisBody = this.world.createRigidBody(
      RB.dynamic()
        .setTranslation(0, baseY + chassisH / 2, 0)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .enabledRotations(true, true, false)   // pitch + yaw free, roll locked
        .setCcdEnabled(true)
        .setAngularDamping(1.6)                 // physical rate damping (adds control margin)
        .setLinearDamping(0.05)                 // low: lets the bot reach cruise speed
    );
    this.world.createCollider(
      CO.cuboid(chassisW / 2, chassisH / 2, chassisD / 2).setDensity(CHASSIS_DENSITY), chassisBody);
    this.bodies.chassis = chassisBody;

    const chassisMesh = makeRobotVisual(chassisH);
    this.group.add(chassisMesh);
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

      const wheelMesh = makeWheelVisual(wheelR, wheelW);
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
    // a poke near the top of the body: a gentle disturbance it has to *recover*
    // from (that's the whole point), not a launch. Applied above the CoM so it tips.
    const f = this.forwardDir().multiplyScalar(18);
    const c = this.bodies.chassis.translation();
    this.bodies.chassis.applyImpulseAtPoint(
      { x: f.x, y: 0, z: f.z }, { x: c.x, y: c.y + 4.5, z: c.z }, true);
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
    const driving = Math.abs(this.input.fwd) > 0.01;

    const lv = this.bodies.chassis.linvel();
    const fwd = this.forwardDir();
    const baseVel = lv.x * fwd.x + lv.z * fwd.z;          // speed along heading
    const axle = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat()).normalize();

    // ── commanded lean ──
    // driving: a small feed-forward lean into the motion; the wheel-speed
    // servo below does the actual accelerating. idle: hold station.
    let desiredLean;
    if (driving) {
      desiredLean = this.input.fwd * DRIVE_FF_LEAN;
    } else {
      const t = this.bodies.chassis.translation();
      const along = (t.x - this.home.x) * fwd.x + (t.z - this.home.z) * fwd.z;
      const targetSpeed = THREE.MathUtils.clamp(-0.5 * along, -7, 7);
      desiredLean = THREE.MathUtils.clamp(K_LEAN * (targetSpeed - baseVel), -MAX_LEAN, MAX_LEAN);
    }
    this.debug = { baseVel: +baseVel.toFixed(2), desiredLean: +desiredLean.toFixed(3) };

    // ── inner loop: PID keeps the bot upright about the commanded lean ──
    const error = theta - desiredLean;
    if (!this.fallen) {
      this.integral += error * FIXED_DT;
      this.integral = THREE.MathUtils.clamp(this.integral, -1.5, 1.5);
    }
    const deriv = (error - this.prevError) / FIXED_DT;
    this.prevError = error;
    const output = Kp * error + Ki * 0.02 * this.integral + Kd * deriv;
    const magBal = THREE.MathUtils.clamp(output * TORQUE_SCALE, -MAX_TORQUE, MAX_TORQUE);

    // ── wheel-speed servo: WASD drives the wheels directly to a target speed ──
    let magDrive = 0;
    if (driving) {
      const targetOmega = this.input.fwd * (CRUISE_SPEED / this.wheelR);
      let om = 0;
      for (const w of this.bodies.wheels) {
        const a = w.body.angvel();
        om += a.x * axle.x + a.y * axle.y + a.z * axle.z;
      }
      om /= this.bodies.wheels.length;
      magDrive = THREE.MathUtils.clamp(DRIVE_KV * (targetOmega - om), -DRIVE_MAX, DRIVE_MAX);
    }

    if (!this.fallen) {
      const total = THREE.MathUtils.clamp(magBal + magDrive, -MAX_TORQUE, MAX_TORQUE);
      const imp = { x: axle.x * total * FIXED_DT, y: axle.y * total * FIXED_DT, z: axle.z * total * FIXED_DT };
      for (const w of this.bodies.wheels) w.body.applyTorqueImpulse(imp, true);

      // steering + heading hold: A/D advance the target heading; a PD loop
      // locks the robot to it so it drives dead straight otherwise.
      const yaw = Math.atan2(fwd.x, fwd.z);
      const yawRate = this.bodies.chassis.angvel().y;
      if (this.input.turn !== 0) this.heading -= this.input.turn * 2.3 * FIXED_DT;
      let yawErr = this.heading - yaw;
      yawErr = Math.atan2(Math.sin(yawErr), Math.cos(yawErr));   // wrap to [-pi,pi]
      const lean = Math.min(1, Math.abs(theta) / 0.5);
      const ty = (TURN_TORQUE * yawErr - 0.25 * TURN_TORQUE * yawRate) * (1 - 0.6 * lean) * FIXED_DT;
      this.bodies.chassis.applyTorqueImpulse({ x: 0, y: ty, z: 0 }, true);
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

// ── premium material set (gunmetal body + steel trim + carbon + glowing accents) ──
// deliberately NOT uniform white chrome — that read as a "cheap toy". Reflections
// come from scene.environment; the emissive accents drive the bloom pass.
const CHROME = new THREE.MeshStandardMaterial({ color: 0x2a2f37, metalness: 0.95, roughness: 0.26 });   // gunmetal (main body)
const CHROME_DK = new THREE.MeshStandardMaterial({ color: 0x0f1216, metalness: 0.75, roughness: 0.5 });  // dark carbon (panels)
const DARKMETAL = new THREE.MeshStandardMaterial({ color: 0x090b0e, metalness: 0.6, roughness: 0.6 });   // matte vents
const STEEL = new THREE.MeshStandardMaterial({ color: 0xc2cad6, metalness: 1.0, roughness: 0.17 });      // bright trim / bolts
const GLASS = new THREE.MeshStandardMaterial({ color: 0x04060b, metalness: 0.8, roughness: 0.04 });      // dark glass screens
const LENS = new THREE.MeshStandardMaterial({ color: 0x0a2036, metalness: 0.3, roughness: 0.12, emissive: 0x22c4ff, emissiveIntensity: 4.0 });
const SEAM = new THREE.MeshStandardMaterial({ color: 0x061a2b, metalness: 0.4, roughness: 0.3, emissive: 0x18b6ff, emissiveIntensity: 3.2 });
const TIRE = new THREE.MeshStandardMaterial({ color: 0x121418, metalness: 0.2, roughness: 0.8 });

// Chrome sphere-bot matching the reference: metallic body, camera dome,
// two gripper arms, on a neck above the wheel axle. Origin = chassis center.
function makeRobotVisual(chassisH) {
  const g = new THREE.Group();
  const bottom = -chassisH / 2;   // axle line in local coords

  // ── real GLB robot (preferred) ──
  if (ROBOT && ROBOT_SIZE) {
    const targetH = chassisH * 1.12;
    const s = targetH / ROBOT_SIZE.y;
    ROBOT.scale.setScalar(s);
    ROBOT.position.set(0, bottom - ROBOT_MINY * s, 0);   // feet on the axle line
    ROBOT.rotation.y = 0;                                // faces +Z (drive forward)
    g.add(ROBOT);
    return g;
  }

  // ── procedural sphere-bot fallback ──
  // neck from axle up to the body
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 4.2, 20), CHROME);
  neck.position.y = bottom + 2.1;
  neck.castShadow = true;
  g.add(neck);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 24), STEEL);
  collar.position.y = bottom + 4.1;
  g.add(collar);

  // main body sphere
  const body = new THREE.Mesh(new THREE.SphereGeometry(3.4, 40, 32), CHROME);
  body.position.y = bottom + 7.0;
  body.castShadow = true;
  g.add(body);

  // glowing equator seam + a lower accent ring (these bloom)
  const seam = new THREE.Mesh(new THREE.TorusGeometry(3.36, 0.10, 12, 60), SEAM);
  seam.rotation.x = Math.PI / 2;
  seam.position.y = bottom + 7.0;
  g.add(seam);
  const seam2 = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.07, 10, 60), SEAM);
  seam2.rotation.x = Math.PI / 2;
  seam2.position.y = bottom + 5.4;
  g.add(seam2);
  // machined steel belt just under the equator
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(3.28, 3.28, 0.5, 40), STEEL);
  belt.position.y = bottom + 6.55;
  g.add(belt);

  // side vent grilles (dark slots), mirrored on both sides
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 1.9 - Math.abs(i - 2) * 0.35), DARKMETAL);
      fin.position.set(sx * 2.55, bottom + 7.0 + (i - 2) * 0.55, 0.5);
      g.add(fin);
    }
  }

  // front face panel (dark screen)
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.5, 28), GLASS);
  face.position.set(0, bottom + 6.4, 3.28);
  g.add(face);

  // camera dome on top
  const domeRing = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.9, 0.5, 28), STEEL);
  domeRing.position.y = bottom + 9.9;
  g.add(domeRing);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.7, 28, 20, 0, Math.PI * 2, 0, Math.PI / 2), GLASS);
  dome.position.y = bottom + 10.1;
  dome.castShadow = true;
  g.add(dome);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 16), LENS);
  lens.position.set(0, bottom + 10.5, 0.9);
  g.add(lens);

  // two arms with grippers
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 3.0, bottom + 6.6, 0.3);

    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.85, 18, 14), CHROME_DK);
    arm.add(shoulder);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 3.0, 14), CHROME);
    upper.rotation.z = Math.PI / 2;
    upper.position.x = sx * 1.7;
    arm.add(upper);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), CHROME_DK);
    elbow.position.x = sx * 3.2;
    arm.add(elbow);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 2.2, 14), CHROME);
    fore.position.set(sx * 3.9, -0.9, 0);
    fore.rotation.z = sx * 0.5;
    arm.add(fore);
    // gripper base + two claws
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 14), CHROME_DK);
    wrist.position.set(sx * 4.5, -2.0, 0);
    arm.add(wrist);
    for (const cz of [-0.28, 0.28]) {
      const claw = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.22), CHROME);
      claw.position.set(sx * 4.9, -2.7, cz);
      claw.rotation.z = sx * 0.25;
      arm.add(claw);
    }
    g.add(arm);
  }

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// Fat treaded wheel; local cylinder axis = Y (sync rotates it onto the X axle).
function makeWheelVisual(r, w) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 30), TIRE);
  tire.castShadow = true;
  g.add(tire);
  // tread blocks around the circumference
  const N = 18;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.5, w * 0.98, 0.9), TIRE);
    block.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    block.rotation.y = -a;
    g.add(block);
  }
  // chrome rim + hub cap on both faces
  for (const sy of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.25, 24), STEEL);
    rim.position.y = sy * (w / 2 + 0.02);
    g.add(rim);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, 0.4, 16), CHROME_DK);
    cap.position.y = sy * (w / 2 + 0.1);
    g.add(cap);
    // spokes
    for (let s = 0; s < 5; s++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, 0.12, 0.35), CHROME_DK);
      sp.position.y = sy * (w / 2 + 0.02);
      sp.rotation.y = (s / 5) * Math.PI * 2;
      g.add(sp);
    }
  }
  return g;
}
