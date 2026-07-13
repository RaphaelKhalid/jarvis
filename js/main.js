// Orchestrator: creates the scene + core systems, wires the app modules
// together (assembly, hud, input), owns Upload/back transitions + render loop.
import * as THREE from 'three';
import { createScene } from './scene.js';
import { WiringManager } from './wiring.js';
import { initEditor } from './editor.js';
import { loadRapier, loadRobotModel } from './sim.js';
import { createSimBody } from './robots/sim-registry.js';
import { activeRobot, bootActiveRobot } from './robots/index.js';
import { Serial } from './serial.js';
import { audio } from './audio.js';
import { state, set } from './app/state.js';
import { initHud } from './app/hud.js';
import { initGuide } from './app/guide.js';
import { initAssembly, TW_OPEN } from './app/assembly.js';
import { initInput } from './app/input.js';
import { initSave } from './app/save.js';
import { initTouch } from './app/touch.js';
import { initCurriculum } from './curriculum/engine.js';
import { initPerf } from './app/perf.js';
import { initTopbar } from './app/topbar.js';
import { installErrorBoundary, isWebGLAvailable, showFatal } from './app/errors.js';
import { track, trackOnce, EVENTS, initAnalytics } from './app/analytics.js';
import { initAccount } from './app/account.js';
import { pushDocument, pullDocument, flushQueue } from './app/cloud.js';

installErrorBoundary();  // global error/rejection reporting + fatal fallback wiring
initAnalytics();         // attach the PostHog sink (privacy-locked; buffers until ready)
if (!isWebGLAvailable()) {
  // 3D can't run at all — show the friendly fallback instead of a blank canvas.
  showFatal();
  throw new Error('WebGL unavailable — halting boot.');
}

bootActiveRobot();  // resolve persisted robot into state BEFORE any module reads a def
initPerf();   // dev-only FPS/startup HUD (?perf or Alt+P); no-op otherwise
initTopbar(); // product-frame shell: brand, robot name, theme toggle
const serial = new Serial(document.getElementById('serial-log'));

// unlock audio on first interaction (browser autoplay policy)
window.addEventListener('pointerdown', () => audio.resume(), { once: false });

const canvas = document.getElementById('three-canvas');
let sceneBits;
try {
  sceneBits = createScene(canvas);
} catch (e) {
  // context creation can still fail past the capability check (blocklisted GPU,
  // exhausted contexts) — fall back gracefully instead of a half-dead page.
  showFatal();
  throw e;
}
const { renderer, scene, camera, controls, slotMeshes, resize, composer, floorUniforms, assemblyDecor } = sceneBits;

// workshop vs. outdoor (sim) atmosphere — swapped on Upload / back
const WORKSHOP_BG = scene.background.clone();
const WORKSHOP_FOG = { color: scene.fog.color.clone(), near: scene.fog.near, far: scene.fog.far };
const SKY_BG = new THREE.Color(0x8fb0cf);
const SKY_FOG = new THREE.Color(0xd9b98a);

const wiring = new WiringManager(scene, camera, renderer, () => hud.refreshChecklist());
const sim = createSimBody(activeRobot().simKey, scene);
window.__sim = sim;   // debug/testing hook

const controlsLegend = document.getElementById('controls-legend');

// hud is created first with lazy getters into the not-yet-created assembly module
const hud = initHud({
  wiring, sim,
  getPlacedCount: () => (assemblyApi ? assemblyApi.getPlacedCount() : 0),
  getGains: () => state.gains,
  onExitSim: () => exitSim(),
  onGains: (g) => setSketchGains(g),   // live PID sliders write back into the .ino sketch
});
const assemblyApi = initAssembly({ canvas, scene, camera, controls, slotMeshes, wiring, hud });
// education-first Guide rail: always-visible instructions that advance with state
const guide = initGuide({
  wiring, assemblyApi, getGains: () => state.gains,
  onWire: (res, req) => {
    if (res.state === 'valid') { hud.flash(`✓ ${req.label}`, 'ok'); audio.connect(); }
    else if (res.state === 'duplicate') { audio.ui(); }
    track('wire_guided', { label: req.label });
  },
});
const input = initInput({ canvas, sim });
initTouch({ sim });   // no-op on fine-pointer devices

sim.onTelemetry = ({ tiltDeg }) => hud.pushTilt(tiltDeg);

// ── editor ──────────────────────────────────────────────────────
const cm = initEditor(document.getElementById('editor-container'), (g) => {
  set('gains', g);
  sim.setGains(g);
  const gr = document.getElementById('gains-readout');
  if (gr) gr.textContent = `Kp ${g.Kp}  Ki ${g.Ki}  Kd ${g.Kd}`;
  saveApi?.persist();
});

// ── save/load (schema v1, localStorage) ─────────────────────────
const saveApi = initSave({
  assemblyApi, wiring,
  getSketch: () => cm.getValue(),
  setSketch: (s) => cm.setValue(s),
  onPersist: (doc) => { pushDocument('save', doc).catch(() => {}); },   // cloud sync (queued if signed out)
});
// each robot ships its own starter sketch (self-balancer's === the editor
// default). Done after saveApi exists so the editor's change handler, which
// calls saveApi.persist(), isn't hit during the temporal dead zone.
if (activeRobot().sketch) cm.setValue(activeRobot().sketch);
// firmware panel header reflects the active robot's sketch file
{
  const ff = document.getElementById('firmware-file');
  if (ff && activeRobot().sketchFile) ff.textContent = activeRobot().sketchFile;
}
// any checklist refresh (placement, wiring, clear) marks the state dirty
// progressive disclosure: demote the firmware panel until the board is wired,
// so a cold-start user leads with Build → Wire instead of a wall of code.
const rightPanel = document.getElementById('right-panel');
const fwHint = document.getElementById('fw-hint');
function updateFirmwareDisclosure() {
  const demote = state.mode === 'assembly' && !wiring.allRequiredDone();
  rightPanel?.classList.toggle('demoted', demote);
  fwHint?.classList.toggle('hidden', !demote);
}
updateFirmwareDisclosure();

{
  const origRefresh = hud.refreshChecklist;
  hud.refreshChecklist = (...a) => {
    origRefresh(...a);
    guide.refresh();
    saveApi.persist();
    updateFirmwareDisclosure();
    // funnel milestones — first part placed, then all wiring done
    if (assemblyApi.getPlacedCount() > 0) trackOnce(EVENTS.PLACE, { robot: activeRobot().id });
    if (wiring.allRequiredDone()) trackOnce(EVENTS.WIRE, { robot: activeRobot().id });
  };
}

// ── curriculum (Learn mode) ─────────────────────────────────────
function setSketchGains({ Kp, Ki, Kd }) {
  let v = cm.getValue();
  if (Kp != null) v = v.replace(/\bKp\s*=\s*-?\d+(?:\.\d+)?/, `Kp = ${Kp}`);
  if (Ki != null) v = v.replace(/\bKi\s*=\s*-?\d+(?:\.\d+)?/, `Ki = ${Ki}`);
  if (Kd != null) v = v.replace(/\bKd\s*=\s*-?\d+(?:\.\d+)?/, `Kd = ${Kd}`);
  cm.setValue(v);
}
const curriculum = initCurriculum({
  sim, wiring, assemblyApi, hud, setSketchGains, guide,
  onProgress: (p) => { pushDocument('progress', p).catch(() => {}); },   // cloud sync (queued if signed out)
  onUpgrade: (lesson) => {   // Pro CTA — measure intent now; Stripe checkout lands here later
    track('upgrade_click', { lesson: lesson?.id || null });
    hud.flash('GYRO Pro is launching soon — thanks for the interest!', 'ok');
  },
});
// single help/learn surface: the Guide rail. "?" expands it; its own "Lessons"
// button opens the curriculum. (The old floating learn-btn was redundant.)
document.getElementById('help-btn').addEventListener('click', () => guide.expand());
guide.onLessons(() => curriculum.openOverlay());

// ── share build ─────────────────────────────────────────────────
document.getElementById('share-btn').addEventListener('click', async () => {
  if (assemblyApi.getPlacedCount() === 0) { hud.flash('Place some parts first, then share', 'bad'); return; }
  const url = saveApi.shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    hud.flash('Build link copied to clipboard', 'ok');
  } catch {
    // clipboard blocked (insecure context / permissions) — fall back to a prompt
    window.prompt('Copy your shareable build link:', url);
  }
  track(EVENTS.SHARE, { robot: activeRobot().id });
});
window.__lab = { assemblyApi, wiring, curriculum, hud, saveApi };   // debug/testing hook
track(EVENTS.LOAD, { robot: activeRobot().id });   // funnel entry — app booted

// ── cloud account + sync ─────────────────────────────────────────
// On sign-in: pull the cloud progress/save, merge locally (progress = max stars
// per lesson so nothing is lost; save applies only onto an empty board), push
// our local-only state back up, then flush any queued offline writes.
initAccount({
  onSignIn: async () => {
    try {
      const rp = await pullDocument('progress', 0);
      if (rp) curriculum.applyRemoteProgress(rp);
      pushDocument('progress', curriculum.getProgress()).catch(() => {});
      const rs = await pullDocument('save', 0);
      if (rs) saveApi.applyRemote(rs);
      await flushQueue();
      hud.flash('Synced to your account', 'ok');
    } catch { /* sync is best-effort */ }
  },
});

// ── onboarding → Guide rail ─────────────────────────────────────
// The always-on Guide rail replaces the old spotlight tour: both onboarding
// buttons just make sure the rail is open so new users start reading it.
document.getElementById('overlay-start').addEventListener('click', () => guide.expand());
document.getElementById('overlay-tour').addEventListener('click', () => {
  document.getElementById('overlay').classList.add('hidden');
  try { localStorage.setItem('sbl-seen', '1'); } catch {}
  guide.expand();
});

// ── upload / simulation ─────────────────────────────────────────
const uploadBtn = document.getElementById('upload-btn');
const uploadLabel = uploadBtn.querySelector('span');
uploadBtn.addEventListener('click', async () => {
  if (uploadBtn.disabled) return;
  trackOnce(EVENTS.UPLOAD, { robot: activeRobot().id });
  uploadBtn.classList.add('loading');
  uploadLabel.textContent = 'COMPILING…';
  try {
    // physics engine is required; the robot model is best-effort (falls back)
    await Promise.all([loadRapier(), loadRobotModel()]);
    window.__perf?.mark('rapier');
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
    hud.setStatus(activeRobot().simKey === 'balance'
      ? 'Drive with W/A/S/D — the robot balances as it moves'
      : 'Drive with W/A/S/D — steer by driving the two sides');
  });
  hud.enterSimMissions();
  hud.updateStepper();
  guide.refresh();
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
  guide.refresh();
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
    // funnel: DRIVE = the user actually drove (first real WASD/touch input after
    // boot), not merely reaching sim mode — keyboard and touch both feed sim.input.
    if (sim.input && (sim.input.fwd !== 0 || sim.input.turn !== 0)) {
      trackOnce(EVENTS.DRIVE, { robot: activeRobot().id });
    }
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

  curriculum.tick(dt);
  composer.render();
}
animate();
resize();
hud.updateStepper();
