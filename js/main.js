// Orchestrator: tray + drag-to-slot, raycasting, wiring, editor, sim, HUD.
import * as THREE from 'three';
import { createScene } from './scene.js';
import { PART_DEFS, SLOTS, makeMotor } from './parts.js';
import { WiringManager, suggestFor } from './wiring.js';
import { initEditor } from './editor.js';
import { BalanceSim, loadRapier } from './sim.js';

const canvas = document.getElementById('three-canvas');
const { renderer, scene, camera, controls, slotMeshes, resize } = createScene(canvas);

const assembly = new THREE.Group();
scene.add(assembly);

const wiring = new WiringManager(scene, camera, renderer, refreshChecklist);
const sim = new BalanceSim(scene);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');
const hudStatus = document.getElementById('hud-status');

const placed = {};          // slotId -> { group, compType }
const usedTypes = new Set();
let mode = 'assembly';      // 'assembly' | 'sim'

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
    if (w.valid) showTooltip(e, `✓ ${w.req.label}`);
    else {
      const want = suggestFor(w.idA) || suggestFor(w.idB);
      const wantTxt = want ? ` — should go to ${want.split('.')[1]}` : '';
      showTooltip(e, `✗ wrong pin${wantTxt}`, true);
    }
  }
  if (hoveredWire) { moveTooltip(e); return; }

  // pin hover cursor
  if (wiring.enabled) {
    const pinHit = pickPin();
    canvas.style.cursor = pinHit ? 'pointer' : 'default';
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'assembly' || !wiring.enabled) return;
  if (e.button === 2 && hoveredWire) {         // right-click deletes a wire
    wiring.removeWire(hoveredWire);
    hoveredWire = null;
    e.preventDefault();
    return;
  }
});
canvas.addEventListener('click', (e) => {
  if (mode !== 'assembly' || !wiring.enabled) return;
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const pin = pickPin();
  if (!pin) return;
  const id = pin.userData.endpointId;
  const res = wiring.handlePinClick(id);
  if (res.state === 'armed') hudStatus.textContent = `Selected ${id} — now click its target`;
  else if (res.state === 'valid') flash(`✓ ${res.label}`, 'ok');
  else if (res.state === 'invalid') {
    const want = res.suggestion ? ` — ${res.idA.split('.')[1]} should go to ${res.suggestion}` : '';
    flash(`✗ wrong pin${want}`, 'bad');
  } else if (res.state === 'duplicate') flash('already wired', 'bad');
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

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
}

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
uploadBtn.addEventListener('click', async () => {
  if (uploadBtn.disabled) return;
  uploadBtn.textContent = '⏳ COMPILING…';
  try {
    await loadRapier();
  } catch (err) {
    flash('Failed to load physics engine', 'bad');
    uploadBtn.textContent = '⬆ UPLOAD';
    return;
  }
  uploadBtn.textContent = '⬆ UPLOAD';
  enterSim();
});

function enterSim() {
  mode = 'sim';
  assembly.visible = false;
  document.querySelector('#three-canvas').style.cursor = 'default';
  sim.setGains(currentGains);
  sim.start();
  controls.target.set(0, 6, 0);
  camera.position.set(0, 12, 34);
  simHud.classList.remove('hidden');
  graphData.length = 0;
}

function exitSim() {
  mode = 'assembly';
  sim.hide();
  assembly.visible = true;
  controls.target.set(0, 2, 1);
  camera.position.set(18, 20, 26);
  simHud.classList.add('hidden');
}

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
    <button id="nudge-btn">⚡ Nudge</button>
    <button id="reset-btn">↻ Reset</button>
    <button id="back-btn">← Assembly</button>
  </div>
  <div class="sim-gains" id="gains-readout">Kp 15  Ki 140  Kd 0.9</div>`;
document.getElementById('workspace').appendChild(simHud);
document.getElementById('nudge-btn').addEventListener('click', () => sim.nudge());
document.getElementById('reset-btn').addEventListener('click', () => { sim.setGains(currentGains); sim.reset(); graphData.length = 0; });
document.getElementById('back-btn').addEventListener('click', exitSim);

const tiltReadout = () => document.getElementById('tilt-readout');
const simState = () => document.getElementById('sim-state');

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

  controls.update();

  if (mode === 'sim') {
    sim.step(dt);
    const el = tiltReadout();
    if (el) el.textContent = `Tilt: ${sim.tiltDeg.toFixed(1)}°`;
    const st = simState();
    if (st) {
      if (sim.fallen) { st.textContent = 'FALLEN'; st.className = 'sim-bad'; }
      else if (Math.abs(sim.tiltDeg) < 4) { st.textContent = 'BALANCING'; st.className = 'sim-ok'; }
      else { st.textContent = 'CORRECTING'; st.className = 'sim-warn'; }
    }
    drawSpark();
  }

  renderer.render(scene, camera);
}
animate();
resize();
