import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/ui-localization.js', import.meta.url), 'utf8');
const { createRenderer } = vm.runInNewContext(`${source}\nCodexWebLocalization;`);
const escapeHtml = (value: string) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const renderer = (language: string) => createRenderer({
  state: { language }, DEFAULT_LANGUAGE: 'en', normalizeLanguage: (value: string) => value,
  UI_TRANSLATIONS: { 'zh-CN': { Settings: '设置' } }, escapeHtml, escapeAttribute: escapeHtml,
});
const token = '__CODEX_WEB_I18N_BLOCK_0__';

for (const language of ['en', 'zh-CN']) {
  test(`${language} preserves literal placeholders without multiplying protected messages`, () => {
    // Nine blocks are enough to expose exponential restoration safely: the old
    // implementation expands 368 characters into 55,556 and creates 1,031 tags.
    const html = '<p class="message-text">ordinary</p>'.repeat(8)
      + `<p class="message-text">${token}${token}</p>`;
    const output = renderer(language).localizeUiHtml(html);
    assert.equal(output.length, html.length);
    assert.equal(output, html);
    assert.equal((output.match(/class="message-text"/gu) || []).length, 9);
  });

  test(`${language} preserves placeholders in nested protected content and textarea`, () => {
    const protectedHtml = `<div data-i18n-skip><p class="message-text">Settings ${token}</p><pre><code>${token}</code></pre></div>`
      + `<textarea placeholder="Settings">Settings &amp; ${token}</textarea>`
      + `<pre><code>Settings &lt;tag&gt; ${token}</code></pre>`
      + `<script>const example = '${token}';</script><style>/* ${token} */</style>`
      + `<iframe title="Settings">${token}</iframe>`;
    const html = `<button title="Settings">Settings</button>${protectedHtml}`;
    const expected = language === 'en' ? html
      : `<button title="设置">设置</button>${protectedHtml.replace('placeholder="Settings"', 'placeholder="设置"')}`;
    assert.equal(renderer(language).localizeUiHtml(html), expected);
  });
}

test('Chinese localization skips namespaces already present in the input', () => {
  const text = `${token} __CODEX_WEB_I18N_BLOCK__0__ __CODEX_WEB_I18N_BLOCK___0__`;
  const html = `<button>Settings</button><p class="message-text">${text}</p><code>${text}</code>`;
  assert.equal(renderer('zh-CN').localizeUiHtml(html), html.replace('>Settings<', '>设置<'));
});

test('Chinese localization restores nested protection introduced in separate passes', () => {
  const html = `<textarea placeholder="Settings"><code>Settings ${token}</code></textarea><button>Settings</button>`;
  assert.equal(renderer('zh-CN').localizeUiHtml(html),
    `<textarea placeholder="设置"><code>Settings ${token}</code></textarea><button>设置</button>`);
});

test('protecting a long transcript slices only a linear amount of text', () => {
  const sandbox = vm.createContext({});
  const ui = vm.runInContext(`${source}\nCodexWebLocalization.createRenderer({});`, sandbox);
  vm.runInContext(`
    globalThis.slicedCharacters = 0;
    const originalSlice = String.prototype.slice;
    String.prototype.slice = function (...args) {
      const value = originalSlice.apply(this, args);
      slicedCharacters += value.length;
      return value;
    };
  `, sandbox);
  const blocks = Array.from({ length: 80 }, (_, index) => (
    `<p class="message-text">${index}:${'流式输出 &lt;code&gt; '.repeat(512)}</p>`
  ));
  const html = `<section>${blocks.join('<hr>')}</section>`;
  const protectedBlocks: string[] = [];
  const protectedHtml = ui.protectUiContentBlocks(html, (block: string) => {
    protectedBlocks.push(block);
    return `[${protectedBlocks.length - 1}]`;
  });
  assert.equal(protectedHtml, `<section>${blocks.map((_, index) => `[${79 - index}]`).join('<hr>')}</section>`);
  assert.deepEqual(protectedBlocks, [...blocks].reverse(), 'preserve protection order and every original message');
  assert.ok(vm.runInContext('slicedCharacters', sandbox) <= html.length * 2,
    'protecting each message must not repeatedly slice the entire remaining transcript');
});

test('nested protected regions keep only outer ranges and preserve adjacent content', () => {
  const ui = renderer('zh-CN');
  const block = '<div data-i18n-skip><p class="message-text">Settings</p><div data-i18n-skip>Settings</div></div>';
  const html = `<button>Settings</button>${block}<span>Settings</span>${block}<button>Settings</button>`;
  assert.equal(ui.localizeUiHtml(html), html.replaceAll('>Settings</button>', '>设置</button>').replace('>Settings</span>', '>设置</span>'));
  assert.equal(ui.findProtectedUiContentRanges(html).length, 2);
});

test('long literal marker suffixes do not enlarge temporary protection tokens', () => {
  const patterns: string[] = [];
  const base = '__CODEX_WEB_I18N_BLOCK_';
  const ObservedRegExp = class extends RegExp {
    constructor(pattern: string, flags?: string) {
      super(pattern, flags);
      if (pattern.startsWith(base)) patterns.push(pattern);
    }
  };
  const { createRenderer } = vm.runInNewContext(`${source}\nCodexWebLocalization;`, { RegExp: ObservedRegExp });
  const ui = createRenderer({ state: { language: 'zh-CN' }, DEFAULT_LANGUAGE: 'en',
    normalizeLanguage: (value: string) => value, UI_TRANSLATIONS: {}, escapeHtml, escapeAttribute: escapeHtml });
  const html = '<p class="message-text">ordinary</p>'.repeat(79)
    + `<p class="message-text">${base}${'_'.repeat(4096)}</p>`;
  assert.equal(ui.localizeUiHtml(html), html);
  assert.equal(patterns.length, 1);
  assert.ok(patterns[0].length < 40, 'restoration prefix stays short even when user text contains a long suffix');

  const collisions = [0, 1, 3].map(id => `${base}${id}_0__`).join(' ');
  const nested = `<textarea><code>${collisions}</code></textarea>`;
  assert.equal(ui.localizeUiHtml(nested), nested, 'occupied numeric namespaces remain literal, including nested protection');
  assert.ok(patterns[1].startsWith(`${base}2_`), 'select the first unoccupied namespace');
  ui.localizeUiHtml('<code>fresh render</code>');
  assert.ok(patterns[2].startsWith(`${base}0_`), 'occupied namespaces do not accumulate across renders');
});

test('date labels preserve native output and reuse at most four formatters across language changes', () => {
  let constructions = 0;
  const CountingFormatter = class extends Intl.DateTimeFormat {
    constructor(...args: ConstructorParameters<typeof Intl.DateTimeFormat>) { super(...args); constructions++; }
  };
  const { createRenderer } = vm.runInNewContext(`${source}\nCodexWebLocalization;`, { Intl: { DateTimeFormat: CountingFormatter } });
  const state = { language: 'en' };
  const ui = createRenderer({ state, normalizeLanguage: (value: string) => value });
  for (const value of [undefined, NaN, Infinity, 'not a date', 1e100]) {
    assert.equal(ui.formatShortDate(value), '');
    assert.equal(ui.formatShortDateTime(value), '');
  }
  assert.equal(constructions, 0, 'invalid dates do not allocate a formatter');
  const values = [0, null, '2026-10-13T00:01:00Z', '2026-10-13T15:59:00Z'];
  for (const language of ['en', 'zh-CN', 'en', 'zh-CN']) {
    state.language = language;
    for (const value of values) {
      const date = new Date(value);
      assert.equal(ui.formatShortDate(value), date.toLocaleDateString(language, { month: 'short', day: 'numeric' }));
      assert.equal(ui.formatShortDateTime(value), date.toLocaleString(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    }
  }
  for (let index = 0; index < 240; index++) ui.formatShortDateTime(1700000000000 + index);
  assert.equal(constructions, 4, 'distinct timestamps and locale switches reuse fixed style instances');
});
