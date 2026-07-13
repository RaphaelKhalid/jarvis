// @ts-check
// Guided wiring: the Guide rail's Wire step is a tappable connection list — each
// row wires that pair, the next one is highlighted, and tapping through the list
// completes the loom (the touch/keyboard-accessible path).
import { test, expect } from '@playwright/test';

test('tapping the guide connection rows wires the whole board', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window.__lab && window.__lab.wiring), null, { timeout: 20_000 });
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
    for (const t of ['arduino', 'mpu6050', 'l298n', 'motor', 'motor', 'battery']) {
      window.__lab.assemblyApi.placeByType(t);
    }
  });

  // once the board is placed, the Wire phase renders tappable rows with a "next"
  await expect(page.locator('#g-walk .gp-wire')).not.toHaveCount(0);
  await expect(page.locator('#g-walk .gp-wire.next')).toHaveCount(1);

  // tap the highlighted "next" row until the loom is complete
  for (let i = 0; i < 25; i++) {
    if (await page.evaluate(() => window.__lab.wiring.allRequiredDone())) break;
    const next = page.locator('#g-walk .gp-wire.next');
    if (await next.count() === 0) break;
    await next.click();
  }

  expect(await page.evaluate(() => window.__lab.wiring.allRequiredDone())).toBe(true);
  await expect(page.locator('#upload-btn')).toBeEnabled();
});
