import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const evidence = 'docs/audits/2026-09-19-markdown-preview-evidence';
const phase = process.env.CODEX_WEB_CAPTURE_PHASE || 'after';
const sample = `# 会话与管理控制台整改记录

这份记录说明会话阅读、消息同步和管理控制台的改动。**普通会话进入时显示最新消息**，管理台只读查看从会话开头开始。

## 阅读与刷新

### 验收步骤

1. 打开普通会话，确认最新回答与输入框可见。
2. 向上阅读历史，再调整窗口大小。
   - 保持当前消息的位置。
   - 返回后确认未发送的草稿仍在。
3. 打开管理控制台，以只读方式查看完整对话。

> 网络暂时中断时，保留已经显示的消息；连接恢复后继续同步。

## 改动对照

| 检查项目 | 修复后的行为 | 验证方式 |
| --- | --- | --- |
| 普通会话进入 | 每次进入都定位到最新回答，不恢复旧的阅读位置 | 桌面与手机重新进入、刷新 |
| 管理台只读查看 | 从第一条消息开始，列表保持固定宽度 | 120 条消息、三种桌面宽度 |
| 消息与附件 | 相同提交只显示一次，旧图片不会出现在最新位置 | 弱网、迟到回执与完整历史核对 |

## 运行检查

\`\`\`bash
npm run typecheck
node scripts/check-session-layout.mjs --viewport=1440x900 --session=long-running-conversation --keep-draft --verify-reading-position
\`\`\`

#### 补充说明

可以下载原文件保留这份记录。长路径也应该能正常阅读：/Users/test/Documents/workspaces/codex-mobile-web-app/docs/audits/2026-09-19-second-remediation-progress.md。
`;

test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait', 'mobile-compact'].includes(info.project.name));
  await fs.mkdir(evidence, { recursive: true });
  await page.addInitScript(() => { localStorage.setItem('codexWebToken', 'markdown-preview-token'); localStorage.setItem('codexWebLanguage', 'zh-CN'); });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__markdownPreview = { applyTheme, render };` });
  });
});

async function openFile(page, content) {
  await page.route('**/api/sessions/session_browser_files/files/sf_browser_markdown/content?*', route => route.fulfill({ contentType: 'text/markdown; charset=utf-8', body: content }));
  await page.goto('/');
  await page.locator('[data-session-id="session_browser_files"]').click();
  await page.locator('#prompt-input').fill('预览文档时保留草稿');
  await page.getByRole('link', { name: 'Browser session guide' }).click();
  await expect(page.locator('.session-file-document')).toBeVisible();
}

test('Markdown preview separates heading levels and preserves lists, tables, code and the conversation', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openFile(page, sample);
  const doc = page.locator('.session-file-document');
  await page.screenshot({ path: `${evidence}/${phase}-${info.project.name}.png` });
  const typography = await doc.evaluate(el => {
    const px = selector => parseFloat(getComputedStyle(el.querySelector(selector)).fontSize);
    return { h1: px('h1'), h2: px('h2'), h3: px('h3'), body: px('p'), lineHeight: parseFloat(getComputedStyle(el.querySelector('p')).lineHeight) };
  });
  expect(typography.h1).toBeGreaterThan(typography.h2);
  expect(typography.h2).toBeGreaterThan(typography.h3);
  expect(typography.body).toBeGreaterThanOrEqual(16);
  expect(typography.lineHeight).toBeGreaterThanOrEqual(26);
  await expect(doc.locator('ol > li')).toHaveCount(3);
  await expect(doc.locator('ol > li > ul > li')).toHaveCount(2);
  await expect(doc.locator('h4')).toHaveText('补充说明');
  await doc.locator('pre').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/${phase}-code-${info.project.name}.png` });
  for (const region of [doc.locator('.markdown-table'), doc.locator('pre')]) {
    await region.scrollIntoViewIfNeeded();
    await expect(region).toHaveAttribute('tabindex', '0');
    await region.focus();
    const hasOverflow = await region.evaluate(el => el.scrollWidth > el.clientWidth);
    if (hasOverflow) { await page.keyboard.press('ArrowRight'); await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); }
    await region.evaluate(el => { el.scrollLeft = 0; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(info.project.use.viewport.width);
  }
  await expect(doc.locator('pre code')).toContainText('--session=long-running-conversation --keep-draft');
  await expect(doc.locator('pre code')).toHaveCSS('white-space', 'pre');
  const viewer = page.locator('.session-file-viewer');
  const scrollTop = await viewer.evaluate(el => el.scrollTop);
  await page.setViewportSize({ width: info.project.use.viewport.width, height: info.project.use.viewport.height - 48 });
  await expect(doc).toBeVisible();
  await expect.poll(async () => Math.abs(await viewer.evaluate(el => el.scrollTop) - scrollTop)).toBeLessThanOrEqual(2);
  const download = page.waitForEvent('download'); await page.locator('#session-file-download').click();
  expect((await download).suggestedFilename()).toBe('browser-session-guide.md');
  await page.locator('#close-session-file-button').click();
  await expect(page.locator('#timeline')).toContainText('Generated');
  await expect(page.locator('#prompt-input')).toHaveValue('预览文档时保留草稿');
  expect(errors).toEqual([]);
});

test('the real remediation report stays readable at narrow preview widths and in dark themes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const report = await fs.readFile('docs/audits/2026-09-19-second-remediation-progress.md', 'utf8');
  await openFile(page, report);
  const checks = [];
  for (const width of [1440, 980, 979, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(width >= 980 ? '.desktop-session-file-overlay' : '.session-file-screen')).toBeVisible();
    const table = page.locator('.session-file-document .markdown-table').first();
    await expect(async () => {
      await table.scrollIntoViewIfNeeded();
      await expect(table).toBeInViewport();
    }).toPass();
    const bounds = await table.evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: innerWidth, pageWidth: document.documentElement.scrollWidth, columnWidth: el.querySelector('td').getBoundingClientRect().width }));
    expect(bounds.right).toBeLessThanOrEqual(width); expect(bounds.pageWidth).toBeLessThanOrEqual(width);
    expect(bounds.columnWidth).toBeGreaterThanOrEqual(130); checks.push(bounds);
    await page.screenshot({ path: `${evidence}/${phase}-report-${width}.png` });
  }
  for (const theme of ['fresh-light', 'retro', 'terminal', 'dark-gold', 'oled-black']) {
    await page.evaluate(theme => { globalThis.__markdownPreview.applyTheme(theme); globalThis.__markdownPreview.render(); }, theme);
    await page.locator('.session-file-document h1').scrollIntoViewIfNeeded();
    const contrast = await page.locator('.session-file-document').evaluate(doc => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      const color = css => { context.clearRect(0, 0, 1, 1); context.fillStyle = css; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
      const luminance = rgba => rgba.slice(0, 3).map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      return ['p', 'a', 'code', 'code a', 'th', 'td'].map(selector => {
        const element = doc.querySelector(selector);
        const fg = luminance(color(getComputedStyle(element).color));
        let ancestor = element;
        while (ancestor.parentElement && !color(getComputedStyle(ancestor).backgroundColor)[3]) ancestor = ancestor.parentElement;
        const bg = luminance(color(getComputedStyle(ancestor).backgroundColor));
        return { selector, ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
      });
    });
    for (const pair of contrast) expect(pair.ratio, `${theme} ${pair.selector}`).toBeGreaterThanOrEqual(4.5);
    checks.push({ theme, contrast });
    await page.screenshot({ path: `${evidence}/${phase}-theme-${theme}.png` });
  }
  await page.locator('#close-session-file-button').click();
  await expect(page.locator('#prompt-input')).toHaveValue('预览文档时保留草稿');
  expect(errors).toEqual([]);
  await fs.writeFile(`${evidence}/bounds.json`, JSON.stringify(checks, null, 2));
});
