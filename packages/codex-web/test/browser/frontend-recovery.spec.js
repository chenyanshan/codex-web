import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const asset of ['app.js', 'admin-data.js']) {
  test(`cold startup recovers from a failed ${asset} without clearing device state`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('codexWebLanguage', 'zh-CN');
      localStorage.setItem('frontendRecoveryDraftSentinel', 'keep-this-draft');
    });
    const pattern = `**/${asset}?*`;
    await page.route(pattern, route => route.abort('failed'));
    await page.goto('/');
    await expect(page.locator('.boot-wordmark')).toHaveText('页面未能加载');
    await expect(page.locator('.boot-reload')).toBeVisible();
    await page.unroute(pattern);
    await page.locator('.boot-reload').click();
    await expect(page.locator('#login-form')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('frontendRecoveryDraftSentinel'))).toBe('keep-this-draft');
  });
}

test('a stalled startup offers bounded recovery and can still finish loading', async ({ page }) => {
  await page.clock.install();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/app.js?*', async route => { await held; await route.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('.boot-wordmark')).toHaveText('Codex');
  await page.waitForFunction(() => Boolean(globalThis.CodexWebBoot));
  await page.clock.fastForward(16000);
  await expect(page.locator('.boot-wordmark')).toHaveText('Taking longer to load');
  await expect(page.locator('.boot-reload')).toBeVisible();
  release();
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('.boot-shell')).toHaveCount(0);
});

test('the shell retains a recovery link even when the recovery script itself fails', async ({ page }) => {
  await page.route('**/boot-recovery.js?*', route => route.abort('failed'));
  await page.route('**/app.js?*', route => route.abort('failed'));
  await page.goto('/');
  await page.locator('.boot-help summary').click();
  await expect(page.getByRole('link', { name: 'Reload page' })).toBeVisible();
});

test('denied browser storage does not strand the login screen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage denied', 'SecurityError'); } });
  });
  await page.goto('/');
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#password')).toBeEditable();
  await expect(page.locator('.boot-shell')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('share denial statuses use the same private-safe message and keep browser credentials off the request', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('codexWebLanguage', 'zh-CN');
    localStorage.setItem('codexWebToken', 'private-test-device');
  });
  for (const status of [401, 403, 404, 410]) {
    await page.route('**/api/share/test-link/session', route => {
      expect(route.request().headers().authorization).toBeUndefined();
      return route.fulfill({ status, json: { error: 'session_not_found', message: 'Selected session was not found.' } });
    });
    await page.goto('/share/test-link');
    await expect(page.getByRole('heading', { name: '分享链接不可用' })).toBeVisible();
    await expect(page.getByText('请向分享者索取新的链接。')).toBeVisible();
    await expect(page.locator('#shared-session-retry-button')).toHaveCount(0);
    await expect(page.locator('#timeline')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Selected session');
    await page.unroute('**/api/share/test-link/session');
  }
});

test('a temporary share failure retries only on request and then renders read-only history', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/share/test-link/session', route => {
    requests++;
    return requests === 1
      ? route.fulfill({ status: 503, json: { message: 'private upstream detail' } })
      : route.fulfill({ json: { mode: 'share', session: {
        id: 'recovered-share', readOnly: true, settings: { metadata: {} }, thread: { turns: [] },
        timeline: [{ id: 'shared-message', kind: 'message', role: 'assistant', text: 'Recovered shared answer' }],
      } } });
  });
  await page.goto('/share/test-link');
  await expect(page.getByRole('heading', { name: 'Shared session could not load' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('private upstream detail');
  expect(requests).toBe(1);
  await page.locator('#shared-session-retry-button').click();
  await expect(page.locator('#timeline')).toContainText('Recovered shared answer');
  await expect(page.locator('#prompt-input')).toHaveCount(0);
  expect(requests).toBe(2);
});

test('keyboard navigation reaches every collapsed work item and stays inside the dialog', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('codexWebToken', 'keyboard-details-fixture'));
  await page.goto('/');
  await page.locator('button[data-session-id="session_browser_fixture"]').click();
  await page.locator('#open-work-details-button').click();
  const dialog = page.locator('.work-details-dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.locator('.work-detail > summary').count()).toBeGreaterThanOrEqual(3);
  const expectedIds = await dialog.locator('.work-detail > summary').evaluateAll(elements => elements.map(el => el.parentElement.dataset.workEventId));
  const visited = new Set();
  await page.locator('#close-work-details-button').focus();
  for (let index = 0; index < expectedIds.length * 4 + 8; index++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({
      contained: Boolean(document.activeElement.closest('.work-details-dialog')),
      id: document.activeElement.tagName === 'SUMMARY' ? document.activeElement.parentElement.dataset.workEventId : '',
    }));
    expect(focus.contained).toBe(true);
    if (focus.id) visited.add(focus.id);
  }
  for (const id of expectedIds) expect(visited.has(id)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#open-work-details-button')).toBeFocused();
});
