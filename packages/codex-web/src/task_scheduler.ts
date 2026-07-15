import path from 'node:path';
import type { ScheduledTaskDefinition } from './task_store.js';

export type TaskSchedulerPlatform = 'darwin' | 'linux';
export type TaskSchedulerAction = 'install' | 'uninstall' | 'status';
export type TaskSchedulerKind = 'launchd' | 'systemd';

export interface SchedulerFile {
  path: string;
  content: string;
  mode?: number;
}

export interface SchedulerCommand {
  argv: string[];
  allowFailure?: boolean;
}

export interface TaskSchedulerPlan {
  kind: TaskSchedulerKind;
  files: SchedulerFile[];
  commands: SchedulerCommand[];
}

export interface SchedulerRenderInput {
  task: ScheduledTaskDefinition;
  codexWebArgv: string[];
  envPath: string;
}

export interface CreateTaskSchedulerPlanInput extends SchedulerRenderInput {
  platform: NodeJS.Platform | TaskSchedulerPlatform;
  action: TaskSchedulerAction;
  homeDir: string;
}

export function createTaskSchedulerPlan(input: CreateTaskSchedulerPlanInput): TaskSchedulerPlan {
  if (input.platform === 'darwin') {
    return createLaunchdPlan(input);
  }
  if (input.platform === 'linux') {
    return createSystemdPlan(input);
  }
  throw new Error(`Scheduled task install is not supported on ${input.platform}`);
}

export function createCodexWebCommandArgv({
  cliPath,
  nodePath,
  tsxLoaderPath = null,
}: {
  cliPath: string;
  nodePath: string;
  tsxLoaderPath?: string | null;
}): string[] {
  if (!path.isAbsolute(cliPath) || !path.isAbsolute(nodePath)) {
    throw new Error('Scheduled task command paths must be absolute');
  }
  if (/\.tsx?$/u.test(cliPath)) {
    if (!tsxLoaderPath || !path.isAbsolute(tsxLoaderPath)) {
      throw new Error('A source Codex Web CLI requires an absolute tsx loader path');
    }
    return [
      nodePath,
      '--conditions=development',
      '--import',
      tsxLoaderPath,
      cliPath,
    ];
  }
  return [nodePath, cliPath];
}

export function renderLaunchdTaskPlist({ task, codexWebArgv, envPath }: SchedulerRenderInput): string {
  const { hour, minute } = parseDailyTime(task.schedule.time);
  const label = launchdTaskLabel(task.id);
  const taskArgv = appendTaskRunArgs(codexWebArgv, task.id);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${escapeXml(label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...taskArgv.map((arg) => `    <string>${escapeXml(arg)}</string>`),
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>CODEX_WEB_ENV_PATH</key>',
    `    <string>${escapeXml(envPath)}</string>`,
    '  </dict>',
    '  <key>StartCalendarInterval</key>',
    '  <dict>',
    '    <key>Hour</key>',
    `    <integer>${hour}</integer>`,
    '    <key>Minute</key>',
    `    <integer>${minute}</integer>`,
    '  </dict>',
    '  <key>StandardOutPath</key>',
    `  <string>${escapeXml(path.join(path.dirname(envPath), '..', '..', '.codex-web', 'logs', `${label}.out.log`))}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${escapeXml(path.join(path.dirname(envPath), '..', '..', '.codex-web', 'logs', `${label}.err.log`))}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function renderSystemdTaskService({ task, codexWebArgv, envPath }: SchedulerRenderInput): string {
  const taskArgv = appendTaskRunArgs(codexWebArgv, task.id);
  return [
    '[Unit]',
    `Description=Codex Web scheduled task ${task.id}`,
    '',
    '[Service]',
    'Type=oneshot',
    `EnvironmentFile=${systemdQuoteArg(`-${envPath}`)}`,
    `Environment=${systemdQuoteArg(`CODEX_WEB_ENV_PATH=${envPath}`)}`,
    `ExecStart=${taskArgv.map(systemdQuoteArg).join(' ')}`,
    '',
  ].join('\n');
}

export function renderSystemdTaskTimer({ task }: { task: ScheduledTaskDefinition }): string {
  return [
    '[Unit]',
    `Description=Codex Web scheduled task timer ${task.id}`,
    '',
    '[Timer]',
    `OnCalendar=*-*-* ${task.schedule.time}:00`,
    'Persistent=true',
    `Unit=codex-web-task@${systemdUnitInstance(task.id)}.service`,
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
}

export function launchdTaskLabel(taskId: string): string {
  return `com.chenyanshan.codex-web.task.${taskId}`;
}

function createLaunchdPlan(input: CreateTaskSchedulerPlanInput): TaskSchedulerPlan {
  const plistPath = path.join(input.homeDir, 'Library', 'LaunchAgents', `${launchdTaskLabel(input.task.id)}.plist`);
  if (input.action === 'install') {
    return {
      kind: 'launchd',
      files: [{
        path: plistPath,
        content: renderLaunchdTaskPlist(input),
        mode: 0o644,
      }],
      commands: [
        {
          argv: ['launchctl', 'unload', plistPath],
          allowFailure: true,
        },
        {
          argv: ['launchctl', 'load', plistPath],
        },
      ],
    };
  }
  if (input.action === 'uninstall') {
    return {
      kind: 'launchd',
      files: [],
      commands: [
        {
          argv: ['launchctl', 'unload', plistPath],
          allowFailure: true,
        },
        {
          argv: ['rm', '-f', plistPath],
        },
      ],
    };
  }
  return {
    kind: 'launchd',
    files: [],
    commands: [
      {
        argv: ['launchctl', 'list', launchdTaskLabel(input.task.id)],
      },
    ],
  };
}

function createSystemdPlan(input: CreateTaskSchedulerPlanInput): TaskSchedulerPlan {
  const userDir = path.join(input.homeDir, '.config', 'systemd', 'user');
  const servicePath = path.join(userDir, `codex-web-task@${input.task.id}.service`);
  const timerPath = path.join(userDir, `codex-web-task@${input.task.id}.timer`);
  const timerName = `codex-web-task@${systemdUnitInstance(input.task.id)}.timer`;
  if (input.action === 'install') {
    return {
      kind: 'systemd',
      files: [
        {
          path: servicePath,
          content: renderSystemdTaskService(input),
          mode: 0o644,
        },
        {
          path: timerPath,
          content: renderSystemdTaskTimer({ task: input.task }),
          mode: 0o644,
        },
      ],
      commands: [
        {
          argv: ['systemctl', '--user', 'daemon-reload'],
        },
        {
          argv: ['systemctl', '--user', 'enable', '--now', timerName],
        },
      ],
    };
  }
  if (input.action === 'uninstall') {
    return {
      kind: 'systemd',
      files: [],
      commands: [
        {
          argv: ['systemctl', '--user', 'disable', '--now', timerName],
          allowFailure: true,
        },
        {
          argv: ['rm', '-f', servicePath, timerPath],
        },
        {
          argv: ['systemctl', '--user', 'daemon-reload'],
        },
      ],
    };
  }
  return {
    kind: 'systemd',
    files: [],
    commands: [
      {
        argv: ['systemctl', '--user', 'status', timerName],
      },
    ],
  };
}

function parseDailyTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map((part) => Number(part));
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function systemdUnitInstance(taskId: string): string {
  return taskId.replace(/%/gu, '%%');
}

function appendTaskRunArgs(codexWebArgv: string[], taskId: string): string[] {
  if (codexWebArgv.length === 0 || codexWebArgv.some((arg) => !arg)) {
    throw new Error('Scheduled task command argv cannot be empty');
  }
  if (!path.isAbsolute(codexWebArgv[0]!)) {
    throw new Error('Scheduled task executable path must be absolute');
  }
  return [...codexWebArgv, 'task', 'run', taskId];
}

function systemdQuoteArg(value: string): string {
  return `"${value
    .replace(/%/gu, '%%')
    .replace(/\\/gu, '\\\\')
    .replace(/"/gu, '\\"')}"`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}
