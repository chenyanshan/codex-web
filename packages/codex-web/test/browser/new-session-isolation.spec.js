import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-new-session-isolation');
    localStorage.setItem('codexWebLanguage', 'en');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__isolation = { state, selectProjectScope, render, syncComposerStatusDisplay };` });
  });
});

test('new session and draft survive resize and send to a new conversation', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#open-new-session-button').click();
  await page.locator('#new-cwd-input').fill('/Users/test/new-project');
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }, info.project.use.viewport]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#new-session-form')).toBeVisible();
    await expect(page.locator('#new-cwd-input')).toHaveValue('/Users/test/new-project');
  }
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('#prompt-input').fill('A question for the new project');
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }, info.project.use.viewport]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.new-session-empty-state')).toBeVisible();
    await expect(page.locator('#prompt-input')).toHaveValue('A question for the new project');
  }
  for (const status of ['Ready', 'Attachment uploaded']) {
    await page.evaluate(status => {
      globalThis.__isolation.state.status = status;
      globalThis.__isolation.render();
      globalThis.__isolation.syncComposerStatusDisplay();
    }, status);
    await expect(page.locator('.composer-status')).toHaveCount(0);
  }
  await page.screenshot({ path: info.outputPath('clean-new-session.png') });
  let submitted;
  await page.route('**/api/session-submissions', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: {
      submission: { id: submitted.submissionId, status: 'submitted', sessionId: 'new_isolated_session', turnId: 'new_isolated_turn' },
      session: { id: 'new_isolated_session', cwd: '/Users/test/new-project', settings: {}, activeTurnId: 'new_isolated_turn' },
      turnId: 'new_isolated_turn',
    } });
  });
  await page.route('**/api/turns/new_isolated_turn/events*', route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => submitted?.text).toBe('A question for the new project');
  expect(submitted.sessionId || null).toBeNull();
  expect(submitted.cwd).toBe('/Users/test/new-project');
  expect(errors).toEqual([]);
});

test('a delayed project selection cannot replace a new draft', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => globalThis.__isolation.state.projectsLoaded)).toBe(true);
  await expect.poll(() => page.evaluate(() => globalThis.__isolation.state.sessionsLoading)).toBe(false);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/api/sessions?projectId=project_browser_fixture', async route => {
    const response = await route.fetch();
    requested = true;
    await gate;
    await route.fulfill({ response });
  });
  await page.evaluate(() => { globalThis.__isolation.selecting = globalThis.__isolation.selectProjectScope('project_browser_fixture'); });
  await expect.poll(() => requested).toBe(true);
  await page.locator('#open-new-session-button').click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('#prompt-input').fill('Keep this new draft');
  release();
  await page.evaluate(() => globalThis.__isolation.selecting);
  await expect(page.locator('.new-session-empty-state')).toBeVisible();
  await expect(page.locator('#prompt-input')).toHaveValue('Keep this new draft');
  expect(await page.evaluate(() => globalThis.__isolation.state.sessionId)).toBeNull();
});

test('uploaded image links survive switching away and reloading the session', async ({ page }, info) => {
  const id = 'session_browser_idle';
  const localPath = `/state/turn-attachments/user/${id}/screenshot.png`;
  const text = `Inspect this screenshot\n\nAttachments:\n1. image\n   path: ${localPath}\n   filename: screenshot.png\n   mime: image/png\n   attached_as: localImage\n\nUse the local file paths above when you inspect these attachments.`;
  const session = { id, cwd: '/Users/test/yanshan_quant', settings: {}, activeTurnId: null };
  await page.route(`**/api/sessions/${id}/status`, route => route.fulfill({ json: { session } }));
  await page.route(`**/api/sessions/${id}/timeline?*`, route => route.fulfill({ json: {
    session, items: [{ id: 'uploaded_user_message', kind: 'message', role: 'user', meta: 'sent', text }], hasMore: false,
  } }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=', 'base64');
  await page.route(`**/api/sessions/${id}/files/resolve`, route => route.fulfill({ json: {
    file: { id: 'screenshot', name: 'screenshot.png', path: localPath, kind: 'image', mimeType: 'image/png', sizeBytes: png.length, contentUrl: `/api/sessions/${id}/files/screenshot/content` },
  } }));
  await page.route(`**/api/sessions/${id}/files/screenshot/content*`, route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.goto('/');
  await page.locator(`button[data-session-id="${id}"]`).click();
  await expect(page.locator('.message-attachment')).toContainText('screenshot.png');
  if (await page.locator('#back-to-list-button').isVisible()) await page.locator('#back-to-list-button').click();
  await page.locator('button[data-session-id="session_browser_history"]').click();
  if (await page.locator('#back-to-list-button').isVisible()) await page.locator('#back-to-list-button').click();
  await page.locator(`button[data-session-id="${id}"]`).click();
  await expect(page.locator('.message-attachment')).toContainText('screenshot.png');
  await page.reload();
  await expect(page.locator('.message-attachment')).toContainText('screenshot.png');
  await page.screenshot({ path: info.outputPath('reopened-message-attachment.png') });
  await page.locator('.message-attachment').click();
  await expect(page.locator('.session-file-image')).toBeVisible();
  await expect.poll(() => page.locator('.session-file-image').evaluate(image => image.naturalWidth)).toBe(1);
  await page.screenshot({ path: info.outputPath('reopened-attachment.png') });
});
