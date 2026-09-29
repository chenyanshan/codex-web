import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

test.use({ serviceWorkers: 'block' });

const sessionId = 'session_browser_history';
const turnId = 'alias_recovery_turn';
const submissionId = 'alias-recovery-submission';
const clientMessageId = createHash('sha256').update(submissionId).digest('hex').slice(0, 24);
const checkpoint = { generation: 'alias-recovery-generation', revision: 240 };
const prompt = '还有哪些没改的吗？';
const canonical = (id, role, text, position, aliases = []) => ({
  id, itemId: id, turnId, kind: 'message', role, text,
  meta: role === 'assistant' ? 'final' : 'history',
  ...(role === 'assistant' ? { phase: 'final_answer' } : {}),
  timeline: { ...checkpoint, id, position, version: 2, aliases },
});
const anchor = canonical('alias-anchor', 'assistant', 'Previous completed response.', 228);
// Native initial-user history has no direct clientMessageId. The receipt hash
// survives solely as an alias, as in the real ordering failure.
const user = canonical('alias-canonical-user', 'user', prompt, 230, [clientMessageId, 'history_alias_0']);
const answer = canonical('alias-final-answer', 'assistant', 'All remaining changes are listed here.', 234);
const history = [anchor, user, answer];
const pending = {
  id: `local_user_${submissionId}`, kind: 'message', role: 'user', meta: 'pending',
  text: prompt, turnId, submissionId, clientMessageId, deliveryLabel: 'Server received',
  historyAnchorId: anchor.id,
};
const session = {
  id: sessionId, title: 'Submission alias recovery', cwd: '/Users/test/yanshan_quant',
  settings: {}, updatedAt: 1000, activeTurnId: null, activityState: 'idle',
  timelineCheckpoint: checkpoint,
  thread: { turns: [{ id: turnId, status: 'completed', items: [] }] },
};

test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-submission-alias');
    localStorage.setItem('codexWebLanguage', 'en');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__aliasRecovery = { state, applyTurnEvent, handleComposerRefresh, saveCurrentTimeline, selectSession, markCachedSubmissionDelivered };` });
  });
  await page.route(new RegExp(`/api/sessions/${sessionId}(?:[/?]|$)`), async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: url.pathname.endsWith('/status') ? { session }
      : url.pathname.endsWith('/timeline') ? { session, items: history, hasMore: false, nextBefore: null, timelineCheckpoint: checkpoint }
        : { session: { ...session, timeline: history, timelineComplete: true } } });
  });
  await page.route(`**/api/turns/${turnId}/events*`, route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
});

async function open(page) {
  await page.goto('/');
  await page.locator(`button[data-session-id="${sessionId}"]`).click();
  await expect(page.locator('#timeline')).toContainText(answer.text);
  await expect.poll(() => page.evaluate(() => globalThis.__aliasRecovery.state.sessionHistoryPending)).toBe(false);
}

async function expectOneCanonicalPrompt(page) {
  await expect(page.locator('#timeline .message-card.user').filter({ hasText: prompt })).toHaveCount(1);
  await expect(page.locator(`#timeline [data-timeline-id="${user.id}"]`)).toHaveCount(1);
  const order = await page.locator('#timeline [data-timeline-id]').evaluateAll(items => items.map(item => item.dataset.timelineId));
  expect(order.indexOf(user.id)).toBeLessThan(order.indexOf(answer.id));
  expect(order).not.toContain(pending.id);
}

test('an alias-confirmed cached receipt disappears on refresh and never returns after reload', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ sessionId, history, pending }) => {
    if (!localStorage.getItem('codexWebTimelineCache')) {
      const stale = [...history, pending];
      localStorage.setItem('codexWebTimelineCache', JSON.stringify({ version: 3, entries: [{
        sessionId, savedAt: Date.now(), timeline: stale, history: stale,
        historyComplete: true, batches: [], approvals: [],
      }] }));
    }
  }, { sessionId, history, pending });
  await open(page);
  await page.evaluate(() => globalThis.__aliasRecovery.handleComposerRefresh());
  await expectOneCanonicalPrompt(page);
  await page.evaluate(() => {
    globalThis.__aliasRecovery.saveCurrentTimeline();
    window.dispatchEvent(new Event('pagehide'));
  });
  await page.reload();
  await expect(page.locator('#timeline')).toContainText(answer.text);
  await expect.poll(() => page.evaluate(() => globalThis.__aliasRecovery.state.sessionHistoryPending)).toBe(false);
  await expectOneCanonicalPrompt(page);
  const cached = await page.evaluate(sessionId => JSON.parse(localStorage.getItem('codexWebTimelineCache')).entries.find(entry => entry.sessionId === sessionId), sessionId);
  expect(cached.timeline.filter(item => item.role === 'user' && item.text === prompt)).toHaveLength(1);
  expect(cached.history.filter(item => item.role === 'user' && item.text === prompt)).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('alias-cache-reloaded.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('a late receipt after navigating away cannot append a duplicate to alias-only canonical cache', async ({ page }, info) => {
  await open(page);
  await page.evaluate(() => globalThis.__aliasRecovery.selectSession('session_browser_idle'));
  await expect.poll(() => page.evaluate(() => globalThis.__aliasRecovery.state.sessionId)).toBe('session_browser_idle');
  const cached = await page.evaluate(({ sessionId, history, submissionId, clientMessageId, turnId, prompt }) => {
    const api = globalThis.__aliasRecovery;
    const existing = api.state.timelineCache.get(sessionId);
    api.state.timelineCache.set(sessionId, { ...existing, timeline: history, history });
    api.markCachedSubmissionDelivered({ id: submissionId, sessionId, text: prompt, attachments: [], createdAt: Date.now() }, sessionId, turnId, clientMessageId);
    return api.state.timelineCache.get(sessionId);
  }, { sessionId, history, submissionId, clientMessageId, turnId, prompt });
  expect(cached.timeline.map(item => item.id)).toEqual(history.map(item => item.id));
  expect(cached.history.map(item => item.id)).toEqual(history.map(item => item.id));
  await page.evaluate(sessionId => globalThis.__aliasRecovery.selectSession(sessionId), sessionId);
  await expect(page.locator('#timeline')).toContainText(answer.text);
  await expectOneCanonicalPrompt(page);
  await page.screenshot({ path: info.outputPath('alias-late-receipt.png'), animations: 'disabled' });
});

test('a canonical user event removes every same-identity copy while preserving attachments and a distinct repeated submission', async ({ page }, info) => {
  await open(page);
  const attachment = { kind: 'image', localPath: '/uploads/alias-evidence.png', fileName: 'alias-evidence.png', mimeType: 'image/png', sizeBytes: 128 };
  const distinct = { ...pending, id: 'local_user_distinct', submissionId: 'distinct-submission', clientMessageId: 'different-submission-hash', deliveryLabel: 'Waiting to send' };
  const timeline = await page.evaluate(({ history, pending, distinct, attachment, turnId, user, checkpoint }) => {
    const api = globalThis.__aliasRecovery;
    api.state.timeline = [...history, { ...pending, attachments: [attachment] }, distinct];
    api.state.terminalTurnIds.delete(turnId);
    api.applyTurnEvent({ type: 'user.message', turnId, threadId: api.state.sessionId,
      text: user.text, timeline: user.timeline, timelineCheckpoint: checkpoint }, null);
    return api.state.timeline;
  }, { history, pending, distinct, attachment, turnId, user, checkpoint });
  expect(timeline.filter(item => item.role === 'user' && item.text === prompt)).toHaveLength(2);
  expect(timeline.some(item => item.id === pending.id)).toBe(false);
  expect(timeline.find(item => item.id === user.id).attachments).toEqual([attachment]);
  expect(timeline.find(item => item.id === distinct.id).clientMessageId).toBe(distinct.clientMessageId);
  expect(timeline.findIndex(item => item.id === user.id)).toBeLessThan(timeline.findIndex(item => item.id === answer.id));
  await expect(page.locator('#timeline .message-card.user').filter({ hasText: prompt })).toHaveCount(2);
  await expect(page.locator(`#timeline [data-timeline-id="${pending.id}"]`)).toHaveCount(0);
  await expect(page.locator(`#timeline [data-timeline-id="${distinct.id}"]`)).toHaveCount(1);
  await expect(page.locator(`#timeline [data-timeline-id="${user.id}"]`)).toContainText(attachment.fileName);
  await page.screenshot({ path: info.outputPath('alias-user-event-merged.png'), animations: 'disabled' });
});
