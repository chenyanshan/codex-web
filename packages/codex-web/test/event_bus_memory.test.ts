import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('event history remains memory-bounded after cumulative output replay is serialized', () => {
  const fixture = fileURLToPath(new URL('./fixtures/event_bus_memory_scenario.ts', import.meta.url));
  const result = spawnSync(process.execPath, [
    '--expose-gc',
    '--conditions=development',
    '--import',
    'tsx',
    fixture,
  ], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_MEMORY_TURNS: '100',
      CODEX_MEMORY_DELTAS: '500',
      CODEX_MEMORY_DELTA_CHARS: '80',
    },
    maxBuffer: 1024 * 1024,
  });

  assert.equal(result.status, 0, result.stderr);
  const metrics = JSON.parse(result.stdout.trim()) as {
    serializedBytes: number;
    peakHeapUsed: number;
    heapUsedAfterGc: number;
    retention: { totalBytes: number };
    sentinel: number;
  };
  assert.equal(metrics.sentinel, 500);
  assert.ok(metrics.retention.totalBytes <= 64 * 1024 * 1024);
  assert.ok(metrics.serializedBytes < 32 * 1024 * 1024, `serialized ${metrics.serializedBytes} bytes`);
  assert.ok(metrics.peakHeapUsed < 160 * 1024 * 1024, `peak heap ${metrics.peakHeapUsed} bytes`);
  assert.ok(metrics.heapUsedAfterGc < 80 * 1024 * 1024, `retained heap ${metrics.heapUsedAfterGc} bytes`);
});
