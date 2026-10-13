import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CdpConnection, parseOptions, record } from './browser-allocation-profile.mjs';

class MockSocket extends EventTarget {
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  reply(id, result = {}) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result }) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

test('requires explicit target choice and output; uses conservative defaults', () => {
  assert.throws(() => parseOptions([]));
  assert.throws(() => parseOptions(['--output=/tmp/profiles', '--target-id=x', '--url=https://example.com']));
  assert.throws(() => parseOptions(['--output=/tmp/profiles', '--target-id=x', '--duration-seconds=0']));
  const result = parseOptions(['--output=/tmp/profiles', '--target-id=x']);
  assert.equal(result.durationSeconds, 300);
  assert.equal(result.samplingInterval, 65536);
  assert.equal(result.cdp, 'http://127.0.0.1:9222');
});

test('CDP responses release pending commands and ignore unsolicited events', async () => {
  const socket = new MockSocket(), client = new CdpConnection(socket, 100);
  const result = client.command('Runtime.getHeapUsage');
  socket.reply(99, { secret: 'not requested' });
  socket.reply(1, { usedSize: 42 });
  assert.deepEqual(await result, { usedSize: 42 });
  assert.equal(client.pending.size, 0);
  client.close();
});

test('timeout clears all pending probes and prevents new traffic; finalization is bounded', async () => {
  const socket = new MockSocket(), client = new CdpConnection(socket, 10);
  const results = await Promise.allSettled([client.command('Runtime.getHeapUsage'), client.command('Memory.getDOMCounters')]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(client.pending.size, 0);
  assert.equal(client.stopped, true);
  await assert.rejects(client.command('Performance.getMetrics'), /stopped/u);
  assert.equal(socket.sent.length, 2);
  const last = client.command('Profiler.stop', {}, { finalizing: true });
  socket.reply(3, { profile: { nodes: [] } });
  assert.deepEqual(await last, { profile: { nodes: [] } });
  await assert.rejects(client.command('HeapProfiler.stopSampling', {}, { finalizing: true }), /timed out/u);
  assert.equal(client.pending.size, 0);
  client.close();
  assert.ok(socket.sent.every(command => !['Browser.close', 'Page.reload', 'Target.closeTarget', 'HeapProfiler.collectGarbage', 'HeapProfiler.takeHeapSnapshot'].includes(command.method)));
});

test('disconnect rejects pending commands without leaving timeout handles', async () => {
  const socket = new MockSocket(), client = new CdpConnection(socket, 100);
  const request = client.command('Runtime.getHeapUsage');
  socket.close();
  await assert.rejects(request, /closed/u);
  assert.equal(client.pending.size, 0);
});

test('mock recording saves private profiles and stops at the heap guard without navigating or closing the page', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-allocation-mock-'));
  const previousSocket = globalThis.WebSocket, previousFetch = globalThis.fetch;
  const commands = [];
  let heapReads = 0, connectionClosed = false;
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ id: 'mock', type: 'page', webSocketDebuggerUrl: 'ws://mock' }] });
  globalThis.WebSocket = class extends MockSocket {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(value) {
      super.send(value);
      const command = this.sent.at(-1);
      commands.push(command.method);
      let result = {};
      if (command.method === 'Runtime.getHeapUsage') result = { usedSize: ++heapReads === 1 ? 1000 : 257 * 1024 * 1024, totalSize: 300 * 1024 * 1024 };
      if (command.method === 'Memory.getDOMCounters') result = { documents: 1, nodes: 10, jsEventListeners: 2 };
      if (command.method === 'Performance.getMetrics') result = { metrics: [{ name: 'Nodes', value: 10 }] };
      if (['HeapProfiler.getSamplingProfile', 'HeapProfiler.stopSampling', 'Profiler.stop'].includes(command.method)) result = { profile: { nodes: [] } };
      queueMicrotask(() => this.reply(command.id, result));
    }
    close() { connectionClosed = true; super.close(); }
  };
  try {
    const result = await record(parseOptions([`--output=${directory}`, '--target-id=mock', '--duration-seconds=1']));
    assert.match(result.reason, /256 MiB/u);
    const files = await readdir(result.directory);
    assert.equal(files.filter(name => name.endsWith('.heapprofile')).length, 2);
    assert.ok(files.includes('final.cpuprofile'));
    const events = (await readFile(result.timeline, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(events.some(event => event.type === 'metrics' && event.pressure));
    assert.equal(events.at(-1).type, 'stop');
    for (const file of files) assert.equal((await stat(join(result.directory, file))).mode & 0o777, 0o600);
    assert.equal((await stat(result.directory)).mode & 0o777, 0o700);
    assert.ok(connectionClosed);
    assert.ok(commands.includes('Profiler.stop') && commands.includes('HeapProfiler.stopSampling'));
    assert.ok(!commands.some(method => /navigate|reload|closeTarget|Browser.close|Snapshot|collectGarbage/u.test(method)));
  } finally {
    globalThis.WebSocket = previousSocket; globalThis.fetch = previousFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
