import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileSessionTimelineStore, type CodexWebTimelineMessage } from '../src/session_timeline_store.js';

test('file session timeline store re-reads state for every mutation', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-timeline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'session-timeline.json');
  const first = new FileSessionTimelineStore({ timelinePath });
  const previouslyLoaded = new FileSessionTimelineStore({ timelinePath });

  (await first.append('thread_one', message('one')));
  assert.equal((await previouslyLoaded.list('thread_one')).length, 1);
  (await first.append('thread_one', message('two')));
  (await previouslyLoaded.append('thread_one', message('three')));

  assert.deepEqual(
    (await new FileSessionTimelineStore({ timelinePath }).list('thread_one')).map((entry) => entry.id),
    ['one', 'two', 'three'],
  );
});

test('file session timeline store preserves other sessions during replacement and deletion', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-timeline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'session-timeline.json');
  const first = new FileSessionTimelineStore({ timelinePath });
  const second = new FileSessionTimelineStore({ timelinePath });

  (await first.append('thread_one', message('one')));
  (await second.append('thread_two', message('two')));
  (await first.replace('thread_one', [message('replacement')]));
  (await second.delete('thread_one'));

  const reloaded = new FileSessionTimelineStore({ timelinePath });
  assert.deepEqual((await reloaded.list('thread_one')), []);
  assert.deepEqual((await reloaded.list('thread_two')).map((entry) => entry.id), ['two']);
});

test('file session timeline store preserves safe projection metadata and strips provider raw data', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-timeline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'session-timeline.json');
  const store = new FileSessionTimelineStore({ timelinePath });

  (await store.append('thread_one', {
    ...message('projected'),
    turnId: 'turn_one',
    itemId: 'item_one',
    projectionKey: 'turn_one\u0000item_one',
    clientMessageId: 'client_message_one',
    phase: 'final_answer',
    lifecycle: 'completed',
    raw: { secret: true },
  } as CodexWebTimelineMessage & { raw: Record<string, unknown> }));

  assert.deepEqual((await store.list('thread_one')), [{
    ...message('projected'),
    turnId: 'turn_one',
    itemId: 'item_one',
    projectionKey: 'turn_one\u0000item_one',
    clientMessageId: 'client_message_one',
    phase: 'final_answer',
    lifecycle: 'completed',
    severity: undefined,
    afterHistoryIndex: undefined,
    afterHistoryId: undefined,
  }]);
  assert.equal('raw' in (await store.list('thread_one'))[0]!, false);
});

test('file session timeline store serializes concurrent appends across processes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-timeline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'session-timeline.json');

  await Promise.all(['alpha', 'beta', 'gamma'].map((prefix) => runTimelineWorker(timelinePath, prefix, 15)));

  const entries = (await new FileSessionTimelineStore({ timelinePath }).list('shared_thread'));
  assert.equal(entries.length, 45);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 45);
});

test('file session timeline store fails closed on corrupted state', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-timeline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'session-timeline.json');
  const corrupted = JSON.stringify({ version: 1, sessions: { thread_one: [{ kind: 'message' }] } });
  await fs.writeFile(timelinePath, corrupted);
  const store = new FileSessionTimelineStore({ timelinePath });

  await assert.rejects(async () => (await store.list('thread_one')), /Invalid session timeline entry/u);
  await assert.rejects(async () => (await store.append('thread_one', message('must-not-persist'))), /Invalid session timeline entry/u);
  assert.equal(await fs.readFile(timelinePath, 'utf8'), corrupted);
});

test('file session timeline store retains only the configured newest entries per session', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-timeline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'session-timeline.json');
  const store = new FileSessionTimelineStore({ timelinePath, maxEntriesPerSession: 3 });

  for (const id of ['one', 'two', 'three', 'four', 'five']) {
    (await store.append('thread_one', message(id)));
  }

  assert.deepEqual((await store.list('thread_one')).map((entry) => entry.id), ['three', 'four', 'five']);
});

test('file session timeline store compacts oldest entries to stay within its total byte quota', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-timeline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'session-timeline.json');
  const store = new FileSessionTimelineStore({
    timelinePath,
    maxEntriesPerSession: 100,
    maxBytes: 700,
  });

  for (let index = 0; index < 8; index += 1) {
    (await store.append('thread_one', { ...message(`entry_${index}`), text: 'x'.repeat(180) }));
  }

  const manifest = JSON.parse(await fs.readFile(`${timelinePath}.d/manifest.json`, 'utf8'));
  const raw = await fs.readFile(path.join(`${timelinePath}.d`, manifest.sessions.thread_one.file));
  const retained = (await store.list('thread_one'));
  assert.ok(raw.byteLength <= 700);
  assert.ok(retained.length > 0);
  assert.equal(retained.at(-1)?.id, 'entry_7');
  assert.equal(retained.some((entry) => entry.id === 'entry_0'), false);
});

function message(id: string): CodexWebTimelineMessage {
  return {
    id,
    kind: 'message',
    role: 'assistant',
    label: 'Codex',
    meta: 'saved',
    text: id,
  };
}

function runTimelineWorker(timelinePath: string, prefix: string, count: number): Promise<void> {
  const moduleUrl = new URL('../src/session_timeline_store.ts', import.meta.url).href;
  const source = `
    import { FileSessionTimelineStore } from ${JSON.stringify(moduleUrl)};
    const store = new FileSessionTimelineStore({ timelinePath: process.env.TIMELINE_PATH });
    for (let index = 0; index < Number(process.env.ENTRY_COUNT); index += 1) {
      const id = process.env.ENTRY_PREFIX + '_' + index;
      await store.append('shared_thread', {
        id,
        kind: 'message',
        role: 'assistant',
        label: 'Codex',
        meta: 'saved',
        text: id,
      });
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--conditions=development',
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      source,
    ], {
      env: {
        ...process.env,
        TIMELINE_PATH: timelinePath,
        ENTRY_PREFIX: prefix,
        ENTRY_COUNT: String(count),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`timeline worker failed (${code ?? signal}): ${stderr}`));
    });
  });
}

test('migration backs up legacy state and never overwrites newer shards on restart', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-migrate-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'timeline.json');
  const legacy = JSON.stringify({ version: 1, sessions: { one: [message('legacy')] } });
  await fs.writeFile(timelinePath, legacy);
  const store = new FileSessionTimelineStore({ timelinePath });
  assert.equal((await store.list('one'))[0]?.id, 'legacy');
  await store.append('one', message('new'));
  assert.equal(await fs.readFile(`${timelinePath}.migration-backup`, 'utf8'), legacy);
  assert.deepEqual((await new FileSessionTimelineStore({ timelinePath }).list('one')).map((item) => item.id), ['legacy', 'new']);
  await fs.unlink(`${timelinePath}.d/manifest.json`);
  await assert.rejects(new FileSessionTimelineStore({ timelinePath }).list('one'), /manifest missing/u);
});

test('partition commits retain one recoverable predecessor and bounded shard versions', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-partition-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'timeline.json');
  const store = new FileSessionTimelineStore({ timelinePath });
  for (let index = 0; index < 20; index += 1) await store.replace('one', [message(`entry-${index}`)]);
  const files = await fs.readdir(`${timelinePath}.d`);
  assert.equal(files.filter((file) => /^[a-f0-9]{64}-/u.test(file)).length, 2);
  const backup = JSON.parse(await fs.readFile(`${timelinePath}.d/manifest.backup.json`, 'utf8'));
  assert.equal(JSON.parse(await fs.readFile(path.join(`${timelinePath}.d`, backup.sessions.one.file), 'utf8'))[0].id, 'entry-18');
  // Recovery is deliberate: corrupt state never silently rolls back accepted writes.
  await fs.writeFile(`${timelinePath}.d/manifest.json`, 'corrupt');
  await assert.rejects(new FileSessionTimelineStore({ timelinePath }).list('one'), SyntaxError);
  await fs.copyFile(`${timelinePath}.d/manifest.backup.json`, `${timelinePath}.d/manifest.json`);
  assert.equal((await new FileSessionTimelineStore({ timelinePath }).list('one'))[0]?.id, 'entry-18');
});

test('timeline lock contention yields to timers instead of blocking the event loop', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-async-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'timeline.json');
  const store = new FileSessionTimelineStore({ timelinePath });
  t.after(() => store.dispose());
  await store.list('one');
  await fs.writeFile(`${timelinePath}.lock`, JSON.stringify({ version: 1, pid: process.pid, createdAt: new Date().toISOString(), token: 'contending-writer' }));
  let timerRan = false;
  const release = new Promise<void>((resolve, reject) => setTimeout(() => {
    timerRan = true;
    fs.unlink(`${timelinePath}.lock`).then(resolve, reject);
  }, 20));
  await Promise.all([store.append('one', message('after-lock')), release]);
  assert.equal(timerRan, true);
  assert.equal((await store.list('one'))[0]?.id, 'after-lock');
});

test('postcommit retirement failure preserves successful writes and retries orphan cleanup', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-retirement-failure-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timelinePath = path.join(dir, 'timeline.json');
  const store = new FileSessionTimelineStore({ timelinePath });
  t.after(() => store.dispose());
  await store.replace('one', [message('first')]);
  const firstManifest = JSON.parse(await fs.readFile(`${timelinePath}.d/manifest.json`, 'utf8'));
  const orphanPath = path.join(`${timelinePath}.d`, firstManifest.sessions.one.file);
  await store.replace('one', [message('second')]);

  const unlink = fs.unlink.bind(fs);
  let injectedFailures = 0;
  const injected = t.mock.method(fs, 'unlink', async (file: Parameters<typeof fs.unlink>[0]) => {
    if (file === orphanPath) {
      injectedFailures += 1;
      throw Object.assign(new Error('Injected shard retirement failure'), { code: 'EACCES' });
    }
    return unlink(file);
  });
  await assert.doesNotReject(store.replace('one', [message('committed')]));
  assert.equal(injectedFailures, 1, 'failure occurs in retirement after the third manifest commit');
  assert.equal((await new FileSessionTimelineStore({ timelinePath }).list('one'))[0]?.id, 'committed');
  assert.equal((await fs.stat(orphanPath)).isFile(), true);
  const backup = JSON.parse(await fs.readFile(`${timelinePath}.d/manifest.backup.json`, 'utf8'));
  assert.equal(JSON.parse(await fs.readFile(path.join(`${timelinePath}.d`, backup.sessions.one.file), 'utf8'))[0].id, 'second');

  injected.mock.restore();
  t.mock.timers.tick(30_000);
  await store.dispose();
  await assert.rejects(fs.stat(orphanPath), { code: 'ENOENT' });
  assert.equal((await store.list('one'))[0]?.id, 'committed');
});
