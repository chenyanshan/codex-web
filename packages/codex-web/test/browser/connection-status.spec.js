import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('restart 502 stays visible until service and session recover, without losing the draft', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'restart-fixture-token');
    localStorage.setItem('codexWebLanguage', 'zh-CN');
  });
  let unavailable = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (unavailable && (path === '/api/health' || path.endsWith('/status'))) {
      return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' });
    }
    if (path === '/api/health') return route.fulfill({ json: { ok: true } });
    return route.continue();
  });
  await page.goto('/');
  await page.locator('[data-session-id="session_browser_history"]').click();
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
  await page.locator('#prompt-input').fill('重启期间保留我的草稿');
  unavailable = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.composer-status')).toContainText('HTTP 502');
  await expect(page.locator('.composer-status')).toContainText('重连');
  await expect(page.locator('.runtime-feedback')).toContainText('HTTP 502');
  await page.setViewportSize({ width: info.project.use.viewport.width, height: info.project.use.viewport.height - 32 });
  await expect(page.locator('.composer-status')).toContainText('HTTP 502');
  await expect(page.locator('.composer-status')).not.toContainText('就绪');
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
  await expect(page.locator('#prompt-input')).toHaveValue('重启期间保留我的草稿');
  const evidence = 'docs/audits/2026-09-19-connection-work-evidence';
  await fs.mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/restart-502-${info.project.name}.png` });
  unavailable = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.composer-status')).not.toContainText('502');
  await expect(page.locator('.composer-status')).toContainText('就绪');
  await expect(page.locator('#prompt-input')).toHaveValue('重启期间保留我的草稿');
});
