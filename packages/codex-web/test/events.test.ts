import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeApprovalEvent,
  normalizeProgressEvent,
  normalizeTurnCompletedEvent,
  normalizeTurnFailedEvent,
  presentCodexWebEvent,
} from '../src/event_model.js';

test('progress normalization emits assistant delta events without retaining cumulative raw text', () => {
  const event = normalizeProgressEvent({
    turnId: 'turn_1',
    threadId: 'thread_1',
    progress: {
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
    text: 'lo',
    phase: 'final_answer',
    raw: {
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
      availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
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
    grantRoot: null,
    networkPermission: null,
    fileReadPermissions: [],
    fileWritePermissions: [],
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
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

test('public event DTOs omit internal thread ids, raw payloads, and cwd fields', () => {
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
    summary: { reason: 'Run tests', command: 'npm test' },
  });
  assert.doesNotMatch(JSON.stringify(presented), /thread_private|\/Users\/alice|unknownProviderField|raw/u);
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
