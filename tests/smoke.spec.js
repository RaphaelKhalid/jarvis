// @ts-check
// Smoke suite: the regression net. Clean load, no console errors, the scriptable
// API is live, and a place→connect→run cycle drives the motor.
import { test, expect } from '@playwright/test';

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  return errors;
}

async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
  });
}

test('loads without console errors and exposes window.__api', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page);
  const hasApi = await page.evaluate(() => typeof window.__api?.place_component === 'function');
  expect(hasApi).toBe(true);
  await expect(page.locator('#parts-tray')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the tray offers the M1 library and a doc mutation renders 3D meshes', async ({ page }) => {
  await openApp(page);
  // tray is built from the component library (battery + motor), not the old slots
  await expect(page.locator('#parts-tray .part-card[data-type="battery"]')).toBeVisible();
  await expect(page.locator('#parts-tray .part-card[data-type="motor"]')).toBeVisible();

  // placing through the API syncs the 3D view (onDocChange → assembly.sync)
  const meshCount = await page.evaluate(() => {
    const api = window.__api;
    api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [], nets: [],
      code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
    return window.__lab.assemblyApi.getPlacedCount();
  });
  expect(meshCount).toBe(2);

  // clearing removes them — still through the API
  const after = await page.evaluate(() => {
    window.__lab.assemblyApi.clearBoard();
    return { placed: window.__lab.assemblyApi.getPlacedCount(),
             comps: window.__api.get_document().components.length };
  });
  expect(after).toEqual({ placed: 0, comps: 0 });
});

test('the inspector renders the live document + solved current in the DOM', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const api = window.__api;
    api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [], nets: [],
      code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
    api.connect({ from: 'bat1.+', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
  });
  // the panel polls (~400ms) — wait for the component id and its amps to appear
  await expect(page.locator('#inspector .insp-id', { hasText: 'motor1' })).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#inspector')).toContainText(/A\b/);   // a current reading
  await expect(page.locator('#inspector')).toContainText('Circuit OK');
});

test('place → connect → run spins the motor from the solved circuit', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const api = window.__api;
    api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [], nets: [],
      code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
    api.connect({ from: 'bat1.+', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
    api.run_sim();
  });
  await page.waitForFunction(() => window.__sim && Math.abs(window.__sim.omega('motor1')) > 1,
    null, { timeout: 30_000 });
  expect(await page.evaluate(() => Math.abs(window.__sim.omega('motor1')))).toBeGreaterThan(1);
});
