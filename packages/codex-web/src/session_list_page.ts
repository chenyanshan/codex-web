const DEFAULT_SESSION_LIST_PAGE_SIZE = 30;
const MAX_SESSION_LIST_PAGE_SIZE = 100;
const SESSION_LIST_CURSOR_VERSION = 1;

interface SessionListCursor {
  version: number;
  scope: string;
  principalId: string;
  priority: number;
  updatedAt: number;
  id: string;
}

export interface SessionListPageOptions {
  cursor?: string | null;
  limit?: string | number | null;
  scope: string;
  principalId: string;
}

export interface SessionListPage<T> {
  items: T[];
  nextCursor: string | null;
}

export class InvalidSessionListCursorError extends Error {
  readonly code = 'invalid_cursor';

  constructor() {
    super('The session list cursor is invalid or belongs to another list.');
  }
}

export function paginateSessionList<T extends Record<string, unknown>>(
  input: T[],
  options: SessionListPageOptions,
): SessionListPage<T> {
  const limit = normalizeSessionListLimit(options.limit);
  const uniqueItems = new Map<string, T>();
  for (const item of input) {
    const id = sessionListItemId(item);
    if (id && !uniqueItems.has(id)) {
      uniqueItems.set(id, item);
    }
  }
  const items = [...uniqueItems.values()].sort(compareSessionListItems);
  const cursor = decodeSessionListCursor(options.cursor, options);
  const remaining = cursor
    ? items.filter((item) => isSessionListItemAfterCursor(item, cursor))
    : items;
  const pageItems = remaining.slice(0, limit);
  const nextCursor = remaining.length > limit && pageItems.length
    ? encodeSessionListCursor(pageItems[pageItems.length - 1]!, options)
    : null;
  return { items: pageItems, nextCursor };
}

export function compareSessionListItems(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const leftKey = sessionListSortKey(left);
  const rightKey = sessionListSortKey(right);
  return rightKey.priority - leftKey.priority
    || rightKey.updatedAt - leftKey.updatedAt
    || leftKey.id.localeCompare(rightKey.id);
}

function normalizeSessionListLimit(value: string | number | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SESSION_LIST_PAGE_SIZE;
  }
  return Math.min(MAX_SESSION_LIST_PAGE_SIZE, Math.floor(parsed));
}

function sessionListSortKey(item: Record<string, unknown>): Pick<SessionListCursor, 'priority' | 'updatedAt' | 'id'> {
  return {
    priority: sessionListActivityPriority(item),
    updatedAt: Math.max(normalizeTimestamp(item.updatedAt), normalizeTimestamp(item.lastInputAt)),
    id: sessionListItemId(item),
  };
}

function sessionListItemId(item: Record<string, unknown>): string {
  return typeof item.id === 'string' ? item.id : '';
}

function sessionListActivityPriority(item: Record<string, unknown>): number {
  if (item.activityState === 'waiting_approval') {
    return 2;
  }
  if (item.activityState === 'running' || (typeof item.activeTurnId === 'string' && item.activeTurnId)) {
    return 1;
  }
  return 0;
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function encodeSessionListCursor(
  item: Record<string, unknown>,
  options: Pick<SessionListPageOptions, 'scope' | 'principalId'>,
): string {
  const key = sessionListSortKey(item);
  const cursor: SessionListCursor = {
    version: SESSION_LIST_CURSOR_VERSION,
    scope: options.scope,
    principalId: options.principalId,
    ...key,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeSessionListCursor(
  value: string | null | undefined,
  options: Pick<SessionListPageOptions, 'scope' | 'principalId'>,
): SessionListCursor | null {
  if (!value) {
    return null;
  }
  if (value.length > 2_048) {
    throw new InvalidSessionListCursorError();
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SessionListCursor>;
    if (
      parsed.version !== SESSION_LIST_CURSOR_VERSION
      || parsed.scope !== options.scope
      || parsed.principalId !== options.principalId
      || typeof parsed.priority !== 'number'
      || !Number.isFinite(parsed.priority)
      || typeof parsed.updatedAt !== 'number'
      || !Number.isFinite(parsed.updatedAt)
      || typeof parsed.id !== 'string'
      || !parsed.id
    ) {
      throw new InvalidSessionListCursorError();
    }
    return parsed as SessionListCursor;
  } catch (error) {
    if (error instanceof InvalidSessionListCursorError) {
      throw error;
    }
    throw new InvalidSessionListCursorError();
  }
}

function isSessionListItemAfterCursor(item: Record<string, unknown>, cursor: SessionListCursor): boolean {
  const key = sessionListSortKey(item);
  if (key.priority !== cursor.priority) {
    return key.priority < cursor.priority;
  }
  if (key.updatedAt !== cursor.updatedAt) {
    return key.updatedAt < cursor.updatedAt;
  }
  return key.id > cursor.id;
}
