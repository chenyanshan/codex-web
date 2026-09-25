import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InvalidSessionListCursorError,
  paginateSessionList,
} from '../src/session_list_page.js';

test('session list pagination sorts before applying the page limit', () => {
  const input = Array.from({ length: 35 }, (_, index) => ({
    id: `session_${String(index).padStart(2, '0')}`,
    listOrderAt: index,
  }));

  const first = paginateSessionList(input, {
    scope: 'active:all',
    principalId: 'user_alice',
  });
  const second = paginateSessionList(input, {
    scope: 'active:all',
    principalId: 'user_alice',
    cursor: first.nextCursor,
  });

  assert.equal(first.items.length, 30);
  assert.equal(first.items[0]?.id, 'session_34');
  assert.equal(first.items[29]?.id, 'session_05');
  assert.equal(second.items.length, 5);
  assert.equal(second.items[0]?.id, 'session_04');
  assert.equal(second.nextCursor, null);
});

test('session list order follows explicit input, independent of output and attention states', () => {
  const page = paginateSessionList([
    { id: 'new_idle', listOrderAt: 30, updatedAt: 30 },
    { id: 'old_running', listOrderAt: 10, updatedAt: 100, activityState: 'running' },
    { id: 'old_waiting', listOrderAt: 5, updatedAt: 200, activityState: 'waiting_approval' },
  ], {
    scope: 'active:all',
    principalId: 'user_alice',
  });

  assert.deepEqual(page.items.map((item) => item.id), ['new_idle', 'old_running', 'old_waiting']);
  assert.equal(page.items[2]?.activityState, 'waiting_approval');
});

test('session list cursors cannot be reused for another user or filter', () => {
  const first = paginateSessionList([
    { id: 'session_2', listOrderAt: 2 },
    { id: 'session_1', listOrderAt: 1 },
  ], {
    scope: 'active:project_a',
    principalId: 'user_alice',
    limit: 1,
  });

  assert.throws(() => paginateSessionList([], {
    scope: 'active:project_b',
    principalId: 'user_alice',
    cursor: first.nextCursor,
  }), InvalidSessionListCursorError);
  assert.throws(() => paginateSessionList([], {
    scope: 'active:project_a',
    principalId: 'user_bob',
    cursor: first.nextCursor,
  }), InvalidSessionListCursorError);
});

test('mutable callers cannot reuse a stale sorted cursor index', () => {
  const items = [{ id: 'old', listOrderAt: 1 }, { id: 'new', listOrderAt: 2 }];
  const options = { scope: 'all', principalId: 'user', limit: 1 };
  assert.equal(paginateSessionList(items, options).items[0]?.id, 'new');
  items[0]!.listOrderAt = 3;
  assert.equal(paginateSessionList(items, options).items[0]?.id, 'old');
  items.push({ id: 'newest', listOrderAt: 4 });
  assert.equal(paginateSessionList(items, options).items[0]?.id, 'newest');
});

test('output and terminal state changes between pages cannot omit or duplicate sessions', () => {
  const items = Array.from({ length: 45 }, (_, index) => ({
    id: `session_${String(index).padStart(2, '0')}`,
    listOrderAt: index,
    updatedAt: index,
    lastInputAt: index,
    activityState: 'running',
    activeTurnId: `turn_${index}`,
  }));
  const options = { scope: 'active:favorites', principalId: 'user_alice', limit: 30 };
  const first = paginateSessionList(items, options);
  for (const [index, item] of items.entries()) {
    item.updatedAt = 10_000 - index;
    item.lastInputAt = item.updatedAt;
    item.activityState = index % 2 ? 'waiting_approval' : 'failed';
    item.activeTurnId = '';
  }
  const second = paginateSessionList(items, { ...options, cursor: first.nextCursor });
  const ids = [...first.items, ...second.items].map(item => item.id);
  assert.deepEqual(ids, [...items].reverse().map(item => item.id));
  assert.equal(new Set(ids).size, items.length);
  assert.equal(second.nextCursor, null);
});

test('equal and unavailable order markers have deterministic ties without an output timestamp fallback', () => {
  const input = [
    { id: 'b', listOrderAt: 2, updatedAt: 500 },
    { id: 'a', listOrderAt: 2, updatedAt: 1 },
    { id: 'd', updatedAt: 999 },
    { id: 'c', listOrderAt: Number.NaN, updatedAt: 9999 },
  ];
  const options = { scope: 'archived', principalId: 'user', limit: 1 };
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const page = paginateSessionList(input, { ...options, cursor });
    ids.push(...page.items.map(item => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
});

test('obsolete activity-order cursors are rejected rather than interpreted with different ordering', () => {
  const options = { scope: 'active:all', principalId: 'user_alice' };
  const cursor = Buffer.from(JSON.stringify({
    ...options, version: 1, priority: 2, updatedAt: 50, id: 'session_old',
  })).toString('base64url');
  assert.throws(() => paginateSessionList([], { ...options, cursor }), InvalidSessionListCursorError);
});
