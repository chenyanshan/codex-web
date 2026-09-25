import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const evidence = 'docs/audits/2026-09-25-session-polish-evidence';
const title = 'Review session rendering, navigation and weak-network recovery across every layout / 排查手机长任务恢复';
const project = 'a-very-long-production-project-directory-name';
const objective = 'Verify that the session remains readable throughout the running goal / 检查目标完成情况';
test.use({ serviceWorkers: 'block' });

test('mobile header keeps essential status visible and moves full context into the existing menu', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('mobile'));
  await fs.mkdir(evidence, { recursive: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('codexWebToken', 'mobile-header-fixture'); localStorage.setItem('codexWebLanguage', 'en'); });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__headerTest={state,render,applyTheme,applyLanguage,setSessionLayout,refreshRuntimeFeedback,CONNECTION};` });
  });
  await page.goto('/'); await page.locator('[data-session-id="session_browser_history"]').click();
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
  await page.evaluate(({ title, project, objective }) => {
    const { state, render } = globalThis.__headerTest;
    state.currentSession = { ...state.currentSession, title, projectName: project, cwd: `/workspace/${project}`, goal: { objective, status: 'active' }, turnStartedAt: Date.now() - 45000, lastBusinessActivityAt: Date.now() - 5000 };
    state.pendingTurn = true; state.turnId = 'header-fixture'; state.streamConnection = 'reconnecting'; render();
  }, { title, project, objective });
  const header = page.locator('.chat-topbar');
  for (const language of ['en', 'zh-CN']) for (const layout of ['current', 'console']) for (const theme of ['fresh-light', 'retro', 'dark-gold', 'oled-black', 'terminal']) {
    await page.evaluate(({ language, layout, theme }) => { globalThis.__headerTest.applyLanguage(language); globalThis.__headerTest.setSessionLayout(layout); globalThis.__headerTest.applyTheme(theme); globalThis.__headerTest.render(); }, { language, layout, theme });
    await expect(header.locator('.project-title')).toHaveText(title);
    await expect(header.locator('.chat-project-context')).toBeHidden();
    await expect(header.locator('.goal-status')).toBeHidden();
    await expect(header.locator('.runtime-timing')).toBeHidden();
    await expect(header.locator('.runtime-feedback')).toBeVisible();
    const geometry = await header.evaluate(el => {
      const status = el.querySelector('.runtime-feedback');
      return { height: el.getBoundingClientRect().height, clipped: status.scrollHeight > status.clientHeight + 1 || status.scrollWidth > status.clientWidth + 1, width: document.documentElement.scrollWidth };
    });
    expect(geometry.height).toBeLessThanOrEqual(90);
    expect(geometry.clipped).toBe(false); expect(geometry.width).toBeLessThanOrEqual(info.project.use.viewport.width);
    for (const selector of ['#back-to-list-button', '#visible-stop-button', '#settings-toggle']) {
      const box = await page.locator(selector).boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `${evidence}/header-${info.project.name}-${language}-${layout}-${theme}.png` });
  }
  await page.evaluate(() => { globalThis.__headerTest.CONNECTION.failed('header-fixture', { status: 502, message: 'fixture network failure' }); globalThis.__headerTest.render(); });
  await expect(header.locator('.runtime-feedback')).toContainText('HTTP 502');
  expect(await header.locator('.runtime-feedback').evaluate(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)).toBe(false);
  expect((await header.boundingBox()).height).toBeLessThanOrEqual(90);
  await page.locator('#prompt-input').fill('Keep this draft / 保留草稿');
  await page.locator('#settings-toggle').click();
  const context = page.locator('.session-context');
  await expect(context).toContainText(title); await expect(context).toContainText(project); await expect(context).toContainText(objective); await expect(context).toContainText('目标进行中');
  await expect(context.locator('.goal-objective')).toBeHidden();
  await page.evaluate(() => { globalThis.__headerTest.state.currentSession.goal.objective = globalThis.__headerTest.state.currentSession.goal.objective.repeat(80); globalThis.__headerTest.render(); });
  await expect(context.locator('details')).not.toHaveAttribute('open');
  await expect(context.locator('.goal-objective')).toBeHidden();
  await context.locator('details > summary').click();
  await expect(context.locator('.goal-objective')).toBeVisible();
  await context.locator('details > summary').click();
  await expect(context.locator('.runtime-timing')).toBeVisible();
  await expect(context.locator('.runtime-feedback')).not.toHaveAttribute('role');
  await expect(page.locator('.runtime-feedback[role="status"]')).toHaveCount(1);
  await page.evaluate(() => { globalThis.__headerTest.state.currentSession.turnStartedAt = Date.now() - 125000; globalThis.__headerTest.refreshRuntimeFeedback(); });
  await expect(context.locator('.runtime-timing')).toContainText('2m 5s');
  await expect(context.locator('.runtime-feedback')).not.toHaveAttribute('role');
  await page.screenshot({ path: `${evidence}/header-menu-${info.project.name}.png` });
  await page.locator('#settings-drawer-close').click();
  await expect(page.locator('#settings-toggle')).toBeFocused();
  await expect(page.locator('#prompt-input')).toHaveValue('Keep this draft / 保留草稿');
  const scrollBefore = await page.locator('#timeline').evaluate(el => el.scrollTop);
  await page.evaluate(() => globalThis.__headerTest.refreshRuntimeFeedback());
  expect(await page.locator('#timeline').evaluate(el => el.scrollTop)).toBe(scrollBefore);
  expect(errors).toEqual([]);
});
