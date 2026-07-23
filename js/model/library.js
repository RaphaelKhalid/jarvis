// Component library — pure metadata (no THREE). The single place that knows a
// component type's pins, default electrical params, and pin roles. parts.js
// (geometry) and circuit.js (physics) both defer to this so a Jarvis-authored
// component and a hand-placed one are described identically.
//
// pin role: 'power+' | 'power-' | 'signal' | 'gnd'

export const LIBRARY = {
  battery: {
    label: '7.4V LiPo',
    pins: [
      { name: '+', role: 'power+' },
      { name: '-', role: 'power-' },
    ],
    params: { voltsNominal: 7.4, capacityMah: 800, internalResistance: 0.4, maxCurrent: 30 },
  },
  motor: {
    label: 'DC Gear Motor',
    pins: [
      { name: 'A', role: 'power+' },
      { name: 'B', role: 'power-' },
    ],
    // resistance = armature R_a (ohms); ke = back-EMF / torque constant (V·s/rad).
    params: { resistance: 2.0, ke: 0.05, friction: 0.002, maxCurrent: 10 },
  },
  resistor: {
    label: 'Resistor',
    // passive + non-polar: either pin can be A or B.
    pins: [
      { name: 'A', role: 'signal' },
      { name: 'B', role: 'signal' },
    ],
    params: { resistance: 100, maxCurrent: 5 },
  },
  switch: {
    label: 'Switch',
    pins: [
      { name: 'A', role: 'signal' },
      { name: 'B', role: 'signal' },
    ],
    // closed = conducts; open = breaks the circuit. Toggle it in the sim.
    params: { closed: false, maxCurrent: 30 },
  },
  potentiometer: {
    label: 'Potentiometer',
    // a rheostat (2-terminal variable resistor): the knob sets resistance from
    // ~0 up to maxResistance. Turn it down and more current flows.
    pins: [
      { name: 'A', role: 'signal' },
      { name: 'B', role: 'signal' },
    ],
    params: { resistance: 500, maxResistance: 1000, maxCurrent: 5 },
  },
  led: {
    label: 'LED',
    // polar: anode (A, long leg) → cathode (K). Only lights when A is positive.
    pins: [
      { name: 'A', role: 'power+' },
      { name: 'K', role: 'power-' },
    ],
    // forwardVoltage = Vf drop; resistance = Ron; maxCurrent = burn-out limit.
    params: { forwardVoltage: 2.0, resistance: 12, maxCurrent: 0.03 },
  },
  push_button: {
    label: 'Push Button',
    // momentary switch: same two-terminal contract as switch. `closed` reflects
    // whether it is currently pressed (held down).
    pins: [
      { name: 'A', role: 'signal' },
      { name: 'B', role: 'signal' },
    ],
    description: 'A momentary push button — conducts only while pressed, then springs back open.',
    params: { closed: false, maxCurrent: 5 },
  },
  lamp: {
    label: 'Lamp',
    // an incandescent bulb: a plain resistive load whose brightness reads from
    // the solved current (like the LED, but non-polar and ohmic).
    pins: [
      { name: 'A', role: 'power+' },
      { name: 'B', role: 'power-' },
    ],
    description: 'An incandescent lamp — a resistive load that glows brighter with more current.',
    params: { resistance: 24, maxCurrent: 0.5 },
  },
  buzzer: {
    label: 'Buzzer',
    // piezo/magnetic buzzer: modeled as a resistive load; it sounds when current
    // flows. Polar (power+ / power-) like a small speaker coil.
    pins: [
      { name: '+', role: 'power+' },
      { name: '-', role: 'power-' },
    ],
    description: 'An active buzzer — a resistive load that sounds while current flows through it.',
    params: { resistance: 80, maxCurrent: 0.1 },
  },
  diode: {
    label: 'Diode',
    // polar rectifier: conducts anode(A)→cathode(K) past its forward drop, blocks
    // the reverse direction. Same piecewise-linear model as the LED.
    pins: [
      { name: 'A', role: 'power+' },
      { name: 'K', role: 'power-' },
    ],
    description: 'A rectifier diode — passes current one way (A→K) once past its forward voltage, blocks the other.',
    params: { forwardVoltage: 0.7, resistance: 5, maxCurrent: 1 },
  },
  photoresistor: {
    label: 'Photoresistor',
    // light-dependent resistor (LDR): a variable R like the potentiometer. Its
    // resistance stands in for the sensed light level (bright = low R).
    pins: [
      { name: 'A', role: 'signal' },
      { name: 'B', role: 'signal' },
    ],
    description: 'A light-dependent resistor (LDR) — its resistance falls as light gets brighter.',
    params: { resistance: 5000, maxResistance: 200000, maxCurrent: 1 },
  },
  thermistor: {
    label: 'Thermistor',
    // temperature-dependent resistor: a variable R like the potentiometer. Its
    // resistance stands in for the sensed temperature.
    pins: [
      { name: 'A', role: 'signal' },
      { name: 'B', role: 'signal' },
    ],
    description: 'A temperature-sensitive resistor — its resistance changes with temperature.',
    params: { resistance: 10000, maxResistance: 100000, maxCurrent: 1 },
  },
  fuse: {
    label: 'Fuse',
    // a near-ideal wire that flags an over-current violation past maxCurrent
    // (its rated blow current). Non-polar.
    pins: [
      { name: 'A', role: 'signal' },
      { name: 'B', role: 'signal' },
    ],
    description: 'A protective fuse — a near-ideal conductor that flags an over-current past its rating.',
    params: { resistance: 0.01, maxCurrent: 1 },
  },
  capacitor: {
    label: 'Capacitor',
    // at DC steady state a capacitor is an open circuit (blocks current). Modeled
    // as a very high resistance so the solve stays well-posed. Non-polar here.
    pins: [
      { name: 'A', role: 'power+' },
      { name: 'B', role: 'power-' },
    ],
    description: 'A capacitor — stores charge and blocks steady (DC) current, acting as an open circuit at rest.',
    params: { capacitanceUf: 100, maxCurrent: 5 },
  },
  servo: {
    label: 'Servo Motor',
    // shares the DC-motor electrical model (a V-source with back-EMF + armature
    // R). Third pin is the (unpowered here) control signal line.
    pins: [
      { name: '+', role: 'power+' },
      { name: '-', role: 'power-' },
      { name: 'SIG', role: 'signal' },
    ],
    description: 'A hobby servo motor — driven like a DC motor, with a separate control signal pin.',
    params: { resistance: 3.0, ke: 0.04, friction: 0.002, maxCurrent: 2 },
  },
  relay: {
    label: 'Relay',
    // an electrically-switched contact: `closed` picks whether the common(COM)→
    // normally-open(NO) contact conducts. Switch-like R across COM/NO.
    pins: [
      { name: 'COM', role: 'signal' },
      { name: 'NO', role: 'signal' },
    ],
    description: 'A relay — an electrically-controlled switch; conducts COM→NO when energized (closed).',
    params: { closed: false, maxCurrent: 10 },
  },
};

// Base type for instanced parts (motorL/motorR → motor).
export function baseType(type) {
  if (!type) return type;
  if (type.startsWith('motor')) return 'motor';
  return type;
}

export function defaultParams(type) {
  return { ...(LIBRARY[baseType(type)]?.params || {}) };
}

export function pinsFor(type) {
  return (LIBRARY[baseType(type)]?.pins || []).map(p => ({ ...p }));
}

export function isKnownType(type) {
  return !!LIBRARY[baseType(type)];
}
