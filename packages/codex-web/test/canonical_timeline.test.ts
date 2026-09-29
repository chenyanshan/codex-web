import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanonicalTimelineStore } from '../src/canonical_timeline.js';
import { paginateSessionTimeline } from '../src/session_timeline_page.js';
import type { CodexWebTimelineMessage } from '../src/session_timeline_store.js';
const message = (id: string, text = id): CodexWebTimelineMessage => ({ id: `history_${id}`, itemId: id, turnId: 'turn', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text, lifecycle: 'completed' });
test('native order, distinct same-text items, repeat reads and backfill preserve identities', () => {
  const store = new CanonicalTimelineStore();
  try {
    const first = store.reconcile('session', [message('b', 'same'), message('c', 'same')]);
    assert.notEqual(first.items[0].id, first.items[1].id);
    assert.deepEqual(store.reconcile('session', [message('b', 'same'), message('c', 'same')]), first);
    const backfill = store.reconcile('session', [message('a'), message('b', 'same'), message('c', 'same')]);
    assert.equal(backfill.items[1].id, first.items[0].id);
    assert.notEqual(backfill.checkpoint.generation, first.checkpoint.generation);
    assert.deepEqual(backfill.items.map(item => item.itemId), ['a', 'b', 'c']);
    const reordered = store.reconcile('session', [message('c'), message('a'), message('b')]);
    assert.notEqual(reordered.checkpoint.generation, backfill.checkpoint.generation);
    assert.deepEqual(reordered.items.map(item => item.itemId), ['c', 'a', 'b']);
  } finally { store.close(); }
});
test('committed event content and checkpoint survive reconstruction and racing stale history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canonical-'));
  try {
    let store = new CanonicalTimelineStore({ path: join(dir, 'timeline.sqlite') });
    store.reconcile('s', [message('a')]);
    const boundary = store.checkpoint('s');
    const live = store.upsert('s', { ...message('a', 'fresh'), lifecycle: 'completed' });
    const tail = store.upsert('s', message('b'));
    const raced = store.reconcile('s', [message('a', 'old')], boundary);
    assert.equal(raced.items[0].text, 'fresh');
    assert.equal(raced.items[1].id, tail.id);
    assert.equal(live.timeline?.id, raced.items[0].timeline?.id);
    store.close();
    store = new CanonicalTimelineStore({ path: join(dir, 'timeline.sqlite') });
    assert.deepEqual(store.list('s'), raced.items);
    assert.deepEqual(store.checkpoint('s'), raced.checkpoint);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('bounded retention invalidates cursors, stable keysets survive append and are scoped', () => {
  const store = new CanonicalTimelineStore({ maxEntriesPerSession: 3, maxBytes: 4096 });
  try {
    const first = store.reconcile('s', [message('a'), message('b'), message('c')]);
    const context = { sessionId: 's', scope: 'owner', checkpoint: first.checkpoint };
    const page = paginateSessionTimeline(first.items, new URL('http://test?limit=1'), items => items, context);
    const before = page.nextBefore!;
    assert.ok(before.startsWith('tl1.'));
    const older = paginateSessionTimeline(first.items, new URL(`http://test?limit=1&before=${before}`), items => items, context);
    assert.equal((older.items[0] as CodexWebTimelineMessage).itemId, 'b');
    const denied = paginateSessionTimeline(first.items, new URL(`http://test?before=${before}`), items => items, { ...context, scope: 'share' });
    assert.equal(denied.resetRequired, true);
    store.upsert('s', message('d'));
    assert.equal(store.list('s').length, 3);
    assert.notEqual(store.checkpoint('s').generation, first.checkpoint.generation);
    const reset = paginateSessionTimeline(store.list('s'), new URL(`http://test?before=${before}`), items => items, { ...context, checkpoint: store.checkpoint('s') });
    assert.equal(reset.resetRequired, true);
    const stable = store.reconcile('s', ['a','b','c','d'].map(id => message(id)));
    assert.deepEqual(store.reconcile('s', ['a','b','c','d'].map(id => message(id))), stable);
    for (let i = 0; i < 20; i++) store.upsert(`s${i}`, message('large', 'x'.repeat(500)));
    assert.ok(Array.from({length:20}, (_,i) => store.list(`s${i}`).length).reduce((a,b)=>a+b,0) < 20);
  } finally { store.close(); }
});
test('retention does not hide native history and reverted historical rows do not resurrect', () => {
  const store = new CanonicalTimelineStore({ maxEntriesPerSession: 2 });
  try {
    const full = store.reconcile('s', ['a','b','c','d','e'].map(id => message(id)));
    assert.equal(full.items.length, 5);
    assert.equal(store.list('s').length, 2);
    assert.deepEqual(store.reconcile('s', ['a','b','c','d','e'].map(id => message(id))), full);
    const reverted = store.reconcile('s', ['a','b','c'].map(id => message(id)), full.checkpoint);
    assert.deepEqual(reverted.items.map(item => item.itemId), ['a','b','c']);
    assert.notEqual(reverted.checkpoint.generation, full.checkpoint.generation);
  } finally { store.close(); }
});
test('initial user and steer client aliases survive native hydration without duplicate rows', () => {
  const store = new CanonicalTimelineStore();
  try {
    const initial = store.upsert('s', { ...message('optimistic', 'hello'), role: 'user', canonicalKey: 'initial-user', clientMessageId: 'client-first' });
    const steered = store.upsert('s', { ...message('provider-client', 'follow up'), role: 'user', clientMessageId: 'client-steer' });
    const hydrated = store.reconcile('s', [
      { ...message('native-user', 'hello'), role: 'user', canonicalKey: 'initial-user' },
      { ...message('native-steer', 'follow up'), role: 'user', clientMessageId: 'client-steer' },
    ]);
    assert.deepEqual(hydrated.items.map(item => item.id), [initial.id, steered.id]);
    assert.ok(hydrated.items[0].timeline?.aliases.includes('client-first'));
    assert.equal(hydrated.items.length, 2);
  } finally { store.close(); }
});
test('oversized writes are not persisted and force generation reset for recovery', () => {
  const store = new CanonicalTimelineStore({ maxBytes: 1024 });
  try {
    const before = store.checkpoint('s');
    store.upsert('s', message('huge', 'x'.repeat(100_000)));
    assert.equal(store.list('s').length, 0);
    assert.notEqual(store.checkpoint('s').generation, before.generation);
    assert.equal(store.reconcile('s', [message('huge', 'x'.repeat(100_000))]).items[0].text.length, 100_000);
  } finally { store.close(); }
});
test('provider-confirmed rows updated live can still be authoritatively reverted', () => {
  const store = new CanonicalTimelineStore();
  try {
    store.reconcile('s', [message('a')]);
    store.upsert('s', message('a', 'updated'));
    const before = store.checkpoint('s');
    assert.equal(store.reconcile('s', [], before).items.length, 0);
    store.upsert('s', message('new', 'accepted'));
    const pending = store.reconcile('s', [], store.checkpoint('s'));
    assert.equal(pending.items.length, 1);
    assert.equal(store.reconcile('s', [], pending.checkpoint).items.length, 1);
  } finally { store.close(); }
});
test('synthetic final binds exactly one native final, with identity retained on later events', () => {
  const store = new CanonicalTimelineStore();
  try {
    const fallback = store.upsert('s', { ...message('assistant_turn_final', 'answer'), phase: 'final_answer' });
    const native = store.reconcile('s', [{ ...message('native-final', 'answer'), phase: 'final_answer' }]);
    assert.equal(native.items.length, 1);
    assert.equal(native.items[0].id, fallback.id);
    assert.equal(store.upsert('s', { ...message('native-final', 'answer revised'), phase: 'final_answer' }).id, fallback.id);
  } finally { store.close(); }
});
test('omitted live records stay between known neighbors and within their native turn', () => {
  const store = new CanonicalTimelineStore();
  try {
    const aUser = { ...message('a-user'), role: 'user' as const, turnId: 'a' };
    const aAnswer = { ...message('a-answer'), turnId: 'a' };
    const bUser = { ...message('b-user'), role: 'user' as const, turnId: 'b' };
    const bAnswer = { ...message('b-answer'), turnId: 'b' };
    store.reconcile('s', [aUser]);
    const live = store.upsert('s', aAnswer);
    const history = store.reconcile('s', [aUser, bUser, bAnswer]);
    assert.deepEqual(history.items.map(item => item.itemId), ['a-user','a-answer','b-user','b-answer']);
    assert.equal(history.items[1].id, live.id);
    assert.deepEqual(store.reconcile('s', [aUser, bUser, bAnswer]), history);
    store.upsert('s', { ...message('a-late'), turnId: 'a' });
    const anchored = store.reconcile('s', [aUser, { ...message('a-final'), turnId: 'a' }, bUser, bAnswer]);
    assert.deepEqual(anchored.items.map(item => item.itemId), ['a-user','a-answer','a-final','a-late','b-user','b-answer']);
  } finally { store.close(); }
});
test('preview placeholder yields to an accepted real user without text matching', () => {
  const store = new CanonicalTimelineStore();
  try {
    const preview = { ...message('preview', 'preview of input'), role: 'user' as const, meta: 'preview', turnId: undefined, itemId: undefined };
    store.reconcile('s', [preview]);
    const user = store.upsert('s', { ...message('real-user', 'accepted input'), role: 'user', canonicalKey:'initial-user' });
    const hydrated = store.reconcile('s', [preview]);
    assert.equal(hydrated.items.length, 1);
    assert.equal(hydrated.items[0].id, user.id);
    assert.equal(hydrated.items[0].text, 'accepted input');
  } finally { store.close(); }
});
test('unretained native history versions advance and remain monotonic when written live again', () => {
  const store = new CanonicalTimelineStore({maxEntriesPerSession:1});
  try {
    let old = store.upsert('s', message('a','one'));
    old = store.upsert('s', message('a','two'));
    store.upsert('s', message('b'));
    const first = store.reconcile('s', [message('a','two'),message('b')]);
    const changed = store.reconcile('s', [message('a','corrected'),message('b')]);
    assert.equal(changed.checkpoint.generation, first.checkpoint.generation);
    assert.ok(changed.items[0].timeline!.version > first.items[0].timeline!.version);
    assert.deepEqual(changed.items[1], store.find('s', changed.items[1].id));
    const resumed = store.upsert('s', message('a','corrected live'));
    assert.ok(resumed.timeline!.version > changed.items[0].timeline!.version);
  } finally { store.close(); }
});
test('a lagging active native turn cannot truncate a completed live final', () => {
  const store = new CanonicalTimelineStore();
  try {
    store.reconcile('s', [message('answer','answer-')]);
    store.upsert('s', message('answer','answer-complete'));
    const checkpoint = store.checkpoint('s');
    const lagging = store.reconcile('s', [message('answer','answer-')], checkpoint, new Set(), new Set(['turn']));
    assert.equal(lagging.items[0].text, 'answer-complete');
    const settled = store.reconcile('s', [message('answer','provider-corrected')], lagging.checkpoint, new Set(['turn']));
    assert.equal(settled.items[0].text, 'provider-corrected');
    assert.equal(store.reconcile('s', [], settled.checkpoint, new Set(['turn'])).items.length, 0);
  } finally { store.close(); }
});
test('ordering changes wholly outside retained tail invalidate old cursors while native append remains compatible', () => {
  const store = new CanonicalTimelineStore({maxEntriesPerSession:1});
  try {
    const first = store.reconcile('s', ['a','b','c'].map(id=>message(id)));
    const reordered = store.reconcile('s', ['b','a','c'].map(id=>message(id)));
    assert.notEqual(reordered.checkpoint.generation, first.checkpoint.generation);
    assert.deepEqual(reordered.items.map(item=>item.itemId), ['b','a','c']);
    assert.deepEqual(store.reconcile('s', ['b','a','c'].map(id=>message(id))), reordered);
  } finally { store.close(); }
  const appendStore = new CanonicalTimelineStore();
  try {
    const first = appendStore.reconcile('s', ['a','b'].map(id=>message(id)));
    assert.equal(appendStore.reconcile('s', ['a','b','c'].map(id=>message(id))).checkpoint.generation, first.checkpoint.generation);
  } finally { appendStore.close(); }
});
