// First-run onboarding coach — a tiny "build your first circuit" checklist that
// teaches the core loop (place → wire → run) without a heavyweight tutorial.
// It owns no state: every step's "done" is derived by looking at the live
// document + electrical solve through window.__api, the same surface the tests
// and Jarvis use. Once the user completes it (or dismisses it) we remember that
// in localStorage and never show it again.
import { baseType } from '../model/library.js';
import { state } from './state.js';

const SEEN_KEY = 'jarvis-coached';

// Each step: a short label, an optional one-line hint, and a predicate over
// { doc, elec, mode }. Steps are checked in order; the first not-yet-done step
// is the "current" one and shows its hint.
const STEPS = [
  { label: 'Drag a battery onto the bench',
    hint: 'Grab it from the parts tray on the left.',
    done: ({ doc }) => hasType(doc, 'battery') },
  { label: 'Drag a motor onto the bench',
    hint: 'One more part from the tray — the motor is what spins.',
    done: ({ doc }) => hasType(doc, 'motor') },
  { label: 'Wire battery + to the motor',
    hint: 'Click the battery + pin, then a motor pin to join them.',
    done: ({ doc }) => wired(doc, 'power+', 'motor') },
  { label: 'Close the loop so current flows',
    hint: 'Wire battery − back to the motor. The Inspector will show current.',
    done: ({ elec }) => currentFlows(elec) },
  { label: 'Press RUN to watch it spin',
    hint: 'Hit RUN (top right) to drop into the physics sim.',
    done: ({ mode }) => mode === 'sim' },
];

// is a battery power pin (+/−) on the same net as any motor pin?
function wired(doc, role, targetType) {
  const batPins = pinsWithRole(doc, 'battery', role);
  const motorEps = new Set(epsOfType(doc, targetType));
  return doc.nets.some(n => n.endpoints.some(e => batPins.has(e)) &&
    n.endpoints.some(e => motorEps.has(e)));
}
function hasType(doc, type) { return doc.components.some(c => baseType(c.type) === type); }
function currentFlows(elec) {
  return Object.values(elec.current || {}).some(i => Math.abs(i) > 0.01);
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
    `<li data-i="${i}">
       <span class="coach-check">○</span>
       <span class="coach-body">
         <span class="coach-label">${s.label}</span>
         <span class="coach-hint">${s.hint || ''}</span>
       </span>
     </li>`).join('');

  // A friendly nudge that Jarvis can do the whole thing for you — the
  // learning-curve flattener. Injected once, below the steps.
  const nudge = document.createElement('div');
  nudge.className = 'coach-nudge';
  nudge.innerHTML = `New to this? <button type="button" class="coach-ask" ` +
    `aria-label="Open Jarvis and ask it to build the circuit">Ask Jarvis to build it ✨</button>`;
  host.appendChild(nudge);
  nudge.querySelector('.coach-ask')?.addEventListener('click', () => {
    // open Jarvis and pre-fill a starter prompt; it's just the DOM, no coupling.
    const jv = document.getElementById('jarvis');
    jv?.classList.remove('collapsed');
    const inp = document.getElementById('jarvis-input');
    if (inp) { inp.value = 'wire a battery to a motor and run it'; inp.focus(); }
  });

  host.classList.remove('hidden');

  let done = false;
  function dismiss() {
    if (done) return;
    done = true;
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
      const isDone = i < current;
      li.classList.toggle('done', isDone);
      li.classList.toggle('current', i === current);
      li.querySelector('.coach-check').textContent = isDone ? '✓' : (i === current ? '▸' : '○');
    });
    if (current >= STEPS.length && !host.classList.contains('coach-complete')) {
      celebrate();
    }
  }

  function celebrate() {
    host.classList.add('coach-complete');
    nudge.remove();
    const banner = document.createElement('div');
    banner.className = 'coach-done';
    banner.innerHTML = `🎉 <b>Nice — your first circuit is alive!</b>` +
      `<span>That's the whole loop: place → wire → run. Build anything from here.</span>`;
    host.appendChild(banner);
    setTimeout(dismiss, 3600);
  }

  render();
  const timer = setInterval(render, 500);
  return { stop: () => clearInterval(timer), dismiss };
}

function safe(fn, fallback) { try { return fn() ?? fallback; } catch { return fallback; } }
