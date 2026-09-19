import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './file_lock.js';

interface Entry { file: string; bytes: number }
interface Manifest { version: 2; sessions: Record<string, Entry> }

/** Copy-on-write session shards. The atomic manifest is the transaction commit point. */
export class SessionPartitionStore<T> {
  private ready: Promise<void> | null = null;
  private cachedManifest: { identity: string; value: Manifest } | null = null;
  private readonly cache = new Map<string, T>();
  private readonly root: string;
  private cacheBytes = 0;
  private readonly cacheSizes = new Map<string, number>();

  private cacheValue(file: string, value: T, bytes: number): void {
    this.dropCached(file);
    if (bytes > 16 * 1024 * 1024) return;
    this.cache.set(file, structuredClone(value));
    this.cacheSizes.set(file, bytes);
    this.cacheBytes += bytes;
    while (this.cache.size > 64 || this.cacheBytes > 16 * 1024 * 1024) this.dropCached(this.cache.keys().next().value!);
  }

  private dropCached(file: string): void {
    this.cacheBytes -= this.cacheSizes.get(file) ?? 0;
    this.cacheSizes.delete(file);
    this.cache.delete(file);
  }
  constructor(
    private readonly legacyPath: string,
    private readonly normalize: (value: unknown, id: string) => T,
    private readonly maxBytes = Number.MAX_SAFE_INTEGER,
    private readonly compact?: (value: T, budget: number) => T,
  ) { this.root = `${legacyPath}.d`; }

  async revision(id?: string): Promise<string> {
    await this.initialize();
    const manifest = await this.manifest();
    return id ? manifest.sessions[id]?.file ?? 'absent' : this.cachedManifest!.identity;
  }

  async get(id: string): Promise<T | null> {
    await this.initialize();
    const entry = (await this.manifest()).sessions[id];
    if (!entry) return null;
    try { return await this.readEntry(entry, id); } catch (error) {
      // A reader can hold a previous manifest during atomic commit and bounded shard retirement.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.cachedManifest = null;
      const current = (await this.manifest()).sessions[id];
      return current ? this.readEntry(current, id) : null;
    }
  }

  async list(): Promise<Array<[string, T]>> {
    await this.initialize();
    const manifest = await this.manifest();
    const entries: Array<[string, T]> = [];
    for (const [id, entry] of Object.entries(manifest.sessions)) {
      try { entries.push([id, await this.readEntry(entry, id)]); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const current = await this.get(id);
        if (current !== null) entries.push([id, current]);
      }
    }
    return entries;
  }

  async mutate(id: string, update: (current: T | null) => T | null): Promise<void> {
    await this.initialize();
    await withFileLock(`${this.legacyPath}.lock`, async () => {
      const manifest = structuredClone(await this.manifest());
      const old = manifest.sessions[id];
      let value = update(old ? await this.readEntry(old, id) : null);
      const retired: string[] = [];
      if (old) retired.push(old.file);
      delete manifest.sessions[id];
      if (value !== null) {
        value = this.normalize(value, id);
        if (this.compact) value = this.compact(value, this.maxBytes);
        const body = JSON.stringify(value);
        const bytes = Buffer.byteLength(body);
        // Evict the largest other partitions when the total budget is exhausted. No repeated full serialization.
        let total = Object.values(manifest.sessions).reduce((sum, entry) => sum + entry.bytes, 0);
        for (const [otherId, entry] of Object.entries(manifest.sessions).sort((a, b) => b[1].bytes - a[1].bytes)) {
          if (total + bytes <= this.maxBytes) break;
          total -= entry.bytes;
          retired.push(entry.file);
          delete manifest.sessions[otherId];
        }
        if (bytes > this.maxBytes) throw new Error('Session partition exceeds storage quota');
        const file = `${crypto.createHash('sha256').update(id).digest('hex')}-${crypto.randomUUID()}.json`;
        await fs.writeFile(path.join(this.root, file), body, { mode: 0o600, flag: 'wx' });
        manifest.sessions[id] = { file, bytes };
        this.cacheValue(file, value, bytes);
      }
      await this.commit(manifest);
      // Keep the preceding manifest and its shards for recovery. Older orphans are removed off the request path.
      this.scheduleCleanup();
      for (const file of retired) this.dropCached(file);
    });
  }

  private initialize(): Promise<void> {
    if (!this.ready) this.ready = withFileLock(`${this.legacyPath}.lock`, async () => {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      try { await this.manifest(); return; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      // Never remigrate when a committed manifest was damaged or removed: recovery is explicit.
      if (await fs.stat(path.join(this.root, 'migrated')).then(() => true, () => false)) {
        throw new Error(`Session partition manifest missing: ${this.root}; restore manifest.backup.json`);
      }
      const manifest: Manifest = { version: 2, sessions: {} };
      let raw: string | null = null;
      try { raw = await fs.readFile(this.legacyPath, 'utf8'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (raw !== null) {
        const parsed = JSON.parse(raw) as { version?: number; sessions?: Record<string, unknown> };
        if (parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== 'object') throw new Error(`Invalid session state: ${this.legacyPath}`);
        // Validate all records before creating a migration commit.
        const entries = Object.entries(parsed.sessions).map(([id, value]) => [id, this.normalize(value, id)] as const);
        await fs.copyFile(this.legacyPath, `${this.legacyPath}.migration-backup`, fs.constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        });
        for (const [id, value] of entries) {
          const file = `${crypto.createHash('sha256').update(id).digest('hex')}-${crypto.randomUUID()}.json`;
          const body = JSON.stringify(value);
          await fs.writeFile(path.join(this.root, file), body, { mode: 0o600, flag: 'wx' });
          manifest.sessions[id] = { file, bytes: Buffer.byteLength(body) };
        }
      }
      await this.commit(manifest);
      await fs.writeFile(path.join(this.root, 'migrated'), '2\n', { mode: 0o600 });
    }).catch((error) => { this.ready = null; throw error; });
    return this.ready;
  }

  private async manifest(): Promise<Manifest> {
    const file = path.join(this.root, 'manifest.json');
    const stat = await fs.stat(file, { bigint: true });
    const identity = `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
    if (this.cachedManifest?.identity === identity) return this.cachedManifest.value;
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as Manifest;
    if (value.version !== 2 || !value.sessions || typeof value.sessions !== 'object') throw new Error(`Invalid session partition manifest: ${file}`);
    for (const entry of Object.values(value.sessions)) {
      if (!entry || !/^[a-f0-9]{64}-[a-f0-9-]{36}\.json$/u.test(entry.file) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error(`Invalid session partition entry: ${file}`);
    }
    this.cachedManifest = { identity, value };
    return value;
  }

  private async readEntry(entry: Entry, id: string): Promise<T> {
    const cached = this.cache.get(entry.file);
    if (cached !== undefined) return structuredClone(cached);
    const value = this.normalize(JSON.parse(await fs.readFile(path.join(this.root, entry.file), 'utf8')), id);
    this.cacheValue(entry.file, value, entry.bytes);
    return structuredClone(value);
  }

  private async commit(manifest: Manifest): Promise<void> {
    const target = path.join(this.root, 'manifest.json');
    const oldBackup = await fs.readFile(path.join(this.root, 'manifest.backup.json'), 'utf8').then((raw) => JSON.parse(raw) as Manifest, (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    const previous = await fs.readFile(target, 'utf8').then((raw) => JSON.parse(raw) as Manifest, (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
    await fs.copyFile(target, path.join(this.root, 'manifest.backup.json')).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await fs.rename(temp, target);
    this.cachedManifest = null;
    // Retain at most current + preceding committed shards, rather than 30 seconds of every version.
    const retained = new Set([...Object.values(manifest.sessions), ...Object.values(previous?.sessions ?? {})].map((entry) => entry.file));
    for (const entry of Object.values(oldBackup?.sessions ?? {})) {
      if (!retained.has(entry.file)) await fs.unlink(path.join(this.root, entry.file)).catch((error: NodeJS.ErrnoException) => {
        // The manifest is already committed. A failed retirement must not turn a successful
        // mutation into an apparent failure; the orphan sweep can safely retry later.
        if (error.code !== 'ENOENT') this.scheduleCleanup();
      });
    }
  }

  private cleanupScheduled = false;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupPending: Promise<void> | null = null;
  private disposed = false;
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = null;
    await this.cleanupPending;
  }
  private scheduleCleanup(): void {
    if (this.disposed || this.cleanupScheduled) return;
    this.cleanupScheduled = true;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      this.cleanupPending = fs.stat(this.root).then(() => withFileLock(`${this.legacyPath}.lock`, async () => {
        const current = await this.manifest();
        const backup = JSON.parse(await fs.readFile(path.join(this.root, 'manifest.backup.json'), 'utf8')) as Manifest;
        const retained = new Set([...Object.values(current.sessions), ...Object.values(backup.sessions)].map((entry) => entry.file));
        for (const file of await fs.readdir(this.root)) {
          if (/^[a-f0-9]{64}-[a-f0-9-]{36}\.json$/u.test(file) && !retained.has(file)) await fs.unlink(path.join(this.root, file));
        }
      })).catch(() => {}).finally(() => { this.cleanupScheduled = false; this.cleanupPending = null; });
    }, 30_000);
    this.cleanupTimer.unref();
  }
}
