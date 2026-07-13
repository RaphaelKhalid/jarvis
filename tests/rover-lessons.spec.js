// @ts-check
// Robot-aware curriculum: the Rover track only shows when the rover is active,
// and a rover lesson's assemble+wire setup builds the rover's 8-part board.
import { test, expect } from '@playwright/test';

test('rover lessons show only for the rover and build its board', async ({ page }) => {
  // boot as the rover, mark onboarding seen, and unlock rv2 via seeded progress
  await page.addInitScript(() => {
    try {
      localStorage.setItem('sbl-active-robot', 'rover');
      localStorage.setItem('sbl-seen', '1');
      localStorage.setItem('sbl-progress-v1', JSON.stringify({ rv1: 3 }));
    } catch { /* storage blocked */ }
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window.__lab && window.__lab.saveApi), null, { timeout: 20_000 });
  await page.evaluate(() => document.getElementById('overlay-start')?.click());

  await page.click('#g-lessons');
  const browser = page.locator('#g-browser');
  await expect(browser).toContainText('Rover School');
  await expect(browser).toContainText('Build the Rover');
  // self-balancer lessons are hidden while the rover is active
  await expect(browser).not.toContainText('Power Up');

  // rover lessons are Pro-gated; entitle Pro so rv2 actually starts (the gate
  // itself is covered by entitlement.spec.js)
  await page.evaluate(() => window.__lab.curriculum.setTier('pro'));
  // rv2 (assemble+wire) should pre-build and pre-wire the full 8-part rover
  await page.click('[data-lesson="rv2"]');
  await expect.poll(() => page.evaluate(() => window.__lab.assemblyApi.getPlacedCount())).toBe(8);
  await expect(page.locator('#upload-btn')).toBeEnabled();
});
