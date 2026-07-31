import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CodexAppClient,
  type ProviderApprovalRequest,
  type ProviderTurnProgress,
  type ProviderTurnWorkEvent,
} from '../src/index.js';

test('app client steers input into the expected active turn', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  client.request = async (method: string, params: Record<string, unknown>, options) => {
    assert.equal(method, 'turn/steer');
    assert.deepEqual(params, {
      threadId: 'thread_steer',
      expectedTurnId: 'turn_active',
      input: [
        {
          type: 'text',
          text: 'Use the new requirement.',
          text_elements: [],
        },
        {
          type: 'localImage',
          path: '/tmp/reference.png',
        },
      ],
      clientUserMessageId: 'message_external_1',
    });
    assert.deepEqual(options, { timeoutMs: 15_000 });
    return { turnId: 'turn_active' };
  };

  const result = await client.steerTurn({
    threadId: 'thread_steer',
    expectedTurnId: 'turn_active',
    input: [
      {
        type: 'text',
        text: 'Use the new requirement.',
        text_elements: [],
      },
      {
        type: 'localImage',
        path: '/tmp/reference.png',
      },
    ],
    clientUserMessageId: 'message_external_1',
  });

  assert.deepEqual(result, { turnId: 'turn_active' });
});

test('app client omits an unspecified steer message id and requires a response turn id', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  client.request = async (method: string, params: Record<string, unknown>) => {
    assert.equal(method, 'turn/steer');
    assert.equal(Object.hasOwn(params, 'clientUserMessageId'), false);
    return {};
  };

  await assert.rejects(client.steerTurn({
    threadId: 'thread_steer',
    expectedTurnId: 'turn_active',
    input: [{
      type: 'text',
      text: 'Continue.',
      text_elements: [],
    }],
  }), /Codex turn\/steer returned no turn id/);
});

test('app client preserves structured active-turn-not-steerable JSON-RPC errors', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  const rejected = new Promise<never>((_resolve, reject) => {
    (client as any).pending.set('steer-error', { resolve: () => {}, reject });
  });

  client.handleMessage(JSON.stringify({
    id: 'steer-error',
    error: {
      code: -32_000,
      message: 'cannot steer a review turn',
      data: {
        codexErrorInfo: {
          activeTurnNotSteerable: { turnKind: 'review' },
        },
      },
    },
  }));

  await assert.rejects(rejected, (error: any) => {
    assert.equal(error.code, 'active_turn_not_steerable');
    assert.equal(error.rpcCode, -32_000);
    assert.equal(error.data.codexErrorInfo.activeTurnNotSteerable.turnKind, 'review');
    return true;
  });
});

test('app client sends persisted permission settings when resuming a thread', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  client.request = async (method: string, params: Record<string, unknown>) => {
    assert.equal(method, 'thread/resume');
    assert.equal(params.approvalPolicy, 'never');
    assert.equal(params.sandbox, 'danger-full-access');
    assert.equal(Object.hasOwn(params, 'sandboxPolicy'), false);
    return {};
  };

  await client.resumeThread({
    threadId: 'thread_full_access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  });
});

test('app client projects runtime environment into new and resumed thread shell policies', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  const calls: Array<{ method: string; config: unknown }> = [];
  client.request = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, config: params.config });
    return method === 'thread/start'
      ? { thread: { id: 'thread_first_turn' }, cwd: '/workspace' }
      : {};
  };

  await client.startThread({
    cwd: '/workspace',
    runtimeEnv: { CODEX_WEB_CONTEXT_FILE: '/runtime/contexts/first-turn.json' },
  });
  await client.resumeThread({
    threadId: 'thread_alice',
    runtimeEnv: { CODEX_WEB_CONTEXT_FILE: '/runtime/contexts/app-alice.json' },
  });
  await client.resumeThread({
    threadId: 'thread_new',
    runtimeEnv: { CODEX_WEB_CONTEXT_FILE: null },
  });

  assert.deepEqual(calls, [
    {
      method: 'thread/start',
      config: {
        shell_environment_policy: {
          filters: { CODEX_WEB_CONTEXT_FILE: 'exclude' },
          set: { CODEX_WEB_CONTEXT_FILE: '/runtime/contexts/first-turn.json' },
        },
      },
    },
    {
      method: 'thread/resume',
      config: {
        shell_environment_policy: {
          filters: { CODEX_WEB_CONTEXT_FILE: 'exclude' },
          set: { CODEX_WEB_CONTEXT_FILE: '/runtime/contexts/app-alice.json' },
        },
      },
    },
    {
      method: 'thread/resume',
      config: {
        shell_environment_policy: {
          filters: { CODEX_WEB_CONTEXT_FILE: 'exclude' },
          set: {},
        },
      },
    },
  ]);
});

test('app client replays pending approvals and stops delivery after unsubscribe', () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  client.handleMessage(JSON.stringify({
    jsonrpc: '2.0',
    id: 41,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 'thread_replay',
      turnId: 'turn_replay',
      itemId: 'item_replay',
      command: 'npm test',
      cwd: '/workspace',
      reason: 'Run tests',
      availableDecisions: ['accept', 'decline'],
    },
  }));
  const received: ProviderApprovalRequest[] = [];

  const unsubscribe = client.subscribeToApprovalRequests((request) => {
    received.push(request);
  }, { replayPending: true });

  assert.deepEqual(received.map((request) => request.requestId), ['41']);
  unsubscribe();
  client.emit('approval_request', {
    ...received[0],
    requestId: '42',
  });
  assert.deepEqual(received.map((request) => request.requestId), ['41']);
});

test('app client registers approval listeners before reading the pending snapshot', () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  const liveRequest: ProviderApprovalRequest = {
    requestId: 'live',
    kind: 'command',
    threadId: 'thread_live',
    turnId: 'turn_live',
    itemId: 'item_live',
    reason: null,
  };
  const replayedRequest: ProviderApprovalRequest = {
    requestId: 'replayed',
    kind: 'file_change',
    threadId: 'thread_replayed',
    turnId: 'turn_replayed',
    itemId: 'item_replayed',
    reason: null,
  };
  client.getPendingApprovals = () => {
    client.emit('approval_request', liveRequest);
    return [replayedRequest];
  };
  const received: ProviderApprovalRequest[] = [];

  client.subscribeToApprovalRequests((request) => {
    received.push(request);
  }, { replayPending: true });

  assert.deepEqual(received.map((request) => request.requestId), ['live', 'replayed']);
});

test('app client maps thread runtime status and turn timestamps', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  client.request = async (method: string) => {
    if (method === 'thread/list') {
      return {
        data: [{
          id: 'thread_active',
          name: 'Active thread',
          cwd: '/workspace',
          updatedAt: 1_784_117_000,
          status: {
            type: 'active',
            activeFlags: ['waitingOnApproval', 'waitingOnUserInput'],
          },
        }],
        nextCursor: null,
      };
    }
    assert.equal(method, 'thread/read');
    return {
      thread: {
        id: 'thread_idle',
        name: 'Idle thread',
        cwd: '/workspace',
        updatedAt: 1_784_117_100,
        status: { type: 'idle' },
        turns: [{
          id: 'turn_completed',
          status: 'completed',
          error: null,
          items: [],
          startedAt: 1_784_117_001,
          completedAt: 1_784_117_099,
        }, {
          id: 'turn_running',
          status: 'inProgress',
          error: null,
          items: [],
          startedAt: 1_784_117_100,
          completedAt: null,
        }],
      },
    };
  };

  const listed = await client.listThreads();
  const read = await client.readThread('thread_idle', true);

  assert.deepEqual(listed.items[0]?.runtimeStatus, {
    type: 'active',
    activeFlags: ['waitingOnApproval', 'waitingOnUserInput'],
  });
  assert.deepEqual(read?.runtimeStatus, { type: 'idle', activeFlags: [] });
  assert.equal(read?.turns?.[0]?.startedAt, 1_784_117_001_000);
  assert.equal(read?.turns?.[0]?.completedAt, 1_784_117_099_000);
  assert.equal(read?.turns?.[1]?.startedAt, 1_784_117_100_000);
  assert.equal(read?.turns?.[1]?.completedAt, null);
});

test('app client maps stable turn item ids and exposes only reasoning summaries', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  client.request = async (method: string) => {
    assert.equal(method, 'thread/read');
    return {
      thread: {
        id: 'thread_reasoning_history',
        status: { type: 'idle' },
        turns: [{
          id: 'turn_reasoning_history',
          status: 'completed',
          items: [{
            type: 'reasoning',
            id: 'reasoning_history_1',
            summary: ['Checked the implementation.', 'Verified the tests.'],
            content: ['private raw reasoning'],
          }, {
            type: 'agentMessage',
            id: 'answer_history_1',
            phase: 'final_answer',
            text: 'Done.',
          }],
        }],
      },
    };
  };

  const thread = await client.readThread('thread_reasoning_history', true);
  const reasoning = thread?.turns?.[0]?.items[0];
  const answer = thread?.turns?.[0]?.items[1];

  assert.equal(reasoning?.id, 'reasoning_history_1');
  assert.equal(reasoning?.text, 'Checked the implementation.\n\nVerified the tests.');
  assert.equal(Object.hasOwn(reasoning?.raw ?? {}, 'content'), false);
  assert.equal(JSON.stringify(reasoning).includes('private raw reasoning'), false);
  assert.equal(answer?.id, 'answer_history_1');
});

test('app client preserves string and snake_case model reasoning efforts', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  client.request = async (method: string) => {
    assert.equal(method, 'model/list');
    return {
      data: [{
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        isDefault: true,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        defaultReasoningEffort: 'low',
      }, {
        id: 'gpt-5.6-luna',
        model: 'gpt-5.6-luna',
        displayName: 'GPT-5.6 Luna',
        supported_reasoning_efforts: [
          { reasoning_effort: 'low' },
          { reasoning_effort: 'medium' },
          { reasoning_effort: 'high' },
          { reasoning_effort: 'xhigh' },
          { reasoning_effort: 'max' },
        ],
        default_reasoning_effort: 'medium',
      }],
      nextCursor: null,
    };
  };

  const models = await client.listModels();

  assert.deepEqual(models[0]?.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(models[0]?.defaultReasoningEffort, 'low');
  assert.deepEqual(models[1]?.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(models[1]?.defaultReasoningEffort, 'medium');
});

test('app client reads effective model and reasoning defaults from Codex config', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  client.request = async (method: string, params: Record<string, unknown>) => {
    assert.equal(method, 'config/read');
    assert.deepEqual(params, {
      includeLayers: false,
      cwd: '/workspace/project',
    });
    return {
      config: {
        model: 'gpt-5.6-sol',
        model_reasoning_effort: 'ultra',
      },
    };
  };

  assert.deepEqual(await client.readConfigDefaults({ cwd: '/workspace/project' }), {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
  });
});

test('app client keeps effective model settings returned by thread start', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  client.request = async (method: string, params: Record<string, unknown>) => {
    assert.equal(method, 'thread/start');
    assert.equal(params.model, null);
    return {
      thread: { id: 'thread_effective', name: 'Effective thread' },
      cwd: '/workspace/project',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
    };
  };

  const started = await client.startThread({ cwd: '/workspace/project', model: null });

  assert.deepEqual(started, {
    threadId: 'thread_effective',
    cwd: '/workspace/project',
    title: 'Effective thread',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
  });
});

test('app client keeps effective model settings returned by thread resume', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  client.request = async (method: string) => {
    assert.equal(method, 'thread/resume');
    return { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' };
  };

  assert.deepEqual(await client.resumeThread({ threadId: 'thread_existing' }), {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
  });
});

test('app client streams assistant and reasoning lifecycle by stable item id', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const progressEvents: ProviderTurnProgress[] = [];
  let emitted = false;
  const emit = (method: string, itemId: string, extra: Record<string, unknown> = {}) => {
    client.emit('notification', {
      method,
      params: {
        threadId: 'thread_progress_items',
        turnId: 'turn_progress_items',
        itemId,
        ...extra,
      },
    });
  };

  client.readThread = async () => {
    if (!emitted) {
      emitted = true;
      emit('item/started', 'commentary_1', {
        item: { type: 'agentMessage', id: 'commentary_1', phase: 'commentary', text: '' },
      });
      emit('item/agentMessage/delta', 'commentary_1', { delta: 'First note.' });
      emit('item/completed', 'commentary_1', {
        item: { type: 'agentMessage', id: 'commentary_1', phase: 'commentary', text: 'First note.' },
      });
      emit('item/started', 'reasoning_1', {
        item: { type: 'reasoning', id: 'reasoning_1', summary: [], content: [] },
      });
      emit('item/reasoning/summaryTextDelta', 'reasoning_1', {
        delta: 'Checked one path.',
        summaryIndex: 0,
      });
      emit('item/reasoning/textDelta', 'reasoning_1', {
        delta: 'private raw reasoning',
      });
      emit('item/reasoning/summaryTextDelta', 'reasoning_1', {
        delta: 'Checked another path.',
        summaryIndex: 1,
      });
      emit('item/completed', 'reasoning_1', {
        item: {
          type: 'reasoning',
          id: 'reasoning_1',
          summary: ['Checked one path.', 'Checked another path.'],
          content: ['private raw reasoning'],
        },
      });
      emit('item/started', 'commentary_2', {
        item: { type: 'agentMessage', id: 'commentary_2', phase: 'commentary', text: '' },
      });
      emit('item/agentMessage/delta', 'commentary_2', { delta: 'Second note.' });
      emit('item/completed', 'commentary_2', {
        item: { type: 'agentMessage', id: 'commentary_2', phase: 'commentary', text: 'Second note.' },
      });
      emit('item/started', 'answer_1', {
        item: { type: 'agentMessage', id: 'answer_1', phase: 'final_answer', text: '' },
      });
      emit('item/agentMessage/delta', 'answer_1', { delta: 'Done.' });
      emit('item/completed', 'answer_1', {
        item: { type: 'agentMessage', id: 'answer_1', phase: 'final_answer', text: 'Done.' },
      });
    }
    return {
      threadId: 'thread_progress_items',
      turns: [{
        id: 'turn_progress_items',
        status: 'completed',
        items: [{
          id: 'answer_1',
          type: 'agentMessage',
          role: 'assistant',
          phase: 'final_answer',
          text: 'Done.',
        }],
      }],
    } as any;
  };

  const result = await client.waitForTurnResult({
    threadId: 'thread_progress_items',
    turnId: 'turn_progress_items',
    timeoutMs: 1000,
    onProgress: (progress) => {
      progressEvents.push(progress);
    },
  });

  assert.equal(result.outputText, 'Done.');
  assert.deepEqual(
    progressEvents.map(({ itemId, eventType, outputKind, text, delta }) => ({
      itemId,
      eventType,
      outputKind,
      text,
      delta,
    })),
    [
      { itemId: 'commentary_1', eventType: 'started', outputKind: 'commentary', text: '', delta: '' },
      { itemId: 'commentary_1', eventType: 'delta', outputKind: 'commentary', text: 'First note.', delta: 'First note.' },
      { itemId: 'commentary_1', eventType: 'completed', outputKind: 'commentary', text: 'First note.', delta: '' },
      { itemId: 'reasoning_1', eventType: 'started', outputKind: 'reasoning_summary', text: '', delta: '' },
      { itemId: 'reasoning_1', eventType: 'delta', outputKind: 'reasoning_summary', text: 'Checked one path.', delta: 'Checked one path.' },
      {
        itemId: 'reasoning_1',
        eventType: 'delta',
        outputKind: 'reasoning_summary',
        text: 'Checked one path.\n\nChecked another path.',
        delta: '\n\nChecked another path.',
      },
      {
        itemId: 'reasoning_1',
        eventType: 'completed',
        outputKind: 'reasoning_summary',
        text: 'Checked one path.\n\nChecked another path.',
        delta: '',
      },
      { itemId: 'commentary_2', eventType: 'started', outputKind: 'commentary', text: '', delta: '' },
      { itemId: 'commentary_2', eventType: 'delta', outputKind: 'commentary', text: 'Second note.', delta: 'Second note.' },
      { itemId: 'commentary_2', eventType: 'completed', outputKind: 'commentary', text: 'Second note.', delta: '' },
      { itemId: 'answer_1', eventType: 'started', outputKind: 'final_answer', text: '', delta: '' },
      { itemId: 'answer_1', eventType: 'delta', outputKind: 'final_answer', text: 'Done.', delta: 'Done.' },
      { itemId: 'answer_1', eventType: 'completed', outputKind: 'final_answer', text: 'Done.', delta: '' },
    ],
  );
  assert.equal(JSON.stringify(progressEvents).includes('private raw reasoning'), false);
});

test('app client preserves reasoning summary as a terminal preview without commentary', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const progressEvents: ProviderTurnProgress[] = [];
  let emitted = false;
  client.readThread = async () => {
    if (!emitted) {
      emitted = true;
      client.emit('notification', {
        method: 'item/started',
        params: {
          threadId: 'thread_reasoning_preview',
          turnId: 'turn_reasoning_preview',
          item: { type: 'reasoning', id: 'reasoning_preview', summary: [], content: [] },
        },
      });
      client.emit('notification', {
        method: 'item/reasoning/summaryTextDelta',
        params: {
          threadId: 'thread_reasoning_preview',
          turnId: 'turn_reasoning_preview',
          itemId: 'reasoning_preview',
          summaryIndex: 0,
          delta: 'Safe summary only.',
        },
      });
      client.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: 'thread_reasoning_preview',
          turnId: 'turn_reasoning_preview',
          item: {
            type: 'reasoning',
            id: 'reasoning_preview',
            summary: ['Safe summary only.'],
            content: ['private raw reasoning'],
          },
        },
      });
    }
    return {
      threadId: 'thread_reasoning_preview',
      turns: [{
        id: 'turn_reasoning_preview',
        status: 'completed',
        items: [{
          type: 'reasoning',
          id: 'reasoning_preview',
          text: 'Safe summary only.',
        }],
      }],
    } as any;
  };

  const result = await client.waitForTurnResult({
    threadId: 'thread_reasoning_preview',
    turnId: 'turn_reasoning_preview',
    timeoutMs: 1000,
    onProgress: (progress) => progressEvents.push(progress),
  });

  assert.deepEqual(progressEvents.map((event) => event.outputKind), [
    'reasoning_summary',
    'reasoning_summary',
    'reasoning_summary',
  ]);
  assert.equal(result.previewText, 'Safe summary only.');
  assert.equal(result.finalSource, 'reasoning_summary_only');
  assert.equal(JSON.stringify(progressEvents).includes('private raw reasoning'), false);
});

test('app client replays turn events emitted before turn start acknowledgement', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const deliveries: string[] = [];
  const progressEvents: ProviderTurnProgress[] = [];
  const workEvents: ProviderTurnWorkEvent[] = [];
  const approvals: ProviderApprovalRequest[] = [];
  const emitNotification = (
    threadId: string,
    turnId: string,
    method: string,
    extra: Record<string, unknown>,
  ) => {
    const notification = {
      method,
      params: { threadId, turnId, ...extra },
    };
    client.emit('notification', notification);
    return notification;
  };

  client.request = async (method: string) => {
    assert.equal(method, 'turn/start');
    emitNotification('thread_other', 'turn_other_thread', 'item/agentMessage/delta', {
      itemId: 'other_thread_message',
      delta: 'must not leak',
    });
    emitNotification('thread_early', 'turn_other', 'item/agentMessage/delta', {
      itemId: 'other_turn_message',
      delta: 'must not leak',
    });
    emitNotification('thread_early', 'turn_other', 'item/started', {
      item: {
        type: 'commandExecution',
        id: 'other_turn_command',
        command: 'must not leak',
        cwd: '/workspace',
        status: 'inProgress',
      },
    });
    emitNotification('thread_early', 'turn_early', 'item/started', {
      item: {
        type: 'agentMessage',
        id: 'message_early',
        phase: 'commentary',
        text: '',
      },
    });
    const earlyDelta = emitNotification('thread_early', 'turn_early', 'item/agentMessage/delta', {
      itemId: 'message_early',
      delta: 'Early',
    });
    client.emit('notification', earlyDelta);
    emitNotification('thread_early', 'turn_early', 'item/started', {
      item: {
        type: 'commandExecution',
        id: 'command_early',
        command: 'npm test',
        cwd: '/workspace',
        status: 'inProgress',
        aggregatedOutput: null,
      },
    });
    emitNotification('thread_early', 'turn_early', 'item/commandExecution/outputDelta', {
      itemId: 'command_early',
      delta: 'running\n',
    });
    client.emit('approval_request', {
      requestId: 'approval_other_thread',
      kind: 'command',
      threadId: 'thread_other',
      turnId: 'turn_other_thread',
      itemId: 'command_other_thread',
      reason: null,
    } satisfies ProviderApprovalRequest);
    client.emit('approval_request', {
      requestId: 'approval_other_turn',
      kind: 'command',
      threadId: 'thread_early',
      turnId: 'turn_other',
      itemId: 'command_other_turn',
      reason: null,
    } satisfies ProviderApprovalRequest);
    client.emit('approval_request', {
      requestId: 'approval_early',
      kind: 'command',
      threadId: 'thread_early',
      turnId: 'turn_early',
      itemId: 'command_early',
      reason: null,
    } satisfies ProviderApprovalRequest);
    return { turn: { id: 'turn_early', status: 'inProgress' } };
  };

  let readCount = 0;
  client.readThread = async () => {
    readCount += 1;
    emitNotification('thread_early', 'turn_early', 'item/completed', {
      item: {
        type: 'agentMessage',
        id: 'message_early',
        phase: 'commentary',
        text: 'Early after ack.',
      },
    });
    return {
      threadId: 'thread_early',
      turns: [{
        id: 'turn_early',
        status: 'completed',
        items: [{
          type: 'agentMessage',
          id: 'answer_early',
          role: 'assistant',
          phase: 'final_answer',
          text: 'Done.',
        }],
      }],
    } as any;
  };

  const result = await client.startTurn({
    threadId: 'thread_early',
    inputText: 'Run it',
    model: 'gpt-5.6-sol',
    timeoutMs: 1000,
    onTurnStarted: () => {
      client.emit('notification', {
        method: 'turn/completed',
        params: {
          threadId: 'thread_early',
          turn: { id: 'turn_other', status: 'completed' },
        },
      });
      emitNotification('thread_early', 'turn_early', 'item/agentMessage/delta', {
        itemId: 'message_early',
        delta: ' after ack.',
      });
    },
    onProgress: (progress) => {
      progressEvents.push(progress);
      deliveries.push(`progress:${progress.eventType}:${progress.itemId}`);
    },
    onWorkEvent: (event) => {
      workEvents.push(event);
      deliveries.push(`work:${event.type}:${event.itemId}`);
    },
    onApprovalRequest: (request) => {
      approvals.push(request);
      deliveries.push(`approval:${request.requestId}`);
    },
  });

  assert.equal(readCount, 1);
  assert.equal(result.outputText, 'Done.');
  assert.deepEqual(deliveries, [
    'progress:started:message_early',
    'progress:delta:message_early',
    'work:started:command_early',
    'work:updated:command_early',
    'approval:approval_early',
    'progress:delta:message_early',
    'progress:completed:message_early',
  ]);
  assert.deepEqual(progressEvents.map((event) => event.text), [
    '',
    'Early',
    'Early after ack.',
    'Early after ack.',
  ]);
  assert.equal(workEvents[1]?.summary?.output, 'running\n');
  assert.deepEqual(approvals.map((request) => request.requestId), ['approval_early']);
  assert.equal(JSON.stringify({ progressEvents, workEvents, approvals }).includes('must not leak'), false);
  assert.equal(client.listenerCount('notification'), 0);
  assert.equal(client.listenerCount('approval_request'), 0);
});

test('app client confirms slow user-only interrupted snapshots despite item completion', async () => {
  let now = 0;
  let readCount = 0;
  const sleeps: number[] = [];
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });
  client.request = async (method: string) => {
    assert.equal(method, 'turn/start');
    return { turn: { id: 'turn_start_race', status: 'inProgress' } };
  };
  client.readThread = async () => {
    readCount += 1;
    if (readCount <= 4) {
      if (readCount === 1) {
        client.emit('notification', {
          method: 'item/completed',
          params: {
            threadId: 'thread_start_race',
            turnId: 'turn_start_race',
            item: {
              type: 'userMessage',
              id: 'message_start_race',
              role: 'user',
              text: 'Run it',
            },
          },
        });
      }
      return {
        threadId: 'thread_start_race',
        turns: [{
          id: 'turn_start_race',
          status: 'interrupted',
          error: null,
          items: [{ type: 'userMessage', role: 'user', text: 'Run it' }],
        }],
      } as any;
    }
    if (readCount === 5) {
      client.emit('notification', {
        method: 'turn/started',
        params: {
          threadId: 'thread_start_race',
          turn: { id: 'turn_start_race', status: 'inProgress' },
        },
      });
      return {
        threadId: 'thread_start_race',
        runtimeStatus: { type: 'active', activeFlags: [] },
        turns: [{
          id: 'turn_start_race',
          status: 'inProgress',
          error: null,
          items: [{ type: 'userMessage', role: 'user', text: 'Run it' }],
        }],
      } as any;
    }
    return {
      threadId: 'thread_start_race',
      turns: [{
        id: 'turn_start_race',
        status: 'completed',
        error: null,
        items: [{
          type: 'agentMessage',
          role: 'assistant',
          phase: 'final_answer',
          text: 'Completed after materialization.',
        }],
      }],
    } as any;
  };

  const result = await client.startTurn({
    threadId: 'thread_start_race',
    inputText: 'Run it',
    model: 'gpt-5.6-sol',
    timeoutMs: 5000,
  });

  assert.equal(readCount, 6);
  assert.deepEqual(sleeps, [250, 250, 250, 250, 1000]);
  assert.equal(result.outputState, 'complete');
  assert.equal(result.outputText, 'Completed after materialization.');
});

test('app client returns a confirmed empty interruption without entering terminal settling', async () => {
  let now = 0;
  let readCount = 0;
  const sleeps: number[] = [];
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });
  client.request = async (method: string) => {
    assert.equal(method, 'turn/start');
    return { turn: { id: 'turn_immediate_interrupt', status: 'inProgress' } };
  };
  client.readThread = async () => {
    readCount += 1;
    return {
      threadId: 'thread_immediate_interrupt',
      turns: [{
        id: 'turn_immediate_interrupt',
        status: 'interrupted',
        error: null,
        items: [],
      }],
    } as any;
  };

  const result = await client.startTurn({
    threadId: 'thread_immediate_interrupt',
    inputText: 'Run it',
    model: 'gpt-5.6-sol',
    timeoutMs: 5000,
  });

  assert.equal(readCount, 9);
  assert.deepEqual(sleeps, Array(8).fill(250));
  assert.equal(result.outputState, 'interrupted');
});

test('app client returns an interrupted snapshot with observed work activity immediately', async () => {
  const sleeps: number[] = [];
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  client.request = async (method: string) => {
    assert.equal(method, 'turn/start');
    return { turn: { id: 'turn_work_interrupt', status: 'inProgress' } };
  };
  client.readThread = async () => ({
    threadId: 'thread_work_interrupt',
    turns: [{
      id: 'turn_work_interrupt',
      status: 'interrupted',
      error: null,
      items: [{
        type: 'commandExecution',
        id: 'command_work_interrupt',
        command: 'npm test',
        status: 'interrupted',
      }],
    }],
  } as any);

  const result = await client.startTurn({
    threadId: 'thread_work_interrupt',
    inputText: 'Run it',
    model: 'gpt-5.6-sol',
    timeoutMs: 5000,
  });

  assert.deepEqual(sleeps, []);
  assert.equal(result.outputState, 'interrupted');
});

test('app client accepts a matching interrupted turn completion notification immediately', async () => {
  let readCount = 0;
  const sleeps: number[] = [];
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  client.request = async (method: string) => {
    assert.equal(method, 'turn/start');
    return { turn: { id: 'turn_notified_interrupt', status: 'inProgress' } };
  };
  client.readThread = async () => {
    readCount += 1;
    client.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: 'thread_notified_interrupt',
        turn: { id: 'turn_notified_interrupt', status: 'interrupted' },
      },
    });
    return {
      threadId: 'thread_notified_interrupt',
      turns: [{
        id: 'turn_notified_interrupt',
        status: 'interrupted',
        error: null,
        items: [],
      }],
    } as any;
  };

  const result = await client.startTurn({
    threadId: 'thread_notified_interrupt',
    inputText: 'Run it',
    model: 'gpt-5.6-sol',
    timeoutMs: 5000,
  });

  assert.equal(readCount, 1);
  assert.deepEqual(sleeps, []);
  assert.equal(result.outputState, 'interrupted');
});

test('app client accepts a matching rollout turn_aborted event immediately', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-api-turn-aborted-'));
  const sessionPath = path.join(sessionDir, 'rollout.jsonl');
  fs.writeFileSync(sessionPath, JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'turn_aborted',
      turn_id: 'turn_rollout_interrupt',
      reason: 'interrupted',
    },
  }));
  let readCount = 0;
  const sleeps: number[] = [];
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  client.request = async (method: string) => {
    assert.equal(method, 'turn/start');
    return { turn: { id: 'turn_rollout_interrupt', status: 'inProgress' } };
  };
  client.readThread = async () => {
    readCount += 1;
    return {
      threadId: 'thread_rollout_interrupt',
      path: sessionPath,
      turns: [{
        id: 'turn_rollout_interrupt',
        status: 'interrupted',
        error: null,
        items: [],
      }],
    } as any;
  };

  const result = await client.startTurn({
    threadId: 'thread_rollout_interrupt',
    inputText: 'Run it',
    model: 'gpt-5.6-sol',
    timeoutMs: 5000,
  });

  assert.equal(readCount, 1);
  assert.deepEqual(sleeps, []);
  assert.equal(result.outputState, 'interrupted');
});

test('app client prefers matching task_complete output over a stale interrupted snapshot', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-api-stale-interrupt-'));
  const sessionPath = path.join(sessionDir, 'rollout.jsonl');
  fs.writeFileSync(sessionPath, [{
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: 'turn_stale_interrupt',
    },
  }, {
    type: 'response_item',
    payload: {
      type: 'message',
      id: 'answer_stale_interrupt',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: 'Completed from rollout.' }],
    },
  }, {
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: 'turn_stale_interrupt',
      last_agent_message: 'Completed from rollout.',
    },
  }].map((entry) => JSON.stringify(entry)).join('\n'));
  const sleeps: number[] = [];
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  client.request = async (method: string) => {
    assert.equal(method, 'turn/start');
    return { turn: { id: 'turn_stale_interrupt', status: 'inProgress' } };
  };
  client.readThread = async () => ({
    threadId: 'thread_stale_interrupt',
    path: sessionPath,
    turns: [{
      id: 'turn_stale_interrupt',
      status: 'interrupted',
      error: null,
      items: [],
    }],
  } as any);

  const result = await client.startTurn({
    threadId: 'thread_stale_interrupt',
    inputText: 'Run it',
    model: 'gpt-5.6-sol',
    timeoutMs: 5000,
  });

  assert.deepEqual(sleeps, []);
  assert.equal(result.outputState, 'complete');
  assert.equal(result.outputText, 'Completed from rollout.');
  assert.equal(result.status, 'completed');
});

test('app client accumulates current command execution output deltas', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const workEvents: ProviderTurnWorkEvent[] = [];
  let emitted = false;

  client.readThread = async () => {
    if (!emitted) {
      emitted = true;
      client.emit('notification', {
        method: 'item/started',
        params: {
          threadId: 'thread_command_delta',
          turnId: 'turn_command_delta',
          item: {
            type: 'commandExecution',
            id: 'command_1',
            command: 'npm test',
            cwd: '/workspace',
            status: 'inProgress',
            aggregatedOutput: null,
          },
        },
      });
      for (const delta of ['first line\n', 'second line\n']) {
        client.emit('notification', {
          method: 'item/commandExecution/outputDelta',
          params: {
            threadId: 'thread_command_delta',
            turnId: 'turn_command_delta',
            itemId: 'command_1',
            delta,
          },
        });
      }
      client.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: 'thread_command_delta',
          turnId: 'turn_command_delta',
          item: {
            type: 'commandExecution',
            id: 'command_1',
            command: 'npm test',
            cwd: '/workspace',
            status: 'completed',
            aggregatedOutput: 'first line\nsecond line\n',
            exitCode: 0,
          },
        },
      });
    }
    return {
      threadId: 'thread_command_delta',
      turns: [{
        id: 'turn_command_delta',
        status: 'completed',
        items: [{
          type: 'agentMessage',
          role: 'assistant',
          phase: 'final_answer',
          text: 'Tests passed.',
        }],
      }],
    } as any;
  };

  await client.waitForTurnResult({
    threadId: 'thread_command_delta',
    turnId: 'turn_command_delta',
    timeoutMs: 1000,
    onWorkEvent: (event) => {
      workEvents.push(event);
    },
  });

  assert.deepEqual(workEvents.map((event) => event.type), [
    'started',
    'updated',
    'updated',
    'completed',
  ]);
  assert.equal(workEvents[1]?.summary?.output, 'first line\n');
  assert.equal(workEvents[1]?.summary?.outputDelta, 'first line\n');
  assert.equal(workEvents[2]?.summary?.output, 'first line\nsecond line\n');
  assert.equal(workEvents[2]?.summary?.outputDelta, 'second line\n');
  assert.equal(workEvents[3]?.summary?.output, 'first line\nsecond line\n');
  assert.equal(workEvents[3]?.summary?.exitCode, 0);
});

test('app client maps file change patch updates with nested change kinds', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const workEvents: ProviderTurnWorkEvent[] = [];
  let emitted = false;
  client.readThread = async () => {
    if (!emitted) {
      emitted = true;
      client.emit('notification', {
        method: 'item/fileChange/patchUpdated',
        params: {
          threadId: 'thread_patch_update',
          turnId: 'turn_patch_update',
          itemId: 'file-change-1',
          changes: [{
            path: 'src/new.ts',
            kind: { type: 'add' },
            diff: '@@ +1 @@',
          }, {
            path: 'src/old.ts',
            kind: { type: 'delete' },
            diff: '@@ -1 @@',
          }],
        },
      });
    }
    return {
      threadId: 'thread_patch_update',
      turns: [{
        id: 'turn_patch_update',
        status: 'completed',
        items: [{
          type: 'agentMessage',
          role: 'assistant',
          phase: 'final_answer',
          text: 'Done',
        }],
      }],
    } as any;
  };

  await client.waitForTurnResult({
    threadId: 'thread_patch_update',
    turnId: 'turn_patch_update',
    timeoutMs: 1000,
    onWorkEvent: (event) => workEvents.push(event),
  });

  assert.equal(workEvents.length, 1);
  assert.equal(workEvents[0]?.type, 'updated');
  assert.equal(workEvents[0]?.itemId, 'file-change-1');
  assert.equal(workEvents[0]?.kind, 'file_change');
  assert.equal(workEvents[0]?.title, 'Edited 2 files');
  assert.deepEqual(workEvents[0]?.summary?.fileChanges, [{
    path: 'src/new.ts',
    action: 'added',
    kind: 'add',
    diff: '@@ +1 @@',
  }, {
    path: 'src/old.ts',
    action: 'deleted',
    kind: 'delete',
    diff: '@@ -1 @@',
  }]);
});

test('app client renews an active observer lease until the turn is terminal', async () => {
  let now = 0;
  let readCount = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });
  client.readThread = async () => {
    readCount += 1;
    const completed = readCount >= 3;
    return {
      threadId: 'thread_long_turn',
      runtimeStatus: { type: completed ? 'idle' : 'active', activeFlags: [] },
      turns: [{
        id: 'turn_long_turn',
        status: completed ? 'completed' : 'inProgress',
        items: completed
          ? [{
            type: 'agentMessage',
            role: 'assistant',
            phase: 'final_answer',
            text: 'Finished after renewal.',
          }]
          : [],
      }],
    } as any;
  };

  const result = await client.waitForTurnResult({
    threadId: 'thread_long_turn',
    turnId: 'turn_long_turn',
    timeoutMs: 1000,
  });

  assert.equal(readCount, 3);
  assert.equal(result.outputState, 'complete');
  assert.equal(result.outputText, 'Finished after renewal.');
});

test('app client sends complete collaboration settings for inherited plan turns', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  let turnParams: Record<string, any> | null = null;
  client.request = async (method: string, params: Record<string, unknown>) => {
    if (method === 'thread/start') {
      return {
        thread: { id: 'thread_inherited', name: 'Inherited thread' },
        cwd: '/workspace/project',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'ultra',
      };
    }
    assert.equal(method, 'turn/start');
    turnParams = params as Record<string, any>;
    return { turn: { id: 'turn_inherited', status: 'inProgress' } };
  };
  client.waitForTurnResult = async () => ({
    outputText: 'done',
    status: 'completed',
    turnId: 'turn_inherited',
    threadId: 'thread_inherited',
  });

  await client.startThread({ cwd: '/workspace/project', model: null });
  await client.startTurn({
    threadId: 'thread_inherited',
    inputText: 'Plan this',
    model: null,
    effort: null,
    collaborationMode: 'plan',
    developerInstructions: '',
  });

  assert.equal(turnParams?.model, 'gpt-5.6-sol');
  assert.equal(turnParams?.effort, 'ultra');
  assert.deepEqual(turnParams?.collaborationMode, {
    mode: 'plan',
    settings: {
      model: 'gpt-5.6-sol',
      reasoning_effort: 'ultra',
      developer_instructions: null,
    },
  });
});

test('app client extracts work details from function call notifications', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const workEvents: ProviderTurnWorkEvent[] = [];
  let emitted = false;

  client.readThread = async () => {
    if (!emitted) {
      emitted = true;
      client.emit('notification', {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          item: {
            type: 'function_call',
            id: 'fc_exec_1',
            call_id: 'call_exec_1',
            name: 'exec_command',
            arguments: JSON.stringify({
              cmd: 'sed -n "1,80p" packages/codex-web/public/app.js',
              workdir: '/workspace',
            }),
          },
        },
      });
      client.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          item: {
            type: 'function_call_output',
            id: 'fco_exec_1',
            call_id: 'call_exec_1',
            output: 'const TOKEN_KEY = "codexWebToken";',
          },
        },
      });
      client.emit('notification', {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          item: {
            type: 'custom_tool_call',
            id: 'ctc_patch_1',
            call_id: 'call_patch_1',
            name: 'apply_patch',
            input: [
              '*** Begin Patch',
              '*** Update File: packages/codex-web/public/app.js',
              '@@',
              '-old',
              '+new',
              '*** End Patch',
            ].join('\n'),
          },
        },
      });
      client.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          item: {
            type: 'custom_tool_call_output',
            id: 'ctco_patch_1',
            call_id: 'call_patch_1',
            output: 'Success. Updated the following files:\nM packages/codex-web/public/app.js',
          },
        },
      });
    }
    return {
      threadId: 'thread_1',
      turns: [{
        id: 'turn_1',
        status: 'completed',
        items: [{
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          text: 'Done',
        }],
      }],
    } as any;
  };

  await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId: 'turn_1',
    timeoutMs: 1000,
    onWorkEvent: (event) => {
      workEvents.push(event);
    },
  });

  assert.deepEqual(workEvents.map((event) => `${event.type}:${event.itemId}:${event.kind}`), [
    'started:call_exec_1:command',
    'completed:call_exec_1:command',
    'started:call_patch_1:file_change',
    'completed:call_patch_1:file_change',
  ]);
  assert.equal(workEvents[0]?.itemId, 'call_exec_1');
  assert.equal(workEvents[0]?.kind, 'command');
  assert.equal(workEvents[0]?.summary?.command, 'sed -n "1,80p" packages/codex-web/public/app.js');
  assert.equal(workEvents[0]?.summary?.cwd, '/workspace');
  assert.equal(workEvents[1]?.itemId, 'call_exec_1');
  assert.equal(workEvents[1]?.summary?.output, 'const TOKEN_KEY = "codexWebToken";');
  assert.equal(workEvents[2]?.itemId, 'call_patch_1');
  assert.equal(workEvents[2]?.kind, 'file_change');
  assert.deepEqual(workEvents[2]?.summary?.fileChanges, [
    { path: 'packages/codex-web/public/app.js', action: 'modified' },
  ]);
  assert.match(String(workEvents[2]?.summary?.diff), /Update File: packages\/codex-web\/public\/app\.js/u);
  assert.equal(workEvents[3]?.itemId, 'call_patch_1');
  assert.match(String(workEvents[3]?.summary?.output), /Success/u);
});

test('app client extracts work details from polled turn items when notifications are unavailable', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const workEvents: ProviderTurnWorkEvent[] = [];

  client.readThread = async () => ({
    threadId: 'thread_1',
    turns: [{
      id: 'turn_1',
      status: 'completed',
      items: [{
        type: 'function_call',
        id: 'fc_exec_1',
        call_id: 'call_exec_1',
        name: 'exec_command',
        arguments: JSON.stringify({
          cmd: 'sed -n "1,80p" packages/codex-web/public/app.js',
          workdir: '/workspace',
        }),
      }, {
        type: 'function_call_output',
        call_id: 'call_exec_1',
        output: 'const TOKEN_KEY = "codexWebToken";',
      }, {
        type: 'custom_tool_call',
        id: 'ctc_patch_1',
        call_id: 'call_patch_1',
        name: 'apply_patch',
        input: [
          '*** Begin Patch',
          '*** Update File: packages/codex-web/public/app.js',
          '@@',
          '-old',
          '+new',
          '*** End Patch',
        ].join('\n'),
      }, {
        type: 'custom_tool_call_output',
        call_id: 'call_patch_1',
        output: 'Success. Updated the following files:\nM packages/codex-web/public/app.js',
      }, {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        text: 'Done',
      }],
    }],
  } as any);

  await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId: 'turn_1',
    timeoutMs: 1000,
    onWorkEvent: (event) => {
      workEvents.push(event);
    },
  });

  assert.equal(workEvents[0]?.type, 'started');
  assert.equal(workEvents[0]?.itemId, 'call_exec_1');
  assert.equal(workEvents[0]?.kind, 'command');
  assert.equal(workEvents[0]?.summary?.command, 'sed -n "1,80p" packages/codex-web/public/app.js');
  assert.equal(workEvents[0]?.summary?.cwd, '/workspace');
  assert.equal(workEvents[1]?.type, 'completed');
  assert.equal(workEvents[1]?.itemId, 'call_exec_1');
  assert.equal(workEvents[1]?.summary?.output, 'const TOKEN_KEY = "codexWebToken";');
  assert.equal(workEvents[2]?.type, 'started');
  assert.equal(workEvents[2]?.itemId, 'call_patch_1');
  assert.equal(workEvents[2]?.kind, 'file_change');
  assert.deepEqual(workEvents[2]?.summary?.fileChanges, [
    { path: 'packages/codex-web/public/app.js', action: 'modified' },
  ]);
  assert.match(String(workEvents[2]?.summary?.diff), /Update File: packages\/codex-web\/public\/app\.js/u);
  assert.equal(workEvents[3]?.type, 'completed');
  assert.equal(workEvents[3]?.itemId, 'call_patch_1');
  assert.match(String(workEvents[3]?.summary?.output), /Success/u);
});

test('app client upserts native command and file change snapshots with stable ids', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const workEvents: ProviderTurnWorkEvent[] = [];
  client.readThread = async () => ({
    threadId: 'thread_native_work',
    turns: [{
      id: 'turn_native_work',
      status: 'completed',
      items: [{
        type: 'commandExecution',
        id: 'exec-native-1',
        command: 'npm test',
        cwd: '/workspace',
        status: 'completed',
        aggregatedOutput: 'ok\n',
        exitCode: 0,
        text: '',
      }, {
        type: 'fileChange',
        id: 'file-native-1',
        status: 'completed',
        changes: [{
          path: 'src/old.ts',
          kind: { type: 'update', move_path: 'src/new.ts' },
          diff: '@@ -1 +1 @@',
        }],
        text: '',
      }, {
        type: 'agentMessage',
        id: 'answer-native-1',
        role: 'assistant',
        phase: 'final_answer',
        text: 'Done',
      }],
    }],
  } as any);

  await client.waitForTurnResult({
    threadId: 'thread_native_work',
    turnId: 'turn_native_work',
    timeoutMs: 1000,
    onWorkEvent: (event) => workEvents.push(event),
  });

  assert.deepEqual(
    workEvents.map((event) => `${event.type}:${event.itemId}:${event.kind}`),
    [
      'started:exec-native-1:command',
      'updated:exec-native-1:command',
      'completed:exec-native-1:command',
      'started:file-native-1:file_change',
      'updated:file-native-1:file_change',
      'completed:file-native-1:file_change',
    ],
  );
  assert.equal(workEvents[0]?.title, 'npm test');
  assert.deepEqual(workEvents[0]?.summary, {});
  assert.equal(workEvents[1]?.title, 'npm test');
  assert.equal(workEvents[1]?.summary?.output, 'ok\n');
  assert.equal(workEvents[1]?.summary?.exitCode, 0);
  assert.equal(workEvents[3]?.title, 'Edited src/old.ts');
  assert.deepEqual(workEvents[4]?.summary?.fileChanges, [{
    path: 'src/old.ts',
    action: 'modified',
    kind: 'update',
    movePath: 'src/new.ts',
    diff: '@@ -1 +1 @@',
  }]);
  assert.deepEqual(workEvents[5]?.summary, workEvents[4]?.summary);
});

test('app client extracts nested apply_patch work and structured output from exec custom tools', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const workEvents: ProviderTurnWorkEvent[] = [];
  const toolInput = [
    'const patch = "*** Begin Patch\\n',
    '*** Update File: packages/codex-web/public/app.js\\n',
    '@@\\n-old\\n+new\\n',
    '*** Add File: packages/codex-web/public/work-status.js\\n',
    '+export const status = \\\"ready\\\";\\n',
    '*** End Patch";',
    'text(await tools.apply_patch(patch));',
  ].join('');

  client.readThread = async () => ({
    threadId: 'thread_nested_patch',
    turns: [{
      id: 'turn_nested_patch',
      status: 'completed',
      items: [{
        type: 'custom_tool_call',
        id: 'ctc_nested_patch',
        call_id: 'call_nested_patch',
        name: 'exec',
        input: toolInput,
      }, {
        type: 'custom_tool_call_output',
        call_id: 'call_nested_patch',
        output: [{
          type: 'input_text',
          text: 'Script completed\nOutput:',
        }, {
          type: 'input_text',
          text: 'Done!',
        }],
      }, {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        text: 'Done',
      }],
    }],
  } as any);

  await client.waitForTurnResult({
    threadId: 'thread_nested_patch',
    turnId: 'turn_nested_patch',
    timeoutMs: 1000,
    onWorkEvent: (event) => {
      workEvents.push(event);
    },
  });

  assert.equal(workEvents.length, 2);
  assert.equal(workEvents[0]?.type, 'started');
  assert.equal(workEvents[0]?.kind, 'file_change');
  assert.equal(workEvents[0]?.title, 'Edited 2 files');
  assert.deepEqual(workEvents[0]?.summary?.fileChanges, [{
    path: 'packages/codex-web/public/app.js',
    action: 'modified',
  }, {
    path: 'packages/codex-web/public/work-status.js',
    action: 'added',
  }]);
  assert.match(String(workEvents[0]?.summary?.diff), /\*\*\* Update File: packages\/codex-web\/public\/app\.js\n/u);
  assert.doesNotMatch(String(workEvents[0]?.summary?.diff), /\\n/u);
  assert.equal(workEvents[1]?.type, 'completed');
  assert.equal(workEvents[1]?.kind, 'file_change');
  assert.equal(workEvents[1]?.summary?.output, 'Script completed\nOutput:\nDone!');
  assert.doesNotMatch(String(workEvents[1]?.summary?.output), /\[object Object\]/u);
});

test('app client extracts work details from session jsonl response items when turn snapshots omit tools', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-api-work-jsonl-'));
  const sessionPath = path.join(sessionDir, 'rollout.jsonl');
  const turnId = 'turn_jsonl_1';
  fs.writeFileSync(sessionPath, [
    {
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: turnId,
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: 'fc_jsonl_exec_1',
        call_id: 'call_exec_1',
        name: 'exec_command',
        arguments: JSON.stringify({
          cmd: 'rg "Activity details" packages/codex-web/public/app.js',
          workdir: '/workspace',
        }),
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_exec_1',
        output: 'packages/codex-web/public/app.js:Activity details',
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        id: 'ctc_jsonl_patch_1',
        call_id: 'call_patch_1',
        name: 'apply_patch',
        input: [
          '*** Begin Patch',
          '*** Update File: packages/codex-web/public/app.js',
          '@@',
          '-old',
          '+new',
          '*** End Patch',
        ].join('\n'),
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'call_patch_1',
        output: 'Success. Updated the following files:\nM packages/codex-web/public/app.js',
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'reasoning',
        id: 'reasoning_jsonl_1',
        summary: ['Safe summary.'],
        content: ['private raw reasoning'],
        encrypted_content: 'private encrypted reasoning',
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'message_jsonl_1',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: 'Done' }],
      },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: turnId,
        last_agent_message: 'Done',
      },
    },
  ].map((entry) => JSON.stringify(entry)).join('\n'));

  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const workEvents: ProviderTurnWorkEvent[] = [];

  client.readThread = async () => ({
    threadId: 'thread_1',
    path: sessionPath,
    turns: [{
      id: turnId,
      status: 'completed',
      items: [{
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        text: 'Done',
      }],
    }],
  } as any);

  const result = await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId,
    timeoutMs: 1000,
    onWorkEvent: (event) => {
      workEvents.push(event);
    },
  });

  assert.deepEqual(workEvents.map((event) => `${event.type}:${event.itemId}:${event.kind}`), [
    'started:call_exec_1:command',
    'completed:call_exec_1:command',
    'started:call_patch_1:file_change',
    'completed:call_patch_1:file_change',
  ]);
  assert.equal(workEvents[0]?.summary?.command, 'rg "Activity details" packages/codex-web/public/app.js');
  assert.equal(workEvents[1]?.summary?.output, 'packages/codex-web/public/app.js:Activity details');
  assert.deepEqual(workEvents[2]?.summary?.fileChanges, [
    { path: 'packages/codex-web/public/app.js', action: 'modified' },
  ]);
  assert.match(String(workEvents[3]?.summary?.output), /Success/u);
  const reasoningItem = result.responseItems?.find((item) => item.id === 'reasoning_jsonl_1');
  assert.deepEqual(reasoningItem?.summary, ['Safe summary.']);
  assert.equal(Object.hasOwn(reasoningItem ?? {}, 'content'), false);
  assert.equal(Object.hasOwn(reasoningItem ?? {}, 'encrypted_content'), false);
  assert.equal(JSON.stringify(result.responseItems).includes('private raw reasoning'), false);
  assert.equal(JSON.stringify(result.responseItems).includes('private encrypted reasoning'), false);
  assert.equal(result.responseItems?.some((item) => item.id === 'message_jsonl_1'), true);
});

test('app client fails open turns from session jsonl runtime errors without task complete', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-api-runtime-error-'));
  const sessionPath = path.join(sessionDir, 'rollout.jsonl');
  const turnId = 'turn_invalid_key';
  const message = 'unexpected status 401 Unauthorized: {"code":"INVALID_API_KEY","message":"Invalid API key"}, url: https://allinai7.cloud/v1/responses, request id: a12befc6-4026-4e7b-94dc-7e184daca4e4';
  fs.writeFileSync(sessionPath, [
    {
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: turnId,
      },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'error',
        message,
        codex_error_info: 'other',
      },
    },
  ].map((entry) => JSON.stringify(entry)).join('\n'));

  let now = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => ({
    threadId: 'thread_1',
    path: sessionPath,
    turns: [{
      id: turnId,
      status: 'running',
      items: [],
    }],
  } as any);

  await assert.rejects(
    client.waitForTurnResult({
      threadId: 'thread_1',
      turnId,
      timeoutMs: 1000,
    }),
    /INVALID_API_KEY/u,
  );
});

test('app client fails open turns from generic session failed events', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-api-generic-runtime-error-'));
  const sessionPath = path.join(sessionDir, 'rollout.jsonl');
  const turnId = 'turn_generic_failure';
  fs.writeFileSync(sessionPath, [
    {
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: turnId,
      },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'model_request_failed',
        error: 'upstream provider returned a non-retryable failure',
      },
    },
  ].map((entry) => JSON.stringify(entry)).join('\n'));

  let now = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => ({
    threadId: 'thread_1',
    path: sessionPath,
    turns: [{
      id: turnId,
      status: 'running',
      items: [],
    }],
  } as any);

  await assert.rejects(
    client.waitForTurnResult({
      threadId: 'thread_1',
      turnId,
      timeoutMs: 1000,
    }),
    /upstream provider returned a non-retryable failure/u,
  );
});

test('app client fails turns from matching Codex error notifications before completed snapshots', async () => {
  const message = 'unexpected status 403 Forbidden: {"code":"FORBIDDEN","message":"Forbidden"}';
  let now = 0;
  let emitted = false;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => {
    if (!emitted) {
      emitted = true;
      client.emit('notification', {
        method: 'error',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_notification_error',
          error: {
            message,
          },
        },
      });
    }
    return {
      threadId: 'thread_1',
      path: null,
      turns: [{
        id: 'turn_notification_error',
        status: 'completed',
        items: [{
          type: 'message',
          role: 'assistant',
          text: '',
        }],
      }],
    } as any;
  };

  await assert.rejects(
    client.waitForTurnResult({
      threadId: 'thread_1',
      turnId: 'turn_notification_error',
      timeoutMs: 1000,
    }),
    /403 Forbidden/u,
  );
});

test('app client ignores transient reconnecting error notifications while turn is still running', async () => {
  let now = 0;
  let readCount = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => {
    readCount += 1;
    if (readCount === 1) {
      client.emit('notification', {
        method: 'error',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_reconnect',
          message: 'Reconnecting... 1/5',
        },
      });
    }
    return {
      threadId: 'thread_1',
      path: null,
      turns: [{
        id: 'turn_reconnect',
        status: readCount < 2 ? 'inProgress' : 'completed',
        items: readCount < 2
          ? []
          : [{
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            text: 'Recovered after reconnect.',
          }],
      }],
    } as any;
  };

  const result = await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId: 'turn_reconnect',
    timeoutMs: 3000,
  });

  assert.equal(result.outputText, 'Recovered after reconnect.');
});

test('app client retries transient rollout materialization read errors after turn starts', async () => {
  let now = 0;
  let readCount = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => {
    readCount += 1;
    if (readCount === 1) {
      throw new Error(
        'failed to read thread: thread-store internal error: failed to read thread '
        + '/Users/test/.codex/sessions/rollout.jsonl: rollout at '
        + '/Users/test/.codex/sessions/rollout.jsonl is empty',
      );
    }
    return {
      threadId: 'thread_1',
      path: null,
      turns: [{
        id: 'turn_materializing',
        status: 'completed',
        items: [{
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          text: 'Recovered after materialization.',
        }],
      }],
    } as any;
  };

  const result = await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId: 'turn_materializing',
    timeoutMs: 3000,
  });

  assert.equal(readCount, 2);
  assert.equal(result.outputText, 'Recovered after materialization.');
});

test('app client fails open turns from Codex stderr runtime errors', async () => {
  const message = 'unexpected status 403 Forbidden: {"code":"FORBIDDEN","message":"Forbidden"}, url: https://allinai7.cloud/v1/responses, request id: req_forbidden';
  let now = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });
  (client as any).childStderrSequence += 1;
  (client as any).childStderrTail.push({
    sequence: (client as any).childStderrSequence,
    text: `■ ${message}`,
  });

  client.readThread = async () => ({
    threadId: 'thread_1',
    path: null,
    turns: [{
      id: 'turn_stderr_failure',
      status: 'running',
      items: [],
    }],
  } as any);

  await assert.rejects(
    client.waitForTurnResult({
      threadId: 'thread_1',
      turnId: 'turn_stderr_failure',
      timeoutMs: 1000,
    }),
    /403 Forbidden/u,
  );
});

test('app client ignores background MCP transport failures while the turn keeps running', async () => {
  let now = 0;
  let readCount = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => {
    readCount += 1;
    if (readCount === 1) {
      (client as any).childStderrSequence += 1;
      (client as any).childStderrTail.push({
        sequence: (client as any).childStderrSequence,
        text: '\u001b[31mERROR\u001b[0m \u001b[2mrmcp::transport::worker\u001b[0m: worker quit with fatal: '
          + 'Transport channel closed, when UnexpectedServerResponse("HTTP 403: Forbidden")',
      });
    }
    return {
      threadId: 'thread_mcp_failure',
      path: null,
      turns: [{
        id: 'turn_mcp_failure',
        status: readCount < 2 ? 'inProgress' : 'completed',
        items: readCount < 2
          ? []
          : [{
              type: 'message',
              role: 'assistant',
              phase: 'final_answer',
              text: 'The main turn completed.',
            }],
      }],
    } as any;
  };

  const result = await client.waitForTurnResult({
    threadId: 'thread_mcp_failure',
    turnId: 'turn_mcp_failure',
    timeoutMs: 3000,
  });

  assert.equal(result.outputText, 'The main turn completed.');
});

test('app client ignores recoverable tool router errors containing provider error text', async () => {
  let now = 0;
  let readCount = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => {
    readCount += 1;
    if (readCount === 1) {
      (client as any).childStderrSequence += 1;
      (client as any).childStderrTail.push({
        sequence: (client as any).childStderrSequence,
        text: '\u001b[31mERROR\u001b[0m \u001b[2mcodex_core::tools::router\u001b[0m: error=apply_patch verification failed: '
          + "Failed to find expected line 'unexpected status 403 Forbidden'",
      });
    }
    return {
      threadId: 'thread_tool_error',
      path: null,
      turns: [{
        id: 'turn_tool_error',
        status: readCount < 2 ? 'inProgress' : 'completed',
        items: readCount < 2
          ? []
          : [{
              type: 'message',
              role: 'assistant',
              phase: 'final_answer',
              text: 'Recovered with a corrected patch.',
            }],
      }],
    } as any;
  };

  const result = await client.waitForTurnResult({
    threadId: 'thread_tool_error',
    turnId: 'turn_tool_error',
    timeoutMs: 3000,
  });

  assert.equal(result.outputText, 'Recovered with a corrected patch.');
});

test('app client ignores stderr runtime errors emitted before a turn wait starts', async () => {
  let now = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });
  (client as any).childStderrSequence += 1;
  (client as any).childStderrTail.push({
    sequence: (client as any).childStderrSequence,
    text: 'unexpected status 403 Forbidden from an earlier turn',
  });

  client.readThread = async () => ({
    threadId: 'thread_1',
    path: null,
    turns: [{
      id: 'turn_after_stderr',
      status: 'completed',
      items: [{
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        text: 'Recovered',
      }],
    }],
  } as any);

  const result = await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId: 'turn_after_stderr',
    timeoutMs: 1000,
    stderrBaseline: 1,
  } as any);

  assert.equal(result.outputText, 'Recovered');
});
