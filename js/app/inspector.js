// Inspector panel — the DOM window into the live RobotDoc. It renders nothing it
// owns: every value comes from `window.__api` (get_document / read_electrical /
// read_telemetry), the same surface the tests and (later) Jarvis drive. This is
// the M1 replacement for the deleted Guide rail — it surfaces the electrical
// solve and its violations, which previously had no on-screen home.
//
// Read-only for now: it observes the document and the running solve. Mutation
// stays with the assembly/wiring layer (which also goes through the API).

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');

export function initInspector(api, { getMode } = {}) {
  const host = document.getElementById('inspector');
  if (!host) return { refresh() {} };

  function render() {
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
      </div>`;
    }).join('');
    return `<div class="insp-sect"><div class="insp-h">COMPONENTS</div>${rows}</div>`;
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
