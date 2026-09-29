import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './file_lock.js';

export type UserInputReceiptStatus = 'preparing' | 'delivery_unknown' | 'resolved' | 'expired';
export interface UserInputReceipt {
  ownerUserId: string; sessionId: string; requestId: string; answerSubmissionId: string;
  answerHash: string; status: UserInputReceiptStatus; createdAt: string; updatedAt: string;
}
const MAX_RECORDS = 1024;
const MAX_BYTES = 4 * 1024 * 1024;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Separate bounded receipts in the existing state directory; answers (possibly secrets)
 * never persist here. A receipt is evidence of an attempted answer, never a replay job. */
export class FileUserInputStore {
  private readonly filename: string;
  constructor({ stateDir }: { stateDir: string }) { this.filename = path.join(stateDir, 'user-input-receipts.json'); }
  async read(ownerUserId: string, sessionId: string, answerSubmissionId: string): Promise<UserInputReceipt | null> {
    return (await this.load()).find(r => r.ownerUserId === ownerUserId && r.sessionId === sessionId && r.answerSubmissionId === answerSubmissionId) ?? null;
  }
  async prepare(input: { ownerUserId: string; sessionId: string; requestId: string; answerSubmissionId: string; answers: unknown }): Promise<{ record: UserInputReceipt; created: boolean }> {
    for (const value of [input.ownerUserId, input.sessionId, input.requestId, input.answerSubmissionId]) {
      if (typeof value !== 'string' || !value || value.length > 1024) throw new Error('Invalid answer receipt identity');
    }
    const serialized = JSON.stringify(input.answers);
    if (!serialized || Buffer.byteLength(serialized) > 32 * 1024) throw new Error('Invalid answer size');
    const answerHash = crypto.createHash('sha256').update(stableJson(input.answers)).digest('hex');
    return withFileLock(`${this.filename}.lock`, async () => {
      const records = await this.load();
      const existing = records.find(r => r.ownerUserId === input.ownerUserId && r.sessionId === input.sessionId
        && (r.answerSubmissionId === input.answerSubmissionId || r.requestId === input.requestId));
      if (existing) {
        if (existing.requestId !== input.requestId || existing.answerSubmissionId !== input.answerSubmissionId || existing.answerHash !== answerHash) {
          const error = new Error('This question already has an answer submission') as Error & { code: string }; error.code = 'answer_conflict'; throw error;
        }
        return { record: existing, created: false };
      }
      const retained = records.filter(r => !['resolved', 'expired'].includes(r.status) || Date.parse(r.updatedAt) > Date.now() - RETENTION_MS);
      // Unknown receipts are not evicted merely to make space: that would enable accidental replay.
      if (retained.length >= MAX_RECORDS) throw new Error('Answer receipt capacity reached');
      const now = new Date().toISOString();
      const record: UserInputReceipt = { ownerUserId: input.ownerUserId, sessionId: input.sessionId, requestId: input.requestId,
        answerSubmissionId: input.answerSubmissionId, answerHash, status: 'preparing', createdAt: now, updatedAt: now };
      retained.push(record); await this.write(retained);
      return { record, created: true };
    });
  }
  async update(ownerUserId: string, sessionId: string, answerSubmissionId: string, status: UserInputReceiptStatus): Promise<UserInputReceipt> {
    if (!['delivery_unknown', 'resolved', 'expired'].includes(status)) throw new Error('Invalid answer receipt transition');
    return withFileLock(`${this.filename}.lock`, async () => {
      const records = await this.load();
      const record = records.find(r => r.ownerUserId === ownerUserId && r.sessionId === sessionId && r.answerSubmissionId === answerSubmissionId);
      if (!record) throw new Error('Answer receipt not found');
      if (record.status === 'resolved' || record.status === 'expired') return record;
      record.status = status; record.updatedAt = new Date().toISOString(); await this.write(records); return record;
    });
  }
  async resolveRequest(requestId: string, status: 'resolved' | 'expired'): Promise<number> {
    return withFileLock(`${this.filename}.lock`, async () => {
      const records = await this.load(); let changed = 0;
      for (const record of records) if (record.requestId === requestId && !['resolved', 'expired'].includes(record.status)) {
        record.status = status; record.updatedAt = new Date().toISOString(); changed++;
      }
      if (changed) await this.write(records);
      return changed;
    });
  }
  private async load(): Promise<UserInputReceipt[]> {
    try {
      if ((await fs.stat(this.filename)).size > MAX_BYTES) throw new Error('Answer receipt file exceeds capacity');
      const file = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (file?.version !== 1 || !Array.isArray(file.receipts) || file.receipts.length > MAX_RECORDS) throw new Error('Invalid answer receipt file');
      return file.receipts.map((r: UserInputReceipt) => {
        if (!r || ![r.ownerUserId, r.sessionId, r.requestId, r.answerSubmissionId, r.answerHash].every(v => typeof v === 'string' && v.length > 0 && v.length <= 1024)
          || !['preparing', 'delivery_unknown', 'resolved', 'expired'].includes(r.status) || !Number.isFinite(Date.parse(r.createdAt)) || !Number.isFinite(Date.parse(r.updatedAt))) throw new Error('Invalid answer receipt');
        return { ...r, status: r.status === 'preparing' ? 'delivery_unknown' : r.status };
      });
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  private async write(receipts: UserInputReceipt[]) {
    const text = JSON.stringify({ version: 1, receipts });
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Answer receipt capacity reached');
    await fs.mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    const temporary = `${this.filename}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, this.filename);
    } finally { await fs.rm(temporary, { force: true }); }
  }
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
