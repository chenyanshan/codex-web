import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ProviderTurnWorkEvent,
  ProviderTurnWorkEventKind,
} from '../provider.js';
const MAX_WORK_STREAM_BYTES = 256 * 1024;
const MAX_WORK_DELTA_BYTES = 64 * 1024;

export function normalizeEventItemType(item) {
  return String(item?.type ?? '').replace(/[^a-z]/gi, '').toLowerCase();
}

export function extractTextCandidate(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  for (const key of ['text', 'delta', 'content', 'value', 'message']) {
    if (typeof value[key] === 'string') {
      return value[key];
    }
  }
  for (const key of ['parts', 'segments', 'content']) {
    const candidate = value[key];
    if (!Array.isArray(candidate)) {
      continue;
    }
    const text = candidate
      .map((entry) => extractTextCandidate(entry))
      .filter((entry) => typeof entry === 'string')
      .join('');
    if (text) {
      return text;
    }
  }
  return null;
}

export function buildArtifactFromFilePath(filePath) {
  const normalizedPath = String(filePath ?? '').trim();
  const kind = inferArtifactKindFromPath(normalizedPath);
  let sizeBytes = null;
  try {
    sizeBytes = fs.statSync(normalizedPath).size;
  } catch {
    sizeBytes = null;
  }
  return {
    kind,
    path: normalizedPath,
    displayName: path.basename(normalizedPath) || null,
    mimeType: inferMimeTypeFromPath(normalizedPath),
    sizeBytes,
    caption: null,
    source: 'provider_native' as const,
    turnId: null,
  };
}

export function inferArtifactKindFromPath(filePath) {
  const extension = path.extname(String(filePath ?? '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(extension)) {
    return 'image';
  }
  if (['.mp4', '.mov', '.mkv', '.webm'].includes(extension)) {
    return 'video';
  }
  if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.amr'].includes(extension)) {
    return 'audio';
  }
  return 'file';
}

export function inferMimeTypeFromPath(filePath) {
  const extension = path.extname(String(filePath ?? '')).toLowerCase();
  return ({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.html': 'text/html',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.tgz': 'application/gzip',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
  })[extension] ?? null;
}

export function normalizeLegacyImageMedia(artifacts) {
  return artifacts.filter((artifact) => artifact?.kind === 'image');
}

export function extractWorkEventsFromResponseItems(items: any[]): ProviderTurnWorkEvent[] {
  const startedByItemId = new Map<string, ProviderTurnWorkEvent>();
  const events: ProviderTurnWorkEvent[] = [];
  for (const item of items) {
    const extracted = extractWorkEventFromTurnItem(item, startedByItemId);
    if (!extracted) {
      continue;
    }
    const itemEvents = Array.isArray(extracted) ? extracted : [extracted];
    for (const event of itemEvents) {
      events.push(event);
      if (event.type === 'started') {
        startedByItemId.set(event.itemId, event);
      }
    }
  }
  return events;
}

export function extractWorkEventFromTurnItem(
  item: any,
  startedByItemId: Map<string, ProviderTurnWorkEvent>,
): ProviderTurnWorkEvent | ProviderTurnWorkEvent[] | null {
  if (!item || typeof item !== 'object' || isAssistantVisibleItem(item) || isUserVisibleItem(item)) {
    return null;
  }
  const itemType = normalizeEventItemType(item);
  const responseToolItem = itemType === 'functioncall'
    || itemType === 'customtoolcall'
    || itemType === 'functioncalloutput'
    || itemType === 'customtoolcalloutput';
  const itemId = responseToolItem
    ? extractToolCallCorrelationId(item)
    : extractItemId(item);
  if (!itemId) {
    return null;
  }
  if (itemType === 'functioncall' || itemType === 'customtoolcall') {
    const summary = buildWorkSummary(item, item);
    const kind = classifyWorkEventKind(item, item);
    if (kind === 'unknown' && Object.keys(summary).length === 0) {
      return null;
    }
    return {
      type: 'started',
      itemId,
      kind,
      title: buildWorkTitle(kind, item, summary),
      status: normalizeNullableString(item?.status),
      summary,
      raw: item,
    };
  }
  if (itemType === 'functioncalloutput' || itemType === 'customtoolcalloutput') {
    const previous = startedByItemId.get(itemId);
    const summary = buildWorkSummary(item, item);
    const kind = previous?.kind ?? classifyWorkEventKind(item, item);
    if (kind === 'unknown' && Object.keys(summary).length === 0) {
      return null;
    }
    return {
      type: 'completed',
      itemId,
      kind,
      title: previous?.title ?? buildWorkTitle(kind, item, summary),
      status: normalizeNullableString(item?.status) ?? 'completed',
      summary,
      raw: item,
    };
  }
  if (itemType === 'commandexecution' || itemType === 'filechange') {
    const summary = buildWorkSummary(item, item);
    const kind = itemType === 'commandexecution' ? 'command' : 'file_change';
    const status = normalizeNullableString(item?.status);
    const title = buildWorkTitle(kind, item, summary);
    const events: ProviderTurnWorkEvent[] = [{
      type: 'started',
      itemId,
      kind,
      title,
      status,
      summary: {},
      raw: item,
    }, {
      type: 'updated',
      itemId,
      kind,
      title,
      status,
      summary,
      raw: item,
    }];
    if (isCompletedWorkItemStatus(status)) {
      events.push({
        type: 'completed',
        itemId,
        kind,
        title,
        status,
        summary,
        raw: item,
      });
    }
    return events;
  }
  return null;
}

export function isAssistantVisibleItem(item) {
  const itemType = normalizeEventItemType(item);
  if (itemType === 'agentmessage' || itemType === 'assistantmessage') {
    return true;
  }
  return itemType === 'message' && normalizeEventItemRole(item) === 'assistant';
}

export function normalizeEventItemRole(item) {
  return String(item?.role ?? '').replace(/[^a-z]/gi, '').toLowerCase();
}

export function isUserVisibleItem(item) {
  const itemType = normalizeEventItemType(item);
  if (itemType.includes('user')) {
    return true;
  }
  return itemType === 'message' && normalizeEventItemRole(item) === 'user';
}

export function extractToolCallCorrelationId(...values: any[]): string | null {
  for (const value of values) {
    const callId = normalizeNullableString(
      value?.call_id
        ?? value?.callId
        ?? value?.item?.call_id
        ?? value?.item?.callId,
    );
    if (callId) {
      return callId;
    }
  }
  for (const value of values) {
    const itemId = extractItemId(value);
    if (itemId) {
      return itemId;
    }
  }
  return null;
}

export function normalizeNullableString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function extractItemId(value) {
  const candidates = [
    value?.itemId,
    value?.item_id,
    value?.id,
    value?.call_id,
    value?.callId,
    value?.item?.id,
    value?.item?.call_id,
    value?.item?.callId,
  ];
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate);
    }
  }
  return null;
}

export function buildWorkSummary(item, params): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const itemArguments = parseToolArguments(item);
  const paramsArguments = parseToolArguments(params);
  const command = extractCommandValue(item)
    ?? extractCommandValue(params)
    ?? extractCommandValue(itemArguments)
    ?? extractCommandValue(paramsArguments);
  if (command) {
    summary.command = command;
  }
  const cwd = normalizeNullableString(
    item?.cwd
      ?? item?.workingDirectory
      ?? item?.working_directory
      ?? params?.cwd
      ?? itemArguments?.cwd
      ?? itemArguments?.workdir
      ?? itemArguments?.workingDirectory
      ?? itemArguments?.working_directory
      ?? paramsArguments?.cwd
      ?? paramsArguments?.workdir
      ?? paramsArguments?.workingDirectory
      ?? paramsArguments?.working_directory,
  );
  if (cwd) {
    summary.cwd = cwd;
  }
  const output = extractWorkOutputValue(item)
    ?? extractWorkOutputValue(params)
    ?? extractWorkOutputValue(itemArguments)
    ?? extractWorkOutputValue(paramsArguments);
  if (output) {
    summary.output = output;
  }
  const exitCode = extractNumericValue(item, ['exitCode', 'exit_code', 'code'])
    ?? extractNumericValue(params, ['exitCode', 'exit_code', 'code'])
    ?? extractNumericValue(itemArguments, ['exitCode', 'exit_code', 'code'])
    ?? extractNumericValue(paramsArguments, ['exitCode', 'exit_code', 'code']);
  if (exitCode !== null) {
    summary.exitCode = exitCode;
  }
  const patchText = extractPatchText(item) ?? extractPatchText(params) ?? extractPatchText(itemArguments) ?? extractPatchText(paramsArguments);
  const fileChanges = firstNonEmptyFileChanges([
    extractFileChangesValue(item),
    extractFileChangesValue(params),
    extractFileChangesValue(itemArguments),
    extractFileChangesValue(paramsArguments),
    extractFileChangesFromPatch(patchText),
  ]);
  if (fileChanges.length) {
    summary.fileChanges = fileChanges;
  }
  const diff = normalizeNullableString(item?.diff ?? item?.patch ?? params?.diff ?? params?.patch ?? itemArguments?.diff ?? itemArguments?.patch ?? paramsArguments?.diff ?? paramsArguments?.patch ?? patchText);
  if (diff) {
    summary.diff = diff;
  }
  const pathValue = normalizeNullableString(item?.path ?? item?.file ?? params?.path ?? params?.file ?? itemArguments?.path ?? itemArguments?.file ?? paramsArguments?.path ?? paramsArguments?.file);
  if (pathValue) {
    summary.path = pathValue;
  }
  const status = normalizeNullableString(item?.status ?? params?.status);
  if (status) {
    summary.status = status;
  }
  const error = extractStructuredString(item?.error ?? params?.error);
  if (error) {
    summary.error = error;
  }
  return summary;
}

export function parseToolArguments(value): any | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value?.arguments ?? value?.args_json ?? value?.argumentsJson ?? value?.item?.arguments;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function extractCommandValue(value): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (Array.isArray(value?.command)) {
    const command = value.command.map((entry) => String(entry ?? '').trim()).filter(Boolean).join(' ');
    return command || null;
  }
  if (Array.isArray(value?.cmd)) {
    const command = value.cmd.map((entry) => String(entry ?? '').trim()).filter(Boolean).join(' ');
    return command || null;
  }
  if (Array.isArray(value?.args) && typeof value?.cmd === 'string') {
    const command = [value.cmd, ...value.args].map((entry) => String(entry ?? '').trim()).filter(Boolean).join(' ');
    return command || null;
  }
  return normalizeNullableString(value?.command ?? value?.cmd);
}

export function extractWorkOutputValue(value): string | null {
  for (const candidate of [
    value?.output,
    value?.aggregatedOutput,
    value?.aggregated_output,
    value?.stdout,
    value?.stderr,
    value?.text,
    value?.content,
    value?.result?.output,
  ]) {
    const direct = extractStructuredString(candidate);
    if (direct) {
      return direct;
    }
  }
  if (Array.isArray(value?.outputs)) {
    const output = value.outputs
      .map((entry) => extractStructuredString(entry))
      .filter(Boolean)
      .join('\n');
    return output || null;
  }
  return null;
}

export function extractStructuredString(value) {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (Array.isArray(value)) {
    const text = value
      .map((entry) => extractStructuredString(entry))
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .join('\n');
    return text || null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  return extractTextCandidate(value) ?? extractTextCandidate(value?.message) ?? extractTextCandidate(value?.error);
}

export function extractNumericValue(value, keys: string[]): number | null {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string' && candidate.trim() && Number.isFinite(Number(candidate))) {
      return Number(candidate);
    }
  }
  return null;
}

export function extractPatchText(value): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const direct = normalizeNullableString(value?.patch ?? value?.diff ?? value?.changeset ?? value?.item?.patch ?? value?.item?.diff);
  if (direct) {
    return direct;
  }
  const candidates = [
    value?.arguments,
    value?.input,
    value?.item?.arguments,
    value?.item?.input,
  ];
  for (const candidate of candidates) {
    const patch = extractEmbeddedPatchPayload(candidate);
    if (patch) {
      return patch;
    }
  }
  return null;
}

export function extractEmbeddedPatchPayload(value): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const start = value.indexOf('*** Begin Patch');
  if (start < 0) {
    return null;
  }
  const marker = '*** End Patch';
  const end = value.indexOf(marker, start);
  if (end < 0) {
    return null;
  }
  const payload = value.slice(start, end + marker.length);
  return payload.includes('\n') ? payload : decodeEscapedPatchPayload(payload);
}

export function decodeEscapedPatchPayload(value: string): string {
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character !== '\\' || index + 1 >= value.length) {
      decoded += character;
      continue;
    }
    const escape = value[index + 1]!;
    if (escape === 'n') {
      decoded += '\n';
      index += 1;
    } else if (escape === 'r') {
      decoded += '\r';
      index += 1;
    } else if (escape === 't') {
      decoded += '\t';
      index += 1;
    } else if (escape === '"' || escape === "'" || escape === '\\') {
      decoded += escape;
      index += 1;
    } else {
      decoded += character;
    }
  }
  return decoded;
}

export function firstNonEmptyFileChanges(groups: Array<Array<Record<string, unknown>>>): Array<Record<string, unknown>> {
  for (const group of groups) {
    if (Array.isArray(group) && group.length > 0) {
      return group;
    }
  }
  return [];
}

export function extractFileChangesValue(value): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const raw = value?.fileChanges ?? value?.file_changes ?? value?.changes ?? value?.files;
  if (Array.isArray(raw)) {
    return raw.map(normalizeFileChange).filter(Boolean) as Array<Record<string, unknown>>;
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw)
      .map(([pathValue, change]) => normalizeFileChange({ path: pathValue, ...(change && typeof change === 'object' ? change : {}) }))
      .filter(Boolean) as Array<Record<string, unknown>>;
  }
  const pathValue = normalizeNullableString(value?.path ?? value?.file);
  if (!pathValue) {
    return [];
  }
  return [normalizeFileChange(value) ?? { path: pathValue }];
}

export function normalizeFileChange(value): Record<string, unknown> | null {
  if (typeof value === 'string') {
    return { path: value };
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const pathValue = normalizeNullableString(value?.path ?? value?.file ?? value?.target ?? value?.source);
  if (!pathValue) {
    return null;
  }
  const change: Record<string, unknown> = { path: pathValue };
  const kind = value?.kind && typeof value.kind === 'object' ? value.kind : null;
  const kindType = normalizeNullableString(kind?.type ?? (typeof value?.kind === 'string' ? value.kind : null));
  const action = normalizeFileChangeAction(
    normalizeNullableString(value?.action ?? kindType ?? value?.type ?? value?.status),
  );
  if (action) {
    change.action = action;
  }
  if (kindType) {
    change.kind = kindType;
  }
  const movePath = normalizeNullableString(kind?.move_path ?? kind?.movePath ?? value?.move_path ?? value?.movePath);
  if (movePath) {
    change.movePath = movePath;
  }
  const diff = typeof value?.diff === 'string' ? value.diff : null;
  if (diff !== null) {
    change.diff = diff;
  }
  const additions = extractNumericValue(value, ['additions', 'added', 'linesAdded']);
  if (additions !== null) {
    change.additions = additions;
  }
  const deletions = extractNumericValue(value, ['deletions', 'deleted', 'linesDeleted']);
  if (deletions !== null) {
    change.deletions = deletions;
  }
  return change;
}

export function normalizeFileChangeAction(value: string | null): string | null {
  const normalized = String(value ?? '').replace(/[^a-z]/giu, '').toLowerCase();
  if (normalized === 'add' || normalized === 'added' || normalized === 'create' || normalized === 'created') {
    return 'added';
  }
  if (normalized === 'delete' || normalized === 'deleted' || normalized === 'remove' || normalized === 'removed') {
    return 'deleted';
  }
  if (normalized === 'update' || normalized === 'updated' || normalized === 'modify' || normalized === 'modified') {
    return 'modified';
  }
  return value;
}

export function extractFileChangesFromPatch(value: string | null): Array<Record<string, unknown>> {
  if (!value) {
    return [];
  }
  const changes = new Map<string, Record<string, unknown>>();
  for (const line of value.split(/\r?\n/u)) {
    const match = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/u);
    if (!match) {
      continue;
    }
    const pathValue = match[1]?.trim();
    if (!pathValue) {
      continue;
    }
    const action = line.startsWith('*** Add File:')
      ? 'added'
      : line.startsWith('*** Delete File:')
        ? 'deleted'
        : 'modified';
    changes.set(pathValue, { path: pathValue, action });
  }
  return [...changes.values()];
}

export function classifyWorkEventKind(item, params): ProviderTurnWorkEventKind {
  const toolName = extractToolName(item) ?? extractToolName(params);
  const parsedToolArguments = parseToolArguments(item) ?? parseToolArguments(params);
  if (hasEmbeddedApplyPatchCall(item) || hasEmbeddedApplyPatchCall(params)) {
    return 'file_change';
  }
  const typeText = [
    item?.type,
    item?.kind,
    item?.name,
    item?.toolName,
    item?.tool_name,
    params?.type,
    params?.kind,
    params?.method,
  ]
    .map((entry) => String(entry ?? ''))
    .join(' ')
    .toLowerCase();
  if (
    isCommandToolName(toolName)
    || typeText.includes('command')
    || typeText.includes('exec')
    || typeText.includes('shell')
    || hasAnyOwnProperty(item, ['command', 'cmd', 'args', 'argv'])
    || hasAnyOwnProperty(params, ['command', 'cmd'])
    || hasAnyOwnProperty(parsedToolArguments, ['command', 'cmd', 'args', 'argv'])
  ) {
    return 'command';
  }
  if (
    isFileChangeToolName(toolName)
    || typeText.includes('file')
    || typeText.includes('patch')
    || typeText.includes('diff')
    || hasAnyOwnProperty(item, ['fileChanges', 'file_changes', 'changes', 'diff', 'patch', 'path'])
    || hasAnyOwnProperty(params, ['fileChanges', 'file_changes', 'changes', 'diff', 'patch', 'path'])
    || hasAnyOwnProperty(parsedToolArguments, ['fileChanges', 'file_changes', 'changes', 'diff', 'patch', 'path'])
    || extractPatchText(item)
    || extractPatchText(params)
  ) {
    return 'file_change';
  }
  if (typeText.includes('permission') || typeText.includes('approval')) {
    return 'permission';
  }
  return 'unknown';
}

export function extractToolName(value): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return normalizeNullableString(value?.name ?? value?.toolName ?? value?.tool_name ?? value?.item?.name ?? value?.item?.toolName ?? value?.item?.tool_name);
}

export function hasEmbeddedApplyPatchCall(value): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  for (const candidate of [value?.arguments, value?.input, value?.item?.arguments, value?.item?.input]) {
    if (typeof candidate === 'string' && /\btools\s*\.\s*apply_patch\s*\(/u.test(candidate)) {
      return true;
    }
  }
  return false;
}

export function isCommandToolName(value: string | null): boolean {
  const normalized = normalizeToolName(value);
  return normalized === 'execcommand'
    || normalized === 'exec'
    || normalized === 'shell'
    || normalized === 'bash'
    || normalized === 'command';
}

export function normalizeToolName(value: string | null): string {
  return String(value ?? '').replace(/[^a-z]/giu, '').toLowerCase();
}

export function hasAnyOwnProperty(value, keys: string[]): boolean {
  return Boolean(value && typeof value === 'object' && keys.some((key) => Object.prototype.hasOwnProperty.call(value, key)));
}

export function isFileChangeToolName(value: string | null): boolean {
  const normalized = normalizeToolName(value);
  return normalized === 'applypatch'
    || normalized === 'patch'
    || normalized === 'edit'
    || normalized === 'filechange'
    || normalized === 'writefile';
}

export function buildWorkTitle(
  kind: ProviderTurnWorkEventKind,
  item,
  summary: Record<string, unknown>,
): string {
  const explicit = normalizeNullableString(item?.title ?? item?.name ?? item?.label);
  if (explicit && !(kind === 'file_change' && normalizeToolName(explicit) === 'exec')) {
    return explicit;
  }
  if (kind === 'command' && typeof summary.command === 'string' && summary.command.trim()) {
    return summary.command;
  }
  if (kind === 'file_change') {
    const changes = Array.isArray(summary.fileChanges) ? summary.fileChanges : [];
    if (changes.length === 1) {
      const pathValue = normalizeNullableString((changes[0] as any)?.path);
      if (pathValue) {
        return `Edited ${pathValue}`;
      }
    }
    if (changes.length > 1) {
      return `Edited ${changes.length} files`;
    }
    if (typeof summary.path === 'string' && summary.path.trim()) {
      return `Edited ${summary.path}`;
    }
  }
  if (kind === 'permission') {
    return 'Permission request';
  }
  return 'Tool activity';
}

export function isCompletedWorkItemStatus(status: string | null): boolean {
  const normalized = String(status ?? '').replace(/[^a-z]/giu, '').toLowerCase();
  return ['completed', 'complete', 'failed', 'declined', 'cancelled', 'canceled'].includes(normalized);
}

export function buildWorkEventEmissionKey(event: ProviderTurnWorkEvent): string {
  return `${event.itemId}:${event.type}:${JSON.stringify(event.summary ?? {})}`;
}
