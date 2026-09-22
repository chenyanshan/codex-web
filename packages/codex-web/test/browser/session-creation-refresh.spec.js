import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('a delayed list refresh cannot replace a newly created conversation', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-session-creation-refresh');
    localStorage.setItem('codexWebLanguage', 'en');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__creationTest = { state, refreshSessionsList };` });
  });
  const session = { id: 'session_browser_new_refresh', cwd: '/Users/test/new-project', title: 'New conversation', settings: {}, activeTurnId: 'turn_new_refresh', activityState: 'running' };
  await page.route('**/api/session-submissions', async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: {
      submission: { id: body.submissionId, status: 'submitted', sessionId: session.id, turnId: session.activeTurnId },
      session, turnId: session.activeTurnId,
    } });
  });
  await page.route('**/api/turns/turn_new_refresh/events*', route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
  await page.goto('/');
  await expect(page.locator('button[data-session-id="session_browser_idle"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.__creationTest.state.sessionsLoading)).toBe(false);

  let releaseList;
  const heldList = new Promise(resolve => { releaseList = resolve; });
  let listRequested = false;
  await page.route(/\/api\/sessions(?:\?|$)/u, async route => {
    const response = await route.fetch();
    listRequested = true;
    await heldList;
    await route.fulfill({ response });
  });
  await page.evaluate(() => { globalThis.__creationTest.pendingRefresh = globalThis.__creationTest.refreshSessionsList({ scope: 'all' }); });
  await expect.poll(() => listRequested).toBe(true);
  await page.locator('#open-new-session-button').click();
  await page.locator('#new-cwd-input').fill(session.cwd);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const prompt = 'Keep this message in the new conversation';
  await page.locator('#prompt-input').fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__creationTest.state.sessionId)).toBe(session.id);
  await page.locator('#prompt-input').fill('Unsent follow-up');
  releaseList();
  await page.evaluate(() => globalThis.__creationTest.pendingRefresh);
  await expect(page.locator('#timeline')).toContainText(prompt);
  await expect(page.locator('#prompt-input')).toHaveValue('Unsent follow-up');
  expect(await page.evaluate(() => ({
    sessionId: globalThis.__creationTest.state.sessionId,
    cwd: globalThis.__creationTest.state.cwd,
    turnId: globalThis.__creationTest.state.turnId,
  }))).toEqual({ sessionId: session.id, cwd: session.cwd, turnId: session.activeTurnId });
  await page.screenshot({ path: info.outputPath('new-session-after-list-refresh.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});
