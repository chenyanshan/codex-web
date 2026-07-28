import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CodexWebPrincipal } from '../src/access_control.js';
import { FileIdentityStore } from '../src/identity_store.js';
import { createCodexWebServer } from '../src/server.js';
import {
  FileSessionFileStore,
  SessionFileBusyError,
  type CodexWebSessionFileContent,
  type CodexWebSessionFileScope,
} from '../src/session_file_store.js';

function createConfig(stateDir: string, defaultCwd: string) {
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
    managedStorageMaxBytes: 2 * 1024 * 1024 * 1024,
    projectUploadMaxBytes: 512 * 1024 * 1024,
    uploadTtlSeconds: 7 * 86_400,
    turnAttachmentTtlSeconds: 30 * 86_400,
    reportTtlSeconds: 365 * 86_400,
    runtimeContextTtlSeconds: 30 * 86_400,
    timelineMaxEntriesPerSession: 500,
    timelineMaxBytes: 16 * 1024 * 1024,
  };
}

function runtimeForProjects(projectsByThread: Record<string, string>) {
  return {
    listModels: async () => [],
    readUsage: async () => null,
    listSessions: async () => [],
    createSession: async () => ({ id: 'unused' }),
    readSession: async (threadId: string) => {
      const cwd = projectsByThread[threadId];
      return cwd
        ? { id: threadId, cwd, projectName: path.basename(cwd), settings: {}, thread: { turns: [] }, timeline: [] }
        : null;
    },
    archiveSession: async () => true,
    updateSessionFavorite: async () => null,
    updateSessionSettings: async () => null,
    reloadRuntime: async () => ({ mcpServersReloaded: true }),
    startTurn: async () => ({ turnId: 'turn_1' }),
    interruptTurn: async () => {},
    resolveApproval: async () => {},
    getTurnEvents: () => [],
    subscribeToTurn: () => () => {},
  };
}

function singleUserAuth() {
  return {
    isConfigured: async () => true,
    login: async () => {
      throw new Error('unused');
    },
    verifyToken: async (token: string | null | undefined) => token === 'local-token'
      ? { id: 'auth_local', deviceName: 'test', createdAt: '', lastSeenAt: '' }
      : null,
    logout: async () => {},
  };
}

function multiUserAuth(principals: Record<string, CodexWebPrincipal>) {
  return {
    isConfigured: async () => true,
    login: async () => {
      throw new Error('unused');
    },
    verifyToken: async (token: string | null | undefined) => {
      const principal = token ? principals[token] : null;
      return principal
        ? { id: `auth_${principal.userId}`, deviceName: 'test', createdAt: '', lastSeenAt: '', principal }
        : null;
    },
    logout: async () => {},
  };
}

async function resolveFile(baseUrl: string, sessionId: string, inputPath: string, token = 'local-token') {
  return fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/files/resolve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: inputPath }),
  });
}

class PausingSessionFileStore extends FileSessionFileStore {
  private nextGate: {
    ready: () => void;
    resume: Promise<void>;
    done: () => void;
  } | null = null;

  pauseNextRead(): { ready: Promise<void>; resume: () => void; done: Promise<void> } {
    let markReady = () => {};
    let resume = () => {};
    let markDone = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const resumePromise = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const done = new Promise<void>((resolve) => {
      markDone = resolve;
    });
    this.nextGate = { ready: markReady, resume: resumePromise, done: markDone };
    return { ready, resume, done };
  }

  override async readFile(
    scope: CodexWebSessionFileScope,
    fileId: string,
  ): Promise<CodexWebSessionFileContent> {
    const content = await super.readFile(scope, fileId);
    const gate = this.nextGate;
    this.nextGate = null;
    if (gate) {
      gate.ready();
      await gate.resume;
      gate.done();
    }
    return content;
  }
}

test('session file store bounds in-flight content buffers until callers release them', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-file-capacity-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(projectRoot, { recursive: true });
  const paths = Array.from({ length: 5 }, (_value, index) => `file-${index}.md`);
  await Promise.all(paths.map((filePath, index) => (
    fs.writeFile(path.join(projectRoot, filePath), `# File ${index}\n`)
  )));
  const store = new FileSessionFileStore();
  const scope = {
    principalId: 'local-admin',
    sessionId: 'thread_capacity',
    projectRoot,
    projectStorageKey: 'project_capacity',
    attachmentSessionIds: [],
    legacyReportKeys: [],
    stateDir: path.join(root, 'state'),
    reportsDir: path.join(root, 'state', 'reports'),
  };
  const files = await Promise.all(paths.map((filePath) => store.resolveFile(scope, filePath)));
  const held = await Promise.all(files.slice(0, 4).map((file) => store.readFile(scope, file.id)));
  try {
    await assert.rejects(
      () => store.readFile(scope, files[4]!.id),
      SessionFileBusyError,
    );
    held[0]!.release();
    const resumed = await store.readFile(scope, files[4]!.id);
    try {
      assert.equal(resumed.data.toString('utf8'), '# File 4\n');
    } finally {
      resumed.release();
    }
  } finally {
    for (const content of held) {
      content.release();
    }
  }
});

test('aborted content responses release reserved file capacity', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-file-abort-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const stateDir = path.join(root, 'state');
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'preview.md'), '# Preview\n');
  const sessionFileStore = new PausingSessionFileStore();
  const server = createCodexWebServer({
    auth: singleUserAuth(),
    runtime: runtimeForProjects({ thread_abort: projectRoot }) as any,
    config: createConfig(stateDir, projectRoot),
    sessionFileStore,
  });
  await server.start();
  t.after(async () => {
    await server.stop();
  });

  const resolved = await resolveFile(server.baseUrl, 'thread_abort', 'preview.md');
  assert.equal(resolved.status, 200);
  const file = (await resolved.json() as any).file;
  for (let index = 0; index < 4; index += 1) {
    const gate = sessionFileStore.pauseNextRead();
    const controller = new AbortController();
    const pending = fetch(`${server.baseUrl}${file.contentUrl}`, {
      headers: { Authorization: 'Bearer local-token' },
      signal: controller.signal,
    });
    await gate.ready;
    controller.abort();
    await assert.rejects(pending, /abort/iu);
    gate.resume();
    await gate.done;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const recovered = await fetch(`${server.baseUrl}${file.contentUrl}`, {
    headers: { Authorization: 'Bearer local-token' },
  });
  assert.equal(recovered.status, 200);
  assert.equal(await recovered.text(), '# Preview\n');
});

test('single-user session files safely render project files, uploads, attachments, and matching legacy reports', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-files-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const stateDir = path.join(root, 'state');
  const projectDir = path.join(root, 'project-alpha');
  const outsideDir = path.join(root, 'outside');
  await Promise.all([
    fs.mkdir(path.join(projectDir, 'docs'), { recursive: true }),
    fs.mkdir(outsideDir, { recursive: true }),
  ]);
  await fs.writeFile(path.join(projectDir, 'docs', 'readme.md'), '# Session file\n');
  await fs.writeFile(path.join(projectDir, 'preview.html'), '<h1>Preview</h1>\n');
  await fs.writeFile(path.join(projectDir, 'document.pdf'), Buffer.from('%PDF-1.7\n'));
  await fs.writeFile(path.join(projectDir, 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(path.join(projectDir, 'archive.bin'), Buffer.from([0x00, 0x01, 0x02]));
  await fs.writeFile(path.join(outsideDir, 'secret.md'), '# Secret\n');
  await fs.symlink(path.join(outsideDir, 'secret.md'), path.join(projectDir, 'linked-secret.md'));

  const projectUpload = path.join(projectDir, 'uploads', 'local-admin', 'att_abc123-photo.png');
  const projectKey = `cwd-${crypto.createHash('sha256').update(projectDir).digest('hex').slice(0, 16)}`;
  const stateUpload = path.join(
    stateDir,
    'uploads',
    'projects',
    projectKey,
    'local-admin',
    'att_def456-notes.md',
  );
  const turnAttachment = path.join(
    stateDir,
    'turn-attachments',
    'local-admin',
    'thread_1',
    '01234567-89ab-cdef-0123-456789abcdef-history.md',
  );
  const legacyReport = path.join(stateDir, 'reports', 'project-alpha', 'old.md');
  const otherReport = path.join(stateDir, 'reports', 'project-beta', 'other.md');
  await Promise.all([
    fs.mkdir(path.dirname(projectUpload), { recursive: true }),
    fs.mkdir(path.dirname(stateUpload), { recursive: true }),
    fs.mkdir(path.dirname(turnAttachment), { recursive: true }),
    fs.mkdir(path.dirname(legacyReport), { recursive: true }),
    fs.mkdir(path.dirname(otherReport), { recursive: true }),
  ]);
  await fs.writeFile(projectUpload, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(stateUpload, '# Uploaded notes\n');
  await fs.writeFile(turnAttachment, '# Historical attachment\n');
  await fs.writeFile(legacyReport, '# Legacy\n');
  await fs.writeFile(otherReport, '# Other project\n');

  const largeFile = path.join(projectDir, 'large.pdf');
  await fs.writeFile(largeFile, '');
  await fs.truncate(largeFile, 64 * 1024 * 1024 + 1);

  const server = createCodexWebServer({
    auth: singleUserAuth(),
    runtime: runtimeForProjects({ thread_1: projectDir, thread_2: projectDir }) as any,
    config: createConfig(stateDir, projectDir),
  });
  await server.start();
  try {
    const unauthorized = await fetch(`${server.baseUrl}/api/sessions/thread_1/files/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'docs/readme.md' }),
    });
    assert.equal(unauthorized.status, 401);

    const resolved = await resolveFile(server.baseUrl, 'thread_1', 'docs/readme.md');
    assert.equal(resolved.status, 200);
    const payload = await resolved.json() as any;
    assert.match(payload.file.id, /^sf_[A-Za-z0-9_-]+$/u);
    assert.deepEqual({
      name: payload.file.name,
      kind: payload.file.kind,
      mimeType: payload.file.mimeType,
      source: payload.file.source,
    }, {
      name: 'readme.md',
      kind: 'markdown',
      mimeType: 'text/markdown; charset=utf-8',
      source: 'project',
    });
    assert.equal(payload.file.path, undefined);
    assert.equal(payload.file.contentUrl, `/api/sessions/thread_1/files/${payload.file.id}/content`);

    const content = await fetch(`${server.baseUrl}${payload.file.contentUrl}`, {
      headers: { Authorization: 'Bearer local-token' },
    });
    assert.equal(content.status, 200);
    assert.equal(content.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.equal(content.headers.get('cache-control'), 'no-store');
    assert.equal(content.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await content.text(), '# Session file\n');

    const typeCases = [
      ['preview.html', 'html', 'text/html; charset=utf-8'],
      ['document.pdf', 'pdf', 'application/pdf'],
      ['pixel.png', 'image', 'image/png'],
      ['archive.bin', 'file', 'application/octet-stream'],
    ];
    for (const [filePath, kind, mimeType] of typeCases) {
      const response = await resolveFile(server.baseUrl, 'thread_1', filePath!);
      assert.equal(response.status, 200);
      const item = (await response.json() as any).file;
      assert.equal(item.kind, kind);
      const raw = await fetch(`${server.baseUrl}${item.contentUrl}`, {
        headers: { Authorization: 'Bearer local-token' },
      });
      assert.equal(raw.status, 200);
      assert.equal(raw.headers.get('content-type'), mimeType);
      assert.match(
        raw.headers.get('content-disposition') ?? '',
        kind === 'file' ? /^attachment;/u : /^inline;/u,
      );
      if (kind === 'html') {
        assert.match(raw.headers.get('content-security-policy') ?? '', /\bsandbox\b/u);
      }
    }

    const projectUploadResponse = await resolveFile(server.baseUrl, 'thread_1', projectUpload);
    const projectUploadFile = (await projectUploadResponse.json() as any).file;
    assert.equal(projectUploadFile.name, 'photo.png');
    assert.equal(projectUploadFile.source, 'upload');

    const stateUploadResponse = await resolveFile(server.baseUrl, 'thread_1', stateUpload);
    assert.equal((await stateUploadResponse.json() as any).file.source, 'upload');
    const attachmentResponse = await resolveFile(server.baseUrl, 'thread_1', turnAttachment);
    const attachmentFile = (await attachmentResponse.json() as any).file;
    assert.equal(attachmentFile.name, 'history.md');
    assert.equal(attachmentFile.source, 'turn_attachment');
    const legacyResponse = await resolveFile(server.baseUrl, 'thread_1', legacyReport);
    assert.equal((await legacyResponse.json() as any).file.source, 'legacy_report');

    for (const deniedPath of [
      path.join(outsideDir, 'secret.md'),
      '../outside/secret.md',
      path.join(projectDir, 'linked-secret.md'),
      otherReport,
    ]) {
      const denied = await resolveFile(server.baseUrl, 'thread_1', deniedPath);
      assert.equal(denied.status, 404, deniedPath);
      assert.equal((await denied.json() as any).error, 'file_not_found');
    }

    const wrongSession = await fetch(
      `${server.baseUrl}/api/sessions/thread_2/files/${encodeURIComponent(payload.file.id)}/content`,
      { headers: { Authorization: 'Bearer local-token' } },
    );
    assert.equal(wrongSession.status, 404);

    const largeResolved = await resolveFile(server.baseUrl, 'thread_1', largeFile);
    assert.equal(largeResolved.status, 200);
    const large = (await largeResolved.json() as any).file;
    const largeContent = await fetch(`${server.baseUrl}${large.contentUrl}`, {
      headers: { Authorization: 'Bearer local-token' },
    });
    assert.equal(largeContent.status, 413);
    assert.deepEqual(await largeContent.json(), {
      error: 'file_too_large',
      message: 'Session file exceeds the maximum readable size.',
      maxBytes: 64 * 1024 * 1024,
    });
  } finally {
    await server.stop();
  }
});

test('multi-user session files enforce session ownership, project read access, and user-scoped attachments', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-files-multi-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const stateDir = path.join(root, 'state');
  const allowedProject = path.join(root, 'allowed-project');
  const deniedProject = path.join(root, 'denied-project');
  await Promise.all([
    fs.mkdir(allowedProject, { recursive: true }),
    fs.mkdir(deniedProject, { recursive: true }),
  ]);
  await fs.writeFile(path.join(allowedProject, 'summary.md'), '# Allowed project\n');
  await fs.writeFile(path.join(deniedProject, 'secret.md'), '# Denied project\n');

  const identityStore = new FileIdentityStore({ identityPath: path.join(stateDir, 'identity.json') });
  await identityStore.setMultiUserEnabled(true);
  await identityStore.upsertProject({
    id: 'project_allowed',
    internalName: 'allowed-project',
    cwd: allowedProject,
    displayName: 'Allowed Project',
    enabled: true,
  });
  await identityStore.upsertProject({
    id: 'project_denied',
    internalName: 'denied-project',
    cwd: deniedProject,
    displayName: 'Denied Project',
    enabled: true,
  });
  await identityStore.upsertRole({
    id: 'role_reader',
    name: 'Reader',
    isAdmin: false,
    projectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: false, canWrite: false }],
  });
  for (const [id, username] of [['user_alice', 'alice'], ['user_bob', 'bob']]) {
    await identityStore.upsertUserWithPassword({
      id,
      username,
      password: `${username}-password`,
      roleIds: ['role_reader'],
    });
  }
  await identityStore.upsertSession({
    id: 'app_alice',
    codexThreadId: 'thread_alice',
    projectId: 'project_allowed',
    ownerUserId: 'user_alice',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  });
  await identityStore.upsertSession({
    id: 'app_bob',
    codexThreadId: 'thread_bob',
    projectId: 'project_allowed',
    ownerUserId: 'user_bob',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  });
  await identityStore.upsertSession({
    id: 'app_denied',
    codexThreadId: 'thread_denied',
    projectId: 'project_denied',
    ownerUserId: 'user_alice',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  });

  const aliceUpload = path.join(allowedProject, 'uploads', 'user_alice', 'att_aaa-alice.md');
  const bobUpload = path.join(allowedProject, 'uploads', 'user_bob', 'att_bbb-bob.md');
  const aliceAttachment = path.join(
    stateDir,
    'turn-attachments',
    'user_alice',
    'thread_alice',
    '01234567-89ab-cdef-0123-456789abcdef-history.pdf',
  );
  const matchingLegacyReport = path.join(stateDir, 'reports', 'project_allowed', 'legacy.md');
  const deniedLegacyReport = path.join(stateDir, 'reports', 'project_denied', 'legacy.md');
  for (const filePath of [aliceUpload, bobUpload, aliceAttachment, matchingLegacyReport, deniedLegacyReport]) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, filePath.endsWith('.pdf') ? Buffer.from('%PDF-1.7\n') : '# File\n');
  }

  const principals = {
    admin: {
      userId: 'user_admin',
      username: 'admin',
      roleIds: ['role_admin'],
      isAdmin: true,
      mode: 'multi' as const,
    },
    alice: {
      userId: 'user_alice',
      username: 'alice',
      roleIds: ['role_reader'],
      isAdmin: false,
      mode: 'multi' as const,
    },
    bob: {
      userId: 'user_bob',
      username: 'bob',
      roleIds: ['role_reader'],
      isAdmin: false,
      mode: 'multi' as const,
    },
  };
  const server = createCodexWebServer({
    auth: multiUserAuth(principals),
    identityStore,
    runtime: runtimeForProjects({
      thread_alice: allowedProject,
      thread_bob: allowedProject,
      thread_denied: deniedProject,
    }) as any,
    config: createConfig(stateDir, allowedProject),
  });
  await server.start();
  try {
    const allowed = await resolveFile(server.baseUrl, 'app_alice', 'summary.md', 'alice');
    assert.equal(allowed.status, 200);
    const allowedFile = (await allowed.json() as any).file;
    assert.equal(allowedFile.path, undefined);
    assert.equal(allowedFile.kind, 'markdown');

    const ownUpload = await resolveFile(server.baseUrl, 'app_alice', aliceUpload, 'alice');
    assert.equal(ownUpload.status, 200);
    assert.equal((await ownUpload.json() as any).file.source, 'upload');
    const ownAttachment = await resolveFile(server.baseUrl, 'app_alice', aliceAttachment, 'alice');
    assert.equal(ownAttachment.status, 200);
    assert.equal((await ownAttachment.json() as any).file.source, 'turn_attachment');
    const legacy = await resolveFile(server.baseUrl, 'app_alice', matchingLegacyReport, 'alice');
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json() as any).file.source, 'legacy_report');

    const observedProject = await fetch(`${server.baseUrl}/api/admin/sessions/app_alice/files/resolve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'summary.md' }),
    });
    assert.equal(observedProject.status, 200);
    const observedFile = (await observedProject.json() as any).file;
    assert.match(observedFile.contentUrl, /^\/api\/admin\/sessions\/app_alice\/files\/[^/]+\/content$/u);
    const observedContent = await fetch(`${server.baseUrl}${observedFile.contentUrl}`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(observedContent.status, 200);
    assert.equal(await observedContent.text(), '# Allowed project\n');

    const observedUpload = await fetch(`${server.baseUrl}/api/admin/sessions/app_alice/files/resolve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: aliceUpload }),
    });
    assert.equal(observedUpload.status, 200);
    assert.equal((await observedUpload.json() as any).file.source, 'upload');

    const deniedRequests = await Promise.all([
      resolveFile(server.baseUrl, 'app_bob', 'summary.md', 'alice'),
      resolveFile(server.baseUrl, 'app_alice', 'summary.md', 'bob'),
      resolveFile(server.baseUrl, 'app_denied', 'secret.md', 'alice'),
      resolveFile(server.baseUrl, 'app_alice', bobUpload, 'alice'),
      resolveFile(server.baseUrl, 'app_alice', deniedLegacyReport, 'alice'),
      resolveFile(server.baseUrl, 'app_alice', path.join(deniedProject, 'secret.md'), 'alice'),
      resolveFile(server.baseUrl, 'app_alice', 'summary.md', 'admin'),
    ]);
    assert.deepEqual(deniedRequests.map((response) => response.status), [404, 404, 404, 404, 404, 404, 404]);

    const wrongPrincipal = await fetch(
      `${server.baseUrl}/api/sessions/app_bob/files/${encodeURIComponent(allowedFile.id)}/content`,
      { headers: { Authorization: 'Bearer bob' } },
    );
    assert.equal(wrongPrincipal.status, 404);
  } finally {
    await server.stop();
  }
});
