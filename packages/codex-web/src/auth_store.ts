import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './file_lock.js';

const PASSWORD_ITERATIONS = 310_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export interface AuthSession {
  id: string;
  tokenHash: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt?: string;
}

export interface AuthState {
  revision?: number;
  passwordHash?: string;
  passwordSalt?: string;
  passwordIterations?: number;
  sessions: AuthSession[];
}

export interface PublicAuthSession {
  id: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt?: string;
  principal?: {
    userId: string;
    username: string;
    roleIds: string[];
    isAdmin: boolean;
    mode: 'single' | 'multi';
  };
}

export interface AuthStoreError extends Error {
  code?: string;
}

export interface PasswordHashRecord {
  passwordHash: string;
  passwordSalt: string;
  passwordIterations?: number;
}

export class AuthStore {
  private readonly authPath: string;

  private tokenSnapshot: { version: string; sessions: Map<string, AuthSession>; configured: boolean } | null = null;

  private mutationLock: Promise<void> = Promise.resolve();

  constructor({ authPath, sessionTtlMs = 90 * 24 * 60 * 60 * 1000 }: { authPath: string; sessionTtlMs?: number }) {
    this.authPath = authPath;
    this.sessionTtlMs = sessionTtlMs;
  }

  private readonly sessionTtlMs: number;

  private backupHealthy = true;

  diagnostics(): { backupHealthy: boolean } { return { backupHealthy: this.backupHealthy }; }

  async isConfigured(): Promise<boolean> {
    return (await this.readTokenSnapshot()).configured;
  }

  async setPassword(password: string): Promise<void> {
    await this.withMutationLock(async () => {
      const normalized = normalizePassword(password);
      const salt = crypto.randomBytes(32).toString('base64url');
      let state: AuthState;
      try { state = await this.readState(); } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        await fs.copyFile(this.authPath, `${this.authPath}.corrupt-${Date.now()}`);
        state = { sessions: [] };
      }
      state.passwordSalt = salt;
      state.passwordHash = await hashPassword(normalized, salt, PASSWORD_ITERATIONS);
      state.passwordIterations = PASSWORD_ITERATIONS;
      state.sessions = [];
      await this.writeState(state);
    });
  }

  async login({
    password,
    deviceName,
  }: {
    password: string;
    deviceName?: string | null;
  }): Promise<{ token: string; session: PublicAuthSession; configuredNow: boolean }> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      if (!state.passwordHash || !state.passwordSalt) {
        throw createSetupRequiredError();
      }
      const valid = await verifyPassword(password, state);
      if (!valid) {
        throw new Error('Invalid password');
      }
      const now = new Date().toISOString();
      const token = createToken();
      const session: AuthSession = {
        id: crypto.randomUUID(),
        tokenHash: hashToken(token),
        deviceName: normalizeDeviceName(deviceName),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(Date.now() + this.sessionTtlMs).toISOString(),
      };
      state.sessions = [...state.sessions, session];
      await this.writeState(state);
      return {
        token,
        session: toPublicSession(session),
        configuredNow: false,
      };
    });
  }

  async verifyToken(token: string | null | undefined): Promise<PublicAuthSession | null> {
    const normalized = normalizeToken(token);
    if (!normalized) {
      return null;
    }
    const tokenHash = hashToken(normalized);
    const findValid = (state: AuthState) => state.sessions.find((session) => safeEqual(session.tokenHash, tokenHash)
      && Date.parse(session.expiresAt ?? session.createdAt) + (session.expiresAt ? 0 : this.sessionTtlMs) > Date.now());
    const candidate = (await this.readTokenSnapshot()).sessions.get(tokenHash);
    const session = candidate && Date.parse(candidate.expiresAt ?? candidate.createdAt) + (candidate.expiresAt ? 0 : this.sessionTtlMs) > Date.now() ? candidate : null;
    if (!session) return null;
    if (Date.now() - Date.parse(session.lastSeenAt) < 30_000) return toPublicSession(session);
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const current = findValid(state);
      if (!current) return null;
      if (Date.now() - Date.parse(current.lastSeenAt) >= 30_000) {
        current.lastSeenAt = new Date().toISOString();
        await this.writeState(state);
      }
      return toPublicSession(current);
    });
  }

  async logout(token: string | null | undefined): Promise<void> {
    const normalized = normalizeToken(token);
    if (!normalized) {
      return;
    }
    await this.withMutationLock(async () => {
      const tokenHash = hashToken(normalized);
      const state = await this.readState();
      state.sessions = state.sessions.filter((session) => !safeEqual(session.tokenHash, tokenHash));
      await this.writeState(state);
    });
  }

  private async readTokenSnapshot(): Promise<{ sessions: Map<string, AuthSession>; configured: boolean }> {
    const version = async () => {
      try { const stat = await fs.stat(this.authPath, { bigint: true }); return `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.size}`; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error; }
    };
    const before = await version();
    if (this.tokenSnapshot?.version === before) return this.tokenSnapshot;
    const state = await this.readState();
    const snapshot = { version: before, sessions: new Map(state.sessions.map(session => [session.tokenHash, session])), configured: Boolean(state.passwordHash && state.passwordSalt) };
    if (await version() === before) this.tokenSnapshot = snapshot;
    return snapshot;
  }

  async listSessions(token: string): Promise<PublicAuthSession[]> {
    if (!await this.verifyToken(token)) return [];
    return (await this.readState()).sessions.filter((session) =>
      Date.parse(session.expiresAt ?? session.createdAt) + (session.expiresAt ? 0 : this.sessionTtlMs) > Date.now()).map(toPublicSession);
  }

  async revokeSession(token: string, id: string): Promise<void> {
    await this.withMutationLock(async () => {
      const state = await this.readState();
      if (!state.sessions.some((session) => safeEqual(session.tokenHash, hashToken(token)))) return;
      state.sessions = state.sessions.filter((session) => session.id !== id);
      await this.writeState(state);
    });
  }

  async revokeOtherSessions(token: string): Promise<void> {
    await this.withMutationLock(async () => {
      const state = await this.readState();
      const current = state.sessions.find((session) => safeEqual(session.tokenHash, hashToken(token)));
      if (!current) return;
      state.sessions = [current];
      await this.writeState(state);
    });
  }

  async readState(): Promise<AuthState> {
    try {
      const raw = await fs.readFile(this.authPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AuthState>;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)
        || (Boolean(parsed.passwordHash) !== Boolean(parsed.passwordSalt))) throw new SyntaxError('Invalid authentication state');
      return {
        revision: Number(parsed.revision) || 0,
        passwordHash: typeof parsed.passwordHash === 'string' ? parsed.passwordHash : undefined,
        passwordSalt: typeof parsed.passwordSalt === 'string' ? parsed.passwordSalt : undefined,
        passwordIterations: Number.isFinite(parsed.passwordIterations)
          ? Number(parsed.passwordIterations)
          : PASSWORD_ITERATIONS,
        sessions: Array.isArray(parsed.sessions)
          ? parsed.sessions.map(normalizeSession).filter(Boolean) as AuthSession[]
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { sessions: [] };
      }
      throw error;
    }
  }

  async readPasswordHash(): Promise<PasswordHashRecord | null> {
    const state = await this.readState();
    if (!state.passwordHash || !state.passwordSalt) {
      return null;
    }
    return {
      passwordHash: state.passwordHash,
      passwordSalt: state.passwordSalt,
      passwordIterations: state.passwordIterations ?? PASSWORD_ITERATIONS,
    };
  }

  private async writeState(state: AuthState): Promise<void> {
    await fs.mkdir(path.dirname(this.authPath), { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({
      revision: (state.revision ?? 0) + 1,
      passwordHash: state.passwordHash,
      passwordSalt: state.passwordSalt,
      passwordIterations: state.passwordIterations ?? PASSWORD_ITERATIONS,
      sessions: state.sessions,
    }, null, 2);
    const tempPath = path.join(
      path.dirname(this.authPath),
      `.${path.basename(this.authPath)}.${crypto.randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(tempPath, `${payload}\n`, { mode: 0o600 });
      await fs.chmod(tempPath, 0o600).catch(() => {});
      await fs.rename(tempPath, this.authPath);
      await fs.chmod(this.authPath, 0o600).catch(() => {});
      // Backup is for explicit operator recovery only: automatic rollback could resurrect credentials.
      const backupTemp = `${tempPath}.backup`;
      try {
        await fs.writeFile(backupTemp, `${payload}\n`, { mode: 0o600 });
        await fs.rename(backupTemp, `${this.authPath}.backup`);
        this.backupHealthy = true;
      } catch { this.backupHealthy = false; } finally { await fs.rm(backupTemp, { force: true }).catch(() => {}); }
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.mutationLock;
    let release!: () => void;
    this.mutationLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior.catch(() => {});
    try {
      return await withFileLock(`${this.authPath}.lock`, operation);
    } finally {
      release();
    }
  }
}

async function verifyPassword(password: string, state: AuthState): Promise<boolean> {
  if (!state.passwordHash || !state.passwordSalt) {
    return false;
  }
  const candidate = await hashPassword(
    coercePassword(password),
    state.passwordSalt,
    state.passwordIterations ?? PASSWORD_ITERATIONS,
  );
  return safeEqual(candidate, state.passwordHash);
}

function hashPassword(password: string, salt: string, iterations: number): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, KEY_LENGTH, DIGEST, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey.toString('base64url'));
    });
  });
}

function createToken(): string {
  return `cw_${crypto.randomBytes(32).toString('base64url')}`;
}

function hashToken(token: string): string {
  return crypto.createHash(DIGEST).update(token).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizePassword(password: string): string {
  const normalized = coercePassword(password);
  if (normalized.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  return normalized;
}

function coercePassword(password: string): string {
  return String(password ?? '');
}

function normalizeToken(token: string | null | undefined): string | null {
  const normalized = typeof token === 'string' ? token.trim() : '';
  return normalized || null;
}

function normalizeDeviceName(deviceName: string | null | undefined): string {
  const normalized = typeof deviceName === 'string' ? deviceName.trim() : '';
  return normalized.slice(0, 120) || 'Unknown device';
}

function normalizeSession(raw: unknown): AuthSession | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const session = raw as Partial<AuthSession>;
  if (
    typeof session.id !== 'string'
    || typeof session.tokenHash !== 'string'
    || typeof session.createdAt !== 'string'
    || typeof session.lastSeenAt !== 'string'
  ) {
    return null;
  }
  return {
    id: session.id,
    tokenHash: session.tokenHash,
    deviceName: normalizeDeviceName(session.deviceName),
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
  };
}

function createSetupRequiredError(): AuthStoreError {
  const error = new Error('Password not configured. Run codex-web auth set-password.') as AuthStoreError;
  error.code = 'setup_required';
  return error;
}

function toPublicSession(session: AuthSession): PublicAuthSession {
  return {
    id: session.id,
    deviceName: session.deviceName,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
  };
}
