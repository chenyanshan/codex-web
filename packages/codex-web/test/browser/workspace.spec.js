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

  const newSessionButton = page.locator('#open-new-session-button');
  await expect(newSessionButton).toBeVisible();

  const sessionButton = page.locator('[data-session-id="session_browser_fixture"]');
  await expect(sessionButton).toBeVisible();
  await expect(sessionButton).toContainText('yanshan_quant');
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
