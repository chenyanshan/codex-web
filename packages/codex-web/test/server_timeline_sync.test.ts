import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { CanonicalTimelineStore } from '../src/canonical_timeline.js';
import { loadServiceConfig } from '../src/config.js';
import { CodexWebEventBus } from '../src/event_bus.js';
import { createCodexWebServer } from '../src/server.js';
import type { CodexWebTimelineMessage } from '../src/session_timeline_store.js';

const message = (id: string, text = id): CodexWebTimelineMessage => ({
  id, itemId: id, turnId: 'turn', kind: 'message', role: 'assistant',
  label: 'Assistant', meta: 'final', phase: 'final_answer', lifecycle: 'completed', text,
});
const headers = { Authorization: 'Bearer timeline-test' };

async function fixture(t: TestContext) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'timeline-http-'));
  const store = new CanonicalTimelineStore();
  const bus = new CodexWebEventBus({ epoch: 'event-epoch' });
  let snapshot = store.reconcile('session', [message('first'), message('second'), message('third')]);
  const runtime = {
    eventBus: bus,
    listSessions: async () => [],
    readSession: async () => ({ id: 'session', activeTurnId: 'turn', timeline: snapshot.items, timelineCheckpoint: snapshot.checkpoint }),
    threadIdForTurn: (turnId: string) => turnId === 'turn' ? 'session' : null,
    getTimelineCheckpoint: (sessionId: string) => store.checkpoint(sessionId),
    getTurnEvents: (turnId: string, after?: string | number | null) => bus.list(turnId, after),
    getTurnEventReplay: (turnId: string, after?: string | number | null, epoch?: string | null) => bus.replay(turnId, after, epoch),
    getTurnEventSnapshot: (turnId: string) => bus.snapshot(turnId).map(entry => {
      const item = entry.event.timeline ? store.find('session', entry.event.timeline.id) : undefined;
      return item ? { ...entry, event: { ...entry.event, timeline: item.timeline, timelineCheckpoint: store.checkpoint('session') } } : entry;
    }),
    subscribeToTurn: (turnId: string, listener: Parameters<CodexWebEventBus['subscribe']>[1]) => bus.subscribe(turnId, listener),
  };
  const config = loadServiceConfig({ env: { CODEX_WEB_STATE_DIR: stateDir, CODEX_WEB_HOST: '127.0.0.1' }, envPath: path.join(stateDir, 'no.env') });
  config.port = 0;
  const server = createCodexWebServer({
    config, runtime: runtime as any,
    auth: {
      isConfigured: async () => true,
      verifyToken: async token => token === 'timeline-test' ? { id: 'device', deviceName: 'fixture', createdAt: '', lastSeenAt: '' } : null,
      login: async () => { throw new Error('not used'); }, logout: async () => {},
    },
  });
  await server.start();
  t.after(async () => { await server.stop(); store.close(); await rm(stateDir, { recursive: true, force: true }); });
  return {
    server, bus, store, get snapshot() { return snapshot; },
    replace(items: CodexWebTimelineMessage[]) { snapshot = store.reconcile('session', items); return snapshot; },
    get: async (query: string) => {
      const response = await fetch(`${server.baseUrl}/api/sessions/session/timeline?${query}`, { headers });
      assert.equal(response.status, 200); return response.json();
    },
  };
}

test('HTTP history preserves canonical identities and scoped keyset boundaries across append and reset', async t => {
  const f = await fixture(t);
  const latest = await f.get('limit=2');
  assert.deepEqual(latest.items.map((item: any) => item.text), ['second', 'third']);
  assert.deepEqual(latest.timelineCheckpoint, { ...f.snapshot.checkpoint });
  assert.deepEqual(latest.session.timelineCheckpoint, latest.timelineCheckpoint);
  assert.deepEqual(latest.turnSnapshot.timelineCheckpoint, latest.timelineCheckpoint);
  assert.match(latest.nextBefore, /^tl1\./);
  assert.deepEqual(latest.items[0].timeline, f.snapshot.items[1]!.timeline);
  f.replace([message('first'), message('second'), message('third'), message('fourth')]);
  const older = await f.get(`limit=2&before=${encodeURIComponent(latest.nextBefore)}`);
  assert.deepEqual(older.items.map((item: any) => item.text), ['first']);
  assert.equal(older.resetRequired, undefined);
  const anchored = await f.get('limit=1&anchor=second');
  assert.equal(anchored.anchorFound, true);
  assert.equal(anchored.items[0].id, latest.items[0].id);
  f.replace([message('inserted'), message('first'), message('second'), message('third'), message('fourth')]);
  const reset = await f.get(`limit=2&before=${encodeURIComponent(latest.nextBefore)}`);
  assert.equal(reset.resetRequired, true);
  assert.notEqual(reset.timelineCheckpoint.generation, latest.timelineCheckpoint.generation);
  const denied = await fetch(`${f.server.baseUrl}/api/sessions/session/timeline`);
  assert.equal(denied.status, 401);
});

async function nextControl(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<any> {
  const decoder = new TextDecoder();
  let text = '';
  while (!signal.aborted) {
    const next = await reader.read();
    if (next.done) throw new Error('stream ended before control');
    text += decoder.decode(next.value, { stream: true });
    for (const frame of text.split('\n\n').slice(0, -1)) {
      if (frame.startsWith('event: control\n')) return JSON.parse(frame.split('\ndata: ')[1]!);
    }
  }
  throw new Error('control timed out');
}

test('SSE resets an obsolete timeline generation even when its event cursor is already current', async t => {
  const f = await fixture(t);
  const oldGeneration = f.snapshot.checkpoint.generation;
  f.bus.append('turn', { id: 'started', type: 'turn.started', turnId: 'turn', threadId: 'session' });
  const item = f.snapshot.items[2]!;
  const event = f.bus.append('turn', { id: 'answer', type: 'assistant.final', turnId: 'turn', threadId: 'session', itemId: 'third', text: 'third', timeline: item.timeline });
  f.replace([message('inserted'), message('first'), message('second'), message('third')]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${f.server.baseUrl}/api/turns/turn/events?after=${event.sequence}&epoch=event-epoch&timelineGeneration=${oldGeneration}`, { headers, signal: controller.signal });
    assert.equal(response.headers.get('X-Codex-Event-Reset'), 'true');
    const control = await nextControl(response.body!.getReader(), controller.signal);
    assert.equal(control.type, 'stream.reset');
    assert.equal(control.reason, 'timeline_generation_changed');
    assert.deepEqual(control.timelineCheckpoint, { ...f.snapshot.checkpoint });
    assert.deepEqual(control.snapshot.timelineCheckpoint, { ...f.snapshot.checkpoint });
    assert.equal(control.snapshot.events.find((entry: any) => entry.id === 'answer').timeline.generation, f.snapshot.checkpoint.generation);
  } finally { clearTimeout(timer); controller.abort(); }
});

test('an open SSE connection sends a new snapshot before a changed-generation live event', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${f.server.baseUrl}/api/turns/turn/events`, { headers, signal: controller.signal });
    const reader = response.body!.getReader();
    const ready = await nextControl(reader, controller.signal);
    assert.equal(ready.type, 'stream.ready');
    f.replace([message('inserted'), message('first'), message('second'), message('third')]);
    const item = f.snapshot.items[3]!;
    f.bus.append('turn', { id: 'new-answer', type: 'assistant.final', turnId: 'turn', threadId: 'session', itemId: 'third', text: 'third', timeline: item.timeline });
    const reset = await nextControl(reader, controller.signal);
    assert.equal(reset.type, 'stream.reset');
    assert.equal(reset.reason, 'timeline_generation_changed');
    assert.equal(reset.snapshot.events.filter((entry: any) => entry.id === 'new-answer').length, 1);
    assert.equal(reset.timelineCheckpoint.generation, f.snapshot.checkpoint.generation);
  } finally { clearTimeout(timer); controller.abort(); }
});
