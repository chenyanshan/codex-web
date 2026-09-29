import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleUserInputRoute } from '../src/user_input_routes.js';
import { FileUserInputStore } from '../src/user_input_store.js';
import type { UserInputRequest } from '@codex-mobile-web-app/codex-native-api';
test('authorized answer routes persist before send and recover same receipt without another write', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'question-route-')); t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const store = new FileUserInputStore({ stateDir }); let sends = 0;
  const request: UserInputRequest = { requestId: 'epoch:1', connectionEpoch: 1, threadId: 'thread', turnId: 'turn', itemId: 'item', status: 'pending', isBlocking: true, autoResolutionMs: null, questions: [] };
  const runtime = { listUserInputRequests: () => [request], answerUserInput: async (_t: string, _r: string, _a: unknown, before: () => Promise<void>) => {
    await before(); assert.ok(await store.read('owner', 'session', 'submission')); sends++; request.status = 'delivery_unknown'; return request;
  } };
  const context = { ownerUserId: 'owner', sessionId: 'session', threadId: 'thread', runtime, store };
  const submit = { ...context, method: 'POST', path: '/user-input/epoch%3A1/answer', body: { answerSubmissionId: 'submission', answers: { q: { answers: ['A'] } } } };
  assert.equal((await handleUserInputRoute(submit))?.status, 200);
  assert.equal((await handleUserInputRoute(submit))?.status, 200); assert.equal(sends, 1);
  request.status = 'resolved';
  const receipt = await handleUserInputRoute({ ...context, method: 'GET', path: '/user-input/receipts/submission' });
  assert.equal((receipt?.body as any).receipt.status, 'resolved');
  assert.equal((await handleUserInputRoute({ ...context, ownerUserId: 'other', method: 'GET', path: '/user-input/receipts/submission' }))?.status, 404);
  assert.equal((await handleUserInputRoute({ ...submit, body: { ...submit.body, answers: {} } }))?.status, 409);
});
