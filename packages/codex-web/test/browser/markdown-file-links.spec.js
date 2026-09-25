import { test, expect } from '@playwright/test';
import path from 'node:path';

const sessionId = 'session_browser_files';
const projectRoot = '/Users/test/yanshan_quant/';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait', 'mobile-compact'].includes(info.project.name));
  await page.addInitScript(() => localStorage.setItem('codexWebToken', 'markdown-link-fixture'));
});

async function installFiles(page, { failCsvOnce = false } = {}) {
  const files = new Map([
    ['docs/browser-session-guide.md', { id: 'sf_guide', kind: 'markdown', mimeType: 'text/markdown', data: '# Guide\n\n[Nested guide](notes/nested.md)\n\n[Spreadsheet](downloads/monthly%20report%2525.csv)\n\n[Absolute image](/Users/test/yanshan_quant/docs/assets/preview.png)' }],
    ['docs/notes/nested.md', { id: 'sf_nested', kind: 'markdown', mimeType: 'text/markdown', data: '# Nested guide\n\n[Preview image](../assets/preview.png)' }],
    ['docs/assets/preview.png', { id: 'sf_image', kind: 'image', mimeType: 'image/png', data: png }],
    ['docs/downloads/monthly report%25.csv', { id: 'sf_csv', kind: 'file', mimeType: 'text/csv', data: 'name,value\nexample,42\n' }],
  ]);
  const requests = [];
  await page.route(`**/api/sessions/${sessionId}/files/resolve`, async route => {
    const input = route.request().postDataJSON().path;
    const canonical = path.posix.normalize(input);
    const relative = canonical.startsWith(projectRoot) ? canonical.slice(projectRoot.length) : canonical;
    requests.push(relative);
    const file = files.get(relative);
    if (!file) return route.fulfill({ status: 404, json: { error: 'file_not_found' } });
    if (failCsvOnce && file.id === 'sf_csv') {
      failCsvOnce = false;
      return route.fulfill({ status: 503, json: { error: 'file_busy' } });
    }
    const { data, ...metadata } = file;
    await route.fulfill({ json: { file: { ...metadata, name: path.posix.basename(relative), source: 'project', sizeBytes: Buffer.byteLength(data), contentUrl: `/api/sessions/${sessionId}/files/${file.id}/content` } } });
  });
  await page.route(`**/api/sessions/${sessionId}/files/*/content?*`, async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2);
    const file = [...files.values()].find(item => item.id === id);
    if (!file) return route.fulfill({ status: 404, json: { error: 'file_not_found' } });
    await route.fulfill({ contentType: file.mimeType, body: file.data });
  });
  await page.goto('/');
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  await page.locator('#prompt-input').fill('Preserve the conversation draft');
  await page.getByRole('link', { name: 'Browser session guide', exact: true }).click();
  await expect(page.locator('.session-file-document h1')).toHaveText('Guide');
  return requests;
}

test('links inside nested Markdown resolve beside their document and return to the conversation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = await installFiles(page);
  await page.getByRole('link', { name: 'Nested guide', exact: true }).click();
  await expect(page.locator('.session-file-document h1')).toHaveText('Nested guide');
  await page.getByRole('link', { name: 'Preview image', exact: true }).click();
  await expect(page.locator('.session-file-image')).toBeVisible();
  await expect.poll(() => page.locator('.session-file-image').evaluate(image => image.naturalWidth)).toBe(1);
  expect(requests).toEqual(['docs/browser-session-guide.md', 'docs/notes/nested.md', 'docs/assets/preview.png']);
  await page.locator('#close-session-file-button').click();
  await expect(page.locator('#prompt-input')).toHaveValue('Preserve the conversation draft');
  await page.getByRole('link', { name: 'Browser session guide', exact: true }).click();
  await page.getByRole('link', { name: 'Absolute image', exact: true }).click();
  await expect(page.locator('.session-file-image')).toBeVisible();
  expect(requests.at(-1)).toBe('docs/assets/preview.png');
  expect(errors).toEqual([]);
});

test('retry and download retain the resolved document directory and literal encoded filename', async ({ page }) => {
  const requests = await installFiles(page, { failCsvOnce: true });
  await page.getByRole('link', { name: 'Spreadsheet', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('File preview is busy. Try again.');
  await page.locator('#retry-session-file-button').click();
  await expect(page.locator('.session-file-generic')).toContainText('monthly report%25.csv');
  expect(requests.slice(1)).toEqual(['docs/downloads/monthly report%25.csv', 'docs/downloads/monthly report%25.csv']);
  const download = page.waitForEvent('download');
  await page.locator('#session-file-download').click();
  expect((await download).suggestedFilename()).toBe('monthly report%25.csv');
  await page.locator('#close-session-file-button').click();
  await expect(page.locator('#prompt-input')).toHaveValue('Preserve the conversation draft');
});
