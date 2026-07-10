import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseCliArgs,
  runAuthSetPasswordCommand,
  runTaskCommand,
  startServeCommand,
} from '../src/cli.js';

function createConfig() {
  return {
    host: '127.0.0.1',
    port: 43210,
    defaultCwd: '/workspace',
    codexBin: 'codex',
    stateDir: '/tmp/codex-web-state',
    authPath: '/tmp/codex-web-state/auth.json',
    reportsDir: '/tmp/codex-web-state/reports',
    reportIndexPath: '/tmp/codex-web-state/report-index.json',
    envPath: '/tmp/codex-web-service.env',
    debug: false,
  };
}

test('cli parses serve and auth set-password commands', () => {
  assert.deepEqual(parseCliArgs([]), {
    command: 'serve',
    host: null,
    port: null,
  });
  assert.deepEqual(parseCliArgs(['serve', '--host', '0.0.0.0', '--port', '4444']), {
    command: 'serve',
    host: '0.0.0.0',
    port: 4444,
  });
  assert.deepEqual(parseCliArgs(['auth', 'set-password']), {
    command: 'auth-set-password',
  });
  assert.deepEqual(parseCliArgs(['task', 'run', 'morning-report']), {
    command: 'task',
    action: 'run',
    taskId: 'morning-report',
  });
  assert.deepEqual(parseCliArgs(['task', 'install', 'morning-report']), {
    command: 'task',
    action: 'install',
    taskId: 'morning-report',
  });
  assert.deepEqual(parseCliArgs(['task', 'uninstall', 'morning-report']), {
    command: 'task',
    action: 'uninstall',
    taskId: 'morning-report',
  });
  assert.deepEqual(parseCliArgs(['task', 'status', 'morning-report']), {
    command: 'task',
    action: 'status',
    taskId: 'morning-report',
  });
});

test('auth set-password prefers CODEX_WEB_PASSWORD and writes through the configured auth path', async () => {
  const calls: Array<{ authPath: string; password: string }> = [];
  const env = {
    CODEX_WEB_PASSWORD: 'secret-password',
  };

  await runAuthSetPasswordCommand({
    env,
    loadConfig: () => createConfig(),
    createAuthStore: ({ authPath }) => ({
      setPassword: async (password: string) => {
        calls.push({ authPath, password });
      },
    }),
    promptForPassword: async () => {
      throw new Error('prompt should not be used when CODEX_WEB_PASSWORD is set');
    },
    stdout: { write: () => true },
  });

  assert.deepEqual(calls, [{
    authPath: '/tmp/codex-web-state/auth.json',
    password: 'secret-password',
  }]);
  assert.equal(Object.hasOwn(env, 'CODEX_WEB_PASSWORD'), false);
});

test('auth set-password prompts when CODEX_WEB_PASSWORD is missing', async () => {
  const calls: string[] = [];
  let prompted = false;

  await runAuthSetPasswordCommand({
    env: {},
    loadConfig: () => createConfig(),
    createAuthStore: () => ({
      setPassword: async (password: string) => {
        calls.push(password);
      },
    }),
    promptForPassword: async () => {
      prompted = true;
      return 'prompted-password';
    },
    stdout: { write: () => true },
  });

  assert.equal(prompted, true);
  assert.deepEqual(calls, ['prompted-password']);
});

test('spawned auth set-password runs through a symlinked TypeScript entrypoint and writes only hashed state', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-cli-state-'));
  const linkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-cli-link-'));
  const cliModulePath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const cliLinkPath = path.join(linkDir, 'codex-web-cli.ts');
  await fs.symlink(cliModulePath, cliLinkPath);

  const result = await spawnProcess(process.execPath, ['--import', 'tsx', cliLinkPath, 'auth', 'set-password'], {
    cwd: path.dirname(fileURLToPath(new URL('../package.json', import.meta.url))),
    env: {
      ...process.env,
      CODEX_WEB_PASSWORD: 'symlink-secret-password',
      CODEX_WEB_STATE_DIR: stateDir,
    },
  });

  assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const authPath = path.join(stateDir, 'auth.json');
  const raw = await fs.readFile(authPath, 'utf8');
  assert.equal(raw.includes('symlink-secret-password'), false);

  const parsed = JSON.parse(raw) as {
    passwordHash?: unknown;
    passwordSalt?: unknown;
    sessions?: unknown;
  };
  assert.equal(typeof parsed.passwordHash, 'string');
  assert.equal(typeof parsed.passwordSalt, 'string');
  assert.deepEqual(parsed.sessions, []);
});

test('serve command applies host and port overrides and bootstraps auth from one-time env', async () => {
  const started: Array<{ host: string; port: number }> = [];
  const passwordBootstraps: Array<{ authPath: string; password: string }> = [];
  const env = {
    CODEX_WEB_PASSWORD: 'bootstrap-password',
  };

  const server = await startServeCommand(parseCliArgs([
    'serve',
    '--host', '0.0.0.0',
    '--port', '4444',
  ]), {
    env,
    loadConfig: () => createConfig(),
    createAuthStore: ({ authPath }) => ({
      isConfigured: async () => false,
      setPassword: async (password: string) => {
        passwordBootstraps.push({ authPath, password });
      },
      login: async () => {
        throw new Error('unused');
      },
      verifyToken: async () => null,
      logout: async () => {},
    }),
    createRuntime: () => ({}) as any,
    createServer: ({ config }) => ({
      baseUrl: `http://${config.host}:${config.port}`,
      start: async () => {
        started.push({ host: config.host, port: config.port });
      },
      stop: async () => {},
    }),
    stdout: { write: () => true },
  });

  assert.equal(server.baseUrl, 'http://0.0.0.0:4444');
  assert.deepEqual(started, [{ host: '0.0.0.0', port: 4444 }]);
  assert.deepEqual(passwordBootstraps, [{
    authPath: '/tmp/codex-web-state/auth.json',
    password: 'bootstrap-password',
  }]);
  assert.equal(Object.hasOwn(env, 'CODEX_WEB_PASSWORD'), false);
});

test('serve command clears one-time password before creating runtime', async () => {
  const env = {
    CODEX_WEB_PASSWORD: 'bootstrap-password',
  };
  const observations: boolean[] = [];

  await startServeCommand(parseCliArgs(['serve']), {
    env,
    loadConfig: () => createConfig(),
    createAuthStore: () => ({
      isConfigured: async () => true,
      setPassword: async () => {},
      login: async () => {
        throw new Error('unused');
      },
      verifyToken: async () => null,
      logout: async () => {},
    }),
    createRuntime: () => {
      observations.push(Object.hasOwn(env, 'CODEX_WEB_PASSWORD'));
      return {} as any;
    },
    createServer: ({ config }) => ({
      baseUrl: `http://${config.host}:${config.port}`,
      start: async () => {},
      stop: async () => {},
    }),
    stdout: { write: () => true },
  });

  assert.deepEqual(observations, [false]);
  assert.equal(Object.hasOwn(env, 'CODEX_WEB_PASSWORD'), false);
});

test('serve command gives the runtime a help report path in the configured report tree', async () => {
  const observedHelpReportPaths: unknown[] = [];

  await startServeCommand(parseCliArgs(['serve']), {
    env: {},
    loadConfig: () => createConfig(),
    createAuthStore: () => ({
      isConfigured: async () => true,
      setPassword: async () => {},
      login: async () => {
        throw new Error('unused');
      },
      verifyToken: async () => null,
      logout: async () => {},
    }),
    createServer: ({ config, runtime }) => ({
      baseUrl: `http://${config.host}:${config.port}`,
      start: async () => {
        observedHelpReportPaths.push((runtime as any).helpReportPath);
      },
      stop: async () => {},
    }),
    stdout: { write: () => true },
  });

  assert.deepEqual(observedHelpReportPaths, [
    '/tmp/codex-web-state/reports/codex-mobile-web-app/2026-05-22/codex-web-help.md',
  ]);
});

test('serve command creates state and log directories before server start', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-cli-serve-'));
  const stateDir = path.join(tempRoot, 'state');
  const authPath = path.join(stateDir, 'auth.json');
  const logDir = path.join(stateDir, 'logs');
  const reportsDir = path.join(stateDir, 'reports');
  const helpReportPath = path.join(
    reportsDir,
    'codex-mobile-web-app',
    '2026-05-22',
    'codex-web-help.md',
  );

  const server = await startServeCommand(parseCliArgs(['serve']), {
    env: {},
    loadConfig: () => ({
      ...createConfig(),
      stateDir,
      authPath,
      reportsDir,
      reportIndexPath: path.join(stateDir, 'report-index.json'),
    }),
    createAuthStore: () => ({
      isConfigured: async () => true,
      setPassword: async () => {},
      login: async () => {
        throw new Error('unused');
      },
      verifyToken: async () => null,
      logout: async () => {},
    }),
    createRuntime: () => ({}) as any,
    createServer: ({ config }) => ({
      baseUrl: `http://${config.host}:${config.port}`,
      start: async () => {},
      stop: async () => {},
    }),
    stdout: { write: () => true },
  });

  await server.stop();

  const stateStat = await fs.stat(stateDir);
  const logStat = await fs.stat(logDir);
  const reportsStat = await fs.stat(reportsDir);
  const helpReport = await fs.readFile(helpReportPath, 'utf8');
  assert.equal(stateStat.isDirectory(), true);
  assert.equal(logStat.isDirectory(), true);
  assert.equal(reportsStat.isDirectory(), true);
  assert.match(helpReport, /# Codex Web 帮助/u);
  assert.match(helpReport, /\| 命令 \| 作用 \| 会启动 Codex turn \|/u);
  assert.match(helpReport, /`\/help`/u);
  assert.match(helpReport, /`\/goal resume`/u);
});

test('task run reads the configured task and invokes the scheduled task runner', async () => {
  const calls: unknown[] = [];
  const stdoutLines: string[] = [];
  let stopped = false;

  const parsed = parseCliArgs(['task', 'run', 'morning-report']);
  assert.equal(parsed.command, 'task');

  await runTaskCommand(parsed, {
    env: {},
    loadConfig: () => createConfig(),
    createTaskStore: ({ stateDir }) => ({
      readTask: async (taskId: string) => {
        calls.push({ readTask: taskId, stateDir });
        return {
          id: taskId,
          title: 'Morning report',
          cwd: '/workspace',
          projectId: null,
          runAsUserId: null,
          schedule: { kind: 'daily', time: '09:00' },
          settings: {},
          archive: { onCompletion: true },
          prompt: 'Run task\n',
          taskDir: '/tmp/task',
        };
      },
    }),
    createRuntime: ({ config }) => {
      calls.push({ runtimeStateDir: config.stateDir });
      return {
        stop: async () => {
          stopped = true;
        },
      } as any;
    },
    createIdentityStore: ({ identityPath }) => {
      calls.push({ identityPath });
      return {} as any;
    },
    runTask: async ({ task, stateDir, identityStore }) => {
      calls.push({ runTask: task.id, stateDir, hasIdentityStore: Boolean(identityStore) });
      return {
        taskId: task.id,
        sessionId: 'thread_task',
        turnId: 'turn_task',
        archived: true,
      };
    },
    stdout: { write: (chunk) => {
      stdoutLines.push(chunk);
      return true;
    } },
  });

  assert.deepEqual(calls, [
    { readTask: 'morning-report', stateDir: '/tmp/codex-web-state' },
    { runtimeStateDir: '/tmp/codex-web-state' },
    { identityPath: '/tmp/codex-web-state/identity.json' },
    { runTask: 'morning-report', stateDir: '/tmp/codex-web-state', hasIdentityStore: true },
  ]);
  assert.equal(stopped, true);
  assert.deepEqual(stdoutLines, [
    'task_started: morning-report\n',
    'session_id: thread_task\n',
    'turn_id: turn_task\n',
    'archived: true\n',
  ]);
});

test('task install writes scheduler files and runs platform commands', async () => {
  const writes: Array<{ filePath: string; content: string; mode?: number }> = [];
  const commands: Array<{ argv: string[]; allowFailure?: boolean }> = [];

  const parsed = parseCliArgs(['task', 'install', 'morning-report']);
  assert.equal(parsed.command, 'task');

  await runTaskCommand(parsed, {
    env: {},
    platform: 'linux',
    homeDir: '/home/alice',
    codexWebBin: '/home/alice/.local/bin/codex-web',
    loadConfig: () => createConfig(),
    createTaskStore: () => ({
      readTask: async (taskId: string) => ({
        id: taskId,
        title: 'Morning report',
        cwd: null,
        projectId: null,
        runAsUserId: null,
        schedule: { kind: 'daily', time: '09:30' },
        settings: {},
        archive: { onCompletion: true },
        prompt: 'Run task\n',
        taskDir: '/tmp/task',
      }),
    }),
    writeSchedulerFile: async (filePath, content, mode) => {
      writes.push({ filePath, content, mode });
    },
    runCommand: async (command) => {
      commands.push(command);
    },
    stdout: { write: () => true },
  });

  assert.deepEqual(writes.map((write) => write.filePath), [
    '/home/alice/.config/systemd/user/codex-web-task@morning-report.service',
    '/home/alice/.config/systemd/user/codex-web-task@morning-report.timer',
  ]);
  assert.match(writes[1]?.content ?? '', /OnCalendar=\*-\*-\* 09:30:00/u);
  assert.deepEqual(commands, [
    { argv: ['systemctl', '--user', 'daemon-reload'] },
    { argv: ['systemctl', '--user', 'enable', '--now', 'codex-web-task@morning-report.timer'] },
  ]);
});

test('task install continues past allowed scheduler command failures', async () => {
  const commands: Array<{ argv: string[]; allowFailure?: boolean }> = [];
  const parsed = parseCliArgs(['task', 'install', 'daily']);
  assert.equal(parsed.command, 'task');

  await runTaskCommand(parsed, {
    env: {},
    platform: 'darwin',
    homeDir: '/Users/alice',
    codexWebBin: '/opt/codex-web/bin/codex-web',
    loadConfig: () => createConfig(),
    createTaskStore: () => ({
      readTask: async (taskId: string) => ({
        id: taskId,
        title: 'Daily',
        cwd: null,
        projectId: null,
        runAsUserId: null,
        schedule: { kind: 'daily', time: '09:00' },
        settings: {},
        archive: { onCompletion: true },
        prompt: 'Run task\n',
        taskDir: '/tmp/task',
      }),
    }),
    writeSchedulerFile: async () => {},
    runCommand: async (command) => {
      commands.push(command);
      if (command.allowFailure) {
        throw new Error('simulated unload failure');
      }
    },
    stdout: { write: () => true },
  });

  assert.deepEqual(commands, [
    {
      argv: ['launchctl', 'unload', '/Users/alice/Library/LaunchAgents/com.chenyanshan.codex-web.task.daily.plist'],
      allowFailure: true,
    },
    {
      argv: ['launchctl', 'load', '/Users/alice/Library/LaunchAgents/com.chenyanshan.codex-web.task.daily.plist'],
    },
  ]);
});

function spawnProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
