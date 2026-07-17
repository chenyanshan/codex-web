import { expect, test } from '@playwright/test';

async function readCacheEntries(page) {
  return page.evaluate(async () => {
    const entries = [];
    for (const cacheName of await window.caches.keys()) {
      const cache = await window.caches.open(cacheName);
      for (const request of await cache.keys()) {
        entries.push(request.url);
      }
    }
    return entries.sort();
  });
}

async function sampleBrowserMemory(page, context) {
  await page.waitForTimeout(250);
  await page.requestGC();
  const cdp = await context.newCDPSession(page);
  try {
    const [heap, dom] = await Promise.all([
      cdp.send('Runtime.getHeapUsage'),
      cdp.send('Memory.getDOMCounters'),
    ]);
    return { heap, dom };
  } finally {
    await cdp.detach();
  }
}

async function expectTouchTarget(locator, minimum = 44) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(minimum);
  expect(box.height).toBeGreaterThanOrEqual(minimum);
}

test.beforeEach(async ({ page }, testInfo) => {
  const browserToken = `browser-fixture-token-${testInfo.project.name}-${testInfo.workerIndex}`;
  await page.addInitScript((token) => {
    window.localStorage.setItem('codexWebToken', token);
    window.localStorage.setItem(
      'codexWebLanguage',
      window.localStorage.getItem('codexWebTestLanguage') || 'en',
    );
  }, browserToken);
});

test('workspace is usable without overflow and exposes work and status semantics', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);

  const app = page.locator('#app');
  await expect(app).toBeVisible();
  await expect.poll(async () => (await app.innerText()).trim().length).toBeGreaterThan(80);

  if (testInfo.project.name === 'desktop-portrait') {
    await expect(page.locator('.desktop-workspace')).toHaveCount(0);
    await expect(page.locator('.mobile-session-topbar')).toBeVisible();
  }
  if (testInfo.project.name === 'desktop') {
    const chatPane = page.locator('.desktop-chat-pane');
    await expect(chatPane).toBeVisible();
    const chatPaneBox = await chatPane.boundingBox();
    expect(chatPaneBox).not.toBeNull();
    expect(chatPaneBox.width).toBeGreaterThanOrEqual(640);
  }

  const newSessionButton = page.locator('#open-new-session-button');
  await expect(newSessionButton).toBeVisible();

  const sessionButton = page.locator('[data-session-id="session_browser_fixture"]');
  await expect(sessionButton).toBeVisible();
  await expect(sessionButton).toContainText('yanshan_quant');
  await expect(sessionButton).toContainText('Active');
  for (const selector of ['.session-title', '.session-card-meta']) {
    await expect(sessionButton.locator(selector)).toHaveCSS('font-weight', '400');
  }
  await expect(page.locator('[data-session-id="session_browser_history"] .session-preview'))
    .toHaveCSS('font-weight', '400');
  if (testInfo.project.name.startsWith('mobile-')) {
    for (const locator of [
      page.locator('#mobile-sidebar-toggle-button'),
      page.locator('#open-new-session-button'),
      page.locator('[data-sort-mode="time"]'),
      page.locator('[data-session-favorite-id="session_browser_fixture"]'),
    ]) {
      await expectTouchTarget(locator);
    }
    const filterButtons = page.locator('.mobile-session-sort-toggle [data-sort-mode]');
    await expect(filterButtons).toHaveCount(3);
    await expect(page.locator('[data-sort-mode="archived"]')).toHaveAttribute('aria-label', 'Archived sessions');
    await expect(page.locator('[data-sort-mode="archived"] .archive-sort-icon')).toBeVisible();
    const filterBoxes = await filterButtons.evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        mode: button.getAttribute('data-sort-mode'),
        width: box.width,
        height: box.height,
        scrollWidth: button.scrollWidth,
        clientWidth: button.clientWidth,
      };
    }));
    const favoritesBox = filterBoxes.find((box) => box.mode === 'favorites');
    const recentsBox = filterBoxes.find((box) => box.mode === 'time');
    const archivedBox = filterBoxes.find((box) => box.mode === 'archived');
    expect(Math.abs(favoritesBox.width - recentsBox.width)).toBeLessThanOrEqual(1);
    expect(archivedBox.width).toBeLessThan(favoritesBox.width);
    expect(archivedBox.width).toBeGreaterThanOrEqual(44);
    expect(filterBoxes.every((box) => box.height >= 44)).toBe(true);
    expect(filterBoxes.every((box) => box.scrollWidth <= box.clientWidth + 1)).toBe(true);
    const topbarGeometry = await page.evaluate(() => {
      const menu = document.querySelector('#mobile-sidebar-toggle-button')?.getBoundingClientRect();
      const filters = document.querySelector('.mobile-session-sort-toggle')?.getBoundingClientRect();
      const create = document.querySelector('#open-new-session-button')?.getBoundingClientRect();
      return menu && filters && create
        ? { menuRight: menu.right, filtersLeft: filters.left, filtersRight: filters.right, createLeft: create.left }
        : null;
    });
    expect(topbarGeometry).not.toBeNull();
    expect(topbarGeometry.filtersLeft).toBeGreaterThanOrEqual(topbarGeometry.menuRight);
    expect(topbarGeometry.filtersRight).toBeLessThanOrEqual(topbarGeometry.createLeft);
  }

  const sessionListLayout = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(Math.max(sessionListLayout.bodyScrollWidth, sessionListLayout.documentScrollWidth))
    .toBeLessThanOrEqual(sessionListLayout.viewportWidth + 1);
  await page.screenshot({
    path: `/tmp/codex-web-browser-${testInfo.project.name}-sessions.png`,
    fullPage: true,
  });
  await sessionButton.click();

  const liveStatus = page.locator('.composer-status[role="status"][aria-live="polite"][aria-atomic="true"]');
  await expect(liveStatus).toBeVisible();
  await expect(liveStatus.locator('.composer-status-action > span').first()).toHaveText('Working · Needs approval');
  await expect(page.locator('[data-timeline-id="assistant_turn_browser_active_commentary_browser_before"]'))
    .toContainText('Checking the event stream and replay state.');
  await expect(page.locator('[data-timeline-id="assistant_turn_browser_active_commentary_browser_after"]'))
    .toContainText('Command output is complete; reviewing the file update.');
  await expect(page.locator('#timeline .inline-work-row')).toHaveCount(0);
  await expect(page.locator('#timeline .work-turn')).toHaveCount(0);
  await expect(page.locator('#timeline')).not.toContainText('Tests are still running');
  await expect(page.locator('#timeline')).not.toContainText('packages/codex-web/public/styles.css');
  const projectedTurnOrder = await page.locator('#timeline [data-timeline-id]').evaluateAll((items) => items
    .map((item) => item.getAttribute('data-timeline-id'))
    .filter((id) => id?.includes('turn_browser_active')));
  expect(projectedTurnOrder).toEqual([
    'assistant_turn_browser_active_commentary_browser_before',
    'assistant_turn_browser_active_commentary_browser_after',
  ]);
  const openWorkDetailsButton = page.locator('#open-work-details-button');
  await expect(openWorkDetailsButton).toBeVisible();
  await openWorkDetailsButton.click();
  const workDialog = page.locator('.work-details-dialog');
  await expect(workDialog).toBeVisible();
  const workTurn = workDialog.locator('.work-turn');
  await expect(workTurn).toHaveCount(1);
  await expect(workTurn).toContainText('Ran 1');
  await expect(workTurn).toContainText('Edited 2');
  await expect(workTurn).not.toContainText('[object Object]');
  const commandDetail = workTurn.locator('.work-detail[data-work-kind="command"]');
  await commandDetail.locator('summary').click();
  await expect(commandDetail).toContainText('Tests are still running');
  await expect(commandDetail).toContainText('No failures yet');
  const editDetail = workTurn.locator('.work-detail[data-work-kind="edit"]');
  await expect(editDetail).toContainText('packages/codex-web/public/styles.css');
  const workRowGeometry = await workTurn.locator('.work-detail > summary').evaluateAll((summaries) => summaries.map((summary) => {
    const parent = summary.getBoundingClientRect();
    const children = [...summary.children].map((child) => child.getBoundingClientRect());
    return {
      childrenInside: children.every((child) => child.left >= parent.left - 1
        && child.right <= parent.right + 1
        && child.top >= parent.top - 1
        && child.bottom <= parent.bottom + 1),
      overlaps: children.some((left, index) => children.slice(index + 1).some((right) => (
        left.left < right.right - 1
        && left.right > right.left + 1
        && left.top < right.bottom - 1
        && left.bottom > right.top + 1
      ))),
    };
  }));
  expect(workRowGeometry.every((row) => row.childrenInside && !row.overlaps)).toBe(true);
  await expectTouchTarget(page.locator('#close-work-details-button'));
  await page.screenshot({
    path: `/tmp/codex-web-work-dialog-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.locator('#close-work-details-button').click();
  await expect(workDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop current turn' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Session menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  const promptInput = page.locator('#prompt-input');
  await expect(promptInput).toHaveCSS('font-weight', '400');
  await expect(page.locator('.message-card .message-text, .message-card .markdown-body').first())
    .toHaveCSS('font-weight', '400');
  if (testInfo.project.name.startsWith('mobile-')) {
    await expect(page.locator('.project-title')).toHaveCSS('font-weight', '650');
  }
  if (testInfo.project.name.startsWith('desktop')) {
    const promptBox = await promptInput.boundingBox();
    expect(promptBox).not.toBeNull();
    expect(promptBox.height).toBeGreaterThanOrEqual(96);
  }
  if (testInfo.project.name === 'desktop') {
    await expect(sessionButton).toContainText('Needs approval');
  }
  if (testInfo.project.name.startsWith('mobile-')) {
    for (const locator of [
      page.getByRole('button', { name: 'Sessions' }),
      page.getByRole('button', { name: 'Session menu' }),
      page.getByRole('button', { name: 'Attach files' }),
      page.getByRole('button', { name: 'Send' }),
    ]) {
      await expectTouchTarget(locator);
    }
  }

  const layout = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(Math.max(layout.bodyScrollWidth, layout.documentScrollWidth)).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(pageErrors).toEqual([]);

  await page.screenshot({
    path: `/tmp/codex-web-browser-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Session menu' }).click();
  const menuCloseButton = page.getByRole('button', { name: 'Close session menu' });
  const stopButton = page.getByRole('button', { name: 'Stop current turn' });
  await expect(menuCloseButton).toBeVisible();
  await expect(stopButton).toBeVisible();
  await expect(menuCloseButton).toBeFocused();
  await expect(page.locator('#model-select')).toHaveValue('gpt-5.6-sol');
  await expect(page.locator('#reasoning-select')).toHaveValue('ultra');
  await expect(page.locator('.settings-stop-row')).toHaveAttribute('data-session-state', 'running');
  await expect(page.locator('.settings-drawer .settings-card')).toHaveCount(4);
  await expect(page.locator('.settings-options-card').first()).toContainText('Model');
  await expect(page.locator('.settings-behavior-card')).toContainText('Permissions');
  await expect(page.locator('[data-session-reports-project], #open-reports-button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reports', exact: true })).toHaveCount(0);
  const settingsGeometry = await page.locator('.settings-drawer').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(settingsGeometry.scrollWidth).toBeLessThanOrEqual(settingsGeometry.clientWidth + 1);
  expect(settingsGeometry.scrollHeight).toBeGreaterThanOrEqual(settingsGeometry.clientHeight);
  if (testInfo.project.name.startsWith('mobile-')) {
    await expectTouchTarget(menuCloseButton);
    await expectTouchTarget(stopButton);
    await expectTouchTarget(page.getByRole('button', { name: 'Archive', exact: true }));
  }
  await page.screenshot({
    path: `/tmp/codex-web-session-menu-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await menuCloseButton.click();
  await expect(page.locator('.settings-drawer')).toHaveCount(0);
});

test('reasoning summaries use plain message borders without timeline ornaments', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait', 'One viewport covers shared message-card styling.');

  await page.goto('/');
  await page.locator('[data-session-id="session_browser_fixture"]').click();
  const styles = await page.evaluate(() => {
    const timeline = document.querySelector('#timeline');
    const card = document.createElement('article');
    card.className = 'card message-card assistant reasoning-summary';
    timeline?.appendChild(card);
    const result = {
      borderStyle: getComputedStyle(card).borderTopStyle,
      cardBefore: getComputedStyle(card, '::before').content,
      cardAfter: getComputedStyle(card, '::after').content,
      timelineBefore: timeline ? getComputedStyle(timeline, '::before').content : '',
      timelineAfter: timeline ? getComputedStyle(timeline, '::after').content : '',
    };
    card.remove();
    return result;
  });

  expect(styles.borderStyle).toBe('solid');
  for (const content of [styles.cardBefore, styles.cardAfter, styles.timelineBefore, styles.timelineAfter]) {
    expect(['none', 'normal']).toContain(content);
  }
});

test('lost new-session responses recover from the durable outbox after reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait', 'One phone viewport covers weak-network recovery.');

  let acceptedSubmissionId = '';
  const submissionIds = [];
  await page.route('**/api/session-submissions', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    submissionIds.push(body.submissionId);
    if (!acceptedSubmissionId) {
      acceptedSubmissionId = body.submissionId;
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        submission: {
          id: acceptedSubmissionId,
          status: 'submitted',
          sessionId: 'session_browser_recovered',
          turnId: 'turn_browser_recovered',
          error: null,
        },
        session: {
          id: 'session_browser_recovered',
          cwd: '/Users/test/yanshan_quant',
          projectName: 'yanshan_quant',
          firstUserInput: 'Recover this weak-network session',
          lastUserInput: 'Recover this weak-network session',
          updatedAt: Date.now(),
          lastInputAt: Date.now(),
          settings: {},
          thread: { id: 'session_browser_recovered', turns: [] },
        },
        turnId: 'turn_browser_recovered',
      }),
    });
  });

  await page.goto('/');
  await page.locator('#open-new-session-button').click();
  await page.locator('#new-cwd-input').fill('/Users/test/yanshan_quant');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('#prompt-input').fill('Recover this weak-network session');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.locator('#timeline [data-submission-retry-id]')).toBeVisible();
  await expect(page.locator('#timeline [data-submission-retry-id]')).toHaveAccessibleName('Send failed. Retry send');
  const storedBeforeReload = await page.evaluate(() => {
    const prefix = 'codexWebSubmissionOutbox:';
    return Array.from({ length: window.localStorage.length }, (_item, index) => (
      window.localStorage.key(index)
    ))
      .filter((key) => key?.startsWith(prefix))
      .map((key) => JSON.parse(window.localStorage.getItem(key)).entry);
  });
  expect(storedBeforeReload).toHaveLength(1);
  expect(storedBeforeReload[0].id).toBe(acceptedSubmissionId);
  expect(storedBeforeReload[0].text).toBe('Recover this weak-network session');

  await page.reload();

  await expect.poll(async () => page.evaluate(() => {
    const prefix = 'codexWebSubmissionOutbox:';
    return Array.from({ length: window.localStorage.length }, (_item, index) => (
      window.localStorage.key(index)
    )).filter((key) => key?.startsWith(prefix)).length;
  })).toBe(0);
  await expect(page.locator('[data-session-id="session_browser_recovered"]')).toHaveCount(1);
  expect(submissionIds).toEqual([acceptedSubmissionId, acceptedSubmissionId]);
});

test('mobile session opens a relative Markdown file and returns to the same timeline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait', 'One phone viewport covers the full-screen Markdown viewer.');

  await page.goto('/');
  await page.locator('[data-session-id="session_browser_files"]').click();

  const timeline = page.locator('#timeline');
  const fileLink = page.getByRole('link', { name: 'Browser session guide' });
  await expect(fileLink).toBeVisible();
  const timelineScrollTop = await timeline.evaluate((element) => {
    element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - 24);
    return element.scrollTop;
  });

  await fileLink.click();

  const viewer = page.locator('.session-file-screen .session-file-viewer');
  await expect(viewer).toBeVisible();
  await expect(page.locator('.desktop-session-file-overlay')).toHaveCount(0);
  await expect(page.locator('.session-file-topbar .page-title')).toHaveText('browser-session-guide.md');
  await expect(viewer.locator('.session-file-document')).toContainText('Browser Session Guide');
  await expect(viewer.locator('.session-file-document')).toContainText('resolved from the current project');
  const viewerGeometry = await page.locator('.session-file-screen').evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }));
  expect(viewerGeometry.width).toBeGreaterThanOrEqual(viewerGeometry.viewportWidth - 1);
  expect(viewerGeometry.height).toBeGreaterThanOrEqual(viewerGeometry.viewportHeight - 1);
  await page.screenshot({
    path: '/tmp/codex-web-browser-mobile-markdown-viewer.png',
    fullPage: true,
  });

  await page.locator('#close-session-file-button').click();

  await expect(timeline).toBeVisible();
  await expect(fileLink).toBeVisible();
  await expect(timeline).toContainText('This image was uploaded in an earlier turn.');
  await expect.poll(async () => timeline.evaluate((element) => element.scrollTop)).toBe(timelineScrollTop);
});

test('historical image attachment opens in the session viewer and returns to its message', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-compact', 'The compact phone viewport covers retained attachment viewing.');

  await page.goto('/');
  await page.locator('[data-session-id="session_browser_files"]').click();

  const attachment = page.locator('.message-attachment', { hasText: 'history-image.png' });
  await expect(attachment).toBeVisible();
  await expect(attachment).toHaveAttribute('data-session-file-path', '/state/turn-attachments/browser/history-image.png');
  await attachment.click();

  await expect(page.locator('.session-file-topbar .page-title')).toHaveText('history-image.png');
  const image = page.locator('.session-file-image');
  await expect(image).toBeVisible();
  await expect.poll(async () => image.evaluate((element) => ({
    complete: element.complete,
    naturalWidth: element.naturalWidth,
    naturalHeight: element.naturalHeight,
  }))).toEqual({ complete: true, naturalWidth: 192, naturalHeight: 192 });
  await page.screenshot({
    path: '/tmp/codex-web-browser-mobile-image-viewer.png',
    fullPage: true,
  });

  await page.locator('#close-session-file-button').click();

  await expect(page.locator('#timeline')).toContainText('This image was uploaded in an earlier turn.');
  await expect(attachment).toBeVisible();
});

test('sandboxed HTML preview blocks scripts, remote assets, and refresh navigation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One desktop browser covers HTML sandbox enforcement.');

  const previewRequests = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/html-probe') || pathname === '/html-refresh-target') {
      previewRequests.push(pathname);
    }
  });

  await page.goto('/');
  await page.locator('[data-session-id="session_browser_files"]').click();
  const htmlLink = page.getByRole('link', { name: 'sandboxed HTML preview' });
  await htmlLink.click();

  const iframe = page.locator('.session-file-html');
  await expect(iframe).toBeVisible();
  await expect(page.locator('#close-session-file-button')).toBeFocused();
  await expect(iframe).toHaveAttribute('sandbox', '');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  const preview = page.frameLocator('.session-file-html');
  await expect(preview.locator('h1')).toHaveText('Sandboxed HTML');
  await expect(preview.locator('html')).not.toHaveAttribute('data-script-ran', 'true');
  await page.waitForTimeout(250);
  await page.screenshot({
    path: '/tmp/codex-web-browser-desktop-html-viewer.png',
    fullPage: true,
  });

  expect(previewRequests).toEqual([]);
  const previewFrame = page.frames().find((frame) => frame.parentFrame() === page.mainFrame());
  expect(previewFrame?.url() || '').not.toContain('/html-refresh-target');
  await page.keyboard.press('Escape');
  await expect(page.locator('.desktop-session-file-overlay')).toHaveCount(0);
  await expect(htmlLink).toBeFocused();
});

test('archived sessions use a compact filter and a clear restore icon', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-compact', 'The compact mobile viewport covers archive controls.');

  await page.goto('/');
  await page.getByRole('button', { name: 'Archived sessions' }).click();

  await expect(page.locator('[data-session-id="session_browser_archived"]')).toBeVisible();
  const restoreButton = page.getByRole('button', { name: 'Unarchive' });
  await expect(restoreButton).toBeVisible();
  await expect(restoreButton.locator('.session-action-icon-stroke')).toBeVisible();
  await expect(restoreButton).toHaveText('');
  await page.screenshot({
    path: '/tmp/codex-web-browser-mobile-compact-archived.png',
    fullPage: true,
  });
});

test('opening an archived session never restores it to recents', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait', 'One phone viewport covers archive scope isolation.');

  await page.goto('/');
  await page.getByRole('button', { name: 'Archived sessions' }).click();
  await page.locator('[data-session-id="session_browser_archived"]').click();
  await expect(page.locator('.read-only-composer-wrap')).toBeVisible();

  await page.getByRole('button', { name: 'Sessions' }).click();
  await page.locator('[data-sort-mode="time"]').click();

  await expect(page.locator('[data-session-id="session_browser_archived"]')).toHaveCount(0);
  await expect(page.locator('[data-session-id="session_browser_idle"]')).toBeVisible();
});

test('large work details use one stable vertical scroll surface', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One narrow desktop viewport covers the long-work geometry regression.');
  await page.setViewportSize({ width: 1060, height: 503 });

  await page.goto('/');
  await page.locator('[data-session-id="session_browser_fixture"]').click();
  await page.locator('#open-work-details-button').click();
  const workDialog = page.locator('.work-details-dialog');
  const workTurn = workDialog.locator('.work-turn');
  await expect(workTurn).toBeVisible();

  await workTurn.evaluate((turn) => {
    const events = turn.querySelector(':scope > .work-events');
    const detail = events?.querySelector(':scope > .work-detail');
    if (!events || !detail) {
      throw new Error('work detail fixture is unavailable');
    }
    for (let index = events.children.length; index < 120; index += 1) {
      events.append(detail.cloneNode(true));
    }
  });

  const geometry = await workDialog.evaluate((dialog) => {
    const list = dialog.querySelector('.work-details-list');
    const events = dialog.querySelector('.work-events');
    const outputs = [...dialog.querySelectorAll('.work-output')];
    const verticalScrollOwners = [list, events, ...outputs].filter((element) => {
      if (!element) {
        return false;
      }
      const overflowY = getComputedStyle(element).overflowY;
      return element.scrollHeight > element.clientHeight + 1 && ['auto', 'scroll'].includes(overflowY);
    });
    return {
      dialogHeight: dialog.getBoundingClientRect().height,
      listClientHeight: list?.clientHeight || 0,
      listScrollHeight: list?.scrollHeight || 0,
      listOverflowY: list ? getComputedStyle(list).overflowY : '',
      eventsOverflowY: events ? getComputedStyle(events).overflowY : '',
      verticalScrollOwnerClasses: verticalScrollOwners.map((element) => element?.className || ''),
    };
  });

  expect(geometry.dialogHeight).toBeLessThanOrEqual(503 * 0.78 + 2);
  expect(geometry.listScrollHeight).toBeGreaterThan(geometry.listClientHeight);
  expect(geometry.listOverflowY).toBe('auto');
  expect(geometry.eventsOverflowY).toBe('visible');
  expect(geometry.verticalScrollOwnerClasses).toEqual(['work-details-list']);
});

test('expanded work details pause live following until new activity is requested', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One desktop viewport covers live Work state preservation.');

  await page.goto('/');
  await page.locator('[data-session-id="session_browser_fixture"]').click();
  await page.locator('#open-work-details-button').click();

  const list = page.locator('.work-details-list');
  const commandDetail = page.locator('.work-detail[data-work-kind="command"]');
  const commandSummary = commandDetail.locator('summary');
  await commandSummary.click();
  await expect(commandDetail).toHaveAttribute('open', '');
  await expect(commandSummary).toBeFocused();
  const scrollTop = await list.evaluate((element) => element.scrollTop);

  const delivery = await page.evaluate(async () => {
    const token = window.localStorage.getItem('codexWebToken') || '';
    const response = await fetch('/__test/turn-event', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'batch.started',
        turnId: 'turn_browser_active',
        batchId: 'batch_browser_new_activity',
        kind: 'command',
        title: 'git status --short',
      }),
    });
    return response.json();
  });
  expect(delivery.delivered).toBe(1);

  const newActivityButton = page.locator('[data-work-show-latest]');
  await expect(newActivityButton).toHaveText('1 new activity');
  await expect(commandDetail).toHaveAttribute('open', '');
  await expect(commandSummary).toBeFocused();
  await expect(page.locator('.work-details-dialog')).not.toContainText('git status --short');
  expect(await list.evaluate((element) => element.scrollTop)).toBe(scrollTop);

  await newActivityButton.click();
  await expect(newActivityButton).toHaveCount(0);
  await expect(page.locator('.work-details-dialog')).toContainText('git status --short');
  await expect(commandDetail).toHaveAttribute('open', '');
});

test('Chinese work details render symbols and activity labels without escaped entities', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-compact', 'The compact phone viewport covers Chinese Work glyph rendering.');

  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.setItem('codexWebTestLanguage', 'zh-CN');
    window.localStorage.setItem('codexWebLanguage', 'zh-CN');
  });
  await page.reload();
  await page.locator('[data-session-id="session_browser_fixture"]').click();
  const openWorkDetailsButton = page.locator('#open-work-details-button');
  await expect(openWorkDetailsButton.locator('.composer-status-disclosure')).toHaveText('›');
  await openWorkDetailsButton.click();

  const dialog = page.locator('.work-details-dialog');
  await expect(dialog).toContainText('本轮活动');
  await expect(dialog).toContainText('执行 1 · 修改 2 个文件');
  await expect(dialog).toContainText('packages/codex-web/public/styles.css +1');
  await expect(page.locator('#close-work-details-button')).toHaveText('×');
  await expect(dialog).not.toContainText(/&(?:times|middot|#\d+);/u);
  await page.screenshot({
    path: '/tmp/codex-web-work-dialog-zh-mobile-compact.png',
    fullPage: true,
  });
});

test('desktop prompt accepts pasted files as uploaded attachments', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop and portrait desktop cover paste uploads.');

  await page.goto('/');
  await page.locator('[data-session-id="session_browser_idle"]').click();
  await expect(page.locator('#prompt-input')).toBeVisible();

  const defaultPrevented = await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['paste-image'], 'pasted-image.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    document.querySelector('#prompt-input').dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(defaultPrevented).toBe(true);
  const attachment = page.locator('.attachment-chip');
  await expect(attachment).toContainText('pasted-image.png');
  await expect(attachment.locator('.attachment-status')).toHaveText('Saved');
  await page.screenshot({
    path: `/tmp/codex-web-browser-${testInfo.project.name}-pasted-attachment.png`,
    fullPage: true,
  });
});

test('desktop wheel at the top reveals earlier session exchanges', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop and portrait desktop cover wheel history expansion.');

  await page.goto('/');
  await page.locator('[data-session-id="session_browser_history"]').click();

  const timeline = page.locator('#timeline');
  await expect(timeline).toContainText('Latest browser answer');
  await expect(timeline).not.toContainText('Oldest browser answer');
  await timeline.evaluate((element) => {
    element.scrollTop = 0;
  });
  await timeline.hover();
  await page.mouse.wheel(0, -240);

  await expect(timeline).toContainText('Oldest browser answer');
  await page.screenshot({
    path: `/tmp/codex-web-browser-${testInfo.project.name}-expanded-history.png`,
    fullPage: true,
  });
});

test('settings keep appearance and new-session defaults separated without overflow', async ({ page }, testInfo) => {
  test.skip(!['mobile-compact', 'desktop'].includes(testInfo.project.name), 'One mobile and one desktop viewport cover settings.');

  await page.goto('/');
  if (testInfo.project.name === 'mobile-compact') {
    await page.locator('#mobile-sidebar-toggle-button').click();
  }
  await page.locator('#open-app-settings-button').click();

  const settings = testInfo.project.name === 'desktop'
    ? page.locator('.desktop-settings-panel')
    : page.locator('.app-settings-page');
  await expect(settings).toBeVisible();
  await expect(settings.getByText('Appearance', { exact: true })).toBeVisible();
  await expect(settings.getByText('New sessions on this device', { exact: true })).toBeVisible();
  await expect(settings.locator('#default-model-select')).toHaveValue('gpt-5.6-sol');
  await expect(settings.locator('#default-reasoning-select')).toHaveValue('ultra');

  const geometry = await settings.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.scrollHeight).toBeGreaterThanOrEqual(geometry.clientHeight);
  await page.screenshot({
    path: `/tmp/codex-web-browser-${testInfo.project.name}-settings.png`,
    fullPage: true,
  });
});

test('mobile session menu opens archive confirmation for an idle session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-compact', 'The compact mobile viewport covers this menu flow.');

  await page.goto('/');
  await page.locator('[data-session-id="session_browser_idle"]').click();
  await page.getByRole('button', { name: 'Session menu' }).click();

  const archiveButton = page.getByRole('button', { name: 'Archive', exact: true });
  await expect(archiveButton).toBeVisible();
  await expect(archiveButton).toBeEnabled();
  await expectTouchTarget(archiveButton);
  await archiveButton.click();

  const dialog = page.getByRole('dialog', { name: 'Archive session?' });
  await expect(dialog).toBeVisible();
  const cancelButton = dialog.getByRole('button', { name: 'Cancel' });
  const confirmButton = dialog.getByRole('button', { name: 'Archive', exact: true });
  await expect(cancelButton).toBeFocused();
  await expectTouchTarget(cancelButton);
  await expectTouchTarget(confirmButton);
  await cancelButton.click();
  await expect(dialog).toHaveCount(0);
});

test('standalone foreground checks do not grow Cache Storage', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Cache Storage coverage only needs one Chromium project.');
  await page.addInitScript(() => {
    let now = Date.now();
    Date.now = () => now;
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: true,
    });
    window.__advanceCodexTestClock = (milliseconds) => {
      now += milliseconds;
    };
  });

  const versionRequestUrls = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === 'fetch' && url.pathname === '/app.js') {
      versionRequestUrls.push(url.toString());
    }
  });

  await page.goto('/');
  await page.evaluate(() => window.navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.navigator.serviceWorker.controller));
  await page.waitForLoadState('networkidle');
  const before = await readCacheEntries(page);

  for (let index = 0; index < 6; index += 1) {
    const response = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return candidate.request().resourceType() === 'fetch' && url.pathname === '/app.js';
    });
    await page.evaluate(() => {
      window.__advanceCodexTestClock(16_000);
      window.dispatchEvent(new Event('focus'));
    });
    await response;
  }

  await expect.poll(() => readCacheEntries(page)).toEqual(before);
  expect(versionRequestUrls.length).toBeGreaterThanOrEqual(6);
  expect(versionRequestUrls.every((value) => new URL(value).search === '')).toBe(true);
  expect(before.filter((value) => new URL(value).pathname === '/app.js')).toHaveLength(1);
});

test('repeated chat renders release detached DOM and listeners', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Chromium memory coverage only needs one viewport.');
  test.setTimeout(60_000);

  await page.goto('/');
  await page.locator('[data-session-id="session_browser_fixture"]').click();
  await expect(page.getByText('Approval requested', { exact: true })).toBeVisible();
  const settingsButton = page.locator('#settings-toggle');
  await expect(settingsButton).toBeVisible();
  const bounds = await settingsButton.boundingBox();
  expect(bounds).not.toBeNull();
  const point = {
    x: bounds.x + (bounds.width / 2),
    y: bounds.y + (bounds.height / 2),
  };
  const runRenderCycles = async (count) => {
    for (let index = 0; index < count; index += 1) {
      await page.mouse.click(point.x, point.y);
      await page.keyboard.press('Escape');
    }
  };

  await runRenderCycles(10);
  const before = await sampleBrowserMemory(page, context);
  await runRenderCycles(200);
  const after = await sampleBrowserMemory(page, context);

  expect(await settingsButton.getAttribute('aria-expanded')).toBe('false');
  expect(after.dom.documents).toBe(before.dom.documents);
  expect(after.dom.nodes - before.dom.nodes).toBeLessThanOrEqual(64);
  expect(after.dom.jsEventListeners - before.dom.jsEventListeners).toBeLessThanOrEqual(16);
  expect(after.heap.embedderHeapUsedSize - before.heap.embedderHeapUsedSize).toBeLessThanOrEqual(2_000_000);
  expect(after.heap.usedSize - before.heap.usedSize).toBeLessThanOrEqual(512_000);
});
