// Three.js scene setup: renderer, camera, lights, chassis plate, slots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SLOTS } from './parts.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  // deep tech-studio backdrop (premium, lets the neon accents & bloom read)
  scene.background = new THREE.Color(0x0e151c);
  scene.fog = new THREE.Fog(0x0e151c, 90, 300);

  // environment map for realistic metal reflections
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

  // ── lights: cool studio key + soft fill, dark enough that emissives glow ──
  scene.add(new THREE.HemisphereLight(0x9fc0e8, 0x0a0f14, 0.55));
  scene.add(new THREE.AmbientLight(0xffffff, 0.18));
  const key = new THREE.DirectionalLight(0xfff2df, 2.2);
  key.position.set(40, 70, 35);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const s = 90;
  key.shadow.camera.left = -s; key.shadow.camera.right = s;
  key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
  key.shadow.camera.far = 240;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x4da3ff, 0.7);
  fill.position.set(-30, 20, -20);
  scene.add(fill);

  // ── grid floor (cyan neon lines on dark) ──
  const grid = new THREE.GridHelper(300, 100, 0x3aa0ff, 0x18465f);
  grid.material.opacity = 0.18;
  grid.material.transparent = true;
  grid.position.y = -0.02;
  scene.add(grid);

  // ── custom shader floor: analytic grid + expanding energy rings ──
  // A GLSL ShaderMaterial (no derivatives, so it runs on WebGL1/2 alike).
  const floorUniforms = { uTime: { value: 0 } };
  const floorMat = new THREE.ShaderMaterial({
    uniforms: floorUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec2 vWorld;
      void main() {
        vWorld = position.xy;                 // plane is XY before rotation
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vWorld;
      uniform float uTime;
      void main() {
        float d = length(vWorld);
        // analytic grid lines every 12 units (no fwidth needed)
        vec2 gr = abs(fract(vWorld / 12.0) - 0.5);
        float line = smoothstep(0.46, 0.5, max(gr.x, gr.y));
        // slow expanding rings radiating from the build platform
        float ring = smoothstep(0.10, 0.0, abs(sin(d * 0.05 - uTime * 1.1))) * 0.6;
        float fade = smoothstep(150.0, 18.0, d);
        vec3 col = mix(vec3(0.11, 0.34, 0.58), vec3(0.35, 0.78, 1.0), ring);
        float a = (line * 0.30 + ring * 0.55) * fade;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  scene.add(floor);

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

  // assembly-only scenery — hidden while the sim's arena is on screen
  const assemblyDecor = [grid, floor, chassis];

  // ── post-processing: bloom makes the emissive accents glow (big fidelity win) ──
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.5, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

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
