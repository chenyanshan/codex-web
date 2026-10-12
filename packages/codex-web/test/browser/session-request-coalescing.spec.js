import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('overlapping foreground, manual, and background reads share a request pair and failed recovery backs off', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-request-coalescing');
    localStorage.setItem('codexWebLanguage', 'en');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__readsTest = { state, refreshCurrentSessionMetadata, reconcileCurrentSessionInBackground, recoverActiveTurnAfterForeground, handleComposerRefresh };` });
  });
  const id = 'session_browser_history';
  let fail = false, delay = false;
  const counts = { status: 0, timeline: 0 };
  await page.route(new RegExp(`/api/sessions/${id}(?:[/?]|$)`), async route => {
    const url = new URL(route.request().url());
    const kind = url.pathname.endsWith('/timeline') ? 'timeline' : 'status';
    counts[kind]++;
    if (delay) await new Promise(resolve => setTimeout(resolve, 150));
    if (fail) return route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } });
    const session = { id, title: 'Request recovery', cwd: '/Users/test/yanshan_quant', settings: {}, activeTurnId: null, activityState: 'idle' };
    return route.fulfill({ json: kind === 'timeline' ? { session, items: [{ id: 'read-message', kind: 'message', role: 'assistant', text: 'Preserved conversation' }], hasMore: false } : { session } });
  });
  await page.goto('/');
  await page.locator(`button[data-session-id="${id}"]`).click();
  await expect(page.locator('#timeline')).toContainText('Preserved conversation');
  await page.waitForFunction(() => !globalThis.__readsTest.state.sessionHistoryPending && !globalThis.__readsTest.state.sessionStatusPending);
  counts.status = counts.timeline = 0; delay = true;
  await page.evaluate(async () => {
    const api = globalThis.__readsTest;
    await Promise.all([api.handleComposerRefresh(), api.recoverActiveTurnAfterForeground(), api.reconcileCurrentSessionInBackground(),
      ...Array.from({ length: 20 }, () => api.refreshCurrentSessionMetadata({ hydrateTimeline: true }))]);
  });
  expect(counts).toEqual({ status: 1, timeline: 1 });
  fail = true; delay = false; counts.status = counts.timeline = 0;
  await page.evaluate(async () => {
    for (let i = 0; i < 20; i++) await globalThis.__readsTest.reconcileCurrentSessionInBackground();
  });
  expect(counts).toEqual({ status: 1, timeline: 1 });
  await expect(page.locator('#timeline')).toContainText('Preserved conversation');
  expect(errors).toEqual([]);
});
