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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('codexWebToken', 'browser-fixture-token');
    window.localStorage.setItem('codexWebLanguage', 'en');
  });
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

  const workCard = page.locator('.work-card');
  await expect(workCard).toBeVisible();
  await expect(workCard).toContainText('Ran 1');
  await expect(workCard).toContainText('Edited 1');

  const liveStatus = page.locator('.composer-status[role="status"][aria-live="polite"][aria-atomic="true"]');
  await expect(liveStatus).toBeVisible();
  await expect(liveStatus).toHaveText('Running');
  await expect(page.getByRole('button', { name: 'Stop current turn' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Session menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  if (testInfo.project.name.startsWith('desktop')) {
    const promptInput = page.locator('#prompt-input');
    const promptBox = await promptInput.boundingBox();
    expect(promptBox).not.toBeNull();
    expect(promptBox.height).toBeGreaterThanOrEqual(96);
    await expect(promptInput).toHaveCSS('font-weight', '400');
    await expect(page.locator('.message-card .message-text, .message-card .markdown-body').first())
      .toHaveCSS('font-weight', '400');
  }
  if (testInfo.project.name === 'desktop') {
    await expect(sessionButton).toContainText('Needs approval');
  }
  if (testInfo.project.name.startsWith('mobile-')) {
    for (const locator of [
      page.getByRole('button', { name: 'Sessions' }),
      page.getByRole('button', { name: 'Stop current turn' }),
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
  await expect(menuCloseButton).toBeVisible();
  await expect(menuCloseButton).toBeFocused();
  await expect(page.locator('#model-select')).toHaveValue('gpt-5.6-sol');
  await expect(page.locator('#reasoning-select')).toHaveValue('ultra');
  const openReportsButton = page.locator('[data-session-reports-project="yanshan_quant"]');
  await expect(openReportsButton).toBeVisible();
  if (testInfo.project.name.startsWith('mobile-')) {
    await expectTouchTarget(menuCloseButton);
    await expectTouchTarget(openReportsButton);
    await expectTouchTarget(page.getByRole('button', { name: 'Archive', exact: true }));
  }
  await openReportsButton.click();
  await expect(page.locator('.settings-drawer')).toHaveCount(0);
  if (testInfo.project.name === 'desktop') {
    const reportsOverlay = page.locator('.desktop-overlay');
    await expect(reportsOverlay).toBeVisible();
    await expect(reportsOverlay).not.toHaveAttribute('aria-hidden', 'true');
  } else {
    await expect(page.locator('.page-title')).toHaveText('Reports');
  }
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
