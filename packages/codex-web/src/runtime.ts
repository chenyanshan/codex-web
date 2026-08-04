import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CodexAppClient,
  createStderrLogger,
  type CodexTurnInput,
  type ProviderApprovalRequest,
  type ProviderConfigDefaults,
  type ProviderModelInfo,
  type ProviderSkillsListResult,
  type ProviderThreadGoal,
  type ProviderThreadListResult,
  type ProviderThreadStartResult,
  type ProviderThreadSummary,
  type ProviderThreadTurn,
  type ProviderThreadTurnItem,
  type ProviderTurnAttachment,
  type ProviderTurnProgress,
  type ProviderTurnResult,
  type ProviderTurnSessionSettings,
  type ProviderTurnWorkEvent,
  type ProviderUsageReport,
  resolveCodexHome,
} from '@codex-mobile-web-app/codex-native-api';
import { CodexWebEventBus } from './event_bus.js';
import {
  historyWorkSummary,
  mergeBoundedWorkSummary,
} from './event_memory.js';
import {
  createBatchCompletedEvent,
  isTerminalProviderTurnResult,
  normalizeApprovalBatchEvent,
  normalizeApprovalBatchUpdatedEvent,
  normalizeApprovalEvent,
  normalizeApprovalResolvedEvent,
  normalizeProgressEvent,
  normalizeTurnCompletedEvent,
  normalizeTurnFailedEvent,
  normalizeTurnStartedEvent,
  normalizeWorkBatchEvents,
  type CodexWebEvent,
} from './event_model.js';
import type {
  CodexWebSessionSettingsStore,
  CodexWebStoredSessionSettings,
} from './session_settings_store.js';
import type {
  CodexWebSessionTimelineStore,
  CodexWebTimelineMessage,
} from './session_timeline_store.js';

const CODEX_WEB_MODEL_DEFAULTS_VERSION = 2;
const LEGACY_DEFAULT_MODEL = 'gpt-5.4';
const LEGACY_DEFAULT_REASONING_EFFORT = 'xhigh';
const SESSION_STATUS_SUMMARY_CACHE_MS = 5_000;

interface CodexWebRuntimeLogger {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface CodexWebSession {
  id: string;
  cwd: string | null;
  projectName: string | null;
  title: string | null;
  updatedAt: number | null;
  preview: string | null;
  firstUserInput: string | null;
  lastUserInput: string | null;
  lastInputAt: number | null;
  favorite: boolean;
  favoriteOrder: number | null;
  goal?: ProviderThreadGoal | null;
  activeTurnId: string | null;
  activityState: CodexWebSessionActivityState;
  settings: CodexWebStoredSessionSettings;
  thread: ProviderThreadSummary;
  timeline: CodexWebTimelineMessage[];
}

export type CodexWebSessionActivityState = 'running' | 'waiting_approval' | null;

export interface CodexWebRuntimeClient {
  stop?(): Promise<void> | void;
  listModels(): Promise<ProviderModelInfo[]>;
  readConfigDefaults?(args?: { cwd?: string | null }): Promise<ProviderConfigDefaults>;
  readUsage(): Promise<ProviderUsageReport | null>;
  listThreads(args?: {
    limit?: number;
    cursor?: string | null;
    searchTerm?: string | null;
    archived?: boolean | null;
  }): Promise<ProviderThreadListResult>;
  startThread(args?: {
    cwd?: string | null;
    title?: string | null;
    model?: string | null;
    serviceTier?: string | null;
    sandboxMode?: string;
    approvalPolicy?: string;
    ephemeral?: boolean | null;
    runtimeEnv?: Record<string, string | null>;
  }): Promise<ProviderThreadStartResult>;
  readThread(threadId: string, includeTurns?: boolean): Promise<ProviderThreadSummary | null>;
  resumeThread?(args: {
    threadId: string;
    approvalPolicy?: string | null;
    sandboxMode?: string | null;
    runtimeEnv?: Record<string, string | null>;
    developerInstructions?: string | null;
  }): Promise<unknown>;
  listSkills?(args?: {
    cwd?: string | null;
    forceReload?: boolean;
  }): Promise<ProviderSkillsListResult>;
  getPendingApprovals?(args?: {
    threadId?: string | null;
    turnId?: string | null;
  }): ProviderApprovalRequest[];
  subscribeToApprovalRequests?(
    listener: (request: ProviderApprovalRequest) => Promise<void> | void,
    options?: { replayPending?: boolean },
  ): () => void;
  getThreadGoal?(threadId: string): Promise<ProviderThreadGoal | null>;
  setThreadGoal?(args: {
    threadId: string;
    objective?: string | null;
    status?: string | null;
    suppressAutoTurn?: boolean;
  }): Promise<ProviderThreadGoal | null>;
  startThreadGoal?(args: {
    threadId: string;
    objective?: string | null;
    status?: string | null;
    onGoalUpdated?: ((goal: ProviderThreadGoal | null) => Promise<void> | void) | null;
    onProgress?: ((progress: any) => Promise<void> | void) | null;
    onWorkEvent?: ((event: ProviderTurnWorkEvent) => Promise<void> | void) | null;
    onTurnStarted?: ((meta: Record<string, unknown>) => Promise<void> | void) | null;
    onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void> | void) | null;
    timeoutMs?: number;
  }): Promise<{ goal: ProviderThreadGoal | null; turn: ProviderTurnResult }>;
  clearThreadGoal?(threadId: string): Promise<boolean>;
  archiveThread?(threadId: string): Promise<void>;
  unarchiveThread?(threadId: string): Promise<void>;
  writeConfigValue(args: {
    keyPath: string;
    value: unknown;
    mergeStrategy?: 'replace' | 'upsert';
    filePath?: string | null;
    expectedVersion?: string | null;
  }): Promise<void>;
  reloadMcpServers?(): Promise<void>;
  startTurn(args: {
    threadId: string;
    inputText: string;
    input?: CodexTurnInput[] | null;
    cwd?: string | null;
    model?: string | null;
    effort?: string | null;
    serviceTier?: string | null;
    personality?: string | null;
    sandboxMode?: string;
    approvalPolicy?: string;
    collaborationMode?: string;
    developerInstructions?: string;
    onProgress?: ((progress: any) => Promise<void> | void) | null;
    onWorkEvent?: ((event: ProviderTurnWorkEvent) => Promise<void> | void) | null;
    onTurnStarted?: ((meta: Record<string, unknown>) => Promise<void> | void) | null;
    onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void> | void) | null;
    timeoutMs?: number;
  }): Promise<ProviderTurnResult>;
  steerTurn?(args: {
    threadId: string;
    expectedTurnId: string;
    input: CodexTurnInput[];
    clientUserMessageId?: string | null;
  }): Promise<{ turnId: string }>;
  waitForTurnResult?(args: {
    threadId: string;
    turnId: string;
    onProgress?: ((progress: any) => Promise<void> | void) | null;
    onWorkEvent?: ((event: ProviderTurnWorkEvent) => Promise<void> | void) | null;
    onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void> | void) | null;
    timeoutMs: number;
  }): Promise<ProviderTurnResult>;
  interruptTurn(args: { threadId: string; turnId: string }): Promise<void>;
  respondToApproval(args: { requestId: string; option: 1 | 2 | 3 }): Promise<void>;
}

export interface CodexWebRuntimeOptions {
  codexBin: string;
  defaultCwd: string;
  client?: CodexWebRuntimeClient;
  eventBus?: CodexWebEventBus;
  settingsStore?: CodexWebSessionSettingsStore;
  timelineStore?: CodexWebSessionTimelineStore;
  logger?: CodexWebRuntimeLogger;
}

export interface ReadSessionStatusOptions {
  archived?: boolean;
}

export interface CreateSessionInput {
  cwd?: string | null;
  title?: string | null;
  settings?: Partial<ProviderTurnSessionSettings>;
  runtimeEnv?: Record<string, string | null>;
}

export interface UpdateSessionSettingsInput {
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  collaborationMode?: 'plan' | 'default' | null;
  personality?: 'friendly' | 'pragmatic' | 'none' | null;
  accessPreset?: 'read-only' | 'default' | 'full-access' | null;
  approvalPolicy?: string | null;
  sandboxMode?: string | null;
  locale?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StartTurnInput {
  text: string;
  attachments?: ProviderTurnAttachment[];
  attachmentIds?: string[];
  settings?: Partial<ProviderTurnSessionSettings>;
  developerInstructions?: string;
  runtimeEnv?: Record<string, string | null>;
}

export interface AppendSessionTimelineEntryInput {
  id?: string | null;
  role: 'user' | 'assistant' | 'system';
  label?: string | null;
  meta?: string | null;
  text: string;
  severity?: 'error' | null;
  afterHistoryIndex?: number | null;
  afterHistoryId?: string | null;
}

export interface CodexWebCommandResult {
  type: 'command';
  command: {
    name: 'goal' | 'help';
    action: 'show' | 'set' | 'pause' | 'resume' | 'clear';
    message: string;
    goal: ProviderThreadGoal | null;
  };
  turnId?: string;
  session?: CodexWebSession | null;
}

export type CodexWebStartTurnResult = { turnId: string } | CodexWebCommandResult;

interface CodexWebTurnConflictError extends Error {
  code: 'turn_conflict';
  activeTurnId: string;
}

interface CodexWebActiveTurnNotSteerableError extends Error {
  code: 'active_turn_not_steerable';
}

export interface ListSessionsOptions {
  favorite?: boolean;
  archived?: boolean;
}

export class CodexWebRuntime {
  readonly client: CodexWebRuntimeClient;

  readonly eventBus: CodexWebEventBus;

  private readonly defaultCwd: string;

  private readonly settingsStore: CodexWebSessionSettingsStore | null;

  private readonly timelineStore: CodexWebSessionTimelineStore | null;

  private readonly sessionSettings = new Map<string, CodexWebStoredSessionSettings>();

  private readonly threadSummaries = new Map<string, ProviderThreadSummary>();

  private readonly threadSummaryCachedAt = new Map<string, number>();

  private readonly turnToThread = new Map<string, string>();

  private readonly activeTurnByThread = new Map<string, string>();

  private readonly approvalToTurn = new Map<string, string>();

  private readonly approvalToBatch = new Map<string, string>();

  private readonly activeTurns = new Map<string, Promise<ProviderTurnResult>>();

  private readonly workSummaries = new Map<string, Map<string, Record<string, unknown>>>();

  private readonly finalAnswerItemIds = new Map<string, string>();

  private readonly terminalTurns = new Set<string>();

  private unsubscribeApprovalRequests: (() => void) | null = null;

  private readonly logger: CodexWebRuntimeLogger;

  constructor({
    codexBin,
    defaultCwd,
    logger = createStderrLogger({ envVar: 'CODEX_WEB_DEBUG' }),
    client = new CodexAppClient({ codexCliBin: codexBin, logger }),
    eventBus = new CodexWebEventBus(),
    settingsStore,
    timelineStore,
  }: CodexWebRuntimeOptions) {
    this.client = client;
    this.eventBus = eventBus;
    this.defaultCwd = defaultCwd;
    this.settingsStore = settingsStore ?? null;
    this.timelineStore = timelineStore ?? null;
    this.logger = logger;
    if (typeof this.client.subscribeToApprovalRequests === 'function') {
      this.unsubscribeApprovalRequests = this.client.subscribeToApprovalRequests(
        (request) => this.captureApprovalRequest(request),
        { replayPending: true },
      );
    } else {
      this.replayPendingApprovals();
    }
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    return this.client.listModels();
  }

  async readConfigDefaults(): Promise<ProviderConfigDefaults | null> {
    if (typeof this.client.readConfigDefaults !== 'function') {
      return null;
    }
    try {
      return await this.client.readConfigDefaults({ cwd: this.defaultCwd });
    } catch (error) {
      this.logger.warn?.(`Could not read Codex config defaults: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async readUsage(): Promise<ProviderUsageReport | null> {
    if (typeof this.client.readUsage !== 'function') {
      return null;
    }
    return this.client.readUsage();
  }

  async hasAvailableSkill(name: string, cwd: string | null = null): Promise<boolean> {
    if (typeof this.client.listSkills !== 'function') {
      return false;
    }
    try {
      const result = await this.client.listSkills({ cwd, forceReload: false });
      return result.skills.some((skill) => skill.enabled && skill.name === name);
    } catch (error) {
      this.logger.warn?.(`Could not read Codex skill catalog: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async stop(): Promise<void> {
    this.unsubscribeApprovalRequests?.();
    this.unsubscribeApprovalRequests = null;
    this.sessionSettings.clear();
    this.threadSummaries.clear();
    this.threadSummaryCachedAt.clear();
    this.turnToThread.clear();
    this.activeTurnByThread.clear();
    this.approvalToTurn.clear();
    this.approvalToBatch.clear();
    this.activeTurns.clear();
    this.workSummaries.clear();
    this.finalAnswerItemIds.clear();
    this.terminalTurns.clear();
    if (typeof this.client.stop === 'function') {
      await this.client.stop();
    }
  }

  async listSessions(options: ListSessionsOptions = {}): Promise<CodexWebSession[]> {
    this.primeSessionSettingsCache();
    if (options.favorite === true) {
      return this.listFavoriteSessions();
    }
    const result = await this.client.listThreads({ limit: 100, archived: options.archived === true });
    return result.items
      .filter((thread) => typeof thread.threadId === 'string' && thread.threadId)
      .map((thread) => this.toSessionSummary(thread));
  }

  private async listFavoriteSessions(): Promise<CodexWebSession[]> {
    const favoriteIds = this.favoriteSessionIds();
    if (!favoriteIds.length) {
      return [];
    }
    const threads = await Promise.all(favoriteIds.map((threadId) => this.readFavoriteThreadSummary(threadId)));
    const sessions = threads
      .filter((thread): thread is ProviderThreadSummary => Boolean(thread?.threadId))
      .map((thread) => this.toSessionSummary(thread));
    return sessions.sort((left, right) => (left.favoriteOrder ?? Number.MAX_SAFE_INTEGER) - (right.favoriteOrder ?? Number.MAX_SAFE_INTEGER)
      || (right.lastInputAt ?? 0) - (left.lastInputAt ?? 0));
  }

  private async readFavoriteThreadSummary(threadId: string): Promise<ProviderThreadSummary | null> {
    return this.readTurnFreeThreadSummary(threadId);
  }

  private async readTurnFreeThreadSummary(threadId: string): Promise<ProviderThreadSummary | null> {
    try {
      const thread = await this.client.readThread(threadId, false);
      if (thread) {
        return thread;
      }
    } catch (error) {
      if (!isUnavailableThreadError(error)) {
        throw error;
      }
    }
    if (typeof this.client.resumeThread !== 'function') {
      return null;
    }
    try {
      await this.resumeThreadWithSessionSettings(threadId);
    } catch (error) {
      if (isUnavailableThreadError(error)) {
        return null;
      }
      throw error;
    }
    try {
      return await this.client.readThread(threadId, false);
    } catch (error) {
      if (isUnavailableThreadError(error)) {
        return null;
      }
      throw error;
    }
  }

  async createSession(input: CreateSessionInput = {}): Promise<CodexWebSession> {
    const initialSettings = this.mergeSettings(null, input.settings);
    const started = await this.client.startThread({
      cwd: input.cwd ?? this.defaultCwd,
      title: input.title ?? null,
      model: initialSettings.model,
      serviceTier: initialSettings.serviceTier,
      sandboxMode: initialSettings.sandboxMode ?? 'danger-full-access',
      approvalPolicy: initialSettings.approvalPolicy ?? 'never',
      ephemeral: false,
      ...(input.runtimeEnv ? { runtimeEnv: input.runtimeEnv } : {}),
    });
    const thread = await this.requireThread(started.threadId);
    const effectiveSettings = mergeEffectiveModelSettings(initialSettings, started);
    this.persistSessionSettings(started.threadId, {
      ...effectiveSettings,
      bridgeSessionId: started.threadId,
      updatedAt: Date.now(),
    });
    return this.toSession(thread);
  }

  async readSession(sessionId: string): Promise<CodexWebSession | null> {
    const thread = await this.readThreadSummary(sessionId);
    if (!thread) {
      const archivedThread = this.readArchivedThreadSummary(sessionId);
      return archivedThread ? this.toSession(archivedThread) : null;
    }
    this.replayPendingApprovals(sessionId);
    const session = this.toSession(thread);
    this.observeRecoveredTurn(session);
    return this.withThreadGoal(session);
  }

  isSessionArchived(sessionId: string): boolean {
    return this.readArchivedThreadSummary(sessionId) !== null;
  }

  async readSessionStatus(
    sessionId: string,
    options: ReadSessionStatusOptions = {},
  ): Promise<CodexWebSession | null> {
    this.primeSessionSettingsCache();
    const cachedThread = this.threadSummaries.get(sessionId) ?? null;
    const cachedAt = this.threadSummaryCachedAt.get(sessionId) ?? 0;
    let thread = cachedThread && Date.now() - cachedAt <= SESSION_STATUS_SUMMARY_CACHE_MS
      ? cachedThread
      : null;
    if (!thread) {
      thread = await this.readTurnFreeThreadSummary(sessionId);
    }
    if (!thread && options.archived === true) {
      thread = this.readArchivedThreadSummary(sessionId);
    }
    if (!thread) {
      this.threadSummaries.delete(sessionId);
      this.threadSummaryCachedAt.delete(sessionId);
      return null;
    }
    this.replayPendingApprovals(sessionId);
    return this.toSessionSummary(thread);
  }

  async updateSessionSettings(
    sessionId: string,
    patch: UpdateSessionSettingsInput,
  ): Promise<CodexWebSession | null> {
    const thread = await this.readThreadSummary(sessionId);
    if (!thread) {
      return null;
    }
    const nextSettings = this.mergeSettings(sessionId, patch);
    this.persistSessionSettings(sessionId, nextSettings);
    return this.toSession(thread);
  }

  async archiveSession(sessionId: string): Promise<boolean> {
    if (typeof this.client.archiveThread !== 'function') {
      throw new Error('Thread archive is not supported by this Codex runtime');
    }
    const current = this.getStoredSessionSettings(sessionId);
    let thread: ProviderThreadSummary | null = null;
    try {
      thread = await this.readThreadSummary(sessionId);
    } catch (error) {
      if (!isUnavailableThreadError(error)) {
        throw error;
      }
    }
    if (thread) {
      await this.client.archiveThread(sessionId);
    } else if (!current?.favorite) {
      return false;
    } else {
      this.deleteLocalSessionState(sessionId, { deleteTimeline: true });
    }
    return true;
  }

  async unarchiveSession(sessionId: string): Promise<CodexWebSession | null> {
    if (typeof this.client.unarchiveThread !== 'function') {
      throw new Error('Thread unarchive is not supported by this Codex runtime');
    }
    await this.client.unarchiveThread(sessionId);
    return this.readSession(sessionId);
  }

  appendSessionTimelineEntry(
    sessionId: string,
    input: AppendSessionTimelineEntryInput,
  ): CodexWebTimelineMessage | null {
    const entry = normalizeSessionTimelineEntry(sessionId, input);
    if (!entry) {
      return null;
    }
    if (!this.timelineStore) {
      return publicSessionTimelineEntry(entry);
    }
    const existing = this.timelineStore.list(sessionId);
    const next = upsertSessionTimelineEntry(existing, entry);
    this.timelineStore.replace(sessionId, next);
    return publicSessionTimelineEntry(entry);
  }

  async updateSessionFavorite(
    sessionId: string,
    favorite: boolean,
    favoriteOrder?: number | null,
  ): Promise<CodexWebSession | null> {
    const current = this.getStoredSessionSettings(sessionId);
    if (favorite && current?.favorite === true && favoriteOrder !== undefined) {
      const settings = {
        ...current,
        favorite: true,
        favoriteOrder: favoriteOrder ?? current.favoriteOrder ?? this.nextFavoriteOrder(),
        updatedAt: Date.now(),
      };
      this.persistSessionSettings(sessionId, settings);
      return this.toStoredFavoriteSession(sessionId, settings);
    }
    if (!favorite && current?.favorite === true) {
      const settings = {
        ...current,
        favorite: false,
        favoriteOrder: null,
        updatedAt: Date.now(),
      };
      this.persistSessionSettings(sessionId, settings);
      let thread: ProviderThreadSummary | null = null;
      try {
        thread = await this.readThreadSummary(sessionId);
      } catch (error) {
        if (!isUnavailableThreadError(error)) {
          throw error;
        }
      }
      return thread ? this.toSession(thread) : null;
    }
    const thread = await this.readThreadSummary(sessionId);
    if (!thread) {
      return null;
    }
    const existing = this.getSessionSettings(sessionId);
    const settings = {
      ...existing,
      favorite,
      favoriteOrder: favorite ? favoriteOrder ?? existing.favoriteOrder ?? this.nextFavoriteOrder() : null,
      updatedAt: Date.now(),
    };
    this.persistSessionSettings(sessionId, settings);
    return this.toSession(thread);
  }

  async reloadRuntime(): Promise<{ mcpServersReloaded: boolean }> {
    if (typeof this.client.reloadMcpServers !== 'function') {
      return { mcpServersReloaded: false };
    }
    await this.client.reloadMcpServers();
    return { mcpServersReloaded: true };
  }

  async startTurn(sessionId: string, input: StartTurnInput): Promise<CodexWebStartTurnResult> {
    const session = await this.readSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    const helpCommand = parseHelpSlashCommand(input.text);
    if (helpCommand) {
      await this.ensureThreadReadyForTurn(sessionId, input.runtimeEnv);
      const result = createHelpCommandResult();
      this.appendCommandTimeline(sessionId, input.text, result.command, timelineMessagesFromThread(session.thread));
      return {
        ...result,
        session: await this.readSession(sessionId),
      };
    }
    const goalCommand = parseGoalSlashCommand(input.text);
    if (goalCommand) {
      if (goalCommand.action === 'set' || goalCommand.action === 'resume') {
        const conflictingTurnId = this.conflictingActiveTurnId(session);
        if (conflictingTurnId) {
          throw createTurnConflictError(sessionId, conflictingTurnId);
        }
      }
      await this.ensureThreadReadyForTurn(sessionId, input.runtimeEnv, input.developerInstructions);
      if (goalCommand.action === 'set' || goalCommand.action === 'resume') {
        return this.startGoalCommandTurn(session, input.text, goalCommand);
      }
      const result = await this.handleGoalCommand(sessionId, goalCommand);
      this.appendCommandTimeline(sessionId, input.text, result.command, timelineMessagesFromThread(session.thread));
      return {
        ...result,
        session: await this.readSession(sessionId),
      };
    }
    const conflictingTurnId = this.conflictingActiveTurnId(session);
    if (conflictingTurnId) {
      throw createTurnConflictError(sessionId, conflictingTurnId);
    }
    let settings = this.mergeSettings(sessionId, input.settings);
    this.persistSessionSettings(sessionId, settings);
    await this.ensureThreadReadyForTurn(sessionId, input.runtimeEnv, input.developerInstructions);
    settings = this.getSessionSettings(sessionId);
    this.logDebug('turn_start_requested', {
      sessionId,
      textLength: input.text.length,
      attachmentCount: Array.isArray(input.attachments) ? input.attachments.length : 0,
      cwd: session.cwd ?? this.defaultCwd,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      serviceTier: settings.serviceTier,
      sandboxMode: settings.sandboxMode ?? 'danger-full-access',
      approvalPolicy: settings.approvalPolicy ?? 'never',
      collaborationMode: settings.collaborationMode ?? 'default',
    });
    const codexInput = buildCodexTurnInput(input.text, input.attachments);
    return this.startTrackedTurn({
      session,
      start: (callbacks) => this.client.startTurn({
        threadId: sessionId,
        inputText: input.text,
        input: codexInput,
        cwd: session.cwd ?? this.defaultCwd,
        model: settings.model,
        effort: settings.reasoningEffort,
        serviceTier: settings.serviceTier,
        personality: settings.personality ?? null,
        sandboxMode: settings.sandboxMode ?? 'danger-full-access',
        approvalPolicy: settings.approvalPolicy ?? 'never',
        collaborationMode: settings.collaborationMode ?? 'default',
        developerInstructions: input.developerInstructions ?? '',
        ...callbacks,
      }),
    });
  }

  private startTrackedTurn({
    session,
    start,
    buildStartedResult = (turnId) => ({ turnId }),
    failureHistoryOffset = 1,
  }: {
    session: CodexWebSession;
    start: (callbacks: {
      onTurnStarted: (meta: Record<string, unknown>) => Promise<void>;
      onProgress: (progress: any) => Promise<void>;
      onWorkEvent: (event: ProviderTurnWorkEvent) => Promise<void>;
      onApprovalRequest: (request: ProviderApprovalRequest) => Promise<void>;
    }) => Promise<ProviderTurnResult>;
    buildStartedResult?: (turnId: string) => CodexWebStartTurnResult;
    failureHistoryOffset?: number;
  }): Promise<CodexWebStartTurnResult> {
    const sessionId = session.id;
    let startedTurnId = '';
    let resolveStarted: ((value: CodexWebStartTurnResult) => void) | null = null;
    let rejectStarted: ((reason?: unknown) => void) | null = null;
    const startedPromise = new Promise<CodexWebStartTurnResult>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    const markTurnStarted = (turnId: string, raw: unknown): boolean => {
      if (!turnId || startedTurnId) {
        return false;
      }
      startedTurnId = turnId;
      this.rememberTurnThread(turnId, sessionId);
      this.rememberActiveTurn(sessionId, turnId);
      this.markThreadSummaryActive(sessionId);
      this.append(turnId, normalizeTurnStartedEvent({
        turnId,
        threadId: sessionId,
        raw,
      }));
      this.logDebug('turn_started', {
        sessionId,
        turnId,
        raw: summarizeRuntimeValue(raw),
      });
      try {
        resolveStarted?.(buildStartedResult(turnId));
      } catch (error) {
        rejectStarted?.(error);
        throw error;
      }
      return true;
    };
    const runPromise = start({
      onTurnStarted: async (meta) => {
        markTurnStarted(String(meta.turnId ?? ''), meta);
      },
      onProgress: async (progress) => {
        if (startedTurnId) {
          this.captureTurnProgress(startedTurnId, sessionId, progress);
        }
      },
      onWorkEvent: async (event) => {
        if (startedTurnId) {
          this.captureTurnWorkEvent(startedTurnId, event);
        }
      },
      onApprovalRequest: async (request) => {
        this.captureApprovalRequest(request, startedTurnId || null, sessionId);
      },
    }).then((result) => {
      const resultTurnId = String(result.turnId ?? '');
      markTurnStarted(resultTurnId, result);
      if (!startedTurnId) {
        throw new Error('Turn started without turn id');
      }
      this.logDebug('turn_result', {
        sessionId,
        turnId: startedTurnId,
        result: summarizeRuntimeTurnResult(result),
      });
      const normalizedEvents = normalizeTurnCompletedEvent({
        turnId: startedTurnId,
        threadId: sessionId,
        result,
        itemId: finalAnswerItemIdFromResult(result) ?? this.finalAnswerItemIds.get(startedTurnId),
      });
      this.logDebug('turn_normalized_events', {
        sessionId,
        turnId: startedTurnId,
        events: normalizedEvents.map((event) => summarizeRuntimeEvent(event)),
      });
      for (const event of normalizedEvents) {
        this.append(startedTurnId, event);
      }
      if (isTerminalProviderTurnResult(result)) {
        this.cleanupFinishedTurn(startedTurnId);
      }
      return result;
    }).catch((error: unknown) => {
      if (!startedTurnId) {
        rejectStarted?.(error);
      }
      const turnId = startedTurnId || `turn_failed_${sessionId}`;
      const failureMessage = publicRuntimeTurnFailureMessage(error);
      this.logDebug('turn_error', {
        sessionId,
        turnId,
        error: summarizeRuntimeError(error),
      });
      const event = normalizeTurnFailedEvent({
        turnId,
        threadId: sessionId,
        error: failureMessage === 'Turn failed' ? new Error(failureMessage) : error,
      });
      this.logDebug('turn_normalized_events', {
        sessionId,
        turnId,
        events: [summarizeRuntimeEvent(event)],
      });
      this.append(turnId, event);
      this.appendFailedTurnTimeline(
        sessionId,
        turnId,
        failureMessage,
        timelineMessagesFromThread(session.thread).length + failureHistoryOffset,
      );
      if (startedTurnId) {
        this.cleanupFinishedTurn(startedTurnId);
      }
      throw error;
    });
    runPromise.catch(() => {});
    startedPromise.then((started) => {
      const turnId = String(started.turnId || '');
      if (!turnId) {
        return;
      }
      this.activeTurns.set(turnId, runPromise);
      runPromise.finally(() => {
        if (this.activeTurns.get(turnId) === runPromise) {
          this.activeTurns.delete(turnId);
        }
      }).catch(() => {});
    }).catch(() => {});
    return startedPromise;
  }

  private startGoalCommandTurn(
    session: CodexWebSession,
    inputText: string,
    command: ParsedGoalSlashCommand,
  ): Promise<CodexWebStartTurnResult> {
    let commandResult: CodexWebCommandResult | null = null;
    const action = command.action === 'resume' ? 'resume' : 'set';
    return this.startTrackedTurn({
      session,
      failureHistoryOffset: 2,
      buildStartedResult: (turnId) => {
        if (!commandResult) {
          throw new Error('Goal turn started before the goal update completed');
        }
        return { ...commandResult, turnId };
      },
      start: (callbacks) => this.requireGoalStarter()({
        threadId: session.id,
        objective: action === 'set' ? command.objective : null,
        status: 'active',
        onGoalUpdated: async (goal) => {
          commandResult = createGoalCommandResult({
            action,
            goal,
            message: goal
              ? `${action === 'resume' ? 'Goal resumed' : 'Goal set'}: ${goal.objective}`
              : action === 'resume' ? 'Goal resumed.' : 'Goal set.',
          });
          this.appendCommandTimeline(
            session.id,
            inputText,
            commandResult.command,
            timelineMessagesFromThread(session.thread),
          );
        },
        ...callbacks,
      }).then(({ turn }) => turn),
    });
  }

  private async handleGoalCommand(
    sessionId: string,
    command: ParsedGoalSlashCommand,
  ): Promise<CodexWebCommandResult> {
    if (command.action === 'show') {
      const goal = await this.requireGoalReader()(sessionId);
      return createGoalCommandResult({
        action: 'show',
        goal,
        message: formatGoalMessage(goal),
      });
    }
    if (command.action === 'clear') {
      await this.requireGoalClearer()(sessionId);
      return createGoalCommandResult({
        action: 'clear',
        goal: null,
        message: 'Goal cleared.',
      });
    }
    if (command.action === 'pause') {
      const goal = await this.requireGoalSetter()({
        threadId: sessionId,
        objective: null,
        status: 'paused',
        suppressAutoTurn: true,
      });
      return createGoalCommandResult({
        action: 'pause',
        goal,
        message: goal ? `Goal paused: ${goal.objective}` : 'Goal paused.',
      });
    }
    throw new Error('Active goal commands must start a managed turn');
  }

  private requireGoalReader(): (threadId: string) => Promise<ProviderThreadGoal | null> {
    if (typeof this.client.getThreadGoal !== 'function') {
      throw new Error('Goal commands are not supported by this Codex runtime');
    }
    return this.client.getThreadGoal.bind(this.client);
  }

  private requireGoalSetter(): (args: {
    threadId: string;
    objective?: string | null;
    status?: string | null;
    suppressAutoTurn?: boolean;
  }) => Promise<ProviderThreadGoal | null> {
    if (typeof this.client.setThreadGoal !== 'function') {
      throw new Error('Goal commands are not supported by this Codex runtime');
    }
    return this.client.setThreadGoal.bind(this.client);
  }

  private requireGoalStarter(): NonNullable<CodexWebRuntimeClient['startThreadGoal']> {
    if (typeof this.client.startThreadGoal !== 'function') {
      throw new Error('Goal auto-start is not supported by this Codex runtime');
    }
    return this.client.startThreadGoal.bind(this.client);
  }

  private requireGoalClearer(): (threadId: string) => Promise<boolean> {
    if (typeof this.client.clearThreadGoal !== 'function') {
      throw new Error('Goal commands are not supported by this Codex runtime');
    }
    return this.client.clearThreadGoal.bind(this.client);
  }

  async interruptTurn(turnId: string): Promise<void> {
    const sessionId = this.turnToThread.get(turnId);
    if (!sessionId) {
      throw new Error(`Unknown turn: ${turnId}`);
    }
    await this.client.interruptTurn({ threadId: sessionId, turnId });
  }

  async steerTurn(
    turnId: string,
    input: StartTurnInput,
    clientUserMessageId: string | null = null,
  ): Promise<{ turnId: string }> {
    const sessionId = this.turnToThread.get(turnId);
    if (!sessionId) {
      throw new Error(`Unknown turn: ${turnId}`);
    }
    return this.steerTurnForThread(sessionId, turnId, input, clientUserMessageId);
  }

  threadIdForTurn(turnId: string): string | null {
    return this.turnToThread.get(turnId) ?? null;
  }

  threadIdForApproval(approvalId: string): string | null {
    const turnId = this.approvalToTurn.get(approvalId);
    return turnId ? this.threadIdForTurn(turnId) : null;
  }

  async interruptTurnForThread(threadId: string, turnId: string): Promise<void> {
    const ownerThreadId = this.threadIdForTurn(turnId);
    if (ownerThreadId !== threadId) {
      throw new Error(`Turn ${turnId} does not belong to thread ${threadId}.`);
    }
    await this.client.interruptTurn({ threadId, turnId });
  }

  async steerTurnForThread(
    threadId: string,
    expectedTurnId: string,
    input: StartTurnInput,
    clientUserMessageId: string | null = null,
  ): Promise<{ turnId: string }> {
    const steerTurn = this.client.steerTurn;
    if (typeof steerTurn !== 'function') {
      throw createActiveTurnNotSteerableError('This Codex runtime does not support turn steering.');
    }
    const ownerThreadId = this.threadIdForTurn(expectedTurnId);
    if (ownerThreadId !== threadId) {
      throw new Error(`Turn ${expectedTurnId} does not belong to thread ${threadId}.`);
    }
    try {
      const result = await steerTurn.call(this.client, {
        threadId,
        expectedTurnId,
        input: buildCodexTurnInput(input.text, input.attachments) ?? [{
          type: 'text',
          text: input.text,
          text_elements: [],
        }],
        clientUserMessageId,
      });
      if (result.turnId !== expectedTurnId) {
        throw new Error(`Codex turn/steer returned unexpected turn id ${result.turnId}.`);
      }
      this.rememberTurnThread(expectedTurnId, threadId);
      this.rememberActiveTurn(threadId, expectedTurnId);
      this.markThreadSummaryActive(threadId);
      this.logDebug('turn_steered', {
        sessionId: threadId,
        turnId: expectedTurnId,
        textLength: input.text.length,
        attachmentCount: Array.isArray(input.attachments) ? input.attachments.length : 0,
        clientUserMessageId,
      });
      return { turnId: expectedTurnId };
    } catch (error) {
      if (isActiveTurnNotSteerableError(error)) {
        throw preserveActiveTurnNotSteerableError(error);
      }
      throw error;
    }
  }

  async resolveApproval(
    approvalId: string,
    decision: 'accept' | 'accept_for_session' | 'deny',
  ): Promise<void> {
    const turnId = this.approvalToTurn.get(approvalId);
    if (!turnId) {
      throw new Error(`Unknown approval: ${approvalId}`);
    }
    const option = mapApprovalDecision(decision);
    await this.client.respondToApproval({ requestId: approvalId, option });
    this.append(turnId, normalizeApprovalResolvedEvent({
      turnId,
      approvalId,
      decision: mapResolvedDecision(decision),
    }));
    this.append(turnId, createBatchCompletedEvent({
      turnId,
      batchId: this.approvalToBatch.get(approvalId) ?? approvalId,
      status: mapResolvedDecision(decision),
    }));
    this.approvalToTurn.delete(approvalId);
    this.approvalToBatch.delete(approvalId);
  }

  async resolveApprovalForThread(
    threadId: string,
    approvalId: string,
    decision: 'accept' | 'accept_for_session' | 'deny',
  ): Promise<void> {
    const ownerThreadId = this.threadIdForApproval(approvalId);
    if (ownerThreadId !== threadId) {
      throw new Error(`Approval ${approvalId} does not belong to thread ${threadId}.`);
    }
    await this.resolveApproval(approvalId, decision);
  }

  getTurnEvents(turnId: string, afterId?: string | number | null) {
    return this.eventBus.list(turnId, afterId);
  }

  getTurnEventReplay(
    turnId: string,
    afterId?: string | number | null,
    requestedEpoch?: string | null,
  ) {
    return this.eventBus.replay(turnId, afterId, requestedEpoch);
  }

  getTurnEventSnapshot(turnId: string) {
    return this.eventBus.snapshot(turnId);
  }

  hasActiveTurn(turnId: string): boolean {
    return this.activeTurns.has(turnId);
  }

  subscribeToTurn(turnId: string, listener: (entry: { event: CodexWebEvent; sequence: number }) => void) {
    return this.eventBus.subscribe(turnId, listener);
  }

  private captureApprovalRequest(
    request: ProviderApprovalRequest,
    fallbackTurnId: string | null = null,
    fallbackThreadId: string | null = null,
  ): void {
    const requestId = String(request.requestId ?? '').trim();
    const threadId = String(request.threadId ?? fallbackThreadId ?? '').trim();
    const turnId = String(request.turnId ?? fallbackTurnId ?? this.activeTurnIdForThread(threadId) ?? '').trim();
    if (!requestId || !threadId || !turnId) {
      this.logDebug('approval_unroutable', {
        requestId,
        threadId,
        turnId: request.turnId ?? null,
      });
      return;
    }
    if (this.approvalToTurn.get(requestId) === turnId) {
      return;
    }
    this.rememberTurnThread(turnId, threadId);
    this.rememberActiveTurn(threadId, turnId);
    this.approvalToTurn.set(requestId, turnId);
    this.approvalToBatch.set(requestId, request.itemId || requestId);
    this.append(turnId, normalizeApprovalBatchEvent({ turnId, request }));
    this.append(turnId, normalizeApprovalBatchUpdatedEvent({ turnId, request }));
    this.append(turnId, normalizeApprovalEvent({ turnId, request }));
    this.logDebug('approval_captured', {
      requestId,
      threadId,
      turnId,
      kind: request.kind,
    });
  }

  private replayPendingApprovals(threadId: string | null = null): void {
    if (typeof this.client.getPendingApprovals !== 'function') {
      return;
    }
    for (const request of this.client.getPendingApprovals({ threadId })) {
      this.captureApprovalRequest(request);
    }
  }

  private captureTurnWorkEvent(turnId: string, event: ProviderTurnWorkEvent): void {
    const turnWorkSummaries = this.workSummaries.get(turnId) ?? new Map<string, Record<string, unknown>>();
    this.workSummaries.set(turnId, turnWorkSummaries);
    const existing = turnWorkSummaries.get(event.itemId) ?? {};
    const update = event.summary ?? {};
    mergeBoundedWorkSummary(existing, update);
    turnWorkSummaries.set(event.itemId, existing);
    for (const normalized of normalizeWorkBatchEvents({
      turnId,
      event: {
        ...event,
        summary: historyWorkSummary(update, existing, event.type),
      },
    })) {
      this.append(turnId, normalized);
    }
  }

  private captureTurnProgress(
    turnId: string,
    threadId: string,
    progress: ProviderTurnProgress,
  ): void {
    const event = normalizeProgressEvent({ turnId, threadId, progress });
    if (event.type === 'assistant.delta' && event.phase === 'final_answer' && event.itemId) {
      this.finalAnswerItemIds.set(turnId, event.itemId);
    }
    this.append(turnId, event);
  }

  private observeRecoveredTurn(session: CodexWebSession): void {
    const turnId = session.activeTurnId;
    if (
      !turnId
      || threadRuntimeStatusType(session.thread) !== 'active'
      || this.activeTurns.has(turnId)
      || typeof this.client.waitForTurnResult !== 'function'
    ) {
      return;
    }
    this.rememberTurnThread(turnId, session.id);
    if (!this.eventBus.list(turnId).some((entry) => entry.event.type === 'turn.started')) {
      this.append(turnId, normalizeTurnStartedEvent({
        turnId,
        threadId: session.id,
        raw: { recovered: true },
      }));
    }
    const runPromise = this.client.waitForTurnResult({
      threadId: session.id,
      turnId,
      timeoutMs: 15 * 60 * 1000,
      onProgress: async (progress) => {
        this.captureTurnProgress(turnId, session.id, progress);
      },
      onWorkEvent: async (event) => {
        this.captureTurnWorkEvent(turnId, event);
      },
      onApprovalRequest: async (request) => {
        this.captureApprovalRequest(request, turnId, session.id);
      },
    });
    this.activeTurns.set(turnId, runPromise);
    void runPromise.then((result) => {
      for (const event of normalizeTurnCompletedEvent({
        turnId,
        threadId: session.id,
        result,
        itemId: finalAnswerItemIdFromResult(result) ?? this.finalAnswerItemIds.get(turnId),
      })) {
        this.append(turnId, event);
      }
      if (isTerminalProviderTurnResult(result)) {
        this.cleanupFinishedTurn(turnId);
      }
    }).catch((error: unknown) => {
      const failureMessage = publicRuntimeTurnFailureMessage(error);
      this.append(turnId, normalizeTurnFailedEvent({
        turnId,
        threadId: session.id,
        error: failureMessage === 'Turn failed' ? new Error(failureMessage) : error,
      }));
      this.cleanupFinishedTurn(turnId);
    }).finally(() => {
      if (this.activeTurns.get(turnId) === runPromise) {
        this.activeTurns.delete(turnId);
      }
    });
  }

  private append(turnId: string, event: CodexWebEvent): void {
    if (
      this.terminalTurns.has(turnId)
      && event.type !== 'approval.resolved'
      && event.type !== 'batch.completed'
    ) {
      return;
    }
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      this.logDebug('event_append', {
        turnId,
        event: summarizeRuntimeEvent(event),
      });
    }
    this.eventBus.append(turnId, event);
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      this.terminalTurns.add(turnId);
      const threadId = this.turnToThread.get(turnId);
      if (threadId) {
        this.markThreadSummaryIdle(threadId);
      }
      while (this.terminalTurns.size > MAX_TURN_THREAD_MAPPINGS) {
        const oldestTurnId = this.terminalTurns.values().next().value as string | undefined;
        if (!oldestTurnId) {
          break;
        }
        this.terminalTurns.delete(oldestTurnId);
      }
    }
  }

  private logDebug(event: string, payload: unknown = null): void {
    try {
      this.logger.debug?.(`[codex-web-runtime] ${event} ${JSON.stringify(payload)}`);
    } catch {
      this.logger.debug?.(`[codex-web-runtime] ${event}`);
    }
  }

  private async requireThread(threadId: string): Promise<ProviderThreadSummary> {
    const thread = await this.readThreadSummary(threadId);
    if (!thread) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    return thread;
  }

  private async readThreadSummary(threadId: string): Promise<ProviderThreadSummary | null> {
    try {
      const thread = await this.client.readThread(threadId, true);
      if (thread) {
        return thread;
      }
      return this.resumeAndReadThread(threadId);
    } catch (error) {
      if (isMissingThreadError(error)) {
        return this.resumeAndReadThread(threadId);
      }
      if (!isIncludeTurnsRetryableError(error)) {
        throw error;
      }
      const thread = await this.client.readThread(threadId, false);
      if (thread) {
        return thread;
      }
      return this.resumeAndReadThread(threadId);
    }
  }

  private async resumeAndReadThread(threadId: string): Promise<ProviderThreadSummary | null> {
    if (typeof this.client.resumeThread !== 'function') {
      return null;
    }
    try {
      await this.resumeThreadWithSessionSettings(threadId);
    } catch (error) {
      if (isMissingThreadError(error)) {
        return null;
      }
      throw error;
    }
    try {
      const thread = await this.client.readThread(threadId, true);
      if (thread) {
        return thread;
      }
    } catch (error) {
      if (isMissingThreadError(error)) {
        return null;
      }
      if (!isIncludeTurnsRetryableError(error)) {
        throw error;
      }
    }
    return this.client.readThread(threadId, false);
  }

  private readArchivedThreadSummary(threadId: string): ProviderThreadSummary | null {
    const archivedDir = path.join(resolveCodexHome(), 'archived_sessions');
    let fileNames: string[] = [];
    try {
      fileNames = fs.readdirSync(archivedDir)
        .filter((name) => name.endsWith('.jsonl'));
    } catch {
      return null;
    }
    const prioritized = [
      ...fileNames.filter((name) => name.includes(threadId)),
      ...fileNames.filter((name) => !name.includes(threadId)),
    ];
    for (const fileName of prioritized) {
      const thread = readArchivedThreadFromFile(path.join(archivedDir, fileName), threadId);
      if (thread) {
        return thread;
      }
    }
    return null;
  }

  private async ensureThreadReadyForTurn(
    threadId: string,
    runtimeEnv: Record<string, string | null> | undefined = undefined,
    developerInstructions: string | undefined = undefined,
  ): Promise<void> {
    if (typeof this.client.resumeThread !== 'function') {
      return;
    }
    try {
      await this.resumeThreadWithSessionSettings(threadId, runtimeEnv, developerInstructions);
    } catch (error) {
      if (isMissingRolloutError(error)) {
        return;
      }
      throw error;
    }
  }

  private async resumeThreadWithSessionSettings(
    threadId: string,
    runtimeEnv: Record<string, string | null> | undefined = undefined,
    developerInstructions: string | undefined = undefined,
  ): Promise<void> {
    if (typeof this.client.resumeThread !== 'function') {
      return;
    }
    const settings = this.getSessionSettings(threadId);
    const permissions = resolveResumePermissions(settings);
    const resumed = await this.client.resumeThread({
      threadId,
      approvalPolicy: permissions.approvalPolicy,
      sandboxMode: permissions.sandboxMode,
      runtimeEnv: runtimeEnv ?? { CODEX_WEB_CONTEXT_FILE: null },
      developerInstructions: developerInstructions ?? null,
    });
    const effectiveSettings = mergeEffectiveModelSettings(settings, resumed);
    if (effectiveSettings !== settings) {
      this.persistSessionSettings(threadId, effectiveSettings);
    }
  }

  private toSession(thread: ProviderThreadSummary): CodexWebSession {
    this.rememberThreadSummary(thread);
    this.rememberThreadTurns(thread);
    const current = this.getSessionSettings(thread.threadId);
    const updatedAt = thread.updatedAt ?? null;
    const inputSummary = summarizeSessionInputs(thread);
    const activeTurnId = this.activeTurnIdForThread(thread.threadId, thread);
    return {
      id: thread.threadId,
      cwd: thread.cwd,
      projectName: summarizeProjectName(thread.cwd),
      title: thread.title,
      updatedAt,
      preview: thread.preview ?? null,
      firstUserInput: inputSummary.firstUserInput,
      lastUserInput: inputSummary.lastUserInput,
      lastInputAt: updatedAt,
      favorite: current.favorite === true,
      favoriteOrder: current.favoriteOrder ?? null,
      goal: null,
      activeTurnId,
      activityState: sessionActivityState(
        thread,
        activeTurnId,
        Boolean(this.pendingApprovalTurnIdForThread(thread.threadId)),
      ),
      settings: current,
      thread,
      timeline: composeSessionTimeline(thread, this.timelineStore?.list(thread.threadId) ?? []),
    };
  }

  private toSessionSummary(thread: ProviderThreadSummary): CodexWebSession {
    this.rememberThreadSummary(thread);
    this.rememberThreadTurns(thread);
    const current = this.getSessionSettings(thread.threadId);
    const updatedAt = thread.updatedAt ?? null;
    const inputSummary = summarizeSessionInputs(thread);
    const activeTurnId = this.activeTurnIdForThread(thread.threadId, thread);
    return {
      id: thread.threadId,
      cwd: thread.cwd,
      projectName: summarizeProjectName(thread.cwd),
      title: thread.title,
      updatedAt,
      preview: thread.preview ?? null,
      firstUserInput: inputSummary.firstUserInput,
      lastUserInput: inputSummary.lastUserInput,
      lastInputAt: updatedAt,
      favorite: current.favorite === true,
      favoriteOrder: current.favoriteOrder ?? null,
      activeTurnId,
      activityState: sessionActivityState(
        thread,
        activeTurnId,
        Boolean(this.pendingApprovalTurnIdForThread(thread.threadId)),
      ),
      settings: current,
      thread: { ...thread, turns: [] },
      timeline: [],
    };
  }

  private rememberThreadSummary(thread: ProviderThreadSummary): void {
    if (!thread.threadId) {
      return;
    }
    this.threadSummaries.set(thread.threadId, { ...thread, turns: [] });
    this.threadSummaryCachedAt.set(thread.threadId, Date.now());
    while (this.threadSummaries.size > MAX_TURN_THREAD_MAPPINGS) {
      const oldestThreadId = this.threadSummaries.keys().next().value as string | undefined;
      if (!oldestThreadId) {
        break;
      }
      this.threadSummaries.delete(oldestThreadId);
      this.threadSummaryCachedAt.delete(oldestThreadId);
    }
  }

  private markThreadSummaryActive(threadId: string): void {
    const thread = this.threadSummaries.get(threadId);
    if (!thread) {
      return;
    }
    this.threadSummaries.set(threadId, {
      ...thread,
      runtimeStatus: {
        type: 'active',
        activeFlags: thread.runtimeStatus?.activeFlags ?? [],
      },
    });
    this.threadSummaryCachedAt.set(threadId, Date.now());
  }

  private markThreadSummaryIdle(threadId: string): void {
    this.activeTurnByThread.delete(threadId);
    const thread = this.threadSummaries.get(threadId);
    if (!thread) {
      return;
    }
    this.threadSummaries.set(threadId, {
      ...thread,
      runtimeStatus: {
        type: 'idle',
        activeFlags: [],
      },
    });
    this.threadSummaryCachedAt.set(threadId, Date.now());
  }

  private toStoredFavoriteSession(
    sessionId: string,
    settings: CodexWebStoredSessionSettings,
  ): CodexWebSession {
    const updatedAt = settings.updatedAt ?? null;
    const thread: ProviderThreadSummary = {
      threadId: sessionId,
      cwd: null,
      title: null,
      updatedAt,
      preview: '',
      turns: [],
    };
    return {
      id: sessionId,
      cwd: null,
      projectName: null,
      title: null,
      updatedAt,
      preview: null,
      firstUserInput: null,
      lastUserInput: null,
      lastInputAt: updatedAt,
      favorite: settings.favorite === true,
      favoriteOrder: settings.favoriteOrder ?? null,
      activeTurnId: null,
      activityState: null,
      settings,
      thread,
      timeline: this.timelineStore?.list(sessionId) ?? [],
    };
  }

  private rememberTurnThread(turnId: string, threadId: string): void {
    if (this.turnToThread.has(turnId)) {
      this.turnToThread.delete(turnId);
    }
    this.turnToThread.set(turnId, threadId);
    while (this.turnToThread.size > MAX_TURN_THREAD_MAPPINGS) {
      const oldestTurnId = this.turnToThread.keys().next().value as string | undefined;
      if (!oldestTurnId) {
        break;
      }
      this.turnToThread.delete(oldestTurnId);
    }
  }

  private rememberActiveTurn(threadId: string, turnId: string): void {
    if (this.activeTurnByThread.has(threadId)) {
      this.activeTurnByThread.delete(threadId);
    }
    this.activeTurnByThread.set(threadId, turnId);
    while (this.activeTurnByThread.size > MAX_TURN_THREAD_MAPPINGS) {
      const oldestThreadId = this.activeTurnByThread.keys().next().value as string | undefined;
      if (!oldestThreadId) {
        break;
      }
      this.activeTurnByThread.delete(oldestThreadId);
    }
  }

  private rememberThreadTurns(thread: ProviderThreadSummary): void {
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    for (const turn of turns) {
      if (turn?.id) {
        this.rememberTurnThread(turn.id, thread.threadId);
      }
    }
  }

  private cleanupFinishedTurn(turnId: string): void {
    this.workSummaries.delete(turnId);
    this.finalAnswerItemIds.delete(turnId);
  }

  private activeTurnIdForThread(threadId: string, thread: ProviderThreadSummary | null = null): string | null {
    const approvalTurnId = this.pendingApprovalTurnIdForThread(threadId);
    if (approvalTurnId) {
      return approvalTurnId;
    }
    const providerTurnId = latestActiveThreadTurnId(thread);
    const runtimeStatus = threadRuntimeStatusType(thread);
    if (thread && runtimeStatus && runtimeStatus !== 'active') {
      this.forgetTrackedTurnsForThread(threadId);
      return null;
    }
    if (providerTurnId) {
      this.forgetTrackedTurnsForThread(threadId, providerTurnId);
      this.rememberActiveTurn(threadId, providerTurnId);
      return providerTurnId;
    }
    const rememberedTurnId = this.activeTurnByThread.get(threadId);
    if (rememberedTurnId) {
      return rememberedTurnId;
    }
    for (const [turnId] of this.activeTurns) {
      if (this.turnToThread.get(turnId) === threadId) {
        if (thread && isTerminalThreadTurn(thread, turnId)) {
          this.activeTurns.delete(turnId);
          continue;
        }
        return turnId;
      }
    }
    return latestActiveThreadTurnId(thread);
  }

  private pendingApprovalTurnIdForThread(threadId: string): string | null {
    const entries = [...this.approvalToTurn.entries()];
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const turnId = entries[index]?.[1] ?? null;
      if (turnId && this.turnToThread.get(turnId) === threadId) {
        return turnId;
      }
    }
    return null;
  }

  private forgetTrackedTurnsForThread(threadId: string, keepTurnId: string | null = null): void {
    for (const turnId of this.activeTurns.keys()) {
      if (this.turnToThread.get(turnId) === threadId && turnId !== keepTurnId) {
        this.activeTurns.delete(turnId);
      }
    }
    if (keepTurnId) {
      this.rememberActiveTurn(threadId, keepTurnId);
    } else {
      this.activeTurnByThread.delete(threadId);
    }
  }

  private conflictingActiveTurnId(session: CodexWebSession): string | null {
    return this.activeTurnIdForThread(session.id, session.thread);
  }

  private async withThreadGoal(session: CodexWebSession): Promise<CodexWebSession> {
    if (typeof this.client.getThreadGoal !== 'function') {
      return session;
    }
    let goal: ProviderThreadGoal | null = null;
    try {
      goal = await this.client.getThreadGoal(session.id);
    } catch (error) {
      if (!isUnavailableThreadError(error)) {
        throw error;
      }
    }
    return {
      ...session,
      goal,
    };
  }

  private mergeSettings(
    sessionId: string | null,
    patch: Partial<ProviderTurnSessionSettings> | UpdateSessionSettingsInput | undefined,
  ): CodexWebStoredSessionSettings {
    const current = sessionId
      ? this.getSessionSettings(sessionId)
      : createDefaultSettings('pending');
    const metadataSource = patch?.metadata && typeof patch.metadata === 'object'
      ? patch.metadata
      : current.metadata;
    const metadata = { ...metadataSource };
    if (patch) {
      delete metadata.codexWebDefaultsOnly;
      metadata.codexWebModelDefaultsVersion = CODEX_WEB_MODEL_DEFAULTS_VERSION;
    }
    return {
      ...current,
      ...patch,
      bridgeSessionId: sessionId ?? current.bridgeSessionId,
      metadata,
      updatedAt: Date.now(),
    };
  }

  private getSessionSettings(sessionId: string): CodexWebStoredSessionSettings {
    const cached = this.sessionSettings.get(sessionId);
    if (cached) {
      return cached;
    }
    const stored = this.settingsStore?.get(sessionId);
    const migratedStored = migrateLegacyModelDefaults(stored);
    const settings = migratedStored
      ? {
        ...createDefaultSettings(sessionId),
        ...migratedStored,
        bridgeSessionId: sessionId,
        metadata: migratedStored.metadata ?? {},
      }
      : {
        ...createDefaultSettings(sessionId),
        metadata: { codexWebDefaultsOnly: true },
      };
    this.sessionSettings.set(sessionId, settings);
    return settings;
  }

  private primeSessionSettingsCache(): void {
    if (typeof this.settingsStore?.list !== 'function') {
      return;
    }
    for (const [sessionId, stored] of this.settingsStore.list()) {
      const migratedStored = migrateLegacyModelDefaults(stored);
      if (!migratedStored) {
        continue;
      }
      this.sessionSettings.set(sessionId, {
        ...createDefaultSettings(sessionId),
        ...migratedStored,
        bridgeSessionId: sessionId,
        metadata: migratedStored.metadata ?? {},
      });
    }
  }

  private getStoredSessionSettings(sessionId: string): CodexWebStoredSessionSettings | null {
    return this.sessionSettings.get(sessionId) ?? this.settingsStore?.get(sessionId) ?? null;
  }

  private persistSessionSettings(sessionId: string, settings: CodexWebStoredSessionSettings): void {
    const normalized = {
      ...settings,
      bridgeSessionId: sessionId,
      metadata: settings.metadata ?? {},
    };
    this.sessionSettings.set(sessionId, normalized);
    this.settingsStore?.set(sessionId, normalized);
  }

  private deleteLocalSessionState(
    sessionId: string,
    options: { deleteTimeline: boolean } = { deleteTimeline: false },
  ): void {
    this.sessionSettings.delete(sessionId);
    this.settingsStore?.delete(sessionId);
    if (options.deleteTimeline) {
      this.timelineStore?.delete(sessionId);
    }
  }

  private favoriteSessionIds(): string[] {
    return [...this.sessionSettings.entries()]
      .filter(([, settings]) => settings.favorite === true)
      .sort(([, left], [, right]) => (left.favoriteOrder ?? Number.MAX_SAFE_INTEGER) - (right.favoriteOrder ?? Number.MAX_SAFE_INTEGER)
        || (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      .map(([sessionId]) => sessionId);
  }

  private nextFavoriteOrder(): number {
    let maxOrder = 0;
    for (const settings of this.sessionSettings.values()) {
      if (settings.favorite === true && Number.isFinite(settings.favoriteOrder)) {
        maxOrder = Math.max(maxOrder, Number(settings.favoriteOrder));
      }
    }
    return maxOrder + 1;
  }

  private findOpenApprovals(turnId: string): string[] {
    const approvalIds: string[] = [];
    for (const [approvalId, mappedTurnId] of this.approvalToTurn.entries()) {
      if (mappedTurnId === turnId) {
        approvalIds.push(approvalId);
      }
    }
    return approvalIds;
  }

  private appendCommandTimeline(
    sessionId: string,
    inputText: string,
    command: CodexWebCommandResult['command'],
    history: CodexWebTimelineMessage[],
  ): void {
    const baseId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const afterHistoryIndex = history.length;
    const afterHistoryId = history.at(-1)?.id;
    this.appendSessionTimelineEntry(sessionId, {
      id: `local_user_${baseId}`,
      role: 'user',
      label: 'You',
      meta: 'command',
      text: inputText.trim(),
      afterHistoryIndex,
      afterHistoryId,
    });
    this.appendSessionTimelineEntry(sessionId, {
      id: `command_${command.name}_${baseId}`,
      role: 'system',
      label: `/${command.name}`,
      meta: command.action || 'completed',
      text: String(command.message || 'Command completed.'),
      afterHistoryIndex,
      afterHistoryId,
    });
  }

  private appendFailedTurnTimeline(sessionId: string, turnId: string, message: string, afterHistoryIndex: number): void {
    if (!message.trim()) {
      return;
    }
    this.appendSessionTimelineEntry(sessionId, {
      id: `error_${turnId}`,
      role: 'system',
      label: 'Error',
      meta: 'failed',
      text: message,
      severity: 'error',
      afterHistoryIndex,
    });
  }
}

const SESSION_INPUT_PREVIEW_MAX_LENGTH = 240;
const MAX_TURN_THREAD_MAPPINGS = 1_000;

function summarizeProjectName(cwd: string | null | undefined): string | null {
  const segments = cwd?.split(/[\\/]+/u).filter(Boolean) ?? [];
  if (!segments.length) {
    return null;
  }
  return segments.slice(-2).join('/');
}

function summarizeSessionInputs(thread: ProviderThreadSummary): {
  firstUserInput: string | null;
  lastUserInput: string | null;
} {
  const userInputs: string[] = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      if (item.role?.toLowerCase() !== 'user') {
        continue;
      }
      const text = summarizeCodexWebSessionInputText(item.text);
      if (text) {
        userInputs.push(text);
      }
    }
  }
  if (userInputs.length) {
    return {
      firstUserInput: userInputs[0] ?? null,
      lastUserInput: userInputs[userInputs.length - 1] ?? null,
    };
  }
  const fallback = summarizeCodexWebSessionInputText(thread.preview);
  return {
    firstUserInput: fallback,
    lastUserInput: fallback,
  };
}

export function summarizeCodexWebSessionInputText(text: string | null | undefined): string | null {
  const normalized = text?.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= SESSION_INPUT_PREVIEW_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, SESSION_INPUT_PREVIEW_MAX_LENGTH - 3).trimEnd()}...`;
}

export function isCodexWebSlashCommandText(text: string | null | undefined): boolean {
  return Boolean(parseHelpSlashCommand(String(text ?? '')) || parseGoalSlashCommand(String(text ?? '')));
}

interface ParsedGoalSlashCommand {
  action: 'show' | 'set' | 'pause' | 'resume' | 'clear';
  objective?: string;
}

function parseHelpSlashCommand(text: string): { action: 'show' } | null {
  const normalized = String(text ?? '').trim();
  if (normalized === '/help') {
    return { action: 'show' };
  }
  return null;
}

function parseGoalSlashCommand(text: string): ParsedGoalSlashCommand | null {
  const normalized = String(text ?? '').trim();
  if (!normalized.startsWith('/goal')) {
    return null;
  }
  const afterCommand = normalized.slice('/goal'.length);
  if (afterCommand && !/^\s/u.test(afterCommand)) {
    return null;
  }
  const rest = afterCommand.trim();
  if (!rest) {
    return { action: 'show' };
  }
  const [firstToken = '', ...remaining] = rest.split(/\s+/u);
  const keyword = firstToken.toLowerCase();
  if (keyword === 'clear') {
    return { action: 'clear' };
  }
  if (keyword === 'pause') {
    return { action: 'pause' };
  }
  if (keyword === 'resume') {
    return { action: 'resume' };
  }
  if (keyword === 'edit' || keyword === 'set') {
    const objective = remaining.join(' ').trim();
    return objective ? { action: 'set', objective } : { action: 'show' };
  }
  return { action: 'set', objective: rest };
}

function createGoalCommandResult({
  action,
  goal,
  message,
}: {
  action: CodexWebCommandResult['command']['action'];
  goal: ProviderThreadGoal | null;
  message: string;
}): CodexWebCommandResult {
  return {
    type: 'command',
    command: {
      name: 'goal',
      action,
      message,
      goal,
    },
  };
}

function composeSessionTimeline(
  thread: ProviderThreadSummary,
  extraEntries: CodexWebTimelineMessage[],
): CodexWebTimelineMessage[] {
  const history = timelineMessagesFromThread(thread);
  if (!extraEntries.length) {
    return history;
  }
  const seen = new Set(history.map((entry) => timelineDedupKey(entry)));
  const extras = extraEntries
    .map((entry) => ({ ...entry }))
    .filter((entry) => {
      const key = timelineDedupKey(entry);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  if (!extras.length) {
    return history;
  }
  const extrasByAfterHistoryIndex = new Map<number, CodexWebTimelineMessage[]>();
  for (const entry of extras) {
    const anchoredHistoryIndex = entry.afterHistoryId
      ? history.findIndex((item) => item.id === entry.afterHistoryId)
      : -1;
    const afterHistoryIndex = entry.afterHistoryId
      ? anchoredHistoryIndex >= 0 ? anchoredHistoryIndex + 1 : 0
      : Number.isFinite(entry.afterHistoryIndex)
        ? Math.max(0, Math.min(history.length, Math.floor(Number(entry.afterHistoryIndex))))
        : history.length;
    const entries = extrasByAfterHistoryIndex.get(afterHistoryIndex) ?? [];
    entries.push(entry);
    extrasByAfterHistoryIndex.set(afterHistoryIndex, entries);
  }
  const merged: CodexWebTimelineMessage[] = [];
  const leadingExtras = extrasByAfterHistoryIndex.get(0) ?? [];
  merged.push(...leadingExtras);
  for (let index = 0; index < history.length; index += 1) {
    merged.push(history[index]!);
    const anchoredExtras = extrasByAfterHistoryIndex.get(index + 1) ?? [];
    merged.push(...anchoredExtras);
  }
  return merged;
}

function normalizeSessionTimelineEntry(
  sessionId: string,
  input: AppendSessionTimelineEntryInput,
): CodexWebTimelineMessage | null {
  if (!sessionId || !input || !['user', 'assistant', 'system'].includes(input.role)) {
    return null;
  }
  const text = String(input.text || '').trim();
  if (!text) {
    return null;
  }
  const role = input.role;
  const meta = typeof input.meta === 'string' ? input.meta.trim() : '';
  const label = typeof input.label === 'string' && input.label.trim()
    ? input.label.trim()
    : role === 'system' && input.severity === 'error'
      ? 'Error'
      : role === 'system'
        ? 'System'
        : role === 'assistant'
          ? 'Assistant'
          : 'You';
  return {
    id: typeof input.id === 'string' && input.id.trim()
      ? input.id.trim()
      : createSessionTimelineEntryId(sessionId, role, meta, text),
    kind: 'message',
    role,
    label,
    meta,
    text,
    severity: input.severity === 'error' ? 'error' : undefined,
    afterHistoryIndex: Number.isFinite(input.afterHistoryIndex) ? Math.max(0, Math.floor(Number(input.afterHistoryIndex))) : undefined,
    afterHistoryId: typeof input.afterHistoryId === 'string' && input.afterHistoryId.trim()
      ? input.afterHistoryId.trim()
      : undefined,
  };
}

function publicSessionTimelineEntry(entry: CodexWebTimelineMessage): CodexWebTimelineMessage {
  const {
    afterHistoryIndex: _afterHistoryIndex,
    afterHistoryId: _afterHistoryId,
    ...publicEntry
  } = entry;
  return publicEntry;
}

function upsertSessionTimelineEntry(
  existing: CodexWebTimelineMessage[],
  entry: CodexWebTimelineMessage,
): CodexWebTimelineMessage[] {
  const next = existing.map((item) => ({ ...item }));
  const index = next.findIndex((current) => current.id === entry.id);
  if (index >= 0) {
    next[index] = { ...entry };
    return next;
  }
  next.push({ ...entry });
  return next;
}

function createSessionTimelineEntryId(
  sessionId: string,
  role: AppendSessionTimelineEntryInput['role'],
  meta: string,
  text: string,
): string {
  const digest = crypto.createHash('sha1')
    .update(`${sessionId}:${role}:${meta}:${text}`)
    .digest('hex')
    .slice(0, 12);
  return `timeline_${role}_${digest}`;
}

function timelineMessagesFromThread(thread: ProviderThreadSummary): CodexWebTimelineMessage[] {
  const items: CodexWebTimelineMessage[] = [];
  for (const turn of thread.turns ?? []) {
    const turnItems = turn.items ?? [];
    const explicitFinalIndexes = new Set<number>();
    let fallbackFinalIndex = -1;
    for (let index = 0; index < turnItems.length; index += 1) {
      const item = turnItems[index]!;
      if (
        isTimelineAssistantMessageItem(item)
        && normalizeTimelineAssistantPhase(item.phase) === 'final_answer'
      ) {
        explicitFinalIndexes.add(index);
      }
    }
    if (explicitFinalIndexes.size === 0 && isSuccessTurnStatus(turn.status)) {
      for (let index = turnItems.length - 1; index >= 0; index -= 1) {
        const item = turnItems[index]!;
        if (
          isTimelineAssistantMessageItem(item)
          && !normalizeTimelineAssistantPhase(item.phase)
        ) {
          fallbackFinalIndex = index;
          break;
        }
      }
    }
    for (let itemIndex = 0; itemIndex < turnItems.length; itemIndex += 1) {
      const item = turnItems[itemIndex]!;
      const role = normalizeTimelineMessageRole(item.role, item.type);
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!role || !text) {
        continue;
      }
      const itemId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null;
      const clientMessageId = timelineClientMessageId(item);
      const isFinal = role === 'assistant'
        && (explicitFinalIndexes.has(itemIndex) || fallbackFinalIndex === itemIndex);
      const phase = role === 'assistant' ? historicalTimelineAssistantPhase(item, isFinal) : null;
      items.push({
        id: `history_${turn.id}_${itemIndex}`,
        kind: 'message',
        role,
        label: role === 'user' ? 'You' : 'Assistant',
        meta: role === 'assistant' ? timelineAssistantMeta(phase, isFinal) : 'history',
        text,
        turnId: turn.id,
        ...(itemId ? {
          itemId,
          projectionKey: `${turn.id}\u0000${itemId}`,
        } : {}),
        ...(clientMessageId ? { clientMessageId } : {}),
        ...(phase ? { phase } : {}),
        lifecycle: 'completed',
      });
    }
    if (isFailureTurnStatus(turn.status)) {
      items.push({
        id: `error_${turn.id || `history_failed_${items.length}`}`,
        kind: 'message',
        role: 'system',
        label: 'Error',
        meta: 'failed',
        text: runtimeTurnErrorMessage(turn) || 'Turn failed',
        turnId: turn.id,
        lifecycle: 'completed',
        severity: 'error',
      });
    }
  }
  if (!items.length) {
    const preview = summarizeCodexWebSessionInputText(thread.preview);
    if (preview) {
      items.push({
        id: `history_preview_${thread.threadId}`,
        kind: 'message',
        role: 'user',
        label: 'You',
        meta: 'preview',
        text: preview,
      });
    }
  }
  return items;
}

function timelineClientMessageId(item: ProviderThreadTurnItem): string | null {
  const clientId = typeof item.raw?.clientId === 'string' ? item.raw.clientId.trim() : '';
  return clientId ? crypto.createHash('sha256').update(clientId).digest('hex').slice(0, 24) : null;
}

function normalizeTimelineMessageRole(role: string | null | undefined, type: string | null | undefined): 'user' | 'assistant' | null {
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (normalizedRole === 'user' || normalizedRole === 'assistant') {
    return normalizedRole;
  }
  const normalizedType = typeof type === 'string' ? type.replace(/[^a-z]/giu, '').toLowerCase() : '';
  if (normalizedType.includes('assistant') || normalizedType.includes('agent') || normalizedType.includes('reasoning')) {
    return 'assistant';
  }
  if (normalizedType.includes('user')) {
    return 'user';
  }
  return null;
}

function normalizeTimelineAssistantPhase(phase: string | null | undefined): string {
  return typeof phase === 'string'
    ? phase.trim().toLowerCase().replace(/[\s-]+/gu, '_')
    : '';
}

function isTimelineAssistantMessageItem(item: ProviderThreadTurnItem): boolean {
  if (normalizeTimelineMessageRole(item.role, item.type) !== 'assistant') {
    return false;
  }
  const normalizedType = String(item.type || '').replace(/[^a-z]/giu, '').toLowerCase();
  return !normalizedType || normalizedType.includes('message');
}

function historicalTimelineAssistantPhase(
  item: ProviderThreadTurnItem,
  isFinal: boolean,
): string {
  const normalizedType = String(item.type || '').replace(/[^a-z]/giu, '').toLowerCase();
  if (normalizedType.includes('reasoning')) {
    return 'reasoning_summary';
  }
  if (isFinal) {
    return 'final_answer';
  }
  return normalizeTimelineAssistantPhase(item.phase) || 'commentary';
}

function timelineAssistantMeta(phase: string | null, isFinal: boolean): string {
  if (isFinal || phase === 'final_answer' || phase === 'final') {
    return 'final';
  }
  if (phase?.includes('reasoning') && phase.includes('summary')) {
    return 'reasoning-summary';
  }
  if (phase === 'commentary' || phase === 'analysis') {
    return 'commentary';
  }
  return phase || 'commentary';
}

function timelineDedupKey(entry: CodexWebTimelineMessage): string {
  return `${entry.id}\u0001${entry.role}\u0001${entry.meta}\u0001${entry.text}`;
}

function runtimeTurnErrorMessage(turn: Pick<ProviderThreadTurn, 'error' | 'items'> & {
  details?: unknown;
  message?: unknown;
}): string {
  return normalizeRuntimeErrorText(turn?.details)
    || normalizeRuntimeErrorText(turn?.error)
    || normalizeRuntimeErrorText(turn?.message)
    || runtimeTurnItemErrorMessage(turn)
    || 'Turn failed';
}

function publicRuntimeTurnFailureMessage(error: unknown): string {
  const message = runtimeTurnErrorMessage({
    error: (error as Error | undefined)?.message ?? null,
    details: (error as Error & { details?: unknown } | undefined)?.details ?? null,
    items: [],
    message: error instanceof Error ? error.message : String(error || ''),
  });
  return isRuntimeRequestTimeoutMessage(message) ? 'Turn failed' : message;
}

function isRuntimeRequestTimeoutMessage(message: string): boolean {
  return /\brequest\s+(?:timed\s*out|timeout)\b|\btimed\s*out\s+waiting\s+for\s+codex\s+turn\b/iu.test(message);
}

function runtimeTurnItemErrorMessage(turn: {
  items?: ProviderThreadTurnItem[];
}): string | null {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    const raw: Record<string, unknown> = isRecord(item.raw) ? item.raw : {};
    const marker = [
      item.type,
      item.phase,
      raw.status,
      raw.severity,
      raw.type,
      raw.status,
    ].map((value) => String(value || '').toLowerCase()).join(' ');
    const hasErrorMarker = /error|fail|denied|unauthorized|forbidden|rate[_\s-]*limit/u.test(marker);
    const candidate = normalizeRuntimeErrorText(raw.details)
      || normalizeRuntimeErrorText(raw.error)
      || normalizeRuntimeErrorText(raw.message)
      || normalizeRuntimeErrorText(item.result)
      || normalizeRuntimeErrorText(raw.details)
      || normalizeRuntimeErrorText(raw.message)
      || normalizeRuntimeErrorText(raw.error);
    if (candidate && (hasErrorMarker || /unexpected status|unauthorized|forbidden|too many requests|rate limit|error|failed|failure|401|403|429/u.test(candidate.toLowerCase()))) {
      return candidate;
    }
    const text = normalizeRuntimeErrorText(item.text);
    if (text && hasErrorMarker) {
      return text;
    }
  }
  return null;
}

function normalizeRuntimeErrorText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (!isRecord(value)) {
    return null;
  }
  return normalizeRuntimeErrorText(value.details)
    || normalizeRuntimeErrorText(value.rawMessage)
    || normalizeRuntimeErrorText(value.errorMessage)
    || normalizeRuntimeErrorText(value.message)
    || normalizeRuntimeErrorText(value.error)
    || normalizeRuntimeErrorText(value.stderr)
    || normalizeRuntimeErrorText(value.stack)
    || null;
}

function isFailureTurnStatus(status: string | null | undefined): boolean {
  return ['failed', 'error', 'timedout', 'timeout'].includes(normalizeTurnStatus(status));
}

function isSuccessTurnStatus(status: string | null | undefined): boolean {
  return ['completed', 'complete', 'succeeded', 'success', 'finished'].includes(normalizeTurnStatus(status));
}

function isInterruptedTurnStatus(status: string | null | undefined): boolean {
  return ['interrupted', 'cancelled', 'canceled', 'aborted'].includes(normalizeTurnStatus(status));
}

function normalizeTurnStatus(status: string | null | undefined): string {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function isActiveTurnStatus(status: string | null | undefined): boolean {
  const normalized = normalizeTurnStatus(status);
  return Boolean(normalized)
    && !isSuccessTurnStatus(normalized)
    && !isFailureTurnStatus(normalized)
    && !isInterruptedTurnStatus(normalized);
}

function isTerminalThreadTurn(thread: ProviderThreadSummary, turnId: string): boolean {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const turn = turns.find((entry) => entry.id === turnId);
  return Boolean(turn && !isActiveTurnStatus(turn.status));
}

function latestActiveThreadTurnId(thread: ProviderThreadSummary | null): string | null {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  let latestTurnId: string | null = null;
  let latestStartedAt = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (turn?.id && isActiveTurnStatus(turn.status)) {
      const startedAt = Number((turn as typeof turn & { startedAt?: number | null }).startedAt);
      const comparableStartedAt = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : index;
      if (comparableStartedAt >= latestStartedAt) {
        latestTurnId = turn.id;
        latestStartedAt = comparableStartedAt;
      }
    }
  }
  return latestTurnId;
}

function threadRuntimeStatusType(thread: ProviderThreadSummary | null): string | null {
  const runtimeStatus = thread?.runtimeStatus ?? null;
  return typeof runtimeStatus?.type === 'string' && runtimeStatus.type.trim()
    ? runtimeStatus.type.trim()
    : null;
}

function sessionActivityState(
  thread: ProviderThreadSummary,
  activeTurnId: string | null,
  hasPendingApproval: boolean,
): CodexWebSessionActivityState {
  const activeFlags = Array.isArray(thread.runtimeStatus?.activeFlags)
    ? thread.runtimeStatus.activeFlags.map((flag) => normalizeTurnStatus(flag))
    : [];
  if (hasPendingApproval || activeFlags.includes('waitingonapproval')) {
    return 'waiting_approval';
  }
  if (activeTurnId || normalizeTurnStatus(threadRuntimeStatusType(thread)) === 'active') {
    return 'running';
  }
  return null;
}

function createTurnConflictError(sessionId: string, activeTurnId: string): CodexWebTurnConflictError {
  const error = new Error(`Session ${sessionId} already has an active turn (${activeTurnId}).`) as CodexWebTurnConflictError;
  error.code = 'turn_conflict';
  error.activeTurnId = activeTurnId;
  return error;
}

function createActiveTurnNotSteerableError(message: string): CodexWebActiveTurnNotSteerableError {
  const error = new Error(message) as CodexWebActiveTurnNotSteerableError;
  error.code = 'active_turn_not_steerable';
  return error;
}

function preserveActiveTurnNotSteerableError(error: unknown): CodexWebActiveTurnNotSteerableError {
  if (!(error instanceof Error)) {
    return createActiveTurnNotSteerableError(String(error));
  }
  const preserved = error as Error & { code?: string };
  preserved.code = 'active_turn_not_steerable';
  return preserved as CodexWebActiveTurnNotSteerableError;
}

function isActiveTurnNotSteerableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = String((error as Error & { code?: unknown }).code ?? '').toLowerCase();
  const message = error.message;
  return code === 'active_turn_not_steerable'
    || code === 'activeturnnotsteerable'
    || /active.?turn.?not.?steerable/iu.test(message)
    || /cannot steer (?:a )?(?:review|compact) turn/iu.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createHelpCommandResult(): CodexWebCommandResult {
  return {
    type: 'command',
    command: {
      name: 'help',
      action: 'show',
      message: [
        '支持的命令：',
        '- `/help` - 显示这份命令列表。',
        '- `/goal` - 显示当前会话的目标。',
        '- `/goal <objective>` - 设置当前会话目标。',
        '- `/goal set <objective>` 或 `/goal edit <objective>` - 替换当前会话目标。',
        '- `/goal pause` - 暂停当前目标。',
        '- `/goal resume` - 恢复当前目标。',
        '- `/goal clear` - 清除当前会话目标。',
      ].join('\n'),
      goal: null,
    },
  };
}

function formatGoalMessage(goal: ProviderThreadGoal | null): string {
  if (!goal) {
    return 'No goal is set.';
  }
  const status = goal.status ? ` (${goal.status})` : '';
  return `Goal${status}: ${goal.objective}`;
}

function summarizeRuntimeTurnResult(result: ProviderTurnResult): Record<string, unknown> {
  const withDetails = result as ProviderTurnResult & { details?: unknown };
  return {
    turnId: result.turnId ?? null,
    threadId: result.threadId ?? null,
    status: result.status ?? null,
    outputState: result.outputState ?? null,
    finalSource: result.finalSource ?? null,
    outputTextLength: String(result.outputText ?? '').length,
    previewTextLength: String(result.previewText ?? '').length,
    errorMessage: result.errorMessage ?? null,
    details: withDetails.details ?? null,
  };
}

function summarizeRuntimeEvent(event: CodexWebEvent): Record<string, unknown> {
  if (event.type === 'turn.completed') {
    return {
      type: event.type,
      turnId: event.turnId,
      threadId: event.threadId,
      status: event.status,
      raw: summarizeRuntimeValue(event.raw),
    };
  }
  if (event.type === 'turn.failed') {
    return {
      type: event.type,
      turnId: event.turnId,
      threadId: event.threadId,
      message: event.message,
      details: event.details ?? null,
      raw: summarizeRuntimeValue(event.raw),
    };
  }
  return {
    type: event.type,
    turnId: 'turnId' in event ? event.turnId : null,
  };
}

function finalAnswerItemIdFromResult(result: Partial<ProviderTurnResult>): string | null {
  const responseItems = Array.isArray(result.responseItems) ? result.responseItems : [];
  const outputText = normalizeComparableAssistantText(result.outputText ?? result.previewText);
  let fallbackId: string | null = null;
  for (let index = responseItems.length - 1; index >= 0; index -= 1) {
    const item = responseItems[index];
    if (!isFinalAssistantResponseItem(item)) {
      continue;
    }
    const itemId = responseItemId(item);
    if (!itemId) {
      continue;
    }
    fallbackId ??= itemId;
    const itemText = normalizeComparableAssistantText(responseItemText(item));
    if (
      itemText
      && outputText
      && (itemText === outputText || outputText.endsWith(itemText))
    ) {
      return itemId;
    }
  }
  return fallbackId;
}

function isFinalAssistantResponseItem(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  const type = String(item.type ?? '').replace(/[^a-z]/giu, '').toLowerCase();
  const role = String(item.role ?? '').replace(/[^a-z]/giu, '').toLowerCase();
  const assistant = type === 'agentmessage'
    || type === 'assistantmessage'
    || (type === 'message' && role === 'assistant');
  if (!assistant) {
    return false;
  }
  const phase = String(item.phase ?? '').replace(/[^a-z]/giu, '').toLowerCase();
  return !phase || ['answer', 'final', 'finalanswer', 'finalresponse', 'response'].includes(phase);
}

function responseItemId(item: Record<string, unknown>): string | null {
  for (const value of [item.itemId, item.item_id, item.id]) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function responseItemText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(responseItemText).join('');
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'delta', 'value', 'message'] as const) {
    if (typeof record[key] === 'string') {
      return record[key];
    }
  }
  return responseItemText(record.content ?? record.parts ?? record.segments);
}

function normalizeComparableAssistantText(value: unknown): string {
  return String(value ?? '').trim().replace(/\r\n/gu, '\n');
}

function summarizeRuntimeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      details: (error as Error & { details?: unknown }).details ?? null,
      stack: error.stack?.split('\n').slice(0, 4).join('\n') ?? null,
    };
  }
  return {
    value: summarizeRuntimeValue(error),
  };
}

function summarizeRuntimeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Error) {
    return summarizeRuntimeError(value);
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function buildCodexTurnInput(
  text: string,
  attachments: ProviderTurnAttachment[] | undefined,
): CodexTurnInput[] | null {
  const normalizedAttachments = Array.isArray(attachments)
    ? attachments
      .map(normalizeTurnAttachment)
      .filter((attachment): attachment is ProviderTurnAttachment => attachment !== null)
    : [];
  if (!normalizedAttachments.length) {
    return null;
  }
  const input: CodexTurnInput[] = [{
    type: 'text',
    text: buildAttachmentPrompt(text, normalizedAttachments),
    text_elements: [],
  }];
  for (const attachment of normalizedAttachments) {
    if (attachment.kind !== 'image') {
      continue;
    }
    input.push({
      type: 'localImage',
      path: attachment.localPath,
    });
  }
  return input;
}

function normalizeTurnAttachment(value: ProviderTurnAttachment | null | undefined): ProviderTurnAttachment | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const localPath = normalizeString(value.localPath);
  if (!localPath) {
    return null;
  }
  return {
    kind: value.kind === 'image' ? 'image' : 'file',
    localPath,
    fileName: normalizeString(value.fileName) || null,
    mimeType: normalizeString(value.mimeType) || null,
    transcriptText: normalizeString(value.transcriptText) || null,
    durationSeconds: typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds)
      ? value.durationSeconds
      : null,
  };
}

function buildAttachmentPrompt(text: string, attachments: readonly ProviderTurnAttachment[]): string {
  const normalizedText = normalizeString(text);
  const lines: string[] = [];
  if (normalizedText) {
    lines.push(normalizedText, '');
  } else {
    lines.push('User sent attachments without additional text.', '');
  }
  lines.push('Attachments:');
  attachments.forEach((attachment, index) => {
    lines.push(`${index + 1}. ${describeAttachment(attachment)}`);
    lines.push(`   path: ${attachment.localPath}`);
    if (attachment.fileName) {
      lines.push(`   filename: ${attachment.fileName}`);
    }
    if (attachment.mimeType) {
      lines.push(`   mime: ${attachment.mimeType}`);
    }
    if (typeof attachment.durationSeconds === 'number' && Number.isFinite(attachment.durationSeconds)) {
      lines.push(`   duration_seconds: ${attachment.durationSeconds}`);
    }
    if (attachment.transcriptText) {
      lines.push(`   transcript_hint: ${attachment.transcriptText}`);
    }
    if (attachment.kind === 'image') {
      lines.push('   attached_as: localImage');
    }
  });
  lines.push('', 'Use the local file paths above when you inspect these attachments.');
  return lines.join('\n');
}

function describeAttachment(attachment: ProviderTurnAttachment): string {
  switch (attachment.kind) {
    case 'image':
      return 'image';
    case 'voice':
      return 'voice message';
    case 'video':
      return 'video';
    case 'file':
    default:
      return 'file';
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function mergeEffectiveModelSettings(
  settings: CodexWebStoredSessionSettings,
  source: unknown,
): CodexWebStoredSessionSettings {
  const value = source && typeof source === 'object' ? source as Record<string, unknown> : {};
  const config = value.config && typeof value.config === 'object'
    ? value.config as Record<string, unknown>
    : value;
  const model = normalizeString(config.model);
  const reasoningEffort = normalizeString(config.reasoningEffort)
    || normalizeString(config.modelReasoningEffort)
    || normalizeString(config.model_reasoning_effort);
  const nextModel = settings.model || model || null;
  const nextReasoningEffort = settings.reasoningEffort || reasoningEffort || null;
  if (nextModel === settings.model && nextReasoningEffort === settings.reasoningEffort) {
    return settings;
  }
  return {
    ...settings,
    model: nextModel,
    reasoningEffort: nextReasoningEffort,
    metadata: {
      ...(settings.metadata ?? {}),
      codexWebModelDefaultsVersion: CODEX_WEB_MODEL_DEFAULTS_VERSION,
    },
    updatedAt: Date.now(),
  };
}

function migrateLegacyModelDefaults(
  settings: CodexWebStoredSessionSettings | null | undefined,
): CodexWebStoredSessionSettings | null {
  if (!settings) {
    return null;
  }
  const metadata = settings.metadata ?? {};
  if (Number(metadata.codexWebModelDefaultsVersion) >= CODEX_WEB_MODEL_DEFAULTS_VERSION) {
    return settings;
  }
  if (settings.model !== LEGACY_DEFAULT_MODEL || settings.reasoningEffort !== LEGACY_DEFAULT_REASONING_EFFORT) {
    return settings;
  }
  return {
    ...settings,
    model: null,
    reasoningEffort: null,
    metadata: {
      ...metadata,
      codexWebModelDefaultsVersion: CODEX_WEB_MODEL_DEFAULTS_VERSION,
    },
    updatedAt: Date.now(),
  };
}

function createDefaultSettings(sessionId: string): CodexWebStoredSessionSettings {
  return {
    bridgeSessionId: sessionId,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    collaborationMode: 'default',
    personality: 'pragmatic',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    locale: null,
    metadata: { codexWebModelDefaultsVersion: CODEX_WEB_MODEL_DEFAULTS_VERSION },
    updatedAt: Date.now(),
    favorite: false,
    favoriteOrder: null,
  };
}

function resolveResumePermissions(settings: CodexWebStoredSessionSettings): {
  approvalPolicy: string;
  sandboxMode: string;
} {
  const presetDefaults = settings.accessPreset === 'read-only'
    ? { approvalPolicy: 'never', sandboxMode: 'read-only' }
    : settings.accessPreset === 'default'
      ? { approvalPolicy: 'on-request', sandboxMode: 'workspace-write' }
      : { approvalPolicy: 'never', sandboxMode: 'danger-full-access' };
  return {
    approvalPolicy: settings.approvalPolicy || presetDefaults.approvalPolicy,
    sandboxMode: settings.sandboxMode || presetDefaults.sandboxMode,
  };
}

function mapApprovalDecision(decision: 'accept' | 'accept_for_session' | 'deny'): 1 | 2 | 3 {
  switch (decision) {
    case 'accept':
      return 1;
    case 'accept_for_session':
      return 2;
    case 'deny':
      return 3;
  }
}

function mapResolvedDecision(
  decision: 'accept' | 'accept_for_session' | 'deny',
): 'accepted' | 'accepted_for_session' | 'denied' {
  switch (decision) {
    case 'accept':
      return 'accepted';
    case 'accept_for_session':
      return 'accepted_for_session';
    case 'deny':
      return 'denied';
  }
}

function isIncludeTurnsRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /includeTurns is unavailable before first user message/i.test(message)
    || /ephemeral threads do not support includeTurns/i.test(message)
    || /not materialized yet/i.test(message)
    || /empty session file/i.test(message)
    || /rollout .* is empty/i.test(message);
}

export function isMissingThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /thread not found/i.test(message)
    || /thread not loaded/i.test(message)
    || /session not found/i.test(message)
    || /unknown thread/i.test(message);
}

function isUnavailableThreadError(error: unknown): boolean {
  return isMissingThreadError(error) || isMissingRolloutError(error);
}

function isMissingRolloutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no rollout found for thread id/i.test(message)
    || /rollout .* is empty/i.test(message);
}

function readArchivedThreadFromFile(filePath: string, threadId: string): ProviderThreadSummary | null {
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(filePath, 'utf8').split('\n');
  } catch {
    return null;
  }
  const turns: ProviderThreadTurn[] = [];
  let cwd: string | null = null;
  let title: string | null = null;
  let updatedAt: number | null = null;
  let preview: string | null = null;
  let matchedThread = false;
  let currentTurn: ProviderThreadTurn | null = null;
  let currentTurnId: string | null = null;

  for (const line of lines) {
    const entry = parseArchivedSessionLine(line);
    if (!entry) {
      continue;
    }
    const payload = isArchivedRecord(entry.payload) ? entry.payload : null;
    if (entry.type === 'session_meta' && payload) {
      const payloadId = normalizeString(payload.id);
      if (payloadId && payloadId !== threadId) {
        return null;
      }
      matchedThread = payloadId === threadId || matchedThread;
      cwd = normalizeString(payload.cwd) || cwd;
      title = normalizeString(payload.title) || title;
      updatedAt = parseArchivedTimestamp(payload.timestamp) ?? updatedAt;
      continue;
    }
    if (entry.type === 'turn_context' && payload) {
      const turnId = normalizeString(payload.turn_id);
      if (!turnId) {
        continue;
      }
      currentTurnId = turnId;
      currentTurn = {
        id: turnId,
        status: null,
        error: null,
        items: [],
      };
      turns.push(currentTurn);
      continue;
    }
    if (entry.type === 'event_msg' && payload) {
      if (payload.type === 'task_started') {
        const turnId = normalizeString(payload.turn_id);
        if (turnId && turnId !== currentTurnId) {
          currentTurnId = turnId;
          currentTurn = {
            id: turnId,
            status: 'running',
            error: null,
            items: [],
          };
          turns.push(currentTurn);
        }
        continue;
      }
      if (payload.type === 'task_complete') {
        if (currentTurn) {
          currentTurn.status = 'completed';
        }
        updatedAt = parseArchivedTimestamp(entry.timestamp) ?? updatedAt;
        continue;
      }
      continue;
    }
    if (entry.type !== 'response_item' || !payload) {
      continue;
    }
    if (payload.type !== 'message') {
      continue;
    }
    const role = normalizeArchivedMessageRole(payload.role);
    const text = extractArchivedMessageText(payload.content);
    if (!role || !text) {
      continue;
    }
    if (!currentTurn) {
      currentTurn = {
        id: `archived_${turns.length + 1}`,
        status: 'completed',
        error: null,
        items: [],
      };
      currentTurnId = currentTurn.id;
      turns.push(currentTurn);
    }
    currentTurn.items.push({
      type: 'message',
      role,
      phase: null,
      text,
    });
    preview ||= text;
    updatedAt = parseArchivedTimestamp(entry.timestamp) ?? updatedAt;
  }

  if (!matchedThread && !path.basename(filePath).includes(threadId)) {
    return null;
  }
  if (!turns.length && !preview) {
    return null;
  }
  for (const turn of turns) {
    turn.status ||= 'completed';
  }
  return {
    threadId,
    cwd,
    title,
    updatedAt,
    preview,
    turns,
    path: filePath,
  };
}

function parseArchivedSessionLine(line: string): { type?: unknown; payload?: unknown; timestamp?: unknown } | null {
  const text = line.trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as { type?: unknown; payload?: unknown; timestamp?: unknown };
  } catch {
    return null;
  }
}

function normalizeArchivedMessageRole(role: unknown): 'user' | 'assistant' | null {
  const normalized = normalizeString(role).toLowerCase();
  if (normalized === 'user' || normalized === 'assistant') {
    return normalized;
  }
  return null;
}

function extractArchivedMessageText(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }
  const parts = content
    .map((item) => {
      if (!isArchivedRecord(item)) {
        return '';
      }
      const type = normalizeString(item.type).toLowerCase();
      if (type !== 'input_text' && type !== 'output_text' && type !== 'text') {
        return '';
      }
      return normalizeString(item.text);
    })
    .filter(Boolean);
  if (!parts.length) {
    return null;
  }
  return parts.join('\n\n');
}

function parseArchivedTimestamp(value: unknown): number | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function isArchivedRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
