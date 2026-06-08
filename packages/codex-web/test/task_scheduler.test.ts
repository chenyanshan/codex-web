import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScheduledTaskDefinition } from '../src/task_store.js';
import {
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
    codexWebBin: '/usr/local/bin/codex-web',
    envPath: '/Users/alice/.config/codex-web/service.env',
  });

  assert.match(plist, /<key>Label<\/key>\s*<string>com\.chenyanshan\.codex-web\.task\.morning-report<\/string>/u);
  assert.match(plist, /<string>\/usr\/local\/bin\/codex-web<\/string>/u);
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
    codexWebBin: '/home/alice/.local/bin/codex-web',
    envPath: '/home/alice/.config/codex-web/service.env',
  });
  const timer = renderSystemdTaskTimer({ task });

  assert.match(service, /^\[Unit\]\nDescription=Codex Web scheduled task morning-report/mu);
  assert.match(service, /EnvironmentFile=-\/home\/alice\/.config\/codex-web\/service.env/u);
  assert.match(service, /ExecStart=\/home\/alice\/.local\/bin\/codex-web task run morning-report/u);
  assert.match(timer, /OnCalendar=\*-\*-\* 09:30:00/u);
  assert.match(timer, /Persistent=true/u);
  assert.match(timer, /WantedBy=timers.target/u);
});

test('scheduler plan returns platform-specific files and commands', () => {
  const macPlan = createTaskSchedulerPlan({
    platform: 'darwin',
    action: 'install',
    task: createTask({ id: 'daily' }),
    codexWebBin: '/opt/codex-web/bin/codex-web',
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
    codexWebBin: '/home/alice/.local/bin/codex-web',
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
