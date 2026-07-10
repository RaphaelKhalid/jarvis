// Keyboard + pointer input for sim driving, gated by state.mode.
// Exposes named axes ('drive', 'steer') so future control schemes
// (touch sticks, gamepad) can feed the same channels without rewrites.
import * as THREE from 'three';
import { state } from './state.js';
import { audio } from '../audio.js';

const DRIVE_KEYS = { w: 1, a: 1, s: 1, d: 1 };
const CAM_KEYS = { arrowup: 1, arrowdown: 1, arrowleft: 1, arrowright: 1 };

export function initInput({ canvas, sim }) {
  const keys = new Set();
  const camKeys = new Set();
  // camera orbit state (offset from the auto chase behind the heading)
  const cam = { yaw: 0, elev: 0.36, zoom: 1, dragging: false };

  function axis(name) {
    if (name === 'drive') return (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
    if (name === 'steer') return (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    return 0;
  }

  function updateDriveInput() {
    if (state.booting) { sim.input.fwd = 0; sim.input.turn = 0; return; }   // locked during boot
    sim.input.fwd = axis('drive');
    sim.input.turn = axis('steer');
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (state.mode !== 'sim') return;
    if (k === ' ' || k === 'spacebar') { if (!state.booting) { sim.jumpOrRecover(); audio.nudge(); } e.preventDefault(); }
    else if (DRIVE_KEYS[k]) { keys.add(k); updateDriveInput(); e.preventDefault(); }
    else if (CAM_KEYS[k]) { camKeys.add(k); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (DRIVE_KEYS[k]) { keys.delete(k); updateDriveInput(); }
    else if (CAM_KEYS[k]) camKeys.delete(k);
  });

  // mouse-drag to orbit the camera while driving
  canvas.addEventListener('pointerdown', (e) => { if (state.mode === 'sim' && e.button === 0) cam.dragging = true; });
  window.addEventListener('pointerup', () => { cam.dragging = false; });
  canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'sim' || !cam.dragging) return;
    cam.yaw -= e.movementX * 0.005;
    cam.elev = THREE.MathUtils.clamp(cam.elev + e.movementY * 0.004, 0.06, 1.35);
  });
  canvas.addEventListener('wheel', (e) => {
    if (state.mode !== 'sim') return;
    cam.zoom = THREE.MathUtils.clamp(cam.zoom * (1 + e.deltaY * 0.001), 0.5, 2.4);
    e.preventDefault();
  }, { passive: false });

  return { axis, cam, camKeys, clearKeys: () => keys.clear(), updateDriveInput };
}
