import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { buildPublic } from '../scripts/build-public.mjs';

test('public build minifies independent scripts and CSS while preserving asset paths and build placeholders', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-build-public-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const outdir = path.join(dir, 'public');
  await fs.mkdir(outdir);
  await fs.writeFile(path.join(outdir, 'stale.js'), 'stale');
  const assets = await buildPublic({ outdir });
  const publicRoot = new URL('../public/', import.meta.url);
  assert.equal(await fs.stat(path.join(outdir, 'stale.js')).then(() => true, () => false), false);
  for (const asset of assets) {
    const emitted = await fs.readFile(path.join(outdir, asset.name));
    const source = await fs.readFile(new URL(asset.name, publicRoot));
    if (!/\.(?:js|css)$/u.test(asset.name)) assert.deepEqual(emitted, source);
    if (asset.name.endsWith('.js')) new vm.Script(emitted.toString(), { filename: asset.name });
  }
  const app = assets.find((asset) => asset.name === 'app.js')!;
  const styles = assets.find((asset) => asset.name === 'styles.css')!;
  assert.ok(app.outputBytes < app.sourceBytes * 0.85, `${app.outputBytes}/${app.sourceBytes} app bytes`);
  assert.ok(styles.outputBytes < styles.sourceBytes * 0.85);
  const index = await fs.readFile(path.join(outdir, 'index.html'), 'utf8');
  const worker = await fs.readFile(path.join(outdir, 'service-worker.js'), 'utf8');
  assert.match(index, /__CODEX_WEB_BUILD_ID__/u);
  assert.match(worker, /__CODEX_WEB_BUILD_ID__/u);
  for (const match of index.matchAll(/(?:src|href)="\/([^"?]+)(?:\?[^"]*)?"/gu)) {
    assert.ok(assets.some((asset) => asset.name === match[1]), `Missing boot asset ${match[1]}`);
  }
  const context: Record<string, unknown> = { AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(await fs.readFile(path.join(outdir, 'request-context.js'), 'utf8'), context);
  assert.ok(context.CodexWebRequestContext, 'classic script global survives minification');
});

test('compiled build validation rejects stale sources and damaged output instead of smoking an old deployment', async (t) => {
  const { verifyBuiltPublic } = await import('../scripts/build-public.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-build-stale-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sourceRoot = path.join(dir, 'source');
  const outdir = path.join(dir, 'output');
  await fs.mkdir(sourceRoot);
  await fs.writeFile(path.join(sourceRoot, 'app.js'), 'globalThis.value = 1;');
  await buildPublic({ sourceRoot, outdir });
  await verifyBuiltPublic({ sourceRoot, outdir });
  await fs.writeFile(path.join(sourceRoot, 'app.js'), 'globalThis.value = 2;');
  await assert.rejects(verifyBuiltPublic({ sourceRoot, outdir }), /stale or incomplete.*app.js/u);
  await buildPublic({ sourceRoot, outdir });
  await fs.writeFile(path.join(outdir, 'app.js'), 'corrupted');
  await assert.rejects(verifyBuiltPublic({ sourceRoot, outdir }), /stale or incomplete.*app.js/u);
  await buildPublic({ sourceRoot, outdir });
  await fs.writeFile(path.join(sourceRoot, 'new.js'), 'globalThis.newValue = true;');
  await assert.rejects(verifyBuiltPublic({ sourceRoot, outdir }), /source file list/u);
  await fs.unlink(path.join(sourceRoot, 'new.js'));
  await fs.unlink(path.join(sourceRoot, 'app.js'));
  await assert.rejects(verifyBuiltPublic({ sourceRoot, outdir }), /source file list/u);
});
