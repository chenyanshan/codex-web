import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test.use({ serviceWorkers: 'block', locale: 'fr-FR' });
const evidence = 'docs/audits/2026-09-25-session-polish-evidence';

for (const language of ['en', 'zh-CN']) {
  test(`session heading and dates use the selected ${language} language`, async ({ page }) => {
    await page.addInitScript(language => {
      localStorage.setItem('codexWebToken', 'session-language-fixture');
      localStorage.setItem('codexWebLanguage', language);
    }, language);
    await page.goto('/');
    const expected = await page.evaluate(language => new Date('2026-07-15T07:01:00.000Z').toLocaleString(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), language);
    await expect(page.locator('[data-session-id="session_browser_idle"] .session-card-meta')).toContainText(expected);
    await page.locator('#open-new-session-button').click();
    await expect(page.locator('.new-session-heading')).toHaveText(language === 'en' ? 'Start a new session' : '新建会话');
  });

  test(`failed attachments keep ${language} retry and remove actions readable and preserve the draft`, async ({ page }, info) => {
    await page.addInitScript(language => {
      localStorage.setItem('codexWebToken', 'session-attachment-polish');
      localStorage.setItem('codexWebLanguage', language);
    }, language);
    await page.route('**/api/sessions/session_browser_idle/attachments', route => route.fulfill({ status: 503, json: { message: 'Synthetic upload failure' } }));
    await page.goto('/');
    await page.locator('button[data-session-id="session_browser_idle"]').click();
    await page.locator('#prompt-input').fill('Keep this draft while removing a failed attachment');
    await page.locator('#attachment-input').setInputFiles({ name: '这是一份文件名很长的附件-report-with-a-long-name-that-should-not-hide-the-retry-action.txt', mimeType: 'text/plain', buffer: Buffer.from('Attachment layout fixture') });
    const chip = page.locator('.attachment-chip.is-failed');
    await expect(chip).toBeVisible();
    for (const theme of ['retro', 'dark-gold', 'oled-black', 'fresh-light', 'terminal']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const action of ['.attachment-retry', '.attachment-remove']) {
        const geometry = await chip.locator(action).evaluate(el => {
          const box = el.getBoundingClientRect();
          const parent = el.closest('.attachment-chip').getBoundingClientRect();
          return { width: box.width, height: box.height, inside: box.left >= parent.left && box.right <= parent.right && box.top >= parent.top && box.bottom <= parent.bottom, clipped: el.scrollWidth > el.clientWidth };
        });
        expect(geometry.inside).toBe(true);
        expect(geometry.clipped).toBe(false);
        expect(geometry.height).toBeGreaterThanOrEqual(44);
        expect(geometry.width).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'fresh-light'; });
    await fs.mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/attachment-${info.project.name}-${language}.png` });
    await chip.locator('.attachment-remove').click();
    await expect(chip).toHaveCount(0);
    await expect(page.locator('#prompt-input')).toHaveValue('Keep this draft while removing a failed attachment');
  });
}
