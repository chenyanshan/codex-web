import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function openApproval(page, language = 'en') {
  await page.addInitScript(language => {
    localStorage.setItem('codexWebToken', `approval-delivery-${Math.random()}`);
    localStorage.setItem('codexWebLanguage', language);
  }, language);
  await page.goto('/');
  await page.locator('button[data-session-id="session_browser_fixture"]').click();
  await expect(page.locator('[data-approval-action="accept"]')).toBeVisible();
}

test('approval decisions disable together while sending and retain the draft', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/approvals/approval_browser_fixture/*', async route => {
    requests++;
    await held;
    await route.fulfill({ json: { ok: true } });
  });
  await openApproval(page);
  const prompt = page.locator('#prompt-input');
  await prompt.fill('Keep this draft during approval');
  const accept = page.locator('[data-approval-action="accept"]');
  // Two same-tick clicks exercise the handler guard as well as disabled styling.
  await accept.evaluate(button => { button.click(); button.click(); });
  await expect(page.getByRole('status').filter({ hasText: 'Sending approval…' })).toBeVisible();
  for (const action of ['accept', 'accept-for-session', 'deny']) await expect(page.locator(`[data-approval-action="${action}"]`)).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  await expect(prompt).toHaveValue('Keep this draft during approval');
  release();
  await expect(page.getByText('Sending approval…', { exact: true })).toBeHidden();
  await expect(accept).toHaveCount(0);
  await expect(page.locator('.approval-card.is-resolved')).toBeVisible();
  await expect(prompt).toHaveValue('Keep this draft during approval');
});

test('a lost approval response stays unconfirmed without resending and accepts a later resolution', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/approvals/approval_browser_fixture/*', route => { requests++; return route.abort('failed'); });
  await openApproval(page, 'zh-CN');
  await page.locator('[data-approval-action="accept"]').click();
  await expect(page.getByText('审批是否送达尚未确认。请刷新会话后再处理。', { exact: true })).toBeVisible();
  await expect(page.locator('[data-approval-action="deny"]')).toBeDisabled();
  expect(requests).toBe(1);
  await page.evaluate(async () => {
    await fetch('/__test/turn-event', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('codexWebToken')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ turnId: 'turn_browser_active', type: 'approval.resolved', approvalId: 'approval_browser_fixture', decision: 'accepted' }) });
  });
  await expect(page.getByText('审批是否送达尚未确认。请刷新会话后再处理。', { exact: true })).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect(requests).toBe(1);
});

test('a late approval failure cannot update another session', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/approvals/approval_browser_fixture/*', async route => { await held; await route.fulfill({ status: 409, json: { error: 'expired', message: 'Old approval expired' } }); });
  await openApproval(page);
  await page.locator('[data-approval-action="accept"]').click();
  await expect(page.getByText('Sending approval…', { exact: true })).toBeVisible();
  const back = page.locator('#back-to-list-button');
  if (await back.isVisible()) await back.click();
  await page.locator('button[data-session-id="session_browser_history"]').click();
  release();
  await expect(page.locator('#timeline')).not.toContainText('Old approval expired');
  await expect(page.getByText('This approval is no longer available. Refresh the session.', { exact: true })).toBeHidden();
});

test('execution observation loss retains the draft and active turn until official progress resumes', async ({ page }) => {
  await openApproval(page);
  await page.locator('#prompt-input').fill('Keep my next instruction');
  const emit = async event => {
    const delivered = await page.evaluate(async event => {
      const response = await fetch('/__test/turn-event', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('codexWebToken')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ turnId: 'turn_browser_active', ...event }) });
      return (await response.json()).delivered;
    }, event);
    expect(delivered).toBe(1);
  };
  await emit({ type: 'approval.resolved', approvalId: 'approval_browser_fixture', decision: 'accepted' });
  await emit({ type: 'turn.observation_interrupted' });
  await expect(page.locator('.composer-status')).toContainText('Status awaiting sync');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(page.locator('#prompt-input')).toHaveValue('Keep my next instruction');
  await expect(page.locator('#timeline')).not.toContainText('Turn failed');
  await emit({ type: 'assistant.delta', itemId: 'recovered_output', text: 'Observed again', phase: 'commentary' });
  await expect(page.locator('.composer-status')).not.toContainText('Status awaiting sync');
  await expect(page.locator('#timeline')).toContainText('Observed again');
  await expect(page.locator('#prompt-input')).toHaveValue('Keep my next instruction');
});

test('command rules have an explicit label and unavailable actions stay hidden', async ({ page }) => {
  await openApproval(page);
  await page.evaluate(async () => {
    await fetch('/__test/turn-event', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('codexWebToken')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'approval.requested', turnId: 'turn_browser_active', approvalId: 'approval_browser_fixture', approvalKind: 'command', summary: { command: 'npm test', availableDecisionKeys: ['accept', 'acceptWithExecpolicyAmendment', 'cancel'], execPolicyAmendment: ['npm', 'test'] } }) });
  });
  await expect(page.getByRole('button', { name: 'Allow with command rule', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow for this session', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel turn', exact: true })).toBeVisible();
  let sentPath = '';
  await page.route('**/api/approvals/approval_browser_fixture/*', async route => { sentPath = new URL(route.request().url()).pathname; await route.fulfill({ json: { ok: true } }); });
  await page.getByRole('button', { name: 'Allow with command rule', exact: true }).click();
  await expect.poll(() => sentPath).toBe('/api/approvals/approval_browser_fixture/accept-for-session');
  await expect(page.locator('.approval-card.is-resolved')).toBeVisible();
});

test('oversized live approval details cannot silently authorize a truncated command', async ({ page }) => {
  await openApproval(page);
  await page.evaluate(async () => {
    await fetch('/__test/turn-event', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('codexWebToken')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'approval.requested', turnId: 'turn_browser_active', approvalId: 'approval_browser_fixture', approvalKind: 'command', summary: { command: 'x'.repeat(4001), availableDecisionKeys: ['accept', 'acceptForSession', 'decline'] } }) });
  });
  await expect(page.getByText('Request details exceed the display limit. Approval is unavailable here.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-approval-action="accept"]')).toHaveCount(0);
  await expect(page.locator('[data-approval-action="accept-for-session"]')).toHaveCount(0);
  await expect(page.locator('[data-approval-action="deny"]')).toBeEnabled();
  expect(await page.locator('.approval-operation code').innerText()).toHaveLength(4000);
});
