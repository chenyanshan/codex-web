#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { 'codex-bin': { type: 'string' }, out: { type: 'string' }, 'source-commit': { type: 'string' } } });
if (!values['codex-bin'] || !values.out) throw new Error('Required: --codex-bin ABSOLUTE_PATH --out DIRECTORY [--source-commit SHA]');
const bin = fs.realpathSync(values['codex-bin']);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-schema-'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const env = { PATH: process.env.PATH, HOME: temp, CODEX_HOME: temp };
const version = execFileSync(bin, ['--version'], { env, encoding: 'utf8' }).trim();
const manifest = { version, source: `https://github.com/openai/codex/tree/rust-v${version.replace('codex-cli ', '')}`, sourceCommit: values['source-commit'] ?? null, license: 'Apache-2.0; see LICENSE', binarySha256: hash(fs.readFileSync(bin)), generation: [], transformation: 'Append .js to relative TypeScript module specifiers for NodeNext; no protocol fields changed.', files: {} };
function visit(dir, base) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file, base);
    else if (file.endsWith('.ts')) {
      const raw = fs.readFileSync(file, 'utf8');
      const normalized = raw.replace(/(from\s+["'])(\.[^"']+)(["'])/g, (_, before, spec, after) => before + (fs.existsSync(path.resolve(path.dirname(file), spec, 'index.ts')) ? `${spec}/index.js` : spec.endsWith('.js') ? spec : `${spec}.js`) + after);
      fs.writeFileSync(file, normalized);
      manifest.files[path.relative(base, file)] = { upstreamSha256: hash(raw), sha256: hash(normalized) };
    }
  }
}
try {
  fs.mkdirSync(values.out, { recursive: true });
  for (const variant of ['stable', 'experimental']) {
    const out = path.join(values.out, variant);
    if (fs.existsSync(out)) fs.rmSync(out, { recursive: true });
    const args = ['app-server', 'generate-ts', ...(variant === 'experimental' ? ['--experimental'] : []), '--out', out];
    execFileSync(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    manifest.generation.push(`codex app-server generate-ts ${variant === 'experimental' ? '--experimental ' : ''}--out ${variant}`);
    visit(out, values.out);
  }
  fs.writeFileSync(path.join(values.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ version, files: Object.keys(manifest.files).length, out: path.resolve(values.out) }));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
