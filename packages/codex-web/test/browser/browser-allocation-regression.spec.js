import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'allocation-regression');
    localStorage.setItem('codexWebLanguage', 'zh-CN');
    globalThis.__dateFormatterConstructions = 0;
    Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
      construct(target, args) {
        globalThis.__dateFormatterConstructions++;
        return Reflect.construct(target, args);
      },
    });
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__allocationTest={state,render,applyTurnEvent,localizeUiHtml,formatShortDateTime,applyLanguage};` });
  });
  await page.goto('/');
  await page.locator('button[data-session-id="session_browser_fixture"]').click();
  await expect(page.locator('.composer-status')).toContainText('等待审批');
});

test('streamed tool output preserves existing message nodes and draft while details update', async ({ page }, info) => {
  await page.locator('#prompt-input').fill('Keep this unsent draft / 保留草稿');
  await page.locator('#open-work-details-button').click();
  await expect(page.locator('.work-details-dialog')).toBeVisible();
  await page.locator('[data-work-event-id="batch_browser_command"] > summary').click();
  const result = await page.evaluate(async () => {
    const api = globalThis.__allocationTest;
    const messages = [...document.querySelectorAll('#timeline .message-card')];
    for (let index = 0; index < 4; index++) {
      api.applyTurnEvent({ type: 'batch.updated', turnId: 'turn_browser_active', batchId: 'batch_browser_command', summary: { outputDelta: `allocation check ${index}\n` } }, null);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    return { count: messages.length, kept: messages.every(node => node.isConnected), output: api.state.batches.get('batch_browser_command').summary.output };
  });
  expect(result.count).toBeGreaterThan(0);
  expect(result.kept).toBe(true);
  expect(result.output).toContain('allocation check 3');
  await expect(page.locator('#prompt-input')).toHaveValue('Keep this unsent draft / 保留草稿');
  await expect(page.locator('.work-details-dialog')).toContainText('allocation check 3');
  await page.screenshot({ path: info.outputPath('tool-output-preserves-messages.png'), animations: 'disabled' });
});

test('Chinese protection preserves literal markers and repeated dates reuse formatters', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = globalThis.__allocationTest;
    const marker = '__CODEX_WEB_I18N_BLOCK_0__';
    const html = '<p class="message-text">plain</p>'.repeat(8) + `<p class="message-text">${marker}${marker}</p>`;
    const localized = api.localizeUiHtml(html);
    const before = globalThis.__dateFormatterConstructions;
    for (const language of ['en', 'zh-CN', 'en', 'zh-CN']) {
      api.applyLanguage(language, { persist: false });
      for (let index = 0; index < 60; index++) api.formatShortDateTime(1791864000000 + index * 1000);
    }
    const after = globalThis.__dateFormatterConstructions;
    api.render();
    return { unchanged: html === localized, addedFormatters: after - before };
  });
  expect(result.unchanged).toBe(true);
  expect(result.addedFormatters).toBeLessThanOrEqual(2);
});
