import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function network(overrides = {}) {
  const context: any = { AbortController, setTimeout, clearTimeout, ...overrides };
  vm.runInNewContext(await readFile(new URL('../public/network-recovery.js', import.meta.url), 'utf8'), context);
  return context.CodexWebNetworkRecovery;
}

test('ordinary request deadlines and caller cancellation settle non-cooperative requests', async () => {
  const api = await network();
  let signal: AbortSignal | null = null;
  await assert.rejects(api.bounded((value: AbortSignal) => { signal = value; return new Promise(() => {}); }, { timeoutMs: 5 }), { name: 'TimeoutError' });
  assert.equal(signal!.aborted, true);
  const caller = new AbortController();
  const request = api.bounded(() => new Promise(() => {}), { signal: caller.signal, timeoutMs: 1000 });
  caller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(await api.bounded(async () => 'ready', { timeoutMs: 5 }), 'ready');
});

async function connectionHarness(overrides: Record<string, any> = {}) {
  const api = await network();
  const state = { error: '', pendingTurn: false };
  const connection = api.createConnectionState({
    state, owner: () => 'device', changed() {}, request: async () => ({ ok: true }),
    canCheck: () => true, recover: async () => true, ...overrides,
  });
  return { connection, state };
}

test('connection failures retain HTTP codes across unrelated successes and ignore obsolete successes', async () => {
  const { connection, state } = await connectionHarness();
  const earlier = connection.ticket();
  connection.failed('status', { status: 502, message: 'HTTP 502' }, earlier);
  connection.succeeded('models', connection.ticket());
  connection.succeeded('status', earlier);
  assert.match(connection.label(), /HTTP 502.*Reconnecting/u);
  connection.failed('files', { status: 503 });
  connection.failed('status', { status: 504, message: 'HTTP 504' });
  assert.match(connection.label(), /HTTP 504/u, 'the newest failure wins even when an existing scope is updated');
  state.error = 'HTTP 504';
  connection.succeeded('status', connection.ticket());
  assert.equal(state.error, '');
  assert.match(connection.label(), /HTTP 503/u);
  connection.succeeded('files', connection.ticket());
  assert.equal(connection.label(), '');
  for (const error of [{ name: 'AbortError', message: 'Request cancelled' }, { status: 401 }, { status: 403 }]) connection.failed('status', error);
  assert.equal(connection.label(), '');
});

test('recovery requires a confirmed session and keeps an active stream failure until its handshake succeeds', async () => {
  let confirmed = false;
  const { connection, state } = await connectionHarness({ recover: async () => confirmed });
  state.pendingTurn = true;
  connection.failed('stream', { status: 502, message: 'HTTP 502' });
  connection.failed('status', { status: 502, message: 'HTTP 502' });
  await connection.check();
  assert.match(connection.label(), /HTTP 502/u);
  confirmed = true;
  await connection.check();
  assert.match(connection.label(), /HTTP 502/u, 'an available API does not prove the active stream recovered');
  assert.equal(state.pendingTurn, true);
  connection.succeeded('stream', connection.ticket());
  assert.equal(connection.label(), '');

  connection.failed('stream', { status: 502, message: 'HTTP 502' });
  state.pendingTurn = false;
  await connection.check();
  assert.equal(connection.label(), '', 'an authoritative terminal session no longer needs a stream');
});

test('a verified recovery rejects old failures but preserves new failures arriving during a probe', async () => {
  let resolveHealth!: () => void;
  const { connection } = await connectionHarness({ request: () => new Promise<void>(resolve => { resolveHealth = resolve; }) });
  const stale = connection.ticket();
  connection.failed('status', { status: 502 });
  const recovering = connection.check();
  assert.equal(connection.check(), recovering, 'concurrent checks share one probe');
  connection.failed('files', { status: 503 });
  resolveHealth(); await recovering;
  assert.match(connection.label(), /HTTP 503/u);
  const confirmed = connection.check(); resolveHealth(); await confirmed;
  assert.equal(connection.label(), '');
  connection.failed('status', { status: 502 }, stale);
  assert.equal(connection.label(), '');
  connection.failed('status', { status: 504 }, connection.ticket());
  assert.match(connection.label(), /HTTP 504/u);
});

test('changing accounts isolates failure state and never waits for the old account probe', async () => {
  let owner = 'old';
  const probes: Array<() => void> = [];
  const { connection } = await connectionHarness({ owner: () => owner, request: () => new Promise<void>(resolve => probes.push(resolve)) });
  const oldTicket = connection.ticket();
  connection.failed('status', { status: 502 });
  const oldProbe = connection.check();
  owner = 'new';
  assert.equal(connection.label(), '');
  connection.failed('status', { status: 504 });
  const newProbe = connection.check();
  assert.equal(probes.length, 2);
  probes[0](); await oldProbe;
  assert.match(connection.label(), /HTTP 504/u);
  probes[1](); await newProbe;
  connection.failed('status', { status: 502 }, oldTicket);
  assert.equal(connection.label(), '');
});

test('API transport retains gateway status from HTML and preserves request, auth and rename behavior', async () => {
  let gateway = true;
  const calls: any[] = [];
  const failures: any[] = [];
  const successes: any[] = [];
  const api = await network({ fetch: async (path: string, options: any) => {
    calls.push({ path, ...options });
    return gateway
      ? { ok: false, status: 502, json: async () => { throw new SyntaxError('HTML'); } }
      : { ok: true, status: options.method === 'DELETE' ? 204 : 200, json: async () => ({ name: 'server title' }) };
  } });
  const client = api.createApiClient({ state: { token: 'test-token' },
    rename: { capture: () => 'request-title', reconcile: (payload: any, title: string) => ({ ...payload, title }) },
    connection: { ticket: () => 'ticket', failed: (...args: any[]) => failures.push(args), succeeded: (...args: any[]) => successes.push(args) },
  });
  await assert.rejects(client.request('/api/sessions?limit=10'), { status: 502, message: 'HTTP 502' });
  assert.equal(failures[0][0], 'api:/api/sessions');
  await assert.rejects(client.request('/api/health', { trackConnection: false }), { status: 502 });
  assert.equal(failures.length, 1);
  gateway = false;
  const result = await client.request('/api/sessions', { method: 'POST', body: { name: 'new' } });
  assert.equal(result.title, 'request-title');
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer test-token');
  assert.equal(calls.at(-1).headers['Content-Type'], 'application/json');
  assert.equal(calls.at(-1).body, '{"name":"new"}');
  assert.equal(successes[0][0], 'api:/api/sessions');
  assert.equal(await client.request('/api/session', { method: 'DELETE', skipAuth: true }), null);
  assert.equal(calls.at(-1).headers.Authorization, undefined);
});

test('SSE recovery uses HTTP status independently of gateway response bodies and rejects permission failures', async () => {
  const api = await network();
  for (const status of [408, 425, 429, 500, 502, 503, 504]) assert.equal(api.retryable({ status, message: '<html>Gateway failure</html>' }), true);
  for (const status of [400, 401, 403, 404, 409, 501, 505]) assert.equal(api.retryable({ status, message: 'network error' }), false);
});

test('compact history/status arrive independently and confirmed status beats a late timeline snapshot', async () => {
  const context: any = { AbortController };
  vm.runInNewContext(await readFile(new URL('../public/session-loader.js', import.meta.url), 'utf8'), context);
  for (const first of ['status', 'timeline']) {
    const resolve: Record<string, (value: unknown) => void> = {};
    const stages: any[] = [];
    const load = context.CodexWebSessionLoader.createLoader({
      state: { timelineCache: new Map() }, apiFetch: (path: string) => new Promise((done) => { resolve[path.includes('/status') ? 'status' : 'timeline'] = done; }),
      isFatalSessionOpenError: () => false, timelinesHaveStableOverlap: () => false, dedupeTimelineProjectionEntries: (items: unknown[]) => items,
    });
    const loading = load({ id: 'one' }, { onProgress: (payload: unknown) => stages.push(payload) });
    const payloads = {
      status: { session: { id: 'one', activeTurnId: 'active', activityState: 'running' } },
      timeline: { session: { id: 'one', activeTurnId: null, activityState: 'idle' }, items: [{ id: 'message', text: 'Already here' }], hasMore: false },
    };
    resolve[first](payloads[first]);
    await new Promise((done) => setImmediate(done));
    assert.equal(stages.length, 1);
    assert.equal(stages[0].statusError, ''); assert.equal(stages[0].historyError, '');
    assert.equal(stages[0].statusPending, first === 'timeline');
    assert.equal(stages[0].historyPending, first === 'status');
    resolve[first === 'status' ? 'timeline' : 'status'](payloads[first === 'status' ? 'timeline' : 'status']);
    const result = await loading;
    assert.equal(result.session.activeTurnId, 'active');
    assert.equal(result.session.timeline[0].text, 'Already here');
    assert.equal(stages.length, 2);
  }
});

test('execution summaries prefer freshness and otherwise retain an active turn from either compact source', async () => {
  const context: any = { AbortController };
  vm.runInNewContext(await readFile(new URL('../public/session-loader.js', import.meta.url), 'utf8'), context);
  const active = { activeTurnId: 'running', activityState: 'running' };
  const idle = { activeTurnId: null, activityState: 'idle' };
  for (const [status, timeline, expected] of [
    [active, idle, 'running'], [idle, active, 'running'],
    [{ ...active, updatedAt: 2 }, { ...idle, updatedAt: 1 }, 'running'],
    [{ ...idle, updatedAt: 1 }, { ...active, updatedAt: 2 }, 'running'],
    [{ ...idle, lastBusinessActivityAt: 3 }, { ...active, lastBusinessActivityAt: 2 }, null],
    [{ ...active, updatedAt: 2 }, { ...idle, updatedAt: 3 }, null],
  ] as const) {
    const load = context.CodexWebSessionLoader.createLoader({ state: { timelineCache: new Map() },
      apiFetch: async (path: string) => path.includes('/status') ? { session: { id: 'one', ...status }, turnSnapshot: { turnId: 'wrong' } } : { session: { id: 'one', ...timeline }, items: [], turnSnapshot: { turnId: 'running' } },
      isFatalSessionOpenError: () => false, timelinesHaveStableOverlap: () => false, dedupeTimelineProjectionEntries: (items: unknown[]) => items });
    const result = await load({ id: 'one' });
    assert.equal(result.session.activeTurnId, expected);
    assert.equal(result.turnSnapshot?.turnId || null, expected);
  }
});

test('late models fill untouched defaults while preserving explicit draft reasoning and permissions', async () => {
  const api = await network();
  for (const edited of [false, true]) {
    const state: any = { token: 'owner', sessionId: null, model: 'fallback', reasoningEffort: 'ultra', permissionPreset: 'full-access', draftSettingsEdited: {} };
    let deliver!: (value: any) => void;
    const request = new Promise((resolve) => { deliver = resolve; });
    const recovery = api.createAuthRecovery({ state, getGeneration: () => 1, isAuthRequestCurrent: () => true, render() {},
      initializeDefaultThreadSettingsFromCodex: (defaults: any) => { state.defaults = defaults; },
      applyDefaultSettings: () => { state.model = state.defaults.model; state.reasoningEffort = state.defaults.reasoningEffort; state.permissionPreset = 'full-access'; },
    });
    const loading = recovery.loadModels(request);
    if (edited) {
      state.reasoningEffort = 'low'; state.permissionPreset = 'read-only';
      state.draftSettingsEdited = { reasoningEffort: true, permissionPreset: true };
    }
    deliver({ items: [], defaults: { model: 'new-default-model', reasoningEffort: 'high' } });
    await loading;
    assert.equal(state.model, 'new-default-model');
    assert.equal(state.reasoningEffort, edited ? 'low' : 'high');
    assert.equal(state.permissionPreset, edited ? 'read-only' : 'full-access');
  }
});
