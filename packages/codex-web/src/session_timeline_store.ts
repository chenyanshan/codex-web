import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { withFileLockSync } from './file_lock.js';

export interface CodexWebTimelineMessage {
  id: string;
  kind: 'message';
  role: 'user' | 'assistant' | 'system';
  label: string;
  meta: string;
  text: string;
  severity?: 'error';
  afterHistoryIndex?: number;
}

export interface CodexWebSessionTimelineStore {
  list(sessionId: string): CodexWebTimelineMessage[];
  append(sessionId: string, entry: CodexWebTimelineMessage): void;
  replace(sessionId: string, entries: CodexWebTimelineMessage[]): void;
  delete(sessionId: string): void;
}

interface TimelineFile {
  version: 1;
  sessions: Record<string, CodexWebTimelineMessage[]>;
}

const DEFAULT_MAX_ENTRIES_PER_SESSION = 500;
const DEFAULT_MAX_TIMELINE_BYTES = 16 * 1024 * 1024;

export class FileSessionTimelineStore implements CodexWebSessionTimelineStore {
  private readonly timelinePath: string;

  private readonly maxEntriesPerSession: number;

  private readonly maxBytes: number;

  constructor({
    timelinePath,
    maxEntriesPerSession = DEFAULT_MAX_ENTRIES_PER_SESSION,
    maxBytes = DEFAULT_MAX_TIMELINE_BYTES,
  }: {
    timelinePath: string;
    maxEntriesPerSession?: number;
    maxBytes?: number;
  }) {
    this.timelinePath = timelinePath;
    this.maxEntriesPerSession = positiveInteger(maxEntriesPerSession, DEFAULT_MAX_ENTRIES_PER_SESSION);
    this.maxBytes = positiveInteger(maxBytes, DEFAULT_MAX_TIMELINE_BYTES);
  }

  list(sessionId: string): CodexWebTimelineMessage[] {
    return normalizeEntries(this.read().sessions[sessionId]);
  }

  append(sessionId: string, entry: CodexWebTimelineMessage): void {
    withFileLockSync(`${this.timelinePath}.lock`, () => {
      const file = this.read();
      const current = normalizeEntries(file.sessions[sessionId]);
      current.push(normalizeEntry(entry));
      file.sessions[sessionId] = current;
      this.write(compactTimelineFile(file, this.maxEntriesPerSession, this.maxBytes));
    });
  }

  replace(sessionId: string, entries: CodexWebTimelineMessage[]): void {
    withFileLockSync(`${this.timelinePath}.lock`, () => {
      const file = this.read();
      file.sessions[sessionId] = normalizeEntries(entries);
      this.write(compactTimelineFile(file, this.maxEntriesPerSession, this.maxBytes));
    });
  }

  delete(sessionId: string): void {
    withFileLockSync(`${this.timelinePath}.lock`, () => {
      const file = this.read();
      if (!(sessionId in file.sessions)) {
        return;
      }
      delete file.sessions[sessionId];
      this.write(file);
    });
  }

  private read(): TimelineFile {
    let raw: string;
    try {
      raw = fs.readFileSync(this.timelinePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyFile();
      }
      throw error;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.sessions)) {
      throw new Error(`Invalid session timeline file: ${this.timelinePath}`);
    }
    const sessions: Record<string, CodexWebTimelineMessage[]> = {};
    for (const [sessionId, entries] of Object.entries(parsed.sessions)) {
      if (!Array.isArray(entries)) {
        throw new Error(`Invalid session timeline entry list for ${sessionId}: ${this.timelinePath}`);
      }
      const normalized = normalizeEntries(entries);
      if (normalized.length !== entries.length) {
        throw new Error(`Invalid session timeline entry for ${sessionId}: ${this.timelinePath}`);
      }
      sessions[sessionId] = normalized;
    }
    return { version: 1, sessions };
  }

  private write(file: TimelineFile): void {
    fs.mkdirSync(path.dirname(this.timelinePath), { recursive: true, mode: 0o700 });
    const tmpPath = `${this.timelinePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, serializeTimelineFile(file), { mode: 0o600 });
      fs.renameSync(tmpPath, this.timelinePath);
      try {
        fs.chmodSync(this.timelinePath, 0o600);
      } catch {
        // The atomic state update succeeded; chmod is best-effort for non-POSIX filesystems.
      }
    } catch (error) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // Preserve the original persistence error.
      }
      throw error;
    }
  }
}

function emptyFile(): TimelineFile {
  return { version: 1, sessions: {} };
}

function compactTimelineFile(
  file: TimelineFile,
  maxEntriesPerSession: number,
  maxBytes: number,
): TimelineFile {
  const compacted: TimelineFile = { version: 1, sessions: {} };
  for (const [sessionId, entries] of Object.entries(file.sessions)) {
    const retained = normalizeEntries(entries).slice(-maxEntriesPerSession);
    if (retained.length > 0) {
      compacted.sessions[sessionId] = retained;
    }
  }

  while (Buffer.byteLength(serializeTimelineFile(compacted)) > maxBytes) {
    const candidate = Object.entries(compacted.sessions)
      .filter(([, entries]) => entries.length > 0)
      .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))[0];
    if (!candidate) {
      break;
    }
    const [sessionId, entries] = candidate;
    entries.shift();
    if (entries.length === 0) {
      delete compacted.sessions[sessionId];
    }
  }
  return compacted;
}

function serializeTimelineFile(file: TimelineFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
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
    severity: value.severity === 'error' ? 'error' : undefined,
    afterHistoryIndex: Number.isFinite(value.afterHistoryIndex) ? Math.max(0, Math.floor(Number(value.afterHistoryIndex))) : undefined,
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
    severity: entry.severity === 'error' ? 'error' : undefined,
    afterHistoryIndex: Number.isFinite(entry.afterHistoryIndex) ? Math.max(0, Math.floor(Number(entry.afterHistoryIndex))) : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
