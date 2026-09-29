import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export type RuntimeCommandExecutor = (command: string, args: string[], timeoutMs: number) => Promise<string>;
export const executeRuntimeCommand: RuntimeCommandExecutor = (command, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout: timeoutMs, maxBuffer: 256 * 1024, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
});
export interface RuntimeInstallationStatus {
  installedVersion: string | null;
  installation: 'npm' | 'unsupported';
  updateSupported: boolean;
  source: string;
  limitation: string;
  checkedAt: string | null;
}
export function stableRuntimeVersion(value: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('A pinned stable version is required');
  return value;
}
/** Only the installation selected by codexBin is inspected; no global installation scanning. */
export class RuntimeUpdateService {
  private cached: RuntimeInstallationStatus = { installedVersion: null, installation: 'unsupported', updateSupported: false, source: 'unknown', limitation: 'Installation source is unknown; update manually.', checkedAt: null };
  private refreshing: Promise<RuntimeInstallationStatus> | null = null;
  private npmRoot: string | null = null;
  private readonly execute: RuntimeCommandExecutor;
  constructor(private readonly options: { codexBin: string; compatibilityScript: string; npmBin?: string; execute?: RuntimeCommandExecutor; resolveBinary?: (bin: string) => Promise<string> }) { this.execute = options.execute ?? executeRuntimeCommand; }
  status(): RuntimeInstallationStatus { return { ...this.cached }; }
  refresh(): Promise<RuntimeInstallationStatus> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.inspect().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  private async inspect(): Promise<RuntimeInstallationStatus> {
    let installedVersion: string | null = null;
    this.npmRoot = null;
    try {
      const output = await this.execute(this.options.codexBin, ['--version'], 15_000);
      installedVersion = output.match(/(?:^|\s)(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:\s|$)/)?.[1] ?? null;
    } catch { /* Unknown stays distinct from the running version. */ }
    let supported = false;
    try {
      const binary = await (this.options.resolveBinary ?? resolveBinary)(this.options.codexBin);
      const root = (await this.execute(this.options.npmBin ?? 'npm', ['root', '-g'], 15_000)).trim();
      if (!path.isAbsolute(root)) throw new Error('Invalid npm root');
      const entry = await fs.realpath(path.join(root, '@openai/codex/bin/codex.js'));
      const pkg = JSON.parse(await fs.readFile(path.join(root, '@openai/codex/package.json'), 'utf8'));
      supported = pkg.name === '@openai/codex' && binary === entry;
      if (supported) this.npmRoot = root;
    } catch { /* Other package managers require an explicit supported implementation. */ }
    this.cached = { installedVersion, installation: supported ? 'npm' : 'unsupported', updateSupported: supported, source: supported ? 'https://registry.npmjs.org/@openai/codex' : 'unknown', limitation: supported ? 'In-place npm upgrade; no atomic rollback or guaranteed state downgrade. Installation starts only after global idle; compatibility is checked before restarting the owned app-server.' : 'Installation source is unsupported; update manually, then apply the installed version.', checkedAt: new Date().toISOString() };
    return this.status();
  }
  async resolveStableTarget(): Promise<string> {
    if (!this.cached.updateSupported) throw new Error('Unsupported installation source');
    const output = await this.execute(this.options.npmBin ?? 'npm', ['view', '@openai/codex', 'dist-tags.latest', '--json', '--registry=https://registry.npmjs.org'], 30_000);
    return stableRuntimeVersion(JSON.parse(output));
  }
  async installPinned(version: string): Promise<void> {
    stableRuntimeVersion(version);
    const previousRoot = this.npmRoot;
    await this.refresh();
    if (!this.cached.updateSupported || !previousRoot || previousRoot !== this.npmRoot) throw new Error('Installation source changed or is unsupported');
    // Official npm update action, pinned once rather than resolving latest during execution.
    await this.execute(this.options.npmBin ?? 'npm', ['install', '-g', `@openai/codex@${version}`, '--registry=https://registry.npmjs.org'], 10 * 60_000);
    await this.refresh();
    if (this.cached.installedVersion !== version) throw new Error('Installed version does not match the pinned target');
  }
  async verifyInstalled(version?: string): Promise<void> {
    await this.refresh();
    if (version && this.cached.installedVersion !== version) throw new Error('Installed version changed before compatibility verification');
    const binary = await (this.options.resolveBinary ?? resolveBinary)(this.options.codexBin);
    await this.execute(process.execPath, ['--conditions=development', '--import', 'tsx', this.options.compatibilityScript, '--codex-bin', binary], 120_000);
  }
}
async function resolveBinary(bin: string): Promise<string> {
  if (path.isAbsolute(bin) || bin.includes(path.sep)) return fs.realpath(bin);
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    try { const candidate = path.join(directory, bin); await fs.access(candidate, fs.constants.X_OK); return await fs.realpath(candidate); } catch { /* Try the next PATH entry. */ }
  }
  throw new Error('Codex binary not found');
}
