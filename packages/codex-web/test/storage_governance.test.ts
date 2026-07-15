import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ManagedStorageQuotaError,
  maintainManagedStateStorage,
  withManagedStateStorageCapacity,
  withProjectUploadCapacity,
} from '../src/storage_governance.js';

test('managed state cleanup applies TTL only to owned files and never follows symlinks', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-storage-'));
  t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const reportsDir = path.join(stateDir, 'reports');
  const uploadsDir = path.join(stateDir, 'uploads', 'projects', 'project', 'user');
  const outsidePath = path.join(stateDir, 'outside.txt');
  const expiredUpload = path.join(uploadsDir, 'att_aaaaaaaaaaaaaaaaaaaa-old.txt');
  const unmanagedUpload = path.join(uploadsDir, 'notes.txt');
  const symlinkUpload = path.join(uploadsDir, 'att_bbbbbbbbbbbbbbbbbbbb-link.txt');
  const reportPath = path.join(reportsDir, 'project', 'fresh.md');
  const expiredReport = path.join(reportsDir, 'project', 'expired.html');
  const expiredSnapshot = path.join(
    stateDir,
    'turn-attachments',
    'user',
    'thread',
    '12345678-1234-1234-1234-123456789012-old.txt',
  );
  const expiredContext = path.join(stateDir, 'runtime-context', 'sessions', 'expired.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(path.dirname(expiredSnapshot), { recursive: true });
  await fs.mkdir(path.dirname(expiredContext), { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(expiredUpload, 'expired');
  await fs.writeFile(unmanagedUpload, 'keep');
  await fs.writeFile(outsidePath, 'outside');
  await fs.symlink(outsidePath, symlinkUpload);
  await fs.writeFile(reportPath, 'fresh report');
  await fs.writeFile(expiredReport, 'expired report');
  await fs.writeFile(expiredSnapshot, 'expired snapshot');
  await fs.writeFile(expiredContext, '{}');
  const old = new Date(Date.now() - 5_000);
  await Promise.all([
    fs.utimes(expiredUpload, old, old),
    fs.utimes(expiredReport, old, old),
    fs.utimes(expiredSnapshot, old, old),
    fs.utimes(expiredContext, old, old),
  ]);

  const result = await maintainManagedStateStorage({
    stateDir,
    reportsDir,
    managedStorageMaxBytes: 1_024,
    uploadTtlSeconds: 1,
    reportTtlSeconds: 1,
    turnAttachmentTtlSeconds: 1,
    runtimeContextTtlSeconds: 1,
  });

  assert.equal(result.deletedFiles, 4);
  for (const expiredPath of [expiredUpload, expiredReport, expiredSnapshot, expiredContext]) {
    await assert.rejects(fs.stat(expiredPath), { code: 'ENOENT' });
  }
  assert.equal(await fs.readFile(unmanagedUpload, 'utf8'), 'keep');
  assert.equal(await fs.readlink(symlinkUpload), outsidePath);
  assert.equal(await fs.readFile(outsidePath, 'utf8'), 'outside');
  assert.equal(await fs.readFile(reportPath, 'utf8'), 'fresh report');
});

test('managed state capacity prunes oldest files and rejects writes when protected data fills the quota', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-storage-'));
  t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const reportsDir = path.join(stateDir, 'reports');
  const oldReport = path.join(reportsDir, 'project', 'old.md');
  const snapshot = path.join(
    stateDir,
    'turn-attachments',
    'user',
    'thread',
    '12345678-1234-1234-1234-123456789012-note.txt',
  );
  await fs.mkdir(path.dirname(oldReport), { recursive: true });
  await fs.mkdir(path.dirname(snapshot), { recursive: true });
  await fs.writeFile(oldReport, '12345678');
  await fs.writeFile(snapshot, 'abcdefgh');
  const old = new Date(Date.now() - 5_000);
  await fs.utimes(oldReport, old, old);
  const config = {
    stateDir,
    reportsDir,
    managedStorageMaxBytes: 12,
    uploadTtlSeconds: 3_600,
    reportTtlSeconds: 3_600,
    turnAttachmentTtlSeconds: 3_600,
    runtimeContextTtlSeconds: 3_600,
  };

  const first = await maintainManagedStateStorage(config);
  assert.equal(first.totalBytes, 8);
  await assert.rejects(fs.stat(oldReport), { code: 'ENOENT' });
  assert.equal(await fs.readFile(snapshot, 'utf8'), 'abcdefgh');

  let operationCalled = false;
  await assert.rejects(
    withManagedStateStorageCapacity({
      config,
      incomingBytes: 8,
      protectedPaths: [snapshot],
      operation: async () => {
        operationCalled = true;
      },
    }),
    ManagedStorageQuotaError,
  );
  assert.equal(operationCalled, false);
  assert.equal(await fs.readFile(snapshot, 'utf8'), 'abcdefgh');
});

test('project upload governance enforces a project-wide quota while preserving unrelated files', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-storage-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-project-'));
  t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  const uploadsRoot = path.join(projectDir, 'uploads');
  const userDir = path.join(uploadsRoot, 'user');
  const oldUpload = path.join(userDir, 'att_cccccccccccccccccccc-old.txt');
  const unrelated = path.join(uploadsRoot, 'README.txt');
  await fs.mkdir(userDir, { recursive: true });
  await fs.writeFile(oldUpload, '12345678');
  await fs.writeFile(unrelated, 'preserve');

  const written = await withProjectUploadCapacity({
    config: {
      stateDir,
      reportsDir: path.join(stateDir, 'reports'),
      projectUploadMaxBytes: 10,
      uploadTtlSeconds: 3_600,
    },
    uploadsRoot,
    incomingBytes: 6,
    operation: async () => {
      const target = path.join(userDir, 'att_dddddddddddddddddddd-new.txt');
      await fs.mkdir(userDir, { recursive: true });
      await fs.writeFile(target, '123456');
      return target;
    },
  });

  await assert.rejects(fs.stat(oldUpload), { code: 'ENOENT' });
  assert.equal(await fs.readFile(written, 'utf8'), '123456');
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'preserve');
});
