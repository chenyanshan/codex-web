import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const evidence = 'docs/audits/2026-09-30-activity-panel-evidence';
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
  await expect(dialog.locator('.work-progress-count')).toHaveText('已收到 3 条活动');
  await expect(dialog.locator('.work-progress-title')).toContainText('修改文件');
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
    await region.evaluate(el => {
      el.__keyboardScrollEnded = new Promise(resolve => el.addEventListener('scrollend', resolve, { once: true }));
    });
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await region.evaluate(async el => { await el.__keyboardScrollEnded; delete el.__keyboardScrollEnded; });
  }
  // Wait for the actual keyboard scroll to finish before testing event-update
  // preservation. Otherwise Chromium can continue moving after this assignment.
  const horizontal = await region.evaluate(el => {
    const target = Math.min(24, el.scrollWidth - el.clientWidth);
    el.scrollTo({ left: target, top: el.scrollTop, behavior: 'instant' });
    return target;
  });
  await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBe(horizontal);
  await emit(page, { type: 'batch.completed', batchId: 'batch_browser_edit', status: 'completed' });
  await expect(dialog.locator('.work-progress-count')).toHaveText('已收到 3 条活动');
  await expect(region).toBeFocused();
  await expect(edit).toHaveAttribute('open', '');
  await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBe(horizontal);
  await emit(page, { type: 'batch.started', batchId: 'read_results', kind: 'command', title: 'git diff --check' });
  await expect(dialog.locator('.work-progress-current')).toHaveText('git diff --check');
  await expect(dialog.locator('.work-events')).not.toContainText('git diff --check');
  await expect(dialog.locator('[data-work-show-latest]')).toBeVisible();
  await expect(region).toBeFocused();
  const boxes = await dialog.evaluate(el => {
    const progress = el.querySelector('.work-details-list').getBoundingClientRect();
    const button = el.querySelector('[data-work-show-latest]').getBoundingClientRect();
    return { progress: { top: progress.top, bottom: progress.bottom, right: progress.right }, button: { top: button.top, bottom: button.bottom, right: button.right }, pageWidth: document.documentElement.scrollWidth, viewportHeight: window.innerHeight };
  });
  expect(boxes.button.top).toBeGreaterThanOrEqual(boxes.progress.top);
  expect(boxes.button.bottom).toBeLessThanOrEqual(boxes.progress.bottom);
  expect(boxes.button.bottom).toBeLessThanOrEqual(boxes.viewportHeight);
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
  await expect(page.locator('.work-progress-count')).toHaveText('已收到 3 条活动');
  expect(attempts).toBe(2);
});

test('work text and diff lines remain readable in every theme', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await openSession(page);
  await emit(page, { type: 'batch.updated', batchId: 'batch_browser_edit', summary: { fileChanges: [{ path: 'public/app.js', action: 'updated', diff }] } });
  await page.locator('#open-work-details-button').click();
  const dialog = page.locator('.work-details-dialog');
  await dialog.locator('[data-work-event-id="batch_browser_edit"] > summary').click();
  await expect(dialog.locator('.work-diff')).toBeVisible();
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

test('long retained output is lazy, expandable and survives updates without losing return focus', async ({ page }, info) => {
  await openSession(page);
  const output = Array.from({ length: 100 }, (_, index) => `record ${index}: retained test output`).join('\n');
  await emit(page, { type: 'batch.updated', batchId: 'batch_browser_command', summary: { output } });
  await page.locator('#open-work-details-button').click();
  const detail = page.locator('[data-work-event-id="batch_browser_command"]');
  await expect(detail.locator('.work-output')).toHaveCount(0);
  await detail.locator(':scope > summary').click();
  await expect(detail.locator('.work-output').last()).not.toContainText('record 99');
  await detail.locator('[data-work-content-open]').click();
  await expect(detail.locator('.work-output').last()).toContainText('record 99');
  await expect(detail.locator('[data-work-content-back]')).toBeFocused();
  await emit(page, { type: 'batch.completed', batchId: 'batch_browser_command', status: 'completed' });
  await expect(detail.locator('.work-output').last()).toContainText('record 99');
  await expect(detail.locator('[data-work-content-back]')).toBeFocused();
  await detail.locator('[data-work-content-back]').click();
  await expect(detail.locator('[data-work-content-open]')).toBeFocused();
  await expect(detail.locator('.work-output').last()).not.toContainText('record 99');
  await page.keyboard.press('Escape');
  await expect(page.locator('#open-work-details-button')).toBeFocused();
});

test('official activity state is compact, optional and keeps plan disclosure across updates', async ({ page }, info) => {
  const activity = {
    threadId: 'session_browser_fixture', turnId: 'turn_browser_active', revision: 1, observedAt: Date.now(), lastProgressAt: Date.now(),
    health: { status: 'retrying', observedRetryCount: 2, lastError: 'Upstream connection interrupted; retrying' }, observation: 'connected', compaction: 'idle',
    plan: { explanation: 'Verify the narrow-screen activity workflow', steps: [{ step: 'Inspect existing activity', status: 'completed' }, { step: 'Exercise keyboard and retained output', status: 'in_progress' }] },
    agents: [{ threadId: 'agent-ui-review', status: 'running', message: 'Checking mobile reading position', observedAt: Date.now() }],
    tools: [], tokenUsage: { last: { totalTokens: 1200 }, total: { totalTokens: 4600 } }, diff: { available: false }, truncated: false,
  };
  await page.route(/\/api\/sessions\/session_browser_fixture(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.session.turnActivity = activity;
    await route.fulfill({ response, json });
  });
  await openSession(page);
  await emit(page, { type: 'turn.activity', activity });
  await page.locator('#open-work-details-button').click();
  const dialog = page.locator('.work-details-dialog');
  await expect(dialog.locator('.work-progress-title')).toHaveText('模型连接重试中');
  const plan = dialog.locator('[data-work-section="plan"]');
  await expect(plan).not.toHaveAttribute('open');
  await expect(plan.locator('summary')).toHaveText('计划：完成 1/2 步');
  await plan.locator('summary').click();
  await emit(page, { type: 'batch.completed', batchId: 'batch_browser_command', status: 'completed' });
  await expect(plan).toHaveAttribute('open', '');
  await expect(dialog.locator('.work-progress-count')).toHaveText('已收到 3 条活动');
  await dialog.locator('.work-details-list').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: `${evidence}/work-retry-plan-${info.project.name}.png` });
});

test('turn diff loads on demand, retries locally, and preserves horizontal reading through updates', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  let requests = 0;
  await page.route('**/api/sessions/session_browser_fixture/turns/turn_browser_active/diff', async route => {
    requests += 1;
    if (requests === 1) return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
    return route.fulfill({ json: { diff: { text: `${diff}\n+${'long_code_'.repeat(180)}`, bytes: 5000, truncated: true } } });
  });
  await openSession(page);
  await emit(page, { type: 'turn.activity', activity: { turnId: 'turn_browser_active', revision: 1, health: { status: 'working' }, diff: { available: true } } });
  await page.locator('#open-work-details-button').click();
  const section = page.locator('[data-work-section="diff"]');
  await section.locator('summary').click();
  expect(requests).toBe(0);
  await section.locator('[data-work-load-diff]').click();
  await expect(section).toContainText('差异加载失败');
  await section.locator('[data-work-load-diff]').click();
  const region = section.locator('.work-diff');
  await expect(region).toBeVisible();
  await expect(section).toContainText('仅显示已保留的差异');
  await region.focus();
  await region.evaluate(el => { el.scrollLeft = 100; });
  await emit(page, { type: 'batch.completed', batchId: 'batch_browser_command', status: 'completed' });
  await expect(region).toBeFocused();
  expect(await region.evaluate(el => el.scrollLeft)).toBe(100);
  expect(requests).toBe(2);
});

test('long activity history stays inside the panel with a pinned overview and readable assignments and token units', async ({ page }, info) => {
  await openSession(page);
  const activity = { turnId: 'turn_browser_active', revision: 1, health: { status: 'working' }, observation: 'connected',
    agents: [{ threadId: 'child-opaque-123', prompt: '检查手机端的活动窗口，保留阅读位置与输入焦点。\n核对弱网下的恢复行为。', status: 'running', observedAt: Date.now() }],
    tools: [], tokenUsage: { total: { totalTokens: 2400000000, inputTokens: 2100000000, outputTokens: 300000000, cachedInputTokens: 1250000 }, last: { totalTokens: 12500 }, modelContextWindow: 1000000 } };
  await emit(page, { type: 'turn.activity', activity });
  for (let i = 0; i < 35; i++) await emit(page, { type: 'batch.started', batchId: `overflow-${i}`, kind: 'command', title: `Read activity record ${i}` });
  await page.locator('#open-work-details-button').click();
  const dialog = page.locator('.work-details-dialog');
  const checkBounds = async () => {
    await expect(dialog.locator('.work-overview')).toBeVisible();
    const bounds = await dialog.evaluate(el => {
      const rect = node => { const r = node.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height}; };
      return { dialog: rect(el), header: rect(el.querySelector('.work-details-header')), overview: rect(el.querySelector('.work-overview')), list: rect(el.querySelector('.work-details-list')), viewport: innerHeight };
    });
    expect(bounds.dialog.top).toBeGreaterThanOrEqual(0);
    expect(bounds.dialog.bottom).toBeLessThanOrEqual(bounds.viewport + 1);
    expect(bounds.header.top).toBeGreaterThanOrEqual(bounds.dialog.top);
    expect(bounds.overview.top).toBeGreaterThanOrEqual(bounds.header.bottom - 1);
    expect(bounds.overview.bottom).toBeLessThan(bounds.list.bottom);
    expect(bounds.list.height - bounds.overview.height).toBeGreaterThan(70);
  };
  await checkBounds();
  const agents = dialog.locator('[data-work-section="agents"]');
  await agents.locator(':scope > summary').click();
  await expect(agents.locator('.work-agent-prompt')).toContainText('检查手机端的活动窗口');
  await expect(agents.locator('.work-agent-meta')).not.toHaveAttribute('open');
  await checkBounds();
  await agents.locator(':scope > summary').click();
  const usage = dialog.locator('[data-work-section="usage"]');
  await usage.locator(':scope > summary').click();
  await expect(usage.locator('.work-token-metrics')).toContainText('2.4B');
  await expect(usage.locator('.work-token-metrics')).toContainText('12.5K');
  await expect(usage.locator('.work-token-metrics')).toContainText('1M');
  await usage.locator('.work-token-metrics').scrollIntoViewIfNeeded();
  await checkBounds();
  await page.screenshot({ path: `${evidence}/refined-tokens-${info.project.name}.png` });
  await usage.locator(':scope > summary').click();
  await agents.locator(':scope > summary').click();
  await agents.locator('.work-agent-prompt').scrollIntoViewIfNeeded();
  await emit(page, { type: 'turn.activity', activity: { ...activity, revision: 2 } });
  await expect(agents).toHaveAttribute('open', '');
  await checkBounds();
  await page.screenshot({ path: `${evidence}/refined-agents-${info.project.name}.png` });
  await dialog.locator('.work-details-list').evaluate(el => { el.scrollTop = 0; });
  await checkBounds();
  await dialog.locator('.work-details-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await checkBounds();
});
