import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileSessionSettingsStore } from '../src/session_settings_store.js';

test('file session settings store persists session favorite flag', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-settings-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const settingsPath = path.join(dir, 'session-settings.json');
  const store = new FileSessionSettingsStore({ settingsPath });

  store.set('thread_favorite', {
    bridgeSessionId: 'thread_favorite',
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    collaborationMode: 'default',
    personality: 'pragmatic',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    locale: null,
    metadata: {},
    updatedAt: 1,
    favorite: true,
    favoriteOrder: 4,
  } as any);

  const reloaded = new FileSessionSettingsStore({ settingsPath });
  assert.equal((reloaded.get('thread_favorite') as any)?.favorite, true);
  assert.equal((reloaded.get('thread_favorite') as any)?.favoriteOrder, 4);
});

test('file session settings store re-reads state for every mutation', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-settings-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, 'session-settings.json');
  const first = new FileSessionSettingsStore({ settingsPath });
  const previouslyLoaded = new FileSessionSettingsStore({ settingsPath });

  first.set('thread_one', createSettings('thread_one', 1));
  assert.ok(previouslyLoaded.get('thread_one'));
  first.set('thread_two', createSettings('thread_two', 2));
  previouslyLoaded.set('thread_three', createSettings('thread_three', 3));

  assert.deepEqual(
    new FileSessionSettingsStore({ settingsPath }).list().map(([sessionId]) => sessionId).sort(),
    ['thread_one', 'thread_three', 'thread_two'],
  );
});

test('file session settings store serializes concurrent writers across processes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-settings-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, 'session-settings.json');

  await Promise.all(['alpha', 'beta', 'gamma'].map((prefix) => runSettingsWorker(settingsPath, prefix, 15)));

  const entries = new FileSessionSettingsStore({ settingsPath }).list();
  assert.equal(entries.length, 45);
  assert.equal(new Set(entries.map(([sessionId]) => sessionId)).size, 45);
});

test('file session settings store fails closed on corrupted state', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-settings-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, 'session-settings.json');
  const corrupted = '{"version":1,"sessions":';
  await fs.writeFile(settingsPath, corrupted);
  const store = new FileSessionSettingsStore({ settingsPath });

  assert.throws(() => store.get('thread_one'), SyntaxError);
  assert.throws(() => store.set('thread_one', createSettings('thread_one', 1)), SyntaxError);
  assert.equal(await fs.readFile(settingsPath, 'utf8'), corrupted);
});

function createSettings(sessionId: string, updatedAt: number): any {
  return {
    bridgeSessionId: sessionId,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    collaborationMode: 'default',
    personality: 'pragmatic',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    locale: null,
    metadata: {},
    updatedAt,
  };
}

function runSettingsWorker(settingsPath: string, prefix: string, count: number): Promise<void> {
  const moduleUrl = new URL('../src/session_settings_store.ts', import.meta.url).href;
  const source = `
    import { FileSessionSettingsStore } from ${JSON.stringify(moduleUrl)};
    const store = new FileSessionSettingsStore({ settingsPath: process.env.SETTINGS_PATH });
    for (let index = 0; index < Number(process.env.ENTRY_COUNT); index += 1) {
      const sessionId = process.env.ENTRY_PREFIX + '_' + index;
      store.set(sessionId, {
        bridgeSessionId: sessionId,
        model: null,
        reasoningEffort: null,
        serviceTier: null,
        collaborationMode: 'default',
        personality: 'pragmatic',
        accessPreset: 'full-access',
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access',
        locale: null,
        metadata: {},
        updatedAt: index,
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
        SETTINGS_PATH: settingsPath,
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
      reject(new Error(`settings worker failed (${code ?? signal}): ${stderr}`));
    });
  });
}
