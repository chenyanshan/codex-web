// Read-only UI audit. Run against the repository browser fixture, never production.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAdminFixture, navigateAdmin } from '../../../packages/codex-web/test/browser/helpers/admin-fixture.js';

const output = path.dirname(fileURLToPath(import.meta.url));
const baseURL = process.env.DESIGN_AUDIT_URL || 'http://127.0.0.1:41759';
if (!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('Use a local fixture only');
const browser = await chromium.launch({ executablePath: process.env.DESIGN_AUDIT_CHROMIUM || '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', headless: true });
const results = { fixture: baseURL, capturedAt: new Date().toISOString(), scenarios: [], probes: [] };
const summary = {
  reason: '为检查手机与桌面页面，需要启动一个隔离的浏览器测试站点。',
  command: '/bin/bash -lc "/home/ubuntu/workspace/.local/node-v24.16.0/bin/node packages/codex-web/test/browser/fixture-server.mjs --port=41759"',
  cwd: '/home/ubuntu/workspace/codex-mobile-web-app',
  availableDecisionKeys: ['accept', 'acceptWithExecpolicyAmendment', 'cancel'],
  execPolicyAmendment: ['/home/ubuntu/workspace/.local/node-v24.16.0/bin/node', 'packages/codex-web/test/browser/fixture-server.mjs'],
};
async function contextFor(viewport, { admin = false, auth = true, lang = 'zh-CN', theme = 'fresh-light' } = {}) {
  const context = await browser.newContext({ baseURL, viewport, serviceWorkers: 'block', isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  if (admin) await installAdminFixture(page);
  await page.addInitScript(({ auth, lang, theme }) => {
    if (auth && !localStorage.getItem('codexWebToken')) localStorage.setItem('codexWebToken', 'design-audit-fixture');
    localStorage.setItem('codexWebLanguage', lang);
    localStorage.setItem('codexWebTheme', theme);
    localStorage.setItem('codexWebSessionLayout', 'current');
  }, { auth, lang, theme });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__designAudit = {state, render, selectSession, openAppSettingsPage, openNewSessionPage, openAdminConsole, openSessionFileByPath, setSessionLayout, setLanguage: value => { applyLanguage(value); render(); }, setTheme: value => { applyTheme(value); render(); }, focusableElements, activeFocusScope};` });
  });
  await page.route('**/api/auth/sessions', route => route.fulfill({ json: { sessions: [
    { id: 'design-device', deviceName: 'Chrome / Audit fixture', current: true, lastSeenAt: '2026-09-25T00:00:00Z' },
    { id: 'design-other', deviceName: 'Safari / iPhone fixture', current: false, lastSeenAt: '2026-09-24T09:00:00Z' },
  ] } }));
  await page.route('**/api/metrics', route => route.fulfill({ json: {
    http: { uptimeSeconds: 86435, samples: 35, requestP95Ms: 248, activeStreams: 4, sseReplays: 16, sseResets: 2,
      routes: { sessions: { requests: 120, errors: 2, clientErrors: 1, samples: 35, requestP95Ms: 248 }, events: { requests: 36, errors: 0, clientErrors: 0, samples: 16, requestP95Ms: 60 } } },
    storage: { managedStorageMaxBytes: 1073741824, projectUploadMaxBytes: 104857600, backgroundFailures: 0 },
  } }));
  await page.goto('/');
  await page.waitForFunction(() => Boolean(globalThis.__designAudit));
  if (auth) await page.locator('button[data-session-id]').first().waitFor();
  else await page.locator('#login-form').waitFor();
  return { context, page, errors };
}
async function capture(page, name, extra = {}) {
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  const geometry = await page.evaluate(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const visible = element => element.checkVisibility() && element.getBoundingClientRect().width > 0;
    return {
      viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth,
      headings: [...document.querySelectorAll('h1,h2,h3,.settings-section-title')].filter(visible).map(e => e.innerText),
      text: document.body.innerText,
      scrollRegions: [...document.querySelectorAll('*')].filter(e => visible(e) && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4).map(e => ({ tag: e.tagName, class: e.className, id: e.id, height: e.clientHeight, contentHeight: e.scrollHeight })),
      approval: [...document.querySelectorAll('.approval-actions button')].map(e => ({ text: e.innerText, rect: rect(e), clientWidth: e.clientWidth, scrollWidth: e.scrollWidth, font: getComputedStyle(e).fontSize, disabled: e.disabled })),
      smallTouchControls: [...document.querySelectorAll('button,input:not([type=checkbox]),select')].filter(e => visible(e) && !e.disabled).map(e => ({ text: e.innerText.slice(0, 70) || e.getAttribute('aria-label') || e.id, ...rect(e) })).filter(r => r.width < 44 || r.height < 44),
    };
  });
  results.scenarios.push({ name, ...geometry, ...extra });
  console.log(JSON.stringify({ name, width: geometry.viewport.width, pageWidth: geometry.pageWidth, approval: geometry.approval }));
}
async function step(name, fn) {
  try { await fn(); } catch (error) { results.probes.push({ name, error: error.message }); console.log(JSON.stringify({ name, error: error.message })); }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
}
async function select(page, id) {
  await page.evaluate(id => globalThis.__designAudit.selectSession(id), id);
  await page.locator('#timeline').waitFor();
}
async function decorateApproval(page) {
  await page.locator('.approval-actions').waitFor();
  await page.evaluate(summary => {
    const api = globalThis.__designAudit;
    for (const item of api.state.timeline) if (item.kind === 'approval') item.summary = summary;
    for (const item of api.state.approvals.values()) item.summary = summary;
    api.render();
  }, summary);
}

try {
  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
    await step(`${label}-login`, async () => {
      const { context, page } = await contextFor(viewport, { auth: false });
      try {
        await capture(page, `${label}-login`);
        await page.route('**/api/auth/login', route => route.fulfill({ status: 409, json: { error: 'setup_required', message: 'Password not configured.' } }));
        await page.locator('#password').fill('fixture-only-password');
        await page.locator('#login-form button[type=submit]').click();
        await page.locator('pre.command').waitFor();
        await capture(page, `${label}-setup`);
      } finally { await context.close(); }
    });
    const { context, page, errors } = await contextFor(viewport);
    try {
      await step(`${label}-sessions`, () => capture(page, `${label}-sessions`));
      await step(`${label}-new`, async () => {
        await page.evaluate(() => globalThis.__designAudit.openNewSessionPage());
        await capture(page, `${label}-new`);
      });
      await step(`${label}-approval`, async () => {
        await select(page, 'session_browser_fixture'); await decorateApproval(page);
        await page.locator('.approval-actions').scrollIntoViewIfNeeded();
        await capture(page, `${label}-approval`);
      });
      await step(`${label}-session-settings`, async () => {
        await page.locator('#settings-toggle').click();
        await capture(page, `${label}-session-settings`);
        await page.keyboard.press('Escape');
      });
      await step(`${label}-work-details`, async () => {
        await page.locator('#open-work-details-button').click();
        await page.locator('.work-details-dialog').waitFor();
        const details = page.locator('.work-details-dialog details').first();
        if (await details.count()) await details.locator('summary').first().click();
        await capture(page, `${label}-work-details`);
        await page.keyboard.press('Escape');
      });
      await step(`${label}-file`, async () => {
        await select(page, 'session_browser_files');
        await page.getByRole('link', { name: 'Browser session guide', exact: true }).click();
        await page.waitForFunction(() => document.body.innerText.includes('Session scoped'));
        await capture(page, `${label}-file`);
        await page.keyboard.press('Escape');
      });
      await step(`${label}-app-settings`, async () => {
        await page.evaluate(() => globalThis.__designAudit.openAppSettingsPage());
        await page.locator('#load-auth-devices').waitFor({ state: 'attached' });
        await capture(page, `${label}-app-settings-top`);
        await page.locator('#load-auth-devices').click();
        await page.locator('#settings-logout-button').scrollIntoViewIfNeeded();
        await capture(page, `${label}-app-settings-bottom`);
      });
      results.probes.push({ name: `${label}-page-errors`, errors });
    } finally { await context.close(); }
    await step(`${label}-admin`, async () => {
      const { context, page, errors } = await contextFor(viewport, { admin: true });
      try {
        await page.evaluate(() => globalThis.__designAudit.openAdminConsole());
        await page.locator('[data-admin-session-id]').first().waitFor();
        await capture(page, `${label}-admin-sessions`);
        for (const section of ['projects', 'roles', 'users', 'system']) {
          await navigateAdmin(page, section);
          await page.waitForTimeout(100);
          await capture(page, `${label}-admin-${section}`);
          if (section === 'system') continue;
          const kind = section.slice(0, -1);
          await page.locator(`[data-admin-add="${kind}"]`).click();
          await capture(page, `${label}-admin-${kind}-editor-before-scroll`);
          await page.locator(`#admin-${kind}-form`).scrollIntoViewIfNeeded();
          await capture(page, `${label}-admin-${kind}-editor`);
          results.probes.push({ name: `${label}-${kind}-editor-focus`, focused: await page.evaluate(() => ({ tag: document.activeElement.tagName, id: document.activeElement.id, name: document.activeElement.getAttribute('name') })) });
          await page.locator(`#admin-${kind}-edit-cancel`).click();
        }
        results.probes.push({ name: `${label}-admin-page-errors`, errors });
      } finally { await context.close(); }
    });
  }
  await step('approval-matrix', async () => {
    const { context, page } = await contextFor({ width: 320, height: 568 }, { lang: 'en' });
    try {
      await page.evaluate(() => globalThis.__designAudit.openNewSessionPage());
      await capture(page, 'compact-new-english');
      await select(page, 'session_browser_fixture'); await decorateApproval(page);
      for (const theme of ['fresh-light', 'retro', 'terminal', 'dark-gold', 'oled-black']) {
        for (const layout of ['current', 'console']) {
          await page.evaluate(({ theme, layout }) => { globalThis.__designAudit.setTheme(theme); globalThis.__designAudit.setSessionLayout(layout); }, { theme, layout });
          await page.locator('.approval-actions').scrollIntoViewIfNeeded();
          await capture(page, `compact-approval-${theme}-${layout}`);
        }
      }
      await page.evaluate(() => { globalThis.__designAudit.setLanguage('zh-CN'); globalThis.__designAudit.setTheme('retro'); });
      for (const viewport of [{ width: 844, height: 390 }, { width: 980, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.locator('.approval-actions').scrollIntoViewIfNeeded();
        await capture(page, `approval-boundary-${viewport.width}`);
      }
    } finally { await context.close(); }
  });
  for (const failure of ['app.js', 'admin-data.js', 'storage']) {
    await step(`boot-${failure}`, async () => {
      const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      try {
        const page = await context.newPage(); const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (failure === 'storage') await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException('Audit: browser storage denied', 'SecurityError'); }; });
        else await page.route(`**/${failure}*`, route => route.abort('failed'));
        await page.goto('/'); await page.waitForTimeout(1300);
        await capture(page, `boot-failure-${failure.replace('.', '-')}`, { errors, failureInjection: failure });
      } finally { await context.close(); }
    });
  }
  await step('share-states', async () => {
    const { context, page } = await contextFor({ width: 390, height: 844 }, { auth: false });
    try {
      await page.route('**/api/share/design-audit/session', route => route.fulfill({ json: { mode: 'share', session: { id: 'design-share', cwd: '', readOnly: true, settings: { metadata: {} }, timeline: [{ id: 'shared-user', kind: 'message', role: 'user', label: 'You', text: '请检查审批请求的界面。' }, { id: 'shared-assistant', kind: 'message', role: 'assistant', label: 'Assistant', text: '审批请求需要清楚说明执行内容、授权范围与可选操作。' }], thread: { turns: [] } } } }));
      await page.goto('/share/design-audit'); await page.locator('.shared-session-page').waitFor();
      await capture(page, 'mobile-share');
      await page.route('**/api/share/design-audit/session', route => route.fulfill({ status: 410, json: { error: 'share_expired', message: 'Share expired' } }));
      await page.reload(); await page.waitForTimeout(250);
      await capture(page, 'mobile-share-expired');
    } finally { await context.close(); }
  });
} finally {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
