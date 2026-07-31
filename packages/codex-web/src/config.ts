import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexWebConfig {
  host: string;
  port: number;
  defaultCwd: string;
  codexBin: string;
  stateDir: string;
  authPath: string;
  reportsDir: string;
  reportIndexPath: string;
  runtimeContextDir: string;
  envPath: string;
  debug: boolean;
  publicSharesEnabled: boolean;
  publicShareTtlSeconds: number;
  managedStorageMaxBytes: number;
  projectUploadMaxBytes: number;
  uploadTtlSeconds: number;
  turnAttachmentTtlSeconds: number;
  reportTtlSeconds: number;
  runtimeContextTtlSeconds: number;
  timelineMaxEntriesPerSession: number;
  timelineMaxBytes: number;
}

const DEFAULT_PUBLIC_SHARE_TTL_SECONDS = 24 * 60 * 60;
const MAX_PUBLIC_SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const DAY_SECONDS = 24 * 60 * 60;
const MAX_STORAGE_BYTES = 1024 * GIBIBYTE;
const MAX_RETENTION_SECONDS = 10 * 365 * DAY_SECONDS;

export function loadServiceConfig(options: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  envPath?: string;
} = {}): CodexWebConfig {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const envPath = options.envPath
    ?? normalizeString(env.CODEX_WEB_ENV_PATH)
    ?? path.join(homeDir, '.config', 'codex-web', 'service.env');
  const fileEnv = readEnvFile(envPath);
  const merged = {
    ...fileEnv,
    ...env,
  };
  const stateDir = normalizeString(merged.CODEX_WEB_STATE_DIR)
    || path.join(homeDir, '.codex-web');
  const runtimeContextHostDir = path.resolve(stateDir, 'runtime-context', 'sessions');
  const runtimeContextDir = path.resolve(
    normalizeString(merged.CODEX_WEB_RUNTIME_CONTEXT_DIR) || runtimeContextHostDir,
  );
  const port = parsePort(merged.CODEX_WEB_PORT, 43210);
  return {
    host: normalizeString(merged.CODEX_WEB_HOST) || '0.0.0.0',
    port,
    defaultCwd: normalizeString(merged.CODEX_WEB_DEFAULT_CWD) || homeDir,
    codexBin: normalizeString(merged.CODEX_REAL_BIN) || 'codex',
    stateDir,
    authPath: path.join(stateDir, 'auth.json'),
    reportsDir: path.join(stateDir, 'reports'),
    reportIndexPath: path.join(stateDir, 'report-index.json'),
    runtimeContextDir,
    envPath,
    debug: parseBoolean(merged.CODEX_WEB_DEBUG, false),
    publicSharesEnabled: parseBoolean(merged.CODEX_WEB_PUBLIC_SHARES_ENABLED, false),
    publicShareTtlSeconds: parsePositiveInteger(
      merged.CODEX_WEB_PUBLIC_SHARE_TTL_SECONDS,
      DEFAULT_PUBLIC_SHARE_TTL_SECONDS,
      MAX_PUBLIC_SHARE_TTL_SECONDS,
    ),
    managedStorageMaxBytes: parsePositiveInteger(
      merged.CODEX_WEB_MANAGED_STORAGE_MAX_BYTES,
      2 * GIBIBYTE,
      MAX_STORAGE_BYTES,
    ),
    projectUploadMaxBytes: parsePositiveInteger(
      merged.CODEX_WEB_PROJECT_UPLOAD_MAX_BYTES,
      512 * MEBIBYTE,
      MAX_STORAGE_BYTES,
    ),
    uploadTtlSeconds: parsePositiveInteger(
      merged.CODEX_WEB_UPLOAD_TTL_SECONDS,
      7 * DAY_SECONDS,
      MAX_RETENTION_SECONDS,
    ),
    turnAttachmentTtlSeconds: parsePositiveInteger(
      merged.CODEX_WEB_TURN_ATTACHMENT_TTL_SECONDS,
      30 * DAY_SECONDS,
      MAX_RETENTION_SECONDS,
    ),
    reportTtlSeconds: parsePositiveInteger(
      merged.CODEX_WEB_REPORT_TTL_SECONDS,
      365 * DAY_SECONDS,
      MAX_RETENTION_SECONDS,
    ),
    runtimeContextTtlSeconds: parsePositiveInteger(
      merged.CODEX_WEB_RUNTIME_CONTEXT_TTL_SECONDS,
      30 * DAY_SECONDS,
      MAX_RETENTION_SECONDS,
    ),
    timelineMaxEntriesPerSession: parsePositiveInteger(
      merged.CODEX_WEB_TIMELINE_MAX_ENTRIES_PER_SESSION,
      500,
      100_000,
    ),
    timelineMaxBytes: parsePositiveInteger(
      merged.CODEX_WEB_TIMELINE_MAX_BYTES,
      16 * MEBIBYTE,
      MAX_STORAGE_BYTES,
    ),
  };
}

export function readEnvFile(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const entries: Record<string, string> = {};
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^"|"$/gu, '');
    if (/^[A-Z_][A-Z0-9_]*$/u.test(key)) {
      entries[key] = value;
    }
  }
  return entries;
}

function parsePort(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parsePositiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}

function normalizeString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}
