import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './file_lock.js';

const OPERATION_LOCK_STALE_MS = 5 * 60 * 1_000;
const OPERATION_LOCK_TIMEOUT_MS = 90_000;

export interface CodexWebWebhookConversation {
  ownerUserId: string;
  keyHash: string;
  sessionId: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WebhookConversationFile {
  version: 1;
  conversations: Record<string, CodexWebWebhookConversation>;
}

export class FileWebhookConversationStore {
  private readonly conversationPath: string;

  constructor({ stateDir, conversationPath }: { stateDir?: string; conversationPath?: string }) {
    const resolvedPath = conversationPath ?? (stateDir ? path.join(stateDir, 'webhook-conversations.json') : null);
    if (!resolvedPath) {
      throw new Error('Either stateDir or conversationPath is required');
    }
    this.conversationPath = resolvedPath;
  }

  async read(ownerUserId: string, keyHash: string): Promise<CodexWebWebhookConversation | null> {
    const file = await this.readFile();
    return file.conversations[conversationKey(ownerUserId, keyHash)] ?? null;
  }

  async bind(
    conversation: CodexWebWebhookConversation,
  ): Promise<{ conversation: CodexWebWebhookConversation; created: boolean }> {
    return withFileLock(`${this.conversationPath}.lock`, async () => {
      const file = await this.readFile();
      const normalized = normalizeConversation(conversation);
      const key = conversationKey(normalized.ownerUserId, normalized.keyHash);
      const existing = file.conversations[key];
      if (existing) {
        return { conversation: existing, created: false };
      }
      file.conversations[key] = normalized;
      await this.writeFile(file);
      return { conversation: normalized, created: true };
    });
  }

  async bindMany(conversations: CodexWebWebhookConversation[]): Promise<number> {
    if (!conversations.length) {
      return 0;
    }
    return withFileLock(`${this.conversationPath}.lock`, async () => {
      const file = await this.readFile();
      let created = 0;
      for (const conversation of conversations) {
        const normalized = normalizeConversation(conversation);
        const key = conversationKey(normalized.ownerUserId, normalized.keyHash);
        if (file.conversations[key]) {
          continue;
        }
        file.conversations[key] = normalized;
        created += 1;
      }
      if (created > 0) {
        await this.writeFile(file);
      }
      return created;
    });
  }

  async touch(ownerUserId: string, keyHash: string, updatedAt = new Date().toISOString()): Promise<void> {
    await withFileLock(`${this.conversationPath}.lock`, async () => {
      const file = await this.readFile();
      const key = conversationKey(ownerUserId, keyHash);
      const existing = file.conversations[key];
      if (!existing) {
        return;
      }
      file.conversations[key] = normalizeConversation({ ...existing, updatedAt });
      await this.writeFile(file);
    });
  }

  async withConversationOperationLock<T>(
    ownerUserId: string,
    keyHash: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockPath = path.join(
      `${this.conversationPath}.operation-locks`,
      `${conversationKey(ownerUserId, keyHash)}.lock`,
    );
    return withFileLock(lockPath, operation, {
      staleMs: OPERATION_LOCK_STALE_MS,
      timeoutMs: OPERATION_LOCK_TIMEOUT_MS,
      retireClaimStaleMs: OPERATION_LOCK_STALE_MS,
    });
  }

  private async readFile(): Promise<WebhookConversationFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.conversationPath, 'utf8')) as Partial<WebhookConversationFile>;
      if (parsed.version !== 1 || !isRecord(parsed.conversations)) {
        throw new Error(`Invalid webhook conversation file: ${this.conversationPath}`);
      }
      const conversations: Record<string, CodexWebWebhookConversation> = {};
      for (const [key, value] of Object.entries(parsed.conversations)) {
        if (!isRecord(value)) {
          throw new Error(`Invalid webhook conversation entry: ${this.conversationPath}`);
        }
        const normalized = normalizeConversation(value as unknown as CodexWebWebhookConversation);
        if (!normalized.ownerUserId || !normalized.keyHash || !normalized.sessionId) {
          throw new Error(`Invalid webhook conversation entry: ${this.conversationPath}`);
        }
        if (key !== conversationKey(normalized.ownerUserId, normalized.keyHash)) {
          throw new Error(`Invalid webhook conversation key: ${this.conversationPath}`);
        }
        conversations[key] = normalized;
      }
      return { version: 1, conversations };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, conversations: {} };
      }
      throw error;
    }
  }

  private async writeFile(file: WebhookConversationFile): Promise<void> {
    await fs.mkdir(path.dirname(this.conversationPath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.conversationPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tempPath, this.conversationPath);
      await fs.chmod(this.conversationPath, 0o600).catch(() => {});
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}

export function hashWebhookConversationKey(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function conversationKey(ownerUserId: string, keyHash: string): string {
  return crypto.createHash('sha256').update(`${ownerUserId}\0${keyHash}`).digest('hex');
}

function normalizeConversation(value: CodexWebWebhookConversation): CodexWebWebhookConversation {
  const createdAt = normalizeString(value.createdAt) || new Date().toISOString();
  return {
    ownerUserId: normalizeString(value.ownerUserId),
    keyHash: normalizeString(value.keyHash),
    sessionId: normalizeString(value.sessionId),
    projectId: nullableString(value.projectId),
    createdAt,
    updatedAt: normalizeString(value.updatedAt) || createdAt,
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
