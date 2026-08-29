import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AuthStore } from '../src/auth_store.js';
import { HybridAuthStore } from '../src/hybrid_auth_store.js';
import { createCodexWebServer, isLoopbackSocketAddress } from '../src/server.js';
import { FileIdentityStore } from '../src/identity_store.js';
import type { CodexWebPrincipal } from '../src/access_control.js';

interface TestConfig {
  host: string;
  port: number;
  defaultCwd: string;
  codexBin: string;
  stateDir: string;
  authPath: string;
  reportsDir: string;
  reportIndexPath: string;
  envPath: string;
  debug: boolean;
  publicSharesEnabled: boolean;
  publicShareTtlSeconds: number;
}

function createConfig(overrides: Partial<TestConfig> = {}): TestConfig {
  const stateDir = overrides.stateDir ?? '/tmp';
  return {
    host: '127.0.0.1',
    port: 0,
    defaultCwd: '/tmp',
    codexBin: 'codex',
    stateDir,
    authPath: path.join(stateDir, 'auth.json'),
    reportsDir: path.join(stateDir, 'reports'),
    reportIndexPath: path.join(stateDir, 'report-index.json'),
    envPath: '/tmp/service.env',
    debug: false,
    publicSharesEnabled: true,
    publicShareTtlSeconds: 3_600,
    ...overrides,
  };
}

function authFor(principals: Record<string, CodexWebPrincipal>) {
  return {
    isConfigured: async () => true,
    login: async () => {
      throw new Error('unused');
    },
    verifyToken: async (token: string | null | undefined) => {
      const principal = token ? principals[token] : null;
      return principal
        ? { id: `session_${principal.userId}`, deviceName: 'test', createdAt: '', lastSeenAt: '', principal }
        : null;
    },
    logout: async () => {},
  };
}

function runtimeStub() {
  const calls: string[] = [];
  const runtime = {
    calls,
    listModels: async () => [],
    readUsage: async () => null,
    listSessions: async () => [],
    createSession: async ({ cwd }: { cwd?: string | null }) => {
      calls.push(`create:${cwd}`);
      return { id: 'thread_new', cwd: cwd ?? null, projectName: 'hidden', settings: {}, thread: { turns: [] } };
    },
    readSession: async (threadId: string) => {
      calls.push(`read:${threadId}`);
      return { id: threadId, cwd: '/secret/path', projectName: 'secret/path', settings: {}, thread: { turns: [] }, timeline: [] };
    },
    archiveSession: async (threadId: string) => {
      calls.push(`archive:${threadId}`);
      return true;
    },
    unarchiveSession: async (threadId: string) => {
      calls.push(`unarchive:${threadId}`);
      return { id: threadId, cwd: '/secret/path', projectName: 'secret/path', settings: {}, thread: { turns: [] }, timeline: [] };
    },
    updateSessionFavorite: async (threadId: string) => {
      calls.push(`favorite:${threadId}`);
      return { id: threadId, cwd: '/secret/path', settings: {}, thread: { turns: [] } };
    },
    updateSessionSettings: async (threadId: string) => {
      calls.push(`settings:${threadId}`);
      return { id: threadId, cwd: '/secret/path', settings: {}, thread: { turns: [] } };
    },
    reloadRuntime: async () => ({ mcpServersReloaded: true }),
    startTurn: async (threadId: string) => {
      calls.push(`turn:${threadId}`);
      return { turnId: 'turn_1' };
    },
    interruptTurnForThread: async (threadId: string, turnId: string) => {
      calls.push(`interrupt:${threadId}:${turnId}`);
    },
    resolveApprovalForThread: async (threadId: string, approvalId: string) => {
      calls.push(`approval:${threadId}:${approvalId}`);
    },
    interruptTurn: async (turnId: string) => {
      calls.push(`legacy-interrupt:${turnId}`);
    },
    resolveApproval: async (approvalId: string) => {
      calls.push(`legacy-approval:${approvalId}`);
    },
    threadIdForTurn: () => 'thread_alice',
    threadIdForApproval: () => 'thread_alice',
    getTurnEvents: () => [],
    subscribeToTurn: () => () => {},
  };
  return runtime;
}

async function createIdentityStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-mu-'));
  const store = new FileIdentityStore({ identityPath: path.join(dir, 'identity.json') });
  await store.setMultiUserEnabled(true);
  await store.upsertProject({
    id: 'project_allowed',
    internalName: 'secret-repo',
    cwd: '/Users/alice/secret-repo',
    displayName: 'Allowed Project',
    enabled: true,
  });
  await store.upsertProject({
    id: 'project_denied',
    internalName: 'other-repo',
    cwd: '/Users/bob/other-repo',
    displayName: 'Other Project',
    enabled: true,
  });
  await store.upsertRole({
    id: 'role_admin',
    name: 'Admin',
    isAdmin: true,
    projectGrants: [],
  });
  await store.upsertRole({
    id: 'role_user',
    name: 'User',
    isAdmin: false,
    projectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true }],
  });
  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'alice-password',
    canNewSession: true,
    roleIds: ['role_user'],
    directProjectGrants: [],
  });
  await store.upsertUserWithPassword({
    id: 'user_admin',
    username: 'admin',
    password: 'admin-password',
    roleIds: ['role_admin'],
  });
  await store.upsertSession({
    id: 'app_alice',
    codexThreadId: 'thread_alice',
    projectId: 'project_allowed',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  });
  await store.upsertSession({
    id: 'app_bob',
    codexThreadId: 'thread_bob',
    projectId: 'project_allowed',
    ownerUserId: 'user_bob',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  });
  return store;
}

async function readInitialSseEvents(url: string, token: string): Promise<any[]> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream\b/iu);
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let payload = '';
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    while (!payload.includes('"type":"turn.completed"')) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      payload += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await reader.cancel().catch(() => {});
  }
  return payload
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)));
}

async function waitForSseClose(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      reader.read().then((result) => result.done).catch(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), 1_000);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

test('multi-user session list omits conversation details while direct reads retain them', async () => {
  const identityStore = await createIdentityStore();
  const aliceRuntimeSession = {
    id: 'thread_alice',
    cwd: '/secret/path',
    projectName: 'secret/path',
    activityState: 'waiting_approval',
    settings: {},
    thread: {
      turns: [{
        id: 'turn_1',
        status: 'completed',
        error: null,
        items: [{ type: 'message', role: 'assistant', phase: 'final_answer', text: 'Detailed answer' }],
      }],
    },
    timeline: [{
      id: 'timeline_1',
      kind: 'message',
      role: 'assistant',
      label: 'Assistant',
      meta: 'final',
      text: 'Detailed answer',
      turnId: 'turn_1',
      itemId: 'item_answer',
      projectionKey: 'turn_1\u0000item_answer',
      phase: 'final_answer',
      lifecycle: 'completed',
      raw: { secret: true },
    }],
  };
  const runtime = {
    ...runtimeStub(),
    listSessions: async (options?: { favorite?: boolean }) => {
      runtime.calls.push(`list:${options?.favorite === true ? 'favorites' : 'all'}`);
      return [
        aliceRuntimeSession,
        {
          id: 'thread_bob',
          cwd: '/other/path',
          projectName: 'other/path',
          activityState: 'running',
          settings: {},
          thread: { turns: [] },
          timeline: [],
        },
      ];
    },
    readSession: async (threadId: string) => {
      runtime.calls.push(`read:${threadId}`);
      if (threadId !== 'thread_alice') {
        throw new Error(`unexpected session read ${threadId}`);
      }
      return { ...aliceRuntimeSession, goal: null };
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.items.map((item: any) => item.id), ['app_alice']);
    assert.equal(payload.items[0].projectDisplayName, 'Allowed Project');
    assert.equal(payload.items[0].activityState, 'waiting_approval');
    assert.equal('goal' in payload.items[0], false);
    assert.equal(payload.items[0].cwd, undefined);
    assert.equal('thread' in payload.items[0], false);
    assert.equal('timeline' in payload.items[0], false);
    assert.deepEqual(runtime.calls, ['list:all']);

    const detailResponse = await fetch(`${server.baseUrl}/api/sessions/app_alice`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json();
    assert.equal(detailPayload.session.thread.turns[0].items[0].text, 'Detailed answer');
    assert.equal(detailPayload.session.timeline[0].text, 'Detailed answer');
    assert.equal(detailPayload.session.timeline[0].turnId, 'turn_1');
    assert.equal(detailPayload.session.timeline[0].itemId, 'item_answer');
    assert.equal(detailPayload.session.timeline[0].projectionKey, 'turn_1\u0000item_answer');
    assert.equal(detailPayload.session.timeline[0].phase, 'final_answer');
    assert.equal(detailPayload.session.timeline[0].lifecycle, 'completed');
    assert.equal('raw' in detailPayload.session.timeline[0], false);
    assert.equal('goal' in detailPayload.session, true);
    assert.equal(detailPayload.session.goal, null);
    assert.deepEqual(runtime.calls, ['list:all', 'read:thread_alice']);
  } finally {
    await server.stop();
  }
});

test('multi-user session pagination is applied after ownership filtering', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertProject({
    id: 'project_secondary',
    internalName: 'secondary-repo',
    cwd: '/Users/alice/secondary-repo',
    displayName: 'Secondary Project',
    enabled: true,
  });
  await identityStore.upsertRole({
    id: 'role_user',
    name: 'User',
    isAdmin: false,
    projectGrants: [
      { projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true },
      { projectId: 'project_secondary', canRead: true, canCreate: true, canWrite: true },
    ],
  });
  const aliceSessions = [{
    id: 'app_alice',
    threadId: 'thread_alice',
    updatedAt: 1,
  }];
  for (let index = 1; index < 35; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const appSession = {
      id: `app_alice_${suffix}`,
      threadId: `thread_alice_${suffix}`,
      updatedAt: index + 1,
    };
    aliceSessions.push(appSession);
    await identityStore.upsertSession({
      id: appSession.id,
      codexThreadId: appSession.threadId,
      projectId: 'project_allowed',
      ownerUserId: 'user_alice',
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: new Date(Date.UTC(2026, 4, 27, 0, index)).toISOString(),
      archived: false,
      archivedAt: null,
      archivedByUserId: null,
      archiveSource: null,
    });
  }
  const secondarySession = {
    id: 'app_alice_secondary',
    threadId: 'thread_alice_secondary',
    updatedAt: 0,
  };
  await identityStore.upsertSession({
    id: secondarySession.id,
    codexThreadId: secondarySession.threadId,
    projectId: 'project_secondary',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
    archived: false,
    archivedAt: null,
    archivedByUserId: null,
    archiveSource: null,
  });
  const unrelated = Array.from({ length: 100 }, (_, index) => ({
    id: `thread_unrelated_${index}`,
    cwd: '/other/path',
    projectName: 'other/path',
    updatedAt: 10_000 - index,
    settings: {},
    thread: { turns: [] },
    timeline: [],
  }));
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      ...unrelated,
      ...aliceSessions.map((session) => ({
        id: session.threadId,
        cwd: '/secret/path',
        projectName: 'secret/path',
        updatedAt: session.updatedAt,
        firstUserInput: `Alice session ${session.id}`,
        settings: {},
        thread: { turns: [] },
        timeline: [],
      })),
      {
        id: secondarySession.threadId,
        cwd: '/secondary/path',
        projectName: 'secondary/path',
        updatedAt: secondarySession.updatedAt,
        firstUserInput: 'Secondary project session',
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
    ],
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const firstResponse = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.items.length, 30);
    assert.equal(typeof first.nextCursor, 'string');
    assert.equal(first.totalCount, 36);
    assert.deepEqual(first.projectCounts.map((project: any) => ({
      projectId: project.projectId,
      count: project.sessionCount,
    })), [
      { projectId: 'project_allowed', count: 35 },
      { projectId: 'project_secondary', count: 1 },
    ]);

    const secondResponse = await fetch(`${server.baseUrl}/api/sessions?cursor=${encodeURIComponent(first.nextCursor)}`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.equal(second.items.length, 6);
    assert.equal(second.nextCursor, null);

    const combined = [...first.items, ...second.items];
    assert.equal(new Set(combined.map((item: any) => item.id)).size, 36);
    assert.equal(combined.every((item: any) => item.ownerUserId === 'user_alice'), true);
    assert.equal(combined.some((item: any) => String(item.id).includes('unrelated')), false);

    const projectResponse = await fetch(`${server.baseUrl}/api/sessions?projectId=project_allowed`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(projectResponse.status, 200);
    const projectPage = await projectResponse.json();
    assert.equal(projectPage.items.length, 30);
    assert.equal(projectPage.items.every((item: any) => item.projectId === 'project_allowed'), true);
    assert.equal(projectPage.totalCount, 36);
    assert.deepEqual(projectPage.projectCounts.map((project: any) => ({
      projectId: project.projectId,
      count: project.sessionCount,
    })), [
      { projectId: 'project_allowed', count: 35 },
      { projectId: 'project_secondary', count: 1 },
    ]);
  } finally {
    await server.stop();
  }
});

test('multi-user favorite session list uses the runtime favorite filter before hydrating sessions', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    listSessions: async (options?: { favorite?: boolean }) => {
      runtime.calls.push(`list:${options?.favorite === true ? 'favorites' : 'all'}`);
      return options?.favorite === true
        ? [{
          id: 'thread_alice',
          cwd: '/secret/path',
          projectName: 'secret/path',
          settings: {},
          thread: { turns: [] },
          timeline: [],
          favorite: true,
          favoriteOrder: 1,
        }]
        : [];
    },
    readSession: async (threadId: string) => {
      runtime.calls.push(`read:${threadId}`);
      if (threadId !== 'thread_alice') {
        throw new Error(`unexpected hydration for ${threadId}`);
      }
      return {
        id: threadId,
        cwd: '/secret/path',
        projectName: 'secret/path',
        settings: {},
        thread: { turns: [] },
        timeline: [],
        favorite: true,
        favoriteOrder: 1,
      };
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions?favorite=true`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.items.map((item: any) => item.id), ['app_alice']);
    assert.deepEqual(runtime.calls, ['list:favorites']);
  } finally {
    await server.stop();
  }
});

test('multi-user read and write reject sessions owned by another user', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const read = await fetch(`${server.baseUrl}/api/sessions/app_bob`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(read.status, 404);

    const write = await fetch(`${server.baseUrl}/api/sessions/app_bob/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    assert.equal(write.status, 404);
    assert.deepEqual(runtime.calls, []);
  } finally {
    await server.stop();
  }
});

test('multi-user session create uses project cwd and stores app session mapping', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  let createInput: any = null;
  runtime.createSession = async (input: any) => {
    createInput = input;
    runtime.calls.push(`create:${input.cwd}`);
    return { id: 'thread_new', cwd: input.cwd, settings: input.settings, thread: { turns: [] }, timeline: [] } as any;
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_allowed', cwd: '/tmp/ignored' }),
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.notEqual(payload.session.id, 'thread_new');
    assert.equal(payload.session.projectDisplayName, 'Allowed Project');
    assert.equal(payload.session.cwd, undefined);
    assert.deepEqual(runtime.calls, ['create:/Users/alice/secret-repo']);
    assert.deepEqual(createInput.runtimeEnv, {
      CODEX_WEB_LOCAL_API_URL: `http://127.0.0.1:${new URL(server.baseUrl).port}`,
    });
    assert.equal(Object.hasOwn(createInput.runtimeEnv, 'CODEX_WEB_CONTEXT_FILE'), false);
    const state = await identityStore.readState();
    assert.equal(state.sessions.some((session) => session.codexThreadId === 'thread_new'), true);
  } finally {
    await server.stop();
  }
});

test('admin project APIs persist active session limits and member work visibility', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const create = await fetch(`${server.baseUrl}/api/admin/projects`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'project_limited',
        cwd: '/Users/admin/limited',
        displayName: 'Limited',
        activeSessionLimit: 5,
        showWorkDetailsToMembers: false,
      }),
    });
    assert.equal(create.status, 201);
    const createPayload = await create.json();
    assert.equal(createPayload.project.activeSessionLimit, 5);
    assert.equal(createPayload.project.showWorkDetailsToMembers, false);

    const list = await fetch(`${server.baseUrl}/api/admin/projects`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(list.status, 200);
    const listPayload = await list.json();
    assert.equal(listPayload.items.find((item: any) => item.id === 'project_limited')?.activeSessionLimit, 5);
    assert.equal(listPayload.items.find((item: any) => item.id === 'project_limited')?.showWorkDetailsToMembers, false);
  } finally {
    await server.stop();
  }
});

test('admin project patch updates active session limits and member work visibility', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const patch = await fetch(`${server.baseUrl}/api/admin/projects/project_allowed`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Allowed Updated',
        activeSessionLimit: 7,
        showWorkDetailsToMembers: false,
      }),
    });
    assert.equal(patch.status, 200);
    const patchPayload = await patch.json();
    assert.equal(patchPayload.project.id, 'project_allowed');
    assert.equal(patchPayload.project.displayName, 'Allowed Updated');
    assert.equal(patchPayload.project.cwd, '/Users/alice/secret-repo');
    assert.equal(patchPayload.project.activeSessionLimit, 7);
    assert.equal(patchPayload.project.showWorkDetailsToMembers, false);

    const state = await identityStore.readState();
    assert.equal(state.projects.find((project) => project.id === 'project_allowed')?.activeSessionLimit, 7);
    assert.equal(state.projects.find((project) => project.id === 'project_allowed')?.showWorkDetailsToMembers, false);
  } finally {
    await server.stop();
  }
});

test('admin project APIs reject duplicate display names case-insensitively', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const create = await fetch(`${server.baseUrl}/api/admin/projects`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'project_duplicate',
        cwd: '/Users/admin/duplicate',
        displayName: 'allowed project',
      }),
    });
    assert.equal(create.status, 409);
    assert.deepEqual(await create.json(), {
      error: 'project_display_name_conflict',
      message: 'A project with this display name already exists.',
    });

    const rename = await fetch(`${server.baseUrl}/api/admin/projects/project_denied`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'ALLOWED PROJECT' }),
    });
    assert.equal(rename.status, 409);
    assert.equal((await rename.json()).error, 'project_display_name_conflict');

    const state = await identityStore.readState();
    assert.equal(state.projects.some((project) => project.id === 'project_duplicate'), false);
    assert.equal(state.projects.find((project) => project.id === 'project_denied')?.displayName, 'Other Project');
  } finally {
    await server.stop();
  }
});

test('disabling member work details closes existing streams and restricts subsequent hydration', async () => {
  const identityStore = await createIdentityStore();
  const runtimeSession = {
    id: 'thread_alice',
    cwd: '/Users/alice/private',
    projectName: 'private',
    settings: {},
    thread: {
      threadId: 'thread_alice',
      turns: [{
        id: 'turn_alice',
        status: 'completed',
        error: null,
        items: [
          { type: 'message', role: 'assistant', phase: 'commentary', text: 'PRIVATE_COMMENTARY' },
          { type: 'message', role: 'assistant', phase: 'final_answer', text: 'Safe answer' },
        ],
      }],
    },
    timeline: [
      { id: 'timeline_commentary', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'PRIVATE_COMMENTARY' },
      { id: 'timeline_final', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Safe answer' },
    ],
  };
  const runtime = {
    ...runtimeStub(),
    readSession: async () => runtimeSession,
    threadIdForTurn: () => 'thread_alice',
    getTurnEvents: () => [{
      sequence: 1,
      event: {
        id: 'evt_turn_started',
        type: 'turn.started',
        turnId: 'turn_alice',
        threadId: 'thread_alice',
      },
    }],
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const stream = await fetch(`${server.baseUrl}/api/turns/turn_alice/events`, {
      headers: { Authorization: 'Bearer alice' },
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    assert.ok(stream.body);
    reader = stream.body.getReader();
    const initial = await reader.read();
    assert.equal(initial.done, false);
    assert.match(new TextDecoder().decode(initial.value), /turn\.started/u);

    const patch = await fetch(`${server.baseUrl}/api/admin/projects/project_allowed`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ showWorkDetailsToMembers: false }),
    });
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).project.showWorkDetailsToMembers, false);

    assert.equal(await waitForSseClose(reader), true);

    const hydrated = await fetch(`${server.baseUrl}/api/sessions/app_alice`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(hydrated.status, 200);
    const payload = await hydrated.json();
    assert.equal(payload.session.canViewWorkDetails, false);
    assert.deepEqual(
      payload.session.thread.turns[0].items.map((item: any) => item.text),
      ['Safe answer'],
    );
    assert.deepEqual(payload.session.timeline.map((entry: any) => entry.text), ['Safe answer']);
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_COMMENTARY/u);
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    await server.stop();
  }
});

test('legacy project POST closes existing streams when member work visibility changes', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    threadIdForTurn: () => 'thread_alice',
    getTurnEvents: () => [{
      sequence: 1,
      event: {
        id: 'evt_turn_started',
        type: 'turn.started',
        turnId: 'turn_alice',
        threadId: 'thread_alice',
      },
    }],
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const stream = await fetch(`${server.baseUrl}/api/turns/turn_alice/events`, {
      headers: { Authorization: 'Bearer alice' },
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    assert.ok(stream.body);
    reader = stream.body.getReader();
    const initial = await reader.read();
    assert.equal(initial.done, false);

    const update = await fetch(`${server.baseUrl}/api/admin/projects`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'project_allowed',
        internalName: 'secret-repo',
        cwd: '/Users/alice/secret-repo',
        displayName: 'Allowed Project',
        enabled: true,
        activeSessionLimit: null,
        showWorkDetailsToMembers: false,
      }),
    });
    assert.equal(update.status, 201);
    assert.equal((await update.json()).project.showWorkDetailsToMembers, false);
    assert.equal(await waitForSseClose(reader), true);
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    await server.stop();
  }
});

test('multi-user session create rejects non-admins at the active session limit', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertProject({
    id: 'project_allowed',
    internalName: 'secret-repo',
    cwd: '/Users/alice/secret-repo',
    displayName: 'Allowed Project',
    enabled: true,
    activeSessionLimit: 1,
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_allowed' }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'active_session_limit_reached',
      message: 'Archive an existing session before creating a new one.',
      projectId: 'project_allowed',
      activeSessionLimit: 1,
    });
    assert.deepEqual(runtime.calls, []);
  } finally {
    await server.stop();
  }
});

test('owners can list and read their archived sessions as read-only', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertSession({
    id: 'app_archived',
    codexThreadId: 'thread_archived',
    projectId: 'project_allowed',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    archived: true,
    archivedAt: '2026-05-28T00:00:00.000Z',
    archivedByUserId: 'user_alice',
    archiveSource: 'codex',
  });
  const runtime = {
    ...runtimeStub(),
    listSessions: async (options?: { favorite?: boolean; archived?: boolean }) => {
      runtime.calls.push(`list:${options?.archived === true ? 'archived' : options?.favorite === true ? 'favorites' : 'all'}`);
      return options?.archived === true
        ? [{ id: 'thread_archived', cwd: '/secret/path', projectName: 'secret/path', settings: {}, thread: { turns: [] }, timeline: [] }]
        : [{ id: 'thread_alice', cwd: '/secret/path', projectName: 'secret/path', settings: {}, thread: { turns: [] }, timeline: [] }];
    },
    readSession: async (threadId: string) => {
      runtime.calls.push(`read:${threadId}`);
      return { id: threadId, cwd: '/secret/path', projectName: 'secret/path', settings: {}, thread: { turns: [] }, timeline: [] };
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const list = await fetch(`${server.baseUrl}/api/sessions?state=archived`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(list.status, 200);
    const listPayload = await list.json();
    assert.deepEqual(listPayload.items.map((item: any) => item.id), ['app_archived']);
    assert.equal(listPayload.items[0].archived, true);

    const read = await fetch(`${server.baseUrl}/api/sessions/app_archived`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(read.status, 200);
    const readPayload = await read.json();
    assert.equal(readPayload.session.id, 'app_archived');
    assert.equal(readPayload.session.archived, true);
    assert.equal(readPayload.session.readOnly, true);
  } finally {
    await server.stop();
  }
});

test('owners can list archived sessions recorded in identity when runtime archived scan is empty', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertSession({
    id: 'app_archived',
    codexThreadId: 'thread_archived',
    projectId: 'project_allowed',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    archived: true,
    archivedAt: '2026-05-28T00:00:00.000Z',
    archivedByUserId: 'user_alice',
    archiveSource: 'codex',
  });
  const runtime = {
    ...runtimeStub(),
    listSessions: async (options?: { favorite?: boolean; archived?: boolean }) => {
      runtime.calls.push(`list:${options?.archived === true ? 'archived' : options?.favorite === true ? 'favorites' : 'all'}`);
      return [];
    },
    readSession: async (threadId: string) => {
      runtime.calls.push(`read:${threadId}`);
      return { id: threadId, cwd: '/secret/path', projectName: 'secret/path', settings: {}, thread: { turns: [] }, timeline: [] };
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const list = await fetch(`${server.baseUrl}/api/sessions?state=archived`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(list.status, 200);
    const listPayload = await list.json();
    assert.deepEqual(listPayload.items.map((item: any) => item.id), ['app_archived']);
    assert.equal(listPayload.items[0].archived, true);
    assert.equal(listPayload.items[0].readOnly, true);
    assert.deepEqual(runtime.calls, ['list:archived', 'list:all', 'read:thread_archived']);
  } finally {
    await server.stop();
  }
});

test('session listing repairs an indexed active session found in the Codex archive', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    listSessions: async (options?: { archived?: boolean }) => {
      runtime.calls.push(`list:${options?.archived === true ? 'archived' : 'all'}`);
      return options?.archived === true
        ? [{ id: 'thread_alice', cwd: '/secret/path', projectName: 'secret/path', settings: {}, thread: { turns: [] }, timeline: [] }]
        : [];
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items, []);

    const state = await identityStore.readState();
    const repaired = state.sessions.find((session) => session.id === 'app_alice');
    assert.equal(repaired?.archived, true);
    assert.equal(repaired?.archiveSource, 'codex');
    assert.deepEqual(runtime.calls, ['list:all', 'list:archived']);
  } finally {
    await server.stop();
  }
});

test('project readers cannot list or read archived sessions owned by another user', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertSession({
    id: 'app_archived',
    codexThreadId: 'thread_archived',
    projectId: 'project_allowed',
    ownerUserId: 'user_admin',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    archived: true,
    archivedAt: '2026-05-28T00:00:00.000Z',
    archivedByUserId: 'user_admin',
    archiveSource: 'codex',
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const list = await fetch(`${server.baseUrl}/api/sessions?state=archived`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(list.status, 200);
    const listPayload = await list.json();
    assert.deepEqual(listPayload.items, []);

    const read = await fetch(`${server.baseUrl}/api/sessions/app_archived`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(read.status, 404);
  } finally {
    await server.stop();
  }
});

test('archived sessions reject write APIs until they are unarchived', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertSession({
    id: 'app_archived',
    codexThreadId: 'thread_archived',
    projectId: 'project_allowed',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    archived: true,
    archivedAt: '2026-05-28T00:00:00.000Z',
    archivedByUserId: 'user_alice',
    archiveSource: 'codex',
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const turn = await fetch(`${server.baseUrl}/api/sessions/app_archived/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'continue' }),
    });
    assert.equal(turn.status, 409);
    assert.deepEqual(await turn.json(), {
      error: 'session_archived',
      message: 'Unarchive this session before making changes.',
    });

    const settings = await fetch(`${server.baseUrl}/api/sessions/app_archived/settings`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.4' }),
    });
    assert.equal(settings.status, 409);

    assert.deepEqual(runtime.calls, []);
  } finally {
    await server.stop();
  }
});

test('archiving a session updates app metadata and delete remains an alias', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const archive = await fetch(`${server.baseUrl}/api/sessions/app_alice/archive`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(archive.status, 200);
    let state = await identityStore.readState();
    let archived = state.sessions.find((session) => session.id === 'app_alice');
    assert.equal(archived?.archived, true);
    assert.equal(archived?.archivedByUserId, 'user_alice');
    assert.equal(archived?.archiveSource, 'codex');

    const unarchive = await fetch(`${server.baseUrl}/api/sessions/app_alice/unarchive`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(unarchive.status, 200);
    state = await identityStore.readState();
    archived = state.sessions.find((session) => session.id === 'app_alice');
    assert.equal(archived?.archived, false);
    assert.equal(archived?.archivedAt, null);
    assert.equal(archived?.archivedByUserId, null);
    assert.equal(archived?.archiveSource, null);

    const legacyArchive = await fetch(`${server.baseUrl}/api/sessions/app_alice`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(legacyArchive.status, 200);
    assert.deepEqual(runtime.calls, ['archive:thread_alice', 'unarchive:thread_alice', 'archive:thread_alice']);
  } finally {
    await server.stop();
  }
});

test('unarchiving checks the active session limit for non-admins', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertProject({
    id: 'project_allowed',
    internalName: 'secret-repo',
    cwd: '/Users/alice/secret-repo',
    displayName: 'Allowed Project',
    enabled: true,
    activeSessionLimit: 1,
  });
  await identityStore.upsertSession({
    id: 'app_archived',
    codexThreadId: 'thread_archived',
    projectId: 'project_allowed',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    archived: true,
    archivedAt: '2026-05-28T00:00:00.000Z',
    archivedByUserId: 'user_alice',
    archiveSource: 'codex',
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/app_archived/unarchive`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'active_session_limit_reached',
      message: 'Archive an existing session before creating a new one.',
      projectId: 'project_allowed',
      activeSessionLimit: 1,
    });
    assert.deepEqual(runtime.calls, []);
  } finally {
    await server.stop();
  }
});

test('admin projects list exposes every enabled project as creatable', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [
        { id: 'project_allowed', displayName: 'Allowed Project', canCreate: true, canViewWorkDetails: true, favorite: false },
        { id: 'project_denied', displayName: 'Other Project', canCreate: true, canViewWorkDetails: true, favorite: false },
      ],
    });
  } finally {
    await server.stop();
  }
});

test('project list exposes computed work-detail capability for admins and members', async () => {
  const identityStore = await createIdentityStore();
  const existing = (await identityStore.readState()).projects.find((project) => project.id === 'project_allowed')!;
  await identityStore.upsertProject({ ...existing, showWorkDetailsToMembers: false });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const [memberResponse, adminResponse] = await Promise.all([
      fetch(`${server.baseUrl}/api/projects`, { headers: { Authorization: 'Bearer alice' } }),
      fetch(`${server.baseUrl}/api/projects`, { headers: { Authorization: 'Bearer admin' } }),
    ]);
    assert.equal(memberResponse.status, 200);
    assert.equal(adminResponse.status, 200);
    const memberPayload = await memberResponse.json();
    const adminPayload = await adminResponse.json();

    assert.equal(memberPayload.items.find((item: any) => item.id === 'project_allowed')?.canViewWorkDetails, false);
    assert.equal(adminPayload.items.find((item: any) => item.id === 'project_allowed')?.canViewWorkDetails, true);
  } finally {
    await server.stop();
  }
});

test('admin projects list includes disabled legacy projects as creatable', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertProject({
    id: 'project_legacy',
    internalName: 'legacy-repo',
    cwd: '/Users/admin/legacy-repo',
    displayName: 'Legacy Repo',
    enabled: false,
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const projects = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(projects.status, 200);
    const projectPayload = await projects.json();
    assert.equal(
      projectPayload.items.some((item: any) => item.id === 'project_legacy' && item.canCreate === true),
      true,
    );

    const create = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_legacy' }),
    });
    assert.equal(create.status, 201);
    assert.deepEqual(runtime.calls, ['create:/Users/admin/legacy-repo']);
  } finally {
    await server.stop();
  }
});

test('multi-user role-assigned projects are creatable without a separate user toggle', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertUserWithPassword({
    id: 'user_viewer',
    username: 'viewer',
    password: 'viewer-password',
    canNewSession: false,
    roleIds: ['role_user'],
    directProjectGrants: [],
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      viewer: { userId: 'user_viewer', username: 'viewer', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const projects = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer viewer' },
    });
    assert.equal(projects.status, 200);
    assert.deepEqual(await projects.json(), {
      items: [{ id: 'project_allowed', displayName: 'Allowed Project', canCreate: true, canViewWorkDetails: true, favorite: false }],
    });

    const create = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer viewer', 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_allowed' }),
    });
    assert.equal(create.status, 201);
    assert.deepEqual(runtime.calls, ['create:/Users/alice/secret-repo']);
  } finally {
    await server.stop();
  }
});

test('admin can audit all sessions and read any session with observer mode', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const list = await fetch(`${server.baseUrl}/api/admin/sessions?userId=user_bob`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(list.status, 200);
    const listPayload = await list.json();
    assert.deepEqual(listPayload.items.map((item: any) => item.id), ['app_bob']);

    const read = await fetch(`${server.baseUrl}/api/admin/sessions/app_bob`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(read.status, 200);
    const readPayload = await read.json();
    assert.equal(readPayload.mode, 'observer');
    assert.equal(readPayload.session.id, 'app_bob');
    assert.equal(readPayload.session.mode, 'observer');
    assert.equal(readPayload.session.readOnly, true);
    assert.equal(readPayload.session.cwd, undefined);
    assert.deepEqual(runtime.calls, ['read:thread_bob']);
  } finally {
    await server.stop();
  }
});

test('admin session audit returns newest sessions first', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertSession({
    id: 'app_alice',
    codexThreadId: 'thread_alice',
    projectId: 'project_allowed',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T08:00:00.000Z',
  });
  await identityStore.upsertSession({
    id: 'app_bob',
    codexThreadId: 'thread_bob',
    projectId: 'project_allowed',
    ownerUserId: 'user_bob',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T10:00:00.000Z',
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/admin/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.items.map((item: any) => item.id), ['app_bob', 'app_alice']);
  } finally {
    await server.stop();
  }
});

test('starting a turn refreshes admin audit session recency', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertSession({
    id: 'app_alice',
    codexThreadId: 'thread_alice',
    projectId: 'project_allowed',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T08:00:00.000Z',
  });
  await identityStore.upsertSession({
    id: 'app_bob',
    codexThreadId: 'thread_bob',
    projectId: 'project_allowed',
    ownerUserId: 'user_bob',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T10:00:00.000Z',
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const turn = await fetch(`${server.baseUrl}/api/sessions/app_alice/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'refresh this session recency' }),
    });
    assert.equal(turn.status, 202);

    const audit = await fetch(`${server.baseUrl}/api/admin/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(audit.status, 200);
    const payload = await audit.json();
    assert.deepEqual(payload.items.map((item: any) => item.id), ['app_alice', 'app_bob']);
  } finally {
    await server.stop();
  }
});

test('admin normal access to another owner session is hidden and cannot start turns', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const read = await fetch(`${server.baseUrl}/api/sessions/app_bob`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(read.status, 404);

    const write = await fetch(`${server.baseUrl}/api/sessions/app_bob/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'not allowed' }),
    });
    assert.equal(write.status, 404);
    assert.deepEqual(runtime.calls, []);
  } finally {
    await server.stop();
  }
});

test('multi-user steer hides another owner turn without steering or interrupting it', async () => {
  const identityStore = await createIdentityStore();
  const calls: string[] = [];
  const runtime = {
    ...runtimeStub(),
    threadIdForTurn: (turnId: string) => {
      calls.push(`lookup:${turnId}`);
      return turnId === 'turn_bob' ? 'thread_bob' : null;
    },
    steerTurnForThread: async (threadId: string, turnId: string) => {
      calls.push(`steer:${threadId}:${turnId}`);
      return { turnId };
    },
    interruptTurnForThread: async (threadId: string, turnId: string) => {
      calls.push(`interrupt:${threadId}:${turnId}`);
    },
    interruptTurn: async (turnId: string) => {
      calls.push(`legacy-interrupt:${turnId}`);
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_bob/steer`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer alice',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Do not allow this' }),
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: 'session_not_found',
      message: 'Selected session was not found.',
    });
    assert.deepEqual(calls, ['lookup:turn_bob']);
  } finally {
    await server.stop();
  }
});

test('admin normal event stream access to another owner session is hidden', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    threadIdForTurn: (turnId: string) => turnId === 'turn_bob' ? 'thread_bob' : null,
    getTurnEvents: () => [],
  };
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_bob/events`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 404);
  } finally {
    await server.stop();
  }
});

test('hidden project event streams send safe work categories to members and full details to admins', async () => {
  const identityStore = await createIdentityStore();
  const existingProject = (await identityStore.readState()).projects.find((project) => project.id === 'project_allowed')!;
  await identityStore.upsertProject({ ...existingProject, showWorkDetailsToMembers: false });
  await identityStore.upsertSession({
    id: 'app_admin',
    codexThreadId: 'thread_admin',
    projectId: 'project_allowed',
    ownerUserId: 'user_admin',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    archived: false,
    archivedAt: null,
    archivedByUserId: null,
    archiveSource: null,
  });
  const storedEventsFor = (turnId: string, threadId: string) => [
    {
      sequence: 1,
      event: {
        id: `evt_${turnId}_commentary`,
        type: 'assistant.delta',
        turnId,
        threadId,
        text: 'Inspecting /Users/alice/private',
        phase: 'commentary',
      },
    },
    {
      sequence: 2,
      event: {
        id: `evt_${turnId}_started`,
        type: 'batch.started',
        turnId,
        batchId: `batch_${turnId}`,
        kind: 'command',
        title: 'cat /Users/alice/private',
      },
    },
    {
      sequence: 3,
      event: {
        id: `evt_${turnId}_updated`,
        type: 'batch.updated',
        turnId,
        batchId: `batch_${turnId}`,
        summary: {
          command: 'cat /Users/alice/private',
          output: 'secret output',
          fileChanges: [{ path: '/Users/alice/private', diff: 'private diff' }],
        },
      },
    },
    {
      sequence: 4,
      event: {
        id: `evt_${turnId}_completed`,
        type: 'batch.completed',
        turnId,
        batchId: `batch_${turnId}`,
        status: 'completed',
      },
    },
    {
      sequence: 5,
      event: {
        id: `evt_${turnId}_final_delta`,
        type: 'assistant.delta',
        turnId,
        threadId,
        text: 'Done',
        phase: 'final_answer',
      },
    },
    {
      sequence: 6,
      event: {
        id: `evt_${turnId}_turn_completed`,
        type: 'turn.completed',
        turnId,
        threadId,
        status: 'completed',
      },
    },
  ];
  const runtime = {
    ...runtimeStub(),
    threadIdForTurn: (turnId: string) => turnId === 'turn_admin' ? 'thread_admin' : 'thread_alice',
    getTurnEvents: (turnId: string) => storedEventsFor(
      turnId,
      turnId === 'turn_admin' ? 'thread_admin' : 'thread_alice',
    ),
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const memberEvents = await readInitialSseEvents(`${server.baseUrl}/api/turns/turn_alice/events`, 'alice');
    const adminEvents = await readInitialSseEvents(
      `${server.baseUrl}/api/admin/sessions/app_alice/turns/turn_alice/events`,
      'admin',
    );

    assert.deepEqual(memberEvents.map((event) => event.type), [
      'stream.ready',
      'batch.started',
      'batch.completed',
      'assistant.delta',
      'turn.completed',
    ]);
    assert.equal(memberEvents[0]?.reset, false);
    assert.equal(memberEvents[1]?.kind, 'command');
    assert.equal(memberEvents[1]?.title, 'Running command');
    assert.equal(memberEvents[2]?.status, 'completed');
    assert.equal(memberEvents[3]?.phase, 'final_answer');
    assert.doesNotMatch(
      JSON.stringify(memberEvents),
      /Users|private|secret output|private diff|fileChanges|batch\.updated|commentary/u,
    );

    assert.deepEqual(adminEvents.map((event) => event.type), [
      'stream.ready',
      'assistant.delta',
      'batch.started',
      'batch.updated',
      'batch.completed',
      'assistant.delta',
      'turn.completed',
    ]);
    assert.equal(adminEvents[0]?.reset, false);
    assert.equal(adminEvents[1]?.phase, 'commentary');
    assert.equal(adminEvents[2]?.title, 'cat /Users/alice/private');
    assert.equal(adminEvents[3]?.summary.command, 'cat /Users/alice/private');
    assert.equal(adminEvents[3]?.summary.output, 'secret output');
    assert.equal(adminEvents[3]?.summary.fileChanges[0].diff, 'private diff');
  } finally {
    await server.stop();
  }
});

test('admin normal session list returns only their own sessions', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertSession({
    id: 'app_admin',
    codexThreadId: 'thread_admin',
    projectId: 'project_allowed',
    ownerUserId: 'user_admin',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  });
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      { id: 'thread_admin', cwd: '/admin/path', projectName: 'admin/path', settings: {}, thread: { turns: [] }, timeline: [] },
      { id: 'thread_alice', cwd: '/secret/path', projectName: 'secret/path', settings: {}, thread: { turns: [] }, timeline: [] },
      { id: 'thread_bob', cwd: '/other/path', projectName: 'other/path', settings: {}, thread: { turns: [] }, timeline: [] },
    ],
  };
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.items.map((item: any) => item.id), ['app_admin']);
    assert.equal(payload.items[0].mode, undefined);
    assert.equal(payload.items[0].readOnly, undefined);
  } finally {
    await server.stop();
  }
});

test('admin normal workspace includes admin-owned legacy sessions adopted from runtime', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      {
        id: 'thread_legacy',
        cwd: '/Users/admin/legacy-repo',
        projectName: 'legacy-repo',
        updatedAt: 1_779_811_200_000,
        firstUserInput: 'Legacy prompt',
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
    ],
  };
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const audit = await fetch(`${server.baseUrl}/api/admin/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(audit.status, 200);
    const state = await identityStore.readState();
    const legacySession = state.sessions.find((session) => session.codexThreadId === 'thread_legacy');
    assert.equal(legacySession?.ownerUserId, 'user_admin');

    const normalList = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(normalList.status, 200);
    const normalPayload = await normalList.json();
    assert.deepEqual(normalPayload.items.map((item: any) => item.id), [legacySession?.id]);
    assert.equal(normalPayload.items[0].mode, undefined);
    assert.equal(normalPayload.items[0].readOnly, undefined);
  } finally {
    await server.stop();
  }
});

test('admin session audit includes a summary from runtime session previews', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      {
        id: 'thread_alice',
        cwd: '/secret/path',
        projectName: 'secret/path',
        firstUserInput: 'Set up the mobile console login flow',
        preview: 'Fallback preview should not be used',
        lastUserInput: 'Latest prompt should not be used',
        title: 'Title should not be used',
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
      {
        id: 'thread_bob',
        cwd: '/other/path',
        projectName: 'other/path',
        preview: 'Review the RBAC session audit screen',
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
    ],
  };
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/admin/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const summariesById = new Map(payload.items.map((item: any) => [item.id, item.summary]));
    assert.equal(summariesById.get('app_alice'), 'Set up the mobile console login flow');
    assert.equal(summariesById.get('app_bob'), 'Review the RBAC session audit screen');
  } finally {
    await server.stop();
  }
});

test('admin audit filters archived and active sessions and can read archived detail', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertSession({
    id: 'app_archived',
    codexThreadId: 'thread_archived',
    projectId: 'project_allowed',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    archived: true,
    archivedAt: '2026-05-28T00:00:00.000Z',
    archivedByUserId: 'user_alice',
    archiveSource: 'codex',
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const archivedOnly = await fetch(`${server.baseUrl}/api/admin/sessions?state=archived`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(archivedOnly.status, 200);
    const archivedPayload = await archivedOnly.json();
    assert.deepEqual(archivedPayload.items.map((item: any) => item.id), ['app_archived']);
    assert.equal(archivedPayload.items[0].archived, true);

    const activeOnly = await fetch(`${server.baseUrl}/api/admin/sessions?state=active`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(activeOnly.status, 200);
    const activePayload = await activeOnly.json();
    assert.equal(activePayload.items.some((item: any) => item.id === 'app_archived'), false);

    const detail = await fetch(`${server.baseUrl}/api/admin/sessions/app_archived`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(detail.status, 200);
    const detailPayload = await detail.json();
    assert.equal(detailPayload.mode, 'observer');
    assert.equal(detailPayload.session.id, 'app_archived');
    assert.equal(detailPayload.session.archived, true);
    assert.equal(detailPayload.session.readOnly, true);
  } finally {
    await server.stop();
  }
});

test('admin audit can filter sessions by project only', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const allowed = await fetch(`${server.baseUrl}/api/admin/sessions?projectId=project_allowed`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(allowed.status, 200);
    const allowedPayload = await allowed.json();
    assert.deepEqual(allowedPayload.items.map((item: any) => item.id).sort(), ['app_alice', 'app_bob']);

    const denied = await fetch(`${server.baseUrl}/api/admin/sessions?projectId=project_denied`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(denied.status, 200);
    assert.deepEqual((await denied.json()).items, []);
  } finally {
    await server.stop();
  }
});

test('admin legacy session import reuses one enabled project with the same normalized cwd', async () => {
  const identityStore = await createIdentityStore();
  const initialState = await identityStore.readState();
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      {
        id: 'thread_existing_workspace',
        cwd: '/Users/alice/secret-repo/../secret-repo/',
        projectName: 'secret-repo',
        updatedAt: 1_779_811_200_000,
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
      {
        id: 'thread_other_workspace',
        cwd: '/Users/admin/other-repo/',
        projectName: 'other-repo',
        updatedAt: 1_779_811_201_000,
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
      {
        id: 'thread_unknown_workspace',
        cwd: null,
        projectName: 'unknown-workspace',
        updatedAt: 1_779_811_202_000,
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
    ],
  };
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/admin/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 200);

    const state = await identityStore.readState();
    const reusedSession = state.sessions.find((session) => session.codexThreadId === 'thread_existing_workspace');
    const independentSession = state.sessions.find((session) => session.codexThreadId === 'thread_other_workspace');
    const unknownCwdSession = state.sessions.find((session) => session.codexThreadId === 'thread_unknown_workspace');
    assert.equal(reusedSession?.projectId, 'project_allowed');
    assert.match(independentSession?.projectId ?? '', /^project_admin_legacy_/u);
    assert.notEqual(independentSession?.projectId, reusedSession?.projectId);
    assert.match(unknownCwdSession?.projectId ?? '', /^project_admin_legacy_/u);
    assert.notEqual(unknownCwdSession?.projectId, reusedSession?.projectId);
    assert.notEqual(unknownCwdSession?.projectId, independentSession?.projectId);
    assert.equal(state.projects.length, initialState.projects.length + 2);
    assert.equal(
      state.projects.some((project) => (
        project.id.startsWith('project_admin_legacy_')
        && path.resolve(project.cwd) === '/Users/alice/secret-repo'
      )),
      false,
    );
  } finally {
    await server.stop();
  }
});

test('admin legacy session import does not reuse ambiguous projects with the same cwd', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertProject({
    id: 'project_allowed_duplicate',
    internalName: 'secret-repo-duplicate',
    cwd: '/Users/alice/secret-repo/',
    displayName: 'Allowed Project Duplicate',
    enabled: true,
  });
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [{
      id: 'thread_ambiguous_workspace',
      cwd: '/Users/alice/other/../secret-repo',
      projectName: 'secret-repo',
      updatedAt: 1_779_811_200_000,
      settings: {},
      thread: { turns: [] },
      timeline: [],
    }],
  };
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/admin/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 200);

    const state = await identityStore.readState();
    const importedSession = state.sessions.find((session) => session.codexThreadId === 'thread_ambiguous_workspace');
    assert.match(importedSession?.projectId ?? '', /^project_admin_legacy_/u);
    assert.notEqual(importedSession?.projectId, 'project_allowed');
    assert.notEqual(importedSession?.projectId, 'project_allowed_duplicate');
  } finally {
    await server.stop();
  }
});

test('admin audit adopts unmapped legacy runtime sessions as enabled admin-owned sessions', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      {
        id: 'thread_legacy',
        cwd: '/Users/admin/legacy-repo',
        projectName: 'legacy-repo',
        title: null,
        updatedAt: 1_779_811_200_000,
        preview: 'Legacy prompt',
        firstUserInput: 'Legacy prompt',
        lastUserInput: 'Legacy prompt',
        lastInputAt: 1_779_811_200_000,
        favorite: false,
        favoriteOrder: null,
        goal: null,
        activeTurnId: null,
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
    ],
  };
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const adminList = await fetch(`${server.baseUrl}/api/admin/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(adminList.status, 200);
    const adminPayload = await adminList.json();
    const legacyAudit = adminPayload.items.find((item: any) => item.codexThreadId === 'thread_legacy');
    assert.equal(legacyAudit.ownerUserId, 'user_admin');
    assert.equal(legacyAudit.projectDisplayName, 'legacy-repo');

    const state = await identityStore.readState();
    const legacySession = state.sessions.find((session) => session.codexThreadId === 'thread_legacy');
    assert.equal(legacySession?.ownerUserId, 'user_admin');
    assert.equal(state.projects.some((project) => project.id === legacySession?.projectId && project.enabled === true), true);

    const aliceList = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(aliceList.status, 200);
    const alicePayload = await aliceList.json();
    assert.equal(alicePayload.items.some((item: any) => item.id === legacySession?.id), false);
  } finally {
    await server.stop();
  }
});

test('admin audit re-enables previously imported legacy projects', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertProject({
    id: 'project_admin_legacy_cfd14b543e583280dd16',
    internalName: 'legacy-repo',
    cwd: '/Users/admin/legacy-repo',
    displayName: 'legacy-repo',
    enabled: false,
  });
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      {
        id: 'thread_legacy',
        cwd: '/Users/admin/legacy-repo',
        projectName: 'legacy-repo',
        updatedAt: 1_779_811_200_000,
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
    ],
  };
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const adminList = await fetch(`${server.baseUrl}/api/admin/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(adminList.status, 200);

    const state = await identityStore.readState();
    assert.equal(
      state.projects.some((project) => project.id === 'project_admin_legacy_cfd14b543e583280dd16' && project.enabled === true),
      true,
    );
  } finally {
    await server.stop();
  }
});

test('admin can start turns from an unmapped legacy runtime session id after adoption', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      {
        id: 'thread_legacy',
        cwd: '/Users/admin/legacy-repo',
        projectName: 'legacy-repo',
        title: null,
        updatedAt: 1_779_811_200_000,
        preview: 'Legacy prompt',
        firstUserInput: 'Legacy prompt',
        lastUserInput: 'Legacy prompt',
        lastInputAt: 1_779_811_200_000,
        favorite: false,
        favoriteOrder: null,
        goal: null,
        activeTurnId: null,
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
    ],
  };
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_legacy/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello legacy' }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { turnId: 'turn_1' });
    assert.equal(runtime.calls.includes('turn:thread_legacy'), true);

    const state = await identityStore.readState();
    const legacySession = state.sessions.find((session) => session.codexThreadId === 'thread_legacy');
    assert.equal(legacySession?.ownerUserId, 'user_admin');
  } finally {
    await server.stop();
  }
});

test('share links read sessions without bearer auth and stay read-only', async () => {
  const identityStore = await createIdentityStore();
  const { token } = await identityStore.createShare({ sessionId: 'app_alice', createdByUserId: 'user_alice' });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({}),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const read = await fetch(`${server.baseUrl}/api/share/${encodeURIComponent(token)}/session`);
    assert.equal(read.status, 200);
    const payload = await read.json();
    assert.equal(payload.mode, 'share');
    assert.equal(payload.session.id, 'app_alice');
    assert.equal(payload.session.cwd, undefined);

    const write = await fetch(`${server.baseUrl}/api/share/${encodeURIComponent(token)}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'not allowed' }),
    });
    assert.equal(write.status, 404);
    assert.deepEqual(runtime.calls, ['read:thread_alice']);
  } finally {
    await server.stop();
  }
});

test('share capabilities expose only same-project reports referenced by public assistant answers', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-share-reports-'));
  const identityStore = await createIdentityStore();
  const linkedReportId = 'project_allowed/2026-07-16/linked.md';
  const unlistedReportId = 'project_allowed/2026-07-16/unlisted.md';
  const symlinkReportId = 'project_allowed/2026-07-16/escape.md';
  const otherProjectReportId = 'project_denied/2026-07-16/other.md';
  await fs.mkdir(path.join(stateDir, 'reports', 'project_allowed', '2026-07-16'), { recursive: true });
  await fs.mkdir(path.join(stateDir, 'reports', 'project_denied', '2026-07-16'), { recursive: true });
  await fs.writeFile(path.join(stateDir, 'reports', linkedReportId), '# Linked report\n');
  await fs.writeFile(path.join(stateDir, 'reports', unlistedReportId), '# Unlisted report\n');
  await fs.writeFile(path.join(stateDir, 'reports', otherProjectReportId), '# Other project\n');
  const outsideReportPath = path.join(stateDir, 'outside.md');
  await fs.writeFile(outsideReportPath, '# Outside report\n');
  await fs.symlink(outsideReportPath, path.join(stateDir, 'reports', symlinkReportId));
  await fs.writeFile(path.join(stateDir, 'report-index.json'), JSON.stringify({
    version: 1,
    reports: {
      [otherProjectReportId]: { project: 'project_allowed' },
    },
  }));
  const userText = `Do not share /Users/alice/.codex-web/reports/${unlistedReportId}`;
  const assistantText = [
    `[Linked](/Users/alice/.codex-web/reports/${linkedReportId})`,
    `[Other](/Users/alice/.codex-web/reports/${otherProjectReportId})`,
    `[Traversal](/Users/alice/.codex-web/reports/project_allowed/../secret.md)`,
    `[Symlink](/Users/alice/.codex-web/reports/${symlinkReportId})`,
  ].join('\n');
  const runtime = {
    ...runtimeStub(),
    readSession: async (threadId: string) => ({
      id: threadId,
      cwd: '/Users/alice/secret-repo',
      projectName: 'secret-repo',
      settings: {},
      thread: {
        turns: [{
          id: 'turn_reports',
          status: 'completed',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: userText },
            { type: 'message', role: 'assistant', phase: 'final_answer', text: assistantText },
          ],
        }],
      },
      timeline: [
        { id: 'user_reports', kind: 'message', role: 'user', label: 'User', meta: 'history', text: userText },
        { id: 'assistant_reports', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text: assistantText },
      ],
    }),
  };
  const precreated = await identityStore.createShare({ sessionId: 'app_alice', createdByUserId: 'user_alice' });
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig({ stateDir, publicSharesEnabled: true }),
  });
  await server.start();
  try {
    const sessionResponse = await fetch(`${server.baseUrl}/api/share/${encodeURIComponent(precreated.token)}/session`);
    assert.equal(sessionResponse.status, 200);
    const sessionPayload = await sessionResponse.json();
    assert.deepEqual(sessionPayload.reports.map((report: any) => report.id), [linkedReportId]);
    assert.equal(sessionPayload.reports[0].path, undefined);

    const contentResponse = await fetch(
      `${server.baseUrl}/api/share/${encodeURIComponent(precreated.token)}/reports/${encodeURIComponent(linkedReportId)}/content`,
    );
    assert.equal(contentResponse.status, 200);
    const contentPayload = await contentResponse.json();
    assert.equal(contentPayload.content, '# Linked report\n');
    assert.equal(contentPayload.report.id, linkedReportId);
    assert.equal(contentPayload.report.path, undefined);

    const unlistedResponse = await fetch(
      `${server.baseUrl}/api/share/${encodeURIComponent(precreated.token)}/reports/${encodeURIComponent(unlistedReportId)}/content`,
    );
    assert.equal(unlistedResponse.status, 404);
    const otherProjectResponse = await fetch(
      `${server.baseUrl}/api/share/${encodeURIComponent(precreated.token)}/reports/${encodeURIComponent(otherProjectReportId)}/content`,
    );
    assert.equal(otherProjectResponse.status, 404);

    const createResponse = await fetch(`${server.baseUrl}/api/sessions/app_alice/share`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(createResponse.status, 201);
    const createPayload = await createResponse.json();
    assert.deepEqual(createPayload.reports.map((report: any) => report.id), [linkedReportId]);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('share event streams are limited to turns from the shared session', async () => {
  const identityStore = await createIdentityStore();
  const { token } = await identityStore.createShare({ sessionId: 'app_alice', createdByUserId: 'user_alice' });
  const runtime = {
    ...runtimeStub(),
    threadIdForTurn: (turnId: string) => turnId === 'turn_alice' ? 'thread_alice' : 'thread_bob',
    getTurnEvents: (turnId: string) => turnId === 'turn_alice'
      ? [{ sequence: 1, event: { type: 'turn.started', turnId: 'turn_alice', threadId: 'thread_alice' } }]
      : [],
  };
  const server = createCodexWebServer({
    auth: authFor({}),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const denied = await fetch(`${server.baseUrl}/api/share/${encodeURIComponent(token)}/turns/turn_bob/events`);
    assert.equal(denied.status, 404);

    const controller = new AbortController();
    const allowedPromise = fetch(`${server.baseUrl}/api/share/${encodeURIComponent(token)}/turns/turn_alice/events`, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    const allowed = await allowedPromise;
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers.get('content-type') ?? '', /^text\/event-stream\b/i);
    controller.abort();
  } finally {
    await server.stop();
  }
});

test('authorized owners can create read-only share links for their sessions', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/app_alice/share`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.match(payload.shareUrl, /^\/share\//u);
    assert.match(payload.token, /^cws_/u);
    const state = await identityStore.readState();
    assert.equal(state.shares.length, 1);
    assert.equal(state.shares[0]?.sessionId, 'app_alice');
    assert.equal(state.shares[0]?.tokenHash.includes(payload.token), false);
  } finally {
    await server.stop();
  }
});

test('admin cannot create share links for another owner session from the normal workspace', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/app_bob/share`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 404);

    const state = await identityStore.readState();
    assert.deepEqual(state.shares, []);
  } finally {
    await server.stop();
  }
});

test('admin settings and project management APIs require admin principal', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const forbidden = await fetch(`${server.baseUrl}/api/admin/settings`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(forbidden.status, 403);

    const settings = await fetch(`${server.baseUrl}/api/admin/settings`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(settings.status, 200);
    assert.equal((await settings.json()).settings.multiUserEnabled, true);

    const create = await fetch(`${server.baseUrl}/api/admin/projects`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'project_new',
        cwd: '/Users/admin/new-secret',
        displayName: '',
      }),
    });
    assert.equal(create.status, 201);
    const payload = await create.json();
    assert.deepEqual(payload.project, {
      id: 'project_new',
      internalName: 'project_new',
      cwd: '/Users/admin/new-secret',
      displayName: 'new-secret',
      enabled: true,
      activeSessionLimit: 30,
      showWorkDetailsToMembers: true,
    });
  } finally {
    await server.stop();
  }
});

test('global site title settings are readable by users and writable only by admin or single-user principals', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
      single: { userId: 'local-admin', username: 'local-admin', roleIds: ['admin'], isAdmin: true, mode: 'single' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const readable = await fetch(`${server.baseUrl}/api/settings`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(readable.status, 200);
    assert.deepEqual(await readable.json(), {
      settings: { siteTitle: 'Codex Web' },
      permissions: { canSetSiteTitle: false },
      features: { publicSharesEnabled: true },
    });

    const forbidden = await fetch(`${server.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteTitle: 'Alice Title' }),
    });
    assert.equal(forbidden.status, 403);

    const adminUpdate = await fetch(`${server.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteTitle: 'Admin Title' }),
    });
    assert.equal(adminUpdate.status, 200);
    assert.deepEqual(await adminUpdate.json(), {
      settings: { siteTitle: 'Admin Title' },
      permissions: { canSetSiteTitle: true },
      features: { publicSharesEnabled: true },
    });

    const singleUpdate = await fetch(`${server.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer single', 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteTitle: 'Single Title' }),
    });
    assert.equal(singleUpdate.status, 200);
    assert.deepEqual(await singleUpdate.json(), {
      settings: { siteTitle: 'Single Title' },
      permissions: { canSetSiteTitle: true },
      features: { publicSharesEnabled: true },
    });

    const state = await identityStore.readState();
    assert.equal(state.settings.siteTitle, 'Single Title');
  } finally {
    await server.stop();
  }
});

test('admin can create roles and users with project assignments', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const role = await fetch(`${server.baseUrl}/api/admin/roles`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'role_writer',
        name: 'Writer',
        projectIds: ['project_allowed'],
      }),
    });
    assert.equal(role.status, 201);
    const rolePayload = await role.json();
    assert.equal(rolePayload.role.id, 'role_writer');
    assert.deepEqual(rolePayload.role.projectGrants, [
      { projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true },
    ]);

    const user = await fetch(`${server.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'writer',
        email: ' writer@example.com ',
        password: 'writer-password',
        roleId: 'role_writer',
      }),
    });
    assert.equal(user.status, 201);
    const payload = await user.json();
    assert.equal(payload.user.id, 'user_writer');
    assert.equal(payload.user.email, 'writer@example.com');
    assert.equal(payload.user.passwordHash, undefined);
    assert.deepEqual(payload.user.roleIds, ['role_writer']);
    assert.equal(payload.user.roleId, 'role_writer');
    assert.equal(payload.user.canNewSession, undefined);

    const users = await fetch(`${server.baseUrl}/api/admin/users`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(users.status, 200);
    const usersPayload = await users.json() as any;
    assert.equal(usersPayload.items.some((item: any) => item.username === 'writer'), true);
    assert.equal(usersPayload.items.find((item: any) => item.id === 'user_writer')?.email, 'writer@example.com');
  } finally {
    await server.stop();
  }
});

test('admin role creation ignores admin flag for non-bootstrap roles', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const role = await fetch(`${server.baseUrl}/api/admin/roles`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'role_writer_admin',
        name: 'Writer Admin',
        isAdmin: true,
        projectIds: ['project_allowed'],
      }),
    });
    assert.equal(role.status, 201);
    const rolePayload = await role.json();
    assert.equal(rolePayload.role.id, 'role_writer_admin');
    assert.equal(rolePayload.role.isAdmin, false);

    const state = await identityStore.readState();
    assert.equal(state.roles.find((item) => item.id === 'role_writer_admin')?.isAdmin, false);
    assert.equal(state.roles.find((item) => item.id === 'role_admin')?.isAdmin, true);
  } finally {
    await server.stop();
  }
});

test('admin can create users with direct project assignments that unlock project selection', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
      writer: { userId: 'user_writer', username: 'writer', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const user = await fetch(`${server.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'writer',
        password: 'writer-password',
        directProjectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true }],
      }),
    });
    assert.equal(user.status, 201);

    const projects = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer writer' },
    });
    assert.equal(projects.status, 200);
    assert.deepEqual(await projects.json(), {
      items: [{ id: 'project_allowed', displayName: 'Allowed Project', canCreate: true, canViewWorkDetails: true, favorite: false }],
    });

    const create = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer writer', 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_allowed' }),
    });
    assert.equal(create.status, 201);
    assert.deepEqual(runtime.calls, ['create:/Users/alice/secret-repo']);
  } finally {
    await server.stop();
  }
});

test('admin create user rejects duplicate usernames when ids are server generated', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'alice',
        password: 'another-password',
      }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'username_conflict',
      message: 'A user with this username already exists.',
    });
  } finally {
    await server.stop();
  }
});

test('project favorites are stored per user and returned with projects', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const favorite = await fetch(`${server.baseUrl}/api/projects/project_allowed/favorite`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(favorite.status, 200);
    assert.deepEqual(await favorite.json(), { projectId: 'project_allowed', favorite: true });

    const aliceProjects = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(aliceProjects.status, 200);
    assert.deepEqual(await aliceProjects.json(), {
      items: [{ id: 'project_allowed', displayName: 'Allowed Project', canCreate: true, canViewWorkDetails: true, favorite: true }],
    });

    const adminProjects = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(adminProjects.status, 200);
    assert.deepEqual(await adminProjects.json(), {
      items: [
        { id: 'project_allowed', displayName: 'Allowed Project', canCreate: true, canViewWorkDetails: true, favorite: false },
        { id: 'project_denied', displayName: 'Other Project', canCreate: true, canViewWorkDetails: true, favorite: false },
      ],
    });

    const state = await identityStore.readState();
    assert.deepEqual(state.users.find((user) => user.id === 'user_alice')?.favoriteProjectIds, ['project_allowed']);
    assert.deepEqual(state.users.find((user) => user.id === 'user_admin')?.favoriteProjectIds, []);
  } finally {
    await server.stop();
  }
});

test('project favorites reject unreadable projects', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const favorite = await fetch(`${server.baseUrl}/api/projects/project_denied/favorite`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(favorite.status, 404);

    const state = await identityStore.readState();
    assert.deepEqual(state.users.find((user) => user.id === 'user_alice')?.favoriteProjectIds, []);
  } finally {
    await server.stop();
  }
});

test('admin can update existing user role without resetting password', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertRole({
    id: 'role_viewer',
    name: 'Viewer',
    isAdmin: false,
    projectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true }],
  });
  const before = await identityStore.readState();
  const originalHash = before.users.find((user) => user.id === 'user_alice')?.passwordHash;
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/admin/users/user_alice`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId: 'role_viewer' }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.user.roleId, 'role_viewer');
    assert.deepEqual(payload.user.roleIds, ['role_viewer']);
    assert.equal(payload.user.canNewSession, undefined);
    assert.equal(payload.user.passwordHash, undefined);

    const after = await identityStore.readState();
    const alice = after.users.find((user) => user.id === 'user_alice');
    assert.equal(alice?.passwordHash, originalHash);
    assert.equal(await identityStore.verifyUserPassword('alice', 'alice-password'), 'user_alice');
  } finally {
    await server.stop();
  }
});

test('admin can delete a user and their related sessions, shares, and auth sessions', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.addUserSession({
    id: 'auth_alice',
    tokenHash: 'hashed-token',
    deviceName: 'Alice Phone',
    createdAt: '2026-05-27T00:00:00.000Z',
    lastSeenAt: '2026-05-27T00:00:00.000Z',
    userId: 'user_alice',
  });
  await identityStore.createShare({
    sessionId: 'app_alice',
    createdByUserId: 'user_alice',
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/admin/users/user_alice`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 204);

    const state = await identityStore.readState();
    assert.equal(state.users.some((user) => user.id === 'user_alice'), false);
    assert.equal(state.sessions.some((session) => session.ownerUserId === 'user_alice'), false);
    assert.equal(state.userSessions.some((session) => session.userId === 'user_alice'), false);
    assert.equal(state.shares.some((share) => share.createdByUserId === 'user_alice' || share.sessionId === 'app_alice'), false);
  } finally {
    await server.stop();
  }
});

test('legacy local admin can enable multi-user mode from default single-user mode', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-mu-toggle-'));
  const identityStore = new FileIdentityStore({ identityPath: path.join(dir, 'identity.json') });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      legacy: { userId: 'local-admin', username: 'local-admin', roleIds: ['admin'], isAdmin: true, mode: 'single' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const before = await fetch(`${server.baseUrl}/api/admin/settings`, {
      headers: { Authorization: 'Bearer legacy' },
    });
    assert.equal(before.status, 200);
    assert.equal((await before.json()).settings.multiUserEnabled, false);

    const toggle = await fetch(`${server.baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer legacy', 'Content-Type': 'application/json' },
      body: JSON.stringify({ multiUserEnabled: true }),
    });
    assert.equal(toggle.status, 200);
    assert.equal((await toggle.json()).settings.multiUserEnabled, true);

    const state = await identityStore.readState();
    assert.equal(state.settings.multiUserEnabled, true);
  } finally {
    await server.stop();
  }
});

test('enabling multi-user mode migrates the legacy password into an admin account', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-mu-migrate-'));
  const legacyAuth = new AuthStore({ authPath: path.join(dir, 'auth.json') });
  await legacyAuth.setPassword('single-password');
  const identityStore = new FileIdentityStore({ identityPath: path.join(dir, 'identity.json') });
  const auth = new HybridAuthStore({ legacyAuth, identityStore });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth,
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const legacyLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'single-password' }),
    });
    assert.equal(legacyLogin.status, 200);
    const { token } = await legacyLogin.json();

    const toggle = await fetch(`${server.baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ multiUserEnabled: true }),
    });
    assert.equal(toggle.status, 200);
    assert.equal(await auth.isConfigured(), true);

    const state = await identityStore.readState();
    const adminRole = state.roles.find((role) => role.isAdmin);
    const adminUser = state.users.find((user) => user.username === 'admin');
    assert.equal(adminRole?.id, 'role_admin');
    assert.deepEqual(adminUser?.roleIds, ['role_admin']);
    assert.notEqual(adminUser?.passwordHash, undefined);
    assert.equal(adminUser?.passwordHash?.includes('single-password'), false);

    const adminLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'single-password' }),
    });
    assert.equal(adminLogin.status, 200);
    const payload = await adminLogin.json();
    assert.equal(payload.session.principal.username, 'admin');
    assert.equal(payload.session.principal.isAdmin, true);
    assert.equal(payload.session.principal.mode, 'multi');
  } finally {
    await server.stop();
  }
});

test('legacy admin tokens continue writing admin-owned sessions after multi-user migration', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-mu-legacy-token-'));
  const legacyAuth = new AuthStore({ authPath: path.join(dir, 'auth.json') });
  await legacyAuth.setPassword('single-password');
  const identityStore = new FileIdentityStore({ identityPath: path.join(dir, 'identity.json') });
  const auth = new HybridAuthStore({ legacyAuth, identityStore });
  const runtime = runtimeStub();

  const legacyLogin = await auth.login({ password: 'single-password', deviceName: 'phone' });
  await auth.setMultiUserEnabled(true);
  await identityStore.upsertProject({
    id: 'project_admin',
    internalName: 'admin-repo',
    cwd: '/Users/admin/admin-repo',
    displayName: 'Admin Project',
    enabled: true,
  });
  await identityStore.upsertSession({
    id: 'app_admin',
    codexThreadId: 'thread_admin',
    projectId: 'project_admin',
    ownerUserId: 'user_admin',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  });

  const server = createCodexWebServer({
    auth,
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/app_admin/turns`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${legacyLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'continue after migration' }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { turnId: 'turn_1' });
    assert.equal(runtime.calls.includes('turn:thread_admin'), true);
  } finally {
    await server.stop();
  }
});

test('loopback thread context resolves the live owner and project without bearer authentication', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertUserWithPassword({
    id: 'user_bob',
    username: 'bob',
    password: 'bob-password',
    roleIds: ['role_user'],
    directProjectGrants: [],
  });
  const server = createCodexWebServer({
    auth: authFor({}),
    identityStore,
    runtime: runtimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const aliceResponse = await fetch(`${server.baseUrl}/api/local/thread-context/thread_alice`, {
      headers: { 'X-Forwarded-For': '203.0.113.10' },
    });
    assert.equal(aliceResponse.status, 200);
    assert.equal(aliceResponse.headers.get('cache-control'), 'no-store');
    const aliceContext = await aliceResponse.json() as any;
    assert.deepEqual(aliceContext.owner, {
      userId: 'user_alice',
      username: 'alice',
      email: null,
    });
    assert.deepEqual(aliceContext.project, { id: 'project_allowed', displayName: 'Allowed Project' });

    const bobResponse = await fetch(`${server.baseUrl}/api/local/thread-context/thread_bob`);
    assert.equal(bobResponse.status, 200);
    const bobContext = await bobResponse.json() as any;
    assert.deepEqual(bobContext.owner, {
      userId: 'user_bob',
      username: 'bob',
      email: null,
    });
    assert.equal((await fetch(`${server.baseUrl}/api/local/thread-context/thread_unknown`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/api/local/thread-context/app_alice`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/api/local/thread-context/`)).status, 404);

    await identityStore.setMultiUserEnabled(false);
    assert.equal((await fetch(`${server.baseUrl}/api/local/thread-context/thread_alice`)).status, 404);
  } finally {
    await server.stop();
  }
});

test('writable app session turns expose only the loopback API URL to the runtime', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-local-context-'));
  const identityStore = await createIdentityStore();
  const starts: any[] = [];
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: {
      ...runtimeStub(),
      startTurn: async (_threadId: string, input: any) => {
        starts.push(input);
        return { turnId: 'turn_mapped' };
      },
    } as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/app_alice/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'context only when requested' }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(starts[0]?.runtimeEnv, {
      CODEX_WEB_LOCAL_API_URL: `http://127.0.0.1:${new URL(server.baseUrl).port}`,
    });
    assert.equal(starts[0]?.developerInstructions, undefined);
    assert.equal(Object.hasOwn(starts[0]?.runtimeEnv ?? {}, 'CODEX_WEB_CONTEXT_FILE'), false);
    await assert.rejects(fs.access(path.join(stateDir, 'runtime-context', 'sessions')));
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('local context socket checks accept only loopback addresses', () => {
  assert.equal(isLoopbackSocketAddress('127.0.0.1'), true);
  assert.equal(isLoopbackSocketAddress('::1'), true);
  assert.equal(isLoopbackSocketAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackSocketAddress('127.0.0.2'), false);
  assert.equal(isLoopbackSocketAddress('192.168.1.20'), false);
  assert.equal(isLoopbackSocketAddress(undefined), false);
});

test('ordinary trusted multi-user requests preserve full access at every input boundary', async () => {
  const identityStore = await createIdentityStore();
  const createInputs: any[] = [];
  const settingsInputs: any[] = [];
  const turnInputs: any[] = [];
  const runtime = {
    ...runtimeStub(),
    createSession: async (input: any) => {
      createInputs.push(input);
      return { id: 'thread_safe', cwd: input.cwd, settings: input.settings, thread: { turns: [] }, timeline: [] };
    },
    updateSessionSettings: async (_threadId: string, input: any) => {
      settingsInputs.push(input);
      return { id: 'thread_alice', settings: input, thread: { turns: [] }, timeline: [] };
    },
    startTurn: async (_threadId: string, input: any) => {
      turnInputs.push(input);
      return { turnId: 'turn_safe' };
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const create = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project_allowed',
        settings: { accessPreset: 'full-access', sandboxMode: 'danger-full-access', approvalPolicy: 'never' },
      }),
    });
    assert.equal(create.status, 201);

    const settings = await fetch(`${server.baseUrl}/api/sessions/app_alice/settings`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessPreset: 'full-access', sandboxMode: 'danger-full-access', approvalPolicy: 'never' }),
    });
    assert.equal(settings.status, 200);

    const turn = await fetch(`${server.baseUrl}/api/sessions/app_alice/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'continue safely',
        settings: { accessPreset: 'full-access', sandboxMode: 'danger-full-access', approvalPolicy: 'never' },
      }),
    });
    assert.equal(turn.status, 202);

    const durableSubmission = await fetch(`${server.baseUrl}/api/session-submissions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: `sub-full-access-${process.pid}-${Date.now()}`,
        projectId: 'project_allowed',
        text: 'start with full access',
        settings: { accessPreset: 'full-access', sandboxMode: 'danger-full-access', approvalPolicy: 'never' },
      }),
    });
    assert.equal(durableSubmission.status, 201);

    for (const policy of [
      createInputs[0]?.settings,
      settingsInputs[0],
      turnInputs[0]?.settings,
      createInputs[1]?.settings,
      turnInputs[1]?.settings,
    ]) {
      assert.equal(policy.accessPreset, 'full-access');
      assert.equal(policy.sandboxMode, 'danger-full-access');
      assert.equal(policy.approvalPolicy, 'never');
    }
  } finally {
    await server.stop();
  }
});

test('multi-user routing denies unlisted fallbacks and reserves usage and reload for admins', async () => {
  const identityStore = await createIdentityStore();
  let usageCalls = 0;
  let reloadCalls = 0;
  const runtime = {
    ...runtimeStub(),
    readUsage: async () => {
      usageCalls += 1;
      return { totalTokens: 1 };
    },
    reloadRuntime: async () => {
      reloadCalls += 1;
      return { mcpServersReloaded: true };
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const aliceUsage = await fetch(`${server.baseUrl}/api/usage`, { headers: { Authorization: 'Bearer alice' } });
    const aliceReload = await fetch(`${server.baseUrl}/api/runtime/reload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
    });
    const unlisted = await fetch(`${server.baseUrl}/api/not-covered-by-multi-user`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(aliceUsage.status, 403);
    assert.equal(aliceReload.status, 403);
    assert.equal(unlisted.status, 404);
    assert.equal(usageCalls, 0);
    assert.equal(reloadCalls, 0);

    const adminUsage = await fetch(`${server.baseUrl}/api/usage`, { headers: { Authorization: 'Bearer admin' } });
    const adminReload = await fetch(`${server.baseUrl}/api/runtime/reload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(adminUsage.status, 200);
    assert.equal(adminReload.status, 200);
    assert.equal(usageCalls, 1);
    assert.equal(reloadCalls, 1);

    await identityStore.setMultiUserEnabled(false);
    const staleMultiPrincipal = await fetch(`${server.baseUrl}/api/usage`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(staleMultiPrincipal.status, 403);
    assert.equal(usageCalls, 1);
  } finally {
    await server.stop();
  }
});

test('session timeline and favorite mutations enforce owner and project write access', async () => {
  const identityStore = await createIdentityStore();
  const calls: string[] = [];
  const runtime = {
    ...runtimeStub(),
    appendSessionTimelineEntry: (threadId: string) => {
      calls.push(`timeline:${threadId}`);
      return { id: 'entry_1', kind: 'message', role: 'system', label: 'System', meta: '', text: 'notice' };
    },
    updateSessionFavorite: async (threadId: string) => {
      calls.push(`favorite:${threadId}`);
      return { id: threadId, settings: {}, thread: { turns: [] }, timeline: [] };
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const foreignTimeline = await fetch(`${server.baseUrl}/api/sessions/app_bob/timeline`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'system', text: 'notice' }),
    });
    const foreignFavorite = await fetch(`${server.baseUrl}/api/sessions/app_bob/favorite`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(foreignTimeline.status, 404);
    assert.equal(foreignFavorite.status, 404);
    assert.deepEqual(calls, []);

    const ownTimeline = await fetch(`${server.baseUrl}/api/sessions/app_alice/timeline`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'system', text: 'notice' }),
    });
    const ownFavorite = await fetch(`${server.baseUrl}/api/sessions/app_alice/favorite`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(ownTimeline.status, 201);
    assert.equal(ownFavorite.status, 200);
    assert.deepEqual(calls, ['timeline:thread_alice', 'favorite:thread_alice']);
  } finally {
    await server.stop();
  }
});

test('compact multi-user timeline enforces ownership and preserves only safe final projection metadata', async () => {
  const identityStore = await createIdentityStore();
  const existingProject = (await identityStore.readState()).projects.find((project) => project.id === 'project_allowed')!;
  await identityStore.upsertProject({ ...existingProject, showWorkDetailsToMembers: false });
  const reads: string[] = [];
  const runtime = {
    ...runtimeStub(),
    readSession: async (threadId: string) => {
      reads.push(threadId);
      return {
        id: threadId,
        settings: {},
        activeTurnId: null,
        goal: null,
        thread: {
          turns: [{
            id: 'turn_compact',
            status: 'completed',
            error: null,
            items: [
              { id: 'item_commentary', type: 'message', role: 'assistant', phase: 'commentary', text: 'Private work' },
              { id: 'item_final', type: 'message', role: 'assistant', phase: 'final_answer', text: 'Safe answer' },
            ],
          }],
        },
        timeline: [{
          id: 'timeline_commentary',
          kind: 'message',
          role: 'assistant',
          label: 'Assistant',
          meta: 'commentary',
          text: 'Private work',
          turnId: 'turn_compact',
          itemId: 'item_commentary',
          projectionKey: 'turn_compact\u0000item_commentary',
          phase: 'commentary',
          lifecycle: 'completed',
        }, {
          id: 'timeline_final',
          kind: 'message',
          role: 'assistant',
          label: 'Assistant',
          meta: 'final',
          text: 'Safe answer',
          turnId: 'turn_compact',
          itemId: 'item_final',
          projectionKey: 'turn_compact\u0000item_final',
          phase: 'final_answer',
          lifecycle: 'completed',
          raw: { secret: true },
        }],
      };
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const foreign = await fetch(`${server.baseUrl}/api/sessions/app_bob/timeline`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(foreign.status, 404);
    assert.deepEqual(reads, []);

    const own = await fetch(`${server.baseUrl}/api/sessions/app_alice/timeline`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(own.status, 200);
    const payload = await own.json() as any;
    assert.deepEqual(reads, ['thread_alice']);
    assert.deepEqual(payload.items, [{
      id: 'timeline_final',
      kind: 'message',
      role: 'assistant',
      label: 'Assistant',
      meta: 'final',
      text: 'Safe answer',
      turnId: 'turn_compact',
      itemId: 'item_final',
      projectionKey: 'turn_compact\u0000item_final',
      phase: 'final_answer',
      lifecycle: 'completed',
    }]);
    assert.equal('turnSnapshot' in payload, true);
    assert.equal(JSON.stringify(payload).includes('Private work'), false);
    assert.equal(JSON.stringify(payload).includes('"raw"'), false);

    const snapshotOmitted = await fetch(`${server.baseUrl}/api/sessions/app_alice/timeline`, {
      headers: {
        Authorization: 'Bearer alice',
        'X-Codex-Include-Turn-Snapshot': 'false',
      },
    });
    const snapshotOmittedPayload = await snapshotOmitted.json() as any;
    assert.equal(snapshotOmitted.status, 200);
    assert.equal('turnSnapshot' in snapshotOmittedPayload, false);

    const older = await fetch(`${server.baseUrl}/api/sessions/app_alice/timeline?before=1`, {
      headers: { Authorization: 'Bearer alice' },
    });
    const olderPayload = await older.json() as any;
    assert.equal(older.status, 200);
    assert.equal('turnSnapshot' in olderPayload, false);
    assert.deepEqual(reads, ['thread_alice', 'thread_alice', 'thread_alice']);
  } finally {
    await server.stop();
  }
});

test('lightweight session status preserves multi-user session ownership checks', async () => {
  const identityStore = await createIdentityStore();
  const statusReads: string[] = [];
  const runtime = {
    ...runtimeStub(),
    readSessionStatus: async (threadId: string) => {
      statusReads.push(threadId);
      return {
        id: threadId,
        cwd: '/secret/path',
        projectName: 'hidden',
        settings: {},
        activeTurnId: null,
        activityState: null,
        thread: { turns: [] },
        timeline: [],
      };
    },
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const foreign = await fetch(`${server.baseUrl}/api/sessions/app_bob/status`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(foreign.status, 404);
    assert.deepEqual(statusReads, []);

    const own = await fetch(`${server.baseUrl}/api/sessions/app_alice/status`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(own.status, 200);
    assert.deepEqual(statusReads, ['thread_alice']);
    const ownPayload = (await own.json()) as any;
    assert.equal(ownPayload.session.id, 'app_alice');
    assert.equal('goal' in ownPayload.session, false);
  } finally {
    await server.stop();
  }
});

test('read-only project grants cannot create or mutate sessions', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertRole({
    id: 'role_user',
    name: 'Reader',
    isAdmin: false,
    projectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: false, canWrite: false }],
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const read = await fetch(`${server.baseUrl}/api/sessions/app_alice`, {
      headers: { Authorization: 'Bearer alice' },
    });
    const create = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_allowed' }),
    });
    const write = await fetch(`${server.baseUrl}/api/sessions/app_alice/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'not permitted' }),
    });
    assert.equal(read.status, 200);
    assert.equal(create.status, 404);
    assert.equal(write.status, 404);
    assert.deepEqual(runtime.calls, ['read:thread_alice']);
  } finally {
    await server.stop();
  }
});

test('multi-user reports are filtered by project grants and omit server paths', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-report-acl-'));
  const identityStore = await createIdentityStore();
  const allowedId = 'project_allowed/allowed.md';
  const deniedId = 'project_denied/denied.md';
  await fs.mkdir(path.join(stateDir, 'reports', 'project_allowed'), { recursive: true });
  await fs.mkdir(path.join(stateDir, 'reports', 'project_denied'), { recursive: true });
  await fs.writeFile(path.join(stateDir, 'reports', allowedId), '# Allowed\n');
  await fs.writeFile(path.join(stateDir, 'reports', deniedId), '# Denied\n');
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtimeStub() as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const list = await fetch(`${server.baseUrl}/api/reports`, { headers: { Authorization: 'Bearer alice' } });
    assert.equal(list.status, 200);
    const payload = await list.json();
    assert.deepEqual(payload.items.map((report: any) => report.id), [allowedId]);
    assert.equal(payload.items[0].path, undefined);

    const denied = await fetch(`${server.baseUrl}/api/reports/${encodeURIComponent(deniedId)}/content`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(denied.status, 404);

    const favoriteMutation = await fetch(`${server.baseUrl}/api/reports/${encodeURIComponent(allowedId)}/favorite`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(favoriteMutation.status, 404);
    await assert.rejects(fs.access(path.join(stateDir, 'report-index.json')), /ENOENT/u);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('hidden projects filter work details from every member session hydration response', async () => {
  const identityStore = await createIdentityStore();
  const existingProject = (await identityStore.readState()).projects.find((project) => project.id === 'project_allowed')!;
  await identityStore.upsertProject({ ...existingProject, showWorkDetailsToMembers: false });
  await identityStore.upsertSession({
    id: 'app_admin',
    codexThreadId: 'thread_admin',
    projectId: 'project_allowed',
    ownerUserId: 'user_admin',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    archived: false,
    archivedAt: null,
    archivedByUserId: null,
    archiveSource: null,
  });
  const sensitiveSession = (threadId: string) => ({
    id: threadId,
    cwd: '/Users/alice/private',
    projectName: 'private',
    settings: {},
    thread: {
      threadId,
      turns: [
        {
          id: 'turn_sensitive',
          status: 'failed',
          error: 'failed at /Users/alice/private/command.sh',
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Safe question' },
            { type: 'message', role: 'assistant', phase: 'commentary', text: 'COMMENTARY /Users/alice/private' },
            { type: 'message', role: 'assistant', phase: 'analysis', text: 'ANALYSIS private reasoning' },
            { type: 'commandExecution', role: null, phase: null, text: 'COMMAND cat /Users/alice/private' },
            { type: 'toolOutput', role: null, phase: null, text: 'OUTPUT private output and DIFF private diff' },
            { type: 'message', role: 'assistant', phase: 'final_answer', text: 'Safe answer' },
          ],
        },
        {
          id: 'turn_legacy_final',
          status: 'completed',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Legacy question' },
            { type: 'message', role: 'assistant', phase: null, text: 'EARLY_NULL_COMMENTARY private path' },
            { type: 'message', role: 'assistant', phase: null, text: 'Legacy safe answer' },
            { type: 'message', role: 'assistant', phase: 'commentary', text: 'LATE_COMMENTARY private path' },
          ],
        },
        {
          id: 'turn_active',
          status: 'inProgress',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Active question' },
            { type: 'message', role: 'assistant', phase: null, text: 'ACTIVE_NULL_COMMENTARY private path' },
            { type: 'message', role: 'assistant', phase: 'final_answer', text: 'Explicit final answer' },
          ],
        },
      ],
    },
    timeline: [
      { id: 'timeline_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Safe question' },
      { id: 'timeline_commentary', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'COMMENTARY /Users/alice/private' },
      { id: 'timeline_analysis', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'ANALYSIS private reasoning' },
      { id: 'timeline_tool', kind: 'message', role: 'system', label: 'Command /Users/alice/private', meta: 'work', text: 'OUTPUT private output and DIFF private diff' },
      { id: 'timeline_final', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Safe answer' },
      { id: 'timeline_error', kind: 'message', role: 'system', label: 'Error /Users/alice/private', meta: 'failed', text: 'failed at /Users/alice/private', severity: 'error' },
      { id: 'timeline_legacy_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Legacy question' },
      { id: 'timeline_legacy_early', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'EARLY_NULL_COMMENTARY private path' },
      { id: 'timeline_legacy_final', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Legacy safe answer' },
      { id: 'timeline_legacy_late', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'commentary', text: 'LATE_COMMENTARY private path' },
      { id: 'timeline_active_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Active question' },
      { id: 'timeline_active_null', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'ACTIVE_NULL_COMMENTARY private path' },
      { id: 'timeline_active_explicit', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Explicit final answer' },
    ],
  });
  const runtime = {
    ...runtimeStub(),
    readSession: async (threadId: string) => sensitiveSession(threadId),
    updateSessionFavorite: async (threadId: string) => sensitiveSession(threadId),
    updateSessionSettings: async (threadId: string) => sensitiveSession(threadId),
    startTurn: async (threadId: string) => ({
      type: 'command',
      command: { name: 'goal', action: 'show', message: 'Goal is active.', goal: null },
      session: sensitiveSession(threadId),
    }),
  };
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const memberResponses = await Promise.all([
      fetch(`${server.baseUrl}/api/sessions/app_alice`, {
        headers: { Authorization: 'Bearer alice' },
      }),
      fetch(`${server.baseUrl}/api/sessions/app_alice/favorite`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: true }),
      }),
      fetch(`${server.baseUrl}/api/sessions/app_alice/settings`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.4' }),
      }),
      fetch(`${server.baseUrl}/api/sessions/app_alice/turns`, {
        method: 'POST',
        headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '/goal' }),
      }),
    ]);
    const memberPayloads = await Promise.all(memberResponses.map(async (response) => {
      assert.ok(response.status === 200 || response.status === 202);
      return response.json();
    }));
    for (const payload of memberPayloads) {
      assert.equal(payload.session.canViewWorkDetails, false);
      assert.deepEqual(
        payload.session.thread.turns[0].items.map((item: any) => item.text),
        ['Safe question', 'Safe answer'],
      );
      assert.equal(payload.session.thread.turns[0].error, 'Turn failed');
      assert.deepEqual(
        payload.session.thread.turns[1].items.map((item: any) => item.text),
        ['Legacy question', 'Legacy safe answer'],
      );
      assert.deepEqual(
        payload.session.thread.turns[2].items.map((item: any) => item.text),
        ['Active question', 'Explicit final answer'],
      );
      assert.deepEqual(
        payload.session.timeline.map((entry: any) => entry.text),
        [
          'Safe question',
          'Safe answer',
          'Turn failed',
          'Legacy question',
          'Legacy safe answer',
          'Active question',
          'Explicit final answer',
        ],
      );
      assert.deepEqual(
        payload.session.timeline.map((entry: any) => entry.meta),
        ['history', 'final', 'failed', 'history', 'final', 'history', 'final'],
      );
      assert.doesNotMatch(
        JSON.stringify(payload),
        /COMMENTARY|ANALYSIS|COMMAND|OUTPUT|DIFF|EARLY_NULL|ACTIVE_NULL|Users\/alice|private reasoning|private output|private diff/u,
      );
    }

    const adminResponse = await fetch(`${server.baseUrl}/api/sessions/app_admin`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(adminResponse.status, 200);
    const adminPayload = await adminResponse.json();
    assert.equal(adminPayload.session.canViewWorkDetails, true);
    assert.deepEqual(
      adminPayload.session.thread.turns[0].items.map((item: any) => item.text),
      [
        'Safe question',
        'COMMENTARY /Users/alice/private',
        'ANALYSIS private reasoning',
        'COMMAND cat /Users/alice/private',
        'OUTPUT private output and DIFF private diff',
        'Safe answer',
      ],
    );
    assert.match(JSON.stringify(adminPayload), /COMMENTARY|ANALYSIS|COMMAND|OUTPUT|DIFF|Users\/alice/u);
  } finally {
    await server.stop();
  }
});

test('session and share DTOs whitelist nested runtime data', async () => {
  const identityStore = await createIdentityStore();
  const { token } = await identityStore.createShare({ sessionId: 'app_alice', createdByUserId: 'user_alice' });
  const runtime = {
    ...runtimeStub(),
    readSession: async () => ({
      id: 'thread_alice',
      cwd: '/Users/alice/private',
      projectName: 'alice/private',
      title: 'Safe title',
      activityState: 'waiting_approval',
      unknownProviderField: 'secret',
      goal: { threadId: 'thread_alice', objective: 'Ship safely', status: 'active', raw: { secret: true } },
      settings: {
        bridgeSessionId: 'thread_alice',
        model: 'gpt-5.4',
        metadata: { cwd: '/Users/alice/private', secret: true },
      },
      thread: {
        threadId: 'thread_alice',
        cwd: '/Users/alice/private',
        path: '/Users/alice/.codex/session.jsonl',
        turns: [
          {
            id: 'turn_1',
            status: 'completed',
            error: null,
            items: [
              { type: 'message', role: 'user', phase: null, text: 'Safe question' },
              { type: 'message', role: 'assistant', phase: 'commentary', text: 'HIDDEN_COMMENTARY' },
              { type: 'message', role: 'assistant', phase: 'analysis', text: 'HIDDEN_ANALYSIS' },
              { type: 'commandExecution', role: null, phase: null, text: 'HIDDEN_TOOL_OUTPUT' },
              {
                type: 'message',
                role: 'assistant',
                phase: 'final_answer',
                text: 'Safe answer',
                savedPath: '/Users/alice/private/output.md',
                raw: { cwd: '/Users/alice/private' },
              },
            ],
          },
          {
            id: 'turn_legacy',
            status: 'completed',
            error: null,
            items: [
              { type: 'message', role: 'assistant', phase: null, text: 'HIDDEN_EARLY_NULL' },
              { type: 'message', role: 'assistant', phase: null, text: 'Legacy answer' },
            ],
          },
          {
            id: 'turn_active',
            status: 'inProgress',
            error: null,
            items: [
              { type: 'message', role: 'assistant', phase: null, text: 'HIDDEN_ACTIVE_NULL' },
            ],
          },
          {
            id: 'turn_failed_null',
            status: 'failed',
            error: 'provider failure',
            items: [
              { type: 'message', role: 'assistant', phase: null, text: 'HIDDEN_FAILED_NULL' },
            ],
          },
          {
            id: 'turn_interrupted_null',
            status: 'interrupted',
            error: null,
            items: [
              { type: 'message', role: 'assistant', phase: null, text: 'HIDDEN_INTERRUPTED_NULL' },
            ],
          },
        ],
      },
      timeline: [
        { id: 'timeline_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Safe question' },
        { id: 'timeline_commentary', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'HIDDEN_COMMENTARY' },
        { id: 'timeline_analysis', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'HIDDEN_ANALYSIS' },
        { id: 'timeline_final', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Safe answer' },
        { id: 'timeline_legacy_early', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'HIDDEN_EARLY_NULL' },
        { id: 'timeline_legacy_final', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Legacy answer' },
        { id: 'timeline_active_null', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'HIDDEN_ACTIVE_NULL' },
        { id: 'timeline_failed_null', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'HIDDEN_FAILED_NULL' },
        { id: 'timeline_interrupted_null', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'HIDDEN_INTERRUPTED_NULL' },
      ],
    }),
  };
  runtime.startTurn = async () => ({
    type: 'command',
    command: {
      name: 'goal',
      action: 'show',
      message: 'Goal is active.',
      goal: { threadId: 'thread_alice', objective: 'Ship safely', status: 'active' },
    },
    session: await runtime.readSession(),
  }) as any;
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig({ publicSharesEnabled: true }),
  });
  await server.start();
  try {
    const workspace = await fetch(`${server.baseUrl}/api/sessions/app_alice`, {
      headers: { Authorization: 'Bearer alice' },
    });
    const share = await fetch(`${server.baseUrl}/api/share/${encodeURIComponent(token)}/session`);
    const command = await fetch(`${server.baseUrl}/api/sessions/app_alice/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '/goal' }),
    });
    assert.equal(workspace.status, 200);
    assert.equal(share.status, 200);
    assert.equal(command.status, 202);
    const workspacePayload = await workspace.json();
    const sharePayload = await share.json();
    const commandPayload = await command.json();
    assert.equal(workspacePayload.session.canViewWorkDetails, true);
    assert.equal(sharePayload.session.canViewWorkDetails, false);
    assert.equal(commandPayload.session.canViewWorkDetails, true);
    for (const payload of [workspacePayload, sharePayload, commandPayload]) {
      const serialized = JSON.stringify(payload);
      assert.doesNotMatch(serialized, /"(?:cwd|threadId|raw|bridgeSessionId|metadata|savedPath)"/u);
      assert.doesNotMatch(serialized, /\/Users\/alice\/private|session\.jsonl|unknownProviderField/u);
    }
    assert.deepEqual(
      workspacePayload.session.thread.turns[0].items.map((item: any) => item.text),
      ['Safe question', 'HIDDEN_COMMENTARY', 'HIDDEN_ANALYSIS', 'HIDDEN_TOOL_OUTPUT', 'Safe answer'],
    );
    assert.deepEqual(
      commandPayload.session.thread.turns[0].items.map((item: any) => item.text),
      ['Safe question', 'HIDDEN_COMMENTARY', 'HIDDEN_ANALYSIS', 'HIDDEN_TOOL_OUTPUT', 'Safe answer'],
    );
    assert.deepEqual(
      sharePayload.session.thread.turns[0].items.map((item: any) => item.text),
      ['Safe question', 'Safe answer'],
    );
    assert.deepEqual(
      sharePayload.session.thread.turns[1].items.map((item: any) => item.text),
      ['Legacy answer'],
    );
    assert.deepEqual(sharePayload.session.thread.turns[2].items, []);
    assert.deepEqual(sharePayload.session.thread.turns[3].items, []);
    assert.deepEqual(sharePayload.session.thread.turns[4].items, []);
    assert.equal(sharePayload.session.thread.turns[3].error, 'Turn failed');
    assert.deepEqual(
      sharePayload.session.timeline.map((entry: any) => entry.text),
      ['Safe question', 'Safe answer', 'Legacy answer'],
    );
    assert.deepEqual(
      sharePayload.session.timeline.map((entry: any) => entry.meta),
      ['history', 'final', 'final'],
    );
    assert.equal(
      workspacePayload.session.timeline.find((entry: any) => entry.text === 'Safe answer')?.meta,
      'history',
    );
    assert.doesNotMatch(
      JSON.stringify(sharePayload),
      /HIDDEN_COMMENTARY|HIDDEN_ANALYSIS|HIDDEN_TOOL_OUTPUT|HIDDEN_EARLY_NULL|HIDDEN_ACTIVE_NULL|HIDDEN_FAILED_NULL|HIDDEN_INTERRUPTED_NULL/u,
    );
    assert.equal(workspacePayload.session.ownerUserId, 'user_alice');
    assert.equal(workspacePayload.session.activityState, 'waiting_approval');
    assert.equal(sharePayload.session.ownerUserId, undefined);
    assert.equal(sharePayload.session.activityState, undefined);
    assert.equal(sharePayload.session.readOnly, true);
    assert.equal(commandPayload.command.goal.objective, 'Ship safely');
  } finally {
    await server.stop();
  }
});

test('public share capabilities require the feature flag and become invalid after revoke or multi-user shutdown', async () => {
  const identityStore = await createIdentityStore();
  const precreated = await identityStore.createShare({ sessionId: 'app_alice', createdByUserId: 'user_alice' });
  const disabledServer = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtimeStub() as any,
    config: createConfig({ publicSharesEnabled: false }),
  });
  await disabledServer.start();
  try {
    const create = await fetch(`${disabledServer.baseUrl}/api/sessions/app_alice/share`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
    });
    const read = await fetch(`${disabledServer.baseUrl}/api/share/${encodeURIComponent(precreated.token)}/session`);
    assert.equal(create.status, 403);
    assert.equal(read.status, 404);
  } finally {
    await disabledServer.stop();
  }

  const enabledRuntime = {
    ...runtimeStub(),
    getTurnEvents: () => [{
      sequence: 1,
      event: {
        id: 'evt_turn_started',
        type: 'turn.started',
        turnId: 'turn_alice',
        threadId: 'thread_alice',
      },
    }],
  };
  const enabledServer = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: enabledRuntime as any,
    config: createConfig({ publicSharesEnabled: true }),
  });
  await enabledServer.start();
  const revokedController = new AbortController();
  const modeController = new AbortController();
  let revokedReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let modeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const createdResponse = await fetch(`${enabledServer.baseUrl}/api/sessions/app_alice/share`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const revokedStream = await fetch(
      `${enabledServer.baseUrl}/api/share/${encodeURIComponent(created.token)}/turns/turn_alice/events`,
      { signal: revokedController.signal },
    );
    assert.equal(revokedStream.status, 200);
    assert.ok(revokedStream.body);
    revokedReader = revokedStream.body.getReader();
    assert.equal((await revokedReader.read()).done, false);

    const revoke = await fetch(`${enabledServer.baseUrl}/api/shares/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(revoke.status, 200);
    assert.equal(await waitForSseClose(revokedReader), true);
    const revokedRead = await fetch(`${enabledServer.baseUrl}/api/share/${encodeURIComponent(created.token)}/session`);
    assert.equal(revokedRead.status, 404);

    await identityStore.upsertRole({
      id: 'role_user',
      name: 'User',
      isAdmin: false,
      projectGrants: [],
    });
    const revokedByGrant = await fetch(`${enabledServer.baseUrl}/api/share/${encodeURIComponent(precreated.token)}/session`);
    assert.equal(revokedByGrant.status, 404);
    await identityStore.upsertRole({
      id: 'role_user',
      name: 'User',
      isAdmin: false,
      projectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true }],
    });
    const restoredGrant = await fetch(`${enabledServer.baseUrl}/api/share/${encodeURIComponent(precreated.token)}/session`);
    assert.equal(restoredGrant.status, 200);

    const modeStream = await fetch(
      `${enabledServer.baseUrl}/api/share/${encodeURIComponent(precreated.token)}/turns/turn_alice/events`,
      { signal: modeController.signal },
    );
    assert.equal(modeStream.status, 200);
    assert.ok(modeStream.body);
    modeReader = modeStream.body.getReader();
    assert.equal((await modeReader.read()).done, false);

    const disableMode = await fetch(`${enabledServer.baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ multiUserEnabled: false }),
    });
    assert.equal(disableMode.status, 200);
    assert.equal((await disableMode.json()).settings.multiUserEnabled, false);
    assert.equal(await waitForSseClose(modeReader), true);
    const disabledByMode = await fetch(`${enabledServer.baseUrl}/api/share/${encodeURIComponent(precreated.token)}/session`);
    assert.equal(disabledByMode.status, 404);
  } finally {
    revokedController.abort();
    modeController.abort();
    await revokedReader?.cancel().catch(() => {});
    await modeReader?.cancel().catch(() => {});
    await enabledServer.stop();
  }
});
