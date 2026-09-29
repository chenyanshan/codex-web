import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const installed = {
  webBuild: 'web-test-build', installedVersion: '0.153.4', runningVersion: '0.152.0',
  protocolVersion: '0.156.1', installation: 'npm', updateSupported: true,
  limitation: 'In-place npm installation', operation: null,
};

test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'runtime-settings-fixture');
    localStorage.setItem('codexWebLanguage', 'zh-CN');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__runtimeSettingsTest = { render, showSessionList, switchIdentity() { setLoggedOut(); state.token = 'runtime-second-user'; state.authSession = { id: 'runtime-second-session', principal: { mode: 'single', userId: 'second-user', isAdmin: true } }; state.view = 'sessions'; render(); } };` });
  });
});

async function openRuntimeSettings(page) {
  await expect(page.locator('#open-app-settings-button')).toBeAttached();
  if (!await page.locator('#open-app-settings-button').isVisible()) await page.locator('#mobile-sidebar-toggle-button').click();
  await page.locator('#open-app-settings-button').click();
  await page.locator('[data-settings-group="server"]').click();
  await expect(page.locator('#runtime-version-settings')).toBeVisible();
  return page.locator('#runtime-version-settings');
}

test('Chinese runtime versions stay distinct and local render reconciliation preserves the loaded panel', async ({ page }, info) => {
  let statusReads = 0;
  await page.route('**/api/runtime/status', route => { statusReads++; return route.fulfill({ json: installed }); });
  await page.goto('/');
  const panel = await openRuntimeSettings(page);
  await expect(panel).toContainText('已安装 CLI');
  await expect(panel).toContainText('运行中的 app-server');
  await expect(panel).toContainText('协议基准版本');
  for (const version of ['0.153.4', '0.152.0', '0.156.1']) await expect(panel).toContainText(version);
  await expect(panel.getByRole('button', { name: '检查更新', exact: true })).toBeVisible();
  await page.evaluate(() => { globalThis.__runtimePanel = document.querySelector('#runtime-version-settings'); globalThis.__runtimeSettingsTest.render(); globalThis.__runtimeSettingsTest.render(); });
  expect(await page.evaluate(() => document.querySelector('#runtime-version-settings') === globalThis.__runtimePanel)).toBe(true);
  await expect(panel).toContainText('0.153.4');
  expect(statusReads).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await panel.getByRole('button', { name: '空闲后应用已安装版本', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('runtime-settings-zh.png'), animations: 'disabled' });
});

for (const transition of ['leave', 'identity']) {
  test(`late runtime status cannot replace the new page after ${transition}`, async ({ page }) => {
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    let reads = 0;
    let delivered = false;
    await page.route('**/api/runtime/status', async route => {
      reads++;
      if (reads === 1) {
        await waiting;
        await route.fulfill({ json: { ...installed, installedVersion: 'STALE_PRIVATE_VERSION' } }).catch(() => {});
        delivered = true;
      } else await route.fulfill({ json: { ...installed, installedVersion: 'CURRENT_VERSION' } });
    });
    await page.goto('/');
    await openRuntimeSettings(page);
    await expect.poll(() => reads).toBe(1);
    if (transition === 'identity') await page.evaluate(() => globalThis.__runtimeSettingsTest.switchIdentity());
    else await page.evaluate(() => globalThis.__runtimeSettingsTest.showSessionList());
    await expect(page.locator('#runtime-version-settings')).toHaveCount(0);
    const newPanel = await openRuntimeSettings(page);
    await expect(newPanel).toContainText('CURRENT_VERSION');
    release();
    await expect.poll(() => delivered).toBe(true);
    await expect(newPanel).toContainText('CURRENT_VERSION');
    await expect(page.locator('body')).not.toContainText('STALE_PRIVATE_VERSION');
  });
}

test('lost maintenance POST is never resent and explicit status refresh reconciles its original operation', async ({ page }) => {
  let operation = null;
  let posts = 0;
  let statusReads = 0;
  await page.route('**/api/runtime/status', route => { statusReads++; return route.fulfill({ json: { ...installed, operation } }); });
  await page.route('**/api/runtime/maintenance', async route => {
    posts++;
    const body = route.request().postDataJSON();
    operation = { ...body, phase: 'waiting', reasons: ['Active turns'], error: null };
    await route.abort('failed');
  });
  await page.goto('/');
  const panel = await openRuntimeSettings(page);
  await expect(panel).toContainText('0.153.4');
  await panel.getByRole('button', { name: '空闲后应用已安装版本', exact: true }).click();
  await expect(panel).toContainText('请求结果未知');
  expect(posts).toBe(1);
  const pendingId = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(name => name.startsWith('codex.runtime-maintenance:'));
    return key ? JSON.parse(sessionStorage.getItem(key)).id : null;
  });
  expect(pendingId).toBe(operation.id);
  await page.evaluate(() => { globalThis.__runtimeSettingsTest.render(); window.dispatchEvent(new Event('online')); });
  await expect(panel.getByRole('button', { name: '空闲后应用已安装版本', exact: true })).toBeDisabled();
  expect(posts).toBe(1);
  await panel.getByRole('button', { name: '刷新状态', exact: true }).click();
  await expect(panel).toContainText('等待任务结束');
  await expect(panel).toContainText('存在运行中的任务');
  await expect(panel.getByRole('button', { name: '取消预约', exact: true })).toBeVisible();
  expect(statusReads).toBe(2);
  expect(posts).toBe(1);
  expect(await page.evaluate(() => Object.keys(sessionStorage).some(name => name.startsWith('codex.runtime-maintenance:')))).toBe(false);
});
