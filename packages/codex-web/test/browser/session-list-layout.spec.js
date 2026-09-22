import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('activity badges stay beside long titles without increasing card height', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-session-badge-token');
    localStorage.setItem('codexWebLanguage', 'zh-CN');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__badgeTest = { setSessionSummaryActivity, render };` });
  });
  await page.route(/\/api\/sessions(?:\?|$)/u, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.items = payload.items.map(session => session.id === 'session_browser_idle' ? {
      ...session, title: '分析监控告警如何触发排查，并检查长会话标题与活动状态的布局',
    } : session);
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/');
  const card = page.locator('.session-card').filter({ has: page.locator('button[data-session-id="session_browser_idle"]') });
  for (const width of info.project.name === 'desktop' ? [1440, 980] : [390, 320]) {
    await page.setViewportSize({ width, height: info.project.name === 'desktop' ? 900 : 844 });
    await page.evaluate(() => { globalThis.__badgeTest.setSessionSummaryActivity('session_browser_idle', null); globalThis.__badgeTest.render(); });
    await expect(card).toBeVisible();
    // Finish the workspace width transition before comparing row geometry.
    await page.screenshot({ path: info.outputPath(`idle-${width}.png`), animations: 'disabled' });
    const height = (await card.boundingBox()).height;
    for (const status of ['running', 'waiting_approval']) {
      await page.evaluate(status => { globalThis.__badgeTest.setSessionSummaryActivity('session_browser_idle', status, 'badge_turn'); globalThis.__badgeTest.render(); }, status);
      const badge = card.locator('.session-attention-state');
      await expect(badge).toBeVisible();
      const titleBox = await card.locator('.session-title').boundingBox();
      const badgeBox = await badge.boundingBox();
      expect(Math.abs(badgeBox.y - titleBox.y)).toBeLessThanOrEqual(6);
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(badgeBox.x);
      expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual((await card.boundingBox()).x + (await card.boundingBox()).width);
      expect((await card.boundingBox()).height).toBe(height);
      if (status === 'running') await page.screenshot({ path: info.outputPath(`active-${width}.png`), animations: 'disabled' });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('session titles use the full desktop card width and footer actions remain accessible', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(request.url()));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-session-layout-token');
    localStorage.setItem('codexWebLanguage', 'en');
  });
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true } }));
  let idleSession;
  await page.route(/\/api\/sessions(?:\?|$)/u, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.items = payload.items.map(session => session.id === 'session_browser_idle' ? {
      ...session,
      title: '检查会话列表的长标题与操作按钮布局，保留更多可读内容',
      firstUserInput: '检查会话列表的长标题与操作按钮布局，保留更多可读内容',
      lastUserInput: 'Review session-list layout with long previews and accessible actions',
    } : session);
    idleSession = payload.items.find(session => session.id === 'session_browser_idle') || idleSession;
    await route.fulfill({ response, json: payload });
  });
  let favorites = 0;
  await page.route('**/api/sessions/session_browser_idle/favorite', route => {
    favorites++;
    return route.fulfill({ json: { session: { ...idleSession, favorite: true } } });
  });
  await page.goto('/');
  const open = page.locator('button[data-session-id="session_browser_idle"]');
  const card = page.locator('.session-card').filter({ has: open });
  const actions = card.locator('.session-card-actions');
  const favorite = card.locator('.session-favorite');
  const desktop = info.project.name === 'desktop';
  if (desktop) {
    await page.locator('button[data-session-id="session_browser_history"]').click();
    await expect(page.locator('#timeline')).toBeVisible();
    await page.locator('[data-sort-mode]').first().focus();
  }
  for (const width of desktop ? [1440, 980, 979] : [390]) {
    await page.setViewportSize({ width, height: desktop ? 900 : 844 });
    if (desktop && width < 980) await page.locator('.chat-back-button').click();
    await expect(open).toBeVisible();
    let previousWidth = 0;
    let stableReads = 0;
    await expect.poll(async () => {
      const currentWidth = (await card.boundingBox()).width;
      stableReads = currentWidth === previousWidth ? stableReads + 1 : 0;
      previousWidth = currentWidth;
      return stableReads;
    }, { intervals: [100] }).toBeGreaterThanOrEqual(3);
    await page.mouse.move(0, 0);
    if (desktop && width >= 980) {
      await page.locator('[data-sort-mode]').first().focus();
      await expect(actions).toHaveCSS('opacity', '0');
      const before = await card.boundingBox();
      const content = await card.locator('.session-card-main').boundingBox();
      expect(before.x + before.width - content.x - content.width).toBeLessThanOrEqual(14);
      await card.hover();
      await expect(actions).toHaveCSS('opacity', '1');
      const actionBox = await actions.boundingBox();
      expect(actionBox.y).toBeGreaterThanOrEqual(content.y + content.height);
      const metadata = card.locator('.session-card-meta span');
      for (const span of await metadata.all()) {
        const box = await span.boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(actionBox.x);
      }
      expect((await card.boundingBox()).height).toBe(before.height);
      const hoveredContent = await card.locator('.session-card-main').boundingBox();
      expect(hoveredContent.width).toBe(content.width);
      expect(hoveredContent.height).toBe(content.height);
      await page.screenshot({ path: info.outputPath(`sessions-${width}-hover.png`) });
      await page.mouse.move(0, 0);
      await open.focus();
      await page.keyboard.press('Tab');
      await expect(favorite).toBeFocused();
      await expect(actions).toHaveCSS('opacity', '1');
      await page.keyboard.press('Tab');
      await expect(card.locator('.session-archive')).toBeFocused();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Archive session?' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toHaveCount(0);
      await page.locator('[data-sort-mode]').first().focus();
    } else {
      await expect(actions).toHaveCSS('opacity', '1');
      if (!desktop) {
        const box = await favorite.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`sessions-${width}.png`) });
  }
  await favorite.click();
  await expect.poll(() => favorites).toBe(1);
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await open.click();
  await expect(page.locator('#timeline')).toBeVisible();
  expect(errors).toEqual([]);
});
