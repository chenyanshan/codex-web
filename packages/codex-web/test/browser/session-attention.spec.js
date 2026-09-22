import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('session dots distinguish running, unread, approval and failure without growing rows', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-session-dots');
    localStorage.setItem('codexWebLanguage', 'zh-CN');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__attentionTest = { state, render, refreshBackgroundSessionAttention };` });
  });
  const ids = ['session_browser_fixture', 'session_browser_idle', 'session_browser_history', 'session_browser_files'];
  const sessions = [
    { id: ids[0], title: '检查正在运行的监控任务', activityState: 'running', activeTurnId: 'turn_running' },
    { id: ids[1], title: '已完成的排查结果，还没有查看', activityState: null, activeTurnId: null, latestTurn: { id: 'turn_unread', status: 'completed' } },
    { id: ids[2], title: '等待确认的文件修改', activityState: 'waiting_approval', activeTurnId: 'turn_approval' },
    { id: ids[3], title: '执行失败的任务，需要重试', activityState: 'failed', activeTurnId: null, latestTurn: { id: 'turn_failed', status: 'failed' } },
  ].map(session => ({ ...session, cwd: '/Users/test/work', settings: {}, updatedAt: 1000 }));
  await page.route(/\/api\/sessions(?:\?|$)/u, route => route.fulfill({ json: { items: sessions, directoryComplete: true } }));
  for (const session of sessions) {
    await page.route(new RegExp(`/api/sessions/${session.id}(?:[/?]|$)`), route => {
      const turnId = session.latestTurn?.id || session.activeTurnId;
      const items = session.latestTurn?.status === 'completed' ? [
        { id: 'question', kind: 'message', role: 'user', turnId, text: '检查监控任务' },
        { id: 'answer', kind: 'message', role: 'assistant', turnId, text: '排查结果已经生成。', meta: 'final' },
      ] : [];
      return route.fulfill({ json: { session: { ...session, thread: { turns: [{ id: turnId, status: session.latestTurn?.status || 'inProgress', items: [] }] }, timeline: items }, items, hasMore: false } });
    });
  }
  await page.route('**/api/turns/*/events*', route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
  await page.goto('/');
  const dot = id => page.locator(`button[data-session-id="${id}"] .session-attention-state`);
  await expect(dot(ids[0])).toHaveAttribute('data-state', 'running');
  await expect(dot(ids[1])).toHaveAttribute('data-state', 'unread');
  await expect(dot(ids[2])).toHaveAttribute('data-state', 'waiting_approval');
  await expect(dot(ids[3])).toHaveAttribute('data-state', 'failed');
  await expect(dot(ids[1])).toHaveAttribute('aria-label', '已完成 · 未读');
  for (const width of info.project.name === 'desktop' ? [1440, 980] : [390, 320]) {
    await page.setViewportSize({ width, height: info.project.name === 'desktop' ? 900 : 844 });
    await expect(dot(ids[0])).toHaveCSS('width', '8px');
    await expect(dot(ids[0])).toHaveCSS('height', '8px');
    await expect(dot(ids[0])).toHaveText('');
    await page.screenshot({ path: info.outputPath(`session-dots-${width}.png`), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.locator(`button[data-session-id="${ids[1]}"]`).click();
  await expect(page.locator('#timeline')).toContainText('排查结果已经生成。');
  if (info.project.name !== 'desktop') await page.locator('.chat-back-button').click();
  await expect(dot(ids[1])).toHaveCount(0);
  await expect(dot(ids[3])).toHaveAttribute('data-state', 'failed');
  await page.reload();
  if (info.project.name !== 'desktop' && await page.locator('.chat-back-button').isVisible()) await page.locator('.chat-back-button').click();
  await expect(page.locator(`button[data-session-id="${ids[1]}"]`)).toBeVisible();
  await expect(dot(ids[1])).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(dot(ids[0])).toHaveCSS('animation-name', 'none');
  expect(errors).toEqual([]);
});
