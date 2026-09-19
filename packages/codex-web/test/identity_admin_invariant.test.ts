import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileIdentityStore, LastAdministratorError } from '../src/identity_store.js';

async function fixture(t: test.TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-admin-invariant-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const identityPath = path.join(directory, 'identity.json');
  const store = new FileIdentityStore({ identityPath });
  await store.upsertRole({ id: 'admin', name: 'Admin', isAdmin: true, projectGrants: [] });
  await store.upsertRole({ id: 'member', name: 'Member', isAdmin: false, projectGrants: [] });
  await store.upsertUserWithPassword({ id: 'a', username: 'first-admin', password: 'test-password', roleIds: ['admin'] });
  await store.setMultiUserEnabled(true);
  return { store, identityPath };
}

test('all destructive mutations of the last login-capable administrator fail without writing state', async t => {
  const { store, identityPath } = await fixture(t);
  const before = await fs.readFile(identityPath, 'utf8');
  const mutations = [
    () => store.updateUserAccess({ id: 'a', enabled: false }),
    () => store.updateUserAccess({ id: 'a', roleIds: ['member'] }),
    () => store.deleteUser('a'),
    () => store.upsertRole({ id: 'admin', name: 'Downgraded', isAdmin: false, projectGrants: [] }),
    () => store.upsertUserWithPassword({ id: 'a', username: 'first-admin', password: 'replacement-password', roleIds: [] }),
  ];
  for (const mutate of mutations) {
    await assert.rejects(mutate, LastAdministratorError);
    assert.equal(await fs.readFile(identityPath, 'utf8'), before);
  }
  assert.equal(await store.verifyUserPassword('first-admin', 'test-password'), 'a');
});

test('a disabled administrator cannot make removal of the last enabled administrator safe', async t => {
  const { store } = await fixture(t);
  await store.upsertUserWithPassword({ id: 'b', username: 'disabled-admin', password: 'test-password', roleIds: ['admin'], enabled: false });
  await assert.rejects(store.deleteUser('a'), LastAdministratorError);
});

test('concurrent changes through different store instances retain one administrator', async t => {
  const { store, identityPath } = await fixture(t);
  await store.upsertUserWithPassword({ id: 'b', username: 'second-admin', password: 'test-password', roleIds: ['admin'] });
  const otherStore = new FileIdentityStore({ identityPath });
  const results = await Promise.allSettled([
    store.updateUserAccess({ id: 'a', enabled: false }),
    otherStore.updateUserAccess({ id: 'b', roleIds: [] }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof LastAdministratorError);
  const state = await otherStore.readState();
  assert.equal(state.users.filter(user => user.enabled && user.roleIds.includes('admin')).length, 1);
});

test('initial setup and edits that keep the existing administrator remain possible', async t => {
  const { store } = await fixture(t);
  await store.updateUserAccess({ id: 'a', email: 'changed@example.test' });
  await store.upsertRole({ id: 'admin', name: 'Renamed admin role', isAdmin: true, projectGrants: [] });
  await store.upsertUserWithPassword({ id: 'b', username: 'second-admin', password: 'test-password', roleIds: ['admin'] });
  await store.deleteUser('a');
  assert.equal(await store.verifyUserPassword('second-admin', 'test-password'), 'b');
});
