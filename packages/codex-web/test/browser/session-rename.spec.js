import { test, expect } from '@playwright/test';

const id = 'session_browser_fixture';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-fixture-token');
    localStorage.setItem('codexWebLanguage', 'en');
  });
});

test('rename saves a native name while preserving the running turn and draft, with cancel and retry', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(testInfo.project.name));
  let title = 'Quality gate fixture';
  let attempts = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route(/\/api\/sessions(?:\?|\/session_browser_fixture(?:\/(?:status|timeline))?(?:\?|$)|$)/, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const rename = (session) => session?.id === id ? { ...session, title } : session;
    if (payload.session) payload.session = rename(payload.session);
    if (payload.items) payload.items = payload.items.map(rename);
    await route.fulfill({ response, json: payload });
  });
  await page.route(`**/api/sessions/${id}/name`, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await pending;
      await route.fulfill({ status: 502, json: { error: 'session_rename_failed' } });
    } else {
      title = route.request().postDataJSON().name;
      await route.fulfill({ json: { session: { id, title } } });
    }
  });
  await page.goto('/');
  await page.locator(`button[data-session-id="${id}"]`).click();
  await page.locator('#prompt-input').fill('Unsent draft stays here');
  await page.locator('#settings-toggle').click();
  await page.locator('#rename-session-button').click();
  await expect(page.locator('#session-name-input')).toHaveValue(title);
  await expect(page.locator('#session-name-input')).toBeFocused();
  expect((await page.locator('#session-name-input').boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.locator('#cancel-session-name').click();
  expect(attempts).toBe(0);
  await page.locator('#settings-toggle').click();
  await page.locator('#rename-session-button').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#session-name-form')).toHaveCount(0);
  await page.locator('#settings-toggle').click();
  await page.locator('#rename-session-button').click();
  await page.locator('#session-name-input').fill('   ');
  await expect(page.locator('#save-session-name')).toBeDisabled();
  const name = '自定义 <b>Send & 名称</b> ' + '中A'.repeat(45);
  await page.locator('#session-name-input').fill(name);
  await page.locator('#save-session-name').click();
  await expect(page.locator('#save-session-name')).toBeDisabled();
  await expect(page.locator('#cancel-session-name')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#session-name-form')).toBeVisible();
  expect(attempts).toBe(1);
  release();
  await expect(page.locator('#session-name-error')).toContainText('Could not save');
  await expect(page.locator('#session-name-input')).toHaveValue(name);
  await expect(page.locator('#session-name-input')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#save-session-name').click();
  await expect(page.locator('#session-name-form')).toHaveCount(0);
  await expect(page.locator('.chat-title-stack .project-title')).toHaveText(name);
  await expect(page.locator('.chat-title-stack .project-title b')).toHaveCount(0);
  await expect(page.locator('#visible-stop-button')).toBeVisible();
  await expect(page.locator('#prompt-input')).toHaveValue('Unsent draft stays here');
  await page.reload();
  await expect(page.locator('.chat-title-stack .project-title')).toHaveText(name);
  await expect(page.locator('#prompt-input')).toHaveValue('Unsent draft stays here');
  if (testInfo.project.name === 'mobile-portrait') await page.locator('#back-to-list-button').click();
  await expect(page.locator(`button[data-session-id="${id}"] .session-title`)).toHaveText(name);
  expect(attempts).toBe(2);
});

test('late rename completion cannot replace the next session and read-only capability hides the entry', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.route('**/app.js*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__renameTest = { state, render, selectSession };` });
  });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route(`**/api/sessions/${id}/name`, async (route) => {
    await pending;
    await route.fulfill({ json: { session: { id, title: 'Late result' } } });
  });
  await page.goto('/');
  await page.locator(`button[data-session-id="${id}"]`).click();
  await page.locator('#settings-toggle').click();
  await page.locator('#rename-session-button').click();
  await page.locator('#session-name-input').fill('Late result');
  const requested = page.waitForRequest(`**/api/sessions/${id}/name`);
  await page.locator('#save-session-name').click();
  await requested;
  await page.evaluate(() => globalThis.__renameTest.selectSession('session_browser_idle'));
  const arrived = page.waitForResponse(`**/api/sessions/${id}/name`);
  release(); await arrived;
  await expect(page.locator('.chat-title-stack .project-title')).toHaveText('Idle quality gate fixture');
  await expect(page.locator('#session-name-form')).toHaveCount(0);
  await page.evaluate(() => {
    const { state, render } = globalThis.__renameTest;
    state.authSession.principal = { mode: 'multi' };
    state.currentSession.canRename = false;
    state.settingsOpen = true;
    render();
  });
  await expect(page.locator('#settings-drawer-close')).toBeVisible();
  await expect(page.locator('#rename-session-button')).toHaveCount(0);
});
