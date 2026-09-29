import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'lazy-view-fixture');
    localStorage.setItem('codexWebLanguage', 'en');
  });
});

test('chat startup defers optional views and a failed file module retries on the next open', async ({ page }) => {
  const requests = [];
  let fileAttempts = 0;
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.route('**/session-file-viewer.js*', route => ++fileAttempts === 1 ? route.abort('failed') : route.continue());
  await page.goto('/');
  await page.locator('[data-session-id="session_browser_files"]').click();
  const guide = page.getByRole('link', { name: 'Browser session guide', exact: true });
  await expect(guide).toBeVisible();
  expect(requests).not.toContain('/session-file-viewer.js');
  expect(requests).not.toContain('/webhook-settings.js');
  expect(requests).not.toContain('/admin-ui.css');
  await page.locator('#prompt-input').fill('Keep this draft');
  await guide.click();
  await expect.poll(() => fileAttempts).toBe(1);
  await expect(page.locator('.composer-error')).toBeVisible();
  await guide.click();
  await expect(page.locator('.session-file-document')).toBeVisible();
  expect(fileAttempts).toBe(2);
  await page.locator('#close-session-file-button').click();
  await expect(page.locator('#prompt-input')).toHaveValue('Keep this draft');
  if (!await page.locator('#open-app-settings-button').isVisible() && await page.locator('#back-to-list-button').isVisible()) await page.locator('#back-to-list-button').click();
  if (!await page.locator('#open-app-settings-button').isVisible()) await page.locator('#mobile-sidebar-toggle-button').click();
  await page.locator('#open-app-settings-button').click();
  await page.locator('[data-settings-group="account"]').click();
  await expect(page.locator('#webhook-enabled-toggle')).toBeEnabled();
  expect(requests).toContain('/webhook-settings.js');
});

test('a late optional file module cannot reopen the previous session after navigation', async ({ page }) => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/session-file-viewer.js*', async route => { requested = true; await wait; await route.continue(); });
  await page.goto('/');
  await page.locator('[data-session-id="session_browser_files"]').click();
  await page.getByRole('link', { name: 'Browser session guide', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  if (!await page.locator('[data-session-id="session_browser_history"]').isVisible()) await page.locator('#back-to-list-button').click();
  await page.locator('[data-session-id="session_browser_history"]').click();
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
  release();
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.CodexWebFileViewer))).toBe(true);
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
  await expect(page.locator('.session-file-viewer')).toHaveCount(0);
});
