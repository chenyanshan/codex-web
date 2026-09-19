import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { buildPublic } from '../scripts/build-public.mjs';

const publicRoot = new URL('../public/', import.meta.url);

test('production startup dependency graph stays self-contained and within the weak-network budget', async () => {
  const outdir = await mkdtemp(path.join(tmpdir(), 'codex-web-frontend-budget-'));
  try {
    await buildPublic({ outdir });
    const index = await readFile(path.join(outdir, 'index.html'), 'utf8');
    const dependencies = [...new Set([...index.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(\/[^"?]+\.(?:js|css))(?:\?[^"]*)?"/giu)].map((match) => match[1].slice(1)))];
    assert.ok(dependencies.includes('draft-store.js'));
    assert.ok(dependencies.includes('request-context.js'));
    assert.ok(!dependencies.includes('admin-ui.js'), 'admin tools must stay outside the critical graph');
    const assets = await Promise.all(dependencies.map((asset) => readFile(path.join(outdir, asset))));
    const compressedBytes = [Buffer.from(index), ...assets].reduce((total, source) => total + gzipSync(source, { level: 6 }).byteLength, 0);
    assert.ok(compressedBytes <= 140 * 1024, `critical production gzip payload is ${compressedBytes} bytes`);
    const appSource = await readFile(new URL('app.js', publicRoot));
    const appBuilt = await readFile(path.join(outdir, 'app.js'));
    assert.ok(appSource.byteLength <= 500_000, `app.js source is ${appSource.byteLength} bytes`);
    assert.ok(appBuilt.byteLength <= 500_000, `app.js production parse payload is ${appBuilt.byteLength} bytes`);
    assert.doesNotMatch(index, /<(?:script|link)[^>]+(?:src|href)="https?:\/\//iu);
    assert.doesNotMatch(await readFile(path.join(outdir, 'styles.css'), 'utf8'), /@import\s+url|@font-face/iu);
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});
