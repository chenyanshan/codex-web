import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const output = fileURLToPath(new URL('./', import.meta.url));
const base = 'http://127.0.0.1:41743';
const browser = await chromium.launch({ headless: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = { measuredAt: new Date().toISOString(), environment: 'Chromium, isolated fixture, synthetic users/projects/sessions; no real accounts or Codex calls', cases: [] };
const projects = [
  { id: 'project_alpha', cwd: '/Users/test/workspaces/mobile-console', displayName: '移动控制台', enabled: true, activeSessionLimit: 30, showWorkDetailsToMembers: true },
  { id: 'project_beta', cwd: '/Users/test/workspaces/automation-reports', displayName: '自动化报告', enabled: false, activeSessionLimit: 8, showWorkDetailsToMembers: false },
];
const roles = [
  { id: 'role_admin', name: '管理员', isAdmin: true, projectGrants: [] },
  { id: 'role_writer', name: '项目成员', isAdmin: false, projectGrants: [{ projectId: 'project_alpha', canRead: true, canCreate: true, canWrite: true }] },
];
const users = [
  { id: 'user_admin', username: 'admin', email: 'admin@example.test', enabled: true, roleId: 'role_admin', roleIds: ['role_admin'] },
  { id: 'user_member', username: 'project-member', email: 'member@example.test', enabled: true, roleId: 'role_writer', roleIds: ['role_writer'] },
  { id: 'user_disabled', username: 'archived-member', email: 'old@example.test', enabled: false, roleId: '', roleIds: [] },
];
const sessions = [
  { id: 'audit_session_a', title: '修复移动端输入框', ownerUserId: 'user_member', projectId: 'project_alpha', projectDisplayName: '移动控制台', summary: '检查键盘弹起后的输入框与会话导航。', updatedAt: '2026-09-19T03:20:00.000Z' },
  { id: 'audit_session_b', title: '补充部署验收报告', ownerUserId: 'user_admin', projectId: 'project_alpha', projectDisplayName: '移动控制台', summary: '补充离线恢复和部署结果。', updatedAt: '2026-09-19T02:10:00.000Z' },
];
function detail(session) {
  return { mode: 'observer', session: { ...session, readOnly: true, timeline: [
    { id: `${session.id}_u`, kind: 'message', role: 'user', label: 'User', meta: 'history', text: session.summary },
    { id: `${session.id}_a`, kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', phase: 'final_answer', lifecycle: 'completed', text: `已完成：${session.title}。` },
  ], thread: { turns: [] } } };
}
async function setup(viewport = { width: 1440, height: 900 }, options = {}) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 980, isMobile: viewport.width < 980, serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [], assetFailures = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => { if (/\.(js|css)(\?|$)/u.test(response.url()) && response.status() >= 400) assetFailures.push(response.url()); });
  await page.addInitScript(() => {
    localStorage.setItem('codexWebToken', 'isolated-audit-token');
    localStorage.setItem('codexWebLanguage', 'zh-CN');
  });
  await page.route('**/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.__audit = { state, render };` });
  });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { session: { id: 'isolated-admin-session', principal: { mode: 'multi', userId: 'user_admin', username: 'admin', isAdmin: true, roleIds: ['role_admin'] } } } }));
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url());
    if (options.handle && await options.handle(route, url)) return;
    const paths = {
      '/api/admin/settings': { settings: { multiUserEnabled: true } },
      '/api/admin/projects': { items: projects }, '/api/admin/users': { items: users },
      '/api/admin/roles': { items: roles }, '/api/admin/sessions': { items: options.sessions || sessions },
    };
    const session = sessions.find(item => url.pathname === `/api/admin/sessions/${item.id}`);
    const payload = session ? detail(session) : paths[url.pathname];
    if (payload) await route.fulfill({ json: payload }); else await route.fallback();
  });
  await page.goto(base);
  await page.waitForFunction(() => globalThis.__audit?.state.authSession?.id === 'isolated-admin-session');
  const toggle = page.locator('#mobile-sidebar-toggle-button');
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('#open-admin-console-button').click();
  await page.waitForFunction(() => globalThis.__audit?.state.view === 'admin');
  return { context, page, viewport, pageErrors, assetFailures };
}
async function settled(run) { await run.page.waitForFunction(() => !globalThis.__audit.state.admin.loading); }
async function shot(run, file) { await run.page.screenshot({ path: `${output}/${file}`, animations: 'disabled' }); }
async function finish(run, data) {
  results.cases.push({ ...data, viewport: run.viewport, pageErrors: run.pageErrors, assetFailures: run.assetFailures });
  await fs.writeFile(`${output}/browser-checks.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(data));
  await run.context.close();
}
try {
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 }, intermediate: { width: 980, height: 900 }, compact: { width: 320, height: 568 } })) {
    const run = await setup(viewport); await settled(run);
    await shot(run, `${name}-admin-sessions.png`);
    const sessionsGeometry = await run.page.evaluate(() => ({
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      regions: ['.admin-layout', '.admin-content', '.admin-observed-panel', '.admin-observed-placeholder-header .admin-status-badge'].map(selector => {
        const element = document.querySelector(selector);
        if (!element) return { selector, present: false };
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { selector, left: rect.left, right: rect.right, width: rect.width, display: style.display, clippedRightByViewport: Math.max(0, rect.right - innerWidth) };
      }),
    }));
    const titleShown = await run.page.locator('.admin-session-list').innerText();
    await run.page.locator('[data-admin-page="users"]').click();
    await shot(run, `${name}-admin-users.png`);
    const usersGeometry = await run.page.evaluate(() => ({
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      form: (() => { const r = document.querySelector('#admin-user-form').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })(),
      firstUserTop: document.querySelector('.admin-user-row')?.getBoundingClientRect().top,
      inputs: [...document.querySelectorAll('.admin-form input:not([type="checkbox"]), .admin-form select')].map(element => ({ name: element.name, size: getComputedStyle(element).fontSize, height: element.getBoundingClientRect().height })),
      buttons: [...document.querySelectorAll('.admin-user-action-row button')].slice(0, 6).map(element => ({ text: element.textContent, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })),
    }));
    await run.page.locator('[data-admin-page="projects"]').click();
    await shot(run, `${name}-admin-projects.png`);
    await run.page.locator('[data-admin-page="roles"]').click();
    await shot(run, `${name}-admin-roles.png`);
    await finish(run, { name: `layout_${name}`, usersGeometry, sessionsGeometry, sessionTitleDisplayed: titleShown.includes(sessions[0].title) });
  }
  {
    const run = await setup(undefined, { handle: async route => {
      if (route.request().method() !== 'POST') return false;
      await route.fulfill({ status: 409, json: { error: 'project_display_name_conflict', message: 'Display name already exists' } }); return true;
    } }); await settled(run);
    await run.page.locator('[data-admin-page="projects"]').click();
    await run.page.locator('[name="displayName"]').fill('未保存的项目名称');
    await run.page.locator('[name="cwd"]').fill('/Users/test/workspaces/unsaved-project');
    await run.page.locator('[name="enabled"]').uncheck();
    await run.page.locator('#admin-project-form [type="submit"]').click();
    await run.page.waitForFunction(() => Boolean(globalThis.__audit.state.error));
    await shot(run, 'desktop-admin-save-failed.png');
    await finish(run, { name: 'failed_project_save_draft', displayNameAfterFailure: await run.page.locator('[name="displayName"]').inputValue(), cwdAfterFailure: await run.page.locator('[name="cwd"]').inputValue(), enabledBeforeFailure: false, enabledAfterFailure: await run.page.locator('[name="enabled"]').isChecked(), error: await run.page.evaluate(() => __audit.state.error) });
  }
  {
    const run = await setup(); await settled(run);
    await run.page.locator('[data-admin-page="projects"]').click();
    await run.page.locator('[data-admin-edit-project="project_alpha"]').click();
    await run.page.locator('[name="displayName"]').fill('为第一个项目输入的新名称');
    await run.page.locator('[name="cwd"]').fill('/Users/test/workspaces/changed-first-project');
    await run.page.locator('[data-admin-edit-project="project_beta"]').click();
    await shot(run, 'desktop-admin-wrong-edit-draft.png');
    await finish(run, { name: 'switch_edit_target_with_dirty_inputs', editingProjectId: await run.page.evaluate(() => __audit.state.admin.editingProjectId), expectedName: projects[1].displayName, actualName: await run.page.locator('[name="displayName"]').inputValue(), expectedCwd: projects[1].cwd, actualCwd: await run.page.locator('[name="cwd"]').inputValue() });
  }
  {
    let posts = 0, release; const gate = new Promise(resolve => { release = resolve; });
    const run = await setup(undefined, { handle: async route => {
      if (route.request().method() !== 'POST') return false;
      posts++; await gate; await route.fulfill({ status: 409, json: { error: 'synthetic_failure' } }); return true;
    } }); await settled(run);
    await run.page.locator('[data-admin-page="users"]').click();
    await run.page.locator('[name="username"]').fill('synthetic-new-member');
    await run.page.locator('[name="password"]').fill('synthetic-only-password');
    await run.page.locator('#admin-user-form [type="submit"]').click();
    await delay(80);
    const disabledDuringRequest = await run.page.locator('#admin-user-form [type="submit"]').isDisabled();
    await run.page.locator('#admin-user-form [type="submit"]').click();
    await delay(80); const requests = posts; release(); await delay(100);
    await finish(run, { name: 'duplicate_user_submission', disabledDuringRequest, requestsForTwoClicks: requests });
  }
  {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const run = await setup(undefined, { handle: async (route, url) => {
      if (url.pathname !== '/api/admin/sessions/audit_session_a') return false;
      await gate; await route.fulfill({ json: detail(sessions[0]) }); return true;
    } }); await settled(run);
    await run.page.locator('[data-admin-session-id="audit_session_a"]').click();
    await run.page.locator('[data-admin-session-id="audit_session_b"]').click();
    await run.page.waitForFunction(() => __audit.state.sessionId === 'audit_session_b');
    const beforeLateResponse = await run.page.evaluate(() => __audit.state.sessionId);
    release(); await delay(200);
    await shot(run, 'desktop-admin-stale-observer.png');
    await finish(run, { name: 'observer_navigation_race', lastClicked: 'audit_session_b', beforeLateResponse, afterLateResponse: await run.page.evaluate(() => __audit.state.sessionId) });
  }
  {
    const run = await setup(undefined, { handle: async (route, url) => {
      if (url.pathname !== '/api/admin/roles') return false;
      await route.fulfill({ status: 503, json: { error: 'synthetic_roles_unavailable' } }); return true;
    } }); await settled(run);
    await run.page.locator('[data-admin-page="users"]').click();
    await shot(run, 'desktop-admin-partial-failure.png');
    await finish(run, { name: 'one_admin_endpoint_failure', state: await run.page.evaluate(() => ({ loaded: __audit.state.admin.loaded, users: __audit.state.admin.users.length, projects: __audit.state.admin.projects.length, sessions: __audit.state.admin.sessions.length, error: __audit.state.error })) });
  }
  {
    const run = await setup(); await settled(run);
    await run.page.locator('[data-admin-page="projects"]').click();
    await run.page.locator('[name="displayName"]').fill('切页前未保存的内容');
    await run.page.locator('[data-admin-page="roles"]').click();
    await run.page.locator('[data-admin-page="projects"]').click();
    const afterNavigation = await run.page.locator('[name="displayName"]').inputValue();
    await run.page.locator('[data-admin-page="users"]').click();
    await run.page.locator('[data-admin-edit-user="user_admin"]').click();
    await finish(run, { name: 'admin_edit_boundaries', draftAfterTabRoundtrip: afterNavigation, currentAdminEnabledCheckboxDisabled: await run.page.locator('#admin-user-form [name="enabled"]').isDisabled(), currentAdminRoleSelectDisabled: await run.page.locator('#admin-user-role-select').isDisabled() });
  }
  {
    const manySessions = Array.from({ length: 1000 }, (_, index) => ({ ...sessions[index % 2], id: `scale_session_${index}`, summary: `第 ${index + 1} 次移动控制台检查与部署报告`, title: `任务 ${index + 1}` }));
    const run = await setup(undefined, { sessions: manySessions }); await settled(run);
    const cdp = await run.context.newCDPSession(run.page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const measurements = await run.page.evaluate(() => {
      const durations = []; for (let i = 0; i < 4; i++) { const start = performance.now(); __audit.render(); durations.push(performance.now() - start); }
      return { sessions: __audit.state.admin.sessions.length, renderedRows: document.querySelectorAll('.admin-session-row').length, domNodes: document.querySelectorAll('*').length, renderMsAt4xCPU: durations };
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await finish(run, { name: 'admin_1000_sessions_scale', ...measurements });
  }
  {
    const run = await setup(); await settled(run);
    await run.page.locator('[data-admin-page="users"]').click();
    const themes = [];
    await run.page.addStyleTag({ content: '* { transition: none !important; }' });
    for (const theme of ['fresh-light', 'retro', 'terminal', 'dark-gold', 'oled-black']) {
      themes.push(await run.page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const rgba = color => { context.clearRect(0,0,1,1); context.fillStyle = color; context.fillRect(0,0,1,1); return [...context.getImageData(0,0,1,1).data].map((value,index) => index === 3 ? value / 255 : value); };
        const composite = (front, back) => front.slice(0,3).map((value,index) => value * front[3] + back[index] * (1-front[3]));
        const luminance = color => color.map(value => { const c=value/255; return c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4; }).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
        const samples = ['.admin-page-count','.admin-nav-count','.admin-row-meta','.admin-status-badge'].map(selector => {
          const element = document.querySelector(selector); const style = getComputedStyle(element);
          const chain = []; for (let node=element;node;node=node.parentElement) chain.unshift(node);
          const background = chain.reduce((color,node) => composite(rgba(getComputedStyle(node).backgroundColor),color), [255,255,255]);
          const foreground = composite(rgba(style.color),background);
          const a=luminance(foreground), b=luminance(background);
          return { selector, fontSize:style.fontSize, color:style.color, background, contrast:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05) };
        });
        return { theme, samples };
      }, theme));
    }
    await shot(run, 'desktop-admin-oled-users.png');
    await finish(run, { name:'admin_theme_contrast', themes });
  }
} finally { await browser.close(); }
results.sourceSha256 = {};
for (const name of ['app.js', 'admin-ui.js', 'styles.css', 'network-recovery.js', 'session-loader.js']) results.sourceSha256[name] = createHash('sha256').update(await fs.readFile(new URL(`../../../packages/codex-web/public/${name}`, import.meta.url))).digest('hex');
results.completedAt = new Date().toISOString();
await fs.writeFile(`${output}/browser-checks.json`, JSON.stringify(results, null, 2) + '\n');
