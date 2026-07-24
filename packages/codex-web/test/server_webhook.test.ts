import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CodexWebPrincipal } from '../src/access_control.js';
import { FileIdentityStore } from '../src/identity_store.js';
import { createCodexWebServer } from '../src/server.js';

function createConfig(stateDir: string, defaultCwd = '/tmp/webhook-default') {
  return {
    host: '127.0.0.1',
    port: 0,
    defaultCwd,
    codexBin: 'codex',
    stateDir,
    authPath: path.join(stateDir, 'auth.json'),
    reportsDir: path.join(stateDir, 'reports'),
    reportIndexPath: path.join(stateDir, 'report-index.json'),
    envPath: path.join(stateDir, 'service.env'),
    debug: false,
    publicSharesEnabled: false,
    publicShareTtlSeconds: 86_400,
    managedStorageMaxBytes: 128 * 1024 * 1024,
    projectUploadMaxBytes: 128 * 1024 * 1024,
    uploadTtlSeconds: 86_400,
    turnAttachmentTtlSeconds: 86_400,
    reportTtlSeconds: 86_400,
    runtimeContextTtlSeconds: 86_400,
    timelineMaxEntriesPerSession: 1_000,
    timelineMaxBytes: 10 * 1024 * 1024,
  };
}

function authFor(principals: Record<string, CodexWebPrincipal | null>) {
  return {
    isConfigured: async () => true,
    login: async () => {
      throw new Error('unused');
    },
    verifyToken: async (token: string | null | undefined) => {
      if (!token || !Object.prototype.hasOwnProperty.call(principals, token)) {
        return null;
      }
      const principal = principals[token];
      return {
        id: `auth_${token}`,
        deviceName: 'test',
        createdAt: '',
        lastSeenAt: '',
        ...(principal ? { principal } : {}),
      };
    },
    logout: async () => {},
  };
}

function runtimeStub() {
  const sessions = new Map<string, any>();
  const createInputs: any[] = [];
  const startInputs: Array<{ sessionId: string; input: any }> = [];
  return {
    sessions,
    createInputs,
    startInputs,
    listModels: async () => [],
    readUsage: async () => null,
    listSessions: async () => [...sessions.values()],
    createSession: async (input: any) => {
      createInputs.push(input);
      const id = `thread_${createInputs.length}`;
      const session = {
        id,
        cwd: input.cwd ?? null,
        title: input.title ?? null,
        settings: input.settings ?? {},
        activityState: null,
        thread: { id, turns: [] },
        timeline: [],
      };
      sessions.set(id, session);
      return session;
    },
    readSession: async (id: string) => sessions.get(id) ?? null,
    archiveSession: async () => true,
    updateSessionFavorite: async () => null,
    updateSessionSettings: async () => null,
    reloadRuntime: async () => ({ mcpServersReloaded: false }),
    startTurn: async (sessionId: string, input: any) => {
      startInputs.push({ sessionId, input });
      return { turnId: `turn_${startInputs.length}` };
    },
    interruptTurn: async () => {},
    resolveApproval: async () => {},
    getTurnEvents: () => [],
    subscribeToTurn: () => () => {},
  };
}

async function createMultiUserStore(stateDir: string) {
  const store = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  await store.setMultiUserEnabled(true);
  await store.upsertProject({
    id: 'project_shared',
    internalName: 'shared',
    cwd: '/private/shared-project',
    displayName: 'Shared Project',
    enabled: true,
    activeSessionLimit: null,
    showWorkDetailsToMembers: false,
  });
  await store.upsertRole({
    id: 'role_member',
    name: 'Member',
    isAdmin: false,
    projectGrants: [{ projectId: 'project_shared', canRead: true, canCreate: true, canWrite: true }],
  });
  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'alice-password',
    roleIds: ['role_member'],
    directProjectGrants: [],
  });
  return store;
}

const alicePrincipal: CodexWebPrincipal = {
  userId: 'user_alice',
  username: 'alice',
  roleIds: ['role_member'],
  isAdmin: false,
  mode: 'multi',
};

async function browserRequest(
  baseUrl: string,
  pathname: string,
  options: { method?: string; body?: Record<string, unknown>; token?: string } = {},
) {
  return fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${options.token ?? 'browser'}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function webhookRequest(
  baseUrl: string,
  key: string,
  idempotencyKey: string | null,
  body: Record<string, unknown>,
) {
  return fetch(`${baseUrl}/api/webhook`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey === null ? {} : { 'Idempotency-Key': idempotencyKey }),
    },
    body: JSON.stringify(body),
  });
}

function streamingWebhookRequest(
  baseUrl: string,
  key: string,
  idempotencyKey: string,
): { request: http.ClientRequest; response: Promise<{ status: number; body: any }> } {
  let request!: http.ClientRequest;
  const response = new Promise<{ status: number; body: any }>((resolve, reject) => {
    request = http.request(`${baseUrl}/api/webhook`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve({ status: incoming.statusCode ?? 0, body });
      });
    });
    request.on('error', reject);
  });
  return { request, response };
}

test('webhook management is self-scoped and a webhook creates one owner-mapped session and turn', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-multi-'));
  const identityStore = await createMultiUserStore(stateDir);
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({ browser: alicePrincipal }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    const initial = await browserRequest(server.baseUrl, '/api/webhook');
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), {
      webhook: {
        enabled: false,
        hasKey: false,
        keyHint: null,
        endpointPath: '/api/webhook',
      },
      key: null,
    });

    const enabled = await browserRequest(server.baseUrl, '/api/webhook', {
      method: 'PATCH',
      body: { enabled: true },
    });
    assert.equal(enabled.status, 200);
    const enabledPayload = await enabled.json() as any;
    assert.match(enabledPayload.key, /^cwwh_/u);
    assert.equal(enabledPayload.webhook.keyHint, enabledPayload.key.slice(-6));
    const key = enabledPayload.key as string;

    const reread = await browserRequest(server.baseUrl, '/api/webhook');
    const rereadPayload = await reread.json() as any;
    assert.equal(rereadPayload.key, key);
    assert.deepEqual(rereadPayload.webhook, enabledPayload.webhook);
    const enabledAgain = await browserRequest(server.baseUrl, '/api/webhook', {
      method: 'PATCH',
      body: { enabled: true },
    });
    assert.equal((await enabledAgain.json() as any).key, key);

    const eventId = 'github:delivery:123';
    const requestBody = {
      text: 'Review the incoming change',
      projectId: 'Shared Project',
      title: 'Webhook review',
    };
    const first = await webhookRequest(server.baseUrl, key, eventId, requestBody);
    assert.equal(first.status, 201);
    const firstPayload = await first.json() as any;
    assert.equal(
      firstPayload.submission.id,
      `webhook:${crypto.createHash('sha256').update(eventId).digest('hex')}`,
    );
    assert.equal(firstPayload.session.ownerUserId, 'user_alice');
    assert.equal(firstPayload.session.projectId, 'project_shared');
    assert.equal(firstPayload.session.cwd, undefined);
    assert.equal(firstPayload.turnId, 'turn_1');
    assert.deepEqual(runtime.createInputs, [{
      cwd: '/private/shared-project',
      title: 'Webhook review',
      settings: {},
    }]);
    assert.equal(runtime.startInputs[0]?.sessionId, 'thread_1');
    assert.equal(runtime.startInputs[0]?.input.text, 'Review the incoming change');
    assert.deepEqual(runtime.startInputs[0]?.input.settings, {});
    assert.match(runtime.startInputs[0]?.input.developerInstructions, /Codex Web context file:/u);

    const state = await identityStore.readState();
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0]?.ownerUserId, 'user_alice');
    assert.equal(state.sessions[0]?.codexThreadId, 'thread_1');
    assert.equal(state.webhookCredentials[0]?.tokenHash.includes(key), false);
    assert.equal(state.webhookCredentials[0]?.key, key);

    const replay = await webhookRequest(server.baseUrl, key, eventId, requestBody);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as any).turnId, 'turn_1');
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.length, 1);

    const conflict = await webhookRequest(server.baseUrl, key, eventId, {
      ...requestBody,
      text: 'Different content',
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json() as any).error, 'submission_conflict');
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.length, 1);

    const keyCannotReadApis = await browserRequest(server.baseUrl, '/api/settings', { token: key });
    assert.equal(keyCannotReadApis.status, 401);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('webhook project references ignore display-name case and reject ambiguous legacy names', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-project-name-'));
  const identityStore = await createMultiUserStore(stateDir);
  await identityStore.upsertProject({
    id: 'project_duplicate',
    internalName: 'duplicate',
    cwd: '/private/duplicate-project',
    displayName: 'Shared Project',
    enabled: true,
    activeSessionLimit: null,
    showWorkDetailsToMembers: false,
  }, { allowDisplayNameConflict: true });
  const created = await identityStore.setWebhookEnabled('user_alice', true);
  const key = created.key!;
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({ browser: alicePrincipal }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    const uniqueVisibleName = await webhookRequest(server.baseUrl, key, 'visible-name', {
      text: 'Use the only accessible project with this name',
      projectId: 'sHaReD pRoJeCt',
    });
    assert.equal(uniqueVisibleName.status, 201);
    assert.equal((await uniqueVisibleName.json() as any).session.projectId, 'project_shared');
    assert.equal(runtime.createInputs[0]?.cwd, '/private/shared-project');

    await identityStore.upsertRole({
      id: 'role_member',
      name: 'Member',
      isAdmin: false,
      projectGrants: [
        { projectId: 'project_shared', canRead: true, canCreate: true, canWrite: true },
        { projectId: 'project_duplicate', canRead: true, canCreate: true, canWrite: true },
      ],
    });
    const ambiguousVisibleName = await webhookRequest(server.baseUrl, key, 'ambiguous-name', {
      text: 'Must not choose a project arbitrarily',
      projectId: 'Shared Project',
    });
    assert.equal(ambiguousVisibleName.status, 409);
    assert.equal((await ambiguousVisibleName.json() as any).error, 'ambiguous_project_reference');
    assert.equal(runtime.createInputs.length, 1);

    const exactId = await webhookRequest(server.baseUrl, key, 'exact-project-id', {
      text: 'Use the exact project id',
      projectId: 'project_duplicate',
    });
    assert.equal(exactId.status, 201);
    assert.equal((await exactId.json() as any).session.projectId, 'project_duplicate');
    assert.equal(runtime.createInputs[1]?.cwd, '/private/duplicate-project');

    const unknownName = await webhookRequest(server.baseUrl, key, 'unknown-project-name', {
      text: 'Unknown projects must not run',
      projectId: 'Missing Project',
    });
    assert.equal(unknownName.status, 404);
    assert.equal((await unknownName.json() as any).error, 'project_not_found');
    assert.equal(runtime.createInputs.length, 2);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('rotated, disabled, unauthorized, and mode-mismatched webhook keys fail closed', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-auth-'));
  const identityStore = await createMultiUserStore(stateDir);
  const firstCredential = await identityStore.setWebhookEnabled('user_alice', true);
  const firstKey = firstCredential.key!;
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({ browser: alicePrincipal }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    const invalid = await webhookRequest(server.baseUrl, 'cwwh_invalid', 'invalid-key', {
      text: 'must not run',
      projectId: 'project_shared',
    });
    assert.equal(invalid.status, 401);

    const rotated = await browserRequest(server.baseUrl, '/api/webhook/rotate', { method: 'POST' });
    assert.equal(rotated.status, 200);
    const rotatedPayload = await rotated.json() as any;
    assert.match(rotatedPayload.key, /^cwwh_/u);
    assert.notEqual(rotatedPayload.key, firstKey);
    const secondKey = rotatedPayload.key as string;

    const oldKey = await webhookRequest(server.baseUrl, firstKey, 'old-key', {
      text: 'must not run',
      projectId: 'project_shared',
    });
    assert.equal(oldKey.status, 401);
    const accepted = await webhookRequest(server.baseUrl, secondKey, 'accepted', {
      text: 'run once',
      projectId: 'project_shared',
    });
    assert.equal(accepted.status, 201);
    assert.equal(runtime.createInputs.length, 1);

    const disabled = await browserRequest(server.baseUrl, '/api/webhook', {
      method: 'PATCH',
      body: { enabled: false },
    });
    assert.equal(disabled.status, 200);
    assert.equal((await disabled.json() as any).key, secondKey);
    const disabledKey = await webhookRequest(server.baseUrl, secondKey, 'disabled', {
      text: 'must not run',
      projectId: 'project_shared',
    });
    assert.equal(disabledKey.status, 401);

    const reenabled = await browserRequest(server.baseUrl, '/api/webhook', {
      method: 'PATCH',
      body: { enabled: true },
    });
    assert.equal((await reenabled.json() as any).key, secondKey);
    await identityStore.updateUserAccess({ id: 'user_alice', roleIds: [] });
    const revokedGrant = await webhookRequest(server.baseUrl, secondKey, 'revoked-grant', {
      text: 'must not run',
      projectId: 'project_shared',
    });
    assert.equal(revokedGrant.status, 404);
    assert.equal((await revokedGrant.json() as any).error, 'project_not_found');
    assert.equal(runtime.createInputs.length, 1);

    await identityStore.updateUserAccess({ id: 'user_alice', roleIds: ['role_member'], enabled: false });
    const disabledUser = await webhookRequest(server.baseUrl, secondKey, 'disabled-user', {
      text: 'must not run',
      projectId: 'project_shared',
    });
    assert.equal(disabledUser.status, 401);
    assert.equal(runtime.createInputs.length, 1);

    await identityStore.updateUserAccess({ id: 'user_alice', enabled: true });
    await identityStore.setMultiUserEnabled(false);
    const wrongMode = await webhookRequest(server.baseUrl, secondKey, 'wrong-mode', {
      text: 'must not run',
      projectId: 'project_shared',
    });
    assert.equal(wrongMode.status, 401);
    assert.equal(runtime.createInputs.length, 1);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('single-user webhooks use the server default cwd and reject unsupported payload fields', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-single-'));
  const identityStore = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  const created = await identityStore.setWebhookEnabled('local-admin', true);
  const key = created.key!;
  const runtime = runtimeStub();
  const defaultCwd = '/private/default-project';
  const server = createCodexWebServer({
    auth: authFor({ browser: null }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir, defaultCwd),
  });
  await server.start();
  try {
    const invalidBodies = [
      { text: 'x', settings: {} },
      { text: 'x', cwd: '/tmp/override' },
      { text: 'x', sessionId: 'thread_existing' },
      { text: 'x', attachments: [] },
      { text: 'x', unexpected: true },
      { title: 'missing text' },
      { text: 'x', title: 42 },
      { text: 'x', projectId: 'project_shared' },
    ];
    for (const [index, body] of invalidBodies.entries()) {
      const response = await webhookRequest(server.baseUrl, key, `invalid-${index}`, body);
      assert.equal(response.status, 400, `payload ${index} should be rejected`);
      assert.equal((await response.json() as any).error, 'invalid_webhook_payload');
    }
    assert.equal(runtime.createInputs.length, 0);

    const accepted = await webhookRequest(server.baseUrl, key, 'single-valid', {
      text: 'Run in the default project',
      title: 'Single-user webhook',
    });
    assert.equal(accepted.status, 201);
    assert.deepEqual(runtime.createInputs, [{
      cwd: null,
      title: 'Single-user webhook',
      settings: {},
    }]);
    assert.deepEqual(runtime.startInputs[0]?.input, {
      text: 'Run in the default project',
      settings: {},
      attachments: [],
      attachmentIds: [],
    });
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('webhooks require a bounded Idempotency-Key before creating a session', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-idempotency-'));
  const identityStore = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  const created = await identityStore.setWebhookEnabled('local-admin', true);
  const key = created.key!;
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({ browser: null }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    const missing = await webhookRequest(server.baseUrl, key, null, { text: 'missing key' });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json() as any).error, 'invalid_idempotency_key');
    const tooLong = await webhookRequest(server.baseUrl, key, 'x'.repeat(257), { text: 'long key' });
    assert.equal(tooLong.status, 400);
    assert.equal((await tooLong.json() as any).error, 'invalid_idempotency_key');
    assert.equal(runtime.createInputs.length, 0);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('invalid webhook tokens are rate limited before credential lookup', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-invalid-rate-'));
  const identityStore = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({ browser: null }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    const invalidKey = `cwwh_${'z'.repeat(43)}`;
    for (let index = 0; index < 10; index += 1) {
      const response = await webhookRequest(server.baseUrl, invalidKey, `invalid-rate-${index}`, { text: 'must not run' });
      assert.equal(response.status, 401);
    }
    const limited = await webhookRequest(server.baseUrl, invalidKey, 'invalid-rate-10', { text: 'must not run' });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json() as any).error, 'rate_limited');
    assert.equal(limited.headers.get('retry-after') !== null, true);
    assert.equal(runtime.createInputs.length, 0);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('webhook credentials are revalidated after reading the request body', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-revalidate-'));
  const store = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  const created = await store.setWebhookEnabled('local-admin', true);
  const key = created.key!;
  const runtime = runtimeStub();
  let initialCredentialRead = false;
  let resolveInitialAuthorization!: () => void;
  const initialAuthorization = new Promise<void>((resolve) => {
    resolveInitialAuthorization = resolve;
  });
  const identityStore = {
    readState: async () => {
      const state = await store.readState();
      if (initialCredentialRead) {
        initialCredentialRead = false;
        resolveInitialAuthorization();
      }
      return state;
    },
    upsertSession: store.upsertSession.bind(store),
    findWebhookCredentialByToken: async (token: string) => {
      const credential = await store.findWebhookCredentialByToken(token);
      initialCredentialRead = true;
      return credential;
    },
  };
  const server = createCodexWebServer({
    auth: authFor({ browser: null }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    const pending = streamingWebhookRequest(server.baseUrl, key, 'rotated-during-body');
    pending.request.write('{"text":"rotate while reading');
    await initialAuthorization;
    await store.rotateWebhookKey('local-admin');
    pending.request.end('"}');

    const response = await pending.response;
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Unauthorized');
    assert.equal(runtime.createInputs.length, 0);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('valid webhook keys are limited to ten requests per minute', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-rate-'));
  const identityStore = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  const created = await identityStore.setWebhookEnabled('local-admin', true);
  const key = created.key!;
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({ browser: null }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    for (let index = 0; index < 10; index += 1) {
      const response = await webhookRequest(server.baseUrl, key, `rate-${index}`, { text: `request ${index}` });
      assert.equal(response.status, 201);
    }
    const limited = await webhookRequest(server.baseUrl, key, 'rate-10', { text: 'request 10' });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json() as any).error, 'rate_limited');
    assert.equal(limited.headers.get('retry-after') !== null, true);
    assert.equal(runtime.createInputs.length, 10);
    assert.equal(runtime.startInputs.length, 10);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
