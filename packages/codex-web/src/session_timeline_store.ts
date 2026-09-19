import { SessionPartitionStore } from './session_partition_store.js';

export interface CodexWebTimelineMessage {
  id: string;
  kind: 'message';
  role: 'user' | 'assistant' | 'system';
  label: string;
  meta: string;
  text: string;
  turnId?: string;
  itemId?: string;
  projectionKey?: string;
  clientMessageId?: string;
  phase?: string;
  lifecycle?: 'started' | 'delta' | 'completed';
  severity?: 'error';
  afterHistoryIndex?: number;
  afterHistoryId?: string;
}

export interface CodexWebSessionTimelineStore {
  dispose?(): Promise<void>;
  revision?(sessionId?: string): Promise<string>;
  upsert?(sessionId: string, entry: CodexWebTimelineMessage): Promise<void>;
  list(sessionId: string): CodexWebTimelineMessage[] | Promise<CodexWebTimelineMessage[]>;
  append(sessionId: string, entry: CodexWebTimelineMessage): void | Promise<void>;
  replace(sessionId: string, entries: CodexWebTimelineMessage[]): void | Promise<void>;
  delete(sessionId: string): void | Promise<void>;
}

const DEFAULT_MAX_ENTRIES_PER_SESSION = 500;
const DEFAULT_MAX_TIMELINE_BYTES = 16 * 1024 * 1024;

export class FileSessionTimelineStore implements CodexWebSessionTimelineStore {
  dispose(): Promise<void> { return this.store.dispose(); }
  private readonly store: SessionPartitionStore<CodexWebTimelineMessage[]>;
  constructor({ timelinePath, maxEntriesPerSession = DEFAULT_MAX_ENTRIES_PER_SESSION, maxBytes = DEFAULT_MAX_TIMELINE_BYTES }: {
    timelinePath: string; maxEntriesPerSession?: number; maxBytes?: number;
  }) {
    const maxEntries = positiveInteger(maxEntriesPerSession, DEFAULT_MAX_ENTRIES_PER_SESSION);
    this.store = new SessionPartitionStore(timelinePath, (value, id) => {
      const entries = normalizeEntries(value);
      if (!Array.isArray(value) || entries.length !== value.length) throw new Error(`Invalid session timeline entry for ${id}`);
      return entries;
    }, positiveInteger(maxBytes, DEFAULT_MAX_TIMELINE_BYTES), (entries, budget) => {
      const retained = entries.slice(-maxEntries);
      // Binary search makes compaction O(n log n), instead of serializing all sessions per removed entry.
      let low = 0; let high = retained.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (Buffer.byteLength(JSON.stringify(retained.slice(middle))) <= budget) high = middle;
        else low = middle + 1;
      }
      return retained.slice(low);
    });
  }
  revision(sessionId?: string): Promise<string> { return this.store.revision(sessionId); }
  async upsert(sessionId: string, entry: CodexWebTimelineMessage): Promise<void> {
    await this.store.mutate(sessionId, (current) => {
      const entries = current ?? [];
      const index = entries.findIndex((item) => item.id === entry.id);
      if (index >= 0) entries[index] = normalizeEntry(entry);
      else entries.push(normalizeEntry(entry));
      return entries;
    });
  }
  async list(sessionId: string): Promise<CodexWebTimelineMessage[]> { return await this.store.get(sessionId) ?? []; }
  async append(sessionId: string, entry: CodexWebTimelineMessage): Promise<void> {
    await this.store.mutate(sessionId, (entries) => [...entries ?? [], normalizeEntry(entry)]);
  }
  async replace(sessionId: string, entries: CodexWebTimelineMessage[]): Promise<void> {
    await this.store.mutate(sessionId, () => normalizeEntries(entries));
  }
  async delete(sessionId: string): Promise<void> { await this.store.mutate(sessionId, () => null); }
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function normalizeEntries(value: unknown): CodexWebTimelineMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeEntryOrNull)
    .filter((entry): entry is CodexWebTimelineMessage => Boolean(entry));
}

function normalizeEntryOrNull(value: unknown): CodexWebTimelineMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = value.kind === 'message' ? 'message' : null;
  const role = value.role === 'user' || value.role === 'assistant' || value.role === 'system'
    ? value.role
    : null;
  const id = typeof value.id === 'string' && value.id ? value.id : null;
  const label = typeof value.label === 'string' ? value.label : null;
  const meta = typeof value.meta === 'string' ? value.meta : null;
  const text = typeof value.text === 'string' ? value.text : null;
  if (!kind || !role || !id || !label || !meta || !text) {
    return null;
  }
  return {
    id,
    kind,
    role,
    label,
    meta,
    text,
    turnId: optionalString(value.turnId),
    itemId: optionalString(value.itemId),
    projectionKey: optionalString(value.projectionKey),
    clientMessageId: optionalString(value.clientMessageId),
    phase: optionalString(value.phase),
    lifecycle: normalizeLifecycle(value.lifecycle),
    severity: value.severity === 'error' ? 'error' : undefined,
    afterHistoryIndex: Number.isFinite(value.afterHistoryIndex) ? Math.max(0, Math.floor(Number(value.afterHistoryIndex))) : undefined,
    afterHistoryId: optionalString(value.afterHistoryId),
  };
}

function normalizeEntry(entry: CodexWebTimelineMessage): CodexWebTimelineMessage {
  return {
    id: entry.id,
    kind: 'message',
    role: entry.role,
    label: entry.label,
    meta: entry.meta,
    text: entry.text,
    turnId: optionalString(entry.turnId),
    itemId: optionalString(entry.itemId),
    projectionKey: optionalString(entry.projectionKey),
    clientMessageId: optionalString(entry.clientMessageId),
    phase: optionalString(entry.phase),
    lifecycle: normalizeLifecycle(entry.lifecycle),
    severity: entry.severity === 'error' ? 'error' : undefined,
    afterHistoryIndex: Number.isFinite(entry.afterHistoryIndex) ? Math.max(0, Math.floor(Number(entry.afterHistoryIndex))) : undefined,
    afterHistoryId: optionalString(entry.afterHistoryId),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeLifecycle(value: unknown): CodexWebTimelineMessage['lifecycle'] {
  return value === 'started' || value === 'delta' || value === 'completed' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
