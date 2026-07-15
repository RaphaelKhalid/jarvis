// Three.js scene setup: renderer, camera, lights, chassis plate, slots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { activeRobot } from './robots/index.js';
import { isLowQuality } from './app/quality.js';

// Vertical lift applied to the assembly rig (chassis deck, parts, slot ghosts)
// so the motors' wheels rest on the workbench floor instead of clipping through
// it. Shared with js/app/assembly.js so parts and deck lift together.
export const ASSEMBLY_LIFT = 2.1;

export function createScene(canvas) {
  const lowQ = isLowQuality();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowQ });
  // pixel ratio is the biggest GPU lever and also drives the bloom pass's
  // internal resolution — cap it lower on weak devices.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowQ ? 1 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  // cozy wood-workshop backdrop — warm, dim, natural
  scene.background = new THREE.Color(0x140d07);
  scene.fog = new THREE.Fog(0x140d07, 70, 260);

  // Warm, dim environment for reflections: a dark room lit by a single warm
  // ceiling lamp — metals pick up a soft amber sheen instead of a blown-out
  // studio highlight. Built procedurally so we fully control its brightness.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x0d0805);
  const envRoom = new THREE.Mesh(
    new THREE.BoxGeometry(40, 26, 40),
    new THREE.MeshBasicMaterial({ color: 0x241609, side: THREE.BackSide }));
  envScene.add(envRoom);
  const envLamp = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshBasicMaterial({ color: 0xffca7a }));
  envLamp.position.set(0, 12.8, 0);
  envLamp.rotation.x = Math.PI / 2;
  envScene.add(envLamp);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.5).texture;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(18, 20, 26);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 2, 1);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 8;
  controls.maxDistance = 140;

  // ── lights: warm workshop lamp key + dim amber fill ──
  // hemisphere: warm light from above, wood-brown bounce from the bench below
  scene.add(new THREE.HemisphereLight(0xffdca8, 0x1a0f06, 0.45));
  scene.add(new THREE.AmbientLight(0xffe4c0, 0.12));
  // key = a hanging workshop lamp: warm orange, angled like an overhead bulb
  const key = new THREE.DirectionalLight(0xffb060, 2.4);
  key.position.set(24, 60, 30);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const s = 90;
  key.shadow.camera.left = -s; key.shadow.camera.right = s;
  key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
  key.shadow.camera.far = 240;
  key.shadow.bias = -0.0004;
  scene.add(key);
  // soft warm fill from the other side so shadows aren't black
  const fill = new THREE.DirectionalLight(0xffa866, 0.5);
  fill.position.set(-30, 22, -18);
  scene.add(fill);
  // a warm point light for a pool of lamplight over the bench
  const lamp = new THREE.PointLight(0xffb673, 90, 120, 2.0);
  lamp.position.set(0, 26, 6);
  scene.add(lamp);

  // ── PBR wood-plank workbench floor (real CC0 PolyHaven texture set) ──
  // A lit MeshStandardMaterial so the floor takes the same warm key light,
  // casts/receives shadows, and blooms consistently with the bench and parts —
  // the old unlit shader floor read as fake next to the lit geometry.
  // floorUniforms kept as a harmless stub so main.js's uTime tick stays valid.
  const floorUniforms = { uTime: { value: 0 } };
  const texLoader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const FLOOR_SIZE = 500;
  const FLOOR_TILE = 150;                       // world units covered by one texture tile (~1 plank run)
  const repeat = FLOOR_SIZE / FLOOR_TILE;
  function loadFloorTex(url, srgb) {
    const t = texLoader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const floorMat = new THREE.MeshStandardMaterial({
    map:          loadFloorTex('assets/textures/wood_floor_diff.jpg', true),
    normalMap:    loadFloorTex('assets/textures/wood_floor_nor.png', false),
    roughnessMap: loadFloorTex('assets/textures/wood_floor_rough.jpg', false),
    roughness: 0.85, metalness: 0.0,
    normalScale: new THREE.Vector2(0.75, 0.75),
    color: 0xcabfa6,                            // desaturated tan so the warm key light doesn't push the planks fully red
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  floor.receiveShadow = true;
  scene.add(floor);

  // ── mounting deck the robot is built on (layered, product-looking) ──
  const chassis = new THREE.Group();
  // wooden base board (slightly larger, gives a warm border)
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.6, 28),
    new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.78, metalness: 0.04 }));
  board.position.y = -0.55;
  board.receiveShadow = true; board.castShadow = true;
  chassis.add(board);
  // brushed dark-metal deck the parts actually sit on (top at y≈0)
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.4, 26),
    new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.42, metalness: 0.82 }));
  deck.position.y = -0.2;
  deck.receiveShadow = true; deck.castShadow = true;
  chassis.add(deck);
  // brass edge trim (a frame, so it doesn't cover the mounting surface)
  const brass = new THREE.MeshStandardMaterial({ color: 0xc0902f, roughness: 0.33, metalness: 0.88 });
  for (const [w, d, x, z] of [[16.5, 0.4, 0, 13], [16.5, 0.4, 0, -13], [0.4, 26.5, 8, 0], [0.4, 26.5, -8, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), brass);
    bar.position.set(x, 0.0, z);
    chassis.add(bar);
  }
  // brass corner bolts
  for (const bx of [-7.4, 7.4]) for (const bz of [-12.4, 12.4]) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 12), brass);
    bolt.position.set(bx, 0.06, bz);
    chassis.add(bolt);
  }
  // lift the whole rig so the motors' wheels (which hang ~2 units below their
  // mount and off the deck edges) rest on the workbench floor instead of
  // clipping through it. Assembly parts + slot ghosts lift by the same amount.
  chassis.position.y = ASSEMBLY_LIFT;
  scene.add(chassis);

  // ── backdrop sky dome: the same sunset panorama the sim uses, so the build
  // view shares the outdoor look (toneMapped:false — it's a finished image). ──
  const skyTex = new THREE.TextureLoader().load('assets/textures/sky_06_2k.png');
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyTex.wrapS = THREE.RepeatWrapping;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 60, 40),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
  scene.add(sky);

  // ── slot ghosts (highlighted during drag) ──
  const slotMeshes = {};
  for (const slot of activeRobot().slots) {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(slot.w, slot.d),
      new THREE.MeshBasicMaterial({
        color: 0xffb257, transparent: true, opacity: 0, side: THREE.DoubleSide,
      })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set(slot.x, 0.06 + ASSEMBLY_LIFT, slot.z);
    g.userData.slot = slot;
    scene.add(g);
    slotMeshes[slot.id] = g;
  }

  // assembly-only scenery — hidden while the sim's arena is on screen
  const assemblyDecor = [floor, chassis, sky];

  // ── post-processing: bloom makes the emissive accents glow (big fidelity win) ──
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // higher threshold so only genuinely bright emissives glow — lit metal and
  // wood no longer bloom into white hotspots.
  // soften bloom slightly on low-quality devices (cheaper, still glows)
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), lowQ ? 0.38 : 0.5, lowQ ? 0.5 : 0.6, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // SMAA anti-aliasing — display-space, so it goes AFTER OutputPass. The composer
  // renders to a non-MSAA target, so without this the emissive/bloom edges shimmer
  // (the single loudest "unfinished 3D" tell). Cheap enough to run on both tiers.
  const smaa = new SMAAPass(1, 1);
  composer.addPass(smaa);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera, controls, slotMeshes, resize, composer, floorUniforms, assemblyDecor };
}
