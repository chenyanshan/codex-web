import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const stylesUrl = new URL('../public/styles.css', import.meta.url);
const appUrl = new URL('../public/app.js', import.meta.url);
const themeInitUrl = new URL('../public/theme-init.js', import.meta.url);

const paletteSelectors = new Map([
  ['retro', ':root'],
  ['dark-gold', ':root[data-theme="dark-gold"]'],
  ['oled-black', ':root[data-theme="oled-black"]'],
  ['fresh-light', ':root[data-theme="fresh-light"]'],
  ['terminal', ':root[data-theme="terminal"]'],
]);

test('every theme meets contrast targets for text, actions, states, and controls', async () => {
  const css = await readFile(stylesUrl, 'utf8');

  for (const [theme, selector] of paletteSelectors) {
    const tokens = parseThemeTokens(css, selector);
    for (const token of [
      'bg',
      'bg-base',
      'bg-panel',
      'bg-card',
      'bg-user-shared',
      'text-user',
      'msg-sys-bg',
      'panel',
      'panel-2',
      'border',
      'border-strong',
      'control-border',
      'text',
      'text-main',
      'muted',
      'text-muted',
      'accent',
      'brand-color',
      'accent-2',
      'on-accent',
      'info',
      'success',
      'warn',
      'danger',
      'code-bg',
      'code-text',
      'code-border',
      'code-inline-bg',
      'code-inline-text',
      'overlay',
      'shadow',
    ]) {
      assert.ok(tokens[token], `${theme} is missing --${token}`);
    }

    assertContrast(theme, 'text/background', tokens.text, tokens.bg, 7);
    assertContrast(theme, 'user text/shared surface', tokens['text-user'], tokens['bg-user-shared'], 7);
    assertContrast(theme, 'muted/panel', tokens.muted, tokens.panel, 3);
    assertContrast(theme, 'accent/panel', tokens.accent, tokens.panel, 2.3);
    assertContrast(theme, 'primary action', tokens['on-accent'], tokens['accent-2'], 4.5);
    assertContrast(theme, 'control boundary', resolveThemeToken(tokens, 'control-border'), tokens.panel, 3);
    assertContrast(theme, 'info/panel', tokens.info, tokens.panel, 4.5);
    assertContrast(theme, 'success/panel', tokens.success, tokens.panel, 4.5);
    assertContrast(theme, 'warning/panel', tokens.warn, tokens.panel, 4.5);
    assertContrast(theme, 'danger/panel', tokens.danger, tokens.panel, 4.5);
    assertContrast(theme, 'code text/background', tokens['code-text'], tokens['code-bg'], 7);
    assertContrast(theme, 'inline code text/background', tokens['code-inline-text'], tokens['code-inline-bg'], 7);
    assert.equal(tokens.bg, tokens['bg-base']);
    assert.equal(tokens.text, tokens['text-main']);
    assert.equal(tokens.muted, tokens['text-muted']);
    assert.equal(tokens.accent, tokens['brand-color']);
  }
});

test('the five product themes keep the specified surface palette', async () => {
  const css = await readFile(stylesUrl, 'utf8');
  const expected = {
    retro: ['#fcf9f2', '#f5efe3', '#ffffff', '#dfd6c8', '#2d2d2d', '#ffffff', '#4a4a4a', '#8a8a8a', '#e8decc', '#d97757'],
    'dark-gold': ['#18181a', '#121212', '#202022', '#42424a', '#f4f4f5', '#27272a', '#e4e4e7', '#a1a1aa', '#3f3f46', '#eab308'],
    'oled-black': ['#000000', '#000000', '#151515', '#38383f', '#ffffff', '#121212', '#f4f4f5', '#a1a1aa', '#27272a', '#ffffff'],
    'fresh-light': ['#f4f5f7', '#eaecef', '#ffffff', '#cfd4dc', '#111827', '#ffffff', '#1f2937', '#6b7280', '#e5e7eb', '#10b981'],
    terminal: ['#11151a', '#171b20', '#171b20', '#30353b', '#f0f1f2', '#171b20', '#d8dadd', '#91979f', '#343a42', '#20c5c9'],
  };
  const keys = [
    'bg-base',
    'bg-panel',
    'bg-card',
    'bg-user-shared',
    'text-user',
    'msg-sys-bg',
    'text-main',
    'text-muted',
    'border-color',
    'brand-color',
  ];

  for (const [theme, values] of Object.entries(expected)) {
    const selector = paletteSelectors.get(theme);
    assert.ok(selector);
    const tokens = parseThemeTokens(css, selector);
    assert.deepEqual(keys.map((key) => tokens[key]), values);
  }
});

test('theme registries, browser chrome colors, and picker previews stay in sync', async () => {
  const [css, app, themeInit] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(themeInitUrl, 'utf8'),
  ]);
  const expectedIds = [...paletteSelectors.keys()];
  const appThemes = [...app.matchAll(
    /\{ id: '([^']+)', label: '[^']+', chromeColor: '(#[0-9a-f]{6})' \},/gu,
  )].map((match) => ({ id: match[1], chromeColor: match[2] }));
  const themeColorsBlock = themeInit.match(/const themeColors = \{([\s\S]*?)\n  \};/u)?.[1] ?? '';
  const initializedThemes = [...themeColorsBlock.matchAll(
    /^\s*(?:'([^']+)'|([a-z][a-z-]*)): '(#[0-9a-f]{6})',$/gmu,
  )].map((match) => ({ id: match[1] || match[2], chromeColor: match[3] }));

  assert.deepEqual(appThemes.map((theme) => theme.id), expectedIds);
  assert.deepEqual(initializedThemes, appThemes);
  for (const theme of appThemes) {
    const selector = paletteSelectors.get(theme.id);
    assert.ok(selector);
    assert.equal(parseThemeTokens(css, selector).bg, theme.chromeColor);
    assert.ok(
      css.includes(`.theme-option[data-app-theme="${theme.id}"] {`),
      `${theme.id} is missing its picker preview`,
    );
  }
});

test('retro keeps dividers quiet while controls retain a visible boundary', async () => {
  const css = await readFile(stylesUrl, 'utf8');
  const retro = parseThemeTokens(css, ':root');

  assert.equal(retro.border, '#e8decc');
  assert.equal(retro['control-border'], 'var(--border-strong)');
  assert.ok(contrastRatio(retro.border, retro.panel) < 2);
  assert.ok(contrastRatio(resolveThemeToken(retro, 'control-border'), retro.panel) >= 3);
  assert.match(css, /button,\s*select,\s*input,\s*textarea\s*\{[^}]*border:\s*1px solid var\(--control-border\);/su);
  assert.match(css, /\.theme-option\s*\{[^}]*border:\s*1px solid var\(--control-border\);/su);
  assert.match(css, /\.theme-option\[data-app-theme="retro"\]\s*\{[^}]*--preview-border:\s*#e8decc;/su);
});

test('specialized focus styling follows each theme accent', async () => {
  const css = await readFile(stylesUrl, 'utf8');
  const sunny = parseThemeTokens(css, ':root');

  assert.equal(sunny.focus, 'var(--accent)');
  assert.match(css, /\.submission-retry-button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\);/su);
});

test('pre-style theme initialization restores saved themes and defaults to fresh light', async () => {
  const source = await readFile(themeInitUrl, 'utf8');

  assert.deepEqual(runThemeInit(source, null), {
    theme: 'fresh-light',
    chromeColor: '#f4f5f7',
    sessionLayout: 'current',
  });
  assert.deepEqual(runThemeInit(source, 'dark-gold'), {
    theme: 'dark-gold',
    chromeColor: '#18181a',
    sessionLayout: 'current',
  });
  assert.deepEqual(runThemeInit(source, 'oled-black'), {
    theme: 'oled-black',
    chromeColor: '#000000',
    sessionLayout: 'current',
  });
  assert.deepEqual(runThemeInit(source, 'terminal'), {
    theme: 'terminal',
    chromeColor: '#11151a',
    sessionLayout: 'current',
  });
  assert.deepEqual(runThemeInit(source, 'unsupported'), {
    theme: 'fresh-light',
    chromeColor: '#f4f5f7',
    sessionLayout: 'current',
  });
  assert.deepEqual(runThemeInit(source, 'fresh-light', 'console'), {
    theme: 'fresh-light',
    chromeColor: '#f4f5f7',
    sessionLayout: 'console',
  });
  assert.deepEqual(runThemeInit(source, 'fresh-light', 'unsupported'), {
    theme: 'fresh-light',
    chromeColor: '#f4f5f7',
    sessionLayout: 'current',
  });
});

test('theme picker and thread settings use stable responsive grids', async () => {
  const css = await readFile(stylesUrl, 'utf8');

  assert.match(css, /\.theme-picker\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/su);
  assert.match(css, /@media \(max-width:\s*420px\)\s*\{[\s\S]*?\.theme-picker\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/su);
  assert.match(css, /\.thread-settings-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/su);
  assert.match(css, /@media \(max-width:\s*420px\)\s*\{[\s\S]*?\.thread-settings-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/su);
});

function parseThemeTokens(css: string, selector: string): Record<string, string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const block = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'u'))?.[1];
  assert.ok(block, `missing CSS block for ${selector}`);
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/giu)]
      .map((match) => [match[1], match[2].trim()]),
  );
}

function assertContrast(theme: string, pair: string, foreground: string, background: string, minimum: number): void {
  const ratio = contrastRatio(foreground, background);
  assert.ok(ratio >= minimum, `${theme} ${pair} contrast ${ratio.toFixed(2)} is below ${minimum}:1`);
}

function resolveThemeToken(tokens: Record<string, string>, token: string): string {
  const value = tokens[token];
  const reference = value?.match(/^var\(--([a-z0-9-]+)\)$/iu)?.[1];
  return reference ? resolveThemeToken(tokens, reference) : value;
}

function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05);
}

function relativeLuminance(color: string): number {
  assert.match(color, /^#[0-9a-f]{6}$/iu);
  const channels = color.slice(1).match(/../gu)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function runThemeInit(
  source: string,
  savedTheme: string | null,
  savedSessionLayout: string | null = null,
): { theme: string; chromeColor: string; sessionLayout: string } {
  const dataset: Record<string, string> = {};
  let chromeColor = '';
  vm.runInNewContext(source, {
    localStorage: {
      getItem: (key: string) => key === 'codexWebSessionLayout' ? savedSessionLayout : savedTheme,
    },
    document: {
      documentElement: { dataset },
      querySelector: () => ({
        setAttribute: (_name: string, value: string) => {
          chromeColor = value;
        },
      }),
    },
  });
  return { theme: dataset.theme, chromeColor, sessionLayout: dataset.sessionLayout };
}
