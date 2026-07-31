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
import {
  FileSessionSubmissionStore,
  hashSessionSubmissionPayload,
  type CodexWebSessionSubmissionPayload,
} from '../src/session_submission_store.js';
import { FileWebhookConversationStore } from '../src/webhook_conversation_store.js';

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
  const archivedSessionIds = new Set<string>();
  const createInputs: any[] = [];
  const startInputs: Array<{ sessionId: string; input: any }> = [];
  const steerInputs: Array<{ sessionId: string; turnId: string; input: any; clientUserMessageId: string | null }> = [];
  return {
    sessions,
    archivedSessionIds,
    createInputs,
    startInputs,
    steerInputs,
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
        activeTurnId: null,
        activityState: null,
        thread: { id, turns: [] },
        timeline: [],
      };
      sessions.set(id, session);
      return session;
    },
    readSession: async (id: string) => sessions.get(id) ?? null,
    isSessionArchived: (id: string) => archivedSessionIds.has(id),
    archiveSession: async () => true,
    updateSessionFavorite: async () => null,
    updateSessionSettings: async () => null,
    reloadRuntime: async () => ({ mcpServersReloaded: false }),
    startTurn: async (sessionId: string, input: any) => {
      startInputs.push({ sessionId, input });
      return { turnId: `turn_${startInputs.length}` };
    },
    steerTurnForThread: async (
      sessionId: string,
      turnId: string,
      input: any,
      clientUserMessageId: string | null,
    ) => {
      steerInputs.push({ sessionId, turnId, input, clientUserMessageId });
      return { turnId };
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

test('webhook management is self-scoped and one key keeps routing turns to the same owner session', async () => {
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
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
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
    assert.equal(runtime.createInputs.length, 1);
    const { runtimeEnv, ...createInput } = runtime.createInputs[0];
    assert.deepEqual(createInput, {
      cwd: '/private/shared-project',
      title: 'Webhook review',
      settings: { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    });
    assert.match(
      runtimeEnv?.CODEX_WEB_CONTEXT_FILE,
      new RegExp(`${firstPayload.session.id}-[0-9a-f]{16}\\.json$`, 'u'),
    );
    assert.equal(runtime.startInputs[0]?.sessionId, 'thread_1');
    assert.equal(runtime.startInputs[0]?.input.text, 'Review the incoming change');
    assert.deepEqual(runtime.startInputs[0]?.input.settings, {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    });
    assert.match(runtime.startInputs[0]?.input.developerInstructions, /Codex Web context file:/u);

    const state = await identityStore.readState();
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0]?.ownerUserId, 'user_alice');
    assert.equal(state.sessions[0]?.codexThreadId, 'thread_1');
    assert.equal(state.webhookCredentials[0]?.tokenHash.includes(key), false);
    assert.equal(state.webhookCredentials[0]?.key, key);

    runtime.sessions.get('thread_1').activeTurnId = 'turn_1';
    const steered = await webhookRequest(server.baseUrl, key, eventId, {
      ...requestBody,
      text: 'Include the latest requirement',
      model: 'gpt-5.6-luna',
    });
    assert.equal(steered.status, 202);
    assert.equal((await steered.json() as any).turnId, 'turn_1');
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.length, 1);
    assert.equal(runtime.steerInputs.length, 1);
    assert.equal(runtime.steerInputs[0]?.sessionId, 'thread_1');
    assert.equal(runtime.steerInputs[0]?.turnId, 'turn_1');
    assert.equal(runtime.steerInputs[0]?.input.text, 'Include the latest requirement');
    assert.match(runtime.steerInputs[0]?.clientUserMessageId ?? '', /^webhook:/u);

    runtime.sessions.get('thread_1').activeTurnId = null;
    const continuedBody = {
      ...requestBody,
      text: 'Run the follow-up checks',
      model: 'gpt-5.6-luna',
    };
    const continued = await webhookRequest(server.baseUrl, key, eventId, continuedBody);
    assert.equal(continued.status, 202);
    assert.equal((await continued.json() as any).turnId, 'turn_2');
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.length, 2);
    assert.equal(runtime.startInputs[1]?.sessionId, 'thread_1');
    assert.equal(runtime.startInputs[1]?.input.text, 'Run the follow-up checks');
    assert.deepEqual(runtime.startInputs[1]?.input.settings, {
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
    });

    const repeatedText = await webhookRequest(server.baseUrl, key, eventId, continuedBody);
    assert.equal(repeatedText.status, 202);
    assert.equal((await repeatedText.json() as any).turnId, 'turn_3');
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.length, 3);
    assert.equal(runtime.startInputs[2]?.sessionId, 'thread_1');
    assert.equal(runtime.startInputs[2]?.input.text, 'Run the follow-up checks');

    const anotherConversation = await webhookRequest(server.baseUrl, key, 'github:delivery:other', requestBody);
    assert.equal(anotherConversation.status, 201);
    assert.equal(runtime.createInputs.length, 2);
    assert.equal(runtime.startInputs.length, 4);
    assert.equal(runtime.startInputs[3]?.sessionId, 'thread_2');

    const keyCannotReadApis = await browserRequest(server.baseUrl, '/api/settings', { token: key });
    assert.equal(keyCannotReadApis.status, 401);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('the same webhook conversation key is isolated between different owners', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-owner-isolation-'));
  const identityStore = await createMultiUserStore(stateDir);
  await identityStore.upsertUserWithPassword({
    id: 'user_bob',
    username: 'bob',
    password: 'bob-password',
    roleIds: ['role_member'],
    directProjectGrants: [],
  });
  const aliceCredential = await identityStore.setWebhookEnabled('user_alice', true);
  const bobCredential = await identityStore.setWebhookEnabled('user_bob', true);
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({ browser: alicePrincipal }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    const conversationKey = 'shared-external-conversation-id';
    const aliceFirst = await webhookRequest(server.baseUrl, aliceCredential.key!, conversationKey, {
      projectId: 'Shared Project',
      text: 'Alice first message',
    });
    const bobFirst = await webhookRequest(server.baseUrl, bobCredential.key!, conversationKey, {
      projectId: 'Shared Project',
      text: 'Bob first message',
    });
    assert.equal(aliceFirst.status, 201);
    assert.equal(bobFirst.status, 201);
    const alicePayload = await aliceFirst.json() as any;
    const bobPayload = await bobFirst.json() as any;
    assert.notEqual(alicePayload.session.id, bobPayload.session.id);
    assert.equal(alicePayload.session.ownerUserId, 'user_alice');
    assert.equal(bobPayload.session.ownerUserId, 'user_bob');

    const aliceContinued = await webhookRequest(server.baseUrl, aliceCredential.key!, conversationKey, {
      projectId: 'Shared Project',
      text: 'Alice second message',
    });
    assert.equal(aliceContinued.status, 202);
    assert.equal(runtime.createInputs.length, 2);
    assert.equal(runtime.startInputs[2]?.sessionId, 'thread_1');
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('webhook conversation routing survives a server restart', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-restart-'));
  const identityStore = await createMultiUserStore(stateDir);
  const runtime = runtimeStub();
  const config = createConfig(stateDir);
  const createServer = () => createCodexWebServer({
    auth: authFor({ browser: alicePrincipal }),
    identityStore,
    runtime: runtime as any,
    config,
  });

  const firstServer = createServer();
  await firstServer.start();
  let key = '';
  try {
    const enabled = await browserRequest(firstServer.baseUrl, '/api/webhook', {
      method: 'PATCH',
      body: { enabled: true },
    });
    key = String((await enabled.json() as any).key);
    const first = await webhookRequest(firstServer.baseUrl, key, 'conversation-after-restart', {
      projectId: 'Shared Project',
      text: 'First message',
    });
    assert.equal(first.status, 201);
  } finally {
    await firstServer.stop();
  }

  const restarted = createServer();
  await restarted.start();
  try {
    const continued = await webhookRequest(restarted.baseUrl, key, 'conversation-after-restart', {
      projectId: 'Shared Project',
      text: 'Second message',
    });
    assert.equal(continued.status, 202);
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.length, 2);
    assert.equal(runtime.startInputs[1]?.sessionId, 'thread_1');
  } finally {
    await restarted.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('server startup migrates successful legacy webhook submissions into conversation routing', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-legacy-migration-'));
  const identityStore = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  const created = await identityStore.setWebhookEnabled('local-admin', true);
  const key = created.key!;
  const idempotencyKey = 'legacy-webhook-delivery';
  const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
  const legacyPayload: CodexWebSessionSubmissionPayload = {
    sessionId: null,
    projectId: null,
    cwd: null,
    title: 'Legacy webhook',
    settings: {},
    text: 'Original message',
    attachments: [],
    attachmentIds: [],
  };
  const submissionStore = new FileSessionSubmissionStore({ stateDir });
  const conversationStore = new FileWebhookConversationStore({ stateDir });
  await submissionStore.create({
    id: `webhook:${keyHash}`,
    ownerUserId: 'local-admin',
    payloadHash: hashSessionSubmissionPayload(legacyPayload),
    payload: legacyPayload,
    status: 'submitted',
    sessionId: 'thread_legacy',
    runtimeSessionId: 'thread_legacy',
    turnBaseline: null,
    turnId: 'turn_legacy',
    result: { turnId: 'turn_legacy' },
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
  });
  const runtime = runtimeStub();
  runtime.sessions.set('thread_legacy', {
    id: 'thread_legacy',
    cwd: '/tmp/webhook-default',
    title: 'Legacy webhook',
    settings: {},
    activeTurnId: null,
    activityState: null,
    thread: { id: 'thread_legacy', turns: [] },
    timeline: [],
  });
  const server = createCodexWebServer({
    auth: authFor({ browser: null }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
    sessionSubmissionStore: submissionStore,
    webhookConversationStore: conversationStore,
  });
  await server.start();
  try {
    const migrated = await conversationStore.read('local-admin', keyHash);
    assert.equal(migrated?.sessionId, 'thread_legacy');
    assert.equal(migrated?.projectId, null);

    const continued = await webhookRequest(server.baseUrl, key, idempotencyKey, {
      text: 'Continue after the upgrade',
    });
    assert.equal(continued.status, 202);
    assert.equal(runtime.createInputs.length, 0);
    assert.equal(runtime.startInputs.length, 1);
    assert.equal(runtime.startInputs[0]?.sessionId, 'thread_legacy');
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('mapped single-user webhook sessions fail closed when archived or missing', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-mapped-session-'));
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
    const first = await webhookRequest(server.baseUrl, key, 'mapped-session', { text: 'First message' });
    assert.equal(first.status, 201);
    runtime.archivedSessionIds.add('thread_1');

    const archived = await webhookRequest(server.baseUrl, key, 'mapped-session', { text: 'Archived follow-up' });
    assert.equal(archived.status, 409);
    assert.equal((await archived.json() as any).error, 'session_archived');
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.length, 1);

    runtime.archivedSessionIds.delete('thread_1');
    runtime.sessions.delete('thread_1');
    const missing = await webhookRequest(server.baseUrl, key, 'mapped-session', { text: 'Missing follow-up' });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as any).error, 'session_not_found');
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.length, 1);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('rotating the webhook credential keeps conversation routing for its owner', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-rotation-routing-'));
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
    const enabled = await browserRequest(server.baseUrl, '/api/webhook', {
      method: 'PATCH',
      body: { enabled: true },
    });
    const firstKey = String((await enabled.json() as any).key);
    const first = await webhookRequest(server.baseUrl, firstKey, 'rotation-conversation', {
      projectId: 'Shared Project',
      text: 'First message',
    });
    assert.equal(first.status, 201);

    const rotated = await browserRequest(server.baseUrl, '/api/webhook/rotate', { method: 'POST' });
    const secondKey = String((await rotated.json() as any).key);
    const continued = await webhookRequest(server.baseUrl, secondKey, 'rotation-conversation', {
      projectId: 'Shared Project',
      text: 'Second message',
    });
    assert.equal(continued.status, 202);
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.length, 2);
    assert.equal(runtime.startInputs[1]?.sessionId, 'thread_1');
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('existing webhook conversations require write access but not permission to create another session', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-write-access-'));
  const identityStore = await createMultiUserStore(stateDir);
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
    const first = await webhookRequest(server.baseUrl, key, 'write-only-continuation', {
      projectId: 'Shared Project',
      text: 'First message',
    });
    assert.equal(first.status, 201);
    await identityStore.upsertRole({
      id: 'role_member',
      name: 'Member',
      isAdmin: false,
      projectGrants: [{ projectId: 'project_shared', canRead: true, canCreate: false, canWrite: true }],
    });

    const continued = await webhookRequest(server.baseUrl, key, 'write-only-continuation', {
      projectId: 'Shared Project',
      text: 'Continue the existing session',
    });
    assert.equal(continued.status, 202);
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.at(-1)?.sessionId, 'thread_1');

    const newConversation = await webhookRequest(server.baseUrl, key, 'cannot-create-another', {
      projectId: 'Shared Project',
      text: 'Must not create another session',
    });
    assert.equal(newConversation.status, 404);
    assert.equal((await newConversation.json() as any).error, 'project_not_found');
    assert.equal(runtime.createInputs.length, 1);

    await identityStore.upsertRole({
      id: 'role_member',
      name: 'Member',
      isAdmin: false,
      projectGrants: [{ projectId: 'project_shared', canRead: true, canCreate: true, canWrite: false }],
    });
    const writeDenied = await webhookRequest(server.baseUrl, key, 'write-only-continuation', {
      projectId: 'Shared Project',
      text: 'Must not write after access is revoked',
    });
    assert.equal(writeDenied.status, 404);
    assert.equal((await writeDenied.json() as any).error, 'session_not_found');
    assert.equal(runtime.startInputs.length, 2);
    assert.equal(runtime.steerInputs.length, 0);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('a webhook conversation key cannot move its session to another project', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-project-binding-'));
  const identityStore = await createMultiUserStore(stateDir);
  await identityStore.upsertProject({
    id: 'project_other',
    internalName: 'other',
    cwd: '/private/other-project',
    displayName: 'Other Project',
    enabled: true,
    activeSessionLimit: null,
    showWorkDetailsToMembers: false,
  });
  await identityStore.upsertRole({
    id: 'role_member',
    name: 'Member',
    isAdmin: false,
    projectGrants: [
      { projectId: 'project_shared', canRead: true, canCreate: true, canWrite: true },
      { projectId: 'project_other', canRead: true, canCreate: true, canWrite: true },
    ],
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({ browser: alicePrincipal }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    const enabled = await browserRequest(server.baseUrl, '/api/webhook', {
      method: 'PATCH',
      body: { enabled: true },
    });
    const key = String((await enabled.json() as any).key);
    const first = await webhookRequest(server.baseUrl, key, 'bound-project', {
      projectId: 'Shared Project',
      text: 'First message',
    });
    assert.equal(first.status, 201);

    const conflict = await webhookRequest(server.baseUrl, key, 'bound-project', {
      projectId: 'Other Project',
      text: 'Move this conversation',
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json() as any).error, 'webhook_conversation_conflict');
    assert.equal(runtime.createInputs.length, 1);
    assert.equal(runtime.startInputs.length, 1);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('non-steerable webhook conversations return a retryable conflict without interrupting', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-non-steerable-'));
  const identityStore = await createMultiUserStore(stateDir);
  const runtime = runtimeStub();
  let interrupts = 0;
  runtime.interruptTurn = async () => {
    interrupts += 1;
  };
  const server = createCodexWebServer({
    auth: authFor({ browser: alicePrincipal }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    const enabled = await browserRequest(server.baseUrl, '/api/webhook', {
      method: 'PATCH',
      body: { enabled: true },
    });
    const key = String((await enabled.json() as any).key);
    const first = await webhookRequest(server.baseUrl, key, 'review-conversation', {
      projectId: 'Shared Project',
      text: 'Start review',
    });
    assert.equal(first.status, 201);

    runtime.sessions.get('thread_1').activeTurnId = 'turn_review';
    runtime.steerTurnForThread = async () => {
      const error = new Error('cannot steer a review turn') as Error & { code?: string };
      error.code = 'active_turn_not_steerable';
      throw error;
    };
    const blocked = await webhookRequest(server.baseUrl, key, 'review-conversation', {
      projectId: 'Shared Project',
      text: 'New requirement',
    });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json() as any).error, 'active_turn_not_steerable');
    assert.equal(interrupts, 0);

    runtime.sessions.get('thread_1').activeTurnId = null;
    const retry = await webhookRequest(server.baseUrl, key, 'review-conversation', {
      projectId: 'Shared Project',
      text: 'New requirement',
    });
    assert.equal(retry.status, 202);
    assert.equal(runtime.startInputs.at(-1)?.sessionId, 'thread_1');
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

test('webhooks accept optional model and reasoning effort as non-empty strings', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-webhook-model-settings-'));
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
    const invalidBodies = [
      { text: 'x', model: 42 },
      { text: 'x', model: '   ' },
      { text: 'x', reasoningEffort: null },
      { text: 'x', reasoningEffort: '   ' },
    ];
    for (const [index, body] of invalidBodies.entries()) {
      const response = await webhookRequest(server.baseUrl, key, `invalid-model-setting-${index}`, body);
      assert.equal(response.status, 400, `model payload ${index} should be rejected`);
      assert.equal((await response.json() as any).error, 'invalid_webhook_payload');
    }
    assert.equal(runtime.createInputs.length, 0);

    const modelOnly = await webhookRequest(server.baseUrl, key, 'model-only', {
      text: 'Use a selected model',
      model: '  custom-model  ',
    });
    assert.equal(modelOnly.status, 201);
    assert.deepEqual(runtime.createInputs[0]?.settings, { model: 'custom-model' });
    assert.deepEqual(runtime.startInputs[0]?.input.settings, { model: 'custom-model' });

    const reasoningOnly = await webhookRequest(server.baseUrl, key, 'reasoning-only', {
      text: 'Use the default model with selected reasoning',
      reasoningEffort: '  deep  ',
    });
    assert.equal(reasoningOnly.status, 201);
    assert.deepEqual(runtime.createInputs[1]?.settings, { reasoningEffort: 'deep' });
    assert.deepEqual(runtime.startInputs[1]?.input.settings, { reasoningEffort: 'deep' });
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
