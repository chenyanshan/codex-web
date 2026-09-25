import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function setup(page, count = 65) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-stable-order');
    localStorage.setItem('codexWebLanguage', 'en');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__stableOrder = { state, refreshSessionsList, refreshCurrentView, showSessionList, render };` });
  });
  const sessions = Array.from({ length: count }, (_, index) => ({
    id: `stable_${String(index).padStart(2, '0')}`, title: `Session ${index}`,
    cwd: '/Users/test/work', settings: {}, favorite: true, archived: false,
    listOrderAt: 10_000 - index, updatedAt: 10_000 - index, lastInputAt: 10_000 - index,
    activeTurnId: index < 2 ? `turn_stable_${index}` : null,
    activityState: index < 2 ? 'running' : null,
  }));
  const requests = [], archives = [], sends = [];
  await page.route(/\/api\/sessions(?:\?|$)/u, route => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const ordered = sessions.filter(session => session.archived === (url.searchParams.get('state') === 'archived'))
      .sort((left, right) => right.listOrderAt - left.listOrderAt || left.id.localeCompare(right.id));
    const start = Number(url.searchParams.get('cursor') || 0), end = start + 30;
    return route.fulfill({ json: { items: ordered.slice(start, end), nextCursor: end < ordered.length ? String(end) : null, totalCount: ordered.length, directoryComplete: true } });
  });
  await page.route(/\/api\/sessions\/stable_\d+(?:[/?]|$)/u, route => {
    const url = new URL(route.request().url()), id = url.pathname.split('/')[3];
    const session = sessions.find(item => item.id === id);
    if (url.pathname.endsWith('/archive')) {
      archives.push(id); session.archived = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname.endsWith('/unarchive')) {
      session.archived = false;
      return route.fulfill({ json: { session } });
    }
    if (url.pathname.endsWith('/turns')) {
      sends.push(id); session.listOrderAt = 20_000; session.activeTurnId = `turn_sent_${id}`; session.activityState = 'running';
      return route.fulfill({ json: { turnId: session.activeTurnId, session } });
    }
    const items = [{ id: `answer_${id}`, kind: 'message', role: 'assistant', text: `History for ${id}`, meta: 'final' }];
    return route.fulfill({ json: { session: { ...session, thread: { turns: [] }, timeline: items, timelineComplete: true }, items, hasMore: false } });
  });
  await page.route('**/api/turns/*/events*', route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
  await page.goto('/');
  await expect(page.locator('button[data-session-id="stable_00"]')).toBeVisible();
  return { sessions, requests, archives, sends, errors };
}

const rowIds = page => page.locator('.session-list button[data-session-id]').evaluateAll(rows => rows.map(row => row.dataset.sessionId));
const refreshList = page => page.evaluate(() => globalThis.__stableOrder.refreshCurrentView());

test('concurrent output, attention and return navigation preserve order; explicit send promotes in recents and favorites', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  const fixture = await setup(page, 25);
  const expected = await rowIds(page);
  for (const [index, session] of fixture.sessions.entries()) session.updatedAt = 50_000 + index;
  fixture.sessions[0].activityState = 'waiting_approval';
  Object.assign(fixture.sessions[1], { activityState: null, activeTurnId: null, latestTurn: { id: 'turn_stable_1', status: 'completed' } });
  fixture.sessions[2].activityState = 'failed';
  await page.evaluate(() => globalThis.__stableOrder.refreshSessionsList({ renderAfter: true, scope: 'all' }));
  expect(await rowIds(page)).toEqual(expected);
  await expect(page.locator('[data-session-id="stable_01"] .session-attention-state')).toHaveAttribute('data-state', 'unread');
  await expect(page.locator('[data-session-id="stable_02"] .session-attention-state')).toHaveAttribute('data-state', 'failed');
  await page.locator('button[data-session-id="stable_10"]').click();
  await expect(page.locator('#timeline')).toContainText('History for stable_10');
  await page.locator('#prompt-input').fill('Keep an unsent draft');
  if (info.project.name !== 'desktop') await page.locator('.chat-back-button').click();
  expect(await rowIds(page)).toEqual(expected);
  await page.locator('[data-sort-mode="favorites"]').click();
  expect(await rowIds(page)).toEqual(expected);
  await page.locator('button[data-session-id="stable_10"]').click();
  await expect(page.locator('#prompt-input')).toHaveValue('Keep an unsent draft');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => fixture.sends).toEqual(['stable_10']);
  if (info.project.name !== 'desktop') await page.locator('.chat-back-button').click();
  await page.evaluate(() => globalThis.__stableOrder.refreshSessionsList({ renderAfter: true, scope: 'favorites' }));
  await expect.poll(() => rowIds(page)).toEqual(['stable_10', ...expected.filter(id => id !== 'stable_10')]);
  await page.locator('[data-sort-mode="time"]').click();
  await page.evaluate(() => globalThis.__stableOrder.refreshSessionsList({ renderAfter: true, scope: 'all' }));
  expect((await rowIds(page))[0]).toBe('stable_10');
  await page.reload();
  if (info.project.name !== 'desktop' && await page.locator('.chat-back-button').isVisible()) await page.locator('.chat-back-button').click();
  await expect.poll(async () => (await rowIds(page))[0]).toBe('stable_10');
  expect(fixture.errors).toEqual([]);
});

test('loaded pages and list scroll survive opening a session and refreshing output', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  const fixture = await setup(page);
  await page.getByRole('button', { name: 'Load older sessions', exact: true }).click();
  await expect(page.locator('.session-list button[data-session-id]')).toHaveCount(60);
  await page.locator('button[data-session-id="stable_45"]').scrollIntoViewIfNeeded();
  const list = page.locator('.session-list');
  const before = await list.evaluate(element => element.scrollTop);
  expect(before).toBeGreaterThan(100);
  await page.locator('button[data-session-id="stable_45"]').click();
  await expect(page.locator('#timeline')).toContainText('History for stable_45');
  if (info.project.name !== 'desktop') await page.locator('.chat-back-button').click();
  await expect.poll(async () => Math.abs(await list.evaluate(element => element.scrollTop) - before)).toBeLessThan(3);
  const expected = await rowIds(page);
  fixture.sessions.forEach((session, index) => { session.updatedAt = 99_000 + index; });
  await refreshList(page);
  await expect(page.locator('.session-list button[data-session-id]')).toHaveCount(60);
  expect(await rowIds(page)).toEqual(expected);
  await expect.poll(async () => Math.abs(await list.evaluate(element => element.scrollTop) - before)).toBeLessThan(3);
  // The remaining third page stays lazy until the user asks for it.
  expect(fixture.requests.some(query => new URLSearchParams(query).get('cursor') === '60')).toBe(false);
  await page.screenshot({ path: info.outputPath('stable-list-position.png') });
  expect(fixture.errors).toEqual([]);
});

test('archive another idle session while current session runs, and restore it without promoting it', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait', 'mobile-compact'].includes(info.project.name));
  const fixture = await setup(page, 8);
  await page.locator('button[data-session-id="stable_00"]').click();
  await expect.poll(() => page.evaluate(() => globalThis.__stableOrder.state.pendingTurn)).toBe(true);
  if (info.project.name !== 'desktop') await page.locator('.chat-back-button').click();
  await expect(page.locator('[data-session-archive-request-id="stable_00"]')).toBeDisabled();
  if (info.project.name === 'desktop') {
    await page.locator('button[data-session-id="stable_02"]').hover();
    await page.locator('[data-session-archive-request-id="stable_02"]').click();
  } else {
    await page.locator('button[data-session-id="stable_02"]').click();
    // Background pagination may remove the current session from the visible list.
    await page.evaluate(() => {
      const { state } = globalThis.__stableOrder;
      state.sessions = state.sessions.filter(session => session.id !== 'stable_02');
      for (const scope of ['all', 'favorites']) state.sessionsByScope[scope] = state.sessionsByScope[scope].filter(session => session.id !== 'stable_02');
    });
    await page.getByRole('button', { name: 'Session menu', exact: true }).click();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
  }
  const dialog = page.getByRole('dialog', { name: 'Archive session?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect.poll(() => fixture.archives).toEqual(['stable_02']);
  await expect(page.locator('button[data-session-id="stable_02"]')).toHaveCount(0);
  await page.locator('[data-sort-mode="archived"]').click();
  if (info.project.name === 'desktop') await page.locator('button[data-session-id="stable_02"]').hover();
  await page.locator('[data-session-unarchive-id="stable_02"]').click();
  await page.locator('[data-sort-mode="time"]').click();
  await page.evaluate(() => globalThis.__stableOrder.refreshSessionsList({ scope: 'all' }));
  expect((await rowIds(page)).slice(0, 3)).toEqual(['stable_00', 'stable_01', 'stable_02']);
  expect(fixture.sessions[2].listOrderAt).toBe(9_998);
  expect(fixture.errors).toEqual([]);
});
