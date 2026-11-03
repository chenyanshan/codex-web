import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_SCAN_FILE_BYTES = 8 * 1024 * 1024;

/** Read-only inventory; never chooses an owner or emits credentials/prompt contents. */
export async function auditSessionOwnership(stateDir) {
  const identity = JSON.parse(await fs.readFile(path.join(stateDir, 'identity.json'), 'utf8'));
  const groups = new Map();
  for (const session of identity.sessions ?? []) {
    if (typeof session.id !== 'string' || !session.id || typeof session.codexThreadId !== 'string' || !session.codexThreadId) {
      throw new Error('Invalid session identifiers; inspect identity.json before inventorying references');
    }
    const entries = groups.get(session.codexThreadId) ?? [];
    entries.push(session); groups.set(session.codexThreadId, entries);
  }
  const duplicates = [...groups].filter(([, sessions]) => sessions.length > 1).map(([threadId, sessions]) => ({
    threadId,
    sessions: sessions.map(({ id, ownerUserId, projectId, createdAt, updatedAt, archived }) => ({
      id, ownerUserId, projectId, createdAt, updatedAt, archived,
    })),
  }));
  const ids = new Set(duplicates.flatMap((group) => group.sessions.map((session) => session.id)));
  const references = []; const unscanned = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const file = path.relative(stateDir, absolute);
      if (entry.isSymbolicLink()) { unscanned.push({ file, reason: 'symbolic-link' }); continue; }
      if (entry.isDirectory()) { await visit(absolute); continue; }
      if (!entry.isFile()) continue;
      const found = new Map();
      const add = (id) => found.set(id, (found.get(id) ?? 0) + 1);
      for (const id of ids) if (file.includes(id)) add(id);
      if (/\.jsonl?$/u.test(file)) {
        const stat = await fs.stat(absolute);
        if (stat.size > MAX_SCAN_FILE_BYTES) unscanned.push({ file, reason: 'over-8-MiB-inspect-separately' });
        else {
          const raw = await fs.readFile(absolute, 'utf8');
          // Count serialized ID occurrences, including keys and embedded log references.
          // This is a candidate-reference inventory, not an automatic migration plan.
          for (const id of ids) {
            let offset = 0;
            while ((offset = raw.indexOf(id, offset)) !== -1) { add(id); offset += id.length; }
          }
        }
      } else unscanned.push({ file, reason: 'non-json-content' });
      for (const [sessionId, count] of found) references.push({ file, sessionId, count });
    }
  }
  if (ids.size) await visit(stateDir);
  return { generatedAt: new Date().toISOString(), duplicates, references, unscanned,
    note: 'Read-only candidate references. Review creation evidence and all unscanned files; never infer ownership from an app_legacy_ prefix.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const stateDir = process.argv[2];
  if (!stateDir) throw new Error('Usage: node scripts/maintenance/audit-session-ownership.mjs /path/to/state-dir');
  process.stdout.write(`${JSON.stringify(await auditSessionOwnership(path.resolve(stateDir)), null, 2)}\n`);
}
