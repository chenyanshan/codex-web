import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const execFileAsync = promisify(execFile);

async function readScript(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('launchd service scripts use the chenyanshan service label', async () => {
  const scriptPaths = [
    'scripts/service/install-codex-web-launchd-user.sh',
    'scripts/service/status-codex-web-launchd-user.sh',
    'scripts/service/restart-codex-web-launchd-user.sh',
    'scripts/service/logs-codex-web-launchd-user.sh',
    'scripts/service/restart-codex-web-launchd-user-detached.sh',
    'scripts/service/stop-codex-web-launchd-user.sh',
    'scripts/service/uninstall-codex-web-launchd-user.sh',
  ];

  for (const scriptPath of scriptPaths) {
    const script = await readScript(scriptPath);
    assert.match(script, /com\.chenyanshan\.codex-web/u);
  }
});

test('launchd restart keeps the job loaded so KeepAlive can recover it', async () => {
  const script = await readScript('scripts/service/restart-codex-web-launchd-user.sh');

  assert.doesNotMatch(script, /launchctl bootout/u);
  assert.match(script, /launchctl print "\$\{LAUNCHD_TARGET\}"/u);
  assert.match(script, /launchctl bootstrap "\$\{LAUNCHD_DOMAIN\}" "\$\{PLIST_PATH\}"/u);
  assert.match(script, /launchctl kickstart -k "\$\{LAUNCHD_TARGET\}"/u);
});

test('launchd detached restart schedules a one-shot helper before killing the service', async () => {
  const script = await readScript('scripts/service/restart-codex-web-launchd-user-detached.sh');

  assert.match(script, /HELPER_LABEL="\$\{LABEL\}\.restart"/u);
  assert.doesNotMatch(script, /StartInterval/u);
  assert.match(script, /launchctl bootstrap "\$\{LAUNCHD_DOMAIN\}" "\$\{HELPER_PLIST_PATH\}"/u);
  assert.doesNotMatch(script, /launchctl kickstart -k/u);
  assert.match(script, /run-codex-web-restart-job\.sh/u);
  assert.match(script, /<string>\/bin\/bash<\/string>/u);
  assert.match(script, /restart already in progress/u);
  assert.match(script, /echo "scheduled detached restart:/u);
  assert.doesNotMatch(script, /RESTART_SCRIPT/u);
  assert.doesNotMatch(script, /scripts\/service\/restart-codex-web-launchd-user\.sh/u);
});

async function restartHarness(t: test.TestContext, desired: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-web-restart-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  await mkdir(bin);
  const statePath = path.join(directory, 'state.json');
  const plistPath = path.join(directory, 'service.plist');
  const backupPath = path.join(directory, 'backup.plist');
  const helperPath = path.join(directory, 'helper.plist');
  await writeFile(plistPath, desired);
  await writeFile(backupPath, 'old');
  await writeFile(helperPath, 'one-shot');
  await writeFile(statePath, JSON.stringify({ phase: 'running', version: 'old', pid: 100, nextPid: 101, attempts: 0, transitions: 0, commands: [] }));
  const fakeLaunchctl = `#!${process.execPath}
const fs = require('node:fs');
const file = process.env.CODEX_RESTART_TEST_STATE;
const state = JSON.parse(fs.readFileSync(file));
const args = process.argv.slice(2), command = args[0];
state.commands.push(args); let code = 0;
if (command === 'bootout') { state.phase = 'unloading'; state.transitions = 4; }
if (command === 'bootstrap') {
  state.attempts++;
  if (state.attempts < 3) code = 37;
  else { state.version = fs.readFileSync(args[2], 'utf8'); state.phase = state.version === 'broken' ? 'crashed' : 'running'; state.pid = state.nextPid++; }
}
if (command === 'kickstart' && state.phase !== 'running') code = 37;
if (command === 'print') {
  if (state.phase === 'unloading' && state.transitions-- <= 0) state.phase = 'absent';
  if (state.phase === 'absent') code = 113;
  else if (state.phase !== 'crashed') console.log(' state = running\\n pid = ' + state.pid);
  else console.log(' state = waiting');
}
fs.writeFileSync(file, JSON.stringify(state)); process.exit(code);
`;
  await writeFile(path.join(bin, 'launchctl'), fakeLaunchctl, { mode: 0o700 });
  await writeFile(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await writeFile(path.join(bin, 'plutil'), `#!${process.execPath}\nconst fs = require('node:fs'); process.exit(fs.readFileSync(process.argv[3], 'utf8') === 'invalid' ? 1 : 0);\n`, { mode: 0o700 });
  return {
    statePath, plistPath, helperPath,
    run: () => execFileAsync('/bin/bash', [path.join(repoRoot, 'scripts/service/run-codex-web-restart-job.sh'), 'gui/501', 'test-service', plistPath, 'reload', backupPath, helperPath], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_RESTART_TEST_STATE: statePath },
    }),
  };
}

test('detached worker survives lingering old jobs and transient bootstrap failures', async (t) => {
  const fixture = await restartHarness(t, 'new');
  const result = await fixture.run();
  const state = JSON.parse(await readFile(fixture.statePath, 'utf8'));
  assert.equal(state.version, 'new');
  assert.equal(state.phase, 'running');
  assert.equal(state.attempts, 3);
  assert.match(result.stdout, /running: gui\/501\/test-service pid=101/u);
  assert.equal(state.commands.filter((args: string[]) => args[0] === 'bootout').length, 1);
  assert.equal(state.commands.some((args: string[]) => args.includes('-k')), false);
  await assert.rejects(stat(fixture.helperPath), { code: 'ENOENT' });
});

test('detached worker restores the previous plist when replacement cannot stay running', async (t) => {
  const fixture = await restartHarness(t, 'broken');
  await assert.rejects(fixture.run(), { code: 2 });
  const state = JSON.parse(await readFile(fixture.statePath, 'utf8'));
  assert.equal(state.phase, 'running');
  assert.equal(state.version, 'old');
  assert.equal(await readFile(fixture.plistPath, 'utf8'), 'old');
});

test('invalid replacement never unloads the running service', async (t) => {
  const fixture = await restartHarness(t, 'invalid');
  await assert.rejects(fixture.run(), { code: 1 });
  const state = JSON.parse(await readFile(fixture.statePath, 'utf8'));
  assert.deepEqual(state.commands, []);
  assert.equal(state.phase, 'running');
});

test('launchd install does not unload a running Codex Web service', async () => {
  const script = await readScript('scripts/service/install-codex-web-launchd-user.sh');

  assert.doesNotMatch(script, /launchctl bootout/u);
  assert.match(script, /if launchctl print "\$\{LAUNCHD_TARGET\}"/u);
  assert.match(script, /launchctl bootstrap "\$\{LAUNCHD_DOMAIN\}" "\$\{PLIST_PATH\}"/u);
  assert.match(script, /launchctl kickstart -k "\$\{LAUNCHD_TARGET\}"/u);
});

test('launchd install runs the Codex Web server directly under node', async () => {
  const script = await readScript('scripts/service/install-codex-web-launchd-user.sh');

  assert.match(script, /NODE_BIN="\$\(command -v node\)"/u);
  assert.match(script, /SERVICE_MODE="\$\{CODEX_WEB_SERVICE_MODE:-dist\}"/u);
  assert.match(script, /packages\/codex-web\/dist\/cli\.js/u);
  assert.match(script, /--conditions=development --import tsx packages\/codex-web\/src\/cli\.ts/u);
  assert.match(script, /npm run build && npm run test:built-public/u);
  assert.match(script, /--reload-plist/u);
  assert.match(script, /service-backups/u);
  assert.doesNotMatch(script, /npm run serve --workspace packages\/codex-web/u);
});

test('macOS installer script installs dependencies, configures password, and optionally installs launchd', async () => {
  const script = await readScript('scripts/install/install-codex-web-macos.sh');

  assert.match(script, /uname -s/u);
  assert.match(script, /npm install/u);
  assert.match(script, /CODEX_WEB_PASSWORD="\$\{PASSWORD\}" npm run codex-web -- auth set-password/u);
  assert.match(script, /--password-stdin/u);
  assert.doesNotMatch(script, /--password\)/u);
  assert.doesNotMatch(script, /CODEX_WEB_INSTALL_PASSWORD/u);
  assert.match(script, /install_bundled_skill "codex-web-user-context"/u);
  assert.match(script, /install-codex-web-launchd-user\.sh/u);
  assert.match(script, /--autostart/u);
});

test('launchd helpers protect logs and provide explicit stop and uninstall lifecycles', async () => {
  const [install, logs, stop, uninstall] = await Promise.all([
    readScript('scripts/service/install-codex-web-launchd-user.sh'),
    readScript('scripts/service/logs-codex-web-launchd-user.sh'),
    readScript('scripts/service/stop-codex-web-launchd-user.sh'),
    readScript('scripts/service/uninstall-codex-web-launchd-user.sh'),
  ]);

  assert.match(install, /umask 077/u);
  assert.match(install, /chmod 600 "\$\{STDOUT_LOG\}" "\$\{STDERR_LOG\}"/u);
  assert.match(install, /ROTATION_LABEL="\$\{LABEL\}\.logrotate"/u);
  assert.match(install, /rotate-codex-web-logs\.sh/u);
  assert.match(install, /<key>StartInterval<\/key>/u);
  assert.match(install, /CODEX_WEB_LOG_MAX_BYTES/u);
  assert.match(logs, /chmod 600 "\$\{STDOUT_LOG\}" "\$\{STDERR_LOG\}"/u);
  assert.match(stop, /launchctl disable/u);
  assert.match(stop, /launchctl bootout/u);
  assert.match(uninstall, /launchctl bootout/u);
  assert.match(uninstall, /rm "\$\{PLIST_PATH\}"/u);
  assert.match(uninstall, /ROTATION_PLIST_PATH/u);
  assert.match(uninstall, /ROTATION_TARGET/u);
  assert.match(uninstall, /preserved state/u);
});

test('log rotation keeps bounded private generations without restarting the service', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'codex-web-logrotate-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const logDir = path.join(homeDir, '.codex-web', 'logs');
  const stdoutLog = path.join(logDir, 'codex-web.stdout.log');
  const unrelatedLog = path.join(logDir, 'other.log');
  const scriptPath = path.join(repoRoot, 'scripts/service/rotate-codex-web-logs.sh');
  await mkdir(logDir, { recursive: true });
  await writeFile(stdoutLog, 'first-generation');
  await writeFile(unrelatedLog, 'unrelated-content');
  await chmod(stdoutLog, 0o644);

  const env = {
    ...process.env,
    HOME: homeDir,
    CODEX_WEB_LOG_MAX_BYTES: '8',
    CODEX_WEB_LOG_GENERATIONS: '2',
  };
  await execFileAsync('/bin/bash', [scriptPath], { env });
  assert.equal(await readFile(stdoutLog, 'utf8'), '');
  assert.equal(await readFile(`${stdoutLog}.1`, 'utf8'), 'first-generation');
  assert.equal((await stat(stdoutLog)).mode & 0o777, 0o600);
  assert.equal((await stat(`${stdoutLog}.1`)).mode & 0o777, 0o600);

  await writeFile(stdoutLog, 'second-generation');
  await execFileAsync('/bin/bash', [scriptPath], { env });
  assert.equal(await readFile(`${stdoutLog}.1`, 'utf8'), 'second-generation');
  assert.equal(await readFile(`${stdoutLog}.2`, 'utf8'), 'first-generation');
  assert.equal(await readFile(unrelatedLog, 'utf8'), 'unrelated-content');
});
