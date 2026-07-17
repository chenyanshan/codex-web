import crypto from 'node:crypto';
import type {
  ProviderApprovalRequest,
  ProviderTurnProgress,
  ProviderTurnResult,
  ProviderTurnWorkEvent,
} from '@codex-mobile-web-app/codex-native-api';

export type CodexWebEvent =
  | { id: string; type: 'turn.started'; turnId: string; threadId: string; raw?: unknown }
  | {
    id: string;
    type: 'assistant.delta';
    turnId: string;
    threadId: string;
    text: string;
    phase: string | null;
    itemId?: string;
    eventType?: 'started' | 'delta' | 'completed';
    delta?: string;
    raw?: unknown;
  }
  | {
    id: string;
    type: 'assistant.final';
    turnId: string;
    threadId: string;
    text: string;
    itemId?: string;
    eventType?: 'completed';
    delta?: string;
    phase?: 'final_answer';
    raw?: unknown;
  }
  | { id: string; type: 'batch.started'; turnId: string; batchId: string; kind: 'command' | 'file_change' | 'permission' | 'unknown'; title: string; raw?: unknown }
  | { id: string; type: 'batch.updated'; turnId: string; batchId: string; summary: Record<string, unknown>; raw?: unknown }
  | { id: string; type: 'batch.completed'; turnId: string; batchId: string; status: string; raw?: unknown }
  | { id: string; type: 'approval.requested'; turnId: string; approvalId: string; approvalKind: string; summary: Record<string, unknown>; raw?: unknown }
  | { id: string; type: 'approval.resolved'; turnId: string; approvalId: string; decision: 'accepted' | 'accepted_for_session' | 'denied'; raw?: unknown }
  | { id: string; type: 'turn.completed'; turnId: string; threadId: string; status: string; raw?: unknown }
  | { id: string; type: 'turn.failed'; turnId: string; threadId: string | null; message: string; details?: string | null; raw?: unknown };

export type CodexWebEventAudience = 'workspace' | 'workspace_summary' | 'share';

export function presentCodexWebEvent(
  event: CodexWebEvent,
  audience: CodexWebEventAudience = 'workspace',
): Record<string, unknown> | null {
  const base = {
    id: event.id,
    type: event.type,
    turnId: event.turnId,
  };
  switch (event.type) {
    case 'turn.started':
      return base;
    case 'assistant.delta':
      if (audience !== 'workspace' && event.phase !== 'final_answer') {
        return null;
      }
      return {
        ...base,
        text: event.text,
        phase: event.phase,
        ...(event.itemId ? { itemId: event.itemId } : {}),
        ...(event.eventType ? { eventType: event.eventType } : {}),
        ...(typeof event.delta === 'string' ? { delta: event.delta } : {}),
      };
    case 'assistant.final':
      return {
        ...base,
        text: event.text,
        ...(event.itemId ? { itemId: event.itemId } : {}),
        ...(event.eventType ? { eventType: event.eventType } : {}),
        ...(typeof event.delta === 'string' ? { delta: event.delta } : {}),
        ...(event.phase ? { phase: event.phase } : {}),
      };
    case 'batch.started':
      if (audience === 'share') {
        return null;
      }
      return {
        ...base,
        batchId: event.batchId,
        kind: event.kind,
        title: audience === 'workspace_summary' ? safeWorkTitle(event.kind) : event.title,
      };
    case 'batch.updated':
      return audience !== 'workspace' ? null : {
        ...base,
        batchId: event.batchId,
        summary: presentEventSummary(event.summary),
      };
    case 'batch.completed':
      return audience === 'share' ? null : {
        ...base,
        batchId: event.batchId,
        status: audience === 'workspace_summary' ? safeWorkStatus(event.status) : event.status,
      };
    case 'approval.requested':
      return audience === 'share' ? null : {
        ...base,
        approvalId: event.approvalId,
        approvalKind: event.approvalKind,
        summary: audience === 'workspace_summary'
          ? presentApprovalDecisionContext(event.summary)
          : presentEventSummary(event.summary),
      };
    case 'approval.resolved':
      return audience === 'share' ? null : {
        ...base,
        approvalId: event.approvalId,
        decision: event.decision,
      };
    case 'turn.completed':
      return {
        ...base,
        status: event.status,
      };
    case 'turn.failed':
      return {
        ...base,
        message: audience === 'workspace' ? event.message : 'Turn failed.',
        ...(audience === 'workspace' && event.details ? { details: event.details } : {}),
      };
  }
}

function safeWorkTitle(kind: Extract<CodexWebEvent, { type: 'batch.started' }>['kind']): string {
  switch (kind) {
    case 'command':
      return 'Running command';
    case 'file_change':
      return 'Updating files';
    case 'permission':
      return 'Checking permissions';
    case 'unknown':
      return 'Working';
  }
}

const SAFE_WORK_STATUSES = new Set([
  'active',
  'cancelled',
  'complete',
  'completed',
  'denied',
  'failed',
  'in_progress',
  'inProgress',
  'interrupted',
  'pending',
  'running',
  'started',
]);

function safeWorkStatus(status: string): string {
  return SAFE_WORK_STATUSES.has(status) ? status : 'completed';
}

const PUBLIC_EVENT_SUMMARY_KEYS = new Set([
  'availableDecisionKeys',
  'command',
  'cwd',
  'diff',
  'error',
  'execPolicyAmendment',
  'exitCode',
  'file',
  'fileChanges',
  'fileReadPermissions',
  'fileWritePermissions',
  'grantRoot',
  'networkPermission',
  'output',
  'outputDelta',
  'patch',
  'path',
  'reason',
  'status',
  'stderr',
  'stderrDelta',
  'stdout',
  'stdoutDelta',
  'target',
]);

function presentEventSummary(summary: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(summary)
      .filter(([key]) => PUBLIC_EVENT_SUMMARY_KEYS.has(key))
      .filter(([, value]) => hasWorkSummaryValue(value)),
  );
}

function presentApprovalDecisionContext(summary: Record<string, unknown>): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  const availableDecisionKeys = Array.isArray(summary.availableDecisionKeys)
    ? summary.availableDecisionKeys.filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
    : [];
  if (availableDecisionKeys.length > 0) {
    context.availableDecisionKeys = availableDecisionKeys;
  }
  if (typeof summary.command === 'string' && summary.command.trim()) {
    context.command = summary.command;
  }
  if (typeof summary.reason === 'string' && summary.reason.trim()) {
    context.reason = summary.reason;
  }
  if (typeof summary.grantRoot === 'string' && summary.grantRoot.trim()) {
    context.grantRoot = summary.grantRoot;
  }
  if (typeof summary.networkPermission === 'boolean') {
    context.networkPermission = summary.networkPermission;
  }
  for (const key of ['fileReadPermissions', 'fileWritePermissions', 'execPolicyAmendment'] as const) {
    const values = presentApprovalStringList(summary[key]);
    if (values.length > 0) {
      context[key] = values;
    }
  }
  const fileChanges = presentApprovalFileChanges(summary.fileChanges);
  return fileChanges.length > 0
    ? { ...context, fileChanges }
    : context;
}

function presentApprovalStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
    : [];
}

function presentApprovalFileChanges(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const fileChanges: unknown[] = [];
  for (const change of value) {
    if (typeof change === 'string') {
      if (change.trim()) {
        fileChanges.push(change);
      }
      continue;
    }
    if (!change || typeof change !== 'object' || Array.isArray(change)) {
      continue;
    }
    const record = change as Record<string, unknown>;
    const paths = Object.fromEntries(
      ['path', 'target']
        .filter((key) => typeof record[key] === 'string' && String(record[key]).trim())
        .map((key) => [key, record[key]]),
    );
    if (Object.keys(paths).length > 0) {
      fileChanges.push(paths);
    }
  }
  return fileChanges;
}

export function normalizeTurnStartedEvent({
  turnId,
  threadId,
  raw = null,
}: {
  turnId: string;
  threadId: string;
  raw?: unknown;
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'turn.started',
    turnId,
    threadId,
    raw: compactTurnStartRaw(raw),
  };
}

export function normalizeProgressEvent({
  turnId,
  threadId,
  progress,
}: {
  turnId: string;
  threadId: string;
  progress: ProviderTurnProgress;
}): CodexWebEvent {
  const extendedProgress = progress as ProviderTurnProgress & {
    itemId?: string | null;
    eventType?: 'started' | 'delta' | 'completed';
  };
  const phase = progress.outputKind || null;
  return {
    id: createEventId(),
    type: 'assistant.delta',
    turnId,
    threadId,
    itemId: normalizeRawString(extendedProgress.itemId)
      ?? fallbackAssistantItemId(turnId, phase),
    eventType: extendedProgress.eventType ?? 'delta',
    text: progress.text || '',
    delta: progress.delta || '',
    phase,
    raw: compactProgressRaw(progress),
  };
}

export function normalizeWorkBatchEvents({
  turnId,
  event,
}: {
  turnId: string;
  event: ProviderTurnWorkEvent;
}): CodexWebEvent[] {
  const events: CodexWebEvent[] = [];
  const summary = sanitizeWorkSummary(event.summary ?? {});
  if (event.type === 'started') {
    events.push({
      id: createEventId(),
      type: 'batch.started',
      turnId,
      batchId: event.itemId,
      kind: event.kind,
      title: event.title || workTitleFromEvent(event, summary),
      raw: event.raw ?? event,
    });
    if (Object.keys(summary).length > 0) {
      events.push(createBatchUpdatedEvent({
        turnId,
        batchId: event.itemId,
        summary,
        raw: event.raw ?? event,
      }));
    }
    return events;
  }
  if (Object.keys(summary).length > 0) {
    events.push(createBatchUpdatedEvent({
      turnId,
      batchId: event.itemId,
      summary,
      raw: event.raw ?? event,
    }));
  }
  if (event.type === 'completed') {
    events.push(createBatchCompletedEvent({
      turnId,
      batchId: event.itemId,
      status: event.status || 'completed',
      raw: event.raw ?? event,
    }));
  }
  return events;
}

export function normalizeApprovalEvent({
  turnId,
  request,
}: {
  turnId: string;
  request: ProviderApprovalRequest;
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'approval.requested',
    turnId,
    approvalId: request.requestId,
    approvalKind: request.kind,
    summary: approvalSummary(request),
    raw: request,
  };
}

function sanitizeWorkSummary(summary: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(summary);
  if (entries.every(([, value]) => hasWorkSummaryValue(value))) {
    return summary;
  }
  return Object.fromEntries(entries.filter(([, value]) => hasWorkSummaryValue(value)));
}

function hasWorkSummaryValue(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}

function workTitleFromEvent(
  event: ProviderTurnWorkEvent,
  summary: Record<string, unknown>,
): string {
  if (event.kind === 'command' && typeof summary.command === 'string') {
    return summary.command;
  }
  if (event.kind === 'file_change') {
    const changes = Array.isArray(summary.fileChanges) ? summary.fileChanges : [];
    if (changes.length === 1 && typeof (changes[0] as any)?.path === 'string') {
      return `Edited ${(changes[0] as any).path}`;
    }
    if (changes.length > 1) {
      return `Edited ${changes.length} files`;
    }
  }
  return 'Tool activity';
}

export function normalizeApprovalBatchEvent({
  turnId,
  request,
}: {
  turnId: string;
  request: ProviderApprovalRequest;
}): CodexWebEvent {
  const kind = request.kind === 'permissions' ? 'permission' : request.kind;
  const title = request.command
    || (request.kind === 'file_change' ? `${request.fileChanges?.length ?? 0} file changes` : request.reason)
    || request.kind;
  return {
    id: createEventId(),
    type: 'batch.started',
    turnId,
    batchId: request.itemId || request.requestId,
    kind,
    title,
    raw: request,
  };
}

export function normalizeApprovalBatchUpdatedEvent({
  turnId,
  request,
}: {
  turnId: string;
  request: ProviderApprovalRequest;
}): CodexWebEvent {
  return createBatchUpdatedEvent({
    turnId,
    batchId: request.itemId || request.requestId,
    summary: approvalSummary(request),
    raw: request,
  });
}

export function createBatchUpdatedEvent({
  turnId,
  batchId,
  summary,
  raw = null,
}: {
  turnId: string;
  batchId: string;
  summary: Record<string, unknown>;
  raw?: unknown;
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'batch.updated',
    turnId,
    batchId,
    summary,
    raw,
  };
}

export function createBatchCompletedEvent({
  turnId,
  batchId,
  status,
  raw = null,
}: {
  turnId: string;
  batchId: string;
  status: string;
  raw?: unknown;
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'batch.completed',
    turnId,
    batchId,
    status,
    raw,
  };
}

export function normalizeApprovalResolvedEvent({
  turnId,
  approvalId,
  decision,
}: {
  turnId: string;
  approvalId: string;
  decision: 'accepted' | 'accepted_for_session' | 'denied';
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'approval.resolved',
    turnId,
    approvalId,
    decision,
  };
}

export function normalizeTurnCompletedEvent({
  turnId,
  threadId,
  result,
  itemId = null,
}: {
  turnId: string;
  threadId: string;
  result: Partial<ProviderTurnResult>;
  itemId?: string | null;
}): CodexWebEvent[] {
  const events: CodexWebEvent[] = [];
  const errorDetails = extractErrorDetails(result);
  if (errorDetails) {
    events.push({
      id: createEventId(),
      type: 'turn.failed',
      turnId,
      threadId,
      message: errorDetails,
      details: errorDetails,
    });
    return events;
  }
  if (!isTerminalProviderTurnResult(result)) {
    return events;
  }
  const text = String(result.outputText || result.previewText || '').trim();
  if (text) {
    events.push({
      id: createEventId(),
      type: 'assistant.final',
      turnId,
      threadId,
      itemId: normalizeRawString(itemId) ?? fallbackAssistantItemId(turnId, 'final_answer'),
      eventType: 'completed',
      text,
      delta: '',
      phase: 'final_answer',
    });
  }
  events.push({
    id: createEventId(),
    type: 'turn.completed',
    turnId,
    threadId,
    status: String(result.status || 'completed'),
    raw: compactTurnResultRaw(result),
  });
  return events;
}

export function isTerminalProviderTurnResult(result: Partial<ProviderTurnResult>): boolean {
  if (extractErrorDetails(result)) {
    return true;
  }
  const status = normalizeTurnMarker(result.status);
  if (isTerminalTurnMarker(status)) {
    return true;
  }
  const outputState = normalizeTurnMarker(result.outputState);
  return isTerminalTurnMarker(outputState);
}

export function normalizeTurnFailedEvent({
  turnId,
  threadId = null,
  error,
}: {
  turnId: string;
  threadId?: string | null;
  error: unknown;
}): CodexWebEvent {
  const message = error instanceof Error ? error.message : String(error);
  const details = extractErrorDetails(error);
  return {
    id: createEventId(),
    type: 'turn.failed',
    turnId,
    threadId,
    message,
    details: details && details !== message ? details : null,
  };
}

export function createEventId(): string {
  return `evt_${crypto.randomUUID()}`;
}

function approvalSummary(request: ProviderApprovalRequest): Record<string, unknown> {
  return {
    reason: request.reason ?? null,
    command: request.command ?? null,
    cwd: request.cwd ?? null,
    fileChanges: request.fileChanges ?? [],
    grantRoot: request.grantRoot ?? null,
    networkPermission: request.networkPermission ?? null,
    fileReadPermissions: request.fileReadPermissions ?? [],
    fileWritePermissions: request.fileWritePermissions ?? [],
    availableDecisionKeys: request.availableDecisionKeys ?? [],
    execPolicyAmendment: request.execPolicyAmendment ?? null,
  };
}

function extractErrorDetails(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  return normalizeDetailText(record.details)
    ?? normalizeDetailText(record.rawMessage)
    ?? normalizeDetailText(record.errorMessage)
    ?? normalizeDetailText(record.stderr)
    ?? null;
}

function normalizeDetailText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function isTerminalTurnMarker(value: string): boolean {
  return [
    'completed',
    'complete',
    'succeeded',
    'success',
    'finished',
    'failed',
    'error',
    'timedout',
    'timeout',
    'interrupted',
    'cancelled',
    'canceled',
    'aborted',
    'providererror',
  ].includes(value);
}

function normalizeTurnMarker(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function compactTurnStartRaw(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    turnId: normalizeRawString(record.turnId),
    threadId: normalizeRawString(record.threadId),
    ...(record.recovered === true ? { recovered: true } : {}),
  };
}

function compactProgressRaw(progress: ProviderTurnProgress): Record<string, unknown> {
  const extendedProgress = progress as ProviderTurnProgress & {
    itemId?: string | null;
    eventType?: 'started' | 'delta' | 'completed';
  };
  return {
    itemId: normalizeRawString(extendedProgress.itemId),
    eventType: extendedProgress.eventType ?? null,
    outputKind: progress.outputKind ?? null,
    textLength: String(progress.text || '').length,
    deltaLength: String(progress.delta || '').length,
  };
}

function fallbackAssistantItemId(turnId: string, phase: string | null): string {
  return phase === 'final_answer'
    ? `assistant_${turnId}_final`
    : `assistant_${turnId}_${phase || 'message'}`;
}

function compactTurnResultRaw(result: Partial<ProviderTurnResult>): Record<string, unknown> {
  return {
    status: result.status ?? null,
    outputState: result.outputState ?? null,
    finalSource: result.finalSource ?? null,
    errorMessage: result.errorMessage ?? null,
    threadId: normalizeRawString(result.threadId),
    turnId: normalizeRawString(result.turnId),
  };
}

function normalizeRawString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
