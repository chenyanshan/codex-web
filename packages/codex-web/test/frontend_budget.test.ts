import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const publicRoot = new URL('../public/', import.meta.url);
const criticalAssets = [
  'styles.css',
  'pwa-pull-refresh.js',
  'ui-copy.js',
  'ui-kit.js',
  'attachment-utils.js',
  'markdown-renderer.js',
  'admin-ui.js',
  'app.js',
];

test('critical frontend stays self-contained and within the weak-network budget', async () => {
  const [index, styles, ...scripts] = await Promise.all([
    readFile(new URL('index.html', publicRoot), 'utf8'),
    readFile(new URL('styles.css', publicRoot), 'utf8'),
    ...criticalAssets.slice(1).map((asset) => readFile(new URL(asset, publicRoot), 'utf8')),
  ]);
  const compressedBytes = [styles, ...scripts]
    .reduce((total, source) => total + gzipSync(source, { level: 6 }).byteLength, 0);
  const app = scripts.at(-1) || '';

  assert.ok(compressedBytes <= 140 * 1024, `critical gzip payload is ${compressedBytes} bytes`);
  assert.ok(Buffer.byteLength(app) <= 500_000, `app.js is ${Buffer.byteLength(app)} bytes`);
  assert.doesNotMatch(index, /<(?:script|link)[^>]+(?:src|href)="https?:\/\//iu);
  assert.doesNotMatch(styles, /@import\s+url|@font-face/iu);
});
