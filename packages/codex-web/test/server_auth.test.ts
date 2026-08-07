import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CodexWebEventBus } from '../src/event_bus.js';
import { FileIdentityStore } from '../src/identity_store.js';
import { createCodexWebServer } from '../src/server.js';

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
  managedStorageMaxBytes?: number;
  projectUploadMaxBytes?: number;
  uploadTtlSeconds?: number;
  turnAttachmentTtlSeconds?: number;
  reportTtlSeconds?: number;
  runtimeContextTtlSeconds?: number;
  timelineMaxEntriesPerSession?: number;
  timelineMaxBytes?: number;
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
    publicSharesEnabled: false,
    publicShareTtlSeconds: 86_400,
    ...overrides,
  };
}

function createAcceptingAuth() {
  return {
    isConfigured: async () => true,
    login: async () => ({
      token: 'cw_token',
      session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' },
      configuredNow: false,
    }),
    verifyToken: async (token: string | null | undefined) => token === 'cw_token'
      ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
      : null,
    logout: async () => {},
  };
}

function createRuntimeStub() {
  return {
    listModels: async () => [],
    readUsage: async () => null,
    listSessions: async () => [],
    createSession: async () => ({ id: 'thread_1' }),
    readSession: async () => ({ id: 'thread_1' }),
    archiveSession: async () => true,
    updateSessionFavorite: async () => ({ id: 'thread_1', favorite: true }),
    updateSessionSettings: async () => ({ id: 'thread_1' }),
    reloadRuntime: async () => ({ mcpServersReloaded: true }),
    startTurn: async () => ({ turnId: 'turn_1' }),
    interruptTurn: async () => {},
    resolveApproval: async () => {},
    getTurnEvents: () => [],
    subscribeToTurn: () => () => {},
  };
}

function assertSecurityHeaders(response: Response): void {
  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/u);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
}

test('API routes reject missing bearer token', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(response.status, 401);
  } finally {
    await server.stop();
  }
});

test('API routes accept valid bearer token', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/health`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  } finally {
    await server.stop();
  }
});

test('large JSON responses negotiate gzip compression', async () => {
  const runtime = {
    ...createRuntimeStub(),
    listModels: async () => Array.from({ length: 20 }, (_, index) => ({
      id: `model-${index}`,
      model: `model-${index}`,
      displayName: `Model ${index} with a deliberately descriptive display name`,
      isDefault: index === 0,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium',
    })),
  };
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/models`, {
      headers: {
        Authorization: 'Bearer cw_token',
        'Accept-Encoding': 'gzip',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.match(response.headers.get('vary') ?? '', /Accept-Encoding/iu);
    assert.equal(((await response.json()) as any).items.length, 20);
  } finally {
    await server.stop();
  }
});

test('static, API, and error responses use the common browser security policy', async () => {
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const [staticResponse, apiResponse, errorResponse, settingsResponse] = await Promise.all([
      fetch(`${server.baseUrl}/`),
      fetch(`${server.baseUrl}/api/health`, { headers: { Authorization: 'Bearer cw_token' } }),
      fetch(`${server.baseUrl}/api/health`),
      fetch(`${server.baseUrl}/api/settings`, { headers: { Authorization: 'Bearer cw_token' } }),
    ]);
    for (const response of [staticResponse, apiResponse, errorResponse, settingsResponse]) {
      assertSecurityHeaders(response);
    }
    assert.match(staticResponse.headers.get('content-security-policy') ?? '', /worker-src 'self'/u);
    assert.equal(errorResponse.status, 401);
    assert.equal(((await settingsResponse.json()) as any).features.publicSharesEnabled, false);
  } finally {
    await server.stop();
  }
});

test('authenticated settings expose the server-side public-share feature flag', async () => {
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig({ publicSharesEnabled: true }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/settings`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.equal(payload.features.publicSharesEnabled, true);
  } finally {
    await server.stop();
  }
});

test('GET /api/models includes effective Codex config defaults in the existing response', async () => {
  const runtime = {
    ...createRuntimeStub(),
    listModels: async () => [{
      id: 'gpt-5.6-sol',
      model: 'gpt-5.6-sol',
      displayName: 'GPT-5.6-Sol',
      isDefault: true,
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultReasoningEffort: 'low',
    }],
    readConfigDefaults: async () => ({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
    }),
  };
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/models`, {
      headers: { Authorization: 'Bearer cw_token' },
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.equal(payload.items[0]?.defaultReasoningEffort, 'low');
    assert.deepEqual(payload.defaults, {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
    });
  } finally {
    await server.stop();
  }
});

test('POST /api/sessions/:sessionId/attachments stores uploads in the session project', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-upload-state-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-upload-project-'));
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      readSession: async () => ({ id: 'thread_1', cwd: projectDir }),
    } as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const form = new FormData();
    form.append('files', new Blob(['hello upload'], { type: 'text/plain' }), 'notes.txt');

    const response = await fetch(`${server.baseUrl}/api/sessions/thread_1/attachments`, {
      method: 'POST',
      headers: { Authorization: 'Bearer cw_token' },
      body: form,
    });

    assert.equal(response.status, 201);
    const payload = await response.json() as any;
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].fileName, 'notes.txt');
    assert.equal(payload.items[0].mimeType, 'text/plain');
    assert.equal(payload.items[0].storage, 'project');
    assert.match(payload.items[0].localPath, /uploads\/local-admin\/att_/u);
    assert.equal(await fs.readFile(payload.items[0].localPath, 'utf8'), 'hello upload');
    assert.equal(await fs.readFile(path.join(projectDir, 'uploads', '.gitignore'), 'utf8'), '*\n!.gitignore\n');
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

test('POST /api/sessions/:sessionId/attachments rejects files that exceed the project upload quota', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-upload-state-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-upload-project-'));
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      readSession: async () => ({ id: 'thread_1', cwd: projectDir }),
    } as any,
    config: createConfig({ stateDir, projectUploadMaxBytes: 5 }),
  });
  await server.start();
  try {
    const form = new FormData();
    form.append('files', new Blob(['too large'], { type: 'text/plain' }), 'notes.txt');

    const response = await fetch(`${server.baseUrl}/api/sessions/thread_1/attachments`, {
      method: 'POST',
      headers: { Authorization: 'Bearer cw_token' },
      body: form,
    });

    assert.equal(response.status, 507);
    assert.deepEqual(await response.json(), {
      error: 'storage_quota_exceeded',
      message: 'Managed storage quota is full. Remove old managed files and try again.',
    });
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

test('POST /api/sessions/:sessionId/attachments falls back to state storage when project storage is not writable', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-upload-state-'));
  const projectFile = path.join(stateDir, 'not-a-directory');
  await fs.writeFile(projectFile, 'project path is a file');
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      readSession: async () => ({ id: 'thread_1', cwd: projectFile }),
    } as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const form = new FormData();
    form.append('files', new Blob(['fallback upload'], { type: 'application/pdf' }), 'brief.pdf');

    const response = await fetch(`${server.baseUrl}/api/sessions/thread_1/attachments`, {
      method: 'POST',
      headers: { Authorization: 'Bearer cw_token' },
      body: form,
    });

    assert.equal(response.status, 201);
    const payload = await response.json() as any;
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].storage, 'state');
    assert.equal(payload.items[0].fileName, 'brief.pdf');
    assert.match(payload.items[0].localPath, /uploads\/projects\/cwd-[a-f0-9]+\/local-admin\/att_/u);
    assert.equal(await fs.readFile(payload.items[0].localPath, 'utf8'), 'fallback upload');
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('POST /api/sessions/:sessionId/turns accepts attachments only from upload roots', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-turn-attachments-state-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-turn-attachments-project-'));
  const uploadedPath = path.join(projectDir, 'uploads', 'local-admin', 'att_safe-notes.txt');
  await fs.mkdir(path.dirname(uploadedPath), { recursive: true });
  await fs.writeFile(uploadedPath, 'safe');
  const startTurnInputs: any[] = [];
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      readSession: async () => ({ id: 'thread_1', cwd: projectDir }),
      startTurn: async (_sessionId: string, input: any) => {
        startTurnInputs.push(input);
        return { turnId: 'turn_1' };
      },
    } as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const accepted = await fetch(`${server.baseUrl}/api/sessions/thread_1/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Read the attachment',
        attachments: [{
          kind: 'file',
          localPath: uploadedPath,
          fileName: 'notes.txt',
          mimeType: 'text/plain',
        }],
      }),
    });
    assert.equal(accepted.status, 202);
    const snapshotPath = startTurnInputs[0]?.attachments[0]?.localPath;
    assert.notEqual(snapshotPath, uploadedPath);
    assert.match(snapshotPath, /turn-attachments\/local-admin\/thread_1\//u);
    assert.equal(await fs.readFile(snapshotPath, 'utf8'), 'safe');
    assert.equal((await fs.stat(snapshotPath)).mode & 0o777, 0o400);
    await fs.writeFile(uploadedPath, 'changed after validation');
    assert.equal(await fs.readFile(snapshotPath, 'utf8'), 'safe');

    const rejected = await fetch(`${server.baseUrl}/api/sessions/thread_1/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Read the attachment',
        attachments: [{
          kind: 'file',
          localPath: path.join(projectDir, 'secret.txt'),
          fileName: 'secret.txt',
          mimeType: 'text/plain',
        }],
      }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), {
      error: 'invalid_attachment',
      message: 'Attachment path is outside the allowed upload directories.',
    });

    const outsidePath = path.join(projectDir, 'outside-secret.txt');
    const symlinkPath = path.join(projectDir, 'uploads', 'local-admin', 'att_link.txt');
    await fs.writeFile(outsidePath, 'outside secret');
    await fs.symlink(outsidePath, symlinkPath);
    const symlinkRejected = await fetch(`${server.baseUrl}/api/sessions/thread_1/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Read the attachment',
        attachments: [{ kind: 'file', localPath: symlinkPath, fileName: 'link.txt' }],
      }),
    });
    assert.equal(symlinkRejected.status, 400);
    assert.deepEqual(await symlinkRejected.json(), {
      error: 'invalid_attachment',
      message: 'Attachment paths must not contain symbolic links.',
    });
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

test('POST /api/auth/login is public', async () => {
  let called = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async ({ password, deviceName }) => {
        called = true;
        assert.equal(password, 'secret-password');
        assert.equal(deviceName, 'iPhone Safari');
        return {
          token: 'cw_token',
          session: { id: 's1', deviceName: 'iPhone Safari', createdAt: '', lastSeenAt: '' },
          configuredNow: false,
        };
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'secret-password',
        deviceName: 'iPhone Safari',
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(called, true);
    assert.match((await response.json()).token, /^cw_/);
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login returns 401 for invalid passwords', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        throw new Error('Invalid password');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'bad-password',
        deviceName: 'iPhone Safari',
      }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'invalid_password',
      message: 'Invalid password',
    });
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login rate limits repeated attempts before password verification', async () => {
  let loginCalls = 0;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        loginCalls += 1;
        throw new Error('Invalid password');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: `bad-password-${index}`,
          deviceName: 'iPhone Safari',
        }),
      });
      assert.equal(response.status, 401);
    }

    const limited = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'bad-password-limited',
        deviceName: 'iPhone Safari',
      }),
    });
    assert.equal(limited.status, 429);
    const retryAfter = Number(limited.headers.get('retry-after'));
    assert.equal(Number.isInteger(retryAfter), true);
    assert.ok(retryAfter >= 1 && retryAfter <= 60);
    const payload = await limited.json();
    assert.equal(payload.error, 'rate_limited');
    assert.equal(payload.message, 'Too many login attempts. Try again later.');
    assert.equal(Number.isInteger(payload.retryAfterSeconds), true);
    assert.ok(payload.retryAfterSeconds >= 1 && payload.retryAfterSeconds <= 60);
    assert.deepEqual(Object.keys(payload).sort(), ['error', 'message', 'retryAfterSeconds']);
    assert.equal(loginCalls, 10);
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login does not trust spoofed forwarded headers for rate limits', async () => {
  let loginCalls = 0;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        loginCalls += 1;
        throw new Error('Invalid password');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `203.0.113.${index}`,
        },
        body: JSON.stringify({
          password: `bad-password-${index}`,
          deviceName: 'iPhone Safari',
        }),
      });
      assert.equal(response.status, 401);
    }

    const limited = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.250',
      },
      body: JSON.stringify({
        password: 'bad-password-limited',
        deviceName: 'iPhone Safari',
      }),
    });
    assert.equal(limited.status, 429);
    assert.equal(loginCalls, 10);
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login rejects oversized bodies before password verification', async () => {
  let loginCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        loginCalled = true;
        throw new Error('unused');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'x'.repeat(70 * 1024),
      }),
    });
    assert.equal(response.status, 413);
    assert.equal(loginCalled, false);
    assert.deepEqual(await response.json(), {
      error: 'payload_too_large',
      message: 'Request body is too large.',
    });
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login rejects malformed JSON with 400', async () => {
  let loginCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        loginCalled = true;
        throw new Error('unused');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"password":',
    });
    assert.equal(response.status, 400);
    assert.equal(loginCalled, false);
    assert.deepEqual(await response.json(), {
      error: 'invalid_json',
      message: 'Request body must be valid JSON.',
    });
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login rejects non-object JSON with 400', async () => {
  let loginCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        loginCalled = true;
        throw new Error('unused');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    assert.equal(response.status, 400);
    assert.equal(loginCalled, false);
    assert.deepEqual(await response.json(), {
      error: 'invalid_json',
      message: 'Request body must be a JSON object.',
    });
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login returns setup_required when password is not configured', async () => {
  let loginCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => false,
      login: async () => {
        loginCalled = true;
        return {
          token: 'cw_token',
          session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' },
          configuredNow: false,
        };
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'secret-password',
        deviceName: 'iPhone Safari',
      }),
    });
    assert.equal(response.status, 503);
    assert.equal(loginCalled, false);
    assert.deepEqual(await response.json(), {
      error: 'setup_required',
      message: 'Password not configured. Run codex-web auth set-password.',
    });
  } finally {
    await server.stop();
  }
});

test('static root is public', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Codex Web/);
    assert.match(html, /app\.js/);
    assert.match(html, /styles\.css/);
    assert.match(response.headers.get('cache-control') ?? '', /stale-while-revalidate/u);

    const indexResponse = await fetch(`${server.baseUrl}/index.html`);
    assert.equal(indexResponse.status, 200);
    assert.equal(await indexResponse.text(), html);

    const shareResponse = await fetch(`${server.baseUrl}/share/cws_public_token`);
    assert.equal(shareResponse.status, 200);
    assert.equal(await shareResponse.text(), html);

    const scriptResponse = await fetch(`${server.baseUrl}/app.js`);
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get('content-type') ?? '', /^application\/javascript\b/i);
    const script = await scriptResponse.text();
    assert.match(script, /localStorage|codexWebToken|fetch/u);
    const buildIdMatch = html.match(/\/app\.js\?v=([a-f0-9]{20})/u);
    assert.ok(buildIdMatch?.[1]);
    const buildId = buildIdMatch[1];
    assert.match(html, new RegExp(`/app\\.js\\?v=${buildId}`, 'u'));
    assert.match(html, new RegExp(`/styles\\.css\\?v=${buildId}`, 'u'));
    assert.match(html, new RegExp(`/theme-init\\.js\\?v=${buildId}`, 'u'));
    assert.match(html, new RegExp(`/ui-kit\\.js\\?v=${buildId}`, 'u'));
    assert.match(html, new RegExp(`/ui-copy\\.js\\?v=${buildId}`, 'u'));
    assert.match(html, new RegExp(`/attachment-utils\\.js\\?v=${buildId}`, 'u'));
    assert.match(html, new RegExp(`/markdown-renderer\\.js\\?v=${buildId}`, 'u'));
    assert.match(html, new RegExp(`/admin-ui\\.js\\?v=${buildId}`, 'u'));
    assert.match(html, new RegExp(`/session-pagination\\.js\\?v=${buildId}`, 'u'));
    assert.equal(scriptResponse.headers.get('cache-control'), 'no-cache');

    const versionedScriptResponse = await fetch(`${server.baseUrl}/app.js?v=${buildId}`, {
      headers: { 'Accept-Encoding': 'br' },
    });
    assert.equal(versionedScriptResponse.status, 200);
    assert.equal(versionedScriptResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(versionedScriptResponse.headers.get('content-encoding'), 'br');
    assert.match(versionedScriptResponse.headers.get('vary') ?? '', /Accept-Encoding/iu);
    assert.match(await versionedScriptResponse.text(), /localStorage|codexWebToken|fetch/u);

    const styleResponse = await fetch(`${server.baseUrl}/styles.css`);
    assert.equal(styleResponse.status, 200);
    assert.match(styleResponse.headers.get('content-type') ?? '', /^text\/css\b/i);
    const style = await styleResponse.text();
    assert.match(style, /body|--bg|font-family/u);
    const gzipStyleResponse = await fetch(`${server.baseUrl}/styles.css?v=${buildId}`, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    assert.equal(gzipStyleResponse.headers.get('content-encoding'), 'gzip');
    assert.equal(gzipStyleResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(await gzipStyleResponse.text(), /body|--bg|font-family/u);

    const themeInitResponse = await fetch(`${server.baseUrl}/theme-init.js`);
    assert.equal(themeInitResponse.status, 200);
    assert.match(themeInitResponse.headers.get('content-type') ?? '', /^application\/javascript\b/i);
    assert.match(await themeInitResponse.text(), /codexWebTheme|dataset\.theme/u);

    const attachmentUtilsResponse = await fetch(`${server.baseUrl}/attachment-utils.js?v=${buildId}`);
    assert.equal(attachmentUtilsResponse.status, 200);
    assert.equal(attachmentUtilsResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(await attachmentUtilsResponse.text(), /CodexWebAttachments|parseAttachmentPromptText/u);

    const sessionPaginationResponse = await fetch(`${server.baseUrl}/session-pagination.js?v=${buildId}`);
    assert.equal(sessionPaginationResponse.status, 200);
    assert.equal(sessionPaginationResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(await sessionPaginationResponse.text(), /CodexWebSessionPagination|createController/u);

    const manifestResponse = await fetch(`${server.baseUrl}/manifest.webmanifest`);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get('content-type') ?? '', /^application\/manifest\+json\b/i);
    const manifest = await manifestResponse.json() as any;
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons.every((icon: any) => icon.src.endsWith(`?v=${buildId}`)));

    const versionResponse = await fetch(`${server.baseUrl}/version.json`);
    assert.equal(versionResponse.status, 200);
    assert.equal(versionResponse.headers.get('cache-control'), 'no-cache');
    assert.deepEqual(await versionResponse.json(), {});
    const versionEtag = versionResponse.headers.get('etag');
    assert.ok(versionEtag);
    const unchangedVersionResponse = await fetch(`${server.baseUrl}/version.json`, {
      headers: { 'If-None-Match': versionEtag },
    });
    assert.equal(unchangedVersionResponse.status, 304);

    const serviceWorkerResponse = await fetch(`${server.baseUrl}/service-worker.js`);
    assert.equal(serviceWorkerResponse.status, 200);
    assert.match(serviceWorkerResponse.headers.get('content-type') ?? '', /^application\/javascript\b/i);
    const serviceWorker = await serviceWorkerResponse.text();
    assert.match(serviceWorker, /self\.addEventListener/u);
    assert.match(serviceWorker, new RegExp(`codex-web-static-${buildIdMatch?.[1]}`.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.doesNotMatch(serviceWorker, /__CODEX_WEB_BUILD_ID__/u);
    assert.equal(serviceWorkerResponse.headers.get('cache-control'), 'no-cache');

    const svgIconResponse = await fetch(`${server.baseUrl}/icon.svg?v=${buildId}`);
    assert.equal(svgIconResponse.status, 200);
    assert.match(svgIconResponse.headers.get('content-type') ?? '', /^image\/svg\+xml\b/i);
    assert.equal(svgIconResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(await svgIconResponse.text(), /<svg\b/u);

    const iconResponse = await fetch(`${server.baseUrl}/icon-192.png`);
    assert.equal(iconResponse.status, 200);
    assert.match(iconResponse.headers.get('content-type') ?? '', /^image\/png\b/i);
  } finally {
    await server.stop();
  }
});

test('default static build id is stable across server restarts', async () => {
  const readBuildId = async (): Promise<string> => {
    const server = createCodexWebServer({
      auth: createAcceptingAuth(),
      runtime: createRuntimeStub() as any,
      config: createConfig(),
    });
    await server.start();
    try {
      const response = await fetch(`${server.baseUrl}/`);
      assert.equal(response.status, 200);
      return (await response.text()).match(/\/app\.js\?v=([a-f0-9]{20})/u)?.[1] ?? '';
    } finally {
      await server.stop();
    }
  };

  const first = await readBuildId();
  const second = await readBuildId();
  assert.match(first, /^[a-f0-9]{20}$/u);
  assert.equal(second, first);
});

test('static app shell exposes configured global title before login', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-title-state-'));
  const identityStore = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  await identityStore.setSiteTitle('Team Codex');
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    identityStore,
    runtime: createRuntimeStub() as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title>Team Codex<\/title>/u);
    assert.ok(html.includes('<script type="application/json" id="codex-web-bootstrap">{"siteTitle":"Team Codex"}</script>'));

    const indexResponse = await fetch(`${server.baseUrl}/index.html`);
    assert.equal(await indexResponse.text(), html);
  } finally {
    await server.stop();
  }
});

test('static asset resolvers are evaluated per request', async () => {
  let version = 'v1';
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig(),
    staticFiles: {
      '/': {
        body: '<!doctype html><script src="/app.js"></script>',
        contentType: 'text/html; charset=utf-8',
      },
      '/app.js': () => ({
        body: `console.log('${version}')`,
        contentType: 'application/javascript; charset=utf-8',
      }),
    },
  });
  await server.start();
  try {
    const first = await fetch(`${server.baseUrl}/app.js`);
    assert.equal(first.status, 200);
    assert.equal(await first.text(), "console.log('v1')");
    assert.equal(first.headers.get('cache-control'), 'no-store');

    version = 'v2';

    const second = await fetch(`${server.baseUrl}/app.js`);
    assert.equal(second.status, 200);
    assert.equal(await second.text(), "console.log('v2')");
  } finally {
    await server.stop();
  }
});

test('GET / shows setup-required page when password is not configured', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => false,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i);
    assert.match(await response.text(), /codex-web auth set-password/);
  } finally {
    await server.stop();
  }
});

test('protected API routes return setup_required when password is not configured', async () => {
  let verifyTokenCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => false,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async () => {
        verifyTokenCalled = true;
        return null;
      },
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(response.status, 503);
    assert.equal(verifyTokenCalled, false);
    assert.deepEqual(await response.json(), {
      error: 'setup_required',
      message: 'Password not configured. Run codex-web auth set-password.',
    });
  } finally {
    await server.stop();
  }
});

test('SSE route rejects missing bearer token', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_1/events`);
    assert.equal(response.status, 401);
  } finally {
    await server.stop();
  }
});

test('POST /api/sessions/:id/turns returns 404 without starting a replacement session', async () => {
  const calls: string[] = [];
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      createSession: async () => {
        calls.push('createSession');
        return { id: 'thread_recovered', cwd: '/tmp', settings: {}, thread: {} };
      },
      startTurn: async (sessionId: string) => {
        calls.push(`startTurn:${sessionId}`);
        if (sessionId === 'stale_thread') {
          throw new Error('Unknown session: stale_thread');
        }
        return { turnId: 'turn_recovered' };
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/stale_thread/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: 'session_not_found',
      message: 'Selected session was not found.',
    });
    assert.deepEqual(calls, [
      'startTurn:stale_thread',
    ]);
  } finally {
    await server.stop();
  }
});

test('POST /api/sessions/:id/turns returns 409 when the session already has an active turn', async () => {
  const calls: string[] = [];
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      startTurn: async (sessionId: string) => {
        calls.push(`startTurn:${sessionId}`);
        const error = new Error('Session thread_busy already has an active turn (turn_active).');
        (error as Error & { code?: string }).code = 'turn_conflict';
        (error as Error & { activeTurnId?: string }).activeTurnId = 'turn_active';
        throw error;
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_busy/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'turn_conflict',
      message: 'Session thread_busy already has an active turn (turn_active).',
      activeTurnId: 'turn_active',
    });
    assert.deepEqual(calls, [
      'startTurn:thread_busy',
    ]);
  } finally {
    await server.stop();
  }
});

test('POST /api/turns/:turnId/steer steers the active single-user turn without interrupting it', async () => {
  const calls: string[] = [];
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      threadIdForTurn: (turnId: string) => {
        calls.push(`lookup:${turnId}`);
        return turnId === 'turn_active' ? 'thread_1' : null;
      },
      steerTurnForThread: async (threadId: string, turnId: string, input: { text: string }) => {
        calls.push(`steer:${threadId}:${turnId}:${input.text}`);
        return { turnId };
      },
      interruptTurn: async (turnId: string) => {
        calls.push(`interrupt:${turnId}`);
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_active/steer`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Continue with this direction' }),
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { turnId: 'turn_active' });
    assert.deepEqual(calls, [
      'lookup:turn_active',
      'steer:thread_1:turn_active:Continue with this direction',
    ]);
  } finally {
    await server.stop();
  }
});

test('durable steer submissions retry without steering the active turn twice', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-durable-steer-'));
  const calls: string[] = [];
  const activeSession = {
    id: 'thread_1',
    cwd: '/tmp',
    activeTurnId: 'turn_active',
    thread: {
      turns: [{ id: 'turn_active', status: 'in_progress', error: null, items: [] }],
    },
    timeline: [],
  };
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      readSession: async () => activeSession,
      startTurn: async () => {
        calls.push('start');
        return { turnId: 'turn_new' };
      },
      steerTurnForThread: async (
        threadId: string,
        turnId: string,
        input: { text: string },
        clientUserMessageId: string,
      ) => {
        calls.push(`steer:${threadId}:${turnId}:${input.text}:${clientUserMessageId}`);
        return { turnId };
      },
      interruptTurn: async () => {
        calls.push('interrupt');
      },
    } as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const request = () => fetch(`${server.baseUrl}/api/sessions/thread_1/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        submissionId: 'steer:ui_message_1',
        text: 'Continue durably',
      }),
    });
    const first = await request();
    const retried = await request();

    assert.equal(first.status, 202);
    assert.equal(retried.status, 200);
    assert.equal((await first.json() as any).submission.turnId, 'turn_active');
    assert.equal((await retried.json() as any).submission.turnId, 'turn_active');
    assert.deepEqual(calls, [
      'steer:thread_1:turn_active:Continue durably:steer:ui_message_1',
    ]);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('durable existing-session messages steer when the browser active-turn state is stale', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-stale-active-turn-'));
  const calls: string[] = [];
  const activeSession = {
    id: 'thread_1',
    cwd: '/tmp',
    activeTurnId: 'turn_active',
    thread: {
      turns: [{ id: 'turn_active', status: 'in_progress', error: null, items: [] }],
    },
    timeline: [],
  };
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      readSession: async () => activeSession,
      startTurn: async () => {
        calls.push('start');
        return { turnId: 'turn_new' };
      },
      steerTurnForThread: async (
        threadId: string,
        turnId: string,
        input: { text: string },
        clientUserMessageId: string,
      ) => {
        calls.push(`steer:${threadId}:${turnId}:${input.text}:${clientUserMessageId}`);
        return { turnId };
      },
    } as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_1/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        submissionId: 'ui_message_from_stale_state',
        text: 'Continue even though the browser missed the active turn',
      }),
    });

    assert.equal(response.status, 202);
    assert.equal((await response.json() as any).submission.turnId, 'turn_active');
    assert.deepEqual(calls, [
      'steer:thread_1:turn_active:Continue even though the browser missed the active turn:ui_message_from_stale_state',
    ]);
  } finally {
    await server.stop();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('POST /api/turns/:turnId/steer returns 409 for a non-steerable turn without interrupting it', async () => {
  const calls: string[] = [];
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      threadIdForTurn: (turnId: string) => {
        calls.push(`lookup:${turnId}`);
        return 'thread_1';
      },
      steerTurnForThread: async (threadId: string, turnId: string) => {
        calls.push(`steer:${threadId}:${turnId}`);
        const error = new Error('Cannot steer a review turn.');
        (error as Error & { code?: string }).code = 'activeTurnNotSteerable';
        throw error;
      },
      interruptTurn: async (turnId: string) => {
        calls.push(`interrupt:${turnId}`);
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_review/steer`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Follow up after review' }),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'active_turn_not_steerable',
      message: 'Cannot steer a review turn.',
    });
    assert.deepEqual(calls, [
      'lookup:turn_review',
      'steer:thread_1:turn_review',
    ]);
  } finally {
    await server.stop();
  }
});

test('POST /api/sessions/:id/turns returns handled slash command results', async () => {
  const helpMessage = [
    '支持的命令：',
    '- `/help`',
    '- `/goal`',
  ].join('\n');
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      startTurn: async (sessionId: string, input: { text: string }) => ({
        type: 'command',
        command: {
          name: input.text === '/help' ? 'help' : 'goal',
          action: input.text === '/help' ? 'show' : 'set',
          message: input.text === '/help'
            ? helpMessage
            : `Goal set from ${sessionId}: ${input.text}`,
          goal: input.text === '/help'
            ? null
            : {
              threadId: sessionId,
              objective: 'ship goal commands',
              status: 'active',
            },
        },
        session: {
          id: sessionId,
          cwd: '/repo',
          title: 'Goal Thread',
          updatedAt: 1,
          preview: input.text,
          firstUserInput: input.text,
          lastUserInput: input.text,
          lastInputAt: 1,
          favorite: false,
          favoriteOrder: null,
          settings: {},
          thread: { threadId: sessionId, cwd: '/repo', title: 'Goal Thread', turns: [] },
          timeline: [
            { id: `command_user_${input.text === '/help' ? 'help' : 'goal'}`, kind: 'message', role: 'user', label: 'You', meta: 'command', text: input.text },
            {
              id: `command_system_${input.text === '/help' ? 'help' : 'goal'}`,
              kind: 'message',
              role: 'system',
              label: input.text === '/help' ? '/help' : '/goal',
              meta: input.text === '/help' ? 'show' : 'set',
              text: input.text === '/help'
                ? helpMessage
                : `Goal set from ${sessionId}: ${input.text}`,
            },
          ],
        },
      }),
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_goal/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: '/goal ship goal commands' }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      type: 'command',
      command: {
        name: 'goal',
        action: 'set',
        message: 'Goal set from thread_goal: /goal ship goal commands',
        goal: {
          threadId: 'thread_goal',
          objective: 'ship goal commands',
          status: 'active',
        },
      },
      session: {
        id: 'thread_goal',
        cwd: '/repo',
        title: 'Goal Thread',
        updatedAt: 1,
        preview: '/goal ship goal commands',
        firstUserInput: '/goal ship goal commands',
        lastUserInput: '/goal ship goal commands',
        lastInputAt: 1,
        favorite: false,
        favoriteOrder: null,
        settings: {},
        thread: { threadId: 'thread_goal', cwd: '/repo', title: 'Goal Thread', turns: [] },
        timeline: [
          { id: 'command_user_goal', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/goal ship goal commands' },
          {
            id: 'command_system_goal',
            kind: 'message',
            role: 'system',
            label: '/goal',
            meta: 'set',
            text: 'Goal set from thread_goal: /goal ship goal commands',
          },
        ],
      },
    });

    const helpResponse = await fetch(`${server.baseUrl}/api/sessions/thread_goal/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: '/help' }),
    });
    assert.equal(helpResponse.status, 202);
    assert.deepEqual(await helpResponse.json(), {
      type: 'command',
      command: {
        name: 'help',
        action: 'show',
        message: helpMessage,
        goal: null,
      },
      session: {
        id: 'thread_goal',
        cwd: '/repo',
        title: 'Goal Thread',
        updatedAt: 1,
        preview: '/help',
        firstUserInput: '/help',
        lastUserInput: '/help',
        lastInputAt: 1,
        favorite: false,
        favoriteOrder: null,
        settings: {},
        thread: { threadId: 'thread_goal', cwd: '/repo', title: 'Goal Thread', turns: [] },
        timeline: [
          { id: 'command_user_help', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/help' },
          {
            id: 'command_system_help',
            kind: 'message',
            role: 'system',
            label: '/help',
            meta: 'show',
            text: helpMessage,
          },
        ],
      },
    });
  } finally {
    await server.stop();
  }
});

test('GET /api/sessions/:id returns backend-managed timeline entries', async () => {
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      readSession: async () => ({
        id: 'thread_goal',
        cwd: '/repo',
        title: 'Goal Thread',
        updatedAt: 1,
        preview: '/goal resume',
        firstUserInput: 'Earlier question',
        lastUserInput: '/goal resume',
        lastInputAt: 1,
        favorite: false,
        favoriteOrder: null,
        settings: {},
        thread: { threadId: 'thread_goal', cwd: '/repo', title: 'Goal Thread', turns: [] },
        timeline: [
          { id: 'history_1', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Earlier question' },
          { id: 'history_2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Earlier answer' },
          { id: 'command_user_1', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/goal resume' },
          { id: 'command_system_1', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
        ],
      }),
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_goal`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.session.timeline.map((item: any) => item.text), [
      'Earlier question',
      'Earlier answer',
      '/goal resume',
      'Goal resumed: ship slash goal support',
    ]);
  } finally {
    await server.stop();
  }
});

test('POST /api/sessions/:id/timeline appends authenticated system messages', async () => {
  const calls: Array<{ sessionId: string; entry: any }> = [];
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      readSession: async (sessionId: string) => sessionId === 'thread_goal'
        ? { id: sessionId, thread: { threadId: sessionId, turns: [] }, timeline: [] }
        : null,
      appendSessionTimelineEntry: (sessionId: string, entry: any) => {
        calls.push({ sessionId, entry });
        return {
          id: 'error_turn_1',
          kind: 'message',
          role: 'system',
          label: 'Error',
          meta: 'failed',
          text: entry.text,
          severity: 'error',
        };
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_goal/timeline`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 'error_turn_1',
        role: 'system',
        label: 'Error',
        meta: 'failed',
        text: 'Load failed',
        severity: 'error',
      }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      entry: {
        id: 'error_turn_1',
        kind: 'message',
        role: 'system',
        label: 'Error',
        meta: 'failed',
        text: 'Load failed',
        severity: 'error',
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.sessionId, 'thread_goal');
    assert.deepEqual(calls[0]?.entry, {
      id: 'error_turn_1',
      role: 'system',
      label: 'Error',
      meta: 'failed',
      text: 'Load failed',
      severity: 'error',
    });
  } finally {
    await server.stop();
  }
});

test('POST /api/sessions/:id/timeline rejects invalid message payloads', async () => {
  const calls: any[] = [];
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      readSession: async () => ({ id: 'thread_goal', thread: { turns: [] }, timeline: [] }),
      appendSessionTimelineEntry: (...args: any[]) => {
        calls.push(args);
        return null;
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_goal/timeline`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 'error_turn_1',
        role: 'assistant',
        text: '',
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'invalid_timeline_entry',
      message: 'A non-empty system message is required.',
    });
    assert.deepEqual(calls, []);
  } finally {
    await server.stop();
  }
});

test('POST /api/sessions/:id/timeline returns 404 for missing sessions', async () => {
  const calls: any[] = [];
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      readSession: async () => null,
      appendSessionTimelineEntry: (...args: any[]) => {
        calls.push(args);
        return null;
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/missing_thread/timeline`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 'error_turn_1',
        role: 'system',
        text: 'Load failed',
      }),
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: 'session_not_found',
      message: 'Selected session was not found.',
    });
    assert.deepEqual(calls, []);
  } finally {
    await server.stop();
  }
});

test('POST /api/runtime/reload reloads the runtime for authenticated clients', async () => {
  let reloadCalls = 0;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      reloadRuntime: async () => {
        reloadCalls += 1;
        return { mcpServersReloaded: true };
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/runtime/reload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      mcpServersReloaded: true,
    });
    assert.equal(reloadCalls, 1);
  } finally {
    await server.stop();
  }
});

test('DELETE /api/sessions/:id archives a session', async () => {
  const calls: string[] = [];
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      archiveSession: async (sessionId: string) => {
        calls.push(sessionId);
        return sessionId === 'thread_1';
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_1`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(calls, ['thread_1']);
  } finally {
    await server.stop();
  }
});

test('POST /api/sessions/:id/archive archives a session', async () => {
  const calls: string[] = [];
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      archiveSession: async (sessionId: string) => {
        calls.push(sessionId);
        return sessionId === 'thread_1';
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_1/archive`, {
      method: 'POST',
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(calls, ['thread_1']);
  } finally {
    await server.stop();
  }
});

test('GET /api/sessions?state=archived lists archived sessions in single-user mode', async () => {
  const calls: Array<{ favorite?: boolean; archived?: boolean }> = [];
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      listSessions: async (options?: { favorite?: boolean; archived?: boolean }) => {
        calls.push(options ?? {});
        return options?.archived === true ? [{ id: 'thread_archived' }] : [{ id: 'thread_active' }];
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions?state=archived`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ id: 'thread_archived' }], nextCursor: null });
    assert.deepEqual(calls, [{ archived: true }]);
  } finally {
    await server.stop();
  }
});

test('single-user session list omits conversation details while direct reads retain them', async () => {
  const runtimeSession = {
    id: 'thread_1',
    cwd: '/repo',
    activityState: 'running',
    thread: {
      turns: [{
        id: 'turn_1',
        status: 'completed',
        error: null,
        items: [{ id: 'item_answer', type: 'message', role: 'assistant', text: 'Detailed answer' }],
      }],
    },
    timeline: [{
      id: 'timeline_1',
      kind: 'message',
      role: 'assistant',
      label: 'Assistant',
      meta: '',
      text: 'Detailed answer',
    }],
  };
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      listSessions: async () => [runtimeSession],
      readSession: async () => ({ ...runtimeSession, goal: null }),
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const listResponse = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json();
    assert.equal(listPayload.items[0].id, 'thread_1');
    assert.equal(listPayload.items[0].activityState, 'running');
    assert.equal('goal' in listPayload.items[0], false);
    assert.equal('thread' in listPayload.items[0], false);
    assert.equal('timeline' in listPayload.items[0], false);

    const detailResponse = await fetch(`${server.baseUrl}/api/sessions/thread_1`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json();
    assert.equal(detailPayload.session.thread.turns[0].items[0].id, 'item_answer');
    assert.equal(detailPayload.session.thread.turns[0].items[0].text, 'Detailed answer');
    assert.equal(detailPayload.session.timeline[0].text, 'Detailed answer');
    assert.equal('goal' in detailPayload.session, true);
    assert.equal(detailPayload.session.goal, null);
  } finally {
    await server.stop();
  }
});

test('PATCH /api/sessions/:id/favorite updates favorite state and order', async () => {
  const calls: Array<{ sessionId: string; favorite: boolean; favoriteOrder?: number | null }> = [];
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      updateSessionFavorite: async (sessionId: string, favorite: boolean, favoriteOrder?: number | null) => {
        calls.push({ sessionId, favorite, favoriteOrder });
        return sessionId === 'thread_1' ? { id: sessionId, favorite, favoriteOrder } : null;
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_1/favorite`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ favorite: true, favoriteOrder: 3 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      session: { id: 'thread_1', favorite: true, favoriteOrder: 3 },
    });
    assert.deepEqual(calls, [{ sessionId: 'thread_1', favorite: true, favoriteOrder: 3 }]);
  } finally {
    await server.stop();
  }
});

test('GET /api/sessions passes the favorite filter to the runtime', async () => {
  const calls: Array<{ favorite?: boolean }> = [];
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      listSessions: async (options?: { favorite?: boolean }) => {
        calls.push(options ?? {});
        return [{ id: options?.favorite ? 'favorite_thread' : 'thread_1', favorite: options?.favorite === true }];
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const favoritesResponse = await fetch(`${server.baseUrl}/api/sessions?favorite=true`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(favoritesResponse.status, 200);
    assert.equal((await favoritesResponse.json()).items[0].id, 'favorite_thread');

    const allResponse = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(allResponse.status, 200);
    assert.equal((await allResponse.json()).items[0].id, 'thread_1');
    assert.deepEqual(calls, [{ favorite: true }, {}]);
  } finally {
    await server.stop();
  }
});

test('GET /api/reports lists reports for authenticated clients', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-reports-'));
  t.after(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  const reportPath = path.join(stateDir, 'reports', 'project-a', '2026-05-19', 'summary.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '# Summary\n', 'utf8');
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/reports`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as { items: Array<{ id: string; project: string; kind: string }> };
    assert.deepEqual(payload.items.map((report) => ({
      id: report.id,
      project: report.project,
      kind: report.kind,
    })), [
      {
        id: 'project-a/2026-05-19/summary.md',
        project: 'project-a',
        kind: 'markdown',
      },
    ]);
  } finally {
    await server.stop();
  }
});

test('GET /api/reports/:id/content returns report content', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-reports-'));
  t.after(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  const reportPath = path.join(stateDir, 'reports', 'project-a', '2026-05-19', 'audit.html');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '<h1>Audit</h1>\n', 'utf8');
  const reportId = 'project-a/2026-05-19/audit.html';
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/reports/${encodeURIComponent(reportId)}/content`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as { report: { id: string; kind: string }; content: string };
    assert.equal(payload.report.id, reportId);
    assert.equal(payload.report.kind, 'html');
    assert.equal(payload.content, '<h1>Audit</h1>\n');
  } finally {
    await server.stop();
  }
});

test('legacy report compatibility rejects favorite mutations', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-reports-'));
  t.after(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  const reportPath = path.join(stateDir, 'reports', 'project-a', '2026-05-19', 'summary.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '# Summary\n', 'utf8');
  const reportId = 'project-a/2026-05-19/summary.md';
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/reports/${encodeURIComponent(reportId)}/favorite`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(response.status, 404);
    await assert.rejects(fs.access(path.join(stateDir, 'report-index.json')), /ENOENT/u);
  } finally {
    await server.stop();
  }
});

test('POST /api/reports/resolve accepts report-root absolute paths and rejects outside paths', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-reports-'));
  t.after(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  const reportPath = path.join(stateDir, 'reports', 'project-a', '2026-05-19', 'summary.md');
  const outsidePath = path.join(stateDir, 'outside.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '# Summary\n', 'utf8');
  await fs.writeFile(outsidePath, '# Outside\n', 'utf8');
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const resolved = await fetch(`${server.baseUrl}/api/reports/resolve`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: reportPath }),
    });
    assert.equal(resolved.status, 200);
    assert.equal(((await resolved.json()) as { report: { id: string } }).report.id, 'project-a/2026-05-19/summary.md');

    const rejected = await fetch(`${server.baseUrl}/api/reports/resolve`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: outsidePath }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), {
      error: 'invalid_report_path',
      message: 'Report path is outside the reports directory.',
    });
  } finally {
    await server.stop();
  }
});

test('GET /api/sessions/:id/status returns lightweight metadata and an active-turn snapshot', async () => {
  const bus = new CodexWebEventBus({ epoch: 'epoch_status' });
  bus.append('turn_status', {
    id: 'evt_status_started',
    type: 'turn.started',
    turnId: 'turn_status',
    threadId: 'thread_status',
  });
  bus.append('turn_status', {
    id: 'evt_status_delta',
    type: 'assistant.delta',
    turnId: 'turn_status',
    threadId: 'thread_status',
    itemId: 'item_status',
    eventType: 'delta',
    text: 'Current answer',
    delta: 'Current answer',
    phase: 'final_answer',
  });
  let fullSessionReads = 0;
  let statusReads = 0;
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      eventBus: bus,
      readSession: async () => {
        fullSessionReads += 1;
        return null;
      },
      readSessionStatus: async () => {
        statusReads += 1;
        return {
          id: 'thread_status',
          cwd: '/workspace',
          projectName: 'workspace',
          title: 'Status thread',
          updatedAt: 10,
          preview: 'Preview',
          firstUserInput: 'Preview',
          lastUserInput: 'Preview',
          lastInputAt: 10,
          favorite: false,
          favoriteOrder: null,
          activeTurnId: 'turn_status',
          activityState: 'running',
          settings: {},
          thread: { threadId: 'thread_status', turns: [] },
          timeline: [],
        };
      },
      getTurnEventReplay: (turnId: string, after?: string | number | null, epoch?: string | null) => (
        bus.replay(turnId, after, epoch)
      ),
      getTurnEventSnapshot: (turnId: string) => bus.snapshot(turnId),
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_status/status`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.equal(statusReads, 1);
    assert.equal(fullSessionReads, 0);
    assert.equal(payload.session.activeTurnId, 'turn_status');
    assert.equal('goal' in payload.session, false);
    assert.equal(payload.session.thread, undefined);
    assert.equal(payload.turnSnapshot.epoch, 'epoch_status');
    assert.equal(payload.turnSnapshot.complete, true);
    assert.deepEqual(payload.turnSnapshot.events.map((event: any) => event.id), [
      'evt_status_started',
      'evt_status_delta',
    ]);
    assert.equal(payload.turnSnapshot.events[1].text, 'Current answer');
  } finally {
    await server.stop();
  }
});

test('GET /api/sessions/:id/timeline pages backward from the latest entries', async () => {
  const bus = new CodexWebEventBus({ epoch: 'epoch_timeline' });
  bus.append('turn_timeline', {
    id: 'evt_timeline_started',
    type: 'turn.started',
    turnId: 'turn_timeline',
    threadId: 'thread_timeline',
  });
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      eventBus: bus,
      readSession: async () => ({
        id: 'thread_timeline',
        activeTurnId: 'turn_timeline',
        activityState: 'running',
        thread: { threadId: 'thread_timeline', turns: [] },
        timeline: [
          { id: 'one', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'One' },
          {
            id: 'two',
            kind: 'message',
            role: 'assistant',
            label: 'Assistant',
            meta: 'final',
            text: 'Two',
            turnId: 'turn_timeline',
            itemId: 'item_two',
            projectionKey: 'turn_timeline\u0000item_two',
            phase: 'final_answer',
            lifecycle: 'completed',
            raw: { secret: true },
          },
          { id: 'three', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Three' },
        ],
      }),
      getTurnEventReplay: (turnId: string, after?: string | number | null, epoch?: string | null) => (
        bus.replay(turnId, after, epoch)
      ),
      getTurnEventSnapshot: (turnId: string) => bus.snapshot(turnId),
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const latest = await fetch(`${server.baseUrl}/api/sessions/thread_timeline/timeline?limit=2`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(latest.status, 200);
    const latestPayload = await latest.json() as any;
    assert.deepEqual(latestPayload.items.map((item: any) => item.id), ['two', 'three']);
    assert.equal(latestPayload.nextBefore, '1');
    assert.equal(latestPayload.hasMore, true);
    assert.equal(latestPayload.session.activeTurnId, 'turn_timeline');
    assert.equal(latestPayload.session.thread, undefined);
    assert.equal(latestPayload.turnSnapshot.turnId, 'turn_timeline');
    assert.equal(latestPayload.turnSnapshot.epoch, 'epoch_timeline');
    assert.deepEqual(latestPayload.items[0], {
      id: 'two',
      kind: 'message',
      role: 'assistant',
      label: 'Assistant',
      meta: 'final',
      text: 'Two',
      turnId: 'turn_timeline',
      itemId: 'item_two',
      projectionKey: 'turn_timeline\u0000item_two',
      phase: 'final_answer',
      lifecycle: 'completed',
    });
    assert.equal('raw' in latestPayload.items[0], false);

    const snapshotOmitted = await fetch(`${server.baseUrl}/api/sessions/thread_timeline/timeline?limit=2`, {
      headers: {
        Authorization: 'Bearer cw_token',
        'X-Codex-Include-Turn-Snapshot': 'false',
      },
    });
    const snapshotOmittedPayload = await snapshotOmitted.json() as any;
    assert.equal(snapshotOmitted.status, 200);
    assert.equal('turnSnapshot' in snapshotOmittedPayload, false);

    const older = await fetch(`${server.baseUrl}/api/sessions/thread_timeline/timeline?limit=2&before=1`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    const olderPayload = await older.json() as any;
    assert.deepEqual(olderPayload.items.map((item: any) => item.id), ['one']);
    assert.equal(olderPayload.nextBefore, null);
    assert.equal('turnSnapshot' in olderPayload, false);
  } finally {
    await server.stop();
  }
});

test('fresh SSE subscriptions use a compact snapshot and cursor replay sends delta-only frames', async () => {
  const bus = new CodexWebEventBus({ epoch: 'epoch_compact' });
  bus.append('turn_compact', {
    id: 'evt_compact_started',
    type: 'turn.started',
    turnId: 'turn_compact',
    threadId: 'thread_compact',
  });
  const firstDelta = bus.append('turn_compact', {
    id: 'evt_compact_1',
    type: 'assistant.delta',
    turnId: 'turn_compact',
    threadId: 'thread_compact',
    itemId: 'item_compact',
    eventType: 'delta',
    text: 'Hello',
    delta: 'Hello',
    phase: 'final_answer',
  });
  bus.append('turn_compact', {
    id: 'evt_compact_2',
    type: 'assistant.delta',
    turnId: 'turn_compact',
    threadId: 'thread_compact',
    itemId: 'item_compact',
    eventType: 'delta',
    text: 'Hello world',
    delta: ' world',
    phase: 'final_answer',
  });
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      eventBus: bus,
      getTurnEvents: (turnId: string, after?: string | number | null) => bus.list(turnId, after),
      getTurnEventReplay: (turnId: string, after?: string | number | null, epoch?: string | null) => (
        bus.replay(turnId, after, epoch)
      ),
      getTurnEventSnapshot: (turnId: string) => bus.snapshot(turnId),
      subscribeToTurn: (turnId: string, listener: any) => bus.subscribe(turnId, listener),
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const fresh = await fetch(`${server.baseUrl}/api/turns/turn_compact/events`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(fresh.headers.get('x-codex-event-reset'), 'true');
    const freshReader = fresh.body?.getReader();
    assert.ok(freshReader);
    const freshChunk = await freshReader!.read();
    const freshText = new TextDecoder().decode(freshChunk.value);
    assert.match(freshText, /initial_snapshot/u);
    assert.match(freshText, /Hello world/u);
    assert.doesNotMatch(freshText, /evt_compact_1/u);
    await freshReader!.cancel();

    const replay = await fetch(
      `${server.baseUrl}/api/turns/turn_compact/events?after=${firstDelta.sequence}&epoch=epoch_compact`,
      { headers: { Authorization: 'Bearer cw_token' } },
    );
    assert.equal(replay.headers.get('x-codex-event-reset'), 'false');
    const replayReader = replay.body?.getReader();
    assert.ok(replayReader);
    let replayText = '';
    for (let index = 0; index < 3 && !replayText.includes('evt_compact_2'); index += 1) {
      const chunk = await replayReader!.read();
      replayText += new TextDecoder().decode(chunk.value);
    }
    assert.match(replayText, /"delta":" world"/u);
    assert.doesNotMatch(replayText, /"text":"Hello world"/u);
    await replayReader!.cancel();
  } finally {
    await server.stop();
  }
});

test('SSE route accepts bearer auth and streams events', async () => {
  let unsubscribeCalled = false;
  let resolveUnsubscribed: (() => void) | null = null;
  const unsubscribed = new Promise<void>((resolve) => {
    resolveUnsubscribed = resolve;
  });
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      getTurnEvents: () => [
        {
          sequence: 1,
          event: {
            id: 'evt_1',
            type: 'turn.started',
            turnId: 'turn_1',
            threadId: 'thread_1',
          },
        },
      ],
      subscribeToTurn: () => () => {
        unsubscribeCalled = true;
        resolveUnsubscribed?.();
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_1/events`, {
      headers: {
        Authorization: 'Bearer cw_token',
        'Accept-Encoding': 'br',
      },
    });
    assert.equal(response.status, 200);
    assertSecurityHeaders(response);
    assert.match(response.headers.get('cache-control') ?? '', /no-transform/u);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    assert.equal(response.headers.get('x-codex-event-reset'), 'false');
    assert.equal(response.headers.get('content-encoding'), null);
    const reader = response.body?.getReader();
    assert.ok(reader);
    let text = '';
    for (let index = 0; index < 4 && !text.includes('turn.started'); index += 1) {
      const chunk = await reader!.read();
      text += new TextDecoder().decode(chunk.value);
    }
    assert.match(text, /stream\.ready/u);
    assert.match(text, /turn.started/);
    assert.doesNotMatch(text, /threadId|thread_1|raw/u);
    await reader!.cancel();
    await Promise.race([
      unsubscribed,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('unsubscribe not called')), 1_000)),
    ]);
    assert.equal(unsubscribeCalled, true);
  } finally {
    await server.stop();
  }
});

test('SSE reset advertises its epoch and includes a projection snapshot after history truncation', async () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 2, epoch: 'epoch_current' });
  bus.append('turn_snapshot', {
    id: 'evt_started',
    type: 'turn.started',
    turnId: 'turn_snapshot',
    threadId: 'thread_1',
  });
  bus.append('turn_snapshot', {
    id: 'evt_early',
    type: 'assistant.delta',
    turnId: 'turn_snapshot',
    threadId: 'thread_1',
    itemId: 'item_early',
    eventType: 'completed',
    text: 'Early commentary',
    delta: 'Early commentary',
    phase: 'commentary',
  });
  bus.append('turn_snapshot', {
    id: 'evt_late_1',
    type: 'assistant.delta',
    turnId: 'turn_snapshot',
    threadId: 'thread_1',
    itemId: 'item_late',
    eventType: 'delta',
    text: 'Late',
    delta: 'Late',
    phase: 'commentary',
  });
  bus.append('turn_snapshot', {
    id: 'evt_late_2',
    type: 'assistant.delta',
    turnId: 'turn_snapshot',
    threadId: 'thread_1',
    itemId: 'item_late',
    eventType: 'completed',
    text: 'Late complete',
    delta: ' complete',
    phase: 'commentary',
  });
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      eventBus: bus,
      getTurnEvents: (turnId: string, after?: string | number | null) => bus.list(turnId, after),
      getTurnEventReplay: (turnId: string, after?: string | number | null, epoch?: string | null) => (
        bus.replay(turnId, after, epoch)
      ),
      getTurnEventSnapshot: (turnId: string) => bus.snapshot(turnId),
      subscribeToTurn: (turnId: string, listener: any) => bus.subscribe(turnId, listener),
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(
      `${server.baseUrl}/api/turns/turn_snapshot/events?after=1&epoch=epoch_previous`,
      { headers: { Authorization: 'Bearer cw_token' } },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-codex-event-epoch'), 'epoch_current');
    assert.equal(response.headers.get('x-codex-event-reset'), 'true');
    const reader = response.body?.getReader();
    assert.ok(reader);
    let text = '';
    for (let index = 0; index < 4 && !text.includes('Late complete'); index += 1) {
      const chunk = await reader!.read();
      text += new TextDecoder().decode(chunk.value);
    }
    assert.match(text, /stream\.reset/u);
    assert.match(text, /epoch_mismatch/u);
    assert.match(text, /"snapshot":\{"events":/u);
    assert.match(text, /"complete":false/u);
    assert.match(text, /Early commentary/u);
    assert.match(text, /Late complete/u);
    await reader!.cancel();

    const completeResponse = await fetch(
      `${server.baseUrl}/api/turns/turn_snapshot/events?after=0&epoch=epoch_current`,
      { headers: { Authorization: 'Bearer cw_token' } },
    );
    assert.equal(completeResponse.headers.get('x-codex-event-reset'), 'true');
    const completeReader = completeResponse.body?.getReader();
    assert.ok(completeReader);
    let completeText = '';
    for (let index = 0; index < 4 && !completeText.includes('"complete":true'); index += 1) {
      const chunk = await completeReader!.read();
      completeText += new TextDecoder().decode(chunk.value);
    }
    assert.match(completeText, /cursor_expired/u);
    assert.match(completeText, /"complete":true/u);
    await completeReader!.cancel();
  } finally {
    await server.stop();
  }
});

test('SSE subscribes before replay and suppresses replay-live duplicate sequences', async () => {
  const calls: string[] = [];
  const entry = {
    sequence: 7,
    event: {
      id: 'evt_race',
      type: 'turn.started' as const,
      turnId: 'turn_race',
      threadId: 'thread_1',
    },
  };
  let listener: ((value: typeof entry) => void) | null = null;
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: {
      ...createRuntimeStub(),
      subscribeToTurn: (_turnId: string, value: (event: typeof entry) => void) => {
        calls.push('subscribe');
        listener = value;
        return () => {};
      },
      getTurnEventReplay: () => {
        calls.push('replay');
        listener?.(entry);
        return {
          epoch: 'epoch_race',
          reset: false,
          resetReason: null,
          retainedFrom: 7,
          retainedFloor: 0,
          latestSequence: 7,
          events: [entry],
        };
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_race/events`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    const reader = response.body?.getReader();
    assert.ok(reader);
    let text = '';
    for (let index = 0; index < 4 && !text.includes('evt_race'); index += 1) {
      const chunk = await reader!.read();
      text += new TextDecoder().decode(chunk.value);
    }
    assert.deepEqual(calls, ['subscribe', 'replay']);
    assert.equal(text.match(/"id":"evt_race"/gu)?.length, 1);
    await reader!.cancel();
  } finally {
    await server.stop();
  }
});

test('server stop closes live SSE streams promptly', async () => {
  let unsubscribeCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      getTurnEvents: () => [
        {
          sequence: 1,
          event: {
            id: 'evt_1',
            type: 'turn.started',
            turnId: 'turn_1',
            threadId: 'thread_1',
          },
        },
      ],
      subscribeToTurn: () => () => {
        unsubscribeCalled = true;
      },
    } as any,
    config: createConfig(),
  });
  let stopPromise: Promise<void> | null = null;
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_1/events`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const firstChunk = await reader!.read();
    assert.equal(firstChunk.done, false);

    stopPromise = server.stop();
    await Promise.race([
      stopPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('server.stop() did not resolve')), 1_000)),
    ]);
    assert.equal(unsubscribeCalled, true);

    const finalChunk = await reader!.read().catch(() => ({ done: true, value: undefined }));
    assert.equal(finalChunk.done, true);
  } finally {
    if (stopPromise) {
      await stopPromise.catch(() => {});
    } else {
      await server.stop();
    }
  }
});

test('server stop stops the runtime client', async () => {
  let runtimeStopped = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      stop: async () => {
        runtimeStopped = true;
      },
    } as any,
    config: createConfig(),
  });
  await server.start();

  await server.stop();

  assert.equal(runtimeStopped, true);
});

test('SSE route rejects query token without bearer auth', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_1/events?token=cw_token`);
    assert.equal(response.status, 401);
  } finally {
    await server.stop();
  }
});
