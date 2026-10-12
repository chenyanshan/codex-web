// Local, synthetic soak only. Run explicitly; never part of the fast test suite.
// node scripts/diagnostics/browser-soak.mjs --duration-seconds=1800 --output=test-results/soak
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openSync, writeSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.findIndex(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
  return index < 0 ? fallback : args[index].includes('=') ? args[index].slice(name.length + 3) : args[index + 1];
};
const duration = Number(option('duration-seconds', 1800));
const cycleSeconds = Number(option('cycle-seconds', 30));
if (!(duration >= 10 && duration <= 7200 && cycleSeconds >= 2)) throw new Error('duration must be 10–7200s and cycle >=2s');
const publicRoot = path.resolve(option('public-root', fileURLToPath(new URL('../../packages/codex-web/public/', import.meta.url))));
const sourceHash = createHash('sha256');
for (const name of (await readdir(publicRoot, { recursive: true })).sort()) {
  const filename = path.join(publicRoot, name);
  if ((await stat(filename)).isFile()) sourceHash.update(name).update(await readFile(filename));
}
const runtime = { publicRoot, publicTreeSha256: sourceHash.digest('hex'), browserVersion: null, gitHead: null, gitStatus: null };
try {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  runtime.gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  runtime.gitStatus = execFileSync('git', ['status', '--short'], { cwd: repo, encoding: 'utf8' }).trim();
} catch {}
const output = path.resolve(option('output', `test-results/soak-${Date.now()}`));
await mkdir(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rssLimit = Number(option('browser-rss-limit-mib', 2048)) * 1024 ** 2, heapLimit = 1024 ** 3;
if (!(rssLimit >= 256 * 1024 ** 2 && rssLimit <= 4096 * 1024 ** 2)) throw new Error('browser RSS limit must be 256–4096 MiB');
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const fixture = spawn(process.execPath, [fileURLToPath(new URL('../../packages/codex-web/test/browser/fixture-server.mjs', import.meta.url)), `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let fixtureLog = '';
for (const stream of [fixture.stdout, fixture.stderr]) stream.on('data', chunk => { fixtureLog = (fixtureLog + chunk).slice(-10000); });
let server, browser, watchdog, stopped = false, failure = null;
const started = Date.now(), samples = [], snapshots = [], errors = [], trackers = [];
const token = 'isolated-soak-fixture';
const operations = { cycles: 0, reloads: 0, activations: 0, injectedEvents: 0, deliveredEvents: 0 };
const hostPressure = [];
function checkHostPressure(phase) {
  if (process.platform !== 'darwin') return;
  let level = null;
  try { level = Number(execFileSync('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8', timeout: 2000 }).trim()); } catch {}
  hostPressure.push({ seconds: (Date.now() - started) / 1000, phase, level });
  if (level !== null && level >= 2) throw new Error(`host macOS memory pressure guard: level ${level} (${phase}); no user process was stopped`);
}
process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });
function browserTreeRss(pid) {
  // ps RSS is summed across descendants: shared pages may be counted repeatedly.
  // No renderer-to-tab mapping is asserted.
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8', timeout: 3000 }).trim().split('\n').map(line => line.trim().split(/\s+/u).map(Number));
    const selected = new Set([pid]);
    for (let pass = 0; pass < rows.length; pass++) {
      let added = false;
      for (const [child, parent] of rows) if (selected.has(parent) && !selected.has(child)) { selected.add(child); added = true; }
      if (!added) break;
    }
    return rows.reduce((sum, [child, , rss]) => sum + (selected.has(child) ? rss * 1024 : 0), 0);
  } catch { return null; }
}
function track(page, tab) {
  const state = { tab, total: 0, reads: 0, peakReadsPerSecond: 0, peakActive: 0, peakReadActive: 0, peakSse: 0, failed: 0, statuses: {}, active: new Map(), second: -1, secondReads: 0 };
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    const read = /^\/api\/sessions\/[^/]+\/(?:status|timeline)$/u.test(pathname);
    state.active.set(request, { read, sse: /\/events$/u.test(pathname) }); state.total++;
    if (read) {
      state.reads++;
      const second = Math.floor((Date.now() - started) / 1000);
      if (state.second !== second) { state.second = second; state.secondReads = 0; }
      state.peakReadsPerSecond = Math.max(state.peakReadsPerSecond, ++state.secondReads);
    }
    state.peakActive = Math.max(state.peakActive, state.active.size);
    state.peakReadActive = Math.max(state.peakReadActive, [...state.active.values()].filter(value => value.read).length);
    state.peakSse = Math.max(state.peakSse, [...state.active.values()].filter(value => value.sse).length);
  });
  page.on('response', response => { state.statuses[response.status()] = (state.statuses[response.status()] || 0) + 1; });
  page.on('requestfinished', request => state.active.delete(request));
  page.on('requestfailed', request => { state.active.delete(request); state.failed++; });
  page.on('pageerror', error => { if (errors.length < 100) errors.push({ tab, message: error.message, seconds: (Date.now() - started) / 1000 }); });
  page.on('crash', () => { failure = `tab ${tab} crashed`; stopped = true; });
  trackers.push(state);
  return state;
}
function requestStats(state) {
  const { active, ...result } = state;
  return { ...result, active: active.size, activeReads: [...active.values()].filter(value => value.read).length, activeSse: [...active.values()].filter(value => value.sse).length };
}
try {
  checkHostPressure('startup');
  for (let tries = 0; ; tries++) {
    if (fixture.exitCode !== null) throw new Error(`fixture exited: ${fixtureLog}`);
    try { if ((await fetch(`${origin}/healthz`)).ok) break; } catch {}
    if (tries > 100) throw new Error('fixture startup timed out');
    await sleep(100);
  }
  server = await chromium.launchServer({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--disable-extensions'] });
  watchdog = setInterval(() => {
    try { checkHostPressure('watchdog'); }
    catch (error) {
      failure = error.message; stopped = true;
      void server.kill().catch(() => {});
      return;
    }
    const rss = browserTreeRss(server.process().pid);
    if (rss !== null && rss > rssLimit) {
      failure = `browser tree RSS watchdog limit: ${rss}`; stopped = true;
      void server.kill().catch(() => {});
    }
  }, 2000);
  watchdog.unref();
  browser = await chromium.connect(server.wsEndpoint());
  runtime.browserVersion = browser.version();
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(15000);
  // Deny all non-fixture traffic even if a fixture response accidentally references it.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__test/') || url.pathname === '/healthz') return route.continue();
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filename = path.resolve(publicRoot, name);
    if (!filename.startsWith(publicRoot + path.sep)) return route.abort('blockedbyclient');
    try {
      const body = await readFile(filename);
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
      return route.fulfill({ status: 200, contentType: mime[path.extname(filename)] || 'application/octet-stream', body });
    } catch { return route.fulfill({ status: 404, body: 'fixture static file not found' }); }
  });
  await context.addInitScript(token => {
    localStorage.setItem('codexWebToken', token); localStorage.setItem('codexWebLanguage', 'en');
    // Headless Chrome may report every page visible. Drive the application's
    // visibility lifecycle explicitly; this is a test hook, not OS suspension.
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    globalThis.__soakVisibility = value => {
      if (hidden === value) return;
      hidden = value; document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event(hidden ? 'blur' : 'focus'));
    };
  }, token);
  const pages = [], clients = [];
  for (let tab = 0; tab < 2; tab++) {
    const page = await context.newPage(); track(page, tab); pages.push(page);
    const client = await context.newCDPSession(page); clients.push(client);
    await client.send('Performance.enable'); await client.send('HeapProfiler.enable');
    await page.goto(origin); await page.locator('button[data-session-id="session_browser_fixture"]').click();
  }
  async function sample(phase, gc = false) {
    checkHostPressure(phase);
    const rss = browserTreeRss(server.process().pid);
    if (rss !== null && rss > rssLimit) throw new Error(`browser tree RSS safety limit: ${rss}`);
    for (let tab = 0; tab < pages.length; tab++) {
      if (gc) await clients[tab].send('HeapProfiler.collectGarbage');
      const metrics = Object.fromEntries((await clients[tab].send('Performance.getMetrics')).metrics.map(value => [value.name, value.value]));
      const dom = await clients[tab].send('Memory.getDOMCounters');
      const row = { seconds: (Date.now() - started) / 1000, phase, tab, gc, heapUsed: metrics.JSHeapUsedSize, heapTotal: metrics.JSHeapTotalSize, nodes: dom.nodes, documents: dom.documents, listeners: dom.jsEventListeners, browserTreeRss: rss, visibility: await pages[tab].evaluate(() => document.visibilityState), ...requestStats(trackers[tab]) };
      samples.push(row);
      await writeFile(path.join(output, 'samples.json'), JSON.stringify(samples, null, 2));
      if (row.heapUsed > heapLimit) throw new Error(`tab ${tab} heap safety limit: ${row.heapUsed}`);
    }
  }
  async function snapshot(label) {
    await sample(`before-${label}-snapshot`, true);
    for (let tab = 0; tab < clients.length; tab++) {
      const filename = `${label}-tab-${tab}.heapsnapshot`, fd = openSync(path.join(output, filename), 'w');
      let bytes = 0, truncated = false;
      const chunk = ({ chunk }) => { bytes += Buffer.byteLength(chunk); if (bytes <= 256 * 1024 ** 2) writeSync(fd, chunk); else truncated = true; };
      clients[tab].on('HeapProfiler.addHeapSnapshotChunk', chunk);
      try { await clients[tab].send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); }
      finally { clients[tab].off('HeapProfiler.addHeapSnapshotChunk', chunk); closeSync(fd); }
      snapshots.push({ filename, bytes, truncated });
      if (truncated) throw new Error('snapshot exceeded 256MiB safety cap; partial snapshot retained');
    }
  }
  const emit = async event => {
    const response = await fetch(`${origin}/__test/turn-event`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ turnId: 'turn_browser_active', ...event }) });
    if (!response.ok) throw new Error(`event injection failed: ${response.status}`);
    const result = await response.json();
    operations.injectedEvents++; operations.deliveredEvents += result.delivered;
    if (!result.delivered) throw new Error('synthetic event had no live SSE recipients');
  };
  await snapshot('initial');
  const runStarted = Date.now(); let cycle = 0, middle = false, nextCycle = 0;
  while (!stopped && Date.now() - runStarted < duration * 1000) {
    if (Date.now() - runStarted >= nextCycle) {
      cycle++; operations.cycles++;
      for (const page of pages) {
        for (const other of pages) await other.evaluate(hidden => globalThis.__soakVisibility(hidden), other !== page);
        await page.bringToFront(); operations.activations++;
        await page.locator('button[data-session-id="session_browser_idle"]').click();
        await page.locator('button[data-session-id="session_browser_fixture"]').click();
      }
      let text = '';
      for (let delta = 0; delta < 64 && !stopped; delta++) {
        const part = `Cycle ${cycle}, fragment ${delta}: bounded synthetic assistant output. `.repeat(32) + '\n';
        text += part;
        await emit({ type: 'assistant.delta', itemId: `soak-${cycle}`, phase: 'final_answer', text, delta: part });
        await sleep(20);
      }
      await sample(`cycle-${cycle}-long-output`);
      await emit({ type: 'assistant.final', itemId: `soak-${cycle}`, phase: 'final_answer', text });
      await emit({ type: 'turn.completed', status: 'completed' });
      await sleep(250);
      for (const page of pages) await page.locator('button[data-session-id="session_browser_idle"]').click();
      await sample(`cycle-${cycle}-complete-switch`, true);
      // Reload one tab periodically; the other remains alive for retention evidence.
      if (cycle % 3 === 0) { await pages[1].reload(); operations.reloads++; }
      nextCycle = Date.now() - runStarted + cycleSeconds * 1000;
    }
    if (!middle && Date.now() - runStarted >= duration * 500) { await snapshot('middle'); middle = true; }
    await sample('periodic');
    await sleep(Math.min(5000, Math.max(100, duration * 1000 - (Date.now() - runStarted))));
  }
  if (!middle && !stopped) await snapshot('middle');
  if (!stopped) await snapshot('final');
} catch (error) { failure ||= error.stack || String(error); process.exitCode = 1; }
finally {
  clearInterval(watchdog);
  const columns = ['seconds', 'phase', 'tab', 'gc', 'heapUsed', 'heapTotal', 'nodes', 'documents', 'listeners', 'browserTreeRss', 'visibility', 'total', 'reads', 'active', 'activeReads', 'activeSse', 'peakReadsPerSecond', 'peakReadActive', 'peakSse', 'failed'];
  await writeFile(path.join(output, 'samples.csv'), [columns.join(','), ...samples.map(row => columns.map(key => JSON.stringify(row[key] ?? null)).join(','))].join('\n'));
  const summary = { durationRequestedSeconds: duration, elapsedSeconds: (Date.now() - started) / 1000, origin, runtime, hostPressure, stopped, failure, errors, operations, snapshots, sampleCount: samples.length, requests: trackers.map(requestStats), limits: { perTabJsHeapBytes: heapLimit, browserTreeRssBytes: rssLimit }, limitations: ['Synthetic local fixture; not production, not proof of the historical crash cause.', 'Heap snapshots and forced GC perturb timing. Persistent tab 0 and reloaded tab 1 must be compared separately.', 'Process RSS is the dedicated browser tree sum, not per-tab memory; shared pages can be double-counted.', 'Visibility/focus transitions use an isolated page test hook because headless tabs remain natively visible; not mobile OS suspension.', 'Fixture completion events do not persist a new runtime history; session switching restores the fixed fixture history.', 'Request peaks use one-second buckets and request counts include canceled requests; SSE counts derive from active event requests.'] };
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(path.join(output, 'fixture.log'), fixtureLog);
  await browser?.close().catch(() => {}); await server?.close().catch(() => {}); fixture.kill('SIGTERM');
  console.log(JSON.stringify({ output, ...summary }, null, 2));
}
