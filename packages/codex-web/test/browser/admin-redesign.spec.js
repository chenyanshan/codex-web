import { test, expect } from '@playwright/test';
import { installAdminFixture, openAdminConsole, navigateAdmin } from './helpers/admin-fixture.js';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await installAdminFixture(page);
  await page.route('**/version.json', route => route.fulfill({ json: { buildId: 'fixture-admin-redesign' } }));
  await page.route('**/api/metrics', route => route.fulfill({ json: { http: { uptimeSeconds: 90245, requestP95Ms: 0, samples: 0, activeStreams: 1, sseReplays: 2, sseResets: 0, routes: { history: { requests: 20, errors: 1, clientErrors: 0, samples: 20, requestP95Ms: 82 }, upload: { requests: 0, errors: 0, clientErrors: 0, samples: 0, requestP95Ms: 0 } } }, storage: { managedStorageMaxBytes: 2147483648, projectUploadMaxBytes: 536870912, backgroundFailures: 0 } } }));
  await page.route('**/api/auth/sessions', route => route.fulfill({ json: { sessions: [{ id: 'device_test', current: true, deviceName: 'Test phone', lastSeenAt: '2026-09-19T08:00:00Z' }] } }));
});

test('admin record hierarchy, editor actions and system snapshots fit the viewport', async ({ page }, info) => {
  await openAdminConsole(page, info.project.name);
  const evidence = 'docs/audits/2026-09-25-admin-redesign-evidence';
  for (const section of ['sessions', 'projects', 'roles', 'users', 'system']) {
    await navigateAdmin(page, section);
    await expect(page.locator('.admin-content h2').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (section === 'system') {
      await expect(page.locator('.admin-system-page')).toContainText('1d 1h 4m (90245 s)');
      await expect(page.locator('.admin-system-facts div').filter({ has: page.locator('dt', { hasText: 'API P95 (ms)' }) }).locator('dd')).toHaveText('—');
      await expect(page.locator('.admin-metrics-scroll tr').filter({ hasText: 'Uploads' }).locator('td').last()).toHaveText('—');
    }
    await page.screenshot({ path: `${evidence}/${info.project.name}-${section}.png`, animations: 'disabled' });
  }
  await navigateAdmin(page, 'users');
  const writer = page.locator('.admin-user-row').filter({ hasText: 'writer@example.com' });
  await expect(writer).toContainText('Role: Writer');
  await expect(writer.locator('.admin-record-identifiers')).not.toHaveAttribute('open', '');
  await page.locator('[data-admin-edit-user="user_writer"]').click();
  await page.locator('[name="email"]').fill('draft@example.com');
  const save = page.locator('#admin-user-form button[type="submit"]');
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await expect(page.locator('[name="email"]')).toHaveValue('draft@example.com');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/${info.project.name}-user-editor.png`, animations: 'disabled' });
});

test('themed delete confirmation cancels safely, preserves focus, and submits only once', async ({ page }, info) => {
  let writes = 0, nativeDialogs = 0;
  page.on('dialog', async dialog => { nativeDialogs++; await dialog.dismiss(); });
  await page.route('**/api/admin/users/user_writer', async route => { writes++; await route.fulfill({ status: 409, json: { message: 'User cannot be deleted now' } }); });
  await openAdminConsole(page, info.project.name);
  await navigateAdmin(page, 'users');
  await expect(page.locator('[data-admin-delete-user-id="user_admin"]')).toBeDisabled();
  const row = page.locator('.admin-user-row').filter({ hasText: 'writer@example.com' });
  await row.locator('.admin-row-more summary').click();
  const trigger = page.locator('[data-admin-delete-user-id="user_writer"]');
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Delete user writer?');
  await page.screenshot({ path: `docs/audits/2026-09-25-admin-redesign-evidence/${info.project.name}-delete-confirm.png`, animations: 'disabled' });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(writes).toBe(0);
  await trigger.click();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row.getByRole('alert')).toContainText('User cannot be deleted now');
  expect(writes).toBe(1); expect(nativeDialogs).toBe(0);
});


test('five themes and both languages keep mobile admin actions readable', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-compact');
  for (const language of ['en', 'zh-CN']) {
    for (const theme of ['fresh-light', 'retro', 'dark-gold', 'oled-black', 'terminal']) {
      await page.addInitScript(({ theme, language }) => { localStorage.setItem('codexWebTheme', theme); localStorage.setItem('codexWebLanguage', language); }, { theme, language });
      await page.goto('/');
      await page.locator('#mobile-sidebar-toggle-button').click();
      await page.locator('#open-admin-console-button').click();
      await expect(page.locator('#admin-page-select')).toBeVisible();
      await page.locator('#admin-page-select').selectOption('users');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.locator('[data-admin-edit-user="user_writer"]').click();
      await page.locator('#admin-user-form button[type="submit"]').scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const buttons = await page.locator('#admin-user-form button').evaluateAll(items => items.map(el => ({ width: el.clientWidth, content: el.scrollWidth, height: el.getBoundingClientRect().height })));
      expect(buttons.every(item => item.content <= item.width && item.height >= 44)).toBe(true);
      await page.screenshot({ path: `docs/audits/2026-09-25-admin-redesign-evidence/320-${theme}-${language}-editor.png`, animations: 'disabled' });
    }
  }
});

test('an expired identity closes a pending confirmation without a write', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  let release, writes = 0;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/admin/roles', async route => { await pending; await route.fulfill({ status: 401, json: { error: 'unauthorized', message: 'Session expired' } }); });
  page.on('request', request => { if (request.method() === 'DELETE') writes++; });
  await openAdminConsole(page, info.project.name);
  await navigateAdmin(page, 'users');
  const row = page.locator('.admin-user-row').filter({ hasText: 'writer@example.com' });
  await row.locator('.admin-row-more summary').click();
  await row.locator('[data-admin-delete-user-id]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.admin-console-screen')).toHaveCount(0);
  expect(writes).toBe(0);
});
