import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InvalidSessionListCursorError,
  paginateSessionList,
} from '../src/session_list_page.js';

test('session list pagination sorts before applying the page limit', () => {
  const input = Array.from({ length: 35 }, (_, index) => ({
    id: `session_${String(index).padStart(2, '0')}`,
    updatedAt: index,
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

test('session list pagination keeps attention states ahead of recency', () => {
  const page = paginateSessionList([
    { id: 'new_idle', updatedAt: 30 },
    { id: 'old_running', updatedAt: 10, activityState: 'running' },
    { id: 'old_waiting', updatedAt: 5, activityState: 'waiting_approval' },
  ], {
    scope: 'active:all',
    principalId: 'user_alice',
  });

  assert.deepEqual(page.items.map((item) => item.id), ['old_waiting', 'old_running', 'new_idle']);
});

test('session list cursors cannot be reused for another user or filter', () => {
  const first = paginateSessionList([
    { id: 'session_2', updatedAt: 2 },
    { id: 'session_1', updatedAt: 1 },
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
