import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  effectiveProjectGrant,
  canCreateProjectSession,
  canReadAppSession,
  canWriteAppSession,
} from '../src/access_control.js';
import { FileIdentityStore } from '../src/identity_store.js';

async function tempIdentityPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-identity-'));
  return path.join(dir, 'identity.json');
}

test('identity store hashes user passwords and verifies credentials', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });

  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    email: '  alice@example.com  ',
    password: 'secret-password',
    roleIds: [],
    directProjectGrants: [],
  });

  const state = await store.readState();
  const [user] = state.users;
  assert.equal(user?.username, 'alice');
  assert.equal((user as any)?.email, 'alice@example.com');
  assert.notEqual(user?.passwordHash, 'secret-password');
  assert.equal(typeof user?.passwordSalt, 'string');
  assert.equal(await store.verifyUserPassword('alice', 'secret-password'), 'user_alice');
  assert.equal(await store.verifyUserPassword('alice', 'wrong-password'), null);
});

test('identity store persists a normalized global site title', async () => {
  const identityPath = await tempIdentityPath();
  const store = new FileIdentityStore({ identityPath });

  assert.equal((await store.readState()).settings.siteTitle, 'Codex Web');

  const updated = await store.setSiteTitle('  Yan Shan Lab  ');

  assert.deepEqual(updated.settings, {
    multiUserEnabled: false,
    siteTitle: 'Yan Shan Lab',
  });
  assert.equal((await store.readState()).settings.siteTitle, 'Yan Shan Lab');
});

test('identity store serializes mutations across store instances without losing updates', async () => {
  const identityPath = await tempIdentityPath();
  const stores = Array.from({ length: 12 }, () => new FileIdentityStore({ identityPath }));

  await Promise.all(stores.map((store, index) => store.upsertProject({
    id: `project_${index}`,
    internalName: `project-${index}`,
    cwd: `/tmp/project-${index}`,
    displayName: `Project ${index}`,
    enabled: true,
    activeSessionLimit: 30,
  })));

  const state = await stores[0]!.readState();
  assert.deepEqual(
    state.projects.map((project) => project.id).sort(),
    Array.from({ length: 12 }, (_, index) => `project_${index}`).sort(),
  );
});

test('identity store recovers a stale filesystem mutation lock', async () => {
  const identityPath = await tempIdentityPath();
  await fs.writeFile(`${identityPath}.lock`, JSON.stringify({
    version: 1,
    pid: process.pid,
    createdAt: '2000-01-01T00:00:00.000Z',
    token: 'stale-lock',
  }));

  const store = new FileIdentityStore({ identityPath });
  await store.setSiteTitle('Recovered');

  assert.equal((await store.readState()).settings.siteTitle, 'Recovered');
  await assert.rejects(() => fs.access(`${identityPath}.lock`), { code: 'ENOENT' });
});

test('identity store fails closed instead of overwriting malformed persisted state', async () => {
  const identityPath = await tempIdentityPath();
  const malformed = '[]\n';
  await fs.writeFile(identityPath, malformed);
  const store = new FileIdentityStore({ identityPath });

  await assert.rejects(() => store.setSiteTitle('Must not persist'), /Invalid identity state/u);
  assert.equal(await fs.readFile(identityPath, 'utf8'), malformed);
});

test('identity store persists a recoverable webhook key in a private identity file', async () => {
  const identityPath = await tempIdentityPath();
  const store = new FileIdentityStore({ identityPath });

  const created = await store.setWebhookEnabled('user_alice', true);

  assert.match(created.key ?? '', /^cwwh_[A-Za-z0-9_-]+$/u);
  assert.equal(created.credential?.enabled, true);
  assert.equal(created.credential?.key, created.key);
  assert.equal(created.credential?.keyHint, created.key?.slice(-6));
  assert.notEqual(created.credential?.tokenHash, created.key);
  assert.equal((await fs.readFile(identityPath, 'utf8')).includes(created.key!), true);
  assert.equal((await fs.stat(identityPath)).mode & 0o777, 0o600);
  const reopened = new FileIdentityStore({ identityPath });
  assert.equal((await reopened.getWebhookCredential('user_alice'))?.key, created.key);
  assert.equal((await store.findWebhookCredentialByToken(created.key!))?.ownerUserId, 'user_alice');
});

test('identity store disables and re-enables an existing webhook credential without changing its key', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });
  assert.deepEqual(await store.setWebhookEnabled('user_alice', false), { credential: null, key: null });
  const created = await store.setWebhookEnabled('user_alice', true);
  const key = created.key!;

  const disabled = await store.setWebhookEnabled('user_alice', false);
  assert.equal(disabled.credential?.enabled, false);
  assert.equal(disabled.credential?.tokenHash, created.credential?.tokenHash);
  assert.equal(disabled.key, key);
  assert.equal(await store.findWebhookCredentialByToken(key), null);

  const reenabled = await store.setWebhookEnabled('user_alice', true);
  assert.equal(reenabled.credential?.enabled, true);
  assert.equal(reenabled.credential?.tokenHash, created.credential?.tokenHash);
  assert.equal(reenabled.key, key);
  assert.equal((await store.findWebhookCredentialByToken(key))?.id, created.credential?.id);
});

test('identity store rotates webhook keys and immediately invalidates the previous key', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });
  const created = await store.setWebhookEnabled('user_alice', true);

  const rotated = await store.rotateWebhookKey('user_alice');

  assert.match(rotated.key, /^cwwh_[A-Za-z0-9_-]+$/u);
  assert.notEqual(rotated.key, created.key);
  assert.equal(rotated.credential.id, created.credential?.id);
  assert.equal(rotated.credential.createdAt, created.credential?.createdAt);
  assert.equal(await store.findWebhookCredentialByToken(created.key!), null);
  assert.equal((await store.findWebhookCredentialByToken(rotated.key))?.id, rotated.credential.id);
});

test('identity store treats a missing webhook credential list as an empty legacy state', async () => {
  const identityPath = await tempIdentityPath();
  await fs.writeFile(identityPath, JSON.stringify({
    settings: { multiUserEnabled: false, siteTitle: 'Legacy' },
    users: [],
    roles: [],
    projects: [],
    sessions: [],
    shares: [],
    userSessions: [],
  }));
  const store = new FileIdentityStore({ identityPath });

  assert.deepEqual((await store.readState()).webhookCredentials, []);
});

test('identity store preserves legacy hash-only webhook credentials until explicit rotation', async () => {
  const identityPath = await tempIdentityPath();
  const legacyKey = `cwwh_${'a'.repeat(43)}`;
  const legacyCredential = {
    id: 'credential_legacy',
    ownerUserId: 'user_alice',
    enabled: true,
    tokenHash: crypto.createHash('sha256').update(legacyKey).digest('base64url'),
    keyHint: legacyKey.slice(-6),
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
  await fs.writeFile(identityPath, JSON.stringify({ webhookCredentials: [legacyCredential] }), { mode: 0o600 });
  const store = new FileIdentityStore({ identityPath });

  assert.equal((await store.getWebhookCredential('user_alice'))?.key, null);
  assert.equal((await store.findWebhookCredentialByToken(legacyKey))?.id, legacyCredential.id);
  assert.equal((await store.setWebhookEnabled('user_alice', true)).key, null);

  const rotated = await store.rotateWebhookKey('user_alice');
  assert.notEqual(rotated.key, legacyKey);
  assert.equal(rotated.credential.key, rotated.key);
  assert.equal(await store.findWebhookCredentialByToken(legacyKey), null);
});

test('identity store fails closed on malformed webhook credential state', async () => {
  const identityPath = await tempIdentityPath();
  const malformed = JSON.stringify({ webhookCredentials: [{ id: 'credential_1', ownerUserId: 'user_alice' }] });
  await fs.writeFile(identityPath, malformed);
  const store = new FileIdentityStore({ identityPath });

  await assert.rejects(() => store.setSiteTitle('Must not persist'), /webhookCredentials\[0\] is malformed/u);
  assert.equal(await fs.readFile(identityPath, 'utf8'), malformed);
});

test('identity store fails closed when a persisted webhook key does not match its format, hint, or hash', async () => {
  const validKey = `cwwh_${'b'.repeat(43)}`;
  const baseCredential = {
    id: 'credential_1',
    ownerUserId: 'user_alice',
    enabled: true,
    key: validKey,
    tokenHash: crypto.createHash('sha256').update(validKey).digest('base64url'),
    keyHint: validKey.slice(-6),
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
  const malformedCredentials = [
    { ...baseCredential, key: 'cwwh_invalid' },
    { ...baseCredential, keyHint: 'wrong!' },
    { ...baseCredential, tokenHash: 'wrong-hash' },
  ];
  for (const credential of malformedCredentials) {
    const identityPath = await tempIdentityPath();
    await fs.writeFile(identityPath, JSON.stringify({ webhookCredentials: [credential] }));
    const store = new FileIdentityStore({ identityPath });

    await assert.rejects(() => store.readState(), /webhookCredentials\[0\] is malformed/u);
  }
});

test('identity store fails closed on duplicate webhook credential owners, ids, or token hashes', async () => {
  const baseCredential = {
    id: 'credential_1',
    ownerUserId: 'user_alice',
    enabled: true,
    tokenHash: 'hash_1',
    keyHint: 'hint_1',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
  for (const duplicateField of ['id', 'ownerUserId', 'tokenHash'] as const) {
    const identityPath = await tempIdentityPath();
    const secondCredential = {
      ...baseCredential,
      id: 'credential_2',
      ownerUserId: 'user_bob',
      tokenHash: 'hash_2',
      [duplicateField]: baseCredential[duplicateField],
    };
    await fs.writeFile(identityPath, JSON.stringify({
      webhookCredentials: [baseCredential, secondCredential],
    }));
    const store = new FileIdentityStore({ identityPath });

    await assert.rejects(
      () => store.readState(),
      new RegExp(`webhookCredentials contains a duplicate ${duplicateField}`, 'u'),
    );
  }
});

test('identity store updates user access without changing password hash', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });
  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    email: 'alice@example.com',
    password: 'secret-password',
    canNewSession: true,
    roleIds: ['role_reader'],
  });
  const before = await store.readState();
  const originalHash = before.users[0]?.passwordHash;

  const updated = await store.updateUserAccess({
    id: 'user_alice',
    enabled: true,
    canNewSession: false,
    email: '  alice+updated@example.com ',
    roleIds: ['role_viewer'],
  });

  assert.equal(updated.passwordHash, originalHash);
  assert.equal((updated as any).email, 'alice+updated@example.com');
  assert.deepEqual(updated.roleIds, ['role_viewer']);
  assert.equal(updated.canNewSession, false);
  assert.equal(await store.verifyUserPassword('alice', 'secret-password'), 'user_alice');
});

test('identity store preserves existing direct project grants when user access update omits them', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });
  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'secret-password',
    roleIds: ['role_reader'],
    directProjectGrants: [{ projectId: 'project_one', canRead: true, canCreate: true, canWrite: true }],
  });

  const updated = await store.updateUserAccess({
    id: 'user_alice',
    enabled: false,
    roleIds: ['role_viewer'],
  });

  assert.equal(updated.enabled, false);
  assert.deepEqual(updated.roleIds, ['role_viewer']);
  assert.deepEqual(updated.directProjectGrants, [
    { projectId: 'project_one', canRead: true, canCreate: true, canWrite: true },
  ]);
});

test('identity store derives blank project display names from the cwd leaf', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });

  const project = await store.upsertProject({
    id: 'project_mobile_web',
    internalName: 'legacy-internal-name',
    cwd: '/Users/alice/codex-mobile-web-app',
    displayName: '',
    enabled: true,
  });

  assert.equal(project.displayName, 'codex-mobile-web-app');
  assert.equal((await store.readState()).projects[0]?.displayName, 'codex-mobile-web-app');
});

test('identity store collapses path-like project display names to the final segment', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });

  const project = await store.upsertProject({
    id: 'project_mobile_web',
    internalName: 'vibecoding/codex-mobile-web-app',
    cwd: '/Users/alice/codex-mobile-web-app',
    displayName: 'vibecoding/codex-mobile-web-app',
    enabled: true,
  });

  assert.equal(project.displayName, 'codex-mobile-web-app');
});

test('identity store prevents case-insensitive duplicate project display names on create and rename', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });
  const first = await store.upsertProject({
    id: 'project_codex_web',
    internalName: 'codex-web',
    cwd: '/Users/alice/codex-web',
    displayName: 'CodeX Web',
    enabled: true,
    activeSessionLimit: null,
    showWorkDetailsToMembers: true,
  });

  await assert.rejects(
    () => store.upsertProject({
      id: 'project_duplicate',
      internalName: 'duplicate',
      cwd: '/Users/alice/duplicate',
      displayName: 'codex web',
      enabled: true,
      activeSessionLimit: null,
      showWorkDetailsToMembers: true,
    }),
    (error: any) => error?.code === 'project_display_name_conflict',
  );

  const other = await store.upsertProject({
    id: 'project_other',
    internalName: 'other',
    cwd: '/Users/alice/other',
    displayName: 'Other Project',
    enabled: true,
    activeSessionLimit: null,
    showWorkDetailsToMembers: true,
  });
  await assert.rejects(
    () => store.upsertProject({ ...other, displayName: 'CODEX WEB' }),
    (error: any) => error?.code === 'project_display_name_conflict',
  );

  const caseOnlyRename = await store.upsertProject({ ...first, displayName: 'CODEX WEB' });
  assert.equal(caseOnlyRename.displayName, 'CODEX WEB');
  assert.deepEqual(
    (await store.readState()).projects.map((project) => project.displayName).sort(),
    ['CODEX WEB', 'Other Project'],
  );
});

test('identity store defaults project active session limit to 30 and persists explicit overrides', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });

  const defaultProject = await store.upsertProject({
    id: 'project_default_limit',
    internalName: 'default-limit',
    cwd: '/Users/alice/default-limit',
    displayName: 'Default Limit',
    enabled: true,
  } as any);
  const unlimitedProject = await store.upsertProject({
    id: 'project_unlimited',
    internalName: 'unlimited',
    cwd: '/Users/alice/unlimited',
    displayName: 'Unlimited',
    enabled: true,
    activeSessionLimit: null,
  } as any);
  const customProject = await store.upsertProject({
    id: 'project_custom_limit',
    internalName: 'custom-limit',
    cwd: '/Users/alice/custom-limit',
    displayName: 'Custom Limit',
    enabled: true,
    activeSessionLimit: 12,
  } as any);

  assert.equal((defaultProject as any).activeSessionLimit, 30);
  assert.equal((unlimitedProject as any).activeSessionLimit, null);
  assert.equal((customProject as any).activeSessionLimit, 12);

  const state = await store.readState();
  assert.equal((state.projects.find((project) => project.id === 'project_default_limit') as any)?.activeSessionLimit, 30);
  assert.equal((state.projects.find((project) => project.id === 'project_unlimited') as any)?.activeSessionLimit, null);
  assert.equal((state.projects.find((project) => project.id === 'project_custom_limit') as any)?.activeSessionLimit, 12);
});

test('identity store defaults legacy project work details to visible and persists hidden projects', async () => {
  const identityPath = await tempIdentityPath();
  await fs.writeFile(identityPath, JSON.stringify({
    settings: { multiUserEnabled: true },
    projects: [{
      id: 'project_legacy',
      internalName: 'legacy',
      cwd: '/Users/alice/legacy',
      displayName: 'Legacy',
      enabled: true,
      activeSessionLimit: 30,
    }],
  }));
  const store = new FileIdentityStore({ identityPath });

  assert.equal((await store.readState()).projects[0]?.showWorkDetailsToMembers, true);

  const hidden = await store.upsertProject({
    id: 'project_hidden',
    internalName: 'hidden',
    cwd: '/Users/alice/hidden',
    displayName: 'Hidden',
    enabled: true,
    activeSessionLimit: 30,
    showWorkDetailsToMembers: false,
  });

  assert.equal(hidden.showWorkDetailsToMembers, false);
  assert.equal(
    (await store.readState()).projects.find((project) => project.id === 'project_hidden')?.showWorkDetailsToMembers,
    false,
  );
});

test('identity store persists archive metadata on app sessions', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });

  const archivedSession = await store.upsertSession({
    id: 'app_archived',
    codexThreadId: 'thread_archived',
    projectId: 'project_one',
    ownerUserId: 'user_alice',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    archived: true,
    archivedAt: '2026-06-01T01:00:00.000Z',
    archivedByUserId: 'user_alice',
    archiveSource: 'codex',
  } as any);

  assert.equal((archivedSession as any).archived, true);
  assert.equal((archivedSession as any).archivedAt, '2026-06-01T01:00:00.000Z');
  assert.equal((archivedSession as any).archivedByUserId, 'user_alice');
  assert.equal((archivedSession as any).archiveSource, 'codex');

  const state = await store.readState();
  const persisted = state.sessions.find((session) => session.id === 'app_archived') as any;
  assert.equal(persisted?.archived, true);
  assert.equal(persisted?.archivedAt, '2026-06-01T01:00:00.000Z');
  assert.equal(persisted?.archivedByUserId, 'user_alice');
  assert.equal(persisted?.archiveSource, 'codex');
});

test('identity store deletes a user and cleans related sessions, shares, auth sessions, and webhook credentials', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });
  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'secret-password',
    roleIds: [],
    directProjectGrants: [],
  });
  await store.upsertSession({
    id: 'app_alice',
    codexThreadId: 'thread_alice',
    projectId: 'project_one',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  });
  await store.createShare({
    sessionId: 'app_alice',
    createdByUserId: 'user_alice',
  });
  await store.addUserSession({
    id: 'auth_alice',
    tokenHash: 'hashed-token',
    deviceName: 'Alice Phone',
    createdAt: '2026-05-27T00:00:00.000Z',
    lastSeenAt: '2026-05-27T00:00:00.000Z',
    userId: 'user_alice',
  });
  await store.setWebhookEnabled('user_alice', true);

  await store.deleteUser('user_alice');

  const state = await store.readState();
  assert.equal(state.users.some((user) => user.id === 'user_alice'), false);
  assert.equal(state.sessions.some((session) => session.ownerUserId === 'user_alice'), false);
  assert.equal(state.shares.some((share) => share.createdByUserId === 'user_alice' || share.sessionId === 'app_alice'), false);
  assert.equal(state.userSessions.some((session) => session.userId === 'user_alice'), false);
  assert.equal(state.webhookCredentials.some((credential) => credential.ownerUserId === 'user_alice'), false);
});

test('access control merges role grants and direct user grants', async () => {
  const state = {
    settings: { multiUserEnabled: true },
    users: [{
      id: 'user_alice',
      username: 'alice',
      enabled: true,
      canNewSession: true,
      roleIds: ['role_reader'],
      directProjectGrants: [{ projectId: 'project_two', canRead: true, canCreate: true, canWrite: false }],
    }],
    roles: [{
      id: 'role_reader',
      name: 'Reader',
      isAdmin: false,
      projectGrants: [{ projectId: 'project_one', canRead: true, canCreate: false, canWrite: false }],
    }],
    projects: [],
    sessions: [],
    shares: [],
  };
  const principal = {
    userId: 'user_alice',
    username: 'alice',
    roleIds: ['role_reader'],
    isAdmin: false,
    mode: 'multi' as const,
  };

  assert.deepEqual(effectiveProjectGrant(state, principal, 'project_one'), {
    projectId: 'project_one',
    canRead: true,
    canCreate: false,
    canWrite: false,
  });
  assert.deepEqual(effectiveProjectGrant(state, principal, 'project_two'), {
    projectId: 'project_two',
    canRead: true,
    canCreate: true,
    canWrite: false,
  });
  assert.equal(canCreateProjectSession(state, principal, 'project_two'), true);
  assert.equal(canCreateProjectSession(state, principal, 'project_one'), false);
});

test('explicit create grant still allows creation when legacy canNewSession is false', async () => {
  const state = {
    settings: { multiUserEnabled: true },
    users: [{
      id: 'user_alice',
      username: 'alice',
      enabled: true,
      canNewSession: false,
      roleIds: ['role_reader'],
      directProjectGrants: [],
    }],
    roles: [{
      id: 'role_reader',
      name: 'Reader',
      isAdmin: false,
      projectGrants: [{ projectId: 'project_one', canRead: true, canCreate: true, canWrite: false }],
    }],
    projects: [],
    sessions: [],
    shares: [],
    userSessions: [],
  };
  const principal = {
    userId: 'user_alice',
    username: 'alice',
    roleIds: ['role_reader'],
    isAdmin: false,
    mode: 'multi' as const,
  };

  assert.deepEqual(effectiveProjectGrant(state, principal, 'project_one'), {
    projectId: 'project_one',
    canRead: true,
    canCreate: true,
    canWrite: false,
  });
  assert.equal(canCreateProjectSession(state, principal, 'project_one'), true);
});

test('access control restricts ordinary users to owned sessions', async () => {
  const state = {
    settings: { multiUserEnabled: true },
    users: [{
      id: 'user_alice',
      username: 'alice',
      enabled: true,
      canNewSession: true,
      roleIds: [],
      directProjectGrants: [{ projectId: 'project_one', canRead: true, canCreate: true, canWrite: true }],
    }],
    roles: [],
    projects: [],
    sessions: [
      { id: 'app_own', codexThreadId: 'thread_own', projectId: 'project_one', ownerUserId: 'user_alice', createdAt: '', updatedAt: '' },
      { id: 'app_other', codexThreadId: 'thread_other', projectId: 'project_one', ownerUserId: 'user_bob', createdAt: '', updatedAt: '' },
    ],
    shares: [],
  };
  const principal = {
    userId: 'user_alice',
    username: 'alice',
    roleIds: [],
    isAdmin: false,
    mode: 'multi' as const,
  };

  assert.equal(canReadAppSession(state, principal, state.sessions[0]!), true);
  assert.equal(canWriteAppSession(state, principal, state.sessions[0]!), true);
  assert.equal(canReadAppSession(state, principal, state.sessions[1]!), false);
  assert.equal(canWriteAppSession(state, principal, state.sessions[1]!), false);
});

test('identity store stores only hashed share tokens', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });

  const created = await store.createShare({ sessionId: 'app_session_1', createdByUserId: 'user_admin' });
  const state = await store.readState();
  const [share] = state.shares;

  assert.match(created.token, /^cws_/u);
  assert.equal(share?.tokenHash.includes(created.token), false);
  assert.equal(typeof share?.expiresAt, 'string');
  assert.equal(share?.revokedAt, null);
  assert.equal(await store.findShareByToken(created.token), share?.id);
  assert.equal(await store.findShareByToken('wrong-token'), null);
});

test('identity store rejects expired and revoked share capabilities', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });
  const expired = await store.createShare({
    sessionId: 'app_expired',
    createdByUserId: 'user_alice',
    ttlSeconds: 0.001,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await store.findShareByToken(expired.token), null);

  const active = await store.createShare({
    sessionId: 'app_active',
    createdByUserId: 'user_alice',
    ttlSeconds: 60,
  });
  assert.equal(await store.findShareByToken(active.token), active.share.id);
  const revoked = await store.revokeShare(active.share.id);
  assert.equal(revoked?.enabled, false);
  assert.equal(typeof revoked?.revokedAt, 'string');
  assert.equal(await store.findShareByToken(active.token), null);
});
