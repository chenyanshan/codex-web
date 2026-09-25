import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(await readFile(new URL('../public/approval-ui.js', import.meta.url), 'utf8'), context);
const ui = context.CodexWebApprovalUi;
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const helpers = { t: (value: string) => value, escapeHtml: escape, escapeAttribute: escape };
const item = (keys: string[], extra = {}) => ({ approvalId: 'id', approvalKind: 'command', summary: { command: 'npm test', availableDecisionKeys: keys, ...extra } });

test('command rule action follows amendment-first transport semantics and does not claim a lifetime', () => {
  const approval = item(['accept', 'acceptForSession', 'acceptWithExecpolicyAmendment', 'cancel'], { execPolicyAmendment: ['npm', 'test'] });
  const actions = ui.actionsFor(approval);
  assert.equal(actions[1].label, 'Cancel turn');
  assert.equal(actions[2].action, 'accept-for-session');
  assert.equal(actions[2].label, 'Allow with command rule');
  const html = ui.render(approval, helpers);
  assert.doesNotMatch(html, /Allow for this session|persist|permanent/);
  assert.match(html, /Command rule/);
});

test('missing and unavailable decisions never fabricate session approval or denial', () => {
  assert.deepEqual(Array.from(ui.actionsFor(item([])), (action: any) => action.action), ['accept']);
  assert.deepEqual(Array.from(ui.actionsFor(item(['cancel'])), (action: any) => action.action), ['deny']);
  assert.equal(ui.actionsFor(item(['acceptWithExecpolicyAmendment'])).length, 0);
  assert.equal(ui.actionsFor(item(['acceptForSession']))[0].label, 'Allow for this session');
});

test('unconfirmed and sending decisions remain disabled; resolved and expired requests have no actions', () => {
  const approval = item(['accept', 'decline', 'acceptForSession']);
  for (const options of [{ sending: true }, { decisionUncertain: true }]) {
    const html = ui.render({ ...approval, ...options }, { ...helpers, ...options });
    assert.equal((html.match(/ disabled/g) || []).length, 3);
  }
  for (const options of [{ resolved: true }, { expired: true, resolved: true }]) {
    const html = ui.render({ ...approval, ...options }, helpers);
    assert.doesNotMatch(html, /data-approval-action/);
    assert.match(html, /Review request/);
  }
});

test('command, paths and permission scope stay complete and HTML escaped', () => {
  const command = '<script>alert("command")</script>' + 'x'.repeat(5000);
  const html = ui.render(item(['accept'], { command, cwd: '/a/<b>', fileReadPermissions: ['/a'], fileWritePermissions: ['/b'], networkPermission: true }), helpers);
  assert.ok(html.includes(escape(command)));
  assert.match(html, /Read access/);
  assert.match(html, /Write access/);
  assert.match(html, /Network access/);
  assert.doesNotMatch(html, /<script>/);
});

test('explicitly truncated details retain bounds and suppress approval without suggesting a refresh will fix them', () => {
  const source = item(['accept', 'decline', 'acceptForSession'], { command: 'x'.repeat(4001) });
  const summary = ui.sanitizeSummary(source.summary, (value: any) => ({ ...value, command: value.command.slice(0, 4000) }));
  assert.equal(summary.command.length, 4000);
  assert.equal(summary.detailsIncomplete, true);
  const approval = { ...source, summary };
  assert.deepEqual(Array.from(ui.actionsFor(approval), (action: any) => action.action), ['deny']);
  assert.match(ui.render(approval, helpers), /exceed the display limit/);
  assert.doesNotMatch(ui.render(approval, helpers), /Refresh/);
  assert.equal(ui.sanitizeSummary(item(['accept']).summary, (value: any) => ({ ...value })).detailsIncomplete, undefined);
  assert.equal(ui.sanitizeSummary({ ...summary, command: 'short' }, (value: any) => ({ ...value })).detailsIncomplete, true);
});
