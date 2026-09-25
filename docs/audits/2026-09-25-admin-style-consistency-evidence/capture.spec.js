import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { installAdminFixture, navigateAdmin } from '../../../packages/codex-web/test/browser/helpers/admin-fixture.js';
const evidence = 'docs/audits/2026-09-25-admin-style-consistency-evidence';
const before = process.env.ADMIN_STYLE_CAPTURE_BEFORE === '1';
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await installAdminFixture(page);
  await page.route('**/version.json', route => route.fulfill({ json: { buildId: 'fixture-admin-style' } }));
  await page.route('**/api/metrics', route => route.fulfill({ json: { http: { uptimeSeconds: 90245, requestP95Ms: 0, samples: 0, activeStreams: 1, sseReplays: 2, sseResets: 0, routes: { history: { requests: 20, errors: 1, clientErrors: 0, samples: 20, requestP95Ms: 82 } } }, storage: { managedStorageMaxBytes: 2147483648, projectUploadMaxBytes: 536870912, backgroundFailures: 0 } } }));
  await page.route('**/api/auth/sessions', route => route.fulfill({ json: { sessions: [{ id: 'test', current: true, deviceName: 'Test phone', lastSeenAt: '2026-09-19T08:00:00Z' }] } }));
});
async function computed(page, selectors) {
  return page.evaluate(selectors => Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
    const element = document.querySelector(selector); if (!element) return [name, null];
    const style = getComputedStyle(element);
    return [name, Object.fromEntries(['backgroundColor', 'color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'gap', 'padding', 'borderRadius', 'borderColor', 'borderLeftWidth', 'boxShadow', 'minHeight'].map(key => [key, style[key]]))];
  })), selectors);
}
for (const theme of ['fresh-light', 'retro', 'dark-gold', 'oled-black', 'terminal']) test(`${theme}: admin uses the session list surfaces and reading scale in every section`, async ({ page }, info) => {
  await page.addInitScript(theme => localStorage.setItem('codexWebTheme', theme), theme);
  await page.goto('/'); await expect(page.locator('.session-card').first()).toBeVisible();
  const reference = await computed(page, { list: '.session-list', row: '.session-card:not(.is-active)', title: '.session-title', meta: '.session-card-meta', action: '.session-card-actions button' });
  await fs.mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${info.project.name}-${theme}-${before ? 'before' : 'after'}-session-list.png` });
  if (!await page.locator('#open-admin-console-button').isVisible()) await page.locator('#mobile-sidebar-toggle-button').click();
  await page.locator('#open-admin-console-button').click();
  await expect(page.locator('.admin-audit-page')).toBeVisible();
  const pages = {};
  for (const section of ['sessions', 'projects', 'roles', 'users', 'system']) {
    await navigateAdmin(page, section);
    await expect(page.locator('.admin-content h2').first()).toBeVisible();
    await expect.poll(() => page.locator('.admin-sidebar').evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
    pages[section] = await computed(page, { canvas: '.admin-console-page', list: '.admin-list', row: '.admin-row', title: '.admin-row-main', heading: '.admin-content h2', section: '.admin-content h3', nav: '.admin-sidebar-button', panel: '.admin-collection-panel' });
    await page.screenshot({ path: `${evidence}/${info.project.name}-${theme}-${before ? 'before' : 'after'}-${section}.png` });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await navigateAdmin(page, 'users');
  await page.locator('[data-admin-edit-user="user_writer"]').click();
  await page.locator('#admin-user-form button[type="submit"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/${info.project.name}-${theme}-after-editor.png`, animations: 'disabled' });
  await page.locator('#admin-user-edit-cancel').click();
  const writer = page.locator('.admin-user-row').filter({ hasText: 'writer@example.com' });
  await writer.locator('.admin-row-more summary').click();
  await writer.locator('[data-admin-delete-user-id]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: `${evidence}/${info.project.name}-${theme}-after-confirm.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await fs.writeFile(`${evidence}/${info.project.name}-${theme}-${before ? 'before' : 'after'}-computed.json`, JSON.stringify({ reference, pages }, null, 2));
});
