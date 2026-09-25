import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('cached messages stay in place while history and execution status refresh', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait', 'mobile-compact'].includes(info.project.name));
  const id = 'session_browser_history';
  const items = [
    { id: 'cached_question', kind: 'message', role: 'user', meta: 'history', text: 'Keep this cached conversation steady.' },
    { id: 'cached_answer', kind: 'message', role: 'assistant', meta: 'final', text: 'The previous answer is already available.' },
  ];
  await page.addInitScript(({ id, items }) => {
    localStorage.setItem('codexWebToken', 'browser-cache-stability');
    localStorage.setItem('codexWebLanguage', 'en');
    localStorage.setItem('codexWebTimelineCache', JSON.stringify({ version: 3, entries: [{
      sessionId: id, savedAt: Date.now(), validatedAt: 0, timeline: items, history: items,
      historyComplete: true, batches: [], approvals: [],
    }] }));
  }, { id, items });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__cacheStability = { state };` });
  });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route(new RegExp(`/api/sessions/${id}(?:[/?]|$)`), async route => {
    requests++;
    await gate;
    const session = { id, title: 'Cached conversation', cwd: '/Users/test/yanshan_quant', settings: {},
      listOrderAt: 1000, updatedAt: 1000, activeTurnId: null, activityState: null };
    await route.fulfill({ json: { session: { ...session, timeline: items, thread: { turns: [] }, timelineComplete: true }, items, hasMore: false } });
  });
  await page.goto('/');
  await page.locator(`button[data-session-id="${id}"]`).click();
  await expect(page.locator('#timeline')).toContainText(items[1].text);
  await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.history-load-pending')).toHaveCount(0);
  await page.locator('#prompt-input').fill('Keep my next draft');
  const anchor = page.locator('[data-timeline-id="cached_question"]');
  const before = await anchor.boundingBox();
  const dimensions = await page.locator('#timeline').evaluate(element => ({ height: element.clientHeight, scroll: element.scrollHeight }));
  release();
  await expect.poll(() => page.evaluate(() => {
    const { state } = globalThis.__cacheStability;
    return state.sessionHistoryPending || state.sessionStatusPending;
  })).toBe(false);
  await expect(page.locator('.history-load-pending')).toHaveCount(0);
  await expect(page.locator('#prompt-input')).toHaveValue('Keep my next draft');
  const after = await anchor.boundingBox();
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  expect(await page.locator('#timeline').evaluate(element => ({ height: element.clientHeight, scroll: element.scrollHeight }))).toEqual(dimensions);
});

test('an uncached empty conversation keeps loading feedback until history arrives', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  // A title is also a legacy message preview; omit it to exercise a truly empty view.
  const session = { id: 'empty_cache_session', title: '', settings: {}, listOrderAt: 1 };
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-empty-cache');
    localStorage.setItem('codexWebLanguage', 'en');
  });
  await page.route(/\/api\/sessions(?:\?|$)/u, route => route.fulfill({ json: { items: [session], directoryComplete: true } }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/sessions/empty_cache_session/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/status')) return route.fulfill({ json: { session } });
    await gate;
    await route.fulfill({ json: { session, items: [{ id: 'loaded_answer', kind: 'message', role: 'assistant', text: 'History is now available.' }], hasMore: false } });
  });
  await page.goto('/');
  await page.locator('button[data-session-id="empty_cache_session"]').click();
  await expect(page.locator('.history-load-pending')).toBeVisible();
  await expect(page.locator('.history-load-pending')).toHaveText('Loading history…');
  release();
  await expect(page.locator('#timeline')).toContainText('History is now available.');
  await expect(page.locator('.history-load-pending')).toHaveCount(0);
});
