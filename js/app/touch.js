// Touch driving controls: a left-thumb virtual stick (drive + steer) and a
// right-side JUMP button. Only shown on coarse-pointer devices, in sim mode.
// Feeds the same sim.input channels as the keyboard (see input.js).
//
// iOS/Safari notes:
//  - All interactive elements get `touch-action:none` inline so Safari never
//    turns a thumb drag into page scroll / rubber-band, and so there is no
//    300ms tap delay (touch-action already kills it on modern iOS, but we also
//    call preventDefault on the raw touch path as a belt-and-suspenders).
//  - Pointer Events are the primary path; we register a passive touch fallback
//    only if PointerEvent is unavailable (older iOS). We never register BOTH
//    for the same gesture, to avoid double-firing.
//  - Safe-area insets are exposed as CSS custom properties on the root
//    (--tc-safe-*) so the stylesheet can inset the controls out from under the
//    home indicator / notch in landscape without this module owning layout.
import { state, subscribe } from './state.js';

export function initTouch({ sim }) {
  const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!coarse) return null;

  const root = document.createElement('div');
  root.id = 'touch-controls';
  root.className = 'hidden';
  // Safe-area hooks the CSS can consume for landscape insets.
  root.style.setProperty('--tc-safe-bottom', 'env(safe-area-inset-bottom, 0px)');
  root.style.setProperty('--tc-safe-left', 'env(safe-area-inset-left, 0px)');
  root.style.setProperty('--tc-safe-right', 'env(safe-area-inset-right, 0px)');
  root.innerHTML = `
    <div id="tc-stick"><div id="tc-knob"></div></div>
    <button id="tc-jump" type="button" aria-label="Jump">JUMP</button>`;
  document.getElementById('workspace').appendChild(root);

  const stick = root.querySelector('#tc-stick');
  const knob = root.querySelector('#tc-knob');
  const jump = root.querySelector('#tc-jump');

  // Functional (not layout): guarantee the gesture surfaces never scroll the
  // page, independent of whether the CSS agent has styled them yet.
  for (const el of [root, stick, knob, jump]) {
    el.style.touchAction = 'none';
    el.style.webkitUserSelect = 'none';
    el.style.userSelect = 'none';
    el.style.webkitTouchCallout = 'none';
  }

  subscribe('mode', (m) => root.classList.toggle('hidden', m !== 'sim'));

  const R = 52;   // stick radius in px
  let activeId = null;

  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (state.booting) { sim.input.fwd = 0; sim.input.turn = 0; return; }
    sim.input.fwd = -dy / R;        // up = forward
    sim.input.turn = dx / R;        // right = steer right
  }

  // Resolve the stick center from a client x/y and drive the sim.
  function driveFrom(clientX, clientY) {
    const r = stick.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    setKnob(dx, dy);
  }

  const hasPointer = typeof window.PointerEvent === 'function';

  if (hasPointer) {
    stick.addEventListener('pointerdown', (e) => {
      if (activeId !== null) return;       // ignore a second finger on the stick
      activeId = e.pointerId;
      try { stick.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      driveFrom(e.clientX, e.clientY);
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeId) return;
      driveFrom(e.clientX, e.clientY);
      e.preventDefault();
    }, { passive: false });
    const release = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      setKnob(0, 0);
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
    stick.addEventListener('lostpointercapture', release);

    jump.addEventListener('pointerdown', (e) => {
      if (!state.booting) sim.jumpOrRecover();
      e.preventDefault();
    });
  } else {
    // Legacy Touch Events fallback (older iOS without Pointer Events).
    stick.addEventListener('touchstart', (e) => {
      if (activeId !== null) return;
      const t = e.changedTouches[0];
      activeId = t.identifier;
      driveFrom(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    stick.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === activeId) { driveFrom(t.clientX, t.clientY); break; }
      }
      e.preventDefault();
    }, { passive: false });
    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === activeId) { activeId = null; setKnob(0, 0); break; }
      }
    };
    stick.addEventListener('touchend', endTouch);
    stick.addEventListener('touchcancel', endTouch);

    jump.addEventListener('touchstart', (e) => {
      if (!state.booting) sim.jumpOrRecover();
      e.preventDefault();
    }, { passive: false });
  }

  return { root };
}
