// Guide rail: the always-visible, education-first instruction panel docked in
// the workspace. It replaces the old top stepper + full-screen modals — you
// read what to do here and place/wire/program alongside it without clicking
// away. It walks the four phases (Assemble → Wire → Program → Run), advancing
// automatically by observing real app state, and hosts the curriculum lessons
// inline (browser + active lesson card render into this same panel).
import { state } from './state.js';
import { activeRobot } from '../robots/index.js';
import { compInfo } from '../glossary.js';

export function initGuide({ wiring, assemblyApi, getGains, onWire }) {
  const workspace = document.getElementById('workspace');

  // the parts checklist is derived from the active robot's slots, so the guide
  // lists exactly what THIS robot needs (6 parts for the balancer, 8 for the rover)
  const robot = activeRobot();
  const balances = robot.simKey === 'balance';
  const requiredParts = () => robot.slots.map(s => ({
    compType: s.accepts,
    label: compInfo(s.accepts)?.title || s.accepts,
  }));

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
      text: balances
        ? 'Drag every part from the tray onto the glowing pads on the chassis. A self-balancer needs a brain, a balance sensor, a motor driver, two motors, and a battery.'
        : 'Drag every part from the tray onto the glowing pads on the chassis. The rover needs a brain, two motor drivers, four motors, and a battery — no balance sensor, it rolls on four wheels.',
      tip: 'Hover a part’s <b>?</b> to see what it does.',
      checklist: () => requiredParts().map(p => ({ label: p.label, done: partDone(p.compType) })),
      done: () => placedCount() >= activeRobot().slots.length,
    },
    {
      key: 'wire', num: 2, label: 'Wire',
      text: 'Each row below is one connection. <b>Tap it to wire it</b> — or find the two <span style="color:var(--accent)">glowing pins</span> in the 3D view and click them yourself.',
      tip: 'Stuck? <b>Auto-wire</b> in the tray finishes the whole loom at once.',
      checklist: () => wiring.status().map(s => ({ label: s.label, done: s.done })),
      done: () => wiring.allRequiredDone(),
    },
    {
      key: 'program', num: 3, label: 'Program',
      text: balances
        ? 'The Arduino sketch on the right is the robot’s balance controller. Tune the PID gains — <b>Kp</b> reacts to how far it’s tipped, <b>Kd</b> damps the wobble, <b>Ki</b> removes steady lean — then hit <b>UPLOAD</b> (bottom-right) to flash your robot and start it up.'
        : 'The Arduino sketch on the right is the rover’s drive firmware — left and right wheels are driven together (skid-steer). Read it over, then hit <b>UPLOAD</b> (bottom-right) to flash your robot and start it up.',
      tip: balances
        ? 'Reference tune: Kp 15, Ki 140, Kd 0.9. Not sure? The defaults balance — just hit Upload.'
        : 'No tuning needed — just hit Upload and drive.',
      checklist: () => {
        const g = getGains();
        return balances
          ? [
              { label: `Gains set — Kp ${g.Kp} · Ki ${g.Ki} · Kd ${g.Kd}`, done: true },
              { label: 'Hit Upload to flash & run', done: state.mode === 'sim' },
            ]
          : [{ label: 'Hit Upload to flash & run', done: state.mode === 'sim' }];
      },
      done: () => state.mode === 'sim',
    },
    {
      key: 'run', num: 4, label: 'Run',
      text: balances
        ? 'Your robot is live! Drive with <b>W A S D</b>. <b>Space</b> jumps — and rights you after a wipeout. Hit the ramps, mind the ice, and tune the PID sliders live in the panel on the right.'
        : 'Your rover is live! Drive with <b>W A S D</b>. <b>Space</b> jumps — and rights you after a wipeout. Hit the ramps and mind the ice.',
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
    if (placedCount() < activeRobot().slots.length) return 0;
    if (!wiring.allRequiredDone()) return 1;
    return 2;
  }

  // tap a connection row → wire it (touch- and keyboard-accessible path). The
  // wiring onChange fires hud.refreshChecklist → guide.refresh(), which re-renders.
  function connectRow(idx) {
    const req = wiring.required[idx];
    if (!req) return;
    const res = wiring.tryConnect(req.a, req.b);
    onWire?.(res, req);
  }

  // ── walkthrough render ────────────────────────────────────────
  function renderWalk() {
    const cur = currentIndex();
    walk.innerHTML = phases.map((ph, i) => {
      const stateCls = i < cur ? 'done' : i === cur ? 'open' : 'future';
      const mark = i < cur ? '✓' : ph.num;
      let checkHtml = '';
      if (i === cur) {
        const items = ph.checklist();
        if (ph.key === 'wire') {
          // interactive connection list: each row wires that pair on tap; the
          // first unwired row is the highlighted "next" step.
          let nextSeen = false;
          checkHtml = items.map((c, idx) => {
            const isNext = !c.done && !nextSeen;
            if (isNext) nextSeen = true;
            return `<button class="gp-wire ${c.done ? 'done' : ''} ${isNext ? 'next' : ''}" data-wireidx="${idx}" ${c.done ? 'disabled' : ''} type="button">
              <span class="gp-box">${c.done ? '☑' : '☐'}</span><span class="gpw-label">${c.label}</span>${isNext ? '<span class="gpw-next">tap to wire ›</span>' : ''}</button>`;
          }).join('');
        } else {
          checkHtml = items.map(c => `<div class="gp-item ${c.done ? 'done' : ''}"><span class="gp-box">${c.done ? '☑' : '☐'}</span>${c.label}</div>`).join('');
        }
      }
      const body = i === cur ? `
        <div class="gp-body">
          <p class="gp-text">${ph.text}</p>
          <div class="gp-check">${checkHtml}</div>
          ${ph.tip ? `<p class="gp-tip">${ph.tip}</p>` : ''}
        </div>` : '';
      return `<div class="gp ${stateCls}">
          <div class="gp-head"><span class="gp-num">${mark}</span><span class="gp-label">${ph.label}</span></div>
          ${body}
        </div>`;
    }).join('');
    for (const btn of walk.querySelectorAll('.gp-wire:not(.done)')) {
      btn.addEventListener('click', () => connectRow(+btn.dataset.wireidx));
    }
  }

  // point the 3D view at the next connection: glow its two pins amber during Wire.
  function updateWireGuide() {
    const inWire = currentIndex() === 1 && state.mode === 'assembly';
    const next = inWire ? wiring.nextRequired() : null;
    wiring.setGuidePins(next ? [next.a, next.b] : []);
  }

  // full refresh (called on any state change + polled)
  function refresh() {
    if (walk.classList.contains('hidden')) { wiring.setGuidePins([]); return; }   // lesson/browser view owns the panel
    renderWalk();
    updateWireGuide();
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
