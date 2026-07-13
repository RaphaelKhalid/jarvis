// @ts-check
// Shareable build URLs: encode the board into a #build= link, reload the app
// on that link, and confirm it restores the same parts + wires.
import { test, expect } from '@playwright/test';

const ready = (page) => page.waitForFunction(() => !!(window.__lab && window.__lab.saveApi));

async function dismissOverlay(page) {
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
  });
}

test('a build round-trips through a shareable URL', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await dismissOverlay(page);

  // build a small board and capture the share link
  await page.evaluate(() => {
    window.__lab.assemblyApi.placeByType('battery');
    window.__lab.assemblyApi.placeByType('arduino');
    window.__lab.wiring.tryConnect('arduino.VIN', 'battery.+');
    window.__lab.wiring.tryConnect('arduino.GND', 'battery.-');
  });
  await expect.poll(() => page.evaluate(() => window.__lab.assemblyApi.getPlacedCount())).toBe(2);
  const url = await page.evaluate(() => window.__lab.saveApi.shareUrl());
  expect(url).toContain('#build=');

  // tear the app down, then load the full share URL — a real forced reload
  // (a hash-only change would not re-run boot). The incoming #build= link takes
  // priority over the local save and offers to load it.
  await page.goto('about:blank');
  await page.goto(url);
  await ready(page);
  await expect(page.locator('#resume-bar')).toContainText('shared a build');
  await dismissOverlay(page);          // clear the first-visit overlay if present
  await page.click('#resume-yes');

  await expect.poll(() => page.evaluate(() => window.__lab.assemblyApi.getPlacedCount())).toBe(2);
  const wired = await page.evaluate(() => window.__lab.wiring.wires.filter(w => w.idA && w.idB).length);
  expect(wired).toBe(2);
  // the #build= hash is cleared after loading so a refresh won't re-prompt
  expect(await page.evaluate(() => window.location.hash)).toBe('');
});
