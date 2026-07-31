import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { CodexWebEventBus } from '../src/event_bus.js';
import { streamTurnEvents } from '../src/server.js';

class FakeSseResponse extends EventEmitter {
  writableEnded = false;

  destroyed = false;

  readonly chunks: string[] = [];

  private blockNextMessage = false;

  private blockNextSlowReset = false;

  private messageBlockedResolve: (() => void) | null = null;

  private slowResetBlockedResolve: (() => void) | null = null;

  readonly messageBlocked = new Promise<void>((resolve) => {
    this.messageBlockedResolve = resolve;
  });

  readonly slowResetBlocked = new Promise<void>((resolve) => {
    this.slowResetBlockedResolve = resolve;
  });

  writeHead(): void {}

  flushHeaders(): void {}

  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    if (this.blockNextMessage && chunk.includes('event: message')) {
      this.blockNextMessage = false;
      this.messageBlockedResolve?.();
      return false;
    }
    if (this.blockNextSlowReset && chunk.includes('slow_consumer')) {
      this.blockNextSlowReset = false;
      this.slowResetBlockedResolve?.();
      return false;
    }
    return true;
  }

  end(): void {
    this.writableEnded = true;
  }

  blockMessageThenSlowReset(): void {
    this.blockNextMessage = true;
    this.blockNextSlowReset = true;
  }
}

test('SSE slow-consumer reset retains events that arrive while the snapshot is backpressured', async () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 500, epoch: 'epoch_backpressure' });
  const response = new FakeSseResponse();
  const request = new EventEmitter() as EventEmitter & {
    socket: { destroy(): void };
  };
  request.socket = { destroy: () => {} };
  const runtime = {
    eventBus: bus,
    getTurnEvents: (turnId: string, after?: string | number | null) => bus.list(turnId, after),
    getTurnEventReplay: (turnId: string, after?: string | number | null, epoch?: string | null) => (
      bus.replay(turnId, after, epoch)
    ),
    getTurnEventSnapshot: (turnId: string) => bus.snapshot(turnId),
    subscribeToTurn: (turnId: string, listener: any) => bus.subscribe(turnId, listener),
  };

  await streamTurnEvents({
    request: request as any,
    response: response as any,
    runtime: runtime as any,
    turnId: 'turn_backpressure',
    afterId: 0,
    requestedEpoch: 'epoch_backpressure',
    registerSseCloser: () => () => {},
  });

  response.blockMessageThenSlowReset();
  bus.append('turn_backpressure', {
    id: 'evt_blocked',
    type: 'assistant.delta',
    turnId: 'turn_backpressure',
    threadId: 'thread_backpressure',
    itemId: 'item_answer',
    eventType: 'delta',
    text: '0',
    delta: '0',
    phase: 'final_answer',
  });
  await response.messageBlocked;

  for (let index = 1; index <= 70; index += 1) {
    bus.append('turn_backpressure', {
      id: `evt_${index}`,
      type: 'assistant.delta',
      turnId: 'turn_backpressure',
      threadId: 'thread_backpressure',
      itemId: 'item_answer',
      eventType: 'delta',
      text: String(index),
      delta: String(index),
      phase: 'final_answer',
    });
  }
  response.emit('drain');
  await response.slowResetBlocked;

  const afterSnapshot = bus.append('turn_backpressure', {
    id: 'evt_after_snapshot',
    type: 'assistant.delta',
    turnId: 'turn_backpressure',
    threadId: 'thread_backpressure',
    itemId: 'item_answer',
    eventType: 'delta',
    text: 'after snapshot',
    delta: ' after snapshot',
    phase: 'final_answer',
  });
  response.emit('drain');

  await waitFor(() => response.chunks.some((chunk) => chunk.includes(`id: ${afterSnapshot.sequence}`)));
  const output = response.chunks.join('');
  response.emit('close');
  assert.match(output, /"reason":"slow_consumer"/u);
  assert.match(output, /"text":"0123456789[0-9]+70"/u);
  assert.match(output, new RegExp(`id: ${afterSnapshot.sequence}\\n`, 'u'));
  assert.match(output, /"delta":" after snapshot"/u);
});

test('SSE reconnects release every turn listener and queued event reference', async () => {
  const bus = new CodexWebEventBus({ epoch: 'epoch_reconnect' });
  const runtime = {
    eventBus: bus,
    getTurnEvents: (turnId: string, after?: string | number | null) => bus.list(turnId, after),
    getTurnEventReplay: (turnId: string, after?: string | number | null, epoch?: string | null) => (
      bus.replay(turnId, after, epoch)
    ),
    getTurnEventSnapshot: (turnId: string) => bus.snapshot(turnId),
    subscribeToTurn: (turnId: string, listener: any) => bus.subscribe(turnId, listener),
  };

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = new FakeSseResponse();
    const request = new EventEmitter() as EventEmitter & { socket: { destroy(): void } };
    request.socket = { destroy: () => {} };
    await streamTurnEvents({
      request: request as any,
      response: response as any,
      runtime: runtime as any,
      turnId: 'turn_reconnect',
      afterId: null,
      requestedEpoch: 'epoch_reconnect',
      registerSseCloser: () => () => {},
    });
    assert.equal(bus.retentionStats().listeners, 1);
    bus.append('turn_reconnect', {
      id: `evt_${attempt}`,
      type: 'batch.updated',
      turnId: 'turn_reconnect',
      batchId: 'command_reconnect',
      summary: { outputDelta: `${attempt}\n` },
    });
    response.emit('close');
    assert.equal(bus.retentionStats().listeners, 0);
    assert.equal(response.writableEnded, true);
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for SSE output');
}
