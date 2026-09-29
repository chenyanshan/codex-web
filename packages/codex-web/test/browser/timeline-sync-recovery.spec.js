import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

test.use({ serviceWorkers: 'block' });
const sessionId = 'session_browser_history';
const turnId = 'sync_recovery_turn';
const session = { id: sessionId, title: 'Timeline recovery', cwd: '/Users/test/yanshan_quant', settings: {}, updatedAt: 1000, activeTurnId: null, activityState: 'idle' };
const message = (id, text, role = 'assistant') => ({ id, itemId: id, projectionKey: id, turnId, kind: 'message', role, text, meta: role === 'assistant' ? 'final' : 'history', phase: role === 'assistant' ? 'final_answer' : undefined });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-sync-recovery');
    localStorage.setItem('codexWebLanguage', 'en');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__syncRecovery = { state, applyTurnEvent, handleComposerRefresh, saveCurrentTimeline, selectSession, applyTurnStreamControl, applySessionTurnSnapshot, connectActiveTurnStream };` });
  });
  await page.route(`**/api/turns/${turnId}/events*`, route => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
});

async function fixture(page, getItems, intercept) {
  await page.route(new RegExp(`/api/sessions/${sessionId}(?:[/?]|$)`), async route => {
    const url = new URL(route.request().url());
    if (intercept && await intercept(route, url)) return;
    const items = getItems();
    await route.fulfill({ json: url.pathname.endsWith('/status') ? { session }
      : url.pathname.endsWith('/timeline') ? { session, items, hasMore: false, nextBefore: null }
        : { session: { ...session, timeline: items, timelineComplete: true } } });
  });
  await page.goto('/');
  await page.locator(`button[data-session-id="${sessionId}"]`).click();
  await expect(page.locator('#timeline')).toContainText(getItems().at(-1).text);
  await expect.poll(() => page.evaluate(() => globalThis.__syncRecovery.state.sessionHistoryPending)).toBe(false);
}
async function live(page, itemId, text) {
  await page.evaluate(({ turnId, itemId, text }) => {
    globalThis.__syncRecovery.applyTurnEvent({ type: 'turn.started', turnId }, null);
    globalThis.__syncRecovery.applyTurnEvent({ type: 'assistant.final', turnId, itemId, text }, null);
  }, { turnId, itemId, text });
}

test('different assistant item IDs retain identical text through live output, history and reload', async ({ page }, info) => {
  const text = 'The same observation is independently valid twice.';
  let items = [message('question', 'Check repeated observations', 'user')];
  await fixture(page, () => items);
  await live(page, 'observation_one', text);
  await live(page, 'observation_two', text);
  await expect(page.locator('#timeline .message-card.assistant').filter({ hasText: text })).toHaveCount(2);
  items = [...items, message('observation_one', text), message('observation_two', text)];
  await page.evaluate(() => globalThis.__syncRecovery.handleComposerRefresh());
  await expect(page.locator('#timeline .message-card.assistant').filter({ hasText: text })).toHaveCount(2);
  await page.reload();
  await expect(page.locator('#timeline .message-card.assistant').filter({ hasText: text })).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('distinct-identities-after-reload.png'), animations: 'disabled' });
});

test('a historical response captured before live output cannot erase the newer answer', async ({ page }) => {
  const items = [message('question', 'Preserve output while an old response is delayed', 'user')];
  const delayed = deferred();
  let hold = false, requested = false;
  await fixture(page, () => items, async (route, url) => {
    if (!hold || !url.pathname.endsWith('/timeline')) return false;
    requested = true;
    await delayed.promise;
    await route.fulfill({ json: { session, items, hasMore: false, nextBefore: null } });
    return true;
  });
  hold = true;
  await page.evaluate(() => { void globalThis.__syncRecovery.handleComposerRefresh(); });
  await expect.poll(() => requested).toBe(true);
  await live(page, 'newer_answer', 'This answer arrived after the history request began.');
  await expect(page.locator('#timeline')).toContainText('This answer arrived after the history request began.');
  delayed.resolve();
  await expect.poll(() => page.evaluate(() => globalThis.__syncRecovery.state.sessionRefreshOutcome)).not.toBe('pending');
  await expect(page.locator('#timeline')).toContainText('This answer arrived after the history request began.');
});

test('accepted POST followed by outbox storage failure reloads using the original receipt without reposting', async ({ page }) => {
  const items = [message('question', 'Storage failure recovery conversation', 'user')];
  let acceptedId = '', posts = 0, receipts = 0;
  await fixture(page, () => items, async (route, url) => {
    if (!url.pathname.endsWith('/turns') || route.request().method() !== 'POST') return false;
    posts += 1;
    acceptedId = route.request().postDataJSON().submissionId;
    // The durable pre-POST "sending" record remains; only subsequent writes fail.
    await page.evaluate(() => {
      const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
      Storage.prototype.setItem = function(key, value) { if (key.startsWith('codexWebSubmissionOutbox')) throw new DOMException('Injected quota failure', 'QuotaExceededError'); return set.call(this, key, value); };
      Storage.prototype.removeItem = function(key) { if (key.startsWith('codexWebSubmissionOutbox')) throw new DOMException('Injected quota failure', 'QuotaExceededError'); return remove.call(this, key); };
    });
    await route.fulfill({ status: 202, json: { submission: { id: acceptedId, status: 'submitted', sessionId, turnId }, session } });
    return true;
  });
  await page.route('**/api/session-submissions/*', route => {
    receipts += 1;
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).pathname).toBe(`/api/session-submissions/${acceptedId}`);
    return route.fulfill({ json: { submission: { id: acceptedId, status: 'submitted', sessionId, turnId }, session, retryAllowed: false } });
  });
  await page.locator('#prompt-input').fill('Execute exactly once despite storage failure');
  await page.locator('#composer-form').evaluate(form => form.requestSubmit());
  await expect.poll(() => posts).toBe(1);
  await expect.poll(() => page.evaluate(() => globalThis.__syncRecovery.state.submissionSending)).toBe(false);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('codexWebSubmissionOutbox:')).map(key => JSON.parse(localStorage.getItem(key)).entry.status))).toEqual(['sending']);
  await page.reload();
  await expect.poll(() => receipts).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => globalThis.__syncRecovery.state.submissionOutbox.size)).toBe(0);
  expect(posts).toBe(1);
});

test('reload keeps a cached historical window readable until an online latest page succeeds', async ({ page }, info) => {
  const latest = [message('latest', 'Latest online answer')];
  const old = [message('deep_history', 'Cached older window remains readable')];
  let unavailable = false;
  await fixture(page, () => latest, async (route, url) => {
    if (unavailable && url.pathname.endsWith('/timeline')) { await route.abort('internetdisconnected'); return true; }
    return false;
  });
  await page.evaluate(({ sessionId, old }) => {
    const api = globalThis.__syncRecovery;
    api.state.timeline = old;
    api.state.sessionHistoryItems = old;
    api.state.currentSession.timeline = old;
    api.state.currentSession.timelineComplete = false;
    api.state.currentSession.timelineHasNewer = true;
    api.state.currentSession.timelineNextAfter = 'older-window';
    api.state.turnId = 'uncached_live_turn';
    api.state.lastTurnEventSequence = 77;
    api.state.lastTurnEventEpoch = 'saved-epoch';
    api.saveCurrentTimeline();
    window.dispatchEvent(new Event('pagehide'));
  }, { sessionId, old });
  const saved = await page.evaluate(sessionId => JSON.parse(localStorage.getItem('codexWebTimelineCache')).entries.find(entry => entry.sessionId === sessionId), sessionId);
  expect(saved.checkpointComplete).toBe(false);
  expect(saved.streamCursor).toBeUndefined();
  unavailable = true;
  await page.reload();
  await expect(page.locator('#timeline')).toContainText(old[0].text);
  await expect.poll(() => page.evaluate(() => globalThis.__syncRecovery.state.sessionHistoryPending)).toBe(false);
  await expect(page.locator('#timeline')).toContainText(old[0].text);
  await page.screenshot({ path: info.outputPath('cached-historical-window.png'), animations: 'disabled' });
  unavailable = false;
  await page.evaluate(() => globalThis.__syncRecovery.handleComposerRefresh());
  await expect(page.locator('#timeline')).toContainText(latest[0].text);
  await expect(page.locator('#timeline')).not.toContainText(old[0].text);
});

for (const loss of ['text truncated', 'entries evicted']) {
  test(`${loss}: reload obtains a complete snapshot instead of resuming a cursor over incomplete cache`, async ({ page }) => {
    const original = [message('question', 'Recover a complete checkpoint', 'user')];
    let reloading = false;
    const streamRequests = [];
    await fixture(page, () => original, async (route, url) => {
      if (!reloading) return false;
      const active = { ...session, activeTurnId: turnId, activityState: 'running' };
      await route.fulfill({ json: url.pathname.endsWith('/status') ? { session: active }
        : { session: active, items: [message('recovered', 'Complete server snapshot recovered')], hasMore: false, nextBefore: null } });
      return true;
    });
    await page.route(`**/api/turns/${turnId}/events*`, route => {
      streamRequests.push(new URL(route.request().url()));
      return route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' });
    });
    await page.evaluate(({ turnId, loss }) => {
      const api = globalThis.__syncRecovery;
      const count = loss === 'entries evicted' ? 100 : 1;
      const text = loss === 'text truncated' ? 'x'.repeat(100_000) : 'Cached item';
      api.state.timeline = Array.from({ length: count }, (_, index) => ({ id: `cache_${index}`, kind: 'message', role: 'assistant', text, meta: 'final', turnId }));
      api.state.turnId = turnId;
      api.state.lastTurnEventSequence = 77;
      api.state.lastTurnEventEpoch = 'saved-epoch';
      api.saveCurrentTimeline();
      window.dispatchEvent(new Event('pagehide'));
    }, { turnId, loss });
    const saved = await page.evaluate(sessionId => JSON.parse(localStorage.getItem('codexWebTimelineCache')).entries.find(entry => entry.sessionId === sessionId), sessionId);
    expect(saved.checkpointComplete).toBe(false);
    expect(saved.streamCursor).toBeUndefined();
    reloading = true;
    await page.reload();
    await expect(page.locator('#timeline')).toContainText('Complete server snapshot recovered');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => streamRequests.length).toBeGreaterThan(0);
    expect(streamRequests.every(url => !url.searchParams.has('after'))).toBe(true);
  });
}

test('slow older-page response overlapping reconnect cannot contaminate a newly selected session', async ({ page }) => {
  const recent = Array.from({ length: 8 }, (_, index) => message(`recent_${index}`, `Recent conversation entry ${index}`, index % 2 ? 'assistant' : 'user'));
  const delayed = deferred();
  let paging = false;
  await fixture(page, () => recent, async (route, url) => {
    if (!url.pathname.endsWith('/timeline')) return false;
    if (url.searchParams.has('before')) {
      paging = true;
      await delayed.promise;
      await route.fulfill({ json: { session, items: [message('late_old', 'Old page must never enter another conversation')], hasMore: false, nextBefore: null } });
    } else await route.fulfill({ json: { session, items: recent, hasMore: true, nextBefore: 'older-page' } });
    return true;
  });
  for (let attempt = 0; attempt < 5 && !paging; attempt += 1) {
    await page.getByRole('button', { name: 'Show earlier messages', exact: true }).click();
  }
  await expect.poll(() => paging).toBe(true);
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
  await page.evaluate(() => globalThis.__syncRecovery.selectSession('session_browser_idle'));
  await expect.poll(() => page.evaluate(() => globalThis.__syncRecovery.state.sessionId)).toBe('session_browser_idle');
  delayed.resolve();
  await expect(page.locator('#timeline')).not.toContainText('Old page must never enter another conversation');
  await expect(page.locator('#timeline')).not.toContainText('Recent conversation entry');
  expect(await page.evaluate(() => globalThis.__syncRecovery.state.sessionId)).toBe('session_browser_idle');
});

test('replayed canonical versions cannot replace a newer visible answer', async ({ page }) => {
  await fixture(page, () => [message('question', 'Verify versioned replay', 'user')]);
  await page.evaluate(turnId => {
    const api = globalThis.__syncRecovery;
    api.applyTurnEvent({ type: 'turn.started', turnId }, null);
    const event = { type: 'assistant.final', turnId, itemId: 'versioned_answer', text: 'Newest full answer',
      timeline: { id: 'canonical:answer', generation: 'generation-one', position: 2, version: 3, revision: 8, aliases: ['versioned_answer'] },
      timelineCheckpoint: { generation: 'generation-one', revision: 8 } };
    api.applyTurnEvent(event, null);
    api.applyTurnEvent({ ...event, text: 'Stale partial answer', timeline: { ...event.timeline, version: 1, revision: 3 }, timelineCheckpoint: { generation: 'generation-one', revision: 3 } }, null);
  }, turnId);
  await expect(page.locator('#timeline')).toContainText('Newest full answer');
  await expect(page.locator('#timeline')).not.toContainText('Stale partial answer');
  await expect(page.locator('#timeline .message-card.assistant').filter({ hasText: 'Newest full answer' })).toHaveCount(1);
});

test('canonical history arriving before a lost POST acknowledgement replaces the optimistic message once', async ({ page }) => {
  let items = [message('question', 'Receipt ordering conversation', 'user')];
  const response = deferred();
  let submissionId = '', confirmed = false;
  const text = 'One instruction before its receipt arrives';
  await fixture(page, () => items, async (route, url) => {
    if (!url.pathname.endsWith('/turns') || route.request().method() !== 'POST') return false;
    submissionId = route.request().postDataJSON().submissionId;
    const clientMessageId = createHash('sha256').update(submissionId).digest('hex').slice(0, 24);
    items = [...items, { ...message('persisted_instruction', text, 'user'),
      timeline: { id: 'canonical:instruction', generation: 'receipt-generation', position: 2, version: 1, revision: 2, aliases: [clientMessageId] } }];
    await response.promise;
    await route.fulfill({ status: 504, contentType: 'text/html', body: '<html>Accepted response lost at gateway</html>' });
    return true;
  });
  await page.route('**/api/session-submissions/*', route => route.fulfill({ json: {
    submission: { id: submissionId, status: confirmed ? 'submitted' : 'starting', sessionId, turnId,
      clientMessageId: createHash('sha256').update(submissionId).digest('hex').slice(0, 24) }, retryAllowed: false,
  } }));
  await page.locator('#prompt-input').fill(text);
  await page.locator('#composer-form').evaluate(form => form.requestSubmit());
  await expect.poll(() => submissionId).not.toBe('');
  await page.evaluate(() => globalThis.__syncRecovery.handleComposerRefresh());
  await expect(page.locator('#timeline .message-card.user').filter({ hasText: text })).toHaveCount(1);
  await expect(page.locator('[data-timeline-id="persisted_instruction"]')).toContainText(text);
  response.resolve();
  await expect.poll(() => page.evaluate(() => globalThis.__syncRecovery.state.submissionSending)).toBe(false);
  confirmed = true;
  await page.reload();
  await expect(page.locator('#timeline .message-card.user').filter({ hasText: text })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => globalThis.__syncRecovery.state.submissionOutbox.size)).toBe(0);
});

test('complete stream snapshots display canonical position instead of arrival order', async ({ page }) => {
  await fixture(page, () => [message('question', 'Snapshot ordering conversation', 'user')]);
  await page.evaluate(async turnId => {
    const api = globalThis.__syncRecovery;
    const checkpoint = { generation: 'snapshot-generation', revision: 4 };
    api.applyTurnEvent({ type: 'turn.started', turnId, timelineCheckpoint: checkpoint }, null);
    const event = (id, position) => ({ type: 'assistant.final', turnId, itemId: id, text: `Canonical position ${position}`,
      timeline: { id: `canonical:${id}`, generation: checkpoint.generation, position, version: 1, revision: position, aliases: [id] }, timelineCheckpoint: checkpoint });
    await api.applyTurnStreamControl({ type: 'stream.reset', timelineCheckpoint: checkpoint,
      snapshot: { complete: true, throughSequence: 4, events: [event('second', 2), event('first', 1)] } }, turnId, null);
  }, turnId);
  await expect(page.locator('#timeline')).toContainText('Canonical position 1');
  const texts = await page.locator('#timeline .message-card.assistant').allTextContents();
  expect(texts.map(text => text.match(/Canonical position \d/)?.[0])).toEqual(['Canonical position 1', 'Canonical position 2']);
});

test('same stream epoch and sequence with a new generation repairs history without resurrecting old output', async ({ page }) => {
  let reset = false, repaired = 0;
  await fixture(page, () => [message('question', 'Generation change conversation', 'user')], async (route, url) => {
    if (!reset) return false;
    const current = { ...session, activeTurnId: turnId, activityState: 'running', timelineCheckpoint: { generation: 'new-generation', revision: 1 } };
    const item = { ...message('new_answer', 'Replacement generation answer'), timeline: { id: 'new:answer', generation: 'new-generation', position: 1, version: 1, revision: 1, aliases: [] } };
    if (!url.pathname.endsWith('/status')) repaired += 1;
    await route.fulfill({ json: url.pathname.endsWith('/status') ? { session: current }
      : url.pathname.endsWith('/timeline') ? { session: current, items: [item], hasMore: false, nextBefore: null }
        : { session: { ...current, timeline: [item], timelineComplete: true } } });
    return true;
  });
  await page.evaluate(turnId => {
    const api = globalThis.__syncRecovery;
    api.applyTurnEvent({ type: 'turn.started', turnId }, null);
    api.applyTurnEvent({ type: 'assistant.final', turnId, itemId: 'old_answer', text: 'Old generation must stay removed',
      timeline: { id: 'old:answer', generation: 'old-generation', position: 1, version: 9, revision: 9, aliases: [] },
      timelineCheckpoint: { generation: 'old-generation', revision: 9 } }, null);
    api.state.lastTurnEventSequence = 7;
    api.state.lastTurnEventEpoch = 'unchanged-epoch';
  }, turnId);
  await expect(page.locator('#timeline')).toContainText('Old generation must stay removed');
  reset = true;
  await page.evaluate(turnId => globalThis.__syncRecovery.applySessionTurnSnapshot({ turnId, epoch: 'unchanged-epoch', throughSequence: 7,
    complete: false, timelineCheckpoint: { generation: 'new-generation', revision: 1 }, events: [] }, turnId), turnId);
  await expect.poll(() => repaired).toBeGreaterThan(0);
  await expect(page.locator('#timeline')).toContainText('Replacement generation answer');
  await expect(page.locator('#timeline')).not.toContainText('Old generation must stay removed');
});

test('a late canonical snapshot backfills missing prompts while retaining the newer live answer version', async ({ page }) => {
  const initial = [message('question', 'Canonical backfill conversation', 'user')];
  const delayed = deferred();
  let hold = false, requested = false;
  const canonical = (id, position, version, revision) => ({ id, generation: 'backfill-generation', position, version, revision, aliases: [] });
  await fixture(page, () => initial, async (route, url) => {
    if (!hold || !url.pathname.endsWith('/timeline')) return false;
    requested = true;
    await delayed.promise;
    await route.fulfill({ json: { session: { ...session, timelineCheckpoint: { generation: 'backfill-generation', revision: 2 } },
      items: [...initial, { ...message('missed_prompt', 'Prompt missing from the local cache', 'user'), timeline: canonical('canonical:prompt', 2, 1, 1) },
        { ...message('answer', 'Old answer version'), timeline: canonical('canonical:answer', 3, 1, 2) }], hasMore: false, nextBefore: null } });
    return true;
  });
  hold = true;
  await page.evaluate(() => { void globalThis.__syncRecovery.handleComposerRefresh(); });
  await expect.poll(() => requested).toBe(true);
  await page.evaluate(({ turnId, timeline }) => {
    const api = globalThis.__syncRecovery;
    api.applyTurnEvent({ type: 'turn.started', turnId }, null);
    api.applyTurnEvent({ type: 'assistant.final', turnId, itemId: 'answer', text: 'Newest answer version', timeline,
      timelineCheckpoint: { generation: 'backfill-generation', revision: 4 } }, null);
  }, { turnId, timeline: canonical('canonical:answer', 3, 3, 4) });
  delayed.resolve();
  await expect(page.locator('#timeline')).toContainText('Prompt missing from the local cache');
  await expect(page.locator('#timeline')).toContainText('Newest answer version');
  await expect(page.locator('#timeline')).not.toContainText('Old answer version');
});

test('a complete empty canonical history clears stale output while preserving an unconfirmed outbox message', async ({ page }) => {
  const response = deferred();
  let empty = false, submitted = false;
  await fixture(page, () => [message('stale_answer', 'Stale answer removed by an empty checkpoint')], async (route, url) => {
    if (url.pathname.endsWith('/turns') && route.request().method() === 'POST') {
      submitted = true;
      await response.promise;
      await route.fulfill({ status: 504, body: 'Lost acknowledgement' });
      return true;
    }
    if (empty && url.pathname.endsWith('/timeline')) {
      await route.fulfill({ json: { session: { ...session, timelineCheckpoint: { generation: 'empty-generation', revision: 1 } }, items: [], hasMore: false, nextBefore: null } });
      return true;
    }
    return false;
  });
  await page.locator('#prompt-input').fill('Keep this unconfirmed outbox message');
  await page.locator('#composer-form').evaluate(form => form.requestSubmit());
  await expect.poll(() => submitted).toBe(true);
  empty = true;
  await page.evaluate(() => globalThis.__syncRecovery.handleComposerRefresh());
  await expect(page.locator('#timeline')).not.toContainText('Stale answer removed by an empty checkpoint');
  await expect(page.locator('#timeline .message-card.user')).toContainText('Keep this unconfirmed outbox message');
  expect(await page.evaluate(() => globalThis.__syncRecovery.state.submissionOutbox.size)).toBe(1);
  response.resolve();
});

test('a compact delta version gap triggers repair without appending corrupt text or persisting its cursor', async ({ page }) => {
  const repair = deferred();
  let repairing = false, streamRequests = 0;
  const timeline = { id: 'gap:answer', generation: 'gap-generation', position: 2, version: 1, revision: 1, aliases: ['gap_answer'] };
  await fixture(page, () => [message('question', 'Delta version gap conversation', 'user')], async (route, url) => {
    if (url.pathname !== `/api/sessions/${sessionId}`) return false;
    repairing = true;
    await repair.promise;
    const item = { ...message('gap:answer', 'Complete repaired answer'), itemId: 'gap_answer', timeline: { ...timeline, version: 3, revision: 3 } };
    await route.fulfill({ json: { session: { ...session, activeTurnId: turnId, activityState: 'running',
      timeline: [item], timelineComplete: true, timelineCheckpoint: { generation: timeline.generation, revision: 3 } } } });
    return true;
  });
  await page.route(`**/api/turns/${turnId}/events*`, route => {
    streamRequests += 1;
    const event = { type: 'assistant.delta', turnId, itemId: 'gap_answer', delta: 'MISSING-MIDDLE-SUFFIX', sequence: 8,
      timeline: { ...timeline, version: 3, revision: 3 }, timelineCheckpoint: { generation: timeline.generation, revision: 3 } };
    return route.fulfill({ contentType: 'text/event-stream', body: streamRequests === 1 ? `id: 8\ndata: ${JSON.stringify(event)}\n\n` : ': waiting\n\n' });
  });
  await page.evaluate(({ turnId, timeline }) => {
    const api = globalThis.__syncRecovery;
    api.applyTurnEvent({ type: 'turn.started', turnId }, null);
    api.applyTurnEvent({ type: 'assistant.delta', turnId, itemId: 'gap_answer', text: 'Original prefix', timeline,
      timelineCheckpoint: { generation: timeline.generation, revision: 1 } }, null);
    api.state.lastTurnEventSequence = 7;
    api.connectActiveTurnStream({ forceReconnect: true });
  }, { turnId, timeline });
  await expect.poll(() => repairing).toBe(true);
  await expect(page.locator('#timeline')).not.toContainText('MISSING-MIDDLE-SUFFIX');
  expect(await page.evaluate(() => globalThis.__syncRecovery.state.lastTurnEventSequence)).toBe(null);
  await page.evaluate(() => globalThis.__syncRecovery.saveCurrentTimeline());
  const cached = await page.evaluate(sessionId => JSON.parse(localStorage.getItem('codexWebTimelineCache')).entries.find(entry => entry.sessionId === sessionId), sessionId);
  expect(cached.streamCursor).toBeUndefined();
  repair.resolve();
  await expect(page.locator('#timeline')).toContainText('Complete repaired answer');
});
