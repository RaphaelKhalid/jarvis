// @ts-check
// The M1 end-to-end slice: battery wired to a motor spins the motor; the open
// build does not; the build survives a reload.
import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
  });
}

function resetDoc(page) {
  return page.evaluate(() => window.__api.loadDocument({ v: 2, robotId: 'self-balancer',
    name: 't', components: [], nets: [], code: null, sim: { gravity: -9.81, seed: 42 },
    meta: { revision: 0 } }));
}

test('wired battery→motor spins; open build does not', async ({ page }) => {
  await openApp(page);
  await resetDoc(page);

  // wired build
  await page.evaluate(() => {
    const api = window.__api;
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
    api.connect({ from: 'bat1.+', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
    api.run_sim();
  });
  // headless software physics is slower than real time — poll for spin-up
  await page.waitForFunction(() => window.__sim && Math.abs(window.__sim.omega('motor1')) > 1,
    null, { timeout: 30_000 });
  const spun = await page.evaluate(() => window.__sim.omega('motor1'));
  expect(Math.abs(spun)).toBeGreaterThan(1);

  // now the open version: disconnect and confirm it decays / never spins
  await page.evaluate(() => {
    const api = window.__api;
    api.stop_sim();
    api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't',
      components: [{ id: 'bat1', type: 'battery', params: {}, transform: { pos: [0, 1, 0], rot: [0, 0, 0] } },
                   { id: 'motor1', type: 'motor', params: {}, transform: { pos: [0, 1, 0], rot: [0, 0, 0] } }],
      nets: [], code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
    api.run_sim();
  });
  await page.waitForFunction(() => window.__sim && window.__sim.running, null, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  const open = await page.evaluate(() => window.__sim.omega('motor1'));
  expect(Math.abs(open)).toBeLessThan(1);
});

test('reversed polarity spins the motor the other way', async ({ page }) => {
  await openApp(page);
  await resetDoc(page);
  await page.evaluate(() => {
    const api = window.__api;
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
    api.connect({ from: 'bat1.+', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
    api.run_sim();
  });
  await page.waitForFunction(() => window.__sim && Math.abs(window.__sim.omega('motor1')) > 1,
    null, { timeout: 30_000 });
  const fwd = await page.evaluate(() => window.__sim.omega('motor1'));

  await page.evaluate(() => {
    const api = window.__api;
    api.stop_sim();
    api.disconnect({ from: 'bat1.+', to: 'motor1.A' });
    api.disconnect({ from: 'bat1.-', to: 'motor1.B' });
    api.connect({ from: 'bat1.+', to: 'motor1.B' });
    api.connect({ from: 'bat1.-', to: 'motor1.A' });
    api.reset_sim();
    api.run_sim();
  });
  await page.waitForFunction(() => window.__sim && Math.abs(window.__sim.omega('motor1')) > 1,
    null, { timeout: 30_000 });
  const rev = await page.evaluate(() => window.__sim.omega('motor1'));
  expect(Math.sign(fwd)).not.toBe(Math.sign(rev));
});

test('the build is restored after a reload', async ({ page }) => {
  await openApp(page);
  await resetDoc(page);
  await page.evaluate(() => {
    const api = window.__api;
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
    api.connect({ from: 'bat1.+', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
  });
  await page.waitForTimeout(600);   // debounced persist (200ms)

  await page.reload();
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  const doc = await page.evaluate(() => window.__api.get_document());
  const ids = doc.components.map(c => c.id).sort();
  expect(ids).toEqual(['bat1', 'motor1']);
  // the two endpoints are on one net
  const net = doc.nets.find(n => n.endpoints.includes('bat1.+'));
  expect(net.endpoints).toContain('motor1.A');
});
