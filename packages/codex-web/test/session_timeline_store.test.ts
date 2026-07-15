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

  first.append('thread_one', message('one'));
  assert.equal(previouslyLoaded.list('thread_one').length, 1);
  first.append('thread_one', message('two'));
  previouslyLoaded.append('thread_one', message('three'));

  assert.deepEqual(
    new FileSessionTimelineStore({ timelinePath }).list('thread_one').map((entry) => entry.id),
    ['one', 'two', 'three'],
  );
});

test('file session timeline store preserves other sessions during replacement and deletion', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-timeline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'session-timeline.json');
  const first = new FileSessionTimelineStore({ timelinePath });
  const second = new FileSessionTimelineStore({ timelinePath });

  first.append('thread_one', message('one'));
  second.append('thread_two', message('two'));
  first.replace('thread_one', [message('replacement')]);
  second.delete('thread_one');

  const reloaded = new FileSessionTimelineStore({ timelinePath });
  assert.deepEqual(reloaded.list('thread_one'), []);
  assert.deepEqual(reloaded.list('thread_two').map((entry) => entry.id), ['two']);
});

test('file session timeline store serializes concurrent appends across processes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-timeline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'session-timeline.json');

  await Promise.all(['alpha', 'beta', 'gamma'].map((prefix) => runTimelineWorker(timelinePath, prefix, 15)));

  const entries = new FileSessionTimelineStore({ timelinePath }).list('shared_thread');
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

  assert.throws(() => store.list('thread_one'), /Invalid session timeline entry/u);
  assert.throws(() => store.append('thread_one', message('must-not-persist')), /Invalid session timeline entry/u);
  assert.equal(await fs.readFile(timelinePath, 'utf8'), corrupted);
});

test('file session timeline store retains only the configured newest entries per session', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-timeline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, 'session-timeline.json');
  const store = new FileSessionTimelineStore({ timelinePath, maxEntriesPerSession: 3 });

  for (const id of ['one', 'two', 'three', 'four', 'five']) {
    store.append('thread_one', message(id));
  }

  assert.deepEqual(store.list('thread_one').map((entry) => entry.id), ['three', 'four', 'five']);
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
    store.append('thread_one', { ...message(`entry_${index}`), text: 'x'.repeat(180) });
  }

  const raw = await fs.readFile(timelinePath);
  const retained = store.list('thread_one');
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
      store.append('shared_thread', {
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
