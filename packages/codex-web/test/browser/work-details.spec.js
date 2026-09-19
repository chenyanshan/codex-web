import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const evidence = 'docs/audits/2026-09-19-connection-work-evidence';
test.use({ serviceWorkers: 'block' });
const diff = ['diff --git a/public/app.js b/public/app.js', '--- a/public/app.js', '+++ b/public/app.js', '@@ -12,2 +12,3 @@', '-  showStatus("Ready");', '+  showStatus(connection.label());', '+  keepDraft("<script>alert(1)</script>");', '   render();', '\\ No newline at end of file'].join('\n');

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name === 'desktop-portrait');
  await fs.mkdir(evidence, { recursive: true });
  await page.addInitScript(token => {
    localStorage.setItem('codexWebToken', token);
    localStorage.setItem('codexWebLanguage', 'zh-CN');
  }, `work-view-${info.project.name}-${info.workerIndex}`);
});

async function emit(page, event) {
  const delivered = await page.evaluate(async event => {
    const response = await fetch('/__test/turn-event', {
      method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('codexWebToken')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId: 'turn_browser_active', ...event }),
    });
    return (await response.json()).delivered;
  }, event);
  expect(delivered).toBe(1);
}

async function openSession(page) {
  await page.goto('/');
  await page.locator('button[data-session-id="session_browser_fixture"]').click();
  await expect(page.locator('.composer-status')).toContainText('等待审批');
}

test('work details show actual progress, readable output and numbered diffs without disrupting reading', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openSession(page);
  await emit(page, { type: 'approval.resolved', approvalId: 'approval_browser_fixture', decision: 'accept' });
  await emit(page, { type: 'batch.updated', batchId: 'batch_browser_command', summary: {
    command: JSON.stringify({ cmd: 'npm run typecheck\nnpm test' }),
    output: JSON.stringify({ content: [{ type: 'text', text: '\u001b[32m类型检查通过\u001b[0m\n58 项测试通过\n<script>alert(1)</script>' }] }),
    cwd: '/Users/test/Documents/codex-mobile-web-app', durationMs: 1240,
    transport: { requestId: 'synthetic-only', attempts: 1 },
  } });
  await emit(page, { type: 'batch.updated', batchId: 'batch_browser_edit', summary: {
    fileChanges: { 'public/app.js': { action: 'updated', additions: 2, deletions: 1, diff }, 'public/styles.css': { action: 'updated' } },
  } });
  await page.locator('#open-work-details-button').click();
  const dialog = page.locator('.work-details-dialog');
  await expect(dialog.locator('.work-progress-current')).toHaveText('public/app.js +1');
  await expect(dialog.locator('.work-progress-count')).toHaveText('已完成 2 / 3 项活动');
  await expect(dialog.locator('.work-progress-title')).toContainText('当前正在进行');
  const command = dialog.locator('[data-work-event-id="batch_browser_command"]');
  const edit = dialog.locator('[data-work-event-id="batch_browser_edit"]');
  await command.locator(':scope > summary').click();
  await expect(command.locator('.work-output').first()).toHaveText('npm run typecheck\nnpm test');
  await expect(command.locator('.work-output').last()).toContainText('类型检查通过\n58 项测试通过\n<script>alert(1)</script>');
  await expect(command).not.toContainText('input_text');
  await expect(command.locator('.work-raw')).not.toHaveAttribute('open');
  await command.locator(':scope > summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/work-output-${info.project.name}.png` });
  await command.locator(':scope > summary').click();
  await edit.locator(':scope > summary').click();
  await expect(edit.locator('.work-diff-line[data-change="added"]')).toHaveCount(2);
  await expect(edit.locator('.work-diff-line[data-change="removed"]')).toHaveCount(1);
  await expect(edit.locator('.work-diff-line[data-change="added"]').first().locator('.work-line-number').nth(1)).toHaveText('12');
  await expect(edit.locator('script')).toHaveCount(0);
  await edit.locator(':scope > summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/work-diff-${info.project.name}.png` });
  const region = edit.locator('.work-diff');
  await region.focus();
  if (await region.evaluate(el => el.scrollWidth > el.clientWidth)) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  }
  // Read a chosen horizontal position while the event stream updates.
  await region.evaluate(el => { el.scrollLeft = 24; });
  const horizontal = await region.evaluate(el => el.scrollLeft);
  await emit(page, { type: 'batch.completed', batchId: 'batch_browser_edit', status: 'completed' });
  await expect(dialog.locator('.work-progress-count')).toHaveText('已完成 3 / 3 项活动');
  await expect(region).toBeFocused();
  await expect(edit).toHaveAttribute('open', '');
  await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBe(horizontal);
  await emit(page, { type: 'batch.started', batchId: 'read_results', kind: 'command', title: 'git diff --check' });
  await expect(dialog.locator('.work-progress-current')).toHaveText('git diff --check');
  await expect(dialog.locator('.work-events')).not.toContainText('git diff --check');
  await expect(dialog.locator('[data-work-show-latest]')).toBeVisible();
  await expect(region).toBeFocused();
  const boxes = await dialog.evaluate(el => {
    const progress = el.querySelector('.work-turn-header').getBoundingClientRect();
    const button = el.querySelector('[data-work-show-latest]').getBoundingClientRect();
    return { progress: { top: progress.top, bottom: progress.bottom, right: progress.right }, button: { top: button.top, bottom: button.bottom, right: button.right }, pageWidth: document.documentElement.scrollWidth };
  });
  expect(boxes.button.top).toBeGreaterThanOrEqual(boxes.progress.top);
  expect(boxes.button.bottom).toBeLessThanOrEqual(boxes.progress.bottom);
  expect(boxes.button.right).toBeLessThanOrEqual(boxes.progress.right);
  expect(boxes.pageWidth).toBeLessThanOrEqual(info.project.use.viewport.width);
  await page.screenshot({ path: `${evidence}/work-live-${info.project.name}.png` });
  await dialog.locator('[data-work-show-latest]').click();
  await expect(dialog.locator('.work-events')).toContainText('git diff --check');
  await command.locator(':scope > summary').click();
  await command.locator('.work-raw > summary').click();
  await emit(page, { type: 'batch.completed', batchId: 'read_results', status: 'failed', summary: { exitCode: 1 } });
  await expect(dialog.locator('.work-progress-failed')).toHaveText('1 项失败');
  await expect(command.locator('.work-raw')).toHaveAttribute('open', '');
  await expect(command.locator('.work-raw > summary')).toBeFocused();

  if (info.project.name === 'desktop') {
    for (const width of [901, 900, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(dialog).toBeVisible();
      await expect(command.locator('.work-raw')).toHaveAttribute('open', '');
      await expect(command).toHaveAttribute('open', '');
      await expect(edit).toHaveAttribute('open', '');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await dialog.locator('.work-details-list').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: `${evidence}/work-width-${width}.png` });
    }
  }
  await page.locator('#close-work-details-button').click();
  await expect(page.locator('#open-work-details-button')).toBeFocused();
  expect(errors).toEqual([]);
});

test('a slow work module cannot reopen a closed dialog or leak into another session', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/work-details-view.js*', async route => { await held; await route.continue(); });
  await openSession(page);
  await page.locator('#open-work-details-button').click();
  await expect(page.locator('.work-details-dialog')).toContainText('正在加载工作详情');
  await page.locator('#close-work-details-button').click();
  await page.locator('button[data-session-id="session_browser_history"]').click();
  release();
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
  await expect(page.locator('.work-details-dialog')).toHaveCount(0);
});

test('a failed work module can be retried by reopening the dialog', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  let attempts = 0;
  await page.route('**/work-details-view.js*', async route => {
    attempts += 1;
    if (attempts === 1) return route.abort('failed');
    return route.continue();
  });
  await openSession(page);
  await page.locator('#open-work-details-button').click();
  await expect(page.locator('.work-details-dialog')).toContainText('工作详情加载失败');
  await page.locator('#close-work-details-button').click();
  await page.locator('#open-work-details-button').click();
  await expect(page.locator('.work-progress-count')).toHaveText('已完成 1 / 3 项活动');
  expect(attempts).toBe(2);
});

test('work text and diff lines remain readable in every theme', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await openSession(page);
  await emit(page, { type: 'batch.updated', batchId: 'batch_browser_edit', summary: { fileChanges: [{ path: 'public/app.js', action: 'updated', diff }] } });
  await page.locator('#open-work-details-button').click();
  const dialog = page.locator('.work-details-dialog');
  await dialog.locator('[data-work-event-id="batch_browser_edit"] > summary').click();
  const checks = [];
  for (const theme of ['fresh-light', 'retro', 'terminal', 'dark-gold', 'oled-black']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const contrast = await dialog.evaluate(el => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      const color = css => { context.clearRect(0, 0, 1, 1); context.fillStyle = css; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
      const luminance = rgba => rgba.slice(0, 3).map(value => { const n = value / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
      return ['.work-event-kind', '.work-event-title', '.work-event-status[data-tone="running"]', '.work-progress-count', '.work-diff-line[data-change="added"] code', '.work-diff-line[data-change="removed"] code', '.work-line-number'].map(selector => {
        const element = el.querySelector(selector);
        const foreground = luminance(color(getComputedStyle(element).color));
        let parent = element;
        while (parent.parentElement && !color(getComputedStyle(parent).backgroundColor)[3]) parent = parent.parentElement;
        const background = luminance(color(getComputedStyle(parent).backgroundColor));
        return { selector, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
      });
    });
    for (const sample of contrast) expect(sample.ratio, `${theme} ${sample.selector}`).toBeGreaterThanOrEqual(4.5);
    checks.push({ theme, contrast });
    await page.screenshot({ path: `${evidence}/work-theme-${theme}.png` });
  }
  await fs.writeFile(`${evidence}/work-contrast.json`, JSON.stringify(checks, null, 2));
});
