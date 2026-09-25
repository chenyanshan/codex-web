#!/usr/bin/env node
/** Opt-in real app-server checks. Never imported by the ordinary test suite. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CodexAppClient } from '../../packages/codex-native-api/src/codex_app_client.js';
import { isolatedEnvironment, optionalCheck, requiredMethods, validateOptionalResponse } from './support.js';
const { values } = parseArgs({ options: {
  'codex-bin': { type: 'string' }, report: { type: 'string' },
  'model-smoke': { type: 'boolean', default: false }, model: { type: 'string' },
  'api-key-env': { type: 'string' }, 'base-url': { type: 'string' },
} });
if (!values['codex-bin'] || !path.isAbsolute(values['codex-bin'])) throw new Error('--codex-bin must be an explicit absolute path');
const smoke = values['model-smoke'];
if (smoke && (!values.model || !values['api-key-env'] || !values['base-url'])) throw new Error('Model smoke requires --model, --api-key-env, --base-url; consumes real inference quota');
if (!smoke && (values.model || values['api-key-env'] || values['base-url'])) throw new Error('Credential/model options require explicit --model-smoke');
const bin = fs.realpathSync(values['codex-bin']);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-compat-'));
const home = path.join(temp, 'home');
const cwd = path.join(temp, 'project');
fs.mkdirSync(home); fs.mkdirSync(cwd);
const env = isolatedEnvironment(home);
const checks: Array<{ name: string; status: string; detail?: string }> = [];
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), binaryPath: bin, binarySha256: createHash('sha256').update(fs.readFileSync(bin)).digest('hex'), nodeVersion: process.version, isolation: { temporaryHome: true, temporaryProject: true, loopbackEphemeralPort: true, copiedCredentials: false }, inference: smoke ? { requested: true, model: values.model, credentials: 'explicit environment variable', quotaImpact: 'one real model turn' } : { requested: false, status: 'not-run' }, checks };
let client: CodexAppClient | undefined;
let activeCheck = 'version/schema generation';
async function check(name: string, run: () => Promise<unknown>) {
  activeCheck = name;
  await run(); checks.push({ name, status: 'passed' });
}
try {
  report.version = execFileSync(bin, ['--version'], { env, encoding: 'utf8', timeout: 15_000 }).trim();
  const schema = path.join(temp, 'schema');
  execFileSync(bin, ['app-server', 'generate-ts', '--out', schema], { env, timeout: 30_000, stdio: 'pipe' });
  const requests = fs.readFileSync(path.join(schema, 'ClientRequest.ts'), 'utf8');
  await check('stable schema required methods', async () => {
    for (const method of requiredMethods) assert.ok(requests.includes(`"${method}"`), `Missing required method: ${method}`);
  });
  if (smoke) {
    const keyName = values['api-key-env']!;
    assert.match(keyName, /^[A-Za-z_][A-Za-z0-9_]*$/);
    assert.ok(process.env[keyName], 'Credential environment variable is empty');
    env[keyName] = process.env[keyName];
    const url = new URL(values['base-url']!);
    assert.ok(!url.username && !url.password && !url.search, 'Base URL cannot contain embedded credentials/query');
    assert.ok(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)), 'Require HTTPS or loopback HTTP provider');
    fs.writeFileSync(path.join(home, 'config.toml'), `model_provider = "compat_smoke"\nmodel = ${JSON.stringify(values.model)}\n[model_providers.compat_smoke]\nname = "Explicit compatibility smoke"\nbase_url = ${JSON.stringify(url.toString())}\nenv_key = ${JSON.stringify(keyName)}\nwire_api = "responses"\n`, { mode: 0o600 });
  }
  client = new CodexAppClient({ codexCliBin: bin, spawnImpl: ((command: string, args: string[], options: any) => spawn(command, args, { ...options, env, cwd })) as typeof spawn });
  await check('initialize real loopback app-server', () => client!.start());
  report.port = client.port;
  let threadId = '';
  await check('thread/start', async () => {
    const result = await client!.request('thread/start', { cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: false });
    assert.equal(typeof result.thread.id, 'string'); threadId = result.thread.id;
  });
  await check('thread/read loaded snapshot', async () => {
    const result = await client!.request('thread/read', { threadId, includeTurns: false });
    assert.equal(result.thread.id, threadId);
  });
  if (!smoke) checks.push({ name: 'thread/resume persisted history', status: 'not-run', detail: 'New threads have no persisted history until a turn; exercised by explicit model smoke.' });
  await check('thread/list', async () => {
    const result = await client!.request('thread/list', { limit: 5 }); assert.ok(Array.isArray(result.data));
  });
  await check('config/read', async () => {
    const result = await client!.request('config/read', { cwd, includeLayers: false }); assert.ok(result.config);
  });
  activeCheck = 'skills/list';
  checks.push(await optionalCheck('skills/list', async () => validateOptionalResponse('skills/list', await client!.request('skills/list', { cwds: [cwd], forceReload: false }))));
  activeCheck = 'mcpServerStatus/list';
  checks.push(await optionalCheck('mcpServerStatus/list', async () => validateOptionalResponse('mcpServerStatus/list', await client!.request('mcpServerStatus/list', { limit: 5 }))));
  if (smoke) await check('real model turn + official persisted history', async () => {
    const result = await client!.startTurn({ threadId, cwd, inputText: 'Reply exactly CODEX_COMPAT_OK. Do not use tools.', model: values.model, effort: 'low', sandboxMode: 'read-only', approvalPolicy: 'never', timeoutMs: 90_000 });
    assert.equal(result.status, 'completed');
    assert.match(result.outputText, /CODEX_COMPAT_OK/);
    const snapshot = await client!.request('thread/read', { threadId, includeTurns: true });
    assert.ok(snapshot.thread.turns.some((turn: any) => turn.status === 'completed'));
    await client!.unsubscribeThread(threadId);
    const resumed = await client!.request('thread/resume', { threadId });
    assert.equal(resumed.thread.id, threadId);
    assert.ok(resumed.thread.turns.some((turn: any) => turn.status === 'completed'));
  });
  await check('thread/unsubscribe', async () => { await client!.unsubscribeThread(threadId); });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  // Never dump server/provider errors: they may include configuration or credentials.
  report.failure = { check: activeCheck, type: error instanceof Error ? error.name : 'Error', code: (error as any)?.code ?? null, rpcCode: (error as any)?.rpcCode ?? null };
  process.exitCode = 1;
} finally {
  if (client) await client.stop();
  fs.rmSync(temp, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.report) fs.writeFileSync(values.report, json, { mode: 0o600 });
  process.stdout.write(json);
}
