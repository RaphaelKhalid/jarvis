// Splat backdrop (scaffold) — loads a captured 3D Gaussian-splat "room" behind
// the bench so the build surface reads as the real desk from the reference
// photo. It is INERT unless a splat is supplied, so normal boot is untouched:
// pass one via `?splat=<url>` in the address bar, `window.__benchSplat = '<url>'`
// before boot, or by calling the returned `.load(url)`.
//
// Spark (the 3DGS renderer) is imported LAZILY the first time a splat is
// requested, so a session that never uses a splat pays zero cost for it.
//
// Aligning a captured room to our world is done by eye against the marble: the
// module publishes `window.__splat.pos/rot/scale(...)` so we can nudge the splat
// live in the console until the real counter sits where our physics plane is,
// then bake the numbers in here as DEFAULT.transform.
//
// Collision note: splats carry no usable geometry, so nothing ever collides with
// this mesh — it is pure backdrop. The bench parts still fall on the invisible
// Rapier ground plane in creator-assembly.js; re-anchoring that plane's height to
// the marble is the integration step once we have a real splat file to align to.

let sparkModPromise = null; // memoized dynamic import of the Spark renderer

const DEFAULT = {
  url: null,
  // world transform that aligns the captured room to our scene. Splat exports
  // are usually Y-down / arbitrary scale, so these get tuned live and baked in.
  position: [0, 0, 0],
  rotation: [0, 0, 0], // radians, applied XYZ
  scale: 1,
};

export function initBenchSplat({ scene, renderer, assemblyDecor } = {}) {
  const params = new window.URLSearchParams(window.location.search);
  const url = params.get('splat') || (typeof window !== 'undefined' && window.__benchSplat) || DEFAULT.url;

  const state = {
    active: false,
    mesh: null,
    sparkRenderer: null,
    position: [...DEFAULT.position],
    rotation: [...DEFAULT.rotation],
    scale: DEFAULT.scale,
  };

  function applyTransform() {
    const m = state.mesh;
    if (!m) return;
    m.position.set(state.position[0], state.position[1], state.position[2]);
    m.rotation.set(state.rotation[0], state.rotation[1], state.rotation[2]);
    m.scale.setScalar(state.scale);
  }

  async function load(u) {
    if (!u || !scene || !renderer) return false;
    try {
      sparkModPromise = sparkModPromise || import('@sparkjsdev/spark');
      const spark = await sparkModPromise;

      // one SparkRenderer per scene drives all SplatMeshes in it
      if (!state.sparkRenderer) {
        state.sparkRenderer = new spark.SparkRenderer({ renderer });
        scene.add(state.sparkRenderer);
      }

      const mesh = new spark.SplatMesh({ url: u });
      // wait for the splat to finish loading if the build exposes a promise
      if (mesh.initialized && typeof mesh.initialized.then === 'function') {
        await mesh.initialized;
      }
      state.mesh = mesh;
      applyTransform();
      scene.add(mesh);
      state.active = true;

      // let the real room show through: hide the procedural floor/grid/chassis
      (assemblyDecor || []).forEach((d) => { if (d) d.visible = false; });

      // live alignment console API — nudge until the marble lines up, then bake
      // the numbers into DEFAULT.transform above.
      window.__splat = {
        pos: (x, y, z) => { state.position = [x, y, z]; applyTransform(); },
        rot: (x, y, z) => { state.rotation = [x, y, z]; applyTransform(); },
        scale: (s) => { state.scale = s; applyTransform(); },
        get: () => ({ position: state.position, rotation: state.rotation, scale: state.scale }),
        mesh,
      };
      console.info('[bench-splat] loaded', u, '— align with window.__splat.pos(x,y,z)/rot(x,y,z)/scale(s)');
      return true;
    } catch (e) {
      console.warn('[bench-splat] failed to load splat', u, e);
      return false;
    }
  }

  if (url) load(url);

  return { load, isActive: () => state.active, state };
}
