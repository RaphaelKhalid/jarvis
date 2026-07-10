// Orchestrator: creates the scene + core systems, wires the app modules
// together (assembly, hud, input), owns Upload/back transitions + render loop.
import * as THREE from 'three';
import { createScene } from './scene.js';
import { WiringManager } from './wiring.js';
import { initEditor } from './editor.js';
import { BalanceSim, loadRapier, loadRobotModel } from './sim.js';
import { Serial } from './serial.js';
import { audio } from './audio.js';
import { state, set } from './app/state.js';
import { initHud } from './app/hud.js';
import { initAssembly, TW_OPEN } from './app/assembly.js';
import { initInput } from './app/input.js';

const serial = new Serial(document.getElementById('serial-log'));

// unlock audio on first interaction (browser autoplay policy)
window.addEventListener('pointerdown', () => audio.resume(), { once: false });

const canvas = document.getElementById('three-canvas');
const { renderer, scene, camera, controls, slotMeshes, resize, composer, floorUniforms, assemblyDecor } = createScene(canvas);

// workshop vs. outdoor (sim) atmosphere — swapped on Upload / back
const WORKSHOP_BG = scene.background.clone();
const WORKSHOP_FOG = { color: scene.fog.color.clone(), near: scene.fog.near, far: scene.fog.far };
const SKY_BG = new THREE.Color(0x8fb0cf);
const SKY_FOG = new THREE.Color(0xd9b98a);

const wiring = new WiringManager(scene, camera, renderer, () => hud.refreshChecklist());
const sim = new BalanceSim(scene);
window.__sim = sim;   // debug/testing hook

const controlsLegend = document.getElementById('controls-legend');

// hud is created first with lazy getters into the not-yet-created assembly module
const hud = initHud({
  wiring, sim,
  getPlacedCount: () => (assemblyApi ? assemblyApi.getPlacedCount() : 0),
  getGains: () => state.gains,
  onExitSim: () => exitSim(),
});
const assemblyApi = initAssembly({ canvas, scene, camera, controls, slotMeshes, wiring, hud });
const input = initInput({ canvas, sim });

sim.onTelemetry = ({ tiltDeg }) => hud.pushTilt(tiltDeg);

// ── editor ──────────────────────────────────────────────────────
initEditor(document.getElementById('editor-container'), (g) => {
  set('gains', g);
  sim.setGains(g);
  const gr = document.getElementById('gains-readout');
  if (gr) gr.textContent = `Kp ${g.Kp}  Ki ${g.Ki}  Kd ${g.Kd}`;
});

// ── upload / simulation ─────────────────────────────────────────
const uploadBtn = document.getElementById('upload-btn');
const uploadLabel = uploadBtn.querySelector('span');
uploadBtn.addEventListener('click', async () => {
  if (uploadBtn.disabled) return;
  uploadBtn.classList.add('loading');
  uploadLabel.textContent = 'COMPILING…';
  try {
    // physics engine is required; the robot model is best-effort (falls back)
    await Promise.all([loadRapier(), loadRobotModel()]);
  } catch {
    hud.flash('Failed to load physics engine', 'bad');
    uploadBtn.classList.remove('loading');
    uploadLabel.textContent = 'UPLOAD';
    return;
  }
  uploadBtn.classList.remove('loading');
  uploadLabel.textContent = 'UPLOAD';
  enterSim();
});

function enterSim() {
  set('mode', 'sim');
  assemblyApi.group.visible = false;
  wiring.setVisible(false);
  for (const d of assemblyDecor) d.visible = false;
  canvas.style.cursor = 'default';
  controlsLegend.classList.add('hidden');
  // outdoor atmosphere for driving
  scene.background = SKY_BG;
  scene.fog.color.copy(SKY_FOG); scene.fog.near = 170; scene.fog.far = 650;
  sim.setGains(state.gains);
  sim.start();
  const p = sim.chassisPos();
  // hand the camera to the chase rig (disable orbit so driving isn't disorienting)
  controls.enabled = false;
  controls.target.copy(p);
  camera.position.set(p.x, p.y + 18, p.z - 46);
  camera.lookAt(p.x, p.y + 4, p.z);
  hud.simHud.classList.remove('hidden');
  hud.setStatus('Booting robot…');
  hud.clearGraph();
  input.clearKeys();
  // power-on bring-up: robot balances while it "boots", driving unlocks after
  set('booting', true);
  audio.boot();
  audio.startMotor();
  serial.boot(state.gains, () => {
    set('booting', false);
    hud.setStatus('Drive with W/A/S/D — the robot balances as it moves');
  });
  hud.enterSimMissions();
  hud.updateStepper();
}

function exitSim() {
  set('mode', 'assembly');
  set('booting', false);
  serial.cancel();
  audio.stopMotor();
  hud.exitSimMissions();
  sim.hide();
  assemblyApi.group.visible = true;
  wiring.setVisible(true);
  for (const d of assemblyDecor) d.visible = true;
  canvas.style.cursor = TW_OPEN;
  controlsLegend.classList.remove('hidden');
  // restore workshop atmosphere
  scene.background = WORKSHOP_BG;
  scene.fog.color.copy(WORKSHOP_FOG.color); scene.fog.near = WORKSHOP_FOG.near; scene.fog.far = WORKSHOP_FOG.far;
  controls.enabled = true;
  controls.target.set(0, 2, 1);
  camera.position.set(18, 20, 26);
  camera.fov = 45; camera.updateProjectionMatrix();
  hud.simHud.classList.add('hidden');
  hud.updateStepper();
}

// ── render loop ─────────────────────────────────────────────────
let last = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;

  if (state.mode === 'assembly') {
    controls.update();
    floorUniforms.uTime.value += dt;
    wiring.animateFlow(dt, wiring.allRequiredDone());
  }

  if (state.mode === 'sim') {
    sim.step(dt);
    // racing chase-cam: trails behind the heading, orbitable with mouse/arrows,
    // pulls back + widens FOV with speed, and looks ahead along travel.
    if (sim.bodies.chassis) {
      const p = sim.chassisPos();
      const spd = sim.driveSpeed || 0;
      const cam = input.cam, camKeys = input.camKeys;
      // arrow-key orbit
      if (camKeys.size) {
        if (camKeys.has('arrowleft')) cam.yaw += 1.6 * dt;
        if (camKeys.has('arrowright')) cam.yaw -= 1.6 * dt;
        if (camKeys.has('arrowup')) cam.elev = THREE.MathUtils.clamp(cam.elev + 1.2 * dt, 0.06, 1.35);
        if (camKeys.has('arrowdown')) cam.elev = THREE.MathUtils.clamp(cam.elev - 1.2 * dt, 0.06, 1.35);
      }
      // gently re-center the yaw behind the bot when not actively looking around
      if (!cam.dragging && !camKeys.size) cam.yaw *= (1 - Math.min(1, 0.6 * dt));
      const a = sim.heading + cam.yaw;
      const fwd = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const dist = (40 + spd * 0.55) * cam.zoom;
      const elev = THREE.MathUtils.clamp(cam.elev, 0.06, 1.35);
      const desired = new THREE.Vector3(
        p.x - fwd.x * dist * Math.cos(elev),
        p.y + dist * Math.sin(elev) + 3,
        p.z - fwd.z * dist * Math.cos(elev));
      const k = 1 - Math.pow(0.002, dt);
      camera.position.lerp(desired, k);
      const head = new THREE.Vector3(Math.sin(sim.heading), 0, Math.cos(sim.heading));
      const look = new THREE.Vector3(p.x + head.x * spd * 0.35, p.y + 4, p.z + head.z * spd * 0.35);
      camera.lookAt(look);
      const targetFov = 46 + Math.min(14, spd * 0.4);
      if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov += (targetFov - camera.fov) * 0.1; camera.updateProjectionMatrix(); }
    }
    hud.simReadouts();
    if (!state.booting) serial.telemetry(sim, now);
    audio.setMotor(sim.speed || 0);
    hud.missionTick(dt);
  }

  composer.render();
}
animate();
resize();
hud.updateStepper();
