import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installAdminFixture, openAdminConsole, returnToAdminList, navigateAdmin } from './helpers/admin-fixture.js';

test('admin panels remain in bounds at breakpoints and metadata meets contrast across five themes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const output = path.resolve('docs/audits/2026-09-19-second-remediation-evidence');
  await fs.mkdir(output, { recursive: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await installAdminFixture(page); await openAdminConsole(page, info.project.name);
  await page.addStyleTag({ content: '* { transition: none !important; }' });
  const bounds = [];
  for (const width of [1440, 1200, 980, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-admin-session-id="session_admin_fixture_1"]').click();
    await expect(page.locator('#timeline')).toContainText('deployment checks passed');
    const measured = await page.locator(width >= 980 ? '.admin-observed-panel' : '#timeline').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth };
    });
    expect(measured.left).toBeGreaterThanOrEqual(0); expect(measured.right).toBeLessThanOrEqual(width);
    expect(measured.scrollWidth).toBeLessThanOrEqual(width); bounds.push(measured);
    await page.screenshot({ path: path.join(output, `admin-observer-${width}.png`) });
    await returnToAdminList(page);
  }
  await navigateAdmin(page, 'users');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width < 400 ? 844 : 900 });
    await expect(page.locator('.admin-user-row').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: path.join(output, `admin-users-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const themes = [];
  for (const theme of ['fresh-light', 'retro', 'terminal', 'dark-gold', 'oled-black']) {
    const result = await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].map((value, index) => index === 3 ? value / 255 : value); };
      const composite = (front, back) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
      const luminance = color => color.map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      return { theme, samples: ['.admin-page-count', '.admin-nav-count', '.admin-row-meta', '.admin-status-badge'].map(selector => {
        const element = document.querySelector(selector), style = getComputedStyle(element), chain = [];
        for (let node = element; node; node = node.parentElement) chain.unshift(node);
        const background = chain.reduce((color, node) => composite(rgba(getComputedStyle(node).backgroundColor), color), [255, 255, 255]);
        const a = luminance(composite(rgba(style.color), background)), b = luminance(background);
        return { selector, fontSize: parseFloat(style.fontSize), contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      }) };
    }, theme);
    themes.push(result);
    for (const sample of result.samples) { expect(sample.contrast, `${theme} ${sample.selector}`).toBeGreaterThanOrEqual(4.5); expect(sample.fontSize).toBeGreaterThanOrEqual(12); }
  }
  await fs.writeFile(path.join(output, 'visual-checks.json'), JSON.stringify({ bounds, themes, errors }, null, 2));
  expect(errors).toEqual([]);
});
