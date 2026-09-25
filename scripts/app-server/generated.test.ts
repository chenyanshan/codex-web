import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('../../packages/codex-native-api/src/app_server/generated/', import.meta.url));
test('generated protocol matches manifest and NodeNext module references resolve', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 'codex-cli 0.156.1');
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
  for (const [relative, metadata] of Object.entries(manifest.files) as Array<[string, { sha256: string }]>) {
    const file = path.join(base, relative);
    const body = fs.readFileSync(file, 'utf8');
    assert.equal(createHash('sha256').update(body).digest('hex'), metadata.sha256, relative);
    for (const [, spec] of body.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      assert.ok(spec.endsWith('.js'), `${relative}: ${spec}`);
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'))), `${relative}: ${spec}`);
    }
  }
});
