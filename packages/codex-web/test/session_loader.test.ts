import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  const context: any = { AbortController, structuredClone };
  vm.runInNewContext(await readFile(process.env.SESSION_LOADER_SOURCE || new URL('../public/session-loader.js', import.meta.url), 'utf8'), context);
  let owner = 'alice:1';
  const calls: any[] = [];
  const load = context.CodexWebSessionLoader.createLoader({
    state: { timelineCache: new Map() }, getOwner: () => owner,
    apiFetch: (path: string, options: any) => new Promise((resolve, reject) => calls.push({ path, signal: options.signal, resolve, reject })),
    isFatalSessionOpenError: (error: any) => error.status === 403,
    timelinesHaveStableOverlap: () => false, mergeLatestTimelineHistory: (_: any, items: any) => items,
  });
  const fulfill = (call: any) => call.resolve(call.path.includes('/timeline')
    ? { session: { id: 'one' }, items: [{ id: 'message', text: 'history' }], hasMore: true, nextBefore: 'older' }
    : { session: { id: 'one', activeTurnId: 'running' }, turnSnapshot: { turnId: 'running', events: [{ type: 'assistant.delta', text: 'shared text' }] } });
  return { load, calls, fulfill, setOwner: (next: string) => { owner = next; } };
}

test('89 overlapping reads share one pair, preserving each caller summary and progress', async () => {
  const { load, calls, fulfill } = await fixture();
  const stages: any[][] = Array.from({ length: 89 }, () => []);
  const reads = stages.map((progress, i) => load({ id: 'one', title: `caller ${i}` }, { onProgress: (value: any) => progress.push(value) }));
  assert.equal(calls.length, 2);
  fulfill(calls[0]); await tick();
  assert.ok(stages.every(progress => progress.length === 1 && progress[0].historyPending));
  fulfill(calls[1]);
  const results = await Promise.all(reads);
  assert.ok(stages.every(progress => progress.length === 2));
  results[0].turnSnapshot.events[0].timelineRecoveryRequired = true;
  assert.equal(results[1].turnSnapshot.events[0].timelineRecoveryRequired, undefined);
  assert.equal(stages[0][0].turnSnapshot.events[0].timelineRecoveryRequired, undefined);
  results.forEach((result, i) => {
    assert.equal(result.session.title, `caller ${i}`);
    assert.equal(result.session.timelineNextBefore, 'older');
  });
  const next = load({ id: 'one' });
  assert.equal(calls.length, 4);
  calls.slice(2).forEach(fulfill); await next;
});

test('progress reentry reuses settled status while history remains pending', async () => {
  const { load, calls, fulfill } = await fixture();
  let reentry: Promise<any> | undefined;
  const opening = load({ id: 'one' }, { onProgress: () => { reentry ||= load({ id: 'one' }); } });
  fulfill(calls[0]); await tick();
  assert.equal(calls.length, 2);
  fulfill(calls[1]); await opening; await reentry;
});

test('latest and different history anchors do not share timeline semantics', async () => {
  const { load, calls, fulfill } = await fixture();
  const reads = [load({ id: 'one' }), load({ id: 'one' }, { latest: true }),
    load({ id: 'one' }, { anchors: [{ id: 'anchor-a' }] }), load({ id: 'one' }, { anchors: [{ id: 'anchor-b' }] })];
  assert.equal(calls.filter(call => call.path.endsWith('/status')).length, 1);
  assert.equal(calls.filter(call => call.path.includes('/timeline')).length, 4);
  calls.forEach(fulfill); await Promise.all(reads);
});

test('one cancelled subscriber cannot abort another; all cancellations abort transport', async () => {
  const { load, calls, fulfill } = await fixture();
  const first = new AbortController(), second = new AbortController();
  const a = load({ id: 'one' }, { signal: first.signal });
  const rejected = assert.rejects(a, { name: 'AbortError' });
  const b = load({ id: 'one' }, { signal: second.signal });
  first.abort(); await rejected;
  assert.ok(calls.every(call => !call.signal.aborted));
  calls.forEach(fulfill); await b;
  const cancel = new AbortController();
  const c = load({ id: 'one' }, { signal: cancel.signal });
  const cancelled = assert.rejects(c, { name: 'AbortError' });
  cancel.abort(); await cancelled;
  assert.ok(calls.slice(2).every(call => call.signal.aborted));
});

test('navigation cancellation and changed identities settle stale non-cooperative reads', async () => {
  const { load, calls, fulfill, setOwner } = await fixture();
  let staleProgress = 0;
  const a = load({ id: 'one' }, { onProgress: () => staleProgress++ });
  const rejected = assert.rejects(a, { name: 'AbortError' });
  setOwner('bob:2');
  const b = load({ id: 'one' });
  await rejected;
  assert.ok(calls.slice(0, 2).every(call => call.signal.aborted));
  calls.forEach(fulfill); await b;
  assert.equal(staleProgress, 0);
  const c = load({ id: 'two' });
  const cancelled = assert.rejects(c, { name: 'AbortError' });
  load.cancel(); await cancelled;
});

test('background partial failures back off per owner without delaying manual reads', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function reconcileCurrentSessionInBackground(');
  const end = source.indexOf('\nfunction scheduleStreamReconnect(', start);
  let now = 1000, calls = 0, owner = 'alice:one';
  const state: any = { authSession: {}, sessionId: 'one', sessionHistoryError: 'partial' };
  const context: any = { state, AbortController, Date: { now: () => now },
    isShareContext: () => false, recoveryOwnerKey: () => owner,
    scheduleNetworkTimer: () => 1, clearNetworkTimer: () => {}, SESSION_RECONCILE_TIMEOUT_MS: 12000,
    refreshCurrentSessionMetadata: async () => { calls++; return { id: state.sessionId }; } };
  vm.runInNewContext(`let sessionReconcilePromise = null, sessionReconcileKey = '', sessionReconcileForceDetail = false;
    let sessionReconcileRetry = { owner: '', failures: 0, after: 0 };\n${source.slice(start, end)}`, context);
  const refresh = context.reconcileCurrentSessionInBackground;
  await refresh(); await refresh(); assert.equal(calls, 1);
  now += 1000; await refresh(); assert.equal(calls, 2);
  now += 1000; await refresh(); assert.equal(calls, 2);
  now += 1000; state.sessionHistoryError = ''; await refresh(); await refresh(); assert.equal(calls, 4);
  state.sessionHistoryError = 'partial'; await refresh();
  owner = 'bob:two'; state.sessionId = 'two'; await refresh(); assert.equal(calls, 6);
});

test('partial failure stays usable, fatal failures cancel siblings, and settled failures are retried', async () => {
  const { load, calls, fulfill } = await fixture();
  const first = load({ id: 'one' });
  calls[0].reject({ status: 503 }); fulfill(calls[1]);
  const partial = await first;
  assert.equal(partial.hasTimelineData, true);
  assert.equal(partial.statusError, 'Execution status could not be refreshed.');
  const second = load({ id: 'one' });
  const denied = assert.rejects(second, { status: 403 });
  calls[2].reject({ status: 403 }); await denied;
  assert.equal(calls[3].signal.aborted, true);
  const third = load({ id: 'one' });
  calls.slice(4).forEach(fulfill); await third;
  assert.equal(calls.length, 6);
});

test('legacy fallback is shared and progress remains delivered to every subscriber', async () => {
  const { load, calls } = await fixture();
  const stages = [[], []] as any[][];
  const reads = stages.map(progress => load({ id: 'one' }, { onProgress: (payload: any) => progress.push(payload) }));
  assert.equal(calls.length, 2);
  calls.forEach(call => call.reject({ status: 404 })); await tick();
  assert.equal(calls.length, 3);
  calls[2].resolve({ session: { id: 'one', timeline: [{ id: 'legacy' }] } });
  const results = await Promise.all(reads);
  assert.ok(results.every(result => result.session.timeline[0].id === 'legacy'));
  results[0].session.timeline[0].id = 'changed';
  assert.equal(results[1].session.timeline[0].id, 'legacy');
  assert.ok(stages.every(progress => progress.length === 1));
});

test('a synchronous transport hook can reenter without observing an uninitialized shared promise', async () => {
  const context: any = { AbortController, structuredClone };
  vm.runInNewContext(await readFile(new URL('../public/session-loader.js', import.meta.url), 'utf8'), context);
  let reentry: Promise<any> | undefined, calls = 0;
  const load = context.CodexWebSessionLoader.createLoader({ state: { timelineCache: new Map() },
    apiFetch: (path: string) => {
      if (++calls === 1) reentry = load({ id: 'one' });
      return Promise.resolve(path.endsWith('/status') ? { session: { id: 'one' } } : { session: { id: 'one' }, items: [] });
    }, isFatalSessionOpenError: () => false, timelinesHaveStableOverlap: () => false, mergeLatestTimelineHistory: () => [] });
  await load({ id: 'one' });
  const result = await reentry;
  assert.equal(calls, 2);
  assert.equal(result.statusError, '');
});

test('background rejected refresh backs off and detail waiters coalesce without following a changed owner', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function reconcileCurrentSessionInBackground(');
  const end = source.indexOf('\nfunction scheduleStreamReconnect(', start);
  let now = 1000, owner = 'alice:one';
  const pending: any[] = [];
  const state: any = { authSession: {}, sessionId: 'one' };
  const context: any = { state, AbortController, Date: { now: () => now },
    isShareContext: () => false, recoveryOwnerKey: () => owner,
    scheduleNetworkTimer: () => 1, clearNetworkTimer: () => {}, SESSION_RECONCILE_TIMEOUT_MS: 12000,
    refreshCurrentSessionMetadata: (options: any) => new Promise((resolve, reject) => pending.push({ options, resolve, reject })) };
  vm.runInNewContext(`let sessionReconcilePromise = null, sessionReconcileKey = '', sessionReconcileForceDetail = false;
    let sessionReconcileRetry = { owner: '', failures: 0, after: 0 };\n${source.slice(start, end)}`, context);
  const refresh = context.reconcileCurrentSessionInBackground;
  const rejected = refresh(); pending[0].reject(new Error('render failed'));
  assert.equal(await rejected, null); await refresh(); assert.equal(pending.length, 1);
  now += 1000;
  const compact = refresh();
  const details = Array.from({ length: 20 }, () => refresh({ forceDetail: true }));
  pending[1].resolve({ id: 'one' }); await tick();
  assert.equal(pending.length, 3); assert.equal(pending[2].options.forceDetail, true);
  pending[2].resolve({ id: 'one' }); await Promise.all([compact, ...details]);
  const old = refresh(); const queued = refresh({ forceDetail: true });
  owner = 'bob:two'; pending[3].resolve({ id: 'one' });
  await old; assert.equal(await queued, null); assert.equal(pending.length, 4);
});
