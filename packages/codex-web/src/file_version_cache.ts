import fs from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';

export interface FileSnapshot<T> { version: string; value: T }

/** No TTL: every read checks the path's inode, size and nanosecond modification metadata. */
export class FileVersionCache<T> {
  private cached: FileSnapshot<T> | null = null;
  constructor(private readonly filePath: string, private readonly parse: (raw: string) => T, private readonly missing: () => T) {}
  invalidate() { this.cached = null; }

  async read(): Promise<FileSnapshot<T>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let version: string;
      try { version = fileVersion(await fs.stat(this.filePath, { bigint: true })); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        this.cached = { version: 'missing', value: freezeDeep(this.missing()) };
        return this.cached;
      }
      if (this.cached?.version === version) return this.cached;
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
        this.cached = { version, value: freezeDeep(this.parse(raw)) };
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
