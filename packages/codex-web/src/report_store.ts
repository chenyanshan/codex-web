import { FileVersionCache } from './file_version_cache.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const REPORT_PREVIEW_BYTES = 512 * 1024;

export type CodexWebReportKind = 'markdown' | 'html';

export interface CodexWebReport {
  id: string;
  project: string;
  title: string;
  kind: CodexWebReportKind;
  path: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
}

export interface CodexWebReportContent {
  report: CodexWebReport;
  content: string;
  previewTruncated: boolean;
  totalBytes: number;
}

interface ReportIndexFile {
  version: 1;
  reports: Record<string, ReportIndexEntry>;
}

interface ReportIndexEntry {
  favorite?: boolean;
  title?: string;
  project?: string;
  createdAt?: string;
  updatedAt?: string;
}

type ReportCursor = Pick<CodexWebReport, 'favorite' | 'updatedAt' | 'id'>;
const compareReports = (left: ReportCursor, right: ReportCursor) => Number(right.favorite) - Number(left.favorite)
  || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
const indexCaches = new Map<string, FileVersionCache<ReportIndexFile>>();

const REPORT_EXTENSIONS = new Map<string, CodexWebReportKind>([
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.html', 'html'],
  ['.htm', 'html'],
]);

export class FileReportStore {
  private readonly reportsDir: string;

  private readonly beforeAccess: (() => Promise<void>) | null;

  private readonly indexCache: FileVersionCache<ReportIndexFile>;

  constructor({
    reportsDir,
    indexPath,
    beforeAccess = null,
  }: {
    reportsDir: string;
    indexPath: string;
    beforeAccess?: (() => Promise<void>) | null;
  }) {
    this.reportsDir = path.resolve(reportsDir);
    const cacheKey = path.resolve(indexPath);
    this.indexCache = indexCaches.get(cacheKey) ?? new FileVersionCache(indexPath, raw => {
      const parsed = JSON.parse(raw) as Partial<ReportIndexFile>;
      return { version: 1, reports: isRecord(parsed.reports) ? parsed.reports as Record<string, ReportIndexEntry> : {} };
    }, () => ({ version: 1, reports: {} }));
    indexCaches.delete(cacheKey); indexCaches.set(cacheKey, this.indexCache);
    if (indexCaches.size > 32) indexCaches.delete(indexCaches.keys().next().value!);
    this.beforeAccess = beforeAccess;
  }

  async listReports(): Promise<CodexWebReport[]> {
    return (await this.listPage()).items;
  }

  /** Scan lazily and retain at most limit + 1 records, including permission filtering. */
  async listPage({ limit = 50, cursor = '', scope = '', visible = () => true }: {
    limit?: number; cursor?: string; scope?: string; visible?: (report: CodexWebReport) => boolean;
  } = {}): Promise<{ items: CodexWebReport[]; nextCursor: string | null; hasMore: boolean }> {
    await this.beforeAccess?.();
    limit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 50;
    let after: ReportCursor | null = null;
    if (cursor) {
      try {
        if (cursor.length > 8192) throw new Error();
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (value.v !== 1 || value.scope !== scope || typeof value.id !== 'string' || typeof value.updatedAt !== 'string' || typeof value.favorite !== 'boolean') throw new Error();
        after = value;
      } catch { throw Object.assign(new Error('Invalid report cursor.'), { statusCode: 400, code: 'invalid_cursor' }); }
    }
    const entries: CodexWebReport[] = [];
    const index = await this.readIndex();
    for await (const report of this.scanDirectory(this.reportsDir, index)) {
      if (!visible(report) || (after && compareReports(report, after) <= 0)) continue;
      let low = 0, high = entries.length;
      while (low < high) { const middle = (low + high) >>> 1; if (compareReports(entries[middle]!, report) < 0) low = middle + 1; else high = middle; }
      entries.splice(low, 0, report);
      if (entries.length > limit + 1) entries.pop();
    }
    const hasMore = entries.length > limit, items = entries.slice(0, limit), last = items.at(-1);
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ v: 1, scope, favorite: last.favorite, updatedAt: last.updatedAt, id: last.id })).toString('base64url') : null;
    return { items, nextCursor, hasMore };
  }

  async readReport(reportId: string): Promise<CodexWebReport | null> {
    await this.beforeAccess?.();
    return this.readReportWithoutMaintenance(reportId);
  }

  private async readReportWithoutMaintenance(reportId: string): Promise<CodexWebReport | null> {
    const absolutePath = await this.resolveReportPath(reportId);
    const stat = await fs.stat(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (!stat?.isFile()) {
      return null;
    }
    const id = await this.reportIdFromPath(absolutePath);
    return this.toReport(id, absolutePath, stat);
  }

  async readContent(reportId: string): Promise<CodexWebReportContent | null> {
    const opened = await this.openContent(reportId);
    if (!opened) return null;
    const { report, handle } = opened;
    try {
      const buffer = Buffer.alloc(Math.min(REPORT_PREVIEW_BYTES, report.sizeBytes));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const previewTruncated = report.sizeBytes > bytesRead;
      const decoder = new StringDecoder('utf8');
      const content = decoder.write(buffer.subarray(0, bytesRead)) + (previewTruncated ? '' : decoder.end());
      return { report, content, previewTruncated, totalBytes: report.sizeBytes };
    } finally { await handle.close(); }
  }

  async openContent(reportId: string) {
    await this.beforeAccess?.();
    const report = await this.readReportWithoutMaintenance(reportId);
    if (!report) return null;
    const realPath = await fs.realpath(report.path);
    await this.assertInsideReportsRoot(realPath);
    const handle = await fs.open(realPath, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); return null; }
      return { report: { ...report, sizeBytes: stat.size }, handle };
    } catch (error) { await handle.close(); throw error; }
  }

  async resolveReport(inputPath: string): Promise<CodexWebReport | null> {
    await this.beforeAccess?.();
    const absolutePath = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : await this.resolveReportPath(inputPath);
    const id = await this.reportIdFromPath(absolutePath);
    return this.readReportWithoutMaintenance(id);
  }

  private async *scanDirectory(directory: string, index: ReportIndexFile): AsyncGenerator<CodexWebReport> {
    let entries: import('node:fs').Dir;
    try {
      entries = await fs.opendir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for await (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        yield* this.scanDirectory(absolutePath, index);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) {
        continue;
      }
      if (!REPORT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      try {
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile()) {
          continue;
        }
        const id = await this.reportIdFromPath(absolutePath);
        yield await this.toReport(id, absolutePath, stat, index);
      } catch (error) {
        if (!isPathEscapeError(error) && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  private async toReport(
    id: string,
    absolutePath: string,
    stat: import('node:fs').Stats,
    snapshot?: ReportIndexFile,
  ): Promise<CodexWebReport> {
    const index = snapshot ?? await this.readIndex();
    const indexed = index.reports[id] ?? {};
    const parts = id.split('/');
    const fallbackTitle = path.basename(id, path.extname(id));
    return {
      id,
      project: normalizeIndexedString(indexed.project) || parts[0] || 'reports',
      title: normalizeIndexedString(indexed.title) || fallbackTitle,
      kind: REPORT_EXTENSIONS.get(path.extname(id).toLowerCase()) ?? 'markdown',
      path: absolutePath,
      sizeBytes: stat.size,
      createdAt: normalizeIndexedString(indexed.createdAt) || stat.birthtime.toISOString(),
      updatedAt: normalizeIndexedString(indexed.updatedAt) || stat.mtime.toISOString(),
      favorite: indexed.favorite === true,
    };
  }

  private async resolveReportPath(reportId: string): Promise<string> {
    const normalized = normalizeReportId(reportId);
    return this.assertInsideReportsRoot(path.join(this.reportsDir, ...normalized.split('/')));
  }

  private async reportIdFromPath(absolutePath: string): Promise<string> {
    const insidePath = await this.assertInsideReportsRoot(absolutePath);
    if (!REPORT_EXTENSIONS.has(path.extname(insidePath).toLowerCase())) {
      throw new Error('Report must be a markdown or html file.');
    }
    return path.relative(this.reportsDir, insidePath).split(path.sep).join('/');
  }

  private async assertInsideReportsRoot(absolutePath: string): Promise<string> {
    const root = await realpathIfExists(this.reportsDir);
    const target = await fs.realpath(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return path.resolve(absolutePath);
      }
      throw error;
    });
    if (!isPathInside(root, target)) {
      throw new Error('Report path is outside the reports directory.');
    }
    return path.resolve(absolutePath);
  }

  private async readIndex(): Promise<ReportIndexFile> {
    return (await this.indexCache.read()).value;
  }
}

function normalizeReportId(value: string): string {
  const normalized = String(value || '').replace(/\\/gu, '/').replace(/^\/+/u, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Invalid report id.');
  }
  return parts.join('/');
}

async function realpathIfExists(directory: string): Promise<string> {
  try {
    return await fs.realpath(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return path.resolve(directory);
    }
    throw error;
  }
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isPathEscapeError(error: unknown): boolean {
  return error instanceof Error && /outside the reports directory/u.test(error.message);
}

function normalizeIndexedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
