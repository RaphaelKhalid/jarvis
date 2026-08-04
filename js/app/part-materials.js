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

// ── surface break-up (A2) ─────────────────────────────────────────
// Perfectly constant roughness is *the* CG tell: a real moulded plastic case has
// mould flow, handling marks and dust, so its highlight breaks up as it travels
// across the surface. ACTION_ITEMS A2 called for a downloaded CC0 grunge map;
// value noise generated into a canvas does the same job at 256x256, costs zero
// bytes, needs no pipeline, and keeps §B's payload budget honest. Built once,
// lazily, and shared by every part material.
const NOISE_SIZE = 256;
// how far roughness swings around its authored value (map multiplies roughness)
const ROUGHNESS_SWING = 0.28;
const NORMAL_STRENGTH = 0.22;
// Tiles across each part's UV space. The textures are shared, so this is one
// value for the whole catalog; 3 keeps the grain sub-millimetre on a 2 cm body
// without turning into visible repetition on the battery's larger faces.
const NOISE_REPEAT = 3;

let _maps = null;

// Value noise summed over octaves. Deterministic (no Math.random) so the bench
// looks identical every load — and so E3's seeded-RNG sweep has nothing to find.
function fbm(x, y) {
  const hash = (i, j) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    const px = x * freq, py = y * freq;
    const i = Math.floor(px), j = Math.floor(py);
    const fx = smooth(px - i), fy = smooth(py - j);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    sum += amp * ((a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy);
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

// One height field → a roughness map and a matching normal map, so the bumps and
// the dull patches line up the way they do on a real surface.
function surfaceMaps() {
  if (_maps) return _maps;
  if (typeof document === 'undefined') return (_maps = { roughnessMap: null, normalMap: null });

  const n = NOISE_SIZE;
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      h[y * n + x] = fbm((x / n) * 8, (y / n) * 8);

  const make = (fill) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const img = cv.getContext('2d').createImageData(n, n);
    fill(img.data);
    cv.getContext('2d').putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(NOISE_REPEAT, NOISE_REPEAT);
    return t;
  };

  // roughnessMap: THREE multiplies material.roughness by the GREEN channel, so
  // centre the map on 1.0 and let it swing — the authored value stays the mean.
  const roughnessMap = make((d) => {
    for (let i = 0; i < n * n; i++) {
      const v = Math.round(255 * (1 - ROUGHNESS_SWING * (h[i] - 0.5) * 2));
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.max(0, Math.min(255, v));
      d[i * 4 + 3] = 255;
    }
  });

  // normalMap: central-difference the same height field into a tangent-space normal
  const normalMap = make((d) => {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const at = (i, j) => h[((j + n) % n) * n + ((i + n) % n)];
        const dx = (at(x + 1, y) - at(x - 1, y)) * NORMAL_STRENGTH;
        const dy = (at(x, y + 1) - at(x, y - 1)) * NORMAL_STRENGTH;
        const len = Math.hypot(-dx, -dy, 1);
        const k = (y * n + x) * 4;
        d[k] = Math.round(255 * ((-dx / len) * 0.5 + 0.5));
        d[k + 1] = Math.round(255 * ((-dy / len) * 0.5 + 0.5));
        d[k + 2] = Math.round(255 * ((1 / len) * 0.5 + 0.5));
        d[k + 3] = 255;
      }
    }
  });

  return (_maps = { roughnessMap, normalMap });
}

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
 *   - `finish: 'clean'` opts out of the surface break-up maps, for surfaces that
 *     should read as flawless. (Transparent materials skip them automatically.)
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

  // Break up the highlight on solid surfaces. Skipped for transparent parts
  // (LED lenses, glass envelopes — a grubby lens reads as a defect, not as
  // realism) and for anything that already brought its own maps.
  if (finish !== 'clean' && !params.transparent && !params.roughnessMap && !params.normalMap) {
    const { roughnessMap, normalMap } = surfaceMaps();
    if (roughnessMap) {
      params.roughnessMap = roughnessMap;
      params.normalMap = normalMap;
      params.normalScale = new THREE.Vector2(1, 1);
      // the map multiplies, so lift the mean back to the authored roughness
      params.roughness = Math.min(1, (params.roughness ?? 0.5) * 1.06);
    }
  }

  return new THREE.MeshStandardMaterial(params);
}
