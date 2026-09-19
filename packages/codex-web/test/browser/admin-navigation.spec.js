import { test, expect } from '@playwright/test';
import { installAdminFixture, openAdminConsole, returnToAdminList, sessions } from './helpers/admin-fixture.js';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  await installAdminFixture(page);
  await page.route(`**/api/admin/sessions/${sessions[0].id}`, route => route.fulfill({ json: {
    mode: 'observer', session: { ...sessions[0], timelineComplete: true, timeline: Array.from({ length: 120 }, (_, i) => ({
      id: `audit_${i}`, kind: 'message', role: i % 2 ? 'assistant' : 'user', meta: i % 2 ? 'final' : 'history',
      text: `Audit message ${i}\n\nReview the recorded deployment checks in their original order.`,
    })) },
  } }));
});

test('admin observation opens the first history window on every entry and supports both reading directions', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openAdminConsole(page, info.project.name);
  for (let entry = 0; entry < 2; entry++) {
    await page.locator(`[data-admin-session-id="${sessions[0].id}"]`).click();
    await expect(page.locator('#timeline [data-timeline-id]').first()).toHaveAttribute('data-timeline-id', 'audit_0');
    await expect.poll(() => page.locator('#timeline').evaluate(el => el.scrollTop)).toBe(0);
    await expect(page.locator('.timeline-history-end')).toBeInViewport();
    await expect(page.locator('#prompt-input')).toHaveCount(0);
    await expect(page.locator('#admin-observed-close, .read-only-composer-wrap')).toHaveCount(0);
    const timeline = await page.locator('#timeline').boundingBox();
    const panel = await page.locator(info.project.name === 'desktop' ? '.admin-observed-panel' : '.screen').boundingBox();
    expect(Math.abs(timeline.y + timeline.height - panel.y - panel.height)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `docs/audits/2026-09-19-second-remediation-evidence/admin-beginning-${info.project.name}.png` });
    await page.locator('#timeline-jump-latest').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#timeline [data-timeline-id]').last()).toHaveAttribute('data-timeline-id', 'audit_119');
    await expect(page.locator('[data-timeline-id="audit_119"]')).toBeInViewport();
    await page.getByRole('button', { name: 'Show earlier messages', exact: true }).click();
    await expect(page.locator('#timeline [data-timeline-id]').first()).toHaveAttribute('data-timeline-id', 'audit_0');
    await returnToAdminList(page);
    await expect(page.locator('#timeline')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('leaving the console restores the original ordinary session at latest with its draft', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/');
  await page.locator('[data-session-id="session_browser_history"]').click();
  await expect(page.locator('#timeline')).toContainText('Latest browser answer');
  await page.getByRole('button', { name: 'Show earlier messages', exact: true }).click();
  await page.locator('#timeline').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await page.locator('#prompt-input').fill('Keep this ordinary session draft');
  for (const observe of [false, true]) {
    await page.locator('#open-admin-console-button').click();
    if (observe) {
      await page.locator(`[data-admin-session-id="${sessions[0].id}"]`).click();
      await expect(page.locator('#timeline')).toHaveAttribute('data-session-id', sessions[0].id);
    }
    await page.locator('#back-to-list-button').click();
    await expect(page.locator('#timeline')).toHaveAttribute('data-session-id', 'session_browser_history');
    await expect.poll(() => page.locator('#timeline').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
    await expect(page.locator('#prompt-input')).toHaveValue('Keep this ordinary session draft');
    await expect(page.locator('#timeline-jump-latest')).toBeHidden();
  }
});

test('admin session list keeps its width and scroll position when opening and switching detail', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.route('**/api/admin/sessions?*', route => route.fulfill({ json: { items: Array.from({ length: 25 }, (_, i) => ({ ...sessions[0], id: i ? `extra_${i}` : sessions[0].id, title: `Deployment review ${i}` })), hasMore: false } }));
  await page.route('**/api/admin/sessions/extra_*', route => route.fulfill({ json: { mode: 'observer', session: { ...sessions[0], id: new URL(route.request().url()).pathname.split('/').pop(), timeline: [{ id: 'other', kind: 'message', role: 'user', text: 'Selected another audit record' }] } } }));
  await openAdminConsole(page, info.project.name);
  for (const width of [1440, 1200, 980]) {
    await page.setViewportSize({ width, height: 900 });
    const list = page.locator('.admin-content');
    await expect(page.locator('.admin-observed-panel.is-empty')).toBeVisible();
    const before = await list.boundingBox();
    expect(before.width).toBe(360);
    await page.locator(`[data-admin-session-id="${sessions[0].id}"]`).click();
    await expect(page.locator('[data-timeline-id="audit_0"]')).toBeInViewport();
    expect((await list.boundingBox()).width).toBe(before.width);
    await list.evaluate(el => { el.scrollTop = 300; });
    const visibleId = await list.evaluate(el => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll('[data-admin-session-id]')].find(button => { const rect = button.getBoundingClientRect(); return rect.top > box.top && rect.bottom < box.bottom; })?.dataset.adminSessionId;
    });
    await page.locator(`[data-admin-session-id="${visibleId}"]`).click();
    await expect(page.locator('#timeline')).toContainText('Selected another audit record');
    expect((await list.boundingBox()).width).toBe(before.width);
    expect(await list.evaluate(el => el.scrollTop)).toBe(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `docs/audits/2026-09-19-second-remediation-evidence/admin-fixed-list-${width}.png` });
    await returnToAdminList(page);
  }
});
