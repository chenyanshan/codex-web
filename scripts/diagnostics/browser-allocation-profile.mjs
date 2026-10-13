#!/usr/bin/env node
import { appendFile, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const HELP = `Usage: node scripts/diagnostics/browser-allocation-profile.mjs
  --output=/private/diagnostic-directory
  (--target-id=EXISTING_PAGE_ID | --url=https://example.com/)
  [--cdp=http://127.0.0.1:9222] [--duration-seconds=300]
  [--sampling-interval=65536] [--command-timeout-ms=5000]

Requires Node 24. Existing targets are never navigated. --url creates a blank
page and starts heap/CPU sampling before navigation. Saves metrics every 2s,
allocation profiles every 5s (initial + latest 20). Stops at JS heap >256 MiB.
Never refreshes/closes pages, kills browsers, takes snapshots or forces GC.
Artifacts can contain source URLs: keep the output directory private.
`;

export function parseOptions(args) {
  const options = { cdp: 'http://127.0.0.1:9222', durationSeconds: 300, samplingInterval: 65536, commandTimeoutMs: 5000 };
  const numeric = { 'duration-seconds': 'durationSeconds', 'sampling-interval': 'samplingInterval', 'command-timeout-ms': 'commandTimeoutMs' };
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return { help: true };
    const match = /^--([^=]+)=(.+)$/u.exec(arg);
    if (!match) throw new Error('Use --name=value arguments; see --help.');
    const [, key, value] = match;
    if (numeric[key]) {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0 || !Number.isInteger(number)) throw new Error(`Invalid --${key}.`);
      options[numeric[key]] = number;
    } else if (['cdp', 'output', 'url', 'target-id'].includes(key)) options[key === 'target-id' ? 'targetId' : key] = value;
    else throw new Error(`Unknown option --${key}.`);
  }
  if (!options.output || Boolean(options.url) === Boolean(options.targetId)) throw new Error('--output and exactly one of --target-id / --url are required.');
  for (const key of ['cdp', ...(options.url ? ['url'] : [])]) {
    const url = new URL(options[key]);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`Invalid --${key} URL.`);
  }
  options.output = resolve(options.output);
  return options;
}

// One timeout shuts down regular traffic. Only bounded finalization commands
// may then run, so an unresponsive renderer never accumulates pending probes.
export class CdpConnection {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 0;
    this.stopped = false;
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`CDP ${entry.method} failed (code ${message.error.code}).`));
      else entry.resolve(message.result || {});
    });
    socket.addEventListener('close', () => this.failPending(new Error('CDP connection closed.')));
    socket.addEventListener('error', () => this.failPending(new Error('CDP connection failed.')));
  }
  failPending(error) {
    this.stopped = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
  command(method, params = {}, { finalizing = false } = {}) {
    if ((this.stopped && !finalizing) || this.socket.readyState !== 1) return Promise.reject(new Error('CDP recording stopped.'));
    return new Promise((resolveCommand, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.failPending(new Error(`CDP ${method} timed out.`)), this.timeoutMs);
      this.pending.set(id, { resolve: resolveCommand, reject, timer, method });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch { this.failPending(new Error(`CDP ${method} could not be sent.`)); }
    });
  }
  close() {
    this.failPending(new Error('CDP recording finished.'));
    this.socket.close();
  }
}

async function connect(url, timeoutMs) {
  const socket = new WebSocket(url);
  await new Promise((accept, reject) => {
    const cleanup = () => { clearTimeout(timer); socket.removeEventListener('open', opened); socket.removeEventListener('error', failed); };
    const opened = () => { cleanup(); accept(); };
    const failed = () => { cleanup(); socket.close(); reject(new Error('CDP WebSocket connection failed.')); };
    const timer = setTimeout(() => { cleanup(); socket.close(); reject(new Error('CDP WebSocket connection timed out.')); }, timeoutMs);
    socket.addEventListener('open', opened, { once: true });
    socket.addEventListener('error', failed, { once: true });
  });
  return new CdpConnection(socket, timeoutMs);
}

async function hostPressure() {
  if (process.platform !== 'darwin') return { platform: process.platform, level: null, status: 'unsupported' };
  try {
    const { stdout } = await exec('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 1500 });
    const level = Number(stdout.trim());
    return { platform: process.platform, level: Number.isFinite(level) ? level : null, status: Number.isFinite(level) ? 'available' : 'unreadable' };
  } catch { return { platform: process.platform, level: null, status: 'unreadable' }; }
}

async function fetchJson(base, path, timeoutMs) {
  try {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { throw new Error('CDP discovery failed or timed out.'); }
}

export async function record(options) {
  process.umask(0o077);
  await mkdir(options.output, { recursive: true, mode: 0o700 });
  await chmod(options.output, 0o700);
  // A distinct run directory avoids overwriting an earlier capture.
  const directory = join(options.output, `allocation-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
  await mkdir(directory, { mode: 0o700 });
  const timeline = join(directory, 'timeline.jsonl');
  const started = Date.now();
  const write = async (name, value) => {
    const path = join(directory, name);
    await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    return path;
  };
  const log = record => appendFile(timeline, `${JSON.stringify({ at: new Date().toISOString(), elapsedMs: Date.now() - started, ...record })}\n`, { mode: 0o600 });
  let client = null, browser = null, heapStarted = false, cpuStarted = false;
  let reason = 'duration reached', stopping = false, profileIndex = 0;
  const recent = [];
  const stop = () => { stopping = true; reason = 'interrupted'; if (client) client.stopped = true; if (browser) browser.stopped = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const saveProfile = async (profile, phase) => {
    const name = `heap-${String(profileIndex++).padStart(5, '0')}.heapprofile`;
    const path = await write(name, profile);
    await log({ type: 'heap-profile', phase, path });
    if (profileIndex > 1) recent.push(path);
    while (recent.length > 20) {
      const expired = recent.shift();
      await rm(expired, { force: true });
      await log({ type: 'profile-pruned', path: expired });
    }
  };
  console.log(`Timeline: ${timeline}`);
  try {
    const pressure = await hostPressure();
    await log({ type: 'start', mode: options.url ? 'new-page' : 'attach', samplingInterval: options.samplingInterval, durationSeconds: options.durationSeconds, heapLimitBytes: 256 * 1024 * 1024, pressure });
    if (options.url && pressure.level >= 2) throw new Error('Host memory pressure >=2: refusing to create a page.');
    let targetId = options.targetId;
    if (options.url) {
      const version = await fetchJson(options.cdp, '/json/version', options.commandTimeoutMs);
      browser = await connect(version.webSocketDebuggerUrl, options.commandTimeoutMs);
      ({ targetId } = await browser.command('Target.createTarget', { url: 'about:blank' }));
      browser.close(); browser = null;
    }
    const targets = await fetchJson(options.cdp, '/json/list', options.commandTimeoutMs);
    const target = targets.find(item => item.id === targetId && item.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('Requested page target was not found.');
    client = await connect(target.webSocketDebuggerUrl, options.commandTimeoutMs);
    if (stopping) throw new Error('Recording interrupted.');
    const initialHeap = await client.command('Runtime.getHeapUsage');
    await log({ type: 'initial-heap', heap: initialHeap });
    if (initialHeap.usedSize > 256 * 1024 * 1024) throw new Error('JS heap exceeded 256 MiB; user page left running');
    await client.command('HeapProfiler.enable');
    await client.command('HeapProfiler.startSampling', {
      samplingInterval: options.samplingInterval,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    heapStarted = true;
    await client.command('Profiler.enable');
    await client.command('Profiler.start');
    cpuStarted = true;
    await client.command('Performance.enable');
    await saveProfile((await client.command('HeapProfiler.getSamplingProfile')).profile, 'initial');
    if (options.url) {
      const pressureBeforeNavigation = await hostPressure();
      if (pressureBeforeNavigation.level >= 2) throw new Error('Host memory pressure >=2: refusing navigation; blank page left open.');
      await client.command('Page.navigate', { url: options.url });
    }
    const deadline = Date.now() + options.durationSeconds * 1000;
    let nextMetrics = 0, nextProfile = Date.now() + 5000;
    while (!stopping && Date.now() < deadline) {
      const now = Date.now();
      if (now >= nextMetrics) {
        nextMetrics = now + 2000;
        const pressure = await hostPressure();
        const heap = await client.command('Runtime.getHeapUsage');
        const dom = await client.command('Memory.getDOMCounters');
        const performance = await client.command('Performance.getMetrics');
        const allowed = new Set(['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents', 'JSEventListeners', 'LayoutCount', 'RecalcStyleCount', 'TaskDuration']);
        await log({ type: 'metrics', heap, dom, pressure, metrics: Object.fromEntries(performance.metrics.filter(item => allowed.has(item.name)).map(item => [item.name, item.value])) });
        if (heap.usedSize > 256 * 1024 * 1024) { reason = 'JS heap exceeded 256 MiB; user page left running'; break; }
        if (options.url && pressure.level >= 2) { reason = 'host memory pressure >=2; user page left running'; break; }
      }
      if (now >= nextProfile) {
        nextProfile = Date.now() + 5000;
        await saveProfile((await client.command('HeapProfiler.getSamplingProfile')).profile, 'periodic');
      }
      await new Promise(accept => setTimeout(accept, 100));
    }
  } catch (error) {
    reason = error.message;
    process.exitCode = 1;
  } finally {
    if (client) client.stopped = true;
    try {
    // Cleanup is bounded too. A finalizer timeout cannot prevent saving the
    // other profiler's result or closing our own debugging connection.
    if (client && cpuStarted) {
      try {
        const { profile } = await client.command('Profiler.stop', {}, { finalizing: true });
        await log({ type: 'cpu-profile', path: await write('final.cpuprofile', profile) });
      } catch { await log({ type: 'finalization-failed', profiler: 'cpu' }).catch(() => {}); }
    }
    if (client && heapStarted) {
      try {
        const { profile } = await client.command('HeapProfiler.stopSampling', {}, { finalizing: true });
        await saveProfile(profile, 'final');
      } catch { await log({ type: 'finalization-failed', profiler: 'heap' }).catch(() => {}); }
    }
    } finally {
      client?.close(); browser?.close();
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    }
    await log({ type: 'stop', reason }).catch(() => {});
    console.log(`Stopped: ${reason}\nSaved timeline: ${timeline}`);
  }
  return { directory, timeline, reason };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else await record(options);
  } catch { console.error('Allocation recorder failed; check arguments, CDP access and output directory permissions. Use --help.'); process.exitCode = 1; }
}
