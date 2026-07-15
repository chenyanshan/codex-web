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
  assert.match(script, /StartInterval/u);
  assert.match(script, /launchctl bootstrap "\$\{LAUNCHD_DOMAIN\}" "\$\{HELPER_PLIST_PATH\}"/u);
  assert.match(script, /launchctl kickstart -k "\$\{LAUNCHD_DOMAIN\}\/\$\{HELPER_LABEL\}"/u);
  assert.match(script, /launchctl kickstart -k %s/u);
  assert.match(script, /shell_escape "\$\{LAUNCHD_TARGET\}"/u);
  assert.match(script, /echo "scheduled detached restart:/u);
  assert.doesNotMatch(script, /RESTART_SCRIPT/u);
  assert.doesNotMatch(script, /scripts\/service\/restart-codex-web-launchd-user\.sh/u);
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
  assert.match(script, /--conditions=development --import tsx packages\/codex-web\/src\/cli\.ts serve/u);
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
  assert.match(script, /install_bundled_skill "codex-mobile-report"/u);
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
