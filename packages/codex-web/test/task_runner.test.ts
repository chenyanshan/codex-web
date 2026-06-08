import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CodexWebSession, CodexWebStartTurnResult, CreateSessionInput, StartTurnInput } from '../src/runtime.js';
import type { ScheduledTaskDefinition } from '../src/task_store.js';
import { runScheduledTask } from '../src/task_runner.js';

test('scheduled task runner creates a session, sends the prompt, and archives by default', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-task-runner-'));
  const calls: string[] = [];
  const runtime = {
    createSession: async (input: CreateSessionInput): Promise<CodexWebSession> => {
      calls.push(`create:${input.title}:${input.cwd}:${input.settings?.model}:${input.settings?.approvalPolicy}`);
      return createSession('thread_task_1');
    },
    startTurn: async (sessionId: string, input: StartTurnInput): Promise<CodexWebStartTurnResult> => {
      calls.push(`turn:${sessionId}:${input.text}:${input.settings?.model}`);
      return { turnId: 'turn_task_1' };
    },
    archiveSession: async (sessionId: string): Promise<boolean> => {
      calls.push(`archive:${sessionId}`);
      return true;
    },
  };

  const result = await runScheduledTask({
    task: createTask({
      id: 'morning-report',
      title: 'Morning report',
      cwd: '/workspace/project',
      prompt: 'Summarize the repo.\n',
      settings: {
        model: 'gpt-5-codex',
        approvalPolicy: 'never',
      },
    }),
    runtime,
    stateDir,
    now: new Date('2026-06-08T01:00:00.000Z'),
  });

  assert.deepEqual(calls, [
    'create:Morning report - 2026-06-08 01:00:/workspace/project:gpt-5-codex:never',
    'turn:thread_task_1:Summarize the repo.\n:gpt-5-codex',
    'archive:thread_task_1',
  ]);
  assert.deepEqual(result, {
    taskId: 'morning-report',
    sessionId: 'thread_task_1',
    turnId: 'turn_task_1',
    archived: true,
  });
});

test('scheduled task runner can keep completed sessions active when configured', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-task-runner-'));
  const archived: string[] = [];
  const runtime = {
    createSession: async () => createSession('thread_keep'),
    startTurn: async () => ({ turnId: 'turn_keep' }),
    archiveSession: async (sessionId: string) => {
      archived.push(sessionId);
      return true;
    },
  };

  const result = await runScheduledTask({
    task: createTask({
      id: 'keep-active',
      archive: { onCompletion: false },
    }),
    runtime,
    stateDir,
    now: new Date('2026-06-08T01:00:00.000Z'),
  });

  assert.deepEqual(archived, []);
  assert.equal(result.archived, false);
});

test('scheduled task runner rejects overlapping runs for the same task', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-task-runner-'));
  await fs.mkdir(path.join(stateDir, 'task-runs'), { recursive: true });
  await fs.writeFile(path.join(stateDir, 'task-runs', 'locked.lock'), '12345\n');

  await assert.rejects(
    () => runScheduledTask({
      task: createTask({ id: 'locked' }),
      runtime: {
        createSession: async () => createSession('unused'),
        startTurn: async () => ({ turnId: 'unused' }),
        archiveSession: async () => true,
      },
      stateDir,
      now: new Date('2026-06-08T01:00:00.000Z'),
    }),
    /Scheduled task locked is already running/u,
  );
});

test('scheduled task runner records owner project mapping and archive state when identity store is provided', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-task-runner-'));
  const upserts: unknown[] = [];
  const createdInputs: CreateSessionInput[] = [];
  const identityStore = {
    readState: async () => ({
      settings: {
        multiUserEnabled: true,
        siteTitle: 'Codex Web',
      },
      users: [{
        id: 'user_alice',
        username: 'alice',
        enabled: true,
        canNewSession: true,
        roleIds: [],
        directProjectGrants: [],
        favoriteProjectIds: [],
      }],
      roles: [],
      projects: [{
        id: 'project_main',
        internalName: 'main',
        cwd: '/workspace/main',
        displayName: 'Main',
        enabled: true,
        activeSessionLimit: null,
      }],
      sessions: [],
      shares: [],
      userSessions: [],
    }),
    upsertSession: async (session: unknown) => {
      upserts.push(session);
      return session;
    },
  };
  const runtime = {
    createSession: async (input: CreateSessionInput): Promise<CodexWebSession> => {
      createdInputs.push(input);
      return createSession('thread_owned');
    },
    startTurn: async () => ({ turnId: 'turn_owned' }),
    archiveSession: async () => true,
  };

  await runScheduledTask({
    task: createTask({
      id: 'owned-task',
      runAsUserId: 'user_alice',
      projectId: 'project_main',
      cwd: '/ignored',
    }),
    runtime,
    identityStore,
    stateDir,
    now: new Date('2026-06-08T01:00:00.000Z'),
  });

  assert.equal(createdInputs[0]?.cwd, '/workspace/main');
  assert.equal(upserts.length, 2);
  assert.deepEqual(upserts[0], {
    id: 'scheduled-owned-task-thread_owned',
    codexThreadId: 'thread_owned',
    projectId: 'project_main',
    ownerUserId: 'user_alice',
    createdAt: '2026-06-08T01:00:00.000Z',
    updatedAt: '2026-06-08T01:00:00.000Z',
    archived: false,
    archivedAt: null,
    archivedByUserId: null,
    archiveSource: null,
  });
  assert.deepEqual(upserts[1], {
    id: 'scheduled-owned-task-thread_owned',
    codexThreadId: 'thread_owned',
    projectId: 'project_main',
    ownerUserId: 'user_alice',
    createdAt: '2026-06-08T01:00:00.000Z',
    updatedAt: '2026-06-08T01:00:00.000Z',
    archived: true,
    archivedAt: '2026-06-08T01:00:00.000Z',
    archivedByUserId: 'user_alice',
    archiveSource: 'codex',
  });
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

function createSession(id: string): CodexWebSession {
  return {
    id,
    cwd: '/workspace',
    projectName: 'workspace',
    title: 'Task',
    updatedAt: 1,
    preview: null,
    firstUserInput: null,
    lastUserInput: null,
    lastInputAt: null,
    favorite: false,
    favoriteOrder: null,
    goal: null,
    activeTurnId: null,
    settings: {
      bridgeSessionId: id,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      collaborationMode: 'default',
      personality: 'pragmatic',
      accessPreset: 'default',
      approvalPolicy: null,
      sandboxMode: null,
      locale: null,
      metadata: {},
      updatedAt: 1,
    },
    thread: {
      threadId: id,
      cwd: '/workspace',
      title: 'Task',
      updatedAt: 1,
      preview: null,
      turns: [],
    },
    timeline: [],
  };
}
