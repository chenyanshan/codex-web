import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('compact running header and circular latest control remain usable with long metadata', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait', 'mobile-compact'].includes(info.project.name));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('codexWebToken', 'browser-controls-token'); localStorage.setItem('codexWebLanguage', 'en'); });
  const id = 'session_browser_history', turnId = 'controls_turn';
  const session = { id, title: 'Review session rendering, navigation and weak-network recovery across every layout',
    cwd: '/Users/test/workspaces/a-very-long-production-project-directory-name',
    goal: { objective: 'Verify that the session remains readable throughout the running goal', status: 'active' },
    activeTurnId: turnId, activityState: 'running', turnStartedAt: Date.now() - 38000, lastBusinessActivityAt: Date.now() - 5000,
    settings: {},
  };
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `controls_${i}`, kind: 'message', role: i % 2 ? 'assistant' : 'user',
    turnId, meta: i % 2 ? 'commentary' : 'history', text: `Review step ${i}\n\n${'Keep the current reading position during network and layout updates.\n\n'.repeat(5)}` }));
  await page.route(new RegExp(`/api/sessions/${id}(?:[/?]|$)`), route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.pathname.endsWith('/status') ? { session } : url.pathname.endsWith('/timeline')
      ? { session, items, hasMore: false } : { session: { ...session, timeline: items, timelineComplete: true } } });
  });
  await page.route(`**/api/turns/${turnId}/events*`, route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
  let interrupts = 0;
  await page.route(`**/api/turns/${turnId}/interrupt`, route => { interrupts++; expect(route.request().method()).toBe('POST'); return route.fulfill({ json: { ok: true } }); });
  await page.goto('/'); await page.locator(`[data-session-id="${id}"]`).click();
  await expect(page.locator('#timeline')).toContainText('Review step 11');
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toBeVisible(); await expect(stop.locator('svg')).toBeVisible();
  expect(await stop.textContent()).toBe('');
  await page.locator('#timeline').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  const latest = page.getByRole('button', { name: 'Back to latest', exact: true });
  await expect(latest).toBeVisible();
  await expect(latest).toHaveCSS('border-radius', '50%');
  expect(await latest.textContent()).toBe('');
  for (const width of info.project.name === 'desktop' ? [1440, 980] : [info.project.use.viewport.width]) {
    await page.setViewportSize({ width, height: info.project.use.viewport.height });
    const header = await page.locator('.chat-topbar').boundingBox(), actions = await page.locator('.chat-header-actions').boundingBox();
    const title = await page.locator('.chat-title-stack').boundingBox(), arrow = await latest.boundingBox();
    const composer = await page.locator('.composer-wrap').boundingBox();
    expect(header.height).toBeLessThanOrEqual(60);
    expect(title.x + title.width).toBeLessThanOrEqual(actions.x);
    expect(arrow.width).toBe(44); expect(arrow.height).toBe(44);
    expect(arrow.y + arrow.height).toBeLessThanOrEqual(composer.y);
    if (info.project.name.startsWith('mobile')) expect((await stop.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `docs/audits/2026-09-19-second-remediation-evidence/session-controls-${info.project.name}-${width}.png` });
  }
  await latest.focus(); await page.keyboard.press('Enter');
  await expect.poll(() => page.locator('#timeline').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
  await expect(latest).toBeHidden();
  await stop.focus(); await page.keyboard.press('Enter');
  await expect.poll(() => interrupts).toBe(1);
  expect(errors).toEqual([]);
});
