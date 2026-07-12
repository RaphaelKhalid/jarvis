// Curriculum engine: interprets lesson data, applies setups, evaluates
// objective predicates each frame, awards stars, persists progress.
import { LESSONS, TRACKS } from './lessons.js';
import { state } from '../app/state.js';

const PROGRESS_KEY = 'sbl-progress-v1';

export function initCurriculum({ sim, wiring, assemblyApi, hud, setSketchGains, guide }) {
  let active = null;   // { lesson, objIdx, t, holdT, counters }
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch {}

  function saveProgress() {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch {}
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
      case 'placeAll': return assemblyApi.getPlacedCount() >= 6;
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
    if (s.assemble) for (const t of ['arduino', 'mpu6050', 'l298n', 'motor', 'motor', 'battery']) assemblyApi.placeByType(t);
    if (s.wire) autoWireAll();
    if (s.gains) setSketchGains(s.gains);

    active = {
      lesson, objIdx: 0, t: 0, holdT: 0,
      counters: { turnAccum: 0, jumpCount: 0, odo: 0, sawFallen: false, wasAir: false, prevHeading: sim.heading || 0, prevPos: null },
    };
    renderCard();
    hud.refreshChecklist();
  }

  async function autoWireAll() {
    const { REQUIRED } = await import('../wiring.js');
    for (const r of REQUIRED) {
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
    card.innerHTML = `
      <div class="l-top"><span class="l-track">LESSON COMPLETE</span></div>
      <div class="l-title">${lesson.title}</div>
      <div class="l-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
      <div class="l-brief">${lesson.debrief}</div>
      <div class="l-btns">
        <button id="l-next">Next lesson</button>
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
    browser.innerHTML = `
      <div class="learn-head"><h2>Lessons</h2><button id="learn-close" aria-label="Back to guide">✕</button></div>
      ${TRACKS.map(t => `
        <div class="learn-track">
          <div class="lt-name">${t.name}</div>
          <div class="lt-blurb">${t.blurb}</div>
          <div class="lt-lessons">
            ${trackLessons(t.id).map(l => {
              const unlocked = isUnlocked(l);
              const st = starsFor(l.id);
              return `<button class="lt-lesson ${unlocked ? '' : 'locked'}" data-lesson="${l.id}" ${unlocked ? '' : 'disabled'}>
                <span class="ltl-title">${l.title}</span>
                <span class="ltl-stars">${st ? '★'.repeat(st) + '☆'.repeat(3 - st) : unlocked ? '' : '🔒'}</span>
              </button>`;
            }).join('')}
          </div>
        </div>`).join('')}`;
    document.getElementById('learn-close').addEventListener('click', () => { guide.showView('walk'); guide.refresh(); });
    for (const btn of browser.querySelectorAll('[data-lesson]')) {
      btn.addEventListener('click', () => start(btn.dataset.lesson));
    }
  }

  return { start, quit, tick, openOverlay, starsFor, get active() { return active; } };
}
