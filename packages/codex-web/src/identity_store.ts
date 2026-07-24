import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './file_lock.js';

const PASSWORD_ITERATIONS = 310_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';
const DEFAULT_SITE_TITLE = 'Codex Web';
const DEFAULT_SHARE_TTL_SECONDS = 24 * 60 * 60;
const MAX_SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface CodexWebProjectGrant {
  projectId: string;
  canRead: boolean;
  canCreate: boolean;
  canWrite: boolean;
}

export interface CodexWebUser {
  id: string;
  username: string;
  email?: string;
  enabled: boolean;
  canNewSession: boolean;
  passwordHash?: string;
  passwordSalt?: string;
  passwordIterations?: number;
  roleIds: string[];
  directProjectGrants: CodexWebProjectGrant[];
  favoriteProjectIds: string[];
}

export interface CodexWebRole {
  id: string;
  name: string;
  isAdmin: boolean;
  projectGrants: CodexWebProjectGrant[];
}

export interface CodexWebProject {
  id: string;
  internalName: string;
  cwd: string;
  displayName: string;
  enabled: boolean;
  activeSessionLimit: number | null;
  showWorkDetailsToMembers: boolean;
}

export interface CodexWebAppSession {
  id: string;
  codexThreadId: string;
  projectId: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  archivedAt: string | null;
  archivedByUserId: string | null;
  archiveSource: 'codex' | 'web-only' | null;
}

export interface CodexWebShare {
  id: string;
  tokenHash: string;
  sessionId: string;
  createdByUserId: string;
  enabled: boolean;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CodexWebUserSession {
  id: string;
  tokenHash: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  userId: string;
}

export interface CodexWebWebhookCredential {
  id: string;
  ownerUserId: string;
  enabled: boolean;
  key: string | null;
  tokenHash: string;
  keyHint: string;
  createdAt: string;
  updatedAt: string;
}

export interface CodexWebIdentityState {
  settings: {
    multiUserEnabled: boolean;
    siteTitle: string;
  };
  users: CodexWebUser[];
  roles: CodexWebRole[];
  projects: CodexWebProject[];
  sessions: CodexWebAppSession[];
  shares: CodexWebShare[];
  userSessions: CodexWebUserSession[];
  webhookCredentials: CodexWebWebhookCredential[];
}

export interface UpsertProjectOptions {
  allowDisplayNameConflict?: boolean;
}

export interface UpsertUserWithPasswordInput {
  id?: string;
  username: string;
  email?: string;
  password: string;
  enabled?: boolean;
  canNewSession?: boolean;
  roleIds?: string[];
  directProjectGrants?: CodexWebProjectGrant[];
}

export interface UpdateUserAccessInput {
  id: string;
  email?: string;
  enabled?: boolean;
  canNewSession?: boolean;
  roleIds?: string[];
  directProjectGrants?: CodexWebProjectGrant[];
}

export interface UpdateUserProjectFavoriteInput {
  userId: string;
  projectId: string;
  favorite: boolean;
}

export interface BootstrapAdminPasswordHashInput {
  passwordHash: string;
  passwordSalt: string;
  passwordIterations?: number;
}

export class FileIdentityStore {
  private readonly identityPath: string;

  private mutationLock: Promise<void> = Promise.resolve();

  constructor({ identityPath }: { identityPath: string }) {
    this.identityPath = identityPath;
  }

  async readState(): Promise<CodexWebIdentityState> {
    try {
      const raw = await fs.readFile(this.identityPath, 'utf8');
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyState();
      }
      throw error;
    }
  }

  async setMultiUserEnabled(enabled: boolean): Promise<CodexWebIdentityState> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      state.settings.multiUserEnabled = enabled;
      await this.writeState(state);
      return state;
    });
  }

  async setSiteTitle(siteTitle: string): Promise<CodexWebIdentityState> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      state.settings.siteTitle = normalizeSiteTitle(siteTitle);
      await this.writeState(state);
      return state;
    });
  }

  async ensureBootstrapAdminFromPasswordHash(input: BootstrapAdminPasswordHashInput): Promise<CodexWebIdentityState> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const adminRole: CodexWebRole = {
        id: 'role_admin',
        name: 'Admin',
        isAdmin: true,
        projectGrants: [],
      };
      state.roles = upsertById(state.roles, adminRole);
      const existingAdmin = state.users.find((user) => user.username === 'admin' || user.id === 'user_admin');
      const adminUser: CodexWebUser = {
        ...(existingAdmin ?? {
          id: 'user_admin',
          username: 'admin',
          email: undefined,
          enabled: true,
          canNewSession: true,
          roleIds: [],
          directProjectGrants: [],
          favoriteProjectIds: [],
        }),
        id: existingAdmin?.id ?? 'user_admin',
        username: existingAdmin?.username ?? 'admin',
        email: normalizeOptionalEmail(existingAdmin?.email),
        enabled: existingAdmin?.enabled !== false,
        canNewSession: true,
        passwordHash: normalizeRequiredId(input.passwordHash, 'password hash'),
        passwordSalt: normalizeRequiredId(input.passwordSalt, 'password salt'),
        passwordIterations: Number.isFinite(input.passwordIterations)
          ? Number(input.passwordIterations)
          : PASSWORD_ITERATIONS,
        roleIds: uniqueStrings([...(existingAdmin?.roleIds ?? []), adminRole.id]),
        directProjectGrants: normalizeProjectGrants(existingAdmin?.directProjectGrants ?? []),
        favoriteProjectIds: normalizeStringArray(existingAdmin?.favoriteProjectIds ?? []),
      };
      state.users = upsertById(state.users, adminUser);
      await this.writeState(state);
      return state;
    });
  }

  async upsertUserWithPassword(input: UpsertUserWithPasswordInput): Promise<CodexWebUser> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalized = normalizePassword(input.password);
      const username = normalizeUsername(input.username);
      const userId = deriveUserId(username, input.id, state.users);
      const existingWithUsername = state.users.find((user) => user.username === username);
      if (existingWithUsername && existingWithUsername.id !== userId) {
        const error = new Error(`Username already exists: ${username}`);
        (error as Error & { code?: string }).code = 'username_conflict';
        throw error;
      }
      const salt = crypto.randomBytes(32).toString('base64url');
      const user: CodexWebUser = {
        id: userId,
        username,
        email: normalizeOptionalEmail(input.email),
        enabled: input.enabled !== false,
        canNewSession: input.canNewSession !== false,
        passwordHash: await hashPassword(normalized, salt, PASSWORD_ITERATIONS),
        passwordSalt: salt,
        passwordIterations: PASSWORD_ITERATIONS,
        roleIds: normalizeStringArray(input.roleIds),
        directProjectGrants: normalizeProjectGrants(input.directProjectGrants),
        favoriteProjectIds: [],
      };
      state.users = upsertById(state.users, user);
      await this.writeState(state);
      return user;
    });
  }

  async updateUserAccess(input: UpdateUserAccessInput): Promise<CodexWebUser> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const userId = normalizeRequiredId(input.id, 'user id');
      const existing = state.users.find((user) => user.id === userId);
      if (!existing) {
        throw new Error(`Unknown user: ${userId}`);
      }
      const user: CodexWebUser = {
        ...existing,
        email: Object.prototype.hasOwnProperty.call(input, 'email')
          ? normalizeOptionalEmail(input.email)
          : existing.email,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : existing.enabled,
        canNewSession: typeof input.canNewSession === 'boolean' ? input.canNewSession : existing.canNewSession,
        roleIds: Array.isArray(input.roleIds) ? normalizeStringArray(input.roleIds) : existing.roleIds,
        directProjectGrants: Array.isArray(input.directProjectGrants)
          ? normalizeProjectGrants(input.directProjectGrants)
          : existing.directProjectGrants,
      };
      state.users = upsertById(state.users, user);
      await this.writeState(state);
      return user;
    });
  }

  async deleteUser(userId: string): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalizedUserId = normalizeRequiredId(userId, 'user id');
      const existing = state.users.find((user) => user.id === normalizedUserId);
      if (!existing) {
        throw new Error(`Unknown user: ${normalizedUserId}`);
      }
      const removedSessionIds = new Set(
        state.sessions
          .filter((session) => session.ownerUserId === normalizedUserId)
          .map((session) => session.id),
      );
      state.users = state.users.filter((user) => user.id !== normalizedUserId);
      state.sessions = state.sessions.filter((session) => session.ownerUserId !== normalizedUserId);
      state.shares = state.shares.filter((share) => share.createdByUserId !== normalizedUserId && !removedSessionIds.has(share.sessionId));
      state.userSessions = state.userSessions.filter((session) => session.userId !== normalizedUserId);
      state.webhookCredentials = state.webhookCredentials.filter((credential) => credential.ownerUserId !== normalizedUserId);
      await this.writeState(state);
    });
  }

  async updateUserProjectFavorite(input: UpdateUserProjectFavoriteInput): Promise<CodexWebUser> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const userId = normalizeRequiredId(input.userId, 'user id');
      const projectId = normalizeRequiredId(input.projectId, 'project id');
      const existing = state.users.find((user) => user.id === userId);
      if (!existing) {
        throw new Error(`Unknown user: ${userId}`);
      }
      const current = new Set(normalizeStringArray(existing.favoriteProjectIds));
      if (input.favorite) {
        current.add(projectId);
      } else {
        current.delete(projectId);
      }
      const user: CodexWebUser = {
        ...existing,
        favoriteProjectIds: [...current],
      };
      state.users = upsertById(state.users, user);
      await this.writeState(state);
      return user;
    });
  }

  async upsertRole(role: CodexWebRole): Promise<CodexWebRole> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalized = normalizeRole(role);
      state.roles = upsertById(state.roles, normalized);
      await this.writeState(state);
      return normalized;
    });
  }

  async upsertProject(
    project: CodexWebProject,
    options: UpsertProjectOptions = {},
  ): Promise<CodexWebProject> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalized = normalizeProject(project);
      const existing = state.projects.find((item) => item.id === normalized.id);
      const displayNameChanged = !existing
        || projectDisplayNameKey(existing.displayName) !== projectDisplayNameKey(normalized.displayName);
      const displayNameConflict = displayNameChanged && state.projects.some((item) => (
        item.id !== normalized.id
        && projectDisplayNameKey(item.displayName) === projectDisplayNameKey(normalized.displayName)
      ));
      if (displayNameConflict && options.allowDisplayNameConflict !== true) {
        const error = new Error('A project with this display name already exists.');
        (error as Error & { code?: string }).code = 'project_display_name_conflict';
        throw error;
      }
      state.projects = upsertById(state.projects, normalized);
      await this.writeState(state);
      return normalized;
    });
  }

  async upsertSession(session: CodexWebAppSession): Promise<CodexWebAppSession> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalized = normalizeAppSession(session);
      state.sessions = upsertById(state.sessions, normalized);
      await this.writeState(state);
      return normalized;
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.withMutationLock(async () => {
      const state = await this.readState();
      state.sessions = state.sessions.filter((session) => session.id !== sessionId);
      await this.writeState(state);
    });
  }

  async verifyUserPassword(username: string, password: string): Promise<string | null> {
    const state = await this.readState();
    const normalizedUsername = normalizeUsername(username);
    const user = state.users.find((item) => item.username === normalizedUsername && item.enabled !== false);
    if (!user?.passwordHash || !user.passwordSalt) {
      return null;
    }
    const candidate = await hashPassword(
      String(password ?? ''),
      user.passwordSalt,
      user.passwordIterations ?? PASSWORD_ITERATIONS,
    );
    return safeEqual(candidate, user.passwordHash) ? user.id : null;
  }

  async createShare({
    sessionId,
    createdByUserId,
    ttlSeconds = DEFAULT_SHARE_TTL_SECONDS,
  }: {
    sessionId: string;
    createdByUserId: string;
    ttlSeconds?: number;
  }): Promise<{ token: string; share: CodexWebShare }> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const now = new Date().toISOString();
      const token = createShareToken();
      const normalizedTtlSeconds = Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? Math.min(Number(ttlSeconds), MAX_SHARE_TTL_SECONDS)
        : DEFAULT_SHARE_TTL_SECONDS;
      const share: CodexWebShare = {
        id: crypto.randomUUID(),
        tokenHash: hashToken(token),
        sessionId: normalizeRequiredId(sessionId, 'session id'),
        createdByUserId: normalizeRequiredId(createdByUserId, 'user id'),
        enabled: true,
        createdAt: now,
        expiresAt: new Date(Date.now() + normalizedTtlSeconds * 1_000).toISOString(),
        revokedAt: null,
      };
      state.shares = [...state.shares, share];
      await this.writeState(state);
      return { token, share };
    });
  }

  async revokeShare(shareId: string, revokedAt = new Date().toISOString()): Promise<CodexWebShare | null> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalizedShareId = normalizeRequiredId(shareId, 'share id');
      const existing = state.shares.find((share) => share.id === normalizedShareId);
      if (!existing) {
        return null;
      }
      const share: CodexWebShare = {
        ...existing,
        enabled: false,
        revokedAt: normalizeOptionalIsoString(revokedAt) ?? new Date().toISOString(),
      };
      state.shares = upsertById(state.shares, share);
      await this.writeState(state);
      return share;
    });
  }

  async addUserSession(session: CodexWebUserSession): Promise<CodexWebUserSession> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalized = normalizeUserSession(session);
      state.userSessions = upsertById(state.userSessions, normalized);
      await this.writeState(state);
      return normalized;
    });
  }

  async touchUserSession(sessionId: string, lastSeenAt: string): Promise<void> {
    await this.withMutationLock(async () => {
      const state = await this.readState();
      const index = state.userSessions.findIndex((session) => session.id === sessionId);
      if (index < 0) {
        return;
      }
      state.userSessions[index] = {
        ...state.userSessions[index]!,
        lastSeenAt,
      };
      await this.writeState(state);
    });
  }

  async deleteUserSession(sessionId: string): Promise<void> {
    await this.withMutationLock(async () => {
      const state = await this.readState();
      state.userSessions = state.userSessions.filter((session) => session.id !== sessionId);
      await this.writeState(state);
    });
  }

  async findShareByToken(token: string): Promise<string | null> {
    const tokenHash = hashToken(String(token ?? '').trim());
    const state = await this.readState();
    const now = Date.now();
    return state.shares.find((share) => (
      share.enabled !== false
      && share.revokedAt === null
      && typeof share.expiresAt === 'string'
      && Date.parse(share.expiresAt) > now
      && safeEqual(share.tokenHash, tokenHash)
    ))?.id ?? null;
  }

  async getWebhookCredential(ownerUserId: string): Promise<CodexWebWebhookCredential | null> {
    const normalizedOwnerUserId = normalizeRequiredId(ownerUserId, 'webhook owner user id');
    const state = await this.readState();
    return state.webhookCredentials.find((credential) => credential.ownerUserId === normalizedOwnerUserId) ?? null;
  }

  async setWebhookEnabled(
    ownerUserId: string,
    enabled: boolean,
  ): Promise<{ credential: CodexWebWebhookCredential | null; key: string | null }> {
    return this.withMutationLock(async () => {
      const normalizedOwnerUserId = normalizeRequiredId(ownerUserId, 'webhook owner user id');
      const state = await this.readState();
      const existing = state.webhookCredentials.find(
        (credential) => credential.ownerUserId === normalizedOwnerUserId,
      );
      if (!existing && !enabled) {
        return { credential: null, key: null };
      }
      if (!existing) {
        const key = createWebhookKey();
        const now = new Date().toISOString();
        const credential: CodexWebWebhookCredential = {
          id: crypto.randomUUID(),
          ownerUserId: normalizedOwnerUserId,
          enabled: true,
          key,
          tokenHash: hashToken(key),
          keyHint: webhookKeyHint(key),
          createdAt: now,
          updatedAt: now,
        };
        state.webhookCredentials = [...state.webhookCredentials, credential];
        await this.writeState(state);
        return { credential, key: credential.key };
      }
      if (existing.enabled === enabled) {
        return { credential: existing, key: existing.key };
      }
      const credential: CodexWebWebhookCredential = {
        ...existing,
        enabled,
        updatedAt: new Date().toISOString(),
      };
      state.webhookCredentials = upsertById(state.webhookCredentials, credential);
      await this.writeState(state);
      return { credential, key: credential.key };
    });
  }

  async rotateWebhookKey(
    ownerUserId: string,
  ): Promise<{ credential: CodexWebWebhookCredential; key: string }> {
    return this.withMutationLock(async () => {
      const normalizedOwnerUserId = normalizeRequiredId(ownerUserId, 'webhook owner user id');
      const state = await this.readState();
      const existing = state.webhookCredentials.find(
        (credential) => credential.ownerUserId === normalizedOwnerUserId,
      );
      const key = createWebhookKey();
      const now = new Date().toISOString();
      const credential: CodexWebWebhookCredential = {
        id: existing?.id ?? crypto.randomUUID(),
        ownerUserId: normalizedOwnerUserId,
        enabled: existing?.enabled ?? true,
        key,
        tokenHash: hashToken(key),
        keyHint: webhookKeyHint(key),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      state.webhookCredentials = upsertById(state.webhookCredentials, credential);
      await this.writeState(state);
      return { credential, key };
    });
  }

  async findWebhookCredentialByToken(token: string): Promise<CodexWebWebhookCredential | null> {
    const normalizedToken = String(token ?? '').trim();
    if (!isWebhookKey(normalizedToken)) {
      return null;
    }
    const tokenHash = hashToken(normalizedToken);
    const state = await this.readState();
    return state.webhookCredentials.find((credential) => (
      credential.enabled === true
      && safeEqual(credential.tokenHash, tokenHash)
    )) ?? null;
  }

  private async writeState(state: CodexWebIdentityState): Promise<void> {
    await fs.mkdir(path.dirname(this.identityPath), { recursive: true, mode: 0o700 });
    const payload = `${JSON.stringify(normalizeState(state), null, 2)}\n`;
    const tempPath = path.join(
      path.dirname(this.identityPath),
      `.${path.basename(this.identityPath)}.${crypto.randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(tempPath, payload, { mode: 0o600 });
      await fs.rename(tempPath, this.identityPath);
      await fs.chmod(this.identityPath, 0o600).catch(() => {});
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
      return await withFileLock(`${this.identityPath}.lock`, operation);
    } finally {
      release();
    }
  }
}

function emptyState(): CodexWebIdentityState {
  return {
    settings: { multiUserEnabled: false, siteTitle: DEFAULT_SITE_TITLE },
    users: [],
    roles: [],
    projects: [],
    sessions: [],
    shares: [],
    userSessions: [],
    webhookCredentials: [],
  };
}

function normalizeState(value: unknown): CodexWebIdentityState {
  if (!isRecord(value)) {
    throw new Error('Invalid identity state: expected an object');
  }
  const record = value;
  if (record.settings !== undefined && !isRecord(record.settings)) {
    throw new Error('Invalid identity state: settings must be an object');
  }
  const settings = isRecord(record.settings) ? record.settings : {};
  const webhookCredentials = normalizeWebhookCredentials(record);
  return {
    settings: {
      multiUserEnabled: settings.multiUserEnabled === true,
      siteTitle: normalizeSiteTitle(settings.siteTitle),
    },
    users: normalizeStateCollection(record, 'users', normalizeUserOrNull),
    roles: normalizeStateCollection(record, 'roles', normalizeRoleOrNull),
    projects: normalizeStateCollection(record, 'projects', normalizeProjectOrNull),
    sessions: normalizeStateCollection(record, 'sessions', normalizeAppSessionOrNull),
    shares: normalizeStateCollection(record, 'shares', normalizeShareOrNull),
    userSessions: normalizeStateCollection(record, 'userSessions', normalizeUserSessionOrNull),
    webhookCredentials,
  };
}

function normalizeStateCollection<T>(
  record: Record<string, any>,
  key: string,
  normalize: (value: unknown) => T | null,
): T[] {
  const value = record[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid identity state: ${key} must be an array`);
  }
  return value.map((entry, index) => {
    const normalized = normalize(entry);
    if (!normalized) {
      throw new Error(`Invalid identity state: ${key}[${index}] is malformed`);
    }
    return normalized;
  });
}

function normalizeUserOrNull(value: unknown): CodexWebUser | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.username !== 'string') {
    return null;
  }
  return {
    id: value.id,
    username: value.username,
    email: normalizeOptionalEmail(value.email),
    enabled: value.enabled !== false,
    canNewSession: value.canNewSession !== false,
    passwordHash: typeof value.passwordHash === 'string' ? value.passwordHash : undefined,
    passwordSalt: typeof value.passwordSalt === 'string' ? value.passwordSalt : undefined,
    passwordIterations: Number.isFinite(value.passwordIterations) ? Number(value.passwordIterations) : undefined,
    roleIds: normalizeStringArray(value.roleIds),
    directProjectGrants: normalizeProjectGrants(value.directProjectGrants),
    favoriteProjectIds: normalizeStringArray(value.favoriteProjectIds),
  };
}

function normalizeRoleOrNull(value: unknown): CodexWebRole | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }
  return normalizeRole(value as CodexWebRole);
}

function normalizeRole(role: CodexWebRole): CodexWebRole {
  return {
    id: normalizeRequiredId(role.id, 'role id'),
    name: String(role.name ?? '').trim() || role.id,
    isAdmin: role.isAdmin === true,
    projectGrants: normalizeProjectGrants(role.projectGrants),
  };
}

function normalizeProjectOrNull(value: unknown): CodexWebProject | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.cwd !== 'string') {
    return null;
  }
  return normalizeProject(value as CodexWebProject);
}

function normalizeProject(project: CodexWebProject): CodexWebProject {
  const id = normalizeRequiredId(project.id, 'project id');
  const cwd = normalizeRequiredId(project.cwd, 'project cwd');
  return {
    id,
    internalName: String(project.internalName ?? '').trim() || id,
    cwd,
    displayName: cwdLeafName(String(project.displayName ?? '').trim()) || cwdLeafName(cwd) || id,
    enabled: project.enabled !== false,
    activeSessionLimit: normalizeProjectActiveSessionLimit((project as CodexWebProject & { activeSessionLimit?: unknown }).activeSessionLimit),
    showWorkDetailsToMembers: (project as CodexWebProject & { showWorkDetailsToMembers?: unknown }).showWorkDetailsToMembers !== false,
  };
}

function cwdLeafName(cwd: string): string {
  const parts = String(cwd || '').split(/[\\/]+/u).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : '';
}

export function projectDisplayNameKey(value: string): string {
  return String(value ?? '').trim().normalize('NFKC').toLowerCase();
}

function normalizeAppSessionOrNull(value: unknown): CodexWebAppSession | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.codexThreadId !== 'string') {
    return null;
  }
  return normalizeAppSession(value as CodexWebAppSession);
}

function normalizeAppSession(session: CodexWebAppSession): CodexWebAppSession {
  const now = new Date().toISOString();
  return {
    id: normalizeRequiredId(session.id, 'session id'),
    codexThreadId: normalizeRequiredId(session.codexThreadId, 'codex thread id'),
    projectId: normalizeRequiredId(session.projectId, 'project id'),
    ownerUserId: normalizeRequiredId(session.ownerUserId, 'owner user id'),
    createdAt: String(session.createdAt ?? '').trim() || now,
    updatedAt: String(session.updatedAt ?? '').trim() || now,
    archived: session.archived === true,
    archivedAt: normalizeOptionalIsoString((session as CodexWebAppSession & { archivedAt?: unknown }).archivedAt),
    archivedByUserId: normalizeOptionalId((session as CodexWebAppSession & { archivedByUserId?: unknown }).archivedByUserId),
    archiveSource: normalizeArchiveSource((session as CodexWebAppSession & { archiveSource?: unknown }).archiveSource),
  };
}

function normalizeShareOrNull(value: unknown): CodexWebShare | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.tokenHash !== 'string') {
    return null;
  }
  return {
    id: value.id,
    tokenHash: value.tokenHash,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
    createdByUserId: typeof value.createdByUserId === 'string' ? value.createdByUserId : '',
    enabled: value.enabled !== false,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    expiresAt: normalizeOptionalIsoString(value.expiresAt),
    revokedAt: normalizeOptionalIsoString(value.revokedAt),
  };
}

function normalizeUserSessionOrNull(value: unknown): CodexWebUserSession | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.tokenHash !== 'string') {
    return null;
  }
  return normalizeUserSession(value as CodexWebUserSession);
}

function normalizeUserSession(session: CodexWebUserSession): CodexWebUserSession {
  const now = new Date().toISOString();
  return {
    id: normalizeRequiredId(session.id, 'auth session id'),
    tokenHash: normalizeRequiredId(session.tokenHash, 'token hash'),
    deviceName: String(session.deviceName ?? '').trim().slice(0, 120) || 'Unknown device',
    createdAt: String(session.createdAt ?? '').trim() || now,
    lastSeenAt: String(session.lastSeenAt ?? '').trim() || now,
    userId: normalizeRequiredId(session.userId, 'user id'),
  };
}

function normalizeWebhookCredentialOrNull(value: unknown): CodexWebWebhookCredential | null {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !value.id.trim()
    || typeof value.ownerUserId !== 'string'
    || !value.ownerUserId.trim()
    || typeof value.enabled !== 'boolean'
    || typeof value.tokenHash !== 'string'
    || !value.tokenHash.trim()
    || typeof value.keyHint !== 'string'
    || !value.keyHint.trim()
    || typeof value.createdAt !== 'string'
    || !value.createdAt.trim()
    || typeof value.updatedAt !== 'string'
    || !value.updatedAt.trim()
  ) {
    return null;
  }
  const key = value.key === undefined || value.key === null
    ? null
    : typeof value.key === 'string'
      ? value.key.trim()
      : null;
  if (
    value.key !== undefined
    && value.key !== null
    && typeof value.key !== 'string'
  ) {
    return null;
  }
  const tokenHash = value.tokenHash.trim();
  const keyHint = value.keyHint.trim();
  if (
    key !== null
    && (
      value.key !== key
      || value.keyHint !== keyHint
      || value.tokenHash !== tokenHash
      || !isWebhookKey(key)
      || keyHint !== webhookKeyHint(key)
      || !safeEqual(tokenHash, hashToken(key))
    )
  ) {
    return null;
  }
  return {
    id: value.id.trim(),
    ownerUserId: value.ownerUserId.trim(),
    enabled: value.enabled,
    key,
    tokenHash,
    keyHint,
    createdAt: value.createdAt.trim(),
    updatedAt: value.updatedAt.trim(),
  };
}

function normalizeWebhookCredentials(record: Record<string, any>): CodexWebWebhookCredential[] {
  const credentials = normalizeStateCollection(record, 'webhookCredentials', normalizeWebhookCredentialOrNull);
  const ids = new Set<string>();
  const ownerUserIds = new Set<string>();
  const tokenHashes = new Set<string>();
  for (const credential of credentials) {
    if (ids.has(credential.id)) {
      throw new Error('Invalid identity state: webhookCredentials contains a duplicate id');
    }
    if (ownerUserIds.has(credential.ownerUserId)) {
      throw new Error('Invalid identity state: webhookCredentials contains a duplicate ownerUserId');
    }
    if (tokenHashes.has(credential.tokenHash)) {
      throw new Error('Invalid identity state: webhookCredentials contains a duplicate tokenHash');
    }
    ids.add(credential.id);
    ownerUserIds.add(credential.ownerUserId);
    tokenHashes.add(credential.tokenHash);
  }
  return credentials;
}

function normalizeProjectGrants(value: unknown): CodexWebProjectGrant[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((grant): CodexWebProjectGrant | null => {
      if (!isRecord(grant) || typeof grant.projectId !== 'string' || !grant.projectId.trim()) {
        return null;
      }
      return {
        projectId: grant.projectId.trim(),
        canRead: grant.canRead === true,
        canCreate: grant.canCreate === true,
        canWrite: grant.canWrite === true,
      };
    })
    .filter(isPresent);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean));
}

function uniqueStrings(value: string[]): string[] {
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function normalizeUsername(username: string): string {
  const normalized = String(username ?? '').trim();
  if (!normalized) {
    throw new Error('username is required');
  }
  return normalized;
}

function normalizeOptionalEmail(email: unknown): string | undefined {
  const normalized = typeof email === 'string' ? email.trim() : '';
  return normalized || undefined;
}

function normalizePassword(password: string): string {
  const normalized = String(password ?? '');
  if (normalized.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  return normalized;
}

function deriveUserId(username: string, rawId: string | undefined, users: CodexWebUser[]): string {
  const explicitId = String(rawId ?? '').trim();
  if (explicitId) {
    return normalizeRequiredId(explicitId, 'user id');
  }
  const base = `user_${slugifyUserSegment(username) || 'user'}`;
  let candidate = base;
  let suffix = 2;
  while (users.some((user) => user.id === candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function slugifyUserSegment(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function normalizeSiteTitle(siteTitle: unknown): string {
  const normalized = typeof siteTitle === 'string' ? siteTitle.trim() : '';
  return normalized || DEFAULT_SITE_TITLE;
}

function normalizeProjectActiveSessionLimit(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 30;
  }
  return parsed;
}

function normalizeOptionalIsoString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeOptionalId(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeArchiveSource(value: unknown): 'codex' | 'web-only' | null {
  return value === 'codex' || value === 'web-only' ? value : null;
}

function normalizeRequiredId(value: string, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
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

function createShareToken(): string {
  return `cws_${crypto.randomBytes(32).toString('base64url')}`;
}

function createWebhookKey(): string {
  return `cwwh_${crypto.randomBytes(32).toString('base64url')}`;
}

function isWebhookKey(key: string): boolean {
  return /^cwwh_[A-Za-z0-9_-]{43}$/u.test(key);
}

function webhookKeyHint(key: string): string {
  return key.slice(-6);
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

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) {
    return [...items, item];
  }
  const next = [...items];
  next[index] = item;
  return next;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
