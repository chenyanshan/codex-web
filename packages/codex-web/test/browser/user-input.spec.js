import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
test.use({ serviceWorkers: 'block' });
const evidence = 'docs/audits/2026-09-30-activity-panel-evidence';
const request = { requestId: 'question-1', turnId: 'turn_browser_active', status: 'pending', isBlocking: true, questions: [
  { id: 'choice', header: 'Test scope', question: 'Which regression suite should run?', isOther: true, options: [{ label: 'Mobile workflow', description: 'Reading position and recovery' }, { label: 'Runtime', description: 'Official protocol and delivery receipts' }] },
  { id: 'secret', header: 'Ephemeral value', question: 'Enter the temporary test value', isSecret: true, isOther: true },
] };
async function emit(page, event) {
  await page.evaluate(async event => {
    await fetch('/__test/turn-event', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('codexWebToken')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ turnId: 'turn_browser_active', ...event }) });
  }, event);
}
async function open(page, info) {
  await page.addInitScript(token => { localStorage.setItem('codexWebToken', token); }, `questions-${info.project.name}-${info.workerIndex}`);
  await page.goto('/');
  await page.locator('[data-session-id="session_browser_fixture"]').first().click();
  await expect(page.locator('.composer-status')).toContainText('Needs approval');
  await emit(page, { type: 'user_input.updated', request });
}
test('question answers survive streaming with focus, persist only nonsecret drafts, and check unknown delivery without reposting', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-portrait'].includes(info.project.name));
  let posts = 0, checks = 0;
  await page.route('**/user-input/question-1/answer', route => { posts++; expect(route.request().postDataJSON()).toMatchObject({ answers: { choice: { answers: ['Mobile workflow'] }, secret: { answers: ['ephemeral-fixture-secret'] } } }); return route.abort('failed'); });
  await page.route('**/user-input/receipts/*', route => { checks++; return route.fulfill({ json: { receipt: { status: 'delivery_unknown' } } }); });
  await open(page, info);
  const card = page.locator('.user-input-question');
  await expect(card).toBeVisible();
  await card.locator('select').selectOption('Mobile workflow');
  const secret = card.locator('input[type="password"]');
  await secret.fill('ephemeral-fixture-secret');
  await emit(page, { type: 'assistant.delta', itemId: 'question-commentary', delta: 'Still observing the active turn.' });
  await expect(secret).toHaveValue('ephemeral-fixture-secret');
  await expect(secret).toBeFocused();
  await emit(page, { type: 'user_input.updated', request });
  await expect(secret).toHaveValue('ephemeral-fixture-secret');
  await expect(secret).toBeFocused();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('codex-web.question-drafts.v1'))).toContain('Mobile workflow');
  const drafts = await page.evaluate(() => localStorage.getItem('codex-web.question-drafts.v1'));
  expect(drafts).toContain('Mobile workflow');
  expect(drafts).not.toContain('ephemeral-fixture-secret');
  await fs.mkdir(evidence, { recursive: true });
  await card.locator('.user-input-actions').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/question-${info.project.name}.png` });
  await card.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(card).toContainText('Answer delivery is unknown');
  await expect(card.getByRole('button', { name: 'Send answer', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'Check answer status' }).click();
  expect(posts).toBe(1); expect(checks).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(info.project.use.viewport.width);
});
for (const resource of ['js', 'css']) test(`failed question ${resource} offers local retry and cannot cross sessions`, async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  let attempts = 0;
  await page.route(`**/user-input-view.${resource}*`, route => ++attempts === 1 ? route.abort('failed') : route.continue());
  await open(page, info);
  await expect(page.locator('#user-input-questions')).toContainText('Questions could not be loaded.');
  const retry = page.locator('[data-question-retry]');
  await retry.evaluate(node => { window.__questionRetryNode = node; });
  await emit(page, { type: 'user_input.updated', request: { ...request, status: 'pending' } });
  await expect(retry).toBeVisible();
  expect(await retry.evaluate(node => node === window.__questionRetryNode)).toBe(true);
  await emit(page, { type: 'assistant.delta', itemId: 'retry-commentary', delta: 'Keep the failed module explicit.' });
  await expect(retry).toBeVisible();
  expect(attempts).toBe(1);
  await retry.click();
  await expect(page.locator('.user-input-question')).toBeVisible();
  await page.locator('.user-input-question input').fill('do-not-share-between-sessions');
  await page.locator('[data-session-id="session_browser_history"]').first().click();
  await expect(page.locator('.user-input-question')).toHaveCount(0);
});
