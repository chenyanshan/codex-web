import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript(token => {
    localStorage.setItem('codexWebToken', token);
    localStorage.setItem('codexWebLanguage', 'en');
  }, `settings-redesign-${testInfo.project.name}`);
});

test('settings navigation preserves scope, masked clipboard and nested confirmation focus', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#open-app-settings-button')).toBeAttached();
  if (!await page.locator('#open-app-settings-button').isVisible()) await page.locator('#mobile-sidebar-toggle-button').click();
  await page.locator('#open-app-settings-button').click();
  await expect(page.locator('#settings-content')).toBeVisible();
  if (await page.locator('.desktop-settings-panel').isVisible()) {
    await expect(page.locator('#desktop-settings-close-button')).toBeFocused();
    const box = await page.locator('.desktop-settings-panel').boundingBox();
    expect(Math.abs(box.x + box.width / 2 - page.viewportSize().width / 2)).toBeLessThan(2);
  }
  await page.locator('[data-settings-group="account"]').click();
  await expect(page.locator('#settings-heading-account')).toBeFocused();
  await expect(page.locator('#webhook-enabled-toggle')).toBeEnabled();
  await page.locator('#webhook-enabled-toggle').check();
  await expect(page.locator('#webhook-key-input')).toHaveAttribute('type', 'password');
  await page.locator('#webhook-reveal-key-button').click();
  await expect(page.locator('#webhook-key-input')).toHaveAttribute('type', 'text');
  await page.locator('#webhook-reveal-key-button').click();
  // Exercise the HTTP/older-browser clipboard fallback while the key stays masked.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = command => {
      window.__copiedSettingsKey = document.activeElement.value;
      return command === 'copy';
    };
  });
  const key = await page.locator('#webhook-key-input').inputValue();
  await page.locator('#webhook-copy-key-button').click();
  await expect(page.locator('#webhook-copy-key-button')).toHaveText('Copied');
  expect(await page.evaluate(() => window.__copiedSettingsKey)).toBe(key);
  await expect(page.locator('#webhook-key-copy-buffer')).toHaveCount(0);
  await expect(page.locator('#webhook-key-input')).toHaveAttribute('type', 'password');
  await page.locator('#webhook-rotate-key-button').click();
  await expect(page.locator('#webhook-rotate-cancel-button')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#webhook-rotate-key-button')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('compact settings share centered close controls and preserve defaults', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#open-app-settings-button')).toBeAttached();
  if (!await page.locator('#open-app-settings-button').isVisible()) await page.locator('#mobile-sidebar-toggle-button').click();
  await page.locator('#open-app-settings-button').click();
  await expect(page.locator('#default-model-select')).toBeVisible();
  const close = page.locator('.desktop-settings-panel .panel-close, .settings-global-header .panel-close');
  await expect(close).toHaveCount(1);
  const bounds = await close.boundingBox();
  const icon = await close.locator('svg').boundingBox();
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(icon.x + icon.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(1);
  expect(Math.abs(icon.y + icon.height / 2 - bounds.y - bounds.height / 2)).toBeLessThan(1);
  expect(await page.locator('#settings-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `docs/audits/2026-09-30-activity-panel-evidence/settings-${testInfo.project.name}.png` });
  await page.locator('[data-default-mode="plan"]').click();
  await expect(page.locator('[data-default-mode="plan"]')).toHaveAttribute('aria-pressed', 'true');
  await close.click();
  await expect(page.locator('#settings-content')).toHaveCount(0);
  if (!await page.locator('#open-app-settings-button').isVisible()) await page.locator('#mobile-sidebar-toggle-button').click();
  await page.locator('#open-app-settings-button').click();
  await expect(page.locator('[data-default-mode="plan"]')).toHaveAttribute('aria-pressed', 'true');
});

test('phone settings close remains tappable below the device safe area', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, left: 0, right: 0, bottom: 34 } });
  await page.goto('/');
  await expect(page.locator('#open-app-settings-button')).toBeAttached();
  if (!await page.locator('#open-app-settings-button').isVisible()) await page.locator('#mobile-sidebar-toggle-button').tap();
  await page.locator('#open-app-settings-button').tap();
  const close = page.locator('.settings-global-header .panel-close');
  await expect(close).toBeVisible();
  const box = await close.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(47);
  expect(await close.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await close.tap();
  await expect(page.locator('#settings-content')).toHaveCount(0);
});
