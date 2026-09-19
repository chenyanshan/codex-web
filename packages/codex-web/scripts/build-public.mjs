import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { transform, version as esbuildVersion } from 'esbuild';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Emit independent, minified assets without changing the classic-script/module loading contract. */
export async function buildPublic({ sourceRoot = path.join(packageRoot, 'public'), outdir = path.join(packageRoot, 'dist/public') } = {}) {
  const staging = `${outdir}.building-${crypto.randomUUID()}`;
  const emitted = [];
  const manifest = { version: 1, esbuildVersion, builderHash: digest(await fs.readFile(fileURLToPath(import.meta.url))), assets: [] };
  await fs.mkdir(staging, { recursive: true });
  try {
    const visit = async (relative = '') => {
      const entries = await fs.readdir(path.join(sourceRoot, relative), { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const name = path.join(relative, entry.name);
        if (entry.isDirectory()) { await fs.mkdir(path.join(staging, name), { recursive: true }); await visit(name); continue; }
        if (!entry.isFile()) throw new Error(`Public asset must be a regular file: ${name}`);
        const source = await fs.readFile(path.join(sourceRoot, name));
        let output = source;
        if (/\.(?:js|css)$/u.test(name)) {
          const result = await transform(source.toString('utf8'), {
            loader: name.endsWith('.css') ? 'css' : 'js',
            minify: true,
            target: ['es2022', 'safari16.4'],
            legalComments: 'none',
            charset: 'utf8',
            sourcefile: name,
            // No bundle/format conversion: existing self-contained modules retain their globals.
          });
          output = Buffer.from(result.code);
        }
        await fs.writeFile(path.join(staging, name), output);
        const assetName = name.split(path.sep).join('/');
        emitted.push({ name: assetName, sourceBytes: source.length, outputBytes: output.length });
        manifest.assets.push({ name: assetName, sourceHash: digest(source), outputHash: digest(output) });
      }
    };
    await visit();
    await fs.writeFile(path.join(staging, '.build-manifest.json'), JSON.stringify(manifest));
    await fs.rm(outdir, { recursive: true, force: true });
    await fs.rename(staging, outdir);
    return emitted;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

/** Detect changed/deleted/added sources and damaged emitted files before validating a deployment. */
export async function verifyBuiltPublic({ sourceRoot = path.join(packageRoot, 'public'), outdir = path.join(packageRoot, 'dist/public') } = {}) {
  const stale = (name) => new Error(`Public build is stale or incomplete (${name}); run npm run build.`);
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(outdir, '.build-manifest.json'), 'utf8')); }
  catch { throw stale('missing build manifest'); }
  if (manifest.version !== 1 || manifest.esbuildVersion !== esbuildVersion || manifest.builderHash !== digest(await fs.readFile(fileURLToPath(import.meta.url))) || !Array.isArray(manifest.assets)) throw stale('build tool version');
  const sourceNames = [];
  const visit = async (relative = '') => {
    for (const entry of await fs.readdir(path.join(sourceRoot, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) sourceNames.push(name.split(path.sep).join('/'));
      else throw stale(name);
    }
  };
  await visit();
  if (JSON.stringify(sourceNames.sort()) !== JSON.stringify(manifest.assets.map((asset) => asset.name).sort())) throw stale('source file list');
  for (const asset of manifest.assets) {
    try {
      if (digest(await fs.readFile(path.join(sourceRoot, asset.name))) !== asset.sourceHash
        || digest(await fs.readFile(path.join(outdir, asset.name))) !== asset.outputHash) throw stale(asset.name);
    } catch { throw stale(asset.name); }
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    await verifyBuiltPublic();
    process.stdout.write('Public build matches current sources.\n');
  } else {
  const emitted = await buildPublic();
  process.stdout.write(`Built ${emitted.length} public assets (${emitted.reduce((sum, item) => sum + item.outputBytes, 0)} bytes).\n`);
  }
}
