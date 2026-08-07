import { createReadStream, readFileSync } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
const fixtureHistoryImage = readFileSync(path.join(publicRoot, 'icon-192.png'));
const portArgument = process.argv.find((argument) => argument.startsWith('--port='));
const port = Number(portArgument?.slice('--port='.length) || process.env.PORT || 41739);
const fixtureBuildId = '__CODEX_WEB_BUILD_ID__';
const activeTurnStreams = new Map();
const webhookSettingsByAuthorization = new Map();
let activeTurnEventSequence = 100;
let webhookKeySequence = 0;

const fixtureSession = {
  id: 'session_browser_fixture',
  cwd: '/Users/test/yanshan_quant',
  projectName: 'yanshan_quant',
  title: 'Quality gate fixture',
  preview: 'Verify the mobile workspace',
  firstUserInput: 'Verify the mobile workspace',
  lastUserInput: 'Verify the mobile workspace',
  lastInputAt: Date.parse('2026-07-15T08:00:00.000Z'),
  updatedAt: Date.parse('2026-07-15T08:01:00.000Z'),
  archived: false,
  favorite: true,
  activeTurnId: 'turn_browser_active',
  activityState: 'running',
  settings: {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
    collaborationMode: 'default',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    personality: 'pragmatic',
    metadata: {},
  },
  thread: {
    id: 'session_browser_fixture',
    turns: [{
      id: 'turn_browser_active',
      status: 'inProgress',
      items: [],
    }],
  },
};

const fixtureIdleSession = {
  id: 'session_browser_idle',
  cwd: '/Users/test/yanshan_quant',
  projectName: 'yanshan_quant',
  title: 'Idle quality gate fixture',
  preview: 'Archive an idle session',
  firstUserInput: 'Archive an idle session',
  lastUserInput: 'Archive an idle session',
  lastInputAt: Date.parse('2026-07-15T07:00:00.000Z'),
  updatedAt: Date.parse('2026-07-15T07:01:00.000Z'),
  archived: false,
  favorite: false,
  activeTurnId: null,
  settings: {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
    collaborationMode: 'default',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    personality: 'pragmatic',
    metadata: {},
  },
  thread: {
    id: 'session_browser_idle',
    turns: [],
  },
};

const fixtureArchivedSession = {
  ...fixtureIdleSession,
  id: 'session_browser_archived',
  title: 'Archived quality gate fixture',
  preview: 'Restore an archived session',
  firstUserInput: 'Restore an archived session',
  lastUserInput: 'Restore an archived session',
  archived: true,
  readOnly: true,
  activeTurnId: null,
  thread: {
    id: 'session_browser_archived',
    turns: [],
  },
};

const fixtureOlderSession = {
  ...fixtureIdleSession,
  id: 'session_browser_older',
  title: 'Older pagination fixture',
  preview: 'Load an older session page',
  firstUserInput: 'Load an older session page',
  lastUserInput: 'Load an older session page',
  lastInputAt: Date.parse('2026-07-14T06:00:00.000Z'),
  updatedAt: Date.parse('2026-07-14T06:01:00.000Z'),
  thread: {
    id: 'session_browser_older',
    turns: [],
  },
};

const fixtureHistorySession = {
  ...fixtureIdleSession,
  id: 'session_browser_history',
  title: 'History scroll fixture',
  preview: 'Oldest browser question',
  firstUserInput: 'Oldest browser question',
  lastUserInput: 'Latest browser question',
  archived: false,
  readOnly: false,
  thread: {
    id: 'session_browser_history',
    turns: [
      {
        id: 'turn_browser_oldest',
        status: 'completed',
        items: [
          { type: 'message', role: 'user', text: 'Oldest browser question' },
          { type: 'message', role: 'assistant', text: 'Oldest browser answer' },
        ],
      },
      {
        id: 'turn_browser_recent',
        status: 'completed',
        items: [
          { type: 'message', role: 'user', text: 'Recent browser question' },
          { type: 'message', role: 'assistant', text: 'Recent browser answer' },
        ],
      },
      {
        id: 'turn_browser_latest',
        status: 'completed',
        items: [
          { type: 'message', role: 'user', text: 'Latest browser question' },
          { type: 'message', role: 'assistant', text: 'Latest browser answer' },
        ],
      },
    ],
  },
};

const fixtureFileTimeline = [
  ...Array.from({ length: 6 }, (_item, index) => ([
    {
      id: `file_history_user_${index}`,
      kind: 'message',
      role: 'user',
      label: 'You',
      meta: 'history',
      text: `Earlier file viewer question ${index + 1}`,
    },
    {
      id: `file_history_assistant_${index}`,
      kind: 'message',
      role: 'assistant',
      label: 'Assistant',
      meta: 'history',
      text: `Earlier file viewer answer ${index + 1}`,
    },
  ])).flat(),
  {
    id: 'file_history_upload',
    kind: 'message',
    role: 'user',
    label: 'You',
    meta: 'history',
    text: 'This image was uploaded in an earlier turn.',
    attachments: [{
      id: 'attachment_browser_history_image',
      kind: 'image',
      fileName: 'history-image.png',
      mimeType: 'image/png',
      sizeBytes: fixtureHistoryImage.byteLength,
      localPath: '/state/turn-attachments/browser/history-image.png',
    }],
  },
  {
    id: 'file_history_generated_markdown',
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    meta: 'final',
    text: 'Generated [Browser session guide](docs/browser-session-guide.md) and [sandboxed HTML preview](docs/browser-sandbox.html) in this project.',
  },
];

const fixtureFileSession = {
  ...fixtureIdleSession,
  id: 'session_browser_files',
  title: 'Session file viewer fixture',
  preview: 'Open generated files and retained attachments',
  firstUserInput: 'Open generated files and retained attachments',
  lastUserInput: 'This image was uploaded in an earlier turn.',
  lastInputAt: Date.parse('2026-07-15T07:30:00.000Z'),
  updatedAt: Date.parse('2026-07-15T07:31:00.000Z'),
  timeline: fixtureFileTimeline,
  thread: {
    id: 'session_browser_files',
    turns: [],
  },
};

const fixtureSessionFiles = new Map([
  ['docs/browser-session-guide.md', {
    id: 'sf_browser_markdown',
    sessionId: 'session_browser_files',
    name: 'browser-session-guide.md',
    kind: 'markdown',
    mimeType: 'text/markdown; charset=utf-8',
    source: 'project',
    updatedAt: '2026-07-15T07:31:00.000Z',
    data: Buffer.from('# Browser Session Guide\n\nThis Markdown file was resolved from the current project.\n\n- Session scoped\n- Mobile ready\n'),
  }],
  ['docs/browser-sandbox.html', {
    id: 'sf_browser_html',
    sessionId: 'session_browser_files',
    name: 'browser-sandbox.html',
    kind: 'html',
    mimeType: 'text/html; charset=utf-8',
    source: 'project',
    updatedAt: '2026-07-15T07:32:00.000Z',
    data: Buffer.from('<meta http-equiv="refresh" content="0;url=/html-refresh-target"><link rel="stylesheet" href="/html-probe.css"><script>document.documentElement.dataset.scriptRan="true"</script><img src="/html-probe.png" alt="blocked"><h1>Sandboxed HTML</h1>'),
  }],
  ['/state/turn-attachments/browser/history-image.png', {
    id: 'sf_browser_history_image',
    sessionId: 'session_browser_files',
    name: 'history-image.png',
    kind: 'image',
    mimeType: 'image/png',
    source: 'turn_attachment',
    updatedAt: '2026-07-15T07:30:00.000Z',
    data: fixtureHistoryImage,
  }],
]);
const fixtureSessionFilesById = new Map(
  [...fixtureSessionFiles.values()].map((file) => [file.id, file]),
);

const jsonRoutes = new Map([
  ['/api/auth/me', {
    session: {
      id: 'browser_auth_fixture',
      createdAt: '2026-07-15T08:00:00.000Z',
      lastSeenAt: '2026-07-15T08:00:00.000Z',
      principal: { mode: 'single', isAdmin: false },
    },
  }],
  ['/api/settings', {
    settings: { siteTitle: 'Codex QA' },
    permissions: { canSetSiteTitle: true },
  }],
  ['/api/models', {
    defaults: {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
    },
    items: [{
      id: 'gpt-5.6-sol',
      model: 'gpt-5.6-sol',
      displayName: 'GPT-5.6-Sol',
      isDefault: true,
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultReasoningEffort: 'low',
    }],
  }],
  ['/api/projects', {
    items: [{
      id: 'project_browser_fixture',
      cwd: '/Users/test/yanshan_quant',
      name: 'yanshan_quant',
      displayName: 'yanshan_quant',
      favorite: true,
    }],
  }],
  ['/api/sessions', { items: [fixtureSession, fixtureIdleSession, fixtureFileSession, fixtureHistorySession], nextCursor: 'older-page' }],
  ['/api/sessions/session_browser_fixture', { session: fixtureSession }],
  ['/api/sessions/session_browser_idle', { session: fixtureIdleSession }],
  ['/api/sessions/session_browser_archived', { session: fixtureArchivedSession }],
  ['/api/sessions/session_browser_history', { session: fixtureHistorySession }],
  ['/api/sessions/session_browser_files', { session: fixtureFileSession }],
  ['/api/sessions/session_browser_older', { session: fixtureOlderSession }],
]);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    const pathname = requestUrl.pathname;

    if (pathname === '/healthz') {
      sendText(response, 200, 'ok');
      return;
    }

    if (pathname === '/version.json') {
      sendJson(response, 200, { buildId: fixtureBuildId });
      return;
    }

    if (pathname === '/api/turns/turn_browser_active/events') {
      streamActiveTurn(request, response);
      return;
    }

    if (pathname === '/api/webhook' && request.method === 'GET') {
      const authorization = request.headers.authorization || '';
      const current = webhookSettingsByAuthorization.get(authorization) ?? emptyWebhookCredentialState();
      sendJson(response, 200, {
        webhook: current.webhook,
        key: current.key,
      });
      return;
    }

    if (pathname === '/api/webhook' && request.method === 'PATCH') {
      const authorization = request.headers.authorization || '';
      const body = await readJsonObject(request);
      const current = webhookSettingsByAuthorization.get(authorization) ?? emptyWebhookCredentialState();
      const enabled = body.enabled === true;
      let key = current.key;
      let webhook = { ...current.webhook, enabled };
      if (enabled && !current.webhook.hasKey) {
        key = createFixtureWebhookKey();
        webhook = { ...webhook, hasKey: true, keyHint: key.slice(-6) };
      }
      webhookSettingsByAuthorization.set(authorization, { webhook, key });
      sendJson(response, 200, {
        webhook,
        key,
      });
      return;
    }

    if (pathname === '/api/webhook/rotate' && request.method === 'POST') {
      const authorization = request.headers.authorization || '';
      const current = webhookSettingsByAuthorization.get(authorization) ?? emptyWebhookCredentialState();
      const key = createFixtureWebhookKey();
      const webhook = {
        ...current.webhook,
        enabled: true,
        hasKey: true,
        keyHint: key.slice(-6),
      };
      webhookSettingsByAuthorization.set(authorization, { webhook, key });
      sendJson(response, 200, { webhook, key });
      return;
    }

    if (pathname === '/__test/reset-webhook' && request.method === 'POST') {
      webhookSettingsByAuthorization.delete(request.headers.authorization || '');
      sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname === '/__test/turn-event' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
      }
      const event = JSON.parse(body || '{}');
      activeTurnEventSequence += 1;
      const authorization = request.headers.authorization || '';
      let delivered = 0;
      for (const [stream, streamAuthorization] of activeTurnStreams) {
        if (streamAuthorization !== authorization) {
          continue;
        }
        stream.write(`id: ${activeTurnEventSequence}\ndata: ${JSON.stringify(event)}\n\n`);
        delivered += 1;
      }
      sendJson(response, 200, { delivered });
      return;
    }

    if (pathname === '/api/sessions' && requestUrl.searchParams.get('state') === 'archived') {
      sendJson(response, 200, { items: [fixtureArchivedSession], nextCursor: null });
      return;
    }

    if (pathname === '/api/sessions' && requestUrl.searchParams.get('cursor') === 'older-page') {
      sendJson(response, 200, { items: [fixtureOlderSession], nextCursor: null });
      return;
    }

    if (pathname === '/api/sessions/session_browser_idle/attachments' && request.method === 'POST') {
      let uploadedBytes = 0;
      for await (const chunk of request) {
        uploadedBytes += chunk.length;
      }
      if (!uploadedBytes) {
        sendJson(response, 400, { error: 'empty_upload' });
        return;
      }
      sendJson(response, 201, {
        items: [{
          id: 'attachment_browser_paste',
          kind: 'image',
          fileName: 'pasted-image.png',
          mimeType: 'image/png',
          sizeBytes: 11,
          storage: 'state',
          localPath: '/state/pasted-image.png',
        }],
      });
      return;
    }

    const sessionFileResolveMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/files\/resolve$/u);
    if (sessionFileResolveMatch && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
      }
      const sessionId = decodeURIComponent(sessionFileResolveMatch[1]);
      const inputPath = String(JSON.parse(body || '{}').path || '');
      const file = fixtureSessionFiles.get(inputPath);
      if (!file || file.sessionId !== sessionId) {
        sendJson(response, 404, { error: 'file_not_found', message: 'Session file was not found.' });
        return;
      }
      const contentUrl = `/api/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(file.id)}/content`;
      sendJson(response, 200, {
        file: {
          id: file.id,
          name: file.name,
          kind: file.kind,
          mimeType: file.mimeType,
          sizeBytes: file.data.byteLength,
          updatedAt: file.updatedAt,
          source: file.source,
          contentUrl,
          downloadUrl: `${contentUrl}?download=1`,
        },
      });
      return;
    }

    const sessionFileContentMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/files\/([^/]+)\/content$/u);
    if (sessionFileContentMatch && request.method === 'GET') {
      const sessionId = decodeURIComponent(sessionFileContentMatch[1]);
      const fileId = decodeURIComponent(sessionFileContentMatch[2]);
      const file = fixtureSessionFilesById.get(fileId);
      if (!file || file.sessionId !== sessionId) {
        sendJson(response, 404, { error: 'file_not_found', message: 'Session file was not found.' });
        return;
      }
      sendFileContent(response, file, requestUrl.searchParams.get('download') === '1');
      return;
    }

    if (jsonRoutes.has(pathname)) {
      sendJson(response, 200, jsonRoutes.get(pathname));
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'fixture_route_missing', message: `No fixture for ${pathname}` });
      return;
    }

    const relativePath = pathname === '/' || /^\/share\/[^/]+$/u.test(pathname)
      ? 'index.html'
      : decodeURIComponent(pathname.slice(1));
    const filePath = path.resolve(publicRoot, relativePath);
    if (!filePath.startsWith(`${path.resolve(publicRoot)}${path.sep}`)) {
      sendText(response, 403, 'forbidden');
      return;
    }

    await access(filePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, 'not found');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': fileStat.size,
      'Content-Type': contentTypes.get(path.extname(filePath)) || 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      sendText(response, 404, 'not found');
      return;
    }
    sendText(response, 500, 'fixture server error');
  }
});

server.listen(port, '127.0.0.1');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

function sendText(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(body);
}

async function readJsonObject(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  const parsed = JSON.parse(body || '{}');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function emptyWebhookSettings() {
  return {
    enabled: false,
    hasKey: false,
    keyHint: null,
    endpointPath: '/api/webhook',
  };
}

function emptyWebhookCredentialState() {
  return {
    webhook: emptyWebhookSettings(),
    key: null,
  };
}

function createFixtureWebhookKey() {
  webhookKeySequence += 1;
  return `cwwh_browser_fixture_${String(webhookKeySequence).padStart(6, '0')}`;
}

function sendFileContent(response, file, download) {
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${file.name}"`,
    'Content-Length': file.data.byteLength,
    'Content-Type': file.mimeType,
  });
  response.end(file.data);
}

function streamActiveTurn(request, response) {
  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
  });
  response.flushHeaders();
  activeTurnStreams.set(response, request.headers.authorization || '');

  const events = [
    {
      type: 'turn.started',
      turnId: 'turn_browser_active',
      threadId: 'session_browser_fixture',
    },
    {
      type: 'assistant.delta',
      turnId: 'turn_browser_active',
      itemId: 'commentary_browser_before',
      eventType: 'completed',
      phase: 'commentary',
      text: 'Checking the event stream and replay state.',
      delta: '',
    },
    {
      type: 'batch.started',
      turnId: 'turn_browser_active',
      batchId: 'batch_browser_command',
      kind: 'command',
      title: 'npm test',
    },
    {
      type: 'batch.updated',
      turnId: 'turn_browser_active',
      batchId: 'batch_browser_command',
      summary: {
        command: 'npm test',
        output: [
          { type: 'input_text', text: 'Tests are still running' },
          { type: 'input_text', text: 'No failures yet' },
        ],
      },
    },
    {
      type: 'batch.completed',
      turnId: 'turn_browser_active',
      batchId: 'batch_browser_command',
      status: 'completed',
    },
    {
      type: 'assistant.delta',
      turnId: 'turn_browser_active',
      itemId: 'commentary_browser_after',
      eventType: 'completed',
      phase: 'commentary',
      text: 'Command output is complete; reviewing the file update.',
      delta: '',
    },
    {
      type: 'batch.started',
      turnId: 'turn_browser_active',
      batchId: 'batch_browser_edit',
      kind: 'file_change',
      title: 'Update styles',
    },
    {
      type: 'batch.updated',
      turnId: 'turn_browser_active',
      batchId: 'batch_browser_edit',
      summary: {
        fileChanges: {
          'packages/codex-web/public/styles.css': {
            action: 'updated',
            additions: 4,
            deletions: 1,
          },
          'packages/codex-web/public/app.js': { action: 'modified' },
        },
      },
    },
    {
      type: 'approval.requested',
      turnId: 'turn_browser_active',
      approvalId: 'approval_browser_fixture',
      approvalKind: 'command',
      summary: { command: 'npm test' },
    },
  ];

  events.forEach((event, index) => {
    response.write(`id: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`);
  });

  const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 5_000);
  request.on('close', () => {
    activeTurnStreams.delete(response);
    clearInterval(heartbeat);
  });
}
