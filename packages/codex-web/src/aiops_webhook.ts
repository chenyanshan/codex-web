import crypto from 'node:crypto';

export const AIOPS_PROMPT_VERSION = 'aiops-im-v1';
export const AIOPS_SCHEMA_VERSION = 'aiops-envelope-v1';

export interface AioPsWebhookEnvelope {
  text: string;
  clientRequestId: string | null;
  conversationType: 'private' | 'temporary';
  projectId: string | null;
  messageId: string;
  messageTime: number;
  userJson: Record<string, unknown> | null;
  continuation: unknown;
  promptVersion: string;
  schemaVersion: string;
}

/**
 * Returns null for the legacy Codex Web webhook shape. Envelope-looking
 * payloads are either fully parsed or rejected; they are never handed to the
 * model as an opaque object for it to interpret.
 */
export function parseAioPsWebhookEnvelope(body: Record<string, unknown>): AioPsWebhookEnvelope | null {
  if (!looksLikeEnvelope(body)) {
    return null;
  }
  const message = nestedMessage(body);
  const source = message ?? body;
  const event = asRecord(body.event);
  const conversation = asRecord(source.conversation) ?? asRecord(body.conversation);
  const conversationType = normalizeConversationType(
    firstValue(source, ['chat_type', 'chatType', 'conversation_type', 'conversationType', 'session_type', 'sessionType'])
      ?? firstValue(conversation ?? {}, ['type', 'kind'])
      ?? firstValue(body, ['chat_type', 'chatType', 'conversation_type', 'conversationType', 'type'])
      ?? (body.temporary === true ? 'temporary' : body.private === true ? 'private' : undefined),
  );
  const messageId = normalizeString(
    firstValue(source, ['message_id', 'messageId', 'msg_id', 'msgId', 'id'])
      ?? firstValue(body, ['message_id', 'messageId', 'msg_id', 'msgId', 'id']),
  );
  const messageTime = normalizeMessageTime(
    firstValue(source, ['create_time', 'createTime', 'timestamp', 'message_time', 'messageTime', 'event_time', 'eventTime'])
      ?? firstValue(body, ['create_time', 'createTime', 'timestamp', 'message_time', 'messageTime', 'event_time', 'eventTime']),
  );
  const content = extractContent(firstValue(source, ['content', 'text', 'body', 'message']))
    ?? extractContent(firstValue(body, ['content', 'text', 'body']));
  const userJson = extractJsonObject(
    firstValue(source, ['user_json', 'userJson', 'userJSON', 'User', 'user'])
      ?? firstValue(body, ['user_json', 'userJson', 'userJSON', 'User', 'user'])
      ?? firstValue(event ?? {}, ['user_json', 'userJson', 'userJSON', 'User', 'user', 'sender'])
      ?? firstValue(body, ['sender']),
  );
  const continuation = firstValue(source, ['continuation', 'continue', 'is_continuation', 'isContinuation'])
    ?? firstValue(body, ['continuation', 'continue', 'is_continuation', 'isContinuation'])
    ?? null;
  if (!conversationType || !messageId || !messageTime || !content?.trim()) {
    throw invalidEnvelope('AIOps IM envelope must include conversation type, message id, message time, and text.');
  }
  const explicitClientRequestId = normalizeString(
    body.clientRequestId ?? body.client_request_id ?? source.clientRequestId ?? source.client_request_id,
  );
  const clientRequestId = explicitClientRequestId || `fsmsg:${crypto.createHash('sha256').update(messageId).digest('hex').slice(0, 40)}`;
  return {
    text: buildStructuredPrompt({
      content: content.trim(),
      conversationType,
      messageId,
      messageTime,
      userJson,
      continuation,
    }),
    clientRequestId,
    conversationType,
    projectId: normalizeString(firstValue(source, ['projectId', 'project_id']) ?? firstValue(body, ['projectId', 'project_id'])) || null,
    messageId,
    messageTime,
    userJson,
    continuation,
    promptVersion: AIOPS_PROMPT_VERSION,
    schemaVersion: AIOPS_SCHEMA_VERSION,
  };
}

export const parseAIOpsWebhookEnvelope = parseAioPsWebhookEnvelope;

export function invalidEnvelope(message: string): Error & { statusCode: number; code: string; stage: string; retryable: boolean } {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
    stage: string;
    retryable: boolean;
  };
  error.statusCode = 400;
  error.code = 'INVALID_REQUEST_ENVELOPE';
  error.stage = 'ingress';
  error.retryable = false;
  return error;
}

function looksLikeEnvelope(body: Record<string, unknown>): boolean {
  return [
    'schema', 'header', 'event', 'message', 'Message', 'message_id', 'messageId', 'msg_id', 'msgId', 'id',
    'chat_type', 'chatType', 'conversation_type', 'conversationType', 'conversation', 'private', 'temporary', 'user_json', 'userJson', 'userJSON', 'User',
    'continuation', 'create_time', 'createTime', 'message_time', 'messageTime',
  ].some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function nestedMessage(body: Record<string, unknown>): Record<string, unknown> | null {
  const event = asRecord(body.event);
  const message = asRecord(body.message) ?? asRecord(body.Message);
  const eventMessage = event ? asRecord(event.message) : null;
  return eventMessage ?? message ?? event ?? null;
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return undefined;
}

function normalizeConversationType(value: unknown): 'private' | 'temporary' | null {
  const normalized = normalizeString(value).toLowerCase().replace(/[\s_-]+/gu, '');
  if (['private', 'p2p', 'direct', 'single', '私聊'].includes(normalized)) {
    return 'private';
  }
  if (['temporary', 'temp', 'temporarychat', '临时', '临时会话'].includes(normalized)) {
    return 'temporary';
  }
  return null;
}

function normalizeMessageTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeEpoch(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) {
      return normalizeEpoch(numeric);
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeEpoch(value: number): number | null {
  const milliseconds = value < 1e12 ? value * 1_000 : value;
  return milliseconds > 0 && Number.isFinite(milliseconds) ? Math.round(milliseconds) : null;
}

function extractContent(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const nested = extractContent(parsed);
      if (nested) return nested;
      if (parsed && typeof parsed === 'object') return null;
    } catch {
      // Feishu text content is often a plain string; keep it as-is.
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    const parts = value.map(extractContent).filter((part): part is string => Boolean(part));
    return parts.join('\n').trim() || null;
  }
  const record = asRecord(value);
  if (!record) return null;
  return extractContent(record.text ?? record.content ?? record.value ?? record.body);
}

function extractJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return extractJsonObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  const record = asRecord(value);
  return record ? record : null;
}

function buildStructuredPrompt(input: {
  content: string;
  conversationType: 'private' | 'temporary';
  messageId: string;
  messageTime: number;
  userJson: Record<string, unknown> | null;
  continuation: unknown;
}): string {
  return [
    '[AIOps IM request]',
    `conversation_type: ${input.conversationType}`,
    `message_id: ${input.messageId}`,
    `message_time_ms: ${input.messageTime}`,
    `continuation: ${stableJson(input.continuation)}`,
    `user_json: ${stableJson(input.userJson)}`,
    'user_message:',
    input.content,
  ].join('\n');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = asRecord(value);
  if (record) {
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
