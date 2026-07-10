// @ts-check
// Curriculum engine: lesson browser, objective progression, stars, gating.
import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); localStorage.setItem('sbl-tutorial-done', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
  });
}

test('lesson c1 completes via place + wire objectives and awards stars', async ({ page }) => {
  await openApp(page);
  await page.click('#learn-btn');
  await expect(page.locator('.learn-card')).toBeVisible();
  await page.click('[data-lesson="c1"]');
  await expect(page.locator('#lesson-hud')).toBeVisible();
  await expect(page.locator('#lesson-hud .l-title')).toHaveText('Power Up');

  // complete the objectives through the real app APIs
  await page.evaluate(() => {
    window.__lab.assemblyApi.placeByType('battery');
    window.__lab.assemblyApi.placeByType('arduino');
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__lab.wiring.tryConnect('arduino.VIN', 'battery.+');
    window.__lab.wiring.tryConnect('arduino.GND', 'battery.-');
  });
  await page.waitForTimeout(800);
  await expect(page.locator('#lesson-hud .l-stars')).toBeVisible();
  const stars = await page.evaluate(() => window.__lab.curriculum.starsFor('c1'));
  expect(stars).toBeGreaterThan(0);
});

test('locked lessons are disabled until the previous one is passed', async ({ page }) => {
  await openApp(page);
  await page.click('#learn-btn');
  await expect(page.locator('[data-lesson="c1"]')).toBeEnabled();
  await expect(page.locator('[data-lesson="c2"]')).toBeDisabled();
  await expect(page.locator('[data-lesson="c5"]')).toBeDisabled();
  // first lesson of every track is open
  await expect(page.locator('[data-lesson="b1"]')).toBeEnabled();
  await expect(page.locator('[data-lesson="d1"]')).toBeEnabled();
  await expect(page.locator('[data-lesson="e1"]')).toBeEnabled();
});

test('lesson with sim setup pre-assembles and pre-wires the board', async ({ page }) => {
  await openApp(page);
  await page.click('#learn-btn');
  await page.evaluate(() => {
    // unlock b4 by seeding progress
    localStorage.setItem('sbl-progress-v1', JSON.stringify({ b1: 3, b2: 3, b3: 3 }));
  });
  await page.reload();
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.getElementById('overlay-start')?.click());
  await page.click('#learn-btn');
  await page.click('[data-lesson="b4"]');
  await page.waitForTimeout(1000);
  // setup should have fully built + wired the robot
  await expect(page.locator('#upload-btn')).toBeEnabled();
  const placed = await page.evaluate(() => window.__lab.assemblyApi.getPlacedCount());
  expect(placed).toBe(6);
});
