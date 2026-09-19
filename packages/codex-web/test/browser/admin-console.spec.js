import { expect, test } from '@playwright/test';

import { installAdminFixture, openAdminConsole, navigateAdmin } from './helpers/admin-fixture.js';

test('admin console stays usable across desktop and mobile layouts', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'mobile-compact', 'mobile-portrait'].includes(testInfo.project.name));
  await installAdminFixture(page);
  await openAdminConsole(page, testInfo.project.name);

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(Math.max(layout.bodyScrollWidth, layout.documentScrollWidth)).toBeLessThanOrEqual(layout.viewportWidth + 1);

  const navButtons = page.locator('button[data-admin-page]');
  await expect(navButtons).toHaveCount(5);
  for (const button of await navButtons.all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  if (testInfo.project.name === 'desktop') {
    await expect(page.locator('.admin-observed-panel.is-empty')).toBeVisible();
    const columns = await page.locator('.admin-layout').evaluate((element) => (
      getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
    ));
    expect(columns).toBe(3);
  }

  await page.screenshot({
    path: `/tmp/codex-web-admin-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await navigateAdmin(page, 'projects');
  await expect(page.locator('#admin-project-form')).toHaveCount(0);
  await page.locator('[data-admin-add="project"]').click();
  await expect(page.locator('#admin-project-form')).toBeVisible();
  await page.locator('#admin-project-edit-cancel').click();
  await expect(page.getByRole('heading', { name: 'Configured Projects' })).toBeVisible();
  await page.screenshot({
    path: `/tmp/codex-web-admin-projects-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await navigateAdmin(page, 'roles');
  await expect(page.locator('#admin-role-form')).toHaveCount(0);
  await page.locator('[data-admin-add="role"]').click();
  await expect(page.locator('#admin-role-form')).toBeVisible();
  await navigateAdmin(page, 'users');
  await expect(page.locator('#admin-user-form')).toHaveCount(0);
  await page.locator('[data-admin-add="user"]').click();
  await expect(page.locator('#admin-user-form')).toBeVisible();
  await page.locator('#admin-user-edit-cancel').click();
  await expect(page.locator('[data-admin-delete-user-id="user_admin"]')).toBeDisabled();

  await navigateAdmin(page, 'sessions');
  await expect(page.locator('button[data-admin-page="sessions"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#admin-session-user-filter')).toBeVisible();

  await page.locator('[data-admin-session-id="session_admin_fixture_1"]').click();
  await expect(page.getByText('The deployment checks passed and the release report is ready.')).toBeVisible();
  await expect(page.locator('#composer')).toHaveCount(0);
});
