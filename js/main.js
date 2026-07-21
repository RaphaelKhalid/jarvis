// Orchestrator: creates the scene + core systems, wires the app modules
// together (assembly, hud, input), owns Upload/back transitions + render loop.
import { createScene } from './scene.js';
import { initEditor } from './editor.js';
import { loadRapier, loadRobotModel } from './sim.js';
import { createSimBody } from './robots/sim-registry.js';
import { activeRobot, bootActiveRobot } from './robots/index.js';
import { audio } from './audio.js';
import { state, set } from './app/state.js';
import { initHud } from './app/hud.js';
import { initCreatorAssembly } from './app/creator-assembly.js';
import { initInput } from './app/input.js';
import { initTouch } from './app/touch.js';
import { createApi } from './api/index.js';
import { emptyDoc } from './model/doc.js';
import { CreatorSim } from './sim/creator-sim.js';
import { initDocSave } from './app/docsave.js';
import { initInspector } from './app/inspector.js';
import { initPerf } from './app/perf.js';
import { initTopbar } from './app/topbar.js';
import { installErrorBoundary, isWebGLAvailable, showFatal } from './app/errors.js';
import { track, trackOnce, EVENTS, initAnalytics } from './app/analytics.js';
import { initAccount } from './app/account.js';
import { initClassroom } from './app/classroom.js';
import { pullDocument, flushQueue, getProfile } from './app/cloud.js';

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
const { scene, camera, controls, resize, composer, floorUniforms, assemblyDecor } = sceneBits;

const sim = createSimBody(activeRobot().simKey, scene);   // legacy balance body (unused in M1; kept for hud refs)
const creatorSim = new CreatorSim(scene);                 // M1 doc-driven motor body
window.__sim = creatorSim;   // debug/testing hook — tests poll motor ω here

const controlsLegend = document.getElementById('controls-legend');

// forward-declared: the fused build surface is created after the API (below),
// but hud/adapters close over it — a null-initialized binding avoids the TDZ.
let assemblyApi = null;

// checklist/stepper adapter: hud reads "wiring status" off the live document
// (the fused assembly is the authority; created just below).
const wiringAdapter = {
  status: () => (assemblyApi ? assemblyApi.wireStatus() : []),
  allRequiredDone: () => (assemblyApi ? assemblyApi.allWired() : false),
};

// hud is created first with lazy getters into the not-yet-created assembly module
const hud = initHud({
  wiring: wiringAdapter, sim,
  getPlacedCount: () => (assemblyApi ? assemblyApi.getPlacedCount() : 0),
  getGains: () => state.gains,
  onExitSim: () => exitSim(),
  onGains: (g) => setSketchGains(g),   // live PID sliders write back into the .ino sketch
});
const input = initInput({ canvas, sim });
initTouch({ sim });   // no-op on fine-pointer devices

sim.onTelemetry = ({ tiltDeg }) => hud.pushTilt(tiltDeg);

// ── editor (firmware panel; inert in M1 — no sketch execution) ──
const cm = initEditor(document.getElementById('editor-container'), (g) => {
  set('gains', g);
  sim.setGains(g);
  const gr = document.getElementById('gains-readout');
  if (gr) gr.textContent = `Kp ${g.Kp}  Ki ${g.Ki}  Kd ${g.Kd}`;
});
// each robot ships its own starter sketch (self-balancer's === the editor
// default). The sketch is inert in M1 (display/parse only, not executed).
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
  const demote = state.mode === 'assembly' && !wiringAdapter.allRequiredDone();
  rightPanel?.classList.toggle('demoted', demote);
  fwHint?.classList.toggle('hidden', !demote);
}
updateFirmwareDisclosure();

{
  const origRefresh = hud.refreshChecklist;
  hud.refreshChecklist = (...a) => {
    origRefresh(...a);
    updateFirmwareDisclosure();
    // funnel milestones — first part placed, then all wiring done
    if (assemblyApi.getPlacedCount() > 0) trackOnce(EVENTS.PLACE, { robot: activeRobot().id });
    if (wiringAdapter.allRequiredDone()) trackOnce(EVENTS.WIRE, { robot: activeRobot().id });
  };
}

// ── live PID sliders → .ino sketch (kept; editor + sim slice) ───
function setSketchGains({ Kp, Ki, Kd }) {
  let v = cm.getValue();
  if (Kp != null) v = v.replace(/\bKp\s*=\s*-?\d+(?:\.\d+)?/, `Kp = ${Kp}`);
  if (Ki != null) v = v.replace(/\bKi\s*=\s*-?\d+(?:\.\d+)?/, `Ki = ${Ki}`);
  if (Kd != null) v = v.replace(/\bKd\s*=\s*-?\d+(?:\.\d+)?/, `Kd = ${Kd}`);
  cm.setValue(v);
}

// ── scriptable API (window.__api) — the single mutation authority ─
// UI actions and tests both drive this; the DOM layer holds no mutation logic.
const api = createApi({
  doc: emptyDoc(state.activeRobotId),
  hooks: {
    // any document change (drag, wire, clear, undo, redo, a script, a #build=
    // load) re-syncs the 3D view — the doc is the single source of truth.
    onDocChange: () => { assemblyApi?.sync(); },
    sim: {
      run: () => enterSim(),
      stop: () => exitSim(),
      reset: () => sim.reset?.(),
      running: () => state.mode === 'sim',
    },
    telemetry: () => {
      // M1 telemetry is the creator body's per-motor ω (Inspector readout).
      const t = creatorSim.telemetry ? creatorSim.telemetry() : {};
      const omega = {};
      for (const id in t) omega[id] = t[id].omega;
      return { omega };
    },
  },
});
window.__api = api;
// the fused build surface: placement + wiring as a pure view over api.get_document().
// Created after the API so its onDocChange → sync loop is wired both ways.
assemblyApi = initCreatorAssembly({ canvas, scene, camera, controls, api, hud });
// live ω from the running sim → the solver's back-EMF input (Inspector readout)
creatorSim.onOmega((tel) => api.setSimState(tel));
// RobotDoc v2 persistence + shareable #build= link (v1 saves migrate on load)
const docSave = initDocSave(api, { onFlash: (m, k) => hud.flash(m, k) });
// Inspector: read-only DOM view of the live document + electrical solve (the M1
// replacement for the Guide rail). Polls the API; owns no state of its own.
initInspector(api, { getMode: () => state.mode });

document.getElementById('help-btn')?.addEventListener('click', () => {
  document.getElementById('overlay')?.classList.remove('hidden');
});

// ── share build ─────────────────────────────────────────────────
document.getElementById('share-btn').addEventListener('click', async () => {
  if (api.get_document().components.length === 0) { hud.flash('Place some parts first, then share', 'bad'); return; }
  const url = docSave.shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    hud.flash('Build link copied to clipboard', 'ok');
  } catch {
    // clipboard blocked (insecure context / permissions) — fall back to a prompt
    window.prompt('Copy your shareable build link:', url);
  }
  track(EVENTS.SHARE, { robot: activeRobot().id });
});

// ── minimizable panels (tray + firmware): collapse to their header so the 3D
// workspace can take the whole screen (especially on phones) ──
for (const btn of document.querySelectorAll('.panel-min')) {
  btn.addEventListener('click', () => document.getElementById(btn.dataset.panel)?.classList.toggle('min'));
}
window.__lab = { assemblyApi, api, hud };   // debug/testing hook
track(EVENTS.LOAD, { robot: activeRobot().id });   // funnel entry — app booted

// ── cloud account + sync ─────────────────────────────────────────
// Lesson/progress sync was removed in the pivot; only the build document
// (kind:'save') syncs now. profiles.tier is still read (Jarvis quota later).
// The classroom shell stays dormant (teams/edu payer path).
const classroom = initClassroom();
const account = initAccount({
  onClassroom: () => classroom.open(),
  onSignOut: () => {},
  onSignIn: async () => {
    try {
      const prof = await getProfile();
      account.setTier((prof && prof.tier) || 'free');
      // pull the build document (kind:'save'); load it if it's a v2 RobotDoc
      const rs = await pullDocument('save', 0);
      if (rs && rs.v === 2 && Array.isArray(rs.components)) api.loadDocument(rs);
      await flushQueue();
      hud.flash('Synced to your account', 'ok');
    } catch { /* sync is best-effort */ }
  },
});

// ── onboarding overlay ──────────────────────────────────────────
function dismissOverlay() {
  document.getElementById('overlay')?.classList.add('hidden');
  try { localStorage.setItem('sbl-seen', '1'); } catch {}
}
document.getElementById('overlay-start')?.addEventListener('click', dismissOverlay);
document.getElementById('overlay-tour')?.addEventListener('click', dismissOverlay);

// ── upload / simulation ─────────────────────────────────────────
const uploadBtn = document.getElementById('upload-btn');
const uploadLabel = uploadBtn.querySelector('span');
uploadBtn.addEventListener('click', async () => {
  if (uploadBtn.disabled) return;
  trackOnce(EVENTS.UPLOAD, { robot: activeRobot().id });
  uploadBtn.classList.add('loading');
  uploadLabel.textContent = 'COMPILING…';
  await enterSim();   // loads Rapier + builds the doc-driven body
  uploadBtn.classList.remove('loading');
  uploadLabel.textContent = 'UPLOAD';
});

// M1 Run: build the doc-driven motor body from the current document and spin it
// from the solved circuit. Async (Rapier + build), so run_sim from tests fires
// this and the test polls ω until it climbs.
let entering = false;
async function enterSim() {
  if (state.mode === 'sim' || entering) return;
  entering = true;
  try {
    await Promise.all([loadRapier(), loadRobotModel().catch(() => {})]);
    window.__perf?.mark('rapier');
    await creatorSim.build(api.get_document());
  } catch {
    hud.flash('Failed to start the simulation', 'bad');
    entering = false;
    return;
  }
  set('mode', 'sim');
  assemblyApi.group.visible = false;   // hides parts + wires (both live under the group)
  for (const d of assemblyDecor) d.visible = false;
  canvas.style.cursor = 'default';
  controlsLegend.classList.add('hidden');
  creatorSim.reset();
  creatorSim.start();
  // frame the wheels
  controls.enabled = false;
  camera.position.set(14, 12, 20);
  camera.lookAt(0, 6, 0);
  hud.simHud.classList.remove('hidden');
  hud.setStatus('Running — motor speed follows the solved circuit');
  input.clearKeys();
  audio.startMotor();
  hud.updateStepper();
  entering = false;
}

function exitSim() {
  set('mode', 'assembly');
  set('booting', false);
  audio.stopMotor();
  creatorSim.hide();
  assemblyApi.group.visible = true;
  for (const d of assemblyDecor) d.visible = true;
  canvas.style.cursor = 'crosshair';
  controlsLegend.classList.remove('hidden');
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
    assemblyApi.animate(dt);   // current-flow charges along wired nets
  }

  if (state.mode === 'sim') {
    creatorSim.step(dt);
    // motor hum tracks the fastest wheel's ω
    let wmax = 0;
    for (const m of creatorSim.motors) wmax = Math.max(wmax, Math.abs(creatorSim.omega(m.id)));
    audio.setMotor(wmax * 0.3);
    camera.lookAt(0, 6, 0);
  }

  composer.render();
}
animate();
resize();
hud.updateStepper();
