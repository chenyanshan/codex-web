import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/submission-identity.js', import.meta.url), 'utf8');
// Deliberately provide no crypto global: LAN HTTP must not need crypto.subtle.
const { clientMessageId } = vm.runInNewContext(`${source}\nCodexWebSubmissionIdentity;`, { TextEncoder });
const expected = (input: string) => createHash('sha256').update(input).digest('hex').slice(0, 24);

test('submission identity matches published SHA-256 vectors synchronously', () => {
  for (const [input, digest] of [
    ['', 'e3b0c44298fc1c149afbf4c8'],
    ['abc', 'ba7816bf8f01cfea414140de'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c02693'],
    ['a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e2'],
  ]) assert.equal(clientMessageId(input), digest);
});

test('UTF-8, surrogate replacement, whitespace, and block padding match server hashing exactly', () => {
  const inputs = ['提交消息🚀', '  no trimming\n', '\0id\0', '\ud800', '\udc00', 'e\u0301', 'é', '会话😀'.repeat(4096)];
  for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129]) inputs.push('a'.repeat(length));
  for (const input of inputs) assert.equal(clientMessageId(input), expected(input), JSON.stringify(input.slice(0, 40)));
});

test('deterministic randomized Unicode submission IDs agree with node crypto', () => {
  let seed = 0x1729;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let trial = 0; trial < 256; trial += 1) {
    const length = random() % 512;
    const input = Array.from({ length }, () => String.fromCharCode(random() & 0xffff)).join('');
    assert.equal(clientMessageId(input), expected(input), `trial ${trial}`);
  }
});
