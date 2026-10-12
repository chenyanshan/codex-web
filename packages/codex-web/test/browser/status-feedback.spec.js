import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'status-feedback-fixture');
    localStorage.setItem('codexWebLanguage', 'zh-CN');
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
});

async function pull(page, phase) {
  await page.evaluate((phase) => {
    const target = document.querySelector('.session-list');
    const send = (type, y) => target.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target, clientX: 120, clientY: y })],
    }));
    if (phase === 'start') { send('touchstart', 180); send('touchmove', 330); }
    else send('touchend', 330);
  }, phase);
}

test('refresh and recovery stay neutral and retry preserves the list', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('mobile'));
  await page.goto('/');
  await expect(page.locator('[data-session-id="session_browser_history"]')).toBeVisible();
  const count = await page.locator('.session-card').count();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/sessions{,?*}', async route => {
    await gate;
    await route.fulfill({ status: 503, json: { error: 'unavailable' } });
  });
  await pull(page, 'start');
  const indicator = page.locator('.pull-refresh-indicator');
  await expect(indicator).toContainText('松开');
  await pull(page, 'end');
  await expect(indicator).toHaveClass(/is-refreshing/);
  await expect(indicator).toHaveAttribute('role', 'status');
  await expect(indicator).toContainText('正在刷新');
  await expect(indicator).toHaveCSS('color', 'rgb(31, 41, 55)');
  await expect(indicator).toHaveCSS('border-top-color', 'rgb(229, 231, 235)');
  await page.screenshot({ path: info.outputPath('refresh.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await indicator.evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('none');
  release();
  const notice = page.locator('.session-list-error');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCSS('border-top-color', 'rgb(138, 87, 0)');
  await expect(indicator).not.toHaveClass(/is-visible/);
  await expect(page.locator('.session-card')).toHaveCount(count);
  const button = notice.getByRole('button');
  const box = await button.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(notice).toHaveCSS('color', 'rgb(31, 41, 55)');
  await page.screenshot({ path: info.outputPath('retry.png') });
  await page.unroute('**/api/sessions{,?*}');
  await button.click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator('.session-card')).toHaveCount(count);
});

test('project menu touch does not leave an accent tint', async ({ page }, info) => {
  test.skip(!['mobile-compact', 'mobile-portrait'].includes(info.project.name));
  await page.goto('/');
  const button = page.locator('#mobile-sidebar-toggle-button');
  await expect(button).toBeVisible();
  const before = await button.evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
  await button.tap();
  await expect(page.locator('.mobile-project-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toHaveCSS('color', before.color);
  await expect(button).toHaveCSS('background-color', before.background);
});

test('mobile session hides header status and preserves composer status', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('mobile'));
  await page.goto('/');
  await page.locator('[data-session-id="session_browser_idle"]').click();
  await expect(page.locator('#prompt-input')).toBeVisible();
  await expect(page.locator('.chat-topbar .runtime-feedback')).toHaveCount(0);
  await expect(page.locator('.composer-status')).toBeVisible();
});
