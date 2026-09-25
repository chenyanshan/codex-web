import { test, expect } from '@playwright/test';
import { installAdminFixture, openAdminConsole, returnToAdminList, navigateAdmin, adminTimelinePage, projects, sessions } from './helpers/admin-fixture.js';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await installAdminFixture(page);
});

test('entity switching preserves its own draft; failed writes retain checkboxes and prevent duplicate submits', async ({ page }, info) => {
  let release, writes = 0;
  const delayed = new Promise(resolve => { release = resolve; });
  await page.route('**/api/admin/projects/project_alpha', async route => {
    writes++; await delayed;
    await route.fulfill({ status: 409, json: { error: 'conflict', message: 'Project was changed. Review and save again.' } });
  });
  await openAdminConsole(page, info.project.name); await navigateAdmin(page, 'projects');
  await page.locator('[data-admin-edit-project="project_alpha"]').click();
  await page.locator('[name="displayName"]').fill('Unsent alpha');
  await page.locator('[name="enabled"]').uncheck();
  if (info.project.name === 'desktop') {
    await page.locator('[data-admin-edit-project="project_beta"]').click();
    await expect(page.locator('[name="displayName"]')).toHaveValue(projects[1].displayName);
    await expect(page.locator('[name="cwd"]')).toHaveValue(projects[1].cwd);
    await page.locator('[data-admin-edit-project="project_alpha"]').click();
  } else {
    await navigateAdmin(page, 'users'); await navigateAdmin(page, 'projects');
    await page.locator('[data-admin-edit-project="project_alpha"]').click();
  }
  await expect(page.locator('[name="displayName"]')).toHaveValue('Unsent alpha');
  await expect(page.locator('[name="enabled"]')).not.toBeChecked();
  await page.locator('#admin-project-form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.locator('#admin-project-form button[type="submit"]')).toBeDisabled();
  await expect.poll(() => writes).toBe(1); release();
  await expect(page.locator('.admin-editor-error')).toContainText('Project was changed');
  await expect(page.locator('[name="enabled"]')).not.toBeChecked();
  await expect(page.locator('[name="displayName"]')).toHaveValue('Unsent alpha');
  await expect(page.locator('#admin-project-form button[type="submit"]')).toBeEnabled();
});

test('late save of A never closes B or replaces its draft', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  let release; const delayed = new Promise(resolve => { release = resolve; });
  await page.route('**/api/admin/projects/project_alpha', async route => { await delayed; await route.fulfill({ json: { project: projects[0] } }); });
  await openAdminConsole(page, info.project.name); await navigateAdmin(page, 'projects');
  await page.locator('[data-admin-edit-project="project_alpha"]').click();
  await page.locator('#admin-project-form button[type="submit"]').click();
  await page.locator('[data-admin-edit-project="project_beta"]').click();
  await page.locator('[name="displayName"]').fill('My beta draft'); release();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await expect(page.locator('#admin-project-form')).toHaveAttribute('data-entity-id', 'project_beta');
  await expect(page.locator('[name="displayName"]')).toHaveValue('My beta draft');
});

test('a failed dependency keeps users visible and can be retried independently', async ({ page }, info) => {
  let failure = true, roleCalls = 0;
  await page.route('**/api/admin/roles', route => { roleCalls++; return failure ? route.fulfill({ status: 503, json: { message: 'Roles temporarily unavailable' } }) : route.fallback(); });
  await openAdminConsole(page, info.project.name); await navigateAdmin(page, 'users');
  await expect(page.locator('.admin-user-row')).toHaveCount(3);
  await expect(page.locator('.admin-resource-error')).toContainText('Roles temporarily unavailable');
  const first = await page.locator('.admin-user-row').first().boundingBox(); expect(first.y).toBeLessThan(450);
  expect(roleCalls).toBe(1); failure = false;
  await page.locator('[data-admin-edit-user="user_writer"]').click();
  await expect(page.locator('#admin-user-form button[type="submit"]')).toBeDisabled();
  await page.locator('[data-admin-retry="roles"]').click();
  await expect(page.locator('.admin-resource-error')).toHaveCount(0);
  await expect(page.locator('.admin-user-row')).toHaveCount(3);
  expect(roleCalls).toBe(2);
  await expect(page.locator('#admin-user-form button[type="submit"]')).toBeEnabled();
});

test('system resources load independently, show actual metrics, and preserve a failed mode change', async ({ page }, info) => {
  await page.route('**/version.json', route => route.fulfill({ json: { buildId: 'fixture-20260919' } }));
  let failure = true, calls = 0;
  await page.route('**/api/metrics', route => {
    calls++;
    return failure ? route.fulfill({ status: 503, json: { message: 'Metrics temporarily unavailable' } }) : route.fulfill({ json: { http: { uptimeSeconds: 240, requestP95Ms: 82, samples: 20, activeStreams: 1, sseReplays: 2, sseResets: 0, routes: { history: { requests: 20, errors: 1, clientErrors: 0, samples: 20, requestP95Ms: 82 } } }, storage: { managedStorageMaxBytes: 2147483648, projectUploadMaxBytes: 536870912, backgroundFailures: 0 } } });
  });
  await page.route('**/api/auth/sessions', route => route.fulfill({ json: { sessions: [{ id: 'device_test', current: true, deviceName: 'Test phone', lastSeenAt: '2026-09-19T08:00:00Z' }] } }));
  await page.route('**/api/admin/settings', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 409, json: { message: 'Mode cannot be changed yet' } }) : route.fallback());
  await openAdminConsole(page, info.project.name); await navigateAdmin(page, 'system');
  await expect(page.locator('.admin-system-page')).toContainText('Test phone');
  await expect(page.locator('.admin-resource-error')).toContainText('Metrics temporarily unavailable');
  failure = false; await page.locator('[data-admin-retry="metrics"]').click();
  await expect(page.locator('.admin-system-page')).toContainText('2048 MiB');
  await expect(page.locator('.admin-metrics-scroll')).toContainText('82');
  const bounds = await page.locator('.admin-system-page').evaluate(el => ({ right: el.getBoundingClientRect().right, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
  await page.screenshot({ path: `docs/audits/2026-09-25-admin-redesign-evidence/admin-system-${info.project.name}.png`, animations: 'disabled' });
  const metricsRegion = page.getByRole('region', { name: 'Service metrics' });
  if (await metricsRegion.evaluate(el => el.scrollWidth > el.clientWidth)) {
    await metricsRegion.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => metricsRegion.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  }
  await page.locator('#admin-multi-user-toggle').click();
  await page.locator('.admin-confirm-dialog').getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(page.locator('.admin-editor-error')).toContainText('Mode cannot be changed yet');
  await expect(page.locator('#admin-multi-user-toggle')).toBeChecked();
  expect(calls).toBe(2);
});

test('observer navigation belongs to the latest selection and exit invalidates pending details', async ({ page }, info) => {
  let release; const delayed = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/admin/sessions/${sessions[0].id}/timeline?*`, async route => { await delayed; await route.fulfill({ json: adminTimelinePage(sessions[0], [{ id: 'a', kind: 'message', role: 'assistant', text: 'Old observer response' }], route.request().url()) }).catch(() => {}); });
  await page.route(`**/api/admin/sessions/${sessions[1].id}/timeline?*`, route => route.fulfill({ json: adminTimelinePage(sessions[1], [{ id: 'b', kind: 'message', role: 'assistant', text: 'Latest observer response' }], route.request().url()) }));
  await openAdminConsole(page, info.project.name);
  await page.locator(`[data-admin-session-id="${sessions[0].id}"]`).click();
  await page.locator(`[data-admin-session-id="${sessions[1].id}"]`).click();
  await expect(page.locator('#timeline')).toContainText('Latest observer response'); release();
  await expect(page.locator('#timeline')).not.toContainText('Old observer response');
  await returnToAdminList(page);
  await expect(page.locator('[data-admin-session-id]')).toHaveCount(2);
  await expect(page.locator('#timeline')).toHaveCount(0);
});

test('admin session filters are explicit and pagination bounds mounted records', async ({ page }, info) => {
  const calls = [];
  await page.route('**/api/admin/sessions?*', route => {
    const url = new URL(route.request().url()); calls.push(url.searchParams.get('state'));
    const start = Number(url.searchParams.get('cursor') || 0), limit = Number(url.searchParams.get('limit'));
    expect(limit).toBe(30);
    const all = Array.from({ length: 76 }, (_, i) => ({ ...sessions[i % 2], id: `page_${i}`, title: `Custom session ${i}`, updatedAt: new Date(100000 - i).toISOString(), archived: i % 2 === 1 })).filter(s => url.searchParams.get('state') !== 'archived' || s.archived);
    return route.fulfill({ json: { items: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, hasMore: start + limit < all.length } });
  });
  await openAdminConsole(page, info.project.name);
  await expect(page.locator('[data-admin-session-id]')).toHaveCount(30);
  await expect(page.locator('.admin-session-row').first()).toContainText('Custom session 0');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.admin-session-row').first()).toContainText('Custom session 30');
  await expect(page.locator('[data-admin-session-id]')).toHaveCount(30);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.locator('.admin-session-row').first()).toContainText('Custom session 0');
  await page.locator('#admin-session-state-filter').selectOption('archived');
  await expect(page.locator('.admin-session-row').first()).toContainText('Custom session 1');
  expect(calls).toEqual(['all', 'all', 'archived']);
});
