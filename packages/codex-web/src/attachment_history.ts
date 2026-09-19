import crypto from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BigIntStats } from 'node:fs';

const footer = '\nUse the local file paths above when you inspect these attachments.';
const hashes = new Map<string, { version: string; digest: string }>();
const maxFileBytes = 25 * 1024 * 1024;

/** Repair only the presentation of old, duplicated upload snapshots. Never edit Codex history. */
export async function repairAttachmentHistory<T>(
  items: readonly T[], scope: { stateDir: string; sessionId: string },
): Promise<T[]> {
  const result: T[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || !('role' in item) || item.role !== 'user'
      || !('text' in item) || typeof item.text !== 'string') { result.push(item); continue; }
    const text = await repairPrompt(item.text, scope);
    result.push(text === item.text ? item : { ...item, text });
  }
  return result;
}

async function repairPrompt(text: string, scope: { stateDir: string; sessionId: string }): Promise<string> {
  const end = text.lastIndexOf(footer);
  if (end < 0) return text;
  const marker = '\n\nAttachments:\n';
  const start = text.lastIndexOf(marker, end);
  const blockStart = start >= 0 ? start + marker.length : text.startsWith('Attachments:\n') ? 'Attachments:\n'.length : -1;
  if (blockStart < 0) return text;
  const blocks = text.slice(blockStart, end).trimEnd().split(/\n(?=\d+\. )/u);
  if (blocks.length < 2 || blocks.length > 64) return text;
  const entries = blocks.map((block, index) => {
    if (!block.startsWith(`${index + 1}. `)) return null;
    const filePath = block.match(/^   path: (.+)$/mu)?.[1];
    if (!filePath) return null;
    const metadata = block.replace(/^\d+\. /u, '').replace(/^   path: .+\n?/mu, '');
    return { block, filePath, metadata };
  });
  if (entries.some(entry => !entry)) return text;
  const counts = new Map<string, number>();
  for (const entry of entries) if (entry) counts.set(entry.metadata, (counts.get(entry.metadata) || 0) + 1);
  const seen = new Set<string>(), kept: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    const digest = (counts.get(entry.metadata) || 0) > 1 ? await snapshotDigest(entry.filePath, scope) : null;
    const key = digest ? `${entry.metadata}\0${digest}` : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(entry.block.replace(/^\d+\./u, `${kept.length + 1}.`));
  }
  return kept.length === blocks.length ? text : `${text.slice(0, blockStart)}${kept.join('\n')}\n${text.slice(end)}`;
}

async function snapshotDigest(filePath: string, scope: { stateDir: string; sessionId: string }): Promise<string | null> {
  const root = path.resolve(scope.stateDir, 'turn-attachments');
  const candidate = path.resolve(filePath);
  const segments = path.relative(root, candidate).split(path.sep);
  const sessionSegment = scope.sessionId.trim().replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'unknown';
  // A prompt is untrusted. Only inspect this session's generated, immutable snapshots.
  if (segments.length !== 3 || !segments[0] || segments[0] === '..' || segments[1] !== sessionSegment
    || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}-.+/iu.test(segments[2]!)) return null;
  try {
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(candidate)]);
    if (realFile !== path.join(realRoot, ...segments)) return null;
    const before = await fs.lstat(candidate, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maxFileBytes)) return null;
    const version = fileVersion(before), cached = hashes.get(candidate);
    if (cached?.version === version) return cached.digest;
    const handle = await fs.open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    let digest: string;
    try {
      if (fileVersion(await handle.stat({ bigint: true })) !== version) return null;
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
        bytes += chunk.length;
        if (bytes > maxFileBytes) return null;
        hash.update(chunk);
      }
      if (fileVersion(await handle.stat({ bigint: true })) !== version) return null;
      digest = hash.digest('hex');
    } finally { await handle.close(); }
    if (fileVersion(await fs.lstat(candidate, { bigint: true })) !== version) return null;
    hashes.delete(candidate); hashes.set(candidate, { version, digest });
    while (hashes.size > 512) hashes.delete(hashes.keys().next().value!);
    return digest;
  } catch { return null; } // Missing/expired/unreadable files must not hide a potentially distinct attachment.
}

function fileVersion(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
