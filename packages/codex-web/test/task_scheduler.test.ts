import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScheduledTaskDefinition } from '../src/task_store.js';
import {
  createCodexWebCommandArgv,
  createTaskSchedulerPlan,
  renderLaunchdTaskPlist,
  renderSystemdTaskService,
  renderSystemdTaskTimer,
} from '../src/task_scheduler.js';

test('launchd scheduled task plist invokes codex-web task run at the configured time', () => {
  const plist = renderLaunchdTaskPlist({
    task: createTask({
      id: 'morning-report',
      schedule: {
        kind: 'daily',
        time: '09:30',
      },
    }),
    codexWebArgv: [
      '/opt/homebrew/bin/node',
      '--conditions=development',
      '--import',
      '/workspace/node_modules/tsx/dist/loader.mjs',
      '/workspace/packages/codex-web/src/cli.ts',
    ],
    envPath: '/Users/alice/.config/codex-web/service.env',
  });

  assert.match(plist, /<key>Label<\/key>\s*<string>com\.chenyanshan\.codex-web\.task\.morning-report<\/string>/u);
  assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>/u);
  assert.match(plist, /<string>--import<\/string>\s*<string>\/workspace\/node_modules\/tsx\/dist\/loader\.mjs<\/string>/u);
  assert.match(plist, /<string>\/workspace\/packages\/codex-web\/src\/cli\.ts<\/string>/u);
  assert.match(plist, /<string>task<\/string>\s*<string>run<\/string>\s*<string>morning-report<\/string>/u);
  assert.match(plist, /<key>Hour<\/key>\s*<integer>9<\/integer>/u);
  assert.match(plist, /<key>Minute<\/key>\s*<integer>30<\/integer>/u);
  assert.match(plist, /<key>CODEX_WEB_ENV_PATH<\/key>\s*<string>\/Users\/alice\/.config\/codex-web\/service.env<\/string>/u);
});

test('systemd scheduled task files invoke codex-web task run with OnCalendar daily time', () => {
  const task = createTask({
    id: 'morning-report',
    schedule: {
      kind: 'daily',
      time: '09:30',
    },
  });

  const service = renderSystemdTaskService({
    task,
    codexWebArgv: ['/usr/bin/node', '/home/alice/Codex Web/dist/cli.js'],
    envPath: '/home/alice/.config/codex-web/service.env',
  });
  const timer = renderSystemdTaskTimer({ task });

  assert.match(service, /^\[Unit\]\nDescription=Codex Web scheduled task morning-report/mu);
  assert.match(service, /EnvironmentFile="-\/home\/alice\/\.config\/codex-web\/service\.env"/u);
  assert.match(service, /Environment="CODEX_WEB_ENV_PATH=\/home\/alice\/\.config\/codex-web\/service\.env"/u);
  assert.match(service, /ExecStart="\/usr\/bin\/node" "\/home\/alice\/Codex Web\/dist\/cli\.js" "task" "run" "morning-report"/u);
  assert.match(timer, /OnCalendar=\*-\*-\* 09:30:00/u);
  assert.match(timer, /Persistent=true/u);
  assert.match(timer, /WantedBy=timers.target/u);
});

test('scheduler plan returns platform-specific files and commands', () => {
  const macPlan = createTaskSchedulerPlan({
    platform: 'darwin',
    action: 'install',
    task: createTask({ id: 'daily' }),
    codexWebArgv: ['/usr/bin/node', '/opt/codex-web/dist/cli.js'],
    envPath: '/Users/alice/.config/codex-web/service.env',
    homeDir: '/Users/alice',
  });
  assert.equal(macPlan.kind, 'launchd');
  assert.deepEqual(macPlan.files.map((file) => file.path), [
    '/Users/alice/Library/LaunchAgents/com.chenyanshan.codex-web.task.daily.plist',
  ]);
  assert.deepEqual(macPlan.commands, [
    {
      argv: ['launchctl', 'unload', '/Users/alice/Library/LaunchAgents/com.chenyanshan.codex-web.task.daily.plist'],
      allowFailure: true,
    },
    {
      argv: ['launchctl', 'load', '/Users/alice/Library/LaunchAgents/com.chenyanshan.codex-web.task.daily.plist'],
    },
  ]);

  const linuxPlan = createTaskSchedulerPlan({
    platform: 'linux',
    action: 'install',
    task: createTask({ id: 'daily' }),
    codexWebArgv: ['/usr/bin/node', '/home/alice/codex-web/dist/cli.js'],
    envPath: '/home/alice/.config/codex-web/service.env',
    homeDir: '/home/alice',
  });
  assert.equal(linuxPlan.kind, 'systemd');
  assert.deepEqual(linuxPlan.files.map((file) => file.path), [
    '/home/alice/.config/systemd/user/codex-web-task@daily.service',
    '/home/alice/.config/systemd/user/codex-web-task@daily.timer',
  ]);
  assert.deepEqual(linuxPlan.commands, [
    {
      argv: ['systemctl', '--user', 'daemon-reload'],
    },
    {
      argv: ['systemctl', '--user', 'enable', '--now', 'codex-web-task@daily.timer'],
    },
  ]);
});

test('scheduler command argv supports both source and built CLI entrypoints', () => {
  assert.deepEqual(createCodexWebCommandArgv({
    cliPath: '/workspace/packages/codex-web/src/cli.ts',
    nodePath: '/opt/homebrew/bin/node',
    tsxLoaderPath: '/workspace/node_modules/tsx/dist/loader.mjs',
  }), [
    '/opt/homebrew/bin/node',
    '--conditions=development',
    '--import',
    '/workspace/node_modules/tsx/dist/loader.mjs',
    '/workspace/packages/codex-web/src/cli.ts',
  ]);
  assert.deepEqual(createCodexWebCommandArgv({
    cliPath: '/workspace/packages/codex-web/dist/cli.js',
    nodePath: '/opt/homebrew/bin/node',
  }), [
    '/opt/homebrew/bin/node',
    '/workspace/packages/codex-web/dist/cli.js',
  ]);
});

test('scheduler command rejects a source entrypoint without an absolute tsx loader', () => {
  assert.throws(() => createCodexWebCommandArgv({
    cliPath: '/workspace/packages/codex-web/src/cli.ts',
    nodePath: '/usr/bin/node',
  }), /requires an absolute tsx loader path/u);
});

function createTask(patch: Partial<ScheduledTaskDefinition> = {}): ScheduledTaskDefinition {
  return {
    id: 'task',
    title: 'Task',
    cwd: null,
    projectId: null,
    runAsUserId: null,
    schedule: {
      kind: 'daily',
      time: '09:00',
    },
    settings: {},
    archive: {
      onCompletion: true,
    },
    prompt: 'Run task\n',
    taskDir: '/tmp/task',
    ...patch,
  };
}
