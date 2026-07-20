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
