import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

async function harness() {
  const handlers = new Map<string, Function>();
  const nodes = new Map<string, any>();
  const state: any = { sessionId: 'one', token: 'owner', authSession: { principal: { mode: 'single' } }, currentSession: { id: 'one', title: 'Old name' }, sessions: [] };
  const requests: any[] = [];
  const applied: any[] = [];
  let respond: (value: any) => void = () => {};
  const context: any = { AbortController, setTimeout, clearTimeout, document: { querySelector: (id: string) => { if (!nodes.has(id)) nodes.set(id, { id }); return nodes.get(id); } } };
  vm.runInNewContext(await readFile(new URL('../public/session-rename.js', import.meta.url), 'utf8'), context);
  const api = context.CodexWebSessionRename.createController({ state, t: (value: string) => value, escapeHtml: (value: string) => value, escapeAttribute: (value: string) => value, render() {}, rememberFocus() {}, restoreFocus() {}, isShare: () => false, isReadOnly: (session: any) => session.readOnly === true || session.archived === true || session.mode === 'observer', listen: (node: any, type: string, handler: Function) => handlers.set(`${node.id}:${type}`, handler), applyName: (...args: any[]) => applied.push(args), apiFetch: (...args: any[]) => { requests.push(args); return new Promise((resolve) => { respond = resolve; }); } });
  api.bind();
  return { api, state, requests, applied, respond: (value: any) => respond(value), input: (value: string) => handlers.get('#session-name-input:input')!({ target: { value } }), save: () => handlers.get('#session-name-form:submit')!({ preventDefault() {} }) };
}

test('rename controls enforce writable capability and valid single-line UTF-16 names', async () => {
  const h = await harness();
  for (const blocked of [{ readOnly: true }, { archived: true }, { mode: 'observer' }, { canRename: false }]) {
    h.state.currentSession = { id: 'one', ...blocked };
    assert.equal(h.api.canOpen(), false);
  }
  h.state.authSession.principal.mode = 'multi';
  h.state.currentSession = { id: 'one' };
  assert.equal(h.api.canOpen(), false);
  h.state.currentSession.canRename = true;
  assert.equal(h.api.canOpen(), true);
  h.api.open();
  for (const invalid of ['', '  ', 'x'.repeat(121), '😀'.repeat(61), 'line\nbreak', '\u0000bad']) {
    h.input(invalid); await h.save();
  }
  assert.equal(h.requests.length, 0);
  h.input('😀'.repeat(60));
  const saving = h.save();
  assert.equal(h.requests[0][1].body.name.length, 120);
  h.respond({ session: { id: 'one', title: 'Valid' } }); await saving;
});

test('rename fences only older response envelopes and cannot apply across navigation or token changes', async () => {
  const h = await harness();
  const oldRequest = h.api.capture();
  h.api.open(); h.input('New name');
  const saving = h.save();
  h.api.close();
  assert.equal(h.api.isOpen(), true);
  await h.save();
  assert.equal(h.requests.length, 1);
  h.respond({ session: { id: 'one', title: 'New name' } }); await saving;
  assert.equal(h.applied.length, 1);
  const delayed = h.api.reconcile({ session: { id: 'one', title: 'Old name' }, items: [{ id: 'one', title: 'Old name' }] }, oldRequest);
  assert.equal(delayed.session.title, 'New name');
  assert.equal(delayed.items[0].title, 'New name');
  const future = h.api.reconcile({ session: { id: 'one', title: 'External later name' } }, h.api.capture());
  assert.equal(future.session.title, 'External later name');
  const array = [{ id: 'one' }];
  assert.equal(h.api.reconcile(array, oldRequest), array);
  h.api.open(); h.input('Late name');
  const late = h.save();
  h.api.invalidate(); h.state.sessionId = 'two'; h.state.token = 'new owner';
  h.respond({ session: { id: 'one', title: 'Late name' } }); await late;
  assert.equal(h.applied.length, 1);
  assert.equal(h.api.isOpen(), false);
});
