// Rapier physics: self-balancing robot on hilly terrain, drivable with WASD.
// A JS PID loop keeps it upright; WASD shifts the lean setpoint / yaws it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isLowQuality } from './app/quality.js';

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

// shared loader for the CC0 ground textures (grass / mud); tiled + repeated
const _texLoader = new THREE.TextureLoader();
function groundTex(url, repeat, srgb) {
  const t = _texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
// ── inner balance model (BalanceSim only; RoverSim leaves this.balances=false) ──
// A lightweight inverted-pendulum tilt error that the live PID actually
// stabilizes, so the Kp/Ki/Kd sliders (and the Balance lessons) visibly change
// how the bot stands: weak Kp sags, low Kd rings, Ki=0 leaves a steady lean, and
// gutting the gains topples it. Kinematic (it feeds the applied lean) — not full
// Rapier dynamics, which would need re-tuning the whole arcade feel.
const BAL_G = 8;             // toppling accel per rad of tilt (unstable → needs control)
const BAL_BIAS = 0.4;        // constant "uneven weight" torque — what Ki exists to cancel
const BAL_KI = 0.02;         // integral scale (kept equal to the old telemetry term)
const BAL_FALL = 0.62;       // |tilt| (rad ≈ 35°) beyond which it topples over
const BAL_NUDGE = 1.1;       // angular-rate kick from the Nudge button (spikes, recovers)
const BAL_NOISE = 0.5;       // tiny process noise so a stable bot still micro-wobbles
// jumping / airborne / falling
const AIR_G = 55;             // gravity for the ballistic jump arc (tuned, not real g)
const JUMP_V = 30;            // upward velocity of a Space jump
const RAMP_LAUNCH_VY = 14;    // terrain rising faster than this (u/s) flings the bot up
const LAND_TUMBLE_VY = 52;    // landing faster than this tips it over (forgiving:
                              // a Space jump ~30 and capped ramp launches land clean)
const MAX_LAUNCH_VY = 26;     // cap on ramp-launch upward speed so it lands under LAND_TUMBLE_VY

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

// ── obstacle course: blocks & hurdle walls you drive over or jump ──
// Axis-aligned boxes. Low steps (≤ STEP_UP) you climb; taller ones are walls
// that block you unless you're airborne above their top. `top` is baked from
// the terrain height at build time. Spawn area (r<20) is kept clear.
const STEP_UP = 2.6;                 // max lip you can roll up without jumping
const OBSTACLES = [
  { x: 0,   z: 34,  w: 30, d: 4,  h: 6 },    // hurdle wall straight ahead — jump it
  { x: 44,  z: 44,  w: 22, d: 22, h: 5, platform: true },  // raised platform to land on
  { x: -40, z: 20,  w: 4,  d: 30, h: 7 },    // long wall
  { x: -44, z: -44, w: 20, d: 20, h: 3, platform: true },
  { x: 78,  z: -6,  w: 26, d: 4,  h: 8 },    // tall wall — needs a running jump
  { x: 20,  z: -46, w: 4,  d: 22, h: 5 },
  { x: -14, z: 62,  w: 4,  d: 22, h: 5 },
  { x: 60,  z: 70,  w: 4,  d: 26, h: 6 },
];
function bakeObstacles() {
  for (const o of OBSTACLES) o.top = terrainHeight(o.x, o.z) + o.h;
}
function obstacleTop(x, z) {
  let top = -1e9;
  for (const o of OBSTACLES)
    if (Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2) top = Math.max(top, o.top);
  return top;
}
// height of whatever solid surface you'd stand on at (x,z): terrain or a box top
function surfaceAt(x, z) {
  return Math.max(terrainHeight(x, z), obstacleTop(x, z));
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
    // inner balance model (see BAL_* constants). RoverSim sets balances=false.
    this.balances = true;
    this.balPhi = 0; this.balPhiDot = 0; this.balInteg = 0;
    this.pidTerms = { p: 0, i: 0, d: 0, out: 0, pwm: 0 };
  }

  setGains(g) { this.gains = { ...g }; }

  buildArena() {
    const RB = RAPIER.RigidBodyDesc, CO = RAPIER.ColliderDesc;
    // terrain mesh + trimesh collider density — the biggest CPU/GPU cost in the
    // arena, so drop it on low-quality devices (still hilly, just coarser).
    const size = (ARENA_HALF + 8) * 2, seg = isLowQuality() ? 110 : 180;

    // ── sky dome (equirectangular photo sky mapped onto a big inverted sphere) ──
    const skyTex = _texLoader.load('assets/textures/sky_06_2k.png');
    skyTex.colorSpace = THREE.SRGBColorSpace;
    skyTex.wrapS = THREE.RepeatWrapping;   // horizontal wrap so there's no seam
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 60, 40),
      // toneMapped:false — the sky is a finished image; ACES tone mapping would
      // otherwise crush the sunset to near-black.
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
    this.group.add(sky);

    // ── ground: rolling grass (real CC0 grass texture, lit + wind-shifted) ──
    bakeObstacles();
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    const grassRepeat = size / 26;                 // one grass tile ≈ 26 units
    const grassNormal = groundTex('assets/textures/grass_nor.png', grassRepeat, false);
    this._grassNormal = grassNormal;               // animated for a subtle wind shimmer
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        map: groundTex('assets/textures/grass_diff.jpg', grassRepeat, true),
        normalMap: grassNormal, normalScale: new THREE.Vector2(0.7, 0.7),
        color: 0x8fa46e, roughness: 1.0, metalness: 0.0,
      })
    );
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this._terrainGeo = geo;                          // reused by the tire-track overlay

    // ── material zones: real mud texture, procedural ice + water, glowing boost ──
    for (const zn of ZONES) {
      const m = MATERIALS[zn.type];
      const zg = new THREE.CircleGeometry(zn.r, 64);
      zg.rotateX(-Math.PI / 2);
      const zp = zg.attributes.position;
      for (let i = 0; i < zp.count; i++) {
        const wx = zp.getX(i) + zn.x, wz = zp.getZ(i) + zn.z;
        zp.setY(i, terrainHeight(wx, wz) + 0.1 - terrainHeight(zn.x, zn.z));
      }
      zg.computeVertexNormals();
      const disc = new THREE.Mesh(zg, this._zoneMaterial(zn.type, m, zn.r));
      disc.position.set(zn.x, terrainHeight(zn.x, zn.z), zn.z);
      disc.receiveShadow = true;
      this.group.add(disc);
    }

    this._buildObstacles();
    this._buildTrackOverlay(size);

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

  // ── per-zone materials: real mud texture, procedural ice + water, boost pad ──
  _zoneMaterial(type, m, r) {
    if (type === 'mud') {
      const rep = r / 12;
      return new THREE.MeshStandardMaterial({
        map: groundTex('assets/textures/mud_diff.jpg', rep, true),
        normalMap: groundTex('assets/textures/mud_nor.png', rep, false),
        normalScale: new THREE.Vector2(0.8, 0.8),
        color: 0x9a8b6f, roughness: 1.0, metalness: 0.0,
      });
    }
    if (type === 'ice') {
      // smooth, glossy, faintly blue — reflects the sky env for a real ice read
      return new THREE.MeshStandardMaterial({
        color: 0xbfe8ff, roughness: 0.06, metalness: 0.35,
        transparent: true, opacity: 0.82,
      });
    }
    if (type === 'water') {
      const uni = { uTime: { value: 0 } };
      this._waterUniforms.push(uni);
      return new THREE.ShaderMaterial({
        transparent: true, uniforms: uni,
        vertexShader: /* glsl */`
          varying vec2 vUv; varying vec3 vN;
          void main() { vUv = uv; vN = normalMatrix * normal;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          precision highp float; varying vec2 vUv; varying vec3 vN; uniform float uTime;
          void main() {
            vec2 p = vUv * 40.0;
            float w = sin(p.x + uTime * 1.6) * 0.5 + sin(p.y * 1.3 - uTime * 1.1) * 0.5;
            w += sin((p.x + p.y) * 0.7 + uTime * 0.8);
            float ripple = 0.5 + 0.5 * sin(w * 2.0);
            vec3 deep = vec3(0.05, 0.22, 0.35), shal = vec3(0.20, 0.55, 0.70);
            vec3 col = mix(deep, shal, ripple * 0.6);
            col += vec3(0.9) * pow(ripple, 6.0) * 0.35;   // glinting highlights
            gl_FragColor = vec4(col, 0.82);
          }`,
      });
    }
    // boost: emissive speed pad
    return new THREE.MeshStandardMaterial({
      color: m.color, roughness: m.rough, metalness: 0.0,
      transparent: true, opacity: m.alpha,
      emissive: m.glow || 0x000000, emissiveIntensity: m.glow ? 2.0 : 0,
    });
  }

  // solid course pieces: platforms to land on, hurdle walls to jump
  _buildObstacles() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4658, roughness: 0.7, metalness: 0.3 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x0a2438, roughness: 0.35, metalness: 0.4, emissive: 0x18b6ff, emissiveIntensity: 2.2 });
    for (const o of OBSTACLES) {
      const base = terrainHeight(o.x, o.z);
      const box = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), bodyMat);
      box.position.set(o.x, base + o.h / 2, o.z);
      box.castShadow = true; box.receiveShadow = true;
      this.group.add(box);
      // glowing edge strip along the top so the lip reads clearly at speed
      const strip = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.3, 0.5, o.d + 0.3), edgeMat);
      strip.position.set(o.x, base + o.h + 0.1, o.z);
      this.group.add(strip);
    }
  }

  // ── tire tracks: a fading trail drawn onto a canvas, draped on the terrain ──
  _buildTrackOverlay(size) {
    const N = 1024;
    const cvs = document.createElement('canvas');
    cvs.width = N; cvs.height = N;
    this._trackCtx = cvs.getContext('2d');
    this._trackSize = size;
    this._trackN = N;
    const tex = new THREE.CanvasTexture(cvs);
    tex.needsUpdate = true;
    this._trackTex = tex;
    const geo = this._terrainGeo.clone();
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const overlay = new THREE.Mesh(geo, mat);
    overlay.position.y = 0.06;
    overlay.renderOrder = 2;
    this.group.add(overlay);
  }

  // fade existing tracks + stamp new dabs under each wheel that's on the ground
  _updateTracks(dt) {
    const ctx = this._trackCtx;
    if (!ctx || this._airborne || this.fallen) { return; }
    const N = this._trackN, S = this._trackSize;
    // fade: erode a little alpha everywhere each frame
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.05, dt * 0.6)})`;
    ctx.fillRect(0, 0, N, N);
    // stamp: dark ovals at each wheel contact (world → uv → pixel)
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(28,20,12,0.5)';
    for (const w of this.bodies.wheels) {
      const t = w.body.translation();
      // world → overlay UV. The overlay is the terrain plane (PlaneGeometry
      // rotated -90° about X), whose V axis runs opposite to +Z, so Z is
      // negated here — otherwise tracks stamp on the mirror-Z side of the wheels.
      const u = (t.x + S / 2) / S, v = (S / 2 - t.z) / S;
      const px = u * N, py = (1 - v) * N;   // CanvasTexture flipY → invert the row
      ctx.beginPath();
      ctx.ellipse(px, py, 3.2, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    this._trackTex.needsUpdate = true;
  }

  build() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.group.clear();
    this._waterUniforms = [];
    this._trackCtx = null;
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
    this.balPhi = 0; this.balPhiDot = 0; this.balInteg = 0;
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
    // a poke the PID has to *recover* from: kick the balance-error rate (the inner
    // loop must catch it) plus a real angular impulse so the body physically lurches.
    if (this.balances) this.balPhiDot += (Math.random() < 0.5 ? -1 : 1) * BAL_NUDGE;
    this._wobble = (this._wobble || 0) + (Math.random() < 0.5 ? -1 : 1) * 0.2;
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

    // ambient life: water ripples, a faint grass-wind shimmer, fading tire tracks
    const dt = Math.min(realDt, 0.05);
    for (const u of (this._waterUniforms || [])) u.uTime.value += dt;
    if (this._grassNormal) {
      this._grassNormal.offset.x = Math.sin(performance.now() * 0.00013) * 0.006;
      this._grassNormal.offset.y = Math.cos(performance.now() * 0.00011) * 0.006;
    }
    this._updateTracks(dt);
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

    // ── inner balance loop: the live PID actually stabilizes an inverted
    // pendulum tilt error (balPhi). Skipped for the rover (balances=false) and
    // while airborne. This is what makes the Kp/Ki/Kd sliders do something.
    if (this.balances && !this._airborne) {
      this.balInteg = THREE.MathUtils.clamp(this.balInteg + this.balPhi * FIXED_DT, -3, 3);
      const u = Kp * this.balPhi + Ki * BAL_KI * this.balInteg + Kd * this.balPhiDot;   // PID torque
      const phiddot = BAL_G * Math.sin(this.balPhi) + BAL_BIAS - u + (Math.random() - 0.5) * BAL_NOISE;
      this.balPhiDot += phiddot * FIXED_DT;
      this.balPhi += this.balPhiDot * FIXED_DT;
      this.pidTerms = {
        p: Kp * this.balPhi, i: Ki * BAL_KI * this.balInteg, d: Kd * this.balPhiDot,
        out: u, pwm: Math.round(THREE.MathUtils.clamp(Math.abs(u) / 40 * 255, 0, 255)),
      };
      if (Math.abs(this.balPhi) > BAL_FALL) {   // the PID lost it — topple
        this._startTumble(headDir.clone().multiplyScalar(Math.sign(this.balPhi) || 1));
        this.world.step();
        if (this.onTelemetry) this.onTelemetry({ tiltDeg: this.tiltDeg, fallen: true });
        return;
      }
    }

    // stylistic lean + decaying nudge wobble + the balance error (the PID's job)
    const targetLean = THREE.MathUtils.clamp(LEAN_ACCEL_STYLE * accel, -MAX_DRIVE_LEAN, MAX_DRIVE_LEAN);
    const prevLean = this._lean || 0;
    this._lean = prevLean + THREE.MathUtils.clamp(targetLean - prevLean, -LEAN_SLEW * FIXED_DT, LEAN_SLEW * FIXED_DT);
    const desiredLean = this._lean + (this._wobble || 0) + (this.balances ? this.balPhi : 0);
    this._wobble = (this._wobble || 0) * 0.94;

    let nx = THREE.MathUtils.clamp(cpos.x + headDir.x * this.vel * FIXED_DT, -R, R);
    let nz = THREE.MathUtils.clamp(cpos.z + headDir.z * this.vel * FIXED_DT, -R, R);

    // wall blocking: while grounded you can't drive into a lip taller than a
    // small step — tall hurdle walls must be jumped (Space) to clear them.
    if (!this._airborne) {
      const curSup = surfaceAt(cpos.x, cpos.z);
      if (surfaceAt(nx, nz) - curSup > STEP_UP) {
        nx = cpos.x; nz = cpos.z;      // stall against the wall face
        this.vel *= 0.2;
      }
    }

    const groundY = surfaceAt(nx, nz) + this.restY;         // where we stand / land (incl. box tops)
    const terrGroundY = terrainHeight(nx, nz) + this.restY; // terrain-only, for ramp-crest detection

    if (this._airborne) {
      this._airVy -= AIR_G * FIXED_DT;
      this._airY += this._airVy * FIXED_DT;
      if (this._airY <= groundY) {                 // touchdown (terrain or a platform top)
        this._airborne = false;
        const hard = this._airVy < -LAND_TUMBLE_VY;
        const sketchy = (matName === 'ice' && this.driveSpeed > 18) || (Math.abs(steer) > 0.7 && this.driveSpeed > 24);
        if (hard || sketchy) this._startTumble(headDir);
        else this._pose(chassis, nx, groundY, nz, headDir, rightDir, desiredLean, 0);
      } else {
        this._pose(chassis, nx, this._airY, nz, headDir, rightDir, desiredLean - 0.14, this._airVy);  // slight nose-up tuck
      }
    } else {
      // grounded: ramp-crest launch + slippery-ice wipeout (terrain-only, so
      // rolling onto a low platform doesn't fling the bot)
      const vyTerrain = (terrGroundY - (this._prevGroundY ?? terrGroundY)) / FIXED_DT;   // current climb rate
      const aheadY = terrainHeight(nx + headDir.x * 5, nz + headDir.z * 5) + this.restY;
      const dropAhead = terrGroundY - aheadY;   // terrain falls away just ahead (a lip)
      if (this.driveSpeed > 12 && vyTerrain > 6 && dropAhead > 2.5) {
        // launch off the ramp lip with the upward momentum we'd built climbing it
        this._airborne = true;
        this._airVy = Math.min(vyTerrain + this.driveSpeed * 0.3, MAX_LAUNCH_VY);
        this._airY = groundY;
        this._pose(chassis, nx, groundY, nz, headDir, rightDir, desiredLean - 0.1, this._airVy);
      } else if (matName === 'ice' && this.driveSpeed > 24 && Math.abs(steer) > 0.8 && Math.random() < 0.05) {
        this._startTumble(rightDir.clone().multiplyScalar(Math.sign(steer)));   // spin out
      } else {
        this._pose(chassis, nx, groundY, nz, headDir, rightDir, desiredLean, 0);
      }
    }
    this._prevGroundY = terrGroundY;

    // pidTerms is set by the inner balance loop above (real Kp/Ki/Kd terms);
    // airborne frames just carry the last grounded value.
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
    this.balPhi = 0; this.balPhiDot = 0; this.balInteg = 0;   // fresh balance state
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

// ── Rover: four-wheel driving body ──────────────────────────────────────────
// Subclasses BalanceSim to reuse ALL of its proven machinery — the arena/terrain,
// the tuned arcade-drive model (fixedStep), tire tracks, jump, tumble, recover,
// telemetry. Only two things differ: the body it builds (a flat chassis on four
// corner wheels, no inverted pendulum) and the pose (it stays flat — no stylistic
// pitch lean). Because the drive model is inherited unchanged, the rover handles
// with the exact same feel as the self-balancer minus the balancing. See
// js/robots/rover.js (the def) and js/robots/sim-registry.js (the simKey wiring).
export class RoverSim extends BalanceSim {
  constructor(scene) {
    super(scene);
    this.balances = false;   // four wheels, no inverted-pendulum balance loop
  }

  build() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.group.clear();
    this._waterUniforms = [];
    this._trackCtx = null;
    this.buildArena();

    const RB = RAPIER.RigidBodyDesc, CO = RAPIER.ColliderDesc;

    const wheelR = 3.0, wheelW = 2.2;
    const track = 6.3, base = 5.5;            // half-width (x) / half-length (z) of the wheel rectangle
    const chassisH = 2.4, chassisW = 11, chassisD = 13;
    this.wheelR = wheelR;
    const baseY = terrainHeight(0, 0) + wheelR;
    this.restY = wheelR + chassisH / 2;       // chassis-center height above the ground
    this.home = { x: 0, z: 0 };
    this.heading = 0;

    // ── flat chassis slab (kinematically posed each frame, like the balancer) ──
    const chassisBody = this.world.createRigidBody(
      RB.dynamic()
        .setTranslation(0, baseY + chassisH / 2, 0)
        .enabledRotations(true, true, false)
        .setCcdEnabled(true)
        .setAngularDamping(1.6)
        .setLinearDamping(0.05));
    this.world.createCollider(
      CO.cuboid(chassisW / 2, chassisH / 2, chassisD / 2).setDensity(CHASSIS_DENSITY), chassisBody);
    this.bodies.chassis = chassisBody;

    const chassisMesh = makeRoverVisual(chassisH, chassisW, chassisD);
    this.group.add(chassisMesh);
    this.bodies.chassisMesh = chassisMesh;

    // ── four wheels at the corners, all on the local-X axle ──
    this.bodies.wheels = [];
    for (const sz of [1, -1]) for (const sx of [-1, 1]) {
      const wx = sx * track, wz = sz * base;
      const wheelBody = this.world.createRigidBody(
        RB.dynamic().setTranslation(wx, baseY, wz).setCcdEnabled(true));
      this.world.createCollider(
        CO.cylinder(wheelW / 2, wheelR).setRotation(zToXQuat())
          .setFriction(3.2).setRestitution(0).setDensity(WHEEL_DENSITY),
        wheelBody);
      const joint = RAPIER.JointData.revolute(
        { x: wx, y: -chassisH / 2, z: wz }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      this.world.createImpulseJoint(joint, chassisBody, wheelBody, true);
      const wheelMesh = makeWheelVisual(wheelR, wheelW);
      this.group.add(wheelMesh);
      this.bodies.wheels.push({ body: wheelBody, mesh: wheelMesh });
    }

    this.integral = 0; this.prevError = 0; this.fallen = false;
    this.vel = 0; this._prevVel = 0; this._lean = 0; this._wobble = 0;
    this._airborne = false; this._airVy = 0; this._airY = 0; this._prevGroundY = undefined;
    this.input = { fwd: 0, turn: 0, brake: false };
    this.syncMeshes();
  }

  // Reuse the parent's drive/pose exactly, but hold the body flat (lean → 0).
  _pose(chassis, x, y, z, headDir, rightDir, lean, vy) {
    super._pose(chassis, x, y, z, headDir, rightDir, 0, vy);
  }
}

// Low four-wheel buggy body. Origin = chassis center; +Z is forward.
function makeRoverVisual(h, w, d) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, h, d * 0.86), CHROME);
  g.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h * 0.7, d * 0.5), CHROME_DK);
  cabin.position.set(0, h * 0.7, -d * 0.05);
  g.add(cabin);
  // glowing waistline seam (blooms)
  const seam = new THREE.Mesh(new THREE.BoxGeometry(w * 0.84, 0.18, d * 0.88), SEAM);
  seam.position.y = h * 0.2;
  g.add(seam);
  // forward light bar
  const lens = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.4, 0.3), LENS);
  lens.position.set(0, h * 0.1, d * 0.44);
  g.add(lens);
  // sensor mast + dome
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, h * 1.1, 12), STEEL);
  mast.position.set(0, h * 1.1, -d * 0.28);
  g.add(mast);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 14), GLASS);
  dome.position.set(0, h * 1.6, -d * 0.28);
  g.add(dome);
  // steel bumpers front + rear
  for (const sz of [1, -1]) {
    const bump = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.5, 0.5), STEEL);
    bump.position.set(0, -h * 0.1, sz * d * 0.45);
    g.add(bump);
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
