// @ts-check
// Rover suite: the second buildable robot (RobotDef seam end-to-end).
// Boots the app AS the rover (persisted robot id), then verifies its own tray,
// wiring, and that RoverSim drives — flat, on four wheels, no balancing.
import { test, expect } from '@playwright/test';

// Set the persisted robot BEFORE any page script runs, so bootActiveRobot()
// resolves the rover on first load (no reload needed).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('sbl-active-robot', 'rover');
      localStorage.setItem('sbl-seen', '1');
    } catch {}
  });
});

async function openRover(page) {
  await page.goto('/');
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.getElementById('overlay-start')?.click());
}

async function uploadAndBoot(page) {
  await page.click('#auto-instant');
  await page.waitForTimeout(800);
  await expect(page.locator('#upload-btn')).toBeEnabled();
  await page.click('#upload-btn');
  await page.waitForFunction(() => window.__sim && window.__sim.running, null, { timeout: 30_000 });
  await expect(page.getByText('Drive with W/A/S/D')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
}

test('boots as the rover: four motors, two drivers, no IMU', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await openRover(page);
  // active robot is the rover
  await expect(page.locator('#tb-robot-name')).toContainText('Rover');
  const tray = page.locator('#parts-tray');
  await expect(tray.getByText('DC Gear Motor')).toBeVisible();
  await expect(tray.getByText('L298N Driver')).toBeVisible();
  // the rover has no balance sensor
  await expect(tray.getByText('MPU6050')).toHaveCount(0);
  // motor card count badge is ×4 (four wheels)
  await expect(tray.locator('.part-card[data-type="motor"] [data-remaining]')).toHaveText('×4');
  await expect(page.locator('#upload-btn')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('auto-wire completes the rover loom and enables Upload', async ({ page }) => {
  await openRover(page);
  await expect(page.locator('#upload-btn')).toBeDisabled();
  await page.click('#auto-instant');
  await page.waitForTimeout(800);
  await expect(page.locator('#upload-btn')).toBeEnabled();
  // all required rover connections satisfied
  expect(await page.evaluate(() => window.__lab.wiring.allRequiredDone())).toBe(true);
});

test('RoverSim drives forward on four wheels and stays flat', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await openRover(page);
  await uploadAndBoot(page);

  // four wheels, and it's the rover sim body
  const rig = await page.evaluate(() => ({
    wheels: window.__sim.bodies.wheels.length,
    kind: window.__sim.constructor.name,
  }));
  expect(rig.wheels).toBe(4);
  expect(rig.kind).toBe('RoverSim');

  const before = await page.evaluate(() => {
    const t = window.__sim.bodies.chassis.translation();
    window.__t0 = { x: t.x, z: t.z };
    return { x: t.x, z: t.z };
  });
  // hold throttle and poll for displacement — headless runs slower than real time
  await page.keyboard.down('w');
  await page.waitForFunction(() => {
    const t = window.__sim.bodies.chassis.translation();
    return Math.hypot(t.x - window.__t0.x, t.z - window.__t0.z) > 6;
  }, null, { timeout: 15_000 });
  await page.keyboard.up('w');
  const after = await page.evaluate(() => {
    const t = window.__sim.bodies.chassis.translation();
    return { x: t.x, z: t.z, fallen: window.__sim.fallen, tiltDeg: window.__sim.tiltDeg };
  });
  const dist = Math.hypot(after.x - before.x, after.z - before.z);
  expect(dist).toBeGreaterThan(5);       // it drove
  expect(after.fallen).toBe(false);       // it didn't wipe out
  expect(Math.abs(after.tiltDeg)).toBeLessThan(5);   // stays flat (no balancing)
  expect(errors).toEqual([]);
});
