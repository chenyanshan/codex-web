import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const helperPath = fileURLToPath(new URL('../../../skills/codex-web-user-context/scripts/read-context.mjs', import.meta.url));

test('user context skill helper fetches and prints the current thread context', async (t) => {
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/api/local/thread-context/thread_skill');
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({
      schemaVersion: 1,
      appSessionId: 'app_skill',
      codexThreadId: 'thread_skill',
      owner: { userId: 'user_skill', username: 'skill-user', email: null },
      project: { id: 'project_skill', displayName: 'Skill Project' },
      updatedAt: '2026-08-29T00:00:00.000Z',
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const { stdout, stderr } = await execFileAsync(process.execPath, [helperPath], {
    env: {
      ...process.env,
      CODEX_THREAD_ID: 'thread_skill',
      CODEX_WEB_LOCAL_API_URL: `http://127.0.0.1:${address.port}`,
    },
  });

  assert.equal(stderr, '');
  const context = JSON.parse(stdout);
  assert.equal(context.codexThreadId, 'thread_skill');
  assert.equal(context.owner.username, 'skill-user');
  assert.equal(context.project.displayName, 'Skill Project');
});

test('user context skill helper fails cleanly without a Codex thread id', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [helperPath], {
      env: {
        ...process.env,
        CODEX_THREAD_ID: '',
        CODEX_WEB_LOCAL_API_URL: 'http://127.0.0.1:43210',
      },
    }),
    (error: any) => {
      assert.equal(error.stdout, '');
      assert.equal(error.stderr, 'Codex Web user context is unavailable: CODEX_THREAD_ID is not set.\n');
      return true;
    },
  );
});

test('user context skill helper rejects non-loopback API URLs before fetching', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [helperPath], {
      env: {
        ...process.env,
        CODEX_THREAD_ID: 'thread_skill',
        CODEX_WEB_LOCAL_API_URL: 'http://192.0.2.20:43210',
      },
    }),
    (error: any) => {
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /must be a loopback HTTP origin/u);
      return true;
    },
  );
});
