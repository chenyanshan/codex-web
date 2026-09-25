import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexAppClient } from '../src/codex_app_client.js';
import { AppServerObservationInterruptedError } from '../src/app_server/transport.js';

function connectedClient() {
  const client = new CodexAppClient({ codexCliBin: '/fixture/codex' });
  const sent: any[] = [];
  client.connected = true;
  client.socket = { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) } as any;
  return { client, sent };
}
test('lost mutation response times out once and never replays', async () => {
  const { client, sent } = connectedClient();
  await assert.rejects(client.request('turn/interrupt', { threadId: 't', turnId: 'u' }, { timeoutMs: 5 }), { code: 'app_server_response_uncertain' });
  assert.equal(sent.length, 1);
  assert.equal(client.pending.size, 0);
  client.handleMessage(JSON.stringify({ id: sent[0].id, result: {} }));
  assert.equal(sent.length, 1);
});
test('disconnect rejects and cleans all pending requests without replay', async () => {
  const { client, sent } = connectedClient();
  const pending = client.request('turn/interrupt', { threadId: 't', turnId: 'u' });
  client.rejectPending(new AppServerObservationInterruptedError('connection closed'));
  await assert.rejects(pending, { code: 'app_server_response_uncertain' });
  assert.equal(client.pending.size, 0);
  assert.equal(sent.length, 1);
});
test('unknown server requests are explicitly rejected and extensions are tolerated', () => {
  const { client, sent } = connectedClient();
  let notifications = 0;
  client.on('notification', () => notifications++);
  for (const raw of ['null', '[]', '1', '{', '{"method":1}']) assert.doesNotThrow(() => client.handleMessage(raw));
  client.handleMessage(JSON.stringify({ id: 42, method: 'future/approval', params: { additional: true } }));
  assert.deepEqual(sent, [{ jsonrpc: '2.0', id: 42, error: { code: -32601, message: 'Unsupported server request: future/approval' } }]);
  assert.equal(client.pendingApprovals.size, 0);
  client.handleMessage(JSON.stringify({ method: 'future/optional', params: { additional: true } }));
  assert.equal(notifications, 1);
});
test('official no-text completion is successful without rollout access or another read', async () => {
  const { client } = connectedClient();
  client.initializedServer = { userAgent: 'codex/0.156.1', binary: '/fixture/codex', initializedAt: 1 };
  let reads = 0;
  client.readThread = async () => {
    reads++;
    client.emit('notification', { method: 'turn/completed', params: { threadId: 't', turn: { id: 'u', status: 'completed', items: [] } } });
    return null;
  };
  const result = await client.waitForTurnResult({ threadId: 't', turnId: 'u', timeoutMs: 100 });
  assert.equal(result.status, 'completed');
  assert.equal(result.outputState, 'complete');
  assert.equal(result.outputText, '');
  assert.equal(result.finalSource, 'official_turn_completed');
  assert.equal(reads, 1);
});
test('official completion wakes an idle observer before the next reconciliation', async () => {
  const { client } = connectedClient();
  client.readThread = async () => ({ threadId: 't', turns: [{ id: 'u', status: 'inProgress', items: [] }] } as any);
  const resultPromise = client.waitForTurnResult({ threadId: 't', turnId: 'u', timeoutMs: 30000 });
  setTimeout(() => client.emit('notification', { method: 'turn/completed', params: { threadId: 't', turn: { id: 'u', status: 'interrupted', items: [] } } }), 5);
  const result = await resultPromise;
  assert.equal(result.status, 'interrupted');
  assert.equal(client.listenerCount('observation_interrupted'), 0);
});
test('observation loss remains uncertain rather than claiming execution failed', async () => {
  const { client } = connectedClient();
  client.readThread = async () => {
    client.emit('observation_interrupted', new AppServerObservationInterruptedError('offline'));
    return null;
  };
  await assert.rejects(client.waitForTurnResult({ threadId: 't', turnId: 'u', timeoutMs: 100 }), { code: 'app_server_observation_interrupted' });
});
test('official item projection preserves Responses messages, tool results and summary-only reasoning', async () => {
  const { client } = connectedClient();
  client.initializedServer = { userAgent: 'codex/0.156.1', binary: '/fixture/codex', initializedAt: 1 };
  client.readThread = async () => {
    client.emit('notification', { method: 'turn/completed', params: { threadId: 't', turn: { id: 'u', status: 'completed', items: [
      { id: 'r', type: 'reasoning', summary: ['Summary'], content: ['hidden private reasoning'] },
      { id: 'c', type: 'commandExecution', command: 'printf ok', cwd: '/fixture', status: 'completed', aggregatedOutput: 'ok', exitCode: 0 },
      { id: 'm', type: 'agentMessage', phase: 'final_answer', text: 'Done' },
    ] } } });
    return null;
  };
  const result = await client.waitForTurnResult({ threadId: 't', turnId: 'u', timeoutMs: 100 });
  assert.deepEqual(result.responseItems?.map((item) => item.type), ['reasoning', 'function_call', 'function_call_output', 'message']);
  assert.deepEqual(result.responseItems?.[0], { id: 'r', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Summary' }] });
  assert.equal(result.responseItems?.[1]?.call_id, 'c');
  assert.match(String(result.responseItems?.[2]?.output), /ok/);
  assert.equal(result.outputText, 'Done');
  assert.ok(!JSON.stringify(result.responseItems).includes('hidden private reasoning'));
});
test('a failed approval write becomes uncertain and cannot be blindly resubmitted', async () => {
  const { client } = connectedClient();
  client.handleMessage(JSON.stringify({ id: 41, method: 'item/commandExecution/requestApproval', params: { threadId: 't', turnId: 'u', itemId: 'c', command: 'true', cwd: '/fixture' } }));
  client.send = () => { throw new Error('write lost'); };
  await assert.rejects(client.respondToApproval({ requestId: '41', option: 1 }), { code: 'app_server_response_uncertain' });
  await assert.rejects(client.respondToApproval({ requestId: '41', option: 1 }), /Unknown approval/);
});
test('concurrent start waits for initialization even after socket opens', async () => {
  const client = new CodexAppClient({ codexCliBin: '/fixture/codex' });
  let release!: () => void;
  let starts = 0;
  client.startServer = async () => { starts++; client.connected = true; await new Promise<void>((resolve) => { release = resolve; }); };
  const first = client.start();
  let secondDone = false;
  const second = client.start().then(() => { secondDone = true; });
  await Promise.resolve();
  assert.equal(secondDone, false);
  release();
  await Promise.all([first, second]);
  assert.equal(starts, 1);
});
test('closed connection invalidates connection-local approvals and requests', async () => {
  const ws = new EventTarget() as EventTarget & { close(): void; send(raw: string): void; readyState: number };
  ws.close = () => {}; ws.send = () => {}; ws.readyState = 1;
  const client = new CodexAppClient({ codexCliBin: '/fixture/codex', webSocketFactory: () => { queueMicrotask(() => ws.dispatchEvent(new Event('open'))); return ws as any; } });
  await client.connectWebSocket();
  client.handleMessage(JSON.stringify({ id: 41, method: 'item/commandExecution/requestApproval', params: { threadId: 't', turnId: 'u', itemId: 'c', command: 'true' } }));
  const request = client.request('turn/interrupt', { threadId: 't', turnId: 'u' });
  ws.dispatchEvent(new Event('close'));
  await assert.rejects(request, { code: 'app_server_response_uncertain' });
  assert.equal(client.pendingApprovals.size, 0);
  assert.equal(client.connected, false);
});
test('sanitized official fixture preserves items when completion omits them and rejects late regression', async () => {
  const { readFile } = await import('node:fs/promises');
  const { TurnObserver } = await import('../src/app_server/turn_observer.js');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/app_server/0.156.1-official-turn.json', import.meta.url), 'utf8'));
  const observer = new TurnObserver('fixture-thread', 'fixture-turn');
  for (const event of fixture.events) observer.accept(event);
  observer.accept({ method: 'turn/completed', params: { threadId: 'fixture-thread', turn: { id: 'fixture-turn', status: 'interrupted', items: [] } } });
  assert.equal(observer.terminal?.status, 'completed');
  assert.deepEqual(observer.terminal?.items.map((item) => item.id), ['fixture-command', 'fixture-message']);
});
test('official event item retention remains bounded by count and bytes', async () => {
  const { TurnObserver } = await import('../src/app_server/turn_observer.js');
  const observer = new TurnObserver('t', 'u');
  observer.accept({ method: 'item/completed', params: { threadId: 't', turnId: 'u', item: { id: 'oversized', type: 'agentMessage', text: 'x'.repeat(2 * 1024 * 1024 + 1) } } });
  for (let index = 0; index < 600; index++) observer.accept({ method: 'item/completed', params: { threadId: 't', turnId: 'u', item: { id: String(index), type: 'agentMessage', text: 'same text' } } });
  observer.accept({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'u', status: 'completed', items: [] } } });
  assert.equal(observer.terminal?.items.length, 512);
  assert.equal(observer.terminal?.items.some((item) => item.id === 'oversized'), false);
});
test('thread title uses the official name API after creating the thread', async () => {
  const { client } = connectedClient();
  const methods: string[] = [];
  client.request = async (method, params) => {
    methods.push(method);
    if (method === 'thread/start') { assert.equal('title' in (params as object), false); return { thread: { id: 't', name: null } } as any; }
    assert.deepEqual(params, { threadId: 't', name: 'Example' });
    return {} as any;
  };
  const result = await client.startThread({ title: 'Example' });
  assert.equal(result.title, 'Example');
  assert.deepEqual(methods, ['thread/start', 'thread/name/set']);
});
test('official retriable errors do not terminate a turn based on their text', async () => {
  const { client } = connectedClient();
  client.readThread = async () => {
    client.emit('notification', { method: 'error', params: { threadId: 't', turnId: 'u', willRetry: true, error: { message: 'provider unavailable' } } });
    client.emit('notification', { method: 'turn/completed', params: { threadId: 't', turn: { id: 'u', status: 'completed', items: [] } } });
    return null;
  };
  assert.equal((await client.waitForTurnResult({ threadId: 't', turnId: 'u', timeoutMs: 100 })).status, 'completed');
});
test('approval public IDs cannot target reused wire IDs after reconnect', async () => {
  const sockets: Array<EventTarget & { close(): void; send(raw: string): void; readyState: number }> = [];
  const sent: any[] = [];
  const client = new CodexAppClient({ codexCliBin: '/fixture/codex', webSocketFactory: () => {
    const ws = new EventTarget() as typeof sockets[number];
    ws.close = () => {}; ws.send = (raw) => sent.push(JSON.parse(raw)); ws.readyState = 1;
    sockets.push(ws); queueMicrotask(() => ws.dispatchEvent(new Event('open'))); return ws as any;
  } });
  const approval = { id: 41, method: 'item/commandExecution/requestApproval', params: { threadId: 't', turnId: 'u', itemId: 'c', command: 'true' } };
  await client.connectWebSocket();
  client.handleMessage(JSON.stringify(approval));
  const oldId = client.getPendingApprovals()[0].requestId;
  sockets[0].dispatchEvent(new Event('close'));
  await client.connectWebSocket();
  client.handleMessage(JSON.stringify(approval));
  const newId = client.getPendingApprovals()[0].requestId;
  assert.notEqual(oldId, newId);
  await assert.rejects(client.respondToApproval({ requestId: oldId, option: 1 }), /Unknown approval/);
  assert.equal(sent.length, 0);
  await client.respondToApproval({ requestId: newId, option: 1 });
  assert.equal(sent[0].id, 41);
  assert.equal(client.pendingApprovals.size, 0);
});
test('modern transient snapshot failures stop after bounded reconciliation without claiming failure', async () => {
  const client = new CodexAppClient({ codexCliBin: '/fixture/codex', turnPollSleep: async () => {} });
  client.initializedServer = { userAgent: 'codex/0.156.1', binary: '/fixture/codex', initializedAt: 1 };
  let reads = 0;
  client.readThread = async () => { reads++; throw new Error('Timed out waiting for Codex JSON-RPC response to thread/read'); };
  await assert.rejects(client.waitForTurnResult({ threadId: 't', turnId: 'u', timeoutMs: 100000 }), { code: 'app_server_observation_interrupted' });
  assert.equal(reads, 3);
});
test('stop during startup cannot leave a late owned app-server process', async () => {
  let spawned = false;
  const client = new CodexAppClient({ codexCliBin: '/fixture/codex', spawnImpl: (() => { spawned = true; throw new Error('must not spawn after stop'); }) as any });
  const starting = client.start();
  await client.stop();
  await assert.rejects(starting, { code: 'app_server_observation_interrupted' });
  assert.equal(spawned, false);
  assert.equal(client.child, null);
});
