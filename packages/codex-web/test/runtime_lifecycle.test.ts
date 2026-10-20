import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexWebRuntime, type CodexWebRuntimeClient } from '../src/runtime.js';

test('runtime stop interrupts and drains an in-flight directory scan', async () => {
  let releaseList!: () => void;
  let stopped = false;
  const listPending = new Promise<void>((resolve) => { releaseList = resolve; });
  const client = {
    listThreads: async () => {
      await listPending;
      return { items: [], nextCursor: null };
    },
    stop: async () => {
      stopped = true;
      releaseList();
    },
  } as unknown as CodexWebRuntimeClient;
  const runtime = new CodexWebRuntime({ defaultCwd: '/tmp', client });

  const scan = runtime.listSessions();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await runtime.stop();
  await scan;

  assert.equal(stopped, true);
  await runtime.stop();
});
