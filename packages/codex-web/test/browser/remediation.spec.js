import { test, expect } from '@playwright/test';

const id = 'session_browser_history';
const fixtureToken = 'browser-fixture-token';

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem('codexWebToken', token);
    localStorage.setItem('codexWebLanguage', 'en');
  }, fixtureToken);
});

async function exposeWorkspace(page) {
  await page.route('**/app.js*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__workspaceTest = { state, render, selectSession, openNewSessionPage, openAppSettingsPage, openSessionFileByPath, refreshChatDynamicUi };` });
  });
}

async function openHistory(page) {
  await page.goto('/');
  await page.locator(`button[data-session-id="${id}"]`).click();
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
}

test('stale missing-session response cannot clear the newly selected session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  await page.route(`**/api/sessions/${id}/status`, async (route) => {
    await blocked;
    await route.fulfill({ status: 404, json: { error: 'session_not_found' } }).catch(() => {});
  });
  await page.goto('/');
  await page.locator(`button[data-session-id="${id}"]`).click();
  await page.locator('button[data-session-id="session_browser_idle"]').click();
  await page.locator('#prompt-input').fill('Keep this unsent draft');
  release();
  await expect(page.locator('.chat-title-stack')).toContainText('Idle quality gate fixture');
  await expect(page.locator('button[data-session-id="session_browser_idle"]')).toBeVisible();
  await expect(page.locator('#prompt-input')).toHaveValue('Keep this unsent draft');
  await expect(page.getByText('Selected session was unavailable.', { exact: false })).toHaveCount(0);
});

test('partial history failure has an independent retry that recovers real compact history', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait');
  let failed = true;
  let fullReads = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === `/api/sessions/${id}`) fullReads += 1; });
  await page.route(`**/api/sessions/${id}/timeline?*`, (route) => failed
    ? route.fulfill({ status: 500, json: { error: 'test_failure' } }) : route.continue());
  await page.goto('/');
  await page.locator(`button[data-session-id="${id}"]`).click();
  await expect(page.locator('.history-load-error')).toContainText('History could not be loaded');
  failed = false;
  await page.locator('#retry-session-history').click();
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
  await expect(page.locator('.history-load-error')).toHaveCount(0);
  expect(fullReads).toBe(0);
});

test('draft text and completed attachment references survive reload without crossing owners', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait');
  await exposeWorkspace(page);
  await openHistory(page);
  await page.evaluate(() => { globalThis.__workspaceTest.state.composerAttachments = [{ id: 'retained-upload', status: 'ready', fileName: 'kept.png', uploaded: { localPath: '/uploads/kept.png', fileName: 'kept.png' } }]; });
  await page.locator('#prompt-input').fill('手机上尚未发送的草稿');
  await page.waitForTimeout(350);
  await page.reload();
  await expect(page.locator('#prompt-input')).toHaveValue('手机上尚未发送的草稿');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('codexWebPromptDrafts:single')));
  expect(stored[id].prompt).toBe('手机上尚未发送的草稿');
  await expect(page.locator('.attachment-name')).toHaveText('kept.png');
  expect(stored[id].attachments[0].uploaded.localPath).toBe('/uploads/kept.png');
  expect(await page.evaluate(() => globalThis.CodexWebDrafts.createStore(localStorage).read('multi:another-user'))).toEqual({});
});

test('long history remains bounded while chrome updates preserve mounted composer and timeline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await exposeWorkspace(page);
  await openHistory(page);
  await page.evaluate(() => {
    const { state, render } = globalThis.__workspaceTest;
    state.timeline = Array.from({ length: 500 }, (_, index) => ({ id: `bounded_${index}`, kind: 'message', role: index % 2 ? 'assistant' : 'user', text: `Message ${index} — 中文与 **Markdown**`, label: index % 2 ? 'Assistant' : 'You' }));
    state.timelineWindowEnd = null;
    render();
    globalThis.__timeline = document.querySelector('#timeline');
    globalThis.__prompt = document.querySelector('#prompt-input');
  });
  await expect(page.locator('#timeline [data-timeline-id]')).toHaveCount(80);
  await page.locator('#prompt-input').fill('Composing input');
  await page.evaluate(() => {
    const input = document.querySelector('#prompt-input');
    input.setSelectionRange(4, 8);
    input.dispatchEvent(new CompositionEvent('compositionstart', { data: '测', bubbles: true }));
    globalThis.__workspaceTest.render();
  });
  expect(await page.evaluate(() => ({
    prompt: document.querySelector('#prompt-input') === globalThis.__prompt,
    timeline: document.querySelector('#timeline') === globalThis.__timeline,
    focused: document.activeElement === globalThis.__prompt,
    start: globalThis.__prompt.selectionStart,
    end: globalThis.__prompt.selectionEnd,
  }))).toEqual({ prompt: true, timeline: true, focused: true, start: 4, end: 8 });
  await page.locator('[data-timeline-window="-1"]').click();
  await expect(page.locator('#timeline [data-timeline-id]')).toHaveCount(80);
  await expect(page.locator('[data-timeline-id="bounded_360"]')).toBeAttached();
  await page.locator('[data-timeline-window="1"]').click();
  await expect(page.locator('[data-timeline-id="bounded_499"]')).toBeAttached();
});

test('session lists keep navigation and unfiltered cursor pagination without search controls', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(testInfo.project.name));
  const requests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/sessions') requests.push(url);
  });
  await page.goto('/');
  await expect(page.locator('button[data-session-id="session_browser_fixture"]')).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.locator('#session-activity-filter')).toHaveCount(0);
  await page.locator('#load-more-sessions-button').click();
  await expect(page.locator('button[data-session-id="session_browser_older"]')).toBeVisible();
  expect(requests.some((url) => url.searchParams.has('cursor'))).toBe(true);
  for (const scope of ['favorites', 'archived', 'time']) {
    await page.locator(`[data-sort-mode="${scope}"]`).click();
    await expect(page.locator(`[data-sort-mode="${scope}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await expect.poll(() => requests.some((url) => url.searchParams.get('favorite') === 'true')).toBe(true);
  await expect.poll(() => requests.some((url) => url.searchParams.get('state') === 'archived')).toBe(true);
  expect(requests.every((url) => !url.searchParams.has('q') && !url.searchParams.has('activity'))).toBe(true);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
});

test('status failure does not hide successful history and both failures remain retryable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.route(`**/api/sessions/${id}/status`, (route) => route.fulfill({ status: 500, json: { error: 'status_failed' } }));
  await openHistory(page);
  await expect(page.locator('.history-load-error')).toContainText('Execution status could not be refreshed');
  await page.route(`**/api/sessions/${id}/timeline?*`, (route) => route.fulfill({ status: 500, json: { error: 'history_failed' } }));
  await page.locator('#retry-session-history').click();
  await expect(page.locator('.history-load-error')).toContainText('Cached messages are shown');
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
});

test('all themes keep secondary session text readable and phone work controls at least 44px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait');
  await page.goto('/');
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  for (const theme of ['retro', 'fresh-light', 'terminal', 'dark-gold', 'oled-black']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await page.waitForTimeout(250);
    const contrasts = await page.locator('.session-preview, .session-card-meta').evaluateAll((elements) => {
      const rgba = (value) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const luminance = (color) => color.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      return elements.filter((element) => element.textContent.trim()).map((element) => {
        let parent = element;
        while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement;
        const foreground = luminance(rgba(getComputedStyle(element).color));
        const background = luminance(rgba(getComputedStyle(parent).backgroundColor));
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      });
    });
    expect(contrasts.length).toBeGreaterThan(0);
    expect(Math.min(...contrasts), `${theme} ordinary secondary text`).toBeGreaterThanOrEqual(4.5);
  }
  await page.locator('button[data-session-id="session_browser_fixture"]').click();
  await expect(page.locator('#open-work-details-button')).toBeVisible();
  for (const selector of ['#open-work-details-button', '#visible-stop-button', '#settings-toggle']) {
    const box = await page.locator(selector).boundingBox();
    expect(box.height, selector).toBeGreaterThanOrEqual(44);
    expect(box.width, selector).toBeGreaterThanOrEqual(44);
  }
});

test('large text preview is explicit and full download is only fetched on request', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.route('**/api/sessions/session_browser_files/files/*/content*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('preview') === '1') {
      return route.fulfill({ headers: { 'content-type': 'text/markdown', 'X-Content-Truncated': 'true', 'X-Content-Total-Bytes': '2000000' }, body: '# Bounded preview' });
    }
    return route.continue();
  });
  await page.goto('/');
  await page.locator('button[data-session-id="session_browser_files"]').click();
  await page.getByRole('link', { name: 'Browser session guide' }).click();
  await expect(page.locator('.session-file-viewer')).toContainText('Preview truncated');
  await expect(page.locator('.session-file-viewer')).toContainText('Bounded preview');
  const download = page.waitForEvent('download');
  await page.locator('#download-full-session-file').click();
  expect((await download).suggestedFilename()).toBeTruthy();
});

test('a new-session draft restores its project and text after reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait');
  await page.goto('/');
  await page.locator('#open-new-session-button').click();
  await page.locator('#new-session-form').evaluate((form) => form.requestSubmit());
  await page.locator('#prompt-input').fill('尚未创建会话的草稿');
  await page.waitForTimeout(350);
  await page.reload();
  await expect(page.locator('#prompt-input')).toHaveValue('尚未创建会话的草稿');
  await expect(page.locator('#timeline')).toHaveCount(0);
});


test('reused settings controls restore authoritative values after a rejected save and reopening', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await exposeWorkspace(page);
  await page.route('**/api/sessions/session_browser_fixture/settings', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Settings save rejected' }) });
  });
  await page.goto('/');
  await page.locator('button[data-session-id="session_browser_fixture"]').click();
  await page.evaluate(() => {
    globalThis.__mountedComposer = document.querySelector('#prompt-input');
    globalThis.__mountedTimeline = document.querySelector('#timeline');
  });
  await page.locator('#settings-toggle').click();
  expect(await page.evaluate(() => document.querySelector('#prompt-input') === globalThis.__mountedComposer && document.querySelector('#timeline') === globalThis.__mountedTimeline)).toBe(true);
  const select = page.locator('#reasoning-select');
  await expect(select).toHaveValue('ultra');
  await select.selectOption('high');
  await expect(page.locator('.composer-error')).toContainText('Settings save rejected');
  await page.evaluate(() => {
    const { state, render } = globalThis.__workspaceTest;
    state.reasoningEffort = 'ultra';
    render();
  });
  await expect(select).toHaveValue('ultra');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { globalThis.__workspaceTest.state.reasoningEffort = 'high'; });
  await page.locator('#settings-toggle').click();
  await expect(select).toHaveValue('high');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.querySelector('#prompt-input') === globalThis.__mountedComposer && document.querySelector('#timeline') === globalThis.__mountedTimeline)).toBe(true);
});

test('composer chrome insertions keep the mounted textarea, draft and selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await exposeWorkspace(page);
  await openHistory(page);
  await page.locator('#prompt-input').fill('Keep my draft and caret');
  await page.evaluate(() => {
    globalThis.__promptNode = document.querySelector('#prompt-input');
    globalThis.__timelineNode = document.querySelector('#timeline');
    globalThis.__promptNode.setSelectionRange(5, 13);
  });
  for (let index = 0; index < 2; index += 1) {
    await page.locator('#settings-toggle').click();
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => {
    const { state, render } = globalThis.__workspaceTest;
    state.error = 'Keep this draft while retrying';
    state.composerAttachments = [{ id: 'chrome-upload', status: 'ready', fileName: 'kept.png', uploaded: { localPath: '/uploads/kept.png', fileName: 'kept.png' } }];
    render();
  });
  await expect(page.locator('.attachment-name')).toHaveText('kept.png');
  expect(await page.evaluate(() => ({
    inputSame: document.querySelector('#prompt-input') === globalThis.__promptNode,
    timelineSame: document.querySelector('#timeline') === globalThis.__timelineNode,
    value: globalThis.__promptNode.value,
    selection: [globalThis.__promptNode.selectionStart, globalThis.__promptNode.selectionEnd],
  }))).toEqual({ inputSame: true, timelineSame: true, value: 'Keep my draft and caret', selection: [5, 13] });
});

test('native titles stay literal, bounded and consistent through session switches and reload', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(testInfo.project.name));
  const sessionId = 'session_browser_fixture';
  let title = 'Send <b>Native & title</b> ' + 'Long session name '.repeat(18);
  await page.addInitScript(() => localStorage.setItem('codexWebLanguage', 'zh-CN'));
  await page.route(/\/api\/sessions(?:\?|\/session_browser_fixture(?:\/(?:status|timeline))?(?:\?|$)|$)/, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const rename = (session) => session?.id === sessionId ? { ...session, title } : session;
    if (Array.isArray(payload.items)) payload.items = payload.items.map(rename);
    if (payload.session) payload.session = rename(payload.session);
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/');
  const card = page.locator(`button[data-session-id="${sessionId}"] .session-title`);
  await expect(card).toHaveText(title.trim());
  await expect(card.locator('b')).toHaveCount(0);
  await page.locator(`button[data-session-id="${sessionId}"]`).click();
  const heading = page.locator('.chat-title-stack .project-title');
  await expect(heading).toHaveText(title.trim());
  await expect(heading).toHaveAttribute('title', title.trim());
  await expect(heading.locator('b')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (testInfo.project.name === 'mobile-portrait') await page.locator('#back-to-list-button').click();
  await page.locator('button[data-session-id="session_browser_idle"]').click();
  if (testInfo.project.name === 'mobile-portrait') await page.locator('#back-to-list-button').click();
  await page.locator(`button[data-session-id="${sessionId}"]`).click();
  await expect(heading).toHaveText(title.trim());
  title = 'Send';
  await page.reload();
  await expect(heading).toHaveText('Send');
  if (testInfo.project.name === 'mobile-portrait') await page.locator('#back-to-list-button').click();
  await expect(card).toHaveText('Send');
});
