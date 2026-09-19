import assert from 'node:assert/strict';
import test from 'node:test';
import { paginateSessionTimeline } from '../src/session_timeline_page.js';

test('deep anchors open a bounded continuous window with complete traversal in both directions', () => {
  const items = Array.from({ length: 300 }, (_, index) => ({ id: `item_${index}`, turnId: `turn_${index}`, role: 'assistant', meta: 'final' }));
  const page = (query: string) => paginateSessionTimeline(items, new URL(`http://fixture/timeline?${query}`)) as any;
  const anchored = page('anchor=assistant_turn_90_final&limit=30');
  assert.equal(anchored.anchorFound, true); assert.equal(anchored.items.length, 30); assert.equal(anchored.items[10].id, 'item_90');
  const seen = [...anchored.items]; let before = anchored.nextBefore, after = anchored.nextAfter;
  while (before) { const older = page(`limit=30&before=${before}`); seen.unshift(...older.items); before = older.nextBefore; }
  while (after) { const newer = page(`limit=30&after=${after}`); seen.push(...newer.items); after = newer.nextAfter; }
  assert.deepEqual(seen.map(item => item.id), items.map(item => item.id));
  assert.equal(page('anchor=missing&limit=1000').items.length, 100);
  assert.equal(page('anchor=missing').anchorFound, false);
  assert.equal(page('before=invalid').items.at(-1).id, 'item_299');
});
