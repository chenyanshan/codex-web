import assert from 'node:assert/strict';
import test from 'node:test';
import { paginateAdminSessions } from '../src/admin_session_page.js';
import { InvalidSessionListCursorError } from '../src/session_list_page.js';

test('admin pagination has stable ISO timestamp ordering, bounds, no duplicates and principal/filter-bound cursors', () => {
  const items = Array.from({ length: 105 }, (_, index) => ({ id: `session_${index}`, updatedAt: new Date(1000 * Math.floor(index / 5)).toISOString(), title: `Native ${index}` }));
  const options = { principalId: 'a', scope: 'admin:all', limit: 30 };
  const first = paginateAdminSessions(items, options);
  assert.equal(first.items.length, 30); assert.equal(first.hasMore, true); assert.ok(first.items[0]!.title.startsWith('Native'));
  const all = [...first.items]; let cursor = first.nextCursor;
  while (cursor) { const page = paginateAdminSessions(items, { ...options, cursor }); all.push(...page.items); cursor = page.nextCursor; }
  assert.equal(all.length, 105); assert.equal(new Set(all.map(item => item.id)).size, 105);
  assert.equal(paginateAdminSessions(items, { ...options, limit: 1000 }).items.length, 100);
  for (const overrides of [{ principalId: 'b' }, { scope: 'admin:archived' }]) assert.throws(() => paginateAdminSessions(items, { ...options, ...overrides, cursor: first.nextCursor }), InvalidSessionListCursorError);
  const inserted = [{ id: 'new', updatedAt: new Date(1000000).toISOString(), title: 'new' }, ...items];
  assert.deepEqual(paginateAdminSessions(inserted, { ...options, cursor: first.nextCursor }).items, paginateAdminSessions(items, { ...options, cursor: first.nextCursor }).items);
});
