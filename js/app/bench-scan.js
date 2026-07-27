// Bench scan — the photogrammetry-mesh version of the room, as a click-to-swap
// alternative to the hand-modeled bench-room. The raw capture is rough (melted
// geometry, holes, a whole cluttered room around the bit we want), so this does
// the augmentations that make it usable:
//   • render it UNLIT — its lighting is already baked into the diffuse map, so
//     re-lighting it with the room's lamps doubles up and blows it out to white.
//   • double-side every face so the holey back-faces don't read as gaps.
//   • fit it: scale the metre-scale capture to the scene (1 unit = 1 cm) and land
//     the captured countertop exactly on y = 0 — the plane creator-assembly.js
//     rests parts on — anchored on the counter's clearest patch, so parts don't
//     spawn buried inside the plant and the pile of cables that are also in the
//     capture. main.js hides the procedural marble slab while Scan is on, so the
//     captured counter IS the bench.
// FIT is the baked result of that search for assets/rooms/desk.glb. The search
// itself (findCounterPlanes) is a few full sweeps of a photogrammetry mesh — too
// slow to spend at every boot for an answer that never changes — so it only runs
// when FIT is null or the URL carries ?scanfit. To re-bake after swapping the
// capture: load with ?scanfit, use window.__scan.surfaces()/use(n)/pos/rot/scale
// to land it, then paste window.__scan.get() into FIT.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const URL = 'assets/rooms/desk.glb';
const FIT = {
  position: [201.886, 57.607, 113.043],
  rotation: [0, 1.532, 0],
  scale: 100,
};
const DEFAULT = { rotation: [0, 0, 0], cmPerUnit: 100, scaleFill: 150, nudge: [0, 0, 0], surface: 0 };

// Find the captured desktop. The capture is a whole ROOM, so height alone can't
// find it: binning every horizontal triangle by height lumps the desk in with the
// tables, shelves and chair seats that share its height across the room, and their
// combined centroid lands on empty floor. So the search is spatial:
//   1. FLOOR = the heaviest horizontal height-band in the bottom quarter.
//   2. raster every upward-ish triangle in the desk band (0.18–0.34 of the room
//      height above the floor, a fraction so it holds whatever units the capture
//      is in) into a coarse xz grid holding each cell's mean height.
//   3. CLOSE the raster — the mesh is melted and holey, so a real desktop shows up
//      as sparse specks that a plain flood fill would never join. Each cell adopts
//      the strongest sample within CLOSE_R cells, which bridges those gaps.
//   4. flood-fill cells whose mean heights are within STEP_TOL — one contiguous
//      slab per cluster, so a desk doesn't merge with a chair seat beside it.
// Clusters come back ranked by area; the biggest is the desk. If it picks wrong on
// a given capture, window.__scan.surfaces()/use(n) retargets it live and the index
// can be baked into DEFAULT.surface. A PCA over the winning cluster gives the yaw
// that lays its long axis along +x, plus its half-extents. All values are in the
// root's local space — the root transform must be identity.
const COUNTER_LO = 0.18, COUNTER_HI = 0.34;  // fraction of room height above the floor
const CELL_DIV = 150;    // xz cells across the room's longest side
const CLOSE_R = 2;       // morphological closing radius, in cells
const UP_MIN = 0.7;      // |cos| between a face normal and +y to count as "flat"
const STEP_TOL = 0.02;   // max height step between joined cells, as a fraction of room height
const CLEAR_HI = 0.45;   // ignore anything above this (of room height) when looking for clutter
const CLEAR_UP = 0.015;  // a cell counts as clear if nothing stands more than this above it

// Flatten the mesh to one triangle table (centroid + area + upness) up front —
// the search below reads it several times, and re-walking a photogrammetry mesh
// per pass blocks the main thread long enough to be felt at boot.
function collectTriangles(root) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  root.updateMatrixWorld(true);
  const meshes = [];
  let cap = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry;
    meshes.push(o);
    cap += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  const X = new Float32Array(cap), Y = new Float32Array(cap), Z = new Float32Array(cap);
  const A = new Float32Array(cap), U = new Float32Array(cap);
  let m = 0;
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const tris = (idx ? idx.count : pos.count) / 3;
    for (let t = 0; t < tris; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
      const area = n.length() * 0.5;
      if (area <= 0) continue;
      X[m] = (a.x + b.x + c.x) / 3; Y[m] = (a.y + b.y + c.y) / 3; Z[m] = (a.z + b.z + c.z) / 3;
      A[m] = area;
      U[m] = Math.abs(n.y / (area * 2));   // |cos| between face normal and +y
      m++;
    }
  }
  return { n: m, X, Y, Z, A, U };
}

function findCounterPlanes(root) {
  const bbox = new THREE.Box3().setFromObject(root);
  const minY = bbox.min.y, height = bbox.max.y - minY;
  if (!(height > 0)) return [];
  const { n: tris, X, Y, Z, A, U } = collectTriangles(root);

  // 1. floor height — the heaviest horizontal band in the bottom quarter
  const BINS = 100, bin = height / BINS;
  const acc = Array.from({ length: BINS }, () => ({ a: 0, y: 0 }));
  for (let t = 0; t < tris; t++) {
    if (U[t] < 0.9) continue;
    const k = Math.min(BINS - 1, Math.max(0, Math.floor((Y[t] - minY) / bin)));
    acc[k].a += A[t]; acc[k].y += Y[t] * A[t];
  }
  let floorBin = -1, floorA = 0;
  for (let k = 0; k <= Math.floor(BINS * 0.25); k++) {
    if (acc[k].a > floorA) { floorA = acc[k].a; floorBin = k; }
  }
  if (floorBin < 0) return [];
  const floorY = acc[floorBin].y / acc[floorBin].a;

  // 2. raster the desk band into a coarse xz grid of mean heights
  const loY = floorY + height * COUNTER_LO, hiY = floorY + height * COUNTER_HI;
  const x0 = bbox.min.x, z0 = bbox.min.z;
  const spanX = bbox.max.x - x0, spanZ = bbox.max.z - z0;
  const cell = Math.max(spanX, spanZ) / CELL_DIV || 1;
  const gx = Math.max(4, Math.ceil(spanX / cell)), gz = Math.max(4, Math.ceil(spanZ / cell));
  const rawA = new Float64Array(gx * gz), rawY = new Float64Array(gx * gz);
  for (let t = 0; t < tris; t++) {
    const y = Y[t];
    if (U[t] < UP_MIN || y < loY || y > hiY) continue;
    const i = Math.min(gx - 1, Math.max(0, Math.floor((X[t] - x0) / cell)));
    const j = Math.min(gz - 1, Math.max(0, Math.floor((Z[t] - z0) / cell)));
    rawA[j * gx + i] += A[t]; rawY[j * gx + i] += y * A[t];
  }

  // 3. closing pass — each cell adopts the strongest sample in its neighbourhood
  const cellA = new Float64Array(gx * gz), cellY = new Float64Array(gx * gz);
  for (let j = 0; j < gz; j++) {
    for (let i = 0; i < gx; i++) {
      let bestA = 0, bestY = 0;
      for (let dj = -CLOSE_R; dj <= CLOSE_R; dj++) {
        for (let di = -CLOSE_R; di <= CLOSE_R; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= gx || jj >= gz) continue;
          const a = rawA[jj * gx + ii];
          if (a > bestA) { bestA = a; bestY = rawY[jj * gx + ii] / a; }
        }
      }
      cellA[j * gx + i] = bestA; cellY[j * gx + i] = bestY;
    }
  }

  // 4. what's ON the surfaces — the tallest thing standing in each cell, under
  // head height. A real counter is covered in clutter, so the centroid of the
  // detected slab is usually buried under a plant or a bag; step 6 uses this to
  // anchor the build area on the clearest patch instead.
  const clearHi = floorY + height * CLEAR_HI;
  const topY = new Float32Array(gx * gz).fill(-Infinity);
  for (let t = 0; t < tris; t++) {
    const y = Y[t];
    if (y > clearHi) continue;
    const i = Math.min(gx - 1, Math.max(0, Math.floor((X[t] - x0) / cell)));
    const j = Math.min(gz - 1, Math.max(0, Math.floor((Z[t] - z0) / cell)));
    const k = j * gx + i;
    if (y > topY[k]) topY[k] = y;
  }

  // 5. flood-fill same-height neighbours into clusters, ranked by area
  const tol = height * STEP_TOL;
  const seen = new Uint8Array(gx * gz);
  const stack = [];
  const found = [];
  for (let s = 0; s < cellA.length; s++) {
    if (seen[s] || cellA[s] <= 0) continue;
    let A = 0, Y = 0, X = 0, Z = 0;
    const cells = [];
    seen[s] = 1; stack.push(s);
    while (stack.length) {
      const k = stack.pop();
      const a = cellA[k], my = cellY[k];
      const i = k % gx, j = (k - i) / gx;
      A += a; Y += my * a; X += (x0 + (i + 0.5) * cell) * a; Z += (z0 + (j + 0.5) * cell) * a;
      cells.push(k);
      const nb = [i > 0 ? k - 1 : -1, i < gx - 1 ? k + 1 : -1,
        j > 0 ? k - gx : -1, j < gz - 1 ? k + gx : -1];
      for (const n2 of nb) {
        if (n2 < 0 || seen[n2] || cellA[n2] <= 0) continue;
        if (Math.abs(cellY[n2] - my) > tol) continue;
        seen[n2] = 1; stack.push(n2);
      }
    }
    found.push({ A, cy: Y / A, cx: X / A, cz: Z / A, cells });
  }
  if (!found.length) return [];

  // 6. per cluster: PCA → the yaw that lays its long axis on +x, half-extents,
  // and the clear spot — the cluster cell furthest (by 4-connected BFS) from any
  // cell that is either off the slab or has something standing on it.
  found.sort((p, q) => q.A - p.A);
  const headroom = height * CLEAR_UP;
  return found.slice(0, 8).map(({ A, cx, cy, cz, cells }) => {
    let sxx = 0, sxz = 0, szz = 0, w = 0;
    const pt = (k) => {
      const i = k % gx;
      return [x0 + (i + 0.5) * cell, z0 + ((k - i) / gx + 0.5) * cell];
    };
    for (const k of cells) {
      const [px, pz] = pt(k), a = cellA[k];
      const dx = px - cx, dz = pz - cz;
      sxx += dx * dx * a; sxz += dx * dz * a; szz += dz * dz * a; w += a;
    }
    let yaw = 0;
    if (w > 0) {
      sxx /= w; sxz /= w; szz /= w;
      yaw = -0.5 * Math.atan2(2 * sxz, sxx - szz);
    }
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    let halfX = 0, halfZ = 0;
    for (const k of cells) {
      const [px, pz] = pt(k);
      const dx = px - cx, dz = pz - cz;
      halfX = Math.max(halfX, Math.abs(dx * cos + dz * sin));
      halfZ = Math.max(halfZ, Math.abs(-dx * sin + dz * cos));
    }

    // BFS distance transform over the cluster's free cells
    const free = new Set();
    for (const k of cells) if (topY[k] <= cellY[k] + headroom) free.add(k);
    const dist = new Map();
    const queue = [];
    for (const k of free) {
      const i = k % gx, j = (k - i) / gx;
      const nb = [i > 0 ? k - 1 : -1, i < gx - 1 ? k + 1 : -1,
        j > 0 ? k - gx : -1, j < gz - 1 ? k + gx : -1];
      if (nb.some((n2) => n2 < 0 || !free.has(n2))) { dist.set(k, 1); queue.push(k); }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const k = queue[qi], d = dist.get(k) + 1;
      const i = k % gx, j = (k - i) / gx;
      for (const n2 of [i > 0 ? k - 1 : -1, i < gx - 1 ? k + 1 : -1,
        j > 0 ? k - gx : -1, j < gz - 1 ? k + gx : -1]) {
        if (n2 < 0 || !free.has(n2) || dist.has(n2)) continue;
        dist.set(n2, d); queue.push(n2);
      }
    }
    let clearK = -1, clearD = 0;
    for (const [k, d] of dist) if (d > clearD) { clearD = d; clearK = k; }
    const [clx, clz] = clearK >= 0 ? pt(clearK) : [cx, cz];

    return { y: cy, x: clx, z: clz, centroid: [cx, cz], clearR: clearD * cell,
      area: A, floorY, yaw, halfX, halfZ };
  });
}

export function initBenchScan({ scene, onReady } = {}) {
  const group = new THREE.Group();
  group.name = 'bench-scan';
  group.visible = false;
  scene.add(group);

  const state = { loaded: false, root: null, position: [0, 0, 0], rotation: [...DEFAULT.rotation], scale: 1 };

  function applyTransform() {
    if (!state.root) return;
    state.root.scale.setScalar(state.scale);
    state.root.rotation.set(state.rotation[0], state.rotation[1], state.rotation[2]);
    state.root.position.set(state.position[0], state.position[1], state.position[2]);
  }

  new GLTFLoader().load(URL, (g) => {
    const root = g.scene;
    // augment: render the capture UNLIT. Its lighting is already baked into the
    // diffuse map, so re-lighting it with the room's key/point lights doubles up
    // and blows the whole mesh out to white. A basic material shows the texture
    // exactly as photographed. Double-sided so the holey shell doesn't read as
    // gaps from the inside.
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.castShadow = false; o.receiveShadow = false;
      const src = Array.isArray(o.material) ? o.material : [o.material];
      const flat = src.map((m) => new THREE.MeshBasicMaterial({
        map: m.map || null,
        color: m.map ? 0xffffff : (m.color || new THREE.Color(0x9a9a9a)),
        side: THREE.DoubleSide,
        toneMapped: true,
      }));
      o.material = Array.isArray(o.material) ? flat : flat[0];
      for (const m of src) m.dispose?.();
    });

    // fit: land the captured countertop on the build plane (y = 0), centered and
    // squared up, at real scale — the app is 1 unit = 1 cm, the capture is metres.
    root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.setScalar(1);
    const bbox = new THREE.Box3().setFromObject(root);
    const c = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());

    state.root = root;
    // the surface search is expensive; skip it entirely when the fit is baked
    const refit = !FIT || /[?&]scanfit\b/.test(window.location.search);
    let surfaces = [];
    const detect = () => (surfaces = surfaces.length ? surfaces : findCounterPlanes(root));
    if (refit) detect();

    // Land surface #n on the build plane. Split out so window.__scan.use(n) can
    // re-fit onto a different detected surface without a reload.
    function fitTo(n) {
      const [nx, ny, nz] = DEFAULT.nudge;
      const counter = surfaces[n];
      if (!counter) {
        // fallback: bottom-align to the floor and center, as before
        const s = DEFAULT.scaleFill / Math.max(size.x, size.y, size.z);
        state.scale = s; state.rotation = [...DEFAULT.rotation];
        state.position = [-c.x * s + nx, -bbox.min.y * s - 78 + ny, -c.z * s - 14 + nz];
        console.warn('[bench-scan] no counter plane detected — using bbox fit');
        applyTransform();
        return;
      }
      state.surface = n;
      state.counter = counter;
      // a real desk/counter sits 0.6–1.4 m off the floor — if the detected one
      // does too, the capture is metric and cmPerUnit is the right scale;
      // otherwise the units are unknown, so scale the bbox to fill the room.
      const rise = counter.y - counter.floorY;
      const metric = rise > 0.6 && rise < 1.4;
      const s = metric ? DEFAULT.cmPerUnit : DEFAULT.scaleFill / Math.max(size.x, size.y, size.z);
      state.scale = s;
      state.rotation = [0, counter.yaw, 0];
      // counter plane → y = 0, counter centroid → x/z = 0 (through the same yaw)
      const cos = Math.cos(counter.yaw), sin = Math.sin(counter.yaw);
      state.position = [
        -(counter.x * cos + counter.z * sin) * s + nx,
        -counter.y * s + ny,
        -(-counter.x * sin + counter.z * cos) * s + nz,
      ];
      applyTransform();
      console.info(`[bench-scan] surface #${n} of ${surfaces.length}: `
        + `${(rise * 100).toFixed(0)}cm above the floor, `
        + `${(counter.halfX * 2 * s).toFixed(0)}×${(counter.halfZ * 2 * s).toFixed(0)}cm, `
        + `yaw ${(counter.yaw * 180 / Math.PI).toFixed(1)}°, `
        + `clear radius ${(counter.clearR * s).toFixed(0)}cm (metric fit: ${metric})`);
    }
    if (refit) fitTo(DEFAULT.surface);
    else {
      state.position = [...FIT.position]; state.rotation = [...FIT.rotation]; state.scale = FIT.scale;
      applyTransform();
    }

    group.add(root);
    state.loaded = true;

    window.__scan = {
      pos: (x, y, z) => { state.position = [x, y, z]; applyTransform(); },
      rot: (x, y, z) => { state.rotation = [x, y, z]; applyTransform(); },
      scale: (v) => { state.scale = v; applyTransform(); },
      // the detected candidates, biggest first — use(n) re-fits onto one of them.
      // Both run the search on demand, so they work without ?scanfit too.
      surfaces: () => detect().map((f, i) => ({
        i,
        riseCm: Math.round((f.y - f.floorY) * 100),
        sizeCm: [Math.round(f.halfX * 2 * 100), Math.round(f.halfZ * 2 * 100)],
        clearCm: Math.round(f.clearR * 100),
        yawDeg: +(f.yaw * 180 / Math.PI).toFixed(1),
      })),
      use: (n) => { detect(); fitTo(n); },
      get: () => ({ position: state.position, rotation: state.rotation, scale: state.scale,
        surface: state.surface, counter: state.counter }),
      root,
    };
    console.info(`[bench-scan] loaded (${refit ? 'detected' : 'baked'} fit) — `
      + '__scan.surfaces()/use(n) to retarget, pos/rot/scale to nudge');
    onReady?.();
  }, undefined, (e) => console.warn('[bench-scan] load failed', e));

  return {
    group,
    show: () => { group.visible = true; },
    hide: () => { group.visible = false; },
    isLoaded: () => state.loaded,
    state,
  };
}
