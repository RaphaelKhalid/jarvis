// Three.js scene setup: renderer, camera, lights, chassis plate, slots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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

  // ── custom shader floor: a dark-wood workbench surface ──
  // GLSL ShaderMaterial (no derivatives, so it runs on WebGL1/2 alike):
  // repeating planks with darker seams + procedural grain streaks, warm-lit and
  // fading to darkness at the edges so it feels like a bench in a dim workshop.
  const floorUniforms = { uTime: { value: 0 } };
  const floorMat = new THREE.ShaderMaterial({
    uniforms: floorUniforms,
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
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      // value noise for organic grain
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x),
                   mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        // staggered planks: run along X, 14 wide, 110 long with per-row offset
        float plankW = 14.0, plankL = 110.0;
        float row = floor(vWorld.y / plankW);
        float xOff = hash(row) * plankL;             // stagger the end joints
        float colId = floor((vWorld.x + xOff) / plankL);
        float rj = hash(row * 7.0 + colId * 13.0) - 0.5;   // per-plank tone

        // layered wood grain: long streaks + fine fibers + soft blotches
        float streak = sin(vWorld.x * 0.55 + row * 9.0
                      + vnoise(vec2(vWorld.x * 0.05, row)) * 9.0) * 0.5 + 0.5;
        float fiber = vnoise(vec2(vWorld.x * 1.4, vWorld.y * 6.0)) * 0.5;
        float blotch = vnoise(vec2(vWorld.x * 0.06, vWorld.y * 0.06));
        float grain = streak * 0.55 + fiber * 0.25 + blotch * 0.35;

        // seams: between rows and at staggered plank ends
        float seamY = smoothstep(0.5, 0.465, abs(fract(vWorld.y / plankW) - 0.5));
        float seamX = smoothstep(0.5, 0.485, abs(fract((vWorld.x + xOff) / plankL) - 0.5));
        float seam = max(seamY, seamX);

        vec3 dark  = vec3(0.13, 0.075, 0.038);
        vec3 light = vec3(0.34, 0.205, 0.105);
        vec3 col = mix(dark, light, clamp(grain * 0.8 + 0.1 + rj * 0.16, 0.0, 1.0));
        col *= mix(1.0, 0.42, seam);

        // warm lamp pool over the bench + gentle falloff (floor stays visible)
        float d = length(vWorld);
        float pool = smoothstep(120.0, 0.0, d);
        col *= 0.55 + 0.75 * pool;
        col = mix(col, col * vec3(1.06, 1.0, 0.9), pool * 0.6);   // warmth in the pool
        col *= smoothstep(320.0, 90.0, d) * 0.85 + 0.15;          // distant falloff
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
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
  scene.add(chassis);

  // ── workshop backdrop dome: warm horizon glow, amber walls, dim ceiling ──
  // Reads as a lamplit room instead of a black void, at any camera angle.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(420, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uCeil:    { value: new THREE.Color(0x1d1610) },   // dim warm ceiling
        uWall:    { value: new THREE.Color(0x3a2818) },   // amber wall band
        uHorizon: { value: new THREE.Color(0x6b4520) },   // lamplight glow
        uFloor:   { value: new THREE.Color(0x0d0805) },   // below the bench
      },
      vertexShader: /* glsl */`
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec3 vPos;
        uniform vec3 uCeil; uniform vec3 uWall; uniform vec3 uHorizon; uniform vec3 uFloor;
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec3 n = normalize(vPos);
          float h = n.y;
          // horizon glow band -> warm walls -> dim ceiling; dark under the floor
          vec3 col = mix(uHorizon, uWall, smoothstep(0.02, 0.35, h));
          col = mix(col, uCeil, smoothstep(0.35, 0.9, h));
          col = mix(uFloor, col, smoothstep(-0.12, 0.02, h));
          // subtle large-scale mottling so the walls aren't flat
          float m = hash2(floor(n.xz * 8.0 + 31.0)) * 0.5 + hash2(floor(n.xy * 5.0)) * 0.5;
          col *= 0.92 + 0.16 * m;
          // faint extra glow toward the lamp side
          col *= 1.0 + 0.25 * max(0.0, n.z) * (1.0 - abs(h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
  scene.add(sky);

  // ── slot ghosts (highlighted during drag) ──
  const slotMeshes = {};
  for (const slot of SLOTS) {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(slot.w, slot.d),
      new THREE.MeshBasicMaterial({
        color: 0xffb257, transparent: true, opacity: 0, side: THREE.DoubleSide,
      })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set(slot.x, 0.06, slot.z);
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.6, 0.92);
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
