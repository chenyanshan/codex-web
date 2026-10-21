import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCodexWebServer } from '../src/server.js';

function config(stateDir: string) {
  return {
    host: '127.0.0.1',
    port: 0,
    defaultCwd: '/tmp',
    codexBin: 'codex',
    stateDir,
    authPath: path.join(stateDir, 'auth.json'),
    reportsDir: path.join(stateDir, 'reports'),
    reportIndexPath: path.join(stateDir, 'reports.json'),
    envPath: path.join(stateDir, 'service.env'),
    debug: false,
    publicSharesEnabled: false,
    publicShareTtlSeconds: 3600,
  };
}

function auth() {
  return {
    isConfigured: async () => true,
    login: async () => ({
      token: 'unused',
      session: { id: 'auth', deviceName: 'test', createdAt: '', lastSeenAt: '' },
      configuredNow: false,
    }),
    verifyToken: async (token: string | null | undefined) => token === 'token'
      ? { id: 'auth', deviceName: 'test', createdAt: '', lastSeenAt: '' }
      : null,
    logout: async () => {},
  };
}

function runtime() {
  const session = {
    id: 'session_attention',
    cwd: '/tmp',
    title: 'Read receipt test',
    latestTurn: { id: 'turn_completed', status: 'completed' },
    activeTurnId: null,
    settings: {},
    thread: { turns: [] },
    timeline: [],
  };
  let fullReads = 0;
  let statusReads = 0;
  return {
    listModels: async () => [],
    readUsage: async () => null,
    listSessions: async () => [session],
    readSession: async (id: string) => { fullReads += 1; return id === session.id ? session : null; },
    readSessionStatus: async (id: string) => { statusReads += 1; return id === session.id ? session : null; },
    threadIdForTurn: (turnId: string) => turnId === 'turn_completed' ? session.id : null,
    reads: () => ({ fullReads, statusReads }),
  };
}

async function json(response: Response): Promise<any> {
  return response.json();
}

test('session read receipts persist across server instances and stay authenticated', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-attention-'));
  t.after(async () => fs.rm(stateDir, { recursive: true, force: true }));
  const runtimeInstance = runtime();
  const options = { auth: auth(), runtime: runtimeInstance as any, config: config(stateDir) };
  const first = createCodexWebServer(options);
  await first.start();
  try {
    const unauthorized = await fetch(`${first.baseUrl}/api/sessions/session_attention/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId: 'turn_completed' }),
    });
    assert.equal(unauthorized.status, 401);

    const initial = await fetch(`${first.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert.equal(initial.status, 200);
    assert.equal((await json(initial)).items[0].readTurnId, undefined);

    const marked = await fetch(`${first.baseUrl}/api/sessions/session_attention/read`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId: 'turn_completed' }),
    });
    assert.equal(marked.status, 200);
    assert.equal((await json(marked)).readTurnId, 'turn_completed');
    assert.deepEqual(runtimeInstance.reads(), { fullReads: 0, statusReads: 1 });

    const invalid = await fetch(`${first.baseUrl}/api/sessions/session_attention/read`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId: 'other_session_turn' }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await first.stop();
  }

  const second = createCodexWebServer(options);
  await second.start();
  try {
    const restored = await fetch(`${second.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer token' },
    });
    assert.equal(restored.status, 200);
    assert.equal((await json(restored)).items[0].readTurnId, 'turn_completed');
    assert.deepEqual(runtimeInstance.reads(), { fullReads: 0, statusReads: 2 });
  } finally {
    await second.stop();
  }
});
