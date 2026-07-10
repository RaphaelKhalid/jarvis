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
// RobotExpressive is ~1.8 units tall with its origin at the feet. Box3 on a
// skinned mesh is unreliable, so we use a fixed scale tuned to the chassis.
const ROBOT_SCALE = 6.2;   // model height ≈ chassisH
const ROBOT_Y = 0.2;       // lift so feet clear the axle line
let ROBOT = null, robotTried = false;
export async function loadRobotModel() {
  if (ROBOT || robotTried) return ROBOT;
  robotTried = true;
  try {
    const gltf = await new GLTFLoader().loadAsync('assets/models/robot.glb');
    const m = gltf.scene;
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    ROBOT = m;
  } catch (e) { ROBOT = null; }
  return ROBOT;
}

const FIXED_DT = 1 / 60;
const GRAVITY = 9.81;
const CHASSIS_DENSITY = 0.06;
const WHEEL_DENSITY = 0.08;
const ARENA_HALF = 150;     // arena inner half-extent (walls at this distance)

// ── arcade driving model: kinematic velocity + heading, PID keeps pitch upright ──
const MAX_SPEED = 34;         // units/s top speed at full throttle
const ACCEL = 46;             // units/s² throttle acceleration
const BRAKE = 60;             // units/s² braking / coast-to-stop
const TURN_RATE = 2.8;        // rad/s heading change at full steer
const TURN_ASSIST = 0.5;      // fraction of turn authority available at a standstill
const YAW_TRACK = 14;         // how hard the body yaw snaps onto the heading
const MAX_YAW_RATE = 7;       // rad/s cap on yaw
const LEAN_ACCEL_STYLE = 0.02;// rad of stylistic pitch lean per (units/s²) of accel
const MAX_DRIVE_LEAN = 0.22;  // cap on the stylistic lean
const LEAN_SLEW = 1.4;        // rad/s max change of the lean setpoint
// jumping / airborne / falling
const AIR_G = 55;             // gravity for the ballistic jump arc (tuned, not real g)
const JUMP_V = 30;            // upward velocity of a Space jump
const RAMP_LAUNCH_VY = 14;    // terrain rising faster than this (u/s) flings the bot up
const LAND_TUMBLE_VY = 36;    // landing faster than this tips it over

// Terrain height field — big rolling hills, flat spawn pad, flat at the walls.
function terrainHeight(x, z) {
  const r = Math.sqrt(x * x + z * z);
  const flat = THREE.MathUtils.clamp((r - 18) / 24, 0, 1);   // flat pad within r<18
  const edge = THREE.MathUtils.clamp((ARENA_HALF - 6 - Math.max(Math.abs(x), Math.abs(z))) / 22, 0, 1);
  const h =
    4.0 * Math.sin(x * 0.028) * Math.cos(z * 0.026) +
    2.6 * Math.sin(x * 0.013 + z * 0.019) +
    1.8 * Math.cos(z * 0.038 - x * 0.011) +
    1.1 * Math.sin(x * 0.06) * Math.sin(z * 0.055);
  return h * flat * edge + rampHeight(x, z);
}

// Launch ramps — wedges baked into the terrain (and its collider). Driving up
// one fast flings the bot into the air; a bad landing tumbles it.
const RAMPS = [
  { x: 0, z: 52, dir: 0, len: 22, w: 11, h: 11 },      // straight ahead of spawn
  { x: 62, z: -34, dir: -1.0, len: 20, w: 10, h: 10 },
  { x: -58, z: 46, dir: 2.3, len: 20, w: 10, h: 9 },
];
function rampHeight(x, z) {
  let add = 0;
  for (const r of RAMPS) {
    const dx = x - r.x, dz = z - r.z;
    const c = Math.cos(-r.dir), s = Math.sin(-r.dir);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;   // ramp-local across / along
    if (Math.abs(lx) < r.w && lz > 0 && lz < r.len) {
      add += r.h * (lz / r.len) * (1 - Math.abs(lx) / r.w);   // rises to a lip, tapered
    }
  }
  return add;
}

// ── ground-material sandbox: circular zones with different physics + look ──
const MATERIALS = {
  normal: { speed: 1.0, accel: 1.0, brake: 1.0, turn: 1.0 },
  mud:    { speed: 0.4, accel: 0.5, brake: 1.6, turn: 0.7, color: 0x4a3218, rough: 1.0, alpha: 0.95 },   // sticky, slow
  ice:    { speed: 1.1, accel: 0.22, brake: 0.18, turn: 0.4, color: 0xbfe8ff, rough: 0.05, alpha: 0.8 },  // slippery, glides
  boost:  { speed: 1.8, accel: 2.2, brake: 1.0, turn: 1.0, color: 0xff9a3c, rough: 0.4, alpha: 0.85, glow: 0x662200 }, // speed pad
  water:  { speed: 0.55, accel: 0.6, brake: 1.3, turn: 0.85, color: 0x1f6f9c, rough: 0.15, alpha: 0.7 },  // wet, draggy
};
const ZONES = [
  { x: 55, z: 40, r: 26, type: 'mud' },
  { x: -70, z: 30, r: 32, type: 'ice' },
  { x: 30, z: -80, r: 24, type: 'boost' },
  { x: -45, z: -60, r: 28, type: 'water' },
  { x: 90, z: -35, r: 30, type: 'ice' },
  { x: -100, z: -95, r: 34, type: 'mud' },
  { x: 100, z: 90, r: 30, type: 'boost' },
];
function terrainZone(x, z) {
  for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.r) return zn.type;
  return 'normal';
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
    this.input = { fwd: 0, turn: 0, brake: false };
  }

  setGains(g) { this.gains = { ...g }; }

  buildArena() {
    const RB = RAPIER.RigidBodyDesc, CO = RAPIER.ColliderDesc;
    const size = (ARENA_HALF + 8) * 2, seg = 180;

    // ── dusk sky dome (gradient: deep blue → warm horizon) ──
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 40, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x1c3566) },
          uMid: { value: new THREE.Color(0x6f9ac4) },
          uHor: { value: new THREE.Color(0xe7ad6e) },
        },
        vertexShader: /* glsl */`
          varying vec3 vP;
          void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          precision highp float; varying vec3 vP;
          uniform vec3 uTop, uMid, uHor;
          void main() {
            float h = normalize(vP).y;
            vec3 c = mix(uMid, uTop, smoothstep(0.02, 0.55, h));
            c = mix(c, uHor, smoothstep(0.16, -0.06, h));   // warm horizon band
            gl_FragColor = vec4(c, 1.0);
          }`,
      }));
    this.group.add(sky);

    // ── ground: rolling grass ──
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x4a6b3a, roughness: 0.95, metalness: 0.0 })
    );
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // ── material zone discs (mud / ice / boost / water), draped over the terrain ──
    for (const zn of ZONES) {
      const m = MATERIALS[zn.type];
      const zg = new THREE.CircleGeometry(zn.r, 56);
      zg.rotateX(-Math.PI / 2);
      const zp = zg.attributes.position;
      for (let i = 0; i < zp.count; i++) {
        const wx = zp.getX(i) + zn.x, wz = zp.getZ(i) + zn.z;
        zp.setY(i, terrainHeight(wx, wz) + 0.12 - terrainHeight(zn.x, zn.z));
      }
      zg.computeVertexNormals();
      const zmat = new THREE.MeshStandardMaterial({
        color: m.color, roughness: m.rough, metalness: zn.type === 'ice' ? 0.3 : 0.0,
        transparent: true, opacity: m.alpha,
        emissive: m.glow || 0x000000, emissiveIntensity: m.glow ? 2.0 : 0,
      });
      const disc = new THREE.Mesh(zg, zmat);
      disc.position.set(zn.x, terrainHeight(zn.x, zn.z), zn.z);
      disc.receiveShadow = true;
      this.group.add(disc);
    }

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
    const startTilt = 3 * Math.PI / 180;   // spawn nearly upright (gentle recovery)
    const baseY = terrainHeight(0, 0) + wheelR;
    this.restY = wheelR + chassisH / 2;    // chassis-center height above the ground
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
    this.vel = 0; this._prevVel = 0; this._lean = 0; this._wobble = 0;
    this._airborne = false; this._airVy = 0; this._airY = 0; this._prevGroundY = undefined;
    this.input = { fwd: 0, turn: 0, brake: false };
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
    // a poke it has to *recover* from: kick the lean setpoint (the PID must catch
    // it) plus a real angular impulse so the body physically lurches.
    this._wobble = (this._wobble || 0) + (Math.random() < 0.5 ? -1 : 1) * 0.45;
    const f = this.forwardDir().multiplyScalar(14);
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

    const { Kp, Ki, Kd } = this.gains;
    const chassis = this.bodies.chassis;
    const throttle = THREE.MathUtils.clamp(this.input.fwd, -1, 1);
    const steer = THREE.MathUtils.clamp(this.input.turn, -1, 1);
    const R = ARENA_HALF - 5;

    const cpos = chassis.translation();
    const matName = terrainZone(cpos.x, cpos.z);
    const mat = MATERIALS[matName];
    this.material = matName;

    // ── FALLEN: real physics tumble, waiting for a Space self-right ──
    if (this.fallen) {
      this.vel = 0; this.speed = 0; this.driveSpeed = 0;
      const lv = chassis.linvel();
      chassis.setLinvel({ x: lv.x * 0.9, y: lv.y, z: lv.z * 0.9 }, true);   // slide to rest
      this.pidTerms = { p: 0, i: 0, d: 0, out: 0, pwm: 0 };
      this.debug = { state: 'FALLEN', tilt: +this.tiltDeg.toFixed(1) };
      this.world.step();
      if (this.onTelemetry) this.onTelemetry({ tiltDeg: this.tiltDeg, fallen: true });
      return;
    }

    // ── speed integrator (ground material modulates it) ──
    const targetSpeed = throttle * MAX_SPEED * mat.speed;
    const rate = (Math.abs(targetSpeed) >= Math.abs(this.vel) ? ACCEL * mat.accel : BRAKE * mat.brake);
    this.vel += THREE.MathUtils.clamp(targetSpeed - this.vel, -rate * FIXED_DT, rate * FIXED_DT);
    const accel = (this.vel - (this._prevVel || 0)) / FIXED_DT;
    this._prevVel = this.vel;
    this.speed = this.vel;
    this.driveSpeed = Math.abs(this.vel);

    // steering (grounded only — you keep your heading mid-air)
    if (Math.abs(steer) > 0.01 && !this._airborne) {
      const frac = TURN_ASSIST + (1 - TURN_ASSIST) * Math.min(1, Math.abs(this.vel) / 10);
      this.heading -= steer * TURN_RATE * mat.turn * frac * FIXED_DT;
    }
    const headDir = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const rightDir = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));

    // stylistic lean + decaying nudge wobble
    const targetLean = THREE.MathUtils.clamp(LEAN_ACCEL_STYLE * accel, -MAX_DRIVE_LEAN, MAX_DRIVE_LEAN);
    const prevLean = this._lean || 0;
    this._lean = prevLean + THREE.MathUtils.clamp(targetLean - prevLean, -LEAN_SLEW * FIXED_DT, LEAN_SLEW * FIXED_DT);
    const desiredLean = this._lean + (this._wobble || 0);
    this._wobble = (this._wobble || 0) * 0.94;

    const nx = THREE.MathUtils.clamp(cpos.x + headDir.x * this.vel * FIXED_DT, -R, R);
    const nz = THREE.MathUtils.clamp(cpos.z + headDir.z * this.vel * FIXED_DT, -R, R);
    const groundY = terrainHeight(nx, nz) + this.restY;

    if (this._airborne) {
      this._airVy -= AIR_G * FIXED_DT;
      this._airY += this._airVy * FIXED_DT;
      if (this._airY <= groundY) {                 // touchdown
        this._airborne = false;
        const hard = this._airVy < -LAND_TUMBLE_VY;
        const sketchy = (matName === 'ice' && this.driveSpeed > 18) || (Math.abs(steer) > 0.7 && this.driveSpeed > 24);
        if (hard || sketchy) this._startTumble(headDir);
        else this._pose(chassis, nx, groundY, nz, headDir, rightDir, desiredLean, 0);
      } else {
        this._pose(chassis, nx, this._airY, nz, headDir, rightDir, desiredLean - 0.14, this._airVy);  // slight nose-up tuck
      }
    } else {
      // grounded: ramp-crest launch + slippery-ice wipeout
      const vyTerrain = (groundY - (this._prevGroundY ?? groundY)) / FIXED_DT;   // current climb rate
      const aheadY = terrainHeight(nx + headDir.x * 5, nz + headDir.z * 5) + this.restY;
      const dropAhead = groundY - aheadY;   // terrain falls away just ahead (a lip)
      if (this.driveSpeed > 12 && vyTerrain > 6 && dropAhead > 2.5) {
        // launch off the ramp lip with the upward momentum we'd built climbing it
        this._airborne = true;
        this._airVy = vyTerrain + this.driveSpeed * 0.3;
        this._airY = groundY;
        this._pose(chassis, nx, groundY, nz, headDir, rightDir, desiredLean - 0.1, this._airVy);
      } else if (matName === 'ice' && this.driveSpeed > 24 && Math.abs(steer) > 0.8 && Math.random() < 0.05) {
        this._startTumble(rightDir.clone().multiplyScalar(Math.sign(steer)));   // spin out
      } else {
        this._pose(chassis, nx, groundY, nz, headDir, rightDir, desiredLean, 0);
      }
    }
    this._prevGroundY = groundY;

    // PID terms for the serial telemetry (pitch is set kinematically above)
    const error = theta;
    this.integral = THREE.MathUtils.clamp(this.integral + error * FIXED_DT, -1.5, 1.5);
    const deriv = (error - this.prevError) / FIXED_DT;
    this.prevError = error;
    const pTerm = Kp * error, iTerm = Ki * 0.02 * this.integral, dTerm = Kd * deriv;
    this.pidTerms = { p: pTerm, i: iTerm, d: dTerm, out: pTerm + iTerm + dTerm, pwm: Math.round(THREE.MathUtils.clamp(Math.abs(this.vel) / MAX_SPEED * 255, 0, 255)) };
    this.debug = { vel: +this.vel.toFixed(1), air: this._airborne, tilt: +this.tiltDeg.toFixed(1) };

    this.world.step();
    if (this.onTelemetry) this.onTelemetry({ tiltDeg: this.tiltDeg, fallen: this.fallen });
  }

  // set the kinematic pose (position, upright+lean orientation, wheel spin)
  _pose(chassis, x, y, z, headDir, rightDir, lean, vy) {
    chassis.setTranslation({ x, y, z }, true);
    chassis.setLinvel({ x: headDir.x * this.vel, y: vy, z: headDir.z * this.vel }, true);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean));
    chassis.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const spin = this.vel / this.wheelR;
    for (const w of this.bodies.wheels) {
      w.body.setLinvel({ x: headDir.x * this.vel, y: vy, z: headDir.z * this.vel }, true);
      w.body.setAngvel({ x: rightDir.x * spin, y: 0, z: rightDir.z * spin }, true);
    }
  }

  _startTumble(dir) {
    this.fallen = true;
    this._airborne = false;
    const c = this.bodies.chassis.translation();
    const f = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(70);
    this.bodies.chassis.applyImpulseAtPoint({ x: f.x, y: 6, z: f.z }, { x: c.x, y: c.y + 5, z: c.z }, true);
    this.bodies.chassis.applyTorqueImpulse(
      { x: (Math.random() - 0.5) * 50, y: (Math.random() - 0.5) * 25, z: (Math.random() - 0.5) * 50 }, true);
  }

  jump() {
    if (this.fallen || this._airborne || !this.bodies.chassis) return;
    this._airborne = true;
    this._airY = this.bodies.chassis.translation().y;
    this._airVy = JUMP_V;
  }

  recover() {
    if (!this.fallen || !this.bodies.chassis) return;
    this.fallen = false; this._airborne = false; this.vel = 0; this._airVy = 0;
    const c = this.bodies.chassis.translation();
    const y = terrainHeight(c.x, c.z) + this.restY;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    this.bodies.chassis.setTranslation({ x: c.x, y, z: c.z }, true);
    this.bodies.chassis.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.bodies.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.bodies.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this._wobble = 0.25;   // little pop as it springs upright
    this.prevError = 0; this.integral = 0;
  }

  jumpOrRecover() { this.fallen ? this.recover() : this.jump(); }

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
  if (ROBOT) {
    ROBOT.scale.setScalar(ROBOT_SCALE);
    ROBOT.position.set(0, bottom + ROBOT_Y, 0);   // feet on the axle line
    ROBOT.rotation.y = 0;                          // faces +Z = drive direction
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
