import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { CanonicalTimelineStore } from '../src/canonical_timeline.js';
import { CodexWebRuntime } from '../src/runtime.js';

test('accepted user and assistant stream rows hydrate to identical history identities and snapshot versions', async () => {
  let thread: any = { threadId: 'session', cwd: '/tmp', title: 'Test', turns: [], updatedAt: 1 };
  let resolveTurn!: (value: any) => void;
  let callbacks: any;
  const runtime = new CodexWebRuntime({ codexBin: 'codex', defaultCwd: '/tmp', client: {
    listModels: async () => [], readUsage: async () => null,
    listThreads: async () => ({items:[thread],nextCursor:null}),
    readThread: async () => thread, startThread: async () => thread,
    resumeThread: async () => thread, writeConfigValue: async () => {},
    startTurn: async (args: any) => {
      callbacks = args;
      await args.onTurnStarted({threadId:'session',turnId:'turn'});
      return new Promise(resolve => { resolveTurn = resolve; });
    }, steerTurn: async () => ({ turnId: 'turn' }), interruptTurn: async () => {}, respondToApproval: async () => {},
  } as any });
  try {
    await runtime.startTurn('session', { text: 'question', clientMessageId: 'submission-hash' });
    const lagging = await runtime.readSessionTimeline('session');
    assert.equal(lagging?.timeline.filter(item => item.role === 'user').length, 1);
    await callbacks.onProgress({ text: 'answer', delta: 'answer', itemId: 'native-answer', outputKind: 'final_answer', eventType: 'delta' });
    const live = runtime.getTurnEvents('turn').map(entry => entry.event);
    const user = live.find(event => event.type === 'user.message')!;
    const assistant = live.find(event => event.type === 'assistant.delta')!;
    assert.ok(user.timeline);
    assert.ok(assistant.timeline);
    assert.ok(user.timeline!.position < assistant.timeline!.position);
    thread = { ...thread, updatedAt: 2, turns: [{ id: 'turn', status: 'completed', items: [
      { id: 'native-user', type: 'userMessage', role: 'user', text: 'question normalized by provider' },
      { id: 'native-answer', type: 'agentMessage', role: 'assistant', text: 'answer', phase: 'final_answer' },
    ] }] };
    const hydrated = await runtime.readSession('session');
    assert.deepEqual(hydrated!.timeline.map(item => item.id), [user.timeline!.id, assistant.timeline!.id]);
    assert.ok(hydrated!.timeline[0].timeline?.aliases.includes('submission-hash'));
    const projectedUser = runtime.getTurnEventSnapshot('turn').find(entry => entry.event.type === 'user.message')!;
    assert.equal((projectedUser.event as any).text, 'question normalized by provider');
    assert.deepEqual(projectedUser.event.timeline, hydrated!.timeline[0].timeline);
    const projected = runtime.getTurnEventSnapshot('turn').find(entry => entry.event.type === 'assistant.delta')!;
    assert.deepEqual(projected.event.timeline, hydrated!.timeline[1].timeline);
    assert.equal(projected.event.timelineCheckpoint?.revision, hydrated!.timelineCheckpoint?.revision);
    const rawClientId = 'raw-steer-submission';
    const hashedClientId = createHash('sha256').update(rawClientId).digest('hex').slice(0, 24);
    await runtime.steerTurnForThread('session', 'turn', { text: 'follow up', clientMessageId: hashedClientId }, rawClientId);
    const steer = runtime.getTurnEvents('turn').map(entry => entry.event).find(event => event.type === 'user.message' && event.clientMessageId === hashedClientId)!;
    assert.equal((steer as any).itemId, undefined);
    thread = { ...thread, updatedAt: 3, turns: [{ ...thread.turns[0], items: [...thread.turns[0].items,
      { id: 'native-steer', type: 'userMessage', role: 'user', text: 'follow up', raw: { clientId: rawClientId } },
    ] }] };
    const steeredHistory = await runtime.readSessionTimeline('session');
    assert.equal(steeredHistory?.timeline.filter(item => item.text === 'follow up').length, 1);
    assert.equal(steeredHistory?.timeline.find(item => item.text === 'follow up')?.id, steer.timeline?.id);
    resolveTurn({ turnId: 'turn', threadId: 'session', status: 'completed', outputText: 'answer' });
    await new Promise(resolve => setTimeout(resolve, 0));
  } finally { await runtime.stop(); }
});

test('durable write failure after provider acceptance reports uncertainty, never known failure', async () => {
  const original = CanonicalTimelineStore.prototype.upsert;
  const runtime = new CodexWebRuntime({ codexBin: 'codex', defaultCwd: '/tmp', client: {
    listModels: async () => [], readUsage: async () => null,
    listThreads: async () => ({items:[],nextCursor:null}),
    readThread: async () => ({threadId:'s',cwd:'/tmp',title:'T',turns:[]}),
    resumeThread: async () => ({threadId:'s'}), writeConfigValue: async () => {},
    startTurn: async (args: any) => { await args.onTurnStarted({threadId:'s',turnId:'t'}); return {turnId:'t'}; },
  } as any });
  try {
    CanonicalTimelineStore.prototype.upsert = () => { throw new Error('disk full'); };
    await assert.rejects(runtime.startTurn('s', {text:'accepted'}), (error: any) => error.code === 'app_server_response_uncertain');
    assert.equal(runtime.getTurnEvents('t').some(entry => entry.event.type === 'turn.failed'), false);
    assert.equal(runtime.getTurnEvents('t').some(entry => entry.event.type === 'turn.observation_interrupted'), true);
  } finally { CanonicalTimelineStore.prototype.upsert = original; await runtime.stop(); }
});
