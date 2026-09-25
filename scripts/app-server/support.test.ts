import assert from 'node:assert/strict';
import test from 'node:test';
import { isolatedEnvironment, optionalCheck, validateOptionalResponse } from './support.js';
test('isolated environment excludes credentials and inherited configuration', () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-secret';
  try {
    const env = isolatedEnvironment('/tmp/fixture-home');
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.CODEX_HOME, '/tmp/fixture-home');
    assert.equal(env.HOME, '/tmp/fixture-home');
    assert.deepEqual(Object.keys(env).sort(), ['CODEX_HOME', 'HOME', 'LANG', 'PATH', 'TMPDIR']);
  } finally {
    if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior;
  }
});
test('optional method only downgrades explicit method-not-found', async () => {
  assert.equal((await optionalCheck('fixture', async () => { throw Object.assign(new Error('unknown'), { rpcCode: -32601 }); })).status, 'unsupported');
  for (const rpcCode of [401, 403, 429, -32602, undefined]) {
    const failure = Object.assign(new Error('failure'), { rpcCode });
    await assert.rejects(optionalCheck('fixture', async () => { throw failure; }), error => error === failure);
  }
  assert.equal((await optionalCheck('fixture', async () => ({}))).status, 'passed');
});

test('method-not-found uses the actual native transport error shape', async () => {
  const { acceptResponse } = await import('../../packages/codex-native-api/src/app_server/transport.js');
  let actual: Error | undefined;
  const host: any = { pending: new Map([['1', { resolve: () => assert.fail('must reject'), reject: (error: Error) => { actual = error; } }]]) };
  acceptResponse(host, { id: '1', error: { code: -32601, message: 'Unknown method' } });
  assert.ok(actual);
  assert.equal((await optionalCheck('fixture', async () => { throw actual; })).status, 'unsupported');
  const unrelated = Object.assign(new Error('not RPC'), { code: -32601 });
  await assert.rejects(optionalCheck('fixture', async () => { throw unrelated; }), error => error === unrelated);
});
test('optional responses reject malformed successes and tolerate extensions', () => {
  validateOptionalResponse('skills/list', { data: [{ cwd: '/fixture', skills: [], errors: [], extra: true }] });
  validateOptionalResponse('mcpServerStatus/list', { data: [{ name: 'fixture', authStatus: 'notLoggedIn', tools: {}, resources: [], resourceTemplates: [] }], nextCursor: null });
  for (const value of [null, {}, { data: {} }, { data: [null] }, { data: [{}] }]) {
    assert.throws(() => validateOptionalResponse('skills/list', value));
    assert.throws(() => validateOptionalResponse('mcpServerStatus/list', value));
  }
});
