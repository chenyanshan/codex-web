import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexWebEventBus } from '../src/event_bus.js';

test('event bus appends, replays after sequence, and notifies subscribers', () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 10 });
  const seen: number[] = [];
  const unsubscribe = bus.subscribe('turn_1', (entry) => {
    seen.push(entry.sequence);
  });

  const first = bus.append('turn_1', {
    id: 'evt_1',
    type: 'turn.started',
    turnId: 'turn_1',
    threadId: 'thread_1',
  });
  const second = bus.append('turn_1', {
    id: 'evt_2',
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_1',
    text: 'hi',
    phase: null,
  });

  assert.deepEqual(seen, [first.sequence, second.sequence]);
  assert.equal(bus.list('turn_1').length, 2);
  assert.deepEqual(bus.list('turn_1', first.sequence).map((entry) => entry.event.id), ['evt_2']);

  unsubscribe();
  bus.append('turn_1', {
    id: 'evt_3',
    type: 'assistant.final',
    turnId: 'turn_1',
    threadId: 'thread_1',
    text: 'done',
  });
  assert.deepEqual(seen, [first.sequence, second.sequence]);
});

test('event bus keeps bounded history per turn', () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 2 });
  bus.append('turn_1', { id: 'evt_1', type: 'turn.started', turnId: 'turn_1', threadId: 'thread_1' });
  bus.append('turn_1', { id: 'evt_2', type: 'assistant.delta', turnId: 'turn_1', threadId: 'thread_1', text: 'a', phase: null });
  bus.append('turn_1', { id: 'evt_3', type: 'assistant.final', turnId: 'turn_1', threadId: 'thread_1', text: 'b' });

  assert.deepEqual(bus.list('turn_1').map((entry) => entry.event.id), ['evt_2', 'evt_3']);
});

test('event bus keeps bounded turn histories globally', () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 5, maxTurns: 2 });
  bus.append('turn_1', { id: 'evt_1', type: 'turn.started', turnId: 'turn_1', threadId: 'thread_1' });
  bus.append('turn_2', { id: 'evt_2', type: 'turn.started', turnId: 'turn_2', threadId: 'thread_1' });
  bus.append('turn_3', { id: 'evt_3', type: 'turn.started', turnId: 'turn_3', threadId: 'thread_1' });

  assert.deepEqual(bus.list('turn_1'), []);
  assert.deepEqual(bus.list('turn_2').map((entry) => entry.event.id), ['evt_2']);
  assert.deepEqual(bus.list('turn_3').map((entry) => entry.event.id), ['evt_3']);
});

test('event bus resets expired cursors and retains a compact full-turn snapshot', () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 2, epoch: 'epoch_current' });
  bus.append('turn_1', {
    id: 'evt_started',
    type: 'turn.started',
    turnId: 'turn_1',
    threadId: 'thread_1',
  });
  bus.append('turn_1', {
    id: 'evt_commentary_1',
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_1',
    itemId: 'item_commentary',
    eventType: 'delta',
    text: 'Checking',
    delta: 'Checking',
    phase: 'commentary',
  });
  bus.append('turn_1', {
    id: 'evt_commentary_2',
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_1',
    itemId: 'item_commentary',
    eventType: 'completed',
    text: 'Checking complete',
    delta: ' complete',
    phase: 'commentary',
  });

  const replay = bus.replay('turn_1', 0, 'epoch_current');
  assert.equal(replay.reset, true);
  assert.equal(replay.resetReason, 'cursor_expired');
  assert.equal(replay.retainedFloor, 1);
  assert.equal(replay.snapshotComplete, true);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(bus.snapshot('turn_1').map((entry) => entry.event.id), [
    'evt_started',
    'evt_commentary_2',
  ]);
});

test('event bus rejects another process epoch while preserving valid same-epoch cursors', () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 3, epoch: 'epoch_current' });
  const first = bus.append('turn_1', {
    id: 'evt_1',
    type: 'turn.started',
    turnId: 'turn_1',
    threadId: 'thread_1',
  });
  bus.append('turn_1', {
    id: 'evt_2',
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_1',
    text: 'Hello',
    phase: 'commentary',
  });

  const valid = bus.replay('turn_1', first.sequence, 'epoch_current');
  assert.equal(valid.reset, false);
  assert.equal(valid.snapshotComplete, true);
  assert.deepEqual(valid.events.map((entry) => entry.event.id), ['evt_2']);

  const restarted = bus.replay('turn_1', first.sequence, 'epoch_previous');
  assert.equal(restarted.reset, true);
  assert.equal(restarted.resetReason, 'epoch_mismatch');
  assert.equal(restarted.snapshotComplete, false);
  assert.deepEqual(restarted.events, []);
});

test('event bus never marks recovered or mid-turn projections as complete snapshots', () => {
  const recovered = new CodexWebEventBus({ maxEventsPerTurn: 1, epoch: 'epoch_recovered' });
  recovered.append('turn_recovered', {
    id: 'evt_recovered_started',
    type: 'turn.started',
    turnId: 'turn_recovered',
    threadId: 'thread_1',
    raw: { recovered: true },
  });
  recovered.append('turn_recovered', {
    id: 'evt_recovered_delta',
    type: 'assistant.delta',
    turnId: 'turn_recovered',
    threadId: 'thread_1',
    itemId: 'item_recovered',
    eventType: 'delta',
    text: 'Resumed here',
    delta: 'Resumed here',
    phase: 'commentary',
  });
  const recoveredReplay = recovered.replay('turn_recovered', 0, 'epoch_recovered');
  assert.equal(recoveredReplay.resetReason, 'cursor_expired');
  assert.equal(recoveredReplay.snapshotComplete, false);

  const midTurn = new CodexWebEventBus({ maxEventsPerTurn: 1, epoch: 'epoch_mid_turn' });
  midTurn.append('turn_mid', {
    id: 'evt_mid_delta_1',
    type: 'assistant.delta',
    turnId: 'turn_mid',
    threadId: 'thread_1',
    text: 'Tail one',
    phase: 'commentary',
  });
  midTurn.append('turn_mid', {
    id: 'evt_mid_delta_2',
    type: 'assistant.delta',
    turnId: 'turn_mid',
    threadId: 'thread_1',
    text: 'Tail two',
    phase: 'commentary',
  });
  assert.equal(midTurn.replay('turn_mid', 0, 'epoch_mid_turn').snapshotComplete, false);
});

test('event bus snapshot restores cumulative assistant state after thousands of deltas', () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 5, epoch: 'epoch_large_turn' });
  bus.append('turn_large', {
    id: 'evt_started',
    type: 'turn.started',
    turnId: 'turn_large',
    threadId: 'thread_1',
  });
  for (let index = 1; index <= 2_000; index += 1) {
    bus.append('turn_large', {
      id: `evt_delta_${index}`,
      type: 'assistant.delta',
      turnId: 'turn_large',
      threadId: 'thread_1',
      itemId: 'item_long_answer',
      eventType: index === 2_000 ? 'completed' : 'delta',
      text: 'x'.repeat(index),
      delta: 'x',
      phase: 'final_answer',
    });
  }

  const replay = bus.replay('turn_large', 1, 'epoch_large_turn');
  assert.equal(replay.reset, true);
  assert.equal(replay.snapshotComplete, true);
  assert.equal(replay.events.length, 0);
  const snapshot = bus.snapshot('turn_large');
  assert.equal(snapshot.length, 2);
  const answer = snapshot.find((entry) => entry.event.type === 'assistant.delta')?.event;
  assert.equal(answer?.type, 'assistant.delta');
  assert.equal(answer?.text.length, 2_000);
  assert.equal(answer?.eventType, 'completed');
});

test('event bus uses a compact snapshot for a fresh subscription without a cursor', () => {
  const bus = new CodexWebEventBus({ epoch: 'epoch_fresh' });
  bus.append('turn_fresh', {
    id: 'evt_started',
    type: 'turn.started',
    turnId: 'turn_fresh',
    threadId: 'thread_1',
  });
  bus.append('turn_fresh', {
    id: 'evt_delta_1',
    type: 'assistant.delta',
    turnId: 'turn_fresh',
    threadId: 'thread_1',
    itemId: 'item_answer',
    eventType: 'delta',
    text: 'Hello',
    delta: 'Hello',
    phase: 'final_answer',
  });
  bus.append('turn_fresh', {
    id: 'evt_delta_2',
    type: 'assistant.delta',
    turnId: 'turn_fresh',
    threadId: 'thread_1',
    itemId: 'item_answer',
    eventType: 'delta',
    text: 'Hello world',
    delta: ' world',
    phase: 'final_answer',
  });

  const replay = bus.replay('turn_fresh');

  assert.equal(replay.reset, true);
  assert.equal(replay.resetReason, 'initial_snapshot');
  assert.equal(replay.snapshotComplete, true);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(bus.snapshot('turn_fresh').map((entry) => entry.event.id), [
    'evt_started',
    'evt_delta_2',
  ]);
});

test('event bus retains command deltas in history and one cumulative projection', () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 500, epoch: 'epoch_command_delta' });
  let output = '';
  for (let index = 0; index < 500; index += 1) {
    const delta = `${index}: output\n`;
    output += delta;
    bus.append('turn_command', {
      id: `evt_${index}`,
      type: 'batch.updated',
      turnId: 'turn_command',
      batchId: 'command_1',
      summary: { output, outputDelta: delta },
    });
  }

  const updates = bus.list('turn_command').map((entry) => entry.event);
  assert.equal(updates.every((event) => (
    event.type === 'batch.updated'
    && event.summary.output === undefined
    && typeof event.summary.outputDelta === 'string'
  )), true);
  const projected = bus.snapshot('turn_command')[0]?.event;
  assert.equal(projected?.type, 'batch.updated');
  assert.equal(projected.summary.output, output);
});

test('event bus enforces event, turn, and global byte budgets', () => {
  const bus = new CodexWebEventBus({
    maxEventsPerTurn: 500,
    maxTurns: 20,
    maxEventBytes: 2 * 1024,
    maxBytesPerTurn: 4 * 1024,
    maxTotalBytes: 8 * 1024,
    epoch: 'epoch_bytes',
  });
  for (let turn = 0; turn < 10; turn += 1) {
    for (let event = 0; event < 20; event += 1) {
      bus.append(`turn_${turn}`, {
        id: `evt_${turn}_${event}`,
        type: 'batch.updated',
        turnId: `turn_${turn}`,
        batchId: `command_${event}`,
        summary: { output: 'x'.repeat(16 * 1024) },
        raw: { output: 'y'.repeat(16 * 1024) },
      });
    }
  }

  const stats = bus.retentionStats();
  assert.ok(stats.totalBytes <= 8 * 1024, `retained ${stats.totalBytes} bytes`);
  assert.ok(stats.turns < 10);
  for (let turn = 0; turn < 10; turn += 1) {
    for (const entry of [...bus.list(`turn_${turn}`), ...bus.snapshot(`turn_${turn}`)]) {
      assert.ok(Buffer.byteLength(JSON.stringify(entry.event)) <= 2 * 1024);
    }
  }
});

test('live listeners do not prevent old turn state from being evicted', () => {
  const bus = new CodexWebEventBus({ maxTurns: 1 });
  const seen: string[] = [];
  const unsubscribe = bus.subscribe('turn_old', (entry) => seen.push(entry.event.id));
  bus.append('turn_old', {
    id: 'evt_old',
    type: 'turn.started',
    turnId: 'turn_old',
    threadId: 'thread_old',
  });
  bus.append('turn_new', {
    id: 'evt_new',
    type: 'turn.started',
    turnId: 'turn_new',
    threadId: 'thread_new',
  });

  assert.deepEqual(bus.list('turn_old'), []);
  bus.append('turn_old', {
    id: 'evt_old_live',
    type: 'assistant.delta',
    turnId: 'turn_old',
    threadId: 'thread_old',
    text: 'still live',
    delta: 'still live',
    phase: 'commentary',
  });
  assert.deepEqual(seen, ['evt_old', 'evt_old_live']);
  unsubscribe();
  assert.equal(bus.retentionStats().listeners, 0);
});
