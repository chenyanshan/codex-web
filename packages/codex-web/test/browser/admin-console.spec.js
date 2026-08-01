import { expect, test } from '@playwright/test';

const projects = [
  {
    id: 'project_alpha',
    cwd: '/Users/test/workspaces/alpha-console',
    displayName: 'Alpha Console',
    enabled: true,
    activeSessionLimit: 24,
    showWorkDetailsToMembers: true,
  },
  {
    id: 'project_beta',
    cwd: '/Users/test/workspaces/beta-automation',
    displayName: 'Beta Automation',
    enabled: false,
    activeSessionLimit: 8,
    showWorkDetailsToMembers: false,
  },
];

const roles = [
  { id: 'role_admin', name: 'Admin', isAdmin: true, projectGrants: [] },
  {
    id: 'role_writer',
    name: 'Writer',
    isAdmin: false,
    projectGrants: [{ projectId: 'project_alpha', canRead: true, canCreate: true, canWrite: true }],
  },
];

const users = [
  { id: 'user_admin', username: 'admin', email: 'admin@example.com', enabled: true, roleId: 'role_admin', roleIds: ['role_admin'] },
  { id: 'user_writer', username: 'writer', email: 'writer@example.com', enabled: true, roleId: 'role_writer', roleIds: ['role_writer'] },
  { id: 'user_disabled', username: 'disabled-user', email: 'disabled@example.com', enabled: false, roleId: '', roleIds: [] },
];

const sessions = [
  {
    id: 'session_admin_fixture_1',
    ownerUserId: 'user_writer',
    projectId: 'project_alpha',
    projectDisplayName: 'Alpha Console',
    summary: 'Review the deployment checks and update the release report.',
    updatedAt: '2026-07-31T10:20:00.000Z',
  },
  {
    id: 'session_admin_fixture_2',
    ownerUserId: 'user_admin',
    projectId: 'project_beta',
    projectDisplayName: 'Beta Automation',
    summary: 'Trace the failed scheduled task without changing project files.',
    archived: true,
    updatedAt: '2026-07-30T07:15:00.000Z',
  },
];

async function installAdminFixture(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('codexWebToken', 'admin-browser-token');
    window.localStorage.setItem('codexWebLanguage', 'en');
  });

  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      session: {
        id: 'admin-browser-session',
        principal: {
          mode: 'multi',
          userId: 'user_admin',
          username: 'admin',
          isAdmin: true,
          roleIds: ['role_admin'],
        },
      },
    }),
  }));

  await page.route('**/api/admin/**', async (route) => {
    const url = new URL(route.request().url());
    const payloadByPath = {
      '/api/admin/settings': { settings: { multiUserEnabled: true } },
      '/api/admin/projects': { items: projects },
      '/api/admin/users': { items: users },
      '/api/admin/roles': { items: roles },
      '/api/admin/sessions': { items: sessions },
      '/api/admin/sessions/session_admin_fixture_1': {
        mode: 'observer',
        session: {
          ...sessions[0],
          timeline: [
            { id: 'admin_message_1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: sessions[0].summary },
            { id: 'admin_message_2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text: 'The deployment checks passed and the release report is ready.' },
          ],
          thread: { turns: [] },
        },
      },
    };
    const payload = payloadByPath[url.pathname];
    if (!payload) {
      await route.fallback();
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

async function openAdminConsole(page, projectName) {
  await page.goto('/');
  if (projectName === 'desktop') {
    await page.locator('#open-admin-console-button').click();
  } else {
    await page.locator('#mobile-sidebar-toggle-button').click();
    await page.locator('#open-admin-console-button').click();
  }
  await expect(page.getByRole('heading', { name: 'Session Audit' })).toBeVisible();
}

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
  await expect(navButtons).toHaveCount(4);
  for (const button of await navButtons.all()) {
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

  await page.locator('button[data-admin-page="projects"]').click();
  await expect(page.locator('#admin-project-form')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Configured Projects' })).toBeVisible();
  await page.screenshot({
    path: `/tmp/codex-web-admin-projects-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await page.locator('button[data-admin-page="roles"]').click();
  await expect(page.locator('#admin-role-form')).toBeVisible();
  await page.locator('button[data-admin-page="users"]').click();
  await expect(page.locator('#admin-user-form')).toBeVisible();
  await expect(page.locator('[data-admin-delete-user-id="user_admin"]')).toBeDisabled();

  await page.locator('button[data-admin-page="sessions"]').click();
  await expect(page.locator('button[data-admin-page="sessions"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#admin-session-user-filter')).toBeVisible();

  await page.locator('[data-admin-session-id="session_admin_fixture_1"]').click();
  await expect(page.getByText('The deployment checks passed and the release report is ready.')).toBeVisible();
  await expect(page.locator('#composer')).toHaveCount(0);
});
