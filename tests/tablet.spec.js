// @ts-check
// Tablet reflow (≤1024px): the app stacks to a single column and the Guide rail
// starts collapsed (an overlay drawer) so it doesn't occlude the 3D drag area.
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1024, height: 768 } });

test('on a 1024px tablet the guide starts collapsed and the layout stacks', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('sbl-seen', '1'); } catch { /* */ } });
  await page.goto('/');
  await page.waitForFunction(() => !!window.__lab, null, { timeout: 20_000 });

  // guide rail is collapsed (reopen button showing), not occluding the scene
  await expect(page.locator('#guide')).toHaveClass(/collapsed/);
  await expect(page.locator('#g-reopen')).toBeVisible();

  // app is a single stacked column at tablet width
  const cols = await page.evaluate(() =>
    getComputedStyle(document.getElementById('app')).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(1);

  // expanding shows the scrim (tap-to-dismiss overlay), so it's never permanent
  await page.locator('#g-reopen').click();
  await expect(page.locator('#guide-scrim')).toBeVisible();
  await page.locator('#guide-scrim').click();
  await expect(page.locator('#guide')).toHaveClass(/collapsed/);
});
