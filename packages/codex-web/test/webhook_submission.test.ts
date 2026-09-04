import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashWebhookRequestFingerprint,
  normalizeWebhookClientRequestId,
  projectWebhookTurnStatus,
  webhookSubmissionId,
} from '../src/webhook_submission.js';
import { parseAioPsWebhookEnvelope } from '../src/aiops_webhook.js';

test('AIOps Feishu envelope parses private and temporary messages with sec/ms times and User JSON', () => {
  const privateEnvelope = parseAioPsWebhookEnvelope({
    schema: '2.0',
    header: { event_id: 'evt-1' },
    event: {
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        message_id: 'om_private',
        create_time: '1720000000',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: '查询支付服务错误' }),
      },
    },
    user_json: JSON.stringify({ service: 'payment', severity: 'high' }),
    continuation: { previous: 'ctx-1' },
  });
  assert.equal(privateEnvelope?.conversationType, 'private');
  assert.equal(privateEnvelope?.messageTime, 1_720_000_000_000);
  assert.match(privateEnvelope?.text ?? '', /查询支付服务错误/u);
  assert.match(privateEnvelope?.text ?? '', /"severity":"high"/u);
  assert.match(privateEnvelope?.clientRequestId ?? '', /^fsmsg:/u);

  const temporaryEnvelope = parseAioPsWebhookEnvelope({
    message: {
      messageId: 'om_temp',
      timestamp: 1720000000123,
      conversationType: 'temporary',
      content: { text: '继续排查' },
      userJson: { user: 'alice' },
    },
    clientRequestId: 'fsmsg:tenant:om_temp',
    continuation: true,
  });
  assert.equal(temporaryEnvelope?.conversationType, 'temporary');
  assert.equal(temporaryEnvelope?.messageTime, 1_720_000_000_123);
  assert.equal(temporaryEnvelope?.clientRequestId, 'fsmsg:tenant:om_temp');
  assert.match(temporaryEnvelope?.text ?? '', /继续排查/u);
});

test('invalid AIOps-looking envelope is rejected before it can become model text', () => {
  assert.throws(
    () => parseAioPsWebhookEnvelope({ message: { message_id: 'missing-fields' } }),
    (error: any) => error.code === 'INVALID_REQUEST_ENVELOPE' && error.stage === 'ingress' && error.statusCode === 400,
  );
});

test('webhook client request ids are bounded and safely hashed for internal ids', () => {
  assert.equal(normalizeWebhookClientRequestId(' fsmsg:tenant:message-1 '), 'fsmsg:tenant:message-1');
  assert.equal(normalizeWebhookClientRequestId('contains/slash'), null);
  assert.equal(normalizeWebhookClientRequestId('x'.repeat(129)), null);
  assert.match(webhookSubmissionId('fsmsg:tenant:message-1'), /^webhook-request:[0-9a-f]{64}$/u);
  assert.equal(webhookSubmissionId('fsmsg:tenant:message-1').includes('fsmsg'), false);
});

test('webhook request fingerprints include conversation, content, settings, and delivery mode', () => {
  const base = {
    conversationKeyHash: 'conversation-a',
    projectId: 'project-a',
    text: 'investigate',
    title: null,
    model: 'gpt-test',
    reasoningEffort: 'high',
    deliveryMode: 'steer' as const,
  };
  const hash = hashWebhookRequestFingerprint(base);
  assert.equal(hashWebhookRequestFingerprint({ ...base }), hash);
  assert.notEqual(hashWebhookRequestFingerprint({ ...base, conversationKeyHash: 'conversation-b' }), hash);
  assert.notEqual(hashWebhookRequestFingerprint({ ...base, text: 'changed' }), hash);
  assert.notEqual(hashWebhookRequestFingerprint({ ...base, model: 'other-model' }), hash);
  assert.notEqual(hashWebhookRequestFingerprint({ ...base, reasoningEffort: 'medium' }), hash);
  assert.notEqual(hashWebhookRequestFingerprint({ ...base, deliveryMode: 'reject_if_busy' }), hash);
});

test('webhook turn projection separates running, completed, failed, and cancelled states', () => {
  const base = { id: 'turn_1', error: null, items: [] };
  assert.equal(projectWebhookTurnStatus({ ...base, status: 'running' }).status, 'running');
  assert.deepEqual(projectWebhookTurnStatus({
    ...base,
    status: 'completed',
    items: [
      { type: 'reasoning', role: 'assistant', phase: 'analysis', text: 'hidden' },
      { type: 'message', role: 'assistant', phase: 'commentary', text: 'progress' },
      {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        text: '',
        content: [{ type: 'output_text', text: 'final' }],
      },
    ],
  }), { status: 'completed', finalText: 'final', error: null });
  assert.deepEqual(projectWebhookTurnStatus({ ...base, status: 'failed', error: 'provider failed' }), {
    status: 'failed',
    finalText: null,
    error: { code: 'turn_failed', message: 'provider failed', retryable: false },
  });
  assert.deepEqual(projectWebhookTurnStatus({ ...base, status: 'interrupted' }), {
    status: 'cancelled',
    finalText: null,
    error: { code: 'turn_cancelled', message: 'The turn was cancelled.', retryable: false },
  });
});

test('webhook turn projection reads only final answer output_text from rollout-shaped messages', () => {
  const projected = projectWebhookTurnStatus({
    id: 'turn_rollout',
    status: 'completed',
    error: null,
    items: [
      {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        text: '',
        content: [{ type: 'output_text', text: 'progress must stay hidden' }],
      },
      {
        type: 'reasoning',
        role: 'assistant',
        phase: 'analysis',
        text: '',
        content: [{ type: 'output_text', text: 'reasoning must stay hidden' }],
      },
      {
        type: 'function_call_output',
        role: null,
        phase: null,
        text: '',
        content: [{ type: 'output_text', text: 'tool output must stay hidden' }],
      },
      {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        text: '',
        content: [
          { type: 'input_text', text: 'input must stay hidden' },
          { type: 'output_text', text: 'Real final response' },
        ],
      },
    ] as any,
  });

  assert.deepEqual(projected, {
    status: 'completed',
    finalText: 'Real final response',
    error: null,
  });
});

test('completed webhook turns remain running until an explicit final answer is available', () => {
  assert.deepEqual(projectWebhookTurnStatus({
    id: 'turn_pending_final',
    status: 'completed',
    error: null,
    items: [
      { type: 'message', role: 'assistant', phase: 'commentary', text: 'Still syncing' },
    ],
  }), {
    status: 'running',
    finalText: null,
    error: null,
  });
});

test('protocol-error assistant text can never project as completed', () => {
  assert.deepEqual(projectWebhookTurnStatus({
    id: 'turn_protocol_error',
    status: 'completed',
    error: null,
    items: [{
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      text: '',
      content: [{ type: 'output_text', text: '网关请求格式无效，请重试' }],
    }],
  }), {
    status: 'failed',
    finalText: null,
    error: {
      code: 'INVALID_REQUEST_ENVELOPE',
      message: 'The request envelope was rejected by the AIOps protocol handler.',
      retryable: false,
    },
  });
});
