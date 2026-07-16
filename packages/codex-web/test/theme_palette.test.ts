import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const stylesUrl = new URL('../public/styles.css', import.meta.url);
const themeInitUrl = new URL('../public/theme-init.js', import.meta.url);

const paletteSelectors = new Map([
  ['sunny', ':root'],
  ['light', ':root[data-theme="light"]'],
  ['dark', ':root[data-theme="dark"]'],
  ['nord', ':root[data-theme="nord"]'],
  ['forest', ':root[data-theme="forest"]'],
  ['rose', ':root[data-theme="rose"]'],
]);

test('every theme meets contrast targets for text, actions, states, and controls', async () => {
  const css = await readFile(stylesUrl, 'utf8');

  for (const [theme, selector] of paletteSelectors) {
    const tokens = parseThemeTokens(css, selector);
    for (const token of [
      'bg',
      'panel',
      'border',
      'border-strong',
      'control-border',
      'text',
      'muted',
      'accent',
      'accent-2',
      'on-accent',
      'info',
      'success',
      'warn',
      'danger',
      'code-bg',
      'code-text',
    ]) {
      assert.ok(tokens[token], `${theme} is missing --${token}`);
    }

    assertContrast(theme, 'text/background', tokens.text, tokens.bg, 7);
    assertContrast(theme, 'muted/panel', tokens.muted, tokens.panel, 4.5);
    assertContrast(theme, 'accent/panel', tokens.accent, tokens.panel, 4.5);
    assertContrast(theme, 'primary action', tokens['on-accent'], tokens['accent-2'], 4.5);
    assertContrast(theme, 'control boundary', resolveThemeToken(tokens, 'control-border'), tokens.panel, 3);
    assertContrast(theme, 'info/panel', tokens.info, tokens.panel, 4.5);
    assertContrast(theme, 'success/panel', tokens.success, tokens.panel, 4.5);
    assertContrast(theme, 'warning/panel', tokens.warn, tokens.panel, 4.5);
    assertContrast(theme, 'danger/panel', tokens.danger, tokens.panel, 4.5);
    assertContrast(theme, 'code text/background', tokens['code-text'], tokens['code-bg'], 7);
  }
});

test('sunny keeps dividers quiet while controls retain a visible boundary', async () => {
  const css = await readFile(stylesUrl, 'utf8');
  const sunny = parseThemeTokens(css, ':root');

  assert.equal(sunny.border, '#dfcfac');
  assert.equal(sunny['control-border'], 'var(--border-strong)');
  assert.ok(contrastRatio(sunny.border, sunny.panel) < 2);
  assert.ok(contrastRatio(resolveThemeToken(sunny, 'control-border'), sunny.panel) >= 3);
  assert.match(css, /button,\s*select,\s*input,\s*textarea\s*\{[^}]*border:\s*1px solid var\(--control-border\);/su);
  assert.match(css, /\.theme-option\s*\{[^}]*border:\s*1px solid var\(--control-border\);/su);
  assert.match(css, /\.theme-option\[data-app-theme="sunny"\]\s*\{[^}]*--preview-border:\s*#dfcfac;/su);
});

test('pre-style theme initialization restores saved themes and defaults to sunny', async () => {
  const source = await readFile(themeInitUrl, 'utf8');

  assert.deepEqual(runThemeInit(source, null), {
    theme: 'sunny',
    chromeColor: '#f8f3e3',
  });
  assert.deepEqual(runThemeInit(source, 'nord'), {
    theme: 'nord',
    chromeColor: '#252a35',
  });
  assert.deepEqual(runThemeInit(source, 'unsupported'), {
    theme: 'sunny',
    chromeColor: '#f8f3e3',
  });
});

test('theme picker and thread settings use stable responsive grids', async () => {
  const css = await readFile(stylesUrl, 'utf8');

  assert.match(css, /\.theme-picker\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/su);
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

function runThemeInit(source: string, savedTheme: string | null): { theme: string; chromeColor: string } {
  const dataset: Record<string, string> = {};
  let chromeColor = '';
  vm.runInNewContext(source, {
    localStorage: {
      getItem: () => savedTheme,
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
  return { theme: dataset.theme, chromeColor };
}
