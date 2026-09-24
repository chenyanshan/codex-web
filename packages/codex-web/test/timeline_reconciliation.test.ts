import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/timeline-reconciliation.js', import.meta.url), 'utf8');
const { pendingMessages, transientDuplicate, mergeLatestHistory } = vm.runInNewContext(`${source}\nCodexWebTimelineReconciliation;`);
type Message = { id: string; kind: string; role: string; text: string; meta: string; turnId?: string; submissionId?: string; clientMessageId?: string; deliveryLabel?: string; historyAnchorId?: string };
const message = (id: string, overrides: Partial<Message> = {}): Message => ({ id, kind: 'message', role: 'user', text: 'Continue', meta: 'pending', ...overrides });
const options = (overrides = {}) => ({
  identity: (item: Message) => `${item.role}:${item.text}`,
  turnId: (item: Message) => item.turnId || '',
  pendingSubmissionIds: new Set<string>(), terminalTurnIds: new Set<string>(),
  activeTurnId: '', authoritative: true, latestWindow: true, ...overrides,
});
const ids = (items: Message[]) => Array.from(items, item => item.id);
const identities = (item: Message) => [`id:${item.id}`, ...(item.clientMessageId ? [`client:${item.clientMessageId}`] : [])];

test('latest history replaces overlapping cached order while preserving the older prefix', () => {
  const older = message('older', { meta: 'history' });
  const prompt = message('prompt', { meta: 'history' });
  const answer = message('answer', { role: 'assistant', meta: 'final' });
  const pending = message('local', { deliveryLabel: 'Server received' });
  assert.deepEqual(ids(mergeLatestHistory([older, pending, answer], [prompt, answer], identities)), ['older', 'prompt', 'answer']);
  // Repair an already cached inversion too, even without an optimistic copy.
  assert.deepEqual(ids(mergeLatestHistory([older, answer, prompt], [prompt, answer], identities)), ['older', 'prompt', 'answer']);
});

test('latest history uses stable aliases and preserves distinct same-text prompts', () => {
  const previous = message('previous', { meta: 'history', clientMessageId: 'previous-client' });
  const cached = message('cached', { meta: 'history', clientMessageId: 'new-client' });
  const native = message('native', { meta: 'history', clientMessageId: 'new-client' });
  assert.deepEqual(ids(mergeLatestHistory([previous, cached], [native], identities)), ['previous', 'native']);
});

test('disconnected latest pages do not append unrelated cached history', () => {
  assert.deepEqual(ids(mergeLatestHistory([message('old')], [message('new')], identities)), ['new']);
  assert.deepEqual(ids(mergeLatestHistory([], [message('new')], identities)), ['new']);
});

test('a recent authoritative page does not append an old receipt but keeps real unsent messages', () => {
  const history = [message('native-new', { meta: 'history', turnId: 'new' })];
  const stale = message('old-upload', { text: 'Earlier screenshot', turnId: 'old', deliveryLabel: 'Server received' });
  const pending = message('offline-upload', { text: 'Unsent screenshot', submissionId: 'outbox' });
  assert.deepEqual(ids(pendingMessages(history, [stale, pending], options({ pendingSubmissionIds: new Set(['outbox']) }))), ['offline-upload']);
});

test('a first-turn receipt remains until its message appears in complete history', () => {
  const received = message('receipt', { turnId: 'active', deliveryLabel: 'Server received', historyAnchorId: '@start' });
  assert.deepEqual(ids(pendingMessages([], [received], options({ completeHistory: true }))), ['receipt']);
  assert.deepEqual(ids(pendingMessages([message('native', { meta: 'history', turnId: 'active' })], [received], options({ completeHistory: true }))), []);
  assert.deepEqual(ids(pendingMessages([], [received], options({ authoritative: false }))), ['receipt']);
});

test('an old turn and a new turn may legitimately have the same prompt', () => {
  const prior = message('prior', { meta: 'history', turnId: 'prior' });
  const next = message('next', { turnId: 'next', historyAnchorId: 'prior' });
  assert.deepEqual(ids(pendingMessages([prior], [prior, next], options())), ['next']);
  const legacyPrior = message('legacy-prior', { meta: 'history' });
  assert.deepEqual(ids(pendingMessages([legacyPrior], [legacyPrior, message('legacy-next', { historyAnchorId: legacyPrior.id })], options())), ['legacy-next']);
});

test('stable client IDs reconcile independently of text and distinguish same-text submissions', () => {
  const prior = message('native', { meta: 'history', clientMessageId: 'first' });
  const confirmed = message('cache', { clientMessageId: 'first', text: 'Previously formatted text' });
  const distinct = message('next', { clientMessageId: 'second', historyAnchorId: 'native' });
  assert.deepEqual(ids(pendingMessages([prior], [confirmed, distinct], options())), ['next']);
});

test('terminal cached turns are not moved to the latest edge and do not erase retryable outbox entries', () => {
  const old = message('old', { turnId: 'terminal' });
  const retryable = message('retry', { turnId: 'terminal', submissionId: 'retry' });
  assert.deepEqual(ids(pendingMessages([], [old, retryable], options({ terminalTurnIds: new Set(['terminal']), pendingSubmissionIds: new Set(['retry']) }))), ['retry']);
});

test('a disconnected historical window does not append newer local messages', () => {
  assert.deepEqual(ids(pendingMessages([], [message('local', { submissionId: 'pending' })], options({ latestWindow: false, pendingSubmissionIds: new Set(['pending']) }))), []);
});

test('a new outbox message is not consumed by an older message with the same text', () => {
  const prior = message('prior', { meta: 'history', turnId: 'active' });
  const pending = message('local', { submissionId: 'retry' });
  assert.deepEqual(ids(pendingMessages([prior], [pending], options({ activeTurnId: 'active', pendingSubmissionIds: new Set(['retry']) }))), ['local']);
});

test('acknowledged messages survive stale status and history until confirmed, without moving older receipts to the end', () => {
  const anchor = message('anchor', { meta: 'final', role: 'assistant', text: 'Previous reply', turnId: 'old' });
  const received = message('received', { turnId: 'finished', deliveryLabel: 'Server received', clientMessageId: 'client-latest', historyAnchorId: 'anchor' });
  const stale = options({ activeTurnId: 'another-turn', terminalTurnIds: new Set(['finished']) });
  assert.deepEqual(ids(pendingMessages([anchor], [received], stale)), ['received']);
  const confirmed = message('native', { meta: 'history', turnId: 'finished', clientMessageId: 'client-latest' });
  assert.deepEqual(ids(pendingMessages([anchor, confirmed], [received], stale)), []);
  assert.deepEqual(ids(pendingMessages([message('much-newer')], [received], stale)), []);
});

test('adjacent repeated submissions survive both cache serialization and timeline merging', () => {
  const prior = message('native', { meta: 'history', turnId: 'active', clientMessageId: 'prior' });
  const waiting = message('waiting', { submissionId: 'outbox' });
  assert.equal(transientDuplicate(prior, waiting, options({ pendingSubmissionIds: new Set(['outbox']) })), false);
  const received = { ...waiting, turnId: 'active', clientMessageId: 'new', deliveryLabel: 'Server received' };
  assert.equal(transientDuplicate(prior, received, options()), false);
  assert.equal(transientDuplicate({ ...prior, clientMessageId: 'new' }, received, options()), true);
});

test('a first-message receipt waits for complete history even after its turn finishes', () => {
  const received = message('first', { deliveryLabel: 'Server received', historyAnchorId: '@start', turnId: 'finished' });
  const config = options({ terminalTurnIds: new Set(['finished']), completeHistory: true });
  assert.deepEqual(ids(pendingMessages([], [received], config)), ['first']);
  assert.deepEqual(ids(pendingMessages([message('native', { meta: 'history', turnId: 'finished' })], [received], config)), []);
  assert.deepEqual(ids(pendingMessages([message('much-newer')], [received], { ...config, completeHistory: false })), []);
});

test('an active long turn does not move receipts from outside the latest page to its end', () => {
  const latest = message('latest-answer', { role: 'assistant', meta: 'commentary', turnId: 'long-goal', text: 'Latest progress' });
  const old = message('old-image', { turnId: 'long-goal', deliveryLabel: 'Server received', clientMessageId: 'old-client', historyAnchorId: 'outside-page' });
  const recent = message('recent', { turnId: 'long-goal', deliveryLabel: 'Server received', clientMessageId: 'recent-client', historyAnchorId: latest.id });
  assert.deepEqual(ids(pendingMessages([latest], [old, latest, recent], options({ activeTurnId: 'long-goal', completeHistory: false }))), ['recent']);
});

test('legacy cached pending flags without a live outbox or history boundary are not new submissions', () => {
  const latest = message('latest-answer', { role: 'assistant', meta: 'commentary', text: 'Latest progress' });
  const legacy = message('old-image', { turnId: 'old-turn', text: 'An old image prompt with stripped receipt fields' });
  assert.deepEqual(ids(pendingMessages([latest], [latest, legacy], options())), []);
  // An unavailable history endpoint cannot invalidate the only local copy.
  assert.deepEqual(ids(pendingMessages([latest], [latest, legacy], options({ authoritative: false }))), ['old-image']);
});
