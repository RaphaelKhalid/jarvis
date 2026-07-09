// Custom-asset workflow — swap the procedural parts for high-quality GLTF models.
//
// HOW TO ADD YOUR OWN MODEL
//   1. Drop a .glb/.gltf into  assets/models/  (e.g. assets/models/arduino.glb).
//   2. Register it in MODEL_OVERRIDES below, keyed by part `type`, with the
//      scale/offset needed to seat it on the chassis (1 unit = 1 cm).
//   3. Reload. Parts with an override load the model; everything else stays
//      procedural, so you can migrate one part at a time.
//
// Models must be self-hosted (same origin) or on a CORS-enabled CDN. Keep them
// low-poly (< ~50k tris) so the assembly scene stays smooth. Kenney.nl (CC0) and
// Sketchfab "downloadable" packs are good sources; re-export to .glb in Blender.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// type -> { url, scale, rotation:[x,y,z], offset:[x,y,z] }.  Empty = all procedural.
export const MODEL_OVERRIDES = {
  // arduino: { url: 'assets/models/arduino.glb', scale: 1, rotation: [0, 0, 0], offset: [0, 0, 0] },
};

const loader = new GLTFLoader();
const cache = new Map();

export function hasModel(type) { return !!MODEL_OVERRIDES[type]; }

// Returns a Promise<THREE.Group> positioned/scaled per the override, with shadows
// enabled. The caller still attaches pins/labels (the model is visual-only).
export function loadModelPart(type) {
  const cfg = MODEL_OVERRIDES[type];
  if (!cfg) return Promise.reject(new Error(`no model override for "${type}"`));
  if (cache.has(cfg.url)) return Promise.resolve(cache.get(cfg.url).clone(true));

  return new Promise((resolve, reject) => {
    loader.load(cfg.url, (gltf) => {
      const root = gltf.scene;
      const s = cfg.scale ?? 1;
      root.scale.setScalar(s);
      if (cfg.rotation) root.rotation.set(...cfg.rotation);
      if (cfg.offset) root.position.set(...cfg.offset);
      root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      cache.set(cfg.url, root);
      resolve(root.clone(true));
    }, undefined, reject);
  });
}
