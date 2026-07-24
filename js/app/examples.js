// Example circuits — a browsable gallery of ready-made builds, from a first LED
// to sensor circuits with real physical inputs (a candle warming a thermistor, a
// lamp lighting a photoresistor). Selecting one clears the bench and rebuilds it
// purely through window.__api (place_component + connect), so an example is just
// a scripted user — no special-case loading path.
import { state } from './state.js';

// Each preset lists parts (type + stable id + optional param overrides) and wires
// (endpoint pairs "id.pin"). Positions are auto-assigned on a grid at load time.
export const EXAMPLES = [
  {
    id: 'led-torch', tier: 'Starter', title: 'LED torch',
    blurb: 'Battery → resistor → LED. The resistor keeps the LED from burning out.',
    parts: [
      { type: 'battery', id: 'bat1' },
      { type: 'resistor', id: 'res1', params: { resistance: 220 } },
      { type: 'led', id: 'led1' },
    ],
    wires: [['bat1.+', 'res1.A'], ['res1.B', 'led1.A'], ['led1.K', 'bat1.-']],
  },
  {
    id: 'switch-lamp', tier: 'Starter', title: 'Light switch',
    blurb: 'A switch in series with a lamp. Click the switch on the bench to toggle it.',
    parts: [
      { type: 'battery', id: 'bat1' },
      { type: 'switch', id: 'sw1', params: { closed: true } },
      { type: 'lamp', id: 'lamp1' },
    ],
    wires: [['bat1.+', 'sw1.A'], ['sw1.B', 'lamp1.A'], ['lamp1.B', 'bat1.-']],
  },
  {
    id: 'button-buzzer', tier: 'Starter', title: 'Push-button buzzer',
    blurb: 'Hold the push button to complete the loop and sound the buzzer.',
    parts: [
      { type: 'battery', id: 'bat1' },
      { type: 'push_button', id: 'btn1', params: { closed: true } },
      { type: 'buzzer', id: 'buz1' },
    ],
    wires: [['bat1.+', 'btn1.A'], ['btn1.B', 'buz1.+'], ['buz1.-', 'bat1.-']],
  },
  {
    id: 'pot-dimmer', tier: 'Intermediate', title: 'Motor speed dimmer',
    blurb: 'A potentiometer in series with a motor — scroll its knob to vary the speed.',
    parts: [
      { type: 'battery', id: 'bat1' },
      { type: 'potentiometer', id: 'pot1', params: { resistance: 40 } },
      { type: 'motor', id: 'mot1' },
    ],
    wires: [['bat1.+', 'pot1.A'], ['pot1.B', 'mot1.A'], ['mot1.B', 'bat1.-']],
  },
  {
    id: 'parallel-leds', tier: 'Intermediate', title: 'Two LEDs in parallel',
    blurb: 'One resistor feeds two LEDs sharing a node — see how parallel branches split current.',
    parts: [
      { type: 'battery', id: 'bat1' },
      { type: 'resistor', id: 'res1', params: { resistance: 150 } },
      { type: 'led', id: 'led1' },
      { type: 'led', id: 'led2' },
    ],
    wires: [
      ['bat1.+', 'res1.A'],
      ['res1.B', 'led1.A'], ['res1.B', 'led2.A'],
      ['led1.K', 'bat1.-'], ['led2.K', 'bat1.-'],
    ],
  },
  {
    id: 'diode-oneway', tier: 'Intermediate', title: 'Diode: the one-way valve',
    blurb: 'A diode passes current only A→K. Wired forward the lamp lights; flip the diode (R) and it goes dark.',
    parts: [
      { type: 'battery', id: 'bat1' },
      { type: 'diode', id: 'dio1' },
      { type: 'lamp', id: 'lamp1' },
    ],
    wires: [['bat1.+', 'dio1.A'], ['dio1.K', 'lamp1.A'], ['lamp1.B', 'bat1.-']],
  },
  {
    id: 'fuse-blow', tier: 'Intermediate', title: 'Fuse & overload',
    blurb: 'A low-resistance lamp draws more than the 1 A fuse allows — the Inspector flags the over-current.',
    parts: [
      { type: 'battery', id: 'bat1' },
      { type: 'fuse', id: 'fus1', params: { maxCurrent: 1 } },
      { type: 'lamp', id: 'lamp1', params: { resistance: 4 } },
    ],
    wires: [['bat1.+', 'fus1.A'], ['fus1.B', 'lamp1.A'], ['lamp1.B', 'bat1.-']],
  },
  {
    id: 'relay-motor', tier: 'Advanced', title: 'Relay-switched motor',
    blurb: 'A relay contact (COM→NO) switches the motor. Toggle the relay to energize it.',
    parts: [
      { type: 'battery', id: 'bat1' },
      { type: 'relay', id: 'rel1', params: { closed: true } },
      { type: 'motor', id: 'mot1' },
    ],
    wires: [['bat1.+', 'rel1.COM'], ['rel1.NO', 'mot1.A'], ['mot1.B', 'bat1.-']],
  },
  {
    id: 'thermal-candle', tier: 'Physical inputs', title: '🔥 Heat-sensing lamp',
    blurb: 'A thermistor + lamp. Cold, its high resistance keeps the lamp dark — drag the candle up to it and the lamp lights.',
    note: 'Drag the candle (it appears on the bench) close to the thermistor to heat it.',
    parts: [
      { type: 'battery', id: 'bat1' },
      { type: 'thermistor', id: 'thr1', params: { resistance: 3000, maxResistance: 3000 } },
      { type: 'lamp', id: 'lamp1' },
    ],
    wires: [['bat1.+', 'thr1.A'], ['thr1.B', 'lamp1.A'], ['lamp1.B', 'bat1.-']],
  },
  {
    id: 'light-ldr', tier: 'Physical inputs', title: '💡 Light-sensing LED',
    blurb: 'A photoresistor + LED. In the dark its resistance is high and the LED is off — shine the lamp on it to switch the LED on.',
    note: 'Drag the lamp (it appears on the bench) over the photoresistor to light it.',
    parts: [
      { type: 'battery', id: 'bat1' },
      { type: 'photoresistor', id: 'ldr1', params: { resistance: 3000, maxResistance: 3000 } },
      { type: 'resistor', id: 'res1', params: { resistance: 150 } },
      { type: 'led', id: 'led1' },
    ],
    wires: [['bat1.+', 'ldr1.A'], ['ldr1.B', 'res1.A'], ['res1.B', 'led1.A'], ['led1.K', 'bat1.-']],
  },
];

export function initExamples({ api, hud, onLoad, exitSim } = {}) {
  const workspace = document.getElementById('workspace');
  if (!workspace) return { load() {} };

  // launcher button
  const btn = document.createElement('button');
  btn.id = 'examples-btn';
  btn.type = 'button';
  btn.title = 'Load an example circuit';
  btn.innerHTML = `<span aria-hidden="true">⚡</span><span>Examples</span>`;
  workspace.appendChild(btn);

  // popover panel
  const panel = document.createElement('div');
  panel.id = 'examples-panel';
  panel.className = 'hidden';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Example circuits');

  const tiers = [...new Set(EXAMPLES.map(e => e.tier))];
  panel.innerHTML =
    `<div class="ex-head"><b>Example circuits</b>` +
    `<button class="ex-close" aria-label="Close">✕</button></div>` +
    `<div class="ex-body">` +
    tiers.map(tier =>
      `<div class="ex-group"><div class="ex-tier">${tier}</div>` +
      EXAMPLES.filter(e => e.tier === tier).map(e =>
        `<button class="ex-item" data-id="${e.id}">` +
        `<span class="ex-title">${e.title}</span>` +
        `<span class="ex-blurb">${e.blurb}</span></button>`).join('') +
      `</div>`).join('') +
    `</div>`;
  workspace.appendChild(panel);

  function open() { panel.classList.remove('hidden'); }
  function close() { panel.classList.add('hidden'); }
  btn.addEventListener('click', () => panel.classList.toggle('hidden'));
  panel.querySelector('.ex-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  function load(preset) {
    if (state.mode === 'sim') exitSim?.();
    // clear whatever's on the bench
    for (const c of api.get_document().components) api.remove_component({ id: c.id });
    // place on a loose grid so parts don't stack (bench physics settles them)
    const cols = 4;
    preset.parts.forEach((p, i) => {
      const gx = ((i % cols) - (cols - 1) / 2) * 10;
      const gz = (Math.floor(i / cols) - 0.5) * 10;
      const r = api.place_component({
        type: p.type, id: p.id, params: p.params,
        transform: { pos: [gx, 2, gz], rot: [0, 0, 0] },
      });
      if (!r.ok) hud?.flash?.(`Couldn't place ${p.type}: ${r.errors?.[0] || ''}`, 'bad');
    });
    for (const [from, to] of preset.wires) api.connect({ from, to });
    hud?.flash?.(`Loaded: ${preset.title}`, 'ok');
    if (preset.note) hud?.setStatus?.(preset.note);
    onLoad?.(preset);
    close();
  }

  panel.querySelectorAll('.ex-item').forEach(el => {
    el.addEventListener('click', () => {
      const preset = EXAMPLES.find(e => e.id === el.dataset.id);
      if (preset) load(preset);
    });
  });

  return { load, open, close };
}
