import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnActivityProjection } from '../src/app_server/activity.js';
import { UserInputRequests } from '../src/app_server/user_input.js';
import { CodexAppClient } from '../src/codex_app_client.js';
const params = { threadId: 'thread', turnId: 'turn' };
test('retry health survives collab progress, clears on parent progress, ignores late errors after terminal', () => {
  const activity = new TurnActivityProjection();
  const observe = (method: string, extra = {}) => activity.observe({ method, params: { ...params, ...extra } }, 10);
  observe('error', { willRetry: true, error: { message: 'HTTP 524 token=private' } });
  const retried = observe('error', { willRetry: true, error: { message: 'HTTP 429' } });
  assert.equal(retried?.health.observedRetryCount, 2);
  assert.equal(observe('item/started', { item: { id: 'agent', type: 'collabAgentToolCall', agentsStates: { child: { status: 'errored', message: 'Failed' } } } })?.health.status, 'retrying');
  assert.equal(observe('item/agentMessage/delta', { delta: 'ok' })?.health.status, 'working');
  observe('turn/completed', { turn: { id: 'turn', status: 'completed' } });
  assert.equal(observe('error', { willRetry: true }), null);
  assert.equal(activity.get('thread')?.agents[0]?.status, 'errored');
});
test('metadata is not progress; duplicate plans deduplicate; compaction and token usage preserve semantics', () => {
  const activity = new TurnActivityProjection();
  const plan = { method: 'turn/plan/updated', params: { ...params, plan: [{ step: 'first', status: 'inProgress' }] } };
  assert.equal(activity.observe(plan, 1)?.lastProgressAt, null);
  assert.equal(activity.observe(plan, 2), null);
  assert.equal(activity.observe({ method: 'item/started', params: { ...params, item: { id: 'compact', type: 'contextCompaction' } } }, 3)?.compaction, 'running');
  const snapshot = activity.observe({ method: 'thread/tokenUsage/updated', params: { ...params, tokenUsage: { total: { totalTokens: 999 }, last: { totalTokens: 50 }, modelContextWindow: 1000 } } }, 4);
  assert.equal(snapshot?.tokenUsage?.total.totalTokens, 999);
  assert.equal(snapshot?.tokenUsage?.last.totalTokens, 50);
  assert.equal(snapshot?.lastProgressAt, 3);
  assert.equal(activity.disconnect()[0]?.observation, 'disconnected');
});
test('large details remain bounded, diff content never enters activity events', () => {
  const activity = new TurnActivityProjection();
  const diff = 'x'.repeat(500_000);
  const snap = activity.observe({ method: 'turn/diff/updated', params: { ...params, diff } });
  assert.equal(snap?.diff.truncated, true);
  assert.ok(JSON.stringify(snap).length < 2000);
  assert.ok(Buffer.byteLength(activity.getDiff('thread', 'turn')!.text) <= 128 * 1024);
  for (let i = 0; i < 30; i++) activity.observe({ method: 'item/started', params: { ...params, item: { id: `tool${i}`, type: 'mcpToolCall', tool: 'y'.repeat(10000) } } });
  assert.ok(Buffer.byteLength(JSON.stringify(activity.get('thread'))) <= 32 * 1024);
});
const request = (id: string | number = 1) => ({ id, params: { ...params, itemId: 'item', isBlocking: false, autoResolutionMs: null,
  questions: [{ id: 'q', header: 'Choice', question: 'Which?', isOther: true, isSecret: false, options: [{ label: 'A', description: 'First' }] }] } });
const answer = { answers: { q: { answers: ['A'] } } };
test('answers persist before single send, remain unknown until matching official resolution', async () => {
  const events: string[] = [];
  const inputs = new UserInputRequests('connection', (r) => events.push(r.status));
  const q = inputs.receive(request(), 2);
  const result = await inputs.answer(q.requestId, answer, () => 2, () => true, () => events.push('send'), async () => { events.push('persist'); });
  assert.equal(result.status, 'delivery_unknown');
  assert.deepEqual(events, ['pending', 'persist', 'delivery_unknown', 'send']);
  await assert.rejects(inputs.answer(q.requestId, answer, () => 2, () => true, () => {}, async () => {}));
  inputs.resolve({ threadId: 'wrong', requestId: 1 }, 2);
  assert.equal(inputs.list()[0].status, 'delivery_unknown');
  inputs.resolve({ threadId: 'thread', requestId: 1 }, 2);
  assert.equal(inputs.list()[0].status, 'resolved');
});
test('storage failure prevents writes; racing devices and epoch changes cannot replay', async () => {
  const inputs = new UserInputRequests('connection', () => {});
  const q = inputs.receive(request(), 1); let writes = 0;
  await assert.rejects(inputs.answer(q.requestId, answer, () => 1, () => true, () => writes++, async () => { throw Error('disk'); }));
  assert.equal(inputs.list()[0].status, 'pending');
  let finish!: () => void; let epoch = 1;
  const first = inputs.answer(q.requestId, answer, () => epoch, () => true, () => writes++, () => new Promise<void>(resolve => { finish = resolve; }));
  await assert.rejects(inputs.answer(q.requestId, answer, () => 1, () => true, () => writes++, async () => {}));
  epoch = 2; finish();
  assert.equal((await first).status, 'expired'); assert.equal(writes, 0);
  assert.notEqual(inputs.receive(request(), 2).requestId, q.requestId);
});
test('socket failure is unknown and disconnect expires only unanswered requests', async () => {
  const inputs = new UserInputRequests('connection', () => {});
  const q = inputs.receive(request(), 1);
  assert.equal((await inputs.answer(q.requestId, answer, () => 1, () => true, () => { throw Error('closed'); }, async () => {})).status, 'delivery_unknown');
  inputs.receive(request(2), 1); inputs.disconnect();
  assert.deepEqual(inputs.list().map(q => q.status), ['delivery_unknown', 'expired']);
});
test('facade routes official request and resolved notification without treating them as approval', () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  client.handleMessage(JSON.stringify({ ...request(), method: 'item/tool/requestUserInput' }));
  assert.equal(client.listUserInputRequests('thread')[0].isBlocking, false);
  client.handleMessage(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 1 } }));
  assert.equal(client.listUserInputRequests()[0].status, 'resolved');
});
test('official read snapshots reconstruct tool state without inventing progress or clearing retry', () => {
  const activity = new TurnActivityProjection();
  const thread = { id: 'thread', turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'cmd', type: 'commandExecution', command: 'sleep 30', status: 'inProgress' }] }] };
  assert.equal(activity.hydrate(thread, activity.revisions(), 1)?.lastProgressAt, null);
  activity.observe({ method: 'error', params: { ...params, willRetry: true, error: { message: '429' } } }, 2);
  const before = activity.revisions();
  activity.hydrate(thread, before, 3);
  assert.equal(activity.get('thread')?.health.status, 'retrying');
  assert.equal(activity.get('thread')?.lastProgressAt, null);
  activity.observe({ method: 'item/agentMessage/delta', params: { ...params, delta: 'new' } }, 4);
  assert.equal(activity.hydrate(thread, before, 5), null);
  assert.equal(activity.get('thread')?.lastProgressAt, 4);
});
test('token deltas retain progress evidence but emit at most once per five seconds', () => {
  const activity = new TurnActivityProjection();
  const delta = { method: 'item/agentMessage/delta', params: { ...params, delta: 'x' } };
  assert.ok(activity.observe(delta, 1000));
  assert.equal(activity.observe(delta, 1001), null);
  assert.equal(activity.observe(delta, 5999), null);
  assert.equal(activity.get('thread')?.lastProgressAt, 5999);
  assert.ok(activity.observe(delta, 6000));
  activity.observe({ method: 'error', params: { ...params, willRetry: true } }, 6001);
  assert.equal(activity.observe(delta, 6002)?.health.status, 'working');
});

test('agent assignments retain prompts through status-only updates and bounded hydration', () => {
  const projection = new TurnActivityProjection();
  const spawn = { id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['child'], prompt: '检查手机端活动窗口\n保留输入焦点 token=private', agentsStates: { child: { status: 'running' } } };
  const observe = (item: any) => projection.observe({ method: 'item/completed', params: { ...params, item } });
  observe(spawn);
  observe({ id: 'wait', type: 'collabAgentToolCall', tool: 'wait', receiverThreadIds: ['child'], prompt: null, agentsStates: { child: { status: 'completed', message: 'Checks passed' } } });
  assert.match(projection.get('thread')!.agents[0]!.prompt!, /检查手机端活动窗口/);
  assert.doesNotMatch(projection.get('thread')!.agents[0]!.prompt!, /private/);
  assert.equal(projection.get('thread')!.agents[0]!.status, 'completed');
  observe({ id: 'state', type: 'subAgentActivity', agentThreadId: 'child', kind: 'update' });
  assert.match(projection.get('thread')!.agents[0]!.prompt!, /保留输入焦点/);
  const thread = { id: 'thread', turns: [{ id: 'turn', status: 'inProgress', items: [spawn, ...Array.from({length: 30}, (_, i) => ({id: `command-${i}`, type: 'commandExecution', command: 'test', status: 'completed'}))] }] };
  const hydrated = new TurnActivityProjection().hydrate(thread, new Map());
  assert.match(hydrated!.agents[0]!.prompt!, /检查手机端活动窗口/);
  for (let i = 0; i < 30; i++) observe({ ...spawn, receiverThreadIds: [`child-${i}`], prompt: '任务'.repeat(5000) });
  assert.ok(Buffer.byteLength(JSON.stringify(projection.get('thread'))) <= 32 * 1024);
  assert.ok(projection.get('thread')!.agents.length <= 20);
});
