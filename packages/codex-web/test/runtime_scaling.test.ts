import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexWebRuntime, type CodexWebRuntimeClient } from '../src/runtime.js';
import { SessionDirectory } from '../src/session_directory.js';

const thread = (id: string) => ({ threadId: id, cwd: '/project', title: id, updatedAt: 1, preview: id, turns: [] });
const client = (patch: Partial<CodexWebRuntimeClient>): CodexWebRuntimeClient => ({
  listModels: async () => [], readUsage: async () => null,
  listThreads: async () => ({ items: [], nextCursor: null }),
  readThread: async () => null,
  startThread: async () => ({ threadId: 'new' }),
  ...patch,
} as CodexWebRuntimeClient);

test('compatibility fallback scans empty intermediate pages and archived pages and coalesces readers', async () => {
  const calls: string[] = [];
  const runtime = new CodexWebRuntime({ defaultCwd: '/project', client: client({
    readThread: async () => { throw new Error('list_turns is not supported yet'); },
    listThreads: async ({ archived, cursor } = {}) => {
      calls.push(`${archived}:${cursor ?? ''}`);
      if (!archived) return { items: [], nextCursor: cursor ? null : 'empty-next' };
      return { items: [thread('old')], nextCursor: null };
    },
  }) });
  const sessions = await Promise.all([runtime.readSession('old'), runtime.readSession('old')]);
  assert.deepEqual(sessions.map((session) => session?.id), ['old', 'old']);
  assert.deepEqual(calls, ['false:', 'false:empty-next', 'true:']);
});

test('compatibility lookup propagates provider failures and cursor cycles instead of reporting missing', async () => {
  for (const repeated of [false, true]) {
    const runtime = new CodexWebRuntime({ defaultCwd: '/project', client: client({
      readThread: async () => { throw new Error('list_turns is not supported yet'); },
      listThreads: async () => {
        if (!repeated) throw new Error('provider unavailable');
        return { items: [], nextCursor: 'cycle' };
      },
    }) });
    await assert.rejects(runtime.readSession('missing'), repeated ? /repeated cursor/u : /provider unavailable/u);
  }
});

test('cold directory returns after one upstream page and background completion includes the full catalog', async () => {
  let calls = 0;
  const directory = new SessionDirectory(async ({ cursor }) => {
    calls += 1;
    const page = Number(cursor ?? 0);
    return { items: Array.from({ length: 100 }, (_, i) => thread(`thread-${page * 100 + i}`)), nextCursor: page === 9 ? null : String(page + 1) };
  });
  const first = await directory.read();
  assert.equal(calls, 1);
  assert.equal(first.threads.length, 100);
  assert.equal(first.complete, false);
  const complete = await directory.read(false, true);
  assert.equal(calls, 10);
  assert.equal(complete.threads.length, 1_000);
  await directory.read();
  assert.equal(calls, 10);
});

test('directory retries a failed background completion and never marks partial search complete', async () => {
  let fail = true;
  const directory = new SessionDirectory(async ({ cursor }) => {
    if (cursor && fail) throw new Error('offline');
    return { items: [thread(cursor ? 'older' : 'recent')], nextCursor: cursor ? null : 'next' };
  });
  assert.equal((await directory.read()).complete, false);
  await assert.rejects(directory.read(false, true), /offline/u);
  fail = false;
  assert.deepEqual((await directory.read(false, true)).threads.map((item) => item.threadId), ['recent', 'older']);
});

test('history projection reuses parsed history across pages and invalidates after local persistence', async () => {
  let fullReads = 0;
  let stored: any[] = [];
  const runtime = new CodexWebRuntime({ defaultCwd: '/project', client: client({
    readThread: async (_id, includeTurns) => { if (includeTurns) fullReads += 1; return thread('history'); },
  }), timelineStore: {
    list: () => stored, append: () => {}, delete: () => {}, replace: (_id, entries) => { stored = entries; },
  } });
  await runtime.readSessionTimeline('history');
  await runtime.readSessionTimeline('history');
  await runtime.readSessionMetadata('history');
  assert.equal(fullReads, 1);
  await runtime.appendSessionTimelineEntry('history', { role: 'system', label: 'Note', meta: 'saved', text: 'Updated' });
  const session = await runtime.readSessionTimeline('history');
  assert.equal(fullReads, 2);
  assert.equal(session?.timeline.at(-1)?.text, 'Updated');
});

test('1000 saved settings are loaded once per manifest revision on lightweight status reads', async (t) => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { FileSessionSettingsStore } = await import('../src/session_settings_store.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-settings-index-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, 'settings.json');
  await fs.writeFile(settingsPath, JSON.stringify({ version: 1, sessions: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`thread-${i}`, { bridgeSessionId: `thread-${i}`, updatedAt: 1 }])) }));
  const store = new FileSessionSettingsStore({ settingsPath });
  let lists = 0;
  const originalList = store.list.bind(store);
  store.list = async () => { lists += 1; return originalList(); };
  const runtime = new CodexWebRuntime({ defaultCwd: '/project', settingsStore: store, client: client({ readThread: async (id) => thread(id) }) });
  await runtime.readSessionStatus('thread-999');
  const started = performance.now();
  for (let index = 0; index < 10; index += 1) await runtime.readSessionStatus('thread-999');
  t.diagnostic(`10 warm status reads with 1000 saved settings: ${(performance.now() - started).toFixed(2)} ms`);
  assert.equal(lists, 1);
  const other = new FileSessionSettingsStore({ settingsPath });
  await other.set('thread-999', { ...(await other.get('thread-999'))!, favorite: true });
  assert.equal((await runtime.readSessionStatus('thread-999'))?.favorite, true);
  assert.equal(lists, 2);
});

test('accepted steering invalidates history immediately even before another provider event', async t => {
  let fullReads = 0;
  const items: any[] = [{ type: 'message', role: 'user', text: 'Initial request' }];
  const runtime = new CodexWebRuntime({ client: client({
    readThread: async (_id, includeTurns) => {
      if (includeTurns) fullReads++;
      return { ...thread('history'), turns: [{ id: 'active', status: 'inProgress', items: [...items] }] };
    },
    steerTurn: async ({ clientUserMessageId }) => {
      items.push({ type: 'message', role: 'user', text: 'New instruction', raw: { clientId: clientUserMessageId } });
      return { turnId: 'active' };
    },
  }) });
  t.after(() => runtime.stop());
  await runtime.readSessionTimeline('history');
  await runtime.readSessionTimeline('history');
  assert.equal(fullReads, 1);
  await runtime.steerTurnForThread('history', 'active', { text: 'New instruction' }, 'new-instruction');
  const fresh = await runtime.readSessionTimeline('history');
  assert.equal(fullReads, 2);
  assert.equal(fresh?.timeline.at(-1)?.text, 'New instruction');
  assert.match(fresh?.timeline.at(-1)?.clientMessageId || '', /^[a-f0-9]{24}$/u);
});

test('compatibility lookup finds the first, second and last pages beyond the first hundred threads', async () => {
  for (const position of [0, 100, 250]) {
    let calls = 0;
    const runtime = new CodexWebRuntime({ defaultCwd: '/project', client: client({
      readThread: async () => { throw new Error('list_turns is not supported yet'); },
      listThreads: async ({ cursor, archived } = {}) => {
        calls += 1;
        if (archived) return { items: [], nextCursor: null };
        const start = Number(cursor ?? 0);
        const end = Math.min(start + 100, 251);
        return { items: Array.from({ length: end - start }, (_, i) => thread(`item-${start + i}`)), nextCursor: end < 251 ? String(end) : null };
      },
    }) });
    assert.equal((await runtime.readSession(`item-${position}`))?.id, `item-${position}`);
    assert.equal(calls, 3);
    await runtime.readSession(`item-${position}`);
    assert.equal(calls, 3, 'fresh complete catalog snapshot serves later compatibility lookups');
  }
});

test('unsupported provider history remains distinguishable from missing or empty history', async () => {
  const runtime = new CodexWebRuntime({ defaultCwd: '/project', client: client({
    readThread: async (_id, includeTurns) => {
      if (includeTurns) throw new Error('list_turns is not supported yet');
      return thread('present');
    },
  }) });
  assert.equal((await runtime.readSession('present'))?.id, 'present');
  await assert.rejects(runtime.readSessionTimeline('present'), (error: any) => error.code === 'history_unavailable');
});
