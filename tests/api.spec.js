// @ts-check
// The scriptable API contract: every function callable via window.__api, dryRun
// mutates nothing, undo restores the exact prior document, invalid connect is a
// no-op that leaves the doc untouched.
import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
    window.__api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [],
      nets: [], code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
  });
}

test('every documented API function is present and callable', async ({ page }) => {
  await openApp(page);
  const missing = await page.evaluate(() => {
    const names = ['place_component', 'remove_component', 'connect', 'disconnect',
      'set_param', 'run_sim', 'stop_sim', 'reset_sim', 'undo', 'redo',
      'get_document', 'read_telemetry', 'read_electrical', 'validate'];
    return names.filter(n => typeof window.__api[n] !== 'function');
  });
  expect(missing).toEqual([]);
});

test('dryRun mutates nothing', async ({ page }) => {
  await openApp(page);
  const same = await page.evaluate(() => {
    const before = JSON.stringify(window.__api.get_document());
    const r = window.__api.place_component({ type: 'battery' }, { dryRun: true });
    const after = JSON.stringify(window.__api.get_document());
    return { ok: r.ok, unchanged: before === after };
  });
  expect(same.ok).toBe(true);
  expect(same.unchanged).toBe(true);
});

test('undo after a multi-step transaction restores the exact prior document', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const api = window.__api;
    api.place_component({ type: 'battery', id: 'bat1' });
    const snapshot = JSON.stringify(api.get_document());
    api.place_component({ type: 'motor', id: 'motor1' });
    api.connect({ from: 'bat1.+', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
    api.undo(); api.undo(); api.undo();   // three committed steps back
    return { restored: JSON.stringify(api.get_document()) === snapshot };
  });
  expect(r.restored).toBe(true);
});

test('invalid connect returns {ok:false} and leaves the doc untouched', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const api = window.__api;
    api.place_component({ type: 'battery', id: 'bat1' });
    const before = JSON.stringify(api.get_document());
    const res = api.connect({ from: 'bat1.+', to: 'ghost.Z' });
    return { ok: res.ok, unchanged: JSON.stringify(api.get_document()) === before };
  });
  expect(r.ok).toBe(false);
  expect(r.unchanged).toBe(true);
});
