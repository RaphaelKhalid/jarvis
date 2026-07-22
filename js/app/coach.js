// First-run onboarding coach — a tiny "build your first circuit" checklist that
// teaches the core loop (place → wire → run) without a heavyweight tutorial.
// It owns no state: every step's "done" is derived by looking at the live
// document + electrical solve through window.__api, the same surface the tests
// and Jarvis use. Once the user completes it (or dismisses it) we remember that
// in localStorage and never show it again.
import { baseType } from '../model/library.js';
import { state } from './state.js';

const SEEN_KEY = 'jarvis-coached';

// Each step: a label + a predicate over { doc, elec, mode }. Steps are checked
// in order; the first not-yet-done step is the "current" one.
const STEPS = [
  { label: 'Drag a battery onto the bench',
    done: ({ doc }) => doc.components.some(c => baseType(c.type) === 'battery') },
  { label: 'Drag a motor onto the bench',
    done: ({ doc }) => doc.components.some(c => baseType(c.type) === 'motor') },
  { label: 'Wire the battery + to the motor',
    done: ({ doc }) => wired(doc, 'power+', 'motor') },
  { label: 'Wire the battery − to close the loop',
    done: ({ elec }) => Object.values(elec.current || {}).some(i => Math.abs(i) > 0.01) },
  { label: 'Press RUN to watch it spin',
    done: ({ mode }) => mode === 'sim' },
];

// is a battery power pin (+/−) on the same net as any motor pin?
function wired(doc, role, targetType) {
  const batPins = pinsWithRole(doc, 'battery', role);
  const motorEps = new Set(epsOfType(doc, targetType));
  return doc.nets.some(n => n.endpoints.some(e => batPins.has(e)) &&
    n.endpoints.some(e => motorEps.has(e)));
}
function pinsWithRole(doc, type, role) {
  // map by the known library roles: battery + is power+, − is power-
  const wanted = role === 'power+' ? '+' : '-';
  const out = new Set();
  for (const c of doc.components) if (baseType(c.type) === type) out.add(`${c.id}.${wanted}`);
  return out;
}
function epsOfType(doc, type) {
  const out = [];
  for (const c of doc.components) if (baseType(c.type) === type) out.push(`${c.id}.A`, `${c.id}.B`);
  return out;
}

export function initCoach(api) {
  const host = document.getElementById('coach');
  const list = document.getElementById('coach-steps');
  if (!host || !list) return { stop() {} };

  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* ignore */ }
  if (seen) return { stop() {} };

  list.innerHTML = STEPS.map((s, i) =>
    `<li data-i="${i}"><span class="coach-check">○</span><span class="coach-label">${s.label}</span></li>`).join('');
  host.classList.remove('hidden');

  function dismiss() {
    host.classList.add('hidden');
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    clearInterval(timer);
  }
  document.getElementById('coach-dismiss')?.addEventListener('click', dismiss);

  function render() {
    const ctx = {
      doc: safe(() => api.get_document(), { components: [], nets: [] }),
      elec: safe(() => api.read_electrical(), { current: {} }),
      mode: state.mode,
    };
    // first step whose predicate is false is the "current" one; all before it done
    let current = STEPS.length;
    for (let i = 0; i < STEPS.length; i++) {
      if (!safe(() => STEPS[i].done(ctx), false)) { current = i; break; }
    }
    [...list.children].forEach((li, i) => {
      const done = i < current;
      li.classList.toggle('done', done);
      li.classList.toggle('current', i === current);
      li.querySelector('.coach-check').textContent = done ? '✓' : (i === current ? '▸' : '○');
    });
    if (current >= STEPS.length) {   // all done — celebrate briefly, then retire
      host.classList.add('coach-complete');
      setTimeout(dismiss, 2200);
    }
  }

  render();
  const timer = setInterval(render, 500);
  return { stop: () => clearInterval(timer), dismiss };
}

function safe(fn, fallback) { try { return fn() ?? fallback; } catch { return fallback; } }
