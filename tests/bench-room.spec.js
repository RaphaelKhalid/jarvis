// The PBR room actually assembles: real ambientCG maps on the built surfaces,
// the Poly Haven props land (bottom-aligned, clear of the build area), and the
// HDRI environment gets installed. Guards the fidelity rebuild against a silent
// regression to flat colours — a missing texture renders as untextured paint,
// which no other test would notice.
import { test, expect } from '@playwright/test';

const BUILD_HALF = 26;
// the marble slab: 135x50 centred at (12.5, 1), so props must live inside this
const SLAB = { x0: -55, x1: 80, z0: -24, z1: 26 };

test('the modeled room builds with real assets', async ({ page }) => {
  const failures = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && /assets\//.test(r.url())) failures.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/');
  await page.waitForFunction(() => !!window.__api, null, { timeout: 60000 });
  // force the modeled room regardless of any persisted choice
  await page.evaluate(() => window.__setRoomMode(false));

  // props arrive as their glTFs resolve
  await page.waitForFunction(
    () => (window.__benchRoom?.placed?.length || 0) >= 4, null, { timeout: 60000 });

  const report = await page.evaluate(async () => {
    const THREE = await import('three');
    const room = window.__benchRoom;
    const mapsPerMaterial = Object.entries(room.materials).map(([k, m]) => ({
      name: k,
      pbr: room.pbrSurfaces.includes(k),
      hasColor: !!m.map, hasNormal: !!m.normalMap, hasRough: !!m.roughnessMap,
      // a tint of pure black/near-black would mean someone re-introduced a
      // darkening multiply over an albedo that already carries its colour
      tint: m.color.getHex(),
    }));
    // measure where each prop actually ENDS UP: object.position is only the
    // corrective offset placeModel applied, so the world bbox is the real test.
    const props = room.placed.map((p) => {
      const b = new THREE.Box3().setFromObject(p);
      const r = (v) => +v.toFixed(1);
      return {
        name: p.name || p.children[0]?.name || '?',
        min: [r(b.min.x), r(b.min.y), r(b.min.z)],
        max: [r(b.max.x), r(b.max.y), r(b.max.z)],
        sizeCm: [r(b.max.x - b.min.x), r(b.max.y - b.min.y), r(b.max.z - b.min.z)],
      };
    });
    return {
      mapsPerMaterial,
      props,
      envInstalled: !!window.__view && !!document.querySelector('#three-canvas'),
      hasEnvironment: !!(room.group.parent?.environment),
      benchVisible: room.bench.visible,
      propsVisible: room.props.visible,
    };
  });

  for (const p of report.props) console.log(JSON.stringify(p));
  expect(failures, `asset requests failed: ${failures.join(', ')}`).toEqual([]);

  // Surfaces with visible pattern carry a colour map; the painted ones (cabinet,
  // curtain) are deliberately flat colour over ambientCG relief, since their
  // source albedos are barn wood and grey upholstery.
  const PATTERNED = ['marble', 'wall', 'floor'];
  for (const m of report.mapsPerMaterial) {
    if (PATTERNED.includes(m.name)) {
      expect(m.hasColor, `${m.name} has no base colour map`).toBe(true);
    }
    if (m.pbr) {
      expect(m.hasNormal, `${m.name} lost its ambientCG normal map`).toBe(true);
      expect(m.hasRough, `${m.name} lost its ambientCG roughness map`).toBe(true);
    }
    // guard the multiply trap: tint × albedo can only darken, so a surface that
    // supplies its own colour must not also be tinted down
    const [r, g, b] = [16, 8, 0].map((s) => (m.tint >> s) & 255);
    expect(Math.max(r, g, b), `${m.name} is tinted too dark (#${m.tint.toString(16)})`)
      .toBeGreaterThan(150);
  }

  // props are real-world sized (nothing left at metre scale, nothing left as a
  // multi-variant sheet) and none of them overlaps the square that components
  // get dropped into
  for (const p of report.props) {
    const biggest = Math.max(...p.sizeCm);
    expect(biggest, `${p.name} is sub-cm — missed the metres→cm ×100`).toBeGreaterThan(3);
    expect(biggest, `${p.name} is ${biggest}cm — an unfitted or multi-variant asset`)
      .toBeLessThan(300);
    // resting on the counter (y=0) or the floor (y=-78), never floating
    const onCounter = Math.abs(p.min[1]) < 1.5;
    expect(onCounter || Math.abs(p.min[1] + 78) < 1.5,
      `${p.name} floats/sinks — base at y=${p.min[1]}`).toBe(true);
    if (!onCounter) {
      // A floor prop can't collide with a dropped component, but it CAN stand
      // inside the counter — the cabinet and washer fill that footprint from
      // y=-80 up to the slab, so anything on the floor has to clear it in plan.
      const inSlabX = p.max[0] > SLAB.x0 && p.min[0] < SLAB.x1;
      const inSlabZ = p.max[2] > SLAB.z0 && p.min[2] < SLAB.z1;
      expect(inSlabX && inSlabZ,
        `${p.name} spans ${p.min}..${p.max} — a floor prop standing inside the counter`)
        .toBe(false);
      continue;
    }
    const overlapsX = p.max[0] > -BUILD_HALF && p.min[0] < BUILD_HALF;
    const overlapsZ = p.max[2] > -BUILD_HALF && p.min[2] < BUILD_HALF;
    expect(overlapsX && overlapsZ,
      `${p.name} spans ${p.min}..${p.max} and intrudes on the ±${BUILD_HALF} build area`)
      .toBe(false);
    // ...and stays ON the slab rather than hanging off an edge. The clear strips
    // are narrow (~55cm a side), so this is easy to violate by a few cm when a
    // prop is resized.
    expect(p.min[0], `${p.name} overhangs the slab's left edge`).toBeGreaterThan(SLAB.x0);
    expect(p.max[0], `${p.name} overhangs the slab's right edge`).toBeLessThan(SLAB.x1);
    expect(p.min[2], `${p.name} overhangs the slab's back edge`).toBeGreaterThan(SLAB.z0);
    expect(p.max[2], `${p.name} overhangs the slab's front edge`).toBeLessThan(SLAB.z1);
  }

  expect(report.hasEnvironment).toBe(true);
  expect(report.benchVisible).toBe(true);
  expect(report.propsVisible).toBe(true);
});
