import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AuthStore } from '../src/auth_store.js';

test('password setup stores only salted hash and login creates reusable session token', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });

  await store.setPassword('correct horse battery staple');
  const raw = await fs.readFile(authPath, 'utf8');
  assert.equal(raw.includes('correct horse battery staple'), false);
  const stat = await fs.stat(authPath);
  assert.equal(stat.mode & 0o777, 0o600);

  const login = await store.login({
    password: 'correct horse battery staple',
    deviceName: 'iPhone Safari',
  });
  assert.match(login.token, /^cw_/);

  const state = JSON.parse(await fs.readFile(authPath, 'utf8'));
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].deviceName, 'iPhone Safari');
  assert.equal(state.sessions[0].tokenHash.includes(login.token), false);

  const session = await store.verifyToken(login.token);
  assert.equal(session?.deviceName, 'iPhone Safari');
});

test('login rejects when password is not configured and does not create auth state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });

  await assert.rejects(
    () => store.login({ password: 'correct horse battery staple', deviceName: 'iPhone Safari' }),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error & { code?: string }).code, 'setup_required');
      assert.match((error as Error).message, /password not configured/i);
      return true;
    },
  );

  await assert.rejects(() => fs.readFile(authPath, 'utf8'), { code: 'ENOENT' });
});

test('invalid login is rejected and logout removes only current session', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const store = new AuthStore({ authPath: path.join(dir, 'auth.json') });
  await store.setPassword('password-one');

  await assert.rejects(
    () => store.login({ password: 'wrong', deviceName: 'bad' }),
    /Invalid password/,
  );

  const first = await store.login({ password: 'password-one', deviceName: 'phone-a' });
  const second = await store.login({ password: 'password-one', deviceName: 'phone-b' });
  await store.logout(first.token);

  assert.equal(await store.verifyToken(first.token), null);
  assert.equal((await store.verifyToken(second.token))?.deviceName, 'phone-b');
});

test('concurrent logins preserve every created session', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });
  await store.setPassword('password-one');

  const logins = await Promise.all(Array.from({ length: 8 }, (_, index) => store.login({
    password: 'password-one',
    deviceName: `phone-${index + 1}`,
  })));

  assert.equal(logins.length, 8);
  const persisted = JSON.parse(await fs.readFile(authPath, 'utf8')) as {
    sessions: Array<{ deviceName: string }>;
  };
  assert.equal(persisted.sessions.length, 8);
  assert.deepEqual(
    persisted.sessions.map((session) => session.deviceName).sort(),
    [
      'phone-1',
      'phone-2',
      'phone-3',
      'phone-4',
      'phone-5',
      'phone-6',
      'phone-7',
      'phone-8',
    ],
  );
});

test('logout does not resurrect a token when verification is racing a stale write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });
  await store.setPassword('password-one');
  const login = await store.login({ password: 'password-one', deviceName: 'phone-a' });

  const staleState = JSON.parse(await fs.readFile(authPath, 'utf8'));
  staleState.sessions[0].lastSeenAt = new Date(Date.now() - 60_000).toISOString();
  await fs.writeFile(authPath, JSON.stringify(staleState));

  const originalWriteState = (store as any).writeState.bind(store) as (state: unknown) => Promise<void>;
  let blockNextWrite = true;
  let releaseBlockedWrite: (() => void) | null = null;
  let notifyBlockedWrite: (() => void) | null = null;
  const blockedWrite = new Promise<void>((resolve) => {
    notifyBlockedWrite = resolve;
  });
  const blockedWriteReleased = new Promise<void>((resolve) => {
    releaseBlockedWrite = resolve;
  });

  (store as any).writeState = async (state: unknown) => {
    if (blockNextWrite) {
      blockNextWrite = false;
      notifyBlockedWrite?.();
      await blockedWriteReleased;
    }
    await originalWriteState(state);
  };

  const verifyPromise = store.verifyToken(login.token);
  await blockedWrite;
  const logoutPromise = store.logout(login.token);
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseBlockedWrite?.();

  await Promise.all([verifyPromise, logoutPromise]);
  assert.equal(await store.verifyToken(login.token), null);
});

test('fresh verifications perform no writes and cross-instance revoke is immediately authoritative', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });
  await store.setPassword('password-one');
  const first = await store.login({ password: 'password-one' });
  const before = await fs.stat(authPath);
  await Promise.all(Array.from({ length: 100 }, () => store.verifyToken(first.token)));
  assert.equal((await fs.stat(authPath)).mtimeMs, before.mtimeMs);
  assert.equal((await fs.readdir(dir)).some((name) => name.endsWith('.lock')), false);
  await new AuthStore({ authPath }).logout(first.token);
  assert.equal(await store.verifyToken(first.token), null);
});

test('session TTL, device revoke, other-device revoke and explicit corruption recovery fail closed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });
  await store.setPassword('password-one');
  const a = await store.login({ password: 'password-one', deviceName: 'A' });
  const b = await store.login({ password: 'password-one', deviceName: 'B' });
  assert.equal((await store.listSessions(a.token)).length, 2);
  await store.revokeSession(a.token, b.session.id);
  assert.equal(await store.verifyToken(b.token), null);
  const c = await store.login({ password: 'password-one' });
  await store.revokeOtherSessions(a.token);
  assert.equal(await store.verifyToken(c.token), null);
  const expired = new AuthStore({ authPath, sessionTtlMs: -1 });
  const d = await expired.login({ password: 'password-one' });
  assert.equal(await expired.verifyToken(d.token), null);
  await fs.writeFile(authPath, '{corrupt');
  await assert.rejects(() => store.verifyToken(a.token));
  await store.setPassword('replacement-password');
  assert.equal(await store.verifyToken(a.token), null);
  await assert.rejects(() => store.login({ password: 'password-one' }));
  assert.ok(await store.login({ password: 'replacement-password' }));
  assert.ok((await fs.readdir(dir)).some((name) => name.includes('.corrupt-')));
});


test('real child-process verification/login/logout cannot undo password rotation', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-process-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });
  await store.setPassword('password-one');
  const login = await store.login({ password: 'password-one' });
  const state = JSON.parse(await fs.readFile(authPath, 'utf8'));
  state.sessions[0].lastSeenAt = new Date(0).toISOString();
  await fs.writeFile(authPath, JSON.stringify(state));
  const moduleUrl = new URL('../src/auth_store.ts', import.meta.url).href;
  const source = `import { AuthStore } from ${JSON.stringify(moduleUrl)};
    const store = new AuthStore({authPath: process.env.TEST_AUTH_PATH});
    const write = store.writeState.bind(store);
    let paused = false;
    store.writeState = async (state) => {
      if (!paused) { paused = true; process.stdout.write('ready\\n'); await new Promise(resolve => process.stdin.once('data', resolve)); }
      await write(state);
    };
    for (let i=0;i<8;i++) {
      await store.verifyToken(process.env.TEST_AUTH_TOKEN);
      try { const login = await store.login({password:'password-one'}); await store.logout(login.token); } catch {}
    }`;
  const child = spawn(process.execPath, ['--conditions=development', '--import', 'tsx', '--input-type=module', '-e', source], {
    env: { ...process.env, TEST_AUTH_PATH: authPath, TEST_AUTH_TOKEN: login.token }, stdio: 'pipe',
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Child exited ${code}`)));
  });
  await Promise.race([new Promise<void>((resolve) => child.stdout.once('data', () => resolve())), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('child barrier timeout')), 5000).unref())]);
  let rotated = false;
  const rotation = store.setPassword('replacement-password').then(() => { rotated = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(rotated, false, 'rotation waits for the child transaction');
  } finally { child.stdin.end('release'); }
  await Promise.all([rotation, done]);
  assert.equal(await store.verifyToken(login.token), null);
  await assert.rejects(() => store.login({ password: 'password-one' }));
  assert.ok(await store.login({ password: 'replacement-password' }));
});

test('backup failure is reported without turning a committed password change into a failure', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-backup-'));
  const authPath = path.join(dir, 'auth.json');
  await fs.mkdir(`${authPath}.backup`);
  const store = new AuthStore({ authPath });
  await store.setPassword('password-one');
  assert.equal(store.diagnostics().backupHealthy, false);
  assert.ok(await store.login({ password: 'password-one' }));
  await fs.rm(`${authPath}.backup`, { recursive: true });
  await store.setPassword('password-two');
  assert.equal(store.diagnostics().backupHealthy, true);
});
