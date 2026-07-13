// @ts-check
// Entitlement (Free vs Pro): a Pro lesson shows a PRO pill, and clicking it opens
// the inline upgrade panel instead of starting — but only when on the Free plan.
import { test, expect } from '@playwright/test';

test('Pro lessons gate to the upgrade panel until entitled', async ({ page }) => {
  // unlock d3 (a Pro lesson) by seeding stars for d1/d2
  await page.addInitScript(() => {
    try {
      localStorage.setItem('sbl-seen', '1');
      localStorage.setItem('sbl-progress-v1', JSON.stringify({ d1: 3, d2: 3 }));
    } catch { /* storage blocked */ }
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window.__lab && window.__lab.curriculum), null, { timeout: 20_000 });
  await page.evaluate(() => document.getElementById('overlay-start')?.click());

  await page.click('#g-lessons');
  // Pro lessons are marked with a pill and the .pro row class
  await expect(page.locator('.ltl-pro').first()).toBeVisible();
  await expect(page.locator('[data-lesson="d3"]')).toHaveClass(/pro/);

  // clicking a Pro lesson opens the upgrade panel, does NOT start the lesson
  await page.evaluate(() => document.querySelector('[data-lesson="d3"]').click());
  await expect(page.locator('#up-go')).toBeVisible();
  expect(await page.evaluate(() => window.__lab.curriculum.active)).toBeNull();

  // dismiss returns to the browser
  await page.evaluate(() => document.getElementById('up-later').click());
  await expect(page.locator('#g-browser .learn-progress')).toBeVisible();

  // once entitled (Pro plan), the same lesson starts normally
  await page.evaluate(() => window.__lab.curriculum.setTier('pro'));
  await expect(page.locator('[data-lesson="d3"]')).not.toHaveClass(/pro/);
  await page.evaluate(() => document.querySelector('[data-lesson="d3"]').click());
  expect(await page.evaluate(() => window.__lab.curriculum.active?.lesson?.id)).toBe('d3');
});
