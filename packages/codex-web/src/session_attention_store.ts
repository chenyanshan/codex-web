import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './file_lock.js';

export interface SessionAttentionRecord { ownerUserId: string; sessionId: string; readTurnId: string; updatedAt: string; }
const MAX_RECORDS = 4096;
const MAX_BYTES = 2 * 1024 * 1024;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export class FileSessionAttentionStore {
  private readonly filename: string;
  constructor({ stateDir }: { stateDir: string }) { this.filename = path.join(stateDir, 'session-attention.json'); }
  async readMany(ownerUserId: string, sessionIds: string[]): Promise<Map<string, string>> {
    const wanted = new Set(sessionIds); const result = new Map<string, string>();
    const cutoff = Date.now() - RETENTION_MS;
    for (const record of await this.load()) {
      if (Date.parse(record.updatedAt) < cutoff) continue;
      if (record.ownerUserId === ownerUserId && wanted.has(record.sessionId)) result.set(record.sessionId, record.readTurnId);
    }
    return result;
  }
  async markRead(ownerUserId: string, sessionId: string, readTurnId: string): Promise<SessionAttentionRecord> {
    validate(ownerUserId, sessionId, readTurnId);
    return withFileLock(`${this.filename}.lock`, async () => {
      const now = new Date().toISOString();
      let records = (await this.load()).filter(r => Date.parse(r.updatedAt) >= Date.now() - RETENTION_MS);
      const existing = records.find(r => r.ownerUserId === ownerUserId && r.sessionId === sessionId);
      if (existing) { existing.readTurnId = readTurnId; existing.updatedAt = now; await this.write(records); return existing; }
      if (records.length >= MAX_RECORDS) records = records.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, MAX_RECORDS - 1);
      const record = { ownerUserId, sessionId, readTurnId, updatedAt: now };
      records.push(record); await this.write(records); return record;
    });
  }
  private async load(): Promise<SessionAttentionRecord[]> {
    try {
      if ((await fs.stat(this.filename)).size > MAX_BYTES) throw new Error('Session attention file exceeds capacity');
      const parsed = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (parsed?.version !== 1 || !Array.isArray(parsed.records) || parsed.records.length > MAX_RECORDS) throw new Error('Invalid session attention file');
      return parsed.records.filter((r: SessionAttentionRecord) => r && [r.ownerUserId, r.sessionId, r.readTurnId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 1024) && Number.isFinite(Date.parse(r.updatedAt)));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  private async write(records: SessionAttentionRecord[]): Promise<void> {
    const text = JSON.stringify({ version: 1, records }); if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Session attention capacity reached');
    await fs.mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 }); const temporary = `${this.filename}.${crypto.randomUUID()}.tmp`;
    try { const handle = await fs.open(temporary, 'wx', 0o600); try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); } await fs.rename(temporary, this.filename); } finally { await fs.rm(temporary, { force: true }); }
  }
}
function validate(...values: string[]) { if (values.some(v => typeof v !== 'string' || !v || v.length > 1024)) throw new Error('Invalid session attention identity'); }
