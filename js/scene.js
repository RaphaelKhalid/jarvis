// Three.js scene setup: renderer, camera, lights, chassis plate, slots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SLOTS } from './parts.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  // bright open sky
  scene.background = new THREE.Color(0xbfe0ff);
  scene.fog = new THREE.Fog(0xbfe0ff, 120, 320);

  // environment map for realistic metal/chrome reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(18, 20, 26);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 2, 1);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 8;
  controls.maxDistance = 140;

  // ── lights: bright, sunny, open ──
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x8a9a6a, 1.15));
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xfff6e6, 2.0);
  key.position.set(40, 70, 35);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const s = 90;
  key.shadow.camera.left = -s; key.shadow.camera.right = s;
  key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
  key.shadow.camera.far = 240;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfe0ff, 0.6);
  fill.position.set(-30, 20, -20);
  scene.add(fill);

  // ── grid floor (subtle, light) ──
  const grid = new THREE.GridHelper(300, 100, 0xffffff, 0xa9c6d8);
  grid.material.opacity = 0.25;
  grid.material.transparent = true;
  grid.position.y = -0.02;
  scene.add(grid);

  // ── chassis plate ──
  const chassis = new THREE.Group();
  const plateGeo = new THREE.BoxGeometry(16, 0.5, 26);
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f3a, roughness: 0.5, metalness: 0.4,
  });
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.y = -0.25;
  plate.receiveShadow = true;
  plate.castShadow = true;
  chassis.add(plate);
  // deck edge accent
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(16.4, 0.12, 26.4),
    new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x123049, roughness: 0.4 })
  );
  edge.position.y = 0.02;
  chassis.add(edge);
  scene.add(chassis);

  // ── slot ghosts (highlighted during drag) ──
  const slotMeshes = {};
  for (const slot of SLOTS) {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(slot.w, slot.d),
      new THREE.MeshBasicMaterial({
        color: 0x4da3ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
      })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set(slot.x, 0.06, slot.z);
    g.userData.slot = slot;
    scene.add(g);
    slotMeshes[slot.id] = g;
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera, controls, slotMeshes, resize };
}
