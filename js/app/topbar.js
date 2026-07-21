// Top-bar shell — the slim product frame above the three-panel cockpit. Turns
// "a demo" into "a product": brand mark, the active robot's name, and a
// light/dark theme toggle. Kept deliberately minimal; the workspace keeps its
// own sound/help/lessons buttons. The current-robot label is a seam for the
// M3 RobotDef work (it will read state.activeRobot.name once that lands).
import { state, subscribe } from './state.js';
import { initRobotPicker } from './robotpicker.js';
import { activeRobot } from '../robots/index.js';

const THEME_KEY = 'sbl-theme';

export function initTopbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return null;

  bar.innerHTML = `
    <div class="tb-brand">
      <span class="tb-mark" aria-hidden="true">◐</span>
      <span class="tb-name">JARVIS</span>
      <span class="tb-sub">Robotics Creator</span>
    </div>
    <button class="tb-robot" id="tb-robot" title="Switch robot"><span class="tb-dot"></span><span id="tb-robot-name">Self-Balancer</span><span class="tb-caret">▾</span></button>
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

  // robot picker popover, anchored to the chip (js/app/robotpicker.js)
  initRobotPicker({ anchor: bar.querySelector('#tb-robot') });

  // chip reflects the active robot + drive/build state
  function refreshChip() {
    const chip = bar.querySelector('#tb-robot');
    const driving = state.mode === 'sim';
    chip.classList.toggle('driving', driving);
    bar.querySelector('#tb-robot-name').textContent =
      activeRobot().name + (driving ? ' — driving' : '');
  }
  subscribe('mode', refreshChip);
  subscribe('activeRobotId', refreshChip);
  refreshChip();

  try { window.lucide?.createIcons(); } catch { /* icons are best-effort */ }
  return { refreshChip };
}
