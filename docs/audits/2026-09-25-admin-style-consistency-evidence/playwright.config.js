import base from '../../../playwright.config.js';
export default { ...base, testDir: '.', webServer: { ...base.webServer, cwd: new URL('../../../', import.meta.url).pathname }, testMatch: 'capture.spec.js', outputDir: '../../../test-results/admin-style-evidence', projects: base.projects.filter(p => ['desktop', 'mobile-portrait'].includes(p.name)) };
