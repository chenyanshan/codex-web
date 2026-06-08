import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FileScheduledTaskStore,
  isValidScheduledTaskId,
} from '../src/task_store.js';

test('task store loads task metadata and prompt with safe defaults', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-task-store-'));
  await fs.mkdir(path.join(stateDir, 'tasks', 'morning-report'), { recursive: true });
  await fs.writeFile(path.join(stateDir, 'tasks', 'morning-report', 'prompt.md'), 'Summarize the repo.\n');
  await fs.writeFile(path.join(stateDir, 'tasks', 'morning-report', 'task.json'), JSON.stringify({
    title: 'Morning report',
    cwd: '/workspace/project',
    schedule: {
      kind: 'daily',
      time: '09:00',
    },
    settings: {
      model: 'gpt-5-codex',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    },
  }, null, 2));

  const store = new FileScheduledTaskStore({ stateDir });
  const task = await store.readTask('morning-report');

  assert.deepEqual(task, {
    id: 'morning-report',
    title: 'Morning report',
    cwd: '/workspace/project',
    projectId: null,
    runAsUserId: null,
    schedule: {
      kind: 'daily',
      time: '09:00',
    },
    settings: {
      model: 'gpt-5-codex',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    },
    archive: {
      onCompletion: true,
    },
    prompt: 'Summarize the repo.\n',
    taskDir: path.join(stateDir, 'tasks', 'morning-report'),
  });
});

test('task store rejects unsafe task ids before reading files', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-task-store-'));
  const store = new FileScheduledTaskStore({ stateDir });

  assert.equal(isValidScheduledTaskId('daily_9am-report'), true);
  assert.equal(isValidScheduledTaskId('../secret'), false);
  assert.equal(isValidScheduledTaskId('bad/id'), false);
  await assert.rejects(
    () => store.readTask('../secret'),
    /Invalid scheduled task id/u,
  );
});

test('task store validates daily schedule and non-empty prompt', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-task-store-'));
  await fs.mkdir(path.join(stateDir, 'tasks', 'bad-time'), { recursive: true });
  await fs.writeFile(path.join(stateDir, 'tasks', 'bad-time', 'prompt.md'), 'Do work\n');
  await fs.writeFile(path.join(stateDir, 'tasks', 'bad-time', 'task.json'), JSON.stringify({
    schedule: {
      kind: 'daily',
      time: '24:99',
    },
  }));

  const store = new FileScheduledTaskStore({ stateDir });
  await assert.rejects(
    () => store.readTask('bad-time'),
    /schedule.time must use HH:mm/u,
  );

  await fs.mkdir(path.join(stateDir, 'tasks', 'empty-prompt'), { recursive: true });
  await fs.writeFile(path.join(stateDir, 'tasks', 'empty-prompt', 'prompt.md'), '   \n');
  await fs.writeFile(path.join(stateDir, 'tasks', 'empty-prompt', 'task.json'), JSON.stringify({
    schedule: {
      kind: 'daily',
      time: '08:30',
    },
  }));

  await assert.rejects(
    () => store.readTask('empty-prompt'),
    /prompt.md must contain non-empty text/u,
  );
});
