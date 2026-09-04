import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './file_lock.js';

export interface CodexWebAttachmentRecord {
  attachmentId: string;
  ownerUserId: string;
  projectCwd: string | null;
  projectKey: string;
  fileName: string;
  mimeType: string | null;
  kind: 'image' | 'file';
  sizeBytes: number;
  localPath: string;
  createdAt: string;
  expiresAt: string;
}

interface AttachmentFile {
  version: 1;
  attachments: Record<string, CodexWebAttachmentRecord>;
}

export class FileAttachmentStore {
  private readonly attachmentPath: string;
  private readonly ttlMs: number;

  constructor({ stateDir, attachmentPath, ttlSeconds = 7 * 24 * 60 * 60 }: {
    stateDir?: string;
    attachmentPath?: string;
    ttlSeconds?: number;
  }) {
    const resolved = attachmentPath ?? (stateDir ? path.join(stateDir, 'attachment-records.json') : null);
    if (!resolved) {
      throw new Error('Either stateDir or attachmentPath is required');
    }
    this.attachmentPath = resolved;
    this.ttlMs = Math.max(1_000, Math.floor(ttlSeconds) * 1_000);
  }

  async record(input: Omit<CodexWebAttachmentRecord, 'createdAt' | 'expiresAt'>): Promise<CodexWebAttachmentRecord> {
    return withFileLock(`${this.attachmentPath}.lock`, async () => {
      const file = await this.readFile();
      const now = new Date();
      const record: CodexWebAttachmentRecord = {
        ...input,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
      };
      file.attachments[input.attachmentId] = record;
      await this.writeFile(file);
      return record;
    });
  }

  async read(attachmentId: string): Promise<CodexWebAttachmentRecord | null> {
    const file = await this.readFile();
    return file.attachments[attachmentId] ?? null;
  }

  async prune(): Promise<void> {
    await withFileLock(`${this.attachmentPath}.lock`, async () => {
      const file = await this.readFile();
      const now = Date.now();
      let changed = false;
      for (const [id, record] of Object.entries(file.attachments)) {
        const missing = await fs.lstat(record.localPath).then(() => false).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT');
        if (missing || !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= now) {
          delete file.attachments[id];
          changed = true;
        }
      }
      if (changed) {
        await this.writeFile(file);
      }
    });
  }

  private async readFile(): Promise<AttachmentFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.attachmentPath, 'utf8')) as Partial<AttachmentFile>;
      if (parsed.version !== 1 || !parsed.attachments || typeof parsed.attachments !== 'object') {
        throw new Error(`Invalid attachment file: ${this.attachmentPath}`);
      }
      return { version: 1, attachments: parsed.attachments as Record<string, CodexWebAttachmentRecord> };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, attachments: {} };
      }
      throw error;
    }
  }

  private async writeFile(file: AttachmentFile): Promise<void> {
    await fs.mkdir(path.dirname(this.attachmentPath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.attachmentPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tempPath, this.attachmentPath);
      await fs.chmod(this.attachmentPath, 0o600).catch(() => {});
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}
