import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexWebServer } from '../src/server.js';
import { FileIdentityStore } from '../src/identity_store.js';
import type { CodexWebPrincipal } from '../src/access_control.js';

test('question and diff HTTP routes authenticate, enforce owner/write permissions and bind runtime thread IDs', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-permissions-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const identityStore = new FileIdentityStore({ identityPath: path.join(dir, 'identity.json') });
  await identityStore.setMultiUserEnabled(true);
  await identityStore.upsertProject({ id: 'project', internalName: 'repo', displayName: 'Repo', cwd: dir, enabled: true });
  for (const [id, write] of [['writer', true], ['reader', false]] as const) await identityStore.upsertRole({ id, name: id, isAdmin: false, projectGrants: [{ projectId: 'project', canRead: true, canCreate: write, canWrite: write }] });
  for (const [id, role] of [['alice', 'writer'], ['bob', 'writer'], ['reader', 'reader']]) {
    await identityStore.upsertUserWithPassword({ id, username: id, password: 'valid-password', roleIds: [role] });
    await identityStore.upsertSession({ id: `app_${id}`, codexThreadId: `thread_${id}`, projectId: 'project', ownerUserId: id, createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' });
  }
  const principals: Record<string, CodexWebPrincipal> = Object.fromEntries(['alice', 'bob', 'reader'].map(id => [id, { userId: id, username: id, roleIds: [id === 'reader' ? 'reader' : 'writer'], isAdmin: false, mode: 'multi' }]));
  principals.admin = { userId: 'admin', username: 'admin', roleIds: [], isAdmin: true, mode: 'multi' };
  let sends = 0; const diffReads: string[] = []; const questionReads: string[] = [];
  const request = { requestId: 'epoch:1', connectionEpoch: 1, threadId: 'thread_alice', turnId: 'turn_alice', itemId: 'item', questions: [], isBlocking: true, autoResolutionMs: null, status: 'pending' };
  const runtime = {
    listSessions: async () => [], readSession: async (id: string) => ({ id, thread: { turns: [] }, timeline: [], settings: {} }),
    listUserInputRequests: (threadId: string) => { questionReads.push(threadId); return threadId === 'thread_alice' ? [request] : []; },
    answerUserInput: async (_threadId: string, _requestId: string, _answer: unknown, beforeSend: () => Promise<void>) => { await beforeSend(); sends++; return { ...request, status: 'delivery_unknown' }; },
    getTurnDiff: (threadId: string, turnId: string) => { diffReads.push(`${threadId}:${turnId}`); return threadId === 'thread_alice' && turnId === 'turn_alice' ? { text: '+private change', bytes: 15, truncated: false } : null; },
  };
  const auth = { isConfigured: async () => true, login: async () => { throw Error('unused'); }, logout: async () => {}, verifyToken: async (token: string) => principals[token] ? { id: token, deviceName: 'test', createdAt: '', lastSeenAt: '', principal: principals[token] } : null };
  const server = createCodexWebServer({ auth, identityStore, runtime: runtime as any, config: { host: '127.0.0.1', port: 0, defaultCwd: dir, codexBin: 'codex', stateDir: dir, authPath: path.join(dir, 'auth.json'), reportsDir: path.join(dir, 'reports'), reportIndexPath: path.join(dir, 'reports.json'), envPath: path.join(dir, 'env'), debug: false, publicSharesEnabled: false, publicShareTtlSeconds: 3600 } });
  await server.start(); t.after(() => server.stop());
  const fetchAs = (suffix: string, token?: string, body?: unknown) => fetch(`${server.baseUrl}${suffix}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  for (const suffix of ['/api/sessions/app_alice/user-input', '/api/sessions/app_alice/turns/turn_alice/diff']) assert.equal((await fetchAs(suffix)).status, 401);
  assert.equal((await fetchAs('/api/sessions/app_alice/user-input', 'bob')).status, 404);
  assert.equal((await fetchAs('/api/sessions/app_reader/user-input', 'reader')).status, 404);
  assert.equal((await fetchAs('/api/sessions/app_alice/user-input', 'admin')).status, 404);
  assert.equal((await fetchAs('/api/sessions/app_alice/turns/turn_alice/diff', 'bob')).status, 404);
  assert.deepEqual(questionReads, []); assert.deepEqual(diffReads, []);
  const questions = await fetchAs('/api/sessions/app_alice/user-input', 'alice'); assert.equal(questions.status, 200); assert.equal(questions.headers.get('cache-control'), 'no-store');
  const payload = { answerSubmissionId: 'submission', answers: {} };
  assert.equal((await fetchAs('/api/sessions/app_reader/user-input/epoch%3A1/answer', 'reader', payload)).status, 404);
  assert.equal((await fetchAs('/api/sessions/app_bob/user-input/epoch%3A1/answer', 'bob', payload)).status, 409);
  assert.equal((await fetchAs('/api/sessions/app_alice/user-input/epoch%3A1/answer', 'alice', payload)).status, 200);
  assert.equal((await fetchAs('/api/sessions/app_alice/user-input/epoch%3A1/answer', 'alice', payload)).status, 200); assert.equal(sends, 1);
  assert.equal((await fetchAs('/api/sessions/app_bob/user-input/receipts/submission', 'bob')).status, 404);
  const diff = await fetchAs('/api/sessions/app_alice/turns/turn_alice/diff', 'alice'); assert.equal(diff.status, 200); assert.equal((await diff.json()).diff.text, '+private change');
  const readOnlyDiff = await fetchAs('/api/sessions/app_reader/turns/turn_reader/diff', 'reader'); assert.equal(readOnlyDiff.status, 200); assert.equal((await readOnlyDiff.json()).diff, null);
  const cross = await fetchAs('/api/sessions/app_alice/turns/turn_bob/diff', 'alice'); assert.equal(cross.status, 200); assert.equal((await cross.json()).diff, null);
  assert.deepEqual(diffReads, ['thread_alice:turn_alice', 'thread_reader:turn_reader', 'thread_alice:turn_bob']);
});
