// @ts-check
// Jarvis agent loop (M2), on the Gemini API. The live Gemini call can't run in
// CI (needs a key), so we mock /api/jarvis with Gemini-shaped replies and assert
// the client loop does the real work: it turns the model's functionCall parts
// into window.__api mutations, feeds functionResponse parts back, and stops on
// the model's final text turn. This is the contract that matters — the model can
// only touch the build through the API.
import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    try { localStorage.removeItem('gyro-jarvis-usage'); } catch {}
    document.getElementById('overlay-start')?.click();
    window.__api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [],
      nets: [], code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
  });
}

const modelTurn = (parts, finishReason = 'STOP') => ({
  contentType: 'application/json',
  body: JSON.stringify({ content: { role: 'model', parts }, finishReason }),
});

// A scripted two-turn "model": first turn emits functionCall parts that build a
// battery→motor loop; second turn (after seeing functionResponse parts) ends.
function installMockJarvis(page) {
  return page.route('**/api/jarvis', async (route) => {
    const body = route.request().postDataJSON();
    const last = body.contents[body.contents.length - 1];
    const sawResults = Array.isArray(last.parts) && last.parts.some((p) => p.functionResponse);

    if (!sawResults) {
      await route.fulfill(modelTurn([
        { text: 'Wiring a battery to a motor.' },
        { functionCall: { name: 'place_component', args: { type: 'battery', id: 'bat1' } } },
        { functionCall: { name: 'place_component', args: { type: 'motor', id: 'motor1' } } },
        { functionCall: { name: 'connect', args: { from: 'bat1.+', to: 'motor1.A' } } },
        { functionCall: { name: 'connect', args: { from: 'bat1.-', to: 'motor1.B' } } },
      ]));
    } else {
      await route.fulfill(modelTurn([{ text: 'Done — the loop is closed.' }]));
    }
  });
}

test('a Jarvis turn applies tool calls to the document through the API', async ({ page }) => {
  await openApp(page);
  await installMockJarvis(page);

  await page.evaluate(() => window.__lab.jarvis.send('wire the battery to the motor'));

  await page.waitForFunction(() => window.__api.get_document().components.length === 2,
    null, { timeout: 10_000 });
  const doc = await page.evaluate(() => window.__api.get_document());
  expect(doc.components.map(c => c.id).sort()).toEqual(['bat1', 'motor1']);
  expect(doc.nets.length).toBe(2);   // + rail and − rail

  await expect(page.locator('#jarvis-log')).toContainText('Done — the loop is closed.');
  await expect(page.locator('#jarvis-log .jv-tool')).toHaveCount(4);
});

test('a Jarvis tool error is fed back, not thrown', async ({ page }) => {
  await openApp(page);
  let turn = 0;
  await page.route('**/api/jarvis', async (route) => {
    turn++;
    if (turn === 1) {
      await route.fulfill(modelTurn([
        { functionCall: { name: 'connect', args: { from: 'ghost.A', to: 'ghost.B' } } },
      ]));
    } else {
      await route.fulfill(modelTurn([{ text: 'That component does not exist yet.' }]));
    }
  });

  await page.evaluate(() => window.__lab.jarvis.send('connect the ghosts'));
  await expect(page.locator('#jarvis-log')).toContainText('does not exist yet', { timeout: 10_000 });
  expect(await page.evaluate(() => window.__api.get_document().components.length)).toBe(0);
});

test('the free-tier quota gate stops calling the API after the daily cap', async ({ page }) => {
  await openApp(page);
  // pre-seed today's usage at the cap so the very next send is blocked
  let apiCalls = 0;
  await page.route('**/api/jarvis', async (route) => { apiCalls++; await route.fulfill(modelTurn([{ text: 'hi' }])); });
  await page.evaluate(() => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('gyro-jarvis-usage', JSON.stringify({ date: today, count: 25 }));
  });

  await page.evaluate(() => window.__lab.jarvis.send('build me something'));
  await expect(page.locator('#jarvis-log')).toContainText('Daily free limit reached');
  expect(apiCalls).toBe(0);   // the gate fired before any network call
});
