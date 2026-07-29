// Bench room — a modeled 3D replica of the reference desk photo, built to be the
// surface the electronic parts sit on. This is the "in-engine reconstruction"
// path (chosen after a photo-capture came out too rough): a sage-green cabinet
// desk with a white calacatta-marble countertop, a plaster wall, a curtained
// window throwing warm light from the left, a desk lamp, and an LG-style
// front-load washer tucked under the right of the counter.
//
// Coordinate contract (1 unit = 1 cm, matching the rest of the app):
//   • the marble TOP sits at world y = 0 — the same plane creator-assembly.js
//     rests parts on (GROUND_Y = 0), so parts land flush on the counter.
//   • the build area is ~±26 units in x/z; the slab extends well past that and
//     the cabinet/washer sit below, the wall behind (−z), the window to the left.
//   • every prop is placed OUTSIDE that ±26 keep-out, so nothing a user drags a
//     component onto is ever occupied by scenery.
//
// Fidelity comes from the CC0 asset set in assets/ (see CREDITS.md): ambientCG
// PBR materials on the built surfaces, Poly Haven glTF models for the props, and
// a Poly Haven HDRI for image-based lighting. The IBL is the load-bearing part —
// marble, brushed metal and a laptop shell all read as flat plastic when there
// is nothing in the scene for them to reflect.
//
// Loading is progressive and never blocks: geometry + lights go up synchronously
// so the bench is usable immediately, then materials resolve and the props fade
// in as their glTFs arrive. A missing or failed asset degrades to the flat
// colour underneath it rather than throwing.
import * as THREE from 'three';
import { pbrMaterial, placeModel, loadEnvironment, whenIdle } from './room-assets.js';
import { isLowQuality } from './quality.js';

// palette pulled from the photo. These are TINTS, and three multiplies tint ×
// albedo — so a surface that already carries its own colour (the calacatta
// canvas, the oak floor) must be left at white or it just goes muddy.
const SAGE = 0xa8bcaa;      // muted mint cabinet
const MARBLE_WHITE = 0xffffff;   // colour lives in the calacatta canvas
const WALL_GRAY = 0xdfe2de;
const WOOD = 0xffffff;      // WoodFloor051 is already light oak
const BLACK_METAL = 0x1c1e22;
const WASHER_WHITE = 0xe8e9ea;

// The build area parts get dropped into. Props must clear it.
const BUILD_HALF = 26;

// ── procedural albedos ─────────────────────────────────────────────────────
// Two surfaces draw their base colour from canvas rather than from the CC0 set,
// because the downloaded material doesn't look like its name (see room-assets.js
// `useColor`). Their ambientCG normal/roughness maps are still used underneath —
// only the colour is replaced.
function makeCanvas(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// calacatta: warm-white base with a few soft grey (+ faint gold) vein systems.
// Stands in for Marble016, which is black marble.
function makeMarbleTexture() {
  const s = 1024, c = makeCanvas(s), x = c.getContext('2d');
  x.fillStyle = '#f2efe7'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 120; i++) {
    x.globalAlpha = 0.03;
    x.fillStyle = i % 5 ? '#f6f4ee' : '#e2dfd6';
    const r = 40 + Math.random() * 160;
    x.beginPath(); x.arc(Math.random() * s, Math.random() * s, r, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  const vein = (sx, sy, ex, ey, w, col) => {
    x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'round';
    x.beginPath(); x.moveTo(sx, sy);
    const mx = (sx + ex) / 2 + (Math.random() - 0.5) * 300;
    const my = (sy + ey) / 2 + (Math.random() - 0.5) * 300;
    x.quadraticCurveTo(mx, my, ex, ey); x.stroke();
  };
  // Many fine, low-contrast veins rather than a few bold ones. The texture tiles
  // across the slab (see repeat below), so a stroke drawn here lands roughly
  // 45cm long in world space — draw them heavy and the counter reads as scribble
  // rather than stone.
  for (let i = 0; i < 9; i++) {
    const sx = Math.random() * s, sy = -20, ex = Math.random() * s, ey = s + 20;
    vein(sx, sy, ex, ey, 1.4 + Math.random() * 1.6, 'rgba(128,128,134,0.3)');
    for (let j = 0; j < 5; j++) {
      const t = Math.random();
      vein(sx + (ex - sx) * t, sy + (ey - sy) * t,
        sx + (ex - sx) * t + (Math.random() - 0.5) * 220,
        sy + (ey - sy) * t + (Math.random() - 0.5) * 220,
        0.7, 'rgba(150,148,152,0.2)');
    }
    if (i < 3) vein(sx + 7, sy, ex + 7, ey, 1, 'rgba(198,176,116,0.16)'); // faint gold
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // Tile it. Mapped 0..1 across a 135cm slab a single vein sweeps the entire
  // counter; at 3× the pattern lands at a believable stone scale.
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1.4);
  t.anisotropy = 8;
  return t;
}

// clean grey painted plaster. Stands in for PaintedPlaster016, whose colour AND
// normal are distressed plaster falling off exposed brick — the brick relief
// makes even its normal map unusable for a tidy interior wall.
function makeWallTexture() {
  const s = 512, c = makeCanvas(s), x = c.getContext('2d');
  x.fillStyle = '#d5d8d4'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    x.globalAlpha = 0.04;
    x.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#b4b8b2';
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

export function initBenchRoom({ scene, renderer, bloom, studioLights = [] } = {}) {
  const lowQ = isLowQuality();
  // The studio three-point rig isn't a mesh, so the decor show/hide never touches
  // it. Left on, it sums with the room's own daylight — over-exposing everything
  // and washing a cool blue cast over warm wood and sage paint. The room lights
  // itself, so the studio rig goes dark while it's up. Kept (not removed) so RUN
  // mode and the Scan room can switch it back on.
  for (const l of studioLights) l.visible = false;
  if (renderer) {
    renderer.shadowMap.enabled = true;
    // photographic exposure, a touch under the studio default (1.02).
    renderer.toneMappingExposure = 1.0;
  }
  // Retune bloom for a daylit room. The studio threshold (0.85 linear) assumes
  // the only bright things in frame are emissives; here every sunlit white
  // surface clears it, and the bench hazes over into milk. Raising the threshold
  // above "brightly lit white" keeps the glow for LEDs and the lamp filament,
  // which are emissive and far brighter still.
  if (bloom) {
    bloom.threshold = 1.15;
    bloom.strength = lowQ ? 0.22 : 0.3;
  }
  const group = new THREE.Group();
  group.name = 'bench-room';

  // ── materials ─────────────────────────────────────────────────────────────
  // `repeat` is tiles across each face's 0..1 UV span, picked so the grain reads
  // at real-world scale on the mesh it lands on.
  //
  // Only WoodFloor051 is used as shipped. The rest take their surface relief
  // (normal/roughness/AO) from ambientCG but get their colour from the palette
  // or a canvas — see room-assets.js `useColor` for why.
  const marbleTex = makeMarbleTexture();
  const wallTex = makeWallTexture();

  const marbleMat = pbrMaterial('Marble016', {
    repeat: 2, physical: true, useColor: false,
    map: marbleTex, color: MARBLE_WHITE,
    roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.3,
    envMapIntensity: 0.55,
  });
  // plain plaster: PaintedPlaster016's normal carries brick relief, so this one
  // takes nothing from the CC0 set at all.
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex, color: WALL_GRAY, roughness: 0.95, envMapIntensity: 0.6,
  });
  const woodMat = pbrMaterial('WoodFloor051', {
    repeat: 7, color: WOOD, roughness: 0.8, envMapIntensity: 0.5,
  });
  // painted cabinetry: the barn-wood grain relief reads correctly as grain
  // showing through paint, so keep the normal and repaint the albedo sage.
  const cabinetMat = pbrMaterial('PaintedWood008C', {
    repeat: 2, useColor: false, color: SAGE, roughness: 0.6, envMapIntensity: 0.6,
  });
  const drawerMat = pbrMaterial('PaintedWood008C', {
    repeat: 1, useColor: false, color: 0xaec0b0, roughness: 0.55, envMapIntensity: 0.6,
  });
  const curtainMat = pbrMaterial('Fabric061', {
    repeat: 3, useColor: false, color: 0xf6f3ec, roughness: 0.95,
    side: THREE.DoubleSide, envMapIntensity: 0.8,
  });
  const blackMat = new THREE.MeshStandardMaterial({
    color: BLACK_METAL, roughness: 0.38, metalness: 0.8, envMapIntensity: 1.1 });
  const washerMat = new THREE.MeshStandardMaterial({
    color: WASHER_WHITE, roughness: 0.3, metalness: 0.12, envMapIntensity: 0.9 });

  // ── image-based lighting (async; the room is lit by the analytic lights until
  // it lands, then gains real reflections) ───────────────────────────────────
  if (renderer) {
    // 1k, not 2k, on every tier. The HDRI is never rendered — scene.background
    // stays as-is and it is only ever convolved by PMREM into a low-order
    // irradiance/specular map, so the extra mip detail in the 2k is thrown away.
    // What it does cost is real: 6.5 MB of float decode plus a slower convolution
    // (~4× the page-load time in CI). assets/hdri keeps the 2k for stills.
    whenIdle(() => loadEnvironment(renderer, scene, {
      file: 'residential_garden_1k',
      intensity: 0.9,
    }).catch((e) => console.warn('[bench-room] HDRI failed, keeping studio env', e)));
  }

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
  decor.push(box(78, 76, 44, cabinetMat, -16, -42, 0));
  for (const dx of [-34, 3]) {
    decor.push(box(35, 20, 1.5, drawerMat, dx, -13, 22.3));
    decor.push(box(15, 1.6, 1.6, blackMat, dx, -13, 23.4)); // handle bar
  }

  // ── LG-style front-load washer under the right of the counter ──────────────
  decor.push(box(54, 76, 44, washerMat, 52, -42, 0));
  const doorRing = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 16, 3, 40),
    new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.28, metalness: 0.35 }));
  doorRing.rotation.x = Math.PI / 2; doorRing.position.set(52, -38, 22.5);
  doorRing.castShadow = true; decor.push(doorRing);
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(12, 12, 2, 40),
    new THREE.MeshPhysicalMaterial({ color: 0x14171b, roughness: 0.12, metalness: 0.2,
      clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4 }));
  glass.rotation.x = Math.PI / 2; glass.position.set(52, -38, 23.4); decor.push(glass);
  decor.push(box(50, 7, 1, new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5 }), 52, -8, 22.4));

  // ── room shell: back / left / right walls, floor, ceiling ─────────────────
  // Every shell surface is DOUBLE-SIDED. Single-sided planes are backface-culled
  // the moment the orbit camera passes outside them, and the room stops being a
  // room — it reads as a floating diorama against the dark studio background.
  // Double-siding costs nothing here and means the box holds up from any angle.
  wallMat.side = THREE.DoubleSide;
  woodMat.side = THREE.DoubleSide;

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(420, 320), wallMat);
  backWall.position.set(20, 60, -24.5); backWall.receiveShadow = true; decor.push(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), wallMat);
  leftWall.rotation.y = Math.PI / 2; leftWall.position.set(-57, 60, 40);
  leftWall.receiveShadow = true; decor.push(leftWall);

  // right wall — off-frame at the default camera, but it bounces the key light
  // back into the scene instead of letting it fall into a black void.
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), wallMat);
  rightWall.rotation.y = -Math.PI / 2; rightWall.position.set(150, 60, 40);
  rightWall.receiveShadow = true; decor.push(rightWall);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), woodMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(20, -78, 40);
  floor.receiveShadow = true; decor.push(floor);

  // Ceiling: closes the box so there's no open top to see sky-less void through,
  // and gives the key light something to bounce off. It must NOT cast a shadow —
  // a lid over a directional key light would put the whole room in shade.
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(420, 400), wallMat);
  ceiling.rotation.x = Math.PI / 2; ceiling.position.set(20, 142, 40);
  ceiling.castShadow = false; ceiling.receiveShadow = true; decor.push(ceiling);

  // ── window on the left wall: bright warm pane + white frame + fabric curtain ─
  const paneMat = new THREE.MeshStandardMaterial({
    color: 0xfff4e0, emissive: 0xfff0d6, emissiveIntensity: 0.3, roughness: 1 });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), paneMat);
  pane.rotation.y = Math.PI / 2; pane.position.set(-56.6, 34, -6); decor.push(pane);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf3f3f0, roughness: 0.65 });
  const vframe = (z) => decor.push(box(2, 74, 4, frameMat, -56.5, 34, z));
  const hframe = (y) => decor.push(box(2, 4, 74, frameMat, -56.5, y, -6));
  vframe(-42); vframe(30); hframe(-2); hframe(70);
  // a gathered fabric panel down the near edge of the window, replacing the old
  // procedural blind slats — a real cloth normal map catches the key light and
  // sells the "daylight through a window" read far better than flat white boxes.
  // It hangs at x = -56.2, tight to the wall (-57) and clear of the counter slab,
  // whose left edge is x = -55. At -54 the panel speared straight up through the
  // marble and read as a white board standing on the worktop.
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(40, 72, 32, 1), curtainMat);
  {
    const p = curtain.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      // ripple across the panel's width so it reads as hanging cloth, not card
      p.setZ(i, Math.sin(p.getX(i) * 0.55) * 2.2);
    }
    curtain.geometry.computeVertexNormals();
  }
  curtain.rotation.y = Math.PI / 2; curtain.position.set(-56.2, 36, 14);
  curtain.castShadow = true; curtain.receiveShadow = true; decor.push(curtain);

  // pack the built geometry into the swappable sub-group before the async props
  // land — placeModel() appends into this same group as each glTF resolves.
  const props = new THREE.Group(); props.name = 'room-props';
  for (const d of decor) props.add(d);
  group.add(props);

  // ── Poly Haven props (async) ───────────────────────────────────────────────
  // Every position clears the ±26 build area. Models are metres → placeModel
  // applies the ×100 and bottom-aligns off the real bbox, so nothing floats or
  // sinks when an asset is swapped. `y: 0` = standing on the counter,
  // `y: -78` = standing on the floor.
  // The counter is only ~55 cm of clear slab either side of the build area, and
  // several of these assets are authored well over life size (the "classic
  // laptop" is 65 cm wide), so each one is fitted to a real desk height and the
  // strips hold exactly what they fit — one substantial prop per side plus small
  // stuff. Crowding more in just makes props intersect each other.
  const onCounter = [
    // the articulated lamp, sitting where the procedural one used to
    ['desk_lamp_arm_01', { x: -41, z: -2, rotY: 0.6, fitHeight: 46 }],
    ['classic_laptop', { x: 48, z: 2, rotY: -0.55, fitHeight: 26 }],
  ];
  const onFloor = [
    // The only floor prop the default camera actually sees: everything else out
    // there is either behind the camera or inside the counter's footprint. The
    // gap between the end of the counter (x=80) and the right wall (x=150) is
    // ~70 cm, so it's fitted down from its natural 84 cm height to clear both.
    ['potted_plant_02', { x: 115, z: -5, rotY: -0.4, fitHeight: 60 }],
  ];
  // Unused from the asset set, kept for later rather than forced in here:
  //   • pachira_aquatica_01 — the file holds FOUR variants side by side (a/b/c/d,
  //     each a bark + leaves pair), which is the real reason its bbox is 6.9 m
  //     wide. Variant "d" alone is a fine 1.9 m tree, but with 1.4 m of canopy
  //     spread there is nowhere in this room to stand it: the only visible floor
  //     is the ~70 cm strip right of the counter.
  //   • ceramic_pot — authored as a 66 cm floor planter; shrunk to desk scale it
  //     reads as a bowl, and at full size it collides with everything.
  //   • drawer_cabinet — redundant with the sage cabinet and washer already built
  //     under the counter.

  const placed = [];
  const track = (p) => { if (p) placed.push(p); return p; };
  const drop = (name, at, y) => placeModel(name, { ...at, y, parent: props })
    .then(track).catch((e) => console.warn(`[bench-room] ${name} skipped`, e));
  // deferred past `load` for the same reason as the HDRI — see whenIdle()
  whenIdle(() => {
    for (const [name, at] of onCounter) drop(name, at, 0);
    for (const [name, at] of onFloor) drop(name, at, -78);
  // The stationery set is 9 separate props authored side by side in one file, so
  // it gets picked apart too. Note picking keeps the originals' relative spacing,
  // so a multi-item pick is still as wide as their layout — taking just the
  // pencil cup gives one compact 8 cm prop instead of a 29 cm spread.
  //
  // assets/models/polyhaven/modular_electric_cables is deliberately UNUSED here.
  // It's a 49-piece modular kit for building wall/conduit runs, authored flat in
  // the XY plane on a layout grid — every piece would need its own rotation to
  // lie on a counter, and any multi-piece pick keeps the grid spacing and sprays
  // cable across a metre of bench. It stays in the asset set for a future wiring
  // prop, but it is not room dressing.
    drop('stationery_supplies', {
      x: -44, z: 18, rotY: 0.2, pick: (n) => /pencilcup/.test(n),
    }, 0);
  });

  // ── lighting: warm window key + soft fills, tuned to the photo ─────────────
  // Sized to light the room ALONE — the studio three-point rig is switched off
  // above, so these are the only analytic lights in play. They also have to hold
  // the room up on their own for the first moment, before the deferred HDRI
  // lands and starts carrying the ambient.
  const key = new THREE.DirectionalLight(0xffdca8, 2.1);
  key.position.set(-70, 70, 24); key.target.position.set(10, 0, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(lowQ ? 1024 : 2048, lowQ ? 1024 : 2048);
  key.shadow.camera.near = 10; key.shadow.camera.far = 320;
  const sc = 110;
  key.shadow.camera.left = -sc; key.shadow.camera.right = sc;
  key.shadow.camera.top = sc; key.shadow.camera.bottom = -sc;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.4;
  group.add(key); group.add(key.target);

  const hemi = new THREE.HemisphereLight(0xd6e6f5, 0x8a7a63, 0.55);
  group.add(hemi);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
  fill.position.set(40, 30, 40); group.add(fill);

  // a warm point light standing in for the lamp's bulb, so the left end of the
  // counter has a pool of light whether or not the lamp model ever loads.
  const lampGlow = new THREE.PointLight(0xffcf87, 0.9, 130, 2);
  lampGlow.position.set(-34, 34, -10);
  group.add(lampGlow);

  scene.add(group);
  return {
    group, props, bench, marbleY: 0, slab, placed,
    buildHalf: BUILD_HALF,
    // named so tests can assert per-surface expectations: `pbrSurfaces` must
    // carry ambientCG relief maps, all of them must carry a base colour.
    materials: {
      marble: marbleMat, wall: wallMat, floor: woodMat,
      cabinet: cabinetMat, curtain: curtainMat,
    },
    pbrSurfaces: ['marble', 'floor', 'cabinet', 'curtain'],
  };
}
