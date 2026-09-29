import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CodexWebRuntime } from '../src/runtime.js';
test('runtime forwards only official terminal question states into receipt persistence', async () => {
  const client = new EventEmitter();
  const runtime = new CodexWebRuntime({ codexBin: 'codex', defaultCwd: '/tmp', client: client as any, logger: {} });
  const persisted: Array<[string, string]> = [];
  runtime.setUserInputReceiptStore({ resolveRequest: async (id, status) => { persisted.push([id, status]); return 1; } });
  const request = { requestId: 'epoch:1', threadId: 'thread', turnId: 'turn', itemId: 'item', connectionEpoch: 1, questions: [], isBlocking: false, autoResolutionMs: null };
  client.emit('user_input_request', { ...request, status: 'pending' });
  client.emit('user_input_updated', { ...request, status: 'delivery_unknown' });
  client.emit('user_input_updated', { ...request, status: 'resolved' });
  client.emit('user_input_updated', { ...request, requestId: 'epoch:2', status: 'expired' });
  await Promise.resolve();
  assert.deepEqual(persisted, [['epoch:1', 'resolved'], ['epoch:2', 'expired']]);
});
