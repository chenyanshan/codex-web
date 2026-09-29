import { expect } from '@playwright/test';
import { test } from './session-file-api-fixture.js';
import path from 'node:path';
import fs from 'node:fs/promises';

const sessionId = 'session_browser_files';
const projectRoot = '/Users/test/yanshan_quant/';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait', 'mobile-compact'].includes(info.project.name));
  await page.addInitScript(() => localStorage.setItem('codexWebToken', 'markdown-link-fixture'));
});

test('filename mentions stay text and explicit app.js, PR.md and ZIP links open and download', async ({ page, sessionFileApi }, info) => {
  const cwd = path.join(sessionFileApi.root, 'codex-web');
  const appPath = path.join(cwd, 'packages/codex-web/public/app.js');
  const prPath = path.join(sessionFileApi.root, 'BilibiliSponsorBlock/tmp/ai-pr/PR.md');
  const zipPath = path.join(sessionFileApi.root, 'BilibiliSponsorBlock/build.zip');
  const files = [
    { path: appPath, id: 'sf_app', name: 'app.js', kind: 'file', mimeType: 'application/octet-stream', data: 'const app = true;\n' },
    { path: prPath, id: 'sf_pr', name: 'PR.md', kind: 'markdown', mimeType: 'text/markdown', data: '# Pull request\n\nVerified output.' },
    { path: zipPath, id: 'sf_zip', name: 'build.zip', kind: 'file', mimeType: 'application/octet-stream', data: 'zip fixture' },
  ];
  for (const file of files) {
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await fs.writeFile(file.path, file.data);
  }
  const message = { id: 'file-link-regression', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history',
    text: `提到的文件名：\`app.js\` 和 \`PR.md\`。\n\n[下载 app.js](${appPath}:42) [打开 PR.md](${prPath}) [下载 ZIP](${zipPath})` };
  sessionFileApi.sessions[sessionId] = { id: sessionId, cwd, projectName: 'codex-web', timeline: [message] };
  await page.route(`**/api/sessions/${sessionId}/timeline*`, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.items = [message];
    payload.hasMore = false;
    payload.nextBefore = null;
    await route.fulfill({ json: payload });
  });
  const requests = [];
  await page.route(`**/api/sessions/${sessionId}/files/**`, async route => {
    expect(route.request().headers().authorization).toBe('Bearer markdown-link-fixture');
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/resolve')) requests.push(route.request().postDataJSON().path);
    const response = await route.fetch({ url: sessionFileApi.baseUrl + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await page.goto('/');
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  await expect(page.getByText('提到的文件名：', { exact: false })).toBeVisible();
  await expect(page.locator('[data-session-file-path="app.js"], [data-session-file-path="PR.md"]')).toHaveCount(0);
  await page.locator('#prompt-input').fill('Draft retained');
  for (const [index, label] of ['下载 app.js', '打开 PR.md', '下载 ZIP'].entries()) {
    await page.getByRole('link', { name: label, exact: true }).click();
    if (index === 1) await expect(page.locator('.session-file-document h1')).toHaveText('Pull request');
    else await expect(page.locator('.session-file-generic')).toContainText(files[index].name);
    await page.screenshot({ path: info.outputPath(`file-${index}.png`) });
    const pending = page.waitForEvent('download');
    await page.locator('#session-file-download').click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(files[index].name);
    expect(await fs.readFile(await download.path(), 'utf8')).toBe(files[index].data);
    await page.locator('#close-session-file-button').click();
    await expect(page.locator('#prompt-input')).toHaveValue('Draft retained');
  }
  expect(requests).toEqual(files.map(item => item.path));
});

async function installFiles(page, { failCsvOnce = false } = {}) {
  const files = new Map([
    ['docs/browser-session-guide.md', { id: 'sf_guide', kind: 'markdown', mimeType: 'text/markdown', data: '# Guide\n\n[HTML preview](preview.html)\n\n[Nested guide](notes/nested.md)\n\n[Spreadsheet](downloads/monthly%20report%2525.csv)\n\n[Absolute image](/Users/test/yanshan_quant/docs/assets/preview.png)' }],
    ['docs/notes/nested.md', { id: 'sf_nested', kind: 'markdown', mimeType: 'text/markdown', data: '# Nested guide\n\n[Preview image](../assets/preview.png)' }],
    ['docs/assets/preview.png', { id: 'sf_image', kind: 'image', mimeType: 'image/png', data: png }],
    ['docs/downloads/monthly report%25.csv', { id: 'sf_csv', kind: 'file', mimeType: 'text/csv', data: 'name,value\nexample,42\n' }],
  ]);
  files.set('docs/preview.html', { id: 'sf_html', kind: 'html', mimeType: 'text/html', data: '<h1>Local covers</h1><img src="assets/preview.png"><img src="assets/preview.png"><img src="missing.png"><script>parent.document.body.textContent="unsafe"</script>' });
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
  await page.route(`**/api/sessions/${sessionId}/files/*/content**`, async route => {
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


test('HTML preview embeds local images through authenticated file APIs and keeps sandbox isolation', async ({ page }) => {
  const requests = await installFiles(page);
  const imageHeaders = [];
  page.on('request', request => {
    if (request.url().includes('/files/sf_image/content')) imageHeaders.push(request.headers().authorization);
  });
  await page.getByRole('link', { name: 'HTML preview', exact: true }).click();
  const frame = page.frameLocator('.session-file-html');
  await expect(frame.locator('h1')).toHaveText('Local covers');
  await expect.poll(() => frame.locator('img').evaluateAll(images => images.filter(image => image.naturalWidth === 1).length)).toBe(2);
  expect(requests.filter(path => path === 'docs/assets/preview.png')).toHaveLength(1);
  expect(imageHeaders).toEqual(['Bearer markdown-link-fixture']);
  await expect(page.locator('.session-file-html')).toHaveAttribute('sandbox', '');
  await expect(page.locator('#close-session-file-button')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#session-file-download').click();
  expect((await downloadPromise).suggestedFilename()).toBe('preview.html');
  await page.locator('#close-session-file-button').click();
  await expect(page.locator('#prompt-input')).toHaveValue('Preserve the conversation draft');
});

test('HTML image embedding bounds resources, ignores remote URLs, and cancels stale loads', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    await import('/session-file-viewer.js');
    const { embedSessionFileImages } = globalThis.CodexWebFileViewer.createRenderer({});
    const requested = [];
    const html = await embedSessionFileImages('<img src="https://example.com/private"><img src="//example.com/x"><img src="data:image/png;base64,eA=="><img src="large.png"><img src="bad.svg"><img src="%E0%A4%A"><img src="space%20name.png">', '/project/docs/index.html', async path => {
      requested.push(path);
      return path.endsWith('large.png') ? new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/png' }) : new Blob(['x'], { type: path.endsWith('.svg') ? 'image/svg+xml' : 'image/png' });
    });
    const controller = new AbortController();
    let aborted = false;
    try {
      await embedSessionFileImages('<img src="a.png"><img src="b.png">', '/index.html', async () => {
        controller.abort();
        return new Blob(['x'], { type: 'image/png' });
      }, controller.signal);
    } catch (error) { aborted = error.name === 'AbortError'; }
    let reads = 0;
    await embedSessionFileImages(Array.from({length: 100}, (_, i) => `<img src="${i}.png">`).join(''), '/index.html', async () => { reads++; return null; });
    return { requested, html, aborted, reads };
  });
  expect(result.requested).toEqual(['/project/docs/large.png', '/project/docs/bad.svg', '/project/docs/space name.png']);
  expect(result.html).toContain('src="large.png"');
  expect(result.html).toContain('src="bad.svg"');
  expect(result.html).toContain('src="data:image/png;base64,eA=="');
  expect(result.aborted).toBe(true);
  expect(result.reads).toBe(64);
});

test('HTML stays readable while an image request stalls and closing cancels it', async ({ page }) => {
  await installFiles(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${sessionId}/files/sf_image/content`, async route => {
    await gate;
    await route.fulfill({ contentType: 'image/png', body: png }).catch(() => {});
  });
  await page.getByRole('link', { name: 'HTML preview', exact: true }).click();
  await expect(page.frameLocator('.session-file-html').locator('h1')).toHaveText('Local covers', { timeout: 2000 });
  await expect(page.locator('.session-file-loading')).toHaveCount(0);
  await page.locator('#close-session-file-button').click();
  release();
  await expect(page.locator('#prompt-input')).toHaveValue('Preserve the conversation draft');
  await expect(page.locator('.session-file-html')).toHaveCount(0);
});

test('image batch timeout returns successful images even when another read never settles', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    await import('/session-file-viewer.js');
    const { embedSessionFileImages } = globalThis.CodexWebFileViewer.createRenderer({});
    const signals = [];
    const started = performance.now();
    const html = await embedSessionFileImages('<img src="good.png"><img src="stuck.png">', '/index.html', async (path, limit, signal) => {
      signals.push(signal);
      if (path.endsWith('stuck.png')) return new Promise(() => {});
      return new Blob(['x'], { type: 'image/png' });
    }, undefined, { timeoutMs: 250, requestTimeoutMs: 100 });
    return { html, elapsed: performance.now() - started, aborted: signals.some(signal => signal.aborted) };
  });
  expect(result.html).toContain('data:image/png;base64,eA==');
  expect(result.elapsed).toBeLessThan(2000);
  expect(result.aborted).toBe(true);
});

test('a stalled document exits loading with a retry action', async ({ page }) => {
  await installFiles(page);
  await page.clock.install();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${sessionId}/files/sf_html/content?*`, async route => {
    await gate;
    await route.fulfill({ contentType: 'text/html', body: '<h1>Late</h1>' }).catch(() => {});
  });
  const pending = page.waitForRequest(`**/files/sf_html/content?*`);
  await page.getByRole('link', { name: 'HTML preview', exact: true }).click();
  await pending;
  await page.clock.fastForward(13000);
  await expect(page.locator('#retry-session-file-button')).toBeVisible();
  await expect(page.locator('.session-file-loading')).toHaveCount(0);
  release();
});
