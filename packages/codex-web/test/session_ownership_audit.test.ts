import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditSessionOwnership } from '../../../scripts/maintenance/audit-session-ownership.mjs';

test('ownership inventory groups duplicates, finds references and omits secrets without modifying state', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ownership-audit-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const identity = JSON.stringify({
    users: [{ passwordHash: 'secret-password-hash' }],
    sessions: [
      { id: 'normal-app', codexThreadId: 'thread', ownerUserId: 'alice' },
      { id: 'legacy-app', codexThreadId: 'thread', ownerUserId: 'admin' },
      { id: 'unique-app', codexThreadId: 'other', ownerUserId: 'bob' },
    ], shares: [{ sessionId: 'legacy-app', tokenHash: 'secret-token-hash' }],
  });
  await fs.writeFile(path.join(dir, 'identity.json'), identity);
  await fs.writeFile(path.join(dir, 'submissions.json'), JSON.stringify({ sessionId: 'normal-app', text: 'secret-prompt' }));
  await fs.writeFile(path.join(dir, 'legacy-app.log'), 'unscanned');
  const report = await auditSessionOwnership(dir);
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].sessions.length, 2);
  assert.ok(report.references.some((ref) => ref.file === 'submissions.json' && ref.sessionId === 'normal-app'));
  assert.ok(report.references.some((ref) => ref.file === 'legacy-app.log' && ref.sessionId === 'legacy-app'));
  assert.ok(report.unscanned.some((ref) => ref.file === 'legacy-app.log'));
  assert.doesNotMatch(JSON.stringify(report), /secret-/);
  assert.equal(await fs.readFile(path.join(dir, 'identity.json'), 'utf8'), identity);
});
