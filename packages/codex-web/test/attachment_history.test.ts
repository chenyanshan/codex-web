import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repairAttachmentHistory } from '../src/attachment_history.js';

function prompt(paths: string[]) {
  return ['Compare the screenshots', '', 'Attachments:', ...paths.flatMap((filePath, index) => [
    `${index + 1}. image`, `   path: ${filePath}`, '   filename: image.png', '   mime: image/png', '   attached_as: localImage',
  ]), '', 'Use the local file paths above when you inspect these attachments.'].join('\n');
}

test('old attachment snapshots are deduplicated by contents within each message, without rewriting history', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-history-attachments-'));
  t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const root = path.join(stateDir, 'turn-attachments', 'local-admin', 'thread_1');
  await fs.mkdir(root, { recursive: true });
  const snapshots = await Promise.all(['same picture', 'other image!', 'same picture'].map(async content => {
    const filePath = path.join(root, `${crypto.randomUUID()}-image.png`);
    await fs.writeFile(filePath, content); return filePath;
  }));
  const text = prompt(snapshots);
  const items = [{ role: 'user', text }, { role: 'user', text }];
  const scope = { stateDir, sessionId: 'thread_1' };
  const first = await repairAttachmentHistory(items, scope);
  assert.deepEqual(first.map(item => item.text), [prompt(snapshots.slice(0, 2)), prompt(snapshots.slice(0, 2))]);
  assert.equal(items[0]!.text, text);
  assert.equal((await fs.readdir(root)).length, 3);
  // Same-size external changes invalidate the digest cache, preserving distinct images with the same name.
  await fs.writeFile(snapshots[2]!, 'new picture!');
  assert.equal((await repairAttachmentHistory(items, scope))[0]!.text, text);
});

test('missing, foreign-session, symlinked and non-user attachment references are never guessed away', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-history-attachment-scope-'));
  t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const root = path.join(stateDir, 'turn-attachments', 'local-admin', 'other_thread');
  await fs.mkdir(root, { recursive: true });
  const files = [0, 1].map(() => path.join(root, `${crypto.randomUUID()}-image.png`));
  await Promise.all(files.map(filePath => fs.writeFile(filePath, 'same picture')));
  const text = prompt(files);
  assert.deepEqual(await repairAttachmentHistory([{ role: 'user', text }], { stateDir, sessionId: 'thread_1' }), [{ role: 'user', text }]);
  assert.deepEqual(await repairAttachmentHistory([{ role: 'assistant', text }], { stateDir, sessionId: 'other_thread' }), [{ role: 'assistant', text }]);
  await fs.unlink(files[1]!);
  assert.equal((await repairAttachmentHistory([{ role: 'user', text }], { stateDir, sessionId: 'other_thread' }))[0]!.text, text);
  await fs.symlink(files[0]!, files[1]!);
  assert.equal((await repairAttachmentHistory([{ role: 'user', text }], { stateDir, sessionId: 'other_thread' }))[0]!.text, text);
});
