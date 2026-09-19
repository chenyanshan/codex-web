import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const output = fileURLToPath(new URL('./', import.meta.url));
const browser = await chromium.launch({ headless: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const id = 'session_browser_history';
const results = { measuredAt: new Date().toISOString(), environment: 'Isolated Chromium; PWA cases emulate navigator.standalone, not physical iOS', cases: [] };
const session = { id, title: '滚动与刷新审查', cwd: '/Users/test/yanshan_quant', archived: false, readOnly: false, activeTurnId: null, activityState: 'idle', settings: {} };
function messages(count = 8, start = 0) {
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + start;
    return { id: `scroll_message_${index}`, kind: 'message', role: index % 2 ? 'assistant' : 'user', label: index % 2 ? 'Assistant' : 'User', turnId: `scroll_turn_${Math.floor(index / 2)}`, meta: index % 2 ? 'final' : 'history', phase: index % 2 ? 'final_answer' : undefined, lifecycle: 'completed', text: index % 2 ? `回复 ${index}\n\n${Array.from({ length: 12 }, (_, row) => `第 ${row + 1} 段：检查历史位置、上下滚动与刷新后的内容，保留正在阅读的消息。`).join('\n\n')}` : `问题 ${index}：检查会话页的位置保持` };
  });
}
async function setup({ desktop = false, pwa = false, readOnly = false, count = 8, handle = null, waitStatus = true } = {}) {
  const context = await browser.newContext({ viewport: desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 }, hasTouch: !desktop, isMobile: !desktop, serviceWorkers: 'block' });
  const page = await context.newPage(); const pageErrors = []; const requests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => { if (request.url().includes(`/api/sessions/${id}`)) requests.push(new URL(request.url()).pathname + new URL(request.url()).search); });
  await page.addInitScript(({ pwa }) => {
    localStorage.setItem('codexWebToken', 'isolated-scroll-token'); localStorage.setItem('codexWebLanguage', 'zh-CN');
    if (pwa) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  }, { pwa });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__audit = { state, render, showMoreSessionHistory, refreshCurrentSessionMetadata, refreshCurrentView, handlePwaPullRefresh, applyTurnEvent };` });
  });
  await page.route(`**/api/sessions/${id}*`, async route => {
    const url = new URL(route.request().url());
    if (handle && await handle(route, url)) return;
    const metadata = { ...session, readOnly, archived: readOnly };
    if (url.pathname.endsWith('/timeline')) await route.fulfill({ json: { session: metadata, items: messages(count), hasMore: false, nextBefore: null } });
    else if (url.pathname.endsWith('/status')) await route.fulfill({ json: { session: metadata, turnSnapshot: null } });
    else await route.fulfill({ json: { session: { ...metadata, timeline: messages(count), timelineComplete: true, thread: { turns: [] } } } });
  });
  // Playwright glob '*' does not match slash; register the child route explicitly.
  await page.route(`**/api/sessions/${id}/**`, async route => {
    const url = new URL(route.request().url());
    if (handle && await handle(route, url)) return;
    const metadata = { ...session, readOnly, archived: readOnly };
    if (url.pathname.endsWith('/timeline')) await route.fulfill({ json: { session: metadata, items: messages(count), hasMore: false, nextBefore: null } });
    else if (url.pathname.endsWith('/status')) await route.fulfill({ json: { session: metadata, turnSnapshot: null } });
    else await route.fallback();
  });
  await page.goto('http://127.0.0.1:41743');
  await page.locator(`[data-session-id="${id}"]`).click();
  await page.waitForFunction(waitStatus => __audit.state.sessionId === 'session_browser_history' && !__audit.state.sessionHistoryPending && (!waitStatus || !__audit.state.sessionStatusPending), waitStatus);
  await page.waitForTimeout(600);
  return { page, context, requests, pageErrors, desktop, pwa };
}
async function position(run) {
  return run.page.evaluate(() => {
    const el = document.querySelector('#timeline'); const rect = el.getBoundingClientRect();
    const nodes = [...el.querySelectorAll('[data-timeline-id]')];
    const visible = nodes.filter(node => { const r = node.getBoundingClientRect(); return r.bottom > rect.top && r.top < rect.bottom; });
    return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight, firstVisibleId: visible[0]?.dataset.timelineId, firstVisibleOffset: visible[0] ? visible[0].getBoundingClientRect().top - rect.top : null, follow: __audit.state.timelineShouldFollowLatest, windowEnd: __audit.state.timelineWindowEnd ?? null, historyLength: __audit.state.sessionHistoryItems.length, displayed: nodes.length };
  });
}
async function touchPull(run, selector) {
  const box = await run.page.locator(selector).boundingBox();
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + Math.min(25, box.height / 2));
  const cdp = await run.context.newCDPSession(run.page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let distance = 25; distance <= 150; distance += 25) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach(); await delay(180);
}
async function finish(run, data) {
  results.cases.push({ ...data, desktop: run.desktop, pwa: run.pwa, pageErrors: run.pageErrors });
  await fs.writeFile(`${output}/session-checks.json`, JSON.stringify(results, null, 2) + '\n'); console.log(JSON.stringify(data)); await run.context.close();
}
try {
  {
    const run = await setup();
    await run.page.locator('#timeline').evaluate(el => { el.scrollTop = 250; }); await delay(100);
    const before = await position(run);
    // Inject normalized runtime events through the real event handler to isolate
    // steady streaming from foreground reconciliation and request ordering.
    await run.page.evaluate(() => {
      __audit.applyTurnEvent({ type:'turn.started', turnId:'synthetic_stream_turn' }, null);
      __audit.applyTurnEvent({ type:'assistant.delta', turnId:'synthetic_stream_turn', itemId:'synthetic_stream_answer', text:'新输出继续增长，当前正在阅读较早回复。'.repeat(50), delta:'新输出', phase:'final_answer' }, null);
    }); await delay(120);
    await finish(run, { name:'steady_stream_while_reading', before, after:await position(run) });
  }
  {
    let release; const gate = new Promise(resolve => { release=resolve; }); let uploads=0;
    const run = await setup({ handle:async (route,url) => {
      if (!url.pathname.endsWith('/attachments')) return false;
      uploads++; await gate; await route.fulfill({ status:503, json:{ error:'synthetic_old_session_upload_failure' } }); return true;
    } });
    await run.page.locator('#attachment-input').setInputFiles({ name:'synthetic-upload.txt', mimeType:'text/plain', buffer:Buffer.from('Isolated audit upload') });
    while (!uploads) await delay(20);
    await run.page.locator('#back-to-list-button').click();
    await run.page.locator('[data-session-id="session_browser_idle"]').click();
    await run.page.waitForFunction(() => __audit.state.sessionId === 'session_browser_idle' && !__audit.state.sessionStatusPending); await delay(100);
    release(); await delay(180);
    await finish(run, { name:'upload_result_after_session_navigation', result:await run.page.evaluate(() => ({ currentSession:__audit.state.sessionId,status:__audit.state.status,error:__audit.state.error,attachments:__audit.state.composerAttachments.length })) });
  }
  {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const run = await setup({ pwa: true, waitStatus: false, handle: async (route, url) => {
      if (!url.pathname.endsWith('/status')) return false;
      await gate; await route.fulfill({ json: { session, turnSnapshot: null } }); return true;
    } });
    await run.page.locator('#timeline').evaluate(el => { el.scrollTop = 250; }); await delay(100);
    const before = await position(run); release();
    await run.page.waitForFunction(() => !__audit.state.sessionStatusPending); await delay(160);
    await finish(run, { name: 'late_initial_status_overrides_reading_position', before, after: await position(run) });
  }
  for (const pwa of [false, true]) {
    const run = await setup({ pwa });
    await run.page.locator('#timeline').evaluate(el => { el.scrollTop = 0; }); await delay(80);
    const before = await position(run); await touchPull(run, '#timeline'); const after = await position(run);
    await run.page.screenshot({ path: `${output}/phone-${pwa ? 'pwa' : 'browser'}-history-pull.png` });
    await finish(run, { name: `phone_history_pull_${pwa ? 'pwa' : 'browser'}`, before, after, visibleHistoryButtons: await run.page.locator('[data-timeline-window="-1"]').count() });
  }
  {
    const run = await setup({ desktop: true });
    await run.page.locator('#timeline').evaluate(el => { el.scrollTop = 250; }); await delay(80);
    const before = await position(run);
    await run.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await delay(350);
    const after = await position(run); await run.page.screenshot({ path: `${output}/desktop-foreground-scroll-jump.png` });
    await finish(run, { name: 'desktop_foreground_while_reading', before, after });
  }
  {
    const run = await setup({ pwa: true, readOnly: true, count: 20 });
    await run.page.locator('#timeline').evaluate(el => { el.scrollTop = 550; }); await delay(100);
    const before = await position(run);
    // A viewport-height change triggers the real resize/render listener.
    await run.page.setViewportSize({ width: 390, height: 780 }); await delay(100);
    await finish(run, { name: 'readonly_resize_while_reading', before, after: await position(run), viewportHeightBefore:844, viewportHeightAfter:780 });
  }
  {
    let failed = false;
    const run = await setup({ pwa: true, handle: async route => {
      if (!failed) return false;
      await route.fulfill({ status: 503, json: { error: 'synthetic_refresh_unavailable' } }); return true;
    } });
    failed = true; const beforeRequests = run.requests.length;
    await touchPull(run, '.chat-topbar'); await delay(200);
    await run.page.screenshot({ path: `${output}/phone-refresh-failure-feedback.png` });
    await finish(run, { name: 'pwa_title_refresh_failure_feedback', requests: run.requests.slice(beforeRequests), feedback: await run.page.evaluate(() => ({ status: __audit.state.status, error: __audit.state.error, historyError: __audit.state.sessionHistoryError, statusError: __audit.state.sessionStatusError, visibleError: document.querySelector('.history-load-error')?.textContent || '', indicatorVisible: document.querySelector('.pull-refresh-indicator')?.classList.contains('is-visible') })) });
  }
  {
    const run = await setup({ pwa: true, count: 4 });
    await run.page.locator('#timeline').evaluate(el => { el.scrollTop = 0; }); await delay(80);
    const beforeRequests = run.requests.length; await touchPull(run, '#timeline');
    await finish(run, { name: 'pwa_timeline_pull_at_oldest', additionalRequests: run.requests.slice(beforeRequests), indicatorText: await run.page.locator('.pull-refresh-indicator').innerText() });
  }
  {
    let release; const gate = new Promise(resolve => { release = resolve; }); let slow = false;
    const run = await setup({ pwa: true, handle: async (route, url) => {
      if (!slow) return false;
      await gate;
      if (url.pathname.endsWith('/status')) await route.fulfill({ json: { session, turnSnapshot: null } });
      else await route.fulfill({ json: { session, items: messages(), hasMore: false, nextBefore: null } });
      return true;
    } });
    await run.page.locator('#timeline').evaluate(el => { el.scrollTop = 250; }); await delay(80);
    slow = true; await touchPull(run, '.chat-topbar');
    await run.page.locator('#timeline').evaluate(el => { el.scrollTop = 700; }); await delay(80);
    const userPositionWhileWaiting = await position(run); release(); await delay(250);
    await finish(run, { name: 'scroll_during_slow_refresh', userPositionWhileWaiting, afterResponse: await position(run) });
  }
  {
    const run = await setup({ pwa: true });
    await run.page.locator('#timeline').evaluate(el => { el.scrollTop = 300; }); await delay(80);
    const before = await position(run); await run.page.reload();
    await run.page.waitForFunction(() => __audit.state.sessionId === 'session_browser_history' && !__audit.state.sessionHistoryPending); await delay(200);
    await finish(run, { name: 'reload_reading_position', before, after: await position(run) });
  }
} finally { await browser.close(); }
results.completedAt = new Date().toISOString();
await fs.writeFile(`${output}/session-checks.json`, JSON.stringify(results, null, 2) + '\n');
