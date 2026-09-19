import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

async function harness() {
  const context = vm.createContext({ AbortController });
  for (const name of ['admin-editor', 'admin-data']) vm.runInContext(await readFile(new URL(`../public/${name}.js`, import.meta.url), 'utf8'), context);
  return context;
}

test('editor drafts isolate every control, deduplicate writes, retain failures and discard secrets at logout', async () => {
  const context = await harness(), store = context.CodexWebAdminEditor.createStore();
  const a = store.get('user', 'a', { name: 'Alice', enabled: true, roleId: 'role_a', projectIds: ['x'], password: 'secret' });
  store.edit('user', 'a', 'enabled', false); store.edit('user', 'a', 'projectIds', ['y']);
  const b = store.get('user', 'b', { name: 'Bob', enabled: true });
  assert.equal(b.values.name, 'Bob'); assert.equal(b.values.enabled, true);
  const write = store.begin('user', 'a'); assert.equal(store.begin('user', 'a'), null);
  write.fail('conflict'); write.finish();
  assert.equal(a.values.enabled, false); assert.deepEqual(Array.from(a.values.projectIds), ['y']); assert.equal(a.error, 'conflict');
  const retry = store.begin('user', 'a'); store.clear();
  const fresh = store.get('user', 'a', { name: 'New owner' }); retry.fail('late'); retry.succeed(); retry.finish();
  assert.equal(store.get('user', 'a'), fresh); assert.equal(fresh.values.password, undefined); assert.equal(fresh.error, '');
});

test('independent resources keep successes and stale valid data; replaced queries ignore all late effects', async () => {
  const context = await harness();
  const pending: Array<{path: string; resolve: (value: unknown) => void; reject: (error: Error) => void}> = [];
  const errors: Error[] = [], applied: string[] = [];
  const store = context.CodexWebAdminData.createStore({ request: (path: string) => new Promise((resolve, reject) => pending.push({ path, resolve, reject })), onError: (error: Error) => errors.push(error) });
  const roles = store.load('roles', '/roles', () => applied.push('roles'));
  const users = store.load('users', '/users', () => applied.push('users'));
  assert.equal(store.load('users', '/users', () => {}), users);
  await Promise.resolve(); pending[0]!.reject(new Error('503')); pending[1]!.resolve({ items: [] }); await Promise.all([roles, users]);
  assert.deepEqual(applied, ['users']); assert.equal(store.get('users').loaded, true); assert.equal(store.get('roles').error, '503');
  const refresh = store.load('users', '/users', () => {}, { force: true }); await Promise.resolve(); pending[2]!.reject(new Error('offline')); await refresh;
  assert.equal(store.get('users').loaded, true);
  const first = store.load('sessions', '/all', () => applied.push('old'));
  const second = store.load('sessions', '/archived', () => applied.push('new'));
  await Promise.resolve(); pending[4]!.resolve({}); await second; pending[3]!.reject(new Error('late')); await first;
  assert.equal(store.get('sessions').error, ''); assert.deepEqual(applied, ['users', 'new']); assert.equal(errors.length, 2);
});
