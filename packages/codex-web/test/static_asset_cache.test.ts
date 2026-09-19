import assert from 'node:assert/strict';
import test from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { prepareStaticAsset, staticAssetCacheMetrics } from '../src/static_asset_cache.js';

test('static representations are prepared once per content and bounded across versions', () => {
  const text = 'const example = true;\n'.repeat(200);
  const first = prepareStaticAsset(text, 'application/javascript');
  const before = staticAssetCacheMetrics();
  assert.equal(prepareStaticAsset(text, 'application/javascript'), first);
  assert.equal(staticAssetCacheMetrics().hits, before.hits + 1);
  assert.equal(brotliDecompressSync(first.br!).toString(), text);
  assert.equal(gunzipSync(first.gzip!).toString(), text);
  assert.notEqual(prepareStaticAsset(text + 'changed', 'application/javascript').etag, first.etag);
  for (let i = 0; i < 80; i++) prepareStaticAsset(`${text}${i}`, 'application/javascript');
  assert.ok(staticAssetCacheMetrics().entries <= 64);
  assert.ok(staticAssetCacheMetrics().retainedBytes <= 16 * 1024 * 1024);
});
