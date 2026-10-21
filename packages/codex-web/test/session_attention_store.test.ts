import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileSessionAttentionStore } from '../src/session_attention_store.js';

test('session attention persists, isolates owners, and writes private atomic state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attention-'));
  const store = new FileSessionAttentionStore({ stateDir: dir });
  await store.markRead('alice', 's1', 't1');
  await store.markRead('bob', 's1', 'tb');
  assert.deepEqual([...(await store.readMany('alice', ['s1', 's2']))], [['s1', 't1']]);
  assert.deepEqual([...(await store.readMany('bob', ['s1']))], [['s1', 'tb']]);
  const stat = await fs.stat(path.join(dir, 'session-attention.json'));
  assert.equal(stat.mode & 0o777, 0o600);
});

test('expired read markers are ignored when listing session attention', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attention-expired-'));
  t.after(async () => fs.rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'session-attention.json');
  const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1_000).toISOString();
  await fs.writeFile(filename, JSON.stringify({
    version: 1,
    records: [{ ownerUserId: 'alice', sessionId: 's1', readTurnId: 't1', updatedAt: old }],
  }), { mode: 0o600 });
  const store = new FileSessionAttentionStore({ stateDir: dir });
  assert.deepEqual([...(await store.readMany('alice', ['s1']))], []);
});
