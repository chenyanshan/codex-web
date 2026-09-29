import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { withFileLock } from './file_lock.js';

interface ExecutionLease { id: string; pid: number }
export function withRuntimeMaintenanceLock<T>(stateDir: string, action: () => Promise<T>): Promise<T> {
  return withFileLock(path.join(stateDir, 'runtime-maintenance.lock'), action, { staleMs: 30 * 60_000, timeoutMs: 15_000 });
}
async function readLeases(stateDir: string): Promise<ExecutionLease[]> {
  try {
    const file = path.join(stateDir, 'runtime-execution-leases.json');
    if ((await fs.stat(file)).size > 64 * 1024) throw new Error('Execution lease state exceeds limit');
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(value) || value.length > 256 || value.some(lease => !lease || typeof lease.id !== 'string' || !Number.isSafeInteger(lease.pid) || lease.pid <= 0)) throw new Error('Invalid execution lease state');
    // A dead parent PID does not prove its app-server child stopped. Retain uncertain
    // leases until an operator reconciles them; never infer idle from parent death.
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
async function writeLeases(stateDir: string, leases: ExecutionLease[]): Promise<void> {
  const file = path.join(stateDir, 'runtime-execution-leases.json');
  await fs.writeFile(`${file}.tmp`, JSON.stringify(leases), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}
/** Must be called under the shared maintenance lock, including the final idle check. */
export async function activeExternalRuntimeExecutions(stateDir: string): Promise<number> {
  const leases = await readLeases(stateDir); await writeLeases(stateDir, leases); return leases.length;
}
/** Records an independent scheduled runtime until its owned app-server has stopped. */
export async function acquireRuntimeExecutionLease(stateDir: string): Promise<() => Promise<void>> {
  const lease = { id: crypto.randomUUID(), pid: process.pid };
  await withRuntimeMaintenanceLock(stateDir, async () => {
    try {
      const file = path.join(stateDir, 'runtime-maintenance.json');
      if ((await fs.stat(file)).size > 16_384) throw new Error('Invalid maintenance state');
      const state = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!['succeeded', 'cancelled', 'failed', 'outcome_unknown'].includes(state.phase)) throw Object.assign(new Error('Runtime maintenance is draining; scheduled execution is paused'), { code: 'RUNTIME_MAINTENANCE' });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const leases = await readLeases(stateDir);
    if (leases.length >= 256) throw new Error('External execution lease limit reached');
    await writeLeases(stateDir, [...leases, lease]);
  });
  return async () => withRuntimeMaintenanceLock(stateDir, async () => { await writeLeases(stateDir, (await readLeases(stateDir)).filter(value => value.id !== lease.id)); });
}
