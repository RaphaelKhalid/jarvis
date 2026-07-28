// Shared loaders for the CC0 asset set (see assets/CREDITS.md). Kept separate
// from bench-room.js so the room file stays about the room, and so anything else
// that wants a Poly Haven prop or an ambientCG material gets the same caching,
// colour-space and scale handling.
//
// Two conventions this file enforces, both easy to get wrong:
//   • ambientCG maps: only the _Color map is sRGB; normal/roughness/AO are data.
//     AO is pointed at UV channel 0 (`tex.channel = 0`) because our geometry is
//     procedural BoxGeometry/PlaneGeometry with a single UV set — three r152+
//     otherwise looks for `uv1` and silently renders the AO as black.
//   • Poly Haven models are in METRES; the app is 1 unit = 1 cm, so everything
//     gets a ×100 scale. placeModel() does that and bottom-aligns for you.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export const CM_PER_METRE = 100;

/**
 * Run `fn` once the page has finished loading and the main thread is idle.
 *
 * The room pulls ~57 MB (HDRI + glTFs + PBR sets). Kicked off during module
 * evaluation, those fetches are subresources of the initial navigation, so they
 * hold the window `load` event open — the app sat "loading" for over a minute on
 * a cold cache even though the bench was interactive almost immediately. Waiting
 * for `load` first makes the room strictly additive: the bench comes up on the
 * built geometry, then the fidelity layer arrives behind it.
 */
export function whenIdle(fn) {
  const go = () => (window.requestIdleCallback
    ? window.requestIdleCallback(fn, { timeout: 2000 })
    : setTimeout(fn, 1));
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

const PBR_DIR = 'assets/textures/pbr';
const MODEL_DIR = 'assets/models/polyhaven';
const HDRI_DIR = 'assets/hdri';

// Which maps each ambientCG set actually ships (Marble016 has no AO). Listing
// them rather than probing avoids a guaranteed 404 per material at boot.
const PBR_MAPS = {
  Marble016: ['Color', 'NormalGL', 'Roughness'],
  WoodFloor051: ['Color', 'NormalGL', 'Roughness', 'AmbientOcclusion'],
  PaintedPlaster016: ['Color', 'NormalGL', 'Roughness', 'AmbientOcclusion'],
  PaintedWood008C: ['Color', 'NormalGL', 'Roughness', 'AmbientOcclusion'],
  Fabric061: ['Color', 'NormalGL', 'Roughness', 'AmbientOcclusion'],
};

const SLOT = {
  Color: 'map',
  NormalGL: 'normalMap',
  Roughness: 'roughnessMap',
  AmbientOcclusion: 'aoMap',
};

const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
const texCache = new Map();
const modelCache = new Map();

function loadTex(url, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const key = `${url}|${repeat}`;
  if (texCache.has(key)) return texCache.get(key);
  const t = texLoader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  texCache.set(key, t);
  return t;
}

/**
 * An ambientCG material. `repeat` is in texture tiles across the mesh's UV span
 * — our boxes/planes are unwrapped 0..1 per face, so this is "how many times the
 * material tiles", and wants scaling with the mesh's real size to keep the grain
 * physically plausible (a 5 m floor needs a much higher repeat than a 50 cm door).
 *
 * `useColor: false` loads everything EXCEPT the albedo, so the caller supplies
 * base colour itself. That matters because several sets in assets/ don't look
 * like their names: Marble016 is BLACK marble, PaintedPlaster016 is distressed
 * plaster over exposed brick, and PaintedWood008C is dark weathered barn wood.
 * A `color` tint can't rescue those — three multiplies tint × albedo, so tinting
 * can only ever darken. Their normal/roughness maps are generic surface relief
 * and perfectly good, so the room keeps those and drives albedo from the palette
 * (or, for the counter, from a purpose-built calacatta canvas).
 */
export function pbrMaterial(name, {
  repeat = 1, physical = false, useColor = true, ...opts
} = {}) {
  const maps = PBR_MAPS[name];
  if (!maps) throw new Error(`unknown ambientCG material: ${name}`);
  const Mat = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  // The material exists immediately as flat colour; its maps attach once the
  // page has loaded. Kicking ~10 1K JPEG fetches + decodes off during module
  // evaluation is what actually dominated cold page-load, far more than the HDRI.
  const mat = new Mat(opts);
  whenIdle(() => {
    for (const m of maps) {
      if (m === 'Color' && !useColor) continue;
      const tex = loadTex(`${PBR_DIR}/${name}/${name}_1K-JPG_${m}.jpg`,
        { srgb: m === 'Color', repeat });
      if (m === 'AmbientOcclusion') tex.channel = 0;  // single-UV procedural geometry
      mat[SLOT[m]] = tex;
    }
    mat.needsUpdate = true;   // adding maps changes the shader program
  });
  return mat;
}

/** Load a Poly Haven glTF once; callers get their own clone to transform. */
export function loadModel(name) {
  if (!modelCache.has(name)) {
    modelCache.set(name, gltfLoader.loadAsync(`${MODEL_DIR}/${name}/${name}_1k.gltf`)
      .then((g) => {
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = o.receiveShadow = true;
        });
        return g.scene;
      }));
  }
  return modelCache.get(name);
}

/**
 * Load a model, scale it metres→cm, and drop it at (x, z) with its BASE resting
 * on `y`. Bottom-aligning off the real bbox is what keeps props from floating or
 * sinking — the models' own origins are inconsistent, so hand-tuned y offsets
 * would need re-deriving every time an asset is swapped.
 *
 * `fitHeight` overrides the ×100 scale to force a target height in cm — the
 * escape hatch for assets whose real-world size is wrong for the shot.
 * `pick` selects a subset by mesh name (for multi-prop assets like the
 * stationery set and the 49-mesh cable kit) and re-centres what survives.
 */
export async function placeModel(name, {
  x = 0, y = 0, z = 0, rotY = 0, scale = CM_PER_METRE, fitHeight = null,
  pick = null, parent = null,
} = {}) {
  const src = await loadModel(name);
  const root = src.clone(true);

  if (pick) {
    const keep = [];
    root.traverse((o) => { if (o.isMesh && pick(o.name, o)) keep.push(o); });
    if (!keep.length) return null;
    const holder = new THREE.Group();
    for (const m of keep) holder.attach(m);
    root.clear();
    root.add(holder);
  }

  root.scale.setScalar(scale);
  root.rotation.y = rotY;
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);

  if (fitHeight) {
    const h = box.max.y - box.min.y;
    if (h > 0) {
      root.scale.setScalar(scale * (fitHeight / h));
      root.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(root);
    }
  }

  const c = box.getCenter(new THREE.Vector3());
  root.position.set(x - c.x, y - box.min.y, z - c.z);
  root.userData.sizeCm = box.getSize(new THREE.Vector3()).toArray();
  parent?.add(root);
  return root;
}

/**
 * Image-based lighting from the CC0 HDRI. This is the single biggest fidelity
 * lever in the room: the marble, the lamp's metal and the laptop shell all read
 * as plastic under the old analytic-light-only setup, because there is nothing
 * for them to reflect. Resolves once the HDRI is decoded.
 */
export async function loadEnvironment(renderer, scene, {
  file = 'residential_garden_2k', intensity = 1,
} = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const hdr = await new RGBELoader().loadAsync(`${HDRI_DIR}/${file}.hdr`);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const env = pmrem.fromEquirectangular(hdr).texture;
  scene.environment = env;
  if ('environmentIntensity' in scene) scene.environmentIntensity = intensity;
  hdr.dispose();
  pmrem.dispose();
  return env;
}
