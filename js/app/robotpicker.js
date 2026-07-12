// Robot picker — a popover opened from the top-bar robot chip that lists the
// roster (js/robots). Today only the self-balancer is buildable; the rover and
// line-follower show as "Coming soon". This is the content-library surface that
// makes the app read as a product with breadth (Brief 1), and the seam the M4
// robots plug into. Selecting an available robot sets state.activeRobotId.
import { ROBOTS, activeRobot, switchRobot } from '../robots/index.js';
import { state } from './state.js';

export function initRobotPicker({ anchor }) {
  const pop = document.createElement('div');
  pop.id = 'robot-picker';
  pop.className = 'hidden';
  document.body.appendChild(pop);

  function render() {
    const curId = state.activeRobotId;
    pop.innerHTML = `
      <div class="rp-head">SELECT ROBOT</div>
      ${ROBOTS.map(r => `
        <button class="rp-card ${r.id === curId ? 'active' : ''} ${r.available ? '' : 'soon'}"
                data-robot="${r.id}" ${r.available ? '' : 'disabled'}>
          <div class="rp-top">
            <span class="rp-name">${r.name}</span>
            <span class="rp-tag">${r.available ? (r.id === curId ? 'Active' : 'Build') : 'Soon'}</span>
          </div>
          <p class="rp-blurb">${r.blurb}</p>
        </button>`).join('')}`;
    pop.querySelectorAll('.rp-card:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        close();
        switchRobot(btn.dataset.robot);  // persist + reload so the app re-inits on the new def
      });
    });
  }

  function open() { render(); pop.classList.remove('hidden'); positionUnder(); }
  function close() { pop.classList.add('hidden'); }
  function toggle() { pop.classList.contains('hidden') ? open() : close(); }

  function positionUnder() {
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.round(r.left)}px`;
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
  }

  anchor.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  // dismiss on outside click / Escape
  document.addEventListener('click', (e) => {
    if (!pop.classList.contains('hidden') && !pop.contains(e.target) && e.target !== anchor) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  return { open, close, current: () => activeRobot() };
}
