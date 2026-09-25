import fs from 'node:fs/promises';
import type { CodexWebTurnSnapshot, CodexWebTurnSnapshotItem } from '../runtime.js';

// Compatibility for historical/unmaterialized thread items observed with 0.153.x.
// Official thread/turn state always wins. Remove after supported versions reliably
// materialize missing final-answer items (runtime.test.ts covers the old gap).
export async function readRolloutTurnSnapshot(
  rolloutPath: string | null | undefined,
  turnId: string,
): Promise<CodexWebTurnSnapshot | null> {
  const normalizedPath = normalizeString(rolloutPath);
  const normalizedTurnId = normalizeString(turnId);
  if (!normalizedPath || !normalizedTurnId) {
    return null;
  }
  let lines: string[];
  try {
    lines = (await fs.readFile(normalizedPath, 'utf8')).split('\n');
  } catch {
    return null;
  }
  let currentTurnId = '';
  let matchedTurn = false;
  let status: string | null = null;
  let finalItem: CodexWebTurnSnapshotItem | null = null;
  for (const line of lines) {
    const entry = parseArchivedSessionLine(line);
    if (!entry) {
      continue;
    }
    const payload = isArchivedRecord(entry.payload) ? entry.payload : null;
    if (!payload) {
      continue;
    }
    const boundaryTurnId = rolloutTurnStartId(entry.type, payload);
    if (boundaryTurnId) {
      currentTurnId = boundaryTurnId;
      if (boundaryTurnId === normalizedTurnId) {
        matchedTurn = true;
        if (entry.type === 'event_msg' && payload.type === 'task_started') {
          status = 'running';
        }
      }
      continue;
    }
    if (entry.type === 'event_msg' && payload.type === 'task_complete') {
      const completedTurnId = normalizeString(payload.turn_id) || currentTurnId;
      if (completedTurnId === normalizedTurnId) {
        matchedTurn = true;
        status = 'completed';
      }
      continue;
    }
    if (entry.type !== 'response_item') {
      continue;
    }
    // The rollout boundary identifies the provider turn. Response metadata can
    // carry an internal child turn id, so only use it when no outer boundary is
    // available for the current response item.
    const itemTurnId = currentTurnId || rolloutResponseItemTurnId(payload);
    if (itemTurnId !== normalizedTurnId) {
      continue;
    }
    matchedTurn = true;
    if (normalizeString(payload.type).toLowerCase() !== 'message'
      || normalizeString(payload.role).toLowerCase() !== 'assistant'
      || normalizeString(payload.phase).toLowerCase().replace(/[\s-]+/gu, '_') !== 'final_answer') {
      continue;
    }
    const content = normalizeTurnSnapshotOutputTextContent(payload.content);
    if (!content.length) {
      continue;
    }
    finalItem = {
      id: normalizeString(payload.id) || null,
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      text: content.map((part) => part.text).join('\n\n'),
      content,
    };
  }
  return matchedTurn
    ? {
        id: normalizedTurnId,
        status,
        error: null,
        items: finalItem ? [finalItem] : [],
      }
    : null;
}

function rolloutTurnStartId(type: unknown, payload: Record<string, unknown>): string {
  if (type === 'turn_context') {
    return normalizeString(payload.turn_id);
  }
  return type === 'event_msg' && payload.type === 'task_started'
    ? normalizeString(payload.turn_id)
    : '';
}

function rolloutResponseItemTurnId(payload: Record<string, unknown>): string {
  const metadata = isArchivedRecord(payload.internal_chat_message_metadata_passthrough)
    ? payload.internal_chat_message_metadata_passthrough
    : isArchivedRecord(payload.internalChatMessageMetadataPassthrough)
      ? payload.internalChatMessageMetadataPassthrough
      : null;
  return normalizeString(metadata?.turn_id)
    || normalizeString(metadata?.turnId)
    || normalizeString(payload.turn_id)
    || normalizeString(payload.turnId);
}

export function normalizeTurnSnapshotOutputTextContent(value: unknown): Array<{
  type: string;
  text: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((part) => {
    if (!isArchivedRecord(part) || normalizeString(part.type).toLowerCase() !== 'output_text') {
      return [];
    }
    const text = normalizeString(part.text);
    return text ? [{ type: 'output_text', text }] : [];
  });
}

function normalizeString(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function isArchivedRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function parseArchivedSessionLine(line: string): Record<string, unknown> | null {
  try { const value: unknown = JSON.parse(line); return isArchivedRecord(value) ? value : null; } catch { return null; }
}

export function needsRolloutFinal(items: CodexWebTurnSnapshotItem[]): boolean {
  if (items.some((item) => item.role === 'assistant' && item.phase === 'final_answer' && (item.text?.trim() || item.content?.some((part) => part.type === 'output_text' && part.text?.trim())))) return false;
  return !items.length || items.every((item) => ['message', 'function_call', 'function_call_output', 'reasoning', 'custom_tool_call', 'custom_tool_call_output'].includes(item.type));
}
