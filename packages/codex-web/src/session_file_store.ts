import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';

export type CodexWebSessionFileKind = 'markdown' | 'html' | 'pdf' | 'image' | 'file';

export type CodexWebSessionFileSource = 'project' | 'upload' | 'turn_attachment' | 'legacy_report';

export interface CodexWebSessionFile {
  id: string;
  name: string;
  kind: CodexWebSessionFileKind;
  mimeType: string;
  sizeBytes: number;
  updatedAt: string;
  source: CodexWebSessionFileSource;
}

export interface CodexWebSessionFileContent {
  file: CodexWebSessionFile;
  data: Buffer;
  release: () => void;
}

export interface CodexWebSessionFileScope {
  principalId: string;
  sessionId: string;
  projectRoot: string;
  projectStorageKey: string;
  attachmentSessionIds: string[];
  legacyReportKeys: string[];
  stateDir: string;
  reportsDir: string;
}

interface SessionFileHandle {
  id: string;
  principalId: string;
  sessionId: string;
  absolutePath: string;
  source: CodexWebSessionFileSource;
  createdAtMs: number;
}

interface AllowedRoot {
  path: string;
  source: CodexWebSessionFileSource;
}

interface ValidatedSessionFile {
  absolutePath: string;
  source: CodexWebSessionFileSource;
  stat: import('node:fs').Stats;
  fileHandle: FileHandle;
}

const HANDLE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_HANDLE_COUNT = 4_096;
const MAX_CONTENT_BYTES = 64 * 1024 * 1024;
const MAX_ACTIVE_CONTENT_BYTES = 128 * 1024 * 1024;
const MAX_ACTIVE_CONTENT_READS = 4;

const FILE_TYPES = new Map<string, { kind: CodexWebSessionFileKind; mimeType: string }>([
  ['.md', { kind: 'markdown', mimeType: 'text/markdown; charset=utf-8' }],
  ['.markdown', { kind: 'markdown', mimeType: 'text/markdown; charset=utf-8' }],
  ['.html', { kind: 'html', mimeType: 'text/html; charset=utf-8' }],
  ['.htm', { kind: 'html', mimeType: 'text/html; charset=utf-8' }],
  ['.pdf', { kind: 'pdf', mimeType: 'application/pdf' }],
  ['.png', { kind: 'image', mimeType: 'image/png' }],
  ['.jpg', { kind: 'image', mimeType: 'image/jpeg' }],
  ['.jpeg', { kind: 'image', mimeType: 'image/jpeg' }],
  ['.gif', { kind: 'image', mimeType: 'image/gif' }],
  ['.webp', { kind: 'image', mimeType: 'image/webp' }],
  ['.bmp', { kind: 'image', mimeType: 'image/bmp' }],
  ['.avif', { kind: 'image', mimeType: 'image/avif' }],
  ['.tif', { kind: 'image', mimeType: 'image/tiff' }],
  ['.tiff', { kind: 'image', mimeType: 'image/tiff' }],
]);

export class SessionFileNotFoundError extends Error {
  constructor() {
    super('Session file was not found.');
    this.name = 'SessionFileNotFoundError';
  }
}

export class SessionFileTooLargeError extends Error {
  readonly maxBytes = MAX_CONTENT_BYTES;

  constructor() {
    super('Session file exceeds the maximum readable size.');
    this.name = 'SessionFileTooLargeError';
  }
}

export class SessionFileBusyError extends Error {
  constructor() {
    super('Session file capacity is temporarily busy.');
    this.name = 'SessionFileBusyError';
  }
}

export class FileSessionFileStore {
  private readonly handles = new Map<string, SessionFileHandle>();
  private activeContentBytes = 0;
  private activeContentReads = 0;

  async resolveFile(scope: CodexWebSessionFileScope, inputPath: string): Promise<CodexWebSessionFile> {
    const normalizedInput = String(inputPath ?? '').trim();
    if (!normalizedInput) {
      throw new SessionFileNotFoundError();
    }
    this.pruneHandles();
    const requestedPath = path.isAbsolute(normalizedInput)
      ? path.resolve(normalizedInput)
      : path.resolve(scope.projectRoot, normalizedInput);
    const validated = await validateSessionFile(scope, requestedPath);
    try {
      const id = `sf_${crypto.randomBytes(24).toString('base64url')}`;
      const handle: SessionFileHandle = {
        id,
        principalId: scope.principalId,
        sessionId: scope.sessionId,
        absolutePath: validated.absolutePath,
        source: validated.source,
        createdAtMs: Date.now(),
      };
      this.handles.set(id, handle);
      return metadataFromValidated(handle, validated);
    } finally {
      await validated.fileHandle.close();
    }
  }

  async readFile(
    scope: CodexWebSessionFileScope,
    fileId: string,
  ): Promise<CodexWebSessionFileContent> {
    this.pruneHandles();
    const handle = this.handles.get(String(fileId ?? ''));
    if (
      !handle
      || handle.principalId !== scope.principalId
      || handle.sessionId !== scope.sessionId
    ) {
      throw new SessionFileNotFoundError();
    }

    const validated = await validateSessionFile(scope, handle.absolutePath, handle.source);
    let release = () => {};
    try {
      const opened = validated.stat;
      if (opened.size > MAX_CONTENT_BYTES) {
        throw new SessionFileTooLargeError();
      }
      release = this.reserveContentCapacity(opened.size);
      const data = await readExactFile(validated.fileHandle, opened.size);
      const afterRead = await validated.fileHandle.stat();
      if (!sameFileVersion(opened, afterRead)) {
        throw new SessionFileNotFoundError();
      }
      return {
        file: metadataFromValidated(handle, validated),
        data,
        release,
      };
    } catch (error) {
      release();
      if (error instanceof SessionFileTooLargeError || error instanceof SessionFileBusyError) {
        throw error;
      }
      throw asSessionFileNotFound(error);
    } finally {
      await validated.fileHandle.close();
    }
  }

  private reserveContentCapacity(sizeBytes: number): () => void {
    if (
      this.activeContentReads >= MAX_ACTIVE_CONTENT_READS
      || this.activeContentBytes + sizeBytes > MAX_ACTIVE_CONTENT_BYTES
    ) {
      throw new SessionFileBusyError();
    }
    this.activeContentReads += 1;
    this.activeContentBytes += sizeBytes;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.activeContentReads -= 1;
      this.activeContentBytes -= sizeBytes;
    };
  }

  private pruneHandles(now = Date.now()): void {
    for (const [id, handle] of this.handles) {
      if (now - handle.createdAtMs > HANDLE_TTL_MS) {
        this.handles.delete(id);
      }
    }
    while (this.handles.size >= MAX_HANDLE_COUNT) {
      const oldestId = this.handles.keys().next().value as string | undefined;
      if (!oldestId) {
        break;
      }
      this.handles.delete(oldestId);
    }
  }
}

async function validateSessionFile(
  scope: CodexWebSessionFileScope,
  requestedPath: string,
  expectedSource?: CodexWebSessionFileSource,
): Promise<ValidatedSessionFile> {
  const absolutePath = path.resolve(requestedPath);
  const allowedRoots = allowedRootsForScope(scope);
  const matchedRoot = allowedRootForPath(scope, allowedRoots, absolutePath);
  if (!matchedRoot || (expectedSource && matchedRoot.source !== expectedSource)) {
    throw new SessionFileNotFoundError();
  }

  let fileHandle: FileHandle | null = null;
  try {
    const [rootBefore, pathBefore] = await Promise.all([
      fs.lstat(matchedRoot.path),
      fs.lstat(absolutePath),
    ]);
    if (!rootBefore.isDirectory() || pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
      throw new SessionFileNotFoundError();
    }
    await rejectPathSymlinks(matchedRoot.path, absolutePath);
    const [realRoot, realPath] = await Promise.all([
      fs.realpath(matchedRoot.path),
      fs.realpath(absolutePath),
    ]);
    if (!isPathInsideOrEqual(realPath, realRoot)) {
      throw new SessionFileNotFoundError();
    }
    const [rootBeforeOpen, pathBeforeOpen] = await Promise.all([
      fs.lstat(matchedRoot.path),
      fs.lstat(absolutePath),
    ]);
    if (
      !sameDirectoryIdentity(rootBefore, rootBeforeOpen)
      || !sameFileIdentity(pathBefore, pathBeforeOpen)
      || pathBeforeOpen.isSymbolicLink()
    ) {
      throw new SessionFileNotFoundError();
    }
    fileHandle = await fs.open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await fileHandle.stat();
    if (!sameFileIdentity(pathBefore, opened)) {
      throw new SessionFileNotFoundError();
    }
    const [rootAfterOpen, pathAfterOpen, realRootAfterOpen, realPathAfterOpen] = await Promise.all([
      fs.lstat(matchedRoot.path),
      fs.lstat(absolutePath),
      fs.realpath(matchedRoot.path),
      fs.realpath(absolutePath),
    ]);
    if (
      !sameDirectoryIdentity(rootBefore, rootAfterOpen)
      || !sameFileIdentity(opened, pathAfterOpen)
      || pathAfterOpen.isSymbolicLink()
      || realRootAfterOpen !== realRoot
      || realPathAfterOpen !== realPath
      || !isPathInsideOrEqual(realPathAfterOpen, realRootAfterOpen)
    ) {
      throw new SessionFileNotFoundError();
    }
    return {
      absolutePath,
      source: matchedRoot.source,
      stat: opened,
      fileHandle,
    };
  } catch (error) {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
    throw asSessionFileNotFound(error);
  }
}

function allowedRootsForScope(scope: CodexWebSessionFileScope): AllowedRoot[] {
  const projectRoot = path.resolve(scope.projectRoot);
  const stateDir = path.resolve(scope.stateDir);
  const reportsDir = path.resolve(scope.reportsDir);
  const userSegment = safePathSegment(scope.principalId);
  const projectStorageKey = safePathSegment(scope.projectStorageKey);
  const roots: AllowedRoot[] = [
    {
      path: path.join(projectRoot, 'uploads', userSegment),
      source: 'upload',
    },
    {
      path: path.join(stateDir, 'uploads', 'projects', projectStorageKey, userSegment),
      source: 'upload',
    },
    ...uniqueSafeSegments(scope.attachmentSessionIds).map((sessionId): AllowedRoot => ({
      path: path.join(stateDir, 'turn-attachments', userSegment, sessionId),
      source: 'turn_attachment',
    })),
    ...uniquePathSegments(scope.legacyReportKeys).map((projectKey): AllowedRoot => ({
      path: path.join(reportsDir, projectKey),
      source: 'legacy_report',
    })),
    {
      path: projectRoot,
      source: 'project',
    },
  ];
  return roots.map((root) => ({ ...root, path: path.resolve(root.path) }));
}

function allowedRootForPath(
  scope: CodexWebSessionFileScope,
  roots: AllowedRoot[],
  candidatePath: string,
): AllowedRoot | null {
  const matchingManagedRoot = roots.find((root) => (
    root.source !== 'project' && isPathInsideOrEqual(candidatePath, root.path)
  ));
  if (matchingManagedRoot) {
    return matchingManagedRoot;
  }

  const projectRoot = roots.find((root) => root.source === 'project');
  if (!projectRoot || !isPathInsideOrEqual(candidatePath, projectRoot.path)) {
    return null;
  }

  const restrictedRoots = [
    path.join(projectRoot.path, 'uploads'),
    path.join(path.resolve(scope.stateDir), 'uploads'),
    path.join(path.resolve(scope.stateDir), 'turn-attachments'),
    path.resolve(scope.reportsDir),
  ];
  if (restrictedRoots.some((root) => isPathInsideOrEqual(candidatePath, root))) {
    return null;
  }
  return projectRoot;
}

async function rejectPathSymlinks(rootPath: string, candidatePath: string): Promise<void> {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  if (!isPathInsideOrEqual(candidate, root)) {
    throw new SessionFileNotFoundError();
  }
  const relative = path.relative(root, candidate);
  const paths = [root];
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    paths.push(current);
  }
  for (const entryPath of paths) {
    const stat = await fs.lstat(entryPath);
    if (stat.isSymbolicLink()) {
      throw new SessionFileNotFoundError();
    }
  }
}

function metadataFromValidated(
  handle: SessionFileHandle,
  validated: ValidatedSessionFile,
): CodexWebSessionFile {
  const fileType = FILE_TYPES.get(path.extname(validated.absolutePath).toLowerCase())
    ?? { kind: 'file' as const, mimeType: 'application/octet-stream' };
  return {
    id: handle.id,
    name: displayFileName(validated.absolutePath, validated.source),
    kind: fileType.kind,
    mimeType: fileType.mimeType,
    sizeBytes: validated.stat.size,
    updatedAt: validated.stat.mtime.toISOString(),
    source: validated.source,
  };
}

function displayFileName(absolutePath: string, source: CodexWebSessionFileSource): string {
  const basename = path.basename(absolutePath);
  if (source === 'upload') {
    return basename.replace(/^att_[A-Za-z0-9]+-/u, '') || basename;
  }
  if (source === 'turn_attachment') {
    return basename.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/iu, '') || basename;
  }
  return basename;
}

async function readExactFile(fileHandle: FileHandle, size: number): Promise<Buffer> {
  const data = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await fileHandle.read(data, offset, size - offset, offset);
    if (bytesRead <= 0) {
      throw new SessionFileNotFoundError();
    }
    offset += bytesRead;
  }
  return data;
}

function sameDirectoryIdentity(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean {
  return left.isDirectory()
    && right.isDirectory()
    && left.dev === right.dev
    && left.ino === right.ino;
}

function sameFileIdentity(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size;
}

function sameFileVersion(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean {
  return sameFileIdentity(left, right)
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function uniqueSafeSegments(values: string[]): string[] {
  return [...new Set(values.map(normalizeSafePathSegment).filter((value): value is string => Boolean(value)))];
}

function uniquePathSegments(values: string[]): string[] {
  return [...new Set(values.map((value) => {
    const normalized = String(value ?? '').trim();
    return normalized && normalized !== '.' && normalized !== '..' && path.basename(normalized) === normalized
      ? normalized
      : null;
  }).filter((value): value is string => Boolean(value)))];
}

function normalizeSafePathSegment(value: string): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized === '.' || normalized === '..' || path.basename(normalized) !== normalized) {
    return null;
  }
  return safePathSegment(normalized);
}

function safePathSegment(value: string): string {
  const normalized = String(value ?? '').trim()
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return normalized || 'unknown';
}

function isPathInsideOrEqual(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function asSessionFileNotFound(error: unknown): SessionFileNotFoundError {
  if (error instanceof SessionFileNotFoundError) {
    return error;
  }
  return new SessionFileNotFoundError();
}
