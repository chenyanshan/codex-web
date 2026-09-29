import fs from 'node:fs/promises';
import path from 'node:path';
import { stableRuntimeVersion } from './runtime_update.js';
import { activeExternalRuntimeExecutions, withRuntimeMaintenanceLock } from './runtime_execution_lease.js';

export type RuntimeMaintenancePhase = 'waiting' | 'installing' | 'verifying' | 'applying' | 'succeeded' | 'cancelled' | 'failed' | 'outcome_unknown';
export interface RuntimeMaintenanceOperation {
  id: string;
  kind: 'apply_installed' | 'upgrade';
  targetVersion: string | null;
  source: string;
  phase: RuntimeMaintenancePhase;
  reasons: string[];
  createdAt: string;
  updatedAt: string;
  runningVersion: string | null;
  error: string | null;
}
export interface RuntimeMaintenanceOptions {
  stateDir: string;
  inspectActivity: () => Promise<{ idle: boolean; reasons: string[] }>;
  applyInstalled: () => Promise<{ runningVersion: string | null }>;
  updater?: { installPinned(version: string): Promise<void>; verifyInstalled(version?: string): Promise<void> };
  onChange?: (operation: RuntimeMaintenanceOperation) => void;
}
const terminal = new Set<RuntimeMaintenancePhase>(['succeeded', 'cancelled', 'failed', 'outcome_unknown']);
/** A single durable operation. Caller owns admin authorization and globally authoritative activity checks. */
export class RuntimeMaintenance {
  private operation: RuntimeMaintenanceOperation | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private admissions = 0;
  private working = false;
  private initialized = false;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly file: string;
  constructor(private readonly options: RuntimeMaintenanceOptions) { this.file = path.join(options.stateDir, 'runtime-maintenance.json'); }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const locked = () => withRuntimeMaintenanceLock(this.options.stateDir, fn);
    const next = this.lock.then(locked, locked); this.lock = next.catch(() => {}); return next;
  }
  async initialize(): Promise<void> {
    await this.exclusive(async () => {
      if (this.initialized) return;
      try {
        const stat = await fs.stat(this.file);
        if (stat.size > 16_384) throw new Error('Invalid maintenance state size');
        const value = JSON.parse(await fs.readFile(this.file, 'utf8')) as RuntimeMaintenanceOperation;
        if (!value || typeof value.id !== 'string' || !['apply_installed', 'upgrade'].includes(value.kind) || !['waiting', 'installing', 'verifying', 'applying', ...terminal].includes(value.phase)) throw new Error('Invalid maintenance state');
        this.operation = value;
        if (!terminal.has(value.phase) && value.phase !== 'waiting') {
          value.phase = 'outcome_unknown'; value.error = 'Service restarted during maintenance; inspect installed/running versions before creating a new operation. No automatic retry.';
          await this.persist();
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      this.initialized = true;
      this.scheduleWake();
    });
  }
  status(): RuntimeMaintenanceOperation | null { return this.operation ? structuredClone(this.operation) : null; }
  assertExecutionAllowed(): void {
    if (!this.initialized || (this.operation && !terminal.has(this.operation.phase))) throw Object.assign(new Error('Runtime maintenance is draining; new execution is paused'), { code: 'RUNTIME_MAINTENANCE', statusCode: 409 });
  }
  async withExecution<T>(action: () => Promise<T>, { allowDuringDrain = false }: { allowDuringDrain?: boolean } = {}): Promise<T> {
    await this.exclusive(async () => {
      if (!(this.initialized && allowDuringDrain && this.operation?.phase === 'waiting')) this.assertExecutionAllowed();
      this.admissions++;
    });
    try { return await action(); } finally { this.admissions--; }
  }
  async schedule(input: { id: string; kind: 'apply_installed' | 'upgrade'; targetVersion?: string }): Promise<RuntimeMaintenanceOperation> {
    return this.exclusive(async () => {
      if (!this.initialized) throw new Error('Maintenance is not initialized');
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.id)) throw new Error('A stable operation ID is required');
      if (!['apply_installed', 'upgrade'].includes(input.kind)) throw new Error('Invalid maintenance kind');
      if (this.operation?.id === input.id) {
        if (this.operation.kind !== input.kind || this.operation.targetVersion !== (input.targetVersion ?? null)) throw new Error('Operation ID already has different parameters');
        return this.status()!;
      }
      if (this.operation && !terminal.has(this.operation.phase)) throw new Error('Another maintenance operation is active');
      if (input.targetVersion !== undefined) stableRuntimeVersion(input.targetVersion);
      if (input.kind === 'upgrade') { if (!this.options.updater) throw new Error('Updates are unsupported'); stableRuntimeVersion(input.targetVersion ?? ''); }
      this.operation = { id: input.id, kind: input.kind, targetVersion: input.targetVersion ?? null, source: input.kind === 'upgrade' ? 'https://registry.npmjs.org/@openai/codex' : 'local-installed', phase: 'waiting', reasons: ['Waiting for global idle'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), runningVersion: null, error: null };
      await this.persist(); this.scheduleWake(); return this.status()!;
    });
  }
  async cancel(id: string): Promise<RuntimeMaintenanceOperation> {
    return this.exclusive(async () => {
      if (this.operation?.id !== id) throw new Error('Maintenance operation not found');
      if (this.operation.phase === 'cancelled') return this.status()!;
      if (this.operation.phase !== 'waiting') throw new Error('Only waiting maintenance can be cancelled');
      this.operation.phase = 'cancelled'; this.operation.reasons = []; await this.persist(); this.scheduleWake(); return this.status()!;
    });
  }
  /** Call from the existing runtime lifecycle tick, never from a new UI poller. */
  async tick(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      const ready = await this.exclusive(async () => {
        if (!this.operation || this.operation.phase !== 'waiting') return false;
        let activity: { idle: boolean; reasons: string[] };
        try {
          const external = await activeExternalRuntimeExecutions(this.options.stateDir);
          activity = external ? { idle: false, reasons: [`${external} scheduled execution(s) active`] } : await this.options.inspectActivity();
        } catch { activity = { idle: false, reasons: ['Global activity is unknown'] }; }
        if (this.admissions || !activity.idle) {
          const reasons = this.admissions ? ['Execution admission in progress'] : activity.reasons.slice(0, 12).map(reason => reason.slice(0, 200));
          if (JSON.stringify(this.operation.reasons) !== JSON.stringify(reasons)) { this.operation.reasons = reasons; await this.persist(); }
          return false;
        }
        this.operation.phase = this.operation.kind === 'upgrade' ? 'installing' : 'verifying'; this.operation.reasons = [];
        await this.persist(); return true;
      });
      if (!ready) return;
      const operation = this.operation!;
      try {
        if (operation.kind === 'upgrade') await this.options.updater!.installPinned(operation.targetVersion!);
        operation.phase = 'verifying'; await this.persist();
        if (this.options.updater) await this.options.updater.verifyInstalled(operation.targetVersion ?? undefined);
        operation.phase = 'applying'; await this.persist();
        const result = await this.options.applyInstalled();
        operation.runningVersion = result.runningVersion;
        if (!result.runningVersion || (operation.targetVersion && result.runningVersion !== operation.targetVersion)) throw new Error('Running version could not be verified');
        operation.phase = 'succeeded'; await this.persist();
      } catch {
        // Installer timeout, process death, or failed initialize can leave partial state; never replay.
        operation.error = `Maintenance ${operation.phase} did not complete. Inspect installed/running versions and service diagnostics; automatic rollback and retry are disabled.`;
        operation.phase = 'outcome_unknown'; await this.persist();
      }
    } finally { this.working = false; this.scheduleWake(); }
  }
  dispose(): void { this.disposed = true; if (this.wakeTimer) clearTimeout(this.wakeTimer); this.wakeTimer = null; }
  private scheduleWake(): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    if (this.disposed || this.operation?.phase !== 'waiting') return;
    this.wakeTimer = setTimeout(() => { this.wakeTimer = null; void this.tick().catch(() => {}); }, 5_000);
    this.wakeTimer.unref();
  }
  private async persist(): Promise<void> {
    if (!this.operation) return;
    this.operation.updatedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.operation)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.file);
    try { this.options.onChange?.(this.status()!); } catch { /* Observers cannot affect maintenance. */ }
  }
}
