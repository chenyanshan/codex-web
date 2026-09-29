import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/submission-delivery.js', import.meta.url), 'utf8');
const { createController } = vm.runInNewContext(`${source}\nCodexWebSubmissionDelivery;`, { AbortController });

for (const fault of ['receipt write', 'timeline write']) {
  test(`acceptance survives ${fault} failure and recovery never POSTs again`, async () => {
    let entry: any = { id: 'submission', status: 'pending', sessionId: 'session', text: 'Execute once', settings: {}, attachments: [], attempts: 0, nextAttemptAt: 0 };
    let durable = structuredClone(entry), fail = true, errors = 0, callbacks = 0;
    const methods: string[] = [];
    const options = {
      get: () => entry, owns: () => true, generation: () => 1, controllers: new Map(), timeoutMs: 100,
      save(value: any) {
        if (fail && fault === 'receipt write' && value.acceptedReceipt) throw new Error('quota');
        durable = structuredClone(value); entry = value; return value;
      },
      async request(_path: string, options: any) {
        methods.push(options.method);
        return { submission: { id: entry.id, status: 'submitted', sessionId: 'session', turnId: 'turn' } };
      },
      accepted() { callbacks += 1; if (fail && fault === 'timeline write') throw new Error('quota'); entry = null; },
      retryDelay: () => 1, schedule() {}, changed() {}, failed() { assert.fail('known acceptance must not become a failed submission'); }, reset() {}, defer: () => false, authError() {}, storageError() { errors += 1; },
    };
    const controller = createController(options);
    await controller.deliver('submission');
    assert.equal(errors, 1);
    assert.equal(entry.status, 'outcome_unknown');
    assert.equal(entry.acceptedReceipt.turnId, 'turn');
    const interruptedDurableState = structuredClone(durable);
    fail = false;
    await controller.deliver('submission', { force: true });
    assert.equal(entry, null);
    assert.deepEqual(methods, ['POST']);
    assert.ok(callbacks >= 1);
    // A fresh page can recover the last durable state too. "sending" is
    // conservatively restored as outcome_unknown, matching the outbox loader.
    entry = { ...interruptedDurableState, status: 'outcome_unknown' };
    await createController({ ...options, controllers: new Map() }).deliver('submission', { force: true });
    assert.equal(entry, null);
    assert.deepEqual(methods, fault === 'receipt write' ? ['POST', 'GET'] : ['POST']);
  });
}
