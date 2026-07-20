// Electrical ↔ mechanical coupling for spinning motors — the pure core of the
// M1 physics, isolated from Rapier so it is unit-testable headlessly.
//
// Per 1/60 physics step we run N electrical substeps: read ω (rad/s) from the
// mechanical side, solve the circuit (back-EMF = Ke·ω is a known source), get
// armature current i, compute torque τ = Kt·i − friction·sign(ω), integrate ω
// against the rotor inertia, and feed the new ω back. `solve` is injected
// (`api.read_electrical`-shaped) so this file knows nothing about the doc.
//
// The real Rapier binding applies τ to a revolute motor as a *torque* and lets
// Rapier integrate ω; this pure integrator mirrors that for tests and for the
// pre-Rapier preview, using a simple rotor model J·dω = τ − b·ω.

import { motorTorque } from './circuit.js';

const DEFAULTS = { inertia: 2e-4, damping: 2e-4 };

// One 1/60 step with N electrical substeps. `motors` is a map
// id -> { omega, params }. `solve(stateOf)` returns a circuit solution keyed by
// component id (specs + current), i.e. api.read_electrical against a given ω map.
// Returns the updated omega map (mutates in place too, for convenience).
export function stepCoupling(motors, solve, dt = 1 / 60, substeps = 8) {
  const h = dt / substeps;
  for (let s = 0; s < substeps; s++) {
    const stateOf = {};
    for (const [id, m] of Object.entries(motors)) stateOf[id] = { omega: m.omega };
    const sol = solve(stateOf);
    for (const [id, m] of Object.entries(motors)) {
      const p = m.params || {};
      const J = Math.max(p.inertia ?? DEFAULTS.inertia, 1e-6);
      const b = p.damping ?? DEFAULTS.damping;
      const tau = motorTorque(id, sol, p, m.omega);
      // J·dω/dt = τ − b·ω
      const domega = (tau - b * m.omega) / J;
      m.omega += domega * h;
    }
  }
  return motors;
}
