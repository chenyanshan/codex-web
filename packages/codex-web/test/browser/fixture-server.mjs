import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
const portArgument = process.argv.find((argument) => argument.startsWith('--port='));
const port = Number(portArgument?.slice('--port='.length) || process.env.PORT || 41739);

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
    model: 'gpt-5.4',
    reasoningEffort: 'xhigh',
    metadata: {
      collaborationMode: 'default',
      accessPreset: 'full-access',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      personality: 'pragmatic',
    },
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
    model: 'gpt-5.4',
    reasoningEffort: 'xhigh',
    metadata: {
      collaborationMode: 'default',
      accessPreset: 'full-access',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      personality: 'pragmatic',
    },
  },
  thread: {
    id: 'session_browser_idle',
    turns: [],
  },
};

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
    items: [{
      id: 'gpt-5.4',
      model: 'gpt-5.4',
      displayName: 'GPT 5.4',
      isDefault: true,
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'xhigh',
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
  ['/api/sessions', { items: [fixtureSession, fixtureIdleSession] }],
  ['/api/sessions/session_browser_fixture', { session: fixtureSession }],
  ['/api/sessions/session_browser_idle', { session: fixtureIdleSession }],
  ['/api/reports', { items: [] }],
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

    if (pathname === '/api/turns/turn_browser_active/events') {
      streamActiveTurn(request, response);
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

    const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
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

function streamActiveTurn(request, response) {
  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
  });
  response.flushHeaders();

  const events = [
    {
      type: 'turn.started',
      turnId: 'turn_browser_active',
      threadId: 'session_browser_fixture',
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
      summary: { command: 'npm test', output: 'Tests are still running' },
    },
    {
      type: 'batch.completed',
      turnId: 'turn_browser_active',
      batchId: 'batch_browser_command',
      status: 'completed',
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
        fileChanges: [{
          path: 'packages/codex-web/public/styles.css',
          action: 'updated',
          additions: 4,
          deletions: 1,
        }],
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
  request.on('close', () => clearInterval(heartbeat));
}
