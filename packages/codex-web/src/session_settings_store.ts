import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ProviderTurnSessionSettings } from '@codex-mobile-web-app/codex-native-api';
import { withFileLockSync } from './file_lock.js';

export type CodexWebStoredSessionSettings = ProviderTurnSessionSettings & {
  favorite?: boolean;
  favoriteOrder?: number | null;
};

export interface CodexWebSessionSettingsStore {
  get(sessionId: string): CodexWebStoredSessionSettings | null;
  list?(): Array<[string, CodexWebStoredSessionSettings]>;
  set(sessionId: string, settings: CodexWebStoredSessionSettings): void;
  delete(sessionId: string): void;
}

interface SessionSettingsFile {
  version: 1;
  sessions: Record<string, CodexWebStoredSessionSettings>;
}

export class FileSessionSettingsStore implements CodexWebSessionSettingsStore {
  private readonly settingsPath: string;

  constructor({ settingsPath }: { settingsPath: string }) {
    this.settingsPath = settingsPath;
  }

  get(sessionId: string): CodexWebStoredSessionSettings | null {
    return normalizeSettings(sessionId, this.read().sessions[sessionId]);
  }

  list(): Array<[string, CodexWebStoredSessionSettings]> {
    return Object.entries(this.read().sessions)
      .map(([sessionId, settings]) => [sessionId, normalizeSettings(sessionId, settings)] as const)
      .filter((entry): entry is [string, CodexWebStoredSessionSettings] => Boolean(entry[1]));
  }

  set(sessionId: string, settings: CodexWebStoredSessionSettings): void {
    const normalized = normalizeSettings(sessionId, settings);
    if (!normalized) {
      throw new TypeError(`Invalid session settings for ${sessionId}`);
    }
    withFileLockSync(`${this.settingsPath}.lock`, () => {
      const file = this.read();
      file.sessions[sessionId] = normalized;
      this.write(file);
    });
  }

  delete(sessionId: string): void {
    withFileLockSync(`${this.settingsPath}.lock`, () => {
      const file = this.read();
      if (!(sessionId in file.sessions)) {
        return;
      }
      delete file.sessions[sessionId];
      this.write(file);
    });
  }

  private read(): SessionSettingsFile {
    let raw: string;
    try {
      raw = fs.readFileSync(this.settingsPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyFile();
      }
      throw error;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.sessions)) {
      throw new Error(`Invalid session settings file: ${this.settingsPath}`);
    }
    const sessions: Record<string, CodexWebStoredSessionSettings> = {};
    for (const [sessionId, settings] of Object.entries(parsed.sessions)) {
      const normalized = normalizeSettings(sessionId, settings as CodexWebStoredSessionSettings);
      if (!normalized) {
        throw new Error(`Invalid session settings entry for ${sessionId}: ${this.settingsPath}`);
      }
      sessions[sessionId] = normalized;
    }
    return { version: 1, sessions };
  }

  private write(file: SessionSettingsFile): void {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true, mode: 0o700 });
    const tmpPath = `${this.settingsPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmpPath, this.settingsPath);
      try {
        fs.chmodSync(this.settingsPath, 0o600);
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

function emptyFile(): SessionSettingsFile {
  return { version: 1, sessions: {} };
}

function normalizeSettings(
  sessionId: string,
  value: CodexWebStoredSessionSettings | undefined,
): CodexWebStoredSessionSettings | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    bridgeSessionId: typeof value.bridgeSessionId === 'string' ? value.bridgeSessionId : sessionId,
    model: nullableString(value.model),
    reasoningEffort: nullableString(value.reasoningEffort),
    serviceTier: nullableString(value.serviceTier),
    collaborationMode: value.collaborationMode === 'plan' ? 'plan' : 'default',
    personality: value.personality === 'friendly' || value.personality === 'none' ? value.personality : 'pragmatic',
    accessPreset: value.accessPreset === 'read-only' || value.accessPreset === 'full-access'
      ? value.accessPreset
      : 'default',
    approvalPolicy: nullableString(value.approvalPolicy),
    sandboxMode: nullableString(value.sandboxMode),
    locale: nullableString(value.locale),
    metadata: isRecord(value.metadata) ? value.metadata : {},
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
    favorite: value.favorite === true,
    favoriteOrder: Number.isFinite(value.favoriteOrder) ? Number(value.favoriteOrder) : null,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
