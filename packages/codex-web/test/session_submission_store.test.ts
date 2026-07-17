import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FileSessionSubmissionStore,
  hashSessionSubmissionPayload,
  type CodexWebSessionSubmissionPayload,
} from '../src/session_submission_store.js';

function payload(overrides: Partial<CodexWebSessionSubmissionPayload> = {}): CodexWebSessionSubmissionPayload {
  return {
    sessionId: null,
    projectId: null,
    cwd: '/tmp/project',
    title: null,
    settings: { model: 'gpt-test', nested: { b: 2, a: 1 } },
    text: 'hello',
    attachments: [],
    attachmentIds: [],
    ...overrides,
  };
}

test('FileSessionSubmissionStore persists records and scopes ids by owner', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-submissions-'));
  const store = new FileSessionSubmissionStore({ stateDir });
  const value = payload();
  const now = new Date().toISOString();
  const base = {
    id: 'sub_1',
    payloadHash: hashSessionSubmissionPayload(value),
    payload: value,
    status: 'queued' as const,
    sessionId: null,
    runtimeSessionId: null,
    turnBaseline: null,
    turnId: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  assert.equal((await store.create({ ...base, ownerUserId: 'alice' })).created, true);
  assert.equal((await store.create({ ...base, ownerUserId: 'alice' })).created, false);
  assert.equal((await store.create({ ...base, ownerUserId: 'bob' })).created, true);

  const reopened = new FileSessionSubmissionStore({ stateDir });
  assert.equal((await reopened.read('alice', 'sub_1'))?.payload.text, 'hello');
  assert.equal((await reopened.read('bob', 'sub_1'))?.ownerUserId, 'bob');
  assert.equal(await reopened.read('charlie', 'sub_1'), null);
  assert.equal((await fs.stat(path.join(stateDir, 'session-submissions.json'))).mode & 0o777, 0o600);
});

test('session submission payload hashes are stable across object key order', () => {
  const left = payload({ settings: { model: 'gpt-test', nested: { a: 1, b: 2 } } });
  const right = payload({ settings: { nested: { b: 2, a: 1 }, model: 'gpt-test' } });
  assert.equal(hashSessionSubmissionPayload(left), hashSessionSubmissionPayload(right));
  assert.notEqual(hashSessionSubmissionPayload(left), hashSessionSubmissionPayload(payload({ text: 'different' })));
});

test('session submission store prunes expired and excess terminal records on create', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-submission-retention-'));
  const store = new FileSessionSubmissionStore({
    stateDir,
    terminalRetentionMs: 60_000,
    maxTerminalRecordsPerOwner: 2,
  });
  const createRecord = async (id: string, status: 'queued' | 'submitted', updatedAt: string) => {
    const value = payload({ text: id });
    await store.create({
      id,
      ownerUserId: 'alice',
      payloadHash: hashSessionSubmissionPayload(value),
      payload: value,
      status,
      sessionId: status === 'submitted' ? `thread_${id}` : null,
      runtimeSessionId: status === 'submitted' ? `thread_${id}` : null,
      turnBaseline: null,
      turnId: status === 'submitted' ? `turn_${id}` : null,
      result: status === 'submitted' ? { turnId: `turn_${id}` } : null,
      error: null,
      createdAt: updatedAt,
      updatedAt,
    });
  };
  const now = Date.now();
  await createRecord('expired', 'submitted', new Date(now - 120_000).toISOString());
  await createRecord('older-retained', 'submitted', new Date(now - 20_000).toISOString());
  await createRecord('newer-retained', 'submitted', new Date(now - 10_000).toISOString());
  await createRecord('new-request', 'queued', new Date(now).toISOString());

  assert.equal(await store.read('alice', 'expired'), null);
  assert.equal(await store.read('alice', 'older-retained'), null);
  assert.equal((await store.read('alice', 'newer-retained'))?.status, 'submitted');
  assert.equal((await store.read('alice', 'new-request'))?.status, 'queued');
});
