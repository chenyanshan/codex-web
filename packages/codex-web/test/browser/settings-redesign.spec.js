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
