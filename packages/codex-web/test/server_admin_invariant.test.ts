import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AuthStore } from '../src/auth_store.js';
import { HybridAuthStore } from '../src/hybrid_auth_store.js';
import { FileIdentityStore } from '../src/identity_store.js';
import { createCodexWebServer } from '../src/server.js';

test('HTTP rejects last-admin edits/deletion and the same authenticated device can still administer the host', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-last-admin-http-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const legacyAuth = new AuthStore({ authPath: path.join(directory, 'auth.json') });
  const identityStore = new FileIdentityStore({ identityPath: path.join(directory, 'identity.json') });
  const auth = new HybridAuthStore({ legacyAuth, identityStore });
  await legacyAuth.setPassword('synthetic-admin-password');
  await auth.setMultiUserEnabled(true);
  const login = await auth.login({ username: 'admin', password: 'synthetic-admin-password' });
  await identityStore.upsertRole({ id: 'member', name: 'Member', isAdmin: false, projectGrants: [] });
  const config = { host: '127.0.0.1', port: 0, defaultCwd: directory, stateDir: directory, codexBin: 'codex', authPath: path.join(directory, 'auth.json'), reportsDir: path.join(directory, 'reports'), reportIndexPath: path.join(directory, 'report-index.json'), envPath: path.join(directory, 'unused.env'), debug: false, publicSharesEnabled: false, publicShareTtlSeconds: 3600 };
  const runtime = { listSessions: async () => [], listModels: async () => [], readUsage: async () => null };
  const server = createCodexWebServer({ config, auth, identityStore, runtime: runtime as any });
  await server.start();
  t.after(() => server.stop());
  const headers = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };
  for (const request of [
    { method: 'PATCH', url: '/api/admin/users/user_admin', body: { enabled: false, roleId: 'role_admin' } },
    { method: 'PATCH', url: '/api/admin/users/user_admin', body: { enabled: true, roleId: 'member' } },
    { method: 'DELETE', url: '/api/admin/users/user_admin', body: undefined },
    { method: 'POST', url: '/api/admin/users', body: { id: 'user_admin', username: 'admin', password: 'other-password', roleId: 'member' } },
  ]) {
    const response = await fetch(`${server.baseUrl}${request.url}`, { method: request.method, headers, body: request.body ? JSON.stringify(request.body) : undefined });
    assert.equal(response.status, 409);
    assert.equal((await response.json() as any).error, 'last_admin_required');
    const users = await fetch(`${server.baseUrl}/api/admin/users`, { headers });
    assert.equal(users.status, 200);
    const payload = await users.json() as any;
    assert.ok(payload.items.some((user: any) => user.id === 'user_admin' && user.enabled && user.roleIds.includes('role_admin')));
  }
});
