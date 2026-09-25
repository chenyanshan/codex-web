import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { verifyBuiltPublic } from './build-public.mjs';
import { createCodexWebServer } from '../dist/server.js';
import { loadServiceConfig } from '../dist/config.js';

await verifyBuiltPublic();

// Real production server/static path, isolated state and inert provider: no Codex execution.
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-built-smoke-'));
const config = { ...loadServiceConfig({ homeDir: stateDir, env: { CODEX_WEB_STATE_DIR: stateDir } }), host: '127.0.0.1', port: 0 };
const session = { id: 'smoke-device', deviceName: 'Build smoke', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
const server = createCodexWebServer({
  config,
  auth: { isConfigured: async () => true, verifyToken: async (token) => token === 'synthetic-build-token' ? session : null, logout: async () => {}, login: async () => { throw new Error('unused'); } },
  runtime: { listModels: async () => [], readConfigDefaults: async () => null, readUsage: async () => null, listSessions: async () => [], listSessionDirectory: async () => ({ items: [], complete: true }), stop: async () => {} },
});
let browser;
try {
  await server.start();
  const url = server.baseUrl;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  const scripts = [];
  page.on('response', (response) => { if (/\.js(?:\?|$)/u.test(response.url())) scripts.push({ url: response.url(), status: response.status() }); });
  await page.addInitScript(() => localStorage.setItem('codexWebToken', 'synthetic-build-token'));
  await page.goto(url, { waitUntil: 'networkidle' });
  assert.deepEqual(failures, [], 'the production app must initialize without script errors');
  assert.ok(scripts.every(script => script.status === 200), `failed production assets: ${JSON.stringify(scripts.filter(script => script.status !== 200))}`);
  await page.locator('.session-list[aria-busy="false"]').waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('searchbox').count(), 0);
  assert.equal(await page.locator('#session-activity-filter').count(), 0);
  assert.deepEqual(failures, []);
  assert.ok(scripts.length >= 10);
  assert.ok(scripts.every((script) => script.status === 200));
  const appResponse = await page.request.get(`${url}/app.js`);
  const served = await appResponse.text();
  const emitted = await fs.readFile(new URL('../dist/public/app.js', import.meta.url), 'utf8');
  const appScript = await page.locator('script[src*="/app.js"]').getAttribute('src');
  const buildId = new URL(appScript, url).searchParams.get('v');
  const addedAssets = ['boot-recovery.js', 'approval-ui.js', 'approval-ui.css', 'settings-ui.js', 'settings-ui.css', 'admin-ui.css'];
  for (const name of addedAssets) {
    const assetUrl = `${url}/${name}`;
    const unversioned = await fetch(assetUrl);
    assert.equal(unversioned.status, 200, name);
    assert.equal(unversioned.headers.get('cache-control'), 'no-cache', name);
    const body = await unversioned.text();
    const emittedAsset = await fs.readFile(new URL(`../dist/public/${name}`, import.meta.url), 'utf8');
    assert.equal(body, emittedAsset.replaceAll('__CODEX_WEB_BUILD_ID__', buildId), `${name} must come from dist/public`);
    assert.equal(await page.locator(`[src="/${name}?v=${buildId}"], [href="/${name}?v=${buildId}"]`).count(), 1, name);
    for (const encoding of ['br', 'gzip']) {
      const headers = { 'Accept-Encoding': encoding };
      const asset = await fetch(`${assetUrl}?v=${buildId}`, { headers });
      assert.equal(asset.status, 200, name);
      assert.equal(asset.headers.get('content-type'), name.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8', name);
      assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable', name);
      // Minification can put a controller below the existing 1 KiB compression cutoff.
      assert.equal(asset.headers.get('content-encoding'), Buffer.byteLength(body) >= 1024 ? encoding : null, name);
      assert.match(asset.headers.get('vary') ?? '', /Accept-Encoding/iu);
      assert.equal(await asset.text(), body, name);
      const etag = asset.headers.get('etag');
      assert.ok(etag, name);
      const unchanged = await fetch(`${assetUrl}?v=${buildId}`, { headers: { ...headers, 'If-None-Match': etag } });
      assert.equal(unchanged.status, 304, name);
      assert.equal(await unchanged.text(), '', name);
    }
    const staleVersion = await fetch(`${assetUrl}?v=old-build`);
    assert.equal(staleVersion.headers.get('cache-control'), 'no-cache', name);
    await staleVersion.arrayBuffer();
  }
  const lazyWork = await page.evaluate(async buildId => {
    await import(`/work-details-view.js?v=${encodeURIComponent(buildId)}`);
    return typeof globalThis.CodexWebWorkView?.createRenderer;
  }, buildId);
  assert.equal(lazyWork, 'function', 'the production server must deliver the lazy work view');
  assert.deepEqual(failures, []);
  assert.ok(scripts.every(script => script.status === 200));
  assert.equal(served, emitted.replaceAll('__CODEX_WEB_BUILD_ID__', buildId));
  assert.ok(served.length < (await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8')).length * 0.85);
  process.stdout.write(JSON.stringify({ servedUrl: url, scripts: scripts.length, verifiedAssets: addedAssets, emittedAppBytes: Buffer.byteLength(emitted), browserErrors: failures }, null, 2) + '\n');
} finally {
  await browser?.close();
  await server.stop().catch(() => {});
  await fs.rm(stateDir, { recursive: true, force: true });
}
