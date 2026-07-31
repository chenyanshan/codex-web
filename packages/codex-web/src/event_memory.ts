import type { CodexWebEvent } from './event_model.js';

export const DEFAULT_MAX_EVENT_BYTES = 512 * 1024;
export const DEFAULT_MAX_TURN_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_EVENT_BYTES = 64 * 1024 * 1024;
export const MAX_STREAM_TEXT_BYTES = 256 * 1024;
export const MAX_STREAM_DELTA_BYTES = 64 * 1024;
const MAX_SUMMARY_STRING_BYTES = 64 * 1024;
const MAX_RAW_BYTES = 16 * 1024;
const TRUNCATION_MARKER = '\n...[truncated]...\n';
const STREAM_KEYS = ['output', 'stdout', 'stderr'] as const;

export function retainedEventSize(event: CodexWebEvent): number {
  return Buffer.byteLength(JSON.stringify(event));
}

export function boundEventForRetention(event: CodexWebEvent): CodexWebEvent {
  const raw = compactRaw(event.raw);
  switch (event.type) {
    case 'assistant.delta': {
      const delta = typeof event.delta === 'string'
        ? truncateUtf8(event.delta, MAX_STREAM_DELTA_BYTES)
        : undefined;
      return {
        ...event,
        text: event.eventType === 'delta' && delta ? '' : truncateUtf8(event.text, MAX_STREAM_TEXT_BYTES),
        ...(delta !== undefined ? { delta } : {}),
        ...(raw !== undefined ? { raw } : {}),
      };
    }
    case 'assistant.final':
      return {
        ...event,
        text: truncateUtf8(event.text, MAX_STREAM_TEXT_BYTES),
        ...(typeof event.delta === 'string'
          ? { delta: truncateUtf8(event.delta, MAX_STREAM_DELTA_BYTES) }
          : {}),
        ...(raw !== undefined ? { raw } : {}),
      };
    case 'batch.updated':
      return {
        ...event,
        summary: boundDeltaOnlyWorkSummary(event.summary),
        ...(raw !== undefined ? { raw } : {}),
      };
    case 'approval.requested':
      return {
        ...event,
        summary: boundWorkSummary(event.summary),
        ...(raw !== undefined ? { raw } : {}),
      };
    case 'turn.failed':
      return {
        ...event,
        message: truncateUtf8(event.message, MAX_SUMMARY_STRING_BYTES),
        ...(typeof event.details === 'string'
          ? { details: truncateUtf8(event.details, MAX_SUMMARY_STRING_BYTES) }
          : {}),
        ...(raw !== undefined ? { raw } : {}),
      };
    default:
      return raw === undefined ? event : { ...event, raw };
  }
}

export function fitEventForRetention(event: CodexWebEvent, maxBytes: number): CodexWebEvent {
  const bounded = boundEventForRetention(event);
  if (retainedEventSize(bounded) <= maxBytes) {
    return bounded;
  }
  if (bounded.type === 'assistant.delta' || bounded.type === 'assistant.final') {
    const base = { ...bounded, text: '', delta: undefined, raw: undefined };
    const available = Math.max(0, maxBytes - retainedEventSize(base));
    const textBudget = bounded.text ? Math.floor(available * 0.8) : 0;
    return {
      ...base,
      text: truncateUtf8(bounded.text, textBudget),
      ...(typeof bounded.delta === 'string'
        ? { delta: truncateUtf8(bounded.delta, available - textBudget) }
        : {}),
    };
  }
  if (bounded.type === 'turn.failed') {
    const base = { ...bounded, message: '', details: undefined, raw: undefined };
    const available = Math.max(0, maxBytes - retainedEventSize(base));
    return {
      ...base,
      message: truncateUtf8(bounded.message, Math.floor(available * 0.7)),
      ...(typeof bounded.details === 'string'
        ? { details: truncateUtf8(bounded.details, Math.ceil(available * 0.3)) }
        : {}),
    };
  }
  if (bounded.type !== 'batch.updated' && bounded.type !== 'approval.requested') {
    return { ...bounded, raw: undefined };
  }
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bounded.summary)) {
    const candidate = { ...bounded, raw: undefined, summary: { ...summary, [key]: value } };
    if (retainedEventSize(candidate) <= maxBytes) {
      summary[key] = value;
    } else {
      const truncatedCandidate = {
        ...bounded,
        raw: undefined,
        summary: { ...summary, [`${key}Truncated`]: true },
      };
      if (retainedEventSize(truncatedCandidate) <= maxBytes) {
        summary[`${key}Truncated`] = true;
      }
    }
  }
  return { ...bounded, raw: undefined, summary };
}

export function boundWorkSummary(summary: Record<string, unknown>): Record<string, unknown> {
  const bounded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(summary)) {
    const streamKey = STREAM_KEYS.find((candidate) => candidate === key);
    const deltaKey = STREAM_KEYS.some((candidate) => `${candidate}Delta` === key);
    if (typeof value === 'string') {
      bounded[key] = truncateUtf8(
        value,
        streamKey ? MAX_STREAM_TEXT_BYTES : deltaKey ? MAX_STREAM_DELTA_BYTES : MAX_SUMMARY_STRING_BYTES,
      );
      continue;
    }
    bounded[key] = boundUnknown(value, 0);
  }
  return bounded;
}

export function mergeBoundedWorkSummary(
  target: Record<string, unknown>,
  update: Record<string, unknown>,
): void {
  const boundedUpdate = boundWorkSummary(update);
  const handled = new Set<string>();
  for (const key of STREAM_KEYS) {
    const deltaKey = `${key}Delta`;
    const previous = typeof target[key] === 'string' ? target[key] : '';
    const incoming = typeof boundedUpdate[key] === 'string' ? boundedUpdate[key] : '';
    const delta = typeof boundedUpdate[deltaKey] === 'string' ? boundedUpdate[deltaKey] : '';
    if (incoming || delta) {
      target[key] = mergeBoundedStreamText(previous, incoming, delta);
    }
    if (delta) {
      target[deltaKey] = delta;
    } else if (incoming) {
      delete target[deltaKey];
    }
    handled.add(key);
    handled.add(deltaKey);
  }
  for (const [key, value] of Object.entries(boundedUpdate)) {
    if (!handled.has(key)) {
      target[key] = value;
    }
  }
}

export function historyWorkSummary(
  update: Record<string, unknown>,
  merged: Record<string, unknown>,
  eventType: 'started' | 'updated' | 'completed',
): Record<string, unknown> {
  if (eventType !== 'updated') {
    const completed = { ...merged };
    for (const key of STREAM_KEYS) {
      delete completed[`${key}Delta`];
    }
    return completed;
  }
  return boundDeltaOnlyWorkSummary(update);
}

export function mergeProjectedBatchUpdate(
  previous: Extract<CodexWebEvent, { type: 'batch.updated' }> | null,
  incoming: Extract<CodexWebEvent, { type: 'batch.updated' }>,
): Extract<CodexWebEvent, { type: 'batch.updated' }> {
  const summary = { ...(previous?.summary ?? {}) };
  mergeBoundedWorkSummary(summary, incoming.summary);
  return {
    ...incoming,
    summary,
  };
}

export function mergeProjectedAssistantUpdate(
  previous: CodexWebEvent | null,
  incoming: Extract<CodexWebEvent, { type: 'assistant.delta' }>,
): Extract<CodexWebEvent, { type: 'assistant.delta' }> {
  if (incoming.eventType !== 'delta' || !incoming.delta) {
    return incoming;
  }
  const previousText = previous?.type === 'assistant.delta' || previous?.type === 'assistant.final'
    ? previous.text
    : '';
  return {
    ...incoming,
    text: mergeBoundedStreamText(previousText, incoming.text, incoming.delta),
  };
}

export function truncateUtf8(value: string, maxBytes: number): string {
  const byteLength = Buffer.byteLength(value);
  if (byteLength <= maxBytes) {
    return value;
  }
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER);
  if (maxBytes <= markerBytes) {
    return sliceUtf8ByBytes(value, Math.max(0, maxBytes), false);
  }
  const contentBudget = Math.max(0, maxBytes - markerBytes);
  const headBudget = Math.floor(contentBudget * 0.6);
  const tailBudget = contentBudget - headBudget;
  const head = sliceUtf8ByBytes(value, headBudget, false);
  const tail = sliceUtf8ByBytes(value, tailBudget, true);
  return `${head}${TRUNCATION_MARKER}${tail}`;
}

function mergeBoundedStreamText(previous: string, incoming: string, delta: string): string {
  if (!previous) {
    return truncateUtf8(incoming || delta, MAX_STREAM_TEXT_BYTES);
  }
  if (incoming === previous || (incoming && previous.endsWith(incoming))) {
    return previous;
  }
  if (incoming.startsWith(previous)) {
    return truncateUtf8(incoming, MAX_STREAM_TEXT_BYTES);
  }
  const addition = delta || incoming;
  if (!addition || previous.endsWith(addition)) {
    return previous;
  }
  return truncateUtf8(`${previous}${addition}`, MAX_STREAM_TEXT_BYTES);
}

function boundDeltaOnlyWorkSummary(summary: Record<string, unknown>): Record<string, unknown> {
  const deltaOnly = { ...summary };
  for (const key of STREAM_KEYS) {
    const deltaKey = `${key}Delta`;
    if (typeof deltaOnly[deltaKey] === 'string' && deltaOnly[deltaKey]) {
      delete deltaOnly[key];
    }
  }
  return boundWorkSummary(deltaOnly);
}

function compactRaw(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  const bounded = boundUnknown(value, 0);
  try {
    if (Buffer.byteLength(JSON.stringify(bounded)) <= MAX_RAW_BYTES) {
      return bounded;
    }
  } catch {
    return { truncated: true };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { truncated: true };
  }
  const record = value as Record<string, unknown>;
  const metadata: Record<string, unknown> = { truncated: true };
  for (const key of ['method', 'type', 'name', 'call_id', 'requestId', 'status', 'recovered']) {
    if (typeof record[key] === 'string' || typeof record[key] === 'boolean' || typeof record[key] === 'number') {
      metadata[key] = record[key];
    }
  }
  return metadata;
}

function boundUnknown(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return truncateUtf8(value, depth >= 2 ? 4 * 1024 : MAX_SUMMARY_STRING_BYTES);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= 4) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((entry) => boundUnknown(entry, depth + 1));
    if (value.length > items.length) {
      items.push(`[${value.length - items.length} more items truncated]`);
    }
    return items;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    result[key] = boundUnknown(entry, depth + 1);
  }
  return result;
}

function sliceUtf8ByBytes(value: string, maxBytes: number, fromEnd: boolean): string {
  if (maxBytes <= 0) {
    return '';
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const length = Math.ceil((low + high) / 2);
    const candidate = fromEnd ? value.slice(value.length - length) : value.slice(0, length);
    if (Buffer.byteLength(candidate) <= maxBytes) {
      low = length;
    } else {
      high = length - 1;
    }
  }
  return fromEnd ? value.slice(value.length - low) : value.slice(0, low);
}
