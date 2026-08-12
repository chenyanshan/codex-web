import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './file_lock.js';

const DEFAULT_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_TERMINAL_RECORDS_PER_OWNER = 10_000;
const OPERATION_LOCK_STALE_MS = 5 * 60 * 1_000;
const OPERATION_LOCK_TIMEOUT_MS = 90_000;

export type CodexWebSessionSubmissionStatus =
  | 'queued'
  | 'creating'
  | 'starting'
  | 'submitted'
  | 'failed';

export interface CodexWebSessionSubmissionPayload {
  sessionId: string | null;
  projectId: string | null;
  cwd: string | null;
  title: string | null;
  settings: Record<string, unknown>;
  text: string;
  attachments: unknown[];
  attachmentIds: string[];
}

export interface CodexWebSessionSubmissionError {
  code: string;
  message: string;
  retryable: boolean;
  outcomeUnknown?: boolean;
  activeTurnId?: string;
}

export interface CodexWebSessionSubmissionRecord {
  id: string;
  ownerUserId: string;
  payloadHash: string;
  payload: CodexWebSessionSubmissionPayload;
  status: CodexWebSessionSubmissionStatus;
  sessionId: string | null;
  runtimeSessionId: string | null;
  operation?: 'start' | 'steer';
  turnBaseline: string[] | null;
  turnId: string | null;
  result: Record<string, unknown> | null;
  error: CodexWebSessionSubmissionError | null;
  source?: 'webhook';
  clientRequestId?: string;
  requestFingerprint?: string;
  deliveryMode?: 'steer' | 'reject_if_busy';
  createdAt: string;
  updatedAt: string;
}

interface SessionSubmissionFile {
  version: 1;
  submissions: Record<string, CodexWebSessionSubmissionRecord>;
}

export class FileSessionSubmissionStore {
  private readonly submissionPath: string;

  private readonly terminalRetentionMs: number;

  private readonly maxTerminalRecordsPerOwner: number;

  constructor({
    stateDir,
    submissionPath,
    terminalRetentionMs = DEFAULT_TERMINAL_RETENTION_MS,
    maxTerminalRecordsPerOwner = DEFAULT_MAX_TERMINAL_RECORDS_PER_OWNER,
  }: {
    stateDir?: string;
    submissionPath?: string;
    terminalRetentionMs?: number;
    maxTerminalRecordsPerOwner?: number;
  }) {
    const resolvedPath = submissionPath ?? (stateDir ? path.join(stateDir, 'session-submissions.json') : null);
    if (!resolvedPath) {
      throw new Error('Either stateDir or submissionPath is required');
    }
    this.submissionPath = resolvedPath;
    this.terminalRetentionMs = Math.max(60_000, Math.floor(terminalRetentionMs));
    this.maxTerminalRecordsPerOwner = Math.max(1, Math.floor(maxTerminalRecordsPerOwner));
  }

  async read(ownerUserId: string, submissionId: string): Promise<CodexWebSessionSubmissionRecord | null> {
    const file = await this.readFile();
    return file.submissions[submissionKey(ownerUserId, submissionId)] ?? null;
  }

  async list(): Promise<CodexWebSessionSubmissionRecord[]> {
    const file = await this.readFile();
    return Object.values(file.submissions);
  }

  async create(
    record: CodexWebSessionSubmissionRecord,
  ): Promise<{ record: CodexWebSessionSubmissionRecord; created: boolean }> {
    return withFileLock(`${this.submissionPath}.lock`, async () => {
      const file = await this.readFile();
      const key = submissionKey(record.ownerUserId, record.id);
      const existing = file.submissions[key];
      if (existing) {
        return { record: existing, created: false };
      }
      file.submissions[key] = normalizeRecord(record);
      pruneTerminalRecords(file, {
        now: Date.now(),
        retentionMs: this.terminalRetentionMs,
        maxPerOwner: this.maxTerminalRecordsPerOwner,
        preserveKey: key,
      });
      await this.writeFile(file);
      return { record: file.submissions[key]!, created: true };
    });
  }

  async update(
    ownerUserId: string,
    submissionId: string,
    update: (record: CodexWebSessionSubmissionRecord) => CodexWebSessionSubmissionRecord,
  ): Promise<CodexWebSessionSubmissionRecord> {
    return withFileLock(`${this.submissionPath}.lock`, async () => {
      const file = await this.readFile();
      const key = submissionKey(ownerUserId, submissionId);
      const current = file.submissions[key];
      if (!current) {
        throw new Error(`Unknown session submission: ${submissionId}`);
      }
      const next = normalizeRecord(update(current));
      if (next.ownerUserId !== ownerUserId || next.id !== submissionId) {
        throw new Error('A session submission update cannot change its owner or id');
      }
      file.submissions[key] = next;
      await this.writeFile(file);
      return next;
    });
  }

  async withSubmissionOperationLock<T>(
    ownerUserId: string,
    submissionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockPath = path.join(
      `${this.submissionPath}.operation-locks`,
      `${submissionKey(ownerUserId, submissionId)}.lock`,
    );
    return withFileLock(lockPath, operation, {
      staleMs: OPERATION_LOCK_STALE_MS,
      timeoutMs: OPERATION_LOCK_TIMEOUT_MS,
      retireClaimStaleMs: OPERATION_LOCK_STALE_MS,
    });
  }

  async withSessionCreationOperationLock<T>(
    ownerUserId: string,
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockPath = path.join(
      `${this.submissionPath}.session-creation-locks`,
      `${submissionKey(ownerUserId, projectId)}.lock`,
    );
    return withFileLock(lockPath, operation, {
      staleMs: OPERATION_LOCK_STALE_MS,
      timeoutMs: OPERATION_LOCK_TIMEOUT_MS,
      retireClaimStaleMs: OPERATION_LOCK_STALE_MS,
    });
  }

  private async readFile(): Promise<SessionSubmissionFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.submissionPath, 'utf8')) as Partial<SessionSubmissionFile>;
      if (parsed.version !== 1 || !isRecord(parsed.submissions)) {
        throw new Error(`Invalid session submission file: ${this.submissionPath}`);
      }
      const submissions: Record<string, CodexWebSessionSubmissionRecord> = {};
      for (const [key, value] of Object.entries(parsed.submissions)) {
        if (!isRecord(value)) {
          throw new Error(`Invalid session submission entry: ${this.submissionPath}`);
        }
        submissions[key] = normalizeRecord(value as unknown as CodexWebSessionSubmissionRecord);
      }
      return { version: 1, submissions };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, submissions: {} };
      }
      throw error;
    }
  }

  private async writeFile(file: SessionSubmissionFile): Promise<void> {
    await fs.mkdir(path.dirname(this.submissionPath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.submissionPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tempPath, this.submissionPath);
      await fs.chmod(this.submissionPath, 0o600).catch(() => {});
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}

export function hashSessionSubmissionPayload(payload: CodexWebSessionSubmissionPayload): string {
  return crypto.createHash('sha256').update(stableJson(payload)).digest('hex');
}

function submissionKey(ownerUserId: string, submissionId: string): string {
  return crypto.createHash('sha256').update(`${ownerUserId}\0${submissionId}`).digest('hex');
}

function normalizeRecord(record: CodexWebSessionSubmissionRecord): CodexWebSessionSubmissionRecord {
  const status = isSubmissionStatus(record.status) ? record.status : 'failed';
  const createdAt = normalizeString(record.createdAt) || new Date().toISOString();
  return {
    id: normalizeString(record.id),
    ownerUserId: normalizeString(record.ownerUserId),
    payloadHash: normalizeString(record.payloadHash),
    payload: normalizePayload(record.payload),
    status,
    sessionId: nullableString(record.sessionId),
    runtimeSessionId: nullableString(record.runtimeSessionId),
    operation: record.operation === 'steer' ? 'steer' : record.operation === 'start' ? 'start' : undefined,
    turnBaseline: normalizeTurnBaseline(record.turnBaseline),
    turnId: nullableString(record.turnId),
    result: isRecord(record.result) ? record.result : null,
    error: normalizeError(record.error),
    source: record.source === 'webhook' ? 'webhook' : undefined,
    clientRequestId: normalizeString(record.clientRequestId) || undefined,
    requestFingerprint: normalizeString(record.requestFingerprint) || undefined,
    deliveryMode: record.deliveryMode === 'reject_if_busy'
      ? 'reject_if_busy'
      : record.deliveryMode === 'steer'
        ? 'steer'
        : undefined,
    createdAt,
    updatedAt: normalizeString(record.updatedAt) || createdAt,
  };
}

function normalizeTurnBaseline(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return [...new Set(value.map(normalizeString).filter(Boolean))];
}

function pruneTerminalRecords(
  file: SessionSubmissionFile,
  {
    now,
    retentionMs,
    maxPerOwner,
    preserveKey,
  }: {
    now: number;
    retentionMs: number;
    maxPerOwner: number;
    preserveKey: string;
  },
): void {
  const retainedByOwner = new Map<string, Array<{ key: string; updatedAt: number }>>();
  for (const [key, record] of Object.entries(file.submissions)) {
    if (!isPrunableStatus(record)) {
      continue;
    }
    const updatedAt = Date.parse(record.updatedAt);
    if (key !== preserveKey && (!Number.isFinite(updatedAt) || updatedAt <= now - retentionMs)) {
      delete file.submissions[key];
      continue;
    }
    const retained = retainedByOwner.get(record.ownerUserId) ?? [];
    retained.push({ key, updatedAt });
    retainedByOwner.set(record.ownerUserId, retained);
  }
  for (const retained of retainedByOwner.values()) {
    retained.sort((left, right) => left.updatedAt - right.updatedAt);
    let excess = retained.length - maxPerOwner;
    for (const { key } of retained) {
      if (excess <= 0) {
        break;
      }
      if (key !== preserveKey) {
        delete file.submissions[key];
        excess -= 1;
      }
    }
  }
}

function isPrunableStatus(record: CodexWebSessionSubmissionRecord): boolean {
  return record.status === 'submitted'
    || record.status === 'queued'
    || (record.status === 'failed' && record.error?.retryable !== true);
}

function normalizePayload(value: CodexWebSessionSubmissionPayload): CodexWebSessionSubmissionPayload {
  const payload: Record<string, any> = isRecord(value) ? value : {};
  return {
    sessionId: nullableString(payload.sessionId),
    projectId: nullableString(payload.projectId),
    cwd: nullableString(payload.cwd),
    title: nullableString(payload.title),
    settings: isRecord(payload.settings) ? payload.settings : {},
    text: typeof payload.text === 'string' ? payload.text : '',
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    attachmentIds: Array.isArray(payload.attachmentIds)
      ? payload.attachmentIds.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function normalizeError(value: unknown): CodexWebSessionSubmissionError | null {
  if (!isRecord(value)) {
    return null;
  }
  const message = normalizeString(value.message);
  if (!message) {
    return null;
  }
  return {
    code: normalizeString(value.code) || 'submission_failed',
    message,
    retryable: value.retryable === true,
    outcomeUnknown: value.outcomeUnknown === true,
    activeTurnId: nullableString(value.activeTurnId) || undefined,
  };
}

function isSubmissionStatus(value: unknown): value is CodexWebSessionSubmissionStatus {
  return value === 'queued'
    || value === 'creating'
    || value === 'starting'
    || value === 'submitted'
    || value === 'failed';
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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableString(value: unknown): string | null {
  return normalizeString(value) || null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
