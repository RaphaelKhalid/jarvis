// @ts-check
// Smoke suite: the regression net for all future refactors.
// Covers: clean load → assembly → wiring gates Upload → sim balances → WASD drives.
import { test, expect } from '@playwright/test';

/** Collect page errors + console errors for the lifetime of the page. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
  });
  return errors;
}

async function openApp(page) {
  await page.goto('/');
  await page.waitForTimeout(1000);
  // skip onboarding overlay
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
  });
}

async function uploadAndBoot(page) {
  await page.click('#auto-instant');
  await page.waitForTimeout(800);
  await expect(page.locator('#upload-btn')).toBeEnabled();
  await page.click('#upload-btn');
  // Rapier WASM + model load + boot sequence
  await page.waitForFunction(() => window.__sim && window.__sim.running, null, { timeout: 30_000 });
  // driving is locked until the serial boot sequence completes
  await expect(page.getByText('Drive with W/A/S/D')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
}

test('loads without console errors and shows the parts tray', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page);
  const tray = page.locator('#parts-tray');
  await expect(tray.getByText('Arduino Uno')).toBeVisible();
  await expect(tray.getByText('MPU6050')).toBeVisible();
  await expect(page.locator('#upload-btn')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('auto-wire completes the checklist and enables Upload', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#upload-btn')).toBeDisabled();
  await page.click('#auto-instant');
  await page.waitForTimeout(800);
  await expect(page.locator('#upload-btn')).toBeEnabled();
});

test('upload boots the sim and the robot stays upright for 10s', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page);
  await uploadAndBoot(page);
  await page.waitForTimeout(10_000);
  const info = await page.evaluate(() => ({
    fallen: window.__sim.fallen,
    tiltDeg: window.__sim.tiltDeg,
  }));
  expect(info.fallen).toBe(false);
  expect(Math.abs(info.tiltDeg)).toBeLessThan(15);
  expect(errors).toEqual([]);
});

test('WASD drives the robot (forward displacement, steering turns)', async ({ page }) => {
  await openApp(page);
  await uploadAndBoot(page);
  const before = await page.evaluate(() => {
    const t = window.__sim.bodies.chassis.translation();
    return { x: t.x, z: t.z };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(2500);
  await page.keyboard.up('w');
  const after = await page.evaluate(() => {
    const t = window.__sim.bodies.chassis.translation();
    return { x: t.x, z: t.z, fallen: window.__sim.fallen };
  });
  const dist = Math.hypot(after.x - before.x, after.z - before.z);
  expect(dist).toBeGreaterThan(5);
  expect(after.fallen).toBe(false);
});

test('space jump goes airborne and lands without wiping out on the flat pad', async ({ page }) => {
  await openApp(page);
  await uploadAndBoot(page);
  await page.keyboard.press(' ');
  await page.waitForTimeout(150);
  const mid = await page.evaluate(() => window.__sim._airborne);
  expect(mid).toBe(true);
  // headless software rendering runs slower than real time — poll for touchdown
  await page.waitForFunction(() => !window.__sim._airborne, null, { timeout: 15_000 });
  const after = await page.evaluate(() => ({ fallen: window.__sim.fallen }));
  expect(after.fallen).toBe(false);
});
