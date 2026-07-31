import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadServiceConfig } from '../src/config.js';

test('service config defaults to LAN-facing binding and external state paths', () => {
  const config = loadServiceConfig({ env: {}, homeDir: '/Users/alice' });

  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 43210);
  assert.equal(config.defaultCwd, '/Users/alice');
  assert.equal(config.stateDir, '/Users/alice/.codex-web');
  assert.equal(config.authPath, '/Users/alice/.codex-web/auth.json');
  assert.equal(config.reportsDir, '/Users/alice/.codex-web/reports');
  assert.equal(config.reportIndexPath, '/Users/alice/.codex-web/report-index.json');
  assert.equal(config.runtimeContextDir, '/Users/alice/.codex-web/runtime-context/sessions');
  assert.equal(config.envPath, '/Users/alice/.config/codex-web/service.env');
  assert.equal(config.publicSharesEnabled, false);
  assert.equal(config.publicShareTtlSeconds, 86_400);
  assert.equal(config.managedStorageMaxBytes, 2 * 1024 * 1024 * 1024);
  assert.equal(config.projectUploadMaxBytes, 512 * 1024 * 1024);
  assert.equal(config.uploadTtlSeconds, 7 * 86_400);
  assert.equal(config.turnAttachmentTtlSeconds, 30 * 86_400);
  assert.equal(config.reportTtlSeconds, 365 * 86_400);
  assert.equal(config.runtimeContextTtlSeconds, 30 * 86_400);
  assert.equal(config.timelineMaxEntriesPerSession, 500);
  assert.equal(config.timelineMaxBytes, 16 * 1024 * 1024);
});

test('service config accepts explicit local-only host and port', () => {
  const config = loadServiceConfig({
    env: {
      CODEX_WEB_HOST: '127.0.0.1',
      CODEX_WEB_PORT: '45678',
      CODEX_WEB_DEFAULT_CWD: '/workspace',
      CODEX_REAL_BIN: '/opt/homebrew/bin/codex',
      CODEX_WEB_PUBLIC_SHARES_ENABLED: 'true',
      CODEX_WEB_PUBLIC_SHARE_TTL_SECONDS: '9999999',
      CODEX_WEB_MANAGED_STORAGE_MAX_BYTES: '123456',
      CODEX_WEB_PROJECT_UPLOAD_MAX_BYTES: '654321',
      CODEX_WEB_UPLOAD_TTL_SECONDS: '1234',
      CODEX_WEB_TIMELINE_MAX_ENTRIES_PER_SESSION: '42',
      CODEX_WEB_TIMELINE_MAX_BYTES: '98765',
      CODEX_WEB_RUNTIME_CONTEXT_DIR: '/runtime/codex-web/contexts',
    },
    homeDir: '/Users/alice',
  });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 45678);
  assert.equal(config.defaultCwd, '/workspace');
  assert.equal(config.codexBin, '/opt/homebrew/bin/codex');
  assert.equal(config.publicSharesEnabled, true);
  assert.equal(config.publicShareTtlSeconds, 604_800);
  assert.equal(config.managedStorageMaxBytes, 123_456);
  assert.equal(config.projectUploadMaxBytes, 654_321);
  assert.equal(config.uploadTtlSeconds, 1_234);
  assert.equal(config.timelineMaxEntriesPerSession, 42);
  assert.equal(config.timelineMaxBytes, 98_765);
  assert.equal(config.runtimeContextDir, '/runtime/codex-web/contexts');
});

test('service config reads the env file selected by CODEX_WEB_ENV_PATH', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-web-config-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const envPath = path.join(tempDir, 'scheduled-task.env');
  fs.writeFileSync(envPath, [
    'CODEX_WEB_HOST=127.0.0.1',
    'CODEX_WEB_PORT=45679',
    `CODEX_WEB_STATE_DIR=${path.join(tempDir, 'state')}`,
    '',
  ].join('\n'));

  const config = loadServiceConfig({
    env: { CODEX_WEB_ENV_PATH: envPath },
    homeDir: '/Users/ignored',
  });

  assert.equal(config.envPath, envPath);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 45679);
  assert.equal(config.stateDir, path.join(tempDir, 'state'));
});

test('an explicit envPath option takes precedence over CODEX_WEB_ENV_PATH', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-web-config-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const explicitPath = path.join(tempDir, 'explicit.env');
  fs.writeFileSync(explicitPath, 'CODEX_WEB_PORT=45680\n');

  const config = loadServiceConfig({
    env: { CODEX_WEB_ENV_PATH: path.join(tempDir, 'ignored.env') },
    homeDir: '/Users/ignored',
    envPath: explicitPath,
  });

  assert.equal(config.envPath, explicitPath);
  assert.equal(config.port, 45680);
});
