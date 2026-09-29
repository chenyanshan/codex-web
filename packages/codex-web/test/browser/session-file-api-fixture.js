import { test as base } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexWebServer } from '../../src/server.ts';
import { loadServiceConfig } from '../../src/config.ts';

// The UI uses the existing chat fixture, but file requests reach the real API,
// including authentication, scope resolution and filesystem reads.
export const test = base.extend({
  sessionFileApi: async ({}, use) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-browser-files-'));
    const sessions = {};
    const server = createCodexWebServer({
      config: { ...loadServiceConfig({ homeDir: root, env: {} }), host: '127.0.0.1', port: 0 },
      auth: {
        isConfigured: async () => true,
        verifyToken: async token => token === 'markdown-link-fixture'
          ? { id: 'test-auth', deviceName: 'browser', createdAt: '', lastSeenAt: '' } : null,
        login: async () => { throw new Error('unused'); },
        logout: async () => {},
      },
      runtime: {
        readSession: async id => sessions[id] ?? null,
        readSessionMetadata: async id => sessions[id] ? { ...sessions[id], timeline: [] } : null,
        readSessionTimeline: async id => sessions[id] ?? null,
      },
    });
    try {
      await server.start();
      await use({ root, sessions, baseUrl: server.baseUrl });
    } finally {
      await server.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
});
