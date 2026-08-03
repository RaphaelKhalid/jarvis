// Rapier WASM loader — shared by the two physics worlds (the build-mode bench in
// js/app/creator-assembly.js and the RUN body in js/sim/creator-sim.js).
//
// Kept in its own module so the WASM is fetched and initialized exactly once,
// whichever world asks for it first. This is the whole surviving surface of the
// pre-pivot js/sim.js (the self-balancer arena/terrain/PID rig); everything else
// there described a robot the creator sandbox no longer has.

let RAPIER = null;
let pending = null;

export async function loadRapier() {
  if (RAPIER) return RAPIER;
  // concurrent callers share one in-flight init instead of racing two WASM loads
  if (!pending) {
    pending = (async () => {
      const mod = await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0');
      await mod.init();
      RAPIER = mod;
      return RAPIER;
    })().catch((e) => { pending = null; throw e; });
  }
  return pending;
}
