import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ProviderTurnResult,
  ProviderResponseItem,
  ProviderTurnWorkEvent,
} from '../../provider.js';
const MAX_WORK_STREAM_BYTES = 256 * 1024;
const MAX_WORK_DELTA_BYTES = 64 * 1024;
import {
  extractTextCandidate,
  buildArtifactFromFilePath,
  normalizeLegacyImageMedia,
  normalizeEventItemType,
  buildWorkEventEmissionKey,
  extractWorkEventsFromResponseItems,
} from "../projection.js";

export interface SessionTurnCompletionState {
  hasTaskComplete: boolean;
  hasTurnAborted: boolean;
  lastAgentMessage: string | null;
  toolSuggestionMessage: string | null;
  responseItems: ProviderResponseItem[];
  outputArtifacts: Array<{ kind?: string | null; path?: string | null }>;
  runtimeError: string | null;
}

export function inspectTurnCompletionFromSessionPath(sessionPath, turnId) {
  if (!sessionPath || !turnId || !fs.existsSync(sessionPath)) {
    return emptySessionTurnCompletionState();
  }
  try {
    const lines = fs.readFileSync(sessionPath, 'utf8').split('\n');
    let hasTurnAborted = false;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }
      let entry = null;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = entry?.payload ?? null;
      if (
        entry?.type === 'event_msg'
        && payload?.type === 'turn_aborted'
        && String(payload?.turn_id ?? '') === turnId
      ) {
        hasTurnAborted = true;
        continue;
      }
      if (entry?.type !== 'event_msg' || payload?.type !== 'task_complete') {
        continue;
      }
      if (String(payload.turn_id ?? '') !== turnId) {
        continue;
      }
      const responseItems = extractSessionResponseItemsForTurn(lines, index, turnId);
      const lastAgentMessage = selectSessionAgentMessage(
        responseItems,
        extractTextCandidate(payload.last_agent_message)?.trim() || null,
      );
      const toolSuggestionMessage = findSessionToolSuggestionMessageForTurn(lines, index, turnId);
      const runtimeError = findSessionRuntimeErrorForTurn(lines, index, turnId);
      return inspectSessionTurnArtifacts(lines, index, {
        hasTaskComplete: true,
        hasTurnAborted,
        lastAgentMessage,
        toolSuggestionMessage,
        responseItems,
        runtimeError,
      });
    }
    if (hasTurnAborted) {
      return {
        ...emptySessionTurnCompletionState(),
        hasTurnAborted: true,
      };
    }
  } catch {
    return emptySessionTurnCompletionState();
  }
  return emptySessionTurnCompletionState();
}

export function findOpenTurnRuntimeErrorFromSessionPath(sessionPath, turnId): string | null {
  if (!sessionPath || !turnId || !fs.existsSync(sessionPath)) {
    return null;
  }
  try {
    const lines = fs.readFileSync(sessionPath, 'utf8').split('\n');
    return findOpenTurnRuntimeError(lines, turnId);
  } catch {
    return null;
  }
}

export function findSessionToolSuggestionMessageForTurn(lines: string[], taskCompleteIndex: number, turnId: string): string | null {
  for (let index = taskCompleteIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let entry: any = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry?.payload ?? null;
    if (entry?.type === 'turn_context' && String(payload?.turn_id ?? '') === turnId) {
      break;
    }
    if (entry?.type === 'event_msg' && payload?.type === 'task_started' && String(payload?.turn_id ?? '') === turnId) {
      break;
    }
    if (entry?.type !== 'response_item') {
      continue;
    }
    const suggestion = extractToolSuggestResponseItemText(payload);
    if (suggestion) {
      return suggestion;
    }
  }
  return null;
}

export function findSessionRuntimeErrorForTurn(lines: string[], taskCompleteIndex: number, turnId: string): string | null {
  for (let index = taskCompleteIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let entry: any = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry?.payload ?? null;
    if (entry?.type === 'turn_context') {
      if (String(payload?.turn_id ?? '') === turnId) {
        break;
      }
      continue;
    }
    if (entry?.type !== 'event_msg') {
      continue;
    }
    const eventType = String(payload?.type ?? '');
    if (eventType === 'task_started' && String(payload?.turn_id ?? '') === turnId) {
      break;
    }
    if (eventType === 'token_count') {
      const rateLimitError = describeSessionRateLimitError(payload?.rate_limits ?? payload?.rateLimits ?? null);
      if (rateLimitError) {
        return rateLimitError;
      }
    }
    const message = extractSessionErrorMessage(payload);
    if (message) {
      return message;
    }
  }
  return null;
}

export function extractSessionErrorMessage(payload: any): string | null {
  const eventType = String(payload?.type ?? '').toLowerCase();
  if (!/error|failed|failure/.test(eventType)) {
    return null;
  }
  return extractTextCandidate(payload?.message)
    ?? extractTextCandidate(payload?.error)
    ?? extractTextCandidate(payload);
}

export function describeSessionRateLimitError(rateLimits: any): string | null {
  if (!rateLimits || typeof rateLimits !== 'object') {
    return null;
  }
  const limitId = normalizeRateLimitString(rateLimits.limit_id ?? rateLimits.limitId) ?? 'codex';
  const credits = rateLimits.credits && typeof rateLimits.credits === 'object'
    ? rateLimits.credits
    : null;
  if (credits) {
    const hasCredits = normalizeRateLimitBoolean(credits.has_credits ?? credits.hasCredits);
    const unlimited = normalizeRateLimitBoolean(credits.unlimited) === true;
    const balance = normalizeRateLimitString(credits.balance);
    if (hasCredits === false && !unlimited) {
      return `Codex subscription credits are exhausted (${limitId} balance ${balance ?? '0'}).`;
    }
  }
  const reachedType = normalizeRateLimitString(rateLimits.rate_limit_reached_type ?? rateLimits.rateLimitReachedType);
  if (reachedType) {
    return `Codex usage limit reached (${limitId}: ${reachedType}).`;
  }
  const primaryUsed = normalizeRateLimitNumber(rateLimits.primary?.used_percent ?? rateLimits.primary?.usedPercent);
  if (primaryUsed !== null && primaryUsed >= 100) {
    return `Codex usage limit reached (${limitId} primary ${Math.round(primaryUsed)}%).`;
  }
  const secondaryUsed = normalizeRateLimitNumber(rateLimits.secondary?.used_percent ?? rateLimits.secondary?.usedPercent);
  if (secondaryUsed !== null && secondaryUsed >= 100) {
    return `Codex usage limit reached (${limitId} weekly ${Math.round(secondaryUsed)}%).`;
  }
  return null;
}

export function inspectSessionTurnArtifacts(
  lines,
  taskCompleteIndex,
  state: Omit<SessionTurnCompletionState, 'outputArtifacts'>,
): SessionTurnCompletionState {
  const outputArtifacts = [];
  const seenArtifacts = new Set<string>();
  for (let index = taskCompleteIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let entry = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry?.payload ?? null;
    if (entry?.type === 'event_msg' && payload?.type === 'task_started') {
      break;
    }
    if (entry?.type !== 'event_msg' || payload?.type !== 'image_generation_end') {
      continue;
    }
    const savedPath = typeof payload?.saved_path === 'string' ? payload.saved_path.trim() : '';
    if (!savedPath || !fs.existsSync(savedPath)) {
      continue;
    }
    const artifact = buildArtifactFromFilePath(savedPath);
    const key = `${artifact.kind}:${artifact.path}`;
    if (seenArtifacts.has(key)) {
      continue;
    }
    seenArtifacts.add(key);
    outputArtifacts.unshift(artifact);
  }
  return {
    hasTaskComplete: state.hasTaskComplete,
    hasTurnAborted: state.hasTurnAborted,
    lastAgentMessage: state.lastAgentMessage || state.toolSuggestionMessage || null,
    toolSuggestionMessage: state.toolSuggestionMessage ?? null,
    responseItems: state.responseItems,
    runtimeError: state.runtimeError ?? null,
    outputArtifacts,
  };
}

export function buildSessionTaskCompleteResult({
  turnId,
  threadId,
  title,
  status,
  previewText,
  sessionState,
}) {
  return {
    turnId,
    threadId,
    title,
    outputText: sessionState.lastAgentMessage ?? '',
    responseItems: sessionState.responseItems,
    outputArtifacts: sessionState.outputArtifacts,
    outputMedia: normalizeLegacyImageMedia(sessionState.outputArtifacts),
    outputState: 'complete',
    previewText,
    finalSource: sessionState.outputArtifacts.length > 0
      ? 'session_task_complete_media'
      : 'session_task_complete',
    status,
  };
}

export function shouldWaitForSessionTaskMaterialization(sessionState, hasAssistantVisibleItems) {
  return sessionState.hasTaskComplete
    && !hasAssistantVisibleItems
    && !sessionState.lastAgentMessage
    && sessionState.outputArtifacts.length === 0;
}

export function emptySessionTurnCompletionState(): SessionTurnCompletionState {
  return {
    hasTaskComplete: false,
    hasTurnAborted: false,
    lastAgentMessage: null,
    toolSuggestionMessage: null,
    responseItems: [],
    outputArtifacts: [],
    runtimeError: null,
  };
}

export function extractSessionResponseItemsForTurn(
  lines: string[],
  taskCompleteIndex: number,
  turnId: string,
): ProviderResponseItem[] {
  const responseItems: ProviderResponseItem[] = [];
  for (let index = taskCompleteIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let entry: any = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry?.payload ?? null;
    if (entry?.type === 'turn_context' && String(payload?.turn_id ?? '') === turnId) {
      break;
    }
    if (entry?.type === 'event_msg' && payload?.type === 'task_started' && String(payload?.turn_id ?? '') === turnId) {
      break;
    }
    if (entry?.type !== 'response_item' || !payload || typeof payload !== 'object') {
      continue;
    }
    responseItems.unshift(cloneSessionResponseItem(payload));
  }
  return responseItems;
}

export function selectSessionAgentMessage(
  responseItems: ProviderResponseItem[],
  fallback: string | null,
): string | null {
  for (let index = responseItems.length - 1; index >= 0; index -= 1) {
    const payload = responseItems[index] as Record<string, unknown>;
    if (String(payload?.type ?? '') !== 'message' || String(payload?.role ?? '') !== 'assistant') {
      continue;
    }
    const phase = String(payload?.phase ?? '');
    if (phase && phase !== 'final_answer') {
      continue;
    }
    const text = extractTextCandidate(payload?.content)?.trim() || null;
    if (text) {
      return text;
    }
  }
  return fallback;
}

export function cloneSessionResponseItem(payload: Record<string, unknown>): ProviderResponseItem {
  const cloned: ProviderResponseItem = typeof structuredClone === 'function'
    ? structuredClone(payload)
    : JSON.parse(JSON.stringify(payload));
  if (normalizeEventItemType(cloned) === 'reasoning') {
    delete cloned.content;
    delete cloned.encrypted_content;
    delete cloned.encryptedContent;
  }
  return cloned;
}

export function attachSessionResponseItems(
  result: ProviderTurnResult,
  sessionPath: string | null | undefined,
): ProviderTurnResult {
  if (!result.turnId || !sessionPath) {
    return result;
  }
  const sessionState = inspectTurnCompletionFromSessionPath(sessionPath, result.turnId);
  if (sessionState.responseItems.length === 0) {
    return result;
  }
  return {
    ...result,
    responseItems: sessionState.responseItems,
  };
}

export function emitWorkEventsFromSessionPath({
  sessionPath,
  turnId,
  onWorkEvent,
  emittedKeys,
}: {
  sessionPath: string | null | undefined;
  turnId: string;
  onWorkEvent?: ((event: ProviderTurnWorkEvent) => Promise<void> | void) | null;
  emittedKeys: Set<string>;
}): void {
  if (typeof onWorkEvent !== 'function') {
    return;
  }
  for (const event of extractWorkEventsFromSessionPath(sessionPath, turnId)) {
    const key = buildWorkEventEmissionKey(event);
    if (emittedKeys.has(key)) {
      continue;
    }
    emittedKeys.add(key);
    void onWorkEvent(event);
  }
}

export function extractWorkEventsFromSessionPath(
  sessionPath: string | null | undefined,
  turnId: string,
): ProviderTurnWorkEvent[] {
  if (!sessionPath || !turnId || !fs.existsSync(sessionPath)) {
    return [];
  }
  try {
    const lines = fs.readFileSync(sessionPath, 'utf8').split('\n');
    return extractWorkEventsFromResponseItems(extractSessionResponseItemsForOpenTurn(lines, turnId));
  } catch {
    return [];
  }
}

export function extractSessionResponseItemsForOpenTurn(lines: string[], turnId: string): ProviderResponseItem[] {
  let startIndex = -1;
  let endIndex = lines.length;
  let taskCompleteIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const entry = parseSessionLine(lines[index]);
    if (!entry) {
      continue;
    }
    const payload = entry.payload ?? null;
    if (isSessionTurnStartBoundary(entry, turnId)) {
      startIndex = index;
      endIndex = lines.length;
      continue;
    }
    if (entry.type === 'event_msg' && payload?.type === 'task_complete' && String(payload?.turn_id ?? '') === turnId) {
      taskCompleteIndex = index;
      if (startIndex >= 0) {
        endIndex = index;
        break;
      }
      continue;
    }
    if (startIndex >= 0 && isSessionAnyTurnBoundary(entry)) {
      endIndex = index;
      break;
    }
  }
  if (startIndex < 0) {
    return taskCompleteIndex >= 0
      ? extractSessionResponseItemsForTurn(lines, taskCompleteIndex, turnId)
      : [];
  }
  const responseItems: ProviderResponseItem[] = [];
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const entry = parseSessionLine(lines[index]);
    const payload = entry?.payload ?? null;
    if (entry?.type !== 'response_item' || !payload || typeof payload !== 'object') {
      continue;
    }
    responseItems.push(cloneSessionResponseItem(payload));
  }
  return responseItems;
}

export function parseSessionLine(line: string | undefined): any | null {
  const text = line?.trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function isSessionTurnStartBoundary(entry: any, turnId: string): boolean {
  const payload = entry?.payload ?? null;
  if (entry?.type === 'turn_context') {
    return String(payload?.turn_id ?? '') === turnId;
  }
  return entry?.type === 'event_msg'
    && payload?.type === 'task_started'
    && String(payload?.turn_id ?? '') === turnId;
}

export function isSessionAnyTurnBoundary(entry: any): boolean {
  const payload = entry?.payload ?? null;
  return entry?.type === 'turn_context'
    || (
      entry?.type === 'event_msg'
      && (payload?.type === 'task_started' || payload?.type === 'task_complete')
    );
}

export function findOpenTurnRuntimeError(lines: string[], turnId: string): string | null {
  let inTurn = false;
  let runtimeError: string | null = null;
  for (const line of lines) {
    const entry = parseSessionLine(line);
    if (!entry) {
      continue;
    }
    const payload = entry.payload ?? null;
    if (isSessionTurnStartBoundary(entry, turnId)) {
      inTurn = true;
      runtimeError = null;
      continue;
    }
    if (!inTurn) {
      continue;
    }
    if (entry.type === 'event_msg' && payload?.type === 'task_complete' && String(payload?.turn_id ?? '') === turnId) {
      return null;
    }
    if (isSessionAnyTurnBoundary(entry)) {
      return runtimeError;
    }
    if (entry.type !== 'event_msg') {
      continue;
    }
    if (String(payload?.type ?? '') === 'token_count') {
      runtimeError = describeSessionRateLimitError(payload?.rate_limits ?? payload?.rateLimits ?? null) ?? runtimeError;
      continue;
    }
    runtimeError = extractSessionErrorMessage(payload) ?? runtimeError;
  }
  return runtimeError;
}

export function extractToolSuggestResponseItemText(payload: any): string | null {
  if (String(payload?.type ?? '') !== 'function_call' || String(payload?.name ?? '') !== 'tool_suggest') {
    return null;
  }
  let parsedArguments: any = null;
  if (typeof payload?.arguments === 'string') {
    try {
      parsedArguments = JSON.parse(payload.arguments);
    } catch {
      parsedArguments = null;
    }
  } else if (payload?.arguments && typeof payload.arguments === 'object') {
    parsedArguments = payload.arguments;
  }
  const reason = extractTextCandidate(parsedArguments?.suggest_reason)?.trim() || '';
  const toolType = String(parsedArguments?.tool_type ?? '').trim().toLowerCase();
  if (!reason) {
    return null;
  }
  const prefix = toolType === 'connector'
    ? '当前缺少所需连接。'
    : toolType === 'plugin'
      ? '当前缺少所需插件。'
      : '当前缺少所需扩展能力。';
  return `${prefix}\n${reason}\n请先完成对应的安装或认证，再重试原请求。`;
}

export function normalizeRateLimitString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function normalizeRateLimitNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeRateLimitBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return null;
}
