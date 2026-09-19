import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
const file = { name: 'reading-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Session A notes') };
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function open(page, session = 'session_browser_idle') { await page.locator(`button[data-session-id="${session}"]`).click(); await expect(page.locator('#prompt-input')).toBeVisible(); }
async function leave(page, info) { if (info.project.name === 'mobile-portrait') await page.locator('#back-to-list-button').click(); }
async function complete(route, failure = false) {
  await route.fulfill({ status: failure ? 503 : 201, json: failure ? { message: 'Synthetic upload failure' } : { items: [{ id: 'uploaded_note', fileName: file.name, localPath: '/state/reading-notes.txt', storage: 'state', kind: 'file', sizeBytes: 15, mimeType: file.mimeType }] } }).catch(() => {});
}
test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'browser-fixture-token'); localStorage.setItem('codexWebLanguage', 'en');
    // Keep the real XHR transport; expose it to dispatch a deterministic progress event.
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) { if (body instanceof FormData) globalThis.__testUpload = this; return send.call(this, body); };
  });
  await page.goto('/'); await open(page);
});

for (const failure of [false, true]) test(`a delayed upload ${failure ? 'failure' : 'success'} stays with its original session draft`, async ({ page }, info) => {
  const pending = gate(); let requests = 0;
  await page.route('**/api/sessions/session_browser_idle/attachments', async route => { requests++; await pending.promise; await complete(route, failure); });
  await page.locator('#prompt-input').fill('Keep A draft');
  await page.locator('#attachment-input').setInputFiles(file);
  await expect.poll(() => requests).toBe(1);
  await leave(page, info); await open(page, 'session_browser_history');
  pending.resolve();
  await expect(page.locator('.attachment-chip')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Synthetic upload failure');
  await leave(page, info); await open(page);
  await expect(page.locator('#prompt-input')).toHaveValue('Keep A draft');
  await expect(page.locator('.attachment-chip')).toContainText(file.name);
  await expect(page.locator('.attachment-status')).toHaveText(failure ? 'Failed' : 'Saved');
  if (failure) await expect(page.locator('[data-attachment-retry-id]')).toBeVisible();
});

test('uploads show byte progress, allow cancellation, and retry a single failed file', async ({ page }) => {
  const pending = gate(); let requests = 0;
  await page.route('**/api/sessions/session_browser_idle/attachments', async route => {
    requests++;
    if (requests === 1) await pending.promise;
    await complete(route, requests === 2);
  });
  await page.locator('#attachment-input').setInputFiles(file);
  await expect.poll(() => requests).toBe(1);
  await page.evaluate(() => globalThis.__testUpload.upload.dispatchEvent(new ProgressEvent('progress', { loaded: 42, total: 100, lengthComputable: true })));
  await expect(page.locator('.attachment-status')).toHaveText('Uploading 42%');
  await page.locator('[data-attachment-remove-id]').click(); pending.resolve();
  await expect(page.locator('.attachment-chip')).toHaveCount(0);
  await page.locator('#attachment-input').setInputFiles(file);
  await expect(page.locator('[data-attachment-retry-id]')).toBeVisible();
  await page.locator('[data-attachment-retry-id]').click();
  await expect(page.locator('.attachment-status')).toHaveText('Saved');
  expect(requests).toBe(3);
});

test('logging out aborts pending uploads without restoring a private draft', async ({ page }, info) => {
  const pending = gate(); let requests = 0;
  await page.route('**/api/sessions/session_browser_idle/attachments', async route => { requests++; await pending.promise; await complete(route); });
  await page.locator('#attachment-input').setInputFiles(file);
  await expect.poll(() => requests).toBe(1);
  await leave(page, info);
  if (info.project.name === 'mobile-portrait') await page.locator('#mobile-sidebar-toggle-button').click();
  await page.locator('#open-app-settings-button').click();
  await page.locator('#settings-logout-button').click(); pending.resolve();
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('.attachment-chip')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('codexWebPromptDrafts:')))).toEqual([]);
});

test('progress on the next queued file does not reset a completed attachment label', async ({ page }) => {
  const pending = gate(); let requests = 0;
  await page.route('**/api/sessions/session_browser_idle/attachments', async route => { requests++; if (requests === 2) await pending.promise; await complete(route); });
  await page.locator('#attachment-input').setInputFiles([file, { ...file, name: 'second-note.txt' }]);
  await expect.poll(() => requests).toBe(2);
  await page.evaluate(() => globalThis.__testUpload.upload.dispatchEvent(new ProgressEvent('progress', { loaded: 51, total: 100, lengthComputable: true })));
  await expect(page.locator('.attachment-status').nth(0)).toHaveText('Saved');
  await expect(page.locator('.attachment-status').nth(1)).toHaveText('Uploading 51%');
  pending.resolve();
  await expect(page.locator('.attachment-status').nth(1)).toHaveText('Saved');
});

test('too many selected files produce an explicit error before any upload', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/sessions/session_browser_idle/attachments', async route => { requests++; await complete(route); });
  await page.locator('#attachment-input').setInputFiles(Array.from({ length: 21 }, (_, index) => ({ ...file, name: `notes-${index}.txt` })));
  await expect(page.locator('body')).toContainText('You can attach up to 20 files.');
  expect(requests).toBe(0);
});
