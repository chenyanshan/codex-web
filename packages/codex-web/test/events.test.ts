import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeApprovalEvent,
  normalizeProgressEvent,
  normalizeTurnCompletedEvent,
  normalizeTurnFailedEvent,
  presentCodexWebEvent,
} from '../src/event_model.js';

test('progress normalization preserves stable item lifecycle, cumulative text, and the latest delta', () => {
  const event = normalizeProgressEvent({
    turnId: 'turn_1',
    threadId: 'thread_1',
    progress: {
      itemId: 'item_answer_1',
      eventType: 'delta',
      text: 'Hello',
      delta: 'lo',
      outputKind: 'final_answer',
    },
  });

  assert.deepEqual(event, {
    id: event.id,
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_1',
    itemId: 'item_answer_1',
    eventType: 'delta',
    text: 'Hello',
    delta: 'lo',
    phase: 'final_answer',
    raw: {
      itemId: 'item_answer_1',
      eventType: 'delta',
      outputKind: 'final_answer',
      textLength: 5,
      deltaLength: 2,
    },
  });
});

test('approval normalization emits approval request summary', () => {
  const event = normalizeApprovalEvent({
    turnId: 'turn_2',
    request: {
      requestId: 'approval_1',
      kind: 'command',
      threadId: 'thread_2',
      turnId: 'turn_2',
      itemId: 'item_1',
      reason: 'needs shell',
      command: 'npm test',
      cwd: '/workspace',
      grantRoot: '/workspace/generated',
      networkPermission: true,
      fileReadPermissions: ['/workspace/input'],
      fileWritePermissions: ['/workspace/output'],
      availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
      execPolicyAmendment: ['prefix_rule(pattern=["npm", "test"], decision="allow")'],
    },
  });

  assert.equal(event.type, 'approval.requested');
  assert.equal(event.approvalId, 'approval_1');
  assert.equal(event.approvalKind, 'command');
  assert.deepEqual(event.summary, {
    reason: 'needs shell',
    command: 'npm test',
    cwd: '/workspace',
    fileChanges: [],
    grantRoot: '/workspace/generated',
    networkPermission: true,
    fileReadPermissions: ['/workspace/input'],
    fileWritePermissions: ['/workspace/output'],
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
    execPolicyAmendment: ['prefix_rule(pattern=["npm", "test"], decision="allow")'],
  });
});

test('turn completion uses provider status and final text', () => {
  const events = normalizeTurnCompletedEvent({
    turnId: 'turn_3',
    threadId: 'thread_3',
    result: {
      outputText: 'Final answer',
      status: 'completed',
      threadId: 'thread_3',
      turnId: 'turn_3',
    },
  });

  assert.equal(events[0].type, 'assistant.final');
  assert.equal(events[0].text, 'Final answer');
  assert.equal(events[0].itemId, 'assistant_turn_3_final');
  assert.equal(events[0].eventType, 'completed');
  assert.equal(events[0].delta, '');
  assert.equal(events[0].phase, 'final_answer');
  assert.equal(events[0].raw, undefined);
  assert.equal(events[1].type, 'turn.completed');
  assert.equal(events[1].status, 'completed');
  assert.deepEqual(events[1].raw, {
    status: 'completed',
    outputState: null,
    finalSource: null,
    errorMessage: null,
    threadId: 'thread_3',
    turnId: 'turn_3',
  });
});

test('turn completion with provider error emits only a failed event', () => {
  const events = normalizeTurnCompletedEvent({
    turnId: 'turn_error',
    threadId: 'thread_error',
    result: {
      outputText: '',
      errorMessage: '429 Too Many Requests: model rate limit reached',
      status: 'failed',
      threadId: 'thread_error',
      turnId: 'turn_error',
    },
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'turn.failed');
  assert.equal(events[0].message, '429 Too Many Requests: model rate limit reached');
  assert.equal(events[0].details, '429 Too Many Requests: model rate limit reached');
});

test('turn failure normalization does not expose local stack traces to frontend events', () => {
  const error = new Error('unexpected status 403 Forbidden: {"code":"FORBIDDEN","message":"Forbidden"}');
  error.stack = [
    error.message,
    '    at CodexAppClient.waitForTurnResult (/Users/test/project/packages/codex-native-api/src/codex_app_client.ts:1674:17)',
  ].join('\n');

  const event = normalizeTurnFailedEvent({
    turnId: 'turn_forbidden',
    threadId: 'thread_forbidden',
    error,
  });

  assert.equal(event.type, 'turn.failed');
  assert.equal(event.message, 'unexpected status 403 Forbidden: {"code":"FORBIDDEN","message":"Forbidden"}');
  assert.equal(event.details, null);
  assert.doesNotMatch(JSON.stringify(event), /\/Users\/test\/project/u);
  assert.doesNotMatch(JSON.stringify(event), /codex_app_client\.ts/u);
});

test('workspace event DTOs retain authorized work context but omit internal and raw fields', () => {
  const presented = presentCodexWebEvent({
    id: 'evt_approval',
    type: 'approval.requested',
    turnId: 'turn_1',
    approvalId: 'approval_1',
    approvalKind: 'command',
    summary: {
      reason: 'Run tests',
      command: 'npm test',
      cwd: '/Users/alice/private',
      threadId: 'thread_private',
      unknownProviderField: 'secret',
    },
    raw: { cwd: '/Users/alice/private', token: 'secret' },
  });

  assert.deepEqual(presented, {
    id: 'evt_approval',
    type: 'approval.requested',
    turnId: 'turn_1',
    approvalId: 'approval_1',
    approvalKind: 'command',
    summary: { reason: 'Run tests', command: 'npm test', cwd: '/Users/alice/private' },
  });
  assert.doesNotMatch(JSON.stringify(presented), /thread_private|unknownProviderField|raw/u);
});

test('workspace batch updates retain structured file and failure details', () => {
  const presented = presentCodexWebEvent({
    id: 'evt_batch_details',
    type: 'batch.updated',
    turnId: 'turn_1',
    batchId: 'batch_1',
    summary: {
      command: 'npm test',
      cwd: '/repo',
      diff: '*** Update File: app.js',
      error: 'Command failed',
      exitCode: 1,
      fileChanges: [{ path: 'app.js', action: 'modified' }],
      unknownProviderField: 'secret',
    },
  });

  assert.deepEqual(presented, {
    id: 'evt_batch_details',
    type: 'batch.updated',
    turnId: 'turn_1',
    batchId: 'batch_1',
    summary: {
      command: 'npm test',
      cwd: '/repo',
      diff: '*** Update File: app.js',
      error: 'Command failed',
      exitCode: 1,
      fileChanges: [{ path: 'app.js', action: 'modified' }],
    },
  });
});

test('share event DTOs expose answer lifecycle but suppress machine work and approval events', () => {
  const delta = presentCodexWebEvent({
    id: 'evt_delta',
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_private',
    text: 'Hello',
    phase: 'final_answer',
    raw: { threadId: 'thread_private' },
  }, 'share');
  const batch = presentCodexWebEvent({
    id: 'evt_batch',
    type: 'batch.started',
    turnId: 'turn_1',
    batchId: 'batch_1',
    kind: 'command',
    title: 'cat /Users/alice/private',
    raw: { cwd: '/Users/alice/private' },
  }, 'share');

  assert.deepEqual(delta, {
    id: 'evt_delta',
    type: 'assistant.delta',
    turnId: 'turn_1',
    text: 'Hello',
    phase: 'final_answer',
  });
  assert.equal(batch, null);
});

test('summary workspace event DTOs expose work categories without work details or commentary', () => {
  const commentary = presentCodexWebEvent({
    id: 'evt_commentary',
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_private',
    text: 'I am reading /Users/alice/private',
    phase: 'commentary',
  }, 'workspace_summary');
  const finalDelta = presentCodexWebEvent({
    id: 'evt_final',
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_private',
    text: 'Done',
    phase: 'final_answer',
  }, 'workspace_summary');
  const started = presentCodexWebEvent({
    id: 'evt_started',
    type: 'batch.started',
    turnId: 'turn_1',
    batchId: 'batch_1',
    kind: 'command',
    title: 'cat /Users/alice/private',
  }, 'workspace_summary');
  const updated = presentCodexWebEvent({
    id: 'evt_updated',
    type: 'batch.updated',
    turnId: 'turn_1',
    batchId: 'batch_1',
    summary: {
      command: 'cat /Users/alice/private',
      output: 'secret output',
      fileChanges: [{ path: '/Users/alice/private' }],
    },
  }, 'workspace_summary');
  const completed = presentCodexWebEvent({
    id: 'evt_completed',
    type: 'batch.completed',
    turnId: 'turn_1',
    batchId: 'batch_1',
    status: 'completed',
  }, 'workspace_summary');

  assert.equal(commentary, null);
  assert.deepEqual(finalDelta, {
    id: 'evt_final',
    type: 'assistant.delta',
    turnId: 'turn_1',
    text: 'Done',
    phase: 'final_answer',
  });
  assert.deepEqual(started, {
    id: 'evt_started',
    type: 'batch.started',
    turnId: 'turn_1',
    batchId: 'batch_1',
    kind: 'command',
    title: 'Running command',
  });
  assert.equal(updated, null);
  assert.deepEqual(completed, {
    id: 'evt_completed',
    type: 'batch.completed',
    turnId: 'turn_1',
    batchId: 'batch_1',
    status: 'completed',
  });
  assert.doesNotMatch(JSON.stringify([started, completed]), /Users|secret|cat /u);

  const unsafeCompleted = presentCodexWebEvent({
    id: 'evt_unsafe_completed',
    type: 'batch.completed',
    turnId: 'turn_1',
    batchId: 'batch_1',
    status: 'failed at /Users/alice/private',
  }, 'workspace_summary');
  assert.equal(unsafeCompleted?.status, 'completed');
  assert.doesNotMatch(JSON.stringify(unsafeCompleted), /Users|private/u);
});

test('summary workspace approvals retain only decision context and file targets', () => {
  const approval = presentCodexWebEvent({
    id: 'evt_approval_summary',
    type: 'approval.requested',
    turnId: 'turn_1',
    approvalId: 'approval_1',
    approvalKind: 'command',
    summary: {
      command: 'rm -rf /Users/alice/private',
      reason: 'Remove generated files',
      networkPermission: false,
      grantRoot: '/Users/alice/private/generated',
      fileReadPermissions: ['/Users/alice/private/input.txt', '', 42],
      fileWritePermissions: ['/Users/alice/private/output.txt'],
      execPolicyAmendment: ['allow rm build/*', null],
      cwd: '/Users/alice/private',
      output: 'secret output',
      diff: 'secret diff',
      patch: 'secret patch',
      exitCode: 17,
      fileChanges: [
        {
          path: '/Users/alice/private/source.txt',
          target: '/Users/alice/private/target.txt',
          output: 'nested output',
          diff: 'nested diff',
          patch: 'nested patch',
          exitCode: 9,
        },
        '/Users/alice/private/plain.txt',
        { diff: 'no target means no decision context' },
      ],
      availableDecisionKeys: ['accept', 'decline'],
    },
  }, 'workspace_summary');

  assert.deepEqual(approval, {
    id: 'evt_approval_summary',
    type: 'approval.requested',
    turnId: 'turn_1',
    approvalId: 'approval_1',
    approvalKind: 'command',
    summary: {
      availableDecisionKeys: ['accept', 'decline'],
      command: 'rm -rf /Users/alice/private',
      reason: 'Remove generated files',
      grantRoot: '/Users/alice/private/generated',
      networkPermission: false,
      fileReadPermissions: ['/Users/alice/private/input.txt'],
      fileWritePermissions: ['/Users/alice/private/output.txt'],
      execPolicyAmendment: ['allow rm build/*'],
      fileChanges: [
        { path: '/Users/alice/private/source.txt', target: '/Users/alice/private/target.txt' },
        '/Users/alice/private/plain.txt',
      ],
    },
  });
  assert.doesNotMatch(JSON.stringify(approval), /"(?:cwd|output|diff|patch|exitCode)"|nested/u);
});

test('share event DTOs suppress non-final assistant commentary', () => {
  const commentary = presentCodexWebEvent({
    id: 'evt_share_commentary',
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_private',
    text: 'Inspecting private files',
    phase: 'commentary',
  }, 'share');

  assert.equal(commentary, null);
});
