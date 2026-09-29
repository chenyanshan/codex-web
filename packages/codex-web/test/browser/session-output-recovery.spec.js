import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const recovery of ['completion', 'completion with replaced anchor', 'manual refresh with replaced anchor', 'partial page with replaced anchor']) {
  test(`${recovery}: reconcile output while preserving partial history windows`, async ({ page }, info) => {
    test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('codexWebToken', 'browser-output-recovery');
      localStorage.setItem('codexWebLanguage', 'en');
    });
    await page.route('**/app.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__outputTest = { applyTurnEvent, state, handleComposerRefresh };` });
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
      const items = completed ? [{ ...user, id: recovery.includes('replaced anchor') ? 'persisted_user' : user.id }, answer] : [user];
      return route.fulfill({ json: url.pathname.endsWith('/timeline') ? { session, items, hasMore: completed && recovery.startsWith('partial') }
        : url.pathname.endsWith('/status') ? { session } : { session: { ...session, timeline: items, timelineComplete: true } } });
    });
    await page.route(`**/api/turns/${turnId}/events*`, route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true } }));
    await page.goto('/');
    await page.locator(`button[data-session-id="${id}"]`).click();
    await expect(page.locator('#timeline')).toContainText(user.text);
    await expect(page.locator('#timeline')).not.toContainText(answer.text);
    if (recovery.includes('replaced anchor')) {
      // Reading mode can outlive an optimistic/stream item ID. A full server
      // history must still replace it when that DOM anchor no longer exists.
      await page.evaluate(() => { globalThis.__outputTest.state.timelineShouldFollowLatest = false; });
    }
    completed = true;
    if ((recovery.startsWith('manual') || recovery.startsWith('partial'))) {
      await page.evaluate(() => globalThis.__outputTest.handleComposerRefresh());
      await page.evaluate(() => globalThis.__outputTest.handleComposerRefresh());
    } else await page.evaluate(turnId => globalThis.__outputTest.applyTurnEvent({ type: 'turn.completed', turnId, status: 'completed' }, null), turnId);
    if (recovery.startsWith('partial')) {
      await expect(page.locator('#timeline')).not.toContainText(answer.text);
      await expect(page.locator('#timeline')).toContainText(user.text);
    } else {
      await expect(page.locator('#timeline')).toContainText(answer.text);
      await expect(page.locator('#timeline [data-timeline-id]')).toHaveCount(2);
    }
    await expect(page.locator('.composer-status')).toContainText('Ready');
    await page.screenshot({ path: info.outputPath('recovered-output.png'), animations: 'disabled' });
    expect(errors).toEqual([]);
  });
}
