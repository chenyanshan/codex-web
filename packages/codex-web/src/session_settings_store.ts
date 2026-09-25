import { SessionPartitionStore } from './session_partition_store.js';
import type { ProviderTurnSessionSettings } from '@codex-mobile-web-app/codex-native-api';

export type CodexWebStoredSessionSettings = ProviderTurnSessionSettings & {
  listOrderAt?: number | null;
  favorite?: boolean;
  favoriteOrder?: number | null;
};

export interface CodexWebSessionSettingsStore {
  dispose?(): Promise<void>;
  revision?(): Promise<string>;
  get(sessionId: string): CodexWebStoredSessionSettings | null | Promise<CodexWebStoredSessionSettings | null>;
  list?(): Array<[string, CodexWebStoredSessionSettings]> | Promise<Array<[string, CodexWebStoredSessionSettings]>>;
  set(sessionId: string, settings: CodexWebStoredSessionSettings): void | Promise<void>;
  updateListOrder?(sessionId: string, settings: CodexWebStoredSessionSettings, at: number, initializeOnly: boolean): Promise<CodexWebStoredSessionSettings>;
  delete(sessionId: string): void | Promise<void>;
}

export class FileSessionSettingsStore implements CodexWebSessionSettingsStore {
  private mutationTail: Promise<unknown> | null = null;
  async dispose(): Promise<void> {
    await this.mutationTail?.catch(() => {});
    await this.store.dispose();
  }
  // Contending on the disk lock within one instance adds polling delays and can
  // time out large metadata bootstraps. Only the queue head acquires that lock;
  // the partition store still serializes independent processes/instances.
  private serializeMutation<T>(mutate: () => Promise<T>): Promise<T> {
    const pending = (this.mutationTail ?? Promise.resolve()).catch(() => {}).then(mutate);
    this.mutationTail = pending;
    void pending.finally(() => {
      if (this.mutationTail === pending) this.mutationTail = null;
    }).catch(() => {});
    return pending;
  }
  private readonly store: SessionPartitionStore<CodexWebStoredSessionSettings>;
  constructor({ settingsPath }: { settingsPath: string }) {
    this.store = new SessionPartitionStore(settingsPath, (value, id) => {
      const settings = normalizeSettings(id, value as CodexWebStoredSessionSettings);
      if (!settings) throw new Error(`Invalid session settings entry for ${id}: ${settingsPath}`);
      return settings;
    });
  }
  revision(): Promise<string> { return this.store.revision(); }
  get(sessionId: string): Promise<CodexWebStoredSessionSettings | null> { return this.store.get(sessionId); }
  list(): Promise<Array<[string, CodexWebStoredSessionSettings]>> { return this.store.list(); }
  async set(sessionId: string, settings: CodexWebStoredSessionSettings): Promise<void> {
    await this.serializeMutation(() => this.store.mutate(sessionId, (current) => ({
      ...settings,
      // Settings snapshots may predate an accepted instruction. Only updateListOrder advances this field.
      listOrderAt: current?.listOrderAt ?? settings.listOrderAt ?? null,
    })));
  }
  async updateListOrder(sessionId: string, settings: CodexWebStoredSessionSettings, at: number, initializeOnly: boolean): Promise<CodexWebStoredSessionSettings> {
    let result = settings;
    await this.serializeMutation(() => this.store.mutate(sessionId, (current) => {
      const previous = current?.listOrderAt;
      result = {
        ...(current ?? settings),
        listOrderAt: initializeOnly && previous != null ? previous : Math.max(previous ?? 0, at),
      };
      return result;
    }));
    return result;
  }
  async delete(sessionId: string): Promise<void> { await this.serializeMutation(() => this.store.mutate(sessionId, () => null)); }
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
    listOrderAt: typeof value.listOrderAt === 'number' && Number.isFinite(value.listOrderAt) ? value.listOrderAt : null,
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
