// HUD: tooltips, status flash, checklist, phase stepper, onboarding overlay,
// sound toggle, sim HUD (sparkline + buttons), mission HUD.
import * as THREE from 'three';
import { SLOTS } from '../parts.js';
import { audio } from '../audio.js';
import { makeMissions } from '../missions.js';
import { state } from './state.js';

export const KIND_LABEL = { power: 'POWER', ground: 'GROUND', data: 'SIGNAL' };

export function initHud({ wiring, sim, getPlacedCount, getGains, onExitSim }) {
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
    const allPlaced = getPlacedCount() >= SLOTS.length;
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
  document.getElementById('help-btn').addEventListener('click', () => overlay.classList.remove('hidden'));
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
    <div class="sim-buttons">
      <button id="nudge-btn"><i data-lucide="zap"></i><span>Nudge</span></button>
      <button id="reset-btn"><i data-lucide="rotate-ccw"></i><span>Reset</span></button>
      <button id="back-btn"><i data-lucide="arrow-left"></i><span>Assembly</span></button>
    </div>
    <div class="sim-gains" id="gains-readout">Kp 15  Ki 140  Kd 0.9</div>
    <div class="sim-drive">W/S drive · A/D steer</div>`;
  document.getElementById('workspace').appendChild(simHud);
  document.getElementById('nudge-btn').addEventListener('click', () => { sim.nudge(); audio.nudge(); });
  document.getElementById('reset-btn').addEventListener('click', () => { sim.setGains(getGains()); sim.reset(); clearGraph(); });
  document.getElementById('back-btn').addEventListener('click', () => onExitSim());

  // ── mission mode HUD (built dynamically) ─────────────────────
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
      <button id="m-prev" title="Previous mission" aria-label="Previous mission"><i data-lucide="chevron-left"></i></button>
      <button id="m-start">Start</button>
      <button id="m-next" title="Next mission" aria-label="Next mission"><i data-lucide="chevron-right"></i></button>
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
    sim.setGains(getGains()); sim.reset(); clearGraph();
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
    if (m.id === 'free') { sim.setGains(getGains()); sim.reset(); clearGraph(); return; }
    missionRunning ? stopMission() : startMission();
  });
  document.getElementById('m-prev').addEventListener('click', () => { if (missionRunning) return; curMission = (curMission + missions.length - 1) % missions.length; renderMissionCard(); audio.ui(); });
  document.getElementById('m-next').addEventListener('click', () => { if (missionRunning) return; curMission = (curMission + 1) % missions.length; renderMissionCard(); audio.ui(); });

  // called from the render loop while driving
  function missionTick(dt) {
    if (!missionRunning || state.booting) return;
    const r = missions[curMission].update(sim, dt, missionCtx);
    mFill.style.width = (r.progress * 100).toFixed(0) + '%';
    if (r.status === 'active') { mStatus.textContent = r.label; mStatus.className = 'm-status'; }
    else if (r.status === 'success' || r.status === 'fail') endMission(r);
  }
  function enterSimMissions() {
    missionRunning = false; missionCtx = null;
    missionHud.classList.remove('hidden');
    renderMissionCard();
  }
  function exitSimMissions() {
    missionRunning = false; missionCtx = null;
    missionHud.classList.add('hidden');
  }

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
  function drawSpark() {
    const ctx = spark.getContext('2d');
    const w = spark.width, h = spark.height;
    ctx.clearRect(0, 0, w, h);
    // zero line
    ctx.strokeStyle = '#2a3446'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    const half = h / 2 - 2;
    // PID term contributions (thin, normalized to ±255 output range)
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(86,168,255,0.75)';  tracePath(ctx, w, h, s => s.p / 255, half);   // P — blue
    ctx.strokeStyle = 'rgba(255,209,102,0.75)'; tracePath(ctx, w, h, s => s.i / 255, half);   // I — yellow
    ctx.strokeStyle = 'rgba(214,134,255,0.75)'; tracePath(ctx, w, h, s => s.d / 255, half);   // D — purple
    // tilt (bold, ±45°)
    const last = graphData[graphData.length - 1];
    ctx.lineWidth = 2;
    ctx.strokeStyle = last && Math.abs(last.t) > 25 ? '#ff5d5d' : '#3ddc84';
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
