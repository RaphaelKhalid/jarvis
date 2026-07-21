// @ts-check
// Jarvis agent loop (M2). The live Anthropic call can't run in CI (needs a key),
// so we mock /api/jarvis and assert the client loop does the real work: it turns
// the model's tool_use blocks into window.__api mutations, feeds tool_results
// back, and stops on the model's final text turn. This is the contract that
// matters — the model can only touch the build through the API.
import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__api, null, { timeout: 20_000 });
  await page.evaluate(() => {
    try { localStorage.setItem('sbl-seen', '1'); } catch {}
    document.getElementById('overlay-start')?.click();
    window.__api.loadDocument({ v: 2, robotId: 'self-balancer', name: 't', components: [],
      nets: [], code: null, sim: { gravity: -9.81, seed: 42 }, meta: { revision: 0 } });
  });
}

// A scripted two-turn "model": first turn emits tool_use blocks that build a
// battery→motor loop; second turn (after seeing tool_results) emits final text.
function installMockJarvis(page) {
  return page.route('**/api/jarvis', async (route) => {
    const body = route.request().postDataJSON();
    const last = body.messages[body.messages.length - 1];
    const sawToolResults = Array.isArray(last.content) &&
      last.content.some((b) => b.type === 'tool_result');

    if (!sawToolResults) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          role: 'assistant', stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Wiring a battery to a motor.' },
            { type: 'tool_use', id: 't1', name: 'place_component', input: { type: 'battery', id: 'bat1' } },
            { type: 'tool_use', id: 't2', name: 'place_component', input: { type: 'motor', id: 'motor1' } },
            { type: 'tool_use', id: 't3', name: 'connect', input: { from: 'bat1.+', to: 'motor1.A' } },
            { type: 'tool_use', id: 't4', name: 'connect', input: { from: 'bat1.-', to: 'motor1.B' } },
          ],
        }),
      });
    } else {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          role: 'assistant', stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Done — the loop is closed.' }],
        }),
      });
    }
  });
}

test('a Jarvis turn applies tool calls to the document through the API', async ({ page }) => {
  await openApp(page);
  await installMockJarvis(page);

  await page.evaluate(() => window.__lab.jarvis.send('wire the battery to the motor'));

  // the mocked tool_use blocks must have mutated the real document
  await page.waitForFunction(() => window.__api.get_document().components.length === 2,
    null, { timeout: 10_000 });
  const doc = await page.evaluate(() => window.__api.get_document());
  expect(doc.components.map(c => c.id).sort()).toEqual(['bat1', 'motor1']);
  expect(doc.nets.length).toBe(2);   // + rail and − rail

  // the loop surfaces the model's turns in the log
  await expect(page.locator('#jarvis-log')).toContainText('Done — the loop is closed.');
  await expect(page.locator('#jarvis-log .jv-tool')).toHaveCount(4);
});

test('a Jarvis tool error is fed back, not thrown', async ({ page }) => {
  await openApp(page);
  // model asks for an impossible connection, then gives up gracefully
  let turn = 0;
  await page.route('**/api/jarvis', async (route) => {
    turn++;
    if (turn === 1) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        role: 'assistant', stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'x1', name: 'connect', input: { from: 'ghost.A', to: 'ghost.B' } }],
      }) });
    } else {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        role: 'assistant', stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'That component does not exist yet.' }],
      }) });
    }
  });

  await page.evaluate(() => window.__lab.jarvis.send('connect the ghosts'));
  await expect(page.locator('#jarvis-log')).toContainText('does not exist yet', { timeout: 10_000 });
  // the failed tool left the document untouched
  expect(await page.evaluate(() => window.__api.get_document().components.length)).toBe(0);
});
