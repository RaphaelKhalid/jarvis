// Curriculum engine: interprets lesson data, applies setups, evaluates
// objective predicates each frame, awards stars, persists progress.
import { LESSONS, TRACKS } from './lessons.js';
import { state } from '../app/state.js';
import { activeRobot } from '../robots/index.js';

// a lesson belongs to a robot (default the self-balancer for the original set)
const lessonRobot = (l) => l.robot || 'self-balancer';

const PROGRESS_KEY = 'sbl-progress-v1';

export function initCurriculum({ sim, wiring, assemblyApi, hud, setSketchGains, guide, onProgress }) {
  let active = null;   // { lesson, objIdx, t, holdT, counters }
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch {}

  function saveProgress() {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch {}
    onProgress?.(progress);   // cloud-sync hook (best-effort)
  }

  // merge a remote progress doc in (max stars per lesson — never lose a star),
  // persist, and re-render the browser if it's open. Returns true if it changed.
  function applyRemoteProgress(remote) {
    if (!remote || typeof remote !== 'object') return false;
    let changed = false;
    for (const [id, stars] of Object.entries(remote)) {
      if ((progress[id] || 0) < stars) { progress[id] = stars; changed = true; }
    }
    if (changed) {
      try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch {}
      if (!browser.classList.contains('hidden')) openOverlay();
    }
    return changed;
  }

  function starsFor(id) { return progress[id] || 0; }
  function trackLessons(trackId) { return LESSONS.filter(l => l.track === trackId); }
  function isUnlocked(lesson) {
    const list = trackLessons(lesson.track);
    const idx = list.indexOf(lesson);
    return idx === 0 || starsFor(list[idx - 1].id) > 0;
  }

  // ── objective predicates ─────────────────────────────────────
  // Each returns true when met this frame; `secs` holds are handled generically.
  function objectiveMet(o, c) {
    switch (o.type) {
      case 'place': {
        const n = o.n || 1;
        const count = Object.values(assemblyApi.placed)
          .filter(p => (o.part === 'motor' ? p.compType.startsWith('motor') : p.compType === o.part)).length;
        return count >= n;
      }
      case 'placeAll': return assemblyApi.getPlacedCount() >= activeRobot().slots.length;
      case 'wire': return wiring.wires.some(w => w.valid && w.req && w.req.label === o.label);
      case 'wireAll': return wiring.allRequiredDone();
      case 'gain': {
        const v = state.gains[o.k];
        return v >= o.min && v <= o.max;
      }
      case 'sim': return state.mode === 'sim' && !state.booting;
      case 'upright': return state.mode === 'sim' && !sim.fallen && !sim._airborne;
      case 'speed': return state.mode === 'sim' && (sim.driveSpeed || 0) >= o.min;
      case 'reach': {
        if (state.mode !== 'sim' || !sim.bodies.chassis) return false;
        const p = sim.chassisPos();
        return Math.hypot(p.x - o.x, p.z - o.z) <= o.r;
      }
      case 'material': return state.mode === 'sim' && sim.material === o.name && !sim.fallen;
      case 'airborne': return state.mode === 'sim' && !!sim._airborne;
      case 'fallen': return state.mode === 'sim' && !!sim.fallen;
      case 'recover': return state.mode === 'sim' && !sim.fallen && c.sawFallen;
      case 'wobble': return state.mode === 'sim' && Math.abs(sim._wobble || 0) > 0.05;
      case 'turns': return c.turnAccum >= o.rad;
      case 'jumps': return c.jumpCount >= o.n;
      case 'odometer': return c.odo >= o.dist;
      default: return false;
    }
  }

  // ── lesson lifecycle ─────────────────────────────────────────
  function start(lessonId) {
    const lesson = LESSONS.find(l => l.id === lessonId);
    if (!lesson || !isUnlocked(lesson)) return;
    if (state.mode === 'sim') return hud.flash('Go back to Assembly first', 'bad');

    const s = lesson.setup || {};
    if (s.clear) assemblyApi.clearBoard();
    // build the ACTIVE robot's full board (self-balancer: 6 parts; rover: 8)
    if (s.assemble) for (const def of activeRobot().parts) for (let i = 0; i < def.count; i++) assemblyApi.placeByType(def.type);
    if (s.wire) autoWireAll();
    if (s.gains) setSketchGains(s.gains);

    active = {
      lesson, objIdx: 0, t: 0, holdT: 0,
      counters: { turnAccum: 0, jumpCount: 0, odo: 0, sawFallen: false, wasAir: false, prevHeading: sim.heading || 0, prevPos: null },
    };
    renderCard();
    hud.refreshChecklist();
  }

  function autoWireAll() {
    // wire the active robot's own loom (self-balancer or rover), not a fixed set
    for (const r of activeRobot().required) {
      const exists = wiring.wires.some(w => w.req && w.req.label === r.label);
      if (!exists) wiring.tryConnect(r.a, r.b);
    }
    hud.refreshChecklist();
  }

  function quit() {
    active = null;
    guide.showView('walk');
    guide.refresh();
  }

  function complete() {
    const { lesson, t } = active;
    let stars = 3;
    if (lesson.par) stars = t <= lesson.par ? 3 : t <= lesson.par * 2 ? 2 : 1;
    progress[lesson.id] = Math.max(progress[lesson.id] || 0, stars);
    saveProgress();
    renderDebrief(lesson, stars);
    active = null;
  }

  // ── per-frame tick (called from the render loop) ─────────────
  function tick(dt) {
    if (!active) return;
    const c = active.counters;
    active.t += dt;

    // counters that need frame-to-frame deltas
    if (state.mode === 'sim' && sim.bodies.chassis) {
      if (sim.fallen) c.sawFallen = true;
      const air = !!sim._airborne;
      if (air && !c.wasAir) c.jumpCount++;
      c.wasAir = air;
      if ((sim.driveSpeed || 0) > 5) {
        let dh = (sim.heading || 0) - c.prevHeading;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        c.turnAccum += Math.abs(dh);
      }
      c.prevHeading = sim.heading || 0;
      const p = sim.chassisPos();
      if (c.prevPos && !sim.fallen) c.odo += Math.hypot(p.x - c.prevPos.x, p.z - c.prevPos.z);
      if (sim.fallen && active.lesson.objectives[active.objIdx]?.type === 'odometer') c.odo = 0;   // wipeout resets the run
      c.prevPos = { x: p.x, z: p.z };
    }

    const o = active.lesson.objectives[active.objIdx];
    if (!o) return complete();
    if (objectiveMet(o, c)) {
      if (o.secs) {
        active.holdT += dt;
        renderObjectiveProgress(Math.min(1, active.holdT / o.secs));
        if (active.holdT < o.secs) return;
      }
      active.holdT = 0;
      active.objIdx++;
      if (active.objIdx >= active.lesson.objectives.length) return complete();
      renderCard();
    } else if (o.secs && active.holdT > 0) {
      active.holdT = 0;   // hold broken — restart the clock
      renderObjectiveProgress(0);
    } else if (o.type === 'odometer') {
      renderObjectiveProgress(Math.min(1, c.odo / o.dist));
    } else if (o.type === 'turns') {
      renderObjectiveProgress(Math.min(1, c.turnAccum / o.rad));
    } else if (o.type === 'jumps') {
      renderObjectiveProgress(Math.min(1, c.jumpCount / o.n));
    }
  }

  // ── UI: lesson card (rendered inline into the Guide rail) ─────
  const card = guide.hosts.lesson;

  function renderCard() {
    const { lesson, objIdx } = active;
    guide.showView('lesson');
    card.innerHTML = `
      <div class="l-top"><span class="l-track">${TRACKS.find(t => t.id === lesson.track).name}</span>
        <button class="l-quit" id="l-quit" aria-label="Quit lesson">✕</button></div>
      <div class="l-title">${lesson.title}</div>
      <div class="l-brief">${lesson.brief}</div>
      <div class="l-objs">${lesson.objectives.map((o, i) => `
        <div class="l-obj ${i < objIdx ? 'done' : i === objIdx ? 'current' : ''}">
          <span>${i < objIdx ? '☑' : '☐'}</span>${o.text}</div>`).join('')}</div>
      <div class="l-bar"><div class="l-fill"></div></div>`;
    document.getElementById('l-quit').addEventListener('click', quit);
  }
  function renderObjectiveProgress(k) {
    const f = card.querySelector('.l-fill');
    if (f) f.style.width = (k * 100).toFixed(0) + '%';
  }
  function renderDebrief(lesson, stars) {
    const list = trackLessons(lesson.track);
    const next = list[list.indexOf(lesson) + 1];
    // this completion just unlocked `next` if it's still unplayed (0 stars)
    const unlockedNext = next && starsFor(next.id) === 0;
    card.innerHTML = `
      <div class="l-top"><span class="l-track">LESSON COMPLETE</span></div>
      <div class="l-title">${lesson.title}</div>
      <div class="l-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
      <div class="l-learned">WHAT YOU LEARNED</div>
      <div class="l-brief">${lesson.debrief}</div>
      ${unlockedNext ? `<div class="l-unlock">🔓 Unlocked: <b>${next.title}</b></div>` : ''}
      <div class="l-btns">
        <button id="l-next">${next ? 'Next lesson' : 'More lessons'}</button>
        <button id="l-close">Close</button>
      </div>`;
    document.getElementById('l-close').addEventListener('click', () => { guide.showView('walk'); guide.refresh(); });
    document.getElementById('l-next').addEventListener('click', () => {
      const list = trackLessons(lesson.track);
      const next = list[list.indexOf(lesson) + 1];
      if (next) { if (state.mode === 'sim') hud.flash('Head back to Assembly to start it', 'bad'); openOverlay(); }
      else openOverlay();
    });
  }

  // ── UI: lesson browser (rendered inline into the Guide rail) ──
  const browser = guide.hosts.browser;

  function openOverlay() {
    guide.showView('browser');
    const robotId = state.activeRobotId;
    // only this robot's lessons (self-balancer and rover have distinct tracks)
    const visibleTracks = TRACKS.filter(t => LESSONS.some(l => l.track === t.id && lessonRobot(l) === robotId));
    const otherHasLessons = LESSONS.some(l => lessonRobot(l) !== robotId);
    const robotLessons = LESSONS.filter(l => lessonRobot(l) === robotId);
    const doneCount = robotLessons.filter(l => starsFor(l.id) > 0).length;
    const totalStars = robotLessons.reduce((s, l) => s + starsFor(l.id), 0);
    const maxStars = robotLessons.length * 3;
    browser.innerHTML = `
      <div class="learn-head"><h2>Lessons</h2><button id="learn-close" aria-label="Back to guide">✕</button></div>
      <div class="learn-progress">
        <div class="lp-row"><span>${doneCount}/${robotLessons.length} lessons</span><span class="lp-stars">★ ${totalStars}/${maxStars}</span></div>
        <div class="lp-bar"><div class="lp-fill" style="width:${robotLessons.length ? (doneCount / robotLessons.length * 100).toFixed(0) : 0}%"></div></div>
      </div>
      ${otherHasLessons ? `<div class="lt-blurb learn-switch-hint">Switch robots in the top bar to see the other robot’s lessons.</div>` : ''}
      ${visibleTracks.map(t => {
        const list = trackLessons(t.id).filter(l => lessonRobot(l) === robotId);
        const tDone = list.filter(l => starsFor(l.id) > 0).length;
        return `
        <div class="learn-track">
          <div class="lt-head"><span class="lt-name">${t.name}</span><span class="lt-count">${tDone}/${list.length}</span></div>
          <div class="lt-blurb">${t.blurb}</div>
          <div class="lt-lessons">
            ${list.map(l => {
              const unlocked = isUnlocked(l);
              const st = starsFor(l.id);
              const isNew = unlocked && st === 0;
              return `<button class="lt-lesson ${unlocked ? '' : 'locked'}" data-lesson="${l.id}" ${unlocked ? '' : 'disabled'}>
                <span class="ltl-title">${l.title}${isNew ? '<span class="ltl-new">NEW</span>' : ''}</span>
                <span class="ltl-stars">${st ? '★'.repeat(st) + '☆'.repeat(3 - st) : unlocked ? '' : '🔒'}</span>
              </button>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}`;
    document.getElementById('learn-close').addEventListener('click', () => { guide.showView('walk'); guide.refresh(); });
    for (const btn of browser.querySelectorAll('[data-lesson]')) {
      btn.addEventListener('click', () => start(btn.dataset.lesson));
    }
  }

  return {
    start, quit, tick, openOverlay, starsFor, applyRemoteProgress,
    getProgress: () => ({ ...progress }),
    get active() { return active; },
  };
}
