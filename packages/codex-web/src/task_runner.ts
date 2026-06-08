import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CodexWebRuntime,
  CodexWebSession,
  CodexWebStartTurnResult,
  CreateSessionInput,
  StartTurnInput,
} from './runtime.js';
import type { ScheduledTaskDefinition } from './task_store.js';
import type {
  CodexWebAppSession,
  CodexWebIdentityState,
} from './identity_store.js';

export interface ScheduledTaskRuntimeLike {
  createSession(input: CreateSessionInput): Promise<CodexWebSession>;
  startTurn(sessionId: string, input: StartTurnInput): Promise<CodexWebStartTurnResult>;
  archiveSession(sessionId: string): Promise<boolean>;
}

export interface ScheduledTaskIdentityStoreLike {
  readState(): Promise<CodexWebIdentityState>;
  upsertSession(session: CodexWebAppSession): Promise<CodexWebAppSession>;
}

export interface RunScheduledTaskInput {
  task: ScheduledTaskDefinition;
  runtime: ScheduledTaskRuntimeLike | CodexWebRuntime;
  identityStore?: ScheduledTaskIdentityStoreLike | null;
  stateDir: string;
  now?: Date;
}

export interface RunScheduledTaskResult {
  taskId: string;
  sessionId: string;
  turnId: string | null;
  archived: boolean;
}

export async function runScheduledTask({
  task,
  runtime,
  identityStore = null,
  stateDir,
  now = new Date(),
}: RunScheduledTaskInput): Promise<RunScheduledTaskResult> {
  return withTaskLock(stateDir, task.id, async () => {
    const resolvedIdentityStore = identityStore ?? null;
    const ownership = resolvedIdentityStore
      ? await resolveScheduledTaskOwnership(task, resolvedIdentityStore)
      : null;
    const title = createScheduledSessionTitle(task.title, now);
    const session = await runtime.createSession({
      cwd: ownership?.cwd ?? task.cwd,
      title,
      settings: task.settings,
    });
    const appSession = ownership
      ? await recordScheduledAppSession({
        identityStore: resolvedIdentityStore!,
        task,
        sessionId: session.id,
        ownership,
        now,
        archived: false,
      })
      : null;
    const turn = await runtime.startTurn(session.id, {
      text: task.prompt,
      settings: task.settings,
    });
    const archived = task.archive.onCompletion
      ? await runtime.archiveSession(session.id)
      : false;
    if (archived && appSession && ownership) {
      await recordScheduledAppSession({
        identityStore: resolvedIdentityStore!,
        task,
        sessionId: session.id,
        ownership,
        now,
        archived: true,
      });
    }
    return {
      taskId: task.id,
      sessionId: session.id,
      turnId: 'turnId' in turn ? turn.turnId : null,
      archived,
    };
  });
}

export function createScheduledSessionTitle(title: string, now: Date): string {
  return `${title} - ${formatUtcMinute(now)}`;
}

async function withTaskLock<T>(
  stateDir: string,
  taskId: string,
  callback: () => Promise<T>,
): Promise<T> {
  const runDir = path.join(stateDir, 'task-runs');
  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(runDir, `${taskId}.lock`);
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Scheduled task ${taskId} is already running`);
    }
    throw error;
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    await handle.close();
    handle = null;
    return await callback();
  } finally {
    if (handle) {
      await handle.close();
    }
    await fs.rm(lockPath, { force: true });
  }
}

function formatUtcMinute(date: Date): string {
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hour = pad2(date.getUTCHours());
  const minute = pad2(date.getUTCMinutes());
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

async function resolveScheduledTaskOwnership(
  task: ScheduledTaskDefinition,
  identityStore: ScheduledTaskIdentityStoreLike,
): Promise<{ ownerUserId: string; projectId: string; cwd: string } | null> {
  if (!task.runAsUserId && !task.projectId) {
    return null;
  }
  if (!task.runAsUserId || !task.projectId) {
    throw new Error('Scheduled tasks with identity metadata require both runAsUserId and projectId');
  }
  const state = await identityStore.readState();
  const user = state.users.find((item) => item.id === task.runAsUserId && item.enabled !== false);
  if (!user) {
    throw new Error(`Unknown scheduled task user: ${task.runAsUserId}`);
  }
  const project = state.projects.find((item) => item.id === task.projectId && item.enabled !== false);
  if (!project) {
    throw new Error(`Unknown scheduled task project: ${task.projectId}`);
  }
  return {
    ownerUserId: user.id,
    projectId: project.id,
    cwd: project.cwd,
  };
}

async function recordScheduledAppSession({
  identityStore,
  task,
  sessionId,
  ownership,
  now,
  archived,
}: {
  identityStore: ScheduledTaskIdentityStoreLike;
  task: ScheduledTaskDefinition;
  sessionId: string;
  ownership: { ownerUserId: string; projectId: string };
  now: Date;
  archived: boolean;
}): Promise<CodexWebAppSession> {
  const timestamp = now.toISOString();
  return identityStore.upsertSession({
    id: scheduledAppSessionId(task.id, sessionId),
    codexThreadId: sessionId,
    projectId: ownership.projectId,
    ownerUserId: ownership.ownerUserId,
    createdAt: timestamp,
    updatedAt: timestamp,
    archived,
    archivedAt: archived ? timestamp : null,
    archivedByUserId: archived ? ownership.ownerUserId : null,
    archiveSource: archived ? 'codex' : null,
  });
}

function scheduledAppSessionId(taskId: string, sessionId: string): string {
  return `scheduled-${taskId}-${sessionId}`;
}
