import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexWebRuntime } from '../src/runtime.js';

function runtimeFor(read: (id: string) => string, request: (_method: string, params: any) => Promise<any>) {
  return new CodexWebRuntime({ codexBin: 'unused', defaultCwd: '/tmp', client: {
    request,
    listModels: async () => [], readUsage: async () => null,
    readThread: async (id: string) => ({ threadId: id, cwd: '/tmp', title: null, updatedAt: 0, preview: '', turns: [], runtimeStatus: { type: read(id) } }),
    listThreads: async () => ({ items: [], nextCursor: null }),
    startThread: async () => ({ threadId: 'unused', cwd: '/tmp', title: null }),
    startTurn: async () => { throw new Error('must not start'); },
    writeConfigValue: async () => {}, interruptTurn: async () => {}, respondToApproval: async () => {},
  } as any });
}

test('idle inspection includes later loaded pages and requires explicit idle statuses', async () => {
  const cursors: unknown[] = [];
  let childStatus = 'active';
  const runtime = runtimeFor(id => id === 'child' ? childStatus : 'idle', async (_method, params) => {
    cursors.push(params.cursor);
    return params.cursor ? { data: ['child'], nextCursor: null } : { data: ['parent'], nextCursor: 'next' };
  });
  try {
    assert.equal((await runtime.inspectRuntimeActivity()).idle, false);
    assert.deepEqual(cursors, [null, 'next']);
    for (const status of ['systemError', 'notLoaded', 'unknown']) { childStatus = status; assert.equal((await runtime.inspectRuntimeActivity()).idle, false); }
    childStatus = 'idle'; assert.equal((await runtime.inspectRuntimeActivity()).idle, true);
  } finally { await runtime.stop(); }
});

test('cyclic pagination does not claim global idle', async () => {
  const runtime = runtimeFor(() => 'idle', async () => ({ data: ['parent'], nextCursor: 'loop' }));
  try { const result = await runtime.inspectRuntimeActivity(); assert.equal(result.idle, false); assert.match(result.reasons.join(' '), /pagination/); } finally { await runtime.stop(); }
});

test('apply installed restart resets stream epoch and refreshes model/config state without clearing confirmed history', async () => {
  const runtime = runtimeFor(() => 'idle', async () => ({ data: [], nextCursor: null }));
  const calls: string[] = [];
  Object.assign(runtime.client, {
    stop: async () => { calls.push('stop'); },
    start: async () => { calls.push('initialize'); },
    listModels: async () => { calls.push('models'); return []; },
    readConfigDefaults: async () => { calls.push('config'); return null; },
    diagnostics: () => ({ connected: true, server: { version: '1.2.3' } }),
  });
  runtime.eventBus.append('finished_turn', { id: 'final', type: 'turn.completed', turnId: 'finished_turn', threadId: 'thread' } as any);
  const oldEpoch = runtime.eventBus.epoch;
  const before = runtime.eventBus.retentionStats();
  let resets = 0;
  const unsubscribe = runtime.eventBus.subscribeToReset(() => { resets++; });
  try {
    assert.equal((await runtime.applyInstalledRuntime()).runningVersion, '1.2.3');
    assert.deepEqual(calls, ['stop', 'initialize', 'models', 'config']);
    assert.equal(resets, 1); assert.notEqual(runtime.eventBus.epoch, oldEpoch);
    assert.equal(runtime.eventBus.retentionStats().totalBytes, before.totalBytes);
    assert.equal(runtime.eventBus.replay('finished_turn', null, oldEpoch).resetReason, 'epoch_mismatch');
  } finally { unsubscribe(); await runtime.stop(); }
});

test('persisted active goal blocks idle even before this runtime has observed its turn', async () => {
  const runtime = runtimeFor(() => 'idle', async () => ({ data: ['persisted_goal'], nextCursor: null }));
  Object.assign(runtime.client, { getThreadGoal: async () => ({ objective: 'Keep working', status: 'active' }) });
  try { const result = await runtime.inspectRuntimeActivity(); assert.equal(result.idle, false); assert.ok(result.reasons.includes('Active goals')); } finally { await runtime.stop(); }
});

test('createSession holds admission through thread creation and new goal starts cannot bypass waiting maintenance', async () => {
  const fs = await import('node:fs/promises'); const os = await import('node:os'); const path = await import('node:path');
  const { RuntimeMaintenance } = await import('../src/runtime_maintenance.js');
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-admission-'));
  const runtime = runtimeFor(() => 'idle', async () => ({ data: [], nextCursor: null }));
  let release!: () => void; let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  Object.assign(runtime.client, { startThread: async () => { began(); await new Promise<void>(resolve => { release = resolve; }); return { threadId: 'new_thread', cwd: '/tmp', title: null }; } });
  const maintenance = new RuntimeMaintenance({ stateDir, inspectActivity: () => runtime.inspectRuntimeActivity(), applyInstalled: async () => { throw new Error('must not apply while creating'); } });
  try {
    await maintenance.initialize(); runtime.setRuntimeMaintenance(maintenance);
    const creating = runtime.createSession(); await started;
    await maintenance.schedule({ id: 'create_admission', kind: 'apply_installed' }); await maintenance.tick();
    assert.deepEqual(maintenance.status()?.reasons, ['Execution admission in progress']);
    await assert.rejects(runtime.createSession(), /paused/);
    await assert.rejects(runtime.startTurn('new_thread', { text: '/goal Continue working' }), /paused/);
    await assert.rejects(runtime.startTurn('new_thread', { text: '/goal resume' }), /paused/);
    const calls: string[] = [];
    (runtime as any).startTurnAdmitted = async (_id: string, input: { text: string }) => { calls.push(input.text); return {}; };
    await runtime.startTurn('new_thread', { text: '/goal pause' });
    await runtime.startTurn('new_thread', { text: '/goal clear' });
    assert.deepEqual(calls, ['/goal pause', '/goal clear']);
    release(); await creating;
  } finally { maintenance.dispose(); await runtime.stop(); await fs.rm(stateDir, { recursive: true, force: true }); }
});
