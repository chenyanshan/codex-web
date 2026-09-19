import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Public shell and unauthenticated rejection checks only: no local tokens or service.env.
const base = 'http://127.0.0.1:43210';
const phase = process.argv[2] || 'check';
const root = await fetch(base);
assert.equal(root.status, 200);
const html = await root.text();
const buildId = html.match(/\/app\.js\?v=([a-f0-9]+)/u)?.[1];
assert.ok(buildId);
const version = await (await fetch(`${base}/version.json`)).json();
const launchd = execFileSync('launchctl', ['print', `gui/${process.getuid()}/com.chenyanshan.codex-web`], { encoding: 'utf8' });
const mode = launchd.includes('packages/codex-web/dist/cli.js') ? 'dist' : launchd.includes('packages/codex-web/src/cli.ts') ? 'source' : 'unknown';
assert.notEqual(mode, 'unknown');
const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/[^"?]+\.(?:js|css))(?:\?[^" ]*)?"/gu)].map(match => match[1]))];
const statuses = [];
for (const asset of assets) {
  const response = await fetch(`${base}${asset}?v=${buildId}`);
  assert.equal(response.status, 200);
  const content = await response.text();
  const root = mode === 'dist' ? 'packages/codex-web/dist/public' : 'packages/codex-web/public';
  const expected = (await fs.readFile(root + asset, 'utf8')).replaceAll('__CODEX_WEB_BUILD_ID__', buildId);
  assert.equal(content, expected, `${asset} must match the current build`);
  statuses.push({ path: asset, status: response.status, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') });
}
const app = await (await fetch(`${base}/app.js?v=${buildId}`)).text();
const localPath = mode === 'dist' ? 'packages/codex-web/dist/public/app.js' : 'packages/codex-web/public/app.js';
const expected = (await fs.readFile(localPath, 'utf8')).replaceAll('__CODEX_WEB_BUILD_ID__', buildId);
assert.equal(app, expected);
for (const path of ['/api/health', '/api/sessions', '/api/admin/sessions', '/api/metrics', '/api/reports', '/api/turns/synthetic-verification/events']) {
  const response = await fetch(`${base}${path}`); await response.arrayBuffer(); assert.equal(response.status, 401); statuses.push({ path, status: response.status });
}
assert.equal(version.buildId, buildId);
const result = { phase, timestamp: new Date().toISOString(), mode, buildId, appBytes: Buffer.byteLength(app), appSha256: createHash('sha256').update(app).digest('hex'), statuses };
const output = new URL('./delivery-checks.json', import.meta.url);
let records = []; try { records = JSON.parse(await fs.readFile(output, 'utf8')); } catch { /* First delivery check. */ }
records.push(result); await fs.writeFile(output, JSON.stringify(records, null, 2));
console.log(JSON.stringify({ phase, mode, buildId, appBytes: result.appBytes, checkedRoutes: statuses.length }));
