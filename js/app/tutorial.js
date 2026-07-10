// First-run interactive tutorial: a spotlight ring + coach card that walks a
// brand-new user through place → wire → tune → upload. Steps auto-advance by
// observing real app state (no fake clicks). Skippable; replayable via Help.
import { state } from './state.js';

const DONE_KEY = 'sbl-tutorial-done';

export function initTutorial({ assemblyApi, wiring }) {
  let stepIdx = -1;
  let pollTimer = null;
  let ring = null, card = null;

  const steps = [
    {
      target: '.part-card[data-type="battery"]',
      title: 'Place your first part',
      text: 'Drag the <b>7.4V LiPo battery</b> card onto the chassis in the middle of the screen. Every robot needs power first.',
      done: () => assemblyApi.getPlacedCount() >= 1,
    },
    {
      target: '#parts-tray',
      title: 'Finish the build',
      text: 'Drag the rest of the parts onto the chassis — the glowing pads show where each one fits. (Motors go on twice!)',
      done: () => assemblyApi.getPlacedCount() >= 6,
    },
    {
      target: '#three-canvas',
      title: 'Wire a connection',
      text: 'Click a <b>pin</b> on one part, then click its matching pin on another — or just drag between them. Hover any pin to learn what it does. Make one connection.',
      done: () => wiring.wires.length >= 1,
    },
    {
      target: '#auto-bar',
      title: 'Wire the rest',
      text: 'Real wiring takes practice — the checklist on the left tracks every required connection. For now, hit <b>Auto-wire (instant)</b> to finish up.',
      done: () => wiring.allRequiredDone(),
    },
    {
      target: '#editor-container',
      title: 'Meet the brain',
      text: 'This Arduino sketch is the robot’s balance controller. Find <b>Kp</b> and change <code>15.0</code> to <code>18.0</code> — hover any keyword to see which part it controls.',
      done: () => state.gains.Kp !== 15,
    },
    {
      target: '#upload-btn',
      title: 'Upload & drive!',
      text: 'Hit <b>UPLOAD</b> to flash the robot and watch it balance. Then drive with <b>W A S D</b> — and try the ramps.',
      done: () => state.mode === 'sim',
    },
  ];

  function el(tag, id, html) {
    const d = document.createElement(tag);
    if (id) d.id = id;
    if (html) d.innerHTML = html;
    document.body.appendChild(d);
    return d;
  }

  function positionRing() {
    const s = steps[stepIdx];
    const t = document.querySelector(s.target);
    if (!t || !ring) return;
    const r = t.getBoundingClientRect();
    ring.style.left = (r.left - 6) + 'px';
    ring.style.top = (r.top - 6) + 'px';
    ring.style.width = (r.width + 12) + 'px';
    ring.style.height = (r.height + 12) + 'px';
    // card near the ring, clamped to viewport
    const cw = 300;
    let cx = r.right + 16;
    if (cx + cw > window.innerWidth - 12) cx = Math.max(12, r.left - cw - 16);
    let cy = Math.max(12, Math.min(r.top, window.innerHeight - 190));
    card.style.left = cx + 'px';
    card.style.top = cy + 'px';
  }

  function renderStep() {
    const s = steps[stepIdx];
    card.innerHTML = `
      <div class="tut-progress">${stepIdx + 1} / ${steps.length}</div>
      <div class="tut-title">${s.title}</div>
      <div class="tut-text">${s.text}</div>
      <div class="tut-btns"><button id="tut-skip">Skip tour</button></div>`;
    document.getElementById('tut-skip').addEventListener('click', finish);
    positionRing();
  }

  function advanceIfDone() {
    if (stepIdx < 0) return;
    positionRing();   // track layout shifts
    if (steps[stepIdx].done()) {
      stepIdx++;
      if (stepIdx >= steps.length) return finish();
      renderStep();
    }
  }

  function start() {
    if (stepIdx >= 0) return;
    stepIdx = 0;
    ring = el('div', 'tut-ring');
    card = el('div', 'tut-card');
    renderStep();
    pollTimer = setInterval(advanceIfDone, 300);
    window.addEventListener('resize', positionRing);
  }

  function finish() {
    clearInterval(pollTimer);
    window.removeEventListener('resize', positionRing);
    ring?.remove(); card?.remove();
    ring = card = null;
    stepIdx = -1;
    try { localStorage.setItem(DONE_KEY, '1'); } catch {}
  }

  function shouldAutoStart() {
    try { return localStorage.getItem(DONE_KEY) !== '1' && localStorage.getItem('sbl-seen') !== '1'; } catch { return false; }
  }

  return { start, finish, shouldAutoStart };
}
