import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 10;
const DEFAULT_RETIRE_CLAIM_STALE_MS = 30_000;
const syncWaitBuffer = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

export interface FileLockOptions {
  staleMs?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  retireClaimStaleMs?: number;
}

interface FileLockOwner {
  version: 1;
  pid: number;
  createdAt: string;
  token: string;
}

interface ResolvedFileLockOptions {
  staleMs: number;
  timeoutMs: number;
  retryDelayMs: number;
  retireClaimStaleMs: number;
}

interface FileLockSnapshot {
  identity: string;
  modifiedAtMs: number;
  owner: FileLockOwner | null;
}

export class FileLockBusyError extends Error {
  readonly code = 'file_lock_busy';

  readonly lockPath: string;

  constructor(lockPath: string) {
    super(`Timed out waiting for file lock: ${lockPath}`);
    this.name = 'FileLockBusyError';
    this.lockPath = lockPath;
  }
}

export async function withFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options?: FileLockOptions,
): Promise<T> {
  const resolved = resolveOptions(options);
  const owner = await acquireFileLock(lockPath, resolved);
  try {
    return await operation();
  } finally {
    await releaseFileLock(lockPath, owner.token, resolved.retireClaimStaleMs);
  }
}

export function withFileLockSync<T>(
  lockPath: string,
  operation: () => T,
  options?: FileLockOptions,
): T {
  const resolved = resolveOptions(options);
  const owner = acquireFileLockSync(lockPath, resolved);
  try {
    return operation();
  } finally {
    releaseFileLockSync(lockPath, owner.token, resolved.retireClaimStaleMs);
  }
}

async function acquireFileLock(
  lockPath: string,
  options: ResolvedFileLockOptions,
): Promise<FileLockOwner> {
  await fsPromises.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + options.timeoutMs;
  while (true) {
    const owner = createOwner();
    let handle: fsPromises.FileHandle | null = null;
    let created = false;
    try {
      handle = await fsPromises.open(lockPath, 'wx', 0o600);
      created = true;
      await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
      await handle.close();
      return owner;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (created) {
        await releaseFileLock(lockPath, owner.token, options.retireClaimStaleMs).catch(() => {});
      }
      if (!isErrno(error, 'EEXIST')) {
        throw error;
      }
    }

    if (await removeStaleLock(lockPath, options.staleMs, options.retireClaimStaleMs)) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new FileLockBusyError(lockPath);
    }
    await delay(Math.min(options.retryDelayMs, Math.max(1, deadline - Date.now())));
  }
}

function acquireFileLockSync(
  lockPath: string,
  options: ResolvedFileLockOptions,
): FileLockOwner {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + options.timeoutMs;
  while (true) {
    const owner = createOwner();
    let descriptor: number | null = null;
    let created = false;
    try {
      descriptor = fs.openSync(lockPath, 'wx', 0o600);
      created = true;
      fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, 'utf8');
      fs.closeSync(descriptor);
      return owner;
    } catch (error) {
      if (descriptor !== null) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // The original acquisition error is more useful.
        }
      }
      if (created) {
        try {
          releaseFileLockSync(lockPath, owner.token, options.retireClaimStaleMs);
        } catch {
          // The original acquisition error is more useful.
        }
      }
      if (!isErrno(error, 'EEXIST')) {
        throw error;
      }
    }

    if (removeStaleLockSync(lockPath, options.staleMs, options.retireClaimStaleMs)) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new FileLockBusyError(lockPath);
    }
    Atomics.wait(
      syncWaitBuffer,
      0,
      0,
      Math.min(options.retryDelayMs, Math.max(1, deadline - Date.now())),
    );
  }
}

async function removeStaleLock(
  lockPath: string,
  staleMs: number,
  retireClaimStaleMs: number,
): Promise<boolean> {
  const inspection = await inspectLock(lockPath, staleMs);
  if (inspection.status === 'missing') {
    return true;
  }
  if (inspection.status !== 'stale') {
    return false;
  }
  return retireLock(lockPath, inspection.identity, retireClaimStaleMs);
}

function removeStaleLockSync(
  lockPath: string,
  staleMs: number,
  retireClaimStaleMs: number,
): boolean {
  const inspection = inspectLockSync(lockPath, staleMs);
  if (inspection.status === 'missing') {
    return true;
  }
  if (inspection.status !== 'stale') {
    return false;
  }
  return retireLockSync(lockPath, inspection.identity, retireClaimStaleMs);
}

async function inspectLock(
  lockPath: string,
  staleMs: number,
): Promise<(FileLockSnapshot & { status: 'active' | 'stale' }) | { status: 'missing' }> {
  let snapshot: FileLockSnapshot;
  try {
    snapshot = await readLockSnapshot(lockPath);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return { status: 'missing' };
    }
    throw error;
  }
  return { ...snapshot, status: lockStatus(snapshot.owner, snapshot.modifiedAtMs, staleMs) };
}

function inspectLockSync(
  lockPath: string,
  staleMs: number,
): (FileLockSnapshot & { status: 'active' | 'stale' }) | { status: 'missing' } {
  let snapshot: FileLockSnapshot;
  try {
    snapshot = readLockSnapshotSync(lockPath);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return { status: 'missing' };
    }
    throw error;
  }
  return { ...snapshot, status: lockStatus(snapshot.owner, snapshot.modifiedAtMs, staleMs) };
}

function lockStatus(
  owner: FileLockOwner | null,
  modifiedAtMs: number,
  staleMs: number,
): 'active' | 'stale' {
  if (owner && !isProcessAlive(owner.pid)) {
    return 'stale';
  }
  const createdAtMs = owner ? Date.parse(owner.createdAt) : Number.NaN;
  const ageMs = Math.max(
    Date.now() - modifiedAtMs,
    Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : 0,
  );
  return ageMs >= staleMs ? 'stale' : 'active';
}

async function releaseFileLock(
  lockPath: string,
  token: string,
  retireClaimStaleMs: number,
): Promise<void> {
  await retireLock(lockPath, ownerIdentity(token), retireClaimStaleMs);
}

function releaseFileLockSync(lockPath: string, token: string, retireClaimStaleMs: number): void {
  retireLockSync(lockPath, ownerIdentity(token), retireClaimStaleMs);
}

async function retireLock(
  lockPath: string,
  expectedIdentity: string,
  retireClaimStaleMs: number,
): Promise<boolean> {
  const claimPath = retirementClaimPath(lockPath, expectedIdentity);
  while (true) {
    try {
      await fsPromises.link(lockPath, claimPath);
      break;
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return true;
      }
      if (isErrno(error, 'EEXIST')) {
        if (await removeExpiredRetirementClaim(claimPath, retireClaimStaleMs)) {
          continue;
        }
        return false;
      }
      throw error;
    }
  }

  try {
    const claimed = await readLockSnapshot(claimPath);
    if (claimed.identity !== expectedIdentity) {
      return true;
    }
    let currentStats: fs.Stats;
    let claimStats: fs.Stats;
    try {
      [currentStats, claimStats] = await Promise.all([
        fsPromises.stat(lockPath),
        fsPromises.stat(claimPath),
      ]);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return true;
      }
      throw error;
    }
    if (currentStats.dev !== claimStats.dev || currentStats.ino !== claimStats.ino) {
      return true;
    }
    try {
      await fsPromises.unlink(lockPath);
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) {
        throw error;
      }
    }
    return true;
  } finally {
    await fsPromises.rm(claimPath, { force: true }).catch(() => {});
  }
}

function retireLockSync(
  lockPath: string,
  expectedIdentity: string,
  retireClaimStaleMs: number,
): boolean {
  const claimPath = retirementClaimPath(lockPath, expectedIdentity);
  while (true) {
    try {
      fs.linkSync(lockPath, claimPath);
      break;
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return true;
      }
      if (isErrno(error, 'EEXIST')) {
        if (removeExpiredRetirementClaimSync(claimPath, retireClaimStaleMs)) {
          continue;
        }
        return false;
      }
      throw error;
    }
  }

  try {
    const claimed = readLockSnapshotSync(claimPath);
    if (claimed.identity !== expectedIdentity) {
      return true;
    }
    let currentStats: fs.Stats;
    let claimStats: fs.Stats;
    try {
      currentStats = fs.statSync(lockPath);
      claimStats = fs.statSync(claimPath);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return true;
      }
      throw error;
    }
    if (currentStats.dev !== claimStats.dev || currentStats.ino !== claimStats.ino) {
      return true;
    }
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) {
        throw error;
      }
    }
    return true;
  } finally {
    try {
      fs.rmSync(claimPath, { force: true });
    } catch {
      // A leftover claim is harmless and is scoped to this unique lock generation.
    }
  }
}

async function readLockSnapshot(lockPath: string): Promise<FileLockSnapshot> {
  const handle = await fsPromises.open(lockPath, 'r');
  try {
    const stats = await handle.stat();
    const raw = await handle.readFile('utf8');
    const owner = parseOwner(raw);
    return {
      identity: owner ? ownerIdentity(owner.token) : unknownIdentity(raw, stats),
      modifiedAtMs: stats.mtimeMs,
      owner,
    };
  } finally {
    await handle.close();
  }
}

function readLockSnapshotSync(lockPath: string): FileLockSnapshot {
  const descriptor = fs.openSync(lockPath, 'r');
  try {
    const stats = fs.fstatSync(descriptor);
    const raw = fs.readFileSync(descriptor, 'utf8');
    const owner = parseOwner(raw);
    return {
      identity: owner ? ownerIdentity(owner.token) : unknownIdentity(raw, stats),
      modifiedAtMs: stats.mtimeMs,
      owner,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function ownerIdentity(token: string): string {
  return `owner:${token}`;
}

function unknownIdentity(raw: string, stats: fs.Stats): string {
  return `unknown:${crypto.createHash('sha256').update(raw).digest('hex')}:${stats.dev}:${stats.ino}:${stats.mtimeMs}:${stats.size}`;
}

function retirementClaimPath(lockPath: string, identity: string): string {
  const lockHash = crypto.createHash('sha256').update(path.resolve(lockPath)).digest('hex').slice(0, 16);
  const identityHash = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
  return path.join(path.dirname(lockPath), `.${lockHash}.${identityHash}.retire`);
}

async function removeExpiredRetirementClaim(claimPath: string, staleMs: number): Promise<boolean> {
  let before: fs.Stats;
  try {
    before = await fsPromises.stat(claimPath);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return true;
    }
    throw error;
  }
  if (Date.now() - before.ctimeMs < staleMs) {
    return false;
  }

  let current: fs.Stats;
  try {
    current = await fsPromises.stat(claimPath);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return true;
    }
    throw error;
  }
  if (!sameFileVersion(before, current) || Date.now() - current.ctimeMs < staleMs) {
    return false;
  }
  try {
    await fsPromises.unlink(claimPath);
    return true;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return true;
    }
    throw error;
  }
}

function removeExpiredRetirementClaimSync(claimPath: string, staleMs: number): boolean {
  let before: fs.Stats;
  try {
    before = fs.statSync(claimPath);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return true;
    }
    throw error;
  }
  if (Date.now() - before.ctimeMs < staleMs) {
    return false;
  }

  let current: fs.Stats;
  try {
    current = fs.statSync(claimPath);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return true;
    }
    throw error;
  }
  if (!sameFileVersion(before, current) || Date.now() - current.ctimeMs < staleMs) {
    return false;
  }
  try {
    fs.unlinkSync(claimPath);
    return true;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return true;
    }
    throw error;
  }
}

function sameFileVersion(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.ctimeMs === right.ctimeMs
    && left.size === right.size;
}

function createOwner(): FileLockOwner {
  return {
    version: 1,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    token: crypto.randomUUID(),
  };
}

function parseOwner(raw: string | Buffer): FileLockOwner | null {
  try {
    const parsed = JSON.parse(String(raw)) as Partial<FileLockOwner>;
    if (
      parsed.version !== 1
      || !Number.isInteger(parsed.pid)
      || Number(parsed.pid) <= 0
      || typeof parsed.createdAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.createdAt))
      || typeof parsed.token !== 'string'
      || !parsed.token
    ) {
      return null;
    }
    return parsed as FileLockOwner;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrno(error, 'ESRCH');
  }
}

function resolveOptions(options: FileLockOptions | undefined): ResolvedFileLockOptions {
  return {
    staleMs: nonNegativeFinite(options?.staleMs, DEFAULT_STALE_MS),
    timeoutMs: nonNegativeFinite(options?.timeoutMs, DEFAULT_TIMEOUT_MS),
    retryDelayMs: Math.max(1, nonNegativeFinite(options?.retryDelayMs, DEFAULT_RETRY_DELAY_MS)),
    retireClaimStaleMs: nonNegativeFinite(
      options?.retireClaimStaleMs,
      DEFAULT_RETIRE_CLAIM_STALE_MS,
    ),
  };
}

function nonNegativeFinite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
