import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ProviderApprovalRequest,
  ProviderThreadGoal,
  ProviderThreadSummary,
  ProviderTurnResult,
} from '../../codex-native-api/src/index.js';
import { CodexWebRuntime, type CodexWebRuntimeClient } from '../src/runtime.js';

function createThread(
  threadId: string,
  overrides: Partial<ProviderThreadSummary> = {},
): ProviderThreadSummary {
  return {
    threadId,
    cwd: '/workspace',
    title: 'Thread',
    turns: [],
    ...overrides,
  };
}

function createClient(overrides: Partial<CodexWebRuntimeClient> = {}): CodexWebRuntimeClient {
  return {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_new', cwd: '/workspace', title: 'Thread' }),
    readThread: async (threadId) => createThread(threadId),
    writeConfigValue: async () => {},
    startTurn: async ({ threadId, onTurnStarted }) => {
      await onTurnStarted?.({ threadId, turnId: 'turn_default' });
      return { threadId, turnId: 'turn_default', status: 'completed', outputText: 'done' };
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
    ...overrides,
  };
}

function createRuntime(
  client: CodexWebRuntimeClient,
  options: {
    graceMs?: number;
    unsubscribeRetryDelaysMs?: readonly number[];
    closingRetryDelaysMs?: readonly number[];
  } = {},
): CodexWebRuntime {
  return new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    threadSubscriptionGraceMs: options.graceMs ?? 0,
    threadUnsubscribeRetryDelaysMs: options.unsubscribeRetryDelaysMs ?? [],
    threadClosingRetryDelaysMs: options.closingRetryDelaysMs ?? [],
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for runtime subscription state');
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test('runtime releases subscriptions created by empty sessions and cold history reads', async () => {
  const unsubscribed: string[] = [];
  let coldReadCount = 0;
  const client = createClient({
    readThread: async (threadId) => {
      if (threadId !== 'thread_cold') {
        return createThread(threadId);
      }
      coldReadCount += 1;
      return coldReadCount === 1 ? null : createThread(threadId);
    },
    resumeThread: async () => ({}),
    unsubscribeThread: async (threadId) => {
      unsubscribed.push(threadId);
      return 'unsubscribed';
    },
  });
  const runtime = createRuntime(client);

  const created = await runtime.createSession();
  assert.equal(created.id, 'thread_new');
  await waitUntil(() => unsubscribed.includes('thread_new'));

  const cold = await runtime.readSessionStatus('thread_cold');
  assert.equal(cold?.id, 'thread_cold');
  await waitUntil(() => unsubscribed.includes('thread_cold'));
  assert.deepEqual(unsubscribed.sort(), ['thread_cold', 'thread_new']);
  await runtime.stop();
});

test('runtime keeps active turns subscribed and invalidates an older release timer', async () => {
  const unsubscribed: string[] = [];
  const pending: Array<(result: ProviderTurnResult) => void> = [];
  let turnSequence = 0;
  const client = createClient({
    resumeThread: async () => ({}),
    startTurn: async ({ threadId, onTurnStarted }) => {
      const turnId = `turn_${++turnSequence}`;
      await onTurnStarted?.({ threadId, turnId });
      return new Promise<ProviderTurnResult>((resolve) => pending.push(resolve));
    },
    unsubscribeThread: async (threadId) => {
      unsubscribed.push(threadId);
      return 'unsubscribed';
    },
  });
  const runtime = createRuntime(client, { graceMs: 20 });

  await runtime.startTurn('thread_active', { text: 'first' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(unsubscribed, []);

  pending.shift()?.({
    threadId: 'thread_active',
    turnId: 'turn_1',
    status: 'completed',
    outputText: 'first done',
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await runtime.startTurn('thread_active', { text: 'second' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(unsubscribed, []);

  pending.shift()?.({
    threadId: 'thread_active',
    turnId: 'turn_2',
    status: 'completed',
    outputText: 'second done',
  });
  await waitUntil(() => unsubscribed.length === 1);
  assert.deepEqual(unsubscribed, ['thread_active']);
  await runtime.stop();
});

test('runtime holds the subscription while turn start acknowledgement is delayed', async () => {
  const unsubscribed: string[] = [];
  let acknowledgeTurn: (() => Promise<void>) | null = null;
  const client = createClient({
    resumeThread: async () => ({}),
    startTurn: async ({ threadId, onTurnStarted }) => new Promise<ProviderTurnResult>((resolve) => {
      acknowledgeTurn = async () => {
        await onTurnStarted?.({ threadId, turnId: 'turn_slow_start' });
        resolve({
          threadId,
          turnId: 'turn_slow_start',
          status: 'completed',
          outputText: 'done',
        });
      };
    }),
    unsubscribeThread: async (threadId) => {
      unsubscribed.push(threadId);
      return 'unsubscribed';
    },
  });
  const runtime = createRuntime(client, { graceMs: 5 });

  const starting = runtime.startTurn('thread_slow_start', { text: 'start slowly' });
  await waitUntil(() => acknowledgeTurn !== null);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(unsubscribed, []);

  await acknowledgeTurn?.();
  assert.equal((await starting).turnId, 'turn_slow_start');
  await waitUntil(() => unsubscribed.length === 1);
  assert.deepEqual(unsubscribed, ['thread_slow_start']);
  await runtime.stop();
});

test('runtime waits for pending approval resolution before unsubscribing', async () => {
  const unsubscribed: string[] = [];
  const approval: ProviderApprovalRequest = {
    requestId: 'approval_waiting',
    kind: 'command',
    threadId: 'thread_approval',
    turnId: 'turn_approval',
    itemId: 'item_approval',
    availableDecisionKeys: ['accept', 'decline'],
  };
  const client = createClient({
    resumeThread: async () => ({}),
    startTurn: async ({ threadId, onTurnStarted, onApprovalRequest }) => {
      await onTurnStarted?.({ threadId, turnId: 'turn_approval' });
      await onApprovalRequest?.(approval);
      return {
        threadId,
        turnId: 'turn_approval',
        status: 'completed',
        outputText: 'waiting for approval',
      };
    },
    unsubscribeThread: async (threadId) => {
      unsubscribed.push(threadId);
      return 'unsubscribed';
    },
  });
  const runtime = createRuntime(client);

  await runtime.startTurn('thread_approval', { text: 'approve this' });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(unsubscribed, []);

  await runtime.resolveApproval('approval_waiting', 'accept');
  await waitUntil(() => unsubscribed.length === 1);
  assert.deepEqual(unsubscribed, ['thread_approval']);
  await runtime.stop();
});

test('runtime keeps active goals subscribed until the goal becomes terminal', async () => {
  const unsubscribed: string[] = [];
  let goal: ProviderThreadGoal = {
    threadId: 'thread_goal',
    objective: 'Finish the task',
    status: 'active',
  };
  const client = createClient({
    startThread: async () => ({ threadId: 'thread_goal', cwd: '/workspace', title: 'Thread' }),
    getThreadGoal: async () => goal,
    unsubscribeThread: async (threadId) => {
      unsubscribed.push(threadId);
      return 'unsubscribed';
    },
  });
  const runtime = createRuntime(client, { graceMs: 5 });

  await runtime.createSession();
  await runtime.readSession('thread_goal');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(unsubscribed, []);

  goal = { ...goal, status: 'complete' };
  await runtime.readSession('thread_goal');
  await waitUntil(() => unsubscribed.length === 1);
  assert.deepEqual(unsubscribed, ['thread_goal']);
  await runtime.stop();
});

test('runtime releases a recovered active turn only after its terminal result', async () => {
  const unsubscribed: string[] = [];
  let readCount = 0;
  let finishRecoveredTurn: ((result: ProviderTurnResult) => void) | null = null;
  const activeThread = createThread('thread_recovered', {
    runtimeStatus: { type: 'active', activeFlags: [] },
    turns: [{ id: 'turn_recovered', status: 'inProgress', error: null, items: [] }],
  });
  const client = createClient({
    readThread: async () => (++readCount === 1 ? null : activeThread),
    resumeThread: async () => ({}),
    waitForTurnResult: async () => new Promise<ProviderTurnResult>((resolve) => {
      finishRecoveredTurn = resolve;
    }),
    unsubscribeThread: async (threadId) => {
      unsubscribed.push(threadId);
      return 'unsubscribed';
    },
  });
  const runtime = createRuntime(client);

  const session = await runtime.readSession('thread_recovered');
  assert.equal(session?.activeTurnId, 'turn_recovered');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(unsubscribed, []);

  finishRecoveredTurn?.({
    threadId: 'thread_recovered',
    turnId: 'turn_recovered',
    status: 'completed',
    outputText: 'recovered',
  });
  await waitUntil(() => unsubscribed.length === 1);
  assert.deepEqual(unsubscribed, ['thread_recovered']);
  await runtime.stop();
});

test('runtime retries unsubscribe failures without changing the completed operation', async () => {
  let attempts = 0;
  const warnings: string[] = [];
  const client = createClient({
    unsubscribeThread: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('temporary disconnect');
      }
      return 'notSubscribed';
    },
  });
  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    logger: { warn: (message) => warnings.push(message) },
    threadSubscriptionGraceMs: 0,
    threadUnsubscribeRetryDelaysMs: [0],
  });

  const session = await runtime.createSession();
  assert.equal(session.id, 'thread_new');
  await waitUntil(() => attempts === 2);
  assert.equal(warnings.some((message) => message.includes('thread_unsubscribe_failed')), true);
  await runtime.stop();
});

test('runtime retries a resume while the app-server is unloading the thread', async () => {
  let resumeAttempts = 0;
  const client = createClient({
    resumeThread: async () => {
      resumeAttempts += 1;
      if (resumeAttempts === 1) {
        throw new Error('thread thread_closing is closing; retry after the thread is closed');
      }
      return {};
    },
  });
  const runtime = createRuntime(client, { closingRetryDelaysMs: [0] });

  const result = await runtime.startTurn('thread_closing', { text: 'continue' });
  assert.equal(result.turnId, 'turn_default');
  assert.equal(resumeAttempts, 2);
  await runtime.stop();
});

test('runtime stop cancels subscription timers before stopping its own client', async () => {
  let stopped = false;
  const unsubscribed: string[] = [];
  const client = createClient({
    stop: async () => {
      stopped = true;
    },
    unsubscribeThread: async (threadId) => {
      unsubscribed.push(threadId);
      return 'unsubscribed';
    },
  });
  const runtime = createRuntime(client, { graceMs: 30 });

  await runtime.createSession();
  await runtime.stop();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(stopped, true);
  assert.deepEqual(unsubscribed, []);
});
