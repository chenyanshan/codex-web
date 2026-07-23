import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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

function createConfig(stateDir: string) {
  return {
    host: '127.0.0.1',
    port: 0,
    defaultCwd: '/tmp',
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

function acceptingAuth() {
  return {
    isConfigured: async () => true,
    login: async () => {
      throw new Error('unused');
    },
    verifyToken: async (token: string | null | undefined) => token === 'token'
      ? { id: 'auth_1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
      : null,
    logout: async () => {},
  };
}

function principalAuth(principals: Record<string, CodexWebPrincipal>) {
  return {
    isConfigured: async () => true,
    login: async () => {
      throw new Error('unused');
    },
    verifyToken: async (token: string | null | undefined) => {
      const principal = token ? principals[token] : null;
      return principal
        ? { id: `auth_${principal.userId}`, deviceName: 'phone', createdAt: '', lastSeenAt: '', principal }
        : null;
    },
    logout: async () => {},
  };
}

function runtimeStub() {
  const sessions = new Map<string, any>();
  const calls = { create: 0, start: 0 };
  const runtime = {
    sessions,
    calls,
    listModels: async () => [],
    readUsage: async () => null,
    listSessions: async () => [...sessions.values()],
    createSession: async ({ cwd, title, settings }: any) => {
      calls.create += 1;
      const id = `thread_${calls.create}`;
      const session = {
        id,
        cwd: cwd ?? '/tmp',
        title: title ?? null,
        settings: settings ?? {},
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
    startTurn: async (sessionId: string, input: { text: string }) => {
      calls.start += 1;
      if (input.text === '/help') {
        return {
          type: 'command',
          command: { name: 'help', action: 'show', message: 'help', goal: null },
          session: sessions.get(sessionId),
        };
      }
      return { turnId: `turn_${calls.start}` };
    },
    interruptTurn: async () => {},
    resolveApproval: async () => {},
    getTurnEvents: () => [],
    subscribeToTurn: () => () => {},
  };
  return runtime;
}

async function postJson(url: string, body: Record<string, unknown>) {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function createMultiUserIdentityStore(stateDir: string) {
  const store = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  await store.setMultiUserEnabled(true);
  await store.upsertProject({
    id: 'project_shared',
    internalName: 'shared',
    cwd: '/tmp/shared-project',
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
  for (const user of ['alice', 'bob']) {
    await store.upsertUserWithPassword({
      id: `user_${user}`,
      username: user,
      password: `${user}-password`,
      canNewSession: true,
      roleIds: ['role_member'],
      directProjectGrants: [],
    });
  }
  return store;
}

test('session submissions create and start exactly once across retries and server restart', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-submission-'));
  const runtime = runtimeStub();
  const config = createConfig(stateDir);
  const body = {
    submissionId: 'sub-restart-1',
    cwd: '/tmp/project',
    title: 'Weak network message',
    settings: { model: 'gpt-test' },
    text: 'hello from the subway',
  };

  const firstServer = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config });
  await firstServer.start();
  try {
    const first = await postJson(`${firstServer.baseUrl}/api/session-submissions`, body);
    assert.equal(first.status, 201);
    const payload = await first.json() as any;
    assert.equal(payload.submission.status, 'submitted');
    assert.equal(payload.submission.sessionId, 'thread_1');
    assert.equal(payload.turnId, 'turn_1');
    assert.equal(payload.session.id, 'thread_1');
  } finally {
    await firstServer.stop();
  }

  const restarted = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config });
  await restarted.start();
  try {
    const replay = await postJson(`${restarted.baseUrl}/api/session-submissions`, body);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as any).turnId, 'turn_1');

    const queried = await fetch(`${restarted.baseUrl}/api/session-submissions/sub-restart-1`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert.equal(queried.status, 200);
    assert.equal((await queried.json() as any).submission.status, 'submitted');
    assert.deepEqual(runtime.calls, { create: 1, start: 1 });
  } finally {
    await restarted.stop();
  }
});

test('successful submissions omit optional session details when response hydration fails', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-submission-hydration-'));
  const runtime = runtimeStub();
  const readSession = runtime.readSession;
  let readCount = 0;
  runtime.readSession = async (id: string) => {
    readCount += 1;
    if (readCount === 2) {
      throw new Error('session rollout is temporarily unreadable');
    }
    return readSession(id);
  };

  const server = createCodexWebServer({
    auth: acceptingAuth(),
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await server.start();
  try {
    const response = await postJson(`${server.baseUrl}/api/session-submissions`, {
      submissionId: 'sub-response-hydration',
      text: 'submission succeeds before hydration',
    });
    assert.equal(response.status, 201);
    const payload = await response.json() as any;
    assert.equal(payload.submission.status, 'submitted');
    assert.equal(payload.turnId, 'turn_1');
    assert.equal('session' in payload, false);
    assert.equal(readCount, 2);
    assert.deepEqual(runtime.calls, { create: 1, start: 1 });

    const stored = await new FileSessionSubmissionStore({ stateDir }).read(
      'local-admin',
      'sub-response-hydration',
    );
    assert.equal(stored?.status, 'submitted');
    assert.equal(stored?.turnId, 'turn_1');

    const replay = await postJson(`${server.baseUrl}/api/session-submissions`, {
      submissionId: 'sub-response-hydration',
      text: 'submission succeeds before hydration',
    });
    assert.equal(replay.status, 200);
    const replayPayload = await replay.json() as any;
    assert.equal(replayPayload.submission.status, 'submitted');
    assert.equal(replayPayload.turnId, 'turn_1');
    assert.deepEqual(runtime.calls, { create: 1, start: 1 });
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('single-user draft attachments upload without creating a session and send with the durable submission', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-draft-attachment-state-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-draft-attachment-project-'));
  const runtime = runtimeStub();
  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const form = new FormData();
    form.append('files', new Blob(['draft attachment'], { type: 'text/plain' }), 'draft.txt');
    const upload = await fetch(
      `${server.baseUrl}/api/session-submission-attachments?cwd=${encodeURIComponent(projectDir)}`,
      { method: 'POST', headers: { Authorization: 'Bearer token' }, body: form },
    );
    assert.equal(upload.status, 201);
    const uploaded = (await upload.json() as any).items[0];
    assert.equal(uploaded.fileName, 'draft.txt');
    assert.match(uploaded.localPath, /uploads\/local-admin\/att_/u);
    assert.deepEqual(runtime.calls, { create: 0, start: 0 });

    const submission = await postJson(`${server.baseUrl}/api/session-submissions`, {
      submissionId: 'sub-with-draft-attachment',
      cwd: projectDir,
      text: 'read the draft attachment',
      attachments: [uploaded],
    });
    assert.equal(submission.status, 201);
    assert.equal((await submission.json() as any).turnId, 'turn_1');
    assert.deepEqual(runtime.calls, { create: 1, start: 1 });
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

test('session submission ids reject payload conflicts without another side effect', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-submission-conflict-'));
  const runtime = runtimeStub();
  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const first = await postJson(`${server.baseUrl}/api/session-submissions`, {
      submissionId: 'sub-conflict',
      text: 'first payload',
    });
    assert.equal(first.status, 201);
    const conflict = await postJson(`${server.baseUrl}/api/session-submissions`, {
      submissionId: 'sub-conflict',
      text: 'different payload',
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json() as any).error, 'submission_conflict');
    assert.deepEqual(runtime.calls, { create: 1, start: 1 });
  } finally {
    await server.stop();
  }
});

test('concurrent requests deduplicate matching payloads and reject conflicting payloads', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-concurrent-submission-'));
  const runtime = runtimeStub();
  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const matchingBody = { submissionId: 'sub-concurrent-match', text: 'same payload' };
    const matching = await Promise.all([
      postJson(`${server.baseUrl}/api/session-submissions`, matchingBody),
      postJson(`${server.baseUrl}/api/session-submissions`, matchingBody),
    ]);
    assert.ok(matching.every((response) => response.status === 201 || response.status === 200));
    assert.deepEqual(runtime.calls, { create: 1, start: 1 });

    const conflicting = await Promise.all([
      postJson(`${server.baseUrl}/api/session-submissions`, {
        submissionId: 'sub-concurrent-conflict', text: 'payload a',
      }),
      postJson(`${server.baseUrl}/api/session-submissions`, {
        submissionId: 'sub-concurrent-conflict', text: 'payload b',
      }),
    ]);
    assert.deepEqual(conflicting.map((response) => response.status).sort(), [201, 409]);
    assert.deepEqual(runtime.calls, { create: 2, start: 2 });
  } finally {
    await server.stop();
  }
});

test('existing turn route uses durable idempotency when submissionId is present', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-existing-submission-'));
  const runtime = runtimeStub();
  runtime.sessions.set('thread_existing', {
    id: 'thread_existing',
    cwd: '/tmp/project',
    settings: {},
    activityState: null,
    thread: { id: 'thread_existing', turns: [] },
    timeline: [],
  });
  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const body = { submissionId: 'sub-existing', text: 'continue this session' };
    const first = await postJson(`${server.baseUrl}/api/sessions/thread_existing/turns`, body);
    assert.equal(first.status, 202);
    assert.equal((await first.json() as any).turnId, 'turn_1');
    const replay = await postJson(`${server.baseUrl}/api/sessions/thread_existing/turns`, body);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as any).turnId, 'turn_1');
    assert.deepEqual(runtime.calls, { create: 0, start: 1 });
  } finally {
    await server.stop();
  }
});

test('GET resumes a persisted starting submission after restart', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-resume-submission-'));
  const runtime = runtimeStub();
  runtime.sessions.set('thread_recovered', {
    id: 'thread_recovered',
    cwd: '/tmp/project',
    settings: {},
    activityState: null,
    thread: { id: 'thread_recovered', turns: [] },
    timeline: [],
  });
  const submissionPayload: CodexWebSessionSubmissionPayload = {
    sessionId: null,
    projectId: null,
    cwd: '/tmp/project',
    title: null,
    settings: {},
    text: 'resume me',
    attachments: [],
    attachmentIds: [],
  };
  const now = new Date().toISOString();
  await new FileSessionSubmissionStore({ stateDir }).create({
    id: 'sub-recover',
    ownerUserId: 'local-admin',
    payloadHash: hashSessionSubmissionPayload(submissionPayload),
    payload: submissionPayload,
    status: 'starting',
    sessionId: 'thread_recovered',
    runtimeSessionId: 'thread_recovered',
    turnBaseline: [],
    turnId: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });

  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/session-submissions/sub-recover`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.equal(payload.submission.status, 'submitted');
    assert.equal(payload.turnId, 'turn_1');
    assert.deepEqual(runtime.calls, { create: 0, start: 1 });
  } finally {
    await server.stop();
  }
});

test('recovery adopts a first turn already accepted before the submission result was persisted', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-adopt-submission-'));
  const runtime = runtimeStub();
  runtime.sessions.set('thread_accepted', {
    id: 'thread_accepted',
    cwd: '/tmp/project',
    firstUserInput: 'accepted before restart',
    activeTurnId: 'turn_already_started',
    settings: {},
    activityState: 'running',
    thread: {
      id: 'thread_accepted',
      turns: [{
        id: 'turn_already_started',
        status: 'inProgress',
        items: [{ type: 'message', role: 'user', phase: null, text: 'accepted before restart' }],
      }],
    },
    timeline: [],
  });
  const submissionPayload: CodexWebSessionSubmissionPayload = {
    sessionId: null,
    projectId: null,
    cwd: '/tmp/project',
    title: null,
    settings: {},
    text: 'accepted before restart',
    attachments: [],
    attachmentIds: [],
  };
  const now = new Date().toISOString();
  await new FileSessionSubmissionStore({ stateDir }).create({
    id: 'sub-adopt',
    ownerUserId: 'local-admin',
    payloadHash: hashSessionSubmissionPayload(submissionPayload),
    payload: submissionPayload,
    status: 'starting',
    sessionId: 'thread_accepted',
    runtimeSessionId: 'thread_accepted',
    turnBaseline: [],
    turnId: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/session-submissions/sub-adopt`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).turnId, 'turn_already_started');
    assert.deepEqual(runtime.calls, { create: 0, start: 0 });
  } finally {
    await server.stop();
  }
});

test('recovery adopts an accepted turn in an existing session using input time and text', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-adopt-existing-submission-'));
  const runtime = runtimeStub();
  runtime.sessions.set('thread_existing_accepted', {
    id: 'thread_existing_accepted',
    cwd: '/tmp/project',
    lastUserInput: 'existing accepted input',
    lastInputAt: Date.now(),
    activeTurnId: null,
    settings: {},
    activityState: null,
    thread: {
      id: 'thread_existing_accepted',
      turns: [{
        id: 'turn_existing_accepted',
        status: 'completed',
        items: [{ type: 'message', role: 'user', phase: null, text: 'existing accepted input' }],
      }],
    },
    timeline: [],
  });
  const submissionPayload: CodexWebSessionSubmissionPayload = {
    sessionId: 'thread_existing_accepted',
    projectId: null,
    cwd: null,
    title: null,
    settings: {},
    text: 'existing accepted input',
    attachments: [],
    attachmentIds: [],
  };
  const now = new Date().toISOString();
  await new FileSessionSubmissionStore({ stateDir }).create({
    id: 'sub-adopt-existing',
    ownerUserId: 'local-admin',
    payloadHash: hashSessionSubmissionPayload(submissionPayload),
    payload: submissionPayload,
    status: 'starting',
    sessionId: 'thread_existing_accepted',
    runtimeSessionId: 'thread_existing_accepted',
    turnBaseline: [],
    turnId: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/session-submissions/sub-adopt-existing`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).turnId, 'turn_existing_accepted');
    assert.deepEqual(runtime.calls, { create: 0, start: 0 });
  } finally {
    await server.stop();
  }
});

test('recovery does not adopt a baseline turn when the process stopped before startTurn', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-before-start-submission-'));
  const runtime = runtimeStub();
  runtime.sessions.set('thread_repeated', {
    id: 'thread_repeated',
    cwd: '/tmp/project',
    firstUserInput: 'continue',
    lastUserInput: 'continue',
    lastInputAt: Date.now(),
    activeTurnId: null,
    settings: {},
    activityState: null,
    thread: {
      id: 'thread_repeated',
      turns: [{
        id: 'turn_previous',
        status: 'completed',
        items: [{ type: 'message', role: 'user', phase: null, text: 'continue' }],
      }],
    },
    timeline: [],
  });
  const submissionPayload: CodexWebSessionSubmissionPayload = {
    sessionId: 'thread_repeated',
    projectId: null,
    cwd: null,
    title: null,
    settings: {},
    text: 'continue',
    attachments: [],
    attachmentIds: [],
  };
  const now = new Date().toISOString();
  await new FileSessionSubmissionStore({ stateDir }).create({
    id: 'sub-before-start',
    ownerUserId: 'local-admin',
    payloadHash: hashSessionSubmissionPayload(submissionPayload),
    payload: submissionPayload,
    status: 'starting',
    sessionId: 'thread_repeated',
    runtimeSessionId: 'thread_repeated',
    turnBaseline: ['turn_previous'],
    turnId: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });

  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/session-submissions/sub-before-start`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).turnId, 'turn_1');
    assert.deepEqual(runtime.calls, { create: 0, start: 1 });
  } finally {
    await server.stop();
  }
});

test('recovery matches long accepted input using the runtime summary normalization', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-long-submission-'));
  const runtime = runtimeStub();
  const text = 'x'.repeat(300);
  runtime.sessions.set('thread_long', {
    id: 'thread_long',
    cwd: '/tmp/project',
    firstUserInput: `${'x'.repeat(237)}...`,
    lastUserInput: `${'x'.repeat(237)}...`,
    lastInputAt: Date.now(),
    activeTurnId: null,
    settings: {},
    activityState: null,
    thread: {
      id: 'thread_long',
      turns: [{
        id: 'turn_long_accepted',
        status: 'completed',
        items: [{ type: 'message', role: 'user', phase: null, text }],
      }],
    },
    timeline: [],
  });
  const submissionPayload: CodexWebSessionSubmissionPayload = {
    sessionId: null,
    projectId: null,
    cwd: '/tmp/project',
    title: null,
    settings: {},
    text,
    attachments: [],
    attachmentIds: [],
  };
  const now = new Date().toISOString();
  await new FileSessionSubmissionStore({ stateDir }).create({
    id: 'sub-long',
    ownerUserId: 'local-admin',
    payloadHash: hashSessionSubmissionPayload(submissionPayload),
    payload: submissionPayload,
    status: 'starting',
    sessionId: 'thread_long',
    runtimeSessionId: 'thread_long',
    turnBaseline: [],
    turnId: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });

  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/session-submissions/sub-long`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).turnId, 'turn_long_accepted');
    assert.deepEqual(runtime.calls, { create: 0, start: 0 });
  } finally {
    await server.stop();
  }
});

test('recovery recognizes an accepted attachment prompt after the upload path was snapshotted', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-attachment-submission-'));
  const runtime = runtimeStub();
  const text = 'inspect this image';
  const runtimePrompt = [
    text,
    '',
    'Attachments:',
    '1. image attachment',
    '   path: /tmp/turn-attachments/snapshot-image.png',
    '   filename: image.png',
    '   mime: image/png',
    '   attached_as: localImage',
    '',
    'Use the local file paths above when you inspect these attachments.',
  ].join('\n');
  runtime.sessions.set('thread_attachment', {
    id: 'thread_attachment',
    cwd: '/tmp/project',
    firstUserInput: 'inspect this image Attachments: 1. image attachment...',
    lastUserInput: 'inspect this image Attachments: 1. image attachment...',
    lastInputAt: Date.now(),
    activeTurnId: null,
    settings: {},
    activityState: null,
    thread: {
      id: 'thread_attachment',
      turns: [{
        id: 'turn_attachment_accepted',
        status: 'completed',
        items: [{ type: 'message', role: 'user', phase: null, text: runtimePrompt }],
      }],
    },
    timeline: [],
  });
  const submissionPayload: CodexWebSessionSubmissionPayload = {
    sessionId: null,
    projectId: null,
    cwd: '/tmp/project',
    title: null,
    settings: {},
    text,
    attachments: [{
      kind: 'image',
      localPath: '/tmp/uploads/original-image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
    }],
    attachmentIds: [],
  };
  const now = new Date().toISOString();
  await new FileSessionSubmissionStore({ stateDir }).create({
    id: 'sub-attachment',
    ownerUserId: 'local-admin',
    payloadHash: hashSessionSubmissionPayload(submissionPayload),
    payload: submissionPayload,
    status: 'starting',
    sessionId: 'thread_attachment',
    runtimeSessionId: 'thread_attachment',
    turnBaseline: [],
    turnId: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });

  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/session-submissions/sub-attachment`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).turnId, 'turn_attachment_accepted');
    assert.deepEqual(runtime.calls, { create: 0, start: 0 });
  } finally {
    await server.stop();
  }
});

test('turn acknowledgement timeout adopts the accepted turn instead of starting it again', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-ack-timeout-submission-'));
  const runtime = runtimeStub();
  const session = {
    id: 'thread_ack_timeout',
    cwd: '/tmp/project',
    firstUserInput: 'older message',
    lastUserInput: 'older message',
    lastInputAt: Date.now(),
    activeTurnId: null,
    settings: {},
    activityState: null,
    thread: {
      id: 'thread_ack_timeout',
      turns: [{
        id: 'turn_old',
        status: 'completed',
        items: [{ type: 'message', role: 'user', phase: null, text: 'older message' }],
      }],
    },
    timeline: [],
  };
  runtime.sessions.set(session.id, session);
  runtime.startTurn = async (_sessionId: string, input: { text: string }) => {
    runtime.calls.start += 1;
    session.lastUserInput = input.text;
    session.lastInputAt = Date.now();
    session.thread.turns.push({
      id: 'turn_acknowledged_late',
      status: 'inProgress',
      items: [{ type: 'message', role: 'user', phase: null, text: input.text }],
    });
    throw new Error('turn/start acknowledgement timed out');
  };

  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const response = await postJson(`${server.baseUrl}/api/sessions/${session.id}/turns`, {
      submissionId: 'sub-ack-timeout',
      text: 'accepted before the acknowledgement',
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json() as any).turnId, 'turn_acknowledged_late');
    assert.deepEqual(runtime.calls, { create: 0, start: 1 });

    const replay = await postJson(`${server.baseUrl}/api/sessions/${session.id}/turns`, {
      submissionId: 'sub-ack-timeout',
      text: 'accepted before the acknowledgement',
    });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as any).turnId, 'turn_acknowledged_late');
    assert.deepEqual(runtime.calls, { create: 0, start: 1 });
  } finally {
    await server.stop();
  }
});

test('same-text concurrent submissions do not adopt a turn rejected by turn_conflict', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-same-text-conflict-'));
  const runtime = runtimeStub();
  const session = {
    id: 'thread_same_text',
    cwd: '/tmp/project',
    firstUserInput: null,
    lastUserInput: null,
    lastInputAt: Date.now(),
    activeTurnId: null as string | null,
    settings: {},
    activityState: null,
    thread: { id: 'thread_same_text', turns: [] as any[] },
    timeline: [],
  };
  runtime.sessions.set(session.id, session);
  let releaseBothStarts: (() => void) | null = null;
  const bothStarts = new Promise<void>((resolve) => {
    releaseBothStarts = resolve;
  });
  runtime.startTurn = async (_sessionId: string, input: { text: string }) => {
    runtime.calls.start += 1;
    if (runtime.calls.start <= 2) {
      if (runtime.calls.start === 2) {
        releaseBothStarts?.();
      }
      await bothStarts;
    }
    if (session.activeTurnId) {
      const error = new Error(`Session already has an active turn (${session.activeTurnId}).`) as Error & {
        code: string;
        activeTurnId: string;
      };
      error.code = 'turn_conflict';
      error.activeTurnId = session.activeTurnId;
      throw error;
    }
    const turnId = runtime.calls.start <= 2 ? 'turn_first_submission' : 'turn_second_submission';
    session.activeTurnId = turnId;
    session.lastUserInput = input.text;
    session.lastInputAt = Date.now();
    session.thread.turns.push({
      id: turnId,
      status: 'inProgress',
      items: [{ type: 'message', role: 'user', phase: null, text: input.text }],
    });
    return { turnId };
  };

  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const submissions = ['sub-same-a', 'sub-same-b'];
    const responses = await Promise.all(submissions.map((submissionId) => postJson(
      `${server.baseUrl}/api/sessions/${session.id}/turns`,
      { submissionId, text: 'continue' },
    )));
    assert.deepEqual(responses.map((response) => response.status).sort(), [202, 409]);
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<any>));
    const conflictIndex = responses.findIndex((response) => response.status === 409);
    assert.equal(payloads[conflictIndex].error, 'turn_conflict');
    const conflictRecord = await new FileSessionSubmissionStore({ stateDir }).read(
      'local-admin',
      submissions[conflictIndex]!,
    );
    assert.equal(conflictRecord?.status, 'failed');
    assert.equal(conflictRecord?.turnBaseline, null);

    session.activeTurnId = null;
    session.thread.turns[0].status = 'completed';
    const retry = await postJson(`${server.baseUrl}/api/sessions/${session.id}/turns`, {
      submissionId: submissions[conflictIndex],
      text: 'continue',
    });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json() as any).turnId, 'turn_second_submission');
    assert.equal(runtime.calls.start, 3);
  } finally {
    await server.stop();
  }
});

test('retryable failed submissions recover accepted turns before retrying startTurn', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-failed-recovery-submission-'));
  const runtime = runtimeStub();
  const text = 'accepted before restart';
  runtime.sessions.set('thread_failed_recovery', {
    id: 'thread_failed_recovery',
    cwd: '/tmp/project',
    firstUserInput: 'old',
    lastUserInput: text,
    lastInputAt: Date.now(),
    activeTurnId: null,
    settings: {},
    activityState: null,
    thread: {
      id: 'thread_failed_recovery',
      turns: [
        { id: 'turn_old', status: 'completed', items: [{ type: 'message', role: 'user', phase: null, text: 'old' }] },
        { id: 'turn_accepted', status: 'completed', items: [{ type: 'message', role: 'user', phase: null, text }] },
      ],
    },
    timeline: [],
  });
  const submissionPayload: CodexWebSessionSubmissionPayload = {
    sessionId: 'thread_failed_recovery',
    projectId: null,
    cwd: null,
    title: null,
    settings: {},
    text,
    attachments: [],
    attachmentIds: [],
  };
  const now = new Date().toISOString();
  await new FileSessionSubmissionStore({ stateDir }).create({
    id: 'sub-failed-recovery',
    ownerUserId: 'local-admin',
    payloadHash: hashSessionSubmissionPayload(submissionPayload),
    payload: submissionPayload,
    status: 'failed',
    sessionId: 'thread_failed_recovery',
    runtimeSessionId: 'thread_failed_recovery',
    turnBaseline: ['turn_old'],
    turnId: null,
    result: null,
    error: {
      code: 'submission_failed',
      message: 'acknowledgement lost',
      retryable: true,
      outcomeUnknown: true,
    },
    createdAt: now,
    updatedAt: now,
  });

  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/session-submissions/sub-failed-recovery`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).turnId, 'turn_accepted');
    assert.deepEqual(runtime.calls, { create: 0, start: 0 });
  } finally {
    await server.stop();
  }
});

test('independent servers serialize the same submission through the file operation lock', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-cross-process-submission-'));
  const runtime = runtimeStub();
  const createSession = runtime.createSession;
  runtime.createSession = async (input: any) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return createSession(input);
  };
  const config = createConfig(stateDir);
  const firstServer = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config });
  const secondServer = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config });
  await Promise.all([firstServer.start(), secondServer.start()]);
  try {
    const body = { submissionId: 'sub-cross-process', text: 'run exactly once' };
    const responses = await Promise.all([
      postJson(`${firstServer.baseUrl}/api/session-submissions`, body),
      postJson(`${secondServer.baseUrl}/api/session-submissions`, body),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<any>));
    assert.equal(payloads[0].submission.sessionId, payloads[1].submission.sessionId);
    assert.equal(payloads[0].turnId, payloads[1].turnId);
    assert.deepEqual(runtime.calls, { create: 1, start: 1 });
  } finally {
    await Promise.all([firstServer.stop(), secondServer.stop()]);
  }
});

test('independent servers serialize multi-user creation before enforcing the active session limit', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-project-limit-lock-'));
  const identityStore = await createMultiUserIdentityStore(stateDir);
  await identityStore.upsertProject({
    id: 'project_shared',
    internalName: 'shared',
    cwd: '/tmp/shared-project',
    displayName: 'Shared Project',
    enabled: true,
    activeSessionLimit: 1,
    showWorkDetailsToMembers: false,
  });
  const reopenedIdentityStore = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  const runtime = runtimeStub();
  const createSession = runtime.createSession;
  runtime.createSession = async (input: any) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return createSession(input);
  };
  const alice = {
    userId: 'user_alice',
    username: 'alice',
    roleIds: ['role_member'],
    isAdmin: false,
    mode: 'multi' as const,
  };
  const firstServer = createCodexWebServer({
    auth: principalAuth({ alice }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  const secondServer = createCodexWebServer({
    auth: principalAuth({ alice }),
    identityStore: reopenedIdentityStore,
    runtime: runtime as any,
    config: createConfig(stateDir),
  });
  await Promise.all([firstServer.start(), secondServer.start()]);
  try {
    const submit = (baseUrl: string, submissionId: string) => fetch(`${baseUrl}/api/session-submissions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId, projectId: 'project_shared', text: submissionId }),
    });
    const responses = await Promise.all([
      submit(firstServer.baseUrl, 'project-limit-a'),
      submit(secondServer.baseUrl, 'project-limit-b'),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const rejected = responses.find((response) => response.status === 409)!;
    assert.equal((await rejected.json() as any).error, 'active_session_limit_reached');
    assert.deepEqual(runtime.calls, { create: 1, start: 1 });
    const state = await identityStore.readState();
    assert.equal(state.sessions.filter((session) => (
      session.ownerUserId === 'user_alice'
      && session.projectId === 'project_shared'
      && session.archived === false
    )).length, 1);
  } finally {
    await Promise.all([firstServer.stop(), secondServer.stop()]);
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('command submissions persist and replay command results without requiring a turn id', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-command-submission-'));
  const runtime = runtimeStub();
  runtime.sessions.set('thread_command', {
    id: 'thread_command',
    cwd: '/tmp/project',
    settings: {},
    activityState: null,
    thread: { id: 'thread_command', turns: [] },
    timeline: [],
  });
  const server = createCodexWebServer({ auth: acceptingAuth(), runtime: runtime as any, config: createConfig(stateDir) });
  await server.start();
  try {
    const body = { submissionId: 'sub-command', text: '/help' };
    const first = await postJson(`${server.baseUrl}/api/sessions/thread_command/turns`, body);
    assert.equal(first.status, 202);
    const firstPayload = await first.json() as any;
    assert.equal(firstPayload.submission.status, 'submitted');
    assert.equal(firstPayload.submission.turnId, null);
    assert.equal(firstPayload.type, 'command');
    assert.equal(firstPayload.command.message, 'help');
    const replay = await postJson(`${server.baseUrl}/api/sessions/thread_command/turns`, body);
    assert.equal((await replay.json() as any).type, 'command');
    assert.equal(runtime.calls.start, 1);
  } finally {
    await server.stop();
  }
});

test('multi-user draft attachment uploads require current project create access', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-multi-draft-attachment-state-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-multi-draft-attachment-project-'));
  const identityStore = await createMultiUserIdentityStore(stateDir);
  await identityStore.upsertProject({
    id: 'project_shared',
    internalName: 'shared',
    cwd: projectDir,
    displayName: 'Shared Project',
    enabled: true,
    activeSessionLimit: null,
    showWorkDetailsToMembers: false,
  });
  const runtime = runtimeStub();
  const alice = {
    userId: 'user_alice', username: 'alice', roleIds: ['role_member'], isAdmin: false, mode: 'multi' as const,
  };
  const server = createCodexWebServer({
    auth: principalAuth({ alice }),
    runtime: runtime as any,
    config: createConfig(stateDir),
    identityStore,
  });
  await server.start();
  try {
    const form = new FormData();
    form.append('files', new Blob(['shared draft'], { type: 'text/plain' }), 'shared.txt');
    const upload = await fetch(`${server.baseUrl}/api/session-submission-attachments?projectId=project_shared`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
      body: form,
    });
    assert.equal(upload.status, 201);
    const uploaded = (await upload.json() as any).items[0];
    assert.match(uploaded.localPath, /uploads\/user_alice\/att_/u);
    assert.deepEqual(runtime.calls, { create: 0, start: 0 });

    const submission = await fetch(`${server.baseUrl}/api/session-submissions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: 'sub-multi-draft-attachment',
        projectId: 'project_shared',
        text: 'read the shared draft',
        attachments: [uploaded],
      }),
    });
    assert.equal(submission.status, 201);
    assert.equal((await submission.json() as any).turnId, 'turn_1');
    assert.deepEqual(runtime.calls, { create: 1, start: 1 });

    await identityStore.updateUserAccess({ id: 'user_alice', roleIds: [] });
    const deniedForm = new FormData();
    deniedForm.append('files', new Blob(['denied'], { type: 'text/plain' }), 'denied.txt');
    const denied = await fetch(`${server.baseUrl}/api/session-submission-attachments?projectId=project_shared`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
      body: deniedForm,
    });
    assert.equal(denied.status, 404);
    assert.equal((await denied.json() as any).error, 'project_not_found');
    assert.deepEqual(runtime.calls, { create: 1, start: 1 });
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

test('multi-user submissions are owner-scoped and recheck project access before recovery', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-multi-submission-'));
  const identityStore = await createMultiUserIdentityStore(stateDir);
  const runtime = runtimeStub();
  const principals = {
    alice: {
      userId: 'user_alice', username: 'alice', roleIds: ['role_member'], isAdmin: false, mode: 'multi' as const,
    },
    bob: {
      userId: 'user_bob', username: 'bob', roleIds: ['role_member'], isAdmin: false, mode: 'multi' as const,
    },
  };
  const server = createCodexWebServer({
    auth: principalAuth(principals),
    runtime: runtime as any,
    config: createConfig(stateDir),
    identityStore,
  });
  await server.start();
  try {
    const aliceCreate = await fetch(`${server.baseUrl}/api/session-submissions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: 'shared-id', projectId: 'project_shared', text: 'alice message' }),
    });
    assert.equal(aliceCreate.status, 201);
    const alicePayload = await aliceCreate.json() as any;
    assert.equal(alicePayload.submission.status, 'submitted');
    assert.notEqual(alicePayload.submission.sessionId, 'thread_1');
    assert.equal(alicePayload.session.ownerUserId, 'user_alice');

    const bobCannotReadAlice = await fetch(`${server.baseUrl}/api/session-submissions/shared-id`, {
      headers: { Authorization: 'Bearer bob' },
    });
    assert.equal(bobCannotReadAlice.status, 404);

    const bobCreate = await fetch(`${server.baseUrl}/api/session-submissions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer bob', 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: 'shared-id', projectId: 'project_shared', text: 'bob message' }),
    });
    assert.equal(bobCreate.status, 201);
    assert.equal((await bobCreate.json() as any).session.ownerUserId, 'user_bob');
    assert.deepEqual(runtime.calls, { create: 2, start: 2 });

    const queuedPayload: CodexWebSessionSubmissionPayload = {
      sessionId: null,
      projectId: 'project_shared',
      cwd: null,
      title: null,
      settings: {},
      text: 'must not run after revoke',
      attachments: [],
      attachmentIds: [],
    };
    const now = new Date().toISOString();
    await new FileSessionSubmissionStore({ stateDir }).create({
      id: 'revoked-id',
      ownerUserId: 'user_alice',
      payloadHash: hashSessionSubmissionPayload(queuedPayload),
      payload: queuedPayload,
      status: 'queued',
      sessionId: null,
      runtimeSessionId: null,
      turnBaseline: null,
      turnId: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    await identityStore.updateUserAccess({ id: 'user_alice', roleIds: [] });
    const revoked = await fetch(`${server.baseUrl}/api/session-submissions/revoked-id`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(revoked.status, 404);
    assert.deepEqual(runtime.calls, { create: 2, start: 2 });
  } finally {
    await server.stop();
  }
});
