import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/timeline-reconciliation.js', import.meta.url), 'utf8');
const reducer = vm.runInNewContext(`${source}\nCodexWebTimelineReconciliation;`);
const record = (id: string, position: number, version = 1, revision = version, generation = 'first') => ({
  id, kind: 'message', role: 'assistant', text: 'Repeated text', meta: 'final',
  timeline: { id: `canonical:${id}`, generation, position, version, revision, aliases: [id] },
});
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('canonical records with equal text retain distinct identities and server order', () => {
  const earlier = record('earlier', 1), later = record('later', 2);
  assert.deepEqual(plain(reducer.reconcileMessages([later], [later, earlier], { generation: 'first', revision: 2 })), [earlier, later]);
});

test('a late history page cannot roll back a newer version of the same record', () => {
  const latest = { ...record('answer', 1, 3, 8), text: 'Completed full answer' };
  const stale = { ...record('answer', 1, 1, 3), text: 'Partial' };
  assert.deepEqual(plain(reducer.reconcileMessages([latest], [stale], { generation: 'first', revision: 3 })), [latest]);
});

test('events newer than snapshot checkpoint survive and replay is idempotent', () => {
  const first = record('first', 1, 1, 2), live = record('live', 2, 1, 5);
  const checkpoint = { generation: 'first', revision: 3 };
  const once = reducer.reconcileMessages([first, live], [first], checkpoint);
  const twice = reducer.reconcileMessages(once, [first], checkpoint);
  assert.deepEqual(plain(once), [first, live]);
  assert.deepEqual(plain(twice), [first, live]);
});

test('generation reset removes prior generation records even when their versions are higher', () => {
  const old = record('answer', 1, 99, 99), orphan = record('orphan', 2, 90, 100);
  const reset = { ...record('answer', 1, 1, 1, 'second'), text: 'Replacement generation' };
  assert.deepEqual(plain(reducer.reconcileMessages([old, orphan], [reset], { generation: 'second', revision: 1 })), [reset]);
});

test('canonical alias reconciles an optimistic identity without duplicating the receipt', () => {
  const local = { id: 'local:submission', kind: 'message', role: 'user', text: 'Send once', meta: 'pending' };
  const confirmed = { ...record('confirmed', 1), role: 'user', text: 'Send once' };
  confirmed.timeline.aliases.push(local.id);
  assert.deepEqual(plain(reducer.reconcileMessages([local], [confirmed], { generation: 'first', revision: 1 })), [confirmed]);
});

test('user replay removes all confirmed copies at the native slot without losing newer content or attachments', () => {
  const confirmed = { ...record('user', 2, 3, 8), role: 'user', text: 'Newer normalized question' };
  confirmed.timeline.aliases.push('accepted-hash');
  const attachment = { localPath: '/uploads/evidence.png' };
  const local = { id: 'local-user', role: 'user', kind: 'message', meta: 'pending', text: confirmed.text,
    clientMessageId: 'accepted-hash', attachments: [attachment] };
  const repeated = { ...local, id: 'different-user', clientMessageId: 'different-hash', attachments: [] };
  const anchor = record('anchor', 1), answer = record('answer', 3);
  const stale = { ...confirmed, text: 'Old text', timeline: { ...confirmed.timeline, version: 1, revision: 2 } };
  const merged = reducer.upsertUserMessage([anchor, local, confirmed, answer, repeated], stale,
    (...groups: (unknown[] | undefined)[]) => groups.flatMap(group => group || []));
  assert.deepEqual(plain(merged), [anchor, { ...confirmed, attachments: [attachment] }, answer, repeated]);
});
