// Inspector panel — the DOM window into the live RobotDoc. It renders nothing it
// owns: every value comes from `window.__api` (get_document / read_electrical /
// read_telemetry), the same surface the tests and (later) Jarvis drive. This is
// the M1 replacement for the deleted Guide rail — it surfaces the electrical
// solve and its violations, which previously had no on-screen home.
//
// The only mutation it does is inline param edits, which still funnel through
// `api.set_param` — no mutation logic lives here.

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');

// Adaptive current readout: mA below an amp so LEDs read cleanly, A above.
function fmtCurrent(i) {
  if (!Number.isFinite(i)) return { value: '—', unit: '' };
  const a = Math.abs(i);
  if (a < 1) return { value: fmt(a * 1000, a < 0.01 ? 1 : 0), unit: 'mA' };
  return { value: fmt(a, 2), unit: 'A' };
}

// Friendly display names for component types (keeps cards readable). Falls back
// to a Title-cased type for anything not listed, so new parts still look tidy.
const TYPE_LABEL = {
  battery: 'Battery', motor: 'Motor', resistor: 'Resistor', switch: 'Switch',
  potentiometer: 'Potentiometer', led: 'LED', push_button: 'Push Button',
  lamp: 'Lamp', buzzer: 'Buzzer', diode: 'Diode', photoresistor: 'Photoresistor',
  thermistor: 'Thermistor', fuse: 'Fuse', capacitor: 'Capacitor', servo: 'Servo',
  relay: 'Relay',
};
function typeLabel(t) {
  if (TYPE_LABEL[t]) return TYPE_LABEL[t];
  const base = String(t || '').replace(/[_-]+/g, ' ');
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Human labels + step for the params worth exposing in the inspector. Anything
// not listed stays hidden (internal bookkeeping the user shouldn't poke). New
// component types reuse these names where they can; unknown params are dropped
// gracefully by the PARAM_META lookup in paramsHtml().
const PARAM_META = {
  // canonical (library today)
  voltsNominal: { label: 'Volts', step: 0.1, unit: 'V' },
  internalResistance: { label: 'Int. R', step: 0.1, unit: 'Ω' },
  resistance: { label: 'R', step: 1, unit: 'Ω' },
  maxResistance: { label: 'Max R', step: 10, unit: 'Ω' },   // rheostat / pot knob range
  forwardVoltage: { label: 'Vꜰ', step: 0.1, unit: 'V' },
  ke: { label: 'Kᴇ', step: 0.01, unit: '' },
  friction: { label: 'Friction', step: 0.001, unit: '' },
  maxCurrent: { label: 'I max', step: 1, unit: 'A' },
  closed: { label: 'Closed', bool: true },
  // short aliases new components may use (guarded: only rendered if present)
  volts: { label: 'Volts', step: 0.1, unit: 'V' },
  vf: { label: 'Vꜰ', step: 0.1, unit: 'V' },
  imax: { label: 'I max', step: 1, unit: 'A' },
  // new scalars for the incoming parts
  capacitanceUf: { label: 'C', step: 1, unit: 'µF' },    // capacitor (matches library param id)
  angle: { label: 'Angle', step: 1, unit: '°' },          // servo
  light: { label: 'Light', step: 1, unit: '%' },          // photoresistor exposure
  temperature: { label: 'Temp', step: 1, unit: '°C' },    // thermistor
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
      host.innerHTML = `<p class="insp-empty hint">Place a battery and a motor, wire them, then hit Upload to watch it spin.</p>`;
      return;
    }

    const tel = running ? safe(() => api.read_telemetry(), {}) : null;

    host.innerHTML = [
      violationsHtml(elec),
      componentsHtml(comps, elec, tel),
      netsHtml(nets),
    ].join('');
  }

  function componentsHtml(comps, elec, tel) {
    const rows = comps.map((c) => {
      const i = elec.current?.[c.id];
      const cur = fmtCurrent(i);
      const live = Number.isFinite(i) && Math.abs(i) > 1e-4;
      const dir = live ? `<span class="insp-dir">${i >= 0 ? '▲' : '▼'}</span>` : '';
      const ampsReading = Number.isFinite(i)
        ? `<span class="insp-amps ${live ? 'is-live' : ''}" title="current through ${esc(c.id)}">
             ${dir}<b>${cur.value}</b><i class="insp-unit">${cur.unit}</i>
           </span>`
        : `<span class="insp-amps insp-idle" title="no current">—</span>`;
      // motor speed, when the sim is live and reporting ω for this motor
      const w = tel?.omega?.[c.id];
      const speed = Number.isFinite(w)
        ? `<span class="insp-omega" title="shaft speed">${fmt(w, 1)}<i class="insp-unit">rad/s</i></span>`
        : '';
      return `<div class="insp-comp" data-type="${esc(c.type)}">
        <div class="insp-comp-head">
          <span class="insp-id">${esc(c.id)}</span>
          <span class="insp-type">${esc(typeLabel(c.type))}</span>
        </div>
        <div class="insp-readings">${ampsReading}${speed}</div>
        ${paramsHtml(c)}
      </div>`;
    }).join('');
    return `<div class="insp-sect"><div class="insp-h">COMPONENTS <span class="insp-count">${comps.length}</span></div>${rows}</div>`;
  }

  // Editable param row(s) for one component — the tunable knobs from PARAM_META.
  // Params without a PARAM_META entry are silently skipped (unknown-param guard).
  function paramsHtml(c) {
    const params = c.params || {};
    const keys = Object.keys(params).filter(k => PARAM_META[k]);
    if (keys.length === 0) return '';
    const fields = keys.map((k) => {
      const meta = PARAM_META[k];
      const v = params[k];
      if (meta.bool) {
        return `<label class="insp-pfield insp-pbool">
          <input type="checkbox" data-comp="${esc(c.id)}" data-key="${esc(k)}" ${v ? 'checked' : ''}>
          <span>${esc(meta.label)}</span>
        </label>`;
      }
      return `<label class="insp-pfield">
        <span class="insp-plabel">${esc(meta.label)}</span>
        <input type="number" step="${meta.step}" value="${Number.isFinite(v) ? v : ''}"
          data-comp="${esc(c.id)}" data-key="${esc(k)}">
        ${meta.unit ? `<i class="insp-unit">${esc(meta.unit)}</i>` : ''}
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

  // Plain-language coaching for each violation code — the "why + what to do".
  function hintFor(v) {
    switch (v.code) {
      case 'short':
        return 'Both terminals sit on the same wire, so current races straight through with nothing to limit it. Put a load (a resistor, motor, or LED) between + and −.';
      case 'over-current':
        return 'More current is flowing than this part can safely handle. Add a resistor in series, or lower the supply voltage, to bring it down.';
      case 'floating-pin':
        return 'This pin isn’t connected to anything yet — wire it into the circuit to complete the loop.';
      default:
        return '';
    }
  }

  function violationsHtml(elec) {
    const vs = elec.violations || [];
    if (vs.length === 0) {
      return `<div class="insp-sect"><div class="insp-ok"><span class="insp-ok-mark">✓</span> Circuit OK</div></div>`;
    }
    const errN = vs.filter(v => (v.level || 'warn') === 'error').length;
    const summary = errN
      ? `${errN} problem${errN > 1 ? 's' : ''} to fix`
      : `${vs.length} thing${vs.length > 1 ? 's' : ''} to check`;
    const rows = vs.map((v) => {
      const level = esc(v.level || 'warn');
      const hint = hintFor(v);
      return `<div class="insp-viol insp-${level}">
        <div class="insp-viol-head">
          <span class="insp-viol-tag">${esc((v.code || 'issue').replace(/[_-]+/g, ' ').toUpperCase())}</span>
          ${v.ref ? `<span class="insp-ref">${esc(v.ref)}</span>` : ''}
        </div>
        <div class="insp-viol-msg">${esc(v.message || '')}</div>
        ${hint ? `<div class="insp-viol-hint">${esc(hint)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="insp-sect insp-issues">
      <div class="insp-h insp-h-alert">${esc(summary)}</div>${rows}
    </div>`;
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
