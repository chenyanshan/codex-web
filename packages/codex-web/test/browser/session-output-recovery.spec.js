import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('completion recovers an answer missing from the live stream', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-output-recovery');
    localStorage.setItem('codexWebLanguage', 'en');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__outputTest = { applyTurnEvent };` });
  });
  const id = 'session_browser_history', turnId = 'output_recovery_turn';
  const user = { id: 'recovery_user', kind: 'message', role: 'user', turnId, meta: 'history', text: 'Analyze the monitoring agent architecture.' };
  const answer = { id: 'recovery_answer', kind: 'message', role: 'assistant', turnId, meta: 'final', phase: 'final_answer', text: 'Use a triage service to assess monitoring signals before starting an investigation.' };
  let completed = false;
  await page.route(new RegExp(`/api/sessions/${id}(?:[/?]|$)`), route => {
    const url = new URL(route.request().url());
    const session = { id, title: 'Output recovery', cwd: '/Users/test/yanshan_quant', settings: {},
      activeTurnId: completed ? null : turnId, activityState: completed ? 'idle' : 'running',
      updatedAt: completed ? 2000 : 1000,
      thread: { turns: [{ id: turnId, status: completed ? 'completed' : 'inProgress', items: [] }] } };
    const items = completed ? [user, answer] : [user];
    return route.fulfill({ json: url.pathname.endsWith('/timeline') ? { session, items, hasMore: false }
      : url.pathname.endsWith('/status') ? { session } : { session: { ...session, timeline: items, timelineComplete: true } } });
  });
  await page.route(`**/api/turns/${turnId}/events*`, route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/');
  await page.locator(`button[data-session-id="${id}"]`).click();
  await expect(page.locator('#timeline')).toContainText(user.text);
  await expect(page.locator('#timeline')).not.toContainText(answer.text);
  completed = true;
  await page.evaluate(turnId => globalThis.__outputTest.applyTurnEvent({ type: 'turn.completed', turnId, status: 'completed' }, null), turnId);
  await expect(page.locator('#timeline')).toContainText(answer.text);
  await expect(page.locator('.composer-status')).toContainText('Ready');
  await page.screenshot({ path: info.outputPath('recovered-output.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});
