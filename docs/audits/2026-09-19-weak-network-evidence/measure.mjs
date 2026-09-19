import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Run against the repository's isolated browser fixture on port 41743.
// Uses only the fixture token and synthetic conversations.
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const output = fileURLToPath(new URL('./', import.meta.url));
const base = process.env.CODEX_WEAK_NETWORK_FIXTURE_URL || 'http://127.0.0.1:41743';
const browser = await chromium.launch({ headless: true });
const contexts = new Set();
const only = process.argv.find(argument => argument.startsWith('--only='))?.slice(7);
const results = only ? JSON.parse(await fs.readFile(`${output}/measurements.json`, 'utf8'))
  : { measuredAt: new Date().toISOString(), environment: 'Chromium desktop/mobile emulation, synthetic local fixture; delay and error injection, not physical cellular measurements', scenarios: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const historyId = 'session_browser_history';

async function setup({ desktop = false, workers = 'block' } = {}) {
  const context = await browser.newContext({
    viewport: desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    isMobile: !desktop, hasTouch: !desktop, serviceWorkers: workers,
  });
  contexts.add(context);
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-fixture-token');
    localStorage.setItem('codexWebLanguage', 'zh-CN');
  });
  if (workers === 'block') await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__weakNetworkAudit = { state, connectActiveTurnStream };` });
  });
  return { context, page };
}
async function finish(context, result) {
  results.scenarios = results.scenarios.filter(previous => previous.name !== result.name);
  results.scenarios.push(result);
  console.log(JSON.stringify(result));
  await fs.writeFile(`${output}/measurements.json`, JSON.stringify(results, null, 2) + '\n');
  await context.close();
  contexts.delete(context);
}
async function snapshot(page) {
  return page.evaluate(() => {
    const state = globalThis.__weakNetworkAudit?.state;
    return {
      status: state?.status || document.querySelector('.composer-status')?.textContent, authSessionId: state?.authSession?.id,
      pendingTurn: state?.pendingTurn, streamConnection: state?.streamConnection,
      sessionCount: state?.sessions.length, renderedSessionCount: document.querySelectorAll('[data-session-id]').length,
      error: state?.error, feedback: document.querySelector('.runtime-feedback')?.textContent,
    };
  });
}

try {
  // Fast history is withheld until an unrelated slow status response arrives.
  if (!only || only === 'status') {
    const { context, page } = await setup();
    let start = 0;
    let timelineResponseMs = null;
    page.on('response', response => {
      if (new URL(response.url()).pathname === `/api/sessions/${historyId}/timeline`) timelineResponseMs = Date.now() - start;
    });
    await page.route(`**/api/sessions/${historyId}/status`, async route => {
      await delay(4200);
      await route.continue();
    });
    await page.goto(base);
    await page.locator(`[data-session-id="${historyId}"]`).waitFor();
    start = Date.now();
    await page.locator(`[data-session-id="${historyId}"]`).click();
    await delay(900);
    const at900ms = { historyResponseReceived: timelineResponseMs !== null, historyVisible: (await page.locator('#timeline').textContent()).includes('Latest browser answer') };
    await page.screenshot({ path: `${output}/phone-slow-status.png` });
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Latest browser answer'));
    const historyVisibleMs = Date.now() - start;
    assert.equal(at900ms.historyResponseReceived, true);
    assert.equal(at900ms.historyVisible, false);
    await finish(context, { name: 'fast_history_waits_for_slow_status', injectedStatusDelayMs: 4200, timelineResponseMs, historyVisibleMs, at900ms });
  }

  // Startup has no request deadline for noncritical model loading.
  if (!only || only === 'startup') {
    const { context, page } = await setup({ desktop: true });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let listResponseMs = null;
    const start = Date.now();
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/api/sessions') listResponseMs = Date.now() - start;
    });
    await page.route('**/api/models', async route => { await gate; await route.continue(); });
    await page.goto(base);
    await delay(13000);
    const whileModelsBlocked = await snapshot(page);
    await page.screenshot({ path: `${output}/desktop-blocked-models.png` });
    release();
    await page.locator(`[data-session-id="${historyId}"]`).waitFor();
    const listVisibleMs = Date.now() - start;
    assert.ok(listResponseMs < 2000);
    assert.equal(whileModelsBlocked.renderedSessionCount, 0);
    await finish(context, { name: 'models_delay_blocks_initial_list_paint', observedBlockedMs: 13000, listResponseMs, listVisibleMs, whileModelsBlocked });
  }

  // A transient gateway error during a reconnect can turn a running task into a failed UI state.
  if (!only || only === 'sse') {
    const { context, page } = await setup();
    let eventRequests = 0;
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/events')) eventRequests += 1; });
    await page.goto(base);
    await page.locator('[data-session-id="session_browser_fixture"]').click();
    await page.waitForFunction(() => { const { state } = globalThis.__weakNetworkAudit; return state.pendingTurn && state.streamConnection === 'connected' && state.status !== 'Loading session'; });
    await delay(700);
    const before = await snapshot(page);
    let injected = 0;
    await page.route('**/api/turns/turn_browser_active/events*', async route => {
      if (injected++ === 0) await route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad Gateway</h1>' });
      else await route.continue();
    });
    await page.evaluate(() => globalThis.__weakNetworkAudit.connectActiveTurnStream({ forceReconnect: true }));
    await page.waitForFunction(() => globalThis.__weakNetworkAudit.state.pendingTurn === false);
    const requestsAfterError = eventRequests;
    const afterError = await snapshot(page);
    await page.screenshot({ path: `${output}/phone-transient-gateway-error.png` });
    await delay(11000);
    const afterWatchdog = await snapshot(page);
    assert.equal(afterWatchdog.pendingTurn, false);
    assert.equal(eventRequests, requestsAfterError);
    await finish(context, { name: 'transient_sse_502_marks_task_failed', injectedResponses: 1, before, afterError, afterWatchdog, observedAfterErrorMs: 11000, additionalReconnectRequests: eventRequests - requestsAfterError });
  }

  // Auth bootstrap is not retried by online/focus handlers after a transient network failure.
  if (!only || only === 'auth') {
    const { context, page } = await setup();
    let authRequests = 0;
    await page.route('**/api/auth/me', async route => {
      authRequests += 1;
      if (authRequests === 1) await route.abort('internetdisconnected');
      else await route.continue();
    });
    await page.goto(base);
    await page.waitForFunction(() => globalThis.__weakNetworkAudit.state.status === 'Offline');
    await context.setOffline(true);
    await delay(100);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await delay(2000);
    const afterOnline = await snapshot(page);
    await page.screenshot({ path: `${output}/phone-auth-recovery-stalled.png` });
    assert.equal(authRequests, 1);
    assert.equal(afterOnline.authSessionId, 'cached');
    await finish(context, { name: 'failed_auth_bootstrap_does_not_retry_when_online', authRequests, observedAfterOnlineMs: 2000, afterOnline });
  }

  // An installed shell and cached messages/draft remain available on a real offline reload.
  if (!only || only === 'offline') {
    const { context, page } = await setup({ workers: 'allow' });
    // This generic fixture omits the runtime's final-answer markers. Supply the
    // real DTO shape so the auth-pending policy correctly recognizes final answers.
    await page.route(`**/api/sessions/${historyId}/timeline?*`, async route => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.items = payload.items.map(item => item.role === 'assistant'
        ? { ...item, meta: 'final', phase: 'final_answer', lifecycle: 'completed' } : item);
      await route.fulfill({ response, json: payload });
    });
    await page.goto(base);
    await page.locator(`[data-session-id="${historyId}"]`).click();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Latest browser answer'));
    await page.locator('#prompt-input').fill('断网后仍保留的草稿');
    await delay(900);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const keys = await caches.keys();
        const cache = await caches.open(keys.find(key => key.startsWith('codex-web-static-')));
        if ((await cache.keys()).length >= 16) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Shell caching did not complete');
    });
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/me'), page.reload()]);
    await page.locator('#prompt-input').waitFor();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await delay(300);
    const offlineStarted = Date.now();
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#prompt-input')?.value === '断网后仍保留的草稿');
    const shellAndDraftReadyMs = Date.now() - offlineStarted;
    const historyRetained = (await page.locator('#timeline').textContent()).includes('Latest browser answer');
    const offline = await snapshot(page);
    await page.screenshot({ path: `${output}/phone-offline-cached-session.png` });
    assert.equal(historyRetained, true);
    await finish(context, { name: 'cached_shell_history_and_draft_survive_offline_reload', measuredAt: new Date().toISOString(), secureContext: true, serviceWorkerSupportedOrigin: base, fixtureNormalization: 'Assistant answers include real runtime final-answer DTO markers', shellAndDraftReadyMs, historyRetained, draftRetained: true, offline });
  }
  const app = await fs.readFile(new URL('../../../packages/codex-web/public/app.js', import.meta.url));
  results.appSourceSha256 = createHash('sha256').update(app).digest('hex');
  await fs.writeFile(`${output}/measurements.json`, JSON.stringify(results, null, 2) + '\n');
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
