import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CodexWebTimelineMessage } from './session_timeline_store.js';

export interface TimelineCheckpoint { generation: string; revision: number }
export interface TimelineIdentity extends TimelineCheckpoint { id: string; position: number; version: number; aliases: string[] }
type Message = CodexWebTimelineMessage;
// live: 0 = provider-confirmed, 1 = not yet observed in native history, 2 = live update to a confirmed item.
interface Row { id: string; position: number; version: number; payload: string; bytes: number; changed: number; live: number }

/** Synchronous SQLite transactions are the serialization point shared by history and live events. */
export class CanonicalTimelineStore {
  private readonly db: DatabaseSync;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  constructor({ path, maxEntriesPerSession = 10_000, maxBytes = 64 * 1024 * 1024 }: { path?: string; maxEntriesPerSession?: number; maxBytes?: number } = {}) {
    if (path) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path ?? ':memory:');
    if (path) chmodSync(path, 0o600);
    this.maxEntries = Math.max(1, Math.floor(maxEntriesPerSession));
    this.maxBytes = Math.max(1024, Math.floor(maxBytes));
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA auto_vacuum=FULL;
      CREATE TABLE IF NOT EXISTS sessions (session TEXT PRIMARY KEY, generation TEXT NOT NULL, revision INTEGER NOT NULL, history_digest TEXT, order_digest TEXT, order_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS messages (session TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, bytes INTEGER NOT NULL, changed INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session,id));
      CREATE INDEX IF NOT EXISTS message_order ON messages(session,position);
      CREATE INDEX IF NOT EXISTS native_identity ON messages(session,json_extract(payload,'$.turnId'),json_extract(payload,'$.itemId'));`);
    const sessionColumns = this.db.prepare('PRAGMA table_info(sessions)').all() as {name:string}[];
    if (!sessionColumns.some(item => item.name === 'history_digest')) this.db.exec('ALTER TABLE sessions ADD COLUMN history_digest TEXT');
    if (!sessionColumns.some(item => item.name === 'order_digest')) this.db.exec('ALTER TABLE sessions ADD COLUMN order_digest TEXT');
    if (!sessionColumns.some(item => item.name === 'order_count')) this.db.exec('ALTER TABLE sessions ADD COLUMN order_count INTEGER NOT NULL DEFAULT 0');
    const columns = this.db.prepare('PRAGMA table_info(messages)').all() as {name:string}[];
    for (const column of ['changed', 'live']) if (!columns.some(item => item.name === column)) this.db.exec(`ALTER TABLE messages ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
  }
  close(): void { this.db.close(); }
  checkpoint(session: string): TimelineCheckpoint {
    this.ensure(session);
    return this.db.prepare('SELECT generation,revision FROM sessions WHERE session=?').get(session) as unknown as TimelineCheckpoint;
  }
  list(session: string): Message[] {
    const checkpoint = this.checkpoint(session);
    return this.rows(session).map(row => this.present(row, checkpoint));
  }
  upsert(session: string, message: Message): Message {
    return this.transaction(() => {
      this.ensure(session);
      const id = this.identity(session, message);
      const row = this.db.prepare('SELECT * FROM messages WHERE session=? AND id=?').get(session, id) as unknown as Row | undefined;
      const last = this.db.prepare('SELECT MAX(position) AS position FROM messages WHERE session=?').get(session) as { position: number | null };
      this.write(session, message, row?.position ?? (last.position ?? 0) + 1, row, true);
      this.trim(session);
      const checkpoint = this.checkpoint(session);
      const saved = this.db.prepare('SELECT * FROM messages WHERE session=? AND id=?').get(session, id) as unknown as Row | undefined;
      return saved ? this.present(saved, checkpoint) : { ...message, id, timeline: { ...checkpoint, id, position: row?.position ?? (last.position ?? 0) + 1, version: row ? row.version + 1 : checkpoint.revision, aliases: aliases(message) } };
    });
  }
  reconcile(session: string, history: Message[], readCheckpoint?: TimelineCheckpoint, settledTurnIds: ReadonlySet<string> = new Set(), activeTurnIds: ReadonlySet<string> = new Set()): { items: Message[]; checkpoint: TimelineCheckpoint } {
    return this.transaction(() => {
      this.ensure(session);
      const previous = this.rows(session);
      const byId = new Map(previous.map(row => [row.id, row]));
      const hasRealUser = history.some(message => message.role === 'user' && message.meta !== 'preview')
        || previous.some(row => { const message = JSON.parse(row.payload) as Message; return row.live !== 0 && message.role === 'user' && message.meta !== 'preview'; });
      if (hasRealUser) history = history.filter(message => message.meta !== 'preview');
      const digest = createHash('sha256').update(JSON.stringify(history.map(withoutTimeline))).digest('base64url');
      const savedDigest = (this.db.prepare('SELECT history_digest FROM sessions WHERE session=?').get(session) as {history_digest:string | null}).history_digest;
      if (savedDigest !== digest) this.db.prepare('UPDATE sessions SET history_digest=?,revision=revision+1 WHERE session=?').run(digest, session);
      const seen = new Set<string>();
      let ordered: Message[] = [];
      const newer = (row: Row) => row.live !== 0 && Boolean(readCheckpoint && row.changed > readCheckpoint.revision);
      const active = (row: Row) => { const message = JSON.parse(row.payload) as Message; return row.live !== 0 && (message.lifecycle !== 'completed' || activeTurnIds.has(message.turnId ?? '')) && !settledTurnIds.has(message.turnId ?? ''); };
      const protectedRow = (row: Row) => newer(row) || active(row);
      const fallbackFinals = new Map(previous.map(row => JSON.parse(row.payload) as Message)
        .filter(message => message.itemId === `assistant_${message.turnId}_final`)
        .map(message => [message.turnId, message.itemId!]));
      const finalCounts = new Map<string | undefined, number>();
      for (const message of history) if (message.role === 'assistant' && message.phase === 'final_answer') finalCounts.set(message.turnId, (finalCounts.get(message.turnId) ?? 0) + 1);
      for (let message of history) {
        const fallback = fallbackFinals.get(message.turnId);
        if (fallback && message.role === 'assistant' && message.phase === 'final_answer' && finalCounts.get(message.turnId) === 1) message = { ...message, canonicalKey: fallback };
        const id = this.identity(session, message);
        if (seen.has(id)) continue;
        seen.add(id);
        const old = byId.get(id);
        const candidate = old && protectedRow(old) ? JSON.parse(old.payload) as Message : message;
        const prior = old ? JSON.parse(old.payload) as Message : undefined;
        ordered.push(prior ? { ...candidate, timelineAliases: [...new Set([...aliases(prior), ...aliases(candidate)])].slice(-16) } : candidate);
      }
      const nativePositions = new Map(ordered.map((message, index) => [this.identity(session, message), index]));
      const turnBounds = new Map<string, {first:number; last:number}>();
      ordered.forEach((message, index) => {
        if (!message.turnId) return;
        const bounds = turnBounds.get(message.turnId);
        turnBounds.set(message.turnId, { first: bounds?.first ?? index, last: index });
      });
      const nextAnchors: Array<number | undefined> = [];
      let nextAnchor: number | undefined;
      for (let index = previous.length - 1; index >= 0; index--) {
        nextAnchors[index] = nextAnchor;
        nextAnchor = nativePositions.get(previous[index]!.id) ?? nextAnchor;
      }
      const insertions = new Map<number, Message[]>();
      let previousAnchor: number | undefined;
      let previousAnchorTurn: string | undefined;
      previous.forEach((row, index) => {
        const nativePosition = nativePositions.get(row.id);
        if (nativePosition !== undefined) { previousAnchor = nativePosition; previousAnchorTurn = ordered[nativePosition]?.turnId; return; }
        if (row.live !== 1 && !protectedRow(row)) return;
        const message = JSON.parse(row.payload) as Message;
        let boundary = nextAnchors[index] ?? (previousAnchor !== undefined ? previousAnchor + 1 : ordered.length);
        if (message.turnId && previousAnchorTurn === message.turnId && previousAnchor !== undefined
          && (nextAnchors[index] === undefined || ordered[nextAnchors[index]!]!.turnId !== message.turnId)) boundary = previousAnchor + 1;
        const bounds = message.turnId ? turnBounds.get(message.turnId) : undefined;
        if (bounds) boundary = Math.max(bounds.first, Math.min(boundary, bounds.last + 1));
        const bucket = insertions.get(boundary) ?? [];
        bucket.push(message); insertions.set(boundary, bucket);
      });
      const withLive = ordered.flatMap((message, index) => [...insertions.get(index) ?? [], message]);
      withLive.push(...insertions.get(ordered.length) ?? []);
      ordered = withLive;
      const orderTokens = ordered.map(message => [this.identity(session, message),
        !message.itemId && !message.clientMessageId && !message.canonicalKey ? createHash('sha256').update(message.text).digest('base64url') : null]);
      const orderHash = (tokens: typeof orderTokens) => createHash('sha256').update(JSON.stringify(tokens)).digest('base64url');
      const previousOrder = this.db.prepare('SELECT order_digest,order_count FROM sessions WHERE session=?').get(session) as {order_digest:string | null; order_count:number};
      const incompatibleOrder = previousOrder.order_digest !== null && (orderTokens.length < previousOrder.order_count
        || orderHash(orderTokens.slice(0, previousOrder.order_count)) !== previousOrder.order_digest);
      this.db.prepare('UPDATE sessions SET order_digest=?,order_count=? WHERE session=?').run(orderHash(orderTokens), orderTokens.length, session);
      const retained = ordered.slice(-this.maxEntries);
      const retainedIds = new Set(retained.map(message => this.identity(session, message)));
      let removed = false;
      for (const row of previous) if (!retainedIds.has(row.id)) {
        this.db.prepare('DELETE FROM messages WHERE session=? AND id=?').run(session, row.id);
        removed = true;
      }
      const reordered = ordered.some((message, index) => {
        const old = byId.get(this.identity(session, message));
        return old && old.position !== index + 1;
      });
      if (reordered || removed || incompatibleOrder) this.reset(session);
      const materialized: Row[] = [];
      ordered.forEach((message, index) => {
        const id = this.identity(session, message), old = byId.get(id);
        const payload = JSON.stringify(withoutTimeline(message));
        const row: Row = { id, position: index + 1, version: old && old.payload === payload && old.position === index + 1 ? old.version : old ? old.version + 1 : this.checkpoint(session).revision + 1,
          payload, bytes: Buffer.byteLength(payload), changed: old?.changed ?? 0, live: old && (protectedRow(old) || !seen.has(id)) ? old.live : 0 };
        materialized.push(row);
        if (retainedIds.has(id)) this.write(session, message, index + 1, old, row.live !== 0);
      });
      this.trim(session);
      const checkpoint = this.checkpoint(session);
      // Persistence is bounded; provider history remains fully traversable by HTTP keyset pages.
      const persisted = new Set(this.rows(session).map(row => row.id));
      return { items: materialized.map(row => this.present(persisted.has(row.id) ? row : { ...row, version: checkpoint.revision }, checkpoint)), checkpoint };
    });
  }

  delete(session: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE session=?').run(session);
      this.db.prepare('DELETE FROM sessions WHERE session=?').run(session);
    });
  }
  find(session: string, id: string): Message | undefined {
    const row = this.db.prepare('SELECT * FROM messages WHERE session=? AND id=?').get(session, id) as unknown as Row | undefined;
    return row ? this.present(row, this.checkpoint(session)) : undefined;
  }
  private identity(session: string, message: Message): string {
    if (!message.canonicalKey && message.role === 'assistant' && message.itemId) {
      const known = this.db.prepare("SELECT id FROM messages WHERE session=? AND json_extract(payload,'$.turnId')=? AND json_extract(payload,'$.itemId')=? LIMIT 1").get(session, message.turnId ?? '', message.itemId) as {id:string} | undefined;
      if (known) return known.id;
    }
    return canonicalId(session, message);
  }
  private rows(session: string): Row[] { return this.db.prepare('SELECT * FROM messages WHERE session=? ORDER BY position').all(session) as unknown as Row[]; }
  private ensure(session: string): void {
    const inserted = this.db.prepare('INSERT OR IGNORE INTO sessions(session,generation,revision) VALUES(?,?,0)').run(session, randomUUID());
    if (!inserted.changes) return;
    const excess = this.db.prepare('SELECT session FROM sessions ORDER BY rowid DESC LIMIT -1 OFFSET 10000').all() as {session:string}[];
    for (const row of excess) {
      this.db.prepare('DELETE FROM messages WHERE session=?').run(row.session);
      this.db.prepare('DELETE FROM sessions WHERE session=?').run(row.session);
    }
  }
  private reset(session: string): void { this.db.prepare('UPDATE sessions SET generation=?,revision=revision+1 WHERE session=?').run(randomUUID(), session); }
  private write(session: string, message: Message, position: number, old?: Row, live = false): void {
    const prior = old ? JSON.parse(old.payload) as Message : undefined;
    const body = prior ? { ...message, timelineAliases: [...new Set([...aliases(prior), ...aliases(message)])].slice(-16) } : message;
    const payload = JSON.stringify(withoutTimeline(body));
    if (Buffer.byteLength(payload) > this.maxBytes) {
      this.db.prepare('DELETE FROM messages WHERE session=? AND id=?').run(session, this.identity(session, message));
      this.reset(session);
      return;
    }
    if (old?.payload === payload && old.position === position) {
      if (!live && old.live) this.db.prepare('UPDATE messages SET live=0 WHERE session=? AND id=?').run(session, old.id);
      return;
    }
    this.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(session,id) DO UPDATE SET position=excluded.position,version=excluded.version,payload=excluded.payload,bytes=excluded.bytes,changed=excluded.changed,live=excluded.live').run(session, this.identity(session, message), position, old ? old.version + 1 : this.checkpoint(session).revision + 1, payload, Buffer.byteLength(payload), this.checkpoint(session).revision + 1, live ? (old?.live === 0 ? 2 : old?.live ?? 1) : 0);
    this.db.prepare('UPDATE sessions SET revision=revision+1 WHERE session=?').run(session);
  }
  private present(row: Row, checkpoint: TimelineCheckpoint): Message {
    const message = JSON.parse(row.payload) as Message;
    return { ...message, id: row.id, timeline: { ...checkpoint, id: row.id, position: row.position, version: row.version, aliases: aliases(message) } };
  }
  private trim(session: string): void {
    const extra = this.db.prepare('SELECT id FROM messages WHERE session=? ORDER BY position DESC LIMIT -1 OFFSET ?').all(session, this.maxEntries) as {id:string}[];
    if (extra.length) {
      for (const row of extra) this.db.prepare('DELETE FROM messages WHERE session=? AND id=?').run(session, row.id);
      this.reset(session);
    }
    let size = Number((this.db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM messages').get() as { bytes: number }).bytes);
    while (size > this.maxBytes) {
      const oldest = this.db.prepare('SELECT rowid,session,bytes FROM messages ORDER BY rowid LIMIT 1').get() as { rowid: number; session: string; bytes: number };
      this.db.prepare('DELETE FROM messages WHERE rowid=?').run(oldest.rowid);
      this.reset(oldest.session);
      size -= oldest.bytes;
    }
    // Checkpoint rows are bounded too; eviction invalidates old generations on next access.
    this.db.prepare('DELETE FROM sessions WHERE session IN (SELECT session FROM sessions WHERE session NOT IN (SELECT session FROM messages) AND session != ? LIMIT MAX(0,(SELECT COUNT(*) FROM sessions)-10000))').run(session);
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
function canonicalId(session: string, message: Message): string {
  return `tl_${createHash('sha256').update(JSON.stringify([session, message.turnId ?? '', message.role, message.canonicalKey ?? (message.role === 'user' ? message.clientMessageId ?? message.itemId : message.itemId) ?? message.id])).digest('base64url')}`;
}
function aliases(message: Message): string[] { return [...new Set([...(message.timelineAliases ?? []), message.id, message.clientMessageId].filter((value): value is string => Boolean(value)))]; }

function withoutTimeline(message: Message): Omit<Message, 'timeline'> { const { timeline: _, ...body } = message; return { ...body, timelineAliases: aliases(message).slice(-16) }; }
