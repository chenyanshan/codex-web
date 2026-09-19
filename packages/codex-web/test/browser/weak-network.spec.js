import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-fixture-token');
    localStorage.setItem('codexWebLanguage', 'en');
  });
  await page.route('**/app.js*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__weakNet = { state, selectSession };` });
  });
});

test('a blocked model catalog does not delay authenticated sessions or editing a draft', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(testInfo.project.name));
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/models', async (route) => { await waiting; await route.continue(); });
  await page.goto('/');
  await expect(page.locator('button[data-session-id="session_browser_history"]')).toBeVisible();
  await page.locator('button[data-session-id="session_browser_history"]').click();
  await page.locator('#prompt-input').fill('Draft before model catalog arrives');
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
  await page.locator('#settings-toggle').click();
  await expect(page.locator('.settings-drawer')).toContainText('Loading models…');
  release();
  await expect(page.locator('.settings-drawer')).not.toContainText('Loading models…');
  await page.keyboard.press('Escape');
  await expect(page.locator('#prompt-input')).toHaveValue('Draft before model catalog arrives');
});

for (const delayed of ['status', 'timeline']) {
  test(`session opening renders the available part while ${delayed} remains pending`, async ({ page }, testInfo) => {
    test.skip(!['desktop', 'mobile-portrait'].includes(testInfo.project.name));
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    await page.route(`**/api/sessions/session_browser_history/${delayed}*`, async (route) => { await waiting; await route.continue(); });
    await page.goto('/');
    await page.locator('button[data-session-id="session_browser_history"]').click();
    if (delayed === 'status') await expect(page.locator('#timeline')).toContainText('Latest browser answer');
    else await expect.poll(() => page.evaluate(() => globalThis.__weakNet.state.sessionStatusPending)).toBe(false);
    await expect(page.locator('.history-load-error')).toHaveCount(0);
    await expect(page.locator('.history-load-pending')).toBeVisible();
    await page.locator('#prompt-input').fill('Keep staged draft');
    release();
    await expect(page.locator('.history-load-pending')).toHaveCount(0);
    await expect(page.locator('#timeline')).toContainText('Latest browser answer');
    await expect(page.locator('#prompt-input')).toHaveValue('Keep staged draft');
  });
}

test('online and focus recover a failed initial auth once, before applying preloaded sessions', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(testInfo.project.name));
  let requests = 0;
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/auth/me', async (route) => {
    requests += 1;
    if (requests === 1) return route.abort('failed');
    await waiting; await route.continue();
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => globalThis.__weakNet.state.status)).toBe('Offline');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    for (let index = 0; index < 8; index += 1) window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('button[data-session-id="session_browser_history"]')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__weakNet.state.authSession.id)).toBe('cached');
  release();
  await expect(page.locator('button[data-session-id="session_browser_history"]')).toBeVisible();
  expect(requests).toBe(2);
});

test('HTML gateway failures retry the same SSE cursor without ending the running task', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const requests = [];
  let finished = false;
  await page.route(/\/api\/sessions\/session_browser_fixture(?:\/(?:status|timeline))?(?:\?|$)/, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    if (finished && payload.session) {
      payload.session.activeTurnId = null;
      payload.session.activityState = 'idle';
      if (payload.session.thread) payload.session.thread.turns = [{ id: 'turn_browser_active', status: 'completed', items: [] }];
    }
    await route.fulfill({ response, json: payload });
  });
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/turns/turn_browser_active/events*', async (route) => {
    requests.push(new URL(route.request().url()));
    if (requests.length === 1) return route.fulfill({ contentType: 'text/event-stream', body: `id: 7\ndata: ${JSON.stringify({ type: 'turn.started', turnId: 'turn_browser_active', sequence: 7 })}\n\n` });
    if (requests.length <= 3) return route.fulfill({ status: requests.length === 2 ? 502 : 503, contentType: 'text/html', body: '<html>Temporary gateway error</html>' });
    await waiting;
    finished = true;
    return route.fulfill({ contentType: 'text/event-stream', body: `id: 8\ndata: ${JSON.stringify({ type: 'assistant.final', turnId: 'turn_browser_active', itemId: 'resumed_answer', sequence: 8, text: 'Resumed answer once' })}\n\nid: 9\ndata: ${JSON.stringify({ type: 'turn.completed', turnId: 'turn_browser_active', sequence: 9, status: 'completed' })}\n\n` });
  });
  await page.goto('/');
  await page.locator('button[data-session-id="session_browser_fixture"]').click();
  await expect.poll(() => requests.length, { timeout: 15000 }).toBeGreaterThanOrEqual(4);
  expect(await page.evaluate(() => globalThis.__weakNet.state.pendingTurn)).toBe(true);
  expect(requests.slice(1).every((url) => url.searchParams.get('after') === '7')).toBe(true);
  await expect(page.locator('#visible-stop-button')).toBeVisible();
  await expect(page.locator('#timeline')).not.toContainText('HTTP 502');
  release();
  await expect(page.locator('#timeline')).toContainText('Resumed answer once');
  await expect.poll(() => page.evaluate(() => globalThis.__weakNet.state.pendingTurn)).toBe(false);
  await expect(page.getByText('Resumed answer once', { exact: true })).toHaveCount(1);
});

test('late model defaults preserve a manually chosen draft reasoning level', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(testInfo.project.name));
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/models', async (route) => { await waiting; await route.continue(); });
  await page.goto('/');
  await expect(page.locator('button[data-session-id="session_browser_history"]')).toBeVisible();
  await page.locator('#open-new-session-button').click();
  await page.locator('#new-cwd-input').fill('/Users/test/yanshan_quant');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('#new-session-settings-button').click();
  await page.locator('#new-session-reasoning-select').selectOption('low');
  release();
  await expect.poll(() => page.evaluate(() => globalThis.__weakNet.state.modelsLoading)).toBe(false);
  await expect(page.locator('#new-session-reasoning-select')).toHaveValue('low');
});
