// Orchestrator: tray + drag-to-slot, raycasting, wiring, editor, sim, HUD.
import * as THREE from 'three';
import { createScene } from './scene.js';
import { PART_DEFS, SLOTS, makeMotor } from './parts.js';
import { WiringManager, suggestFor } from './wiring.js';
import { initEditor } from './editor.js';
import { BalanceSim, loadRapier, loadRobotModel } from './sim.js';
import { pinInfo, connectionBlurb } from './glossary.js';
import { Serial } from './serial.js';
import { audio } from './audio.js';
import { makeMissions } from './missions.js';

const serial = new Serial(document.getElementById('serial-log'));
let booting = false;

// unlock audio on first interaction (browser autoplay policy)
window.addEventListener('pointerdown', () => audio.resume(), { once: false });
// sound toggle
const soundBtn = document.getElementById('sound-btn');
function renderSoundBtn() {
  soundBtn.classList.toggle('muted', !audio.enabled);
  soundBtn.innerHTML = `<i data-lucide="${audio.enabled ? 'volume-2' : 'volume-x'}"></i>`;
  try { window.lucide?.createIcons(); } catch {}
}
soundBtn.addEventListener('click', () => { audio.resume(); audio.setEnabled(!audio.enabled); renderSoundBtn(); });
renderSoundBtn();

const KIND_LABEL = { power: 'POWER', ground: 'GROUND', data: 'SIGNAL' };
function pinTooltipHtml(id) {
  const info = pinInfo(id);
  if (!info) return `<b>${id}</b>`;
  const tag = KIND_LABEL[info.kind] || '';
  return `<span class="tt-tag tt-${info.kind}">${tag}</span><b>${info.title}</b>` +
         `<div class="tt-role">${info.role}</div>` +
         `<span class="unit">${id}</span>`;
}

const canvas = document.getElementById('three-canvas');
const { renderer, scene, camera, controls, slotMeshes, resize, composer, floorUniforms, assemblyDecor } = createScene(canvas);

const assembly = new THREE.Group();
scene.add(assembly);

// workshop vs. outdoor (sim) atmosphere — swapped on Upload / back
const WORKSHOP_BG = scene.background.clone();
const WORKSHOP_FOG = { color: scene.fog.color.clone(), near: scene.fog.near, far: scene.fog.far };
const SKY_BG = new THREE.Color(0x8fb0cf);
const SKY_FOG = new THREE.Color(0xd9b98a);

const wiring = new WiringManager(scene, camera, renderer, refreshChecklist);
const sim = new BalanceSim(scene);
window.__sim = sim;   // debug/testing hook

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');
const hudStatus = document.getElementById('hud-status');

const placed = {};          // slotId -> { group, compType }
const usedTypes = new Set();
let mode = 'assembly';      // 'assembly' | 'sim'

// ── tweezers cursor (open normally, closes while right-dragging the view) ──
const tweezersSvg = (dx) => `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>` +
  `<path d='M16 6 L${10 + dx} 29 M16 6 L${22 - dx} 29' fill='none' stroke='#000' stroke-width='5' stroke-linecap='round' opacity='0.5'/>` +
  `<path d='M16 6 L${10 + dx} 29 M16 6 L${22 - dx} 29' fill='none' stroke='#eef3fb' stroke-width='2.3' stroke-linecap='round'/>` +
  `<circle cx='16' cy='5' r='2.5' fill='#eef3fb' stroke='#000' stroke-width='1'/></svg>`;
const TW_OPEN = `url("data:image/svg+xml,${encodeURIComponent(tweezersSvg(0))}") 16 28, crosshair`;
const TW_CLOSED = `url("data:image/svg+xml,${encodeURIComponent(tweezersSvg(5))}") 16 28, grabbing`;
canvas.style.cursor = TW_OPEN;
const controlsLegend = document.getElementById('controls-legend');
canvas.addEventListener('pointerdown', (e) => {
  if (mode === 'assembly' && e.button === 2) canvas.style.cursor = TW_CLOSED;
});
window.addEventListener('pointerup', (e) => {
  if (mode === 'assembly' && e.button === 2) canvas.style.cursor = TW_OPEN;
});

// ── build parts tray ────────────────────────────────────────────
const tray = document.getElementById('parts-tray');
const cardByType = {};
for (const def of PART_DEFS) {
  const card = document.createElement('div');
  card.className = 'part-card';
  card.dataset.type = def.type;
  card.innerHTML = `
    <div class="part-name"><span class="part-swatch" style="background:${def.swatch}"></span>${def.name}</div>
    <div class="part-desc">${def.desc}</div>
    ${def.count > 1 ? `<span class="count-badge" data-remaining>×${def.count}</span>` : ''}
    <span class="help-icon" title="">?</span>`;
  tray.appendChild(card);
  cardByType[def.type] = card;

  const help = card.querySelector('.help-icon');
  help.addEventListener('mouseenter', (e) => showTooltip(e, def.help));
  help.addEventListener('mouseleave', hideTooltip);
  help.addEventListener('mousemove', moveTooltip);

  card.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('help-icon')) return;
    if (mode !== 'assembly') return;
    startDrag(def, e);
  });
}

// ── remaining counts ────────────────────────────────────────────
const placedCount = {};
function remainingFor(type) {
  const def = PART_DEFS.find(d => d.type === type);
  return def.count - (placedCount[type] || 0);
}
function updateCardState(type) {
  const def = PART_DEFS.find(d => d.type === type);
  const card = cardByType[type];
  const rem = remainingFor(type);
  const badge = card.querySelector('[data-remaining]');
  if (badge) badge.textContent = `×${rem}`;
  if (rem <= 0) card.classList.add('depleted');
}

// ── drag-to-place ───────────────────────────────────────────────
let drag = null;   // { def, ghostEl }
function startDrag(def, e) {
  if (remainingFor(def.type) <= 0) return;
  const ghost = document.createElement('div');
  ghost.className = 'part-card';
  ghost.style.cssText =
    'position:fixed;z-index:200;pointer-events:none;opacity:0.85;width:200px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  ghost.innerHTML = `<div class="part-name"><span class="part-swatch" style="background:${def.swatch}"></span>${def.name}</div>`;
  document.body.appendChild(ghost);
  drag = { def, ghost };
  highlightSlots(def.type, true);
  moveGhost(e);
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
}
function moveGhost(e) {
  if (!drag) return;
  drag.ghost.style.left = (e.clientX + 14) + 'px';
  drag.ghost.style.top = (e.clientY - 10) + 'px';
}
function onDragMove(e) { moveGhost(e); }
function onDragEnd(e) {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  const def = drag.def;
  drag.ghost.remove();
  highlightSlots(def.type, false);
  drag = null;

  const rect = canvas.getBoundingClientRect();
  const overCanvas = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (overCanvas) placePart(def);
}

// which slots accept this card type (motor -> both motor slots)
function slotsForType(type) {
  if (type === 'motor') return SLOTS.filter(s => s.accepts === 'motorL' || s.accepts === 'motorR');
  return SLOTS.filter(s => s.accepts === type);
}
function highlightSlots(type, on) {
  for (const slot of slotsForType(type)) {
    if (placed[slot.id]) continue;
    slotMeshes[slot.id].material.opacity = on ? 0.28 : 0;
  }
}

function placePart(def) {
  const freeSlot = slotsForType(def.type).find(s => !placed[s.id]);
  if (!freeSlot) return;

  let group;
  let compType = freeSlot.accepts;   // e.g. motorL / motorR / arduino ...
  if (def.type === 'motor') {
    group = makeMotor(freeSlot.side);
  } else {
    group = def.make();
  }
  group.position.set(freeSlot.x, 0.3, freeSlot.z);
  group.rotation.y = freeSlot.ry;
  assembly.add(group);

  // drop-in animation
  group.position.y = 6;
  const t0 = performance.now();
  (function fall() {
    const k = Math.min(1, (performance.now() - t0) / 350);
    group.position.y = 6 - (6 - 0.3) * (1 - (1 - k) * (1 - k));
    if (k < 1) requestAnimationFrame(fall);
  })();

  audio.place();
  placed[freeSlot.id] = { group, compType };
  placedCount[def.type] = (placedCount[def.type] || 0) + 1;
  usedTypes.add(compType);
  updateCardState(def.type);

  wiring.registerComponent(group, compType);
  slotMeshes[freeSlot.id].material.opacity = 0;

  const n = Object.keys(placed).length;
  if (n >= 2) {
    wiring.enabled = true;
    hudStatus.textContent = 'Click a pin, then click its target pin to wire them';
  } else {
    hudStatus.textContent = 'Keep placing parts…';
  }
  refreshChecklist();
}

// ── auto-assemble + auto-wire ───────────────────────────────────
import { REQUIRED } from './wiring.js';

let autoBusy = false;

function autoAssemble() {
  for (const def of PART_DEFS) {
    let guard = 0;
    while (remainingFor(def.type) > 0 && guard++ < 4) placePart(def);
  }
}

function wireAllInstant() {
  for (const r of REQUIRED) {
    const exists = wiring.wires.some(w => w.req && w.req.label === r.label);
    if (!exists) wiring.tryConnect(r.a, r.b);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function autoWire(stepByStep) {
  if (autoBusy || mode !== 'assembly') return;
  autoBusy = true;
  autoInstant.disabled = autoStep.disabled = true;
  try {
    if (stepByStep) {
      // place parts one-by-one, then draw wires with a beat between each
      for (const def of PART_DEFS) {
        let guard = 0;
        while (remainingFor(def.type) > 0 && guard++ < 4) {
          placePart(def);
          await sleep(320);
        }
      }
      await sleep(300);
      for (const r of REQUIRED) {
        const exists = wiring.wires.some(w => w.req && w.req.label === r.label);
        if (!exists) { wiring.tryConnect(r.a, r.b); flash(`✓ ${r.label}`, 'ok'); }
        await sleep(260);
      }
    } else {
      autoAssemble();
      wireAllInstant();
    }
  } finally {
    // always re-enable, even if placing/wiring threw (e.g. board cleared mid-run)
    autoBusy = false;
    autoInstant.disabled = autoStep.disabled = false;
    refreshChecklist();
  }
}

const autoInstant = document.getElementById('auto-instant');
const autoStep = document.getElementById('auto-step');
autoInstant.addEventListener('click', () => autoWire(false));
autoStep.addEventListener('click', () => autoWire(true));

// ── raycasting: pins & wires ────────────────────────────────────
function updatePointer(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

let hoveredWire = null;
canvas.addEventListener('pointermove', (e) => {
  if (mode !== 'assembly') return;
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);

  // wire hover
  const wireHit = raycaster.intersectObjects(wiring.wireMeshes(), false)[0];
  if (hoveredWire && (!wireHit || wireHit.object !== hoveredWire)) {
    wiring.setWireHover(hoveredWire, false);
    hoveredWire = null;
    hideTooltip();
  }
  if (wireHit && wireHit.object !== hoveredWire) {
    hoveredWire = wireHit.object;
    wiring.setWireHover(hoveredWire, true);
    const w = hoveredWire.userData.wire;
    if (w.valid) showTooltip(e, `<span class="tt-tag tt-${w.kind}">✓ ${KIND_LABEL[w.kind] || ''}</span><b>${w.req.label}</b><div class="tt-role">${connectionBlurb(w.req)}</div>`);
    else {
      const want = suggestFor(w.idA) || suggestFor(w.idB);
      const wantTxt = want ? ` — should go to ${want.split('.')[1]}` : '';
      showTooltip(e, `✗ wrong pin${wantTxt}`, true);
    }
  }
  if (hoveredWire) { moveTooltip(e); hoveredPinId = null; return; }

  // pin hover: explain what the pin means (works as soon as parts are placed)
  const pinHit = pickPin();
  // disable orbit over a pin (or mid-drag) so a press starts a wire, not a rotate
  controls.enabled = !pinHit && !(wireDrag && wireDrag.moved);
  if (pinHit) {
    const id = pinHit.userData.endpointId;
    if (id !== hoveredPinId) { hoveredPinId = id; showTooltip(e, pinTooltipHtml(id)); }
    else moveTooltip(e);
  } else { hidePinTip(); }
});

let hoveredPinId = null;
function hidePinTip() {
  if (hoveredPinId) { hoveredPinId = null; hideTooltip(); }
}

// leaving the canvas entirely: clear any hover state + tooltip so it can't stick
canvas.addEventListener('pointerleave', () => {
  if (hoveredWire) { wiring.setWireHover(hoveredWire, false); hoveredWire = null; }
  hoveredPinId = null;
  hideTooltip();
  if (mode === 'assembly' && !wireDrag) controls.enabled = true;
});

canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'assembly' || !wiring.enabled) return;
  if (e.button === 2 && hoveredWire) {         // right-click deletes a wire
    wiring.removeWire(hoveredWire);
    hoveredWire = null;
    audio.ui();
    e.preventDefault();
    return;
  }
});
canvas.addEventListener('click', (e) => {
  if (mode !== 'assembly' || !wiring.enabled) return;
  if (suppressClick) { suppressClick = false; return; }   // handled by a drag-connect
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const pin = pickPin();
  if (!pin) return;
  const id = pin.userData.endpointId;
  const res = wiring.handlePinClick(id);
  if (res.state === 'armed') { hudStatus.textContent = `Selected ${id} — now click its target`; audio.ui(); }
  else connectFeedback(res);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// shared connect feedback (used by click-to-wire and drag-to-wire)
function connectFeedback(res) {
  if (res.state === 'valid') { flash(`✓ ${res.label}`, 'ok'); audio.connect(); }
  else if (res.state === 'invalid') {
    const want = res.suggestion ? ` — ${res.idA.split('.')[1]} should go to ${res.suggestion}` : '';
    flash(`✗ wrong pin${want}`, 'bad'); audio.error();
  } else if (res.state === 'duplicate') { flash('already wired', 'bad'); audio.error(); }
}

// ── drag-to-wire: press a pin, drag to its target, release ──
let wireDrag = null;          // { fromId, sx, sy, moved, line }
let suppressClick = false;
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'assembly' || e.button !== 0 || !wiring.enabled) return;
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const pin = pickPin();
  if (!pin) return;
  wireDrag = { fromId: pin.userData.endpointId, sx: e.clientX, sy: e.clientY, moved: false, line: null };
});
canvas.addEventListener('pointermove', (e) => {
  if (!wireDrag) return;
  if (!wireDrag.moved && Math.hypot(e.clientX - wireDrag.sx, e.clientY - wireDrag.sy) > 5) wireDrag.moved = true;
  if (wireDrag.moved) updateWirePreview(e);
});
window.addEventListener('pointerup', (e) => {
  if (!wireDrag) return;
  const wd = wireDrag; wireDrag = null;
  if (wd.line) { scene.remove(wd.line); wd.line.geometry.dispose(); }
  if (wd.moved) {
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const pin = pickPin();
    if (pin && pin.userData.endpointId !== wd.fromId) {
      wiring.highlightPin(wd.fromId, false);
      connectFeedback(wiring.tryConnect(wd.fromId, pin.userData.endpointId));
    }
    suppressClick = true;   // don't let the ensuing click arm a pin
  }
});
function updateWirePreview(e) {
  const from = wiring.worldPosOf(wireDrag.fromId);
  if (!from) return;
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -from.y);
  const end = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, end)) raycaster.ray.at(30, end);
  if (!wireDrag.line) {
    const g = new THREE.BufferGeometry().setFromPoints([from, end]);
    wireDrag.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x56a8ff }));
    scene.add(wireDrag.line);
    wiring.highlightPin(wireDrag.fromId, true);
  } else {
    wireDrag.line.geometry.setFromPoints([from, end]);
  }
}

function pickPin() {
  const pinMeshes = [];
  for (const ep of wiring.endpoints.values()) pinMeshes.push(ep.obj);
  const hit = raycaster.intersectObjects(pinMeshes, false)[0];
  return hit ? hit.object : null;
}

// ── checklist ───────────────────────────────────────────────────
const checklistEl = document.getElementById('checklist');
function refreshChecklist() {
  const st = wiring.status();
  const doneN = st.filter(s => s.done).length;
  checklistEl.innerHTML =
    `<div class="check-item" style="color:var(--text)">${doneN}/${st.length} connections</div>` +
    st.map(s => `<div class="check-item ${s.done ? 'done' : ''}">
        <span class="box">${s.done ? '☑' : '☐'}</span>${s.label}</div>`).join('');

  const ready = wiring.allRequiredDone();
  uploadBtn.disabled = !ready;
  if (ready && mode === 'assembly') hudStatus.textContent = '✓ Wiring complete — hit UPLOAD to run the robot';
  clearBtn.disabled = mode === 'sim' || Object.keys(placed).length === 0;
  updateStepper();
}

// ── phase stepper ───────────────────────────────────────────────
const stepEls = {};
for (const el of document.querySelectorAll('.step')) stepEls[el.dataset.step] = el;
function updateStepper() {
  const allPlaced = Object.keys(placed).length >= SLOTS.length;
  const wired = wiring.allRequiredDone();
  const running = mode === 'sim';
  const state = {
    assemble: running ? 'complete' : (allPlaced ? 'complete' : 'active'),
    wire:     running ? 'complete' : (!allPlaced ? '' : (wired ? 'complete' : 'active')),
    program:  running ? 'complete' : (wired ? 'active' : ''),
    run:      running ? 'active' : '',
  };
  for (const [k, cls] of Object.entries(state)) {
    stepEls[k].classList.remove('active', 'complete');
    if (cls) stepEls[k].classList.add(cls);
  }
}

// ── clear board ─────────────────────────────────────────────────
const clearBtn = document.getElementById('clear-btn');
function clearBoard() {
  if (mode !== 'assembly') return;
  for (const id of Object.keys(placed)) {
    wiring.unregisterComponent(placed[id].compType);
    assembly.remove(placed[id].group);
    placed[id].group.traverse(o => { o.geometry?.dispose?.(); });
    delete placed[id];
  }
  for (const t of Object.keys(placedCount)) delete placedCount[t];
  usedTypes.clear();
  wiring.enabled = false;
  for (const def of PART_DEFS) {
    const card = cardByType[def.type];
    card.classList.remove('depleted');
    const badge = card.querySelector('[data-remaining]');
    if (badge) badge.textContent = `×${def.count}`;
  }
  // defensively un-stick the auto-wire buttons
  autoBusy = false;
  autoInstant.disabled = autoStep.disabled = false;
  hudStatus.textContent = 'Drag parts from the tray onto the chassis';
  refreshChecklist();
}
clearBtn.addEventListener('click', clearBoard);

// ── editor ──────────────────────────────────────────────────────
let currentGains = { Kp: 15, Ki: 140, Kd: 0.9 };
initEditor(document.getElementById('editor-container'), (g) => {
  currentGains = g;
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
  } catch (err) {
    flash('Failed to load physics engine', 'bad');
    uploadBtn.classList.remove('loading');
    uploadLabel.textContent = 'UPLOAD';
    return;
  }
  uploadBtn.classList.remove('loading');
  uploadLabel.textContent = 'UPLOAD';
  enterSim();
});

function enterSim() {
  mode = 'sim';
  assembly.visible = false;
  wiring.setVisible(false);
  for (const d of assemblyDecor) d.visible = false;
  canvas.style.cursor = 'default';
  controlsLegend.classList.add('hidden');
  // outdoor atmosphere for driving
  scene.background = SKY_BG;
  scene.fog.color.copy(SKY_FOG); scene.fog.near = 170; scene.fog.far = 650;
  document.querySelector('#three-canvas').style.cursor = 'default';
  sim.setGains(currentGains);
  sim.start();
  const p = sim.chassisPos();
  // hand the camera to the chase rig (disable orbit so driving isn't disorienting)
  controls.enabled = false;
  controls.target.copy(p);
  camera.position.set(p.x, p.y + 18, p.z - 46);
  camera.lookAt(p.x, p.y + 4, p.z);
  simHud.classList.remove('hidden');
  hudStatus.textContent = 'Booting robot…';
  graphData.length = 0;
  keys.clear();
  // power-on bring-up: robot balances while it "boots", driving unlocks after
  booting = true;
  audio.boot();
  audio.startMotor();
  serial.boot(currentGains, () => {
    booting = false;
    hudStatus.textContent = 'Drive with W/A/S/D — the robot balances as it moves';
  });
  missionRunning = false; missionCtx = null;
  missionHud.classList.remove('hidden');
  renderMissionCard();
  updateStepper();
}

// ── WASD driving · arrows + mouse orbit the camera ─────────────
const keys = new Set();
const DRIVE_KEYS = { w: 1, a: 1, s: 1, d: 1 };
const CAM_KEYS = { arrowup: 1, arrowdown: 1, arrowleft: 1, arrowright: 1 };
const camKeys = new Set();
// camera orbit state (offset from the auto chase behind the heading)
let camYaw = 0, camElev = 0.36, camZoom = 1, camDragging = false;
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (mode !== 'sim') return;
  if (DRIVE_KEYS[k]) { keys.add(k); updateDriveInput(); e.preventDefault(); }
  else if (CAM_KEYS[k]) { camKeys.add(k); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (DRIVE_KEYS[k]) { keys.delete(k); updateDriveInput(); }
  else if (CAM_KEYS[k]) camKeys.delete(k);
});
function updateDriveInput() {
  if (booting) { sim.input.fwd = 0; sim.input.turn = 0; return; }   // locked during boot
  const fwd = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
  const turn = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  sim.input.fwd = fwd;
  sim.input.turn = turn;
}
// mouse-drag to orbit the camera while driving
canvas.addEventListener('pointerdown', (e) => { if (mode === 'sim' && e.button === 0) camDragging = true; });
window.addEventListener('pointerup', () => { camDragging = false; });
canvas.addEventListener('pointermove', (e) => {
  if (mode !== 'sim' || !camDragging) return;
  camYaw -= e.movementX * 0.005;
  camElev = THREE.MathUtils.clamp(camElev + e.movementY * 0.004, 0.06, 1.35);
});
canvas.addEventListener('wheel', (e) => {
  if (mode !== 'sim') return;
  camZoom = THREE.MathUtils.clamp(camZoom * (1 + e.deltaY * 0.001), 0.5, 2.4);
  e.preventDefault();
}, { passive: false });

function exitSim() {
  mode = 'assembly';
  booting = false;
  serial.cancel();
  audio.stopMotor();
  missionRunning = false; missionCtx = null;
  missionHud.classList.add('hidden');
  sim.hide();
  assembly.visible = true;
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
  simHud.classList.add('hidden');
  updateStepper();
}

// ── onboarding overlay + help ───────────────────────────────────
const overlay = document.getElementById('overlay');
function closeOverlay() {
  overlay.classList.add('hidden');
  try { localStorage.setItem('sbl-seen', '1'); } catch {}
}
document.getElementById('overlay-start').addEventListener('click', closeOverlay);
document.getElementById('help-btn').addEventListener('click', () => overlay.classList.remove('hidden'));
let seen = false;
try { seen = localStorage.getItem('sbl-seen') === '1'; } catch {}
if (seen) overlay.classList.add('hidden');

// ── sim HUD (built dynamically) ─────────────────────────────────
const simHud = document.createElement('div');
simHud.id = 'sim-hud';
simHud.className = 'hidden';
simHud.innerHTML = `
  <div class="sim-row">
    <span id="tilt-readout">Tilt: 0.0°</span>
    <span id="sim-state" class="sim-ok">BALANCING</span>
  </div>
  <canvas id="sparkline" width="300" height="70"></canvas>
  <div class="sim-buttons">
    <button id="nudge-btn"><i data-lucide="zap"></i><span>Nudge</span></button>
    <button id="reset-btn"><i data-lucide="rotate-ccw"></i><span>Reset</span></button>
    <button id="back-btn"><i data-lucide="arrow-left"></i><span>Assembly</span></button>
  </div>
  <div class="sim-gains" id="gains-readout">Kp 15  Ki 140  Kd 0.9</div>
  <div class="sim-drive">W/S drive · A/D steer</div>`;
document.getElementById('workspace').appendChild(simHud);
document.getElementById('nudge-btn').addEventListener('click', () => { sim.nudge(); audio.nudge(); });
document.getElementById('reset-btn').addEventListener('click', () => { sim.setGains(currentGains); sim.reset(); graphData.length = 0; });
document.getElementById('back-btn').addEventListener('click', exitSim);

// ── mission mode HUD (built dynamically) ───────────────────────
const missions = makeMissions();
let curMission = 0, missionCtx = null, missionRunning = false;
const missionHud = document.createElement('div');
missionHud.id = 'mission-hud';
missionHud.className = 'hidden';
missionHud.innerHTML = `
  <div class="m-top"><span class="m-title"></span><span class="m-medal"></span></div>
  <div class="m-brief"></div>
  <div class="m-bar"><div class="m-fill"></div></div>
  <div class="m-status"></div>
  <div class="m-btns">
    <button id="m-prev" title="Previous mission"><i data-lucide="chevron-left"></i></button>
    <button id="m-start">Start</button>
    <button id="m-next" title="Next mission"><i data-lucide="chevron-right"></i></button>
  </div>`;
document.getElementById('workspace').appendChild(missionHud);
const mTitle = missionHud.querySelector('.m-title');
const mBrief = missionHud.querySelector('.m-brief');
const mMedal = missionHud.querySelector('.m-medal');
const mFill = missionHud.querySelector('.m-fill');
const mStatus = missionHud.querySelector('.m-status');
const mStart = document.getElementById('m-start');

function renderMissionCard() {
  const m = missions[curMission];
  mTitle.textContent = m.title;
  mBrief.textContent = m.brief;
  mMedal.textContent = '';
  mStatus.textContent = ''; mStatus.className = 'm-status';
  mFill.style.width = '0%';
  mStart.textContent = m.id === 'free' ? 'Reset' : 'Start';
  mStart.classList.remove('running');
}
function startMission() {
  missionCtx = { onShove: () => audio.nudge() };
  missionRunning = true;
  sim.setGains(currentGains); sim.reset(); graphData.length = 0;
  mMedal.textContent = ''; mStatus.textContent = ''; mStatus.className = 'm-status';
  mStart.textContent = 'Stop'; mStart.classList.add('running');
}
function stopMission() {
  missionRunning = false; missionCtx = null;
  mStart.textContent = 'Start'; mStart.classList.remove('running');
  mFill.style.width = '0%';
}
function endMission(r) {
  missionRunning = false; missionCtx = null;
  mStart.textContent = 'Retry'; mStart.classList.remove('running');
  mStatus.textContent = r.label;
  mStatus.className = 'm-status ' + (r.status === 'success' ? 'ok' : 'bad');
  mMedal.textContent = r.status === 'success' ? '🏅' : '💥';
  if (r.status === 'success') audio.boot(); else audio.error();
}
mStart.addEventListener('click', () => {
  const m = missions[curMission];
  if (m.id === 'free') { sim.setGains(currentGains); sim.reset(); graphData.length = 0; return; }
  missionRunning ? stopMission() : startMission();
});
document.getElementById('m-prev').addEventListener('click', () => { if (missionRunning) return; curMission = (curMission + missions.length - 1) % missions.length; renderMissionCard(); audio.ui(); });
document.getElementById('m-next').addEventListener('click', () => { if (missionRunning) return; curMission = (curMission + 1) % missions.length; renderMissionCard(); audio.ui(); });

// render all Lucide icons now that the static + dynamic markup exists
try { window.lucide?.createIcons(); } catch {}

const tiltReadout = () => document.getElementById('tilt-readout');
const simState = () => document.getElementById('sim-state');
const simDrive = simHud.querySelector('.sim-drive');

// ── sparkline ───────────────────────────────────────────────────
const graphData = [];
const spark = document.getElementById('sparkline');
function drawSpark() {
  const ctx = spark.getContext('2d');
  const w = spark.width, h = spark.height;
  ctx.clearRect(0, 0, w, h);
  // zero line
  ctx.strokeStyle = '#2a3446'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  // band ±10°
  const scale = (h / 2) / 45;
  ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 2; ctx.beginPath();
  graphData.forEach((v, i) => {
    const x = (i / (graphData.length - 1 || 1)) * w;
    const y = h / 2 - THREE.MathUtils.clamp(v, -45, 45) * scale;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = graphData.length && Math.abs(graphData[graphData.length - 1]) > 25 ? '#ff5d5d' : '#3ddc84';
  ctx.stroke();
}

sim.onTelemetry = ({ tiltDeg, fallen }) => {
  graphData.push(tiltDeg);
  if (graphData.length > 300) graphData.shift();
};

// ── tooltips ────────────────────────────────────────────────────
function showTooltip(e, html, isError = false) {
  tooltip.innerHTML = html;
  tooltip.classList.toggle('error', isError);
  tooltip.classList.remove('hidden');
  moveTooltip(e);
}
function moveTooltip(e) {
  tooltip.style.left = (e.clientX + 14) + 'px';
  tooltip.style.top = (e.clientY + 14) + 'px';
}
function hideTooltip() { tooltip.classList.add('hidden'); }

// transient status flash
let flashTimer = null;
function flash(msg, kind) {
  hudStatus.textContent = msg;
  hudStatus.style.color = kind === 'ok' ? 'var(--green)' : kind === 'bad' ? 'var(--red)' : '';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { hudStatus.style.color = ''; }, 2200);
}

// ── render loop ─────────────────────────────────────────────────
let last = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;

  if (mode === 'assembly') {
    controls.update();
    floorUniforms.uTime.value += dt;
    wiring.animateFlow(dt, wiring.allRequiredDone());
  }

  if (mode === 'sim') {
    sim.step(dt);
    // racing chase-cam: trails behind the heading, orbitable with mouse/arrows,
    // pulls back + widens FOV with speed, and looks ahead along travel.
    if (sim.bodies.chassis) {
      const p = sim.chassisPos();
      const spd = sim.driveSpeed || 0;
      // arrow-key orbit
      if (camKeys.size) {
        if (camKeys.has('arrowleft')) camYaw += 1.6 * dt;
        if (camKeys.has('arrowright')) camYaw -= 1.6 * dt;
        if (camKeys.has('arrowup')) camElev = THREE.MathUtils.clamp(camElev + 1.2 * dt, 0.06, 1.35);
        if (camKeys.has('arrowdown')) camElev = THREE.MathUtils.clamp(camElev - 1.2 * dt, 0.06, 1.35);
      }
      // gently re-center the yaw behind the bot when not actively looking around
      if (!camDragging && !camKeys.size) camYaw *= (1 - Math.min(1, 0.6 * dt));
      const a = sim.heading + camYaw;
      const fwd = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const dist = (40 + spd * 0.55) * camZoom;
      const elev = THREE.MathUtils.clamp(camElev, 0.06, 1.35);
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
    const el = tiltReadout();
    if (el) el.textContent = `${(sim.driveSpeed || 0).toFixed(0)} u/s`;
    const st = simState();
    if (st) {
      const m = sim.material;
      if (m && m !== 'normal') { st.textContent = m.toUpperCase(); st.className = 'sim-warn'; }
      else if (sim.fallen) { st.textContent = 'FALLEN'; st.className = 'sim-bad'; }
      else { st.textContent = 'DRIVING'; st.className = 'sim-ok'; }
    }
    if (simDrive) simDrive.textContent = 'W/S drive · A/D steer · drag / ↑↓←→ to look';
    drawSpark();
    if (!booting) serial.telemetry(sim, now);
    audio.setMotor(sim.speed || 0);
    if (missionRunning && !booting) {
      const r = missions[curMission].update(sim, dt, missionCtx);
      mFill.style.width = (r.progress * 100).toFixed(0) + '%';
      if (r.status === 'active') { mStatus.textContent = r.label; mStatus.className = 'm-status'; }
      else if (r.status === 'success' || r.status === 'fail') endMission(r);
    }
  }

  composer.render();
}
animate();
resize();
updateStepper();
