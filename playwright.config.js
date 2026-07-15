import { defineConfig } from '@playwright/test';

const fixturePort = 41739;

export default defineConfig({
  testDir: './packages/codex-web/test/browser',
  outputDir: './test-results/playwright',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'line',
  use: {
    baseURL: `http://127.0.0.1:${fixturePort}`,
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-compact',
      use: {
        viewport: { width: 320, height: 568 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'mobile-portrait',
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'desktop',
      use: {
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'desktop-portrait',
      use: {
        viewport: { width: 1440, height: 1920 },
      },
    },
    {
      name: 'mobile-landscape',
      use: {
        viewport: { width: 844, height: 390 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: `node packages/codex-web/test/browser/fixture-server.mjs --port=${fixturePort}`,
    url: `http://127.0.0.1:${fixturePort}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
