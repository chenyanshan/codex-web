import path from 'node:path';
import type {
  CodexWebRuntime,
  CodexWebSession,
  CodexWebStartTurnResult,
  CreateSessionInput,
  StartTurnInput,
} from './runtime.js';
import type { CodexWebEvent } from './event_model.js';
import { FileLockBusyError, withFileLock } from './file_lock.js';
import type { ScheduledTaskDefinition } from './task_store.js';
import type {
  CodexWebAppSession,
  CodexWebIdentityState,
} from './identity_store.js';

const TASK_LOCK_STALE_MS = 24 * 60 * 60 * 1_000;

export interface ScheduledTaskRuntimeLike {
  eventBus?: { epoch: string };
  lifecycleSignal?: AbortSignal;
  interruptTurn?(turnId: string): Promise<void>;
  createSession(input: CreateSessionInput): Promise<CodexWebSession>;
  startTurn(sessionId: string, input: StartTurnInput): Promise<CodexWebStartTurnResult>;
  archiveSession(sessionId: string): Promise<boolean>;
  getTurnEvents(turnId: string): Array<{ event: CodexWebEvent; sequence: number }>;
  subscribeToTurn(
    turnId: string,
    listener: (entry: { event: CodexWebEvent; sequence: number }) => void,
  ): () => void;
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
  signal?: AbortSignal;
  terminalTimeoutMs?: number;
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
  signal,
  terminalTimeoutMs,
}: RunScheduledTaskInput): Promise<RunScheduledTaskResult> {
  return withTaskLock(stateDir, task.id, async () => {
    signal?.throwIfAborted();
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
    const turnId = turn.turnId ?? null;
    if (turnId) {
      try { await waitForScheduledTurnTerminal(runtime, turnId, { signal, timeoutMs: terminalTimeoutMs }); }
      catch (error) {
        if (runtime.interruptTurn) {
          let timer: NodeJS.Timeout | undefined;
          try { await Promise.race([runtime.interruptTurn(turnId).catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]); }
          finally { clearTimeout(timer); }
        }
        throw error;
      }
    }
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
      turnId,
      archived,
    };
  });
}

export async function waitForScheduledTurnTerminal(
  runtime: Pick<ScheduledTaskRuntimeLike, 'getTurnEvents' | 'subscribeToTurn' | 'eventBus' | 'lifecycleSignal'>,
  turnId: string,
  { signal, timeoutMs = 6 * 60 * 60 * 1000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CodexWebEvent> {
  signal?.throwIfAborted();
  runtime.lifecycleSignal?.throwIfAborted();
  const epoch = runtime.eventBus?.epoch;
  const existing = findTerminalTurnEvent(runtime.getTurnEvents(turnId));
  if (existing) {
    return requireSuccessfulTerminalEvent(existing, turnId);
  }

  return new Promise<CodexWebEvent>((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let unsubscribeWhenReady = false;
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    let recovery: NodeJS.Timeout | undefined;
    const runtimeStopped = () => fail(new Error(`Scheduled task runtime stopped while waiting for ${turnId}`));
    const abort = () => fail(signal?.reason ?? new Error("Scheduled turn cancelled"));
    const cleanup = () => {
      clearTimeout(deadline);
      clearInterval(recovery);
      signal?.removeEventListener("abort", abort);
      runtime.lifecycleSignal?.removeEventListener("abort", runtimeStopped);
      if (unsubscribe) {
        unsubscribe();
      } else {
        unsubscribeWhenReady = true;
      }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    };
    const settle = (event: CodexWebEvent) => {
      if (settled || !isTerminalTurnEvent(event)) {
        return;
      }
      settled = true;
      cleanup();
      try {
        resolve(requireSuccessfulTerminalEvent(event, turnId));
      } catch (error) {
        reject(error);
      }
    };

    deadline = setTimeout(() => fail(new Error(`Scheduled task turn ${turnId} exceeded its terminal deadline`)), Math.max(1, timeoutMs));
    signal?.addEventListener('abort', abort, { once: true });
    runtime.lifecycleSignal?.addEventListener('abort', runtimeStopped, { once: true });
    if (runtime.lifecycleSignal?.aborted) { runtimeStopped(); return; }
    if (signal?.aborted) { abort(); return; }
    recovery = setInterval(() => {
      if (runtime.eventBus?.epoch !== epoch) { fail(new Error(`Scheduled task runtime restarted while waiting for ${turnId}`)); return; }
      try { const event = findTerminalTurnEvent(runtime.getTurnEvents(turnId)); if (event) settle(event); }
      catch (error) { fail(error); }
    }, 250);
    try {
      unsubscribe = runtime.subscribeToTurn(turnId, ({ event }) => settle(event));
      if (unsubscribeWhenReady) {
        unsubscribe();
      }
      const racedTerminal = findTerminalTurnEvent(runtime.getTurnEvents(turnId));
      if (racedTerminal) {
        settle(racedTerminal);
      }
    } catch (error) {
      fail(error);
    }
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
  const lockPath = path.join(runDir, `${taskId}.lock`);
  try {
    return await withFileLock(lockPath, callback, {
      timeoutMs: 0,
      staleMs: TASK_LOCK_STALE_MS,
    });
  } catch (error) {
    if (error instanceof FileLockBusyError) {
      throw new Error(`Scheduled task ${taskId} is already running`);
    }
    throw error;
  }
}

function findTerminalTurnEvent(
  entries: Array<{ event: CodexWebEvent }>,
): CodexWebEvent | null {
  return entries.find(({ event }) => isTerminalTurnEvent(event))?.event ?? null;
}

function isTerminalTurnEvent(event: CodexWebEvent): boolean {
  return event.type === 'turn.completed' || event.type === 'turn.failed';
}

function requireSuccessfulTerminalEvent(event: CodexWebEvent, turnId: string): CodexWebEvent {
  if (event.type !== 'turn.failed') {
    return event;
  }
  const details = event.details || event.message || 'unknown error';
  throw new Error(`Scheduled task turn ${turnId} failed: ${details}`);
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
