import assert from 'node:assert/strict';
import { isUnsupportedMethod } from '../../packages/codex-native-api/src/app_server/capabilities.js';
export const requiredMethods = ['initialize', 'thread/start', 'thread/read', 'thread/resume', 'thread/list', 'thread/unsubscribe', 'thread/name/set', 'thread/archive', 'thread/unarchive', 'turn/start', 'turn/steer', 'turn/interrupt', 'model/list', 'config/read', 'config/value/write'];
/** Deliberate allowlist: no login, provider keys, inherited config or proxy secrets. */
export function isolatedEnvironment(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: home, LANG: 'C.UTF-8' };
}
export async function optionalCheck(name: string, run: () => Promise<unknown>) {
  try { await run(); return { name, status: 'passed' }; }
  catch (error) {
    if (isUnsupportedMethod(error)) return { name, status: 'unsupported', detail: 'explicit JSON-RPC method-not-found' };
    throw error;
  }
}

/** Validate stable fields used by the facade, allowing unknown optional extensions. */
export function validateOptionalResponse(method: 'skills/list' | 'mcpServerStatus/list', value: any): void {
  assert.ok(value && Array.isArray(value.data), `${method}: expected data array`);
  for (const entry of value.data) {
    assert.ok(entry && typeof entry === 'object', `${method}: invalid entry`);
    if (method === 'skills/list') {
      assert.equal(typeof entry.cwd, 'string');
      assert.ok(Array.isArray(entry.skills));
      assert.ok(Array.isArray(entry.errors));
      for (const skill of entry.skills) {
        assert.equal(typeof skill?.name, 'string');
        assert.equal(typeof skill?.path, 'string');
      }
    } else {
      assert.equal(typeof entry.name, 'string');
      assert.equal(typeof entry.authStatus, 'string');
      assert.ok(entry.tools && typeof entry.tools === 'object' && !Array.isArray(entry.tools));
      assert.ok(Array.isArray(entry.resources));
      assert.ok(Array.isArray(entry.resourceTemplates));
    }
  }
  if (method === 'mcpServerStatus/list') assert.ok(value.nextCursor == null || typeof value.nextCursor === 'string');
}
