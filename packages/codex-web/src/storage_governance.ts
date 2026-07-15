import fs from 'node:fs/promises';
import path from 'node:path';
import type { CodexWebConfig } from './config.js';
import { withFileLock } from './file_lock.js';

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const DAY_SECONDS = 24 * 60 * 60;

interface ManagedStorageConfig extends Pick<CodexWebConfig, 'stateDir' | 'reportsDir'> {
  managedStorageMaxBytes?: number;
  projectUploadMaxBytes?: number;
  uploadTtlSeconds?: number;
  turnAttachmentTtlSeconds?: number;
  reportTtlSeconds?: number;
  runtimeContextTtlSeconds?: number;
}

interface ManagedRoot {
  rootDir: string;
  ttlSeconds: number;
  matches(relativePath: string): boolean;
}

interface ManagedFile {
  absolutePath: string;
  rootDir: string;
  sizeBytes: number;
  modifiedAtMs: number;
  protected: boolean;
}

export interface StorageMaintenanceResult {
  totalBytes: number;
  deletedBytes: number;
  deletedFiles: number;
  capacityAvailable: boolean;
}

export class ManagedStorageQuotaError extends Error {
  readonly code = 'managed_storage_quota_exceeded';

  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Managed storage quota exceeded (${maxBytes} bytes).`);
    this.name = 'ManagedStorageQuotaError';
    this.maxBytes = maxBytes;
  }
}

export async function maintainManagedStateStorage(
  config: ManagedStorageConfig,
  { protectedPaths = [] }: { protectedPaths?: string[] } = {},
): Promise<StorageMaintenanceResult> {
  return withFileLock(stateStorageLockPath(config.stateDir), () => pruneManagedRoots({
    roots: stateManagedRoots(config),
    maxBytes: positiveInteger(config.managedStorageMaxBytes, 2 * GIBIBYTE),
    protectedPaths,
  }));
}

export async function withManagedStateStorageCapacity<T>({
  config,
  incomingBytes,
  protectedPaths = [],
  operation,
}: {
  config: ManagedStorageConfig;
  incomingBytes: number;
  protectedPaths?: string[];
  operation: () => Promise<T>;
}): Promise<T> {
  const maxBytes = positiveInteger(config.managedStorageMaxBytes, 2 * GIBIBYTE);
  return withFileLock(stateStorageLockPath(config.stateDir), async () => {
    const result = await pruneManagedRoots({
      roots: stateManagedRoots(config),
      maxBytes,
      incomingBytes,
      protectedPaths,
    });
    if (!result.capacityAvailable) {
      throw new ManagedStorageQuotaError(maxBytes);
    }
    return operation();
  });
}

export async function withProjectUploadCapacity<T>({
  config,
  uploadsRoot,
  incomingBytes,
  operation,
}: {
  config: ManagedStorageConfig;
  uploadsRoot: string;
  incomingBytes: number;
  operation: () => Promise<T>;
}): Promise<T> {
  const maxBytes = positiveInteger(config.projectUploadMaxBytes, 512 * MEBIBYTE);
  const lockName = Buffer.from(path.resolve(uploadsRoot)).toString('base64url').slice(0, 80);
  const lockPath = path.join(config.stateDir, 'locks', `project-upload-${lockName}.lock`);
  return withFileLock(lockPath, async () => {
    const result = await pruneManagedRoots({
      roots: [{
        rootDir: uploadsRoot,
        ttlSeconds: positiveInteger(config.uploadTtlSeconds, 7 * DAY_SECONDS),
        matches: isManagedUpload,
      }],
      maxBytes,
      incomingBytes,
    });
    if (!result.capacityAvailable) {
      throw new ManagedStorageQuotaError(maxBytes);
    }
    return operation();
  });
}

async function pruneManagedRoots({
  roots,
  maxBytes,
  incomingBytes = 0,
  protectedPaths = [],
}: {
  roots: ManagedRoot[];
  maxBytes: number;
  incomingBytes?: number;
  protectedPaths?: string[];
}): Promise<StorageMaintenanceResult> {
  const now = Date.now();
  const protectedSet = new Set(protectedPaths.map((entry) => path.resolve(entry)));
  const files = (await Promise.all(roots.map((root) => scanManagedFiles(root, protectedSet)))).flat();
  let totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  let deletedBytes = 0;
  let deletedFiles = 0;
  const remaining: ManagedFile[] = [];

  for (const file of files) {
    const root = roots.find((entry) => path.resolve(entry.rootDir) === file.rootDir);
    const expired = root
      ? file.modifiedAtMs < now - root.ttlSeconds * 1_000
      : false;
    if (expired && !file.protected && await removeManagedFile(file)) {
      totalBytes -= file.sizeBytes;
      deletedBytes += file.sizeBytes;
      deletedFiles += 1;
      continue;
    }
    remaining.push(file);
  }

  const targetBytes = Math.max(0, maxBytes - Math.max(0, Math.floor(incomingBytes)));
  remaining.sort((left, right) => left.modifiedAtMs - right.modifiedAtMs
    || left.absolutePath.localeCompare(right.absolutePath));
  for (const file of remaining) {
    if (totalBytes <= targetBytes) {
      break;
    }
    if (file.protected || !await removeManagedFile(file)) {
      continue;
    }
    totalBytes -= file.sizeBytes;
    deletedBytes += file.sizeBytes;
    deletedFiles += 1;
  }

  return {
    totalBytes,
    deletedBytes,
    deletedFiles,
    capacityAvailable: incomingBytes <= maxBytes && totalBytes <= targetBytes,
  };
}

async function scanManagedFiles(root: ManagedRoot, protectedPaths: Set<string>): Promise<ManagedFile[]> {
  const rootDir = path.resolve(root.rootDir);
  const rootStats = await fs.lstat(rootDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
    return [];
  }

  const files: ManagedFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
      if (!root.matches(relativePath)) {
        continue;
      }
      const stats = await fs.lstat(absolutePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      });
      if (!stats?.isFile() || stats.isSymbolicLink()) {
        continue;
      }
      files.push({
        absolutePath,
        rootDir,
        sizeBytes: stats.size,
        modifiedAtMs: stats.mtimeMs,
        protected: protectedPaths.has(path.resolve(absolutePath)),
      });
    }
  };
  await visit(rootDir);
  return files;
}

async function removeManagedFile(file: ManagedFile): Promise<boolean> {
  try {
    await fs.unlink(file.absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  await removeEmptyParents(path.dirname(file.absolutePath), file.rootDir);
  return true;
}

async function removeEmptyParents(directory: string, rootDir: string): Promise<void> {
  let current = path.resolve(directory);
  const root = path.resolve(rootDir);
  while (current !== root && isPathInside(current, root)) {
    try {
      await fs.rmdir(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        current = path.dirname(current);
        continue;
      }
      if (code === 'ENOTEMPTY' || code === 'EEXIST') {
        return;
      }
      throw error;
    }
    current = path.dirname(current);
  }
}

function stateManagedRoots(config: ManagedStorageConfig): ManagedRoot[] {
  return [
    {
      rootDir: path.join(config.stateDir, 'uploads'),
      ttlSeconds: positiveInteger(config.uploadTtlSeconds, 7 * DAY_SECONDS),
      matches: isManagedUpload,
    },
    {
      rootDir: path.join(config.stateDir, 'turn-attachments'),
      ttlSeconds: positiveInteger(config.turnAttachmentTtlSeconds, 30 * DAY_SECONDS),
      matches: (relativePath) => /^[^/]+\/[^/]+\/[0-9a-f]{8}-[0-9a-f-]{27}-/iu.test(relativePath),
    },
    {
      rootDir: config.reportsDir,
      ttlSeconds: positiveInteger(config.reportTtlSeconds, 365 * DAY_SECONDS),
      matches: (relativePath) => /\.(?:md|markdown|html|htm)$/iu.test(relativePath),
    },
    {
      rootDir: path.join(config.stateDir, 'runtime-context'),
      ttlSeconds: positiveInteger(config.runtimeContextTtlSeconds, 30 * DAY_SECONDS),
      matches: (relativePath) => /\.json$/iu.test(relativePath),
    },
  ];
}

function isManagedUpload(relativePath: string): boolean {
  return /(?:^|\/)att_[0-9a-f]{20}-[^/]+$/iu.test(relativePath);
}

function stateStorageLockPath(stateDir: string): string {
  return path.join(stateDir, 'locks', 'managed-storage.lock');
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}
