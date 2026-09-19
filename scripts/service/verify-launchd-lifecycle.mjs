import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Explicit macOS integration gate. Only creates and removes its own unique jobs.
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-launchd-lifecycle-'));
const label = `com.chenyanshan.codex-web.test-${process.pid}`;
const domain = `gui/${process.getuid()}`;
const target = `${domain}/${label}`;
const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
const helperPath = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.restart.plist`);
const statePath = path.join(directory, 'running.json');
const rollbackPath = path.join(directory, 'previous.plist');
const helperLog = path.join(os.homedir(), '.codex-web/logs', `${label}.restart.log`);
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const records = [];
const ctl = (...args) => exec('launchctl', args, { timeout: 15_000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const plist = version => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array>
${[process.execPath, path.join(directory, 'server.mjs'), statePath, version].map(value => `<string>${escape(value)}</string>`).join('')}
</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${escape(path.join(directory, 'out.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(directory, 'err.log'))}</string>
</dict></plist>`;
async function waitForVersion(version, previousPid) {
  const started = Date.now();
  while (Date.now() - started < 65_000) {
    try {
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      if (state.version === version && state.pid !== previousPid) {
        const response = await fetch(`http://127.0.0.1:${state.port}/version.json`, { signal: AbortSignal.timeout(1_000) });
        assert.equal((await response.json()).buildId, version);
        records.push({ version, pid: state.pid, elapsedMs: Date.now() - started });
        return state;
      }
    } catch { /* Launchd may still be replacing the old process. */ }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${version}`);
}
async function schedule(args = []) {
  await exec('/bin/bash', [path.join(root, 'scripts/service/restart-codex-web-launchd-user-detached.sh'), ...args], {
    env: { ...process.env, CODEX_WEB_LAUNCHD_LABEL: label }, timeout: 20_000,
  });
}
async function waitForHelper(code) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const { stdout } = await ctl('print', `${target}.restart`);
    if (stdout.match(/^\s*last exit code = (\d+)$/mu)?.[1] === String(code)) {
      await assert.rejects(fs.stat(helperPath), { code: 'ENOENT' });
      records.push({ helperExitCode: code });
      return;
    }
    await delay(200);
  }
  throw new Error(`Helper did not finish with ${code}`);
}
try {
  // The fixture can trigger the reload from inside its own launchd process.
  // Copies also avoid granting a new background shell access to Documents.
  for (const file of ['restart-codex-web-launchd-user-detached.sh', 'run-codex-web-restart-job.sh']) {
    await fs.copyFile(path.join(root, 'scripts/service', file), path.join(directory, file));
  }
  await fs.writeFile(path.join(directory, 'server.mjs'), `
import http from 'node:http'; import fs from 'node:fs'; import { execFile } from 'node:child_process';
const [statePath, version] = process.argv.slice(2);
if (version === 'broken') process.exit(1);
const server = http.createServer((req, res) => {
  if (req.url === '/reload' && req.method === 'POST') {
    execFile('/bin/bash', [${JSON.stringify(path.join(directory, 'restart-codex-web-launchd-user-detached.sh'))}, '--reload-plist', '--rollback-plist', ${JSON.stringify(rollbackPath)}], { env: { ...process.env, CODEX_WEB_LAUNCHD_LABEL: ${JSON.stringify(label)} } }, error => { res.statusCode = error ? 500 : 202; res.end(); });
  } else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ buildId: version })); }
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(statePath, JSON.stringify({ pid: process.pid, port: server.address().port, version })));
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 1_500));
`);
  await fs.writeFile(plistPath, plist('source'), { mode: 0o600 });
  await ctl('bootstrap', domain, plistPath);
  const original = await waitForVersion('source');
  await fs.copyFile(plistPath, rollbackPath);
  await fs.writeFile(plistPath, plist('dist'));
  const response = await fetch(`http://127.0.0.1:${original.port}/reload`, { method: 'POST', signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 202);
  const updated = await waitForVersion('dist', original.pid);
  await waitForHelper(0);
  await fs.copyFile(plistPath, rollbackPath);
  await fs.writeFile(plistPath, plist('broken'));
  await schedule(['--reload-plist', '--rollback-plist', rollbackPath]);
  const restored = await waitForVersion('dist', updated.pid);
  assert.equal(await fs.readFile(plistPath, 'utf8'), plist('dist'));
  await waitForHelper(2);
  await schedule();
  await waitForVersion('dist', restored.pid);
  await waitForHelper(0);
  console.log(JSON.stringify({ passed: true, records }));
} catch (error) {
  const status = await ctl('print', `${target}.restart`).catch(error => ({ stdout: String(error) }));
  console.error(status.stdout.split('\n').filter(line => /state =|last exit|runs =|pid =/u.test(line)).join('\n'));
  throw error;
} finally {
  await ctl('bootout', `${target}.restart`).catch(() => {});
  await ctl('bootout', target).catch(() => {});
  await fs.rm(helperPath, { force: true });
  await fs.rm(plistPath, { force: true });
  await fs.rm(helperLog, { force: true });
  await fs.rm(directory, { recursive: true, force: true });
}
