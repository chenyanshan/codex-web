import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

// Emulate the relevant edge transformation, leaving its runtime unavailable.
// Every ordered dependency (including the recovery timer) must opt out.
for (const path of ['/', '/share/rocket-loader-test']) {
  test(`startup survives an unavailable Rocket Loader at ${path}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/cdn-cgi/**', route => route.abort('failed'));
    await page.route('**/*', async route => {
      if (!route.request().isNavigationRequest()) return route.fallback();
      const response = await route.fetch();
      const html = (await response.text()).replace(/<script\b([^>]*)>/gu, (tag, attributes) => {
        if (/^\s+data-cfasync="false"(?:\s|$)/u.test(attributes)) return tag;
        return `<script type="test-rocketscript"${attributes.replace(/\s+type="[^"]*"/gu, '')}>`;
      }).replace('</body>', '<script src="/cdn-cgi/scripts/test/cloudflare-static/rocket-loader.min.js"></script></body>');
      await route.fulfill({ response, body: html });
    });
    await page.route('**/api/share/rocket-loader-test/session', route => route.fulfill({ status: 404, json: { error: 'not_found' } }));
    await page.addInitScript(() => localStorage.setItem('rocketLoaderDraftSentinel', 'preserve'));
    await page.goto(path);
    if (path === '/') await expect(page.locator('#login-form')).toBeVisible();
    else await expect(page.getByRole('heading', { name: 'Share link unavailable' })).toBeVisible();
    expect(await page.evaluate(() => Boolean(globalThis.CodexWebBoot))).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('rocketLoaderDraftSentinel'))).toBe('preserve');
    expect(errors).toEqual([]);
  });
}
