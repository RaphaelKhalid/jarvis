// HUD: tooltips, status flash, checklist, sound toggle, sim HUD (sparkline +
// live PID sliders + buttons), mission HUD. (The phase stepper + onboarding
// overlay it once owned are now the Guide rail — see js/app/guide.js.)
import * as THREE from 'three';
import { activeRobot } from '../robots/index.js';
import { audio } from '../audio.js';
import { state, set, subscribe } from './state.js';

export const KIND_LABEL = { power: 'POWER', ground: 'GROUND', data: 'SIGNAL' };

export function initHud({ wiring, sim, getPlacedCount, getGains, onExitSim, onGains }) {
  const tooltip = document.getElementById('tooltip');
  const hudStatus = document.getElementById('hud-status');
  const checklistEl = document.getElementById('checklist');
  const uploadBtn = document.getElementById('upload-btn');
  const clearBtn = document.getElementById('clear-btn');

  // ── tooltips ──────────────────────────────────────────────────
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
  function setStatus(msg) { hudStatus.textContent = msg; }

  // ── sound toggle ──────────────────────────────────────────────
  const soundBtn = document.getElementById('sound-btn');
  function renderSoundBtn() {
    soundBtn.classList.toggle('muted', !audio.enabled);
    soundBtn.innerHTML = `<i data-lucide="${audio.enabled ? 'volume-2' : 'volume-x'}"></i>`;
    try { window.lucide?.createIcons(); } catch {}
  }
  soundBtn.addEventListener('click', () => { audio.resume(); audio.setEnabled(!audio.enabled); renderSoundBtn(); });
  renderSoundBtn();

  // ── checklist ─────────────────────────────────────────────────
  function refreshChecklist() {
    const st = wiring.status();
    const doneN = st.filter(s => s.done).length;
    checklistEl.innerHTML =
      `<div class="check-item" style="color:var(--text)">${doneN}/${st.length} connections</div>` +
      st.map(s => `<div class="check-item ${s.done ? 'done' : ''}">
          <span class="box">${s.done ? '☑' : '☐'}</span>${s.label}</div>`).join('');

    const ready = wiring.allRequiredDone();
    uploadBtn.disabled = !ready;
    if (ready && state.mode === 'assembly') hudStatus.textContent = '✓ Wiring complete — hit UPLOAD to run the robot';
    clearBtn.disabled = state.mode === 'sim' || getPlacedCount() === 0;
    updateStepper();
  }

  // ── phase stepper ─────────────────────────────────────────────
  const stepEls = {};
  for (const el of document.querySelectorAll('.step')) stepEls[el.dataset.step] = el;
  function updateStepper() {
    const allPlaced = getPlacedCount() >= activeRobot().slots.length;
    const wired = wiring.allRequiredDone();
    const running = state.mode === 'sim';
    const stepState = {
      assemble: running ? 'complete' : (allPlaced ? 'complete' : 'active'),
      wire:     running ? 'complete' : (!allPlaced ? '' : (wired ? 'complete' : 'active')),
      program:  running ? 'complete' : (wired ? 'active' : ''),
      run:      running ? 'active' : '',
    };
    for (const [k, cls] of Object.entries(stepState)) {
      if (!stepEls[k]) continue;   // stepper replaced by the Guide rail; keep this a no-op
      stepEls[k].classList.remove('active', 'complete');
      if (cls) stepEls[k].classList.add(cls);
    }
  }

  // ── onboarding overlay + help ─────────────────────────────────
  const overlay = document.getElementById('overlay');
  function closeOverlay() {
    overlay.classList.add('hidden');
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
  }
  document.getElementById('overlay-start').addEventListener('click', closeOverlay);
  // help-btn is wired in main.js to expand the Guide rail (the single help surface)
  let seen = false;
  try { seen = localStorage.getItem('sbl-seen') === '1'; } catch {}
  // overlay starts hidden in markup (no flash on repeat visits); reveal for newcomers
  if (!seen) overlay.classList.remove('hidden');

  // ── sim HUD (built dynamically) ───────────────────────────────
  const simHud = document.createElement('div');
  simHud.id = 'sim-hud';
  simHud.className = 'hidden';
  simHud.innerHTML = `
    <div class="sim-row">
      <span id="tilt-readout">Tilt: 0.0°</span>
      <span id="sim-state" class="sim-ok">BALANCING</span>
    </div>
    <canvas id="sparkline" width="300" height="70"></canvas>
    <div class="spark-legend">
      <span class="lg-tilt">— tilt</span><span class="lg-p">— P</span><span class="lg-i">— I</span><span class="lg-d">— D</span>
    </div>
    <div class="sim-pid" id="sim-pid">
      <div class="pid-head">LIVE PID TUNING</div>
      <label class="pid-row"><span class="pid-k">Kp</span><input id="kp-sl" type="range" min="0" max="40" step="0.5"><span class="pid-v" id="kp-val">15</span></label>
      <label class="pid-row"><span class="pid-k">Ki</span><input id="ki-sl" type="range" min="0" max="300" step="5"><span class="pid-v" id="ki-val">140</span></label>
      <label class="pid-row"><span class="pid-k">Kd</span><input id="kd-sl" type="range" min="0" max="3" step="0.05"><span class="pid-v" id="kd-val">0.9</span></label>
    </div>
    <div class="sim-buttons">
      <button id="reset-btn"><i data-lucide="rotate-ccw"></i><span>Reset</span></button>
      <button id="back-btn"><i data-lucide="arrow-left"></i><span>Assembly</span></button>
    </div>
    <div class="sim-drive">W/S drive · A/D steer · Space jump</div>`;
  document.getElementById('workspace').appendChild(simHud);
  // the rover has no balance loop: hide the PID tuning sliders + the tilt/PID
  // sparkline (they'd only ever read ~0). Per-frame readouts already show speed.
  if (activeRobot().simKey !== 'balance') {
    for (const sel of ['#sim-pid', '#sparkline', '.spark-legend']) simHud.querySelector(sel)?.classList.add('hidden');
  }
  document.getElementById('reset-btn').addEventListener('click', () => { sim.setGains(getGains()); sim.reset(); clearGraph(); });
  document.getElementById('back-btn').addEventListener('click', () => onExitSim());

  // ── live PID sliders (drive the sim + editor sketch in real time) ──
  const sl = { Kp: simHud.querySelector('#kp-sl'), Ki: simHud.querySelector('#ki-sl'), Kd: simHud.querySelector('#kd-sl') };
  const slv = { Kp: simHud.querySelector('#kp-val'), Ki: simHud.querySelector('#ki-val'), Kd: simHud.querySelector('#kd-val') };
  function syncSliders(g) {
    for (const k of ['Kp', 'Ki', 'Kd']) { sl[k].value = g[k]; slv[k].textContent = g[k]; }
  }
  function onSlide() {
    const g = { Kp: +sl.Kp.value, Ki: +sl.Ki.value, Kd: +sl.Kd.value };
    for (const k of ['Kp', 'Ki', 'Kd']) slv[k].textContent = g[k];
    set('gains', g); sim.setGains(g); onGains?.(g);   // onGains keeps the .ino sketch in sync
  }
  for (const k of ['Kp', 'Ki', 'Kd']) sl[k].addEventListener('input', onSlide);
  syncSliders(getGains());
  subscribe('gains', syncSliders);   // keep sliders in step with edits from the .ino editor

  // Mission mode was removed in the creator-space pivot (M1). These are now
  // no-ops so the render loop + sim transitions keep their call sites.
  function missionTick() {}
  function enterSimMissions() {}
  function exitSimMissions() {}

  // render all Lucide icons now that the static + dynamic markup exists
  try { window.lucide?.createIcons(); } catch {}

  const tiltReadout = () => document.getElementById('tilt-readout');
  const simStateEl = () => document.getElementById('sim-state');
  const simDrive = simHud.querySelector('.sim-drive');

  // ── sparkline ─────────────────────────────────────────────────
  // samples: { t: tiltDeg, p, i, d } — PID terms normalized to the ±255 PWM range
  const graphData = [];
  const spark = document.getElementById('sparkline');
  function clearGraph() { graphData.length = 0; }
  function pushTilt(tiltDeg) {
    const terms = sim.pidTerms || {};
    graphData.push({ t: tiltDeg, p: terms.p || 0, i: terms.i || 0, d: terms.d || 0 });
    if (graphData.length > 300) graphData.shift();
  }
  function tracePath(ctx, w, h, get, scale) {
    ctx.beginPath();
    graphData.forEach((s, idx) => {
      const x = (idx / (graphData.length - 1 || 1)) * w;
      const y = h / 2 - THREE.MathUtils.clamp(get(s), -1, 1) * scale;
      idx ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  // trace colors come from the shared --trace-* tokens (tokens.css) so the
  // canvas and the CSS legend can't drift, and both follow the light/dark theme.
  const hexA = (hex, a) => {
    const n = parseInt(hex.trim().slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  function drawSpark() {
    const ctx = spark.getContext('2d');
    const w = spark.width, h = spark.height;
    const css = window.getComputedStyle(document.documentElement);
    const tk = (name) => css.getPropertyValue(name);
    ctx.clearRect(0, 0, w, h);
    // zero line
    ctx.strokeStyle = tk('--trace-grid'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    const half = h / 2 - 2;
    // PID term contributions (thin, normalized to ±255 output range)
    ctx.lineWidth = 1;
    ctx.strokeStyle = hexA(tk('--trace-p'), 0.75); tracePath(ctx, w, h, s => s.p / 255, half);
    ctx.strokeStyle = hexA(tk('--trace-i'), 0.75); tracePath(ctx, w, h, s => s.i / 255, half);
    ctx.strokeStyle = hexA(tk('--trace-d'), 0.75); tracePath(ctx, w, h, s => s.d / 255, half);
    // tilt (bold, ±45°)
    const last = graphData[graphData.length - 1];
    ctx.lineWidth = 2;
    ctx.strokeStyle = last && Math.abs(last.t) > 25 ? tk('--trace-fault') : tk('--trace-tilt');
    tracePath(ctx, w, h, s => s.t / 45, half);
  }

  // per-frame sim readouts (speed, state chip, drive hint)
  function simReadouts() {
    const el = tiltReadout();
    if (el) el.textContent = `${(sim.driveSpeed || 0).toFixed(0)} u/s`;
    const st = simStateEl();
    if (st) {
      const m = sim.material;
      if (sim.fallen) { st.textContent = 'FALLEN'; st.className = 'sim-bad'; }
      else if (sim._airborne) { st.textContent = 'AIRBORNE'; st.className = 'sim-warn'; }
      else if (m && m !== 'normal') { st.textContent = m.toUpperCase(); st.className = 'sim-warn'; }
      else { st.textContent = 'DRIVING'; st.className = 'sim-ok'; }
    }
    if (simDrive) simDrive.textContent = sim.fallen
      ? 'SPACE to get back up'
      : 'W/S/A/D · SPACE jump · drag / arrows look';
    drawSpark();
  }

  return {
    showTooltip, moveTooltip, hideTooltip, flash, setStatus,
    refreshChecklist, updateStepper,
    simHud, clearGraph, pushTilt, simReadouts,
    missionTick, enterSimMissions, exitSimMissions,
  };
}
