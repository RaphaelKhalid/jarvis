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

test('a placed part can be moved and removed (keeping wires consistent)', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const api = window.__api;
    api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [], nets: [],
      code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
    api.connect({ from: 'bat1.+', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
    // move the motor — the document transform updates, meshes stay in sync
    api.move_component({ id: 'motor1', pos: [8, 1, -4] });
    const moved = api.get_document().components.find(c => c.id === 'motor1').transform.pos;
    // remove the battery — its two edges must be dropped, leaving no nets
    api.remove_component({ id: 'bat1' });
    const doc = api.get_document();
    return { moved, comps: doc.components.length, nets: doc.nets.length,
             meshes: window.__lab.assemblyApi.getPlacedCount() };
  });
  expect(r.moved).toEqual([8, 1, -4]);
  expect(r.comps).toBe(1);       // only the motor remains
  expect(r.nets).toBe(0);        // wires to the removed battery are gone
  expect(r.meshes).toBe(1);      // the 3D view reconciled
});

test('bench physics: parts dropped on one spot fall and stack under gravity', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const api = window.__api;
    api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [], nets: [],
      code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
    api.place_component({ type: 'battery', id: 'b1', transform: { pos: [0, 1, 0], rot: [0, 0, 0] } });
    api.place_component({ type: 'battery', id: 'b2', transform: { pos: [0, 1, 0], rot: [0, 0, 0] } });
    api.place_component({ type: 'battery', id: 'b3', transform: { pos: [0, 1, 0], rot: [0, 0, 0] } });
  });
  // wait for the stack to settle: bottom part on the bench, the others resting above
  await page.waitForFunction(() => {
    const d = window.__lab.assemblyApi.debugPositions?.();
    if (!d || !d.b1 || !d.b3) return false;
    const ys = [d.b1[1], d.b2[1], d.b3[1]].sort((a, b) => a - b);
    return ys[0] < 1.4 && ys[1] > ys[0] + 1.4 && ys[2] > ys[1] + 1.4;
  }, null, { timeout: 20_000 });
  const d = await page.evaluate(() => window.__lab.assemblyApi.debugPositions());
  const ys = [d.b1[1], d.b2[1], d.b3[1]].sort((a, b) => a - b);
  expect(ys[0]).toBeLessThan(1.4);          // one part rests on the bench (~y=1)
  expect(ys[2] - ys[0]).toBeGreaterThan(2.8); // the stack is genuinely stacked
});

test('the onboarding coach appears and advances as the circuit is built', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  await page.evaluate(() => {
    try { localStorage.removeItem('jarvis-coached'); localStorage.setItem('sbl-seen', '1'); } catch {}
    window.location.reload();
  });
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  await page.evaluate(() => {
    document.getElementById('overlay-start')?.click();
    window.__api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [], nets: [],
      code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
  });
  // it shows, with the first step as "current"
  await expect(page.locator('#coach')).toBeVisible();
  await expect(page.locator('#coach-steps li.current')).toContainText('battery');
  // placing a battery ticks step 1 and advances to the motor step
  await page.evaluate(() => window.__api.place_component({ type: 'battery', id: 'b1' }));
  await expect(page.locator('#coach-steps li.done')).toContainText('battery', { timeout: 3000 });
  await expect(page.locator('#coach-steps li.current')).toContainText('motor');
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
  // run_sim resolves only once Rapier's WASM is loaded and the body is built, so
  // awaiting it removes the race this test used to have: previously it fired and
  // forgot, and a failed start was swallowed — the test then polled a sim that
  // was never going to spin and died on a 30s timeout with no diagnostic.
  const started = await page.evaluate(async () => {
    const api = window.__api;
    api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [], nets: [],
      code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
    api.connect({ from: 'bat1.+', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
    return api.run_sim();
  });
  expect(started).toMatchObject({ ok: true, running: true });

  // now it's genuinely running, so ω climbing is a physics question, not a
  // loading one — the wait is short and any failure is a real regression.
  await page.waitForFunction(() => Math.abs(window.__sim.omega('motor1')) > 1,
    null, { timeout: 15_000 });
  expect(await page.evaluate(() => Math.abs(window.__sim.omega('motor1')))).toBeGreaterThan(1);
});

test('the activation funnel fires circuit_ok exactly once, on the first working circuit', async ({ page }) => {
  await openApp(page);
  const events = await page.evaluate(() => {
    const api = window.__api;
    const names = () => (window.__gyroFunnel || []).map(e => e.event);
    api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [], nets: [],
      code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
    api.connect({ from: 'bat1.+', to: 'motor1.A' });
    const beforeLoop = names().filter(n => n === 'circuit_ok').length;
    api.connect({ from: 'bat1.-', to: 'motor1.B' });   // closes the loop
    const afterLoop = names().filter(n => n === 'circuit_ok').length;
    // a second working circuit must not re-fire it (it's a once-per-session metric)
    api.place_component({ type: 'led', id: 'led1' });
    api.connect({ from: 'bat1.+', to: 'led1.A' });
    api.connect({ from: 'bat1.-', to: 'led1.K' });
    return { beforeLoop, afterLoop, total: names().filter(n => n === 'circuit_ok').length };
  });
  expect(events.beforeLoop).toBe(0);   // an unclosed circuit is not activation
  expect(events.afterLoop).toBe(1);
  expect(events.total).toBe(1);
});
