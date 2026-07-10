// Touch driving controls: a left-thumb virtual stick (drive + steer) and a
// right-side JUMP button. Only shown on coarse-pointer devices, in sim mode.
// Feeds the same sim.input channels as the keyboard (see input.js).
import { state, subscribe } from './state.js';

export function initTouch({ sim }) {
  const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!coarse) return null;

  const root = document.createElement('div');
  root.id = 'touch-controls';
  root.className = 'hidden';
  root.innerHTML = `
    <div id="tc-stick"><div id="tc-knob"></div></div>
    <button id="tc-jump" aria-label="Jump">JUMP</button>`;
  document.getElementById('workspace').appendChild(root);

  const stick = root.querySelector('#tc-stick');
  const knob = root.querySelector('#tc-knob');
  const jump = root.querySelector('#tc-jump');

  subscribe('mode', (m) => root.classList.toggle('hidden', m !== 'sim'));

  const R = 52;   // stick radius in px
  let activeId = null;

  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (state.booting) { sim.input.fwd = 0; sim.input.turn = 0; return; }
    sim.input.fwd = -dy / R;        // up = forward
    sim.input.turn = dx / R;        // right = steer right
  }

  stick.addEventListener('pointerdown', (e) => {
    activeId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    setKnob(dx, dy);
    e.preventDefault();
  });
  const release = (e) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    setKnob(0, 0);
  };
  stick.addEventListener('pointerup', release);
  stick.addEventListener('pointercancel', release);

  jump.addEventListener('pointerdown', (e) => {
    if (!state.booting) sim.jumpOrRecover();
    e.preventDefault();
  });

  return { root };
}
