import { randomUUID } from 'node:crypto';
import {
  toProviderResponseItems,
} from './app_server/response_items.js';
import {
  normalizeEventItemType,
  extractTextCandidate,
  buildArtifactFromFilePath,
  inferMimeTypeFromPath,
  normalizeLegacyImageMedia,
  extractWorkEventsFromResponseItems,
  isAssistantVisibleItem,
  isUserVisibleItem,
  extractToolCallCorrelationId,
  normalizeNullableString,
  extractItemId,
  buildWorkSummary,
  extractStructuredString,
  extractFileChangesValue,
  classifyWorkEventKind,
  buildWorkTitle,
  buildWorkEventEmissionKey,
} from './app_server/projection.js';
import {
  type SessionTurnCompletionState,
  inspectTurnCompletionFromSessionPath,
  findOpenTurnRuntimeErrorFromSessionPath,
  buildSessionTaskCompleteResult,
  shouldWaitForSessionTaskMaterialization,
  cloneSessionResponseItem,
  attachSessionResponseItems,
  emitWorkEventsFromSessionPath,
} from './app_server/compat/rollout.js';
import {
  needsLegacyRolloutRecovery,
} from './app_server/compat/policy.js';
import {
  TurnObserver,
} from './app_server/turn_observer.js';
import type {
  JsonValue,
} from './app_server/generated/stable/serde_json/JsonValue.js';
import type {
  SandboxPolicy,
} from './app_server/generated/stable/v2/SandboxPolicy.js';
import {
  callAppServer,
  wireEnum,
  type AppServerMethod,
  type AppServerParams,
  type AppServerResponse,
} from './app_server/client.js';
import {
  initializeParams,
  validateInitialize,
  EXPERIMENTAL_DEPENDENCIES,
} from './app_server/capabilities.js';
import {
  startServer,
  connectWebSocket,
  terminateChildProcess,
  sleep,
} from './app_server/lifecycle.js';
import {
  parseMessage,
  acceptResponse,
  rejectPending as rejectTransportPending,
  AppServerResponseUncertainError,
  AppServerObservationInterruptedError,
} from './app_server/transport.js';
import {
  EventEmitter,
} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  spawn,
  type ChildProcess,
} from 'node:child_process';
import {
  writeSequencedStderrLine,
} from './sequenced_stderr.js';
import {
  readCodexAccountIdentity,
} from './auth_state.js';
import type {
  ProviderAppInfo,
  ProviderApprovalRequest,
  ProviderMcpServerStatus,
  ProviderMcpOauthLoginResult,
  ProviderPluginDetail,
  ProviderPluginInstallResult,
  ProviderPluginLoadError,
  ProviderPluginMarketplace,
  ProviderPluginsListResult,
  ProviderPluginSummary,
  ProviderConfigDefaults,
  ProviderSkillError,
  ProviderSkillInfo,
  ProviderPluginAppSummary,
  ProviderPluginSkillSummary,
  ProviderSkillsListResult,
  ProviderSkillToolDependency,
  ProviderUsageReport,
  ProviderThreadListResult,
  ProviderThreadGoal,
  ProviderThreadStartResult,
  ProviderThreadSummary,
  ProviderTurnProgress,
  ProviderTurnResult,
  ProviderTurnWorkEvent,
} from './provider.js';

const INITIAL_TURN_MATERIALIZATION_SETTLE_MS = 2_000;
const INITIAL_TURN_MATERIALIZATION_POLL_MS = 250;
const MAX_WORK_STREAM_BYTES = 256 * 1024;
const MAX_WORK_DELTA_BYTES = 64 * 1024;
const MAX_EARLY_TURN_EVENTS = 256;
const MAX_EARLY_TURN_EVENT_BYTES = 1024 * 1024;

interface CodexAppLogger {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

interface CodexClientInfo {
  name: string;
  title: string;
  version: string;
}

interface CodexModelInfo {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
}

interface CodexAppRateLimitsResponse {
  rateLimits?: CodexAppRateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, CodexAppRateLimitSnapshot> | null;
}

interface CodexAppRateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  planType?: string | null;
  primary?: CodexAppRateLimitWindow | null;
  secondary?: CodexAppRateLimitWindow | null;
  credits?: CodexAppCreditsSnapshot | null;
}

interface CodexAppRateLimitWindow {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

interface CodexAppCreditsSnapshot {
  balance?: string | null;
  hasCredits?: boolean | null;
  unlimited?: boolean | null;
}

interface CodexAppSkillToolDependency {
  type?: string | null;
  value?: string | null;
  command?: string | null;
  description?: string | null;
  transport?: string | null;
  url?: string | null;
}

interface CodexAppSkillInterface {
  displayName?: string | null;
  defaultPrompt?: string | null;
  shortDescription?: string | null;
  brandColor?: string | null;
}

interface CodexAppSkillMetadata {
  name?: string | null;
  description?: string | null;
  enabled?: boolean | null;
  path?: string | null;
  scope?: string | null;
  shortDescription?: string | null;
  interface?: CodexAppSkillInterface | null;
  dependencies?: {
    tools?: CodexAppSkillToolDependency[] | null;
  } | null;
}

interface CodexAppSkillErrorInfo {
  path?: string | null;
  message?: string | null;
}

interface CodexAppSkillsListEntry {
  cwd?: string | null;
  errors?: CodexAppSkillErrorInfo[] | null;
  skills?: CodexAppSkillMetadata[] | null;
}

interface CodexAppPluginInterface {
  brandColor?: string | null;
  capabilities?: string[] | null;
  category?: string | null;
  defaultPrompt?: string[] | null;
  developerName?: string | null;
  displayName?: string | null;
  longDescription?: string | null;
  shortDescription?: string | null;
  websiteUrl?: string | null;
}

interface CodexAppPluginSourceLocal {
  type?: 'local' | string | null;
  path?: string | null;
}

interface CodexAppPluginSourceMarketplace {
  type?: 'marketplace' | string | null;
  marketplaceName?: string | null;
}

type CodexAppPluginSource = CodexAppPluginSourceLocal | CodexAppPluginSourceMarketplace | null;

interface CodexAppPluginSummary {
  id?: string | null;
  name?: string | null;
  installed?: boolean | null;
  enabled?: boolean | null;
  installPolicy?: string | null;
  authPolicy?: string | null;
  interface?: CodexAppPluginInterface | null;
  source?: CodexAppPluginSource;
}

interface CodexAppPluginMarketplace {
  name?: string | null;
  path?: string | null;
  interface?: {
    displayName?: string | null;
  } | null;
  plugins?: CodexAppPluginSummary[] | null;
}

interface CodexAppMarketplaceLoadError {
  marketplacePath?: string | null;
  message?: string | null;
}

interface CodexAppPluginListResponse {
  featuredPluginIds?: string[] | null;
  marketplaceLoadErrors?: CodexAppMarketplaceLoadError[] | null;
  marketplaces?: CodexAppPluginMarketplace[] | null;
}

interface CodexAppPluginAppSummary {
  id?: string | null;
  name?: string | null;
  needsAuth?: boolean | null;
  description?: string | null;
  installUrl?: string | null;
}

interface CodexAppPluginSkillInterface {
  displayName?: string | null;
}

interface CodexAppPluginSkillSummary {
  name?: string | null;
  path?: string | null;
  description?: string | null;
  enabled?: boolean | null;
  shortDescription?: string | null;
  interface?: CodexAppPluginSkillInterface | null;
}

interface CodexAppPluginDetail {
  summary?: CodexAppPluginSummary | null;
  marketplaceName?: string | null;
  marketplacePath?: string | null;
  description?: string | null;
  apps?: CodexAppPluginAppSummary[] | null;
  mcpServers?: string[] | null;
  skills?: CodexAppPluginSkillSummary[] | null;
}

interface CodexAppPluginInstallResponse {
  authPolicy?: string | null;
  appsNeedingAuth?: CodexAppPluginAppSummary[] | null;
}

interface CodexAppInfo {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  installUrl?: string | null;
  isAccessible?: boolean | null;
  isEnabled?: boolean | null;
  pluginDisplayNames?: string[] | null;
  appMetadata?: {
    categories?: string[] | null;
    developer?: string | null;
  } | null;
  branding?: {
    developer?: string | null;
  } | null;
}

interface CodexAppMcpServerStatus {
  name?: string | null;
  isEnabled?: boolean | null;
  authStatus?: string | null;
  resourceTemplates?: unknown[] | null;
  resources?: unknown[] | null;
  tools?: Record<string, unknown> | null;
}

interface CodexAppMcpOauthLoginResponse {
  authorizationUrl?: string | null;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

interface PendingApproval {
  rpcId: string;
  rpcResponseId: string | number;
  transportKind: 'v2_command' | 'v2_file_change' | 'v2_permissions' | 'legacy_exec' | 'legacy_apply_patch';
  request: ProviderApprovalRequest;
}

interface ApprovedExecution {
  requestId: string;
  kind: ProviderApprovalRequest['kind'];
  threadId: string;
  turnId: string | null;
  itemId: string | null;
  command: string | null;
  approvedAt: number;
  lastSignalAt: number;
  lastSignalKind: string;
  signalCount: number;
  completedAt: number | null;
  lastObservedTurnSnapshotKey: string | null;
}

interface ProgressState {
  commentaryText: string;
  reasoningSummaryText: string;
  finalAnswerText: string;
  sawAssistantActivity: boolean;
  lastAssistantActivityAt: number;
  items: Map<string, ProgressItemState>;
}

interface ProgressItemState {
  text: string;
  outputKind: string;
  reasoningSummaryParts: Map<number, string> | null;
}

type BufferedTurnEvent =
  | { type: 'notification'; value: any }
  | { type: 'approval_request'; value: ProviderApprovalRequest };

interface EarlyTurnEventCapture {
  threadId: string;
  turnId: string | null;
  events: BufferedTurnEvent[];
  eventBytes: number;
  onNotification: (notification: any) => void;
  onApprovalRequest: (request: ProviderApprovalRequest) => void;
  stopped: boolean;
}

const earlyTurnEventCapturesByClient = new WeakMap<object, Set<EarlyTurnEventCapture>>();

interface CodexStderrEntry {
  sequence: number;
  text: string;
}

interface CodexAppClientOptions {
  codexCliBin: string;
  codexCliArgs?: string[];
  launchCommand?: string | null;
  autolaunch?: boolean;
  modelCatalog?: CodexModelInfo[];
  modelCatalogMode?: 'merge' | 'overlay-only';
  enabledFeatures?: string[];
  clientInfo?: CodexClientInfo;
  spawnImpl?: typeof spawn;
  webSocketFactory?: (url: string) => WebSocket;
  platform?: NodeJS.Platform;
  logger?: CodexAppLogger;
  turnPollSleep?: (ms: number) => Promise<void>;
  turnPollNow?: () => number;
}

export interface CodexTextTurnInput {
  type: 'text';
  text: string;
  text_elements: [];
}

export interface CodexLocalImageTurnInput {
  type: 'localImage';
  path: string;
}

export type CodexTurnInput = CodexTextTurnInput | CodexLocalImageTurnInput;

export interface CodexTurnSteerParams {
  threadId: string;
  expectedTurnId: string;
  input: CodexTurnInput[];
  clientUserMessageId?: string | null;
}

export interface CodexTurnSteerResult {
  turnId: string;
}

export type CodexThreadUnsubscribeStatus = 'notLoaded' | 'notSubscribed' | 'unsubscribed';

export class CodexAppClient extends EventEmitter {
  codexCliBin: string;

  codexCliArgs: string[];

  launchCommand: string | null;

  autolaunch: boolean;

  modelCatalog: CodexModelInfo[];

  modelCatalogMode: 'merge' | 'overlay-only';

  enabledFeatures: string[];

  clientInfo: CodexClientInfo;

  spawnImpl: typeof spawn;

  webSocketFactory: (url: string) => WebSocket;

  platform: NodeJS.Platform;

  logger: CodexAppLogger;

  turnPollSleep: (ms: number) => Promise<void>;

  turnPollNow: () => number;

  child: ChildProcess | null;

  socket: WebSocket | null;

  pending: Map<string, PendingRequest>;

  pendingApprovals: Map<string, PendingApproval>;

  approvedExecutions: Map<string, ApprovedExecution>;

  requestId: number;

  port: number | null;

  connected: boolean;

  startPromise: Promise<void> | null;

  childStartError: Error | null;

  childStderrTail: CodexStderrEntry[];

  childStderrSequence: number;

  threadConfigDefaults: Map<string, ProviderConfigDefaults>;

  readonly connectionIdentity = randomUUID();

  connectionEpoch = 0;

  lifecycleGeneration = 0;

  launchedBinaryPath: string | null = null;

  initializedServer: { userAgent: string; binary: string; initializedAt: number; version?: string | null } | null = null;

  diagnostics() {
    return { connected: this.connected, pendingRequests: this.pending.size, pendingApprovals: this.pendingApprovals.size,
      server: this.initializedServer, legacyRolloutRecovery: needsLegacyRolloutRecovery(this.initializedServer?.userAgent ?? null), experimentalDependencies: EXPERIMENTAL_DEPENDENCIES };
  }

  constructor({
    codexCliBin,
    codexCliArgs = [],
    launchCommand = null,
    autolaunch = false,
    modelCatalog = [],
    modelCatalogMode = 'merge',
    enabledFeatures = [],
    clientInfo = {
      name: 'codex-native-api',
      title: 'Codex Native API',
      version: '0.1.0',
    },
    spawnImpl = spawn,
    webSocketFactory = (url) => new WebSocket(url),
    platform = process.platform,
    logger = createNoopLogger(),
    turnPollSleep = sleep,
    turnPollNow = () => Date.now(),
  }: CodexAppClientOptions) {
    super();
    this.codexCliBin = codexCliBin;
    this.codexCliArgs = normalizeStringList(codexCliArgs);
    this.launchCommand = launchCommand;
    this.autolaunch = autolaunch;
    this.modelCatalog = modelCatalog;
    this.modelCatalogMode = modelCatalogMode;
    this.enabledFeatures = normalizeFeatureList(enabledFeatures);
    this.clientInfo = clientInfo;
    this.spawnImpl = spawnImpl;
    this.webSocketFactory = webSocketFactory;
    this.platform = platform;
    this.logger = logger;
    this.turnPollSleep = turnPollSleep;
    this.turnPollNow = turnPollNow;

    this.child = null;
    this.socket = null;
    this.pending = new Map();
    this.pendingApprovals = new Map();
    this.approvedExecutions = new Map();
    this.requestId = 0;
    this.port = null;
    this.connected = false;
    this.startPromise = null;
    this.childStartError = null;
    this.childStderrTail = [];
    this.childStderrSequence = 0;
    this.threadConfigDefaults = new Map();
    earlyTurnEventCapturesByClient.set(this, new Set());
  }

  logDebug(event: string, payload: unknown = null): void {
    try {
      this.logger.debug?.(`[codex-app] ${event} ${JSON.stringify(payload)}`);
    } catch {
      this.logger.debug?.(`[codex-app] ${event}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
      return;
    }
    if (this.connected) return;
    const task = this.startServer().finally(() => {
      if (this.startPromise === task) {
        this.startPromise = null;
      }
    });
    this.startPromise = task;
    await task;
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1;
    stopAllEarlyTurnEventCaptures(this);
    this.connected = false;
    this.socket?.close();
    this.socket = null;
    this.childStartError = null;
    this.childStderrTail = [];
    this.childStderrSequence = 0;
    const child = this.child;
    if (child && child.exitCode === null) {
      await terminateChildProcess(child, this.platform).catch(() => {});
    }
    this.child = null;
    this.pendingApprovals.clear();
    this.approvedExecutions.clear();
    this.threadConfigDefaults.clear();
    this.rejectPending(new AppServerObservationInterruptedError('Codex app client stopped'));
    this.emit('observation_interrupted', new AppServerObservationInterruptedError('Codex app client stopped'));
  }

  async listThreads({
    limit = 20,
    cursor = null,
    searchTerm = null,
    archived = false,
  }: {
    limit?: number;
    cursor?: string | null;
    searchTerm?: string | null;
    archived?: boolean | null;
  } = {}): Promise<ProviderThreadListResult> {
    const result: any = await this.request('thread/list', {
      limit,
      cursor,
      sortKey: 'updated_at',
      searchTerm,
      archived: Boolean(archived),
    }, { timeoutMs: 30_000 });
    const rows = Array.isArray(result?.data) ? result.data : [];
    return {
      items: rows.map(mapThreadSummary),
      nextCursor: typeof result?.nextCursor === 'string' ? result.nextCursor : null,
    };
  }

  async readThread(threadId: string, includeTurns = false): Promise<ProviderThreadSummary | null> {
    try {
      const result: any = await this.request('thread/read', { threadId, includeTurns }, { timeoutMs: 10_000 });
      return result?.thread ? mapThread(result.thread, includeTurns) : null;
    } catch (error) {
      if (!includeTurns || !isListTurnsUnsupportedError(error)) {
        throw error;
      }
      const result: any = await this.request('thread/read', { threadId, includeTurns: false }, { timeoutMs: 10_000 });
      return result?.thread ? mapThread(result.thread, false) : null;
    }
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.request('thread/name/set', { threadId, name }, { timeoutMs: 10_000 });
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.request('thread/archive', { threadId }, { timeoutMs: 30_000 });
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.request('thread/unarchive', { threadId }, { timeoutMs: 30_000 });
  }

  async startThread({
    cwd = null,
    title = null,
    model = null,
    serviceTier = null,
    sandboxMode = 'workspace-write',
    approvalPolicy = 'on-request',
    ephemeral = null,
    runtimeEnv = {},
  }: {
    cwd?: string | null;
    title?: string | null;
    model?: string | null;
    serviceTier?: string | null;
    sandboxMode?: string;
    approvalPolicy?: string;
    ephemeral?: boolean | null;
    runtimeEnv?: Record<string, string | null>;
  } = {}): Promise<ProviderThreadStartResult> {
    const result: any = await this.request('thread/start', {
      cwd,
      approvalPolicy: wireEnum(approvalPolicy, ['untrusted', 'on-request', 'never'] as const, 'approval policy'),
      model,
      modelProvider: null,
      serviceTier,
      sandbox: sandboxMode === null ? null : wireEnum(sandboxMode, ['read-only', 'workspace-write', 'danger-full-access'] as const, 'sandbox mode'),
      config: buildRuntimeEnvironmentConfig(runtimeEnv),
      serviceName: null,
      baseInstructions: null,
      developerInstructions: null,
      personality: null,
      ephemeral,
      experimentalRawEvents: true,
      persistExtendedHistory: false,
    }, { timeoutMs: 30_000 });
    const threadId = String(result.thread.id);
    if (title?.trim()) {
      await this.setThreadName(threadId, title.trim());
      result.thread.name = title.trim();
    }
    const effectiveSettings = normalizeConfigDefaults(result);
    this.threadConfigDefaults.set(threadId, effectiveSettings);
    return {
      threadId,
      cwd: result.cwd ? String(result.cwd) : null,
      title: result.thread?.name ? String(result.thread.name) : null,
      model: effectiveSettings.model,
      reasoningEffort: effectiveSettings.reasoningEffort,
    };
  }

  async resumeThread({
    threadId,
    approvalPolicy = null,
    sandboxMode = null,
    runtimeEnv = {},
    developerInstructions = null,
  }: {
    threadId: string;
    approvalPolicy?: string | null;
    sandboxMode?: string | null;
    runtimeEnv?: Record<string, string | null>;
    developerInstructions?: string | null;
  }): Promise<ProviderConfigDefaults> {
    const result: any = await this.request('thread/resume', {
      threadId,
      cwd: null,
      approvalPolicy: approvalPolicy === null ? null : wireEnum(approvalPolicy, ['untrusted', 'on-request', 'never'] as const, 'approval policy'),
      baseInstructions: null,
      developerInstructions,
      config: buildRuntimeEnvironmentConfig(runtimeEnv),
      sandbox: sandboxMode === null ? null : wireEnum(sandboxMode, ['read-only', 'workspace-write', 'danger-full-access'] as const, 'sandbox mode'),
      model: null,
      modelProvider: null,
      personality: null,
      experimentalRawEvents: true,
      persistExtendedHistory: false,
    }, { timeoutMs: 30_000 });
    const effectiveSettings = normalizeConfigDefaults(result);
    this.threadConfigDefaults.set(threadId, effectiveSettings);
    return effectiveSettings;
  }

  async unsubscribeThread(threadId: string): Promise<CodexThreadUnsubscribeStatus> {
    const result: any = await this.request('thread/unsubscribe', {
      threadId,
    }, { timeoutMs: 10_000 });
    const status = String(result?.status ?? '');
    if (status === 'notLoaded' || status === 'notSubscribed' || status === 'unsubscribed') {
      return status;
    }
    throw new Error(`Codex thread/unsubscribe returned an unknown status: ${status || 'missing'}`);
  }

  async getThreadGoal(threadId: string): Promise<ProviderThreadGoal | null> {
    const result: any = await this.request('thread/goal/get', {
      threadId,
    }, { timeoutMs: 10_000 });
    return mapThreadGoal(result?.goal ?? null);
  }

  async setThreadGoal({
    threadId,
    objective = null,
    status = null,
    suppressAutoTurn = false,
  }: {
    threadId: string;
    objective?: string | null;
    status?: string | null;
    suppressAutoTurn?: boolean;
  }): Promise<ProviderThreadGoal | null> {
    const autoStartedTurnPromise = suppressAutoTurn
      ? this.captureNextTurnStartedForThread(threadId, 750)
      : Promise.resolve(null);
    const result: any = await this.request('thread/goal/set', {
      threadId,
      objective,
      status: status === null ? null : wireEnum(status, ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'] as const, 'goal status'),
    }, { timeoutMs: 15_000 });
    const autoStartedTurnId = await autoStartedTurnPromise;
    if (suppressAutoTurn && autoStartedTurnId) {
      try {
        await this.interruptTurn({ threadId, turnId: autoStartedTurnId });
      } catch (error) {
        this.logDebug('thread_goal_auto_turn_interrupt_failed', {
          threadId,
          turnId: autoStartedTurnId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return mapThreadGoal(result?.goal ?? null);
  }

  async startThreadGoal({
    threadId,
    objective = null,
    status = 'active',
    onGoalUpdated = null,
    onProgress = null,
    onWorkEvent = null,
    onTurnStarted = null,
    onApprovalRequest = null,
    timeoutMs = 15 * 60 * 1000,
  }: {
    threadId: string;
    objective?: string | null;
    status?: string | null;
    onGoalUpdated?: ((goal: ProviderThreadGoal | null) => Promise<void> | void) | null;
    onProgress?: ((progress: ProviderTurnProgress) => Promise<void> | void) | null;
    onWorkEvent?: ((event: ProviderTurnWorkEvent) => Promise<void> | void) | null;
    onTurnStarted?: ((meta: Record<string, unknown>) => Promise<void> | void) | null;
    onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void> | void) | null;
    timeoutMs?: number;
  }): Promise<{ goal: ProviderThreadGoal | null; turn: ProviderTurnResult }> {
    const stderrBaseline = this.childStderrSequence;
    const earlyEventCapture = beginEarlyTurnEventCapture(this, threadId);
    const autoStartedTurnPromise = this.captureNextTurnStartedForThread(threadId, 5_000);
    try {
      const result: any = await this.request('thread/goal/set', {
        threadId,
        objective,
        status: status === null ? null : wireEnum(status, ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'] as const, 'goal status'),
      }, { timeoutMs: 15_000 });
      const goal = mapThreadGoal(result?.goal ?? null);
      const turnId = await autoStartedTurnPromise;
      if (!turnId) {
        throw new Error('Codex thread/goal/set did not start a turn');
      }
      earlyEventCapture.turnId = turnId;
      try {
        if (typeof onGoalUpdated === 'function') {
          await onGoalUpdated(goal);
        }
        if (typeof onTurnStarted === 'function') {
          await onTurnStarted({ turnId, threadId });
        }
      } catch (error) {
        try {
          await this.interruptTurn({ threadId, turnId });
        } catch (interruptError) {
          this.logDebug('thread_goal_untracked_turn_interrupt_failed', {
            threadId,
            turnId,
            error: interruptError instanceof Error ? interruptError.message : String(interruptError),
          });
        }
        throw error;
      }
      const turn = await this.waitForTurnResult({
        threadId,
        turnId,
        turnStartStatus: 'inProgress',
        onProgress,
        onWorkEvent,
        onApprovalRequest,
        timeoutMs,
        stderrBaseline,
      });
      return { goal, turn };
    } finally {
      stopEarlyTurnEventCapture(this, earlyEventCapture);
    }
  }

  async clearThreadGoal(threadId: string): Promise<boolean> {
    const result: any = await this.request('thread/goal/clear', {
      threadId,
    }, { timeoutMs: 15_000 });
    return result?.cleared === true;
  }

  async startTurn({
    threadId,
    inputText,
    input = null,
    cwd = null,
    model = null,
    effort = null,
    serviceTier = null,
    personality = null,
    sandboxMode = 'workspace-write',
    approvalPolicy = 'on-request',
    collaborationMode = 'default',
    developerInstructions = '',
    onProgress = null,
    onWorkEvent = null,
    onTurnStarted = null,
    onApprovalRequest = null,
    timeoutMs = 15 * 60 * 1000,
  }: {
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
    onProgress?: ((progress: ProviderTurnProgress) => Promise<void> | void) | null;
    onWorkEvent?: ((event: ProviderTurnWorkEvent) => Promise<void> | void) | null;
    onTurnStarted?: ((meta: Record<string, unknown>) => Promise<void> | void) | null;
    onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void> | void) | null;
    timeoutMs?: number;
  }): Promise<ProviderTurnResult> {
    const requestedModel = normalizeNullableString(model);
    const requestedEffort = normalizeNullableString(effort);
    let rememberedSettings = this.threadConfigDefaults.get(threadId) ?? null;
    if (!requestedModel && !rememberedSettings?.model) {
      rememberedSettings = await this.readConfigDefaults({ cwd });
      this.threadConfigDefaults.set(threadId, rememberedSettings);
    }
    const effectiveModel = requestedModel ?? rememberedSettings?.model ?? null;
    const effectiveEffort = requestedEffort
      ?? (requestedModel && requestedModel !== rememberedSettings?.model
        ? null
        : rememberedSettings?.reasoningEffort ?? null);
    if (!effectiveModel) {
      throw new Error('Codex did not return an effective model for turn/start');
    }
    this.logDebug('turn_start_requested', {
      threadId,
      cwd,
      model: effectiveModel,
      effort: effectiveEffort,
      serviceTier,
      personality,
      approvalPolicy,
      sandboxMode,
      collaborationMode,
      timeoutMs,
      inputCount: Array.isArray(input) ? input.length : 1,
      inputSummary: summarizeTurnInput(
        Array.isArray(input) && input.length > 0
          ? input
        : [{
          type: 'text',
          text: inputText,
          text_elements: [],
        }],
      ),
    });
    const stderrBaseline = this.childStderrSequence;
    const earlyEventCapture = beginEarlyTurnEventCapture(this, threadId);
    try {
      const result: any = await this.request('turn/start', {
        threadId,
        input: Array.isArray(input) && input.length > 0
          ? input
          : [{
            type: 'text',
            text: inputText,
            text_elements: [],
          }],
        cwd,
        approvalPolicy: wireEnum(approvalPolicy, ['untrusted', 'on-request', 'never'] as const, 'approval policy'),
        sandboxPolicy: mapSandboxPolicy(sandboxMode),
        model: effectiveModel,
        serviceTier,
        effort: effectiveEffort,
        summary: null,
        personality: personality === null ? null : wireEnum(personality, ['none', 'friendly', 'pragmatic'] as const, 'personality'),
        outputSchema: null,
        collaborationMode: serializeCollaborationMode({
          collaborationMode,
          model: effectiveModel,
          effort: effectiveEffort,
          developerInstructions,
        }),
      }, { timeoutMs: 30_000 });
      const turn = result?.turn;
      if (!turn?.id) {
        throw new Error('Codex turn/start returned no turn id');
      }
      const acknowledgedTurnId = String(turn.id);
      this.logDebug('turn_start_acknowledged', {
        threadId,
        turnId: acknowledgedTurnId,
        status: String(turn.status ?? ''),
      });
      if (typeof onTurnStarted === 'function') {
        await onTurnStarted({
          turnId: acknowledgedTurnId,
          threadId,
        });
      }
      earlyEventCapture.turnId = acknowledgedTurnId;
      return await this.waitForTurnResult({
        threadId,
        turnId: acknowledgedTurnId,
        turnStartStatus: normalizeNullableString(turn.status),
        onProgress,
        onWorkEvent,
        onApprovalRequest,
        timeoutMs,
        stderrBaseline,
      });
    } finally {
      stopEarlyTurnEventCapture(this, earlyEventCapture);
    }
  }

  async steerTurn({
    threadId,
    expectedTurnId,
    input,
    clientUserMessageId,
  }: CodexTurnSteerParams): Promise<CodexTurnSteerResult> {
    const result: any = await this.request('turn/steer', {
      threadId,
      expectedTurnId,
      input,
      ...(clientUserMessageId === undefined ? {} : { clientUserMessageId }),
    }, { timeoutMs: 15_000 });
    const turnId = normalizeNullableString(result?.turnId);
    if (!turnId) {
      throw new Error('Codex turn/steer returned no turn id');
    }
    return { turnId };
  }

  async interruptTurn({ threadId, turnId }: { threadId: string; turnId: string }): Promise<void> {
    await this.request('turn/interrupt', { threadId, turnId }, { timeoutMs: 15_000 });
  }

  getPendingApprovals({
    threadId = null,
    turnId = null,
  }: {
    threadId?: string | null;
    turnId?: string | null;
  } = {}): ProviderApprovalRequest[] {
    return [...this.pendingApprovals.values()]
      .map((entry) => entry.request)
      .filter((entry) => {
        if (threadId && entry.threadId !== threadId) {
          return false;
        }
        if (turnId && entry.turnId !== turnId) {
          return false;
        }
        return true;
      });
  }

  subscribeToApprovalRequests(
    listener: (request: ProviderApprovalRequest) => void,
    { replayPending = true }: { replayPending?: boolean } = {},
  ): () => void {
    const onApprovalRequest = (request: ProviderApprovalRequest) => {
      listener(request);
    };
    this.on('approval_request', onApprovalRequest);
    try {
      if (replayPending) {
        for (const request of this.getPendingApprovals()) {
          listener(request);
        }
      }
    } catch (error) {
      this.off('approval_request', onApprovalRequest);
      throw error;
    }
    return () => {
      this.off('approval_request', onApprovalRequest);
    };
  }

  async respondToApproval({
    requestId,
    option,
  }: {
    requestId: string;
    option: 1 | 2 | 3;
  }): Promise<void> {
    const pending = this.pendingApprovals.get(String(requestId)) ?? null;
    if (!pending) {
      throw Object.assign(new Error(`Unknown approval request: ${requestId}`), { code: 'approval_not_found' });
    }
    const result = buildApprovalResponseResult(pending, option);
    const approvedExecution = createApprovedExecution(pending, option, this.turnPollNow());
    if (approvedExecution) {
      this.approvedExecutions.set(approvedExecution.requestId, approvedExecution);
    }
    this.pendingApprovals.delete(String(requestId));
    try {
      this.send({
        jsonrpc: '2.0',
        id: pending.rpcResponseId,
        result,
      });
    } catch (error) {
      if (approvedExecution) {
        this.approvedExecutions.delete(approvedExecution.requestId);
      }
      throw new AppServerResponseUncertainError('approval/response', error instanceof Error ? error.message : String(error));
    }
    this.pendingApprovals.delete(String(requestId));
    if (approvedExecution) {
      this.logDebug('approval_response_sent', summarizeApprovedExecution(approvedExecution));
    }
  }

  async listModels(): Promise<CodexModelInfo[]> {
    const models = [];
    let cursor = null;
    do {
      const result: any = await this.request('model/list', {
        cursor,
        limit: 100,
        includeHidden: false,
      }, { timeoutMs: 30_000 });
      const rows = Array.isArray(result?.data) ? result.data : [];
      models.push(...rows.map(mapModel));
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : null;
    } while (cursor);
    if (this.modelCatalogMode === 'overlay-only' && this.modelCatalog.length > 0) {
      return this.modelCatalog;
    }
    return mergeModelCatalog(models, this.modelCatalog);
  }

  async readConfigDefaults({
    cwd = null,
  }: {
    cwd?: string | null;
  } = {}): Promise<ProviderConfigDefaults> {
    const result: any = await this.request('config/read', {
      includeLayers: false,
      cwd,
    }, { timeoutMs: 30_000 });
    const config = result?.config && typeof result.config === 'object'
      ? result.config
      : result;
    return {
      model: normalizeNullableString(config?.model),
      reasoningEffort: normalizeNullableString(config?.modelReasoningEffort)
        ?? normalizeNullableString(config?.model_reasoning_effort),
    };
  }

  async readUsage(): Promise<ProviderUsageReport | null> {
    const result = await this.request('account/rateLimits/read', {}, { timeoutMs: 15_000 });
    return mapAppServerRateLimits(result);
  }

  async listSkills({
    cwd = null,
    forceReload = false,
  }: {
    cwd?: string | null;
    forceReload?: boolean;
  } = {}): Promise<ProviderSkillsListResult> {
    const result: any = await this.request('skills/list', {
      cwds: cwd ? [cwd] : [],
      forceReload,
    }, { timeoutMs: 30_000 });
    const rows = Array.isArray(result?.data) ? result.data : [];
    const entry = rows.find((item: CodexAppSkillsListEntry) => normalizeNullableString(item?.cwd) === cwd)
      ?? rows[0]
      ?? null;
    return {
      cwd: normalizeNullableString(entry?.cwd) ?? cwd ?? null,
      skills: Array.isArray(entry?.skills) ? entry.skills.map(mapSkillMetadata).filter(Boolean) : [],
      errors: Array.isArray(entry?.errors) ? entry.errors.map(mapSkillErrorInfo).filter(Boolean) : [],
    };
  }

  async setSkillEnabled({
    enabled,
    name = null,
    path = null,
  }: {
    enabled: boolean;
    name?: string | null;
    path?: string | null;
  }): Promise<void> {
    await this.request('skills/config/write', {
      enabled,
      name,
      path,
    }, { timeoutMs: 30_000 });
  }

  async listPlugins({
    cwd = null,
  }: {
    cwd?: string | null;
  } = {}): Promise<ProviderPluginsListResult> {
    const result: CodexAppPluginListResponse = await this.request('plugin/list', {
      cwds: cwd ? [cwd] : [],
    }, { timeoutMs: 30_000 });
    return {
      featuredPluginIds: Array.isArray(result?.featuredPluginIds)
        ? result.featuredPluginIds.map((value) => String(value ?? '').trim()).filter(Boolean)
        : [],
      marketplaceLoadErrors: Array.isArray(result?.marketplaceLoadErrors)
        ? result.marketplaceLoadErrors.map(mapPluginLoadError).filter(Boolean) as ProviderPluginLoadError[]
        : [],
      marketplaces: Array.isArray(result?.marketplaces)
        ? result.marketplaces.map(mapPluginMarketplace).filter(Boolean) as ProviderPluginMarketplace[]
        : [],
    };
  }

  async readPlugin({
    pluginName,
    marketplaceName = null,
    marketplacePath = null,
  }: {
    pluginName: string;
    marketplaceName?: string | null;
    marketplacePath?: string | null;
  }): Promise<ProviderPluginDetail | null> {
    const params: AppServerParams<'plugin/read'> = {
      pluginName,
    };
    if (marketplacePath) {
      params.marketplacePath = marketplacePath;
    } else if (marketplaceName) {
      params.remoteMarketplaceName = marketplaceName;
    }
    const result: any = await this.request('plugin/read', params, { timeoutMs: 30_000 });
    return mapPluginDetail(result?.plugin ?? null, {
      marketplaceName,
      marketplacePath,
    });
  }

  async installPlugin({
    pluginName,
    marketplaceName = null,
    marketplacePath = null,
  }: {
    pluginName: string;
    marketplaceName?: string | null;
    marketplacePath?: string | null;
  }): Promise<ProviderPluginInstallResult> {
    const params: AppServerParams<'plugin/read'> = {
      pluginName,
    };
    if (marketplacePath) {
      params.marketplacePath = marketplacePath;
    } else if (marketplaceName) {
      params.remoteMarketplaceName = marketplaceName;
    }
    const result: CodexAppPluginInstallResponse = await this.request('plugin/install', params, { timeoutMs: 30_000 });
    return {
      authPolicy: normalizeNullableString(result?.authPolicy),
      appsNeedingAuth: Array.isArray(result?.appsNeedingAuth)
        ? result.appsNeedingAuth.map(mapPluginAppSummary).filter(Boolean) as ProviderPluginAppSummary[]
        : [],
    };
  }

  async uninstallPlugin({
    pluginId,
  }: {
    pluginId: string;
  }): Promise<void> {
    await this.request('plugin/uninstall', {
      pluginId,
    }, { timeoutMs: 30_000 });
  }

  async listApps(): Promise<ProviderAppInfo[]> {
    const apps = [];
    let cursor = null;
    do {
      const result: any = await this.request('app/list', {
        cursor,
        limit: 100,
      }, { timeoutMs: 30_000 });
      const rows = Array.isArray(result?.data) ? result.data : [];
      apps.push(...rows.map(mapAppInfo).filter(Boolean));
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : null;
    } while (cursor);
    return apps;
  }

  async listMcpServerStatuses(): Promise<ProviderMcpServerStatus[]> {
    const servers = [];
    let cursor = null;
    do {
      const result: any = await this.request('mcpServerStatus/list', {
        cursor,
        limit: 100,
      }, { timeoutMs: 30_000 });
      const rows = Array.isArray(result?.data) ? result.data : [];
      servers.push(...rows.map(mapMcpServerStatus).filter(Boolean));
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : null;
    } while (cursor);
    return servers;
  }

  async setAppEnabled({
    appId,
    enabled,
  }: {
    appId: string;
    enabled: boolean;
  }): Promise<void> {
    await this.writeConfigValue({
      keyPath: formatConfigKeyPath(['apps', appId, 'enabled']),
      value: enabled,
    });
  }

  async setMcpServerEnabled({
    name,
    enabled,
  }: {
    name: string;
    enabled: boolean;
  }): Promise<void> {
    await this.writeConfigValue({
      keyPath: formatConfigKeyPath(['mcp_servers', name, 'enabled']),
      value: enabled,
    });
  }

  async startMcpServerOauthLogin({
    name,
    scopes = null,
    timeoutSecs = null,
  }: {
    name: string;
    scopes?: string[] | null;
    timeoutSecs?: number | null;
  }): Promise<ProviderMcpOauthLoginResult> {
    const result: CodexAppMcpOauthLoginResponse = await this.request('mcpServer/oauth/login', {
      name,
      scopes,
      timeoutSecs,
    }, { timeoutMs: 30_000 });
    const authorizationUrl = normalizeNullableString(result?.authorizationUrl);
    if (!authorizationUrl) {
      throw new Error(`mcpServer/oauth/login returned no authorization URL for ${name}`);
    }
    return { authorizationUrl };
  }

  async reloadMcpServers(): Promise<void> {
    await this.request('config/mcpServer/reload', undefined, { timeoutMs: 30_000 });
  }

  async writeConfigValue({
    keyPath,
    value,
    mergeStrategy = 'upsert',
    filePath = null,
    expectedVersion = null,
  }: {
    keyPath: string;
    value: unknown;
    mergeStrategy?: 'replace' | 'upsert';
    filePath?: string | null;
    expectedVersion?: string | null;
  }): Promise<void> {
    await this.request('config/value/write', {
      keyPath,
      value: value as JsonValue,
      mergeStrategy,
      filePath,
      expectedVersion,
    }, { timeoutMs: 30_000 });
  }

  async startServer(): Promise<void> { return startServer.call(this); }
  async connectWebSocket(): Promise<void> { return connectWebSocket.call(this); }

  async initialize(): Promise<void> {
    const response = validateInitialize(await this.request('initialize', initializeParams(this.clientInfo), { timeoutMs: 30_000 }));
    this.initializedServer = { userAgent: response.userAgent, binary: this.launchedBinaryPath ?? this.codexCliBin, initializedAt: Date.now(), version: response.userAgent.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?/u)?.[0] ?? null };
    this.send({ jsonrpc: '2.0', method: 'initialized' });
  }

  async request<M extends AppServerMethod>(method: M, params: AppServerParams<M>, { timeoutMs = 30_000 }: { timeoutMs?: number } = {}): Promise<AppServerResponse<M>> {
    return callAppServer(this, method, params, timeoutMs);
  }

  send(payload: any): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Codex app-server socket is not open');
    }
    this.socket.send(JSON.stringify(payload));
  }

  handleMessage(raw: string): void {
    const message = parseMessage(raw);
    if (!message || acceptResponse(this, message)) return;

    if ('method' in message) {
      this.noteApprovedExecutionSignalFromNotification(message);
      this.logDebug('rpc_notification', summarizeNotificationMessage(message));
      if ('id' in message && this.handleServerRequest(message)) {
        return;
      }
      this.emit('notification', message);
    }
  }

  handleServerRequest(message: any): boolean {
    const pendingApproval = mapPendingApproval(message);
    if (!pendingApproval) {
      this.emit('server_request', message);
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unsupported server request: ${message.method}` } });
      return true;
    }
    if (this.connectionEpoch > 0) {
      pendingApproval.rpcId = `${this.connectionIdentity}:${this.connectionEpoch}:${pendingApproval.rpcId}`;
      pendingApproval.request.requestId = pendingApproval.rpcId;
    }
    if (!pendingApproval.request.threadId || pendingApproval.request.threadId === 'undefined') {
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Approval request requires thread identity' } });
      return true;
    }
    if (this.pendingApprovals.has(pendingApproval.rpcId)) return true;
    if (this.pendingApprovals.size >= 1024) {
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Client approval capacity reached' } });
      return true;
    }
    this.pendingApprovals.set(pendingApproval.rpcId, pendingApproval);
    this.emit('approval_request', pendingApproval.request);
    return true;
  }

  rejectPending(error: Error): void {
    rejectTransportPending(this, error);
  }

  captureNextTurnStartedForThread(threadId: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (turnId: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.off('notification', onNotification);
        resolve(turnId);
      };
      const onNotification = (message: any) => {
        if (String(message?.method ?? '') !== 'turn/started') {
          return;
        }
        if (extractThreadIdFromNotification(message) !== threadId) {
          return;
        }
        finish(extractNotificationTurnId(message?.params ?? null));
      };
      const timer = setTimeout(() => finish(null), Math.max(100, timeoutMs));
      this.on('notification', onNotification);
    });
  }

  getApprovedExecutions({
    threadId = null,
    turnId = null,
    activeOnly = false,
  }: {
    threadId?: string | null;
    turnId?: string | null;
    activeOnly?: boolean;
  } = {}): ApprovedExecution[] {
    return [...this.approvedExecutions.values()].filter((entry) => {
      if (threadId && entry.threadId !== threadId) {
        return false;
      }
      if (turnId && entry.turnId && entry.turnId !== turnId) {
        return false;
      }
      if (activeOnly && entry.completedAt) {
        return false;
      }
      return true;
    });
  }

  noteApprovedExecutionSignalFromNotification(message: any): void {
    const signalKind = classifyApprovedExecutionSignal(message?.method);
    if (!signalKind) {
      return;
    }
    const threadId = extractThreadIdFromNotification(message);
    if (!threadId) {
      return;
    }
    this.noteApprovedExecutionSignal({
      threadId,
      turnId: extractNotificationTurnId(message?.params ?? null),
      itemId: extractItemId(message?.params ?? null),
      signalKind,
      markCompleted: signalKind === 'item_completed' || signalKind === 'turn_completed',
    });
  }

  noteApprovedExecutionSignal({
    threadId,
    turnId = null,
    itemId = null,
    signalKind,
    markCompleted = false,
  }: {
    threadId: string;
    turnId?: string | null;
    itemId?: string | null;
    signalKind: string;
    markCompleted?: boolean;
  }): void {
    const now = this.turnPollNow();
    for (const entry of this.approvedExecutions.values()) {
      if (entry.completedAt) {
        continue;
      }
      if (entry.threadId !== threadId) {
        continue;
      }
      if (turnId && entry.turnId && entry.turnId !== turnId) {
        continue;
      }
      if (!turnId && entry.turnId && !isThreadLevelApprovedExecutionSignal(signalKind)) {
        continue;
      }
      const firstSignal = entry.signalCount === 0;
      entry.lastSignalAt = now;
      entry.lastSignalKind = signalKind;
      entry.signalCount += 1;
      if (
        markCompleted
        && (
          !itemId
          || !entry.itemId
          || entry.itemId === itemId
        )
      ) {
        entry.completedAt = now;
      }
      if (firstSignal || entry.completedAt) {
        this.logDebug('approval_signal', summarizeApprovedExecutionSignal(entry, signalKind));
      }
    }
  }

  observeApprovedExecutionTurnSnapshot({
    threadId,
    turnId,
    turn,
  }: {
    threadId: string;
    turnId: string;
    turn: any;
  }): void {
    const activeEntries = this.getApprovedExecutions({ threadId, turnId, activeOnly: true });
    if (activeEntries.length === 0 || !turn) {
      return;
    }
    const snapshotKey = buildTurnSnapshotKey(turn);
    let changed = false;
    for (const entry of activeEntries) {
      if (!entry.lastObservedTurnSnapshotKey) {
        entry.lastObservedTurnSnapshotKey = snapshotKey;
        continue;
      }
      if (entry.lastObservedTurnSnapshotKey !== snapshotKey) {
        entry.lastObservedTurnSnapshotKey = snapshotKey;
        changed = true;
      }
    }
    if (changed) {
      this.noteApprovedExecutionSignal({
        threadId,
        turnId,
        signalKind: 'turn_snapshot_changed',
      });
    }
  }

  inspectApprovedExecutionStall({
    threadId,
    turnId,
    timeoutMs,
  }: {
    threadId: string;
    turnId: string;
    timeoutMs: number;
  }): null | {
    entry: ApprovedExecution;
    idleMs: number;
    idleLimitMs: number;
  } {
    const activeEntries = this.getApprovedExecutions({ threadId, turnId, activeOnly: true });
    if (activeEntries.length === 0) {
      return null;
    }
    const now = this.turnPollNow();
    const idleLimitMs = computeApprovedExecutionIdleLimitMs(timeoutMs);
    let stalledEntry: ApprovedExecution | null = null;
    let stalledIdleMs = 0;
    for (const entry of activeEntries) {
      const idleMs = Math.max(0, now - Math.max(entry.lastSignalAt, entry.approvedAt));
      if (idleMs < idleLimitMs) {
        continue;
      }
      if (!stalledEntry || idleMs > stalledIdleMs) {
        stalledEntry = entry;
        stalledIdleMs = idleMs;
      }
    }
    if (!stalledEntry) {
      return null;
    }
    return {
      entry: stalledEntry,
      idleMs: stalledIdleMs,
      idleLimitMs,
    };
  }

  clearApprovedExecutionsForTurn({
    threadId,
    turnId,
  }: {
    threadId: string;
    turnId: string;
  }): void {
    for (const [requestId, entry] of this.approvedExecutions.entries()) {
      if (entry.threadId !== threadId) {
        continue;
      }
      if (entry.turnId && entry.turnId !== turnId) {
        continue;
      }
      this.approvedExecutions.delete(requestId);
    }
  }

  async waitForTurnResult({
    threadId,
    turnId,
    onProgress,
    onWorkEvent,
    onApprovalRequest,
    timeoutMs,
    stderrBaseline = 0,
    turnStartStatus = null,
  }: {
    threadId: string;
    turnId: string;
    onProgress?: ((progress: ProviderTurnProgress) => Promise<void> | void) | null;
    onWorkEvent?: ((event: ProviderTurnWorkEvent) => Promise<void> | void) | null;
    onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void> | void) | null;
    timeoutMs: number;
    stderrBaseline?: number;
    turnStartStatus?: string | null;
  }): Promise<ProviderTurnResult> {
    const legacyRolloutRecovery = needsLegacyRolloutRecovery(this.initializedServer?.userAgent ?? null);
    let deadline = this.turnPollNow() + timeoutMs;
    let firstTerminalWithoutOutputAt = null;
    let lastTurnSnapshotKey = null;
    let stableTerminalReadCount = 0;
    let terminalSettleLeaseRenewed = false;
    let pollCount = 0;
    let consecutiveReadFailures = 0;
    let includeTurnsUnsupported = false;
    let includeTurnsUnsupportedAt = 0;
    let pendingApprovalWaitLogged = false;
    let lastPendingApprovalCount = 0;
    let initialActiveTurnSnapshotPending = normalizeTurnStatusKey(turnStartStatus) === 'inprogress';
    let initialInterruptedSnapshotAt: number | null = null;
    const terminalSettleMs = computeTerminalSettleMs(timeoutMs);
    const progressState: ProgressState = {
      commentaryText: '',
      reasoningSummaryText: '',
      finalAnswerText: '',
      sawAssistantActivity: false,
      lastAssistantActivityAt: 0,
      items: new Map(),
    };
    const itemOutputKinds = new Map<string, string>();
    const workOutputTexts = new Map<string, string>();
    const startedWorkEvents = new Map<string, ProviderTurnWorkEvent>();
    const emittedSnapshotWorkEvents = new Set<string>();
    let sawTerminalNotification = false;
    let sawInterruptedTurnCompletionNotification = false;
    let sawTurnWorkActivity = false;
    let turnNotificationError: string | null = null;
    const official = new TurnObserver(threadId, turnId);
    let observationError: Error | null = null;
    let wakeObservation: (() => void) | null = null;
    const onObservationInterrupted = (error: Error) => { observationError = error; wakeObservation?.(); };
    const waitForReconciliation = async (ms: number) => {
      if (official.terminal || turnNotificationError || observationError) return;
      if (this.turnPollSleep !== sleep) { await this.turnPollSleep(ms); return; }
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); wakeObservation = null; resolve(); };
        const timer = setTimeout(finish, ms);
        wakeObservation = finish;
      });
    };
    const officialResult = (): ProviderTurnResult | null => {
      if (!official.terminal) return null;
      const turn = mapTurn(official.terminal);
      if (turn.status === 'failed') throw new Error(turn.error || 'Codex turn failed');
      const outputText = extractTurnOutputText(turn) || resolveProgressPreviewText(progressState);
      const outputArtifacts = extractTurnOutputArtifacts(turn);
      emitWorkEventsFromTurnSnapshot({ turn, onWorkEvent, emittedKeys: emittedSnapshotWorkEvents });
      return { threadId, turnId, title: null, status: turn.status,
        outputText, previewText: resolveProgressPreviewText(progressState),
        outputArtifacts, outputMedia: normalizeLegacyImageMedia(outputArtifacts),
        responseItems: toProviderResponseItems(turn.items.map((item) => item.raw).filter(Boolean)),
        outputState: turn.status === 'interrupted' ? 'interrupted' : 'complete', finalSource: 'official_turn_completed' };
    };
    const onNotification = (notification) => {
      const eventThreadId = extractThreadIdFromNotification(notification);
      if (eventThreadId && eventThreadId !== threadId) return;
      if (official.accept(notification)) wakeObservation?.();
      if (isTerminalNotificationForThread(notification, threadId, turnId)) {
        sawTerminalNotification = true;
      }
      if (isInterruptedTurnCompletionNotificationForThread(notification, threadId, turnId)) {
        sawInterruptedTurnCompletionNotification = true;
      }
      const notificationError = extractTurnErrorNotificationMessage(notification, { threadId, turnId });
      if (notificationError) {
        turnNotificationError = notificationError;
        wakeObservation?.();
      }
      const workEvent = extractWorkEventUpdate(notification, {
        threadId,
        turnId,
        workOutputTexts,
        startedWorkEvents,
      });
      if (workEvent) {
        sawTurnWorkActivity = true;
        if (typeof onWorkEvent === 'function') {
          void onWorkEvent(workEvent);
        }
      }
      const progress = extractProgressUpdate(notification, turnId, itemOutputKinds, progressState);
      if (!progress) {
        return;
      }
      if (progress.text || progress.eventType !== 'started') {
        if (progress.outputKind === 'final_answer') {
          progressState.finalAnswerText = progress.text;
        } else if (progress.outputKind === 'reasoning_summary') {
          progressState.reasoningSummaryText = progress.text;
        } else {
          progressState.commentaryText = progress.text;
        }
      }
      progressState.sawAssistantActivity = true;
      progressState.lastAssistantActivityAt = this.turnPollNow();
      if (typeof onProgress === 'function') {
        void onProgress(progress);
      }
    };
    const onApprovalEvent = (request: ProviderApprovalRequest) => {
      if (request.threadId !== threadId) {
        return;
      }
      if (request.turnId && request.turnId !== turnId) {
        return;
      }
      if (typeof onApprovalRequest === 'function') {
        void onApprovalRequest(request);
      }
    };
    this.on('notification', onNotification);
    this.on('approval_request', onApprovalEvent);
    this.on('observation_interrupted', onObservationInterrupted);
    this.logDebug('turn_wait_start', {
      threadId,
      turnId,
      timeoutMs,
      deadline,
      terminalSettleMs,
      turnStartStatus,
    });
    try {
      const bufferedEvents = claimEarlyTurnEvents(this, threadId, turnId);
      if (bufferedEvents.length > 0) {
        this.logDebug('turn_wait_replay_early_events', {
          threadId,
          turnId,
          eventCount: bufferedEvents.length,
        });
      }
      for (const event of bufferedEvents) {
        if (event.type === 'notification') {
          onNotification(event.value);
        } else {
          onApprovalEvent(event.value);
        }
      }
      while (true) {
        const eventResult = officialResult();
        if (eventResult) return eventResult;
        if (observationError) throw observationError;
        if (turnNotificationError) throw new Error(turnNotificationError);
        const pendingApprovalCount = this.getPendingApprovals({ threadId, turnId }).length;
        const pastDeadline = this.turnPollNow() >= deadline;
        if (pastDeadline && pendingApprovalCount > 0) {
          if (!pendingApprovalWaitLogged || pendingApprovalCount !== lastPendingApprovalCount) {
            this.logDebug('turn_wait_continue', {
              threadId,
              turnId,
              pollCount,
              reason: 'pending_approval_wait',
              pendingApprovalCount,
            });
          }
          pendingApprovalWaitLogged = true;
          lastPendingApprovalCount = pendingApprovalCount;
        } else {
          pendingApprovalWaitLogged = false;
          lastPendingApprovalCount = pendingApprovalCount;
        }
        pollCount += 1;
        let thread = null;
        try {
          thread = await this.readThread(threadId, !includeTurnsUnsupported);
        } catch (error) {
          if (official.terminal) return officialResult()!;
          consecutiveReadFailures += 1;
          if (!legacyRolloutRecovery && consecutiveReadFailures >= 3 && (isRequestTimeoutError(error) || isThreadMaterializationPendingError(error))) {
            throw new AppServerObservationInterruptedError(`Unable to synchronize Codex turn ${turnId} after three reads`);
          }
          if (this.turnPollNow() >= deadline && pendingApprovalCount === 0) {
            throw new AppServerObservationInterruptedError(`Unable to synchronize Codex turn ${turnId}`);
          }
          if (isThreadMaterializationPendingError(error)) {
            this.logDebug('turn_poll_retry', {
              threadId,
              turnId,
              pollCount,
              reason: 'thread_materialization_pending',
            });
            await waitForReconciliation(1000);
            continue;
          }
          if (isRequestTimeoutError(error)) {
            this.logDebug('turn_poll_retry', {
              threadId,
              turnId,
              pollCount,
              reason: 'thread_read_timeout',
            });
            await waitForReconciliation(1000);
            continue;
          }
          if (isIncludeTurnsUnsupportedError(error)) {
            includeTurnsUnsupported = true;
            includeTurnsUnsupportedAt ||= this.turnPollNow();
            this.logDebug('turn_poll_retry', {
              threadId,
              turnId,
              pollCount,
              reason: 'thread_read_include_turns_unsupported',
            });
            try {
              thread = await this.readThread(threadId, false);
            } catch (fallbackError) {
              if (isThreadMaterializationPendingError(fallbackError) || isRequestTimeoutError(fallbackError)) {
                await waitForReconciliation(250);
                continue;
              }
              throw fallbackError;
            }
          } else {
            throw error;
          }
        }
        consecutiveReadFailures = 0;
        const completedDuringRead = officialResult();
        if (completedDuringRead) return completedDuringRead;
        if (observationError) throw observationError;
        const turn = includeTurnsUnsupported
          ? null
          : thread?.turns?.find((entry) => entry.id === turnId) ?? null;
        this.logDebug('turn_poll_snapshot', {
          threadId,
          turnId,
          pollCount,
          elapsedMs: timeoutMs - Math.max(0, deadline - this.turnPollNow()),
          threadFound: Boolean(thread),
          threadPath: thread?.path ?? null,
          turn: summarizeTurnSnapshot(turn),
          progress: summarizeProgressState(progressState),
        });
        if (!turnHasNativeWorkItems(turn)) {
          emitWorkEventsFromSessionPath({
            sessionPath: legacyRolloutRecovery ? thread?.path ?? null : null,
            turnId,
            onWorkEvent,
            emittedKeys: emittedSnapshotWorkEvents,
          });
        }
        const openTurnRuntimeError = findOpenTurnRuntimeErrorFromSessionPath(legacyRolloutRecovery ? thread?.path ?? null : null, turnId);
        if (openTurnRuntimeError) {
          this.logDebug('turn_wait_error', {
            threadId,
            turnId,
            pollCount,
            reason: 'session_runtime_error',
            error: openTurnRuntimeError,
          });
          throw new Error(openTurnRuntimeError);
        }
        if (turnNotificationError) {
          this.logDebug('turn_wait_error', {
            threadId,
            turnId,
            pollCount,
            reason: 'notification_error',
            error: turnNotificationError,
          });
          throw new Error(turnNotificationError);
        }
        const turnIsTerminal = Boolean(turn && isTurnTerminal(turn.status));
        const threadRuntimeType = normalizeNullableString(thread?.runtimeStatus?.type);
        const shouldRenewObserverLease = pendingApprovalCount > 0
          || Boolean(turn && !turnIsTerminal)
          || threadRuntimeType === 'active'
          || (legacyRolloutRecovery && includeTurnsUnsupported && !sawTerminalNotification);
        if (pastDeadline && !turnIsTerminal) {
          if (!shouldRenewObserverLease) {
            break;
          }
          deadline = this.turnPollNow() + timeoutMs;
          this.logDebug('turn_wait_continue', {
            threadId,
            turnId,
            pollCount,
            reason: 'observer_lease_renewed',
            pendingApprovalCount,
            threadRuntimeType,
            nextDeadline: deadline,
          });
        }
        if (pastDeadline && turnIsTerminal && !terminalSettleLeaseRenewed) {
          terminalSettleLeaseRenewed = true;
          deadline = this.turnPollNow() + terminalSettleMs;
          this.logDebug('turn_wait_continue', {
            threadId,
            turnId,
            pollCount,
            reason: 'terminal_settle_lease_renewed',
            nextDeadline: deadline,
          });
        }
        if (includeTurnsUnsupported) {
          const previewText = resolveProgressPreviewText(progressState);
          const settleAnchor = Math.max(
            includeTurnsUnsupportedAt,
            progressState.lastAssistantActivityAt || 0,
          );
          const settleElapsedMs = settleAnchor ? this.turnPollNow() - settleAnchor : 0;
          if (
            (
              !sawTerminalNotification
              || !previewText
              || settleElapsedMs < 500
            )
            && this.turnPollNow() + 250 < deadline
          ) {
            await waitForReconciliation(250);
            continue;
          }
          if (previewText) {
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText: previewText,
              outputArtifacts: [],
              outputMedia: [],
              outputState: sawTerminalNotification ? 'complete' : 'partial',
              previewText,
              finalSource: resolveProgressFinalSource(progressState),
              status: sawTerminalNotification ? 'completed' : null,
            };
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          if (sawTerminalNotification) {
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText: '',
              outputArtifacts: [],
              outputMedia: [],
              outputState: 'missing',
              previewText: '',
              finalSource: 'none',
              status: 'completed',
            };
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          await waitForReconciliation(250);
          continue;
        }
        if (turn) {
          emitWorkEventsFromTurnSnapshot({
            turn,
            onWorkEvent,
            emittedKeys: emittedSnapshotWorkEvents,
          });
          this.observeApprovedExecutionTurnSnapshot({
            threadId,
            turnId,
            turn,
          });
        }
        const approvedExecutionStall = this.inspectApprovedExecutionStall({
          threadId,
          turnId,
          timeoutMs,
        });
        if (approvedExecutionStall) {
          this.logDebug('turn_wait_error', {
            threadId,
            turnId,
            pollCount,
            reason: 'approved_execution_stalled',
            idleMs: approvedExecutionStall.idleMs,
            idleLimitMs: approvedExecutionStall.idleLimitMs,
            approval: summarizeApprovedExecution(approvedExecutionStall.entry),
          });
          throw new Error(buildApprovedExecutionStallError(approvedExecutionStall));
        }
        if (turn && initialActiveTurnSnapshotPending && !isTurnTerminal(turn.status)) {
          initialActiveTurnSnapshotPending = false;
        }
        if (turn && isTurnTerminal(turn.status) && !legacyRolloutRecovery) {
          // A resumed snapshot can briefly expose the prior interrupted materialization.
          const awaitingMaterialization = initialActiveTurnSnapshotPending && normalizeTurnStatusKey(turn.status) === 'interrupted'
            && !sawTerminalNotification && !turn.items.length;
          if (awaitingMaterialization) {
            initialInterruptedSnapshotAt ??= this.turnPollNow();
            if (this.turnPollNow() - initialInterruptedSnapshotAt < INITIAL_TURN_MATERIALIZATION_SETTLE_MS) {
              await waitForReconciliation(INITIAL_TURN_MATERIALIZATION_POLL_MS);
              continue;
            }
          }
          if (normalizeTurnStatusKey(turn.status) === 'failed') throw new Error(turn.error || 'Codex turn failed');
          const outputArtifacts = extractTurnOutputArtifacts(turn);
          return { threadId, turnId, title: thread?.title ?? null, status: turn.status,
            outputText: extractTurnOutputText(turn) || resolveProgressPreviewText(progressState),
            previewText: resolveProgressPreviewText(progressState), outputArtifacts,
            outputMedia: normalizeLegacyImageMedia(outputArtifacts),
            responseItems: toProviderResponseItems(turn.items.map((item) => item.raw).filter(Boolean)),
            outputState: normalizeTurnStatusKey(turn.status) === 'interrupted' ? 'interrupted' : 'complete', finalSource: 'official_thread_snapshot' };
        }
        if (turn && isTurnTerminal(turn.status)) {
          const outputText = extractTurnOutputText(turn);
          if (outputText) {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'turn_terminal',
              markCompleted: true,
            });
            const outputArtifacts = extractTurnOutputArtifacts(turn);
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText,
              outputArtifacts,
              outputMedia: normalizeLegacyImageMedia(outputArtifacts),
              outputState: 'complete',
              previewText: resolveProgressPreviewText(progressState),
              finalSource: 'thread_items',
              status: turn.status,
            };
            const enrichedResult = attachSessionResponseItems(result, legacyRolloutRecovery ? thread?.path ?? null : null);
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(enrichedResult));
            return enrichedResult;
          }
          const outputArtifacts = extractTurnOutputArtifacts(turn);
          if (outputArtifacts.length > 0) {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'turn_terminal',
              markCompleted: true,
            });
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText: '',
              outputArtifacts,
              outputMedia: normalizeLegacyImageMedia(outputArtifacts),
              outputState: 'complete',
              previewText: resolveProgressPreviewText(progressState),
              finalSource: 'thread_items_media',
              status: turn.status,
            };
            const enrichedResult = attachSessionResponseItems(result, legacyRolloutRecovery ? thread?.path ?? null : null);
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(enrichedResult));
            return enrichedResult;
          }
          const sessionState = inspectTurnCompletionFromSessionPath(thread?.path ?? null, turnId);
          const hasAssistantVisibleItems = turn.items.some((item) => isAssistantVisibleItem(item));
          const snapshotCompletionState = classifyTurnCompletionState(turn);
          const taskCompleteOverridesInterrupted = snapshotCompletionState === 'interrupted'
            && sessionState.hasTaskComplete;
          const completionState = taskCompleteOverridesInterrupted ? 'other' : snapshotCompletionState;
          const terminalResultStatus = taskCompleteOverridesInterrupted ? 'completed' : turn.status;
          const hasTurnExecutionActivity = hasAssistantVisibleItems
            || turn.items.some((item) => isReasoningItem(item))
            || turnHasWorkActivityItems(turn)
            || progressState.sawAssistantActivity
            || sawTurnWorkActivity;
          this.logDebug('turn_terminal_state', {
            threadId,
            turnId,
            pollCount,
            turn: summarizeTurnSnapshot(turn),
            hasAssistantVisibleItems,
            hasTurnExecutionActivity,
            snapshotCompletionState,
            completionState,
            sessionState: summarizeSessionState(thread?.path ?? null, sessionState),
            progress: summarizeProgressState(progressState),
          });
          if (
            completionState === 'interrupted'
            && !turn.error
            && !hasTurnExecutionActivity
            && initialActiveTurnSnapshotPending
            && !sawInterruptedTurnCompletionNotification
            && !sessionState.hasTurnAborted
          ) {
            initialInterruptedSnapshotAt ??= this.turnPollNow();
            const materializationElapsedMs = this.turnPollNow() - initialInterruptedSnapshotAt;
            if (
              materializationElapsedMs < INITIAL_TURN_MATERIALIZATION_SETTLE_MS
              && this.turnPollNow() + INITIAL_TURN_MATERIALIZATION_POLL_MS <= deadline
            ) {
              this.logDebug('turn_wait_continue', {
                threadId,
                turnId,
                pollCount,
                reason: 'initial_interrupted_snapshot_materialization_wait',
                turnStartStatus,
                materializationElapsedMs,
                materializationSettleMs: INITIAL_TURN_MATERIALIZATION_SETTLE_MS,
              });
              await waitForReconciliation(INITIAL_TURN_MATERIALIZATION_POLL_MS);
              continue;
            }
            initialActiveTurnSnapshotPending = false;
          }
          if (completionState === 'interrupted') {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'turn_terminal',
              markCompleted: true,
            });
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText: '',
              outputState: 'interrupted',
              previewText: resolveProgressPreviewText(progressState),
              finalSource: resolveProgressFinalSource(progressState),
              status: turn.status,
            };
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          if (turn.error && !taskCompleteOverridesInterrupted) {
            this.logDebug('turn_wait_error', {
              threadId,
              turnId,
              pollCount,
              error: turn.error,
            });
            throw new Error(turn.error);
          }
          if (
            (sessionState.lastAgentMessage && hasAssistantVisibleItems)
            || (
              taskCompleteOverridesInterrupted
              && (sessionState.lastAgentMessage || sessionState.outputArtifacts.length > 0)
            )
          ) {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'session_task_complete',
              markCompleted: true,
            });
            const result = buildSessionTaskCompleteResult({
              turnId,
              threadId,
              title: thread?.title ?? null,
              status: terminalResultStatus,
              previewText: resolveProgressPreviewText(progressState),
              sessionState,
            });
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          const sessionTaskCompleteNeedsMaterializationWait = shouldWaitForSessionTaskMaterialization(
            sessionState,
            hasAssistantVisibleItems,
          );
          if (shouldWaitForSettledOutputAfterTerminalTurn(turn, progressState) || sessionTaskCompleteNeedsMaterializationWait) {
            const snapshotKey = buildTurnSnapshotKey(turn);
            if (snapshotKey === lastTurnSnapshotKey) {
              stableTerminalReadCount += 1;
            } else {
              lastTurnSnapshotKey = snapshotKey;
              stableTerminalReadCount = 1;
            }
            firstTerminalWithoutOutputAt ??= this.turnPollNow();
            if (
              (
                this.turnPollNow() - firstTerminalWithoutOutputAt < terminalSettleMs
                || stableTerminalReadCount < 3
              )
              && this.turnPollNow() + 1000 < deadline
            ) {
              this.logDebug('turn_wait_continue', {
                threadId,
                turnId,
                pollCount,
                reason: sessionTaskCompleteNeedsMaterializationWait
                  ? 'session_task_materialization_wait'
                  : 'terminal_settle_wait',
                stableTerminalReadCount,
                terminalElapsedMs: this.turnPollNow() - firstTerminalWithoutOutputAt,
                terminalSettleMs,
              });
              await waitForReconciliation(1000);
              continue;
            }
          }
          if (sessionState.lastAgentMessage || sessionState.outputArtifacts.length > 0) {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'session_task_complete',
              markCompleted: true,
            });
            const result = buildSessionTaskCompleteResult({
              turnId,
              threadId,
              title: thread?.title ?? null,
              status: terminalResultStatus,
              previewText: resolveProgressPreviewText(progressState),
              sessionState,
            });
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          if (sessionState.hasTaskComplete) {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'session_task_complete',
              markCompleted: true,
            });
            const previewText = resolveTurnPreviewText(turn, progressState);
            if (!previewText && sessionState.runtimeError) {
              const result = {
                turnId,
                threadId,
                title: thread?.title ?? null,
                outputText: '',
                outputState: 'provider_error',
                previewText: '',
                finalSource: 'session_runtime_error',
                status: terminalResultStatus,
                errorMessage: sessionState.runtimeError,
              };
              this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
              return result;
            }
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText: '',
              outputState: previewText ? 'partial' : 'missing',
              previewText,
              finalSource: resolveProgressFinalSource(progressState, 'session_task_complete_empty'),
              status: terminalResultStatus,
            };
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          if (shouldWaitForTaskCompleteBeforeMissing(thread?.path ?? null, sessionState)) {
            if (this.turnPollNow() + 1000 < deadline) {
              this.logDebug('turn_wait_continue', {
                threadId,
                turnId,
                pollCount,
                reason: 'waiting_for_session_task_complete',
                sessionPath: legacyRolloutRecovery ? thread?.path ?? null : null,
              });
              await waitForReconciliation(1000);
              continue;
            }
            const previewText = resolveTurnPreviewText(turn, progressState);
            if (previewText) {
              const result = {
                turnId,
                threadId,
                title: thread?.title ?? null,
                outputText: '',
                outputState: 'partial',
                previewText,
                finalSource: resolveProgressFinalSource(progressState),
                status: turn.status,
              };
              this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
              return result;
            }
            this.logDebug('turn_wait_error', {
              threadId,
              turnId,
              pollCount,
              reason: 'task_complete_timeout_without_preview',
            });
            throw new Error(`Timed out waiting for Codex turn ${turnId}`);
          }
          if (hasUnsettledAssistantActivity(turn, progressState)) {
            if (this.turnPollNow() + 1000 < deadline) {
              this.logDebug('turn_wait_continue', {
                threadId,
                turnId,
                pollCount,
                reason: 'unsettled_assistant_activity',
                progress: summarizeProgressState(progressState),
              });
              await waitForReconciliation(1000);
              continue;
            }
            const previewText = resolveTurnPreviewText(turn, progressState);
            if (previewText) {
              const result = {
                turnId,
                threadId,
                title: thread?.title ?? null,
                outputText: '',
                outputState: 'partial',
                previewText,
                finalSource: resolveProgressFinalSource(progressState),
                status: turn.status,
              };
              this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
              return result;
            }
            this.logDebug('turn_wait_error', {
              threadId,
              turnId,
              pollCount,
              reason: 'assistant_activity_timeout_without_preview',
            });
            throw new Error(`Timed out waiting for Codex turn ${turnId}`);
          }
          const previewText = resolveTurnPreviewText(turn, progressState);
          const result = {
            turnId,
            threadId,
            title: thread?.title ?? null,
            outputText: '',
            outputState: previewText ? 'partial' : 'missing',
            previewText,
            finalSource: resolveProgressFinalSource(progressState),
            status: turn.status,
          };
          this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
          return result;
        }
        await waitForReconciliation(legacyRolloutRecovery ? 1000 : Math.min(30_000, 1000 * 2 ** Math.min(pollCount - 1, 5)));
      }
      if (!legacyRolloutRecovery) throw new AppServerObservationInterruptedError(`Timed out synchronizing Codex turn ${turnId}`);
      const previewText = resolveProgressPreviewText(progressState);
      if (previewText) {
        const result = {
          turnId,
          threadId,
          title: null,
          outputText: '',
          outputState: 'partial',
          previewText,
          finalSource: resolveProgressFinalSource(progressState),
          status: null,
        };
        this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
        return result;
      }
      this.logDebug('turn_wait_error', {
        threadId,
        turnId,
        pollCount,
        reason: 'overall_timeout_without_preview',
      });
      throw new Error(`Timed out waiting for Codex turn ${turnId}`);
    } finally {
      this.clearApprovedExecutionsForTurn({ threadId, turnId });
      this.off('notification', onNotification);
      this.off('approval_request', onApprovalEvent);
      this.off('observation_interrupted', onObservationInterrupted);
      wakeObservation?.();
    }
  }
}

function buildRuntimeEnvironmentConfig(runtimeEnv: Record<string, string | null>): Record<string, JsonValue> {
  const entries = Object.entries(runtimeEnv);
  if (entries.length === 0) {
    return {};
  }
  return {
    shell_environment_policy: {
      filters: Object.fromEntries(entries.map(([name]) => [name, 'exclude'])),
      set: Object.fromEntries(entries.filter((entry): entry is [string, string] => entry[1] !== null)),
    },
  };
}

function beginEarlyTurnEventCapture(
  client: CodexAppClient,
  threadId: string,
): EarlyTurnEventCapture {
  const captures = earlyTurnEventCapturesByClient.get(client) ?? new Set<EarlyTurnEventCapture>();
  earlyTurnEventCapturesByClient.set(client, captures);
  const capture: EarlyTurnEventCapture = {
    threadId,
    turnId: null,
    events: [],
    eventBytes: 0,
    onNotification: () => {},
    onApprovalRequest: () => {},
    stopped: false,
  };
  capture.onNotification = (notification: any) => {
    const notificationThreadId = extractThreadIdFromNotification(notification);
    const notificationTurnId = extractNotificationTurnId(notification?.params ?? null);
    if (
      notificationThreadId !== threadId
      && (notificationThreadId || !notificationTurnId)
    ) {
      return;
    }
    appendEarlyTurnEvent(capture, { type: 'notification', value: notification });
  };
  capture.onApprovalRequest = (request: ProviderApprovalRequest) => {
    if (request.threadId !== threadId) {
      return;
    }
    appendEarlyTurnEvent(capture, { type: 'approval_request', value: request });
  };
  captures.add(capture);
  client.on('notification', capture.onNotification);
  client.on('approval_request', capture.onApprovalRequest);
  return capture;
}

function stopEarlyTurnEventCapture(
  client: CodexAppClient,
  capture: EarlyTurnEventCapture,
): void {
  if (capture.stopped) {
    return;
  }
  capture.stopped = true;
  client.off('notification', capture.onNotification);
  client.off('approval_request', capture.onApprovalRequest);
  const captures = earlyTurnEventCapturesByClient.get(client);
  captures?.delete(capture);
  if (captures?.size === 0) {
    earlyTurnEventCapturesByClient.delete(client);
  }
}

function stopAllEarlyTurnEventCaptures(client: CodexAppClient): void {
  const captures = earlyTurnEventCapturesByClient.get(client);
  if (!captures) {
    return;
  }
  for (const capture of [...captures]) {
    stopEarlyTurnEventCapture(client, capture);
  }
}

function claimEarlyTurnEvents(
  client: CodexAppClient,
  threadId: string,
  turnId: string,
): BufferedTurnEvent[] {
  const captures = earlyTurnEventCapturesByClient.get(client);
  const capture = captures
    ? [...captures].find((entry) => entry.threadId === threadId && entry.turnId === turnId)
    : null;
  if (!capture) {
    return [];
  }
  stopEarlyTurnEventCapture(client, capture);
  const seen = new Set<unknown>();
  const events = capture.events.filter((event) => {
    if (seen.has(event.value)) {
      return false;
    }
    seen.add(event.value);
    if (event.type === 'approval_request') {
      return event.value.threadId === threadId
        && (!event.value.turnId || event.value.turnId === turnId);
    }
    const notificationThreadId = extractThreadIdFromNotification(event.value);
    const notificationTurnId = extractNotificationTurnId(event.value?.params ?? null);
    return (!notificationThreadId || notificationThreadId === threadId)
      && (!notificationTurnId || notificationTurnId === turnId);
  });
  capture.events = [];
  capture.eventBytes = 0;
  return events;
}

function appendEarlyTurnEvent(capture: EarlyTurnEventCapture, event: BufferedTurnEvent): void {
  const bytes = estimateBufferedTurnEventBytes(event);
  capture.events.push(event);
  capture.eventBytes += bytes;
  while (
    capture.events.length > MAX_EARLY_TURN_EVENTS
    || capture.eventBytes > MAX_EARLY_TURN_EVENT_BYTES
  ) {
    const removed = capture.events.shift();
    if (!removed) {
      break;
    }
    capture.eventBytes = Math.max(0, capture.eventBytes - estimateBufferedTurnEventBytes(removed));
  }
}

function estimateBufferedTurnEventBytes(event: BufferedTurnEvent): number {
  try {
    return Buffer.byteLength(JSON.stringify(event.value));
  } catch {
    return MAX_EARLY_TURN_EVENT_BYTES;
  }
}

function mapPendingApproval(message: any): PendingApproval | null {
  const rpcId = String(message?.id ?? '').trim();
  const method = String(message?.method ?? '').trim();
  if (!rpcId || !method) {
    return null;
  }
  const rpcResponseId = typeof message?.id === 'number' ? message.id : rpcId;
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return {
        rpcId,
        rpcResponseId,
        transportKind: 'v2_command',
        request: mapCommandExecutionApprovalRequest(rpcId, message.params),
      };
    case 'item/fileChange/requestApproval':
      return {
        rpcId,
        rpcResponseId,
        transportKind: 'v2_file_change',
        request: mapFileChangeApprovalRequest(rpcId, message.params),
      };
    case 'item/permissions/requestApproval':
      return {
        rpcId,
        rpcResponseId,
        transportKind: 'v2_permissions',
        request: mapPermissionsApprovalRequest(rpcId, message.params),
      };
    case 'execCommandApproval':
      return {
        rpcId,
        rpcResponseId,
        transportKind: 'legacy_exec',
        request: mapLegacyExecApprovalRequest(rpcId, message.params),
      };
    case 'applyPatchApproval':
      return {
        rpcId,
        rpcResponseId,
        transportKind: 'legacy_apply_patch',
        request: mapLegacyApplyPatchApprovalRequest(rpcId, message.params),
      };
    default:
      return null;
  }
}

function mapCommandExecutionApprovalRequest(requestId: string, params: any): ProviderApprovalRequest {
  return {
    requestId,
    kind: 'command',
    threadId: String(params?.threadId ?? ''),
    turnId: normalizeNullableString(params?.turnId),
    itemId: normalizeNullableString(params?.itemId),
    reason: normalizeNullableString(params?.reason),
    command: normalizeNullableString(params?.command),
    cwd: normalizeNullableString(params?.cwd),
    availableDecisionKeys: Array.isArray(params?.availableDecisions)
      ? params.availableDecisions.map(normalizeApprovalDecisionKey).filter(Boolean)
      : [],
    execPolicyAmendment: Array.isArray(params?.proposedExecpolicyAmendment)
      ? params.proposedExecpolicyAmendment
        .map((entry: unknown) => String(entry ?? '').trim())
        .filter(Boolean)
      : null,
    networkPermission: normalizeBoolean(params?.additionalPermissions?.network?.enabled),
    fileReadPermissions: normalizeStringList(params?.additionalPermissions?.fileSystem?.read),
    fileWritePermissions: normalizeStringList(params?.additionalPermissions?.fileSystem?.write),
  };
}

function mapFileChangeApprovalRequest(requestId: string, params: any): ProviderApprovalRequest {
  return {
    requestId,
    kind: 'file_change',
    threadId: String(params?.threadId ?? ''),
    turnId: normalizeNullableString(params?.turnId),
    itemId: normalizeNullableString(params?.itemId),
    reason: normalizeNullableString(params?.reason),
    grantRoot: normalizeNullableString(params?.grantRoot),
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
  };
}

function mapPermissionsApprovalRequest(requestId: string, params: any): ProviderApprovalRequest {
  return {
    requestId,
    kind: 'permissions',
    threadId: String(params?.threadId ?? ''),
    turnId: normalizeNullableString(params?.turnId),
    itemId: normalizeNullableString(params?.itemId),
    reason: normalizeNullableString(params?.reason),
    networkPermission: normalizeBoolean(params?.permissions?.network?.enabled),
    fileReadPermissions: normalizeStringList(params?.permissions?.fileSystem?.read),
    fileWritePermissions: normalizeStringList(params?.permissions?.fileSystem?.write),
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
  };
}

function mapLegacyExecApprovalRequest(requestId: string, params: any): ProviderApprovalRequest {
  return {
    requestId,
    kind: 'command',
    threadId: String(params?.conversationId ?? ''),
    turnId: null,
    itemId: normalizeNullableString(params?.approvalId) ?? normalizeNullableString(params?.callId),
    reason: normalizeNullableString(params?.reason),
    command: Array.isArray(params?.command)
      ? params.command.map((entry: unknown) => String(entry ?? '').trim()).filter(Boolean).join(' ')
      : null,
    cwd: normalizeNullableString(params?.cwd),
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
  };
}

function mapLegacyApplyPatchApprovalRequest(requestId: string, params: any): ProviderApprovalRequest {
  return {
    requestId,
    kind: 'file_change',
    threadId: String(params?.conversationId ?? ''),
    turnId: null,
    itemId: normalizeNullableString(params?.callId),
    reason: normalizeNullableString(params?.reason),
    fileChanges: params?.fileChanges && typeof params.fileChanges === 'object'
      ? Object.keys(params.fileChanges).filter(Boolean)
      : [],
    grantRoot: normalizeNullableString(params?.grantRoot),
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
  };
}

function buildApprovalResponseResult(pending: PendingApproval, option: 1 | 2 | 3): any {
  switch (pending.transportKind) {
    case 'v2_command':
      return {
        decision: buildV2CommandApprovalDecision(pending.request, option),
      };
    case 'v2_file_change':
      return {
        decision: buildV2FileChangeApprovalDecision(option),
      };
    case 'v2_permissions':
      return buildV2PermissionsApprovalDecision(pending.request, option);
    case 'legacy_exec':
    case 'legacy_apply_patch':
      return {
        decision: buildLegacyReviewDecision(option),
      };
    default:
      throw new Error(`Unsupported approval transport: ${pending.transportKind}`);
  }
}

function createApprovedExecution(
  pending: PendingApproval,
  option: 1 | 2 | 3,
  now: number,
): ApprovedExecution | null {
  if (option === 3) {
    return null;
  }
  return {
    requestId: pending.rpcId,
    kind: pending.request.kind,
    threadId: pending.request.threadId,
    turnId: pending.request.turnId,
    itemId: pending.request.itemId,
    command: pending.request.command ?? null,
    approvedAt: now,
    lastSignalAt: now,
    lastSignalKind: 'approval_response_sent',
    signalCount: 0,
    completedAt: null,
    lastObservedTurnSnapshotKey: null,
  };
}

function buildV2CommandApprovalDecision(request: ProviderApprovalRequest, option: 1 | 2 | 3): any {
  if (option === 1) {
    return 'accept';
  }
  if (option === 2) {
    if (
      request.execPolicyAmendment
      && request.execPolicyAmendment.length > 0
      && request.availableDecisionKeys?.includes('acceptWithExecpolicyAmendment')
    ) {
      return {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: request.execPolicyAmendment,
        },
      };
    }
    if (request.availableDecisionKeys?.includes('acceptForSession')) {
      return 'acceptForSession';
    }
    throw new Error('Current approval request does not support session-wide approval');
  }
  if (request.availableDecisionKeys?.includes('decline')) {
    return 'decline';
  }
  if (request.availableDecisionKeys?.includes('cancel')) {
    return 'cancel';
  }
  throw new Error('Current approval request does not support denial');
}

function buildV2FileChangeApprovalDecision(option: 1 | 2 | 3): string {
  if (option === 1) {
    return 'accept';
  }
  if (option === 2) {
    return 'acceptForSession';
  }
  return 'decline';
}

function buildV2PermissionsApprovalDecision(request: ProviderApprovalRequest, option: 1 | 2 | 3) {
  return {
    permissions: option === 3
      ? {}
      : {
        ...(request.networkPermission != null ? {
          network: {
            enabled: request.networkPermission,
          },
        } : {}),
        ...(request.fileReadPermissions?.length || request.fileWritePermissions?.length ? {
          fileSystem: {
            read: request.fileReadPermissions ?? [],
            write: request.fileWritePermissions ?? [],
          },
        } : {}),
      },
    scope: option === 2 ? 'session' : 'turn',
  };
}

function buildLegacyReviewDecision(option: 1 | 2 | 3): any {
  if (option === 1) {
    return 'approved';
  }
  if (option === 2) {
    return 'approved_for_session';
  }
  return 'denied';
}

function normalizeApprovalDecisionKey(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  const entries = Object.entries(value);
  if (entries.length !== 1) {
    return '';
  }
  return String(entries[0]?.[0] ?? '').trim();
}

function classifyApprovedExecutionSignal(method: unknown): string | null {
  const normalized = String(method ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  switch (normalized) {
    case 'itemstarted':
      return 'item_started';
    case 'itemcompleted':
      return 'item_completed';
    case 'threadstatuschanged':
      return 'thread_status_changed';
    case 'turnstarted':
      return 'turn_started';
    case 'turncompleted':
      return 'turn_completed';
    case 'serverrequestresolved':
      return 'server_request_resolved';
    default:
      return isAgentDeltaNotificationMethod(normalized) ? 'assistant_delta' : null;
  }
}

function isThreadLevelApprovedExecutionSignal(signalKind: string): boolean {
  return signalKind === 'thread_status_changed'
    || signalKind === 'turn_completed'
    || signalKind === 'server_request_resolved';
}

function summarizeApprovedExecution(entry: ApprovedExecution) {
  return {
    requestId: entry.requestId,
    kind: entry.kind,
    threadId: entry.threadId,
    turnId: entry.turnId,
    itemId: entry.itemId,
    commandPreview: truncateDebugText(entry.command, 120),
    approvedAt: entry.approvedAt,
    lastSignalAt: entry.lastSignalAt,
    lastSignalKind: entry.lastSignalKind,
    signalCount: entry.signalCount,
    completedAt: entry.completedAt,
  };
}

function summarizeApprovedExecutionSignal(entry: ApprovedExecution, signalKind: string) {
  return {
    requestId: entry.requestId,
    threadId: entry.threadId,
    turnId: entry.turnId,
    itemId: entry.itemId,
    signalKind,
    signalCount: entry.signalCount,
    commandPreview: truncateDebugText(entry.command, 120),
    completedAt: entry.completedAt,
  };
}

function normalizeConfigDefaults(value: any): ProviderConfigDefaults {
  const config = value?.config && typeof value.config === 'object' ? value.config : value;
  return {
    model: normalizeNullableString(config?.model) ?? normalizeNullableString(config?.thread?.model),
    reasoningEffort: normalizeNullableString(config?.reasoningEffort)
      ?? normalizeNullableString(config?.modelReasoningEffort)
      ?? normalizeNullableString(config?.model_reasoning_effort)
      ?? normalizeNullableString(config?.thread?.reasoningEffort),
  };
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    : [];
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function formatConfigKeyPath(segments: string[]): string {
  return segments
    .map((segment) => {
      const value = String(segment ?? '').trim();
      if (/^[A-Za-z0-9_]+$/u.test(value)) {
        return value;
      }
      return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
    })
    .join('.');
}

function serializeCollaborationMode({ collaborationMode, model, effort, developerInstructions = '' }: any) {
  const effectiveModel = normalizeNullableString(model);
  if (!collaborationMode || !effectiveModel) {
    return null;
  }
  const settings = {
    model: effectiveModel,
    reasoning_effort: normalizeNullableString(effort),
    developer_instructions: normalizeNullableString(developerInstructions),
  };
  if (collaborationMode === 'default') {
    return {
      mode: 'default',
      settings,
    };
  }
  return {
    mode: collaborationMode,
    settings,
  };
}

export function createNoopLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

export function createStderrLogger({
  envVar = 'CODEX_NATIVE_API_DEBUG',
}: {
  envVar?: string;
} = {}) {
  if (process.env[envVar] !== '1') {
    return createNoopLogger();
  }
  return {
    debug(message: string) {
      writeSequencedStderrLine(message);
    },
    info(message: string) {
      writeSequencedStderrLine(message);
    },
    warn(message: string) {
      writeSequencedStderrLine(message);
    },
    error(message: string) {
      writeSequencedStderrLine(message);
    },
  };
}

function normalizeFeatureList(features: string[]): string[] {
  const normalized = [];
  const seen = new Set<string>();
  for (const feature of features) {
    if (typeof feature !== 'string') {
      continue;
    }
    const value = feature.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function summarizeTurnInput(input: CodexTurnInput[]) {
  return input.map((item) => {
    if (item.type === 'text') {
      return {
        type: item.type,
        textPreview: truncateDebugText(item.text, 160),
      };
    }
    return {
      type: item.type,
      path: item.path,
    };
  });
}

function summarizeRpcParams(method: string, params: any) {
  switch (method) {
    case 'thread/goal/get':
    case 'thread/goal/clear':
    case 'thread/archive':
    case 'thread/unarchive':
      return {
        threadId: String(params?.threadId ?? ''),
      };
    case 'thread/goal/set':
      return {
        threadId: String(params?.threadId ?? ''),
        objective: typeof params?.objective === 'string' ? params.objective : null,
        status: typeof params?.status === 'string' ? params.status : null,
      };
    case 'thread/read':
      return {
        threadId: String(params?.threadId ?? ''),
        includeTurns: Boolean(params?.includeTurns),
      };
    case 'thread/start':
      return {
        cwd: params?.cwd ?? null,
        title: params?.title ?? null,
        model: params?.model ?? null,
        serviceTier: params?.serviceTier ?? null,
        sandbox: params?.sandbox ?? null,
        approvalPolicy: params?.approvalPolicy ?? null,
        ephemeral: params?.ephemeral ?? null,
      };
    case 'turn/start':
      return {
        threadId: String(params?.threadId ?? ''),
        cwd: params?.cwd ?? null,
        model: params?.model ?? null,
        serviceTier: params?.serviceTier ?? null,
        effort: params?.effort ?? null,
        approvalPolicy: params?.approvalPolicy ?? null,
        sandboxPolicy: params?.sandboxPolicy ?? null,
        collaborationMode: params?.collaborationMode?.mode ?? null,
        inputSummary: summarizeTurnInput(Array.isArray(params?.input) ? params.input : []),
      };
    case 'turn/steer':
      return {
        threadId: String(params?.threadId ?? ''),
        expectedTurnId: String(params?.expectedTurnId ?? ''),
        clientUserMessageId: typeof params?.clientUserMessageId === 'string'
          ? params.clientUserMessageId
          : null,
        inputSummary: summarizeTurnInput(Array.isArray(params?.input) ? params.input : []),
      };
    case 'turn/interrupt':
      return {
        threadId: String(params?.threadId ?? ''),
        turnId: String(params?.turnId ?? ''),
      };
    default:
      return summarizePlainObject(params);
  }
}

function summarizeRpcResult(method: string, result: any) {
  switch (method) {
    case 'thread/goal/get':
    case 'thread/goal/set':
      return mapThreadGoal(result?.goal ?? null);
    case 'thread/goal/clear':
      return {
        cleared: result?.cleared === true,
      };
    case 'thread/archive':
      return {};
    case 'thread/unarchive':
      return {
        threadId: String(result?.thread?.id ?? ''),
      };
    case 'thread/read':
      return summarizeThreadReadResult(result?.thread ?? null);
    case 'thread/start':
      return {
        threadId: String(result?.thread?.id ?? ''),
        cwd: result?.cwd ?? null,
      };
    case 'turn/start':
      return {
        turnId: String(result?.turn?.id ?? ''),
        status: String(result?.turn?.status ?? ''),
      };
    case 'turn/steer':
      return {
        turnId: String(result?.turnId ?? ''),
      };
    default:
      return summarizePlainObject(result);
  }
}

function summarizeNotificationMessage(message: any) {
  return {
    method: String(message?.method ?? ''),
    id: 'id' in (message ?? {}) ? String(message.id ?? '') : null,
    threadId: extractThreadIdFromNotification(message),
    turnId: extractNotificationTurnId(message?.params ?? null),
    itemId: extractItemId(message?.params ?? null),
    outputKind: typeof message?.params?.item?.output_kind === 'string'
      ? message.params.item.output_kind
      : null,
  };
}

function summarizeThreadReadResult(thread: any) {
  if (!thread) {
    return null;
  }
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  return {
    threadId: String(thread?.id ?? ''),
    title: typeof thread?.name === 'string' ? thread.name : null,
    path: typeof thread?.path === 'string' ? thread.path : null,
    turnCount: turns.length,
    turns: turns.slice(-3).map((turn) => summarizeTurnSnapshot(turn)),
  };
}

function mapThreadGoal(raw: any): ProviderThreadGoal | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const objective = typeof raw.objective === 'string' ? raw.objective.trim() : '';
  if (!objective) {
    return null;
  }
  return {
    threadId: String(raw.threadId ?? raw.thread_id ?? ''),
    objective,
    status: typeof raw.status === 'string' ? raw.status : 'active',
    tokenBudget: Number.isFinite(raw.tokenBudget) ? Number(raw.tokenBudget) : null,
    tokensUsed: Number.isFinite(raw.tokensUsed) ? Number(raw.tokensUsed) : null,
    timeUsedSeconds: Number.isFinite(raw.timeUsedSeconds) ? Number(raw.timeUsedSeconds) : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

function summarizeTurnSnapshot(turn: any) {
  if (!turn) {
    return null;
  }
  const items = Array.isArray(turn?.items) ? turn.items : [];
  return {
    id: String(turn?.id ?? ''),
    status: String(turn?.status ?? ''),
    itemCount: items.length,
    visibleItemCount: items.filter((item) => isAssistantVisibleItem(item) || isUserVisibleItem(item)).length,
    outputTextPresent: Boolean(extractTurnOutputText(turn)),
    outputArtifactCount: extractTurnOutputArtifacts(turn).length,
    error: typeof turn?.error === 'string' ? turn.error : null,
  };
}

function summarizeProgressState(progressState: Partial<ProgressState>) {
  return {
    commentaryLength: String(progressState?.commentaryText ?? '').length,
    reasoningSummaryLength: String(progressState?.reasoningSummaryText ?? '').length,
    finalAnswerLength: String(progressState?.finalAnswerText ?? '').length,
    sawAssistantActivity: Boolean(progressState?.sawAssistantActivity),
    lastAssistantActivityAt: progressState?.lastAssistantActivityAt ?? 0,
  };
}

function summarizeSessionState(
  sessionPath: string | null | undefined,
  sessionState: SessionTurnCompletionState,
) {
  return {
    sessionPath: sessionPath ?? null,
    hasTaskComplete: sessionState.hasTaskComplete,
    hasTurnAborted: sessionState.hasTurnAborted,
    lastAgentMessagePreview: truncateDebugText(sessionState.lastAgentMessage, 160),
    toolSuggestionPreview: truncateDebugText(sessionState.toolSuggestionMessage, 160),
    runtimeError: truncateDebugText(sessionState.runtimeError, 160),
    responseItemCount: sessionState.responseItems.length,
    responseItemTypes: sessionState.responseItems
      .map((item) => typeof item?.type === 'string' ? item.type : null)
      .filter((value): value is string => Boolean(value))
      .slice(0, 8),
    outputArtifactCount: sessionState.outputArtifacts.length,
    outputArtifacts: sessionState.outputArtifacts.map((artifact) => ({
      kind: artifact.kind ?? null,
      path: artifact.path ?? null,
    })),
  };
}

function summarizeTurnResultForDebug(result: ProviderTurnResult) {
  return {
    threadId: result.threadId ?? null,
    turnId: result.turnId ?? null,
    status: result.status ?? null,
    outputState: result.outputState ?? null,
    finalSource: result.finalSource ?? null,
    errorMessage: truncateDebugText(result.errorMessage, 160),
    outputTextPreview: truncateDebugText(result.outputText, 160),
    previewTextPreview: truncateDebugText(result.previewText, 160),
    responseItemCount: Array.isArray(result.responseItems) ? result.responseItems.length : 0,
    responseItemTypes: Array.isArray(result.responseItems)
      ? result.responseItems
        .map((item) => typeof item?.type === 'string' ? item.type : null)
        .filter((value): value is string => Boolean(value))
        .slice(0, 8)
      : [],
    outputArtifactCount: Array.isArray(result.outputArtifacts) ? result.outputArtifacts.length : 0,
    outputArtifacts: Array.isArray(result.outputArtifacts)
      ? result.outputArtifacts.map((artifact) => ({
        kind: artifact.kind ?? null,
        path: artifact.path ?? null,
        caption: truncateDebugText(artifact.caption, 120),
      }))
      : [],
  };
}

function summarizePlainObject(value: any) {
  if (!value || typeof value !== 'object') {
    return value ?? null;
  }
  const summary: Record<string, unknown> = {};
  Object.keys(value).slice(0, 12).forEach((key) => {
    const raw = value[key];
    if (raw == null || typeof raw === 'number' || typeof raw === 'boolean') {
      summary[key] = raw;
      return;
    }
    if (typeof raw === 'string') {
      summary[key] = truncateDebugText(raw, 120);
      return;
    }
    if (Array.isArray(raw)) {
      summary[key] = { length: raw.length };
      return;
    }
    summary[key] = { keys: Object.keys(raw).slice(0, 8) };
  });
  return summary;
}

function extractThreadIdFromNotification(message: any): string | null {
  const params = message?.params ?? null;
  if (typeof params?.threadId === 'string') {
    return params.threadId;
  }
  if (typeof params?.conversationId === 'string') {
    return params.conversationId;
  }
  if (typeof params?.item?.threadId === 'string') {
    return params.item.threadId;
  }
  if (typeof params?.event?.threadId === 'string') {
    return params.event.threadId;
  }
  return null;
}

function truncateDebugText(value: unknown, limit = 240): string {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text) {
    return '';
  }
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function mapThreadSummary(raw) {
  return {
    threadId: String(raw.id),
    title: raw.name ? String(raw.name) : null,
    cwd: raw.cwd ? String(raw.cwd) : null,
    updatedAt: normalizeTimestamp(raw.updatedAt),
    preview: typeof raw.preview === 'string' ? raw.preview : '',
    runtimeStatus: mapThreadRuntimeStatus(raw.status),
  };
}

function mapThread(raw, includeTurns) {
  return {
    threadId: String(raw.id),
    title: raw.name ? String(raw.name) : null,
    cwd: raw.cwd ? String(raw.cwd) : null,
    path: raw.path ? String(raw.path) : null,
    updatedAt: normalizeTimestamp(raw.updatedAt),
    preview: typeof raw.preview === 'string' ? raw.preview : '',
    turns: includeTurns && Array.isArray(raw.turns) ? raw.turns.map(mapTurn) : [],
    runtimeStatus: mapThreadRuntimeStatus(raw.status),
  };
}

function mapThreadRuntimeStatus(raw) {
  const type = normalizeNullableString(
    typeof raw === 'string' ? raw : raw?.type,
  );
  if (!type) {
    return null;
  }
  return {
    type,
    activeFlags: normalizeStringList(raw?.activeFlags),
  };
}

function normalizeTimestamp(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function mapTurn(raw) {
  return {
    id: String(raw?.id ?? ''),
    status: extractStructuredString(raw?.status),
    error: extractStructuredString(raw?.error),
    items: Array.isArray(raw?.items) ? raw.items.map(mapTurnItem) : [],
    startedAt: normalizeNullableTimestamp(raw?.startedAt),
    completedAt: normalizeNullableTimestamp(raw?.completedAt),
  };
}

function normalizeNullableTimestamp(value) {
  const timestamp = normalizeTimestamp(value);
  return timestamp > 0 ? timestamp : null;
}

function mapTurnItem(raw) {
  return {
    id: extractItemId(raw),
    type: typeof raw?.type === 'string' ? raw.type : 'unknown',
    role: typeof raw?.role === 'string' ? raw.role : null,
    phase: typeof raw?.phase === 'string' ? raw.phase : null,
    text: (isReasoningItem(raw) ? extractReasoningSummaryText(raw) : extractStructuredText(raw)) ?? '',
    savedPath: extractStructuredString(raw?.savedPath),
    result: extractStructuredString(raw?.result),
    raw: cloneTurnItemRaw(raw),
  };
}

function cloneTurnItemRaw(raw): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const cloned = cloneSessionResponseItem(raw);
  if (isReasoningItem(cloned)) {
    delete cloned.content;
  }
  return cloned;
}

function mapModel(raw) {
  const capabilities = raw?.capabilities && typeof raw.capabilities === 'object'
    ? raw.capabilities
    : null;
  const supportedReasoningEfforts = uniqueNormalizedStrings([
    ...normalizeReasoningEffortList(raw?.supportedReasoningEfforts),
    ...normalizeReasoningEffortList(raw?.supported_reasoning_efforts),
    ...normalizeReasoningEffortList(capabilities?.supportedReasoningEfforts),
    ...normalizeReasoningEffortList(capabilities?.supported_reasoning_efforts),
  ]);
  return {
    id: String(raw.id),
    model: String(raw.model),
    displayName: String(raw.displayName || raw.model),
    description: String(raw.description || ''),
    isDefault: Boolean(raw.isDefault),
    supportedReasoningEfforts,
    defaultReasoningEffort: normalizeNullableString(raw.defaultReasoningEffort)
      ?? normalizeNullableString(raw.default_reasoning_effort)
      ?? normalizeNullableString(capabilities?.defaultReasoningEffort)
      ?? normalizeNullableString(capabilities?.default_reasoning_effort),
  };
}

function normalizeReasoningEffortList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return normalizeNullableString(entry);
      }
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as Record<string, unknown>;
      return normalizeNullableString(record.reasoningEffort)
        ?? normalizeNullableString(record.reasoning_effort)
        ?? normalizeNullableString(record.id)
        ?? normalizeNullableString(record.name);
    })
    .filter((entry): entry is string => Boolean(entry));
}

function uniqueNormalizedStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeNullableString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function mapAppServerRateLimits(payload: CodexAppRateLimitsResponse | null | undefined): ProviderUsageReport | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const report: ProviderUsageReport = {
    provider: 'codex',
    accountId: null,
    userId: null,
    email: null,
    plan: null,
    buckets: [],
    credits: null,
  };
  const snapshots: CodexAppRateLimitSnapshot[] = [];
  if (payload.rateLimitsByLimitId && typeof payload.rateLimitsByLimitId === 'object') {
    const keys = Object.keys(payload.rateLimitsByLimitId).sort();
    for (const key of keys) {
      const snapshot = payload.rateLimitsByLimitId[key];
      if (snapshot && typeof snapshot === 'object') {
        snapshots.push(snapshot);
      }
    }
  } else if (payload.rateLimits && typeof payload.rateLimits === 'object') {
    if (payload.rateLimits.limitId || payload.rateLimits.primary || payload.rateLimits.secondary || payload.rateLimits.credits) {
      snapshots.push(payload.rateLimits);
    }
  }

  for (const snapshot of snapshots) {
    if (!report.plan && typeof snapshot.planType === 'string' && snapshot.planType.trim()) {
      report.plan = snapshot.planType.trim();
    }
    if (!report.credits && snapshot.credits && typeof snapshot.credits === 'object') {
      report.credits = {
        hasCredits: Boolean(snapshot.credits.hasCredits),
        unlimited: Boolean(snapshot.credits.unlimited),
        balance: typeof snapshot.credits.balance === 'string' && snapshot.credits.balance.trim()
          ? snapshot.credits.balance.trim()
          : null,
      };
    }
    const windows = appServerUsageWindows(snapshot);
    if (!windows.length) {
      continue;
    }
    const limitReached = windows.some((window) => window.usedPercent >= 100);
    report.buckets.push({
      name: appServerBucketName(snapshot),
      allowed: !limitReached,
      limitReached,
      windows,
    });
  }

  return report;
}

function mapSkillToolDependency(raw: CodexAppSkillToolDependency): ProviderSkillToolDependency | null {
  const type = normalizeNullableString(raw?.type);
  const value = normalizeNullableString(raw?.value);
  if (!type || !value) {
    return null;
  }
  return {
    type,
    value,
    command: normalizeNullableString(raw?.command),
    description: normalizeNullableString(raw?.description),
    transport: normalizeNullableString(raw?.transport),
    url: normalizeNullableString(raw?.url),
  };
}

function mapSkillMetadata(raw: CodexAppSkillMetadata): ProviderSkillInfo | null {
  const name = normalizeNullableString(raw?.name);
  const description = normalizeNullableString(raw?.description);
  const skillPath = normalizeNullableString(raw?.path);
  const scope = normalizeNullableString(raw?.scope);
  if (!name || !description || !skillPath || !scope) {
    return null;
  }
  const dependencies = Array.isArray(raw?.dependencies?.tools)
    ? raw.dependencies.tools.map(mapSkillToolDependency).filter(Boolean)
    : [];
  return {
    name,
    description,
    enabled: raw?.enabled !== false,
    path: skillPath,
    scope,
    shortDescription: normalizeNullableString(raw?.interface?.shortDescription)
      ?? normalizeNullableString(raw?.shortDescription),
    displayName: normalizeNullableString(raw?.interface?.displayName),
    defaultPrompt: normalizeNullableString(raw?.interface?.defaultPrompt),
    brandColor: normalizeNullableString(raw?.interface?.brandColor),
    dependencies,
  };
}

function mapSkillErrorInfo(raw: CodexAppSkillErrorInfo): ProviderSkillError | null {
  const skillPath = normalizeNullableString(raw?.path);
  const message = normalizeNullableString(raw?.message);
  if (!skillPath || !message) {
    return null;
  }
  return {
    path: skillPath,
    message,
  };
}

function mapPluginLoadError(raw: CodexAppMarketplaceLoadError): ProviderPluginLoadError | null {
  const marketplacePath = normalizeNullableString(raw?.marketplacePath);
  const message = normalizeNullableString(raw?.message);
  if (!marketplacePath || !message) {
    return null;
  }
  return {
    marketplacePath,
    message,
  };
}

function mapPluginMarketplace(raw: CodexAppPluginMarketplace): ProviderPluginMarketplace | null {
  const name = normalizeNullableString(raw?.name);
  if (!name) {
    return null;
  }
  return {
    name,
    path: normalizeNullableString(raw?.path),
    displayName: normalizeNullableString(raw?.interface?.displayName),
    plugins: Array.isArray(raw?.plugins)
      ? raw.plugins.map((plugin) => mapPluginSummary(plugin, {
        marketplaceName: name,
        marketplacePath: normalizeNullableString(raw?.path),
        marketplaceDisplayName: normalizeNullableString(raw?.interface?.displayName),
      })).filter(Boolean) as ProviderPluginSummary[]
      : [],
  };
}

function mapPluginSummary(
  raw: CodexAppPluginSummary | null | undefined,
  context: {
    marketplaceName?: string | null;
    marketplacePath?: string | null;
    marketplaceDisplayName?: string | null;
  } = {},
): ProviderPluginSummary | null {
  const id = normalizeNullableString(raw?.id);
  const name = normalizeNullableString(raw?.name);
  if (!id || !name) {
    return null;
  }
  const sourceType = normalizeNullableString((raw?.source as any)?.type);
  const defaultPrompts = Array.isArray(raw?.interface?.defaultPrompt)
    ? raw.interface.defaultPrompt.map((entry) => normalizeNullableString(entry)).filter(Boolean) as string[]
    : [];
  return {
    id,
    name,
    installed: raw?.installed !== false,
    enabled: raw?.enabled !== false,
    installPolicy: normalizeNullableString(raw?.installPolicy) ?? 'AVAILABLE',
    authPolicy: normalizeNullableString(raw?.authPolicy) ?? 'ON_USE',
    marketplaceName: normalizeNullableString(context.marketplaceName) ?? 'unknown',
    marketplacePath: normalizeNullableString(context.marketplacePath),
    marketplaceDisplayName: normalizeNullableString(context.marketplaceDisplayName),
    displayName: normalizeNullableString(raw?.interface?.displayName),
    shortDescription: normalizeNullableString(raw?.interface?.shortDescription),
    longDescription: normalizeNullableString(raw?.interface?.longDescription),
    category: normalizeNullableString(raw?.interface?.category),
    capabilities: Array.isArray(raw?.interface?.capabilities)
      ? raw.interface.capabilities.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : [],
    developerName: normalizeNullableString(raw?.interface?.developerName),
    brandColor: normalizeNullableString(raw?.interface?.brandColor),
    defaultPrompts,
    websiteUrl: normalizeNullableString(raw?.interface?.websiteUrl),
    sourceType,
    sourcePath: normalizeNullableString((raw?.source as any)?.path),
    sourceRemoteMarketplaceName: normalizeNullableString((raw?.source as any)?.marketplaceName),
  };
}

function mapPluginSkillSummary(raw: CodexAppPluginSkillSummary): ProviderPluginSkillSummary | null {
  const name = normalizeNullableString(raw?.name);
  const skillPath = normalizeNullableString(raw?.path);
  const description = normalizeNullableString(raw?.description);
  if (!name || !skillPath || !description) {
    return null;
  }
  return {
    name,
    path: skillPath,
    description,
    enabled: raw?.enabled !== false,
    shortDescription: normalizeNullableString(raw?.shortDescription),
    displayName: normalizeNullableString(raw?.interface?.displayName),
  };
}

function mapPluginAppSummary(raw: CodexAppPluginAppSummary): ProviderPluginAppSummary | null {
  const id = normalizeNullableString(raw?.id);
  const name = normalizeNullableString(raw?.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    needsAuth: Boolean(raw?.needsAuth),
    description: normalizeNullableString(raw?.description),
    installUrl: normalizeNullableString(raw?.installUrl),
  };
}

function mapPluginDetail(
  raw: CodexAppPluginDetail | null | undefined,
  fallback: {
    marketplaceName?: string | null;
    marketplacePath?: string | null;
  } = {},
): ProviderPluginDetail | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const summary = mapPluginSummary(raw.summary ?? null, {
    marketplaceName: normalizeNullableString(raw?.marketplaceName) ?? normalizeNullableString(fallback.marketplaceName),
    marketplacePath: normalizeNullableString(raw?.marketplacePath) ?? normalizeNullableString(fallback.marketplacePath),
  });
  if (!summary) {
    return null;
  }
  return {
    summary,
    marketplaceName: normalizeNullableString(raw?.marketplaceName) ?? summary.marketplaceName,
    marketplacePath: normalizeNullableString(raw?.marketplacePath) ?? summary.marketplacePath,
    description: normalizeNullableString(raw?.description),
    apps: Array.isArray(raw?.apps) ? raw.apps.map(mapPluginAppSummary).filter(Boolean) as ProviderPluginAppSummary[] : [],
    mcpServers: Array.isArray(raw?.mcpServers) ? raw.mcpServers.map((entry) => String(entry ?? '').trim()).filter(Boolean) : [],
    skills: Array.isArray(raw?.skills) ? raw.skills.map(mapPluginSkillSummary).filter(Boolean) as ProviderPluginSkillSummary[] : [],
  };
}

function mapAppInfo(raw: CodexAppInfo): ProviderAppInfo | null {
  const id = normalizeNullableString(raw?.id);
  const name = normalizeNullableString(raw?.name);
  if (!id || !name) {
    return null;
  }
  const categories = Array.isArray(raw?.appMetadata?.categories)
    ? raw.appMetadata.categories.map((entry) => normalizeNullableString(entry)).filter(Boolean) as string[]
    : [];
  return {
    id,
    name,
    description: normalizeNullableString(raw?.description),
    installUrl: normalizeNullableString(raw?.installUrl),
    isAccessible: Boolean(raw?.isAccessible),
    isEnabled: raw?.isEnabled !== false,
    pluginDisplayNames: Array.isArray(raw?.pluginDisplayNames)
      ? raw.pluginDisplayNames.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : [],
    categories,
    developer: normalizeNullableString(raw?.appMetadata?.developer)
      ?? normalizeNullableString(raw?.branding?.developer),
  };
}

function mapMcpServerStatus(raw: CodexAppMcpServerStatus): ProviderMcpServerStatus | null {
  const name = normalizeNullableString(raw?.name);
  if (!name) {
    return null;
  }
  return {
    name,
    isEnabled: raw?.isEnabled !== false,
    authStatus: normalizeNullableString(raw?.authStatus) ?? 'unsupported',
    toolCount: raw?.tools && typeof raw.tools === 'object' ? Object.keys(raw.tools).length : 0,
    resourceCount: Array.isArray(raw?.resources) ? raw.resources.length : 0,
    resourceTemplateCount: Array.isArray(raw?.resourceTemplates) ? raw.resourceTemplates.length : 0,
  };
}

function appServerBucketName(snapshot: CodexAppRateLimitSnapshot): string {
  if (typeof snapshot.limitName === 'string' && snapshot.limitName.trim()) {
    return snapshot.limitName.trim();
  }
  if (typeof snapshot.limitId === 'string' && snapshot.limitId.trim()) {
    return snapshot.limitId.trim();
  }
  return 'Rate limit';
}

function appServerUsageWindows(snapshot: CodexAppRateLimitSnapshot) {
  const windows = [] as Array<{
    name: string;
    usedPercent: number;
    windowSeconds: number;
    resetAfterSeconds: number;
    resetAtUnix: number;
  }>;
  if (snapshot.primary) {
    windows.push(appServerUsageWindow('Primary', snapshot.primary));
  }
  if (snapshot.secondary) {
    windows.push(appServerUsageWindow('Secondary', snapshot.secondary));
  }
  return windows;
}

function appServerUsageWindow(name: string, window: CodexAppRateLimitWindow) {
  const rawUsedPercent = Number(window?.usedPercent ?? 0);
  const usedPercent = Number.isFinite(rawUsedPercent)
    ? Math.max(0, Math.min(100, Math.round(rawUsedPercent)))
    : 0;
  const rawWindowMinutes = Number(window?.windowDurationMins ?? 0);
  const windowSeconds = Number.isFinite(rawWindowMinutes)
    ? Math.max(0, Math.round(rawWindowMinutes * 60))
    : 0;
  const resetAtUnix = Math.max(0, Math.floor(Number(window?.resetsAt ?? 0)));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const resetAfterSeconds = resetAtUnix > 0 ? Math.max(0, resetAtUnix - nowSeconds) : 0;
  return {
    name,
    usedPercent,
    windowSeconds,
    resetAfterSeconds,
    resetAtUnix,
  };
}

function mergeModelCatalog(baseModels, overlayModels) {
  if (overlayModels.length === 0) {
    return baseModels;
  }
  const overlayKeys = new Set(overlayModels.map((model) => model.model));
  const hasOverlayDefault = overlayModels.some((model) => model.isDefault);
  const merged = overlayModels.map((overlay) => {
    const base = baseModels.find((model) => model.model === overlay.model) ?? null;
    return {
      ...(base ?? {}),
      ...overlay,
      isDefault: overlay.isDefault || (!hasOverlayDefault && Boolean(base?.isDefault)),
    };
  });
  for (const base of baseModels) {
    if (!overlayKeys.has(base.model)) {
      merged.push({
        ...base,
        isDefault: hasOverlayDefault ? false : base.isDefault,
      });
    }
  }
  return merged;
}

function mapSandboxPolicy(mode): SandboxPolicy {
  if (mode === 'read-only') {
    return { type: 'readOnly' } as SandboxPolicy;
  }
  if (mode === 'danger-full-access') {
    return { type: 'dangerFullAccess' };
  }
  return { type: 'workspaceWrite' } as SandboxPolicy;
}

const TERMINAL_TURN_STATUS_KEYS = new Set([
  'completed',
  'complete',
  'succeeded',
  'success',
  'finished',
  'failed',
  'error',
  'timedout',
  'timeout',
  'interrupted',
  'cancelled',
  'canceled',
  'aborted',
]);

function normalizeTurnStatusKey(status) {
  return String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function isTurnTerminal(status) {
  const normalized = normalizeTurnStatusKey(status);
  return Boolean(normalized) && TERMINAL_TURN_STATUS_KEYS.has(normalized);
}

function isThreadMaterializationPendingError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /not materialized yet/i.test(message)
    || /includeTurns is unavailable before first user message/i.test(message)
    || /empty session file/i.test(message)
    || /rollout .* is empty/i.test(message)
    || /no rollout found for thread id/i.test(message)
    || /thread not loaded/i.test(message);
}

function isIncludeTurnsUnsupportedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /ephemeral threads do not support includeTurns/i.test(message);
}

function isListTurnsUnsupportedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /list_turns is not supported yet/i.test(message);
}

function isRequestTimeoutError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Timed out waiting for Codex JSON-RPC response to /i.test(message);
}

function isTerminalNotificationForThread(
  notification: any,
  threadId: string,
  turnId: string,
): boolean {
  if (extractThreadIdFromNotification(notification) !== threadId) {
    return false;
  }
  const method = String(notification?.method ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  if (method === 'turncompleted') {
    const notificationTurnId = extractNotificationTurnId(notification?.params ?? null);
    return !notificationTurnId || notificationTurnId === turnId;
  }
  if (method === 'itemcompleted') {
    const notificationTurnId = extractNotificationTurnId(notification?.params ?? null);
    return !notificationTurnId || notificationTurnId === turnId;
  }
  return false;
}

function isInterruptedTurnCompletionNotificationForThread(
  notification: any,
  threadId: string,
  turnId: string,
): boolean {
  if (extractThreadIdFromNotification(notification) !== threadId) {
    return false;
  }
  const method = String(notification?.method ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  if (method !== 'turncompleted') {
    return false;
  }
  const notificationTurnId = extractNotificationTurnId(notification?.params ?? null);
  if (notificationTurnId !== turnId) {
    return false;
  }
  return classifyTurnCompletionState({
    status: extractTurnCompletedNotificationStatus(notification),
  }) === 'interrupted';
}

function extractTurnCompletedNotificationStatus(notification: any): string | null {
  return extractStructuredString(notification?.params?.turn?.status)
    ?? extractStructuredString(notification?.params?.status);
}

function extractTurnErrorNotificationMessage(
  notification: any,
  {
    threadId,
    turnId,
  }: {
    threadId: string;
    turnId: string;
  },
): string | null {
  if (!notification || typeof notification.method !== 'string') {
    return null;
  }
  const normalizedMethod = notification.method.replace(/[^a-z]/gi, '').toLowerCase();
  if (normalizedMethod !== 'error') {
    return null;
  }
  const notificationThreadId = extractThreadIdFromNotification(notification);
  if (notificationThreadId && notificationThreadId !== threadId) {
    return null;
  }
  const params = notification.params ?? {};
  if (params.willRetry === true) return null;
  const notificationTurnId = extractNotificationTurnId(params);
  if (params.willRetry === false && (notificationThreadId !== threadId || notificationTurnId !== turnId)) return null;
  if (notificationTurnId && notificationTurnId !== turnId) {
    return null;
  }
  if (!notificationThreadId && !notificationTurnId) {
    return null;
  }
  const message = extractStructuredString(params?.error)
    ?? extractStructuredString(params?.message)
    ?? extractStructuredString(params?.details)
    ?? extractStructuredString(params)
    ?? 'Codex runtime reported an error';
  return isTransientTurnErrorNotificationMessage(message) ? null : message;
}

function isTransientTurnErrorNotificationMessage(message: string): boolean {
  return /^Reconnecting\.\.\. \d+\/\d+$/u.test(message.trim());
}

function computeTerminalSettleMs(timeoutMs) {
  const numericTimeout = Number(timeoutMs || 0);
  if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
    return 60_000;
  }
  return Math.min(60_000, Math.max(10_000, Math.floor(numericTimeout / 2)));
}

function computeApprovedExecutionIdleLimitMs(timeoutMs) {
  const numericTimeout = Number(timeoutMs || 0);
  if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
    return 300_000;
  }
  return Math.min(Math.max(180_000, Math.floor(numericTimeout / 3)), 300_000);
}

function buildApprovedExecutionStallError({
  entry,
  idleMs,
}: {
  entry: ApprovedExecution;
  idleMs: number;
}) {
  const idleSeconds = Math.max(1, Math.round(idleMs / 1000));
  const kindLabel = entry.kind === 'command'
    ? 'command'
    : entry.kind === 'file_change'
      ? 'file change'
      : 'permission grant';
  const commandSuffix = entry.command
    ? ` (${truncateDebugText(entry.command, 120)})`
    : '';
  if (entry.signalCount === 0) {
    return `Approval was accepted, but the approved ${kindLabel}${commandSuffix} produced no follow-up signal for ${idleSeconds} seconds. The provider may be stuck; use /retry to try again.`;
  }
  return `Approval was accepted, but the approved ${kindLabel}${commandSuffix} stopped making progress after ${entry.lastSignalKind} and stayed idle for ${idleSeconds} seconds. The provider may be stuck; use /retry to try again.`;
}

const INTERRUPTED_PATTERN = /interrupt|interrupted|cancel(?:led)?|aborted?|stopped by user|用户中断|已中断/i;

function classifyTurnCompletionState(turn) {
  const haystack = `${String(turn?.status ?? '')}\n${String(turn?.error ?? '')}`.trim();
  if (!haystack) {
    return 'unknown';
  }
  if (INTERRUPTED_PATTERN.test(haystack)) {
    return 'interrupted';
  }
  return 'other';
}

function extractTurnOutputText(turn) {
  return turn.items
    .filter((item) =>
      isAssistantVisibleItem(item)
      && classifyAgentOutput(extractAgentPhase(item), true) === 'final_answer')
    .map((item) => item.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function extractTurnCommentaryText(turn) {
  return turn.items
    .filter((item) =>
      isAssistantVisibleItem(item)
      && classifyAgentOutput(extractAgentPhase(item), true) !== 'final_answer')
    .map((item) => item.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function resolveTurnPreviewText(turn, progressState: Partial<ProgressState> = {}) {
  return resolveProgressPreviewText(progressState)
    || extractTurnCommentaryText(turn);
}

function resolveProgressPreviewText(progressState: Partial<ProgressState> = {}): string {
  return progressState.finalAnswerText
    || progressState.commentaryText
    || progressState.reasoningSummaryText
    || '';
}

function resolveProgressFinalSource(
  progressState: Partial<ProgressState> = {},
  fallback = 'none',
): string {
  if (progressState.finalAnswerText) {
    return 'progress_only';
  }
  if (progressState.commentaryText) {
    return 'commentary_only';
  }
  if (progressState.reasoningSummaryText) {
    return 'reasoning_summary_only';
  }
  return fallback;
}

function extractTurnOutputArtifacts(turn) {
  const seen = new Set<string>();
  return turn.items
    .flatMap((item) => extractOutputArtifactFromItem(item))
    .filter((item) => {
      const key = `${item.kind}:${item.path}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function extractOutputArtifactFromItem(item) {
  const savedPath = typeof item?.savedPath === 'string' ? item.savedPath.trim() : '';
  if (savedPath && fs.existsSync(savedPath)) {
    return [buildArtifactFromFilePath(savedPath)];
  }
  const result = typeof item?.result === 'string' ? item.result.trim() : '';
  if (result && isLocalFilePath(result) && fs.existsSync(result)) {
    return [buildArtifactFromFilePath(result)];
  }
  if (isRemoteImageUrl(result)) {
    return [{
      kind: 'image' as const,
      path: result,
      displayName: path.basename(new URL(result).pathname) || null,
      mimeType: inferMimeTypeFromPath(result),
      sizeBytes: null,
      caption: null,
      source: 'provider_native' as const,
      turnId: null,
    }];
  }
  if (String(item?.type ?? '') === 'imageGeneration') {
    const inlineImage = decodeInlineImagePayload(result);
    if (inlineImage) {
      const outputPath = materializeInlineImage(savedPath, inlineImage);
      if (outputPath) {
        return [buildArtifactFromFilePath(outputPath)];
      }
    }
  }
  return [];
}

function isLocalFilePath(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return false;
  }
  if (/^(?:https?:)?\/\//iu.test(normalized)) {
    return false;
  }
  if (/^data:/iu.test(normalized)) {
    return false;
  }
  return path.isAbsolute(normalized);
}

function extractAllAssistantVisibleText(turn) {
  return turn.items
    .filter((item) => isAssistantVisibleItem(item))
    .map((item) => item.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function isRemoteImageUrl(value) {
  return /^https?:\/\/\S+/iu.test(String(value ?? ''));
}

function decodeInlineImagePayload(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const dataUrlMatch = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/iu);
  const base64 = dataUrlMatch?.[2] ?? (looksLikeBase64Image(raw) ? raw : '');
  if (!base64) {
    return null;
  }
  try {
    const buffer = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function looksLikeBase64Image(value) {
  const normalized = String(value ?? '').replace(/\s+/g, '');
  if (!normalized || normalized.length < 64 || normalized.length % 4 !== 0) {
    return false;
  }
  return /^[A-Za-z0-9+/=]+$/u.test(normalized);
}

function materializeInlineImage(savedPath, buffer) {
  if (savedPath) {
    try {
      fs.mkdirSync(path.dirname(savedPath), { recursive: true });
      fs.writeFileSync(savedPath, buffer);
      return savedPath;
    } catch {
      return null;
    }
  }
  try {
    const fallbackPath = path.join(os.tmpdir(), `codex-native-api-inline-image-${Date.now()}.png`);
    fs.writeFileSync(fallbackPath, buffer);
    return fallbackPath;
  } catch {
    return null;
  }
}

function shouldWaitForTaskCompleteBeforeMissing(sessionPath, sessionState) {
  return Boolean(String(sessionPath ?? '').trim()) && !sessionState.hasTaskComplete;
}

function shouldWaitForSettledOutputAfterTerminalTurn(turn: any, progressState: Partial<ProgressState> = {}) {
  const visibleItems = turn.items.filter((item) => item.text);
  if (visibleItems.length === 0) {
    return true;
  }
  if (progressState.finalAnswerText || progressState.reasoningSummaryText) {
    return true;
  }
  return visibleItems.every((item) => {
    if (isUserVisibleItem(item)) {
      return true;
    }
    if (!isAssistantVisibleItem(item)) {
      return false;
    }
    return classifyAgentOutput(extractAgentPhase(item), true) !== 'final_answer';
  });
}

function hasUnsettledAssistantActivity(turn: any, progressState: Partial<ProgressState> = {}) {
  if (progressState.finalAnswerText) {
    return true;
  }
  if (
    progressState.commentaryText
    || progressState.reasoningSummaryText
    || progressState.sawAssistantActivity
  ) {
    return true;
  }
  return turn.items.some((item) => {
    if (!isAssistantVisibleItem(item)) {
      return false;
    }
    return classifyAgentOutput(extractAgentPhase(item), true) !== 'final_answer' && Boolean(item.text);
  });
}


function buildTurnSnapshotKey(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  return JSON.stringify({
    status: turn?.status ?? '',
    error: turn?.error ?? '',
    items: items.map((item) => ({
      type: item?.type ?? '',
      role: item?.role ?? '',
      phase: item?.phase ?? '',
      text: item?.text ?? '',
    })),
  });
}

function extractProgressUpdate(
  notification,
  turnId,
  itemOutputKinds,
  progressState,
): ProviderTurnProgress | null {
  if (!notification || typeof notification.method !== 'string') {
    return null;
  }
  const params = notification.params ?? {};
  const notificationTurnId = extractNotificationTurnId(params);
  if (!notificationTurnId || notificationTurnId !== turnId) {
    return null;
  }
  const method = notification.method;
  if (method === 'item/started' || method === 'item/completed') {
    const item = params?.item ?? params;
    if (!isAssistantVisibleItem(item) && !isReasoningItem(item)) {
      return null;
    }
    const itemId = extractItemId(item) ?? extractItemId(params);
    const outputKind = isReasoningItem(item)
      ? 'reasoning_summary'
      : resolveLifecycleOutputKind(item, itemId, itemOutputKinds, method === 'item/completed');
    if (itemId) {
      itemOutputKinds.set(itemId, outputKind);
    }
    const state = getProgressItemState(progressState, itemId, outputKind);
    const itemText = isReasoningItem(item)
      ? extractReasoningSummaryText(item)
      : extractCompletedAgentText(params);
    return buildProgressUpdate({
      state,
      nextText: itemText ?? state.text,
      outputKind,
      itemId,
      eventType: method === 'item/started' ? 'started' : 'completed',
      emitEmpty: true,
    });
  }
  if (isReasoningSummaryDeltaNotificationMethod(method)) {
    const delta = extractNotificationDelta(params);
    if (!delta) {
      return null;
    }
    const itemId = extractItemId(params);
    const state = getProgressItemState(progressState, itemId, 'reasoning_summary');
    const summaryIndex = normalizeSummaryIndex(params?.summaryIndex);
    const summaryParts = state.reasoningSummaryParts ?? new Map<number, string>();
    const previousText = state.text;
    summaryParts.set(summaryIndex, `${summaryParts.get(summaryIndex) ?? ''}${delta}`);
    state.reasoningSummaryParts = summaryParts;
    state.text = [...summaryParts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, text]) => text)
      .join('\n\n');
    state.outputKind = 'reasoning_summary';
    return {
      itemId,
      eventType: 'delta',
      text: state.text,
      delta: state.text.startsWith(previousText) ? state.text.slice(previousText.length) : '',
      outputKind: 'reasoning_summary',
    };
  }
  if (!isAgentDeltaNotificationMethod(method)) {
    return null;
  }
  const delta = extractNotificationDelta(params);
  if (!delta) {
    return null;
  }
  const itemId = extractItemId(params);
  const outputKind = resolveNotificationOutputKind(params, itemId, itemOutputKinds);
  const state = getProgressItemState(progressState, itemId, outputKind);
  return buildProgressUpdate({
    state,
    nextText: `${state.text}${delta}`,
    outputKind,
    itemId,
    eventType: 'delta',
  });
}

function extractWorkEventUpdate(
  notification,
  {
    threadId,
    turnId,
    workOutputTexts,
    startedWorkEvents,
  }: {
    threadId: string;
    turnId: string;
    workOutputTexts: Map<string, string>;
    startedWorkEvents: Map<string, ProviderTurnWorkEvent>;
  },
): ProviderTurnWorkEvent | null {
  if (!notification || typeof notification.method !== 'string') {
    return null;
  }
  const params = notification.params ?? {};
  const notificationTurnId = extractNotificationTurnId(params);
  if (notificationTurnId && notificationTurnId !== turnId) {
    return null;
  }
  if (!notificationTurnId) {
    const notificationThreadId = extractThreadIdFromNotification(notification);
    if (notificationThreadId && notificationThreadId !== threadId) {
      return null;
    }
    if (!notificationThreadId) {
      return null;
    }
  }
  if (isAssistantVisibleItem(params?.item ?? params) || isUserVisibleItem(params?.item ?? params)) {
    return null;
  }
  const method = notification.method;
  if (method === 'item/started' || method === 'item/completed') {
    const item = params?.item ?? params;
    if (isAssistantVisibleItem(item) || isUserVisibleItem(item)) {
      return null;
    }
    const itemType = normalizeEventItemType(item);
    const responseToolItem = itemType === 'functioncall'
      || itemType === 'customtoolcall'
      || itemType === 'functioncalloutput'
      || itemType === 'customtoolcalloutput';
    const itemId = responseToolItem
      ? extractToolCallCorrelationId(item, params)
      : extractItemId(item) ?? extractItemId(params);
    if (!itemId) {
      return null;
    }
    const summary = boundCommandWorkSummary(buildWorkSummary(item, params));
    const previous = startedWorkEvents.get(itemId);
    const kind = previous?.kind ?? classifyWorkEventKind(item, params);
    if (kind === 'command') {
      const output = typeof summary.output === 'string' ? summary.output : null;
      if (output !== null) {
        workOutputTexts.set(itemId, truncateWorkText(output, MAX_WORK_STREAM_BYTES));
      } else if (method === 'item/completed' && workOutputTexts.has(itemId)) {
        summary.output = workOutputTexts.get(itemId)!;
      }
    }
    if (kind === 'unknown' && Object.keys(summary).length === 0) {
      return null;
    }
    const event: ProviderTurnWorkEvent = {
      type: method === 'item/started' ? 'started' : 'completed',
      itemId,
      kind,
      title: previous?.title ?? buildWorkTitle(kind, item, summary),
      status: normalizeNullableString(item?.status ?? params?.status),
      summary,
      raw: notification,
    };
    if (event.type === 'started') {
      startedWorkEvents.set(itemId, { ...event, summary: undefined, raw: undefined });
    } else {
      startedWorkEvents.delete(itemId);
      workOutputTexts.delete(itemId);
    }
    return event;
  }
  if (method === 'item/fileChange/patchUpdated') {
    const itemId = extractItemId(params);
    const fileChanges = extractFileChangesValue(params);
    if (!itemId || fileChanges.length === 0) {
      return null;
    }
    return {
      type: 'updated',
      itemId,
      kind: 'file_change',
      title: buildWorkTitle('file_change', params, { fileChanges }),
      status: normalizeNullableString(params?.status),
      summary: { fileChanges },
      raw: notification,
    };
  }
  if (
    method === 'item/commandExecution/outputDelta'
    || method === 'codex/event/exec_command_output_delta'
  ) {
    const itemId = extractItemId(params);
    const delta = extractNotificationDelta(params)
      ?? normalizeNullableString(params?.chunk)
      ?? normalizeNullableString(params?.output);
    if (!itemId || !delta) {
      return null;
    }
    const output = truncateWorkText(
      `${workOutputTexts.get(itemId) ?? ''}${delta}`,
      MAX_WORK_STREAM_BYTES,
    );
    workOutputTexts.set(itemId, output);
    return {
      type: 'updated',
      itemId,
      kind: 'command',
      summary: { outputDelta: truncateWorkText(delta, MAX_WORK_DELTA_BYTES) },
      raw: notification,
    };
  }
  return null;
}

function boundCommandWorkSummary(summary: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['output', 'stdout', 'stderr'] as const) {
    if (typeof summary[key] === 'string') {
      summary[key] = truncateWorkText(summary[key], MAX_WORK_STREAM_BYTES);
    }
    const deltaKey = `${key}Delta`;
    if (typeof summary[deltaKey] === 'string') {
      summary[deltaKey] = truncateWorkText(summary[deltaKey], MAX_WORK_DELTA_BYTES);
    }
  }
  return summary;
}

function truncateWorkText(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) {
    return value;
  }
  const marker = '\n...[truncated]...\n';
  const contentBudget = Math.max(0, maxBytes - Buffer.byteLength(marker));
  const head = sliceWorkTextByBytes(value, Math.floor(contentBudget * 0.6), false);
  const tail = sliceWorkTextByBytes(value, Math.ceil(contentBudget * 0.4), true);
  return `${head}${marker}${tail}`;
}

function sliceWorkTextByBytes(value: string, maxBytes: number, fromEnd: boolean): string {
  let low = 0;
  let high = value.length;
  while (low < high) {
    const length = Math.ceil((low + high) / 2);
    const candidate = fromEnd ? value.slice(value.length - length) : value.slice(0, length);
    if (Buffer.byteLength(candidate) <= maxBytes) {
      low = length;
    } else {
      high = length - 1;
    }
  }
  return fromEnd ? value.slice(value.length - low) : value.slice(0, low);
}

function emitWorkEventsFromTurnSnapshot({
  turn,
  onWorkEvent,
  emittedKeys,
}: {
  turn: any;
  onWorkEvent?: ((event: ProviderTurnWorkEvent) => Promise<void> | void) | null;
  emittedKeys: Set<string>;
}): void {
  if (typeof onWorkEvent !== 'function') {
    return;
  }
  for (const event of extractWorkEventsFromTurnSnapshot(turn)) {
    const key = buildWorkEventEmissionKey(event);
    if (emittedKeys.has(key)) {
      continue;
    }
    emittedKeys.add(key);
    void onWorkEvent(event);
  }
}

function extractWorkEventsFromTurnSnapshot(turn: any): ProviderTurnWorkEvent[] {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  return extractWorkEventsFromResponseItems(items.map((item) => (
    item?.raw && typeof item.raw === 'object' ? item.raw : item
  )));
}

function turnHasNativeWorkItems(turn: any): boolean {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  return items.some((item) => {
    const raw = item?.raw && typeof item.raw === 'object' ? item.raw : item;
    const type = normalizeEventItemType(raw);
    return type === 'commandexecution' || type === 'filechange';
  });
}

function turnHasWorkActivityItems(turn: any): boolean {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  return items.some((item) => {
    const raw = item?.raw && typeof item.raw === 'object' ? item.raw : item;
    return [
      'commandexecution',
      'filechange',
      'functioncall',
      'customtoolcall',
      'functioncalloutput',
      'customtoolcalloutput',
    ].includes(normalizeEventItemType(raw));
  });
}

function extractNotificationTurnId(params) {
  const direct = typeof params?.turnId === 'string' ? params.turnId : null;
  if (direct) {
    return direct;
  }
  const nested = typeof params?.item?.turnId === 'string' ? params.item.turnId : null;
  if (nested) {
    return nested;
  }
  const turn = typeof params?.turn?.id === 'string' ? params.turn.id : null;
  if (turn) {
    return turn;
  }
  return typeof params?.event?.turnId === 'string' ? params.event.turnId : null;
}

function extractNotificationDelta(params) {
  if (typeof params?.delta === 'string' && params.delta) {
    return params.delta;
  }
  if (typeof params?.text === 'string' && params.text) {
    return params.text;
  }
  if (typeof params?.item?.delta === 'string' && params.item.delta) {
    return params.item.delta;
  }
  return null;
}

function extractNotificationPhase(params) {
  if (typeof params?.phase === 'string') {
    return params.phase;
  }
  if (typeof params?.item?.phase === 'string') {
    return params.item.phase;
  }
  return null;
}

function resolveNotificationOutputKind(params, itemId, itemOutputKinds) {
  const explicit = classifyAgentOutput(extractNotificationPhase(params), false);
  if (explicit === 'final_answer') {
    return explicit;
  }
  if (itemId && itemOutputKinds.has(itemId)) {
    return itemOutputKinds.get(itemId);
  }
  return explicit;
}

function resolveLifecycleOutputKind(item, itemId, itemOutputKinds, completed) {
  const phase = extractAgentPhase(item);
  if (!phase && !completed && itemId && itemOutputKinds.has(itemId)) {
    return itemOutputKinds.get(itemId);
  }
  return classifyAgentOutput(phase, completed);
}

function getProgressItemState(
  progressState: ProgressState,
  itemId: string | null,
  outputKind: string,
): ProgressItemState {
  const key = itemId ?? `anonymous:${outputKind}`;
  const existing = progressState.items.get(key);
  if (existing) {
    existing.outputKind = outputKind;
    return existing;
  }
  const state: ProgressItemState = {
    text: '',
    outputKind,
    reasoningSummaryParts: null,
  };
  progressState.items.set(key, state);
  return state;
}

function buildProgressUpdate({
  state,
  nextText,
  outputKind,
  itemId,
  eventType,
  emitEmpty = false,
}: {
  state: ProgressItemState;
  nextText: unknown;
  outputKind: string;
  itemId: string | null;
  eventType: 'started' | 'delta' | 'completed';
  emitEmpty?: boolean;
}): ProviderTurnProgress | null {
  const normalizedNextText = String(nextText ?? '');
  if (!normalizedNextText && !emitEmpty) {
    return null;
  }
  const previous = state.text;
  const delta = normalizedNextText.startsWith(previous)
    ? normalizedNextText.slice(previous.length)
    : previous
      ? ''
      : normalizedNextText;
  if (!delta && !emitEmpty) {
    return null;
  }
  state.text = normalizedNextText;
  state.outputKind = outputKind;
  return {
    itemId,
    eventType,
    text: normalizedNextText,
    delta,
    outputKind,
  };
}

function classifyAgentOutput(phase, completed) {
  if (!phase) {
    return completed ? 'final_answer' : 'commentary';
  }
  const normalized = phase.replace(/[^a-z]/gi, '').toLowerCase();
  if (
    normalized === 'final'
    || normalized === 'answer'
    || normalized === 'response'
    || normalized === 'finalanswer'
    || normalized === 'finalresponse'
  ) {
    return 'final_answer';
  }
  return 'commentary';
}

function isAgentDeltaNotificationMethod(method) {
  const normalized = String(method ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  return normalized === 'itemagentmessagedelta'
    || normalized === 'itemassistantmessagedelta'
    || normalized === 'itemmessagedelta';
}

function isReasoningSummaryDeltaNotificationMethod(method) {
  const normalized = String(method ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  return normalized === 'itemreasoningsummarytextdelta';
}

function normalizeSummaryIndex(value): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function extractAgentPhase(value) {
  const candidates = [value?.phase, value?.item?.phase];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }
  return null;
}

function isReasoningItem(item) {
  return normalizeEventItemType(item) === 'reasoning';
}

function extractReasoningSummaryText(item): string {
  const summary = Array.isArray(item?.summary) ? item.summary : [];
  return summary
    .map((entry) => extractStructuredString(entry))
    .filter((entry): entry is string => Boolean(entry))
    .join('\n\n');
}

function extractCompletedAgentText(params) {
  if (typeof params?.text === 'string' && params.text) {
    return params.text;
  }
  if (typeof params?.item?.text === 'string' && params.item.text) {
    return params.item.text;
  }
  return null;
}

function extractStructuredText(value) {
  const directText = extractTextCandidate(value?.text)
    ?? extractTextCandidate(value?.content)
    ?? extractTextCandidate(value?.message)
    ?? extractTextCandidate(value?.value);
  return directText ?? extractTextCandidate(value);
}


export { readCodexAccountIdentity };
