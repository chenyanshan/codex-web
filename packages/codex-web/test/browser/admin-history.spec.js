import { test, expect } from '@playwright/test';
import { installAdminFixture, openAdminConsole, returnToAdminList, adminTimelinePage, sessions } from './helpers/admin-fixture.js';

const messages = Array.from({ length: 235 }, (_, index) => ({
  id: `lazy_${index}`, kind: 'message', role: index % 2 ? 'assistant' : 'user',
  meta: index % 2 ? 'final' : 'history',
  text: `History message ${index}\n\nReview this recorded exchange before continuing to the next part of the session.`,
}));

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait', 'mobile-compact'].includes(info.project.name));
  await installAdminFixture(page);
});

async function openHistory(page, info, handlePage = null) {
  const requests = [], detailRequests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`**/api/admin/sessions/${sessions[0].id}`, route => {
    detailRequests.push(route.request().url());
    return route.fulfill({ status: 418, json: { error: 'full_history_request_is_not_allowed' } });
  });
  await page.route(`**/api/admin/sessions/${sessions[0].id}/timeline?*`, async route => {
    const url = new URL(route.request().url());
    const payload = adminTimelinePage(sessions[0], messages, url);
    requests.push({ after: url.searchParams.get('after'), before: url.searchParams.get('before'), anchors: url.searchParams.getAll('anchor'), count: payload.items.length });
    if (handlePage && await handlePage(route, url)) return;
    await route.fulfill({ json: payload }).catch(() => {});
  });
  await openAdminConsole(page, info.project.name);
  await page.locator(`[data-admin-session-id="${sessions[0].id}"]`).click();
  await expect(page.locator('#timeline [data-timeline-id]').first()).toHaveAttribute('data-timeline-id', 'lazy_0');
  await expect(page.locator('#timeline [data-timeline-id]')).toHaveCount(50);
  await expect.poll(() => page.locator('#timeline').evaluate(el => el.scrollTop)).toBe(0);
  expect(requests).toEqual([{ after: '0', before: null, anchors: [], count: 50 }]);
  expect(detailRequests).toEqual([]);
  return { requests, detailRequests, errors };
}

async function scrollToEnd(page) {
  await page.locator('#timeline').dispatchEvent('wheel', { deltaY: 1000 });
  await page.locator('#timeline').evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
}

test('admin history loads the earliest page and continues downwards without losing the reading anchor', async ({ page }, info) => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const state = await openHistory(page, info, async (_route, url) => {
    if (url.searchParams.get('after') === '50') await delayed;
    return false;
  });
  await expect(page.locator('#prompt-input')).toHaveCount(0);
  await scrollToEnd(page);
  await expect.poll(() => state.requests.length).toBe(2);
  const anchor = await page.locator('#timeline').evaluate(el => {
    const top = el.getBoundingClientRect().top;
    const item = [...el.querySelectorAll('[data-timeline-id]')].find(node => node.getBoundingClientRect().bottom > top + 1);
    return { id: item.dataset.timelineId, y: item.getBoundingClientRect().top };
  });
  release();
  await expect(page.locator('[data-timeline-window="1"]')).toBeEnabled();
  await expect.poll(() => page.locator('#timeline [data-timeline-id]').count()).toBeGreaterThan(50);
  expect(Math.abs((await page.locator(`[data-timeline-id="${anchor.id}"]`).boundingBox()).y - anchor.y)).toBeLessThanOrEqual(3);
  const mounted = new Set(messages.slice(0, 50).map(item => item.id));
  for (let step = 0; step < 16; step++) {
    const ids = await page.locator('#timeline [data-timeline-id]').evaluateAll(nodes => nodes.map(node => node.dataset.timelineId));
    expect(ids.length).toBeLessThanOrEqual(80);
    ids.forEach(id => mounted.add(id));
    if (ids.at(-1) === 'lazy_234') break;
    const prior = ids.at(-1);
    await scrollToEnd(page);
    await expect.poll(() => page.locator('#timeline [data-timeline-id]').last().getAttribute('data-timeline-id')).not.toBe(prior);
  }
  await expect(page.locator('#timeline [data-timeline-id]').last()).toHaveAttribute('data-timeline-id', 'lazy_234');
  expect(mounted.size).toBe(235);
  expect(state.requests.map(request => request.after)).toEqual(['0', '50', '100', '150', '200']);
  expect(state.requests.every(request => request.count <= 50)).toBe(true);
  expect(state.detailRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('failed forward pages keep existing history and retry only on user input', async ({ page }, info) => {
  let failures = 1;
  const state = await openHistory(page, info, async (route, url) => {
    if (url.searchParams.get('after') === '50' && failures-- > 0) {
      await route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } });
      return true;
    }
    return false;
  });
  await scrollToEnd(page);
  await expect(page.locator('#retry-session-history')).toBeAttached();
  await expect(page.locator('#timeline [data-timeline-id]')).toHaveCount(50);
  await page.waitForTimeout(300);
  expect(state.requests.map(request => request.after)).toEqual(['0', '50']);
  await page.locator('#retry-session-history').click();
  await expect(page.locator('#retry-session-history')).toHaveCount(0);
  expect(state.requests.map(request => request.after)).toEqual(['0', '50', '50']);
  expect(state.detailRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('jumping to latest and loading earlier history use bounded pages', async ({ page }, info) => {
  const state = await openHistory(page, info);
  await page.locator('#timeline-jump-latest').click();
  await expect(page.locator('[data-timeline-id="lazy_234"]')).toBeInViewport();
  expect(state.requests.at(-1)).toEqual({ after: null, before: null, anchors: [], count: 50 });
  await page.getByRole('button', { name: 'Show earlier messages', exact: true }).click();
  await expect.poll(() => state.requests.at(-1).before).toBe('185');
  expect(await page.locator('#timeline [data-timeline-id]').count()).toBeLessThanOrEqual(80);
  expect(state.detailRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('foreground refresh requests a bounded page around the current reading position', async ({ page }, info) => {
  const state = await openHistory(page, info);
  await page.locator('#timeline').evaluate(el => { el.scrollTop = el.scrollHeight * 0.45; el.dispatchEvent(new Event('scroll')); });
  const anchor = await page.locator('#timeline').evaluate(el => {
    const top = el.getBoundingClientRect().top;
    const item = [...el.querySelectorAll('[data-timeline-id]')].find(node => node.getBoundingClientRect().bottom > top + 1);
    return { id: item.dataset.timelineId, y: item.getBoundingClientRect().top };
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => state.requests.length).toBe(2);
  expect(state.requests[1].anchors).toContain(anchor.id);
  expect(state.requests[1].count).toBe(50);
  await expect.poll(async () => Math.abs((await page.locator(`[data-timeline-id="${anchor.id}"]`).boundingBox()).y - anchor.y)).toBeLessThanOrEqual(3);
  expect(state.detailRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('a late history page cannot overwrite another observed session', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-compact');
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const state = await openHistory(page, info, async (_route, url) => {
    if (url.searchParams.get('after') === '50') await delayed;
    return false;
  });
  await page.route(`**/api/admin/sessions/${sessions[1].id}/timeline?*`, route => route.fulfill({ json: adminTimelinePage(sessions[1], [{ id: 'other_history', kind: 'message', role: 'assistant', text: 'A different observed conversation' }], route.request().url()) }));
  await scrollToEnd(page);
  await expect.poll(() => state.requests.length).toBe(2);
  await returnToAdminList(page);
  await page.locator(`[data-admin-session-id="${sessions[1].id}"]`).click();
  await expect(page.locator('#timeline')).toContainText('A different observed conversation');
  release();
  await expect(page.locator('#timeline')).not.toContainText('History message');
  expect(state.errors).toEqual([]);
});
