const DEFAULT_SESSION_LIST_PAGE_SIZE = 30;
const MAX_SESSION_LIST_PAGE_SIZE = 100;
const SESSION_LIST_CURSOR_VERSION = 2;

interface SessionListCursor {
  version: number;
  scope: string;
  principalId: string;
  listOrderAt: number;
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

const immutableLists = new WeakSet<object[]>();
const sortedLists = new WeakMap<object[], object[]>();

/** Opt-in cache contract: freeze both sort keys and membership before indexing. */
export function cacheSessionListSnapshot<T extends object>(items: T[]): T[] {
  for (const item of items) Object.freeze(item);
  Object.freeze(items);
  immutableLists.add(items);
  return items;
}

export function paginateSessionList<T extends object>(
  input: T[],
  options: SessionListPageOptions,
): SessionListPage<T> {
  const limit = normalizeSessionListLimit(options.limit);
  let items = sortedLists.get(input) as T[] | undefined;
  if (!items) {
    const uniqueItems = new Map<string, T>();
    for (const item of input) {
      const id = sessionListItemId(item as Record<string, unknown>);
      if (id && !uniqueItems.has(id)) uniqueItems.set(id, item);
    }
    items = [...uniqueItems.values()].sort((a, b) => compareSessionListItems(a as Record<string, unknown>, b as Record<string, unknown>));
    if (immutableLists.has(input)) sortedLists.set(input, items);
  }
  const cursor = decodeSessionListCursor(options.cursor, options);
  let start = 0;
  if (cursor) {
    let end = items.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (isSessionListItemAfterCursor(items[middle] as Record<string, unknown>, cursor)) end = middle;
      else start = middle + 1;
    }
  }
  const pageItems = items.slice(start, start + limit);
  const nextCursor = items.length > start + limit && pageItems.length
    ? encodeSessionListCursor(pageItems[pageItems.length - 1]! as Record<string, unknown>, options)
    : null;
  return { items: pageItems, nextCursor };
}

export function compareSessionListItems(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const leftKey = sessionListSortKey(left);
  const rightKey = sessionListSortKey(right);
  return rightKey.listOrderAt - leftKey.listOrderAt
    || leftKey.id.localeCompare(rightKey.id);
}

function normalizeSessionListLimit(value: string | number | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SESSION_LIST_PAGE_SIZE;
  }
  return Math.min(MAX_SESSION_LIST_PAGE_SIZE, Math.floor(parsed));
}

function sessionListSortKey(item: Record<string, unknown>): Pick<SessionListCursor, 'listOrderAt' | 'id'> {
  return {
    listOrderAt: normalizeTimestamp(item.listOrderAt),
    id: sessionListItemId(item),
  };
}

function sessionListItemId(item: Record<string, unknown>): string {
  return typeof item.id === 'string' ? item.id : '';
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
      || typeof parsed.listOrderAt !== 'number'
      || !Number.isFinite(parsed.listOrderAt)
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
  if (key.listOrderAt !== cursor.listOrderAt) {
    return key.listOrderAt < cursor.listOrderAt;
  }
  return key.id.localeCompare(cursor.id) > 0;
}
