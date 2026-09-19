import crypto from 'node:crypto';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

interface PreparedAsset {
  source: string | Buffer;
  contentType: string;
  body: Buffer;
  etag: string;
  br?: Buffer;
  gzip?: Buffer;
}
// Bounded by entry count and retained bytes, including dynamically titled app shells.
const assets: PreparedAsset[] = [];
let retainedBytes = 0;
let hits = 0;
let misses = 0;
export function prepareStaticAsset(source: string | Buffer, contentType: string): PreparedAsset {
  const cached = assets.find((asset) => asset.source === source && asset.contentType === contentType);
  if (cached) { hits++; return cached; }
  misses++;
  const body = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const asset: PreparedAsset = { source, contentType, body,
    etag: `W/"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 22)}"` };
  if (body.length >= 1024 && (/^text\//u.test(contentType) || /^application\/(javascript|json|manifest\+json)\b/u.test(contentType))) {
    asset.br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
    asset.gzip = gzipSync(body, { level: 6 });
  }
  const size = body.length + (asset.br?.length ?? 0) + (asset.gzip?.length ?? 0);
  if (size <= 16 * 1024 * 1024) {
    while (assets.length && (assets.length >= 64 || retainedBytes + size > 16 * 1024 * 1024)) {
      const old = assets.shift()!;
      retainedBytes -= old.body.length + (old.br?.length ?? 0) + (old.gzip?.length ?? 0);
    }
    assets.push(asset); retainedBytes += size;
  }
  return asset;
}
export function staticAssetCacheMetrics() { return { hits, misses, entries: assets.length, retainedBytes }; }
