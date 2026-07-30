import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FileWebhookConversationStore,
  hashWebhookConversationKey,
} from '../src/webhook_conversation_store.js';

test('webhook conversation store persists hashed per-owner session bindings', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-conversations-'));
  const store = new FileWebhookConversationStore({ stateDir });
  const keyHash = hashWebhookConversationKey('external-conversation-1');
  const createdAt = new Date().toISOString();
  const record = {
    ownerUserId: 'user_alice',
    keyHash,
    sessionId: 'session_1',
    projectId: 'project_1',
    createdAt,
    updatedAt: createdAt,
  };

  assert.equal((await store.bind(record)).created, true);
  assert.equal((await store.bind({ ...record, sessionId: 'session_other' })).created, false);
  assert.equal((await store.bind({ ...record, ownerUserId: 'user_bob', sessionId: 'session_bob' })).created, true);

  const reopened = new FileWebhookConversationStore({ stateDir });
  assert.equal((await reopened.read('user_alice', keyHash))?.sessionId, 'session_1');
  assert.equal((await reopened.read('user_bob', keyHash))?.sessionId, 'session_bob');
  assert.equal(await reopened.read('user_charlie', keyHash), null);

  const statePath = path.join(stateDir, 'webhook-conversations.json');
  const raw = await fs.readFile(statePath, 'utf8');
  assert.equal(raw.includes('external-conversation-1'), false);
  assert.equal((await fs.stat(statePath)).mode & 0o777, 0o600);
});

test('webhook conversation store serializes operations for the same owner and key', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-conversation-lock-'));
  const first = new FileWebhookConversationStore({ stateDir });
  const second = new FileWebhookConversationStore({ stateDir });
  const keyHash = hashWebhookConversationKey('shared-conversation');
  const order: string[] = [];
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let releaseFirst!: () => void;
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const firstOperation = first.withConversationOperationLock('user_alice', keyHash, async () => {
    order.push('first-start');
    markFirstStarted();
    await firstHeld;
    order.push('first-end');
  });
  await firstStarted;
  const secondOperation = second.withConversationOperationLock('user_alice', keyHash, async () => {
    order.push('second');
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(order, ['first-start']);
  } finally {
    releaseFirst();
  }
  await Promise.all([firstOperation, secondOperation]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});
