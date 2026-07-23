// Creator assembly — the M1 build surface, fused to window.__api. It owns NO
// document state: it renders the 3D world as a pure view over api.get_document()
// and every user action (drop a part, wire two pins, clear) is an API call
// followed by a re-sync. This replaces the self-balancer's slot-tray + REQUIRED
// wiring (assembly.js + wiring.js) for the doc-model world.
//
//   tray drag → api.place_component     pin → pin → api.connect
//   clear     → api.remove_component    right-click a wire → api.disconnect
//
// The doc is the single source of truth; undo/redo/scripts all flow back here
// through sync() because the API's onDocChange fires it.
import * as THREE from 'three';
import { LIBRARY, pinsFor, baseType } from '../model/library.js';
import { makeBattery, makeMotor } from '../parts.js';
import { makeFlatLabel } from '../labels.js';
import { loadRapier } from '../sim.js';
import { pinInfo } from '../glossary.js';
import { audio } from '../audio.js';
import { state } from './state.js';
import { KIND_LABEL } from './hud.js';
import { track, trackOnce } from './analytics.js';

// tray metadata (name/desc/help) per library type — the human-facing card copy.
const CARD = {
  battery: { name: '7.4V LiPo', swatch: '#3d5a8f', desc: '2S battery pack',
    help: 'The power source. Its + and − terminals push current through whatever you wire across them.' },
  motor: { name: 'DC Gear Motor', swatch: '#f0c020', desc: 'Geared motor + wheel',
    help: 'Current through A→B makes it spin. Reverse the wires and it spins the other way.' },
  resistor: { name: 'Resistor', swatch: '#d8c9a0', desc: '100 Ω, in series',
    help: 'Limits current. Put one in series with the motor and it draws less — the motor spins slower. Non-polar: either lead works.' },
  switch: { name: 'Switch', swatch: '#7bd88f', desc: 'Break / make the loop',
    help: 'Click the switch body to open or close the circuit. Open = no current = the motor stops.' },
  led: { name: 'LED', swatch: '#ff5566', desc: 'Lights when current flows',
    help: 'Polar: current only flows anode (A, long leg) → cathode (K). Wire it the right way and it glows; backwards it stays dark. Needs a resistor in series or it burns out.' },
  potentiometer: { name: 'Potentiometer', swatch: '#8fb3ff', desc: 'A knob you turn to vary resistance',
    help: 'A variable resistor. Scroll on the knob (or edit R in the Inspector) to change its resistance live — turn it down and the motor speeds up / the LED brightens.' },
  push_button: { name: 'Push Button', swatch: '#7bd88f', desc: 'Momentary tactile switch',
    help: 'A momentary switch — conducts only while pressed. Great for triggering an action on demand.' },
  lamp: { name: 'Lamp', swatch: '#ffd27a', desc: 'Incandescent bulb',
    help: 'A filament bulb. Non-polar: current either way heats the filament and it glows brighter the more current flows.' },
  buzzer: { name: 'Buzzer', swatch: '#3a3f4a', desc: 'Piezo sounder',
    help: 'Makes a tone when current flows through it. Wire it across a source to hear it buzz.' },
  diode: { name: 'Diode', swatch: '#5a606c', desc: 'One-way current valve',
    help: 'Polar: current only flows anode (A) → cathode (K, the banded end). Blocks reverse current — a rectifier.' },
  photoresistor: { name: 'Photoresistor', swatch: '#c9b063', desc: 'Light-dependent resistor',
    help: 'Its resistance drops as light hits its face. Non-polar — a light sensor for the circuit.' },
  thermistor: { name: 'Thermistor', swatch: '#c86b4a', desc: 'Temperature-sensitive resistor',
    help: 'Its resistance changes with temperature. Non-polar — a heat sensor for the circuit.' },
  fuse: { name: 'Fuse', swatch: '#c9c9d0', desc: 'Overcurrent protection',
    help: 'A thin link that carries current until it exceeds the rated limit — protects the rest of the circuit.' },
  capacitor: { name: 'Capacitor', swatch: '#2a8f8f', desc: 'Stores charge',
    help: 'Stores and releases charge. Smooths and buffers a circuit; blocks steady DC once charged.' },
  servo: { name: 'Servo', swatch: '#4d7bd8', desc: 'Positional motor',
    help: 'A geared motor that holds a commanded angle. Three wires: power, ground, and a signal line.' },
  relay: { name: 'Relay', swatch: '#3d5a8f', desc: 'Electrically-switched contact',
    help: 'An electrically-operated switch: energising its coil throws a separate, higher-power contact.' },
};

// tray category per type — powers the filter chips as the catalog grows.
const CATEGORY = {
  battery: 'Power',
  motor: 'Output', led: 'Output', lamp: 'Output', buzzer: 'Output', servo: 'Output',
  resistor: 'Passive', capacitor: 'Passive', diode: 'Passive', fuse: 'Passive',
  switch: 'Control', push_button: 'Control', potentiometer: 'Control', relay: 'Control',
  photoresistor: 'Sensor', thermistor: 'Sensor',
};
const CATEGORY_ORDER = ['Power', 'Output', 'Passive', 'Control', 'Sensor'];

// A motor mesh whose two terminals are named A / B (to match the library),
// reusing the self-balancer's nicely-detailed motor geometry.
function makeMotorAB() {
  const g = makeMotor(1);
  g.userData.type = 'motor';
  const names = ['A', 'B'];
  g.userData.pins.forEach((p, i) => {
    p.name = names[i] || p.name;
    // the motor geometry labels its terminals M+/M-; the library names them A/B.
    // swap the visible flat label so the pin you click matches its tooltip id.
    const old = p.obj.userData.labelMesh;
    const lp = p.obj.userData.labelPos;
    if (old && lp) {
      g.remove(old); old.geometry?.dispose?.();
      const fresh = makeFlatLabel(p.name, 0.32, { color: '#e8eef5' });
      fresh.position.set(lp.x, lp.y + 0.02, lp.z + 0.34 * lp.side);
      g.add(fresh); p.obj.userData.labelMesh = fresh;
    }
  });
  return g;   // g.userData.wheelMeshes (tire+hub) carries through for build-mode spin
}
// small gold lead-pin, registered as an endpoint on the group.
function addLeadPin(g, name, x, y, z) {
  const pin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.35 }));
  pin.position.set(x, y + 0.25, z);
  g.userData.pins.push({ name, obj: pin });
  g.add(pin);
  return pin;
}

// passive resistor: beige body with colour bands + two leads (A, B).
function makeResistorMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'resistor', pins: [] };
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 2.6, 16),
    new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.6 }));
  body.rotation.z = Math.PI / 2; body.position.y = 1.2; body.castShadow = true;
  g.add(body);
  [0x8b4513, 0x111111, 0xaa2222, 0xc8a000].forEach((c, i) => {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.63, 0.63, 0.22, 16),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    band.rotation.z = Math.PI / 2; band.position.set(-0.7 + i * 0.42, 1.2, 0);
    g.add(band);
  });
  addLeadPin(g, 'A', -1.7, 1.2, 0);
  addLeadPin(g, 'B', 1.7, 1.2, 0);
  return g;
}

// switch: base + tilting lever + indicator dot. Click the body to toggle (wired
// in the click handler); the lever/indicator reflect params.closed via sync().
function makeSwitchMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'switch', pins: [] };
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.9, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7, metalness: 0.2 }));
  base.position.y = 0.45; base.castShadow = true;
  g.add(base);
  const lever = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.35, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xb0b4bc, metalness: 0.6, roughness: 0.4 }));
  lever.position.set(0, 1.05, 0); lever.rotation.z = 0.4;
  lever.userData.role = 'sw-lever';
  g.add(lever);
  const ind = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x333a33, emissive: 0x000000, emissiveIntensity: 1 }));
  ind.position.set(0.95, 0.95, 0.95); ind.userData.role = 'sw-ind';
  g.add(ind);
  addLeadPin(g, 'A', -1.7, 0.9, 0);
  addLeadPin(g, 'B', 1.7, 0.9, 0);
  return g;
}

// reflect a switch component's closed state on its lever + indicator.
function updateSwitchVisual(group, closed) {
  group.traverse((o) => {
    if (o.userData?.role === 'sw-lever') o.rotation.z = closed ? -0.4 : 0.4;
    if (o.userData?.role === 'sw-ind') o.material.emissive.setHex(closed ? 0x2ecc71 : 0x000000);
  });
}

// LED: a domed lens (role 'led-lens', glows with current) on two legs (A = long
// anode leg, K = short cathode leg). The dome catches the bloom pass when lit.
function makeLedMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'led', pins: [] };
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
    new THREE.MeshStandardMaterial({ color: 0xff5566, emissive: 0xff2233,
      emissiveIntensity: 0, roughness: 0.25, metalness: 0.1,
      transparent: true, opacity: 0.9 }));
  lens.position.y = 1.5; lens.userData.role = 'led-lens'; lens.castShadow = true;
  g.add(lens);
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.82, 0.82, 0.5, 20),
    new THREE.MeshStandardMaterial({ color: 0xcc3344, roughness: 0.4 }));
  collar.position.y = 1.05; g.add(collar);
  addLeadPin(g, 'A', -0.4, 0.0, 0);   // long leg = anode
  addLeadPin(g, 'K', 0.4, 0.0, 0);    // short leg = cathode
  return g;
}

// brightness ∝ current toward its rated max; dark when reverse-biased / off.
function updateLedVisual(group, amps, maxCurrent) {
  const frac = Math.max(0, Math.min(1, Math.abs(amps || 0) / Math.max(maxCurrent || 0.03, 1e-6)));
  group.traverse((o) => {
    if (o.userData?.role === 'led-lens') o.material.emissiveIntensity = frac * 2.4;
  });
}

// potentiometer: a body with a turnable knob (role 'pot-knob') + a pointer
// notch, on two leads (A, B). The knob's angle reflects the resistance.
function makePotMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'potentiometer', pins: [] };
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.9, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.7, metalness: 0.2 }));
  body.position.y = 0.45; body.castShadow = true;
  g.add(body);
  const knob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.8, 0.8, 20),
    new THREE.MeshStandardMaterial({ color: 0x8fb3ff, roughness: 0.4, metalness: 0.3 }));
  knob.position.y = 1.2; knob.userData.role = 'pot-knob'; knob.castShadow = true;
  const notch = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.2, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x0a0f1a, roughness: 0.5 }));
  notch.position.set(0, 0.5, 0.35);
  knob.add(notch);
  g.add(knob);
  addLeadPin(g, 'A', -1.4, 0.45, 0);
  addLeadPin(g, 'B', 1.4, 0.45, 0);
  return g;
}

// rotate the knob to reflect the resistance fraction (0 = full CCW, 1 = full CW)
function updatePotVisual(group, frac) {
  const a = -Math.PI * 0.75 + Math.max(0, Math.min(1, frac)) * Math.PI * 1.5;
  group.traverse((o) => { if (o.userData?.role === 'pot-knob') o.rotation.y = a; });
}

// ── new catalog geometry (data-driven pins) ───────────────────────
// Shared instrument-look materials so the growing catalog reads as one family.
const MAT = {
  darkCase: () => new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.62, metalness: 0.25 }),
  metal: () => new THREE.MeshStandardMaterial({ color: 0xc6ccd6, roughness: 0.32, metalness: 0.85 }),
  glass: (c = 0xbfe4ff) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.35 }),
};

// Attach lead pins whose names/count come straight from the library, so wiring
// works no matter what the library agent named them. Pins spread along X (or Z),
// centred, sitting at the given base height.
function attachLibraryPins(g, type, { y = 0, z = 0, spread = null, along = 'x' } = {}) {
  const pins = pinsFor(type);
  const n = pins.length || 2;
  const width = spread ?? Math.max(1.4, (n - 1) * 1.1 + 1.0);
  pins.forEach((p, i) => {
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5);   // -0.5 … 0.5
    const px = along === 'x' ? t * width : 0;
    const pz = along === 'z' ? t * width : z;
    addLeadPin(g, p.name, px, y, pz);
  });
}

// push-button: square housing with a round tactile cap on top (role 'btn-cap').
function makeButtonMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'push_button', pins: [] };
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 2.0), MAT.darkCase());
  base.position.y = 0.35; base.castShadow = true; g.add(base);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.7, 0.55, 20),
    new THREE.MeshStandardMaterial({ color: 0x7bd88f, roughness: 0.45, metalness: 0.15 }));
  cap.position.y = 0.95; cap.userData.role = 'btn-cap'; cap.castShadow = true; g.add(cap);
  attachLibraryPins(g, 'push_button', { y: 0.7, spread: 3.0 });
  return g;
}
// reflect closed(pressed) state: cap sinks + tints green.
function updateButtonVisual(group, closed) {
  group.traverse((o) => {
    if (o.userData?.role !== 'btn-cap') return;
    o.position.y = closed ? 0.82 : 0.95;
    o.material.color.setHex(closed ? 0x2ecc71 : 0x7bd88f);
  });
}

// lamp: a glass bulb on a brass screw base with a filament that glows w/ current.
function makeLampMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'lamp', pins: [] };
  const baseM = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.62, 0.9, 16),
    new THREE.MeshStandardMaterial({ color: 0xb8860b, roughness: 0.4, metalness: 0.7 }));
  baseM.position.y = 0.9; g.add(baseM);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.0, 22, 18),
    new THREE.MeshStandardMaterial({ color: 0xfff4d0, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.4 }));
  glass.position.y = 2.2; glass.castShadow = true; g.add(glass);
  const fil = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xffcf6b, emissive: 0xffaa22, emissiveIntensity: 0 }));
  fil.position.y = 2.1; fil.userData.role = 'lamp-fil'; g.add(fil);
  attachLibraryPins(g, 'lamp', { y: 0.35, spread: 1.6 });
  return g;
}
function updateLampVisual(group, amps, maxCurrent) {
  const frac = Math.max(0, Math.min(1, Math.abs(amps || 0) / Math.max(maxCurrent || 0.5, 1e-6)));
  group.traverse((o) => {
    if (o.userData?.role === 'lamp-fil') o.material.emissiveIntensity = frac * 3.0;
  });
}

// buzzer: a black cylindrical can with a top sound port.
function makeBuzzerMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'buzzer', pins: [] };
  const can = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.5, 24), MAT.darkCase());
  can.position.y = 0.75; can.castShadow = true; g.add(can);
  const port = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 16),
    new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.8 }));
  port.position.y = 1.51; g.add(port);
  attachLibraryPins(g, 'buzzer', { y: 0.0, spread: 1.2 });
  return g;
}

// diode: glass cylinder body with a cathode band + two axial leads.
function makeDiodeMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'diode', pins: [] };
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.0, 16),
    new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.35, metalness: 0.4 }));
  body.rotation.z = Math.PI / 2; body.position.y = 1.0; body.castShadow = true; g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.53, 0.28, 16),
    new THREE.MeshStandardMaterial({ color: 0xd8dde5, roughness: 0.5 }));
  band.rotation.z = Math.PI / 2; band.position.set(0.6, 1.0, 0); g.add(band);   // toward cathode (K)
  attachLibraryPins(g, 'diode', { y: 1.0, spread: 3.2 });
  return g;
}

// photoresistor: round ceramic face with a serpentine sensor track.
function makePhotoresistorMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'photoresistor', pins: [] };
  const face = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.4, 24),
    new THREE.MeshStandardMaterial({ color: 0xc9b063, roughness: 0.5, metalness: 0.2 }));
  face.position.y = 0.9; face.rotation.x = Math.PI / 2; face.castShadow = true; g.add(face);
  for (let i = 0; i < 4; i++) {
    const trk = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x5a4a1a, roughness: 0.6 }));
    trk.position.set(0, 1.12, -0.5 + i * 0.33); g.add(trk);
  }
  attachLibraryPins(g, 'photoresistor', { y: 0.0, spread: 1.4 });
  return g;
}

// thermistor: a small epoxy bead on two leads.
function makeThermistorMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'thermistor', pins: [] };
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0xc86b4a, roughness: 0.5, metalness: 0.1 }));
  bead.position.y = 1.4; bead.scale.set(1, 1.15, 0.7); bead.castShadow = true; g.add(bead);
  attachLibraryPins(g, 'thermistor', { y: 0.0, spread: 1.2 });
  return g;
}

// fuse: a clear glass tube with metal end caps + a filament wire.
function makeFuseMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'fuse', pins: [] };
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 18), MAT.glass(0xcfe6ff));
  tube.rotation.z = Math.PI / 2; tube.position.y = 1.0; g.add(tube);
  for (const x of [-1.0, 1.0]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.5, 18), MAT.metal());
    cap.rotation.z = Math.PI / 2; cap.position.set(x, 1.0, 0); cap.castShadow = true; g.add(cap);
  }
  const fil = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.4, metalness: 0.7 }));
  fil.position.y = 1.0; g.add(fil);
  attachLibraryPins(g, 'fuse', { y: 1.0, spread: 3.0 });
  return g;
}

// capacitor: an electrolytic can with a vented top + a polarity stripe.
function makeCapacitorMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'capacitor', pins: [] };
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.6, 24),
    new THREE.MeshStandardMaterial({ color: 0x2a8f8f, roughness: 0.4, metalness: 0.35 }));
  can.position.y = 1.55; can.castShadow = true; g.add(can);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.2, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.6 }));
  stripe.position.set(0, 1.55, 0.9); g.add(stripe);
  // vent cross on the top
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.06, 24),
    new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.7 }));
  vent.position.y = 2.86; g.add(vent);
  attachLibraryPins(g, 'capacitor', { y: 0.0, spread: 1.2 });
  return g;
}

// servo: the classic blue box with a white output horn (role 'servo-horn').
function makeServoMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'servo', pins: [] };
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.6, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x2f5fc0, roughness: 0.5, metalness: 0.2 }));
  body.position.y = 1.3; body.castShadow = true; g.add(body);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.7, 18),
    new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.6 }));
  boss.position.set(1.0, 2.85, 0); g.add(boss);
  const horn = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 0.34),
    new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.5 }));
  horn.position.set(1.0, 3.25, 0); horn.userData.role = 'servo-horn'; g.add(horn);
  // mounting tabs
  for (const x of [-2.2, 2.2]) {
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x2f5fc0, roughness: 0.5 }));
    tab.position.set(x, 1.9, 0); g.add(tab);
  }
  attachLibraryPins(g, 'servo', { y: 0.9, z: -0.9, spread: 2.4 });
  return g;
}

// relay: a translucent blue cube case over a visible coil + contact.
function makeRelayMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'relay', pins: [] };
  const shell = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.8, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x3a6bd0, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.55 }));
  shell.position.y = 1.4; shell.castShadow = true; g.add(shell);
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.6, 16),
    new THREE.MeshStandardMaterial({ color: 0xb8860b, roughness: 0.5, metalness: 0.6 }));
  coil.position.set(-0.7, 1.2, 0); g.add(coil);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xc6ccd6, roughness: 0.35, metalness: 0.8 }));
  arm.position.set(0.7, 1.3, 0); g.add(arm);
  attachLibraryPins(g, 'relay', { y: 0.0, spread: null });
  return g;
}

const FACTORY = {
  battery: makeBattery, motor: makeMotorAB, resistor: makeResistorMesh,
  switch: makeSwitchMesh, led: makeLedMesh, potentiometer: makePotMesh,
  push_button: makeButtonMesh, lamp: makeLampMesh, buzzer: makeBuzzerMesh,
  diode: makeDiodeMesh, photoresistor: makePhotoresistorMesh, thermistor: makeThermistorMesh,
  fuse: makeFuseMesh, capacitor: makeCapacitorMesh, servo: makeServoMesh, relay: makeRelayMesh,
};

const KIND_COLOR = { power: 0xff4d4d, ground: 0x2a2f3a, data: 0xffd166 };
const TW_OPEN = 'crosshair';

function pinTooltipHtml(id) {
  const info = pinInfo(id);
  if (!info) return `<b>${id}</b>`;
  const tag = KIND_LABEL[info.kind] || '';
  return `<span class="tt-tag tt-${info.kind}">${tag}</span><b>${info.title}</b>` +
         `<div class="tt-role">${info.role}</div><span class="unit">${id}</span>`;
}

export function initCreatorAssembly({ canvas, scene, camera, controls, api, hud }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const group = new THREE.Group();
  scene.add(group);
  const wireGroup = new THREE.Group();
  group.add(wireGroup);

  const meshes = new Map();        // compId -> THREE.Group
  const endpoints = new Map();     // "compId.pin" -> pin mesh
  const wires = [];                // { mesh, ids:[a,b] }
  let pending = null;              // armed endpoint id (click-to-wire)

  canvas.style.cursor = TW_OPEN;

  // ── bench physics: real Rapier gravity + collisions in the BUILD view ──
  // Every placed part becomes a dynamic rigid body on a ground plane, so parts
  // fall onto the bench, collide, and stack. Rotations are locked (parts stay
  // upright at their authored yaw; R sets yaw via the doc) — position is the
  // only thing physics owns. The doc transform stays the persisted "rest" pose;
  // physics drives the live mesh position each frame and wires follow.
  const GROUND_Y = 0;              // bench-top surface; parts rest with their base here
  const BOUND = 26;                // low walls keep parts on the bench
  let phys = null;                 // { RAPIER, world, bodies:Map(id→body) }
  let physStarted = false;

  // Lazily boot the physics world the first time a part exists — no reason to
  // load Rapier at page open for a build that goes straight to RUN.
  function maybeInitPhysics() {
    if (physStarted || phys) return;
    if (api.get_document().components.length === 0) return;
    physStarted = true;
    initBenchPhysics();
  }
  async function initBenchPhysics() {
    let RAPIER;
    try { RAPIER = await loadRapier(); } catch { return; }   // stay static if Rapier fails
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // ground
    const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, GROUND_Y - 1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(BOUND + 6, 1, BOUND + 6).setFriction(0.9), gb);
    // four walls
    for (const [x, z, hx, hz] of [[BOUND, 0, 1, BOUND], [-BOUND, 0, 1, BOUND], [0, BOUND, BOUND, 1], [0, -BOUND, BOUND, 1]]) {
      const wb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, GROUND_Y + 3, z));
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 4, hz), wb);
    }
    phys = { RAPIER, world, bodies: new Map() };
    ensureBodies();   // parts placed before Rapier finished loading
  }

  // spawn a dynamic body for a component. The collider is sized to the part's
  // ACTUAL mesh bounds (not a fat fixed footprint) so parts rest flush on the
  // bench and sit close together — realistic gravity, not oversized bubbles.
  function makeBody(c, dropIn) {
    const { RAPIER, world } = phys;
    const p = c.transform?.pos || [0, 1, 0];

    // measure the mesh in local space (temporarily neutralise its transform)
    const g = meshes.get(c.id);
    let hx, hy, hz, cx, cy, cz;
    if (g) {
      const savedPos = g.position.clone(), savedRot = g.rotation.clone();
      g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      g.position.copy(savedPos); g.rotation.copy(savedRot); g.updateMatrixWorld(true);
      const size = box.getSize(new THREE.Vector3());
      const ctr = box.getCenter(new THREE.Vector3());
      hx = Math.max(size.x / 2, 0.3); hy = Math.max(size.y / 2, 0.3); hz = Math.max(size.z / 2, 0.3);
      cx = ctr.x; cy = ctr.y; cz = ctr.z;
    } else {
      const f = footprint(c.type); hx = hz = f; hy = 1; cx = cz = 0; cy = 1;
    }

    // rest height so the mesh's true base sits on the bench (y=0):
    //   body.y + (cy - hy) = GROUND_Y  ⇒  restY = GROUND_Y + hy - cy
    const restY = GROUND_Y + hy - cy;
    // stagger drops + jitter XZ so coincident drops don't launch (overlap solve)
    const jit = () => (Math.random() - 0.5) * 0.8;
    const y = dropIn ? restY + 5 + phys.bodies.size * (hy * 2 + 1) : Math.max(p[1], restY);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p[0] + jit(), y, p[2] + jit())
        .enabledRotations(false, false, false)      // stay upright; yaw is doc-driven
        .setLinearDamping(0.35));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz)
        .setFriction(0.9).setRestitution(0).setDensity(1), body);
    phys.bodies.set(c.id, body);
    return body;
  }

  // reconcile physics bodies with the doc (create new, drop removed)
  function ensureBodies() {
    if (!phys) return;
    const live = new Set(api.get_document().components.map(c => c.id));
    for (const [id, body] of phys.bodies) {
      if (!live.has(id)) { phys.world.removeRigidBody(body); phys.bodies.delete(id); }
    }
    for (const c of api.get_document().components) {
      if (!phys.bodies.has(c.id)) makeBody(c, true);
    }
  }

  // ── parts tray ────────────────────────────────────────────────
  const tray = document.getElementById('parts-tray');

  // Search + category filters above the tray so parts stay findable as the
  // catalog grows. Filter state is live; renderTray() re-filters the cards.
  let searchText = '';
  let activeCat = 'All';

  const trayControls = document.createElement('div');
  trayControls.className = 'tray-controls';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'tray-search';
  search.placeholder = 'Search parts…';
  search.setAttribute('aria-label', 'Search parts');
  trayControls.appendChild(search);

  const chipRow = document.createElement('div');
  chipRow.className = 'tray-filters';
  chipRow.setAttribute('role', 'group');
  chipRow.setAttribute('aria-label', 'Filter parts by category');
  for (const cat of ['All', ...CATEGORY_ORDER]) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tray-chip' + (cat === 'All' ? ' is-active' : '');
    chip.dataset.cat = cat;
    chip.textContent = cat;
    chip.setAttribute('aria-pressed', cat === 'All' ? 'true' : 'false');
    chip.addEventListener('click', () => {
      activeCat = cat;
      for (const c of chipRow.children) {
        const on = c === chip;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      renderTray();
    });
    chipRow.appendChild(chip);
  }
  trayControls.appendChild(chipRow);
  tray.parentNode.insertBefore(trayControls, tray);

  const emptyMsg = document.createElement('div');
  emptyMsg.className = 'tray-empty';
  emptyMsg.textContent = 'No parts match your search.';
  emptyMsg.hidden = true;
  tray.parentNode.insertBefore(emptyMsg, tray.nextSibling);

  search.addEventListener('input', () => { searchText = search.value.trim().toLowerCase(); renderTray(); });

  function matches(type, meta, cat) {
    if (activeCat !== 'All' && cat !== activeCat) return false;
    if (!searchText) return true;
    const hay = `${meta.name} ${type} ${meta.desc} ${cat}`.toLowerCase();
    return hay.includes(searchText);
  }

  function renderTray() {
    tray.innerHTML = '';
    let shown = 0;
    for (const type of Object.keys(LIBRARY)) {
      const meta = CARD[type] || { name: type, swatch: '#888', desc: '', help: '' };
      const cat = CATEGORY[type] || 'Other';
      if (!matches(type, meta, cat)) continue;
      shown++;
      const card = document.createElement('div');
      card.className = 'part-card';
      card.dataset.type = type;
      card.dataset.category = cat;
      card.innerHTML = `
        <div class="part-name"><span class="part-swatch" style="background:${meta.swatch}"></span>${meta.name}</div>
        <div class="part-desc">${meta.desc}</div>
        <span class="help-icon" title="">?</span>`;
      tray.appendChild(card);
      const help = card.querySelector('.help-icon');
      help.addEventListener('mouseenter', (e) => hud.showTooltip(e, meta.help));
      help.addEventListener('mouseleave', hud.hideTooltip);
      help.addEventListener('mousemove', hud.moveTooltip);
      card.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('help-icon')) return;
        if (state.mode !== 'assembly') return;
        startDrag(type, e);
      });
    }
    emptyMsg.hidden = shown > 0;
  }
  renderTray();

  // ── drag a card onto the workspace → api.place_component ───────
  let drag = null;
  function startDrag(type, e) {
    const meta = CARD[type] || { name: type, swatch: '#888' };
    const ghost = document.createElement('div');
    ghost.className = 'part-card';
    ghost.style.cssText = 'position:fixed;z-index:200;pointer-events:none;opacity:.85;width:200px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
    ghost.innerHTML = `<div class="part-name"><span class="part-swatch" style="background:${meta.swatch}"></span>${meta.name}</div>`;
    document.body.appendChild(ghost);
    drag = { type, ghost };
    moveGhost(e);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  }
  function moveGhost(e) {
    if (!drag) return;
    drag.ghost.style.left = (e.clientX + 14) + 'px';
    drag.ghost.style.top = (e.clientY - 10) + 'px';
  }
  function onDragMove(e) { moveGhost(e); }
  function onDragEnd(e) {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    const { type } = drag;
    drag.ghost.remove();
    drag = null;
    const rect = canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
    // drop point on the y=1 plane; the part spawns above it and falls onto the
    // bench under gravity, colliding with whatever's already there.
    const pos = dropPoint(e) || [0, 1, 0];
    const res = api.place_component({ type, transform: { pos, rot: [0, 0, 0] } });
    if (res.ok) { audio.place(); trackOnce('place', { type }); }
    sync();
    hud.setStatus(api.get_document().components.length >= 2
      ? 'Click a pin, then its target pin, to wire them'
      : 'Keep placing parts…');
    hud.refreshChecklist();
  }
  const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
  function dropPoint(e) {
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(_plane, hit)) return null;
    return [hit.x, 1, hit.z];
  }

  // XZ footprint half-extent per component — the box collider size that gives
  // parts solidity (they collide/stack under Rapier gravity, below).
  const FOOTPRINT = {
    battery: 3.4, motor: 5.0, resistor: 2.2, switch: 2.4, led: 1.8, potentiometer: 1.6,
    push_button: 1.6, lamp: 1.4, buzzer: 1.3, diode: 1.9, photoresistor: 1.4,
    thermistor: 1.2, fuse: 1.9, capacitor: 1.2, servo: 2.4, relay: 1.8,
  };
  const footprint = (type) => FOOTPRINT[baseType(type)] || 2.6;

  // rotate a placed part about Y (R key / scroll while grabbing). Rotations are
  // physics-locked, so yaw lives in the doc and sync() applies it to the mesh.
  function rotateComp(id, delta) {
    const c = api.get_document().components.find(x => x.id === id);
    if (!c) return;
    const rot = [...(c.transform?.rot || [0, 0, 0])];
    rot[1] += delta;
    api.move_component({ id, pos: c.transform?.pos, rot });
    audio.ui();
  }

  // ── sync: reconcile the 3D world with the document ────────────
  function sync() {
    const doc = api.get_document();
    const live = new Set(doc.components.map(c => c.id));
    // solved currents drive live glows (LED brightness); best-effort.
    let elec = null;
    try { elec = api.read_electrical(); } catch { /* ignore */ }

    // add / move component meshes
    for (const c of doc.components) {
      let g = meshes.get(c.id);
      if (!g) {
        g = (FACTORY[baseType(c.type)] || makeBattery)();
        for (const p of g.userData.pins) {
          const epId = `${c.id}.${p.name}`;
          p.obj.userData.endpointId = epId;
          endpoints.set(epId, p.obj);
        }
        group.add(g);
        meshes.set(c.id, g);
      }
      const p = c.transform?.pos || [0, 1, 0];
      const r = c.transform?.rot || [0, 0, 0];
      // yaw is always doc-driven; position is owned by physics once a body
      // exists (animate copies it), so only seed position when there's no body.
      g.rotation.set(r[0], r[1], r[2]);
      if (!phys?.bodies.has(c.id)) g.position.set(p[0], p[1], p[2]);
      if (baseType(c.type) === 'switch') updateSwitchVisual(g, c.params?.closed === true);
      if (baseType(c.type) === 'push_button') updateButtonVisual(g, c.params?.closed === true);
      if (baseType(c.type) === 'lamp') updateLampVisual(g, elec?.current?.[c.id], c.params?.maxCurrent);
      if (baseType(c.type) === 'led') updateLedVisual(g, elec?.current?.[c.id], c.params?.maxCurrent);
      if (baseType(c.type) === 'potentiometer') {
        updatePotVisual(g, (c.params?.resistance || 0) / (c.params?.maxResistance || 1000));
      }
    }
    // remove meshes for deleted components
    for (const [id, g] of meshes) {
      if (live.has(id)) continue;
      group.remove(g);
      g.traverse(o => o.geometry?.dispose?.());
      meshes.delete(id);
      for (const key of [...endpoints.keys()]) if (key.startsWith(id + '.')) endpoints.delete(key);
      if (pending && pending.startsWith(id + '.')) pending = null;
    }
    maybeInitPhysics();   // boot Rapier on first placement
    ensureBodies();       // keep the physics world in step with the doc
    group.updateMatrixWorld(true);
    rebuildWires(doc.nets);
  }

  // wires are a view over doc.nets: one tube per adjacent endpoint pair
  function rebuildWires(nets) {
    for (const w of wires) { wireGroup.remove(w.mesh); w.mesh.geometry.dispose(); }
    wires.length = 0;
    for (const net of nets) {
      const kind = netKind(net);
      const eps = net.endpoints;
      for (let i = 1; i < eps.length; i++) addWire(eps[i - 1], eps[i], net.color, kind);
    }
  }
  function netKind(net) {
    // color the tube by the electrical role of its endpoints
    const roles = net.endpoints.map(roleOf);
    if (roles.includes('power+')) return 'power';
    if (roles.includes('power-') || roles.includes('gnd')) return 'ground';
    return 'data';
  }
  function roleOf(epId) {
    const [id, pin] = epId.split('.');
    const c = api.get_document().components.find(x => x.id === id);
    if (!c) return null;
    return (pinsFor(c.type).find(p => p.name === pin) || {}).role || null;
  }
  function addWire(idA, idB, color, kind) {
    const pA = worldPosOf(idA), pB = worldPosOf(idB);
    if (!pA || !pB) return;
    const curve = curveFor(pA, pB);
    const geo = new THREE.TubeGeometry(curve, 24, 0.14, 8, false);
    const hex = color ? new THREE.Color(color).getHex() : (KIND_COLOR[kind] ?? 0xffd166);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.4, metalness: 0.2 }));
    mesh.userData.ids = [idA, idB];
    wireGroup.add(mesh);
    wires.push({ mesh, ids: [idA, idB] });
  }
  function curveFor(pA, pB) {
    const mid = pA.clone().add(pB).multiplyScalar(0.5);
    const lift = Math.max(2.5, pA.distanceTo(pB) * 0.35);
    mid.y += lift;
    const c1 = pA.clone().lerp(mid, 0.5); c1.y += lift * 0.3;
    const c2 = pB.clone().lerp(mid, 0.5); c2.y += lift * 0.3;
    return new THREE.CubicBezierCurve3(pA, c1, c2, pB);
  }
  function worldPosOf(id) {
    const obj = endpoints.get(id);
    if (!obj) return null;
    const v = new THREE.Vector3();
    obj.getWorldPosition(v);
    v.y += 0.15;
    return v;
  }

  // ── pin picking (with screen-space snap) ──────────────────────
  function updatePointer(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  const SNAP_PX = 26;
  const _pv = new THREE.Vector3();
  function pickPin() {
    const pinMeshes = [...endpoints.values()];
    const hit = raycaster.intersectObjects(pinMeshes, false)[0];
    if (hit) return hit.object;
    const r = canvas.getBoundingClientRect();
    const px = ((pointer.x + 1) / 2) * r.width;
    const py = ((1 - pointer.y) / 2) * r.height;
    let best = null, bestD = SNAP_PX;
    for (const m of pinMeshes) {
      m.getWorldPosition(_pv); _pv.project(camera);
      if (_pv.z > 1) continue;
      const sx = ((_pv.x + 1) / 2) * r.width, sy = ((1 - _pv.y) / 2) * r.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }
  // nearest switch component under the pointer (for click-to-toggle).
  function pickSwitch() {
    const swIds = new Set(api.get_document().components
      .filter(c => baseType(c.type) === 'switch' || baseType(c.type) === 'push_button').map(c => c.id));
    const id = pickComponent();
    return swIds.has(id) ? id : null;
  }
  // nearest whole component under the pointer (its body OR pins) — for
  // right-click-to-remove and drag-to-move. Returns the compId or null.
  function pickComponent() {
    const targets = [];
    for (const c of api.get_document().components) {
      const g = meshes.get(c.id);
      if (g) g.traverse(o => { if (o.isMesh) { o.userData._compId = c.id; targets.push(o); } });
    }
    const hit = raycaster.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData._compId : null;
  }
  function highlightPin(id, on) {
    const obj = endpoints.get(id);
    if (!obj) return;
    if (on) {
      obj.material = obj.material.clone();
      obj.material.emissive = new THREE.Color(0x4da3ff);
      obj.material.emissiveIntensity = 1.5;
      obj.scale.setScalar(1.6);
    } else {
      obj.material.emissive = new THREE.Color(0x000000);
      obj.scale.setScalar(1);
    }
  }

  // ── hover + click-to-wire ─────────────────────────────────────
  let hoveredPinId = null;
  let hoveredWire = null;
  let moving = null;          // { id, moved } while dragging a placed part
  let suppressClick = false;  // set after a real drag so the click is ignored
  let hoveredCompId = null;   // whole part currently under the pointer (for R-rotate)
  canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'assembly') return;
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);

    // dragging a placed part → drive it as a kinematic body (it shoves other
    // parts aside via physics); on release it drops back under gravity. Falls
    // back to a plain doc move when Rapier isn't loaded.
    if (moving) {
      const raw = dropPoint(e);
      if (raw) {
        moving.moved = true;
        const body = phys?.bodies.get(moving.id);
        if (body) body.setNextKinematicTranslation({ x: raw[0], y: 4, z: raw[2] });
        else api.move_component({ id: moving.id, pos: raw });
      }
      hud.hideTooltip();
      return;
    }

    const wireHit = raycaster.intersectObjects(wires.map(w => w.mesh), false)[0];
    hoveredWire = wireHit ? wireHit.object : null;

    const pin = pickPin();
    // pin → wire it; else a body is grab/removable; else orbit the camera
    hoveredCompId = pin ? null : pickComponent();
    const overBody = !!hoveredCompId;
    controls.enabled = !pin && !overBody;
    canvas.style.cursor = pin ? 'pointer' : overBody ? 'grab' : TW_OPEN;
    if (pin) {
      const id = pin.userData.endpointId;
      if (id !== hoveredPinId) { hoveredPinId = id; hud.showTooltip(e, pinTooltipHtml(id)); }
      else hud.moveTooltip(e);
    } else if (hoveredPinId) { hoveredPinId = null; hud.hideTooltip(); }
  });
  canvas.addEventListener('pointerleave', () => {
    hoveredPinId = null; hoveredWire = null; hoveredCompId = null; hud.hideTooltip();
    if (state.mode === 'assembly') controls.enabled = true;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // R rotates the part under the pointer (or the one being dragged); Shift+R
  // the other way. Scroll while grabbing a part also rotates it.
  window.addEventListener('keydown', (e) => {
    if (state.mode !== 'assembly') return;
    if (e.key !== 'r' && e.key !== 'R') return;
    const id = moving?.id || hoveredCompId;
    if (!id) return;
    rotateComp(id, e.shiftKey ? -Math.PI / 12 : Math.PI / 12);
    e.preventDefault();
  });
  canvas.addEventListener('wheel', (e) => {
    if (state.mode !== 'assembly') return;
    // scroll while dragging → rotate the part
    if (moving) {
      rotateComp(moving.id, (e.deltaY > 0 ? 1 : -1) * Math.PI / 24);
      moving.moved = true;
      e.preventDefault();
      return;
    }
    // scroll over a potentiometer's knob → turn its resistance up/down
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const id = hoveredCompId || pickComponent();
    const c = id && api.get_document().components.find(x => x.id === id);
    if (c && baseType(c.type) === 'potentiometer') {
      const maxR = c.params?.maxResistance || 1000;
      const step = (e.deltaY > 0 ? 1 : -1) * maxR * 0.06;
      const next = Math.max(1, Math.min(maxR, (c.params?.resistance || 0) + step));
      api.set_param({ id, key: 'resistance', value: Math.round(next) });
      audio.ui(); sync();
      e.preventDefault();
    }
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'assembly') return;
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    if (e.button === 2) {                          // right-click removes things
      if (hoveredWire) {                           // …a wire
        const [a, b] = hoveredWire.userData.ids;
        api.disconnect({ from: a, to: b });
        audio.ui(); sync(); hud.refreshChecklist();
      } else {
        const id = pickComponent();                // …or a whole part
        if (id) {
          api.remove_component({ id });
          hud.flash(`Removed ${id}`, 'ok'); audio.ui();
          sync(); hud.refreshChecklist();
        }
      }
      e.preventDefault();
      return;
    }
    // left-press on a part body (not a pin) begins a move-drag
    if (e.button === 0 && !pickPin()) {
      const id = pickComponent();
      if (id) {
        moving = { id, moved: false };
        controls.enabled = false; canvas.style.cursor = 'grabbing';
        const body = phys?.bodies.get(id);
        if (body) body.setBodyType(phys.RAPIER.RigidBodyType.KinematicPositionBased, true);
      }
    }
  });
  window.addEventListener('pointerup', () => {
    if (!moving) return;
    const id = moving.id;
    const body = phys?.bodies.get(id);
    if (body) {
      body.setBodyType(phys.RAPIER.RigidBodyType.Dynamic, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      // persist the rest pose (x,z) so the layout survives reload
      const t = body.translation();
      const rot = api.get_document().components.find(c => c.id === id)?.transform?.rot;
      api.move_component({ id, pos: [t.x, 1, t.z], rot });
    }
    suppressClick = moving.moved;   // a real drag shouldn't also fire click
    moving = null;
    canvas.style.cursor = TW_OPEN;
    if (state.mode === 'assembly') { sync(); hud.refreshChecklist(); }
  });
  canvas.addEventListener('click', (e) => {
    if (state.mode !== 'assembly') return;
    if (suppressClick) { suppressClick = false; return; }
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const pin = pickPin();
    if (!pin) {
      // clicking a switch body toggles it open/closed (re-solves the circuit)
      const swId = pickSwitch();
      if (swId) {
        const comp = api.get_document().components.find(c => c.id === swId);
        const now = comp?.params?.closed === true;
        api.set_param({ id: swId, key: 'closed', value: !now });
        hud.flash(`${swId} ${!now ? 'closed' : 'opened'}`, 'ok'); audio.ui();
        sync(); hud.refreshChecklist();
      }
      return;
    }
    const id = pin.userData.endpointId;
    if (!pending) {
      pending = id; highlightPin(id, true); audio.ui();
      hud.setStatus(`Selected ${id} — now click its target`);
      trackOnce('wire_attempt');
      return;
    }
    if (pending === id) { highlightPin(id, false); pending = null; return; }
    const from = pending; highlightPin(from, false); pending = null;
    const res = api.connect({ from, to: id });
    if (res.ok && res.changed) { hud.flash(`✓ ${from} → ${id}`, 'ok'); audio.connect(); }
    else if (!res.ok) { hud.flash(res.errors[0] || 'invalid connection', 'bad'); audio.error(); track('wire_wrong_pin'); }
    sync(); hud.refreshChecklist();
  });

  // ── clear board ───────────────────────────────────────────────
  const clearBtn = document.getElementById('clear-btn');
  function clearBoard() {
    if (state.mode !== 'assembly') return;
    for (const c of api.get_document().components) api.remove_component({ id: c.id });
    pending = null;
    sync();
    hud.setStatus('Drag a battery and a motor from the tray onto the workspace');
    hud.refreshChecklist();
  }
  clearBtn?.addEventListener('click', clearBoard);

  // the old auto-wire buttons don't apply to free-form building — hide them
  document.getElementById('auto-bar')?.classList.add('hidden');

  // ── live electronics → motion (build mode) ────────────────────
  // Everything here is driven by the real circuit solve, so wiring a loop has a
  // visible consequence *before* you hit RUN: powered wires carry moving charge
  // (speed ∝ current), a powered motor's wheel actually spins, and dead wires
  // stay dark. Together with the LED glow this is the "circuit does something".
  const _spinAxis = new THREE.Vector3(0, 1, 0);   // motor wheel's own axle (local y)
  let flowT = 0;
  const charges = new Map();   // wire mesh -> [spheres]

  // current magnitude carried by a wire ≈ the larger current of the two
  // components it bridges (a series wire carries that component's current).
  function wireCurrent(ids, cur) {
    let mag = 0;
    for (const ep of ids) {
      const compId = ep.split('.')[0];
      mag = Math.max(mag, Math.abs(cur[compId] || 0));
    }
    return mag;
  }

  function animate(dt) {
    let elec = null;
    try { elec = api.read_electrical(); } catch { /* ignore */ }
    const cur = elec?.current || {};
    const powered = elec?.ok !== false;
    const doc = api.get_document();

    // ── real gravity + collisions: step Rapier, copy bodies → meshes ──
    if (phys) {
      // skip the whole world when nothing's moving (all bodies asleep, no drag)
      // — keeps idle build mode cheap and out of the RUN sim's way.
      let anyAwake = !!moving;
      for (const [, body] of phys.bodies) if (!body.isSleeping()) { anyAwake = true; break; }
      if (anyAwake) {
        const steps = Math.min(4, Math.max(1, Math.round(dt / (1 / 60))));
        for (let i = 0; i < steps; i++) phys.world.step();
        for (const [id, body] of phys.bodies) {
          const g = meshes.get(id);
          if (g) { const t = body.translation(); g.position.set(t.x, t.y, t.z); }
        }
        group.updateMatrixWorld(true);
        rebuildWires(doc.nets);           // wires follow the falling/sliding parts
      }
    }

    // motors physically spin from their solved current — direction follows sign
    for (const c of doc.components) {
      if (baseType(c.type) !== 'motor') continue;
      const wheels = meshes.get(c.id)?.userData.wheelMeshes;
      if (!wheels) continue;
      const spin = (powered ? (cur[c.id] || 0) : 0) * dt * 2.4;
      if (spin) for (const w of wheels) w.rotateOnAxis(_spinAxis, spin);
    }

    const liveMeshes = new Set(wires.map(w => w.mesh));
    for (const [mesh, cs] of charges) {
      if (liveMeshes.has(mesh)) continue;
      for (const c of cs) { wireGroup.remove(c); c.geometry.dispose(); }
      charges.delete(mesh);
    }
    // flow rate scales with the strongest wire current in the circuit
    const iRef = Math.max(0, ...wires.map(w => wireCurrent(w.ids, cur)));
    flowT = (flowT + dt * (0.15 + Math.min(iRef, 4) * 0.5)) % 1;

    for (const w of wires) {
      let cs = charges.get(w.mesh);
      if (!cs) {
        cs = [];
        for (let i = 0; i < 3; i++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8),
            new THREE.MeshBasicMaterial({ color: w.mesh.material.color }));
          wireGroup.add(s); cs.push(s);
        }
        charges.set(w.mesh, cs);
      }
      const curve = w.mesh.geometry.parameters?.path;
      const flowing = powered && wireCurrent(w.ids, cur) > 1e-3;   // dead wires stay dark
      cs.forEach((s, i) => {
        s.visible = w.mesh.visible && !!curve && flowing;
        if (curve && flowing) s.position.copy(curve.getPointAt((flowT + i / cs.length) % 1));
      });
    }
  }

  sync();

  return {
    group,
    getPlacedCount: () => api.get_document().components.length,
    clearBoard,
    sync,
    refreshPositions: sync,
    animate,
    // test/debug: live physics-driven mesh positions keyed by component id
    debugPositions: () => { const o = {}; for (const [id, g] of meshes) o[id] = g.position.toArray(); return o; },
    // adapter so hud's checklist/stepper can read wiring status off the doc
    wireStatus: () => api.get_document().nets.map((n) => ({
      label: n.endpoints.join(' — '), done: true, kind: netKind(n),
    })),
    allWired: () => api.get_document().nets.length > 0,
  };
}
