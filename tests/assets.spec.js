import { test } from '@playwright/test';

test('every downloaded asset loads', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__api, null, { timeout: 60000 });
  const report = await page.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
    const out = [];

    const models = ['desk_lamp_arm_01', 'classic_laptop', 'potted_plant_02',
      'pachira_aquatica_01', 'modular_electric_cables', 'stationery_supplies',
      'ceramic_pot', 'drawer_cabinet'];
    const gl = new GLTFLoader();
    for (const m of models) {
      try {
        const g = await gl.loadAsync(`assets/models/polyhaven/${m}/${m}_1k.gltf`);
        let meshes = 0, tex = 0, tris = 0;
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          meshes++;
          const idx = o.geometry.index;
          tris += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
          for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap']) {
            if (o.material?.[k]) tex++;
          }
        });
        const b = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
        out.push({ asset: m, ok: true, meshes, tex, tris: Math.round(tris),
          sizeM: [b.x, b.y, b.z].map(v => +v.toFixed(2)) });
      } catch (e) { out.push({ asset: m, ok: false, err: String(e).slice(0, 90) }); }
    }

    for (const h of ['residential_garden_1k', 'residential_garden_2k']) {
      try {
        const t = await new RGBELoader().loadAsync(`assets/hdri/${h}.hdr`);
        out.push({ asset: h, ok: true, res: `${t.image.width}x${t.image.height}` });
      } catch (e) { out.push({ asset: h, ok: false, err: String(e).slice(0, 90) }); }
    }

    const tl = new THREE.TextureLoader();
    const mats = { Marble016: 3, WoodFloor051: 4, PaintedPlaster016: 4,
      Fabric061: 4, PaintedWood008C: 4 };
    for (const [m, n] of Object.entries(mats)) {
      const maps = ['Color', 'NormalGL', 'Roughness'].concat(n === 4 ? ['AmbientOcclusion'] : []);
      try {
        const got = await Promise.all(maps.map(k =>
          tl.loadAsync(`assets/textures/pbr/${m}/${m}_1K-JPG_${k}.jpg`)));
        out.push({ asset: m, ok: true, maps: got.length, res: `${got[0].image.width}px` });
      } catch (e) { out.push({ asset: m, ok: false, err: String(e).slice(0, 90) }); }
    }
    return out;
  });
  for (const r of report) console.log(JSON.stringify(r));
  const bad = report.filter(r => !r.ok);
  if (bad.length) throw new Error(`${bad.length} asset(s) failed to load`);
});
