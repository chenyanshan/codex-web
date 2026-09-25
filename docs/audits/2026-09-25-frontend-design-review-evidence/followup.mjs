// Targeted follow-up probes; uses mocked/local data only.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installAdminFixture, navigateAdmin } from '../../../packages/codex-web/test/browser/helpers/admin-fixture.js';
const output = path.dirname(fileURLToPath(import.meta.url));
const baseURL = 'http://127.0.0.1:41759';
const browser = await chromium.launch({ executablePath: '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const results = [];
const only = process.env.DESIGN_AUDIT_PROBE || '';
const resultFile = path.join(output, only ? `followup-results-${only}.json` : 'followup-results.json');
async function start({ admin = false, width = 390, touch = true } = {}) {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width, height: 844 }, isMobile: touch, hasTouch: touch });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  if (admin) await installAdminFixture(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('codexWebToken')) localStorage.setItem('codexWebToken', 'design-audit-followup');
    localStorage.setItem('codexWebLanguage', 'zh-CN');
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) { if (body instanceof FormData) globalThis.__auditUpload = this; return send.call(this, body); };
  });
  await page.route('**/app.js*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__audit = {state, render, selectSession, openAppSettingsPage, openAdminConsole, focusableElements, activeFocusScope};` }); });
  await page.goto('/'); await page.locator('button[data-session-id]').first().waitFor();
  return { context, page };
}
async function snapshot(page, name, extra = {}) {
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  results.push({ name, ...extra, ...await page.evaluate(() => ({ text: document.body.innerText, pageWidth: document.documentElement.scrollWidth, width: innerWidth, active: { tag: document.activeElement.tagName, id: document.activeElement.id }, buttons: [...document.querySelectorAll('button')].filter(e => e.checkVisibility()).map(e => { const r = e.getBoundingClientRect(); return { name: e.innerText || e.getAttribute('aria-label'), width: r.width, height: r.height }; }) })) });
}
async function step(name, fn) {
  if (only && only !== name) return;
  try { await fn(); } catch (error) { results.push({ name, error: error.message }); }
  await fs.writeFile(resultFile, JSON.stringify(results, null, 2));
  console.log(name);
}
try {
  await step('settings-complete', async () => {
    const { context, page } = await start();
    try {
      await page.route('**/api/auth/sessions', route => route.fulfill({ json: { sessions: [{ id: 'fixture-current', deviceName: 'Audit phone', current: true, lastSeenAt: '2026-09-25T00:00:00Z' }] } }));
      await page.evaluate(() => globalThis.__audit.openAppSettingsPage());
      await page.locator('#load-auth-devices').click();
      await page.locator('.auth-devices li').waitFor();
      await page.locator('#settings-logout-button').scrollIntoViewIfNeeded();
      await snapshot(page, 'mobile-app-settings-bottom', { note: 'Waited for device request before scrolling; prior audit locator raced a normal render.' });
      await page.evaluate(() => { Object.assign(globalThis.__audit.state.webhook, { enabled: true, loaded: true, key: 'cwwh_fixture_only_not_a_real_secret', hasKey: true, endpointPath: '/api/webhook' }); globalThis.__audit.render(); });
      await page.locator('#webhook-key-input').scrollIntoViewIfNeeded();
      await snapshot(page, 'mobile-webhook-enabled');
    } finally { await context.close(); }
  });
  await step('attachments-and-502', async () => {
    const { context, page } = await start(); let release;
    try {
      await page.evaluate(() => globalThis.__audit.selectSession('session_browser_idle'));
      await page.locator('#prompt-input').fill('保留这段草稿，先检查附件。');
      const held = new Promise(resolve => { release = resolve; });
      await page.route('**/api/sessions/session_browser_idle/attachments', async route => { await held; await route.fulfill({ status: 503, json: { message: '上传服务暂时不可用' } }); });
      await page.locator('#attachment-input').setInputFiles({ name: '很长的检查记录与下一步实施建议-design-audit.txt', mimeType: 'text/plain', buffer: Buffer.from('Fixture attachment') });
      await page.waitForFunction(() => Boolean(globalThis.__auditUpload));
      await page.evaluate(() => globalThis.__auditUpload.upload.dispatchEvent(new ProgressEvent('progress', { loaded: 42, total: 100, lengthComputable: true })));
      await snapshot(page, 'mobile-attachment-progress');
      release(); await page.locator('[data-attachment-retry-id]').waitFor();
      await snapshot(page, 'mobile-attachment-failed');
      await page.route('**/api/**', async route => { const pathname = new URL(route.request().url()).pathname; if (pathname === '/api/health' || pathname.endsWith('/status')) return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' }); return route.fallback(); });
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(() => document.querySelector('.composer-status')?.innerText.includes('502'));
      await snapshot(page, 'mobile-session-502', { draft: await page.locator('#prompt-input').inputValue() });
    } finally { release?.(); await context.close(); }
  });
  await step('admin-native-confirm-and-boundary', async () => {
    const { context, page } = await start({ admin: true, width: 980, touch: false });
    try {
      let writes = 0; page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/admin') && req.method() !== 'GET') writes++; });
      await page.evaluate(() => globalThis.__audit.openAdminConsole());
      await page.locator('[data-admin-session-id]').first().waitFor();
      await snapshot(page, 'desktop-admin-boundary-980');
      await page.locator('[data-admin-session-id]').first().click();
      await page.waitForFunction(() => document.body.innerText.includes('deployment checks passed'));
      await snapshot(page, 'desktop-admin-observer-980');
      await page.evaluate(() => globalThis.__audit.openAdminConsole());
      await navigateAdmin(page, 'users');
      await page.waitForFunction(() => !globalThis.__audit.state.admin.loading);
      const target = page.locator('[data-admin-delete-user-id="user_writer"]');
      await page.locator('.admin-user-row').filter({ has: target }).locator('summary').click();
      let record;
      page.once('dialog', async dialog => { record = { name: 'admin-delete-confirm', type: dialog.type(), message: dialog.message() }; await dialog.dismiss(); });
      await target.click();
      results.push({ ...record, adminWriteRequests: writes });
      await page.setViewportSize({ width: 320, height: 568 });
      await snapshot(page, 'compact-admin-users');
    } finally { await context.close(); }
  });
  await step('work-focus-check', async () => {
    const { context, page } = await start({ width: 1440, touch: false });
    try {
      await page.evaluate(() => globalThis.__audit.selectSession('session_browser_fixture'));
      await page.locator('.approval-actions').waitFor(); await page.locator('#open-work-details-button').click();
      await page.locator('.work-details-dialog').waitFor();
      const inspected = await page.evaluate(() => { const api = globalThis.__audit; const scope = api.activeFocusScope(); return { summaries: [...scope.element.querySelectorAll('summary')].map(e => ({ text: e.innerText, visible: e.checkVisibility() })), candidates: api.focusableElements(scope.element).map(e => ({ tag: e.tagName, id: e.id, visible: e.checkVisibility(), text: e.innerText.slice(0, 80) })) }; });
      const focus = [];
      for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); focus.push(await page.evaluate(() => ({ tag: document.activeElement.tagName, id: document.activeElement.id, text: document.activeElement.innerText, inDialog: Boolean(document.activeElement.closest('.work-details-dialog')) }))); }
      results.push({ name: 'work-dialog-focus', inspected, focus });
    } finally { await context.close(); }
  });
  await step('boot-persistence', async () => {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage(); await page.route('**/app.js*', route => route.abort()); await page.goto('/');
      await page.waitForTimeout(15000); await snapshot(page, 'boot-failure-after-15s', { waitMs: 15000 });
    } finally { await context.close(); }
  });
  await step('share-real-404-shape', async () => {
    const { context, page } = await start();
    try {
      await page.route('**/api/share/unavailable/session', route => route.fulfill({ status: 404, json: { error: 'session_not_found', message: 'Selected session was not found.' } }));
      await page.goto('/share/unavailable'); await page.locator('.shared-session-empty').waitFor(); await page.waitForTimeout(250);
      await snapshot(page, 'mobile-share-unavailable-404');
    } finally { await context.close(); }
  });
} finally {
  await fs.writeFile(resultFile, JSON.stringify(results, null, 2));
  await browser.close();
}
