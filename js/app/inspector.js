// Inspector panel — the DOM window into the live RobotDoc. It renders nothing it
// owns: every value comes from `window.__api` (get_document / read_electrical /
// read_telemetry), the same surface the tests and (later) Jarvis drive. This is
// the M1 replacement for the deleted Guide rail — it surfaces the electrical
// solve and its violations, which previously had no on-screen home.
//
// Read-only for now: it observes the document and the running solve. Mutation
// stays with the assembly/wiring layer (which also goes through the API).

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');

// Human labels + step for the params worth exposing in the inspector. Anything
// not listed stays hidden (internal bookkeeping the user shouldn't poke).
const PARAM_META = {
  voltsNominal: { label: 'Volts', step: 0.1, unit: 'V' },
  internalResistance: { label: 'Int. R', step: 0.1, unit: 'Ω' },
  resistance: { label: 'R', step: 1, unit: 'Ω' },
  ke: { label: 'Kᴇ', step: 0.01, unit: '' },
  friction: { label: 'Friction', step: 0.001, unit: '' },
  maxCurrent: { label: 'I max', step: 1, unit: 'A' },
  closed: { label: 'Closed', bool: true },
};

export function initInspector(api, { getMode } = {}) {
  const host = document.getElementById('inspector');
  if (!host) return { refresh() {} };

  // Don't clobber a field the user is actively editing (the 400ms poll would
  // otherwise re-innerHTML mid-keystroke and drop focus).
  function isEditing() {
    const a = document.activeElement;
    return a && host.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT');
  }

  function render() {
    if (isEditing()) return;
    const doc = api.get_document();
    const comps = doc.components || [];
    const nets = doc.nets || [];
    const elec = safe(() => api.read_electrical(), { current: {}, violations: [], ok: true });
    const running = getMode ? getMode() === 'sim' : false;

    if (comps.length === 0) {
      host.innerHTML = `<p class="hint">Place a battery and a motor, wire them, then hit Upload to watch it spin.</p>`;
      return;
    }

    const tel = running ? safe(() => api.read_telemetry(), {}) : null;

    host.innerHTML = [
      componentsHtml(comps, elec, tel),
      netsHtml(nets),
      violationsHtml(elec),
    ].join('');
  }

  function componentsHtml(comps, elec, tel) {
    const rows = comps.map((c) => {
      const i = elec.current?.[c.id];
      const amps = Number.isFinite(i) ? `${fmt(Math.abs(i))} A` : '—';
      const dir = Number.isFinite(i) && Math.abs(i) > 1e-4
        ? `<span class="insp-dir">${i >= 0 ? '▲' : '▼'}</span>` : '';
      // motor speed, when the sim is live and reporting ω for this motor
      const w = tel?.omega?.[c.id];
      const speed = Number.isFinite(w) ? `<span class="insp-omega">${fmt(w, 1)} rad/s</span>` : '';
      return `<div class="insp-comp">
        <span class="insp-id">${esc(c.id)}</span>
        <span class="insp-type">${esc(c.type)}</span>
        <span class="insp-amps">${dir}${amps}</span>
        ${speed}
      </div>${paramsHtml(c)}`;
    }).join('');
    return `<div class="insp-sect"><div class="insp-h">COMPONENTS</div>${rows}</div>`;
  }

  // Editable param row(s) for one component — the tunable knobs from PARAM_META.
  function paramsHtml(c) {
    const params = c.params || {};
    const keys = Object.keys(params).filter(k => PARAM_META[k]);
    if (keys.length === 0) return '';
    const fields = keys.map((k) => {
      const meta = PARAM_META[k];
      const v = params[k];
      if (meta.bool) {
        return `<label class="insp-pfield">
          <input type="checkbox" data-comp="${esc(c.id)}" data-key="${esc(k)}" ${v ? 'checked' : ''}>
          <span>${esc(meta.label)}</span>
        </label>`;
      }
      return `<label class="insp-pfield">
        <span>${esc(meta.label)}</span>
        <input type="number" step="${meta.step}" value="${Number.isFinite(v) ? v : ''}"
          data-comp="${esc(c.id)}" data-key="${esc(k)}">
        ${meta.unit ? `<i>${esc(meta.unit)}</i>` : ''}
      </label>`;
    }).join('');
    return `<div class="insp-params">${fields}</div>`;
  }

  function netsHtml(nets) {
    if (nets.length === 0) {
      return `<div class="insp-sect"><div class="insp-h">NETS</div><p class="hint">Nothing wired yet.</p></div>`;
    }
    const rows = nets.map((n) => `<div class="insp-net">
      <span class="insp-swatch" style="background:${esc(n.color || '#888')}"></span>
      <span class="insp-eps">${n.endpoints.map(esc).join(' · ')}</span>
    </div>`).join('');
    return `<div class="insp-sect"><div class="insp-h">NETS <span class="insp-count">${nets.length}</span></div>${rows}</div>`;
  }

  function violationsHtml(elec) {
    const vs = elec.violations || [];
    if (vs.length === 0) {
      return `<div class="insp-sect"><div class="insp-ok">✓ Circuit OK</div></div>`;
    }
    const rows = vs.map((v) => `<div class="insp-viol insp-${esc(v.level || 'warn')}">
      <b>${esc((v.code || '').toUpperCase())}</b> ${esc(v.message || '')}
      ${v.ref ? `<span class="insp-ref">${esc(v.ref)}</span>` : ''}
    </div>`).join('');
    return `<div class="insp-sect">${rows}</div>`;
  }

  // Live param edits → api.set_param. Delegated so it survives re-renders.
  function onEdit(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.comp) return;
    const id = el.dataset.comp, key = el.dataset.key;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else {
      value = parseFloat(el.value);
      if (!Number.isFinite(value)) return;
    }
    api.set_param({ id, key, value });
    if (el.type === 'checkbox') render();   // blur-free; refresh switch state now
  }
  host.addEventListener('change', onEdit);

  // poll: the doc mutates through the API from many places (drag/drop, wiring,
  // undo, scripts) and the solve changes every sim frame — a light poll keeps
  // the panel honest without every mutation path having to call us.
  render();
  const timer = setInterval(render, 400);

  return { refresh: render, stop: () => clearInterval(timer) };
}

function safe(fn, fallback) { try { return fn() ?? fallback; } catch { return fallback; } }
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
