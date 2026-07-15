import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FileLockBusyError,
  withFileLock,
  withFileLockSync,
} from '../src/file_lock.js';

test('file lock fails fast while a live owner holds the lock', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-file-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, 'state.lock');

  await withFileLock(lockPath, async () => {
    await assert.rejects(
      () => withFileLock(lockPath, async () => {}, { timeoutMs: 0 }),
      FileLockBusyError,
    );
  });
});

test('file lock recovers immediately when the owner PID is no longer alive', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-file-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, 'state.lock');
  const deadPid = await exitedChildPid();
  await fs.writeFile(lockPath, JSON.stringify({
    version: 1,
    pid: deadPid,
    createdAt: new Date().toISOString(),
    token: 'abandoned',
  }));

  let acquired = false;
  await withFileLock(lockPath, async () => {
    acquired = true;
  }, { timeoutMs: 0 });

  assert.equal(acquired, true);
  await assert.rejects(() => fs.access(lockPath), { code: 'ENOENT' });
});

test('synchronous file lock recovers an owner that exceeded the stale age', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-file-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, 'state.lock');
  await fs.writeFile(lockPath, JSON.stringify({
    version: 1,
    pid: process.pid,
    createdAt: '2000-01-01T00:00:00.000Z',
    token: 'expired',
  }));

  const result = withFileLockSync(lockPath, () => 'acquired', { timeoutMs: 0 });

  assert.equal(result, 'acquired');
  await assert.rejects(() => fs.access(lockPath), { code: 'ENOENT' });
});

test('simultaneous stale-lock contenders never overlap their operations', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-file-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, 'state.lock');
  const guardPath = path.join(dir, 'operation.guard');
  const violationPath = path.join(dir, 'overlap.txt');
  const completionPath = path.join(dir, 'completed.txt');
  await fs.writeFile(lockPath, JSON.stringify({
    version: 1,
    pid: process.pid,
    createdAt: '2000-01-01T00:00:00.000Z',
    token: 'shared-stale-generation',
  }));

  await Promise.all(Array.from({ length: 4 }, (_, index) => runLockWorker({
    lockPath,
    guardPath,
    violationPath,
    completionPath,
    workerId: String(index),
  })));

  await assert.rejects(() => fs.access(violationPath), { code: 'ENOENT' });
  const completed = (await fs.readFile(completionPath, 'utf8')).trim().split('\n');
  assert.equal(completed.length, 4);
});

test('file lock recovers an expired orphan retirement claim', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-file-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, 'state.lock');
  const owner = {
    version: 1,
    pid: process.pid,
    createdAt: '2000-01-01T00:00:00.000Z',
    token: 'orphaned-retirement',
  };
  await fs.writeFile(lockPath, JSON.stringify(owner));
  const claimPath = retirementClaimPathForTest(lockPath, `owner:${owner.token}`);
  await fs.link(lockPath, claimPath);

  let acquired = false;
  await withFileLock(lockPath, async () => {
    acquired = true;
  }, {
    timeoutMs: 100,
    retireClaimStaleMs: 0,
  });

  assert.equal(acquired, true);
  await assert.rejects(() => fs.access(lockPath), { code: 'ENOENT' });
  await assert.rejects(() => fs.access(claimPath), { code: 'ENOENT' });
});

test('malformed lock generations include filesystem identity', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-file-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, 'state.lock');
  const malformed = 'not-json\n';
  const oldTime = new Date('2000-01-01T00:00:00.000Z');
  await fs.writeFile(lockPath, malformed);
  await fs.utimes(lockPath, oldTime, oldTime);
  const oldStats = await fs.stat(lockPath);
  const oldIdentity = unknownIdentityForTest(malformed, oldStats);
  const oldClaimPath = retirementClaimPathForTest(lockPath, oldIdentity);
  await fs.link(lockPath, oldClaimPath);
  await fs.unlink(lockPath);

  await fs.writeFile(lockPath, malformed);
  await fs.utimes(lockPath, oldTime, oldTime);
  const newStats = await fs.stat(lockPath);
  assert.notEqual(newStats.ino, oldStats.ino);

  let acquired = false;
  await withFileLock(lockPath, async () => {
    acquired = true;
  }, { timeoutMs: 100 });

  assert.equal(acquired, true);
  await fs.access(oldClaimPath);
});

function exitedChildPid(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--eval', ''], { stdio: 'ignore' });
    const pid = child.pid;
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0 && pid) {
        resolve(pid);
        return;
      }
      reject(new Error(`PID probe child failed (${code ?? signal})`));
    });
  });
}

function runLockWorker(input: {
  lockPath: string;
  guardPath: string;
  violationPath: string;
  completionPath: string;
  workerId: string;
}): Promise<void> {
  const moduleUrl = new URL('../src/file_lock.ts', import.meta.url).href;
  const source = `
    import fs from 'node:fs/promises';
    import { withFileLock } from ${JSON.stringify(moduleUrl)};
    await withFileLock(process.env.LOCK_PATH, async () => {
      let guard = null;
      try {
        guard = await fs.open(process.env.GUARD_PATH, 'wx');
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        await fs.appendFile(process.env.VIOLATION_PATH, process.env.WORKER_ID + '\\n');
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
      await fs.appendFile(process.env.COMPLETION_PATH, process.env.WORKER_ID + '\\n');
      if (guard) {
        await guard.close();
        await fs.rm(process.env.GUARD_PATH, { force: true });
      }
    }, { retryDelayMs: 1 });
  `;
  return runModuleWorker(source, {
    LOCK_PATH: input.lockPath,
    GUARD_PATH: input.guardPath,
    VIOLATION_PATH: input.violationPath,
    COMPLETION_PATH: input.completionPath,
    WORKER_ID: input.workerId,
  });
}

function runModuleWorker(source: string, env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--conditions=development',
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      source,
    ], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`lock worker failed (${code ?? signal}): ${stderr}`));
    });
  });
}

function unknownIdentityForTest(raw: string, stats: { dev: number; ino: number; mtimeMs: number; size: number }): string {
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  return `unknown:${digest}:${stats.dev}:${stats.ino}:${stats.mtimeMs}:${stats.size}`;
}

function retirementClaimPathForTest(lockPath: string, identity: string): string {
  const lockHash = crypto.createHash('sha256').update(path.resolve(lockPath)).digest('hex').slice(0, 16);
  const identityHash = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
  return path.join(path.dirname(lockPath), `.${lockHash}.${identityHash}.retire`);
}
