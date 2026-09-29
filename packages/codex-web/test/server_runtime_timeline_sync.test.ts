import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadServiceConfig } from '../src/config.js';
import { CodexWebEventBus } from '../src/event_bus.js';
import { CodexWebRuntime } from '../src/runtime.js';
import { createCodexWebServer } from '../src/server.js';

test('authenticated submission, native hydration and server restart preserve canonical HTTP timeline identities', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'runtime-http-timeline-'));
  const headers = { Authorization: 'Bearer runtime-timeline-test' };
  const submissionId = 'submitted-before-restart';
  const clientMessageId = createHash('sha256').update(submissionId).digest('hex').slice(0, 24);
  let thread: any = { threadId: 'session', cwd: stateDir, title: 'Test', turns: [], updatedAt: 1 };
  let callbacks: any;
  let resolveTurn!: (value: any) => void;
  let startCount = 0;
  const provider = {
    listModels: async () => [], readUsage: async () => null,
    listThreads: async () => ({ items: [thread], nextCursor: null }),
    readThread: async () => thread, startThread: async () => thread,
    resumeThread: async () => thread, writeConfigValue: async () => {},
    startTurn: async (args: any) => {
      startCount++;
      callbacks = args;
      await args.onTurnStarted({ threadId: 'session', turnId: 'turn' });
      return new Promise(resolve => { resolveTurn = resolve; });
    },
    interruptTurn: async () => {}, respondToApproval: async () => {},
  };
  const config = loadServiceConfig({
    env: { CODEX_WEB_STATE_DIR: stateDir, CODEX_WEB_HOST: '127.0.0.1' },
    envPath: path.join(stateDir, 'no.env'),
  });
  config.port = 0;
  const createPair = (epoch: string) => {
    const runtime = new CodexWebRuntime({
      codexBin: 'unused-codex', defaultCwd: stateDir, client: provider as any,
      eventBus: new CodexWebEventBus({ epoch }),
      canonicalTimelinePath: path.join(stateDir, 'canonical.sqlite'),
    });
    const server = createCodexWebServer({ config, runtime, auth: {
      isConfigured: async () => true,
      verifyToken: async token => token === 'runtime-timeline-test'
        ? { id: 'device', deviceName: 'fixture', createdAt: '', lastSeenAt: '' } : null,
      login: async () => { throw new Error('not used'); }, logout: async () => {},
    } });
    return { runtime, server };
  };
  let pair = createPair('before-restart');
  const getHistory = async () => {
    const response = await fetch(`${pair.server.baseUrl}/api/sessions/session/timeline?limit=20`, { headers });
    assert.equal(response.status, 200);
    return response.json() as Promise<any>;
  };
  const getReceipt = async () => {
    const response = await fetch(`${pair.server.baseUrl}/api/session-submissions/${submissionId}`, { headers });
    assert.equal(response.status, 200);
    return response.json() as Promise<any>;
  };
  try {
    await pair.server.start();
    const submit = () => fetch(`${pair.server.baseUrl}/api/sessions/session/turns`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId, text: 'question' }),
    });
    const accepted = await submit();
    assert.equal(accepted.status, 202);
    const acceptance: any = await accepted.json();
    assert.equal(acceptance.turnId, 'turn');
    assert.equal(acceptance.submission.clientMessageId, clientMessageId);
    assert.equal((await getReceipt()).submission.clientMessageId, clientMessageId);
    assert.equal((await submit()).status, 200);
    assert.equal(startCount, 1);

    await callbacks.onProgress({ text: 'answer', delta: 'answer', itemId: 'native-answer', outputKind: 'final_answer', eventType: 'delta' });
    const events = pair.runtime.getTurnEvents('turn');
    const user = events.find(entry => entry.event.type === 'user.message')!.event;
    const assistant = events.find(entry => entry.event.type === 'assistant.delta')!.event;
    assert.equal((user as any).clientMessageId, clientMessageId);
    assert.ok(user.timeline);
    assert.ok(assistant.timeline);
    assert.ok(user.timeline.position < assistant.timeline.position);
    const expectedIds = [user.timeline.id, assistant.timeline.id];

    thread = { ...thread, updatedAt: 2, turns: [{ id: 'turn', status: 'completed', items: [
      { id: 'native-user', type: 'userMessage', role: 'user', text: 'question normalized by provider' },
      { id: 'native-answer', type: 'agentMessage', role: 'assistant', text: 'answer', phase: 'final_answer' },
    ] }] };
    const hydrated = await getHistory();
    assert.deepEqual(hydrated.items.map((item: any) => item.id), expectedIds);
    assert.deepEqual(hydrated.items.map((item: any) => item.role), ['user', 'assistant']);
    assert.equal(hydrated.items[0].text, 'question normalized by provider');
    assert.ok(hydrated.items[0].timeline.aliases.includes(clientMessageId));
    resolveTurn({ turnId: 'turn', threadId: 'session', status: 'completed', outputText: 'answer' });
    await new Promise(resolve => setTimeout(resolve, 0));
    const beforeRestart = await getHistory();
    const oldCursor = pair.runtime.getTurnEvents('turn').at(-1)!.sequence;
    await pair.server.stop();
    await pair.runtime.stop();

    pair = createPair('after-restart');
    await pair.server.start();
    const restored = await getHistory();
    assert.deepEqual(restored.items.map((item: any) => item.id), expectedIds);
    assert.deepEqual(restored.items.map((item: any) => item.timeline), beforeRestart.items.map((item: any) => item.timeline));
    assert.deepEqual(restored.timelineCheckpoint, beforeRestart.timelineCheckpoint);
    assert.equal((await getReceipt()).submission.clientMessageId, clientMessageId);
    assert.equal(startCount, 1);
    for (const route of ['/api/sessions/session/timeline', '/api/turns/turn/events', `/api/session-submissions/${submissionId}`]) {
      assert.equal((await fetch(`${pair.server.baseUrl}${route}`)).status, 401);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${pair.server.baseUrl}/api/turns/turn/events?after=${oldCursor}&epoch=before-restart&timelineGeneration=${restored.timelineCheckpoint.generation}`, { headers, signal: controller.signal });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('X-Codex-Event-Reset'), 'true');
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let control: any;
      while (!control) {
        const next = await reader.read();
        assert.equal(next.done, false, 'SSE must deliver a reset control');
        buffer += decoder.decode(next.value, { stream: true });
        const frame = buffer.split('\n\n').slice(0, -1).find(frame => frame.startsWith('event: control\n'));
        if (frame) control = JSON.parse(frame.split('\ndata: ')[1]!);
      }
      assert.equal(control.type, 'stream.reset');
      assert.equal(control.reason, 'epoch_mismatch');
      assert.equal(control.epoch, 'after-restart');
      assert.deepEqual(control.timelineCheckpoint, restored.timelineCheckpoint);
      assert.deepEqual(control.snapshot.timelineCheckpoint, restored.timelineCheckpoint);
    } finally { clearTimeout(timer); controller.abort(); }
  } finally {
    await pair.server.stop();
    await pair.runtime.stop();
    await rm(stateDir, { recursive: true, force: true });
  }
});
