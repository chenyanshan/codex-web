import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function consumer(overrides = {}) {
  const context: any = { TextDecoder, setTimeout, clearTimeout, ...overrides };
  vm.runInNewContext(await readFile(new URL('../public/network-recovery.js', import.meta.url), 'utf8'), context);
  return context.CodexWebNetworkRecovery.consumeSse;
}
const encoder = new TextEncoder();
function source(chunks: Uint8Array[]) {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close(); },
    cancel() { cancelled += 1; },
  });
  return { body, cancellations: () => cancelled };
}

test('SSE accepts split CRLF, UTF-8, LF frames and flushes final decoder text', async () => {
  const consume = await consumer();
  const bytes = encoder.encode('data: 中文🙂\r\n\r\ndata: next\n\ndata: tail');
  const stream = source(Array.from(bytes, byte => Uint8Array.of(byte)));
  const frames: string[] = [];
  await consume(stream.body, (frame: string) => frames.push(frame));
  assert.deepEqual(frames, ['data: 中文🙂', 'data: next', 'data: tail']);
  assert.equal(stream.body.locked, false);
});

test('SSE limits unterminated and completed oversized frames, releasing the reader', async () => {
  const consume = await consumer();
  for (const suffix of ['', '\n\n']) {
    const stream = source([encoder.encode(`data: ${'x'.repeat(100)}${suffix}`)]);
    const frames: string[] = [];
    await assert.rejects(consume(stream.body, (frame: string) => frames.push(frame), { maxFrameChars: 32 }), { name: 'SseFrameLimitError' });
    assert.deepEqual(frames, []);
    assert.equal(stream.body.locked, false);
  }
});

test('many legal frames exceeding the frame budget in one chunk retain all output', async () => {
  const consume = await consumer();
  const stream = source([encoder.encode('data: value\n\n'.repeat(20000))]);
  let count = 0;
  await consume(stream.body, (frame: string) => { assert.equal(frame, 'data: value'); count += 1; }, { maxFrameChars: 32 });
  assert.equal(count, 20000);
  assert.equal(stream.body.locked, false);
});

test('handler failure, obsolete connection and mid-frame cancellation release transport', async () => {
  const consume = await consumer();
  for (const reason of ['throw', 'obsolete', 'abort']) {
    const controller = new AbortController();
    let current = true;
    const stream = source([encoder.encode('data: one\n\ndata: two\n\n'), encoder.encode('data: three\n\n')]);
    let count = 0;
    const task = consume(stream.body, () => {
      count += 1;
      if (reason === 'throw') throw new Error('handler failed');
      if (reason === 'abort') controller.abort();
      current = false;
    }, { signal: controller.signal, isCurrent: () => current });
    if (reason === 'throw') await assert.rejects(task, /handler failed/);
    else await task;
    assert.equal(count, 1);
    assert.equal(stream.body.locked, false);
    assert.equal(stream.cancellations(), 1);
  }
});

test('abort wakes an idle read and removes its signal listener', async () => {
  const consume = await consumer();
  const controller = new AbortController();
  let added = 0, removed = 0, cancelled = 0;
  const signal = {
    get aborted() { return controller.signal.aborted; },
    addEventListener(...args: any[]) { added += 1; (controller.signal.addEventListener as any)(...args); },
    removeEventListener(...args: any[]) { removed += 1; (controller.signal.removeEventListener as any)(...args); },
  };
  const body = new ReadableStream({ cancel() { cancelled += 1; } });
  const task = consume(body, () => assert.fail('aborted stream must not dispatch'), { signal });
  controller.abort();
  await task;
  assert.equal(body.locked, false);
  assert.equal(cancelled, 1);
  assert.equal(added, removed);
});

test('frames at the exact limit survive split delimiter bytes', async () => {
  const consume = await consumer();
  for (const delimiter of ['\n\n', '\r\n\r\n']) {
    const stream = source([encoder.encode('data: ok'), ...Array.from(encoder.encode(delimiter), byte => Uint8Array.of(byte))]);
    const frames: string[] = [];
    await consume(stream.body, (frame: string) => frames.push(frame), { maxFrameChars: 8 });
    assert.deepEqual(frames, ['data: ok']);
  }
});

test('pre-aborted and errored streams release locks without dispatching frames', async () => {
  const consume = await consumer();
  const controller = new AbortController();
  controller.abort();
  let cancelled = 0;
  const body = new ReadableStream({ cancel() { cancelled += 1; } });
  await consume(body, () => assert.fail('pre-aborted frame'), { signal: controller.signal });
  assert.equal(body.locked, false);
  assert.equal(cancelled, 1);
  const broken = new ReadableStream({ start(stream) { stream.error(new Error('source failed')); } });
  await assert.rejects(consume(broken, () => assert.fail('errored frame')), /source failed/);
  assert.equal(broken.locked, false);
  await assert.rejects(consume({ getReader() { throw new Error('already locked'); } }, () => {}), /already locked/);
});

test('a source whose cancel never settles cannot retain reader lock or delay stream cleanup', async () => {
  const consume = await consumer();
  const controller = new AbortController();
  let cancelled = 0;
  const body = new ReadableStream({ cancel() { cancelled += 1; return new Promise(() => {}); } });
  const task = consume(body, () => {}, { signal: controller.signal });
  controller.abort();
  await task;
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

for (const chunking of ['single', 'ready chunks']) {
  test(`SSE yields to tasks across ${chunking} while preserving serial complete output`, async () => {
    const consume = await consumer();
    const messages = Array.from({ length: 240 }, (_, i) => `data: ${i}`);
    const chunks = chunking === 'single' ? [messages.join('\n\n') + '\n\n'] : messages.map(message => message + '\n\n');
    const stream = source(chunks.map(chunk => encoder.encode(chunk)));
    const received: string[] = [];
    let countAtTimer = -1, active = false;
    const timer = new Promise<void>(resolve => setTimeout(() => { countAtTimer = received.length; resolve(); }, 0));
    await consume(stream.body, async (frame: string) => {
      assert.equal(active, false);
      active = true;
      await Promise.resolve();
      received.push(frame);
      active = false;
    });
    await timer;
    assert.ok(countAtTimer > 0 && countAtTimer < 240, `task ran after ${countAtTimer} frames`);
    assert.deepEqual(received, messages);
    assert.equal(stream.body.locked, false);
  });
}

test('abort wakes a scheduled yield without waiting for its timer or reading more chunks', async () => {
  const controller = new AbortController();
  let reads = 0, frames = 0, cleared = 0, released = false, listeners = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args: any[]) => { listeners++; return add(...args); };
  controller.signal.removeEventListener = (...args: any[]) => { listeners--; return remove(...args); };
  let scheduled!: () => void;
  const yielding = new Promise<void>(resolve => { scheduled = resolve; });
  const consume = await consumer({ setTimeout: () => { scheduled(); return 123; }, clearTimeout: () => { cleared++; } });
  const body = { getReader: () => ({
    read: async () => { reads++; return { value: encoder.encode('data: x\n\n'.repeat(240)), done: false }; },
    cancel: async () => {}, releaseLock: () => { released = true; },
  }) };
  const task = consume(body, () => { frames++; }, { signal: controller.signal });
  await yielding;
  assert.ok(frames > 0 && frames <= 32);
  assert.equal(reads, 1);
  controller.abort();
  await task;
  assert.equal(reads, 1);
  assert.equal(cleared, 1);
  assert.equal(listeners, 0);
  assert.equal(released, true);
});
