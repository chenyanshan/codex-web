import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CodexAppClient,
  type ProviderApprovalRequest,
  type ProviderTurnWorkEvent,
} from '../src/index.js';

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
            type: 'function_call',
            call_id: 'call_patch_1',
            name: 'apply_patch',
            arguments: [
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

  await client.waitForTurnResult({
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
