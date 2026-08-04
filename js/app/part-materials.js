// One material factory for every electronic component on the bench.
//
// Why this exists: the room loads an HDRI into `scene.environment` (see
// room-assets.js; scene.js installs a studio fallback before it arrives), but a
// MeshStandardMaterial at `roughness 0.6+, metalness 0` reflects almost none of
// it — the specular lobe is too wide and there is no metallic reflection at all.
// Every part was authored at those values, which is why the room reads as a
// photograph and the parts sitting on it read as flat CG.
//
// So rather than hand-tuning ~35 scattered material literals (and re-tuning them
// every time someone adds a component), the call sites keep their *colours* and
// route the rest through here. This is the single knob for how shiny the whole
// catalog is.
import * as THREE from 'three';

// How strongly parts pick up the environment map. Slightly over 1 because the
// bench HDRI is convolved down and the parts are small — under 1 they read matte
// again at a glance, which is the exact problem this module exists to fix.
export const PART_ENV_INTENSITY = 1.25;

// Anything at or above this reads as metal and gets the metal finish.
const METAL_CUTOFF = 0.5;

// Dielectrics (plastic, ceramic, painted case): a tight enough specular lobe to
// show a highlight and a hint of the room. Metals: a real mirror lobe.
const MAX_DIELECTRIC_ROUGHNESS = 0.5;
const METAL_ROUGHNESS = 0.25;
const METAL_METALNESS = 0.9;

/**
 * Build a part material. Takes MeshStandardMaterial options and returns one with
 * environment-responsive values applied.
 *
 * Roughness is only ever lowered, never raised, so deliberately glossy surfaces
 * (LED lenses, glass envelopes) keep the values their factory chose.
 *
 * @param {object} opts MeshStandardMaterial parameters. Plus:
 *   - `finish: 'rough'` opts out of the roughness clamp, for surfaces that are
 *     genuinely matte (rubber tyres, matte-black housings). They still get the
 *     env map, just a diffuse one.
 */
export function partMat(opts = {}) {
  const { finish, ...params } = opts;
  const metalness = params.metalness ?? 0;
  const isMetal = metalness >= METAL_CUTOFF;

  if (isMetal) {
    params.metalness = Math.max(metalness, METAL_METALNESS);
    params.roughness = Math.min(params.roughness ?? METAL_ROUGHNESS, METAL_ROUGHNESS);
  } else if (finish !== 'rough') {
    params.roughness = Math.min(params.roughness ?? MAX_DIELECTRIC_ROUGHNESS, MAX_DIELECTRIC_ROUGHNESS);
  }

  params.envMapIntensity = params.envMapIntensity ?? PART_ENV_INTENSITY;
  return new THREE.MeshStandardMaterial(params);
}
