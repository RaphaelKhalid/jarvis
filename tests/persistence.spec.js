// @ts-check
// RobotDoc v2 persistence: the document survives a reload (localStorage) and
// round-trips through a shareable #build= URL.
import { test, expect } from '@playwright/test';

async function openApp(page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
  });
}

async function buildBatteryMotor(page) {
  await page.evaluate(() => {
    const api = window.__api;
    api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [], nets: [],
      code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
    api.connect({ from: 'bat1.+', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
  });
  await page.waitForTimeout(600);   // debounced persist (200ms)
}

test('the document survives a reload', async ({ page }) => {
  await openApp(page);
  await buildBatteryMotor(page);

  await page.reload();
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  const doc = await page.evaluate(() => window.__api.get_document());
  expect(doc.components.map(c => c.id).sort()).toEqual(['bat1', 'motor1']);
  // two wires → two nets (the + rail and the − rail)
  expect(doc.nets.length).toBe(2);
});

test('a shared #build= URL restores the same document', async ({ page, context }) => {
  await openApp(page);
  await buildBatteryMotor(page);
  // encode the current doc exactly as docsave.js does
  const shareUrl = await page.evaluate(() => {
    const doc = window.__api.get_document();
    const b64 = window.btoa(window.unescape(encodeURIComponent(JSON.stringify(doc))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${window.location.origin}${window.location.pathname}#build=${b64}`;
  });

  const fresh = await context.newPage();
  await openApp(fresh, shareUrl);
  const doc = await fresh.evaluate(() => window.__api.get_document());
  expect(doc.components.map(c => c.id).sort()).toEqual(['bat1', 'motor1']);
});
