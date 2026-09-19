import { expect } from '@playwright/test';

export const projects = [
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

export const roles = [
  { id: 'role_admin', name: 'Admin', isAdmin: true, projectGrants: [] },
  {
    id: 'role_writer',
    name: 'Writer',
    isAdmin: false,
    projectGrants: [{ projectId: 'project_alpha', canRead: true, canCreate: true, canWrite: true }],
  },
];

export const users = [
  { id: 'user_admin', username: 'admin', email: 'admin@example.com', enabled: true, roleId: 'role_admin', roleIds: ['role_admin'] },
  { id: 'user_writer', username: 'writer', email: 'writer@example.com', enabled: true, roleId: 'role_writer', roleIds: ['role_writer'] },
  { id: 'user_disabled', username: 'disabled-user', email: 'disabled@example.com', enabled: false, roleId: '', roleIds: [] },
];

export const sessions = [
  {
    id: 'session_admin_fixture_1',
    title: 'Deployment checks and release report',
    ownerUserId: 'user_writer',
    projectId: 'project_alpha',
    projectDisplayName: 'Alpha Console',
    summary: 'Review the deployment checks and update the release report.',
    updatedAt: '2026-07-31T10:20:00.000Z',
  },
  {
    id: 'session_admin_fixture_2',
    title: 'Scheduled task failure investigation',
    ownerUserId: 'user_admin',
    projectId: 'project_beta',
    projectDisplayName: 'Beta Automation',
    summary: 'Trace the failed scheduled task without changing project files.',
    archived: true,
    updatedAt: '2026-07-30T07:15:00.000Z',
  },
];

export async function installAdminFixture(page) {
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
    let payload = payloadByPath[url.pathname];
    if (url.pathname === '/api/admin/sessions') {
      const mode = url.searchParams.get('state') || 'active';
      payload = { items: sessions.filter(s => mode === 'all' || (mode === 'archived') === Boolean(s.archived)), nextCursor: null, hasMore: false };
    }
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405, json: { error: 'unexpected_write' } });
    if (!payload) {
      await route.fallback();
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

export async function openAdminConsole(page, projectName) {
  await page.goto('/');
  if (projectName === 'desktop') {
    await page.locator('#open-admin-console-button').click();
  } else {
    await page.locator('#mobile-sidebar-toggle-button').click();
    await page.locator('#open-admin-console-button').click();
  }
  await expect(page.getByRole('heading', { name: 'Session Audit' })).toBeVisible();
}

export async function navigateAdmin(page, name) {
  if (await page.locator('#admin-page-select').isVisible()) await page.locator('#admin-page-select').selectOption(name);
  else await page.locator(`button[data-admin-page="${name}"]`).click();
}

export async function returnToAdminList(page) {
  await page.locator('#back-to-list-button').click();
  if (!await page.locator('.admin-console-screen').count()) {
    if (!await page.locator('#open-admin-console-button').isVisible()) await page.locator('#mobile-sidebar-toggle-button').click();
    await page.locator('#open-admin-console-button').click();
  }
  await expect(page.getByRole('heading', { name: 'Session Audit' })).toBeVisible();
}
