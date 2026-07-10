// @ts-check
// Save/load: assembly state survives a reload via the resume prompt.
import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
  });
}

test('assembly + wiring + sketch edits are restored after reload', async ({ page }) => {
  await openApp(page);
  // build + wire everything, then persist fires (debounced 400ms)
  await page.click('#auto-instant');
  await page.waitForTimeout(1200);
  await expect(page.locator('#upload-btn')).toBeEnabled();

  await page.reload();
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.getElementById('overlay-start')?.click());

  // fresh board: upload disabled until we resume
  await expect(page.locator('#upload-btn')).toBeDisabled();
  await expect(page.locator('#resume-bar')).toBeVisible();
  await page.click('#resume-yes');
  await page.waitForTimeout(800);
  await expect(page.locator('#upload-btn')).toBeEnabled();
});

test('start fresh clears the save and does not re-prompt', async ({ page }) => {
  await openApp(page);
  await page.click('#auto-instant');
  await page.waitForTimeout(1200);

  await page.reload();
  await page.waitForTimeout(1200);
  await expect(page.locator('#resume-bar')).toBeVisible();
  await page.click('#resume-no');
  await expect(page.locator('#resume-bar')).toBeHidden();

  await page.reload();
  await page.waitForTimeout(1200);
  await expect(page.locator('#resume-bar')).toHaveCount(0);
});
