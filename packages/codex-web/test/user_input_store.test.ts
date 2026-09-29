import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileUserInputStore } from '../src/user_input_store.js';
const input = { ownerUserId: 'alice', sessionId: 'session', requestId: 'epoch:rpc', answerSubmissionId: 'submission', answers: { q: { answers: ['secret'] } } };
test('answer receipts survive restart without plaintext answers or permission leaks', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'answer-receipt-')); t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const store = new FileUserInputStore({ stateDir });
  assert.equal((await store.prepare(input)).created, true);
  const restarted = new FileUserInputStore({ stateDir });
  assert.equal((await restarted.read('alice', 'session', 'submission'))?.status, 'delivery_unknown');
  assert.equal(await restarted.read('bob', 'session', 'submission'), null);
  assert.equal(await restarted.read('alice', 'other', 'submission'), null);
  assert.equal((await restarted.prepare(input)).created, false);
  assert.equal((await fs.readFile(path.join(stateDir, 'user-input-receipts.json'), 'utf8')).includes('secret'), false);
  await restarted.update('alice', 'session', 'submission', 'resolved');
  assert.equal((await restarted.update('alice', 'session', 'submission', 'delivery_unknown')).status, 'resolved');
});
test('competing devices and changed answer identity cannot create duplicate receipts', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'answer-receipt-')); t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const first = new FileUserInputStore({ stateDir }), second = new FileUserInputStore({ stateDir });
  const results = await Promise.all([first.prepare(input), second.prepare(input)]);
  assert.equal(results.filter(r => r.created).length, 1);
  await assert.rejects(second.prepare({ ...input, answerSubmissionId: 'other' }), /already/);
  await assert.rejects(second.prepare({ ...input, answers: { q: { answers: ['different'] } } }), /already/);
});
test('corrupt persistence fails closed', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'answer-receipt-')); t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(stateDir, 'user-input-receipts.json'), '{');
  await assert.rejects(new FileUserInputStore({ stateDir }).prepare(input));
});
test('official resolution converges durable receipts without a browser receipt GET', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'answer-receipt-')); t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const store = new FileUserInputStore({ stateDir });
  await store.prepare(input);
  await store.prepare({ ...input, requestId: 'another-epoch:rpc', answerSubmissionId: 'other' });
  assert.equal(await store.resolveRequest(input.requestId, 'resolved'), 1);
  assert.equal((await new FileUserInputStore({ stateDir }).read('alice', 'session', 'submission'))?.status, 'resolved');
  assert.equal((await store.read('alice', 'session', 'other'))?.status, 'delivery_unknown');
  assert.equal(await store.resolveRequest(input.requestId, 'expired'), 0);
  assert.equal(await store.resolveRequest('another-epoch:rpc', 'expired'), 1);
  assert.equal((await store.read('alice', 'session', 'other'))?.status, 'expired');
});
