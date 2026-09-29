import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RuntimeUpdateService, stableRuntimeVersion } from '../src/runtime_update.js';

test('only exact selected npm package is updatable, version status is cached, pinned official update is verified', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-update-'));
  try {
    const pkg = path.join(root, '@openai/codex'); const binary = path.join(pkg, 'bin/codex.js');
    await fs.mkdir(path.dirname(binary), { recursive: true }); await fs.writeFile(binary, '');
    await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: '@openai/codex' }));
    const calls: string[][] = []; let version = '1.2.2';
    const updater = new RuntimeUpdateService({ codexBin: binary, compatibilityScript: '/repo/scripts/app-server/compatibility.ts', execute: async (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === '--version') return `codex-cli ${version}`;
      if (args[0] === 'root') return root;
      if (args[0] === 'view') return '"1.2.3"';
      if (args[0] === 'install') { version = '1.2.3'; return ''; }
      return '{}';
    } });
    await updater.refresh(); assert.equal(updater.status().updateSupported, true);
    const previous = calls.length; updater.status(); updater.status(); assert.equal(calls.length, previous);
    const target = await updater.resolveStableTarget(); await updater.installPinned(target); await updater.verifyInstalled(target);
    assert.equal(updater.status().installedVersion, '1.2.3');
    assert.deepEqual(calls.find(call => call[1] === 'install'), ['npm', 'install', '-g', '@openai/codex@1.2.3', '--registry=https://registry.npmjs.org']);
    assert.ok(calls.some(call => call.includes('/repo/scripts/app-server/compatibility.ts')));
    assert.equal(calls.filter(call => call[1] === 'view').length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('unknown install is explicit and stable versions reject injection/prerelease/latest', async () => {
  const updater = new RuntimeUpdateService({ codexBin: '/unknown/codex', compatibilityScript: '/check.ts', execute: async () => { throw new Error('missing'); } });
  await updater.refresh(); assert.equal(updater.status().installedVersion, null); assert.equal(updater.status().updateSupported, false);
  await assert.rejects(updater.resolveStableTarget(), /Unsupported/);
  for (const value of ['latest', '1.2.3-beta', '1.2.3; echo secret', '../1.2.3']) assert.throws(() => stableRuntimeVersion(value));
});

test('applying a PATH-selected CLI passes its resolved absolute path to compatibility verification', async () => {
  const calls: string[][] = [];
  const updater = new RuntimeUpdateService({ codexBin: 'codex', compatibilityScript: '/repo/check.ts',
    resolveBinary: async bin => { assert.equal(bin, 'codex'); return '/selected/bin/codex'; },
    execute: async (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === '--version') return 'codex-cli 0.159.0';
      if (args[0] === 'root') throw new Error('Not npm');
      return '{}';
    },
  });
  await updater.verifyInstalled('0.159.0');
  const verification = calls.find(call => call.includes('/repo/check.ts'))!;
  assert.equal(verification[verification.indexOf('--codex-bin') + 1], '/selected/bin/codex');
});
