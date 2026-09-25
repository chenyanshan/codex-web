import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';

export interface FileSnapshot<T> { version: string; value: T }

// Filesystems may report identical ns-shaped timestamps for successive writes in
// one clock tick. Revalidate bytes while metadata is recent (also covers coarse
// 1–2 second timestamp precision); cold unchanged files retain the stat-only path.
const RECENT_WRITE_WINDOW_NS = 2_000_000_000n;

/** Every read checks metadata; recent writes additionally verify content identity. */
export class FileVersionCache<T> {
  private cached: FileSnapshot<T> | null = null;
  private cachedMetadata: string | null = null;
  constructor(private readonly filePath: string, private readonly parse: (raw: string) => T, private readonly missing: () => T) {}
  invalidate() { this.cached = null; this.cachedMetadata = null; }

  async read(): Promise<FileSnapshot<T>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let version: string;
      let stat: BigIntStats;
      try { stat = await fs.stat(this.filePath, { bigint: true }); version = fileVersion(stat); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        this.cachedMetadata = null;
        this.cached = { version: 'missing', value: freezeDeep(this.missing()) };
        return this.cached;
      }
      const latestWrite = stat.mtimeNs > stat.ctimeNs ? stat.mtimeNs : stat.ctimeNs;
      const recentWrite = BigInt(Date.now()) * 1_000_000n - latestWrite <= RECENT_WRITE_WINDOW_NS;
      if (this.cached && this.cachedMetadata === version && !recentWrite) return this.cached;
      const handle = await fs.open(this.filePath, 'r').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!handle) continue;
      try {
        if (fileVersion(await handle.stat({ bigint: true })) !== version) continue;
        const raw = await handle.readFile('utf8');
        if (fileVersion(await handle.stat({ bigint: true })) !== version) continue;
        const current = await fs.stat(this.filePath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (!current || fileVersion(current) !== version) continue;
        const contentVersion = `${version}:${createHash('sha256').update(raw).digest('hex')}`;
        if (this.cached?.version === contentVersion) return this.cached;
        this.cached = { version: contentVersion, value: freezeDeep(this.parse(raw)) };
        this.cachedMetadata = version;
        return this.cached;
      } finally { await handle.close(); }
    }
    throw new Error('State file changed during read. Retry the request.');
  }
}

function fileVersion(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
