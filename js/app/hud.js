// HUD: tooltips, transient status flash, the connection checklist, the sound
// toggle, and the compact RUN-mode card.
//
// This module used to carry the pre-pivot self-balancer instrumentation — a
// tilt/PID sparkline, live Kp/Ki/Kd sliders, a four-phase stepper and a mission
// HUD. None of it had a live counterpart in the creator sandbox (there is no
// balance loop, no PID, no mission), so it was hidden-but-still-running dead
// weight. It's gone: the Inspector owns the electrical readout, and RUN is a
// motor test with Reset + back-to-bench.
import { audio } from '../audio.js';
import { state } from './state.js';

export const KIND_LABEL = { power: 'POWER', ground: 'GROUND', data: 'SIGNAL' };

export function initHud({ wiring, onExitSim, onReset }) {
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

    // Run is always enabled — violations surface in the sim, not as a gate.
    uploadBtn.disabled = false;
    clearBtn.disabled = state.mode === 'sim';
  }

  // ── onboarding overlay ────────────────────────────────────────
  const overlay = document.getElementById('overlay');
  document.getElementById('overlay-start').addEventListener('click', () => {
    overlay.classList.add('hidden');
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
  });
  let seen = false;
  try { seen = localStorage.getItem('sbl-seen') === '1'; } catch {}
  // overlay starts hidden in markup (no flash on repeat visits); reveal for newcomers
  if (!seen) overlay.classList.remove('hidden');

  // ── RUN card ──────────────────────────────────────────────────
  // A doc-driven motor test: the Inspector shows solved current + ω, so all this
  // needs is a title and two buttons.
  const simHud = document.createElement('div');
  simHud.id = 'sim-hud';
  simHud.className = 'hidden';
  simHud.innerHTML = `
    <div class="sim-title">MOTOR TEST</div>
    <div class="sim-buttons">
      <button id="reset-btn"><i data-lucide="rotate-ccw"></i><span>Reset</span></button>
      <button id="back-btn"><i data-lucide="arrow-left"></i><span>Bench</span></button>
    </div>`;
  document.getElementById('workspace').appendChild(simHud);
  simHud.querySelector('#reset-btn').addEventListener('click', () => onReset?.());
  simHud.querySelector('#back-btn').addEventListener('click', () => onExitSim());

  // render all Lucide icons now that the static + dynamic markup exists
  try { window.lucide?.createIcons(); } catch {}

  return {
    showTooltip, moveTooltip, hideTooltip, flash, setStatus,
    refreshChecklist, simHud,
  };
}
