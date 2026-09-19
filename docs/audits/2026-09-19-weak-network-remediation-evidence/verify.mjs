import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const output = fileURLToPath(new URL('./', import.meta.url));
const base = process.env.CODEX_WEAK_NETWORK_FIXTURE_URL || 'http://127.0.0.1:41743';
const only = process.argv.find(argument => argument.startsWith('--only='))?.slice(7);
const selected = name => !only || only.split(',').includes(name);
const browser = await chromium.launch({ headless: true });
const contexts = new Set();
const results = only ? JSON.parse(await fs.readFile(`${output}/checks.json`, 'utf8').catch(() => '{"scenarios":[]}'))
  : { measuredAt: new Date().toISOString(), environment: 'Isolated fixture, synthetic accounts and sessions, Chromium fault injection', scenarios: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const historyId = 'session_browser_history';
const views = {
  desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 },
  intermediate: { width: 980, height: 900 }, compact: { width: 320, height: 568 },
};

async function setup(view = 'phone', { workers = 'block' } = {}) {
  const context = await browser.newContext({ viewport: views[view], isMobile: views[view].width < 980, hasTouch: views[view].width < 980, serviceWorkers: workers });
  contexts.add(context);
  const page = await context.newPage();
  const errors = [];
  const assetFailures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (/\.(?:css|js)(?:\?|$)/u.test(response.url()) && response.status() >= 400) assetFailures.push(response.url()); });
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-fixture-token');
    localStorage.setItem('codexWebLanguage', 'zh-CN');
  });
  if (workers === 'block') await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__networkVerification = { state, connectActiveTurnStream };` });
  });
  return { context, page, view, errors, assetFailures };
}
async function finish(run, result) {
  assert.deepEqual(run.errors, []);
  assert.deepEqual(run.assetFailures, []);
  const geometry = await run.page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(geometry.scrollWidth <= geometry.width);
  results.scenarios = results.scenarios.filter(previous => previous.name !== result.name);
  results.scenarios.push({ ...result, view: run.view, geometry, errors: run.errors, assetFailures: run.assetFailures });
  await fs.writeFile(`${output}/checks.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(result));
  await run.context.close();
  contexts.delete(run.context);
}
const ready = page => page.waitForFunction(() => globalThis.__networkVerification?.state.authSession?.id === 'browser_auth_fixture');

try {
  if (selected('history')) {
    const run = await setup();
    const { page } = run;
    let release;
    let statusReturned = false;
    const gate = new Promise(resolve => { release = resolve; });
    let responseMs;
    let start;
    page.on('response', response => { if (new URL(response.url()).pathname.endsWith(`${historyId}/timeline`)) responseMs = Date.now() - start; });
    await page.route(`**/api/sessions/${historyId}/status`, async route => { await gate; statusReturned = true; await route.continue(); });
    await page.goto(base);
    await page.locator(`[data-session-id="${historyId}"]`).waitFor();
    start = Date.now();
    await page.locator(`[data-session-id="${historyId}"]`).click();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Latest browser answer'), null, { timeout: 2000 });
    const visibleMs = Date.now() - start;
    assert.equal(statusReturned, false);
    assert.equal(await page.locator('.history-load-error').count(), 0);
    await page.locator('#prompt-input').fill('状态还在加载时写下的草稿');
    await page.screenshot({ path: `${output}/phone-fast-history.png` });
    release();
    await delay(250);
    assert.equal(await page.locator('#prompt-input').inputValue(), '状态还在加载时写下的草稿');
    await finish(run, { name: 'history_renders_before_slow_status', responseMs, visibleMs, waitingNotReportedAsFailure: true, draftPreserved: true });
  }

  if (selected('status')) {
    const run = await setup('compact');
    const { page } = run;
    // Keep this case focused on metadata ordering. The generic fixture's event
    // stream belongs to a different conversation and would replace this history.
    await page.route('**/api/turns/turn_browser_active/events*', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': keepalive\n\n' }));
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let historyReturned = false;
    await page.route(`**/api/sessions/${historyId}/timeline?*`, async route => { await gate; historyReturned = true; await route.continue(); });
    await page.route(`**/api/sessions/${historyId}/status`, async route => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.session = { ...payload.session, title: '已确认的新名称', activeTurnId: 'turn_browser_active', activityState: 'running' };
      await route.fulfill({ response, json: payload });
    });
    await page.goto(base);
    await page.locator(`[data-session-id="${historyId}"]`).click();
    await page.waitForFunction(() => globalThis.__networkVerification.state.pendingTurn === true, null, { timeout: 2000 });
    assert.equal(historyReturned, false);
    assert.equal(await page.locator('.history-load-error').count(), 0);
    await page.screenshot({ path: `${output}/compact-fast-status.png` });
    release();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Latest browser answer'));
    await delay(250);
    const pendingAfterLateTimeline = await page.evaluate(() => globalThis.__networkVerification.state.pendingTurn);
    assert.equal(pendingAfterLateTimeline, true, 'Stale timeline metadata overrode authoritative running status');
    await finish(run, { name: 'status_renders_before_history_and_remains_authoritative', waitingNotReportedAsFailure: true, pendingAfterLateTimeline });
  }

  if (selected('startup')) {
    const run = await setup('desktop');
    const { page } = run;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let modelsReturned = false;
    let listResponseMs;
    const start = Date.now();
    page.on('response', response => { if (new URL(response.url()).pathname === '/api/sessions') listResponseMs = Date.now() - start; });
    await page.route('**/api/models', async route => { await gate; modelsReturned = true; await route.continue(); });
    await page.goto(base);
    await page.locator(`[data-session-id="${historyId}"]`).waitFor({ timeout: 2000 });
    const listVisibleMs = Date.now() - start;
    assert.equal(modelsReturned, false);
    await page.locator(`[data-session-id="${historyId}"]`).click();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Latest browser answer'), null, { timeout: 2000 });
    await page.locator('#prompt-input').fill('模型列表稍后再加载');
    await page.screenshot({ path: `${output}/desktop-slow-models-usable-chat.png` });
    release();
    await delay(250);
    assert.equal(await page.locator('#prompt-input').inputValue(), '模型列表稍后再加载');
    await finish(run, { name: 'models_do_not_block_session_list_or_chat', listResponseMs, listVisibleMs, draftPreserved: true });
  }

  if (selected('cross_device')) {
    const run = await setup('intermediate');
    const { page } = run;
    await page.route('**/api/turns/turn_browser_active/events*', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': keepalive\n\n' }));
    await page.route(`**/api/sessions/${historyId}/timeline?*`, async route => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.session = { ...payload.session, activeTurnId: 'turn_browser_active', activityState: 'running' };
      await delay(200);
      await route.fulfill({ response, json: payload });
    });
    await page.goto(base);
    await page.locator(`[data-session-id="${historyId}"]`).click();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Latest browser answer'));
    await page.waitForFunction(() => globalThis.__networkVerification.state.pendingTurn === true, null, { timeout: 2000 });
    assert.equal(await page.evaluate(() => globalThis.__networkVerification.state.turnId), 'turn_browser_active');
    await finish(run, { name: 'fresh_cross_device_activity_survives_cached_idle_status', pendingTurn: true });
  }

  if (selected('models_draft')) {
    const run = await setup();
    const { page } = run;
    await page.addInitScript(() => {
      localStorage.setItem('codexWebDefaultThreadSettings', JSON.stringify({ model: 'gpt-5.6-sol', reasoningEffort: 'ultra', accessPreset: 'read-only', sandboxMode: 'read-only', approvalPolicy: 'never' }));
      localStorage.setItem('codexWebDefaultThreadSettingsVersion', '2');
    });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/models', async route => { await gate; await route.continue(); });
    await page.goto(base);
    await page.locator(`[data-session-id="${historyId}"]`).waitFor();
    await page.locator('#open-new-session-button').click();
    await page.locator('#new-cwd-input').fill('/synthetic/weak-network');
    await page.locator('#new-session-form').evaluate(form => form.requestSubmit());
    await page.locator('#prompt-input').fill('模型目录到达前已选择本次设置');
    await page.locator('#new-session-settings-button').click();
    await page.locator('#new-session-reasoning-select').selectOption('low');
    release();
    await page.waitForFunction(() => globalThis.__networkVerification.state.modelsLoading === false);
    const actualEffort = await page.evaluate(() => globalThis.__networkVerification.state.reasoningEffort);
    assert.equal(actualEffort, 'low', 'Late model list overwrote the user-selected draft setting');
    assert.equal(await page.locator('#prompt-input').inputValue(), '模型目录到达前已选择本次设置');
    await finish(run, { name: 'late_model_list_preserves_explicit_draft_settings', reasoningEffort: actualEffort, draftPreserved: true });
  }

  if (selected('sse')) for (const code of [502, 503]) {
    const run = await setup();
    const { page } = run;
    let eventRequests = 0;
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/events')) eventRequests += 1; });
    await page.goto(base);
    await page.locator('[data-session-id="session_browser_fixture"]').click();
    await page.waitForFunction(() => { const { state } = globalThis.__networkVerification; return state.pendingTurn && state.streamConnection === 'connected' && state.status !== 'Loading session'; });
    await delay(500);
    let injected = 0;
    await page.route('**/api/turns/turn_browser_active/events*', async route => {
      if (injected++ === 0) await route.fulfill({ status: code, contentType: 'text/html', body: '<h1>Temporary gateway failure</h1>' });
      else await route.continue();
    });
    const before = eventRequests;
    const start = Date.now();
    await page.evaluate(() => globalThis.__networkVerification.connectActiveTurnStream({ forceReconnect: true }));
    await page.waitForFunction(() => globalThis.__networkVerification.state.streamConnection === 'reconnecting');
    const whileDisconnected = await page.evaluate(() => ({ pending: globalThis.__networkVerification.state.pendingTurn, timeline: document.querySelector('#timeline')?.textContent }));
    assert.equal(whileDisconnected.pending, true);
    assert.equal(whileDisconnected.timeline.includes(`HTTP ${code}`), false);
    await page.screenshot({ path: `${output}/phone-${code}-reconnecting.png` });
    await page.waitForFunction(() => globalThis.__networkVerification.state.streamConnection === 'connected', null, { timeout: 6000 });
    const recoveredMs = Date.now() - start;
    assert.ok(eventRequests >= before + 2);
    assert.equal(await page.evaluate(() => globalThis.__networkVerification.state.pendingTurn), true);
    await finish(run, { name: `transient_sse_${code}_automatically_recovers`, recoveredMs, eventRequestsDuringRecovery: eventRequests - before, taskRemainsRunning: true });
  }

  if (selected('auth')) {
    const run = await setup('intermediate');
    const { page, context } = run;
    let authRequests = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/auth/me', async route => {
      authRequests += 1;
      if (authRequests === 1) await route.abort('internetdisconnected');
      else { await gate; await route.continue(); }
    });
    await page.goto(base);
    await page.waitForFunction(() => globalThis.__networkVerification.state.status === 'Offline');
    await context.setOffline(true);
    await delay(100);
    await context.setOffline(false);
    for (let index = 0; index < 8; index += 1) await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    for (let attempt = 0; attempt < 20 && authRequests < 2; attempt += 1) await delay(100);
    assert.equal(authRequests, 2, 'Recovery signals were not coalesced');
    release();
    await ready(page);
    await page.locator(`[data-session-id="${historyId}"]`).waitFor({ timeout: 2000 });
    await page.screenshot({ path: `${output}/intermediate-auth-recovered.png` });
    await finish(run, { name: 'auth_recovers_on_network_return_with_coalesced_focus', authRequests, recoveredWithoutReload: true });
  }

  if (selected('authorization')) {
    const run = await setup();
    const { page } = run;
    let attempts = 0;
    await page.route('**/api/auth/me', async route => { attempts += 1; await route.fulfill({ status: 401, json: { error: 'unauthorized' } }); });
    await page.goto(base);
    await page.locator('#login-form').waitFor();
    for (let index = 0; index < 5; index += 1) await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
    await delay(300);
    assert.equal(attempts, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('codexWebToken')), null);
    await finish(run, { name: 'auth_401_does_not_loop_or_restore_revoked_token', attempts });
  }

  if (selected('outbox')) {
    const run = await setup();
    const { page } = run;
    const submissionIds = [];
    let authConfirmed = true;
    const tooEarly = [];
    await page.route(`**/api/sessions/${historyId}/turns`, async route => {
      const body = route.request().postDataJSON();
      submissionIds.push(body.submissionId);
      if (!authConfirmed) tooEarly.push(body.submissionId);
      if (submissionIds.length === 1) return route.abort('connectionreset');
      const response = await page.request.get(`${base}/api/sessions/${historyId}`);
      const { session } = await response.json();
      await route.fulfill({ status: 200, json: {
        submission: { id: body.submissionId, status: 'submitted', sessionId: historyId, turnId: 'turn_browser_active', error: null },
        session: { ...session, activeTurnId: 'turn_browser_active' }, turnId: 'turn_browser_active',
      } });
    });
    await page.goto(base);
    await page.locator(`[data-session-id="${historyId}"]`).click();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Latest browser answer'));
    await page.locator('#prompt-input').fill('同一条消息在恢复认证后继续发送');
    await page.locator('#composer-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => [...globalThis.__networkVerification.state.submissionOutbox.values()].some(entry => entry.status === 'failed'));
    assert.equal(submissionIds.length, 1);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    authConfirmed = false;
    await page.route('**/api/auth/me', async route => {
      await gate;
      authConfirmed = true;
      await route.continue();
    });
    await page.reload();
    await page.waitForFunction(() => globalThis.__networkVerification?.state.authSession?.id === 'cached');
    for (let index = 0; index < 5; index += 1) await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
    await delay(400);
    assert.equal(submissionIds.length, 1, 'Outbox was delivered before identity confirmation');
    release();
    await ready(page);
    await page.waitForFunction(() => globalThis.__networkVerification.state.submissionOutbox.size === 0, null, { timeout: 6000 });
    assert.deepEqual(tooEarly, []);
    assert.equal(submissionIds.length, 2);
    assert.equal(submissionIds[0], submissionIds[1]);
    await finish(run, { name: 'durable_outbox_waits_for_confirmed_identity_and_reuses_submission', attempts: submissionIds.length, stableSubmissionId: true, unconfirmedIdentityWrites: tooEarly.length });
  }

  if (selected('offline')) {
    const run = await setup('phone', { workers: 'allow' });
    const { page, context } = run;
    await page.route(`**/api/sessions/${historyId}/timeline?*`, async route => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.items = payload.items.map(item => item.role === 'assistant' ? { ...item, meta: 'final', phase: 'final_answer', lifecycle: 'completed' } : item);
      await route.fulfill({ response, json: payload });
    });
    await page.goto(base);
    await page.locator(`[data-session-id="${historyId}"]`).click();
    await page.waitForFunction(() => document.querySelector('#timeline')?.textContent.includes('Latest browser answer'));
    await page.locator('#prompt-input').fill('弱网优化后的离线草稿');
    await delay(900);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const resources = ['/', ...[...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')].map(node => node.src || node.href)];
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if ((await Promise.all(resources.map(url => caches.match(url)))).every(Boolean)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Critical shell precache did not finish');
    });
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/me'), page.reload()]);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await delay(300);
    const start = Date.now();
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#prompt-input')?.value === '弱网优化后的离线草稿');
    const restoredMs = Date.now() - start;
    assert.ok((await page.locator('#timeline').textContent()).includes('Latest browser answer'));
    await page.screenshot({ path: `${output}/phone-offline-shell.png` });
    await context.setOffline(false);
    await page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/me' && response.status() === 200, { timeout: 3000 });
    await finish(run, { name: 'new_modules_precache_and_offline_draft_survive_reload', restoredMs, historyRetained: true, draftRetained: true, onlineReauthWithoutReload: true, origin: base });
  }
  results.completedAt = new Date().toISOString();
  results.appSourceSha256 = createHash('sha256').update(await fs.readFile(new URL('../../../packages/codex-web/public/app.js', import.meta.url))).digest('hex');
  results.sourceSha256 = {};
  for (const file of ['app.js', 'network-recovery.js', 'session-loader.js', 'service-worker.js', 'index.html', 'ui-kit.js']) {
    results.sourceSha256[file] = createHash('sha256').update(await fs.readFile(new URL(`../../../packages/codex-web/public/${file}`, import.meta.url))).digest('hex');
  }
  await fs.writeFile(`${output}/checks.json`, JSON.stringify(results, null, 2) + '\n');
} catch (error) {
  for (const context of contexts) for (const page of context.pages()) {
    console.error('Failure context:', await page.evaluate(() => ({
      sessionId: globalThis.__networkVerification?.state.sessionId,
      status: globalThis.__networkVerification?.state.status,
      pending: globalThis.__networkVerification?.state.pendingTurn,
      timeline: document.querySelector('#timeline')?.textContent,
    })).catch(() => null));
    await page.screenshot({ path: '/tmp/weak-network-verification-failure.png' }).catch(() => {});
  }
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
