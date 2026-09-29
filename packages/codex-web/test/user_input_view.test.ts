import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
async function api(overrides = {}) { const context: any = { ...overrides }; vm.runInNewContext(await fs.readFile(new URL('../public/user-input-view.js', import.meta.url), 'utf8'), context); return context.CodexWebUserInput; }
const request = { requestId: 'request', status: 'pending', questions: [{ id: 'q', isSecret: false }, { id: 'secret', isSecret: true }] };
const answers = { q: { answers: ['A'] }, secret: { answers: ['password'] } };
test('lost answer response recovers receipt using original identity and never repeats POST', async () => {
  const { createDelivery } = await api(); let persisted = ''; const calls: string[] = [];
  const storage = { getItem: () => persisted, setItem: (_k: string, v: string) => { persisted = v; } };
  const apiFetch = async (url: string, options: any = {}) => { calls.push(options.method || 'GET'); if (options.method === 'POST') throw Error('lost response'); return { receipt: { status: 'resolved' } }; };
  const options = { identity: 'alice', sessionId: 'session', storage, apiFetch, randomUUID: () => 'submission' };
  await assert.rejects(createDelivery(options).submit(request, answers, true), /lost/);
  assert.ok(!persisted.includes('password'));
  const restored = createDelivery(options); await restored.submit(request, answers, true);
  assert.deepEqual(calls, ['POST', 'GET']);
  assert.equal(restored.get('request').answerSubmissionId, 'submission');
  assert.equal(createDelivery({ ...options, identity: 'bob' }).get('request').answerSubmissionId, undefined);
});
test('unverified questions and storage failure never POST', async () => {
  const { createDelivery } = await api(); let calls = 0;
  const delivery = createDelivery({ identity: 'alice', sessionId: 'session', storage: { getItem: () => '', setItem: () => { throw Error('quota'); } }, apiFetch: async () => { calls++; }, randomUUID: () => 'id' });
  await assert.rejects(delivery.submit(request, answers, false));
  await assert.rejects(delivery.submit(request, answers, true)); assert.equal(calls, 0);
});

test('LAN HTTP without randomUUID uses getRandomValues for durable submission identity', async () => {
  const { createDelivery } = await api({ crypto: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) } });
  let persisted = '';
  const delivery = createDelivery({ identity: 'alice', sessionId: 'session', storage: { getItem: () => persisted, setItem: (_key: string, value: string) => { persisted = value; } }, apiFetch: async () => ({ receipt: { status: 'delivery_unknown' } }) });
  await delivery.submit(request, answers, true);
  assert.equal(delivery.get('request').answerSubmissionId, '07'.repeat(16));
});

test('real API client encodes answer once and HTTP question route accepts the answer', async t => {
  const { createServer } = await import('node:http');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const { FileUserInputStore } = await import('../src/user_input_store.js');
  const { handleUserInputRoute } = await import('../src/user_input_routes.js');
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'question-client-http-'));
  t.after(() => fs.rm(stateDir, { force: true, recursive: true }));
  const store = new FileUserInputStore({ stateDir }); let sends = 0; let wireBody: unknown;
  const nativeRequest: any = { ...request, threadId: 'thread', turnId: 'turn', itemId: 'item', isBlocking: true, connectionEpoch: 1, autoResolutionMs: null };
  const runtime = { listUserInputRequests: () => [nativeRequest], answerUserInput: async (_thread: string, _request: string, answer: any, beforeSend: () => Promise<void>) => {
    assert.deepEqual(answer.answers, answers); await beforeSend(); sends++;
    return { ...nativeRequest, status: 'delivery_unknown' as const };
  } };
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer auth-token');
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      wireBody = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(typeof wireBody, 'object');
      const result = await handleUserInputRoute({ method: req.method!, path: req.url!.replace('/api/sessions/session', ''), body: wireBody,
        ownerUserId: 'alice', sessionId: 'session', threadId: 'thread', runtime, store });
      res.writeHead(result!.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result!.body));
    } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const port = (server.address() as { port: number }).port;
  const context: any = { AbortController, setTimeout, clearTimeout, fetch: (url: string, options: RequestInit) => fetch(`http://127.0.0.1:${port}${url}`, options) };
  vm.runInNewContext(await fs.readFile(new URL('../public/network-recovery.js', import.meta.url), 'utf8'), context);
  const client = context.CodexWebNetworkRecovery.createApiClient({ state: { token: 'auth-token' }, rename: { capture: () => ({}), reconcile: (value: unknown) => value }, connection: { ticket: () => ({}), succeeded() {}, failed() {} } });
  const { createDelivery } = await api(); let saved = '';
  const delivery = createDelivery({ apiFetch: client.request, identity: 'alice', sessionId: 'session', randomUUID: () => 'answer-http-id', storage: { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } } });
  const result = await delivery.submit(request, answers, true);
  assert.deepEqual(wireBody, { answerSubmissionId: 'answer-http-id', answers });
  assert.equal(result.receipt.status, 'delivery_unknown'); assert.equal(sends, 1);
  assert.equal((await store.read('alice', 'session', 'answer-http-id'))?.status, 'delivery_unknown');
});
