// Guide rail: the always-visible, education-first instruction panel docked in
// the workspace. It replaces the old top stepper + full-screen modals — you
// read what to do here and place/wire/program alongside it without clicking
// away. It walks the four phases (Assemble → Wire → Program → Run), advancing
// automatically by observing real app state, and hosts the curriculum lessons
// inline (browser + active lesson card render into this same panel).
import { state } from './state.js';
import { SLOTS } from '../parts.js';

const REQUIRED_PARTS = [
  { compType: 'arduino', label: 'Arduino Uno' },
  { compType: 'mpu6050', label: 'MPU6050 sensor' },
  { compType: 'l298n',   label: 'L298N driver' },
  { compType: 'motorL',  label: 'Left motor' },
  { compType: 'motorR',  label: 'Right motor' },
  { compType: 'battery', label: '7.4V battery' },
];

export function initGuide({ wiring, assemblyApi, getGains }) {
  const workspace = document.getElementById('workspace');

  const panel = document.createElement('div');
  panel.id = 'guide';
  panel.innerHTML = `
    <div class="g-head">
      <span class="g-title"><i data-lucide="graduation-cap"></i> GUIDE</span>
      <div class="g-head-btns">
        <button class="g-lessons" id="g-lessons">Lessons</button>
        <button class="g-collapse" id="g-collapse" title="Collapse" aria-label="Collapse guide">‹</button>
      </div>
    </div>
    <div class="g-body">
      <div class="g-walk" id="g-walk"></div>
      <div class="g-browser hidden" id="g-browser"></div>
      <div class="g-lesson hidden" id="g-lesson"></div>
    </div>
    <button class="g-reopen hidden" id="g-reopen" title="Show guide" aria-label="Show guide"><i data-lucide="graduation-cap"></i></button>`;
  workspace.appendChild(panel);

  const walk = panel.querySelector('#g-walk');
  const browserHost = panel.querySelector('#g-browser');
  const lessonHost = panel.querySelector('#g-lesson');
  const reopenBtn = panel.querySelector('#g-reopen');

  // ── collapse / expand ─────────────────────────────────────────
  function setCollapsed(v) {
    panel.classList.toggle('collapsed', v);
    reopenBtn.classList.toggle('hidden', !v);
    try { localStorage.setItem('sbl-guide-collapsed', v ? '1' : '0'); } catch {}
  }
  panel.querySelector('#g-collapse').addEventListener('click', () => setCollapsed(true));
  reopenBtn.addEventListener('click', () => setCollapsed(false));
  try { if (localStorage.getItem('sbl-guide-collapsed') === '1') setCollapsed(true); } catch {}

  function expand() { setCollapsed(false); }

  // ── view switching (walkthrough ↔ lesson browser ↔ active lesson) ──
  function showView(name) {
    walk.classList.toggle('hidden', name !== 'walk');
    browserHost.classList.toggle('hidden', name !== 'browser');
    lessonHost.classList.toggle('hidden', name !== 'lesson');
    if (name !== 'walk') expand();
  }

  // ── phase model ───────────────────────────────────────────────
  const placedCount = () => assemblyApi.getPlacedCount();
  const partDone = (compType) =>
    Object.values(assemblyApi.placed).some(p => p.compType === compType);

  const phases = [
    {
      key: 'assemble', num: 1, label: 'Assemble',
      text: 'Drag all six parts from the tray onto the glowing pads on the chassis. Every robot needs a brain, a balance sensor, a motor driver, two motors, and a battery.',
      tip: 'Hover a part’s <b>?</b> to see what it does.',
      checklist: () => REQUIRED_PARTS.map(p => ({ label: p.label, done: partDone(p.compType) })),
      done: () => placedCount() >= SLOTS.length,
    },
    {
      key: 'wire', num: 2, label: 'Wire',
      text: 'Connect the pins: click a pin then its matching target, or drag from one to the other. Hover a pin to learn what it is.',
      tip: 'In a hurry? Hit <b>Auto-wire</b> in the tray to finish the loom.',
      checklist: () => wiring.status().map(s => ({ label: s.label, done: s.done })),
      done: () => wiring.allRequiredDone(),
    },
    {
      key: 'program', num: 3, label: 'Program',
      text: 'The Arduino sketch on the right is the robot’s balance controller. Tune the PID gains — <b>Kp</b> reacts to how far it’s tipped, <b>Kd</b> damps the wobble, <b>Ki</b> removes steady lean — then hit <b>UPLOAD</b> (bottom-right) to flash your robot and start it up.',
      tip: 'Reference tune: Kp 15, Ki 140, Kd 0.9. Not sure? The defaults balance — just hit Upload.',
      checklist: () => {
        const g = getGains();
        return [
          { label: `Gains set — Kp ${g.Kp} · Ki ${g.Ki} · Kd ${g.Kd}`, done: true },
          { label: 'Hit Upload to flash & run', done: state.mode === 'sim' },
        ];
      },
      done: () => state.mode === 'sim',
    },
    {
      key: 'run', num: 4, label: 'Run',
      text: 'Your robot is live! Drive with <b>W A S D</b>. <b>Space</b> jumps — and rights you after a wipeout. Hit the ramps, mind the ice, and tune the PID sliders live in the panel on the right.',
      tip: 'Arrows or drag to orbit the camera while you drive.',
      checklist: () => [
        { label: 'Robot uploaded & running', done: state.mode === 'sim' },
        { label: 'Drive it with W A S D', done: state.mode === 'sim' },
      ],
      done: () => false,
    },
  ];

  function currentIndex() {
    if (state.mode === 'sim') return 3;
    if (placedCount() < SLOTS.length) return 0;
    if (!wiring.allRequiredDone()) return 1;
    return 2;
  }

  // ── walkthrough render ────────────────────────────────────────
  function renderWalk() {
    const cur = currentIndex();
    walk.innerHTML = phases.map((ph, i) => {
      const stateCls = i < cur ? 'done' : i === cur ? 'open' : 'future';
      const mark = i < cur ? '✓' : ph.num;
      const body = i === cur ? `
        <div class="gp-body">
          <p class="gp-text">${ph.text}</p>
          <div class="gp-check">${ph.checklist().map(c => `
            <div class="gp-item ${c.done ? 'done' : ''}"><span class="gp-box">${c.done ? '☑' : '☐'}</span>${c.label}</div>`).join('')}</div>
          ${ph.tip ? `<p class="gp-tip">${ph.tip}</p>` : ''}
        </div>` : '';
      return `<div class="gp ${stateCls}">
          <div class="gp-head"><span class="gp-num">${mark}</span><span class="gp-label">${ph.label}</span></div>
          ${body}
        </div>`;
    }).join('');
  }

  // full refresh (called on any state change + polled)
  function refresh() {
    if (walk.classList.contains('hidden')) return;   // lesson/browser view owns the panel
    renderWalk();
  }

  renderWalk();
  try { window.lucide?.createIcons(); } catch {}
  // keep the live checklist honest even when nothing fires a refresh
  setInterval(refresh, 600);

  return {
    refresh, expand, showView,
    hosts: { browser: browserHost, lesson: lessonHost },
    onLessons: (fn) => panel.querySelector('#g-lessons').addEventListener('click', fn),
  };
}
