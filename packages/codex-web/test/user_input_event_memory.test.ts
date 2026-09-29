import test from 'node:test';
import assert from 'node:assert/strict';
import { fitEventForRetention, retainedEventSize } from '../src/event_memory.js';
import { CodexWebEventBus } from '../src/event_bus.js';
import type { CodexWebEvent } from '../src/event_model.js';
const oversized = { id: 'id', type: 'user_input.updated', turnId: 'turn', threadId: 'thread', request: {
  requestId: 'epoch:1', connectionEpoch: 1, threadId: 'thread', turnId: 'turn', itemId: 'item', isBlocking: true,
  autoResolutionMs: null, status: 'pending', questions: [{ id: 'q', question: '中'.repeat(20000), header: 'Question', isOther: false, isSecret: false, options: null }],
} } satisfies CodexWebEvent;
test('oversized questions become recovery signals, never truncated answerable requests', () => {
  const event = fitEventForRetention(oversized, 1024);
  assert.equal(event.type, 'turn.observation_interrupted');
  assert.deepEqual(event.raw, { snapshotRequired: true });
  assert.ok(retainedEventSize(event) <= 1024);
});
test('oversized activity fits the same bounded snapshot recovery path', () => {
  const event = fitEventForRetention({ ...oversized, type: 'turn.activity', request: undefined, activity: { data: 'x'.repeat(100000) } } as unknown as CodexWebEvent, 1024);
  assert.equal(event.type, 'turn.observation_interrupted'); assert.ok(retainedEventSize(event) <= 1024);
});
test('replay marks an oversized question projection incomplete for snapshot calibration', () => {
  const bus = new CodexWebEventBus({ maxEventBytes: 1024 });
  bus.append('turn', { id: 'start', type: 'turn.started', turnId: 'turn', threadId: 'thread' });
  bus.append('turn', oversized);
  assert.equal(bus.replay('turn').snapshotComplete, false);
});
