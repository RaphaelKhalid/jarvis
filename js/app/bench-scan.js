// Bench scan — the photogrammetry-mesh version of the room, as a click-to-swap
// alternative to the hand-modeled bench-room. The raw capture is rough (melted
// geometry, dark baked-in lighting, holes), so this does the augmentations that
// make it presentable:
//   • re-light it: the diffuse map has shadows baked in, so it's also fed in as
//     an emissive map at modest intensity — that lifts the murk without needing
//     a de-lighting pass we can't do in-browser.
//   • double-side every face so the holey back-faces don't read as gaps.
//   • fit it: recenter, scale the ~metre-scale capture up to the scene, and drop
//     it so the captured counter sits roughly at the bench height.
// The crisp procedural marble slab from bench-room stays ON in this mode, so
// parts always rest on a clean surface — the scan only supplies the surrounding
// room. Alignment is fiddly on a rough mesh, so window.__scan.pos/rot/scale let
// us nudge it live and bake the numbers into DEFAULT below.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const URL = 'assets/rooms/desk.glb';
// baked alignment (tuned live via window.__scan, then pasted here)
const DEFAULT = { rotation: [0, 0, 0], scaleFill: 150, zPush: -14 };

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
    // augment: lift the dark baked textures + double-side the holey shell
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false;
      const m = o.material;
      if (!m) return;
      m.side = THREE.DoubleSide;
      m.roughness = 1; m.metalness = 0;
      if (m.map) {
        m.emissive = new THREE.Color(0xffffff);
        m.emissiveMap = m.map;
        m.emissiveIntensity = 0.55;
      }
      m.needsUpdate = true;
    });

    // fit: center at origin, scale the capture up to fill the room, lift to bench
    const bbox = new THREE.Box3().setFromObject(root);
    const c = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const s = DEFAULT.scaleFill / Math.max(size.x, size.y, size.z);
    state.scale = s;
    // bottom-align to the floor (bbox min.y → y=-78) so the camera isn't buried
    // inside the mesh; center in x and push back in z so it sits behind the bench.
    state.position = [-c.x * s, -bbox.min.y * s - 78, -c.z * s + DEFAULT.zPush];

    state.root = root;
    applyTransform();
    group.add(root);
    state.loaded = true;

    window.__scan = {
      pos: (x, y, z) => { state.position = [x, y, z]; applyTransform(); },
      rot: (x, y, z) => { state.rotation = [x, y, z]; applyTransform(); },
      scale: (v) => { state.scale = v; applyTransform(); },
      get: () => ({ position: state.position, rotation: state.rotation, scale: state.scale }),
      root,
    };
    console.info('[bench-scan] loaded — align with window.__scan.pos/rot/scale');
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
