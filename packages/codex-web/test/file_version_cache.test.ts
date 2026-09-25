import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { FileVersionCache } from '../src/file_version_cache.js';
import { FileIdentityStore, identityStateVersion } from '../src/identity_store.js';
import { FileReportStore } from '../src/report_store.js';

async function directory(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-file-version-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}

test('unchanged reads reuse immutable snapshots; same-size replacement, rewrite, deletion and malformed state invalidate them', async t => {
  const dir = await directory(t), file = path.join(dir, 'index.json'); let parses = 0;
  const cache = new FileVersionCache(file, raw => { parses++; return JSON.parse(raw) as { nested: { name: string } }; }, () => ({ nested: { name: '' } }));
  assert.equal((await cache.read()).value.nested.name, '');
  await fs.writeFile(file, '{"nested":{"name":"first"}}');
  const first = await cache.read();
  for (let i = 0; i < 10; i++) assert.equal((await cache.read()).value, first.value);
  assert.equal(parses, 1); assert.throws(() => { first.value.nested.name = 'bad'; }, TypeError);
  await fs.writeFile(path.join(dir, 'next'), '{"nested":{"name":"other"}}'); await fs.rename(path.join(dir, 'next'), file);
  const next = await cache.read(); assert.equal(next.value.nested.name, 'other'); assert.notEqual(first.version, next.version);
  await fs.writeFile(file, '{"nested":{"name":"third"}}'); assert.equal((await cache.read()).value.nested.name, 'third');
  await fs.writeFile(file, '{broken'); await assert.rejects(cache.read(), SyntaxError);
  await fs.rm(file); assert.equal((await cache.read()).value.nested.name, '');
});

test('identity snapshots see cross-store revocation immediately while mutable copies cannot pollute authorization', async t => {
  const dir = await directory(t), identityPath = path.join(dir, 'identity.json');
  const a = new FileIdentityStore({ identityPath }), b = new FileIdentityStore({ identityPath });
  await a.upsertUserWithPassword({ id: 'member', username: 'member', password: 'synthetic-password', roleIds: [] });
  const original = await a.readSnapshot(); assert.equal(await a.readSnapshot(), original);
  const mutable = await a.readState(); mutable.users[0]!.enabled = false;
  assert.equal((await a.readSnapshot()).users[0]!.enabled, true);
  await b.updateUserAccess({ id: 'member', enabled: false });
  const revoked = await a.readSnapshot(); assert.equal(revoked.users[0]!.enabled, false);
  assert.notEqual(identityStateVersion(original), identityStateVersion(revoked));
});

test('report store sees externally replaced index and removed metadata without recreating the store', async t => {
  const dir = await directory(t), reportsDir = path.join(dir, 'reports'), indexPath = path.join(dir, 'index.json');
  await fs.mkdir(reportsDir); await fs.writeFile(path.join(reportsDir, 'one.md'), '# Content');
  const store = new FileReportStore({ reportsDir, indexPath });
  assert.equal((await store.readReport('one.md'))!.title, 'one');
  await fs.writeFile(indexPath, JSON.stringify({ reports: { 'one.md': { title: 'First' } } }));
  assert.equal((await store.readReport('one.md'))!.title, 'First');
  await fs.writeFile(path.join(dir, 'next'), JSON.stringify({ reports: { 'one.md': { title: 'Other', favorite: true } } }));
  await fs.rename(path.join(dir, 'next'), indexPath);
  assert.equal((await store.listReports())[0]!.title, 'Other'); assert.equal((await store.readReport('one.md'))!.favorite, true);
  await fs.rm(indexPath); assert.equal((await store.readReport('one.md'))!.title, 'one');
});

test('same-tick metadata collisions refresh values and versions without reparsing unchanged content', async t => {
  const dir = await directory(t), file = path.join(dir, 'collision.json');
  await fs.writeFile(file, '{"enabled":true }');
  const metadata = await fs.stat(file, { bigint: true });
  // Hold every metadata field constant, reproducing a real filesystem clock tick.
  // Keep the wall clock deterministic; no sleeping or timestamp-dependent luck.
  t.mock.method(Date, 'now', () => Number(metadata.ctimeNs / 1_000_000n));
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'stat', async () => metadata);
  let opens = 0, parses = 0;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    opens++;
    const handle = await open(...args);
    t.mock.method(handle, 'stat', async () => metadata);
    return handle;
  });
  const cache = new FileVersionCache(file, raw => { parses++; return JSON.parse(raw); }, () => ({}));
  const original = await cache.read();
  assert.equal((await cache.read()).value, original.value);
  assert.equal(parses, 1);
  assert.equal(opens, 2, 'recent identical metadata rechecks bytes');
  await fs.writeFile(file, '{"enabled":false}');
  const revoked = await cache.read();
  assert.equal(revoked.value.enabled, false);
  assert.notEqual(revoked.version, original.version, 'downstream version caches observe same-metadata changes');
  assert.equal(parses, 2);
  assert.equal((await cache.read()).value, revoked.value);
  assert.equal(parses, 2);
  // Once the metadata is older than the coarse-timestamp safety window,
  // unchanged files again avoid opening/reading their contents.
  t.mock.method(Date, 'now', () => Number(metadata.ctimeNs / 1_000_000n) + 3_000);
  const beforeColdReads = opens;
  for (let i = 0; i < 10; i++) assert.equal((await cache.read()).value, revoked.value);
  assert.equal(opens, beforeColdReads);
  assert.equal(parses, 2);
});
