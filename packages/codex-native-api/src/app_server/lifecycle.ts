import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import type { CodexAppClient } from '../codex_app_client.js';
import { AppServerObservationInterruptedError } from './transport.js';
const APP_SERVER_CONNECT_TIMEOUT_MS = 20_000;
interface CodexStderrEntry { sequence: number; text: string; }
export async function startServer(this: CodexAppClient): Promise<void> {
    const generation = this.lifecycleGeneration;
    if (this.autolaunch && this.launchCommand?.trim()) {
      const launcher = this.spawnImpl(this.launchCommand, {
        shell: true,
        detached: true,
        stdio: 'ignore',
      });
      launcher.unref?.();
    }
    this.childStartError = null;
    this.childStderrTail = [];
    this.childStderrSequence = 0;
    // A reconnect reuses the owned process. Never spawn a second server while it lives.
    if (this.child && this.child.exitCode === null) {
      try {
        await this.connectWebSocket();
        await this.initialize();
      } catch (error) {
        this.connected = false;
        this.socket?.close();
        this.socket = null;
        this.rejectPending(new AppServerObservationInterruptedError('Codex app-server initialization failed'));
        throw error;
      }
      return;
    }
    this.port = await reservePort();
    if (generation !== this.lifecycleGeneration) throw new AppServerObservationInterruptedError('Codex app-server startup cancelled');
    this.launchedBinaryPath = resolveLaunchPath(this.codexCliBin);
    const featureArgs = this.enabledFeatures.flatMap((feature) => ['--enable', feature]);
    const launchSpec = createCodexAppServerLaunchSpec({
      command: this.codexCliBin,
      args: [...this.codexCliArgs, 'app-server', ...featureArgs, '--listen', `ws://127.0.0.1:${this.port}`],
      platform: this.platform,
    });
    try {
      this.child = launchSpec.args
        ? this.spawnImpl(launchSpec.command, launchSpec.args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          ...launchSpec.options,
        })
        : this.spawnImpl(launchSpec.command, {
          stdio: ['ignore', 'pipe', 'pipe'],
          ...launchSpec.options,
        });
    } catch (error) {
      throw createCodexLaunchError({
        command: launchSpec.displayCommand,
        error,
        platform: this.platform,
      });
    }
    this.logDebug('app_server_spawned', {
      command: launchSpec.displayCommand,
      spawnCommand: launchSpec.command,
      spawnArgs: launchSpec.args,
      port: this.port,
      codexCliArgs: this.codexCliArgs,
      enabledFeatures: this.enabledFeatures,
      autolaunch: this.autolaunch,
      launchCommand: this.launchCommand,
    });
    this.child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        this.childStderrSequence += 1;
        rememberCodexStderrLine(this.childStderrTail, {
          sequence: this.childStderrSequence,
          text,
        });
        this.logger.debug?.(`[codex-app] codex.stderr ${text}`);
      }
    });
    this.child.on('error', (error) => {
      this.childStartError = createCodexLaunchError({
        command: launchSpec.displayCommand,
        error,
        platform: this.platform,
      });
    });
    const ownedChild = this.child;
    this.child.on('exit', () => {
      if (this.child !== ownedChild) return;
      this.connected = false;
      this.socket?.close();
      this.socket = null;
      const error = new AppServerObservationInterruptedError('Codex app-server process exited; turn state requires synchronization');
      this.pendingApprovals.clear();
      this.approvedExecutions.clear();
      this.rejectPending(error);
      this.emit('observation_interrupted', error);
    });
    try {
      await this.connectWebSocket();
      await this.initialize();
    } catch (error) {
      this.connected = false;
      this.socket?.close();
      this.socket = null;
      await terminateChildProcess(ownedChild, this.platform);
      if (this.child === ownedChild) this.child = null;
      throw error;
    }
  }

export async function connectWebSocket(this: CodexAppClient): Promise<void> {
    const generation = this.lifecycleGeneration;
    const url = `ws://127.0.0.1:${this.port}`;
    const started = Date.now();
    while (Date.now() - started < APP_SERVER_CONNECT_TIMEOUT_MS) {
      if (generation !== this.lifecycleGeneration) throw new AppServerObservationInterruptedError('Codex app-server connection cancelled');
      if (this.childStartError) {
        throw this.childStartError;
      }
      if (this.child && this.child.exitCode !== null && !this.connected) {
        throw createCodexAppServerExitedError({
          command: this.codexCliBin,
          exitCode: this.child.exitCode,
          stderrTail: codexStderrTextTail(this.childStderrTail),
        });
      }
      try {
        await new Promise<void>((resolve, reject) => {
          const ws = this.webSocketFactory(url);
          let settled = false;
          const timer = setTimeout(() => onError(new Error('WebSocket handshake timed out')), 1000);
          const onError = (error: any) => {
            if (settled) return;
            settled = true;
            ws.removeEventListener('open', onOpen);
            clearTimeout(timer);
            ws.close();
            reject(error instanceof Error ? error : new Error(String(error?.message ?? 'WebSocket connect failed')));
          };
          const onOpen = () => {
            if (generation !== this.lifecycleGeneration) { onError(new AppServerObservationInterruptedError('Codex app-server connection cancelled')); return; }
            if (settled) { ws.close(); return; }
            settled = true;
            clearTimeout(timer);
            ws.removeEventListener('error', onError);
            this.connectionEpoch += 1;
            this.socket = ws;
            this.connected = true;
            ws.addEventListener('message', (message) => { if (this.socket === ws) this.handleMessage(String(message.data)); });
            ws.addEventListener('close', () => {
              if (this.socket !== ws) return;
              this.connected = false;
              this.socket = null;
              const error = new AppServerObservationInterruptedError('Codex app-server connection closed; turn state requires synchronization');
              this.pendingApprovals.clear();
              this.approvedExecutions.clear();
              this.rejectPending(error);
              this.emit('observation_interrupted', error);
            });
            resolve();
          };
          ws.addEventListener('open', onOpen, { once: true });
          ws.addEventListener('error', onError, { once: true });
        });
        return;
      } catch {
        await sleep(250);
      }
    }
    if (this.childStartError) {
      throw this.childStartError;
    }
    throw createCodexConnectTimeoutError({
      command: this.codexCliBin,
      url,
      stderrTail: codexStderrTextTail(this.childStderrTail),
    });
  }


export function rememberCodexStderrLine(stderrTail: CodexStderrEntry[], entry: CodexStderrEntry): void {
  stderrTail.push(entry);
  while (stderrTail.length > 10) {
    stderrTail.shift();
  }
}

export function codexStderrTextTail(stderrTail: CodexStderrEntry[]): string[] {
  return stderrTail.map((entry) => entry.text);
}

function createCodexAppServerLaunchSpec({
  command,
  args,
  platform,
}: {
  command: string;
  args: string[];
  platform: NodeJS.Platform;
}): {
  command: string;
  args?: string[] | null;
  options?: Record<string, unknown>;
  displayCommand: string;
} {
  if (platform === 'win32' && /\.(cmd|bat)$/iu.test(command)) {
    return {
      command: buildWindowsShellCommandLine([command, ...args]),
      args: null,
      options: {
        shell: true,
        windowsHide: true,
      },
      displayCommand: command,
    };
  }
  return {
    command,
    args,
    displayCommand: command,
  };
}

function createCodexLaunchError({
  command,
  error,
  platform,
}: {
  command: string;
  error: unknown;
  platform: NodeJS.Platform;
}): Error {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  if (code === 'ENOENT' || /spawn .* ENOENT/i.test(message)) {
    const windowsHint = platform === 'win32'
      ? ' Ensure the Codex CLI is installed and reachable on PATH, or set CODEX_REAL_BIN to the full path of codex.exe or codex.cmd.'
      : ' Ensure the Codex CLI is installed and reachable on PATH.';
    return new Error(`Failed to launch Codex app-server with "${command}": command not found.${windowsHint}`);
  }
  return new Error(`Failed to launch Codex app-server with "${command}": ${message}`);
}

function createCodexAppServerExitedError({
  command,
  exitCode,
  stderrTail,
}: {
  command: string;
  exitCode: number;
  stderrTail: string[];
}): Error {
  const detail = stderrTail.length > 0
    ? ` Last stderr: ${stderrTail.join(' | ')}`
    : '';
  return new Error(`Codex app-server exited before opening its WebSocket (command: "${command}", exit code: ${exitCode}).${detail}`);
}

function createCodexConnectTimeoutError({
  command,
  url,
  stderrTail,
}: {
  command: string;
  url: string;
  stderrTail: string[];
}): Error {
  const detail = stderrTail.length > 0
    ? ` Last stderr: ${stderrTail.join(' | ')}`
    : '';
  return new Error(`Timed out connecting to ${url} after launching "${command}".${detail}`);
}

function buildWindowsShellCommandLine(parts: string[]): string {
  return parts.map(quoteWindowsShellArgument).join(' ');
}

function quoteWindowsShellArgument(value: string): string {
  const normalized = String(value ?? '');
  if (!normalized) {
    return '""';
  }
  if (!/[\s"]/u.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to reserve TCP port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForChildExit(child: ChildProcess | null, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Codex child process to exit'));
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
    };
    child.on('exit', onExit);
  });
}

export async function terminateChildProcess(child: ChildProcess, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32' && typeof child.pid === 'number') {
    await terminateWindowsProcessTree(child.pid);
    return;
  }
  child.kill('SIGTERM');
  await waitForChildExit(child, 5000).catch(() => {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
    return waitForChildExit(child, 2000).catch(() => {});
  });
}

function terminateWindowsProcessTree(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => {
      resolve();
    });
    killer.on('exit', () => {
      resolve();
    });
  });
}

function resolveLaunchPath(command: string): string {
  const candidates = path.isAbsolute(command) || command.includes(path.sep) ? [path.resolve(command)]
    : (process.env.PATH ?? '').split(path.delimiter).map((directory) => path.join(directory, command));
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return fs.realpathSync(candidate); } catch { /* continue */ }
  }
  return command;
}
