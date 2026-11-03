import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileIdentityStore, type CodexWebAppSession } from '../src/identity_store.js';
import { ensureLegacySessionImportScope } from '../src/legacy_session_import.js';

const context = { source: 'legacy-import' as const, actorUserId: 'admin', correlationId: 'import-request' };
const session = (id = 'normal', ownerUserId = 'alice', codexThreadId = 'thread'): CodexWebAppSession => ({
  id, ownerUserId, codexThreadId, projectId: 'project', createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', archived: false, archivedAt: null,
  archivedByUserId: null, archiveSource: null,
});
const legacy = () => session('app_legacy_thread', 'admin');
function barrier() {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), release: () => resolve() };
}
async function stores(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ownership-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const identityPath = path.join(dir, 'identity.json');
  return { identityPath, first: new FileIdentityStore({ identityPath }), second: new FileIdentityStore({ identityPath }) };
}

test('normal mapping wins against a legacy import holding an older identity snapshot', async (t) => {
  const { first, second } = await stores(t);
  await first.initializeLegacySessionImport(['thread']);
  const stale = await second.readState();
  const ready = barrier(); const resume = barrier();
  const importRequest = (async () => {
    assert.equal(stale.sessions.length, 0);
    ready.release(); await resume.promise;
    return second.importLegacySession(legacy(), context);
  })();
  await ready.promise;
  await first.upsertSession(session());
  resume.release();
  assert.equal(await importRequest, false);
  assert.deepEqual((await second.readState()).sessions.map((s) => [s.id, s.ownerUserId]), [['normal', 'alice']]);
});

test('legacy-first conflicts reject both alternate IDs and attempts to overwrite the owner, thread or project', async (t) => {
  const { first, second } = await stores(t);
  await first.initializeLegacySessionImport(['thread']);
  await first.importLegacySession(legacy(), context);
  for (const attempted of [session(), session('app_legacy_thread'),
    session('app_legacy_thread', 'admin', 'other-thread'), { ...legacy(), projectId: 'other-project' }]) {
    await assert.rejects(second.upsertSession(attempted), { code: 'session_ownership_conflict' });
  }
  assert.equal((await second.readState()).sessions.length, 1);
  assert.equal((await second.readState()).sessions[0]?.ownerUserId, 'admin');
});

test('two administrators importing concurrently produce exactly one mapping and repeat imports are no-ops', async (t) => {
  const { first, second, identityPath } = await stores(t);
  await first.initializeLegacySessionImport(['thread']);
  const gate = barrier();
  const imports = [first, second].map(async (store, i) => {
    await gate.promise;
    return store.importLegacySession(legacy(), { ...context, actorUserId: `admin-${i}` });
  });
  gate.release();
  assert.deepEqual((await Promise.all(imports)).sort(), [false, true]);
  assert.equal(await second.importLegacySession(legacy(), context), false);
  const restarted = new FileIdentityStore({ identityPath });
  assert.equal((await restarted.readState()).sessions.length, 1);
  assert.deepEqual((await restarted.readState()).legacySessionImport?.remainingThreadIds, []);
  await restarted.initializeLegacySessionImport(['new-thread']);
  assert.equal(await restarted.importLegacySession(session('new', 'admin', 'new-thread'), context), false);
});

test('creation waits for a complete migration capture; later threads cannot enter the persisted scope', async (t) => {
  const { first, second } = await stores(t);
  const listed = barrier(); const resume = barrier();
  let calls = 0;
  const list = async () => { calls++; listed.release(); await resume.promise; return [{ id: 'historical' }]; };
  const capture = ensureLegacySessionImportScope(first, list);
  await listed.promise;
  let created = false;
  const create = (async () => {
    await ensureLegacySessionImportScope(first, list);
    created = true;
    // Simulates runtime visibility before normal ownership is persisted.
    assert.equal(await second.importLegacySession(legacy(), context), false);
    await first.upsertSession(session());
  })();
  assert.equal(created, false);
  resume.release(); await Promise.all([capture, create]);
  assert.equal(calls, 1);
  assert.equal(await second.importLegacySession(session('historical-app', 'admin', 'historical'), context), true);
  assert.equal((await first.readState()).sessions.length, 2);
});

test('failed capture retries without creating an empty migration, while concurrent store captures cannot expand it', async (t) => {
  const { first, second } = await stores(t);
  await assert.rejects(ensureLegacySessionImportScope(first, async () => { throw new Error('offline'); }), /offline/);
  assert.equal((await first.readState()).legacySessionImport, undefined);
  const ready = barrier(); const resume = barrier();
  const late = ensureLegacySessionImportScope(second, async () => {
    ready.release(); await resume.promise; return [{ id: 'historical' }, { id: 'new' }];
  });
  await ready.promise;
  await ensureLegacySessionImportScope(first, async () => [{ id: 'historical' }]);
  resume.release(); await late;
  assert.deepEqual((await second.readState()).legacySessionImport?.remainingThreadIds, ['historical']);
});

test('mapping provenance records real persistence time and survives updates without being forged', async (t) => {
  const { first, second } = await stores(t);
  const before = Date.now();
  const inserted = await first.upsertSession(session(), { ...context, source: 'session-create', actorUserId: 'alice' });
  assert.ok(Date.parse(inserted.mappingAudit!.recordedAt) >= before);
  const updated = await second.upsertSession({ ...inserted, updatedAt: new Date().toISOString(), mappingAudit: undefined }, context);
  assert.deepEqual(updated.mappingAudit, inserted.mappingAudit);
  assert.equal(updated.mappingAudit?.actorUserId, 'alice');
});

test('existing duplicates are preserved for review and cannot silently be overwritten', async (t) => {
  const { first, identityPath } = await stores(t);
  const state = await first.readState();
  state.sessions = [session(), legacy()];
  await fs.writeFile(identityPath, JSON.stringify(state));
  await assert.rejects(first.upsertSession(session()), { code: 'session_ownership_conflict' });
  assert.equal((await first.readState()).sessions.length, 2);
});
