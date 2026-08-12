import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashWebhookRequestFingerprint,
  normalizeWebhookClientRequestId,
  projectWebhookTurnStatus,
  webhookSubmissionId,
} from '../src/webhook_submission.js';

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
      { type: 'message', role: 'assistant', phase: 'final_answer', text: 'final' },
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
