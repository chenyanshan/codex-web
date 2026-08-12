import crypto from 'node:crypto';

export type WebhookDeliveryMode = 'steer' | 'reject_if_busy';

export interface WebhookRequestFingerprintInput {
  conversationKeyHash: string;
  projectId: string | null;
  text: string;
  title: string | null;
  model: string | null;
  reasoningEffort: string | null;
  deliveryMode: WebhookDeliveryMode;
}

export interface WebhookTurnSnapshot {
  id: string;
  status: string | null;
  error: string | null;
  items: Array<{
    type: string;
    role: string | null;
    phase: string | null;
    text: string;
  }>;
}

export type WebhookSubmissionPublicStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export function normalizeWebhookClientRequestId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id) ? id : null;
}

export function webhookSubmissionId(clientRequestId: string): string {
  const digest = crypto.createHash('sha256').update(clientRequestId).digest('hex');
  return `webhook-request:${digest}`;
}

export function hashWebhookRequestFingerprint(input: WebhookRequestFingerprintInput): string {
  return crypto.createHash('sha256').update(stableJson(input)).digest('hex');
}

export function projectWebhookTurnStatus(turn: WebhookTurnSnapshot): {
  status: Exclude<WebhookSubmissionPublicStatus, 'queued'>;
  finalText: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
} {
  const status = normalizeTurnStatus(turn.status);
  if (isCancelledStatus(status)) {
    return {
      status: 'cancelled',
      finalText: null,
      error: {
        code: 'turn_cancelled',
        message: turn.error?.trim() || 'The turn was cancelled.',
        retryable: false,
      },
    };
  }
  if (isFailedStatus(status)) {
    return {
      status: 'failed',
      finalText: null,
      error: {
        code: 'turn_failed',
        message: turn.error?.trim() || 'The turn failed.',
        retryable: false,
      },
    };
  }
  if (isCompletedStatus(status)) {
    return { status: 'completed', finalText: finalAssistantText(turn), error: null };
  }
  return { status: 'running', finalText: null, error: null };
}

function finalAssistantText(turn: WebhookTurnSnapshot): string | null {
  const messages = turn.items.filter((item) => {
    const role = String(item.role || '').trim().toLowerCase();
    const type = String(item.type || '').replace(/[^a-z]/giu, '').toLowerCase();
    return role === 'assistant' && (!type || type.includes('message')) && item.text.trim();
  });
  const explicitFinal = messages.filter((item) => (
    String(item.phase || '').trim().toLowerCase().replace(/[\s-]+/gu, '_') === 'final_answer'
  ));
  return (explicitFinal.at(-1) ?? messages.at(-1))?.text.trim() || null;
}

function normalizeTurnStatus(value: string | null): string {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/gu, '');
}

function isCompletedStatus(value: string): boolean {
  return ['completed', 'complete', 'succeeded', 'success', 'finished'].includes(value);
}

function isFailedStatus(value: string): boolean {
  return ['failed', 'error', 'timedout', 'timeout'].includes(value);
}

function isCancelledStatus(value: string): boolean {
  return ['interrupted', 'cancelled', 'canceled', 'aborted'].includes(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
