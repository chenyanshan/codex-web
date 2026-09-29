import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RuntimeMaintenance } from '../src/runtime_maintenance.js';
import { RuntimeUpdateService } from '../src/runtime_update.js';
import { handleRuntimeMaintenanceRoute, registerRuntimeMaintenance } from '../src/runtime_maintenance_routes.js';

test('maintenance routes authorize before status reads, preserve cached GET and stable request identity', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-routes-'));
  try {
    let executions = 0;
    const maintenance = new RuntimeMaintenance({ stateDir, inspectActivity: async () => ({ idle: false, reasons: ['Active task'] }), applyInstalled: async () => ({ runningVersion: '1.2.3' }) });
    await maintenance.initialize();
    const updater = new RuntimeUpdateService({ codexBin: 'codex', compatibilityScript: '/check.ts', execute: async () => { executions++; throw new Error('must not execute cached GET'); } });
    const runtime = {};
    registerRuntimeMaintenance(runtime, { maintenance, updater, versions: () => ({ runningVersion: null }), webBuild: 'test', protocolVersion: '1.2.3' });
    async function request(pathname: string, method: string, isAdmin: boolean, body: Record<string, unknown> = {}) {
      let code = 0; let value: any;
      const response = { writeHead(status: number) { code = status; }, end(payload: string) { value = JSON.parse(payload); } };
      await handleRuntimeMaintenanceRoute({ runtime, principal: { isAdmin }, request: {} as any, response: response as any, pathname, method, readJsonBody: async () => body });
      return { code, value };
    }
    for (const endpoint of ['status', 'check', 'maintenance', 'maintenance/cancel']) assert.equal((await request(`/api/runtime/${endpoint}`, endpoint === 'status' ? 'GET' : 'POST', false)).code, 403);
    const status = await request('/api/runtime/status', 'GET', true); assert.equal(status.code, 200); assert.equal(status.value.runningVersion, null); assert.equal(executions, 0);
    const body = { id: 'request_identity', kind: 'apply_installed' };
    assert.equal((await request('/api/runtime/maintenance', 'POST', true, body)).code, 202);
    assert.equal((await request('/api/runtime/maintenance', 'POST', true, body)).value.operation.id, body.id);
    assert.equal((await request('/api/runtime/maintenance/cancel', 'POST', true, { id: body.id })).value.operation.phase, 'cancelled');
  } finally { await fs.rm(stateDir, { recursive: true, force: true }); }
});
