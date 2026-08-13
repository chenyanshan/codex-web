import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { constants as fsConstants, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { Socket } from 'node:net';
import path from 'node:path';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import {
  canCreateProjectSession,
  effectiveProjectGrant,
  canReadAppSession,
  canWriteAppSession,
  localAdminPrincipal,
  type CodexWebPrincipal,
} from './access_control.js';
import type { PublicAuthSession } from './auth_store.js';
import type { CodexWebConfig } from './config.js';
import type { CodexWebEventReplay, CodexWebStoredEvent } from './event_bus.js';
import { retainedEventSize } from './event_memory.js';
import { presentCodexWebEvent, type CodexWebEventAudience } from './event_model.js';
import {
  projectDisplayNameKey,
  type CodexWebAppSession,
  type CodexWebIdentityState,
  type CodexWebProject,
  type CodexWebRole,
  type CodexWebShare,
  type CodexWebUser,
  type CodexWebWebhookCredential,
  type FileIdentityStore,
} from './identity_store.js';
import { FileReportStore } from './report_store.js';
import type { CodexWebReport } from './report_store.js';
import {
  FileSessionFileStore,
  SessionFileBusyError,
  SessionFileNotFoundError,
  SessionFileTooLargeError,
  type CodexWebSessionFile,
  type CodexWebSessionFileContent,
  type CodexWebSessionFileScope,
} from './session_file_store.js';
import {
  FileSessionSubmissionStore,
  hashSessionSubmissionPayload,
  type CodexWebSessionSubmissionPayload,
  type CodexWebSessionSubmissionRecord,
} from './session_submission_store.js';
import {
  InvalidSessionListCursorError,
  paginateSessionList,
} from './session_list_page.js';
import {
  FileWebhookConversationStore,
  hashWebhookConversationKey,
  type CodexWebWebhookConversation,
} from './webhook_conversation_store.js';
import {
  isCodexWebSlashCommandText,
  summarizeCodexWebSessionInputText,
  type AppendSessionTimelineEntryInput,
  type CodexWebRuntime,
  type CodexWebSession,
  type CodexWebStartTurnResult,
  type CreateSessionInput,
  type StartTurnInput,
  type UpdateSessionSettingsInput,
} from './runtime.js';
import {
  ManagedStorageQuotaError,
  maintainManagedStateStorage,
  withManagedStateStorageCapacity,
  withProjectUploadCapacity,
} from './storage_governance.js';
import {
  hashWebhookRequestFingerprint,
  normalizeWebhookClientRequestId,
  projectWebhookTurnStatus,
  webhookTurnNeedsFinalSync,
  webhookSubmissionId,
  type WebhookDeliveryMode,
} from './webhook_submission.js';

export interface CodexWebAuthLike {
  isConfigured(): Promise<boolean>;
  login(args: {
    username?: string | null;
    password: string;
    deviceName?: string | null;
  }): Promise<{ token: string; session: PublicAuthSession; configuredNow: boolean }>;
  verifyToken(token: string | null | undefined): Promise<PublicAuthSession | null>;
  logout(token: string | null | undefined): Promise<void>;
  setMultiUserEnabled?(enabled: boolean): Promise<CodexWebIdentityState>;
}

export interface CreateCodexWebServerOptions {
  auth: CodexWebAuthLike;
  runtime: CodexWebRuntime;
  config: CodexWebConfig;
  identityStore?: CodexWebIdentityStoreLike | null;
  sessionFileStore?: FileSessionFileStore;
  sessionSubmissionStore?: FileSessionSubmissionStore;
  webhookConversationStore?: FileWebhookConversationStore;
  staticFiles?: StaticFilesRecord;
}

export interface CodexWebServerHandle {
  baseUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface AuthenticatedRequestContext {
  token: string;
  session: PublicAuthSession;
}

interface CodexWebWebhookCredentialResult {
  credential: CodexWebWebhookCredential | null;
  key: string | null;
}

interface CodexWebIdentityStoreLike {
  readState(): Promise<CodexWebIdentityState>;
  setMultiUserEnabled?(enabled: boolean): Promise<CodexWebIdentityState>;
  setSiteTitle?(siteTitle: string): Promise<CodexWebIdentityState>;
  ensureBootstrapAdminFromPasswordHash?: FileIdentityStore['ensureBootstrapAdminFromPasswordHash'];
  upsertProject?: FileIdentityStore['upsertProject'];
  upsertRole?(role: CodexWebRole): Promise<CodexWebRole>;
  upsertUserWithPassword?(input: {
    id?: string;
    username: string;
    email?: string;
    password: string;
    enabled?: boolean;
    canNewSession?: boolean;
    roleIds?: string[];
    directProjectGrants?: any[];
  }): Promise<CodexWebUser>;
  updateUserAccess?(input: {
    id: string;
    email?: string;
    enabled?: boolean;
    canNewSession?: boolean;
    roleIds?: string[];
    directProjectGrants?: any[];
  }): Promise<CodexWebUser>;
  deleteUser?(userId: string): Promise<void>;
  updateUserProjectFavorite?(input: { userId: string; projectId: string; favorite: boolean }): Promise<CodexWebUser>;
  upsertSession(session: CodexWebAppSession): Promise<CodexWebAppSession>;
  deleteSession?(sessionId: string): Promise<void>;
  createShare?(args: { sessionId: string; createdByUserId: string; ttlSeconds?: number }): ReturnType<FileIdentityStore['createShare']>;
  revokeShare?(shareId: string, revokedAt?: string): Promise<CodexWebShare | null>;
  findShareByToken?(token: string): Promise<string | null>;
  getWebhookCredential?(ownerUserId: string): Promise<CodexWebWebhookCredential | null>;
  setWebhookEnabled?(ownerUserId: string, enabled: boolean): Promise<CodexWebWebhookCredentialResult>;
  rotateWebhookKey?(ownerUserId: string): Promise<CodexWebWebhookCredentialResult>;
  findWebhookCredentialByToken?(token: string): Promise<CodexWebWebhookCredential | null>;
}

type ArchiveCapableRuntime = CodexWebRuntime & {
  unarchiveSession?: (sessionId: string) => Promise<CodexWebSession | null>;
  isSessionArchived?: (sessionId: string) => boolean | Promise<boolean>;
};

const SETUP_REQUIRED_MESSAGE = 'Password not configured. Run codex-web auth set-password.';
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_UPLOAD_BODY_BYTES = 32 * 1024 * 1024;
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;
const LOGIN_RATE_LIMIT_PER_CLIENT = 10;
const LOGIN_RATE_LIMIT_GLOBAL = 100;
const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;
const WEBHOOK_RATE_LIMIT_PER_KEY = 10;
const WEBHOOK_RATE_LIMIT_GLOBAL = 100;
const WEBHOOK_STATUS_RATE_LIMIT_PER_KEY = 120;
const WEBHOOK_STATUS_RATE_LIMIT_GLOBAL = 1_000;
const WEBHOOK_STATUS_SYNC_MAX_ATTEMPTS = 3;
const WEBHOOK_STATUS_SYNC_MAX_ENTRIES = 10_000;
const WEBHOOK_ENDPOINT_PATH = '/api/webhook';
const LEGACY_WEBHOOK_SUBMISSION_ID_PATTERN = /^webhook:([0-9a-f]{64})$/u;
const BUILD_ID_PLACEHOLDER = '__CODEX_WEB_BUILD_ID__';
const DEFAULT_SITE_TITLE = 'Codex Web';
const STATIC_IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const APP_SHELL_CACHE_CONTROL = 'public, max-age=0, stale-while-revalidate=86400';
const COMPRESSION_MIN_BYTES = 256;
const DEFAULT_STATIC_SOURCE_FILES = [
  'index.html',
  'app.js',
  'styles.css',
  'theme-init.js',
  'pwa-pull-refresh.js',
  'ui-copy.js',
  'ui-kit.js',
  'attachment-utils.js',
  'markdown-renderer.js',
  'admin-ui.js',
  'session-pagination.js',
  'manifest.webmanifest',
  'service-worker.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
] as const;
type StaticFileAsset = {
  body: string | Buffer;
  contentType: string;
  buildId?: string;
  cacheControl?: string;
  immutableWhenVersioned?: boolean;
};
type StaticFileEntry = StaticFileAsset | (() => StaticFileAsset);
type StaticFilesRecord = Record<string, StaticFileEntry>;

interface ParsedUploadFile {
  fileName: string;
  mimeType: string | null;
  data: Buffer;
}

interface StoredUploadAttachment {
  id: string;
  kind: 'image' | 'file';
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  storage: 'project' | 'state';
  localPath: string;
  displayPath: string;
}

export function createCodexWebServer({
  auth,
  runtime,
  config,
  identityStore = null,
  sessionFileStore: providedSessionFileStore,
  sessionSubmissionStore: providedSessionSubmissionStore,
  webhookConversationStore: providedWebhookConversationStore,
  staticFiles,
}: CreateCodexWebServerOptions): CodexWebServerHandle {
  const resolvedStaticFiles = staticFiles ?? loadDefaultStaticFiles();
  const activeSseClosers = new Set<() => void>();
  const sockets = new Set<Socket>();
  const loginRateLimiter = new FixedWindowRateLimiter({
    windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
    perClientLimit: LOGIN_RATE_LIMIT_PER_CLIENT,
    globalLimit: LOGIN_RATE_LIMIT_GLOBAL,
  });
  const webhookRateLimiter = new FixedWindowRateLimiter({
    windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
    perClientLimit: WEBHOOK_RATE_LIMIT_PER_KEY,
    globalLimit: WEBHOOK_RATE_LIMIT_GLOBAL,
  });
  const webhookStatusRateLimiter = new FixedWindowRateLimiter({
    windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
    perClientLimit: WEBHOOK_STATUS_RATE_LIMIT_PER_KEY,
    globalLimit: WEBHOOK_STATUS_RATE_LIMIT_GLOBAL,
  });
  const sessionFileStore = providedSessionFileStore ?? new FileSessionFileStore();
  const sessionSubmissionStore = providedSessionSubmissionStore ?? new FileSessionSubmissionStore({
    stateDir: config.stateDir,
  });
  const webhookConversationStore = providedWebhookConversationStore ?? new FileWebhookConversationStore({
    stateDir: config.stateDir,
  });
  const sessionSubmissionOperations = new Map<string, Promise<SessionSubmissionExecution>>();
  const webhookStatusSyncAttempts = new Map<string, WebhookStatusSyncAttempt>();
  const server = http.createServer((request, response) => {
    applySecurityResponseHeaders(response);
    void handleRequest({
      request,
      response,
      auth,
      runtime,
      identityStore,
      staticFiles: resolvedStaticFiles,
      config,
      sessionFileStore,
      sessionSubmissionStore,
      sessionSubmissionOperations,
      webhookConversationStore,
      loginRateLimiter,
      webhookRateLimiter,
      webhookStatusRateLimiter,
      webhookStatusSyncAttempts,
      registerSseCloser: (close) => {
        activeSseClosers.add(close);
        return () => {
          activeSseClosers.delete(close);
        };
      },
      closeSseConnections: () => {
        for (const close of [...activeSseClosers]) {
          close();
        }
      },
    }).catch((error) => {
      writeErrorResponse({ request, response, error });
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
  });

  let baseUrl = `http://${config.host}:${config.port}`;

  return {
    get baseUrl() {
      return baseUrl;
    },
    async start(): Promise<void> {
      await migrateLegacyWebhookConversationBindings({
        sessionSubmissionStore,
        webhookConversationStore,
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          const address = server.address();
          if (address && typeof address === 'object') {
            baseUrl = `http://${address.address}:${address.port}`;
          }
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      webhookStatusSyncAttempts.clear();
      for (const close of [...activeSseClosers]) {
        close();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      for (const socket of sockets) {
        socket.destroy();
      }
      await runtime.stop?.();
    },
  };
}

async function migrateLegacyWebhookConversationBindings({
  sessionSubmissionStore,
  webhookConversationStore,
}: {
  sessionSubmissionStore: FileSessionSubmissionStore;
  webhookConversationStore: FileWebhookConversationStore;
}): Promise<void> {
  const legacyConversations = (await sessionSubmissionStore.list()).flatMap((record) => {
    const match = LEGACY_WEBHOOK_SUBMISSION_ID_PATTERN.exec(record.id);
    if (!match || record.status !== 'submitted' || !record.sessionId) {
      return [];
    }
    return [{
      ownerUserId: record.ownerUserId,
      keyHash: match[1]!,
      sessionId: record.sessionId,
      projectId: record.payload.projectId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }];
  });
  await webhookConversationStore.bindMany(legacyConversations);
}

function loadDefaultStaticFiles(): StaticFilesRecord {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  const sources = new Map(DEFAULT_STATIC_SOURCE_FILES.map((relativePath) => [
    relativePath,
    readFileSync(path.join(publicDir, relativePath)),
  ]));
  const buildId = createBuildId(sources);
  const readBinary = (relativePath: typeof DEFAULT_STATIC_SOURCE_FILES[number]): Buffer => {
    const source = sources.get(relativePath);
    if (!source) {
      throw new Error(`Missing static asset: ${relativePath}`);
    }
    return source;
  };
  const readText = (relativePath: typeof DEFAULT_STATIC_SOURCE_FILES[number]): string => (
    readBinary(relativePath).toString('utf8')
  );
  const indexAsset = (): StaticFileAsset => ({
    body: injectBuildId(readText('index.html'), buildId),
    contentType: 'text/html; charset=utf-8',
    buildId,
    cacheControl: APP_SHELL_CACHE_CONTROL,
  });
  const versionedAsset = (
    body: string | Buffer,
    contentType: string,
  ): StaticFileAsset => ({
    body,
    contentType,
    buildId,
    immutableWhenVersioned: true,
  });
  return {
    '/': indexAsset,
    '/index.html': indexAsset,
    '/app.js': () => versionedAsset(
      injectBuildId(readText('app.js'), buildId),
      'application/javascript; charset=utf-8',
    ),
    '/styles.css': () => versionedAsset(readText('styles.css'), 'text/css; charset=utf-8'),
    '/theme-init.js': () => versionedAsset(readText('theme-init.js'), 'application/javascript; charset=utf-8'),
    '/pwa-pull-refresh.js': () => versionedAsset(
      readText('pwa-pull-refresh.js'),
      'application/javascript; charset=utf-8',
    ),
    '/ui-copy.js': () => versionedAsset(readText('ui-copy.js'), 'application/javascript; charset=utf-8'),
    '/ui-kit.js': () => versionedAsset(readText('ui-kit.js'), 'application/javascript; charset=utf-8'),
    '/attachment-utils.js': () => versionedAsset(
      readText('attachment-utils.js'),
      'application/javascript; charset=utf-8',
    ),
    '/markdown-renderer.js': () => versionedAsset(
      readText('markdown-renderer.js'),
      'application/javascript; charset=utf-8',
    ),
    '/admin-ui.js': () => versionedAsset(readText('admin-ui.js'), 'application/javascript; charset=utf-8'),
    '/session-pagination.js': () => versionedAsset(
      readText('session-pagination.js'),
      'application/javascript; charset=utf-8',
    ),
    '/manifest.webmanifest': () => versionedAsset(
      injectManifestBuildId(readText('manifest.webmanifest'), buildId),
      'application/manifest+json; charset=utf-8',
    ),
    '/service-worker.js': () => ({
      body: injectBuildId(readText('service-worker.js'), buildId),
      contentType: 'application/javascript; charset=utf-8',
      buildId,
      cacheControl: 'no-cache',
    }),
    '/version.json': () => ({
      body: '{}\n',
      contentType: 'application/json; charset=utf-8',
      buildId,
      cacheControl: 'no-cache',
    }),
    '/icon.svg': () => versionedAsset(readText('icon.svg'), 'image/svg+xml; charset=utf-8'),
    '/icon-192.png': () => versionedAsset(readBinary('icon-192.png'), 'image/png'),
    '/icon-512.png': () => versionedAsset(readBinary('icon-512.png'), 'image/png'),
    '/apple-touch-icon.png': () => versionedAsset(readBinary('apple-touch-icon.png'), 'image/png'),
  };
}

function createBuildId(sources: Map<string, Buffer>): string {
  const hash = crypto.createHash('sha256');
  for (const relativePath of DEFAULT_STATIC_SOURCE_FILES) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(sources.get(relativePath)!);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 20);
}

function injectBuildId(source: string, buildId: string): string {
  return source.replaceAll(BUILD_ID_PLACEHOLDER, buildId);
}

function injectManifestBuildId(source: string, buildId: string): string {
  const manifest = JSON.parse(source) as { icons?: Array<{ src?: unknown }> };
  for (const icon of manifest.icons ?? []) {
    if (typeof icon.src === 'string' && icon.src.startsWith('/')) {
      icon.src = versionedStaticUrl(icon.src, buildId);
    }
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function versionedStaticUrl(pathname: string, buildId: string): string {
  return `${pathname}?v=${encodeURIComponent(buildId)}`;
}

async function handleRequest({
  request,
  response,
  auth,
  runtime,
  identityStore,
  staticFiles,
  config,
  sessionFileStore,
  sessionSubmissionStore,
  sessionSubmissionOperations,
  webhookConversationStore,
  loginRateLimiter,
  webhookRateLimiter,
  webhookStatusRateLimiter,
  webhookStatusSyncAttempts,
  registerSseCloser,
  closeSseConnections,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  auth: CodexWebAuthLike;
  runtime: CodexWebRuntime;
  identityStore: CodexWebIdentityStoreLike | null;
  staticFiles: StaticFilesRecord;
  config: CodexWebConfig;
  sessionFileStore: FileSessionFileStore;
  sessionSubmissionStore: FileSessionSubmissionStore;
  sessionSubmissionOperations: Map<string, Promise<SessionSubmissionExecution>>;
  webhookConversationStore: FileWebhookConversationStore;
  loginRateLimiter: FixedWindowRateLimiter;
  webhookRateLimiter: FixedWindowRateLimiter;
  webhookStatusRateLimiter: FixedWindowRateLimiter;
  webhookStatusSyncAttempts: Map<string, WebhookStatusSyncAttempt>;
  registerSseCloser: (close: () => void) => () => void;
  closeSseConnections: () => void;
}): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${config.host}:${config.port}`}`);
  const pathname = url.pathname;
  const configured = await auth.isConfigured();

  if (!pathname.startsWith('/api/')) {
    if (!configured && pathname === '/') {
      writeSetupRequiredPage(response);
      return;
    }
    let asset = resolveStaticFile(staticFiles[pathname] ?? (isShareAppRoute(pathname) ? staticFiles['/'] : undefined));
    if (!asset) {
      writeJson(response, 404, { error: 'Not found' });
      return;
    }
    if (isAppShellHtml(pathname, asset)) {
      const identityState = identityStore ? await identityStore.readState() : null;
      asset = injectAppShellBootstrap(asset, siteTitleFromIdentityState(identityState));
    }
    writeStaticAsset({ request, response, url, asset });
    return;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (!configured) {
      writeSetupRequiredJson(response);
      return;
    }
    const rateLimit = loginRateLimiter.take(getClientAddress(request));
    if (!rateLimit.allowed) {
      writeJson(response, 429, {
        error: 'rate_limited',
        message: 'Too many login attempts. Try again later.',
        retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1_000),
      }, {
        'Retry-After': String(Math.ceil(rateLimit.retryAfterMs / 1_000)),
      });
      return;
    }
    const body = await readJsonBody(request);
    const login = await loginWithPassword({
      auth,
      username: typeof body.username === 'string' ? body.username : null,
      password: String(body.password ?? ''),
      deviceName: typeof body.deviceName === 'string' ? body.deviceName : null,
      response,
    });
    if (!login) {
      return;
    }
    writeJson(response, 200, login);
    return;
  }

  if (!configured) {
    writeSetupRequiredJson(response);
    return;
  }

  if (pathname === WEBHOOK_ENDPOINT_PATH && method === 'POST') {
    await handleWebhookSessionRequest({
      request,
      response,
      identityStore,
      runtime,
      config,
      sessionSubmissionStore,
      sessionSubmissionOperations,
      webhookConversationStore,
      webhookRateLimiter,
    });
    return;
  }

  if (pathname.startsWith(`${WEBHOOK_ENDPOINT_PATH}/submissions/`) && method === 'GET') {
    await handleWebhookSubmissionStatusRequest({
      request,
      response,
      pathname,
      identityStore,
      runtime,
      sessionSubmissionStore,
      webhookStatusRateLimiter,
      webhookStatusSyncAttempts,
    });
    return;
  }

  const shareHandled = await handlePublicShareRequest({
    pathname,
    method,
    response,
    identityStore,
    runtime,
    registerSseCloser,
    request,
    url,
    config,
  });
  if (shareHandled) {
    return;
  }

  const authContext = await authenticateRequest({ auth, request });
  if (!authContext) {
    response.writeHead(401, {
      'Content-Type': 'application/json; charset=utf-8',
      'WWW-Authenticate': 'Bearer',
    });
    response.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const identityState = identityStore ? await identityStore.readState() : null;
  const principal = authContext.session.principal ?? localAdminPrincipal();
  const webhookManagementHandled = await handleWebhookManagementRequest({
    request,
    response,
    pathname,
    method,
    principal,
    identityStore,
  });
  if (webhookManagementHandled) {
    return;
  }
  const submissionHandled = await handleSessionSubmissionEndpoint({
    request,
    response,
    pathname,
    method,
    url,
    principal,
    identityStore,
    identityState,
    runtime,
    config,
    sessionSubmissionStore,
    sessionSubmissionOperations,
  });
  if (submissionHandled) {
    return;
  }
  if (
    identityStore
    && identityState
    && (
      identityState.settings.multiUserEnabled === true
      || principal.mode === 'multi'
      || pathname.startsWith('/api/admin/')
    )
  ) {
    const handled = await handleMultiUserRequest({
      request,
      response,
      pathname,
      method,
      url,
      authContext,
      auth,
      principal,
      identityStore,
      identityState,
      runtime,
      config,
      sessionFileStore,
      sessionSubmissionStore,
      sessionSubmissionOperations,
      registerSseCloser,
      closeSseConnections,
    });
    if (handled) {
      return;
    }
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    writeJson(response, 200, { session: authContext.session });
    return;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    await auth.logout(authContext.token);
    writeJson(response, 200, { ok: true });
    return;
  }

  if (pathname === '/api/settings' && method === 'GET') {
    writeJson(response, 200, publicSettingsPayload(identityState, principal, config));
    return;
  }

  if (pathname === '/api/settings' && method === 'PATCH') {
    if (!canSetSiteTitle(principal)) {
      writeJson(response, 403, { error: 'forbidden' });
      return;
    }
    if (typeof identityStore?.setSiteTitle !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return;
    }
    const body = await readJsonBody(request);
    const updatedState = await identityStore.setSiteTitle(String(body.siteTitle ?? ''));
    writeJson(response, 200, publicSettingsPayload(updatedState, principal, config));
    return;
  }

  if (pathname === '/api/health' && method === 'GET') {
    writeJson(response, 200, {
      ok: true,
      host: config.host,
      port: config.port,
    });
    return;
  }

  if (pathname === '/api/models' && method === 'GET') {
    writeJson(response, 200, await readModelSettingsPayload(runtime));
    return;
  }

  if (pathname === '/api/usage' && method === 'GET') {
    writeJson(response, 200, { usage: await runtime.readUsage() });
    return;
  }

  const reportStore = new FileReportStore({
    reportsDir: config.reportsDir,
    indexPath: config.reportIndexPath,
    beforeAccess: async () => {
      await maintainManagedStateStorage(config);
    },
  });

  if (pathname === '/api/reports' && method === 'GET') {
    writeJson(response, 200, { items: await reportStore.listReports() });
    return;
  }

  if (pathname === '/api/reports/resolve' && method === 'POST') {
    const body = await readJsonBody(request);
    const inputPath = typeof body.path === 'string' ? body.path : '';
    if (!inputPath.trim()) {
      writeJson(response, 400, {
        error: 'invalid_report_path',
        message: 'path is required',
      });
      return;
    }
    const report = await resolveReportForResponse(reportStore, inputPath, response);
    if (!report) {
      return;
    }
    writeJson(response, 200, { report });
    return;
  }

  if (pathname === '/api/runtime/reload' && method === 'POST') {
    const result = await runtime.reloadRuntime();
    writeJson(response, 200, { ok: true, ...result });
    return;
  }

  if (pathname === '/api/sessions' && method === 'GET') {
    const favoriteOnly = url.searchParams.get('favorite') === 'true';
    const stateFilter = normalizeSessionStateFilter(url.searchParams.get('state'));
    const options = favoriteOnly
      ? { favorite: true }
      : stateFilter === 'archived'
        ? { archived: true }
        : {};
    const requestedCwd = normalizeOptionalString(url.searchParams.get('cwd'));
    const items = (await runtime.listSessions(options))
      .filter((session) => !requestedCwd || normalizeOptionalString(session.cwd) === requestedCwd)
      .map(presentSessionSummary);
    writeSessionListPage(response, url, items, {
      principalId: 'single-user',
      scope: sessionListScopeKey({
        favoriteOnly,
        archivedOnly: stateFilter === 'archived',
        projectKey: requestedCwd ? `cwd:${requestedCwd}` : '',
      }),
    });
    return;
  }

  if (pathname === '/api/sessions' && method === 'POST') {
    const body = await readJsonBody(request);
    const session = await runtime.createSession(body as CreateSessionInput);
    writeJson(response, 201, { session });
    return;
  }

  const sessionStatusMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/status$/u);
  if (sessionStatusMatch && method === 'GET') {
    const session = await runtime.readSessionStatus(
      decodeURIComponent(sessionStatusMatch[1]!),
      { archived: url.searchParams.get('archived') === 'true' },
    );
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, {
      session: presentSessionSummary(session),
      turnSnapshot: presentActiveTurnSnapshot(runtime, session.activeTurnId, 'workspace'),
    });
    return;
  }

  const sessionFileResolveMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/files\/resolve$/u);
  if (sessionFileResolveMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionFileResolveMatch[1]!);
    const runtimeSession = await runtime.readSession(sessionId);
    const scope = runtimeSession
      ? singleUserSessionFileScope({ config, principal, sessionId, runtimeSession })
      : null;
    if (!scope) {
      writeSessionNotFound(response);
      return;
    }
    const body = await readJsonBody(request);
    const inputPath = typeof body.path === 'string' ? body.path.trim() : '';
    if (!inputPath) {
      writeJson(response, 400, { error: 'invalid_file_path', message: 'path is required' });
      return;
    }
    const file = await resolveSessionFileForResponse({
      store: sessionFileStore,
      scope,
      inputPath,
      response,
    });
    if (!file) {
      return;
    }
    writeJson(response, 200, {
      file: presentSessionFileForUser(file, sessionId),
    });
    return;
  }

  const sessionFileContentMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/files\/([^/]+)\/content$/u);
  if (sessionFileContentMatch && method === 'GET') {
    const sessionId = decodeURIComponent(sessionFileContentMatch[1]!);
    const runtimeSession = await runtime.readSession(sessionId);
    const scope = runtimeSession
      ? singleUserSessionFileScope({ config, principal, sessionId, runtimeSession })
      : null;
    if (!scope) {
      writeSessionNotFound(response);
      return;
    }
    const content = await readSessionFileForResponse({
      store: sessionFileStore,
      scope,
      fileId: decodeURIComponent(sessionFileContentMatch[2]!),
      response,
    });
    if (!content) {
      return;
    }
    writeSessionFileContent(response, content, url.searchParams.get('download') === '1');
    return;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/u);
  if (sessionMatch && method === 'GET') {
    const session = await runtime.readSession(decodeURIComponent(sessionMatch[1]!));
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, { session });
    return;
  }

  const sessionTimelineMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/timeline$/u);
  if (sessionTimelineMatch && method === 'GET') {
    const session = await runtime.readSession(decodeURIComponent(sessionTimelineMatch[1]!));
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, {
      ...paginateSessionTimeline(
        presentSessionTimeline(session.timeline, session.thread, true),
        url,
      ),
      session: presentSessionSummary(session),
      ...(shouldIncludeTimelineTurnSnapshot(request, url)
        ? { turnSnapshot: presentActiveTurnSnapshot(runtime, session.activeTurnId, 'workspace') }
        : {}),
    });
    return;
  }
  if (sessionTimelineMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionTimelineMatch[1]!);
    const session = await runtime.readSession(sessionId);
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    const body = await readJsonBody(request);
    const entryInput = normalizeSessionTimelineEntryInput(body);
    if (!entryInput) {
      writeJson(response, 400, {
        error: 'invalid_timeline_entry',
        message: 'A non-empty system message is required.',
      });
      return;
    }
    const entry = runtime.appendSessionTimelineEntry(sessionId, entryInput);
    if (!entry) {
      writeJson(response, 400, {
        error: 'invalid_timeline_entry',
        message: 'A non-empty system message is required.',
      });
      return;
    }
    writeJson(response, 201, { entry });
    return;
  }

  if (sessionMatch && method === 'DELETE') {
    const archived = await runtime.archiveSession(decodeURIComponent(sessionMatch[1]!));
    if (!archived) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, { ok: true });
    return;
  }

  const sessionArchiveMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/archive$/u);
  if (sessionArchiveMatch && method === 'POST') {
    const archived = await runtime.archiveSession(decodeURIComponent(sessionArchiveMatch[1]!));
    if (!archived) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, { ok: true });
    return;
  }

  const sessionFavoriteMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/favorite$/u);
  if (sessionFavoriteMatch && method === 'PATCH') {
    const sessionId = decodeURIComponent(sessionFavoriteMatch[1]!);
    const body = await readJsonBody(request);
    if (typeof body.favorite !== 'boolean') {
      writeJson(response, 400, { error: 'favorite must be a boolean' });
      return;
    }
    const favoriteOrder = Number.isFinite(body.favoriteOrder) ? Number(body.favoriteOrder) : null;
    const session = await runtime.updateSessionFavorite(sessionId, body.favorite, favoriteOrder);
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, { session });
    return;
  }

  const sessionSettingsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/settings$/u);
  if (sessionSettingsMatch && method === 'PATCH') {
    const sessionId = decodeURIComponent(sessionSettingsMatch[1]!);
    const body = await readJsonBody(request);
    const session = await runtime.updateSessionSettings(sessionId, body as UpdateSessionSettingsInput);
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, { session });
    return;
  }

  const sessionAttachmentsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/attachments$/u);
  if (sessionAttachmentsMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionAttachmentsMatch[1]!);
    const session = await runtime.readSession(sessionId);
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    const items = await storeSessionAttachments({
      request,
      config,
      principal,
      projectCwd: normalizeOptionalString(session.cwd),
      projectKey: `cwd-${stableIdHash(normalizeOptionalString(session.cwd) || sessionId, 16)}`,
    });
    writeJson(response, 201, { items });
    return;
  }

  const reportContentMatch = pathname.match(/^\/api\/reports\/([^/]+)\/content$/u);
  if (reportContentMatch && method === 'GET') {
    const reportId = decodeURIComponent(reportContentMatch[1]!);
    const content = await readReportContentForResponse(reportStore, reportId, response);
    if (!content) {
      return;
    }
    writeJson(response, 200, content);
    return;
  }

  const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)$/u);
  if (reportMatch && method === 'GET') {
    const report = await readReportForResponse(
      () => reportStore.readReport(decodeURIComponent(reportMatch[1]!)),
      response,
    );
    if (!report) {
      return;
    }
    writeJson(response, 200, { report });
    return;
  }

  const startTurnMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/turns$/u);
  if (startTurnMatch && method === 'POST') {
    const sessionId = decodeURIComponent(startTurnMatch[1]!);
    const body = await readJsonBody(request);
    if (hasSessionSubmissionIdField(body)) {
      const execution = await submitSessionSubmission({
        body,
        forcedSessionId: sessionId,
        principal,
        identityStore,
        identityState,
        runtime,
        config,
        store: sessionSubmissionStore,
        operations: sessionSubmissionOperations,
      });
      writeJson(response, execution.created ? 202 : 200, execution.response);
      return;
    }
    if (typeof body.text !== 'string' || !body.text.trim()) {
      writeJson(response, 400, { error: 'text is required' });
      return;
    }
    const input = await normalizeStartTurnInput({
      body,
      config,
      principal,
      runtime,
      sessionId,
      projectCwd: '',
      projectKey: '',
    });
    if (!input) {
      writeSessionNotFound(response);
      return;
    }
    const turn = await startSessionTurn({
      runtime,
      sessionId,
      input,
      response,
    });
    if (!turn) {
      return;
    }
    writeJson(response, 202, turn);
    return;
  }

  const interruptMatch = pathname.match(/^\/api\/turns\/([^/]+)\/interrupt$/u);
  const steerMatch = pathname.match(/^\/api\/turns\/([^/]+)\/steer$/u);
  if (steerMatch && method === 'POST') {
    const turnId = decodeURIComponent(steerMatch[1]!);
    const threadId = runtime.threadIdForTurn(turnId);
    if (!threadId) {
      writeSessionNotFound(response);
      return;
    }
    const body = await readJsonBody(request);
    if (typeof body.text !== 'string' || !body.text.trim()) {
      writeJson(response, 400, { error: 'text is required' });
      return;
    }
    const result = await steerSessionTurn({
      runtime,
      sessionId: threadId,
      turnId,
      input: { text: body.text },
      response,
    });
    if (!result) {
      return;
    }
    writeJson(response, 202, result);
    return;
  }
  if (interruptMatch && method === 'POST') {
    await runtime.interruptTurn(decodeURIComponent(interruptMatch[1]!));
    writeJson(response, 200, { ok: true });
    return;
  }

  const eventsMatch = pathname.match(/^\/api\/turns\/([^/]+)\/events$/u);
  if (eventsMatch && method === 'GET') {
    await streamTurnEvents({
      request,
      response,
      runtime,
      turnId: decodeURIComponent(eventsMatch[1]!),
      afterId: normalizeLastEventId(url.searchParams.get('after'), request.headers['last-event-id']),
      requestedEpoch: normalizeEventEpoch(url.searchParams.get('epoch'), request.headers['x-codex-event-epoch']),
      registerSseCloser,
    });
    return;
  }

  const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/(accept|accept-for-session|deny)$/u);
  if (approvalMatch && method === 'POST') {
    const approvalId = decodeURIComponent(approvalMatch[1]!);
    const action = approvalMatch[2]!;
    const decision = action === 'accept'
      ? 'accept'
      : action === 'accept-for-session'
        ? 'accept_for_session'
        : 'deny';
    await runtime.resolveApproval(approvalId, decision);
    writeJson(response, 200, { ok: true });
    return;
  }

  writeJson(response, 404, { error: 'Not found' });
}

function resolveStaticFile(entry: StaticFileEntry | undefined): StaticFileAsset | null {
  if (!entry) {
    return null;
  }
  return typeof entry === 'function' ? entry() : entry;
}

function writeStaticAsset({
  request,
  response,
  url,
  asset,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  asset: StaticFileAsset;
}): void {
  const body = Buffer.isBuffer(asset.body) ? asset.body : Buffer.from(asset.body);
  const etag = contentEtag(body);
  const cacheControl = asset.immutableWhenVersioned
    && asset.buildId
    && url.searchParams.get('v') === asset.buildId
    ? STATIC_IMMUTABLE_CACHE_CONTROL
    : asset.cacheControl ?? (asset.buildId ? 'no-cache' : 'no-store');
  const baseHeaders: Record<string, string> = {
    'Content-Type': asset.contentType,
    'Cache-Control': cacheControl,
    ETag: etag,
  };
  if (isCompressibleContentType(asset.contentType)) {
    baseHeaders.Vary = appendVaryHeader(baseHeaders.Vary, 'Accept-Encoding');
  }
  if ((request.method === 'GET' || request.method === 'HEAD') && requestMatchesEtag(request, etag)) {
    response.writeHead(304, baseHeaders);
    response.end();
    return;
  }
  const encoded = encodeResponseBody(request, body, asset.contentType);
  if (encoded.contentEncoding) {
    baseHeaders['Content-Encoding'] = encoded.contentEncoding;
  }
  baseHeaders['Content-Length'] = String(encoded.body.byteLength);
  response.writeHead(200, baseHeaders);
  response.end(request.method === 'HEAD' ? undefined : encoded.body);
}

function contentEtag(body: Buffer): string {
  return `W/"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`;
}

function requestMatchesEtag(request: IncomingMessage, etag: string): boolean {
  const value = request.headers['if-none-match'];
  const candidates = Array.isArray(value) ? value : value?.split(',');
  return candidates?.some((candidate) => candidate.trim() === '*' || candidate.trim() === etag) ?? false;
}

function isAppShellHtml(pathname: string, asset: StaticFileAsset): boolean {
  return (pathname === '/' || pathname === '/index.html' || isShareAppRoute(pathname))
    && typeof asset.body === 'string'
    && /^text\/html\b/iu.test(asset.contentType);
}

function injectAppShellBootstrap(asset: StaticFileAsset, siteTitle: string): StaticFileAsset {
  const title = normalizePublicSiteTitle(siteTitle);
  const bootstrap = `<script type="application/json" id="codex-web-bootstrap">${escapeJsonForHtmlScript({ siteTitle: title })}</script>`;
  let body = String(asset.body).replace(/<title>[^<]*<\/title>/iu, `<title>${escapeHtml(title)}</title>`);
  if (!body.includes('id="codex-web-bootstrap"')) {
    body = body.replace(
      /(\s*<script type="module" src="\/app\.js(?:\?[^"<]*)?"><\/script>)/u,
      `\n  ${bootstrap}$1`,
    );
  }
  return { ...asset, body };
}

function siteTitleFromIdentityState(identityState: CodexWebIdentityState | null): string {
  return normalizePublicSiteTitle(identityState?.settings.siteTitle);
}

function normalizePublicSiteTitle(siteTitle: unknown): string {
  const normalized = typeof siteTitle === 'string' ? siteTitle.trim() : '';
  return normalized || DEFAULT_SITE_TITLE;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] ?? character));
}

function escapeJsonForHtmlScript(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</gu, '\\u003C')
    .replace(/>/gu, '\\u003E')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

class FixedWindowRateLimiter {
  private readonly windowMs: number;

  private readonly perClientLimit: number;

  private readonly globalLimit: number;

  private windowStartedAt = 0;

  private globalCount = 0;

  private readonly clientCounts = new Map<string, number>();

  constructor({
    windowMs,
    perClientLimit,
    globalLimit,
  }: {
    windowMs: number;
    perClientLimit: number;
    globalLimit: number;
  }) {
    this.windowMs = windowMs;
    this.perClientLimit = perClientLimit;
    this.globalLimit = globalLimit;
  }

  take(clientId: string, now = Date.now()): RateLimitResult {
    this.rotateWindow(now);
    const clientCount = (this.clientCounts.get(clientId) ?? 0) + 1;
    const globalCount = this.globalCount + 1;
    if (clientCount > this.perClientLimit || globalCount > this.globalLimit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, this.windowStartedAt + this.windowMs - now),
      };
    }
    this.clientCounts.set(clientId, clientCount);
    this.globalCount = globalCount;
    return { allowed: true, retryAfterMs: 0 };
  }

  private rotateWindow(now: number): void {
    if (this.windowStartedAt > 0 && now - this.windowStartedAt < this.windowMs) {
      return;
    }
    this.windowStartedAt = now;
    this.globalCount = 0;
    this.clientCounts.clear();
  }
}

async function authenticateRequest({
  auth,
  request,
}: {
  auth: CodexWebAuthLike;
  request: IncomingMessage;
}): Promise<AuthenticatedRequestContext | null> {
  const token = extractBearerToken(request);
  if (!token) {
    return null;
  }
  const session = await auth.verifyToken(token);
  if (!session) {
    return null;
  }
  return { token, session };
}

async function handleWebhookManagementRequest({
  request,
  response,
  pathname,
  method,
  principal,
  identityStore,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  method: string;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike | null;
}): Promise<boolean> {
  if (pathname === '/api/webhook' && method === 'GET') {
    if (!identityStore?.getWebhookCredential) {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const credential = await identityStore.getWebhookCredential(principal.userId);
    writeJson(response, 200, webhookManagementPayload(credential));
    return true;
  }

  if (pathname === '/api/webhook' && method === 'PATCH') {
    if (!identityStore?.setWebhookEnabled) {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    if (typeof body.enabled !== 'boolean') {
      throw createHttpError(400, 'invalid_webhook_settings', 'enabled must be a boolean.');
    }
    const result = await identityStore.setWebhookEnabled(principal.userId, body.enabled);
    writeJson(response, 200, webhookManagementPayload(result.credential));
    return true;
  }

  if (pathname === '/api/webhook/rotate' && method === 'POST') {
    if (!identityStore?.rotateWebhookKey) {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const result = await identityStore.rotateWebhookKey(principal.userId);
    writeJson(response, 200, webhookManagementPayload(result.credential));
    return true;
  }

  return false;
}

function webhookManagementPayload(
  credential: CodexWebWebhookCredential | null,
): { webhook: Record<string, unknown>; key: string | null } {
  return {
    webhook: {
      enabled: credential?.enabled === true,
      hasKey: Boolean(credential?.tokenHash),
      keyHint: credential?.keyHint ?? null,
      endpointPath: WEBHOOK_ENDPOINT_PATH,
    },
    key: credential?.key ?? null,
  };
}

async function handleWebhookSessionRequest({
  request,
  response,
  identityStore,
  runtime,
  config,
  sessionSubmissionStore,
  sessionSubmissionOperations,
  webhookConversationStore,
  webhookRateLimiter,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  identityStore: CodexWebIdentityStoreLike | null;
  runtime: CodexWebRuntime;
  config: CodexWebConfig;
  sessionSubmissionStore: FileSessionSubmissionStore;
  sessionSubmissionOperations: Map<string, Promise<SessionSubmissionExecution>>;
  webhookConversationStore: FileWebhookConversationStore;
  webhookRateLimiter: FixedWindowRateLimiter;
}): Promise<void> {
  const token = extractBearerToken(request);
  const rateLimit = webhookRateLimiter.take(webhookRateLimitClientId(request, token));
  if (!rateLimit.allowed) {
    const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1_000);
    writeJson(response, 429, {
      error: 'rate_limited',
      message: 'Too many webhook requests. Try again later.',
      retryAfterSeconds,
    }, {
      'Retry-After': String(retryAfterSeconds),
    });
    return;
  }
  if (!token || !identityStore?.findWebhookCredentialByToken) {
    writeWebhookUnauthorized(response);
    return;
  }
  const credential = await identityStore.findWebhookCredentialByToken(token);
  if (!credential || credential.enabled !== true) {
    writeWebhookUnauthorized(response);
    return;
  }
  const identityState = await identityStore.readState();
  const currentCredential = identityState.webhookCredentials.find((item) => (
    item.id === credential.id
    && item.ownerUserId === credential.ownerUserId
    && item.enabled === true
    && item.tokenHash === credential.tokenHash
  ));
  if (!currentCredential) {
    writeWebhookUnauthorized(response);
    return;
  }
  const principal = webhookPrincipalForCredential(identityState, currentCredential);
  if (!principal) {
    writeWebhookUnauthorized(response);
    return;
  }

  const idempotencyKey = normalizeWebhookIdempotencyKey(request.headers['idempotency-key']);
  const rawBody = await readJsonBody(request);
  const revalidatedIdentityState = await identityStore.readState();
  const revalidatedCredential = revalidatedIdentityState.webhookCredentials.find((item) => (
    item.id === currentCredential.id
    && item.ownerUserId === currentCredential.ownerUserId
    && item.enabled === true
    && item.tokenHash === currentCredential.tokenHash
  ));
  const revalidatedPrincipal = revalidatedCredential
    ? webhookPrincipalForCredential(revalidatedIdentityState, revalidatedCredential)
    : null;
  if (!revalidatedCredential || !revalidatedPrincipal) {
    writeWebhookUnauthorized(response);
    return;
  }
  const conversationKeyHash = hashWebhookConversationKey(idempotencyKey);
  await webhookConversationStore.withConversationOperationLock(
    revalidatedPrincipal.userId,
    conversationKeyHash,
    async () => {
      const lockedIdentityState = await identityStore.readState();
      const lockedCredential = lockedIdentityState.webhookCredentials.find((item) => (
        item.id === revalidatedCredential.id
        && item.ownerUserId === revalidatedCredential.ownerUserId
        && item.enabled === true
        && item.tokenHash === revalidatedCredential.tokenHash
      ));
      const lockedPrincipal = lockedCredential
        ? webhookPrincipalForCredential(lockedIdentityState, lockedCredential)
        : null;
      if (!lockedCredential || !lockedPrincipal) {
        writeWebhookUnauthorized(response);
        return;
      }

      let conversation = await webhookConversationStore.read(lockedPrincipal.userId, conversationKeyHash);
      const legacySubmissionId = `webhook:${conversationKeyHash}`;
      const legacySubmission = conversation
        ? null
        : await sessionSubmissionStore.read(lockedPrincipal.userId, legacySubmissionId);
      if (!conversation && legacySubmission?.status === 'submitted' && legacySubmission.sessionId) {
        const firstBody = normalizeWebhookSessionBody(rawBody, lockedIdentityState, lockedPrincipal, null);
        const bound = await webhookConversationStore.bind({
          ownerUserId: lockedPrincipal.userId,
          keyHash: conversationKeyHash,
          sessionId: legacySubmission.sessionId,
          projectId: legacySubmission.payload.projectId,
          createdAt: legacySubmission.createdAt,
          updatedAt: new Date().toISOString(),
        });
        conversation = bound.conversation;
        const firstPayload = normalizeSessionSubmissionPayload(firstBody, null);
        if (hashSessionSubmissionPayload(firstPayload) === legacySubmission.payloadHash) {
          writeJson(response, 200, await presentSessionSubmissionResponse({
            current: legacySubmission,
            principal: lockedPrincipal,
            identityStore,
            identityState: lockedIdentityState,
            runtime,
          }));
          return;
        }
      }

      const clientRequestId = normalizeOptionalWebhookClientRequestId(rawBody.clientRequestId);
      const deliveryMode = normalizeWebhookDeliveryMode(rawBody.deliveryMode);
      const createsConversation = conversation === null;
      let body: Record<string, unknown>;
      try {
        body = normalizeWebhookSessionBody(rawBody, lockedIdentityState, lockedPrincipal, conversation);
      } catch (error) {
        if (
          clientRequestId
          && isHttpError(error)
          && error.code === 'webhook_conversation_conflict'
          && await sessionSubmissionStore.read(lockedPrincipal.userId, webhookSubmissionId(clientRequestId))
        ) {
          throw createHttpError(
            409,
            'submission_conflict',
            'This clientRequestId was already used with different request content.',
          );
        }
        throw error;
      }
      const requestFingerprint = clientRequestId
        ? hashWebhookRequestFingerprint({
            conversationKeyHash,
            projectId: webhookFingerprintProjectId(body, conversation),
            text: String(rawBody.text),
            title: normalizeOptionalString(rawBody.title) || null,
            model: typeof rawBody.model === 'string' ? rawBody.model.trim() : null,
            reasoningEffort: typeof rawBody.reasoningEffort === 'string' ? rawBody.reasoningEffort.trim() : null,
            deliveryMode,
          })
        : null;
      const submissionId = clientRequestId
        ? webhookSubmissionId(clientRequestId)
        : createsConversation
          ? legacySubmissionId
          : `webhook:${conversationKeyHash.slice(0, 24)}:${crypto.randomUUID()}`;
      const execution = await submitSessionSubmission({
        body: { ...body, submissionId },
        forcedSessionId: null,
        principal: lockedPrincipal,
        identityStore,
        identityState: lockedIdentityState,
        runtime,
        config,
        store: sessionSubmissionStore,
        operations: sessionSubmissionOperations,
        submissionDeliveryMode: deliveryMode,
        ...(clientRequestId && requestFingerprint ? {
          metadata: {
            source: 'webhook',
            clientRequestId,
            requestFingerprint,
            deliveryMode,
          },
        } : {}),
      });
      const sessionId = execution.record.sessionId;
      if (!sessionId) {
        throw createHttpError(500, 'submission_failed', 'Webhook submission returned no session id.');
      }
      if (conversation && conversation.sessionId !== sessionId) {
        throw createHttpError(409, 'webhook_conversation_conflict', 'This Idempotency-Key is bound to another session.');
      }
      if (createsConversation) {
        const bound = await webhookConversationStore.bind({
          ownerUserId: lockedPrincipal.userId,
          keyHash: conversationKeyHash,
          sessionId,
          projectId: typeof body.projectId === 'string' ? body.projectId : null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        if (bound.conversation.sessionId !== sessionId) {
          throw createHttpError(409, 'webhook_conversation_conflict', 'This Idempotency-Key is bound to another session.');
        }
      } else {
        await webhookConversationStore.touch(lockedPrincipal.userId, conversationKeyHash);
      }
      writeJson(response, createsConversation ? 201 : 202, execution.response);
    },
  );
}

async function handleWebhookSubmissionStatusRequest({
  request,
  response,
  pathname,
  identityStore,
  runtime,
  sessionSubmissionStore,
  webhookStatusRateLimiter,
  webhookStatusSyncAttempts,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  identityStore: CodexWebIdentityStoreLike | null;
  runtime: CodexWebRuntime;
  sessionSubmissionStore: FileSessionSubmissionStore;
  webhookStatusRateLimiter: FixedWindowRateLimiter;
  webhookStatusSyncAttempts: Map<string, WebhookStatusSyncAttempt>;
}): Promise<void> {
  const token = extractBearerToken(request);
  const rateLimit = webhookStatusRateLimiter.take(webhookRateLimitClientId(request, token));
  if (!rateLimit.allowed) {
    const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1_000);
    writeJson(response, 429, {
      error: 'rate_limited',
      message: 'Too many webhook status requests. Try again later.',
      retryAfterSeconds,
    }, { 'Retry-After': String(retryAfterSeconds) });
    return;
  }
  const principal = await authenticateWebhookPrincipal(identityStore, token);
  if (!principal) {
    writeWebhookUnauthorized(response);
    return;
  }
  const encodedClientRequestId = pathname.slice(`${WEBHOOK_ENDPOINT_PATH}/submissions/`.length);
  let decodedClientRequestId = '';
  try {
    decodedClientRequestId = decodeURIComponent(encodedClientRequestId);
  } catch {
    throw createHttpError(400, 'invalid_client_request_id', 'clientRequestId is invalid.');
  }
  const clientRequestId = normalizeWebhookClientRequestId(decodedClientRequestId);
  if (!clientRequestId) {
    throw createHttpError(
      400,
      'invalid_client_request_id',
      'clientRequestId must use 1-128 letters, numbers, dots, underscores, colons, or dashes.',
    );
  }
  const record = await sessionSubmissionStore.read(principal.userId, webhookSubmissionId(clientRequestId));
  if (!record || record.source !== 'webhook' || record.clientRequestId !== clientRequestId) {
    throw createHttpError(404, 'submission_not_found', 'Webhook submission was not found.');
  }
  const projected = await projectWebhookSubmissionStatus(
    record,
    runtime,
    webhookStatusSyncAttempts,
  );
  writeJson(response, 200, {
    clientRequestId,
    status: projected.status,
    sessionId: record.sessionId,
    turnId: record.turnId,
    finalText: projected.finalText,
    error: projected.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

async function authenticateWebhookPrincipal(
  identityStore: CodexWebIdentityStoreLike | null,
  token: string | null,
): Promise<CodexWebPrincipal | null> {
  if (!token || !identityStore?.findWebhookCredentialByToken) {
    return null;
  }
  const credential = await identityStore.findWebhookCredentialByToken(token);
  if (!credential || credential.enabled !== true) {
    return null;
  }
  const state = await identityStore.readState();
  const current = state.webhookCredentials.find((item) => (
    item.id === credential.id
    && item.ownerUserId === credential.ownerUserId
    && item.enabled === true
    && item.tokenHash === credential.tokenHash
  ));
  return current ? webhookPrincipalForCredential(state, current) : null;
}

async function projectWebhookSubmissionStatus(
  record: CodexWebSessionSubmissionRecord,
  runtime: CodexWebRuntime,
  syncAttempts: Map<string, WebhookStatusSyncAttempt>,
): Promise<{
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  finalText: string | null;
  error: CodexWebSessionSubmissionRecord['error'];
}> {
  const syncKey = webhookStatusSyncKey(record);
  if (record.status === 'failed') {
    syncAttempts.delete(syncKey);
    return { status: 'failed', finalText: null, error: record.error };
  }
  if (!record.turnId || !record.runtimeSessionId) {
    syncAttempts.delete(syncKey);
    return record.status === 'submitted'
      ? {
          status: 'failed',
          finalText: null,
          error: {
            code: 'submission_turn_missing',
            message: 'The webhook submission was accepted without a turn id.',
            retryable: false,
          },
        }
      : { status: 'queued', finalText: null, error: record.error };
  }
  const turn = await runtime.readTurnSnapshot(record.runtimeSessionId, record.turnId);
  if (!turn) {
    return { status: 'running', finalText: null, error: null };
  }
  const projected = projectWebhookTurnStatus(turn);
  if (!webhookTurnNeedsFinalSync(turn)) {
    syncAttempts.delete(syncKey);
    return projected;
  }
  const attempt = rememberWebhookStatusSyncAttempt(
    syncAttempts,
    syncKey,
    record.turnId,
  );
  if (attempt.attempts < WEBHOOK_STATUS_SYNC_MAX_ATTEMPTS) {
    return { status: 'running', finalText: null, error: null };
  }
  return {
    status: 'failed',
    finalText: null,
    error: {
      code: 'final_response_sync_failed',
      message: 'The turn finished, but its final response could not be synchronized.',
      retryable: false,
    },
  };
}

interface WebhookStatusSyncAttempt {
  turnId: string;
  attempts: number;
}

function webhookStatusSyncKey(record: CodexWebSessionSubmissionRecord): string {
  return `${record.ownerUserId}\0${record.id}`;
}

function rememberWebhookStatusSyncAttempt(
  attempts: Map<string, WebhookStatusSyncAttempt>,
  key: string,
  turnId: string,
): WebhookStatusSyncAttempt {
  const current = attempts.get(key);
  const next = {
    turnId,
    attempts: current?.turnId === turnId ? current.attempts + 1 : 1,
  };
  attempts.delete(key);
  attempts.set(key, next);
  while (attempts.size > WEBHOOK_STATUS_SYNC_MAX_ENTRIES) {
    const oldestKey = attempts.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    attempts.delete(oldestKey);
  }
  return next;
}

function webhookRateLimitClientId(request: IncomingMessage, token: string | null): string {
  if (!token) {
    return `address:${getClientAddress(request)}`;
  }
  return `token:${crypto.createHash('sha256').update(token).digest('base64url')}`;
}

function webhookPrincipalForCredential(
  state: CodexWebIdentityState,
  credential: CodexWebWebhookCredential,
): CodexWebPrincipal | null {
  const singlePrincipal = localAdminPrincipal();
  if (state.settings.multiUserEnabled !== true) {
    return credential.ownerUserId === singlePrincipal.userId ? singlePrincipal : null;
  }
  if (credential.ownerUserId === singlePrincipal.userId) {
    return null;
  }
  const user = state.users.find((item) => item.id === credential.ownerUserId && item.enabled !== false);
  if (!user) {
    return null;
  }
  return {
    userId: user.id,
    username: user.username,
    roleIds: [...user.roleIds],
    isAdmin: user.roleIds.some((roleId) => state.roles.some((role) => role.id === roleId && role.isAdmin === true)),
    mode: 'multi',
  };
}

function normalizeWebhookIdempotencyKey(value: string | string[] | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > 256) {
    throw createHttpError(
      400,
      'invalid_idempotency_key',
      'Idempotency-Key must contain between 1 and 256 characters.',
    );
  }
  return normalized;
}

function normalizeWebhookSessionBody(
  body: Record<string, unknown>,
  identityState: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  conversation: CodexWebWebhookConversation | null,
): Record<string, unknown> {
  const allowedFields = new Set([
    'text',
    'projectId',
    'title',
    'model',
    'reasoningEffort',
    'clientRequestId',
    'deliveryMode',
  ]);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    throw createHttpError(
      400,
      'invalid_webhook_payload',
      'Webhook session requests contain unsupported fields.',
    );
  }
  if (typeof body.text !== 'string' || !body.text.trim()) {
    throw createHttpError(400, 'invalid_webhook_payload', 'text is required.');
  }
  if (body.title !== undefined && typeof body.title !== 'string') {
    throw createHttpError(400, 'invalid_webhook_payload', 'title must be a string.');
  }
  normalizeOptionalWebhookClientRequestId(body.clientRequestId);
  normalizeWebhookDeliveryMode(body.deliveryMode);
  const model = normalizeWebhookOptionalSetting(body, 'model');
  const reasoningEffort = normalizeWebhookOptionalSetting(body, 'reasoningEffort');
  const settings = {
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };

  const hasProjectId = Object.prototype.hasOwnProperty.call(body, 'projectId');
  if (identityState.settings.multiUserEnabled === true) {
    const projectReference = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    if (!projectReference) {
      throw createHttpError(400, 'invalid_webhook_payload', 'projectId is required in multi-user mode.');
    }
    if (conversation) {
      const resolved = resolveWritableAppSession(identityState, principal, conversation.sessionId);
      if (!resolved?.project) {
        throw createHttpError(404, 'session_not_found', 'Session was not found.');
      }
      const boundProjectId = conversation.projectId ?? resolved.appSession.projectId;
      if (
        boundProjectId !== resolved.project.id
        || !webhookProjectReferenceMatches(resolved.project, projectReference)
      ) {
        throw createHttpError(
          409,
          'webhook_conversation_conflict',
          'This Idempotency-Key is already bound to a session in another project.',
        );
      }
      return {
        text: body.text,
        sessionId: conversation.sessionId,
        settings,
      };
    }
    const project = resolveWebhookProjectReference(identityState, principal, projectReference);
    if (!project) {
      throw createHttpError(404, 'project_not_found', 'Project was not found.');
    }
    return {
      text: body.text,
      projectId: project.id,
      ...(body.title !== undefined ? { title: body.title } : {}),
      settings,
    };
  }

  if (hasProjectId) {
    throw createHttpError(400, 'invalid_webhook_payload', 'projectId is not accepted in single-user mode.');
  }
  if (conversation) {
    return {
      text: body.text,
      sessionId: conversation.sessionId,
      settings,
    };
  }
  return {
    text: body.text,
    ...(body.title !== undefined ? { title: body.title } : {}),
    settings,
  };
}

function normalizeOptionalWebhookClientRequestId(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  const clientRequestId = normalizeWebhookClientRequestId(value);
  if (!clientRequestId) {
    throw createHttpError(
      400,
      'invalid_webhook_payload',
      'clientRequestId must use 1-128 letters, numbers, dots, underscores, colons, or dashes.',
    );
  }
  return clientRequestId;
}

function normalizeWebhookDeliveryMode(value: unknown): WebhookDeliveryMode {
  if (value === undefined || value === 'steer') {
    return 'steer';
  }
  if (value === 'reject_if_busy') {
    return value;
  }
  throw createHttpError(
    400,
    'invalid_webhook_payload',
    'deliveryMode must be steer or reject_if_busy.',
  );
}

function webhookFingerprintProjectId(
  body: Record<string, unknown>,
  conversation: CodexWebWebhookConversation | null,
): string | null {
  return normalizeOptionalString(body.projectId)
    || normalizeOptionalString(conversation?.projectId)
    || null;
}

function webhookProjectReferenceMatches(project: CodexWebProject, reference: string): boolean {
  return project.id === reference
    || projectDisplayNameKey(project.displayName) === projectDisplayNameKey(reference);
}

function normalizeWebhookOptionalSetting(
  body: Record<string, unknown>,
  field: 'model' | 'reasoningEffort',
): string | null {
  if (!Object.prototype.hasOwnProperty.call(body, field)) {
    return null;
  }
  const value = typeof body[field] === 'string' ? body[field].trim() : '';
  if (!value) {
    throw createHttpError(400, 'invalid_webhook_payload', `${field} must be a non-empty string.`);
  }
  return value;
}

function resolveWebhookProjectReference(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  reference: string,
): CodexWebProject | null {
  const availableProjects = state.projects.filter((project) => (
    project.enabled !== false
    && canCreateProjectSession(state, principal, project.id)
  ));
  const idMatch = availableProjects.find((project) => project.id === reference);
  if (idMatch) {
    return idMatch;
  }
  const displayNameKey = projectDisplayNameKey(reference);
  const displayNameMatches = availableProjects.filter(
    (project) => projectDisplayNameKey(project.displayName) === displayNameKey,
  );
  if (displayNameMatches.length > 1) {
    throw createHttpError(
      409,
      'ambiguous_project_reference',
      'More than one available project has that display name. Use the internal project id.',
    );
  }
  return displayNameMatches[0] ?? null;
}

function writeWebhookUnauthorized(response: ServerResponse): void {
  writeJson(response, 401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
}

async function handlePublicShareRequest({
  pathname,
  method,
  response,
  identityStore,
  runtime,
  registerSseCloser,
  request,
  url,
  config,
}: {
  pathname: string;
  method: string;
  response: ServerResponse;
  identityStore: CodexWebIdentityStoreLike | null;
  runtime: CodexWebRuntime;
  registerSseCloser: (close: () => void) => () => void;
  request: IncomingMessage;
  url: URL;
  config: CodexWebConfig;
}): Promise<boolean> {
  const shareSessionMatch = pathname.match(/^\/api\/share\/([^/]+)\/session$/u);
  const shareEventsMatch = pathname.match(/^\/api\/share\/([^/]+)\/turns\/([^/]+)\/events$/u);
  const shareReportContentMatch = pathname.match(/^\/api\/share\/([^/]+)\/reports\/([^/]+)\/content$/u);
  if (!shareSessionMatch && !shareEventsMatch && !shareReportContentMatch) {
    if (pathname.startsWith('/api/share/')) {
      writeJson(response, 404, { error: 'Not found' });
      return true;
    }
    return false;
  }
  if (!identityStore?.findShareByToken) {
    writeSessionNotFound(response);
    return true;
  }

  if (config.publicSharesEnabled !== true) {
    writeSessionNotFound(response);
    return true;
  }
  if (method !== 'GET') {
    writeJson(response, 404, { error: 'Not found' });
    return true;
  }
  const token = decodeURIComponent((shareSessionMatch?.[1] ?? shareEventsMatch?.[1] ?? shareReportContentMatch?.[1])!);
  const shareId = await identityStore.findShareByToken(token);
  if (!shareId) {
    writeSessionNotFound(response);
    return true;
  }
  const state = await identityStore.readState();
  if (state.settings.multiUserEnabled !== true) {
    writeSessionNotFound(response);
    return true;
  }
  const share = state.shares.find((item) => item.id === shareId && item.enabled !== false);
  const appSession = share ? state.sessions.find((item) => item.id === share.sessionId) : null;
  const sharePrincipal = share ? principalForShareCreator(state, share.createdByUserId) : null;
  const project = appSession ? findProject(state, appSession.projectId) : null;
  if (
    !share
    || !appSession
    || !sharePrincipal
    || !project
    || share.revokedAt !== null
    || typeof share.expiresAt !== 'string'
    || Date.parse(share.expiresAt) <= Date.now()
    || appSession.ownerUserId !== share.createdByUserId
    || project.enabled === false
    || !canReadWorkspaceAppSession(state, sharePrincipal, appSession)
  ) {
    writeSessionNotFound(response);
    return true;
  }
  if (shareEventsMatch) {
    const turnId = decodeURIComponent(shareEventsMatch[2]!);
    const threadId = runtime.threadIdForTurn?.(turnId);
    if (threadId !== appSession.codexThreadId) {
      writeSessionNotFound(response);
      return true;
    }
    await streamTurnEvents({
      request,
      response,
      runtime,
      turnId,
      afterId: normalizeLastEventId(url.searchParams.get('after'), request.headers['last-event-id']),
      requestedEpoch: normalizeEventEpoch(url.searchParams.get('epoch'), request.headers['x-codex-event-epoch']),
      registerSseCloser,
      audience: 'share',
    });
    return true;
  }
  const session = await runtime.readSession(appSession.codexThreadId);
  if (!session) {
    writeSessionNotFound(response);
    return true;
  }
  const presentedSession = presentSessionForUser({
    runtimeSession: session,
    appSession,
    project,
    includeOwnership: false,
    includeActivity: false,
    forceReadOnly: true,
    includeWorkDetails: false,
  });
  const reportStore = new FileReportStore({
    reportsDir: config.reportsDir,
    indexPath: config.reportIndexPath,
    beforeAccess: async () => {
      await maintainManagedStateStorage(config);
    },
  });
  const sharedReports = await reportsReferencedBySharedSession({
    reportStore,
    identityState: state,
    principal: sharePrincipal,
    project,
    presentedSession,
  });
  if (shareReportContentMatch) {
    const reportId = decodeURIComponent(shareReportContentMatch[2]!);
    const listedReport = sharedReports.find((report) => report.id === reportId);
    if (!listedReport) {
      writeReportNotFound(response);
      return true;
    }
    const content = await readReportContentForResponse(reportStore, reportId, response);
    if (!content) {
      return true;
    }
    if (content.report.id !== listedReport.id) {
      writeReportNotFound(response);
      return true;
    }
    writeJson(response, 200, {
      report: presentReportForUser(content.report),
      content: content.content,
    });
    return true;
  }
  writeJson(response, 200, {
    mode: 'share',
    session: presentedSession,
    reports: sharedReports.map((report) => presentReportForUser(report)),
  });
  return true;
}

function isShareAppRoute(pathname: string): boolean {
  return /^\/share\/[^/]+$/u.test(pathname);
}

function principalForShareCreator(
  state: CodexWebIdentityState,
  userId: string,
): CodexWebPrincipal | null {
  const user = state.users.find((item) => item.id === userId && item.enabled !== false);
  if (!user) {
    return null;
  }
  return {
    userId: user.id,
    username: user.username,
    roleIds: [...user.roleIds],
    isAdmin: user.roleIds.some((roleId) => state.roles.some((role) => role.id === roleId && role.isAdmin === true)),
    mode: 'multi',
  };
}

interface SessionSubmissionExecution {
  created: boolean;
  record: CodexWebSessionSubmissionRecord;
  response: Record<string, unknown>;
}

interface SessionSubmissionMetadata {
  source: 'webhook';
  clientRequestId: string;
  requestFingerprint: string;
  deliveryMode: WebhookDeliveryMode;
}

interface SessionSubmissionTarget {
  externalSessionId: string;
  runtimeSessionId: string;
  runtimeSession: CodexWebSession;
  appSession: CodexWebAppSession | null;
  project: CodexWebProject | null;
  identityState: CodexWebIdentityState | null;
}

async function handleSessionSubmissionEndpoint({
  request,
  response,
  pathname,
  method,
  url,
  principal,
  identityStore,
  identityState,
  runtime,
  config,
  sessionSubmissionStore,
  sessionSubmissionOperations,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  method: string;
  url: URL;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike | null;
  identityState: CodexWebIdentityState | null;
  runtime: CodexWebRuntime;
  config: CodexWebConfig;
  sessionSubmissionStore: FileSessionSubmissionStore;
  sessionSubmissionOperations: Map<string, Promise<SessionSubmissionExecution>>;
}): Promise<boolean> {
  if (pathname === '/api/session-submission-attachments' && method === 'POST') {
    const scope = await resolveSessionSubmissionAttachmentScope({
      url,
      principal,
      identityStore,
      identityState,
      config,
    });
    const items = await storeSessionAttachments({
      request,
      config,
      principal,
      projectCwd: scope.projectCwd,
      projectKey: scope.projectKey,
    });
    writeJson(response, 201, { items });
    return true;
  }

  if (pathname === '/api/session-submissions' && method === 'POST') {
    const execution = await submitSessionSubmission({
      body: await readJsonBody(request),
      forcedSessionId: null,
      principal,
      identityStore,
      identityState,
      runtime,
      config,
      store: sessionSubmissionStore,
      operations: sessionSubmissionOperations,
    });
    writeJson(response, execution.created ? 201 : 200, execution.response);
    return true;
  }

  const match = pathname.match(/^\/api\/session-submissions\/([^/]+)$/u);
  if (match && method === 'GET') {
    const submissionId = normalizeSessionSubmissionId(decodeURIComponent(match[1]!));
    const record = await sessionSubmissionStore.read(principal.userId, submissionId);
    if (!record) {
      throw createHttpError(404, 'submission_not_found', 'Session submission was not found.');
    }
    const execution = await runSessionSubmissionOperation({
      operations: sessionSubmissionOperations,
      store: sessionSubmissionStore,
      ownerUserId: principal.userId,
      submissionId,
      payloadHash: record.payloadHash,
      operation: () => advanceSessionSubmission({
        record,
        created: false,
        principal,
        identityStore,
        identityState,
        runtime,
        config,
        store: sessionSubmissionStore,
      }),
    });
    writeJson(response, 200, execution.response);
    return true;
  }
  return false;
}

async function resolveSessionSubmissionAttachmentScope({
  url,
  principal,
  identityStore,
  identityState,
  config,
}: {
  url: URL;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike | null;
  identityState: CodexWebIdentityState | null;
  config: CodexWebConfig;
}): Promise<{ projectCwd: string; projectKey: string }> {
  if (isMultiUserSubmission(identityState, principal)) {
    if (!identityStore || !identityState) {
      throw createHttpError(503, 'identity_store_unavailable', 'Multi-user identity state is unavailable.');
    }
    const freshState = await identityStore.readState();
    const projectId = normalizeOptionalString(url.searchParams.get('projectId'));
    const project = findProject(freshState, projectId);
    if (!project || !canCreateSubmissionInProject(freshState, principal, project)) {
      throw createHttpError(404, 'project_not_found', 'Project was not found.');
    }
    return {
      projectCwd: project.cwd,
      projectKey: safePathSegment(project.id),
    };
  }
  const projectCwd = normalizeOptionalString(url.searchParams.get('cwd'))
    || normalizeOptionalString(config.defaultCwd);
  return {
    projectCwd,
    projectKey: `cwd-${stableIdHash(projectCwd || 'unknown', 16)}`,
  };
}

function hasSessionSubmissionIdField(body: Record<string, unknown>): boolean {
  return body.submissionId !== undefined;
}

async function submitSessionSubmission({
  body,
  forcedSessionId,
  principal,
  identityStore,
  identityState,
  runtime,
  config,
  store,
  operations,
  metadata,
  submissionDeliveryMode,
}: {
  body: Record<string, unknown>;
  forcedSessionId: string | null;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike | null;
  identityState: CodexWebIdentityState | null;
  runtime: CodexWebRuntime;
  config: CodexWebConfig;
  store: FileSessionSubmissionStore;
  operations: Map<string, Promise<SessionSubmissionExecution>>;
  metadata?: SessionSubmissionMetadata;
  submissionDeliveryMode?: WebhookDeliveryMode;
}): Promise<SessionSubmissionExecution> {
  const submissionId = normalizeSessionSubmissionId(body.submissionId);
  const payload = normalizeSessionSubmissionPayload(body, forcedSessionId);
  const payloadHash = hashSessionSubmissionPayload(payload);
  return runSessionSubmissionOperation({
    operations,
    store,
    ownerUserId: principal.userId,
    submissionId,
    payloadHash,
    operation: async () => {
      const now = new Date().toISOString();
      const createdRecord = await store.create({
        id: submissionId,
        ownerUserId: principal.userId,
        payloadHash,
        payload,
        status: 'queued',
        sessionId: payload.sessionId,
        runtimeSessionId: null,
        turnBaseline: null,
        turnId: null,
        result: null,
        error: null,
        ...(submissionDeliveryMode ? { deliveryMode: submissionDeliveryMode } : {}),
        ...(metadata ?? {}),
        createdAt: now,
        updatedAt: now,
      });
      const conflicts = metadata
        ? createdRecord.record.requestFingerprint !== metadata.requestFingerprint
        : createdRecord.record.payloadHash !== payloadHash;
      if (conflicts) {
        throw createHttpError(
          409,
          'submission_conflict',
          metadata
            ? 'This clientRequestId was already used with different request content.'
            : 'This submission id was already used with different content.',
        );
      }
      return advanceSessionSubmission({
        record: createdRecord.record,
        created: createdRecord.created,
        principal,
        identityStore,
        identityState,
        runtime,
        config,
        store,
      });
    },
  });
}

async function runSessionSubmissionOperation({
  operations,
  store,
  ownerUserId,
  submissionId,
  payloadHash,
  operation,
}: {
  operations: Map<string, Promise<SessionSubmissionExecution>>;
  store: FileSessionSubmissionStore;
  ownerUserId: string;
  submissionId: string;
  payloadHash: string;
  operation: () => Promise<SessionSubmissionExecution>;
}): Promise<SessionSubmissionExecution> {
  const key = `${ownerUserId}\0${submissionId}\0${payloadHash}`;
  const current = operations.get(key);
  if (current) {
    return current;
  }
  const promise = store.withSubmissionOperationLock(ownerUserId, submissionId, operation).finally(() => {
    if (operations.get(key) === promise) {
      operations.delete(key);
    }
  });
  operations.set(key, promise);
  return promise;
}

async function advanceSessionSubmission({
  record,
  created,
  principal,
  identityStore,
  identityState,
  runtime,
  config,
  store,
}: {
  record: CodexWebSessionSubmissionRecord;
  created: boolean;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike | null;
  identityState: CodexWebIdentityState | null;
  runtime: CodexWebRuntime;
  config: CodexWebConfig;
  store: FileSessionSubmissionStore;
}): Promise<SessionSubmissionExecution> {
  let current = await store.read(record.ownerUserId, record.id) ?? record;
  try {
    if (current.status === 'submitted' || (current.status === 'failed' && current.error?.retryable !== true)) {
      await authorizeStoredSessionSubmission({
        record: current,
        principal,
        identityStore,
        identityState,
        runtime,
        intent: 'read',
      });
      return {
        created,
        record: current,
        response: await presentSessionSubmissionResponse({ current, principal, identityStore, identityState, runtime }),
      };
    }

    let target = await resolveSessionSubmissionTarget({
      record: current,
      principal,
      identityStore,
      identityState,
      runtime,
      store,
    });
    current = await store.read(record.ownerUserId, record.id) ?? current;
    if (!target) {
      current = await store.update(current.ownerUserId, current.id, (value) => ({
        ...value,
        status: 'creating',
        sessionId: isMultiUserSubmission(identityState, principal)
          ? value.sessionId ?? crypto.randomUUID()
          : value.sessionId,
        error: null,
        updatedAt: new Date().toISOString(),
      }));
      target = await createSessionForSubmission({
        record: current,
        principal,
        identityStore,
        identityState,
        runtime,
        config,
        store,
      });
      current = await store.read(record.ownerUserId, record.id) ?? current;
    }

    const recoveredTurnId = shouldRecoverSessionSubmission(current)
      ? recoverSubmittedTurnId(target.runtimeSession, current)
      : null;
    if (recoveredTurnId) {
      current = await markSessionSubmissionTurnSubmitted(store, current, recoveredTurnId);
      return {
        created,
        record: current,
        response: await presentSessionSubmissionResponse({ current, principal, identityStore, identityState, runtime }),
      };
    }

    const turnBody: Record<string, unknown> = {
      text: current.payload.text,
      settings: current.payload.settings,
      attachments: current.payload.attachments,
      attachmentIds: current.payload.attachmentIds,
    };
    const multiUser = isMultiUserSubmission(target.identityState ?? identityState, principal);
    const projectCwd = normalizeOptionalString(target.project?.cwd) || normalizeOptionalString(target.runtimeSession.cwd);
    const input = await normalizeStartTurnInput({
      body: turnBody,
      config,
      principal,
      runtime,
      sessionId: target.runtimeSessionId,
      projectCwd,
      projectKey: multiUser
        ? safePathSegment(target.project?.id || target.appSession?.projectId || `cwd-${stableIdHash(projectCwd, 16)}`)
        : '',
    });
    if (!input) {
      throw createHttpError(404, 'session_not_found', 'Session was not found.');
    }
    if (multiUser && target.appSession) {
      const runtimeContext = await projectCodexWebRuntimeContext({
        config,
        runtime,
        appSession: target.appSession,
        user: target.identityState?.users.find((item) => item.id === target.appSession?.ownerUserId) ?? null,
        project: target.project,
      });
      input.developerInstructions = runtimeContext.developerInstructions;
      input.runtimeEnv = runtimeContext.runtimeEnv;
    }
    const baselineSession = await runtime.readSession(target.runtimeSessionId) ?? target.runtimeSession;
    const baselineActiveTurnId = normalizeOptionalString(baselineSession.activeTurnId);
    if (current.deliveryMode === 'reject_if_busy' && baselineActiveTurnId) {
      throw createSessionBusyError(baselineActiveTurnId);
    }
    const activeTurnId = sessionSubmissionCanSteerActiveTurn(current)
      ? baselineActiveTurnId
      : '';
    current = await store.update(current.ownerUserId, current.id, (value) => ({
      ...value,
      status: 'starting',
      sessionId: target!.externalSessionId,
      runtimeSessionId: target!.runtimeSessionId,
      operation: activeTurnId ? 'steer' : 'start',
      turnBaseline: activeTurnId ? [] : sessionTurnIds(baselineSession),
      error: null,
      updatedAt: new Date().toISOString(),
    }));

    let result: CodexWebStartTurnResult;
    if (activeTurnId) {
      result = await runtime.steerTurnForThread(
        target.runtimeSessionId,
        activeTurnId,
        input,
        current.id,
      );
    } else {
      try {
        result = await runtime.startTurn(target.runtimeSessionId, input);
      } catch (error) {
        const normalizedStartError = normalizeSubmissionExecutionError(error);
        if (current.deliveryMode === 'reject_if_busy' && normalizedStartError.code === 'turn_conflict') {
          const racedSession = await runtime.readSession(target.runtimeSessionId).catch(() => null);
          const racedTurnId = normalizeOptionalString(normalizedStartError.activeTurnId)
            || normalizeOptionalString(racedSession?.activeTurnId);
          if (racedTurnId) {
            throw createSessionBusyError(racedTurnId);
          }
        }
        const recoveredSession = isUncertainSubmissionStartError(normalizedStartError)
          ? await runtime.readSession(target.runtimeSessionId).catch(() => null)
          : null;
        const recoveredAfterError = recoveredSession
          ? recoverSubmittedTurnId(recoveredSession, current)
          : null;
        if (recoveredAfterError) {
          current = await markSessionSubmissionTurnSubmitted(store, current, recoveredAfterError);
          return {
            created,
            record: current,
            response: await presentSessionSubmissionResponse({ current, principal, identityStore, identityState, runtime }),
          };
        }
        throw error;
      }
    }

    const presentedResult = presentSubmissionTurnResult({
      result,
      target,
      principal,
    });
    current = await store.update(current.ownerUserId, current.id, (value) => ({
      ...value,
      status: 'submitted',
      turnId: normalizeOptionalString(result.turnId) || null,
      result: presentedResult,
      turnBaseline: null,
      payload: redactSubmittedPayload(value.payload),
      error: null,
      updatedAt: new Date().toISOString(),
    }));
    if (target.appSession && identityStore) {
      await identityStore.upsertSession({
        ...target.appSession,
        updatedAt: new Date().toISOString(),
      });
    }
    return {
      created,
      record: current,
      response: await presentSessionSubmissionResponse({ current, principal, identityStore, identityState, runtime }),
    };
  } catch (error) {
    const normalizedError = normalizeSubmissionExecutionError(error);
    const stored = await store.read(record.ownerUserId, record.id);
    if (stored && stored.status !== 'submitted' && !isSubmissionAuthorizationError(normalizedError)) {
      const retryable = isRetryableSubmissionError(normalizedError);
      const outcomeUnknown = isUncertainSubmissionStartError(normalizedError)
        && Array.isArray(stored.turnBaseline);
      current = await store.update(stored.ownerUserId, stored.id, (value) => ({
        ...value,
        status: 'failed',
        turnBaseline: outcomeUnknown ? value.turnBaseline : null,
        error: {
          code: normalizedError.code,
          message: normalizedError.message,
          retryable,
          outcomeUnknown,
          ...(normalizedError.activeTurnId ? { activeTurnId: normalizedError.activeTurnId } : {}),
        },
        updatedAt: new Date().toISOString(),
      }));
    }
    throw normalizedError;
  }
}

async function resolveSessionSubmissionTarget({
  record,
  principal,
  identityStore,
  identityState,
  runtime,
  store,
}: {
  record: CodexWebSessionSubmissionRecord;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike | null;
  identityState: CodexWebIdentityState | null;
  runtime: CodexWebRuntime;
  store: FileSessionSubmissionStore;
}): Promise<SessionSubmissionTarget | null> {
  const multiUser = isMultiUserSubmission(identityState, principal);
  const requestedSessionId = record.payload.sessionId;
  if (requestedSessionId) {
    if (multiUser) {
      if (!identityStore || !identityState) {
        throw createHttpError(503, 'identity_store_unavailable', 'Multi-user identity state is unavailable.');
      }
      const freshState = await identityStore.readState();
      const resolved = resolveWritableAppSession(freshState, principal, requestedSessionId);
      if (!resolved) {
        throw createHttpError(404, 'session_not_found', 'Session was not found.');
      }
      if (resolved.appSession.archived) {
        throw createHttpError(409, 'session_archived', 'Unarchive this session before making changes.');
      }
      const runtimeSession = await runtime.readSession(resolved.appSession.codexThreadId);
      if (!runtimeSession) {
        throw createHttpError(404, 'session_not_found', 'Session was not found.');
      }
      return {
        externalSessionId: resolved.appSession.id,
        runtimeSessionId: resolved.appSession.codexThreadId,
        runtimeSession,
        appSession: resolved.appSession,
        project: resolved.project,
        identityState: freshState,
      };
    }
    const isArchived = await (runtime as ArchiveCapableRuntime).isSessionArchived?.(requestedSessionId);
    if (isArchived) {
      throw createHttpError(409, 'session_archived', 'Unarchive this session before making changes.');
    }
    const runtimeSession = await runtime.readSession(requestedSessionId);
    if (!runtimeSession) {
      throw createHttpError(404, 'session_not_found', 'Session was not found.');
    }
    return {
      externalSessionId: requestedSessionId,
      runtimeSessionId: requestedSessionId,
      runtimeSession,
      appSession: null,
      project: null,
      identityState: null,
    };
  }

  if (!record.runtimeSessionId) {
    await authorizeStoredSessionSubmission({ record, principal, identityStore, identityState, runtime, intent: 'execute' });
    return null;
  }
  if (!multiUser) {
    const runtimeSession = await runtime.readSession(record.runtimeSessionId);
    if (!runtimeSession) {
      throw createHttpError(404, 'session_not_found', 'Session was not found.');
    }
    return {
      externalSessionId: record.sessionId ?? record.runtimeSessionId,
      runtimeSessionId: record.runtimeSessionId,
      runtimeSession,
      appSession: null,
      project: null,
      identityState: null,
    };
  }
  if (!identityStore || !identityState || !record.sessionId) {
    throw createHttpError(503, 'identity_store_unavailable', 'Multi-user identity state is unavailable.');
  }
  const freshState = await identityStore.readState();
  let appSession = findAppSessionByExternalId(freshState, record.sessionId);
  let project = appSession
    ? findProject(freshState, appSession.projectId)
    : findProject(freshState, record.payload.projectId ?? '');
  if (!appSession) {
    if (!project || !canCreateSubmissionInProject(freshState, principal, project)) {
      throw createHttpError(404, 'session_not_found', 'Session was not found.');
    }
    const now = new Date().toISOString();
    appSession = await identityStore.upsertSession({
      id: record.sessionId,
      codexThreadId: record.runtimeSessionId,
      projectId: project.id,
      ownerUserId: principal.userId,
      createdAt: record.createdAt || now,
      updatedAt: now,
      archived: false,
      archivedAt: null,
      archivedByUserId: null,
      archiveSource: null,
    });
    project = findProject(await identityStore.readState(), appSession.projectId);
  }
  if (!canWriteResolvedAppSession(await identityStore.readState(), principal, appSession)) {
    throw createHttpError(404, 'session_not_found', 'Session was not found.');
  }
  const runtimeSession = await runtime.readSession(record.runtimeSessionId);
  if (!runtimeSession) {
    throw createHttpError(404, 'session_not_found', 'Session was not found.');
  }
  await store.update(record.ownerUserId, record.id, (value) => ({
    ...value,
    status: 'starting',
    updatedAt: new Date().toISOString(),
  }));
  return {
    externalSessionId: appSession.id,
    runtimeSessionId: appSession.codexThreadId,
    runtimeSession,
    appSession,
    project,
    identityState: await identityStore.readState(),
  };
}

async function createSessionForSubmission({
  record,
  principal,
  identityStore,
  identityState,
  runtime,
  config,
  store,
}: {
  record: CodexWebSessionSubmissionRecord;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike | null;
  identityState: CodexWebIdentityState | null;
  runtime: CodexWebRuntime;
  config: CodexWebConfig;
  store: FileSessionSubmissionStore;
}): Promise<SessionSubmissionTarget> {
  const multiUser = isMultiUserSubmission(identityState, principal);
  if (!multiUser) {
    const runtimeSession = await runtime.createSession({
      cwd: record.payload.cwd,
      title: record.payload.title,
      settings: record.payload.settings,
    });
    await store.update(record.ownerUserId, record.id, (value) => ({
      ...value,
      sessionId: runtimeSession.id,
      runtimeSessionId: runtimeSession.id,
      status: 'starting',
      updatedAt: new Date().toISOString(),
    }));
    return {
      externalSessionId: runtimeSession.id,
      runtimeSessionId: runtimeSession.id,
      runtimeSession,
      appSession: null,
      project: null,
      identityState: null,
    };
  }
  if (!identityStore || !identityState || !record.sessionId) {
    throw createHttpError(503, 'identity_store_unavailable', 'Multi-user identity state is unavailable.');
  }
  return store.withSessionCreationOperationLock(
    principal.userId,
    record.payload.projectId ?? '',
    async () => {
      const freshState = await identityStore.readState();
      const project = findProject(freshState, record.payload.projectId ?? '');
      if (!project || !canCreateSubmissionInProject(freshState, principal, project)) {
        throw createHttpError(404, 'session_not_found', 'Session was not found.');
      }
      if (!principal.isAdmin) {
        const activeSessionLimit = activeSessionLimitForProject(project);
        if (activeSessionLimit !== null && countActiveSessions(freshState, principal.userId, project.id) >= activeSessionLimit) {
          throw createHttpError(409, 'active_session_limit_reached', 'Archive an existing session before creating a new one.');
        }
      }
      const runtimeSession = await runtime.createSession({
        title: record.payload.title,
        settings: record.payload.settings,
        cwd: project.cwd,
        runtimeEnv: codexWebRuntimeContextEnvironment(config, record.sessionId!),
      });
      const updatedRecord = await store.update(record.ownerUserId, record.id, (value) => ({
        ...value,
        runtimeSessionId: runtimeSession.id,
        status: 'creating',
        updatedAt: new Date().toISOString(),
      }));
      const now = new Date().toISOString();
      const appSession = await identityStore.upsertSession({
        id: updatedRecord.sessionId!,
        codexThreadId: runtimeSession.id,
        projectId: project.id,
        ownerUserId: principal.userId,
        createdAt: now,
        updatedAt: now,
        archived: false,
        archivedAt: null,
        archivedByUserId: null,
        archiveSource: null,
      });
      await store.update(record.ownerUserId, record.id, (value) => ({
        ...value,
        status: 'starting',
        updatedAt: new Date().toISOString(),
      }));
      return {
        externalSessionId: appSession.id,
        runtimeSessionId: runtimeSession.id,
        runtimeSession,
        appSession,
        project,
        identityState: await identityStore.readState(),
      };
    }
  );
}

async function authorizeStoredSessionSubmission({
  record,
  principal,
  identityStore,
  identityState,
  runtime,
  intent,
}: {
  record: CodexWebSessionSubmissionRecord;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike | null;
  identityState: CodexWebIdentityState | null;
  runtime: CodexWebRuntime;
  intent: 'read' | 'execute';
}): Promise<void> {
  if (!isMultiUserSubmission(identityState, principal)) {
    const runtimeSessionId = record.runtimeSessionId ?? record.payload.sessionId;
    if (runtimeSessionId && !await runtime.readSession(runtimeSessionId)) {
      throw createHttpError(404, 'submission_not_found', 'Session submission was not found.');
    }
    return;
  }
  if (!identityStore || !identityState) {
    throw createHttpError(503, 'identity_store_unavailable', 'Multi-user identity state is unavailable.');
  }
  const freshState = await identityStore.readState();
  const externalSessionId = record.payload.sessionId
    ?? (record.runtimeSessionId ? record.sessionId : null);
  if (externalSessionId) {
    const appSession = findAppSessionByExternalId(freshState, externalSessionId);
    const allowed = appSession && (intent === 'read'
      ? canReadWorkspaceAppSession(freshState, principal, appSession)
      : canWriteResolvedAppSession(freshState, principal, appSession));
    if (!allowed) {
      throw createHttpError(404, 'submission_not_found', 'Session submission was not found.');
    }
    return;
  }
  const project = findProject(freshState, record.payload.projectId ?? '');
  if (!project || !canCreateSubmissionInProject(freshState, principal, project)) {
    throw createHttpError(404, 'submission_not_found', 'Session submission was not found.');
  }
}

function canCreateSubmissionInProject(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  project: CodexWebProject,
): boolean {
  return principal.isAdmin || (project.enabled !== false && canCreateProjectSession(state, principal, project.id));
}

function isMultiUserSubmission(
  identityState: CodexWebIdentityState | null,
  principal: CodexWebPrincipal,
): boolean {
  return principal.mode === 'multi' || identityState?.settings.multiUserEnabled === true;
}

function presentSubmissionTurnResult({
  result,
  target,
  principal,
}: {
  result: CodexWebStartTurnResult;
  target: SessionSubmissionTarget;
  principal: CodexWebPrincipal;
}): Record<string, unknown> {
  if (!('type' in result)) {
    return { turnId: result.turnId };
  }
  let presented: Record<string, unknown>;
  if (target.appSession) {
    presented = presentStartTurnResultForUser({
      result,
      appSession: target.appSession,
      project: target.project,
      includeWorkDetails: canViewProjectWorkDetails(principal, target.project),
    });
  } else {
    presented = result as unknown as Record<string, unknown>;
  }
  const { session: _session, ...durableResult } = presented;
  return durableResult;
}

function shouldRecoverSessionSubmission(submission: CodexWebSessionSubmissionRecord): boolean {
  return Array.isArray(submission.turnBaseline)
    && (
      submission.status === 'starting'
      || (submission.status === 'failed' && submission.error?.outcomeUnknown === true)
    );
}

function recoverSubmittedTurnId(
  session: CodexWebSession,
  submission: CodexWebSessionSubmissionRecord,
): string | null {
  if (!Array.isArray(submission.turnBaseline)) {
    return null;
  }
  const turns = Array.isArray(session.thread?.turns) ? session.thread.turns : [];
  if (submission.operation === 'steer') {
    for (const turn of [...turns].reverse()) {
      const turnId = normalizeOptionalString(turn?.id);
      if (turnId && turnContainsSubmissionClientMessage(turn, submission.id)) {
        return turnId;
      }
    }
    return null;
  }
  const expectedText = summarizeCodexWebSessionInputText(submission.payload.text);
  if (!expectedText) {
    return null;
  }
  const baseline = new Set(submission.turnBaseline);
  for (const turn of [...turns].reverse()) {
    const turnId = normalizeOptionalString(turn?.id);
    if (!turnId || baseline.has(turnId)) {
      continue;
    }
    if (turnMatchesSubmissionInput(turn, submission)) {
      return turnId;
    }
  }
  const activeTurnId = normalizeOptionalString(session.activeTurnId);
  if (
    activeTurnId
    && !baseline.has(activeTurnId)
    && sessionSummaryMatchesSubmissionInput(session.lastUserInput, submission)
  ) {
    return activeTurnId;
  }
  return null;
}

function turnContainsSubmissionClientMessage(
  turn: NonNullable<CodexWebSession['thread']['turns']>[number],
  submissionId: string,
): boolean {
  return (turn.items ?? []).some((item) => (
    typeof item.raw?.clientId === 'string' && item.raw.clientId === submissionId
  ));
}

function turnMatchesSubmissionInput(
  turn: NonNullable<CodexWebSession['thread']['turns']>[number],
  submission: CodexWebSessionSubmissionRecord,
): boolean {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (const item of [...items].reverse()) {
    if (normalizeOptionalString(item?.role).toLowerCase() !== 'user') {
      continue;
    }
    const actual = normalizeSubmissionInputText(item.text);
    const expected = normalizeSubmissionInputText(submission.payload.text);
    if (actual === expected) {
      return true;
    }
    if (
      submission.payload.attachments.length > 0
      && expected
      && actual.startsWith(`${expected} Attachments:`)
    ) {
      return true;
    }
  }
  return false;
}

function sessionSummaryMatchesSubmissionInput(
  actualSummary: string | null | undefined,
  submission: CodexWebSessionSubmissionRecord,
): boolean {
  const actual = normalizeSubmissionInputText(actualSummary);
  const expectedSummary = summarizeCodexWebSessionInputText(submission.payload.text);
  if (!actual || !expectedSummary) {
    return false;
  }
  if (actual === expectedSummary) {
    return true;
  }
  const expected = normalizeSubmissionInputText(submission.payload.text);
  return submission.payload.attachments.length > 0
    && expected.length < 237
    && actual.startsWith(`${expected} Attachments:`);
}

function normalizeSubmissionInputText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function sessionTurnIds(session: CodexWebSession): string[] {
  const ids = new Set<string>();
  for (const turn of session.thread?.turns ?? []) {
    const turnId = normalizeOptionalString(turn?.id);
    if (turnId) {
      ids.add(turnId);
    }
  }
  const activeTurnId = normalizeOptionalString(session.activeTurnId);
  if (activeTurnId) {
    ids.add(activeTurnId);
  }
  return [...ids];
}

async function markSessionSubmissionTurnSubmitted(
  store: FileSessionSubmissionStore,
  submission: CodexWebSessionSubmissionRecord,
  turnId: string,
): Promise<CodexWebSessionSubmissionRecord> {
  return store.update(submission.ownerUserId, submission.id, (value) => ({
    ...value,
    status: 'submitted',
    turnBaseline: null,
    turnId,
    result: { turnId },
    payload: redactSubmittedPayload(value.payload),
    error: null,
    updatedAt: new Date().toISOString(),
  }));
}

function redactSubmittedPayload(
  payload: CodexWebSessionSubmissionPayload,
): CodexWebSessionSubmissionPayload {
  return {
    sessionId: payload.sessionId,
    projectId: payload.projectId,
    cwd: null,
    title: null,
    settings: {},
    text: '',
    attachments: [],
    attachmentIds: [],
  };
}

async function presentSessionSubmissionResponse({
  current,
  principal,
  identityStore,
  identityState,
  runtime,
}: {
  current: CodexWebSessionSubmissionRecord;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike | null;
  identityState: CodexWebIdentityState | null;
  runtime: CodexWebRuntime;
}): Promise<Record<string, unknown>> {
  let session: unknown = null;
  if (current.runtimeSessionId) {
    // Session details are optional response enrichment; a transient read failure
    // must not turn an already-persisted submission into an HTTP failure.
    const runtimeSession = await runtime.readSession(current.runtimeSessionId).catch((error) => {
      writeInternalWarning({
        code: 'session_response_hydration_failed',
        message: error instanceof Error ? error.message : String(error),
        context: {
          submissionId: current.id,
          runtimeSessionId: current.runtimeSessionId!,
        },
      });
      return null;
    });
    if (runtimeSession) {
      if (isMultiUserSubmission(identityState, principal) && identityStore && current.sessionId) {
        const freshState = await identityStore.readState();
        const appSession = findAppSessionByExternalId(freshState, current.sessionId);
        if (appSession && canReadWorkspaceAppSession(freshState, principal, appSession)) {
          const project = findProject(freshState, appSession.projectId);
          session = presentSessionForUser({
            runtimeSession,
            appSession,
            project,
            includeWorkDetails: canViewProjectWorkDetails(principal, project),
          });
        }
      } else {
        session = runtimeSession;
      }
    }
  }
  const submission = {
    id: current.id,
    status: current.status,
    sessionId: current.sessionId,
    turnId: current.turnId,
    error: current.error,
    ...(current.result ? { result: current.result } : {}),
  };
  return {
    submission,
    ...(session ? { session } : {}),
    ...(current.turnId ? { turnId: current.turnId } : {}),
    ...(current.result?.type === 'command' ? current.result : current.result ? { result: current.result } : {}),
  };
}

function normalizeSessionSubmissionId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) {
    throw createHttpError(
      400,
      'invalid_submission_id',
      'submissionId must use 1-128 letters, numbers, dots, underscores, colons, or dashes.',
    );
  }
  return id;
}

function sessionSubmissionCanSteerActiveTurn(submission: CodexWebSessionSubmissionRecord): boolean {
  return Boolean(submission.payload.sessionId)
    && !isCodexWebSlashCommandText(submission.payload.text);
}

function normalizeSessionSubmissionPayload(
  body: Record<string, unknown>,
  forcedSessionId: string | null,
): CodexWebSessionSubmissionPayload {
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) {
    throw createHttpError(400, 'invalid_submission', 'text is required');
  }
  const bodySessionId = normalizeOptionalString(body.sessionId) || null;
  if (forcedSessionId && bodySessionId && bodySessionId !== forcedSessionId) {
    throw createHttpError(400, 'invalid_submission', 'sessionId must match the session in the request path.');
  }
  const sessionId = forcedSessionId || bodySessionId;
  const projectId = normalizeOptionalString(body.projectId) || null;
  const cwd = normalizeOptionalString(body.cwd) || null;
  const title = normalizeOptionalString(body.title) || null;
  if (sessionId && (projectId || cwd || title)) {
    throw createHttpError(
      400,
      'invalid_submission',
      'sessionId cannot be combined with projectId, cwd, or title.',
    );
  }
  if (body.settings !== undefined && (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings))) {
    throw createHttpError(400, 'invalid_submission', 'settings must be an object.');
  }
  if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
    throw createHttpError(400, 'invalid_submission', 'attachments must be an array.');
  }
  if (body.attachmentIds !== undefined && !Array.isArray(body.attachmentIds)) {
    throw createHttpError(400, 'invalid_submission', 'attachmentIds must be an array.');
  }
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : [];
  if (Array.isArray(body.attachmentIds) && attachmentIds.length !== body.attachmentIds.length) {
    throw createHttpError(400, 'invalid_submission', 'attachmentIds must contain non-empty strings.');
  }
  return {
    sessionId,
    projectId,
    cwd,
    title,
    settings: body.settings as Record<string, unknown> | undefined ?? {},
    text,
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    attachmentIds,
  };
}

function normalizeSubmissionExecutionError(error: unknown): HttpError {
  if (isHttpError(error)) {
    return error;
  }
  if (isSessionNotFoundError(error)) {
    return createHttpError(404, 'session_not_found', error instanceof Error ? error.message : 'Session was not found.');
  }
  if (isActiveTurnNotSteerableError(error)) {
    return createHttpError(
      409,
      'active_turn_not_steerable',
      error instanceof Error ? error.message : 'The active turn cannot accept steering input.',
    );
  }
  if (isSteerTurnConflictError(error)) {
    return createHttpError(409, 'turn_conflict', error instanceof Error ? error.message : 'The active turn changed.');
  }
  if (isTurnConflictError(error)) {
    const activeTurnId = extractActiveTurnId(error);
    if (activeTurnId) {
      return createTurnConflictHttpError(error, activeTurnId);
    }
    return createHttpError(409, 'turn_conflict', error instanceof Error ? error.message : 'A turn is already running.');
  }
  return createHttpError(
    500,
    'submission_failed',
    error instanceof Error ? error.message : String(error || 'Session submission failed.'),
  );
}

function isRetryableSubmissionError(error: HttpError): boolean {
  return error.statusCode >= 500
    || error.code === 'turn_conflict'
    || error.code === 'session_busy'
    || error.code === 'active_turn_not_steerable'
    || error.code === 'session_archived'
    || error.code === 'active_session_limit_reached';
}

function createTurnConflictHttpError(error: unknown, activeTurnId: string): HttpError {
  const normalized = createHttpError(
    409,
    'turn_conflict',
    error instanceof Error ? error.message : 'A turn is already running.',
  );
  normalized.activeTurnId = activeTurnId;
  return normalized;
}

function createSessionBusyError(activeTurnId: string): HttpError {
  const error = createHttpError(409, 'session_busy', 'The session already has an active turn.');
  error.activeTurnId = activeTurnId;
  error.retryable = true;
  return error;
}

function isUncertainSubmissionStartError(error: HttpError): boolean {
  return error.statusCode >= 500;
}

function isSubmissionAuthorizationError(error: HttpError): boolean {
  return error.code === 'submission_not_found'
    || error.code === 'session_not_found'
    || error.code === 'identity_store_unavailable';
}

async function handleMultiUserRequest({
  request,
  response,
  pathname,
  method,
  url,
  authContext,
  auth,
  principal,
  identityStore,
  identityState,
  runtime,
  config,
  sessionFileStore,
  sessionSubmissionStore,
  sessionSubmissionOperations,
  registerSseCloser,
  closeSseConnections,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  method: string;
  url: URL;
  authContext: AuthenticatedRequestContext;
  auth: CodexWebAuthLike;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike;
  identityState: CodexWebIdentityState;
  runtime: CodexWebRuntime;
  config: CodexWebConfig;
  sessionFileStore: FileSessionFileStore;
  sessionSubmissionStore: FileSessionSubmissionStore;
  sessionSubmissionOperations: Map<string, Promise<SessionSubmissionExecution>>;
  registerSseCloser: (close: () => void) => () => void;
  closeSseConnections: () => void;
}): Promise<boolean> {
  if (pathname === '/api/auth/me' || pathname === '/api/auth/logout') {
    return false;
  }

  if (pathname === '/api/settings' && method === 'GET') {
    writeJson(response, 200, publicSettingsPayload(identityState, principal, config));
    return true;
  }

  if (pathname === '/api/settings' && method === 'PATCH') {
    if (!principal.isAdmin) {
      writeJson(response, 403, { error: 'forbidden' });
      return true;
    }
    if (typeof identityStore.setSiteTitle !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const updatedState = await identityStore.setSiteTitle(String(body.siteTitle ?? ''));
    writeJson(response, 200, publicSettingsPayload(updatedState, principal, config));
    return true;
  }

  if (pathname === '/api/health' && method === 'GET') {
    writeJson(response, 200, { ok: true, host: config.host, port: config.port });
    return true;
  }

  if (pathname === '/api/models' && method === 'GET') {
    writeJson(response, 200, await readModelSettingsPayload(runtime));
    return true;
  }

  if (pathname === '/api/usage' && method === 'GET') {
    if (!principal.isAdmin) {
      writeJson(response, 403, { error: 'forbidden' });
      return true;
    }
    writeJson(response, 200, { usage: await runtime.readUsage() });
    return true;
  }

  if (pathname === '/api/runtime/reload' && method === 'POST') {
    if (!principal.isAdmin) {
      writeJson(response, 403, { error: 'forbidden' });
      return true;
    }
    const result = await runtime.reloadRuntime();
    writeJson(response, 200, { ok: true, ...result });
    return true;
  }

  const reportStore = new FileReportStore({
    reportsDir: config.reportsDir,
    indexPath: config.reportIndexPath,
    beforeAccess: async () => {
      await maintainManagedStateStorage(config);
    },
  });

  if (pathname === '/api/reports' && method === 'GET') {
    const items = (await reportStore.listReports())
      .filter((report) => canReadReport(identityState, principal, report))
      .map((report) => presentReportForUser(report));
    writeJson(response, 200, { items });
    return true;
  }

  if (pathname === '/api/reports/resolve' && method === 'POST') {
    const body = await readJsonBody(request);
    const inputPath = typeof body.path === 'string' ? body.path : '';
    if (!inputPath.trim()) {
      writeJson(response, 400, { error: 'invalid_report_path', message: 'path is required' });
      return true;
    }
    const report = await resolveReportForResponse(reportStore, inputPath, response);
    if (!report) {
      return true;
    }
    if (!canReadReport(identityState, principal, report)) {
      writeReportNotFound(response);
      return true;
    }
    writeJson(response, 200, { report: presentReportForUser(report) });
    return true;
  }

  const reportContentMatch = pathname.match(/^\/api\/reports\/([^/]+)\/content$/u);
  if (reportContentMatch && method === 'GET') {
    const reportId = decodeURIComponent(reportContentMatch[1]!);
    const content = await readReportContentForResponse(reportStore, reportId, response);
    if (!content) {
      return true;
    }
    if (!canReadReport(identityState, principal, content.report)) {
      writeReportNotFound(response);
      return true;
    }
    writeJson(response, 200, {
      report: presentReportForUser(content.report),
      content: content.content,
    });
    return true;
  }

  const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)$/u);
  if (reportMatch && method === 'GET') {
    const report = await readReportForResponse(
      () => reportStore.readReport(decodeURIComponent(reportMatch[1]!)),
      response,
    );
    if (!report) {
      return true;
    }
    if (!canReadReport(identityState, principal, report)) {
      writeReportNotFound(response);
      return true;
    }
    writeJson(response, 200, { report: presentReportForUser(report) });
    return true;
  }

  if (pathname === '/api/projects' && method === 'GET') {
    const favoriteProjectIds = favoriteProjectIdsForPrincipal(identityState, principal);
    const items = identityState.projects
      .filter((project) => (
        principal.isAdmin
        || (project.enabled !== false && canReadProject(identityState, principal, project.id))
      ))
      .map((project) => ({
        id: project.id,
        displayName: projectDisplayName(project, project.id),
        canCreate: principal.isAdmin ? true : canCreateProjectSession(identityState, principal, project.id),
        canViewWorkDetails: principal.isAdmin || project.showWorkDetailsToMembers,
        favorite: favoriteProjectIds.has(project.id),
      }));
    writeJson(response, 200, { items });
    return true;
  }

  const projectFavoriteMatch = pathname.match(/^\/api\/projects\/([^/]+)\/favorite$/u);
  if (projectFavoriteMatch && method === 'PATCH') {
    if (typeof identityStore.updateUserProjectFavorite !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const projectId = decodeURIComponent(projectFavoriteMatch[1]!);
    const project = findProject(identityState, projectId);
    if (
      !project
      || (!principal.isAdmin && (project.enabled === false || !canReadProject(identityState, principal, project.id)))
    ) {
      writeSessionNotFound(response);
      return true;
    }
    const body = await readJsonBody(request);
    if (typeof body.favorite !== 'boolean') {
      writeJson(response, 400, { error: 'favorite must be a boolean' });
      return true;
    }
    await identityStore.updateUserProjectFavorite({
      userId: principal.userId,
      projectId: project.id,
      favorite: body.favorite,
    });
    writeJson(response, 200, { projectId: project.id, favorite: body.favorite });
    return true;
  }

  if (pathname === '/api/sessions' && method === 'GET') {
    const stateFilter = normalizeSessionStateFilter(url.searchParams.get('state'));
    const archivedOnly = stateFilter === 'archived';
    const favoriteOnly = url.searchParams.get('favorite') === 'true';
    const requestedProjectId = normalizeOptionalString(url.searchParams.get('projectId'));
    const workspaceState = principal.isAdmin
      ? await ensureAdminLegacySessionMappings({
        identityStore,
        identityState,
        runtime,
        principal,
      })
      : identityState;
    const readableSessionsByThreadId = new Map(
      workspaceState.sessions
        .filter((appSession) => canReadWorkspaceAppSession(workspaceState, principal, appSession))
        .filter((appSession) => archivedOnly ? appSession.archived === true : appSession.archived !== true)
        .filter((appSession) => !requestedProjectId || appSession.projectId === requestedProjectId)
        .map((appSession) => [appSession.codexThreadId, appSession]),
    );
    const pageContext = {
      principalId: principal.userId,
      scope: sessionListScopeKey({
        favoriteOnly,
        archivedOnly,
        projectKey: requestedProjectId,
      }),
    };
    if (favoriteOnly) {
      const items = [];
      const runtimeSessionsByThreadId = new Map(
        (await runtime.listSessions({ favorite: true })).map((runtimeSession) => [runtimeSession.id, runtimeSession]),
      );
      for (const appSession of readableSessionsByThreadId.values()) {
        const runtimeSession = runtimeSessionsByThreadId.get(appSession.codexThreadId);
        if (!runtimeSession) {
          continue;
        }
        const project = findProject(workspaceState, appSession.projectId);
        items.push(presentSessionForUser({
          runtimeSession,
          appSession,
          project,
          observer: isObserverSessionForPrincipal(identityState, principal, appSession),
          includeDetails: false,
          includeWorkDetails: canViewProjectWorkDetails(principal, project),
        }));
      }
      writeSessionListPage(response, url, items, pageContext);
      return true;
    }
    if (archivedOnly) {
      const items = [];
      const runtimeSessionsByThreadId = new Map(
        (await runtime.listSessions({ archived: true })).map((runtimeSession) => [runtimeSession.id, runtimeSession]),
      );
      const missingAppSessions = [...readableSessionsByThreadId.values()]
        .filter((appSession) => !runtimeSessionsByThreadId.has(appSession.codexThreadId));
      const reconciledThreadIds = await reconcileOppositeArchiveStates({
        identityStore,
        runtime,
        appSessions: missingAppSessions,
        indexedArchived: true,
      });
      for (const appSession of readableSessionsByThreadId.values()) {
        if (reconciledThreadIds.has(appSession.codexThreadId)) {
          continue;
        }
        const runtimeSession = runtimeSessionsByThreadId.get(appSession.codexThreadId)
          ?? await runtime.readSession(appSession.codexThreadId);
        if (!runtimeSession) {
          continue;
        }
        const project = findProject(workspaceState, appSession.projectId);
        items.push(presentSessionForUser({
          runtimeSession,
          appSession,
          project,
          observer: isObserverSessionForPrincipal(identityState, principal, appSession),
          includeDetails: false,
          includeWorkDetails: canViewProjectWorkDetails(principal, project),
        }));
      }
      writeSessionListPage(response, url, items, pageContext);
      return true;
    }
    const items = [];
    const runtimeSessionsByThreadId = new Map(
      (await runtime.listSessions()).map((runtimeSession) => [runtimeSession.id, runtimeSession]),
    );
    const missingAppSessions = [...readableSessionsByThreadId.values()]
      .filter((appSession) => !runtimeSessionsByThreadId.has(appSession.codexThreadId));
    await reconcileOppositeArchiveStates({
      identityStore,
      runtime,
      appSessions: missingAppSessions,
      indexedArchived: false,
    });
    for (const appSession of readableSessionsByThreadId.values()) {
      const runtimeSession = runtimeSessionsByThreadId.get(appSession.codexThreadId);
      if (!runtimeSession) {
        continue;
      }
      const project = findProject(workspaceState, appSession.projectId);
      items.push(presentSessionForUser({
        runtimeSession,
        appSession,
        project,
        observer: isObserverSessionForPrincipal(identityState, principal, appSession),
        includeDetails: false,
        includeWorkDetails: canViewProjectWorkDetails(principal, project),
      }));
    }
    writeSessionListPage(response, url, items, pageContext);
    return true;
  }

  if (pathname === '/api/sessions' && method === 'POST') {
    const body = await readJsonBody(request);
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    const project = findProject(identityState, projectId);
    if (
      !project
      || (!principal.isAdmin && (project.enabled === false || !canCreateProjectSession(identityState, principal, project.id)))
    ) {
      writeSessionNotFound(response);
      return true;
    }
    if (!principal.isAdmin) {
      const activeSessionLimit = activeSessionLimitForProject(project);
      if (activeSessionLimit !== null && countActiveSessions(identityState, principal.userId, project.id) >= activeSessionLimit) {
        writeJson(response, 409, activeSessionLimitReachedPayload(project.id, activeSessionLimit));
        return true;
      }
    }
    const appSessionId = crypto.randomUUID();
    const runtimeSession = await runtime.createSession({
      ...(body as CreateSessionInput),
      cwd: project.cwd,
      runtimeEnv: codexWebRuntimeContextEnvironment(config, appSessionId),
    });
    const now = new Date().toISOString();
    const appSession = await identityStore.upsertSession({
      id: appSessionId,
      codexThreadId: runtimeSession.id,
      projectId: project.id,
      ownerUserId: principal.userId,
      createdAt: now,
      updatedAt: now,
      archived: false,
      archivedAt: null,
      archivedByUserId: null,
      archiveSource: null,
    });
    writeJson(response, 201, {
      session: presentSessionForUser({
        runtimeSession,
        appSession,
        project,
        includeWorkDetails: canViewProjectWorkDetails(principal, project),
      }),
    });
    return true;
  }

  const sessionStatusMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/status$/u);
  if (sessionStatusMatch && method === 'GET') {
    const resolved = resolveReadableWorkspaceAppSession(
      identityState,
      principal,
      decodeURIComponent(sessionStatusMatch[1]!),
    );
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    const runtimeSession = await runtime.readSessionStatus(
      resolved.appSession.codexThreadId,
      { archived: resolved.appSession.archived === true },
    );
    if (!runtimeSession) {
      writeSessionNotFound(response);
      return true;
    }
    const includeWorkDetails = canViewProjectWorkDetails(principal, resolved.project);
    const audience: CodexWebEventAudience = includeWorkDetails ? 'workspace' : 'workspace_summary';
    writeJson(response, 200, {
      session: presentSessionForUser({
        runtimeSession,
        appSession: resolved.appSession,
        project: resolved.project,
        observer: isObserverSessionForPrincipal(identityState, principal, resolved.appSession),
        includeDetails: false,
        includeWorkDetails,
      }),
      turnSnapshot: presentActiveTurnSnapshot(runtime, runtimeSession.activeTurnId, audience),
    });
    return true;
  }

  const adminSessionsMatch = pathname.match(/^\/api\/admin\/sessions(?:\/([^/]+))?$/u);
  const adminSessionEventsMatch = pathname.match(/^\/api\/admin\/sessions\/([^/]+)\/turns\/([^/]+)\/events$/u);
  const adminSessionFileResolveMatch = pathname.match(/^\/api\/admin\/sessions\/([^/]+)\/files\/resolve$/u);
  const adminSessionFileContentMatch = pathname.match(/^\/api\/admin\/sessions\/([^/]+)\/files\/([^/]+)\/content$/u);
  if (pathname.startsWith('/api/admin/')) {
    if (!principal.isAdmin) {
      writeJson(response, 403, { error: 'forbidden' });
      return true;
    }
    const handledAdmin = await handleAdminManagementRequest({
      request,
      response,
      pathname,
      method,
      identityStore,
      identityState,
      auth,
      closeSseConnections,
    });
    if (handledAdmin) {
      return true;
    }
  }

  if (adminSessionsMatch) {
    if (!principal.isAdmin) {
      writeJson(response, 403, { error: 'forbidden' });
      return true;
    }
    const adminIdentityState = await ensureAdminLegacySessionMappings({
      identityStore,
      identityState,
      runtime,
      principal,
    });
    const sessionId = adminSessionsMatch[1] ? decodeURIComponent(adminSessionsMatch[1]) : null;
    if (!sessionId && method === 'GET') {
      const userId = url.searchParams.get('userId');
      const projectId = url.searchParams.get('projectId');
      const stateFilter = normalizeSessionStateFilter(url.searchParams.get('state'));
      const summariesByThreadId = await adminSessionAuditSummaries(runtime, stateFilter);
      const items = adminIdentityState.sessions
        .filter((session) => !userId || session.ownerUserId === userId)
        .filter((session) => !projectId || session.projectId === projectId)
        .filter((session) => stateFilter === 'archived'
          ? session.archived === true
          : stateFilter === 'active'
            ? session.archived !== true
            : true)
        .map((session) => presentAppSessionAudit(
          adminIdentityState,
          session,
          summariesByThreadId.get(session.codexThreadId) ?? null,
        ))
        .sort(comparePresentedSessionAudit);
      writeJson(response, 200, { items });
      return true;
    }
    if (sessionId && method === 'GET') {
      const appSession = adminIdentityState.sessions.find((session) => session.id === sessionId);
      if (!appSession) {
        writeSessionNotFound(response);
        return true;
      }
      const runtimeSession = await runtime.readSession(appSession.codexThreadId);
      if (!runtimeSession) {
        writeSessionNotFound(response);
        return true;
      }
      writeJson(response, 200, {
        mode: 'observer',
        session: presentSessionForUser({
          runtimeSession,
          appSession,
          project: findProject(adminIdentityState, appSession.projectId),
          observer: true,
          includeWorkDetails: true,
        }),
      });
      return true;
    }
  }

  if (adminSessionEventsMatch && method === 'GET') {
    if (!principal.isAdmin) {
      writeJson(response, 403, { error: 'forbidden' });
      return true;
    }
    const adminIdentityState = await ensureAdminLegacySessionMappings({
      identityStore,
      identityState,
      runtime,
      principal,
    });
    const sessionId = decodeURIComponent(adminSessionEventsMatch[1]!);
    const turnId = decodeURIComponent(adminSessionEventsMatch[2]!);
    const appSession = adminIdentityState.sessions.find((session) => session.id === sessionId);
    if (!appSession || runtime.threadIdForTurn?.(turnId) !== appSession.codexThreadId) {
      writeSessionNotFound(response);
      return true;
    }
    await streamTurnEvents({
      request,
      response,
      runtime,
      turnId,
      afterId: normalizeLastEventId(url.searchParams.get('after'), request.headers['last-event-id']),
      requestedEpoch: normalizeEventEpoch(url.searchParams.get('epoch'), request.headers['x-codex-event-epoch']),
      registerSseCloser,
      audience: 'workspace',
    });
    return true;
  }

  if (adminSessionFileResolveMatch && method === 'POST') {
    const sessionId = decodeURIComponent(adminSessionFileResolveMatch[1]!);
    const scope = await multiUserSessionFileScope({
      identityStore,
      identityState,
      runtime,
      principal,
      config,
      sessionId,
      observer: true,
    });
    if (!scope) {
      writeSessionNotFound(response);
      return true;
    }
    const body = await readJsonBody(request);
    const inputPath = typeof body.path === 'string' ? body.path.trim() : '';
    if (!inputPath) {
      writeJson(response, 400, { error: 'invalid_file_path', message: 'path is required' });
      return true;
    }
    const file = await resolveSessionFileForResponse({
      store: sessionFileStore,
      scope,
      inputPath,
      response,
    });
    if (!file) {
      return true;
    }
    writeJson(response, 200, {
      file: presentSessionFileForUser(file, sessionId, { observer: true }),
    });
    return true;
  }

  if (adminSessionFileContentMatch && method === 'GET') {
    const sessionId = decodeURIComponent(adminSessionFileContentMatch[1]!);
    const scope = await multiUserSessionFileScope({
      identityStore,
      identityState,
      runtime,
      principal,
      config,
      sessionId,
      observer: true,
    });
    if (!scope) {
      writeSessionNotFound(response);
      return true;
    }
    const content = await readSessionFileForResponse({
      store: sessionFileStore,
      scope,
      fileId: decodeURIComponent(adminSessionFileContentMatch[2]!),
      response,
    });
    if (!content) {
      return true;
    }
    writeSessionFileContent(response, content, url.searchParams.get('download') === '1');
    return true;
  }

  const shareCreateMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/share$/u);
  if (shareCreateMatch && method === 'POST') {
    if (config.publicSharesEnabled !== true) {
      writeJson(response, 403, {
        error: 'public_shares_disabled',
        message: 'Public share links are disabled by the service configuration.',
      });
      return true;
    }
    const resolved = resolveWritableAppSession(identityState, principal, decodeURIComponent(shareCreateMatch[1]!));
    if (!resolved || !identityStore.createShare) {
      writeSessionNotFound(response);
      return true;
    }
    const runtimeSession = await runtime.readSession(resolved.appSession.codexThreadId);
    if (!runtimeSession || !resolved.project) {
      writeSessionNotFound(response);
      return true;
    }
    const presentedSession = presentSessionForUser({
      runtimeSession,
      appSession: resolved.appSession,
      project: resolved.project,
      includeOwnership: false,
      includeActivity: false,
      forceReadOnly: true,
      includeWorkDetails: false,
    });
    const sharedReports = await reportsReferencedBySharedSession({
      reportStore,
      identityState,
      principal,
      project: resolved.project,
      presentedSession,
    });
    const created = await identityStore.createShare({
      sessionId: resolved.appSession.id,
      createdByUserId: principal.userId,
      ttlSeconds: config.publicShareTtlSeconds,
    });
    writeJson(response, 201, {
      id: created.share.id,
      token: created.token,
      shareUrl: `/share/${encodeURIComponent(created.token)}`,
      expiresAt: created.share.expiresAt,
      reports: sharedReports.map((report) => presentReportForUser(report)),
    });
    return true;
  }

  const shareRevokeMatch = pathname.match(/^\/api\/shares\/([^/]+)$/u);
  if (shareRevokeMatch && method === 'DELETE') {
    const shareId = decodeURIComponent(shareRevokeMatch[1]!);
    const share = identityState.shares.find((item) => item.id === shareId);
    const appSession = share
      ? identityState.sessions.find((item) => item.id === share.sessionId)
      : null;
    if (
      !share
      || !appSession
      || share.createdByUserId !== principal.userId
      || !canWriteResolvedAppSession(identityState, principal, appSession)
      || typeof identityStore.revokeShare !== 'function'
    ) {
      writeSessionNotFound(response);
      return true;
    }
    await identityStore.revokeShare(share.id);
    closeSseConnections();
    writeJson(response, 200, { ok: true });
    return true;
  }

  const sessionFileResolveMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/files\/resolve$/u);
  if (sessionFileResolveMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionFileResolveMatch[1]!);
    const scope = await multiUserSessionFileScope({
      identityStore,
      identityState,
      runtime,
      principal,
      config,
      sessionId,
    });
    if (!scope) {
      writeSessionNotFound(response);
      return true;
    }
    const body = await readJsonBody(request);
    const inputPath = typeof body.path === 'string' ? body.path.trim() : '';
    if (!inputPath) {
      writeJson(response, 400, { error: 'invalid_file_path', message: 'path is required' });
      return true;
    }
    const file = await resolveSessionFileForResponse({
      store: sessionFileStore,
      scope,
      inputPath,
      response,
    });
    if (!file) {
      return true;
    }
    writeJson(response, 200, {
      file: presentSessionFileForUser(file, sessionId),
    });
    return true;
  }

  const sessionFileContentMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/files\/([^/]+)\/content$/u);
  if (sessionFileContentMatch && method === 'GET') {
    const sessionId = decodeURIComponent(sessionFileContentMatch[1]!);
    const scope = await multiUserSessionFileScope({
      identityStore,
      identityState,
      runtime,
      principal,
      config,
      sessionId,
    });
    if (!scope) {
      writeSessionNotFound(response);
      return true;
    }
    const content = await readSessionFileForResponse({
      store: sessionFileStore,
      scope,
      fileId: decodeURIComponent(sessionFileContentMatch[2]!),
      response,
    });
    if (!content) {
      return true;
    }
    writeSessionFileContent(response, content, url.searchParams.get('download') === '1');
    return true;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/u);
  if (sessionMatch && method === 'GET') {
    const resolved = resolveReadableWorkspaceAppSession(identityState, principal, decodeURIComponent(sessionMatch[1]!));
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    const runtimeSession = await runtime.readSession(resolved.appSession.codexThreadId);
    if (!runtimeSession) {
      writeSessionNotFound(response);
      return true;
    }
    writeJson(response, 200, {
      session: presentSessionForUser({
        runtimeSession,
        appSession: resolved.appSession,
        project: resolved.project,
        includeWorkDetails: canViewProjectWorkDetails(principal, resolved.project),
      }),
    });
    return true;
  }

  const sessionTimelineMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/timeline$/u);
  if (sessionTimelineMatch && method === 'GET') {
    const resolved = resolveReadableWorkspaceAppSession(
      identityState,
      principal,
      decodeURIComponent(sessionTimelineMatch[1]!),
    );
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    const runtimeSession = await runtime.readSession(resolved.appSession.codexThreadId);
    if (!runtimeSession) {
      writeSessionNotFound(response);
      return true;
    }
    const includeWorkDetails = canViewProjectWorkDetails(principal, resolved.project);
    const audience: CodexWebEventAudience = includeWorkDetails ? 'workspace' : 'workspace_summary';
    writeJson(response, 200, {
      ...paginateSessionTimeline(
        presentSessionTimeline(
          runtimeSession.timeline,
          runtimeSession.thread,
          includeWorkDetails,
        ),
        url,
      ),
      session: presentSessionForUser({
        runtimeSession,
        appSession: resolved.appSession,
        project: resolved.project,
        observer: isObserverSessionForPrincipal(identityState, principal, resolved.appSession),
        includeDetails: false,
        includeWorkDetails,
      }),
      ...(shouldIncludeTimelineTurnSnapshot(request, url)
        ? { turnSnapshot: presentActiveTurnSnapshot(runtime, runtimeSession.activeTurnId, audience) }
        : {}),
    });
    return true;
  }
  if (sessionTimelineMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionTimelineMatch[1]!);
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId,
    });
    const resolved = resolveWritableAppSession(stateForSession, principal, sessionId);
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    if (rejectArchivedSessionWrite(response, resolved.appSession)) {
      return true;
    }
    const body = await readJsonBody(request);
    const entryInput = normalizeSessionTimelineEntryInput(body);
    if (!entryInput) {
      writeJson(response, 400, {
        error: 'invalid_timeline_entry',
        message: 'A non-empty system message is required.',
      });
      return true;
    }
    const entry = runtime.appendSessionTimelineEntry(resolved.appSession.codexThreadId, entryInput);
    if (!entry) {
      writeJson(response, 400, {
        error: 'invalid_timeline_entry',
        message: 'A non-empty system message is required.',
      });
      return true;
    }
    writeJson(response, 201, { entry });
    return true;
  }

  const sessionFavoriteMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/favorite$/u);
  if (sessionFavoriteMatch && method === 'PATCH') {
    const sessionId = decodeURIComponent(sessionFavoriteMatch[1]!);
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId,
    });
    const resolved = resolveWritableAppSession(stateForSession, principal, sessionId);
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    if (rejectArchivedSessionWrite(response, resolved.appSession)) {
      return true;
    }
    const body = await readJsonBody(request);
    if (typeof body.favorite !== 'boolean') {
      writeJson(response, 400, { error: 'favorite must be a boolean' });
      return true;
    }
    const favoriteOrder = Number.isFinite(body.favoriteOrder) ? Number(body.favoriteOrder) : null;
    const runtimeSession = await runtime.updateSessionFavorite(
      resolved.appSession.codexThreadId,
      body.favorite,
      favoriteOrder,
    );
    if (!runtimeSession) {
      writeSessionNotFound(response);
      return true;
    }
    writeJson(response, 200, {
      session: presentSessionForUser({
        runtimeSession,
        appSession: resolved.appSession,
        project: resolved.project,
        includeWorkDetails: canViewProjectWorkDetails(principal, resolved.project),
      }),
    });
    return true;
  }

  if (sessionMatch && method === 'DELETE') {
    const sessionId = decodeURIComponent(sessionMatch[1]!);
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId,
    });
    const resolved = resolveWritableAppSession(stateForSession, principal, sessionId);
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    const archived = await runtime.archiveSession(resolved.appSession.codexThreadId);
    if (!archived) {
      writeSessionNotFound(response);
      return true;
    }
    const now = new Date().toISOString();
    await identityStore.upsertSession({
      ...resolved.appSession,
      updatedAt: now,
      archived: true,
      archivedAt: now,
      archivedByUserId: principal.userId,
      archiveSource: 'codex',
    });
    writeJson(response, 200, { ok: true });
    return true;
  }

  const sessionArchiveMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/(archive|unarchive)$/u);
  if (sessionArchiveMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionArchiveMatch[1]!);
    const action = sessionArchiveMatch[2]!;
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId,
    });
    const resolved = resolveWritableAppSession(stateForSession, principal, sessionId);
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    if (action === 'archive') {
      const archived = await runtime.archiveSession(resolved.appSession.codexThreadId);
      if (!archived) {
        writeSessionNotFound(response);
        return true;
      }
      const now = new Date().toISOString();
      await identityStore.upsertSession({
        ...resolved.appSession,
        updatedAt: now,
        archived: true,
        archivedAt: now,
        archivedByUserId: principal.userId,
        archiveSource: 'codex',
      });
      writeJson(response, 200, { ok: true });
      return true;
    }
    const project = resolved.project;
    if (!principal.isAdmin && project) {
      const activeSessionLimit = activeSessionLimitForProject(project);
      if (activeSessionLimit !== null && countActiveSessions(stateForSession, principal.userId, project.id) >= activeSessionLimit) {
        writeJson(response, 409, activeSessionLimitReachedPayload(project.id, activeSessionLimit));
        return true;
      }
    }
    const unarchived = await (runtime as ArchiveCapableRuntime).unarchiveSession?.(resolved.appSession.codexThreadId);
    if (!unarchived) {
      writeSessionNotFound(response);
      return true;
    }
    const now = new Date().toISOString();
    await identityStore.upsertSession({
      ...resolved.appSession,
      updatedAt: now,
      archived: false,
      archivedAt: null,
      archivedByUserId: null,
      archiveSource: null,
    });
    writeJson(response, 200, {
      session: presentSessionForUser({
        runtimeSession: unarchived,
        appSession: {
          ...resolved.appSession,
          updatedAt: now,
          archived: false,
          archivedAt: null,
          archivedByUserId: null,
          archiveSource: null,
        },
        project,
        includeWorkDetails: canViewProjectWorkDetails(principal, project),
      }),
    });
    return true;
  }

  const startTurnMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/turns$/u);
  if (startTurnMatch && method === 'POST') {
    const sessionId = decodeURIComponent(startTurnMatch[1]!);
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId,
    });
    const resolved = resolveWritableAppSession(stateForSession, principal, sessionId);
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    if (rejectArchivedSessionWrite(response, resolved.appSession)) {
      return true;
    }
    const body = await readJsonBody(request);
    if (hasSessionSubmissionIdField(body)) {
      const execution = await submitSessionSubmission({
        body,
        forcedSessionId: sessionId,
        principal,
        identityStore,
        identityState,
        runtime,
        config,
        store: sessionSubmissionStore,
        operations: sessionSubmissionOperations,
      });
      writeJson(response, execution.created ? 202 : 200, execution.response);
      return true;
    }
    if (typeof body.text !== 'string' || !body.text.trim()) {
      writeJson(response, 400, { error: 'text is required' });
      return true;
    }
    const runtimeSession = hasRequestAttachments(body)
      ? await runtime.readSession(resolved.appSession.codexThreadId)
      : null;
    const projectCwd = normalizeOptionalString(resolved.project?.cwd) || normalizeOptionalString(runtimeSession?.cwd);
    const input = await normalizeStartTurnInput({
      body,
      config,
      principal,
      runtime,
      sessionId: resolved.appSession.codexThreadId,
      projectCwd,
      projectKey: safePathSegment(resolved.project?.id || resolved.appSession.projectId || `cwd-${stableIdHash(projectCwd, 16)}`),
    });
    if (!input) {
      writeSessionNotFound(response);
      return true;
    }
    const runtimeContext = await projectCodexWebRuntimeContext({
      config,
      runtime,
      appSession: resolved.appSession,
      user: identityState.users.find((item) => item.id === resolved.appSession.ownerUserId) ?? null,
      project: resolved.project,
    });
    input.developerInstructions = runtimeContext.developerInstructions;
    input.runtimeEnv = runtimeContext.runtimeEnv;
    const turn = await startSessionTurn({
      runtime,
      sessionId: resolved.appSession.codexThreadId,
      input,
      response,
    });
    if (!turn) {
      return true;
    }
    await identityStore.upsertSession({
      ...resolved.appSession,
      updatedAt: new Date().toISOString(),
    });
    writeJson(response, 202, presentStartTurnResultForUser({
      result: turn,
      appSession: resolved.appSession,
      project: resolved.project,
      includeWorkDetails: canViewProjectWorkDetails(principal, resolved.project),
    }));
    return true;
  }

  const sessionAttachmentsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/attachments$/u);
  if (sessionAttachmentsMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionAttachmentsMatch[1]!);
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId,
    });
    const resolved = resolveWritableAppSession(stateForSession, principal, sessionId);
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    if (rejectArchivedSessionWrite(response, resolved.appSession)) {
      return true;
    }
    const runtimeSession = await runtime.readSession(resolved.appSession.codexThreadId);
    const projectCwd = normalizeOptionalString(resolved.project?.cwd) || normalizeOptionalString(runtimeSession?.cwd);
    const items = await storeSessionAttachments({
      request,
      config,
      principal,
      projectCwd,
      projectKey: safePathSegment(resolved.project?.id || resolved.appSession.projectId || `cwd-${stableIdHash(projectCwd, 16)}`),
    });
    writeJson(response, 201, { items });
    return true;
  }

  const sessionSettingsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/settings$/u);
  if (sessionSettingsMatch && method === 'PATCH') {
    const sessionId = decodeURIComponent(sessionSettingsMatch[1]!);
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId,
    });
    const resolved = resolveWritableAppSession(stateForSession, principal, sessionId);
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    if (rejectArchivedSessionWrite(response, resolved.appSession)) {
      return true;
    }
    const body = await readJsonBody(request);
    const runtimeSession = await runtime.updateSessionSettings(
      resolved.appSession.codexThreadId,
      body as UpdateSessionSettingsInput,
    );
    if (!runtimeSession) {
      writeSessionNotFound(response);
      return true;
    }
    writeJson(response, 200, {
      session: presentSessionForUser({
        runtimeSession,
        appSession: resolved.appSession,
        project: resolved.project,
        includeWorkDetails: canViewProjectWorkDetails(principal, resolved.project),
      }),
    });
    return true;
  }

  const interruptMatch = pathname.match(/^\/api\/turns\/([^/]+)\/interrupt$/u);
  const steerMatch = pathname.match(/^\/api\/turns\/([^/]+)\/steer$/u);
  if (steerMatch && method === 'POST') {
    const turnId = decodeURIComponent(steerMatch[1]!);
    const threadId = runtime.threadIdForTurn?.(turnId);
    const appSession = threadId ? identityState.sessions.find((session) => session.codexThreadId === threadId) : null;
    if (!appSession || !canWriteResolvedAppSession(identityState, principal, appSession)) {
      writeSessionNotFound(response);
      return true;
    }
    if (rejectArchivedSessionWrite(response, appSession)) {
      return true;
    }
    const body = await readJsonBody(request);
    if (typeof body.text !== 'string' || !body.text.trim()) {
      writeJson(response, 400, { error: 'text is required' });
      return true;
    }
    const result = await steerSessionTurn({
      runtime,
      sessionId: threadId!,
      turnId,
      input: { text: body.text },
      response,
    });
    if (!result) {
      return true;
    }
    await identityStore.upsertSession({
      ...appSession,
      updatedAt: new Date().toISOString(),
    });
    writeJson(response, 202, result);
    return true;
  }
  if (interruptMatch && method === 'POST') {
    const turnId = decodeURIComponent(interruptMatch[1]!);
    const threadId = runtime.threadIdForTurn?.(turnId);
    const appSession = threadId ? identityState.sessions.find((session) => session.codexThreadId === threadId) : null;
    if (!appSession || !canWriteResolvedAppSession(identityState, principal, appSession)) {
      writeSessionNotFound(response);
      return true;
    }
    if (rejectArchivedSessionWrite(response, appSession)) {
      return true;
    }
    if (typeof runtime.interruptTurnForThread === 'function') {
      await runtime.interruptTurnForThread(threadId!, turnId);
    } else {
      await runtime.interruptTurn(turnId);
    }
    writeJson(response, 200, { ok: true });
    return true;
  }

  const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/(accept|accept-for-session|deny)$/u);
  if (approvalMatch && method === 'POST') {
    const approvalId = decodeURIComponent(approvalMatch[1]!);
    const threadId = runtime.threadIdForApproval?.(approvalId);
    const appSession = threadId ? identityState.sessions.find((session) => session.codexThreadId === threadId) : null;
    if (!appSession || !canWriteResolvedAppSession(identityState, principal, appSession)) {
      writeSessionNotFound(response);
      return true;
    }
    if (rejectArchivedSessionWrite(response, appSession)) {
      return true;
    }
    const action = approvalMatch[2]!;
    const decision = action === 'accept'
      ? 'accept'
      : action === 'accept-for-session'
        ? 'accept_for_session'
        : 'deny';
    if (typeof runtime.resolveApprovalForThread === 'function') {
      await runtime.resolveApprovalForThread(threadId!, approvalId, decision);
    } else {
      await runtime.resolveApproval(approvalId, decision);
    }
    writeJson(response, 200, { ok: true });
    return true;
  }

  const eventsMatch = pathname.match(/^\/api\/turns\/([^/]+)\/events$/u);
  if (eventsMatch && method === 'GET') {
    const turnId = decodeURIComponent(eventsMatch[1]!);
    const threadId = runtime.threadIdForTurn?.(turnId);
    const appSession = threadId ? identityState.sessions.find((session) => session.codexThreadId === threadId) : null;
    if (!appSession || !canReadWorkspaceAppSession(identityState, principal, appSession)) {
      writeSessionNotFound(response);
      return true;
    }
    await streamTurnEvents({
      request,
      response,
      runtime,
      turnId,
      afterId: normalizeLastEventId(url.searchParams.get('after'), request.headers['last-event-id']),
      requestedEpoch: normalizeEventEpoch(url.searchParams.get('epoch'), request.headers['x-codex-event-epoch']),
      registerSseCloser,
      audience: canViewProjectWorkDetails(principal, findProject(identityState, appSession.projectId))
        ? 'workspace'
        : 'workspace_summary',
    });
    return true;
  }

  if (identityState.settings.multiUserEnabled === true || principal.mode === 'multi') {
    writeJson(response, 404, { error: 'Not found' });
    return true;
  }
  return false;
}

async function handleAdminManagementRequest({
  request,
  response,
  pathname,
  method,
  identityStore,
  identityState,
  auth,
  closeSseConnections,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  method: string;
  identityStore: CodexWebIdentityStoreLike;
  identityState: CodexWebIdentityState;
  auth: CodexWebAuthLike;
  closeSseConnections: () => void;
}): Promise<boolean> {
  if (pathname === '/api/admin/settings' && method === 'GET') {
    writeJson(response, 200, { settings: identityState.settings });
    return true;
  }
  if (pathname === '/api/admin/settings' && method === 'PATCH') {
    const setMultiUserEnabled = typeof auth.setMultiUserEnabled === 'function'
      ? (enabled: boolean) => auth.setMultiUserEnabled!(enabled)
      : identityStore.setMultiUserEnabled?.bind(identityStore);
    if (typeof setMultiUserEnabled !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const state = await setMultiUserEnabled(body.multiUserEnabled === true);
    if (identityState.settings.multiUserEnabled === true && state.settings.multiUserEnabled !== true) {
      closeSseConnections();
    }
    writeJson(response, 200, { settings: state.settings });
    return true;
  }
  if (pathname === '/api/admin/projects' && method === 'GET') {
    writeJson(response, 200, { items: identityState.projects });
    return true;
  }
  if (pathname === '/api/admin/projects' && method === 'POST') {
    if (typeof identityStore.upsertProject !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const projectId = String(body.id ?? '');
    const existing = identityState.projects.find((project) => project.id === projectId);
    const project = await withProjectDisplayNameConflictHttpError(() => identityStore.upsertProject!({
      id: projectId,
      internalName: String(body.internalName ?? ''),
      cwd: String(body.cwd ?? ''),
      displayName: String(body.displayName ?? ''),
      enabled: body.enabled !== false,
      activeSessionLimit: body.activeSessionLimit === null ? null : Number(body.activeSessionLimit),
      showWorkDetailsToMembers: body.showWorkDetailsToMembers !== false,
    }));
    if (existing && project.showWorkDetailsToMembers !== existing.showWorkDetailsToMembers) {
      closeSseConnections();
    }
    writeJson(response, 201, { project });
    return true;
  }
  const adminProjectMatch = pathname.match(/^\/api\/admin\/projects\/([^/]+)$/u);
  if (adminProjectMatch && method === 'PATCH') {
    if (typeof identityStore.upsertProject !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const projectId = decodeURIComponent(adminProjectMatch[1]!);
    const existing = identityState.projects.find((project) => project.id === projectId);
    if (!existing) {
      writeSessionNotFound(response);
      return true;
    }
    const body = await readJsonBody(request);
    const project = await withProjectDisplayNameConflictHttpError(() => identityStore.upsertProject!({
      ...existing,
      internalName: typeof body.internalName === 'string' ? body.internalName : existing.internalName,
      cwd: typeof body.cwd === 'string' ? body.cwd : existing.cwd,
      displayName: typeof body.displayName === 'string' ? body.displayName : existing.displayName,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : existing.enabled,
      activeSessionLimit: Object.prototype.hasOwnProperty.call(body, 'activeSessionLimit')
        ? body.activeSessionLimit === null ? null : Number(body.activeSessionLimit)
        : existing.activeSessionLimit,
      showWorkDetailsToMembers: typeof body.showWorkDetailsToMembers === 'boolean'
        ? body.showWorkDetailsToMembers
        : existing.showWorkDetailsToMembers,
    }));
    if (project.showWorkDetailsToMembers !== existing.showWorkDetailsToMembers) {
      closeSseConnections();
    }
    writeJson(response, 200, { project });
    return true;
  }
  if (pathname === '/api/admin/roles' && method === 'GET') {
    writeJson(response, 200, { items: identityState.roles });
    return true;
  }
  if (pathname === '/api/admin/roles' && method === 'POST') {
    if (typeof identityStore.upsertRole !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const projectIds = Array.isArray(body.projectIds)
      ? body.projectIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    const role = await identityStore.upsertRole({
      id: String(body.id ?? ''),
      name: String(body.name ?? ''),
      isAdmin: String(body.id ?? '').trim() === 'role_admin' && existingAdminRole(identityState) === true,
      projectGrants: projectIds.length
        ? projectIds.map((projectId) => ({ projectId, canRead: true, canCreate: true, canWrite: true }))
        : normalizeRoleProjectGrants(body.projectGrants),
    });
    writeJson(response, 201, { role });
    return true;
  }
  if (pathname === '/api/admin/users' && method === 'GET') {
    writeJson(response, 200, { items: identityState.users.map(presentAdminUser) });
    return true;
  }
  if (pathname === '/api/admin/users' && method === 'POST') {
    if (typeof identityStore.upsertUserWithPassword !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const roleId = typeof body.roleId === 'string' ? body.roleId.trim() : '';
    const roleIds = roleId
      ? [roleId]
      : Array.isArray(body.roleIds)
        ? body.roleIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 1)
        : [];
    try {
      const user = await identityStore.upsertUserWithPassword({
        id: typeof body.id === 'string' ? body.id : undefined,
        username: String(body.username ?? ''),
        email: typeof body.email === 'string' ? body.email : undefined,
        password: String(body.password ?? ''),
        enabled: body.enabled !== false,
        roleIds,
        directProjectGrants: Array.isArray(body.directProjectGrants) ? body.directProjectGrants as any[] : [],
      });
      writeJson(response, 201, { user: presentAdminUser(user) });
    } catch (error) {
      if (isUsernameConflictError(error)) {
        writeJson(response, 409, {
          error: 'username_conflict',
          message: 'A user with this username already exists.',
        });
        return true;
      }
      throw error;
    }
    return true;
  }
  const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/u);
  if (adminUserMatch && method === 'PATCH') {
    if (typeof identityStore.updateUserAccess !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const roleId = typeof body.roleId === 'string' ? body.roleId.trim() : '';
    const roleIds = roleId
      ? [roleId]
      : Array.isArray(body.roleIds)
        ? body.roleIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 1)
        : [];
    try {
      const user = await identityStore.updateUserAccess({
        id: decodeURIComponent(adminUserMatch[1]!),
        email: typeof body.email === 'string' ? body.email : undefined,
        enabled: body.enabled !== false,
        roleIds,
        directProjectGrants: Array.isArray(body.directProjectGrants) ? body.directProjectGrants as any[] : undefined,
      });
      writeJson(response, 200, { user: presentAdminUser(user) });
    } catch {
      writeSessionNotFound(response);
    }
    return true;
  }
  if (adminUserMatch && method === 'DELETE') {
    if (typeof identityStore.deleteUser !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    try {
      await identityStore.deleteUser(decodeURIComponent(adminUserMatch[1]!));
      response.statusCode = 204;
      response.end();
    } catch {
      writeSessionNotFound(response);
    }
    return true;
  }
  return false;
}

function existingAdminRole(state: CodexWebIdentityState): boolean {
  return state.roles.some((role) => role.id === 'role_admin' && role.isAdmin === true);
}

function presentAdminUser(user: CodexWebUser): Record<string, unknown> {
  const [roleId = ''] = user.roleIds;
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    enabled: user.enabled,
    roleId,
    roleIds: user.roleIds,
    directProjectGrants: user.directProjectGrants,
    favoriteProjectIds: user.favoriteProjectIds,
  };
}

function publicSettingsPayload(
  identityState: CodexWebIdentityState | null,
  principal: CodexWebPrincipal,
  config: CodexWebConfig,
): Record<string, unknown> {
  return {
    settings: {
      siteTitle: identityState?.settings.siteTitle || 'Codex Web',
    },
    permissions: {
      canSetSiteTitle: canSetSiteTitle(principal),
    },
    features: {
      publicSharesEnabled: config.publicSharesEnabled === true,
    },
  };
}

function canSetSiteTitle(principal: CodexWebPrincipal): boolean {
  return principal.mode === 'single' || principal.isAdmin === true;
}

function normalizeRoleProjectGrants(value: unknown): Array<{
  projectId: string;
  canRead: boolean;
  canCreate: boolean;
  canWrite: boolean;
}> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((grant) => {
      if (!grant || typeof grant !== 'object') {
        return null;
      }
      const projectId = typeof (grant as { projectId?: unknown }).projectId === 'string'
        ? (grant as { projectId: string }).projectId.trim()
        : '';
      if (!projectId) {
        return null;
      }
      return {
        projectId,
        canRead: true,
        canCreate: true,
        canWrite: true,
      };
    })
    .filter((grant): grant is { projectId: string; canRead: boolean; canCreate: boolean; canWrite: boolean } => grant !== null);
}

function canReadProject(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  projectId: string,
): boolean {
  if (principal.isAdmin) {
    return true;
  }
  const grant = canReadProjectGrant(state, principal, projectId);
  return grant === true;
}

function canReadProjectGrant(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  projectId: string,
): boolean {
  const user = state.users.find((item) => item.id === principal.userId && item.enabled !== false);
  if (!user) {
    return false;
  }
  const grants = [
    ...state.roles
      .filter((role) => user.roleIds.includes(role.id))
      .flatMap((role) => role.projectGrants),
    ...user.directProjectGrants,
  ].filter((grant) => grant.projectId === projectId);
  return grants.some((grant) => grant.canRead === true || grant.canCreate === true || grant.canWrite === true);
}

function canReadReport(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  report: CodexWebReport,
): boolean {
  if (principal.isAdmin) {
    return true;
  }
  const project = projectForReport(state, report);
  return Boolean(
    project
    && project.enabled !== false
    && canReadProject(state, principal, project.id),
  );
}

function projectForReport(
  state: CodexWebIdentityState,
  report: CodexWebReport,
): CodexWebProject | null {
  const reportRoot = String(report.id || '').split('/').filter(Boolean)[0] ?? '';
  const rootProject = projectForReportKey(state, reportRoot);
  const metadataProject = projectForReportKey(state, String(report.project || ''));
  if (rootProject && metadataProject && rootProject.id !== metadataProject.id) {
    return null;
  }
  return rootProject ?? metadataProject;
}

function projectForReportRoot(
  state: CodexWebIdentityState,
  report: CodexWebReport,
): CodexWebProject | null {
  const reportRoot = String(report.id || '').split('/').filter(Boolean)[0] ?? '';
  return projectForReportKey(state, reportRoot);
}

function projectForReportKey(
  state: CodexWebIdentityState,
  key: string,
): CodexWebProject | null {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return null;
  }
  const exactId = state.projects.find((project) => project.id === normalizedKey);
  if (exactId) {
    return exactId;
  }
  const internalMatches = state.projects.filter((project) => project.internalName === normalizedKey);
  return internalMatches.length === 1 ? internalMatches[0]! : null;
}

function presentReportForUser(report: CodexWebReport): Record<string, unknown> {
  return {
    id: report.id,
    project: report.project,
    title: report.title,
    kind: report.kind,
    sizeBytes: report.sizeBytes,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    favorite: report.favorite,
  };
}

async function reportsReferencedBySharedSession({
  reportStore,
  identityState,
  principal,
  project,
  presentedSession,
}: {
  reportStore: FileReportStore;
  identityState: CodexWebIdentityState;
  principal: CodexWebPrincipal;
  project: CodexWebProject;
  presentedSession: Record<string, unknown>;
}): Promise<CodexWebReport[]> {
  const reports: CodexWebReport[] = [];
  for (const reportId of sharedSessionReportIds(presentedSession)) {
    let report: CodexWebReport | null;
    try {
      report = await reportStore.readReport(reportId);
    } catch (error) {
      if (isInvalidReportPathError(error)) {
        continue;
      }
      throw error;
    }
    if (
      !report
      || !canReadReport(identityState, principal, report)
      || projectForReportRoot(identityState, report)?.id !== project.id
    ) {
      continue;
    }
    reports.push(report);
  }
  return reports;
}

function sharedSessionReportIds(presentedSession: Record<string, unknown>): string[] {
  const timeline = Array.isArray(presentedSession.timeline) ? presentedSession.timeline : [];
  const ids = new Set<string>();
  for (const entry of timeline) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const message = entry as Record<string, unknown>;
    if (message.role !== 'assistant' || typeof message.text !== 'string') {
      continue;
    }
    for (const reportId of reportIdsFromSharedMessage(message.text)) {
      ids.add(reportId);
    }
  }
  return [...ids];
}

function reportIdsFromSharedMessage(text: string): string[] {
  const ids: string[] = [];
  const reportPathPattern = /(?:^|[\\/])\.codex-web[\\/]reports[\\/]([^\s<>"'`()\[\]]+?\.(?:md|markdown|html?|htm))(?=$|[^\p{L}\p{N}_~+%=&@/\\.-])/giu;
  for (const match of text.matchAll(reportPathPattern)) {
    const reportId = String(match[1] ?? '').replaceAll('\\', '/');
    if (reportId) {
      ids.push(reportId);
    }
  }
  return ids;
}

function resolveReadableWorkspaceAppSession(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  sessionId: string,
): { appSession: CodexWebAppSession; project: CodexWebProject | null } | null {
  const appSession = findAppSessionByExternalId(state, sessionId);
  if (!appSession || !canReadWorkspaceAppSession(state, principal, appSession)) {
    return null;
  }
  return {
    appSession,
    project: findProject(state, appSession.projectId),
  };
}

function canReadWorkspaceAppSession(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  session: CodexWebAppSession,
): boolean {
  if (session.ownerUserId !== principal.userId) {
    return false;
  }
  return canReadAppSession(state, principal, session);
}

function resolveWritableAppSession(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  sessionId: string,
): { appSession: CodexWebAppSession; project: CodexWebProject | null } | null {
  const appSession = findAppSessionByExternalId(state, sessionId);
  if (!appSession || !canWriteResolvedAppSession(state, principal, appSession)) {
    return null;
  }
  return {
    appSession,
    project: findProject(state, appSession.projectId),
  };
}

function canWriteResolvedAppSession(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  appSession: CodexWebAppSession,
): boolean {
  return canWriteAppSession(state, principal, appSession);
}

function isObserverSessionForPrincipal(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  appSession: CodexWebAppSession,
): boolean {
  return principal.isAdmin && !canWriteResolvedAppSession(state, principal, appSession);
}

function findAppSessionByExternalId(state: CodexWebIdentityState, sessionId: string): CodexWebAppSession | null {
  return state.sessions.find((session) => session.id === sessionId)
    ?? state.sessions.find((session) => session.codexThreadId === sessionId)
    ?? null;
}

function findProject(state: CodexWebIdentityState, projectId: string): CodexWebProject | null {
  return state.projects.find((project) => project.id === projectId) ?? null;
}

function singleUserSessionFileScope({
  config,
  principal,
  sessionId,
  runtimeSession,
}: {
  config: CodexWebConfig;
  principal: CodexWebPrincipal;
  sessionId: string;
  runtimeSession: CodexWebSession;
}): CodexWebSessionFileScope | null {
  const projectRoot = normalizeOptionalString(runtimeSession.cwd);
  if (!projectRoot) {
    return null;
  }
  const runtimeSessionId = normalizeOptionalString(runtimeSession.id);
  return {
    principalId: principal.userId,
    sessionId,
    projectRoot,
    projectStorageKey: `cwd-${stableIdHash(projectRoot, 16)}`,
    attachmentSessionIds: [sessionId, runtimeSessionId].filter(Boolean),
    legacyReportKeys: legacyReportKeysForProject(projectRoot, runtimeSession.projectName),
    stateDir: config.stateDir,
    reportsDir: config.reportsDir,
  };
}

async function multiUserSessionFileScope({
  identityStore,
  identityState,
  runtime,
  principal,
  config,
  sessionId,
  observer = false,
}: {
  identityStore: CodexWebIdentityStoreLike;
  identityState: CodexWebIdentityState;
  runtime: CodexWebRuntime;
  principal: CodexWebPrincipal;
  config: CodexWebConfig;
  sessionId: string;
  observer?: boolean;
}): Promise<CodexWebSessionFileScope | null> {
  const stateForSession = await stateForSessionAccess({
    identityStore,
    identityState,
    runtime,
    principal,
    sessionId,
  });
  const observedAppSession = observer && principal.isAdmin
    ? findAppSessionByExternalId(stateForSession, sessionId)
    : null;
  const resolved = observedAppSession
    ? {
        appSession: observedAppSession,
        project: findProject(stateForSession, observedAppSession.projectId),
      }
    : resolveReadableWorkspaceAppSession(stateForSession, principal, sessionId);
  if (
    !resolved
    || (observer && !observedAppSession)
    || !resolved.project
    || (!principal.isAdmin && resolved.project.enabled === false)
  ) {
    return null;
  }
  const runtimeSession = await runtime.readSession(resolved.appSession.codexThreadId);
  if (!runtimeSession) {
    return null;
  }
  const projectRoot = normalizeOptionalString(resolved.project.cwd)
    || normalizeOptionalString(runtimeSession.cwd);
  if (!projectRoot) {
    return null;
  }
  return {
    principalId: principal.userId,
    ...(observer ? { managedFileUserIds: [resolved.appSession.ownerUserId] } : {}),
    sessionId,
    projectRoot,
    projectStorageKey: resolved.project.id,
    attachmentSessionIds: [
      resolved.appSession.codexThreadId,
      resolved.appSession.id,
      normalizeOptionalString(runtimeSession.id),
    ].filter(Boolean),
    legacyReportKeys: [resolved.project.id, resolved.project.internalName].filter(Boolean),
    stateDir: config.stateDir,
    reportsDir: config.reportsDir,
  };
}

function legacyReportKeysForProject(projectRoot: string, projectName: unknown): string[] {
  const normalizedProjectName = normalizeOptionalString(projectName).replaceAll('\\', '/');
  return [...new Set([
    path.basename(path.resolve(projectRoot)),
    normalizedProjectName ? path.posix.basename(normalizedProjectName) : '',
  ].filter(Boolean))];
}

async function resolveSessionFileForResponse({
  store,
  scope,
  inputPath,
  response,
}: {
  store: FileSessionFileStore;
  scope: CodexWebSessionFileScope;
  inputPath: string;
  response: ServerResponse;
}): Promise<CodexWebSessionFile | null> {
  try {
    return await store.resolveFile(scope, inputPath);
  } catch (error) {
    if (error instanceof SessionFileNotFoundError) {
      writeSessionFileNotFound(response);
      return null;
    }
    throw error;
  }
}

async function readSessionFileForResponse({
  store,
  scope,
  fileId,
  response,
}: {
  store: FileSessionFileStore;
  scope: CodexWebSessionFileScope;
  fileId: string;
  response: ServerResponse;
}): Promise<CodexWebSessionFileContent | null> {
  try {
    return await store.readFile(scope, fileId);
  } catch (error) {
    if (error instanceof SessionFileBusyError) {
      response.setHeader('Retry-After', '1');
      writeJson(response, 503, {
        error: 'file_busy',
        message: error.message,
      });
      return null;
    }
    if (error instanceof SessionFileTooLargeError) {
      writeJson(response, 413, {
        error: 'file_too_large',
        message: error.message,
        maxBytes: error.maxBytes,
      });
      return null;
    }
    if (error instanceof SessionFileNotFoundError) {
      writeSessionFileNotFound(response);
      return null;
    }
    throw error;
  }
}

function presentSessionFileForUser(
  file: CodexWebSessionFile,
  sessionId: string,
  { observer = false }: { observer?: boolean } = {},
): Record<string, unknown> {
  const sessionBasePath = observer ? '/api/admin/sessions' : '/api/sessions';
  const contentUrl = `${sessionBasePath}/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(file.id)}/content`;
  return {
    ...file,
    contentUrl,
    downloadUrl: `${contentUrl}?download=1`,
  };
}

function writeSessionFileContent(
  response: ServerResponse,
  content: CodexWebSessionFileContent,
  download: boolean,
): void {
  if (sessionFileResponseEnded(response)) {
    content.release();
    return;
  }
  const disposition = download || content.file.kind === 'file' ? 'attachment' : 'inline';
  const headers: Record<string, string> = {
    'Content-Type': content.file.mimeType,
    'Content-Length': String(content.data.byteLength),
    'Content-Disposition': `${disposition}; ${contentDispositionFileName(content.file.name)}`,
    'Cache-Control': 'no-store',
  };
  if (content.file.kind === 'html') {
    headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";
  }
  response.once('finish', content.release);
  response.once('close', content.release);
  response.once('error', content.release);
  if (sessionFileResponseEnded(response)) {
    content.release();
    return;
  }
  try {
    response.writeHead(200, headers);
    response.end(content.data);
  } catch (error) {
    content.release();
    throw error;
  }
}

function sessionFileResponseEnded(response: ServerResponse): boolean {
  return response.destroyed || response.closed || response.writableEnded;
}

function contentDispositionFileName(fileName: string): string {
  const fallback = String(fileName || 'file')
    .replace(/[^A-Za-z0-9._-]+/gu, '_')
    .slice(0, 120) || 'file';
  const encoded = encodeURIComponent(fileName || 'file').replace(/[!'()*]/gu, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return `filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function favoriteProjectIdsForPrincipal(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
): Set<string> {
  const user = state.users.find((item) => item.id === principal.userId && item.enabled !== false);
  return new Set(user?.favoriteProjectIds ?? []);
}

async function stateForSessionAccess({
  identityStore,
  identityState,
  runtime,
  principal,
  sessionId,
}: {
  identityStore: CodexWebIdentityStoreLike;
  identityState: CodexWebIdentityState;
  runtime: CodexWebRuntime;
  principal: CodexWebPrincipal;
  sessionId: string;
}): Promise<CodexWebIdentityState> {
  if (!principal.isAdmin || findAppSessionByExternalId(identityState, sessionId)) {
    return identityState;
  }
  return ensureAdminLegacySessionMappings({
    identityStore,
    identityState,
    runtime,
    principal,
  });
}

async function ensureAdminLegacySessionMappings({
  identityStore,
  identityState,
  runtime,
  principal,
}: {
  identityStore: CodexWebIdentityStoreLike;
  identityState: CodexWebIdentityState;
  runtime: CodexWebRuntime;
  principal: CodexWebPrincipal;
}): Promise<CodexWebIdentityState> {
  if (typeof identityStore.upsertProject !== 'function') {
    return identityState;
  }
  const runtimeSessions = await runtime.listSessions();
  const mappedThreadIds = new Set(identityState.sessions.map((session) => session.codexThreadId));
  const projectsById = new Map(identityState.projects.map((project) => [project.id, project]));
  const ownerUserId = adminOwnerUserId(identityState, principal);
  let changed = false;

  for (const runtimeSession of runtimeSessions) {
    const threadId = normalizeOptionalString(runtimeSession.id);
    if (!threadId || mappedThreadIds.has(threadId)) {
      continue;
    }
    const project = legacyProjectForRuntimeSession(runtimeSession);
    const existingProject = projectsById.get(project.id);
    if (!existingProject) {
      await identityStore.upsertProject(project, { allowDisplayNameConflict: true });
      projectsById.set(project.id, project);
      changed = true;
    } else if (existingProject.enabled === false) {
      const enabledProject = {
        ...existingProject,
        enabled: true,
      };
      await identityStore.upsertProject(enabledProject);
      projectsById.set(project.id, enabledProject);
      changed = true;
    }
    const timestamp = isoFromRuntimeTimestamp(runtimeSession.updatedAt, new Date().toISOString());
    await identityStore.upsertSession({
      id: legacyAppSessionId(threadId),
      codexThreadId: threadId,
      projectId: project.id,
      ownerUserId,
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
      archivedAt: null,
      archivedByUserId: null,
      archiveSource: null,
    });
    mappedThreadIds.add(threadId);
    changed = true;
  }

  return changed ? identityStore.readState() : identityState;
}

function adminOwnerUserId(state: CodexWebIdentityState, principal: CodexWebPrincipal): string {
  const adminUser = state.users.find((user) => user.id === 'user_admin')
    ?? state.users.find((user) => user.username === 'admin')
    ?? state.users.find((user) => user.enabled !== false && user.roleIds.some((roleId) => state.roles.some((role) => role.id === roleId && role.isAdmin)));
  return adminUser?.id ?? principal.userId;
}

function legacyProjectForRuntimeSession(runtimeSession: CodexWebSession): CodexWebProject {
  const cwd = normalizeOptionalString(runtimeSession.cwd) || '__codex_web_legacy_unknown_cwd__';
  const displayName = cwdLeafName(cwd) || normalizeOptionalString(runtimeSession.projectName) || 'Legacy Session';
  return {
    id: `project_admin_legacy_${stableIdHash(cwd, 20)}`,
    internalName: displayName,
    cwd,
    displayName,
    enabled: true,
    activeSessionLimit: null,
    showWorkDetailsToMembers: true,
  };
}

function legacyAppSessionId(threadId: string): string {
  return `app_legacy_${stableIdHash(threadId, 24)}`;
}

function stableIdHash(value: string, length: number): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, length);
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isoFromRuntimeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function presentAppSessionAudit(
  state: CodexWebIdentityState,
  appSession: CodexWebAppSession,
  summary: string | null = null,
): Record<string, unknown> {
  const project = findProject(state, appSession.projectId);
  return {
    id: appSession.id,
    projectId: appSession.projectId,
    projectDisplayName: projectDisplayName(project, appSession.projectId),
    ownerUserId: appSession.ownerUserId,
    codexThreadId: appSession.codexThreadId,
    createdAt: appSession.createdAt,
    updatedAt: appSession.updatedAt,
    archived: appSession.archived === true,
    archivedAt: appSession.archivedAt,
    archivedByUserId: appSession.archivedByUserId,
    archiveSource: appSession.archiveSource,
    ...(summary ? { summary } : {}),
  };
}

function comparePresentedSessionAudit(left: Record<string, unknown>, right: Record<string, unknown>): number {
  return auditSortTime(right) - auditSortTime(left)
    || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
    || String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
    || String(left.id || '').localeCompare(String(right.id || ''));
}

function auditSortTime(session: Record<string, unknown>): number {
  const updated = Date.parse(String(session.updatedAt || ''));
  if (Number.isFinite(updated)) {
    return updated;
  }
  const created = Date.parse(String(session.createdAt || ''));
  return Number.isFinite(created) ? created : 0;
}

async function adminSessionAuditSummaries(
  runtime: CodexWebRuntime,
  stateFilter: 'active' | 'archived' | 'all',
): Promise<Map<string, string>> {
  const summariesByThreadId = new Map<string, string>();
  const collect = async (options: { archived?: boolean } = {}) => {
    for (const runtimeSession of await runtime.listSessions(options)) {
      const threadId = normalizeOptionalString(runtimeSession.id);
      const summary = sessionAuditSummary(runtimeSession);
      if (threadId && summary && !summariesByThreadId.has(threadId)) {
        summariesByThreadId.set(threadId, summary);
      }
    }
  };

  if (stateFilter !== 'archived') {
    await collect();
  }
  if (stateFilter !== 'active') {
    await collect({ archived: true });
  }
  return summariesByThreadId;
}

function sessionAuditSummary(runtimeSession: unknown): string {
  if (!runtimeSession || typeof runtimeSession !== 'object') {
    return '';
  }
  const session = runtimeSession as Record<string, unknown>;
  return [
    session.firstUserInput,
    session.preview,
    session.lastUserInput,
    session.title,
  ]
    .map(normalizeOptionalString)
    .find(Boolean) ?? '';
}

function presentSessionForUser({
  runtimeSession,
  appSession,
  project,
  observer = false,
  includeOwnership = true,
  includeActivity = true,
  forceReadOnly = false,
  includeDetails = true,
  includeWorkDetails,
}: {
  runtimeSession: Partial<CodexWebSession> | null | undefined;
  appSession: CodexWebAppSession;
  project: CodexWebProject | null;
  observer?: boolean;
  includeOwnership?: boolean;
  includeActivity?: boolean;
  forceReadOnly?: boolean;
  includeDetails?: boolean;
  includeWorkDetails: boolean;
}): Record<string, unknown> {
  const session = runtimeSession ?? {};
  const readOnly = forceReadOnly || observer || appSession.archived === true;
  const activityState = presentSessionActivityState(session.activityState);
  return {
    id: appSession.id,
    projectId: appSession.projectId,
    projectDisplayName: projectDisplayName(project, appSession.projectId),
    canViewWorkDetails: includeWorkDetails,
    title: typeof session.title === 'string' ? session.title : null,
    updatedAt: typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt) ? session.updatedAt : null,
    preview: typeof session.preview === 'string' ? session.preview : null,
    firstUserInput: typeof session.firstUserInput === 'string' ? session.firstUserInput : null,
    lastUserInput: typeof session.lastUserInput === 'string' ? session.lastUserInput : null,
    lastInputAt: typeof session.lastInputAt === 'number' && Number.isFinite(session.lastInputAt) ? session.lastInputAt : null,
    favorite: session.favorite === true,
    favoriteOrder: typeof session.favoriteOrder === 'number' && Number.isFinite(session.favoriteOrder)
      ? session.favoriteOrder
      : null,
    ...(Object.prototype.hasOwnProperty.call(session, 'goal')
      ? { goal: presentSessionGoal(session.goal) }
      : {}),
    activeTurnId: typeof session.activeTurnId === 'string' ? session.activeTurnId : null,
    ...(includeActivity && activityState ? { activityState } : {}),
    settings: presentSessionSettings(session.settings),
    ...(includeDetails ? {
      thread: presentSessionThread(session.thread, includeWorkDetails),
      timeline: presentSessionTimeline(session.timeline, session.thread, includeWorkDetails),
    } : {}),
    archived: appSession.archived === true,
    archivedAt: appSession.archivedAt,
    archiveSource: appSession.archiveSource,
    ...(includeOwnership ? {
      ownerUserId: appSession.ownerUserId,
      archivedByUserId: appSession.archivedByUserId,
    } : {}),
    ...(observer ? { mode: 'observer' } : {}),
    ...(readOnly ? { readOnly: true } : {}),
  };
}

function presentSessionSummary(session: CodexWebSession): Partial<CodexWebSession> {
  const summary: Partial<CodexWebSession> = { ...session };
  delete summary.thread;
  delete summary.timeline;
  const activityState = presentSessionActivityState(session.activityState);
  if (activityState) {
    summary.activityState = activityState;
  } else {
    delete summary.activityState;
  }
  return summary;
}

function presentActiveTurnSnapshot(
  runtime: CodexWebRuntime,
  turnId: string | null | undefined,
  audience: CodexWebEventAudience,
): Record<string, unknown> | null {
  if (!turnId) {
    return null;
  }
  const replay = runtime.getTurnEventReplay(turnId, null, runtime.eventBus.epoch);
  const entries = runtime.getTurnEventSnapshot(turnId);
  const events = entries
    .map((entry) => {
      const event = presentCodexWebEvent(entry.event, audience);
      return event ? { ...event, sequence: entry.sequence } : null;
    })
    .filter((event): event is Record<string, unknown> & { sequence: number } => event !== null);
  const throughSequence = Math.max(
    replay.latestSequence ?? 0,
    ...entries.map((entry) => entry.sequence),
  ) || null;
  return {
    turnId,
    epoch: replay.epoch,
    throughSequence,
    complete: replay.snapshotComplete,
    events,
  };
}

function paginateSessionTimeline(
  timeline: Array<Record<string, unknown>>,
  url: URL,
): Record<string, unknown> {
  const requestedLimit = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(100, Math.floor(requestedLimit))
    : 50;
  const rawBefore = url.searchParams.get('before');
  const requestedBefore = rawBefore === null ? Number.NaN : Number(rawBefore);
  const end = Number.isFinite(requestedBefore) && requestedBefore >= 0
    ? Math.min(timeline.length, Math.floor(requestedBefore))
    : timeline.length;
  const start = Math.max(0, end - limit);
  return {
    items: timeline.slice(start, end),
    nextBefore: start > 0 ? String(start) : null,
    hasMore: start > 0,
    total: timeline.length,
  };
}

function shouldIncludeTimelineTurnSnapshot(request: IncomingMessage, url: URL): boolean {
  if (url.searchParams.has('before')) {
    return false;
  }
  const raw = request.headers['x-codex-include-turn-snapshot'];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'no';
}

function presentSessionActivityState(
  activityState: CodexWebSession['activityState'] | undefined,
): Exclude<CodexWebSession['activityState'], null> | null {
  return activityState === 'running' || activityState === 'waiting_approval'
    ? activityState
    : null;
}

function presentSessionGoal(goal: CodexWebSession['goal'] | undefined): Record<string, unknown> | null {
  if (!goal || typeof goal !== 'object') {
    return null;
  }
  return {
    objective: typeof goal.objective === 'string' ? goal.objective : '',
    status: typeof goal.status === 'string' ? goal.status : '',
    tokenBudget: Number.isFinite(goal.tokenBudget) ? Number(goal.tokenBudget) : null,
    tokensUsed: Number.isFinite(goal.tokensUsed) ? Number(goal.tokensUsed) : null,
    timeUsedSeconds: Number.isFinite(goal.timeUsedSeconds) ? Number(goal.timeUsedSeconds) : null,
    createdAt: typeof goal.createdAt === 'string' ? goal.createdAt : null,
    updatedAt: typeof goal.updatedAt === 'string' ? goal.updatedAt : null,
  };
}

async function readModelSettingsPayload(runtime: CodexWebRuntime): Promise<Record<string, unknown>> {
  const [items, defaults] = await Promise.all([
    runtime.listModels(),
    typeof runtime.readConfigDefaults === 'function'
      ? runtime.readConfigDefaults()
      : Promise.resolve(null),
  ]);
  return { items, defaults };
}

function presentSessionSettings(settings: CodexWebSession['settings'] | undefined): Record<string, unknown> {
  const value = settings ?? {} as CodexWebSession['settings'];
  return {
    model: typeof value.model === 'string' ? value.model : null,
    reasoningEffort: typeof value.reasoningEffort === 'string' ? value.reasoningEffort : null,
    serviceTier: typeof value.serviceTier === 'string' ? value.serviceTier : null,
    collaborationMode: value.collaborationMode === 'plan' ? 'plan' : 'default',
    personality: value.personality === 'friendly' || value.personality === 'none' ? value.personality : 'pragmatic',
    accessPreset: value.accessPreset === 'read-only' || value.accessPreset === 'full-access'
      ? value.accessPreset
      : 'default',
    approvalPolicy: typeof value.approvalPolicy === 'string' ? value.approvalPolicy : null,
    sandboxMode: typeof value.sandboxMode === 'string' ? value.sandboxMode : null,
    locale: typeof value.locale === 'string' ? value.locale : null,
    modelDefaultsVersion: Number.isFinite(value.metadata?.codexWebModelDefaultsVersion)
      ? Number(value.metadata?.codexWebModelDefaultsVersion)
      : null,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : null,
    favorite: value.favorite === true,
    favoriteOrder: Number.isFinite(value.favoriteOrder) ? Number(value.favoriteOrder) : null,
  };
}

function presentSessionThread(
  thread: CodexWebSession['thread'] | undefined,
  includeWorkDetails: boolean,
): Record<string, unknown> {
  return {
    turns: Array.isArray(thread?.turns)
      ? thread.turns.map((turn) => {
        const allowedItemIndexes = includeWorkDetails ? null : restrictedTurnConversationItemIndexes(turn);
        return {
          id: turn.id,
          status: turn.status,
          error: includeWorkDetails || !turn.error ? turn.error : 'Turn failed',
          items: Array.isArray(turn.items)
            ? turn.items
              .filter((_item, index) => includeWorkDetails || allowedItemIndexes?.has(index) === true)
              .map((item) => ({
                ...(typeof item.id === 'string' && item.id.trim() ? { itemId: item.id.trim() } : {}),
                type: item.type,
                role: item.role,
                phase: item.phase,
                text: item.text,
                ...(typeof item.raw?.clientId === 'string' && item.raw.clientId.trim()
                  ? { clientMessageId: stableIdHash(item.raw.clientId.trim(), 24) }
                  : {}),
              }))
            : [],
        };
      })
      : [],
  };
}

function restrictedConversationRole(item: {
  type?: string | null;
  role?: string | null;
  phase?: string | null;
}): 'user' | 'assistant' | null {
  const role = typeof item.role === 'string' ? item.role.trim().toLowerCase() : '';
  const type = typeof item.type === 'string' ? item.type.replace(/[^a-z]/giu, '').toLowerCase() : '';
  if (role === 'user' || (!role && type.includes('user') && type.includes('message'))) {
    return 'user';
  }
  const assistantMessage = (role === 'assistant' || (!role && (type.includes('assistant') || type.includes('agent'))))
    && (type === 'message' || type.includes('message'));
  if (!assistantMessage) {
    return null;
  }
  return 'assistant';
}

function restrictedTurnConversationItemIndexes(turn: {
  status?: string | null;
  items?: Array<{
    type?: string | null;
    role?: string | null;
    phase?: string | null;
  }> | null;
}): Set<number> {
  const items = Array.isArray(turn.items) ? turn.items : [];
  const allowed = new Set<number>();
  let hasExplicitFinal = false;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const role = restrictedConversationRole(item);
    if (role === 'user') {
      allowed.add(index);
      continue;
    }
    if (role !== 'assistant') {
      continue;
    }
    if (normalizeAssistantPhase(item.phase) === 'final_answer') {
      hasExplicitFinal = true;
      allowed.add(index);
    }
  }
  if (!hasExplicitFinal && isSuccessfulHydrationTurnStatus(turn.status)) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (
        restrictedConversationRole(items[index]!) === 'assistant'
        && normalizeAssistantPhase(items[index]!.phase) === ''
      ) {
        allowed.add(index);
        break;
      }
    }
  }
  return allowed;
}

function normalizeAssistantPhase(phase: string | null | undefined): string {
  return typeof phase === 'string' ? phase.trim().toLowerCase() : '';
}

const SUCCESSFUL_HYDRATION_TURN_STATUSES = new Set([
  'complete',
  'completed',
  'finished',
  'succeeded',
  'success',
]);

function isSuccessfulHydrationTurnStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, '');
  return SUCCESSFUL_HYDRATION_TURN_STATUSES.has(normalized);
}

function restrictedAssistantTimelineTextCounts(
  thread: CodexWebSession['thread'] | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const turn of thread?.turns ?? []) {
    const items = turn.items ?? [];
    for (const index of restrictedTurnConversationItemIndexes(turn)) {
      const item = items[index];
      if (restrictedConversationRole(item) !== 'assistant') {
        continue;
      }
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (text) {
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function restrictedAssistantTimelineIndexes(
  timeline: NonNullable<CodexWebSession['timeline']>,
  thread: CodexWebSession['thread'] | undefined,
): Set<number> {
  const remainingByText = restrictedAssistantTimelineTextCounts(thread);
  const allowed = new Set<number>();
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index]!;
    if (entry.role !== 'assistant') {
      continue;
    }
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    const remaining = remainingByText.get(text) ?? 0;
    if (!text || remaining <= 0) {
      continue;
    }
    allowed.add(index);
    remainingByText.set(text, remaining - 1);
  }
  return allowed;
}

function presentSessionTimeline(
  timeline: CodexWebSession['timeline'] | undefined,
  thread: CodexWebSession['thread'] | undefined,
  includeWorkDetails: boolean,
): Array<Record<string, unknown>> {
  if (!Array.isArray(timeline)) {
    return [];
  }
  const allowedAssistantIndexes = includeWorkDetails ? null : restrictedAssistantTimelineIndexes(timeline, thread);
  return timeline.flatMap((entry, index) => {
    if (!includeWorkDetails) {
      if (entry.role === 'system' && entry.severity !== 'error') {
        return [];
      }
      if (entry.role === 'assistant' && allowedAssistantIndexes?.has(index) !== true) {
        return [];
      }
    }
    const restrictedError = !includeWorkDetails && entry.severity === 'error';
    const restrictedAssistant = !includeWorkDetails && entry.role === 'assistant';
    return [{
      id: entry.id,
      kind: 'message',
      role: entry.role,
      label: restrictedError ? 'Error' : restrictedAssistant ? 'Assistant' : entry.label,
      meta: restrictedError ? 'failed' : restrictedAssistant ? 'final' : entry.meta,
      text: restrictedError ? 'Turn failed' : entry.text,
      ...(typeof entry.turnId === 'string' && entry.turnId ? { turnId: entry.turnId } : {}),
      ...(typeof entry.itemId === 'string' && entry.itemId ? { itemId: entry.itemId } : {}),
      ...(typeof entry.projectionKey === 'string' && entry.projectionKey ? { projectionKey: entry.projectionKey } : {}),
      ...(typeof entry.clientMessageId === 'string' && entry.clientMessageId
        ? { clientMessageId: entry.clientMessageId }
        : {}),
      ...(typeof entry.phase === 'string' && entry.phase ? { phase: entry.phase } : {}),
      ...(entry.lifecycle === 'started' || entry.lifecycle === 'delta' || entry.lifecycle === 'completed'
        ? { lifecycle: entry.lifecycle }
        : {}),
      ...(entry.severity === 'error' ? { severity: 'error' } : {}),
      ...(Number.isFinite(entry.afterHistoryIndex) ? { afterHistoryIndex: Number(entry.afterHistoryIndex) } : {}),
    }];
  });
}

function presentStartTurnResultForUser({
  result,
  appSession,
  project,
  includeWorkDetails,
}: {
  result: CodexWebStartTurnResult;
  appSession: CodexWebAppSession;
  project: CodexWebProject | null;
  includeWorkDetails: boolean;
}): Record<string, unknown> {
  if (!('type' in result)) {
    return { turnId: result.turnId };
  }
  return {
    type: 'command',
    ...(result.turnId ? { turnId: result.turnId } : {}),
    command: {
      name: result.command.name,
      action: result.command.action,
      message: result.command.message,
      goal: presentSessionGoal(result.command.goal ?? undefined),
    },
    ...(result.session ? {
      session: presentSessionForUser({
        runtimeSession: result.session,
        appSession,
        project,
        includeWorkDetails,
      }),
    } : {}),
  };
}

function writeSessionListPage(
  response: ServerResponse,
  url: URL,
  items: Array<Record<string, unknown>>,
  context: { principalId: string; scope: string },
): void {
  try {
    const page = paginateSessionList(items, {
      cursor: url.searchParams.get('cursor'),
      limit: url.searchParams.get('limit'),
      principalId: context.principalId,
      scope: context.scope,
    });
    writeJson(response, 200, page);
  } catch (error) {
    if (error instanceof InvalidSessionListCursorError) {
      writeJson(response, 400, {
        error: error.code,
        message: error.message,
      });
      return;
    }
    throw error;
  }
}

async function reconcileOppositeArchiveStates({
  identityStore,
  runtime,
  appSessions,
  indexedArchived,
}: {
  identityStore: CodexWebIdentityStoreLike;
  runtime: CodexWebRuntime;
  appSessions: CodexWebAppSession[];
  indexedArchived: boolean;
}): Promise<Set<string>> {
  if (!appSessions.length) {
    return new Set();
  }
  const oppositeThreadIds = new Set(
    (await runtime.listSessions({ archived: !indexedArchived })).map((session) => session.id),
  );
  const reconciled = new Set<string>();
  for (const appSession of appSessions) {
    if (!oppositeThreadIds.has(appSession.codexThreadId)) {
      continue;
    }
    const actualArchived = !indexedArchived;
    await identityStore.upsertSession({
      ...appSession,
      archived: actualArchived,
      archivedAt: actualArchived ? appSession.archivedAt ?? new Date().toISOString() : null,
      archivedByUserId: actualArchived ? appSession.archivedByUserId : null,
      archiveSource: actualArchived ? 'codex' : null,
    });
    reconciled.add(appSession.codexThreadId);
  }
  return reconciled;
}

function sessionListScopeKey({
  favoriteOnly,
  archivedOnly,
  projectKey,
}: {
  favoriteOnly: boolean;
  archivedOnly: boolean;
  projectKey: string;
}): string {
  const state = archivedOnly ? 'archived' : favoriteOnly ? 'favorites' : 'active';
  return `${state}:${projectKey || 'all'}`;
}

function normalizeSessionStateFilter(value: string | null): 'active' | 'archived' | 'all' {
  if (value === 'archived' || value === 'all') {
    return value;
  }
  return 'active';
}

function activeSessionLimitForProject(project: CodexWebProject | null): number | null {
  if (!project) {
    return null;
  }
  return typeof project.activeSessionLimit === 'number' && Number.isInteger(project.activeSessionLimit) && project.activeSessionLimit > 0
    ? project.activeSessionLimit
    : project.activeSessionLimit === null
      ? null
      : 30;
}

function canViewProjectWorkDetails(
  principal: CodexWebPrincipal,
  project: CodexWebProject | null | undefined,
): boolean {
  return principal.isAdmin || project?.showWorkDetailsToMembers === true;
}

function countActiveSessions(state: CodexWebIdentityState, ownerUserId: string, projectId: string): number {
  return state.sessions.filter((session) => (
    session.ownerUserId === ownerUserId
    && session.projectId === projectId
    && session.archived !== true
  )).length;
}

function activeSessionLimitReachedPayload(projectId: string, activeSessionLimit: number): Record<string, unknown> {
  return {
    error: 'active_session_limit_reached',
    message: 'Archive an existing session before creating a new one.',
    projectId,
    activeSessionLimit,
  };
}

function rejectArchivedSessionWrite(response: ServerResponse, appSession: CodexWebAppSession): boolean {
  if (appSession.archived !== true) {
    return false;
  }
  writeJson(response, 409, archivedSessionWritePayload());
  return true;
}

function archivedSessionWritePayload(): Record<string, unknown> {
  return {
    error: 'session_archived',
    message: 'Unarchive this session before making changes.',
  };
}

function projectDisplayName(project: CodexWebProject | null | undefined, fallback: string): string {
  const displayName = cwdLeafName(project?.displayName);
  if (displayName) {
    return displayName;
  }
  return cwdLeafName(project?.cwd) || normalizeOptionalString(fallback) || normalizeOptionalString(project?.id) || 'Unknown project';
}

function cwdLeafName(cwd: unknown): string {
  const parts = normalizeOptionalString(cwd).split(/[\\/]+/u).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : '';
}

function getClientAddress(request: IncomingMessage): string {
  return request.socket.remoteAddress || 'unknown';
}

async function loginWithPassword({
  auth,
  username,
  password,
  deviceName,
  response,
}: {
  auth: CodexWebAuthLike;
  username: string | null;
  password: string;
  deviceName: string | null;
  response: ServerResponse;
}): Promise<{ token: string; session: PublicAuthSession; configuredNow: boolean } | null> {
  try {
    return await auth.login({ username, password, deviceName });
  } catch (error) {
    if (error instanceof Error && (error.message === 'Invalid password' || error.message === 'Invalid username or password')) {
      writeJson(response, 401, {
        error: 'invalid_password',
        message: error.message,
      });
      return null;
    }
    throw error;
  }
}

async function startSessionTurn({
  runtime,
  sessionId,
  input,
  response,
}: {
  runtime: CodexWebRuntime;
  sessionId: string;
  input: StartTurnInput;
  response: ServerResponse;
}): Promise<CodexWebStartTurnResult | null> {
  try {
    return await runtime.startTurn(sessionId, input);
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      writeRequestLog({
        level: 'warn',
        method: 'POST',
        path: `/api/sessions/${encodeURIComponent(sessionId)}/turns`,
        status: 404,
        code: 'session_not_found',
        message: error instanceof Error ? error.message : String(error),
      });
      writeSessionNotFound(response);
      return null;
    }
    if (isTurnConflictError(error)) {
      const activeTurnId = extractActiveTurnId(error);
      writeRequestLog({
        level: 'warn',
        method: 'POST',
        path: `/api/sessions/${encodeURIComponent(sessionId)}/turns`,
        status: 409,
        code: 'turn_conflict',
        message: error instanceof Error ? error.message : String(error),
      });
      writeJson(response, 409, {
        error: 'turn_conflict',
        message: error instanceof Error ? error.message : String(error),
        ...(activeTurnId ? { activeTurnId } : {}),
      });
      return null;
    }
    throw error;
  }
}

async function steerSessionTurn({
  runtime,
  sessionId,
  turnId,
  input,
  response,
  clientUserMessageId = null,
}: {
  runtime: CodexWebRuntime;
  sessionId: string;
  turnId: string;
  input: StartTurnInput;
  response: ServerResponse;
  clientUserMessageId?: string | null;
}): Promise<{ turnId: string } | null> {
  try {
    return await runtime.steerTurnForThread(sessionId, turnId, input, clientUserMessageId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isActiveTurnNotSteerableError(error)) {
      writeRequestLog({
        level: 'warn',
        method: 'POST',
        path: `/api/turns/${encodeURIComponent(turnId)}/steer`,
        status: 409,
        code: 'active_turn_not_steerable',
        message,
      });
      writeJson(response, 409, {
        error: 'active_turn_not_steerable',
        message,
      });
      return null;
    }
    if (isSteerTurnConflictError(error)) {
      writeRequestLog({
        level: 'warn',
        method: 'POST',
        path: `/api/turns/${encodeURIComponent(turnId)}/steer`,
        status: 409,
        code: 'turn_conflict',
        message,
      });
      writeJson(response, 409, {
        error: 'turn_conflict',
        message,
      });
      return null;
    }
    throw error;
  }
}

async function projectCodexWebRuntimeContext({
  config,
  runtime,
  appSession,
  user,
  project,
}: {
  config: CodexWebConfig;
  runtime: CodexWebRuntime;
  appSession: CodexWebAppSession;
  user: CodexWebUser | null;
  project: CodexWebProject | null;
}): Promise<{
  canonicalContextPath: string;
  developerInstructions: string;
  runtimeEnv: Record<string, string>;
}> {
  const { contextPath, canonicalContextPath } = resolveCodexWebRuntimeContextPaths(config, appSession.id);
  const payload = {
    schemaVersion: 1,
    appSessionId: appSession.id,
    codexThreadId: appSession.codexThreadId,
    owner: {
      userId: user?.id ?? appSession.ownerUserId,
      username: user?.username ?? appSession.ownerUserId,
      email: user?.email ?? null,
    },
    project: {
      id: project?.id ?? appSession.projectId,
      displayName: projectDisplayName(project, appSession.projectId),
    },
    updatedAt: new Date().toISOString(),
  };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const skillAvailable = await codexWebUserContextSkillIsAvailable(runtime, project?.cwd ?? null);
  return withStorageQuotaHttpError(() => withManagedStateStorageCapacity({
    config,
    incomingBytes: Buffer.byteLength(serialized),
    operation: async () => {
      await writePrivateRuntimeContextFile(contextPath, serialized);
      return {
        canonicalContextPath,
        developerInstructions: [
          'This turn is running under Codex Web.',
          `Codex Web context file: ${canonicalContextPath}`,
          skillAvailable
            ? 'Use the codex-web-user-context skill if the current web user context is needed.'
            : 'Use CODEX_WEB_CONTEXT_FILE when the current Codex Web user context is needed.',
        ].join('\n'),
        runtimeEnv: {
          CODEX_WEB_CONTEXT_FILE: canonicalContextPath,
        },
      };
    },
  }));
}

function codexWebRuntimeContextEnvironment(
  config: CodexWebConfig,
  appSessionId: string,
): Record<string, string> {
  return {
    CODEX_WEB_CONTEXT_FILE: resolveCodexWebRuntimeContextPaths(config, appSessionId).canonicalContextPath,
  };
}

function resolveCodexWebRuntimeContextPaths(
  config: CodexWebConfig,
  appSessionId: string,
): { contextPath: string; canonicalContextPath: string } {
  const runtimeContextHostDir = path.resolve(config.stateDir, 'runtime-context', 'sessions');
  const runtimeContextDir = path.resolve(
    normalizeOptionalString(config.runtimeContextDir) || runtimeContextHostDir,
  );
  const contextFileName = `${safePathSegment(appSessionId)}-${stableIdHash(appSessionId, 16)}.json`;
  return {
    contextPath: path.join(runtimeContextHostDir, contextFileName),
    canonicalContextPath: path.join(runtimeContextDir, contextFileName),
  };
}

async function codexWebUserContextSkillIsAvailable(
  runtime: CodexWebRuntime,
  cwd: string | null,
): Promise<boolean> {
  const hasAvailableSkill = (runtime as Partial<CodexWebRuntime>).hasAvailableSkill;
  if (typeof hasAvailableSkill !== 'function') {
    return false;
  }
  return hasAvailableSkill.call(runtime, 'codex-web-user-context', cwd);
}

async function writePrivateRuntimeContextFile(filePath: string, serialized: string): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStats = await fs.lstat(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new Error('Codex Web runtime context directory must be a regular directory.');
  }

  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
    handle = await fs.open(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      0o600,
    );
    await handle.writeFile(serialized, 'utf8');
    await handle.chmod(0o600);
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, 0o600);
    const stats = await fs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Codex Web runtime context must be a regular file.');
    }
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function storeSessionAttachments({
  request,
  config,
  principal,
  projectCwd,
  projectKey,
}: {
  request: IncomingMessage;
  config: CodexWebConfig;
  principal: CodexWebPrincipal;
  projectCwd: string;
  projectKey: string;
}): Promise<StoredUploadAttachment[]> {
  const files = await readMultipartUploadFiles(request);
  if (!files.length) {
    throw createHttpError(400, 'invalid_upload', 'Upload request must include at least one file.');
  }
  const incomingBytes = files.reduce((sum, file) => sum + file.data.byteLength, 0);
  const userSegment = safePathSegment(principal.userId || principal.username || 'local-user');
  const projectStorage = normalizeOptionalString(projectCwd)
    ? path.join(projectCwd, 'uploads', userSegment)
    : '';
  if (projectStorage) {
    try {
      return await withStorageQuotaHttpError(() => withProjectUploadCapacity({
        config,
        uploadsRoot: path.join(projectCwd, 'uploads'),
        incomingBytes,
        operation: () => writeUploadFiles({
          files,
          rootDir: projectStorage,
          storage: 'project',
          createProjectGitignore: true,
        }),
      }));
    } catch (error) {
      if (!isProjectUploadFallbackError(error)) {
        throw error;
      }
    }
  }
  const stateStorage = path.join(
    config.stateDir,
    'uploads',
    'projects',
    safePathSegment(projectKey || `cwd-${stableIdHash(projectCwd || 'unknown', 16)}`),
    userSegment,
  );
  try {
    return await withStorageQuotaHttpError(() => withManagedStateStorageCapacity({
      config,
      incomingBytes,
      operation: () => writeUploadFiles({
        files,
        rootDir: stateStorage,
        storage: 'state',
        createProjectGitignore: false,
      }),
    }));
  } catch (error) {
    if (isProjectUploadFallbackError(error)) {
      throw createHttpError(403, 'project_upload_not_writable', 'Upload directory is not writable.');
    }
    throw error;
  }
}

async function normalizeStartTurnInput({
  body,
  config,
  principal,
  runtime,
  sessionId,
  projectCwd,
  projectKey,
}: {
  body: Record<string, unknown>;
  config: CodexWebConfig;
  principal: CodexWebPrincipal;
  runtime: CodexWebRuntime;
  sessionId: string;
  projectCwd: string;
  projectKey: string;
}): Promise<StartTurnInput | null> {
  if (!hasRequestAttachments(body)) {
    return body as unknown as StartTurnInput;
  }
  let resolvedProjectCwd = normalizeOptionalString(projectCwd);
  if (!resolvedProjectCwd) {
    const session = await runtime.readSession(sessionId);
    if (!session) {
      return null;
    }
    resolvedProjectCwd = normalizeOptionalString(session.cwd);
  }
  const allowedRoots = allowedUploadRoots({
    config,
    principal,
    projectCwd: resolvedProjectCwd,
    projectKey: projectKey || `cwd-${stableIdHash(resolvedProjectCwd || sessionId, 16)}`,
  });
  const normalizedAttachments = (body.attachments as unknown[]).map((raw) => {
    const attachment = normalizeAttachmentRequest(raw);
    if (!attachment) {
      throw createHttpError(400, 'invalid_attachment', 'Attachment payload is invalid.');
    }
    return attachment;
  });
  const protectedPaths = normalizedAttachments.map((attachment) => path.resolve(attachment.localPath));
  const attachments = [];
  for (const attachment of normalizedAttachments) {
    const localPath = await snapshotValidatedAttachment({
      attachment,
      allowedRoots,
      config,
      principal,
      sessionId,
      protectedPaths,
    });
    attachments.push({
      ...attachment,
      localPath,
    });
  }
  return {
    ...(body as unknown as StartTurnInput),
    attachments,
  };
}

function hasRequestAttachments(body: Record<string, unknown>): boolean {
  return Array.isArray(body.attachments) && body.attachments.length > 0;
}

function allowedUploadRoots({
  config,
  principal,
  projectCwd,
  projectKey,
}: {
  config: CodexWebConfig;
  principal: CodexWebPrincipal;
  projectCwd: string;
  projectKey: string;
}): string[] {
  const userSegment = safePathSegment(principal.userId || principal.username || 'local-user');
  const roots = [
    path.resolve(
      config.stateDir,
      'uploads',
      'projects',
      safePathSegment(projectKey || `cwd-${stableIdHash(projectCwd || 'unknown', 16)}`),
      userSegment,
    ),
  ];
  if (projectCwd) {
    roots.unshift(path.resolve(projectCwd, 'uploads', userSegment));
  }
  return roots;
}

function normalizeAttachmentRequest(value: unknown): {
  kind: 'image' | 'file';
  localPath: string;
  fileName?: string | null;
  mimeType?: string | null;
  transcriptText?: string | null;
  durationSeconds?: number | null;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const localPath = typeof record.localPath === 'string' ? record.localPath.trim() : '';
  if (!localPath) {
    return null;
  }
  return {
    kind: record.kind === 'image' ? 'image' : 'file',
    localPath,
    fileName: typeof record.fileName === 'string' && record.fileName.trim() ? record.fileName.trim() : null,
    mimeType: typeof record.mimeType === 'string' && record.mimeType.trim() ? record.mimeType.trim() : null,
    transcriptText: typeof record.transcriptText === 'string' && record.transcriptText.trim() ? record.transcriptText.trim() : null,
    durationSeconds: typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)
      ? record.durationSeconds
      : null,
  };
}

async function snapshotValidatedAttachment({
  attachment,
  allowedRoots,
  config,
  principal,
  sessionId,
  protectedPaths,
}: {
  attachment: NonNullable<ReturnType<typeof normalizeAttachmentRequest>>;
  allowedRoots: string[];
  config: CodexWebConfig;
  principal: CodexWebPrincipal;
  sessionId: string;
  protectedPaths: string[];
}): Promise<string> {
  const requestedPath = path.resolve(attachment.localPath);
  const lexicalRoot = allowedRoots.find((root) => isPathInside(requestedPath, root));
  if (!lexicalRoot) {
    throw createHttpError(400, 'invalid_attachment', 'Attachment path is outside the allowed upload directories.');
  }

  try {
    await rejectPathSymlinks(lexicalRoot, requestedPath);
    const [realPath, realRoots] = await Promise.all([
      fs.realpath(requestedPath),
      Promise.all(allowedRoots.map(async (root) => fs.realpath(root).catch(() => null))),
    ]);
    if (!realRoots.some((root): root is string => Boolean(root) && isPathInside(realPath, root!))) {
      throw createHttpError(400, 'invalid_attachment', 'Attachment path is outside the allowed upload directories.');
    }

    const beforeOpen = await fs.lstat(requestedPath);
    if (beforeOpen.isSymbolicLink() || !beforeOpen.isFile()) {
      throw createHttpError(400, 'invalid_attachment', 'Attachment must be a regular file.');
    }
    const handle = await fs.open(requestedPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    let data: Buffer;
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile()
        || opened.dev !== beforeOpen.dev
        || opened.ino !== beforeOpen.ino
        || opened.size > MAX_UPLOAD_FILE_BYTES
      ) {
        throw createHttpError(400, 'invalid_attachment', 'Attachment changed while it was being validated.');
      }
      data = await handle.readFile();
      if (data.byteLength > MAX_UPLOAD_FILE_BYTES) {
        throw createHttpError(400, 'invalid_attachment', 'Attachment exceeds the maximum file size.');
      }
    } finally {
      await handle.close();
    }

    const userSegment = safePathSegment(principal.userId || principal.username || 'local-user');
    const snapshotRoot = path.join(
      config.stateDir,
      'turn-attachments',
      userSegment,
      safePathSegment(sessionId),
    );
    const snapshotName = `${crypto.randomUUID()}-${safeUploadFileName(attachment.fileName || path.basename(requestedPath))}`;
    const snapshotPath = path.resolve(snapshotRoot, snapshotName);
    if (!isPathInside(snapshotPath, path.resolve(snapshotRoot))) {
      throw createHttpError(400, 'invalid_attachment', 'Attachment snapshot path is invalid.');
    }
    return await withStorageQuotaHttpError(() => withManagedStateStorageCapacity({
      config,
      incomingBytes: data.byteLength,
      protectedPaths,
      operation: async () => {
        await ensurePrivateSnapshotDirectory(config.stateDir, snapshotRoot);
        await fs.writeFile(snapshotPath, data, { flag: 'wx', mode: 0o400 });
        return snapshotPath;
      },
    }));
  } catch (error) {
    if (isHttpError(error)) {
      throw error;
    }
    throw createHttpError(400, 'invalid_attachment', 'Attachment file is not accessible.');
  }
}

async function rejectPathSymlinks(rootPath: string, candidatePath: string): Promise<void> {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  if (!isPathInside(candidate, root)) {
    throw createHttpError(400, 'invalid_attachment', 'Attachment path is outside the allowed upload directories.');
  }
  const relative = path.relative(root, candidate);
  const paths = [root];
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    paths.push(current);
  }
  for (const entryPath of paths) {
    const stats = await fs.lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw createHttpError(400, 'invalid_attachment', 'Attachment paths must not contain symbolic links.');
    }
  }
}

async function ensurePrivateSnapshotDirectory(stateDir: string, snapshotRoot: string): Promise<void> {
  const stateRoot = path.resolve(stateDir);
  const root = path.resolve(snapshotRoot);
  if (!isPathInside(root, stateRoot)) {
    throw createHttpError(500, 'invalid_attachment_storage', 'Attachment snapshot directory is invalid.');
  }
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await rejectPathSymlinks(stateRoot, root);
  const [realStateRoot, realRoot] = await Promise.all([fs.realpath(stateRoot), fs.realpath(root)]);
  if (!isPathInside(realRoot, realStateRoot)) {
    throw createHttpError(500, 'invalid_attachment_storage', 'Attachment snapshot directory is invalid.');
  }
}

async function writeUploadFiles({
  files,
  rootDir,
  storage,
  createProjectGitignore,
}: {
  files: ParsedUploadFile[];
  rootDir: string;
  storage: 'project' | 'state';
  createProjectGitignore: boolean;
}): Promise<StoredUploadAttachment[]> {
  await ensureUploadDirectory(rootDir, createProjectGitignore);
  const root = path.resolve(rootDir);
  const items: StoredUploadAttachment[] = [];
  for (const file of files) {
    const id = `att_${crypto.randomUUID().replace(/-/gu, '').slice(0, 20)}`;
    const safeName = safeUploadFileName(file.fileName);
    const localPath = path.resolve(root, `${id}-${safeName}`);
    if (!isPathInside(localPath, root)) {
      throw createHttpError(400, 'invalid_upload', 'Upload path is invalid.');
    }
    await fs.writeFile(localPath, file.data, { flag: 'wx', mode: 0o600 });
    items.push({
      id,
      kind: file.mimeType?.toLowerCase().startsWith('image/') ? 'image' : 'file',
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.data.byteLength,
      storage,
      localPath,
      displayPath: localPath,
    });
  }
  return items;
}

async function ensureUploadDirectory(rootDir: string, createProjectGitignore: boolean): Promise<void> {
  const root = path.resolve(rootDir);
  const parent = path.dirname(root);
  await rejectSymlinkIfPresent(parent);
  await rejectSymlinkIfPresent(root);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await rejectSymlinkIfPresent(root);
  if (createProjectGitignore) {
    const uploadsDir = path.dirname(root);
    await rejectSymlinkIfPresent(uploadsDir);
    await fs.writeFile(path.join(uploadsDir, '.gitignore'), '*\n!.gitignore\n', { flag: 'w', mode: 0o600 });
  }
}

async function rejectSymlinkIfPresent(filePath: string): Promise<void> {
  try {
    const stats = await fs.lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw createHttpError(403, 'project_upload_not_writable', 'Upload directory must not be a symbolic link.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function readMultipartUploadFiles(request: IncomingMessage): Promise<ParsedUploadFile[]> {
  const contentType = String(request.headers['content-type'] ?? '');
  const boundary = parseMultipartBoundary(contentType);
  if (!boundary) {
    throw createHttpError(400, 'invalid_upload', 'Upload request must use multipart/form-data.');
  }
  const body = await readRequestBody(request, MAX_UPLOAD_BODY_BYTES);
  const raw = body.toString('latin1');
  const segments = raw.split(`--${boundary}`);
  const files: ParsedUploadFile[] = [];
  for (const segment of segments) {
    if (!segment || segment === '--\r\n' || segment === '--') {
      continue;
    }
    let part = segment;
    if (part.startsWith('\r\n')) {
      part = part.slice(2);
    }
    if (part.endsWith('\r\n')) {
      part = part.slice(0, -2);
    }
    if (part.endsWith('--')) {
      part = part.slice(0, -2);
    }
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      continue;
    }
    const headerText = part.slice(0, headerEnd);
    const contentText = part.slice(headerEnd + 4);
    const headers = parseMultipartHeaders(headerText);
    const disposition = headers.get('content-disposition') || '';
    const name = multipartDispositionValue(disposition, 'name');
    const fileName = multipartDispositionValue(disposition, 'filename');
    if (!fileName || (name !== 'files' && name !== 'file')) {
      continue;
    }
    const data = Buffer.from(contentText, 'latin1');
    if (data.byteLength > MAX_UPLOAD_FILE_BYTES) {
      throw createHttpError(413, 'payload_too_large', 'Uploaded file is too large.');
    }
    files.push({
      fileName: normalizeUploadedFileName(fileName),
      mimeType: normalizeOptionalString(headers.get('content-type')) || null,
      data,
    });
  }
  return files;
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw createHttpError(413, 'payload_too_large', 'Request body is too large.');
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw createHttpError(413, 'payload_too_large', 'Request body is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseMultipartBoundary(contentType: string): string {
  const match = contentType.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/iu);
  return normalizeOptionalString(match?.[1] || match?.[2]);
}

function parseMultipartHeaders(headerText: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of headerText.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}

function multipartDispositionValue(disposition: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = disposition.match(new RegExp(`${escapedKey}="([^"]*)"`, 'iu'));
  return match ? Buffer.from(match[1]!, 'latin1').toString('utf8') : '';
}

function normalizeUploadedFileName(fileName: string): string {
  const normalized = path.basename(fileName.replace(/\\/gu, '/')).trim();
  return normalized || 'upload';
}

function safeUploadFileName(fileName: string): string {
  const normalized = normalizeUploadedFileName(fileName)
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return normalized || 'upload';
}

function safePathSegment(value: string): string {
  const normalized = normalizeOptionalString(value)
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return normalized || 'unknown';
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isProjectUploadFallbackError(error: unknown): boolean {
  if (isHttpError(error)) {
    return error.statusCode === 403;
  }
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return code === 'EACCES'
    || code === 'EPERM'
    || code === 'EROFS'
    || code === 'ENOTDIR'
    || code === 'ENOENT';
}

function writeSessionNotFound(response: ServerResponse): void {
  writeJson(response, 404, {
    error: 'session_not_found',
    message: 'Selected session was not found.',
  });
}

function writeSessionFileNotFound(response: ServerResponse): void {
  writeJson(response, 404, {
    error: 'file_not_found',
    message: 'Session file was not found.',
  });
}

function normalizeSessionTimelineEntryInput(value: unknown): AppendSessionTimelineEntryInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const role = entry.role === 'user' || entry.role === 'assistant' || entry.role === 'system'
    ? entry.role
    : null;
  const text = typeof entry.text === 'string' ? entry.text.trim() : '';
  if (role !== 'system' || !text) {
    return null;
  }
  return {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null,
    role,
    label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : null,
    meta: typeof entry.meta === 'string' && entry.meta.trim() ? entry.meta.trim() : null,
    text,
    severity: entry.severity === 'error' ? 'error' : null,
    ...(Number.isFinite(entry.afterHistoryIndex) ? { afterHistoryIndex: Number(entry.afterHistoryIndex) } : {}),
  };
}

async function resolveReportForResponse(
  reportStore: FileReportStore,
  inputPath: string,
  response: ServerResponse,
): Promise<CodexWebReport | null> {
  return readReportForResponse(() => reportStore.resolveReport(inputPath), response);
}

async function readReportContentForResponse(
  reportStore: FileReportStore,
  reportId: string,
  response: ServerResponse,
): Promise<{ report: CodexWebReport; content: string } | null> {
  try {
    const content = await reportStore.readContent(reportId);
    if (!content) {
      writeReportNotFound(response);
      return null;
    }
    return content;
  } catch (error) {
    if (isInvalidReportPathError(error)) {
      writeInvalidReportPath(response, error);
      return null;
    }
    throw error;
  }
}

async function readReportForResponse(
  read: () => Promise<CodexWebReport | null>,
  response: ServerResponse,
): Promise<CodexWebReport | null> {
  try {
    const report = await read();
    if (!report) {
      writeReportNotFound(response);
      return null;
    }
    return report;
  } catch (error) {
    if (isInvalidReportPathError(error)) {
      writeInvalidReportPath(response, error);
      return null;
    }
    throw error;
  }
}

function writeReportNotFound(response: ServerResponse): void {
  writeJson(response, 404, {
    error: 'report_not_found',
    message: 'Selected report was not found.',
  });
}

function writeInvalidReportPath(response: ServerResponse, error: unknown): void {
  writeJson(response, 400, {
    error: 'invalid_report_path',
    message: error instanceof Error ? error.message : 'Invalid report path.',
  });
}

function isInvalidReportPathError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid report id|outside the reports directory|markdown or html/iu.test(message);
}

function isSessionNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown session/i.test(message)
    || /thread not found/i.test(message)
    || /session not found/i.test(message)
    || /unknown thread/i.test(message);
}

function isTurnConflictError(error: unknown): boolean {
  return error instanceof Error
    && (error as Error & { code?: string }).code === 'turn_conflict';
}

function isActiveTurnNotSteerableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = String((error as Error & { code?: unknown }).code ?? '');
  return code === 'active_turn_not_steerable'
    || code === 'activeTurnNotSteerable'
    || /active.?turn.?not.?steerable/iu.test(error.message)
    || /cannot steer (?:a )?(?:review|compact) turn/iu.test(error.message);
}

function isSteerTurnConflictError(error: unknown): boolean {
  return error instanceof Error && (
    isTurnConflictError(error)
    || /no active turn to steer/iu.test(error.message)
    || /expected.?turn.?mismatch/iu.test(error.message)
    || /does not match the currently active turn/iu.test(error.message)
  );
}

function isUsernameConflictError(error: unknown): boolean {
  return error instanceof Error
    && (error as Error & { code?: string }).code === 'username_conflict';
}

function isProjectDisplayNameConflictError(error: unknown): boolean {
  return error instanceof Error
    && (error as Error & { code?: string }).code === 'project_display_name_conflict';
}

async function withProjectDisplayNameConflictHttpError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isProjectDisplayNameConflictError(error)) {
      throw createHttpError(409, 'project_display_name_conflict', 'A project with this display name already exists.');
    }
    throw error;
  }
}

function extractActiveTurnId(error: unknown): string | null {
  const activeTurnId = error instanceof Error
    ? (error as Error & { activeTurnId?: unknown }).activeTurnId
    : null;
  return typeof activeTurnId === 'string' && activeTurnId.trim()
    ? activeTurnId.trim()
    : null;
}

function extractBearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string') {
    const match = header.match(/^Bearer\s+(.+)$/iu);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

export async function streamTurnEvents({
  request,
  response,
  runtime,
  turnId,
  afterId,
  requestedEpoch,
  registerSseCloser,
  audience = 'workspace',
}: {
  request: IncomingMessage;
  response: ServerResponse;
  runtime: CodexWebRuntime;
  turnId: string;
  afterId?: string | number | null;
  requestedEpoch?: string | null;
  registerSseCloser: (close: () => void) => () => void;
  audience?: CodexWebEventAudience;
}): Promise<void> {
  const maxQueuedLiveEvents = 64;
  const maxQueuedLiveBytes = 2 * 1024 * 1024;
  const pendingLiveEvents: CodexWebStoredEvent[] = [];
  const liveEvents: CodexWebStoredEvent[] = [];
  let pendingLiveBytes = 0;
  let liveEventBytes = 0;
  let sentThroughSequence = 0;
  let replaying = true;
  let closed = false;
  let flushingLiveEvents = false;
  let slowConsumerResetPending = false;
  let heartbeatPending = false;
  let snapshotThroughSequence = 0;
  let heartbeat: NodeJS.Timeout | null = null;
  let unregisterForcedClose: (() => void) | null = null;

  const compatibleRuntime = runtime as unknown as {
    getTurnEventReplay?: (
      replayTurnId: string,
      replayAfterId?: string | number | null,
      replayEpoch?: string | null,
    ) => CodexWebEventReplay;
    getTurnEventSnapshot?: (snapshotTurnId: string) => CodexWebStoredEvent[];
  };

  const readReplay = (
    replayAfterId?: string | number | null,
    replayEpoch?: string | null,
  ): CodexWebEventReplay => compatibleRuntime.getTurnEventReplay
    ? compatibleRuntime.getTurnEventReplay(turnId, replayAfterId, replayEpoch)
    : legacyTurnEventReplay(runtime, turnId, replayAfterId, replayEpoch);

  const snapshotControl = (
    replay: CodexWebEventReplay,
    forceResetReason: string | null = null,
  ): { frame: string; throughSequence: number } => {
    const reset = replay.reset || Boolean(forceResetReason);
    const snapshotEntries = reset
      ? compatibleRuntime.getTurnEventSnapshot?.(turnId) ?? []
      : [];
    const snapshotEvents = snapshotEntries
      .map((entry) => {
        const event = presentCodexWebEvent(entry.event, audience);
        return event ? { ...event, sequence: entry.sequence } : null;
      })
      .filter((event): event is Record<string, unknown> & { sequence: number } => event !== null);
    const throughSequence = reset
      ? Math.max(replay.latestSequence ?? 0, ...snapshotEntries.map((entry) => entry.sequence))
      : 0;
    const control = {
      type: reset ? 'stream.reset' : 'stream.ready',
      epoch: replay.epoch,
      reset,
      ...(forceResetReason || replay.resetReason
        ? { reason: forceResetReason ?? replay.resetReason }
        : {}),
      retainedFrom: replay.retainedFrom,
      retainedFloor: replay.retainedFloor,
      latestSequence: reset ? throughSequence || replay.latestSequence : replay.latestSequence,
      ...(reset ? {
        snapshot: {
          events: snapshotEvents,
          throughSequence: throughSequence || replay.latestSequence,
          complete: replay.snapshotComplete,
        },
      } : {}),
    };
    return {
      frame: `event: control\ndata: ${JSON.stringify(control)}\n\n`,
      throughSequence,
    };
  };

  const waitForDrainOrClose = (): Promise<void> => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      response.off('drain', finish);
      response.off('close', finish);
      response.off('error', finish);
      resolve();
    };
    response.once('drain', finish);
    response.once('close', finish);
    response.once('error', finish);
  });

  const writeChunk = async (chunk: string): Promise<boolean> => {
    if (closed || response.writableEnded || response.destroyed) {
      return false;
    }
    if (response.write(chunk)) {
      return true;
    }
    await waitForDrainOrClose();
    return !closed && !response.writableEnded && !response.destroyed;
  };

  const writeEvent = async (entry: CodexWebStoredEvent): Promise<void> => {
    if (entry.sequence <= snapshotThroughSequence || entry.sequence <= sentThroughSequence) {
      return;
    }
    const event = presentCodexWebEvent(entry.event, audience, { compactAssistantDelta: true });
    if (!event) {
      sentThroughSequence = Math.max(sentThroughSequence, entry.sequence);
      return;
    }
    const written = await writeChunk(`id: ${entry.sequence}\nevent: message\ndata: ${JSON.stringify({
      ...event,
      sequence: entry.sequence,
    })}\n\n`);
    if (written) {
      sentThroughSequence = Math.max(sentThroughSequence, entry.sequence);
    }
  };

  const flushLiveEvents = async (): Promise<void> => {
    if (flushingLiveEvents || replaying || closed) {
      return;
    }
    flushingLiveEvents = true;
    try {
      while (!closed) {
        if (slowConsumerResetPending) {
          // The snapshot covers earlier appends; clear first so appends during a blocked write stay queued.
          slowConsumerResetPending = false;
          liveEvents.length = 0;
          liveEventBytes = 0;
          const currentReplay = readReplay(null, runtime.eventBus.epoch);
          const resetControl = snapshotControl(currentReplay, 'slow_consumer');
          snapshotThroughSequence = Math.max(snapshotThroughSequence, resetControl.throughSequence);
          if (!await writeChunk(resetControl.frame)) {
            return;
          }
          continue;
        }
        const entry = liveEvents.shift();
        if (entry) {
          liveEventBytes = Math.max(0, liveEventBytes - retainedEventSize(entry.event));
          await writeEvent(entry);
          continue;
        }
        if (heartbeatPending) {
          heartbeatPending = false;
          if (!await writeChunk(': keepalive\n\n')) {
            return;
          }
          continue;
        }
        break;
      }
    } finally {
      flushingLiveEvents = false;
      if (!closed && (slowConsumerResetPending || liveEvents.length > 0 || heartbeatPending)) {
        void flushLiveEvents();
      }
    }
  };

  const enqueueLiveEvent = (entry: CodexWebStoredEvent): void => {
    if (closed || entry.sequence <= snapshotThroughSequence) {
      return;
    }
    if (slowConsumerResetPending) {
      return;
    }
    const entryBytes = retainedEventSize(entry.event);
    if (
      liveEvents.length >= maxQueuedLiveEvents
      || liveEventBytes + entryBytes > maxQueuedLiveBytes
    ) {
      liveEvents.length = 0;
      liveEventBytes = 0;
      slowConsumerResetPending = true;
    } else {
      liveEvents.push(entry);
      liveEventBytes += entryBytes;
    }
    void flushLiveEvents();
  };

  const unsubscribe = runtime.subscribeToTurn(turnId, (entry) => {
    if (replaying) {
      const entryBytes = retainedEventSize(entry.event);
      if (
        pendingLiveEvents.length >= maxQueuedLiveEvents
        || pendingLiveBytes + entryBytes > maxQueuedLiveBytes
      ) {
        pendingLiveEvents.length = 0;
        pendingLiveBytes = 0;
        slowConsumerResetPending = true;
      } else if (!slowConsumerResetPending) {
        pendingLiveEvents.push(entry);
        pendingLiveBytes += entryBytes;
      }
      return;
    }
    enqueueLiveEvent(entry);
  });

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    pendingLiveEvents.length = 0;
    liveEvents.length = 0;
    pendingLiveBytes = 0;
    liveEventBytes = 0;
    unsubscribe();
    unregisterForcedClose?.();
    unregisterForcedClose = null;
    if (!response.writableEnded && !response.destroyed) {
      response.end();
    }
  };

  unregisterForcedClose = registerSseCloser(() => {
    cleanup();
    request.socket.destroy();
  });

  request.once('close', cleanup);
  request.once('aborted', cleanup);
  response.once('close', cleanup);
  response.once('error', cleanup);

  let replay: CodexWebEventReplay;
  try {
    replay = readReplay(afterId, requestedEpoch);
  } catch (error) {
    cleanup();
    throw error;
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Codex-Event-Epoch': replay.epoch,
    'X-Codex-Event-Reset': replay.reset ? 'true' : 'false',
  });
  response.flushHeaders();

  const initialControl = snapshotControl(replay);
  snapshotThroughSequence = initialControl.throughSequence;
  if (!await writeChunk(initialControl.frame)) {
    cleanup();
    return;
  }

  for (const entry of replay.events) {
    await writeEvent(entry);
  }
  replaying = false;
  for (const entry of pendingLiveEvents) {
    enqueueLiveEvent(entry);
  }
  pendingLiveEvents.length = 0;
  pendingLiveBytes = 0;
  heartbeat = setInterval(() => {
    heartbeatPending = true;
    void flushLiveEvents();
  }, 15_000);
  void flushLiveEvents();
}

function legacyTurnEventReplay(
  runtime: CodexWebRuntime,
  turnId: string,
  afterId: string | number | null | undefined,
  requestedEpoch: string | null | undefined,
): CodexWebEventReplay {
  const epoch = runtime.eventBus?.epoch ?? 'legacy';
  const events = runtime.getTurnEvents(turnId, afterId);
  const reset = Boolean(requestedEpoch && requestedEpoch !== epoch);
  const replayEvents = reset ? runtime.getTurnEvents(turnId) : events;
  return {
    epoch,
    reset,
    resetReason: reset ? 'epoch_mismatch' : null,
    retainedFrom: replayEvents[0]?.sequence ?? null,
    retainedFloor: 0,
    latestSequence: replayEvents.at(-1)?.sequence ?? null,
    snapshotComplete: false,
    events: replayEvents,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw createHttpError(413, 'payload_too_large', 'Request body is too large.');
  }
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw createHttpError(413, 'payload_too_large', 'Request body is too large.');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw createHttpError(400, 'invalid_json', 'Request body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isHttpError(error)) {
      throw error;
    }
    throw createHttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

function normalizeLastEventId(
  queryAfter: string | null,
  headerValue: string | string[] | undefined,
): string | number | null {
  if (queryAfter && queryAfter.trim()) {
    return queryAfter.trim();
  }
  if (typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim();
  }
  if (Array.isArray(headerValue)) {
    const first = headerValue.find((value) => value.trim());
    return first?.trim() ?? null;
  }
  return null;
}

function normalizeEventEpoch(
  queryEpoch: string | null,
  headerValue: string | string[] | undefined,
): string | null {
  if (queryEpoch?.trim()) {
    return queryEpoch.trim();
  }
  if (typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim();
  }
  if (Array.isArray(headerValue)) {
    return headerValue.find((value) => value.trim())?.trim() ?? null;
  }
  return null;
}

function writeJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const contentType = 'application/json; charset=utf-8';
  const body = Buffer.from(`${JSON.stringify(payload)}\n`);
  const encoded = encodeResponseBody(response.req, body, contentType);
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Accept-Encoding',
    'Content-Length': String(encoded.body.byteLength),
    ...headers,
  };
  if (encoded.contentEncoding) {
    responseHeaders['Content-Encoding'] = encoded.contentEncoding;
  }
  response.writeHead(status, responseHeaders);
  response.end(encoded.body);
}

function encodeResponseBody(
  request: IncomingMessage,
  body: Buffer,
  contentType: string,
): { body: Buffer; contentEncoding: 'br' | 'gzip' | null } {
  if (body.byteLength < COMPRESSION_MIN_BYTES || !isCompressibleContentType(contentType)) {
    return { body, contentEncoding: null };
  }
  const contentEncoding = preferredContentEncoding(request.headers['accept-encoding']);
  if (contentEncoding === 'br') {
    return {
      body: brotliCompressSync(body, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
      }),
      contentEncoding,
    };
  }
  if (contentEncoding === 'gzip') {
    return { body: gzipSync(body, { level: 6 }), contentEncoding };
  }
  return { body, contentEncoding: null };
}

function isCompressibleContentType(contentType: string): boolean {
  return /^text\//iu.test(contentType)
    || /^(?:application\/(?:javascript|json|manifest\+json))\b/iu.test(contentType);
}

function preferredContentEncoding(
  headerValue: string | string[] | undefined,
): 'br' | 'gzip' | null {
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : headerValue;
  if (!raw) {
    return null;
  }
  const qualities = new Map<string, number>();
  for (const entry of raw.split(',')) {
    const [rawName, ...parameters] = entry.trim().toLowerCase().split(';');
    const name = rawName?.trim();
    if (!name) {
      continue;
    }
    const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith('q='));
    const quality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
    qualities.set(name, Number.isFinite(quality) ? Math.max(0, Math.min(1, quality)) : 0);
  }
  const wildcardQuality = qualities.get('*') ?? 0;
  const identityQuality = qualities.get('identity') ?? 0;
  const candidates = (['br', 'gzip'] as const)
    .map((name) => ({ name, quality: qualities.get(name) ?? wildcardQuality }))
    .filter((candidate) => candidate.quality > 0 && candidate.quality >= identityQuality)
    .sort((left, right) => right.quality - left.quality);
  return candidates[0]?.name ?? null;
}

function appendVaryHeader(existing: string | undefined, name: string): string {
  const values = new Set((existing ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  values.add(name);
  return [...values].join(', ');
}

function applySecurityResponseHeaders(response: ServerResponse): void {
  const headers = {
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Permitted-Cross-Domain-Policies': 'none',
  } as const;
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
}

interface HttpError extends Error {
  statusCode: number;
  code: string;
  activeTurnId?: string;
  retryable?: boolean;
}

function createHttpError(statusCode: number, code: string, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function withStorageQuotaHttpError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ManagedStorageQuotaError) {
      throw createHttpError(
        507,
        'storage_quota_exceeded',
        'Managed storage quota is full. Remove old managed files and try again.',
      );
    }
    throw error;
  }
}

function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error
    && Number.isInteger((error as Partial<HttpError>).statusCode)
    && typeof (error as Partial<HttpError>).code === 'string';
}

function writeErrorResponse({
  request,
  response,
  error,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  error: unknown;
}): void {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }
  if (isHttpError(error)) {
    writeRequestLog({
      level: error.statusCode >= 500 ? 'error' : 'warn',
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      status: error.statusCode,
      code: error.code,
      message: error.message,
    });
    writeJson(response, error.statusCode, {
      error: error.code,
      message: error.message,
      ...(error.activeTurnId ? { activeTurnId: error.activeTurnId } : {}),
      ...(error.retryable === true ? { retryable: true } : {}),
    });
    return;
  }
  writeRequestLog({
    level: 'error',
    method: request.method ?? 'GET',
    path: request.url ?? '/',
    status: 500,
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
  });
  writeJson(response, 500, {
    error: error instanceof Error ? error.message : String(error),
  });
}

function writeRequestLog({
  level,
  method,
  path,
  status,
  code,
  message,
}: {
  level: 'warn' | 'error';
  method: string;
  path: string;
  status: number;
  code: string;
  message: string;
}): void {
  const rawPath = path.split('?')[0] || '/';
  const safePath = rawPath.startsWith(`${WEBHOOK_ENDPOINT_PATH}/submissions/`)
    ? `${WEBHOOK_ENDPOINT_PATH}/submissions/:clientRequestId`
    : rawPath;
  const payload = {
    ts: new Date().toISOString(),
    level,
    method,
    path: safePath,
    status,
    code,
    message,
  };
  process.stderr.write(`[codex-web] ${JSON.stringify(payload)}\n`);
}

function writeInternalWarning({
  code,
  message,
  context = {},
}: {
  code: string;
  message: string;
  context?: Record<string, string>;
}): void {
  process.stderr.write(`[codex-web] ${JSON.stringify({
    ts: new Date().toISOString(),
    level: 'warn',
    code,
    message,
    ...context,
  })}\n`);
}

function writeSetupRequiredJson(response: ServerResponse): void {
  writeJson(response, 503, {
    error: 'setup_required',
    message: SETUP_REQUIRED_MESSAGE,
  });
}

function writeSetupRequiredPage(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Web Setup Required</title>
</head>
<body>
  <main>
    <h1>Setup required</h1>
    <p>${SETUP_REQUIRED_MESSAGE}</p>
    <pre><code>codex-web auth set-password</code></pre>
  </main>
</body>
</html>
`);
}
