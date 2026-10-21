import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('unread results survive reload and missing summaries, and reading is scoped to each account', async () => {
  const source = await readFile(new URL('../public/session-attention.js', import.meta.url), 'utf8');
  const context: any = {};
  vm.runInNewContext(source, context);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) };
  let owner = 'alice';
  const create = () => context.CodexWebSessionAttention.createController({ storage, owner: () => owner });
  let attention = create();
  const session = { id: 'session', latestTurn: { id: 'result_1', status: 'completed' } };
  assert.equal(attention.unread(session), true);
  attention = create();
  assert.equal(attention.unread({ id: 'session', latestTurn: null }), true);
  attention.markRead(session);
  assert.equal(create().unread(session), false);
  assert.equal(attention.unread({ ...session, title: 'Renamed session' }), false);
  owner = 'bob';
  assert.equal(attention.unread(session), true);
  owner = 'alice';
  assert.equal(attention.unread(session), false);
  assert.equal(attention.unread({ ...session, latestTurn: { id: 'result_2', status: 'completed' } }), true);
  assert.equal(attention.unread({ ...session, latestTurn: { id: 'result_2', status: 'inProgress' } }), true);
  assert.equal(attention.unread({ ...session, latestTurn: { id: 'result_3', status: 'inProgress' } }), false);
  assert.equal(attention.unread({ ...session, latestTurn: { id: 'result_3', status: 'failed' } }), false);
});

test('server read markers synchronize completed results across devices', async () => {
  const source = await readFile(new URL('../public/session-attention.js', import.meta.url), 'utf8');
  const context: any = {};
  vm.runInNewContext(source, context);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) };
  const reads: Array<{ id: string; turnId: string }> = [];
  const create = () => context.CodexWebSessionAttention.createController({
    storage,
    owner: () => 'alice',
    onRead: ({ session, turnId }: any) => { reads.push({ id: session.id, turnId }); },
  });
  const unread = { id: 'session', latestTurn: { id: 'turn_2', status: 'completed' }, readTurnId: 'turn_1' };
  assert.equal(create().unread(unread), true);
  const alreadyRead = { ...unread, readTurnId: 'turn_2' };
  assert.equal(create().unread(alreadyRead), false);
  const attention = create();
  assert.equal(attention.markRead(unread), true);
  assert.deepEqual(reads, [{ id: 'session', turnId: 'turn_2' }]);
  assert.equal(create().unread({ ...unread, readTurnId: 'turn_2' }), false);
});

test('local fallback remains immediate when the receipt request fails', async () => {
  const source = await readFile(new URL('../public/session-attention.js', import.meta.url), 'utf8');
  const context: any = {};
  vm.runInNewContext(source, context);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) };
  const attention = context.CodexWebSessionAttention.createController({
    storage,
    owner: () => 'alice',
    onRead: async () => { throw new Error('offline'); },
  });
  const session = { id: 'session', latestTurn: { id: 'turn_1', status: 'completed' }, readTurnId: null };
  assert.equal(attention.unread(session), true);
  assert.equal(attention.markRead(session), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attention.unread(session), false);
});
