import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { withMultipartFiles, type ParsedUploadFile } from '../src/multipart_upload.js';

async function fixture(t: test.TestContext, operation: (files: ParsedUploadFile[]) => Promise<unknown>, limits = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-upload-test-'));
  const server = http.createServer(async (request, response) => {
    try { const result = await withMultipartFiles(request, operation, { tempRoot, ...limits }); response.end(JSON.stringify(result)); }
    catch (error: any) { if (!response.destroyed) { response.writeHead(error.statusCode || 400, { Connection: 'close' }); response.end(error.code || 'invalid_upload'); } }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(tempRoot, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, tempRoot };
}

test('multipart streams binary files without corrupting boundary-like bytes and releases temporary files', async t => {
  const bytes = Buffer.concat([Buffer.from([0, 255, 128]), Buffer.from('--boundary-like\r\ntrailing--')]);
  const { url, tempRoot } = await fixture(t, async files => ({ content: (await fs.readFile(files[0]!.tempPath)).toString('base64'), size: files[0]!.sizeBytes, name: files[0]!.fileName }));
  const form = new FormData(); form.append('files', new Blob([bytes]), '测试.bin');
  const response = await fetch(url, { method: 'POST', body: form }); const payload = await response.json() as any;
  assert.equal(response.status, 200); assert.equal(payload.content, bytes.toString('base64')); assert.equal(payload.size, bytes.length); assert.equal(payload.name, '测试.bin');
  assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('per-file and total-body limits reject at the real stream boundary and clean temporary state', async t => {
  const { url, tempRoot } = await fixture(t, async () => ({ ok: true }), { fileLimit: 128, bodyLimit: 1024 });
  const form = new FormData(); form.append('files', new Blob([new Uint8Array(129)]), 'too-big.bin');
  assert.equal((await fetch(url, { method: 'POST', body: form })).status, 413);
  const large = new FormData(); large.append('files', new Blob([new Uint8Array(2048)]), 'too-large.bin');
  assert.equal((await fetch(url, { method: 'POST', body: large })).status, 413);
  assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('concurrent upload budget rejects excess requests and recovers after all owners finish', async t => {
  let release!: () => void, entered = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { url } = await fixture(t, async () => { entered++; await gate; return { ok: true }; });
  const send = () => { const form = new FormData(); form.append('files', new Blob(['small']), 'test.txt'); return fetch(url, { method: 'POST', body: form }); };
  const four = Array.from({ length: 4 }, send);
  while (entered < 4) await new Promise(resolve => setTimeout(resolve, 5));
  const excess = await send(); assert.equal(excess.status, 429); await excess.text();
  release(); for (const response of await Promise.all(four)) { assert.equal(response.status, 200); await response.text(); }
  const recovered = await send(); assert.equal(recovered.status, 200); await recovered.text();
});

test('aborted request releases its partial upload and concurrency reservation', async t => {
  const { url, tempRoot } = await fixture(t, async () => ({ ok: true }));
  const request = http.request(url, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=cancel-fixture' } });
  request.on('error', () => {});
  request.write('--cancel-fixture\r\nContent-Disposition: form-data; name="files"; filename="part.bin"\r\n\r\npartial');
  while (!(await fs.readdir(tempRoot)).length) await new Promise(resolve => setTimeout(resolve, 5));
  request.destroy();
  for (let i = 0; i < 100 && (await fs.readdir(tempRoot)).length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(await fs.readdir(tempRoot), []);
});
