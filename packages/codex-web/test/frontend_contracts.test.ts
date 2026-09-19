import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('navigation context aborts obsolete requests and stale cleanup cannot cancel the successor', async () => {
  const context: any = { AbortController };
  vm.runInNewContext(await readFile(new URL('../public/request-context.js', import.meta.url), 'utf8'), context);
  const navigation = context.CodexWebRequestContext.createRequestContext();
  const first = navigation.start();
  const second = navigation.start();
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  first.finish();
  assert.equal(second.isCurrent(), true);
  navigation.cancel();
  assert.equal(second.controller.signal.aborted, true);
});

test('durable drafts isolate owners, expire old data, bound storage, and clean successful sends/logout', async () => {
  const values = new Map<string, string>();
  const context: any = {};
  vm.runInNewContext(await readFile(new URL('../public/draft-store.js', import.meta.url), 'utf8'), context);
  const storage = { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const store = context.CodexWebDrafts.createStore(storage);
  store.write('single', 'session', { prompt: 'unsent', attachments: [{ uploaded: { localPath: '/upload/image.png' } }], updatedAt: Date.now() });
  assert.equal(store.read('single').session.prompt, 'unsent');
  assert.equal(Object.keys(store.read('multi:other')).length, 0);
  for (let i = 0; i < 70; i += 1) store.write('single', `session_${i}`, { prompt: 'text', attachments: [], updatedAt: Date.now() + i });
  assert.equal(Object.keys(store.read('single')).length, 50);
  store.write('single', 'session_69', null);
  assert.equal(store.read('single').session_69, undefined);
  store.write('single', 'old', { prompt: 'expired', attachments: [], updatedAt: 1 });
  assert.equal(store.read('single').old, undefined);
  store.clear('single');
  assert.equal(values.has('codexWebPromptDrafts:single'), false);
});

test('draft eviction preserves the current draft under the total byte budget and reports denied storage', async () => {
  const context: any = {};
  vm.runInNewContext(await readFile(new URL('../public/draft-store.js', import.meta.url), 'utf8'), context);
  const values = new Map<string, string>();
  const store = context.CodexWebDrafts.createStore({ getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  for (let index = 0; index < 20; index += 1) store.write('single', `draft_${index}`, { prompt: '草'.repeat(100000), attachments: [], updatedAt: Date.now() + index });
  assert.ok(values.get('codexWebPromptDrafts:single')!.length <= 1000000);
  assert.equal(store.read('single').draft_19.prompt.length, 100000);
  const denied = context.CodexWebDrafts.createStore({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} });
  assert.equal(denied.write('single', 'draft', { prompt: 'keep in memory', attachments: [], updatedAt: Date.now() }), false);
});

test('malformed attachment references are discarded and denied cleanup never prevents logout', async () => {
  const context: any = {};
  vm.runInNewContext(await readFile(new URL('../public/draft-store.js', import.meta.url), 'utf8'), context);
  const store = context.CodexWebDrafts.createStore({ getItem: () => JSON.stringify({ draft: { prompt: 'safe text', updatedAt: Date.now(), attachments: [null, {}, { id: 'bad', uploaded: null }, { id: 'ready', status: 'ready', fileName: 'safe.png', uploaded: { localPath: '/uploads/safe.png', bad: { deep: true } } }] } }), setItem: () => {}, removeItem: () => { throw new Error('Storage denied'); } });
  const restored = store.read('single').draft;
  assert.equal(restored.attachments.length, 1);
  assert.equal(restored.attachments[0].uploaded.localPath, '/uploads/safe.png');
  assert.equal(restored.attachments[0].uploaded.bad, undefined);
  assert.doesNotThrow(() => store.clear('single'));
});

test('logout clears local authentication when browser storage removal is denied', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const logout = source.slice(source.indexOf('async function onLogout()'), source.indexOf('\nfunction showSessionList()', source.indexOf('async function onLogout()')));
  let loggedOut = false;
  const context: any = { cancelSessionOpen() {}, savePromptDraftForCurrentSession() {}, promptDraftStore: { clear() {} }, currentDraftOwnerKey: () => 'single', clearTimeout() {}, promptDraftPersistTimer: null, apiFetch: async () => {}, localStorage: { removeItem() { throw new Error('Storage denied'); } }, TOKEN_KEY: 'token', SESSIONS_CACHE_KEY: 'sessions', TIMELINE_CACHE_KEY: 'timeline', state: { token: 'authenticated' }, setLoggedOut() { loggedOut = true; } };
  vm.runInNewContext(logout, context);
  await context.onLogout();
  assert.equal(context.state.token, '');
  assert.equal(loggedOut, true);
});
