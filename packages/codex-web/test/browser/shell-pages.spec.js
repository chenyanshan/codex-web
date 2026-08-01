import { expect, test } from '@playwright/test';

async function expectNoPageOverflow(page) {
  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(Math.max(layout.bodyScrollWidth, layout.documentScrollWidth))
    .toBeLessThanOrEqual(layout.viewportWidth + 1);
}

test('login and setup surfaces stay usable on phone and desktop', async ({ page }, testInfo) => {
  test.skip(!['mobile-compact', 'desktop'].includes(testInfo.project.name));

  await page.goto('/');
  const login = page.locator('#login-form');
  await expect(login).toBeVisible();
  await expect(login.getByRole('heading', { name: 'Codex Web' })).toBeVisible();
  await expectNoPageOverflow(page);

  const loginBox = await login.boundingBox();
  expect(loginBox).not.toBeNull();
  expect(loginBox.width).toBeLessThanOrEqual(440);
  for (const input of await login.locator('input').all()) {
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  await page.route('**/api/auth/login', (route) => route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'setup_required', message: 'Password not configured.' }),
  }));
  await page.locator('#password').fill('temporary-password');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByRole('heading', { name: 'Setup required' })).toBeVisible();
  await expect(page.locator('pre.command')).toHaveText('codex-web auth set-password');
  await expectNoPageOverflow(page);
  await page.screenshot({
    path: `/tmp/codex-web-shell-setup-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('public share keeps only the read-only conversation surface', async ({ page }, testInfo) => {
  test.skip(!['mobile-compact', 'desktop'].includes(testInfo.project.name));
  await page.route('**/api/share/browser-share/session', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      mode: 'share',
      session: {
        id: 'shared_browser_session',
        cwd: '',
        readOnly: true,
        settings: { metadata: {} },
        timeline: [
          { id: 'shared_user', kind: 'message', role: 'user', label: 'You', text: 'Shared question' },
          { id: 'shared_assistant', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Shared answer' },
        ],
        thread: { turns: [] },
      },
    }),
  }));

  await page.goto('/share/browser-share');
  await expect(page.locator('.shared-session-page')).toBeVisible();
  await expect(page.locator('#timeline')).toContainText('Shared question');
  await expect(page.locator('#timeline')).toContainText('Shared answer');
  await expect(page.locator('.desktop-project-rail, .mobile-session-topbar, #composer')).toHaveCount(0);
  await expectNoPageOverflow(page);
  if (testInfo.project.name === 'desktop') {
    const timelineBox = await page.locator('#timeline').boundingBox();
    const messageBoxes = await page.locator('#timeline .message-card').evaluateAll((messages) => messages.map((message) => {
      const box = message.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }));
    expect(timelineBox).not.toBeNull();
    expect(messageBoxes.length).toBeGreaterThan(0);
    expect(messageBoxes.every((box) => (
      box.left >= timelineBox.x + 150
      && box.right <= timelineBox.x + timelineBox.width - 150
    ))).toBe(true);
  }
  await page.screenshot({
    path: `/tmp/codex-web-shell-share-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
