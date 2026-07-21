// @ts-check
// Circuit solver via window.__api.read_electrical — the electrical acceptance
// criteria: open→0A, closed→expected current, reversed→negative, short→violation.
import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
  });
}

// battery + motor placed fresh each test
async function placeBatteryMotor(page) {
  return page.evaluate(() => {
    const api = window.__api;
    // reset to an empty doc
    api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [], nets: [],
      code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
    api.place_component({ type: 'battery', id: 'bat1' });
    api.place_component({ type: 'motor', id: 'motor1' });
  });
}

test('open loop draws 0 A', async ({ page }) => {
  await openApp(page);
  await placeBatteryMotor(page);
  const i = await page.evaluate(() => window.__api.read_electrical().current.motor1 || 0);
  expect(Math.abs(i)).toBeLessThan(1e-6);
});

test('closed loop draws the expected current (7.4 / (0.4+2.0) ≈ 3.08 A)', async ({ page }) => {
  await openApp(page);
  await placeBatteryMotor(page);
  const i = await page.evaluate(() => {
    window.__api.connect({ from: 'bat1.+', to: 'motor1.A' });
    window.__api.connect({ from: 'bat1.-', to: 'motor1.B' });
    return window.__api.read_electrical().current.motor1;
  });
  expect(i).toBeGreaterThan(3.0);
  expect(i).toBeLessThan(3.2);
});

test('reversed polarity draws negative current', async ({ page }) => {
  await openApp(page);
  await placeBatteryMotor(page);
  const i = await page.evaluate(() => {
    window.__api.connect({ from: 'bat1.+', to: 'motor1.B' });
    window.__api.connect({ from: 'bat1.-', to: 'motor1.A' });
    return window.__api.read_electrical().current.motor1;
  });
  expect(i).toBeLessThan(-3.0);
});

test('a resistor in series with the motor cuts the current', async ({ page }) => {
  await openApp(page);
  await placeBatteryMotor(page);
  const i = await page.evaluate(() => {
    const api = window.__api;
    api.place_component({ type: 'resistor', id: 'r1' });   // default 100 Ω
    // bat+ → r.A, r.B → motor.A, motor.B → bat−  (all in series)
    api.connect({ from: 'bat1.+', to: 'r1.A' });
    api.connect({ from: 'r1.B', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
    const e = api.read_electrical();
    return { motor: e.current.motor1, res: e.current.r1, ok: e.ok };
  });
  expect(i.ok).toBe(true);
  // 7.4 / (0.4 + 100 + 2) ≈ 0.072 A — far below the direct-loop 3.08 A
  expect(Math.abs(i.motor)).toBeLessThan(0.5);
  expect(Math.abs(i.motor)).toBeGreaterThan(0.001);
  // the resistor carries the same series current as the motor
  expect(Math.abs(i.res)).toBeCloseTo(Math.abs(i.motor), 3);
});

test('an open switch breaks the loop; closing it lets current flow', async ({ page }) => {
  await openApp(page);
  await placeBatteryMotor(page);
  const r = await page.evaluate(() => {
    const api = window.__api;
    api.place_component({ type: 'switch', id: 'sw1' });   // defaults open
    api.connect({ from: 'bat1.+', to: 'sw1.A' });
    api.connect({ from: 'sw1.B', to: 'motor1.A' });
    api.connect({ from: 'bat1.-', to: 'motor1.B' });
    const open = api.read_electrical().current.motor1;
    api.set_param({ id: 'sw1', key: 'closed', value: true });
    const closed = api.read_electrical().current.motor1;
    return { open, closed };
  });
  expect(Math.abs(r.open)).toBeLessThan(1e-6);     // open → no current
  expect(r.closed).toBeGreaterThan(3.0);           // closed → full loop ≈ 3.08 A
});

test('short raises a violation and the solve is not ok', async ({ page }) => {
  await openApp(page);
  await placeBatteryMotor(page);
  const r = await page.evaluate(() => {
    window.__api.connect({ from: 'bat1.+', to: 'bat1.-' });
    const e = window.__api.read_electrical();
    return { ok: e.ok, codes: e.violations.map(v => v.code) };
  });
  expect(r.ok).toBe(false);
  expect(r.codes).toContain('short');
});
