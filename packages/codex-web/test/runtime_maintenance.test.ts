import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RuntimeMaintenance } from '../src/runtime_maintenance.js';

test('one operation survives refresh, drains admission and never interrupts active work', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-'));
  try {
    let idle = false; let applies = 0;
    const maintenance = new RuntimeMaintenance({ stateDir, inspectActivity: async () => ({ idle, reasons: ['Child agent active'] }), applyInstalled: async () => { applies++; return { runningVersion: '1.2.3' }; } });
    await maintenance.initialize();
    let release!: () => void;
    const admitted = maintenance.withExecution(() => new Promise<void>(resolve => { release = resolve; }));
    await new Promise(resolve => setImmediate(resolve));
    const operation = { id: 'operation_123', kind: 'apply_installed' as const };
    await maintenance.schedule(operation);
    assert.equal((await maintenance.schedule(operation)).id, operation.id);
    await assert.rejects(maintenance.withExecution(async () => {}), /paused/);
    await maintenance.tick(); assert.equal(applies, 0);
    release(); await admitted;
    await maintenance.tick(); assert.deepEqual(maintenance.status()?.reasons, ['Child agent active']);
    idle = true;
    await Promise.all([maintenance.tick(), maintenance.tick()]);
    assert.equal(applies, 1); assert.equal(maintenance.status()?.phase, 'succeeded');
    await maintenance.schedule(operation); await maintenance.tick(); assert.equal(applies, 1);
  } finally { await fs.rm(stateDir, { recursive: true, force: true }); }
});

test('unknown activity waits, cancellation reopens admission, and interrupted install is never retried', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-'));
  try {
    const options = { stateDir, inspectActivity: async (): Promise<{ idle: boolean; reasons: string[] }> => { throw new Error('offline'); }, applyInstalled: async () => ({ runningVersion: '1.2.3' }) };
    const maintenance = new RuntimeMaintenance(options); await maintenance.initialize();
    await maintenance.schedule({ id: 'operation_cancel', kind: 'apply_installed' }); await maintenance.tick();
    assert.deepEqual(maintenance.status()?.reasons, ['Global activity is unknown']);
    await maintenance.cancel('operation_cancel'); await maintenance.withExecution(async () => {});
    await fs.writeFile(path.join(stateDir, 'runtime-maintenance.json'), JSON.stringify({ ...maintenance.status(), phase: 'installing', kind: 'upgrade', targetVersion: '1.2.3' }));
    const recovered = new RuntimeMaintenance(options); await recovered.initialize(); await recovered.tick();
    assert.equal(recovered.status()?.phase, 'outcome_unknown');
  } finally { await fs.rm(stateDir, { recursive: true, force: true }); }
});

test('pinned install, compatibility, initialize are ordered and uncertain installation never repeats', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-'));
  try {
    const calls: string[] = [];
    const maintenance = new RuntimeMaintenance({ stateDir, inspectActivity: async () => ({ idle: true, reasons: [] }), updater: { installPinned: async version => { calls.push(version); throw new Error('secret credential'); }, verifyInstalled: async () => { calls.push('verify'); } }, applyInstalled: async () => { calls.push('apply'); return { runningVersion: '1.2.3' }; } });
    await maintenance.initialize();
    const input = { id: 'operation_upgrade', kind: 'upgrade' as const, targetVersion: '1.2.3' };
    await maintenance.schedule(input); await maintenance.tick(); await maintenance.schedule(input); await maintenance.tick();
    assert.deepEqual(calls, ['1.2.3']); assert.equal(maintenance.status()?.phase, 'outcome_unknown');
    assert.doesNotMatch(JSON.stringify(maintenance.status()), /secret credential/);
    await assert.rejects(maintenance.schedule({ ...input, targetVersion: '2.0.0' }), /different parameters/);
  } finally { await fs.rm(stateDir, { recursive: true, force: true }); }
});

test('successful pinned upgrade verifies before applying and confirms the actual running version', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-'));
  try {
    const calls: string[] = [];
    const maintenance = new RuntimeMaintenance({ stateDir, inspectActivity: async () => ({ idle: true, reasons: [] }), updater: { installPinned: async version => { calls.push(`install:${version}`); }, verifyInstalled: async version => { calls.push(`verify:${version}`); } }, applyInstalled: async () => { calls.push('apply'); return { runningVersion: '1.2.3' }; } });
    await maintenance.initialize(); await maintenance.schedule({ id: 'operation_success', kind: 'upgrade', targetVersion: '1.2.3' });
    await maintenance.tick();
    assert.deepEqual(calls, ['install:1.2.3', 'verify:1.2.3', 'apply']);
    assert.equal(maintenance.status()?.phase, 'succeeded'); assert.equal(maintenance.status()?.runningVersion, '1.2.3');
    const recovered = new RuntimeMaintenance({ stateDir, inspectActivity: async () => ({ idle: true, reasons: [] }), applyInstalled: async () => { throw new Error('must not repeat'); } });
    await recovered.initialize(); await recovered.tick(); assert.equal(recovered.status()?.phase, 'succeeded');
  } finally { await fs.rm(stateDir, { recursive: true, force: true }); }
});

test('missing running version cannot report success after restart', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-'));
  try {
    const maintenance = new RuntimeMaintenance({ stateDir, inspectActivity: async () => ({ idle: true, reasons: [] }), applyInstalled: async () => ({ runningVersion: null }) });
    await maintenance.initialize(); await maintenance.schedule({ id: 'operation_unknown', kind: 'apply_installed' }); await maintenance.tick();
    assert.equal(maintenance.status()?.phase, 'outcome_unknown');
  } finally { await fs.rm(stateDir, { recursive: true, force: true }); }
});

test('independent scheduled runtime lease participates in the same idle/admission lock', async () => {
  const { acquireRuntimeExecutionLease } = await import('../src/runtime_execution_lease.js');
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-'));
  try {
    const release = await acquireRuntimeExecutionLease(stateDir);
    let applied = 0;
    const maintenance = new RuntimeMaintenance({ stateDir, inspectActivity: async () => ({ idle: true, reasons: [] }), applyInstalled: async () => { applied++; return { runningVersion: '1.2.3' }; } });
    await maintenance.initialize(); await maintenance.schedule({ id: 'scheduled_gate', kind: 'apply_installed' });
    await maintenance.tick(); assert.equal(applied, 0); assert.match(maintenance.status()!.reasons[0]!, /scheduled execution/);
    await assert.rejects(acquireRuntimeExecutionLease(stateDir), /paused/);
    await release(); await maintenance.tick(); assert.equal(applied, 1);
    const after = await acquireRuntimeExecutionLease(stateDir); await after();
  } finally { await fs.rm(stateDir, { recursive: true, force: true }); }
});
