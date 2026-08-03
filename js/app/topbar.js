// Top-bar shell — the slim product frame above the three-panel cockpit. Turns
// "a demo" into "a product": brand mark, the current build's name, and a
// light/dark theme toggle. Kept deliberately minimal; the workspace keeps its
// own sound/help buttons.
//
// The chip used to name the active *robot* (the pre-pivot RobotDef registry, one
// fixed chassis per app boot). In the creator sandbox the unit of work is the
// RobotDoc, so the chip names the open build and doubles as a rename field.
import { state, subscribe } from './state.js';

const THEME_KEY = 'sbl-theme';

export function initTopbar({ getName, onRename } = {}) {
  const bar = document.getElementById('topbar');
  if (!bar) return null;

  bar.innerHTML = `
    <div class="tb-brand">
      <span class="tb-mark" aria-hidden="true">◐</span>
      <span class="tb-name">JARVIS</span>
      <span class="tb-sub">Robotics Creator</span>
    </div>
    <button class="tb-robot" id="tb-robot" title="Rename this build"><span class="tb-dot"></span><span id="tb-robot-name">Bench</span></button>
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

  // chip names the open build and reflects build/run state; clicking renames it
  function refreshChip() {
    const chip = bar.querySelector('#tb-robot');
    const running = state.mode === 'sim';
    chip.classList.toggle('driving', running);
    const name = (getName && getName()) || 'Bench';
    bar.querySelector('#tb-robot-name').textContent = name + (running ? ' — running' : '');
  }
  bar.querySelector('#tb-robot').addEventListener('click', () => {
    if (!onRename) return;
    const next = window.prompt('Name this build:', (getName && getName()) || 'Bench');
    if (next && next.trim()) { onRename(next.trim()); refreshChip(); }
  });
  subscribe('mode', refreshChip);
  refreshChip();

  try { window.lucide?.createIcons(); } catch { /* icons are best-effort */ }
  return { refreshChip };
}
