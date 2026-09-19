import { paginateSessionList, type SessionListPageOptions } from './session_list_page.js';

/** Admin records keep ISO dates on the wire; use the shared keyset cursor for ordering. */
export function paginateAdminSessions<T extends { id: string; updatedAt?: unknown; createdAt?: unknown }>(items: T[], options: SessionListPageOptions) {
  const keyed = items.map(item => ({
    id: item.id,
    updatedAt: timestamp(item.updatedAt) || timestamp(item.createdAt),
    item,
  }));
  const page = paginateSessionList(keyed, options);
  return { items: page.items.map(entry => entry.item), nextCursor: page.nextCursor, hasMore: page.nextCursor !== null };
}

function timestamp(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
