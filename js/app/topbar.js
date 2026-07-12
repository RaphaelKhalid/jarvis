// Top-bar shell — the slim product frame above the three-panel cockpit. Turns
// "a demo" into "a product": brand mark, the active robot's name, and a
// light/dark theme toggle. Kept deliberately minimal; the workspace keeps its
// own sound/help/lessons buttons. The current-robot label is a seam for the
// M3 RobotDef work (it will read state.activeRobot.name once that lands).
import { subscribe } from './state.js';

const THEME_KEY = 'sbl-theme';

export function initTopbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return null;

  bar.innerHTML = `
    <div class="tb-brand">
      <span class="tb-mark" aria-hidden="true">◐</span>
      <span class="tb-name">GYRO</span>
      <span class="tb-sub">Self-Balance Lab</span>
    </div>
    <div class="tb-robot" id="tb-robot"><span class="tb-dot"></span><span id="tb-robot-name">Self-Balancer</span></div>
    <div class="tb-actions">
      <button id="tb-theme" class="tb-btn" title="Toggle light / dark" aria-label="Toggle light / dark">
        <i data-lucide="sun-moon"></i>
      </button>
    </div>`;

  // ── theme toggle (data-theme on <html>; tokens.css reskins the shell) ──
  const root = document.documentElement;
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  }
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) root.setAttribute('data-theme', saved);
  } catch { /* ignore */ }
  bar.querySelector('#tb-theme').addEventListener('click', () => {
    applyTheme(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  // reflect drive vs. build in the robot chip
  subscribe('mode', (m) => {
    const chip = bar.querySelector('#tb-robot');
    chip.classList.toggle('driving', m === 'sim');
    bar.querySelector('#tb-robot-name').textContent =
      m === 'sim' ? 'Self-Balancer — driving' : 'Self-Balancer';
  });

  try { window.lucide?.createIcons(); } catch { /* icons are best-effort */ }
  return { setRobotName: (n) => { bar.querySelector('#tb-robot-name').textContent = n; } };
}
