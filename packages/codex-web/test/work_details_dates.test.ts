import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('activity dates preserve default locale formatting with one reusable formatter', async () => {
  const source = await readFile(new URL('../public/work-details-view.js', import.meta.url), 'utf8');
  let constructions = 0;
  const CountingFormatter = class extends Intl.DateTimeFormat {
    constructor(...args: ConstructorParameters<typeof Intl.DateTimeFormat>) { super(...args); constructions++; }
  };
  const { createRenderer } = vm.runInNewContext(`${source}\nCodexWebWorkView;`, { Intl: { DateTimeFormat: CountingFormatter } });
  const view = createRenderer({
    t: (key: string, params: Record<string, unknown> = {}) => key.replace(/\{([^}]+)\}/gu, (_, name) => String(params[name] ?? `{${name}}`)),
    escapeHtml: String, escapeAttribute: String,
    workDetailsForItem: () => [], workTurnStatus: () => '',
  });
  const renderAt = (value: unknown) => view.renderWorkItem({ turnId: 'turn' }, {
    activityState: { agents: [{ threadId: 'agent', status: 'completed', observedAt: value }] },
  });
  for (const value of [undefined, null, NaN, Infinity, '1700000000000']) {
    assert.match(renderAt(value), /Last observed: <\/small>/u);
  }
  assert.equal(constructions, 0);
  assert.match(renderAt(1e100), /Last observed: Invalid Date<\/small>/u);
  for (const timestamp of [0, 1700000000000, 1700040000000]) {
    const expected = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    assert.ok(renderAt(timestamp).includes(`Last observed: ${expected}</small>`));
  }
  for (let index = 0; index < 240; index++) renderAt(1700000000000 + index);
  assert.equal(constructions, 1, 'repeated activity renders reuse the default locale formatter');
});
