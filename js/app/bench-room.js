// Bench room — a modeled 3D replica of the reference desk photo, built to be the
// surface the electronic parts sit on. This is the "in-engine reconstruction"
// path (chosen after a photo-capture came out too rough): a hand-built sage-green
// cabinet desk with a white calacatta-marble countertop, a gray wall, a blinded
// window throwing warm light from the left, a black desk lamp with an Edison
// globe bulb, and an LG-style front-load washer tucked under the right of the
// counter.
//
// Coordinate contract (1 unit = 1 cm, matching the rest of the app):
//   • the marble TOP sits at world y = 0 — the same plane creator-assembly.js
//     rests parts on (GROUND_Y = 0), so parts land flush on the counter.
//   • the build area is ~±26 units in x/z; the slab extends well past that and
//     the cabinet/washer sit below, the wall behind (−z), the window to the left.
//
// Everything is procedural (geometry + canvas textures) so it stays zero-build
// and CSP-safe — no external asset fetches. All meshes + lights live under one
// group; hiding the group (done by the sim-mode decor toggle) turns the whole
// room, lights included, off in one shot.
import * as THREE from 'three';

// palette pulled from the photo
const SAGE = 0x9db09f;      // muted mint cabinet
const MARBLE_WHITE = 0xdedad0;
const WALL_GRAY = 0xcdd0cc;
const WOOD = 0xcaa87e;      // light oak floor
const BLACK_METAL = 0x1c1e22;
const WASHER_WHITE = 0xe8e9ea;

// ── procedural textures ────────────────────────────────────────────────────
function makeCanvas(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// calacatta: warm-white base with a few soft grey (+ faint gold) vein systems
function makeMarbleTexture() {
  const s = 1024, c = makeCanvas(s), x = c.getContext('2d');
  x.fillStyle = '#e8e5dc'; x.fillRect(0, 0, s, s);
  // faint cloudy mottling
  for (let i = 0; i < 120; i++) {
    x.globalAlpha = 0.03;
    x.fillStyle = i % 5 ? '#e9e7e0' : '#d9d6cd';
    const r = 40 + Math.random() * 160;
    x.beginPath(); x.arc(Math.random() * s, Math.random() * s, r, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  // vein systems — a few main diagonals with branching hairlines
  const vein = (sx, sy, ex, ey, w, col) => {
    x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'round';
    x.beginPath(); x.moveTo(sx, sy);
    const mx = (sx + ex) / 2 + (Math.random() - 0.5) * 300;
    const my = (sy + ey) / 2 + (Math.random() - 0.5) * 300;
    x.quadraticCurveTo(mx, my, ex, ey); x.stroke();
  };
  for (let i = 0; i < 5; i++) {
    const sx = Math.random() * s, sy = -20, ex = Math.random() * s, ey = s + 20;
    vein(sx, sy, ex, ey, 2.4 + Math.random() * 2, 'rgba(120,120,124,0.5)');
    // hairline branches
    for (let j = 0; j < 4; j++) {
      const t = Math.random();
      vein(sx + (ex - sx) * t, sy + (ey - sy) * t,
        sx + (ex - sx) * t + (Math.random() - 0.5) * 260,
        sy + (ey - sy) * t + (Math.random() - 0.5) * 260,
        0.8, 'rgba(150,148,150,0.35)');
    }
    if (i < 2) vein(sx + 6, sy, ex + 6, ey, 1, 'rgba(196,178,120,0.22)'); // faint gold
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// light oak planks with subtle grain
function makeWoodTexture() {
  const s = 1024, c = makeCanvas(s), x = c.getContext('2d');
  x.fillStyle = '#caa87e'; x.fillRect(0, 0, s, s);
  const planks = 6, pw = s / planks;
  for (let p = 0; p < planks; p++) {
    const shade = 200 + Math.floor(Math.random() * 30);
    x.fillStyle = `rgb(${shade},${Math.floor(shade * 0.82)},${Math.floor(shade * 0.6)})`;
    x.fillRect(p * pw, 0, pw, s);
    // grain lines
    for (let g = 0; g < 40; g++) {
      x.globalAlpha = 0.05 + Math.random() * 0.06;
      x.strokeStyle = '#7a5a34'; x.lineWidth = 0.6 + Math.random();
      const gy = Math.random() * s;
      x.beginPath(); x.moveTo(p * pw, gy);
      x.bezierCurveTo(p * pw + pw * 0.3, gy + (Math.random() - 0.5) * 20,
        p * pw + pw * 0.6, gy + (Math.random() - 0.5) * 20, p * pw + pw, gy);
      x.stroke();
    }
    x.globalAlpha = 1;
    // plank seam
    x.strokeStyle = 'rgba(60,40,20,0.5)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(p * pw, 0); x.lineTo(p * pw, s); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.anisotropy = 8;
  return t;
}

// subtle wall stipple (the gray textured plaster)
function makeWallTexture() {
  const s = 512, c = makeCanvas(s), x = c.getContext('2d');
  x.fillStyle = '#cdd0cc'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    x.globalAlpha = 0.04;
    x.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#a8aca6';
    x.fillRect(Math.random() * s, Math.random() * s, 1.4, 1.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function initBenchRoom({ scene, renderer } = {}) {
  if (renderer) {
    renderer.shadowMap.enabled = true;
    // photographic exposure: the room is a bright white-marble space, so pull the
    // exposure down from the studio default (1.02) or the marble blows past the
    // bloom threshold (0.85) and washes the whole view white.
    renderer.toneMappingExposure = 0.72;
  }
  const group = new THREE.Group();
  group.name = 'bench-room';

  const marbleTex = makeMarbleTexture();
  const woodTex = makeWoodTexture();
  const wallTex = makeWallTexture();

  const marbleMat = new THREE.MeshPhysicalMaterial({
    color: MARBLE_WHITE, map: marbleTex,
    roughness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.28,
    envMapIntensity: 0.35,
  });
  const sageMat = new THREE.MeshStandardMaterial({ color: SAGE, roughness: 0.62, metalness: 0.02 });
  const wallMat = new THREE.MeshStandardMaterial({ color: WALL_GRAY, map: wallTex, roughness: 0.96 });
  const woodMat = new THREE.MeshStandardMaterial({ color: WOOD, map: woodTex, roughness: 0.78 });
  const blackMat = new THREE.MeshStandardMaterial({ color: BLACK_METAL, roughness: 0.42, metalness: 0.75 });
  const washerMat = new THREE.MeshStandardMaterial({ color: WASHER_WHITE, roughness: 0.35, metalness: 0.1 });

  // ── countertop: top surface flush at y = 0 (where parts rest) ──────────────
  // The slab + backsplash live in their own sub-group: in Scan mode the captured
  // counter IS the bench surface, so main.js hides this group and only the lights
  // stay shared between the two modes.
  const bench = new THREE.Group(); bench.name = 'room-bench';
  const slab = box(135, 4, 50, marbleMat, 12.5, -2, 1);
  bench.add(slab);
  // backsplash lip
  bench.add(box(135, 8, 2.5, marbleMat, 12.5, 4, -23));
  group.add(bench);

  // Everything below is "room decor" — it lives in a sub-group so Scan mode can
  // hide it and show the captured mesh in its place.
  const decor = [];

  // ── sage-green cabinet under the left of the counter ───────────────────────
  const cab = box(78, 76, 44, sageMat, -16, -42, 0);
  decor.push(cab);
  // two drawer fronts + black bar handles on the front face (z = +22)
  const drawerMat = new THREE.MeshStandardMaterial({ color: 0xa7b9a9, roughness: 0.55 });
  for (const dx of [-34, 3]) {
    decor.push(box(35, 20, 1.5, drawerMat, dx, -13, 22.3));
    decor.push(box(15, 1.6, 1.6, blackMat, dx, -13, 23.4)); // handle bar
  }

  // ── LG-style front-load washer under the right of the counter ──────────────
  const washer = box(54, 76, 44, washerMat, 52, -42, 0);
  decor.push(washer);
  // recessed dark glass door
  const doorRing = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 16, 3, 40),
    new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3, metalness: 0.3 }));
  doorRing.rotation.x = Math.PI / 2; doorRing.position.set(52, -38, 22.5);
  doorRing.castShadow = true; decor.push(doorRing);
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(12, 12, 2, 40),
    new THREE.MeshPhysicalMaterial({ color: 0x14171b, roughness: 0.15, metalness: 0.2,
      clearcoat: 1, clearcoatRoughness: 0.1 }));
  glass.rotation.x = Math.PI / 2; glass.position.set(52, -38, 23.4); decor.push(glass);
  // control strip
  decor.push(box(50, 7, 1, new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5 }), 52, -8, 22.4));

  // ── room shell: back wall, left wall (with window), floor ──────────────────
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(400, 320), wallMat);
  backWall.position.set(0, 60, -24.5); backWall.receiveShadow = true; decor.push(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), wallMat);
  leftWall.rotation.y = Math.PI / 2; leftWall.position.set(-57, 60, 40);
  leftWall.receiveShadow = true; decor.push(leftWall);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), woodMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(20, -78, 30);
  floor.receiveShadow = true; decor.push(floor);

  // ── window on the left wall: bright warm pane + white frame + blind slats ───
  const paneMat = new THREE.MeshStandardMaterial({
    color: 0xfff4e0, emissive: 0xfff0d6, emissiveIntensity: 0.32, roughness: 1 });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), paneMat);
  pane.rotation.y = Math.PI / 2; pane.position.set(-56.6, 34, -6); decor.push(pane);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf3f3f0, roughness: 0.7 });
  const vframe = (z) => decor.push(box(2, 74, 4, frameMat, -56.5, 34, z));
  const hframe = (y) => decor.push(box(2, 4, 74, frameMat, -56.5, y, -6));
  vframe(-42); vframe(30); hframe(-2); hframe(70);
  // blind slats over the top half
  const slatMat = new THREE.MeshStandardMaterial({ color: 0xf6f5f2, roughness: 0.8 });
  for (let i = 0; i < 8; i++) {
    decor.push(box(1.5, 1.4, 68, slatMat, -55.8, 66 - i * 4.5, -6));
  }

  // ── black desk lamp with an Edison globe bulb (left of the counter) ─────────
  const lamp = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.5, 2, 24),
    new THREE.MeshStandardMaterial({ color: 0xcaa87e, roughness: 0.6 })); // wood base
  base.position.set(0, 1, 0); base.castShadow = true; lamp.add(base);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 40, 16), blackMat);
  rod.position.set(0, 21, 0); rod.castShadow = true; lamp.add(rod);
  const arm = new THREE.Mesh(new THREE.TorusGeometry(6, 0.7, 12, 24, Math.PI), blackMat);
  arm.position.set(6, 40, 0); arm.rotation.z = Math.PI; lamp.add(arm);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 16), blackMat);
  socket.position.set(12, 38, 0); lamp.add(socket);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff1cf, emissive: 0xffd98a, emissiveIntensity: 2.4, roughness: 0.3,
    transparent: true, opacity: 0.92 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(4, 24, 24), bulbMat);
  bulb.position.set(12, 32, 0); lamp.add(bulb);
  const bulbLight = new THREE.PointLight(0xffcf87, 0.8, 120, 2);
  bulbLight.position.set(12, 31, 0); lamp.add(bulbLight);
  lamp.position.set(-42, 0, -13); decor.push(lamp);

  // ── lighting: warm window key + soft fills, tuned to the photo ─────────────
  const key = new THREE.DirectionalLight(0xffdca8, 1.25);
  key.position.set(-70, 70, 24); key.target.position.set(10, 0, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 10; key.shadow.camera.far = 320;
  const sc = 110;
  key.shadow.camera.left = -sc; key.shadow.camera.right = sc;
  key.shadow.camera.top = sc; key.shadow.camera.bottom = -sc;
  key.shadow.bias = -0.0004;
  group.add(key); group.add(key.target);

  const hemi = new THREE.HemisphereLight(0xbfd4e8, 0x6b5a45, 0.32);
  group.add(hemi);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.2);
  fill.position.set(40, 30, 40); group.add(fill);
  group.add(new THREE.AmbientLight(0xffffff, 0.05));

  // pack all decor into the swappable sub-group
  const props = new THREE.Group(); props.name = 'room-props';
  for (const d of decor) props.add(d);
  group.add(props);

  scene.add(group);
  return { group, props, bench, marbleY: 0, slab, textures: [marbleTex, woodTex, wallTex] };
}
