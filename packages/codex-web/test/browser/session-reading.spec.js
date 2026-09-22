import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repairAttachmentHistory } from '../../src/attachment_history.ts';
test.use({ serviceWorkers: 'block' });

const id = 'session_browser_history';
const metadata = { id, title: 'Reading regression', cwd: '/Users/test/yanshan_quant', activeTurnId: null, activityState: 'idle', settings: {} };
function messages(count = 8, start = 0) {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    return { id: `reading_${index}`, kind: 'message', role: index % 2 ? 'assistant' : 'user', turnId: `reading_turn_${Math.floor(index / 2)}`, label: index % 2 ? 'Assistant' : 'User', meta: index % 2 ? 'final' : 'history', phase: index % 2 ? 'final_answer' : undefined, lifecycle: 'completed', text: index % 2 ? `Answer ${index}\n\n${Array.from({ length: 12 }, (_, row) => `Paragraph ${row + 1}: preserve the message I am reading during refresh and new output.`).join('\n\n')}` : `Question ${index}: checking reading position` };
  });
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await page.addInitScript(() => { localStorage.setItem('codexWebToken', 'browser-fixture-token'); localStorage.setItem('codexWebLanguage', 'en'); });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__readingTest = { state, applyTurnEvent, applyLanguage, reading: SESSION_READING, pageRequest: () => sessionTimelinePageRequest };` });
  });
});
async function open(page, options = {}) {
  const session = { ...metadata, readOnly: options.readOnly === true, archived: options.readOnly === true };
  await page.route(new RegExp(`/api/sessions/${id}(?:[/?]|$)`), async route => {
    const url = new URL(route.request().url());
    if (options.handle && await options.handle(route, url)) return;
    const items = messages(options.count || 8);
    await route.fulfill({ json: url.pathname.endsWith('/status') ? { session, turnSnapshot: null }
      : url.pathname.endsWith('/timeline') ? { session, items, hasMore: false, nextBefore: null }
        : { session: { ...session, timeline: items, timelineComplete: true, thread: { turns: [] } } } });
  });
  await page.goto('/');
  await page.locator(`button[data-session-id="${id}"]`).click();
  await expect(page.locator('#timeline')).toContainText(`Answer ${(options.count || 8) - 1}`);
  if (!options.slowStatus) await expect.poll(() => page.evaluate(() => globalThis.__readingTest.state.sessionStatusPending)).toBe(false);
}
async function position(page) {
  return page.locator('#timeline').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const node = [...element.querySelectorAll('[data-timeline-id]')].find(item => item.getBoundingClientRect().bottom > rect.top && item.getBoundingClientRect().top < rect.bottom);
    return { top: element.scrollTop, id: node?.getAttribute('data-timeline-id'), offset: node ? node.getBoundingClientRect().top - rect.top : 0 };
  });
}
async function readAt(page, top) {
  await page.locator('#timeline').evaluate((element, top) => { element.scrollTop = top; element.dispatchEvent(new Event('scroll')); }, top);
  return position(page);
}
async function expectAnchor(page, before) {
  await expect.poll(async () => page.locator('#timeline').evaluate((element, before) => {
    const node = [...element.querySelectorAll('[data-timeline-id]')].find(item => item.getAttribute('data-timeline-id') === before.id);
    return node ? Math.abs(node.getBoundingClientRect().top - element.getBoundingClientRect().top - before.offset) : null;
  }, before)).toBeLessThanOrEqual(2);
}
async function refresh(page) {
  const desktop = page.locator('#composer-refresh-button');
  if (await desktop.isVisible()) await desktop.click();
  else { await page.locator('#settings-toggle').click(); await page.locator('#refresh-session-button').click(); }
}

test('a short conversation opens without a history boundary or extra space', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page, { count: 2, handle: async (route, url) => {
    if (!url.pathname.endsWith('/timeline')) return false;
    const items = messages(2).map((item, index) => ({ ...item, text: index ? 'Answer 1: ready to help.' : 'Start a new session' }));
    await route.fulfill({ json: { session: metadata, items, hasMore: false, nextBefore: null } });
    return true;
  } });
  const marker = page.locator('.timeline-history-end');
  await expect(marker).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show earlier messages', exact: true })).toHaveCount(0);
  expect(await marker.evaluate(element => element.getBoundingClientRect().height)).toBe(0);
  await page.locator('#timeline').dispatchEvent('wheel', { deltaY: -200 });
  await page.locator('#timeline').dispatchEvent('keydown', { key: 'Home' });
  await expect(marker).toBeHidden();
  await page.screenshot({ path: info.outputPath('short-session.png') });
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 980, height: 900 });
    await expect(marker).toBeHidden();
    await page.screenshot({ path: info.outputPath('short-session-980.png'), animations: 'disabled' });
  }
  await page.reload();
  await expect(page.locator('#timeline')).toContainText('Answer 1');
  await expect(marker).toBeHidden();
  expect(errors).toEqual([]);
});

test('a long conversation shows its boundary only at the top, regardless of how it is scrolled', async ({ page }, info) => {
  await open(page, { count: 4 });
  const marker = page.locator('.timeline-history-end');
  await expect(marker).toBeVisible();
  await expect(marker).not.toBeInViewport();
  // Scrollbar, wheel, touch and restored positions all use the same content boundary.
  await readAt(page, 0);
  await expect(marker).toBeInViewport();
  await page.screenshot({ path: info.outputPath('history-boundary.png') });
  if (info.project.name === 'desktop') await page.locator('button[data-session-id="session_browser_idle"]').click();
  else {
    await page.locator('#back-to-list-button').click();
    await page.locator('button[data-session-id="session_browser_idle"]').click();
  }
  await expect(page.locator('#timeline')).toHaveAttribute('data-session-id', 'session_browser_idle');
  await expect(page.locator('.timeline-history-end')).toBeHidden();
});

test('the history boundary disappears when the conversation fits after resizing', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page, { count: 4 });
  await expect(page.locator('.timeline-history-end')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 2400 });
  await expect(page.locator('.timeline-history-end')).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.timeline-history-end')).toBeVisible();
  await readAt(page, 0);
  await expect(page.locator('.timeline-history-end')).toBeInViewport();
});

test('an accessible history button reveals the full conversation and preserves the anchor', async ({ page }, info) => {
  await open(page);
  await readAt(page, 0);
  const earlier = page.getByRole('button', { name: 'Show earlier messages', exact: true });
  await expect(earlier).toHaveCSS('border-top-width', '0px');
  await expect(earlier).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const buttonBox = await earlier.boundingBox();
  const timelineBox = await page.locator('#timeline').boundingBox();
  expect(buttonBox.width).toBeLessThan(timelineBox.width * 0.7);
  expect(Math.abs(buttonBox.x + buttonBox.width / 2 - timelineBox.x - timelineBox.width / 2)).toBeLessThanOrEqual(2);
  if (info.project.name === 'mobile-portrait') expect(buttonBox.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath('history-control.png') });
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 980, height: 900 });
    await page.screenshot({ path: info.outputPath('history-control-980.png'), animations: 'disabled' });
    await readAt(page, 0);
  }
  const before = await position(page);
  await earlier.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#timeline [data-timeline-id]')).toHaveCount(6);
  await expectAnchor(page, before);
  await page.getByRole('button', { name: 'Show earlier messages', exact: true }).click();
  await expect(page.locator('#timeline [data-timeline-id]')).toHaveCount(8);
  await expect(page.locator('.timeline-history-end')).toHaveText('Beginning of conversation');
  await expect(page.getByRole('button', { name: 'Show earlier messages', exact: true })).toHaveCount(0);
});

test('old acknowledged attachment messages never reappear at the latest edge after paging, refresh, or reload', async ({ page }, info) => {
  const old = ['A', 'B'].map((letter, index) => ({ id: `local_old_${letter}`, kind: 'message', role: 'user', meta: 'pending', deliveryLabel: 'Server received', submissionId: `old_submission_${letter}`, turnId: `old_turn_${letter}`, text: `Earlier image question ${letter}`, attachments: [{ kind: 'image', localPath: `/uploads/old-${index}.png`, fileName: 'image.png', mimeType: 'image/png', sizeBytes: 12000 }] }));
  await page.addInitScript(({ id, old }) => {
    if (!localStorage.getItem('codexWebTimelineCache')) localStorage.setItem('codexWebTimelineCache', JSON.stringify({ version: 3, entries: [{ sessionId: id, savedAt: Date.now(), timeline: old, history: old, historyComplete: false, batches: [], approvals: [] }] }));
  }, { id, old });
  await open(page, { handle: async (route, url) => {
    if (!url.pathname.endsWith('/timeline')) return false;
    const older = url.searchParams.has('before');
    const items = older ? old.flatMap((item, index) => [{ ...item, id: `native_old_${index}`, meta: 'history', submissionId: undefined, deliveryLabel: undefined }, { id: `native_old_answer_${index}`, kind: 'message', role: 'assistant', turnId: item.turnId, meta: 'final', text: `Earlier image answer ${index}` }]) : messages();
    await route.fulfill({ json: { session: metadata, items, hasMore: !older, nextBefore: older ? null : '80', hasNewer: false } }); return true;
  } });
  await expect(page.locator('#timeline')).not.toContainText('Earlier image question');
  await refresh(page);
  await expect.poll(() => page.evaluate(() => globalThis.__readingTest.state.status)).toBe('Ready');
  await expect(page.locator('#timeline')).not.toContainText('Earlier image question');
  await page.reload();
  await expect(page.locator('#timeline')).toContainText('Answer 7');
  await expect(page.locator('#timeline')).not.toContainText('Earlier image question');
  await page.screenshot({ path: `docs/audits/2026-09-19-second-remediation-evidence/session-order-${info.project.name}.png`, animations: 'disabled' });
  for (let attempt = 0; attempt < 4 && !await page.locator('[data-timeline-id="native_old_0"]').count(); attempt++) {
    await page.getByRole('button', { name: 'Show earlier messages', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Loading history…', exact: true })).toHaveCount(0);
  }
  await expect(page.locator('[data-timeline-id="native_old_0"]')).toHaveCount(1);
  await expect(page.locator('[data-timeline-id="local_old_A"]')).toHaveCount(0);
});

test('late initial status preserves the already visible history and user reading position', async ({ page }) => {
  const gate = deferred();
  await open(page, { slowStatus: true, handle: async (route, url) => {
    if (!url.pathname.endsWith('/status')) return false;
    await gate.promise; await route.fulfill({ json: { session: metadata } }); return true;
  } });
  const before = await readAt(page, 250);
  gate.resolve();
  await expect.poll(() => page.evaluate(() => globalThis.__readingTest.state.sessionStatusPending)).toBe(false);
  await expectAnchor(page, before);
  await expect(page.locator('#timeline-jump-latest')).toBeVisible();
});

test('reload reconciles legacy orphaned receipts and older images within the same long goal turn', async ({ page }, info) => {
  const turnId = 'long_goal';
  const session = { ...metadata, activeTurnId: turnId, activityState: 'running' };
  const latest = messages(50, 10).map(item => ({ ...item, turnId, meta: item.role === 'assistant' ? 'commentary' : 'history' }));
  const old = [0, 1, 2].map(index => ({
    id: `local_old_image_${index}`, kind: 'message', role: 'user', text: `Earlier image report ${index}`, meta: 'pending', turnId,
    // Previous versions lost these fields while normalizing cached history.
    ...(index === 0 ? {} : { submissionId: `old_submission_${index}`, deliveryLabel: 'Server received', historyAnchorId: 'outside-page' }),
    attachments: [{ kind: 'image', localPath: `/uploads/older-${index}.png`, fileName: 'image.png', mimeType: 'image/png' }],
  }));
  const native = old.map((item, index) => ({ ...item, id: `native_old_image_${index}`, meta: 'history', submissionId: undefined, deliveryLabel: undefined, historyAnchorId: undefined }));
  await page.addInitScript(({ id, old, latest }) => {
    const cached = latest.map(item => item.role === 'assistant' ? { ...item, source: 'stream' } : item);
    if (!localStorage.getItem('codexWebTimelineCache')) localStorage.setItem('codexWebTimelineCache', JSON.stringify({ version: 3, entries: [{ sessionId: id, savedAt: Date.now(), timeline: [...cached, ...old], history: [...cached, ...old], historyComplete: false, batches: [], approvals: [] }] }));
  }, { id, old, latest });
  await page.route(`**/api/turns/${turnId}/events*`, route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page, { count: 60, handle: async (route, url) => {
    if (url.pathname.endsWith('/status')) { await route.fulfill({ json: { session } }); return true; }
    if (!url.pathname.endsWith('/timeline')) return false;
    const older = url.searchParams.has('before');
    await page.waitForFunction(() => globalThis.__readingTest.state.pendingTurn);
    await route.fulfill({ json: { session, items: older ? native : latest, hasMore: !older, nextBefore: older ? null : 'older', hasNewer: false } });
    return true;
  } });
  for (const action of [async () => {}, () => refresh(page), () => page.reload()]) {
    await action();
    await expect(page.locator('#timeline')).toContainText('Answer 59');
    await expect.poll(() => page.evaluate(() => globalThis.__readingTest.state.sessionHistoryPending)).toBe(false);
    await expect(page.locator('#timeline')).not.toContainText('Earlier image report');
    expect(await page.evaluate(() => globalThis.__readingTest.state.timeline.filter(item => item.meta === 'pending').map(item => item.id))).toEqual([]);
  }
  await page.screenshot({ path: `docs/audits/2026-09-19-second-remediation-evidence/session-long-goal-order-${info.project.name}.png`, animations: 'disabled' });
  for (let attempt = 0; attempt < 30 && !await page.locator('[data-timeline-id="native_old_image_0"]').count(); attempt++) {
    await page.getByRole('button', { name: 'Show earlier messages', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Loading history…', exact: true })).toHaveCount(0);
  }
  await expect(page.locator('[data-timeline-id="native_old_image_0"]')).toHaveCount(1);
  const order = await page.locator('#timeline [data-timeline-id]').evaluateAll(items => items.map(item => item.dataset.timelineId));
  expect(order.indexOf('native_old_image_2')).toBeLessThan(order.indexOf('reading_10'));
  expect(order.filter(id => id.startsWith('local_old_image_'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('legacy duplicate images and their optimistic message reconcile to one card and one message', async ({ page }, info) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-browser-attachment-history-'));
  try {
    const root = path.join(stateDir, 'turn-attachments', 'local-admin', id);
    await fs.mkdir(root, { recursive: true });
    const snapshots = [0, 1].map(() => path.join(root, `${crypto.randomUUID()}-image.png`));
    await Promise.all(snapshots.map(filePath => fs.writeFile(filePath, 'identical synthetic image')));
    const prompt = ['Inspect this single image', '', 'Attachments:', ...snapshots.flatMap((filePath, index) => [
      `${index + 1}. image`, `   path: ${filePath}`, '   filename: image.png', '   mime: image/png', '   attached_as: localImage',
    ]), '', 'Use the local file paths above when you inspect these attachments.'].join('\n');
    const native = { id: 'native_attachment', kind: 'message', role: 'user', text: prompt, meta: 'history', turnId: 'attachment_turn' };
    const pending = { id: 'local_attachment', kind: 'message', role: 'user', text: 'Inspect this single image', meta: 'pending', turnId: 'attachment_turn', submissionId: 'attachment_receipt', deliveryLabel: 'Server received', attachments: [{ kind: 'image', localPath: '/uploads/att_image.png', fileName: 'image.png', mimeType: 'image/png', sizeBytes: 14000 }] };
    await page.addInitScript(({ id, pending }) => {
      if (!localStorage.getItem('codexWebTimelineCache')) localStorage.setItem('codexWebTimelineCache', JSON.stringify({ version: 3, entries: [{ sessionId: id, savedAt: Date.now(), timeline: [pending], history: [pending], historyComplete: false, batches: [], approvals: [] }] }));
    }, { id, pending });
    await page.route('**/api/turns/attachment_turn/events*', route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
    await open(page, { handle: async (route, url) => {
      const session = { ...metadata, activeTurnId: 'attachment_turn', activityState: 'running' };
      if (url.pathname.endsWith('/status')) { await route.fulfill({ json: { session } }); return true; }
      if (!url.pathname.endsWith('/timeline')) return false;
      const items = await repairAttachmentHistory([...messages(), native], { stateDir, sessionId: id });
      await route.fulfill({ json: { session, items, hasMore: false, nextBefore: null } }); return true;
    } });
    for (const action of [async () => {}, () => refresh(page), () => page.reload()]) {
      await action();
      await expect(page.locator('[data-timeline-id="native_attachment"]')).toContainText('Inspect this single image');
      await expect(page.locator('[data-timeline-id="local_attachment"]')).toHaveCount(0);
      await expect(page.locator('#timeline .message-attachment')).toHaveCount(1);
    }
    await page.screenshot({ path: `docs/audits/2026-09-19-second-remediation-evidence/session-attachment-repair-${info.project.name}.png`, animations: 'disabled' });
  } finally { await fs.rm(stateDir, { recursive: true, force: true }); }
});

test('foreground reconciliation preserves history reading', async ({ page }) => {
  await open(page);
  const before = await readAt(page, 250);
  const refreshed = page.waitForResponse(response => response.url().includes(`/${id}/timeline`));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  await expectAnchor(page, before);
});

test('crossing workspace layout boundaries keeps the conversation and draft visible', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.locator('#prompt-input').fill('Keep this draft while resizing');
  for (const [width, height] of [[980, 900], [979, 900], [1440, 900], [1440, 1600], [1200, 900], [768, 900], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#timeline')).toContainText('Answer 7');
    await expect(page.locator('#timeline [data-timeline-id]')).toHaveCount(4);
    await expect.poll(() => page.locator('#timeline').evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(2);
    await expect(page.locator('#prompt-input')).toHaveValue('Keep this draft while resizing');
    expect(await page.evaluate(() => globalThis.__readingTest.state.sessionId)).toBe(id);
    if (height === 900 && [979, 1440].includes(width)) await page.screenshot({ path: `docs/audits/2026-09-19-second-remediation-evidence/session-resize-${width}.png`, animations: 'disabled' });
  }
  expect(errors).toEqual([]);
});

test('maximizing and rapidly resizing a long conversation never paints an empty message region', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = [];
  let historyRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  await open(page, { count: 70, handle: async (route, url) => {
    if (!url.pathname.endsWith('/timeline')) return false;
    historyRequests++;
    const items = messages(70).map((item, index) => ({ ...item, turnId: 'long_turn', role: index ? 'assistant' : 'user', meta: index ? 'commentary' : 'history', phase: undefined }));
    await route.fulfill({ json: { session: metadata, items, hasMore: false } });
    return true;
  } });
  await page.locator('#prompt-input').fill('Keep this draft while maximizing');
  await page.evaluate(() => {
    globalThis.__resizeFrames = { blank: [], samples: 0, running: true };
    function observe() {
      const sample = globalThis.__resizeFrames;
      if (!sample.running) return;
      const timeline = document.querySelector('#timeline');
      const rect = timeline?.getBoundingClientRect();
      const messages = [...(timeline?.querySelectorAll('[data-timeline-id]') || [])];
      const visibleBottom = Math.min(rect?.bottom || 0, innerHeight, document.querySelector('.composer-wrap')?.getBoundingClientRect().top ?? innerHeight);
      const visible = messages.some(item => { const bounds = item.getBoundingClientRect(); return rect && bounds.bottom > Math.max(0, rect.top) && bounds.top < visibleBottom; });
      if (!visible) sample.blank.push({ width: innerWidth, height: innerHeight, nodes: messages.length, scrollTop: timeline?.scrollTop, scrollHeight: timeline?.scrollHeight, rectHeight: rect?.height });
      sample.samples++;
      requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  });
  const requestsBeforeResize = historyRequests;
  const viewports = [[1270, 1270], [1937, 1262], [1937, 1938], [1937, 1262], [979, 900], [980, 900], [980, 981], [980, 979], [1440, 1600], [1937, 1262], [1920, 1080], [1937, 1262]];
  for (const [width, height] of viewports) {
    await page.locator('#prompt-input').focus();
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    // Read the first rendered frames, without polling until a later update repairs them.
    expect(await page.locator('#timeline [data-timeline-id]').count()).toBe(70);
    expect(await page.locator('.desktop-workspace').count()).toBe(width >= 980 && width > height ? 1 : 0);
  }
  await page.screenshot({ path: 'docs/audits/2026-09-19-second-remediation-evidence/session-maximized-1937.png', animations: 'disabled' });
  const frames = await page.evaluate(() => { globalThis.__resizeFrames.running = false; return globalThis.__resizeFrames; });
  expect(frames.samples).toBeGreaterThan(10);
  expect(frames.blank).toEqual([]);
  expect(historyRequests).toBe(requestsBeforeResize);
  await expect(page.locator('#prompt-input')).toHaveValue('Keep this draft while maximizing');
  expect(errors).toEqual([]);
  await fs.writeFile('docs/audits/2026-09-19-second-remediation-evidence/session-resize-frames.json', JSON.stringify({ viewports, frames, extraHistoryRequests: historyRequests - requestsBeforeResize, browserErrors: errors }, null, 2));
});

test('new instructions remain visible through delayed receipts, stale history, reload and confirmation', async ({ page }, info) => {
  const text = 'Keep this newly sent instruction';
  const receipt = deferred();
  let submitted = false, confirmed = false;
  const items = messages();
  items[6].text = text;
  items.push({ id: 'prior_instruction', kind: 'message', role: 'user', text, meta: 'history', turnId: 'goal_turn', clientMessageId: 'prior_instruction' });
  await open(page, { handle: async (route, url) => {
    if (url.pathname.endsWith('/turns') && route.request().method() === 'POST') {
      submitted = true;
      const body = route.request().postDataJSON();
      await receipt.promise;
      await route.fulfill({ status: 202, json: { submission: { id: body.submissionId, status: 'submitted', sessionId: id, turnId: 'goal_turn', clientMessageId: 'new_instruction' }, session: metadata } });
      return true;
    }
    if (url.pathname.endsWith('/timeline')) {
      await route.fulfill({ json: { session: metadata, items: confirmed ? [...items, { id: 'confirmed_instruction', kind: 'message', role: 'user', meta: 'history', text, turnId: 'goal_turn', clientMessageId: 'new_instruction' }] : items, hasMore: false, nextBefore: null } });
      return true;
    }
    return false;
  } });
  await page.route('**/api/turns/goal_turn/events*', route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
  await page.evaluate(() => { const s = globalThis.__readingTest.state; s.pendingTurn = true; s.turnId = 'goal_turn'; s.currentSession.activeTurnId = 'goal_turn'; });
  await page.locator('#prompt-input').fill(text);
  await page.locator('#composer-form').evaluate(form => form.requestSubmit());
  await expect.poll(() => submitted).toBe(true);
  const pending = page.locator('#timeline [data-timeline-id^="local_user_"]');
  await expect(pending).toContainText(text);
  await refresh(page);
  await expect.poll(() => page.evaluate(() => globalThis.__readingTest.state.sessionRefreshOutcome)).not.toBe('pending');
  await expect(pending).toContainText(text);
  receipt.resolve();
  await expect.poll(() => page.evaluate(() => globalThis.__readingTest.state.submissionOutbox.size)).toBe(0);
  await refresh(page);
  await expect.poll(() => page.evaluate(() => globalThis.__readingTest.state.sessionRefreshOutcome)).not.toBe('pending');
  await expect(pending).toContainText(text);
  await page.reload();
  await expect(pending).toContainText(text);
  confirmed = true;
  await refresh(page);
  await expect(page.locator('[data-timeline-id="confirmed_instruction"]')).toContainText(text);
  await expect(pending).toHaveCount(0);
  await page.screenshot({ path: `docs/audits/2026-09-19-second-remediation-evidence/session-message-receipt-${info.project.name}.png`, animations: 'disabled' });
});

test('read-only resize and normal resize do not reset the reading position', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-portrait');
  await open(page, { readOnly: true, count: 20 });
  await expect.poll(() => page.locator('#timeline').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
  const before = await readAt(page, 550);
  await page.setViewportSize({ width: 390, height: 780 });
  await expectAnchor(page, before);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAnchor(page, before);
});

test('refresh failure keeps content and shows a retry action, followed by successful recovery', async ({ page }, info) => {
  let fail = false;
  await open(page, { handle: async route => {
    if (!fail) return false;
    await route.fulfill({ status: 503, json: { error: 'synthetic_unavailable' } }); return true;
  } });
  const before = await readAt(page, 250);
  fail = true; await refresh(page);
  await expect(page.locator('.history-load-error')).toContainText('History could not be synchronized');
  expect(await page.evaluate(() => globalThis.__readingTest.state.status)).toBe('Refresh failed');
  await expectAnchor(page, before);
  await page.screenshot({ path: `docs/audits/2026-09-19-second-remediation-evidence/session-refresh-failure-${info.project.name}.png`, animations: 'disabled' });
  // Trigger retry without Playwright scrolling the timeline to the top button.
  fail = false; await page.locator('#retry-session-history').evaluate(button => button.click());
  await expect(page.locator('.history-load-error')).toHaveCount(0);
  await expectAnchor(page, before);
});

test('scrolling during a slow refresh wins over the request-start position', async ({ page }) => {
  const gate = deferred(); let slow = false; let requests = 0;
  await open(page, { handle: async () => { if (slow) { requests++; await gate.promise; } return false; } });
  await readAt(page, 250);
  slow = true; await refresh(page);
  await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
  const before = await readAt(page, 700);
  gate.resolve();
  await expect.poll(() => page.evaluate(() => globalThis.__readingTest.state.status)).toBe('Ready');
  await expectAnchor(page, before);
});

test('reopening a session and reloading the page start at the latest message', async ({ page }, info) => {
  await open(page);
  await readAt(page, 300);
  if (info.project.name === 'desktop') await page.locator('button[data-session-id="session_browser_idle"]').click();
  else await page.locator('#back-to-list-button').click();
  await page.locator(`button[data-session-id="${id}"]`).click();
  await expect(page.locator('#timeline')).toContainText('Answer 7');
  await expect.poll(() => page.locator('#timeline').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
  await readAt(page, 300);
  await page.reload();
  await expect(page.locator('#timeline')).toContainText('Answer 7');
  await expect.poll(() => page.evaluate(() => globalThis.__readingTest.state.sessionHistoryPending === true)).toBe(false);
  await expect.poll(() => page.locator('#timeline').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
  await expect(page.locator('#timeline-jump-latest')).toBeHidden();
});

test('new streamed output does not move a history reader', async ({ page }) => {
  await open(page);
  const before = await readAt(page, 250);
  await page.evaluate(() => {
    globalThis.__readingTest.applyTurnEvent({ type: 'turn.started', turnId: 'new_reading_turn' }, null);
    globalThis.__readingTest.applyTurnEvent({ type: 'assistant.delta', turnId: 'new_reading_turn', itemId: 'new_reading_item', phase: 'final_answer', text: 'New live output. '.repeat(80), delta: 'New live output' }, null);
  });
  await expect(page.locator('#timeline')).toContainText('New live output');
  await expectAnchor(page, before);
});

test('opening ignores a saved deep-history bookmark and a cached window with newer pages', async ({ page }) => {
  const all = messages(260), requests = [];
  await page.addInitScript(({ id, history }) => {
    if (!localStorage.getItem('codexWebReading:single')) localStorage.setItem('codexWebReading:single', JSON.stringify({ [id]: { sessionId: id, owner: 'single', revision: 0, scrollTop: 100, bottomOffset: 1000, shouldFollowLatest: false, anchors: [{ id: 'reading_20', offset: -20 }], updatedAt: Date.now() } }));
    if (!localStorage.getItem('codexWebTimelineCache')) localStorage.setItem('codexWebTimelineCache', JSON.stringify({ version: 3, entries: [{ sessionId: id, savedAt: Date.now(), timeline: history, history, hasNewer: true, nextBefore: '4', nextAfter: '54', historyComplete: false, batches: [], approvals: [] }] }));
  }, { id, history: all.slice(4, 54) });
  await page.route(new RegExp(`/api/sessions/${id}(?:[/?]|$)`), async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/status')) return route.fulfill({ json: { session: metadata } });
    requests.push(url.search);
    await route.fulfill({ json: { session: metadata, items: all.slice(-50), hasMore: true, nextBefore: '210', hasNewer: false } });
  });
  await page.goto('/'); await page.locator(`button[data-session-id="${id}"]`).click();
  await expect(page.locator('#timeline')).toContainText('Answer 259');
  await expect(page.locator('[data-timeline-id="reading_20"]')).toHaveCount(0);
  await expect.poll(() => page.locator('#timeline').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
  expect(requests.every(query => !query.includes('anchor='))).toBe(true);
  await expect(page.locator('#timeline-jump-latest')).toBeHidden();
  await page.evaluate(({ id, history }) => {
    const state = globalThis.__readingTest.state;
    state.timeline = history; state.sessionHistoryItems = history; state.sessionHistoryStartIndex = 0;
    Object.assign(state.currentSession, { timeline: history, timelineHasNewer: true, timelineNextBefore: '4', timelineNextAfter: '54', timelineComplete: false });
    const cached = { ...state.timelineCache.get(id), timeline: history, history, hasNewer: true, nextBefore: '4', nextAfter: '54', historyComplete: false };
    state.timelineCache.set(id, cached);
    localStorage.setItem('codexWebTimelineCache', JSON.stringify({ version: 3, entries: [{ ...cached, sessionId: id, batches: [], approvals: [] }] }));
  }, { id, history: all.slice(4, 54) });
  await page.reload();
  await expect(page.locator('#timeline')).toContainText('Answer 259');
  await expect.poll(() => page.locator('#timeline').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
  await expect(page.locator('#timeline-jump-latest')).toBeHidden();
});

test('delayed history paging keeps its pending control and ignores an old page after navigation', async ({ page }, info) => {
  const gate = deferred(); let pending = 0;
  await open(page, { handle: async (route, url) => {
    if (!url.pathname.endsWith('/timeline')) return false;
    if (url.searchParams.has('before')) { pending++; await gate.promise; await route.fulfill({ json: { session: metadata, items: messages(10, 10), hasMore: true, nextBefore: '10' } }).catch(() => {}); return true; }
    await route.fulfill({ json: { session: metadata, items: messages(), hasMore: true, nextBefore: '20' } }); return true;
  } });
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Show earlier messages', exact: true }).click();
  await expect.poll(() => pending).toBe(1);
  await expect(page.getByRole('button', { name: 'Loading history…', exact: true })).toBeDisabled();
  if (info.project.name === 'desktop') await page.locator('button[data-session-id="session_browser_idle"]').click();
  else { await page.locator('#back-to-list-button').click(); await page.locator('button[data-session-id="session_browser_idle"]').click(); }
  gate.resolve();
  await expect(page.locator('#timeline')).not.toContainText('Answer 19');
  await expect(page.locator('#timeline')).toHaveAttribute('data-session-id', 'session_browser_idle');
});

test('continuing to read while latest is loading cancels replacing the historical window', async ({ page }) => {
  const pending = deferred(); let latestRequests = 0;
  await open(page, { handle: async (route, url) => {
    if (!url.pathname.endsWith('/timeline')) return false;
    if (latestRequests++ > 0) {
      await pending.promise;
      await route.fulfill({ json: { session: metadata, items: messages(8, 100), hasMore: true, nextBefore: '100', hasNewer: false } });
    } else await route.fulfill({ json: { session: metadata, items: messages(), hasMore: false, hasNewer: true, nextAfter: '8' } });
    return true;
  } });
  await page.locator('#timeline-jump-latest').click();
  await expect.poll(() => latestRequests).toBe(2);
  const before = await readAt(page, 450);
  pending.resolve();
  await expectAnchor(page, before);
  await expect(page.locator('#timeline')).not.toContainText('Answer 107');
  await expect(page.locator('#timeline-jump-latest')).toBeVisible();
});

test('PWA history gesture keeps its localized indicator until the history request settles', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-portrait');
  await page.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { value: true }); });
  const gate = deferred(); let pending = 0;
  await open(page, { handle: async (route, url) => {
    if (!url.pathname.endsWith('/timeline')) return false;
    if (url.searchParams.has('before')) { pending++; await gate.promise; await route.fulfill({ json: { session: metadata, items: [], hasMore: false, nextBefore: null } }); return true; }
    await route.fulfill({ json: { session: metadata, items: messages(), hasMore: true, nextBefore: '8' } }); return true;
  } });
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Show earlier messages', exact: true }).click();
  await page.evaluate(() => globalThis.__readingTest.applyLanguage('zh-CN'));
  await page.evaluate(() => {
    // Dispatch touch input at the real scroll owner.
    const timeline = document.querySelector('#timeline'); timeline.scrollTop = 0;
    const touch = new Touch({ identifier: 1, target: timeline, clientX: 120, clientY: 180 });
    timeline.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], bubbles: true }));
    const moved = new Touch({ identifier: 1, target: timeline, clientX: 120, clientY: 330 });
    timeline.dispatchEvent(new TouchEvent('touchmove', { touches: [moved], bubbles: true, cancelable: true }));
    timeline.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
  });
  await expect.poll(() => pending).toBe(1);
  await expect(page.locator('.pull-refresh-indicator')).toHaveClass(/is-refreshing/);
  await expect(page.locator('.pull-refresh-indicator')).toContainText('正在加载历史');
  gate.resolve();
  await expect(page.locator('.pull-refresh-indicator')).not.toHaveClass(/is-visible/);
  await expect(page.locator('.timeline-history-end')).toBeVisible();
});
