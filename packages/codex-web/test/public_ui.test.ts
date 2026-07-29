import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const stylesUrl = new URL('../public/styles.css', import.meta.url);
const appUrl = new URL('../public/app.js', import.meta.url);
const indexUrl = new URL('../public/index.html', import.meta.url);
const manifestUrl = new URL('../public/manifest.webmanifest', import.meta.url);
const serviceWorkerUrl = new URL('../public/service-worker.js', import.meta.url);
const pwaPullRefreshUrl = new URL('../public/pwa-pull-refresh.js', import.meta.url);
const themeInitUrl = new URL('../public/theme-init.js', import.meta.url);

test('mobile UI exposes iOS PWA install metadata and registers a service worker', async () => {
  const [index, app, manifest, serviceWorker, themeInit] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(manifestUrl, 'utf8'),
    readFile(serviceWorkerUrl, 'utf8'),
    readFile(themeInitUrl, 'utf8'),
  ]);
  const parsedManifest = JSON.parse(manifest);

  assert.equal(parsedManifest.name, 'Codex Web');
  assert.equal(parsedManifest.short_name, 'Codex');
  assert.equal(parsedManifest.display, 'standalone');
  assert.equal(parsedManifest.orientation, undefined);
  assert.equal(parsedManifest.start_url, '/');
  assert.equal(parsedManifest.theme_color, '#f8f3e3');
  assert.equal(parsedManifest.background_color, '#f8f3e3');
  assert.match(index, /<link rel="manifest" href="\/manifest\.webmanifest\?v=__CODEX_WEB_BUILD_ID__">/u);
  assert.match(index, /<link rel="icon" href="\/icon-192\.png\?v=__CODEX_WEB_BUILD_ID__" type="image\/png">/u);
  assert.match(index, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png\?v=__CODEX_WEB_BUILD_ID__">/u);
  assert.match(index, /<meta name="theme-color" content="#f8f3e3">/u);
  assert.match(index, /<script src="\/theme-init\.js\?v=__CODEX_WEB_BUILD_ID__"><\/script>\s*<link rel="stylesheet"/u);
  assert.doesNotMatch(index, /screen-orientation|x5-orientation/u);
  assert.match(index, /<meta name="apple-mobile-web-app-capable" content="yes">/u);
  assert.match(index, /<meta name="apple-mobile-web-app-title" content="Codex">/u);
  assert.deepEqual(parsedManifest.icons.map((icon) => icon.src), ['/icon-192.png', '/icon-512.png']);
  assert.deepEqual(parsedManifest.icons.map((icon) => icon.type), ['image/png', 'image/png']);
  assert.deepEqual(parsedManifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']);
  assert.match(app, /navigator\.serviceWorker\.register\('\/service-worker\.js'\)/u);
  assert.match(app, /const APP_BUILD_ID = '__CODEX_WEB_BUILD_ID__';/u);
  assert.match(serviceWorker, /codex-web-static-__CODEX_WEB_BUILD_ID__/u);
  assert.doesNotMatch(app, /runtime-status-v37/u);
  assert.doesNotMatch(serviceWorker, /runtime-status-v37/u);
  assert.match(serviceWorker, /'\/icon-192\.png'/u);
  assert.match(serviceWorker, /'\/theme-init\.js'/u);
  assert.match(serviceWorker, /'\/icon-512\.png'/u);
  assert.match(serviceWorker, /'\/apple-touch-icon\.png'/u);
  assert.match(serviceWorker, /self\.addEventListener\('install'/u);
  assert.match(serviceWorker, /self\.addEventListener\('fetch'/u);
  assert.doesNotMatch(serviceWorker, /cached \|\| fetch\(request\)/u);
  assert.match(serviceWorker, /fetch\(request\)/u);
  assert.match(serviceWorker, /cache\.put\(request, response\.clone\(\)\)/u);
  assert.match(serviceWorker, /VERSIONED_STATIC_ASSET_PATHS\.has\(url\.pathname\)/u);
  assert.match(serviceWorker, /url\.searchParams\.get\('v'\)/u);
  assert.match(themeInit, /let theme = 'sunny'/u);
  assert.match(themeInit, /document\.documentElement\.dataset\.theme = theme/u);
});

test('PWA checks app version on foreground to escape stale standalone caches', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /const APP_BUILD_ID = /u);
  assert.match(app, /setupAppVersionRefresh\(\)/u);
  assert.match(app, /function checkForAppUpdate\(\)/u);
  assert.match(app, /fetch\('\/version\.json', \{ cache: 'no-store' \}\)/u);
  assert.match(app, /const payload = await response\.json\(\)/u);
  assert.match(app, /appVersionCheckPromise/u);
  assert.match(app, /APP_VERSION_CHECK_COOLDOWN_MS/u);
  assert.doesNotMatch(app, /version-check=\$\{Date\.now\(\)\}/u);
  assert.match(app, /window\.location\.reload\(\)/u);
});

test('PWA version checks share one request across duplicate foreground events', async () => {
  const fetchCalls: string[] = [];
  let releaseFetch: ((response: unknown) => void) | null = null;
  const { api, context } = await loadAppHarness({
    fetch: async (path: string) => {
      fetchCalls.push(path);
      return await new Promise((resolve) => {
        releaseFetch = resolve;
      });
    },
  });
  context.navigator.standalone = true;

  const first = api.checkForAppUpdate();
  const duplicate = api.checkForAppUpdate();

  assert.deepEqual(fetchCalls, ['/version.json']);
  assert.equal(first, duplicate);
  assert.equal(typeof releaseFetch, 'function');
  releaseFetch?.({
    ok: true,
    json: async () => ({ buildId: '__CODEX_WEB_BUILD_ID__' }),
  });
  await Promise.all([first, duplicate]);
  await api.checkForAppUpdate();
  assert.deepEqual(fetchCalls, ['/version.json']);
});

test('rerendered element listeners use abortable render and timeline lifecycles', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function beginRenderEventBindings\(\) \{[\s\S]*renderEventController\?\.abort\(\);[\s\S]*timelineEventController\?\.abort\(\);/u);
  assert.match(app, /function listenRendered\([\s\S]*renderEventController\?\.signal/u);
  assert.match(app, /function listenTimeline\([\s\S]*timelineEventController\?\.signal/u);
  assert.match(app, /function listenWithSignal\([\s\S]*target\.addEventListener\(type, listener, normalizedOptions\)/u);
  assert.match(app, /function refreshChatDynamicUi\([^)]*\)[\s\S]*beginTimelineEventBindings\(\);[\s\S]*updateTimelineProjectionDom/u);
  assert.match(app, /if \(!updateTimelineProjectionDom\([\s\S]*timeline\.innerHTML = renderTimeline\(\)/u);
});

test('mobile UI leaves device orientation under user control', async () => {
  const lockCalls: string[] = [];
  await loadAppHarness({
    screen: {
      orientation: {
        lock: async (orientation: string) => {
          lockCalls.push(orientation);
        },
      },
    },
  });

  await flushMicrotasks();

  assert.deepEqual(lockCalls, []);
});

test('desktop UI also leaves device orientation under user control', async () => {
  const lockCalls: string[] = [];
  await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    screen: {
      orientation: {
        lock: async (orientation: string) => {
          lockCalls.push(orientation);
        },
      },
    },
  });

  await flushMicrotasks();

  assert.deepEqual(lockCalls, []);
});

test('mobile landscape remains supported without a fallback screen', async () => {
  const [index, styles] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.doesNotMatch(index, /orientation-lock-fallback/u);
  assert.doesNotMatch(styles, /orientation-lock-fallback/u);
  assert.doesNotMatch(styles, /orientation-lock-panel/u);
});

test('new sessions inherit Codex model settings until this device overrides them', async () => {
  const { api } = await loadAppHarness();

  assert.equal(api.state.model, '');
  assert.equal(api.state.reasoningEffort, '');
  assert.equal(api.state.permissionPreset, 'full-access');
  assert.equal(api.state.approvalPolicy, 'never');
  assert.equal(api.state.sandboxMode, 'danger-full-access');
  assert.equal(
    JSON.stringify(api.collectSettings()),
    JSON.stringify({
      model: null,
      reasoningEffort: null,
      collaborationMode: 'default',
      accessPreset: 'full-access',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      personality: 'pragmatic',
    }),
  );
});

test('ordinary trusted multi-user UI keeps full access available and selected by default', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = {
    id: 'auth_1',
    principal: { userId: 'user_1', isAdmin: false, mode: 'multi' },
  };

  api.applyDefaultThreadSettings({ accessPreset: 'default' });
  assert.equal(api.state.permissionPreset, 'default');
  api.applyDefaultThreadSettings({ accessPreset: 'full-access' });

  assert.deepEqual(JSON.parse(JSON.stringify(api.collectSettings())), {
    model: null,
    reasoningEffort: null,
    collaborationMode: 'default',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    personality: 'pragmatic',
  });
  assert.match(api.renderSettingsDrawer(), /data-permission-preset="full-access" aria-pressed="true"/u);
  assert.match(api.renderAppSettings().innerHTML, /data-default-permission-preset="full-access" aria-pressed="true"/u);
});

test('first-run default thread settings initialize from effective Codex config defaults', async () => {
  const { api, storage } = await loadAppHarness({
    fetch: async (path: string) => {
      if (path === '/api/auth/me') {
        return { ok: true, status: 200, json: async () => ({ session: { id: 'auth_1' } }) };
      }
      if (path === '/api/settings') {
        return { ok: true, status: 200, json: async () => ({ settings: {}, permissions: {} }) };
      }
      if (path === '/api/models') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            defaults: {
              model: 'gpt-5.6-sol',
              reasoningEffort: 'ultra',
            },
            items: [
              {
                id: 'gpt-5.6-sol',
                model: 'gpt-5.6-sol',
                displayName: 'GPT-5.6-Sol',
                isDefault: true,
                supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
                defaultReasoningEffort: 'low',
              },
              {
                id: 'gpt-5.5-mini',
                model: 'gpt-5.5-mini',
                displayName: 'GPT 5.5 Mini',
                isDefault: false,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: 'medium',
              },
            ],
          }),
        };
      }
      if (path === '/api/projects' || path === '/api/sessions') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  await api.restoreAuth();

  assert.equal(api.state.defaultThreadSettings.model, 'gpt-5.6-sol');
  assert.equal(api.state.defaultThreadSettings.reasoningEffort, 'ultra');
  assert.equal(api.state.model, 'gpt-5.6-sol');
  assert.equal(api.state.reasoningEffort, 'ultra');
  assert.equal(storage.get('codexWebDefaultThreadSettings'), undefined);
});

test('legacy gpt-5.4 browser defaults migrate once to effective Codex config defaults', async () => {
  const legacyDefaults = {
    model: 'gpt-5.4',
    reasoningEffort: 'xhigh',
    collaborationMode: 'default',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    personality: 'pragmatic',
  };
  const { api, storage } = await loadAppHarness({
    storage: { codexWebDefaultThreadSettings: JSON.stringify(legacyDefaults) },
    fetch: createRestoreAuthFetch({
      models: [{
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        isDefault: true,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        defaultReasoningEffort: 'low',
      }],
      defaults: { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' },
    }),
  });

  api.state.token = 'token';
  await api.restoreAuth();

  assert.equal(api.state.defaultThreadSettings.model, 'gpt-5.6-sol');
  assert.equal(api.state.defaultThreadSettings.reasoningEffort, 'ultra');
  assert.equal(storage.get('codexWebDefaultThreadSettingsVersion'), '2');
});

test('failed model-default reads do not permanently skip the legacy browser migration', async () => {
  const legacyDefaults = {
    model: 'gpt-5.4',
    reasoningEffort: 'xhigh',
    collaborationMode: 'default',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    personality: 'pragmatic',
  };
  const { api, storage } = await loadAppHarness({
    storage: { codexWebDefaultThreadSettings: JSON.stringify(legacyDefaults) },
    fetch: createRestoreAuthFetch({ models: [], defaults: null }),
  });
  api.state.token = 'token';

  await api.restoreAuth();

  assert.equal(api.state.defaultThreadSettings.model, 'gpt-5.4');
  assert.equal(storage.get('codexWebDefaultThreadSettingsVersion'), undefined);
});

test('legacy active-session defaults follow the effective Codex project model', async () => {
  const currentSession = {
    id: 'session_legacy_model',
    cwd: '/repo',
    settings: {
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      collaborationMode: 'default',
      accessPreset: 'full-access',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    },
  };
  const { api } = await loadAppHarness({
    fetch: createRestoreAuthFetch({
      sessions: [currentSession],
      models: [{
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        isDefault: true,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        defaultReasoningEffort: 'low',
      }],
      defaults: { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' },
    }),
  });
  api.state.token = 'token';
  api.state.sessionId = currentSession.id;
  api.state.currentSession = currentSession;

  await api.restoreAuth();

  assert.equal(api.state.model, 'gpt-5.6-sol');
  assert.equal(api.state.reasoningEffort, 'ultra');
  assert.equal(api.collectSettings().model, 'gpt-5.6-sol');
  assert.equal(api.collectSettings().reasoningEffort, 'ultra');
});

test('active session settings stay authoritative over this device new-session defaults', async () => {
  const deviceDefaults = {
    model: 'gpt-5.4-mini',
    reasoningEffort: 'medium',
    collaborationMode: 'default',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    personality: 'pragmatic',
  };
  const currentSession = {
    id: 'session_current',
    cwd: '/repo',
    settings: {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
      collaborationMode: 'default',
      accessPreset: 'full-access',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    },
  };
  const { api } = await loadAppHarness({
    storage: {
      codexWebDefaultThreadSettings: JSON.stringify(deviceDefaults),
      codexWebDefaultThreadSettingsVersion: '2',
    },
    fetch: createRestoreAuthFetch({
      sessions: [currentSession],
      models: [{
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        isDefault: true,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        defaultReasoningEffort: 'low',
      }],
      defaults: { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' },
    }),
  });
  api.state.token = 'token';
  api.state.sessionId = currentSession.id;
  api.state.currentSession = currentSession;

  await api.restoreAuth();

  assert.equal(api.state.defaultThreadSettings.model, 'gpt-5.4-mini');
  assert.equal(api.state.reasoningEffort, 'ultra');
  assert.equal(api.state.model, 'gpt-5.6-sol');
  assert.match(api.renderSettingsDrawer(), /<option value="gpt-5\.6-sol" selected/u);
  assert.match(api.renderSettingsDrawer(), /<option value="ultra" selected/u);
});

test('saved Codex Web default thread settings override Codex model defaults', async () => {
  const savedDefaults = {
    model: 'gpt-5.4-mini',
    reasoningEffort: 'medium',
    collaborationMode: 'plan',
    accessPreset: 'default',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    personality: 'pragmatic',
  };
  const { api, storage } = await loadAppHarness({
    storage: {
      codexWebDefaultThreadSettings: JSON.stringify(savedDefaults),
    },
    fetch: async (path: string) => {
      if (path === '/api/auth/me') {
        return { ok: true, status: 200, json: async () => ({ session: { id: 'auth_1' } }) };
      }
      if (path === '/api/settings') {
        return { ok: true, status: 200, json: async () => ({ settings: {}, permissions: {} }) };
      }
      if (path === '/api/models') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{
              id: 'gpt-5.5',
              model: 'gpt-5.5',
              displayName: 'GPT 5.5',
              isDefault: true,
              supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
              defaultReasoningEffort: 'xhigh',
            }],
          }),
        };
      }
      if (path === '/api/projects' || path === '/api/sessions') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  await api.restoreAuth();
  api.applyDefaultSettings();

  assert.deepEqual(JSON.parse(JSON.stringify(api.state.defaultThreadSettings)), savedDefaults);
  assert.equal(api.state.model, 'gpt-5.4-mini');
  assert.equal(api.state.reasoningEffort, 'medium');
  assert.equal(storage.get('codexWebDefaultThreadSettings'), JSON.stringify(savedDefaults));
});

test('saved gpt-5.6-sol ultra defaults seed the new session request', async () => {
  let createBody = null;
  const savedDefaults = {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
    collaborationMode: 'default',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    personality: 'pragmatic',
  };
  const { api } = await loadAppHarness({
    storage: {
      codexWebDefaultThreadSettings: JSON.stringify(savedDefaults),
    },
    fetch: async (path, options = {}) => {
      if (path === '/api/sessions' && options.method === 'POST') {
        createBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_ultra',
              cwd: '/repo',
              settings: createBody.settings,
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.cwd = '/repo';
  api.state.models = [{
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6-Sol',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    defaultReasoningEffort: 'low',
  }];
  api.applyDefaultSettings();

  await api.ensureSession();

  assert.equal(createBody.settings.model, 'gpt-5.6-sol');
  assert.equal(createBody.settings.reasoningEffort, 'ultra');
});

test('new sessions apply the effective model returned by the backend before the first turn', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      assert.equal(path, '/api/sessions');
      assert.equal(options.method, 'POST');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_effective',
            cwd: '/repo',
            settings: {
              model: 'gpt-5.6-sol',
              reasoningEffort: 'ultra',
              collaborationMode: 'default',
              accessPreset: 'full-access',
              approvalPolicy: 'never',
              sandboxMode: 'danger-full-access',
            },
          },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.cwd = '/repo';
  api.state.model = '';
  api.state.reasoningEffort = '';

  await api.ensureSession();

  assert.equal(api.state.model, 'gpt-5.6-sol');
  assert.equal(api.state.reasoningEffort, 'ultra');
});

test('opening a session applies its persisted settings to controls', async () => {
  const { api } = await loadAppHarness();

  api.applySessionSettings({
    settings: {
      model: 'gpt-5',
      reasoningEffort: 'high',
      collaborationMode: 'plan',
      accessPreset: 'read-only',
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
    },
  });

  assert.equal(api.state.model, 'gpt-5');
  assert.equal(api.state.reasoningEffort, 'high');
  assert.equal(api.state.collaborationMode, 'plan');
  assert.equal(api.state.permissionPreset, 'read-only');
  assert.equal(api.state.approvalPolicy, 'never');
  assert.equal(api.state.sandboxMode, 'read-only');
});

test('changing existing session settings patches the session settings endpoint', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_settings',
            cwd: '/repo',
            settings: JSON.parse(options.body),
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.sessionId = 'session_settings';
  api.state.currentSession = { id: 'session_settings', cwd: '/repo', settings: {} };
  api.state.sessions = [api.state.currentSession];

  await api.updateSessionSettings({ model: 'gpt-5-mini', reasoningEffort: 'low' });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.path, '/api/sessions/session_settings/settings');
  assert.equal(fetchCalls[0]?.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(fetchCalls[0]?.options.body), {
    model: 'gpt-5-mini',
    reasoningEffort: 'low',
    collaborationMode: 'default',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    personality: 'pragmatic',
  });
});

test('repeat opens with a stored token render the app shell before auth verification finishes', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function createCachedAuthSession\(\)/u);
  assert.match(app, /state\.authSession = createCachedAuthSession\(\);/u);
  assert.match(app, /state\.authSession = createCachedAuthSession\(\);\s*state\.sessionsLoading = true;\s*state\.sessionsLoadingScope = currentSessionScope\(\);/u);
  assert.match(app, /function bootstrap\(\)[\s\S]*void restoreAuth\(\);/u);
  assert.doesNotMatch(app, /function bootstrap\(\)\s*\{(?:(?!\n\}\n\nasync function restoreAuth).)*await restoreAuth\(\);/su);
  assert.match(app, /function onLoginSubmit\(event\)[\s\S]*state\.authSession = payload\.session \|\| createCachedAuthSession\(\);/u);
  assert.match(app, /state\.authSession = payload\.session \|\| createCachedAuthSession\(\);\s*state\.sessionsLoading = true;\s*state\.sessionsLoadingScope = currentSessionScope\(\);/u);
  assert.match(app, /function onLoginSubmit\(event\)[\s\S]*void restoreAuth\(\);/u);
  assert.doesNotMatch(app, /function onLoginSubmit\(event\)\s*\{(?:(?!\n\}\n\nasync function onLogout).)*await restoreAuth\(\);/su);
  assert.doesNotMatch(app, /name="deviceName"/u);
  assert.doesNotMatch(app, /form\.get\('deviceName'\)/u);
});

test('bootstrap restores the last cached conversation before auth verification resolves', async () => {
  let authRequested = false;
  const session = {
    id: 'session_cached_boot',
    cwd: '/repo/cached',
    firstUserInput: 'Cached question',
    updatedAt: 10,
    settings: { metadata: {} },
  };
  const cachedAnswer = {
    id: 'cached_answer',
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    meta: 'final',
    text: 'Cached answer before auth',
  };
  const { api, context } = await loadAppHarness({
    storage: {
      codexWebToken: 'token',
      codexWebSessionsCache: JSON.stringify({ scopes: { all: [session] } }),
      codexWebWorkspaceState: JSON.stringify({ view: 'chat', sessionId: session.id }),
      codexWebTimelineCache: JSON.stringify({
        version: 3,
        entries: [{
          sessionId: session.id,
          savedAt: 10,
          timeline: [cachedAnswer],
          history: [cachedAnswer],
          historyComplete: true,
          batches: [],
          approvals: [],
        }],
      }),
    },
    fetch: async (path) => {
      assert.equal(path, '/api/auth/me');
      authRequested = true;
      return await new Promise(() => {});
    },
  });

  assert.equal(authRequested, true);
  assert.equal(api.state.sessionId, session.id);
  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.timeline[0]?.text, 'Cached answer before auth');
  assert.match(context.document.querySelector('#app').innerHTML, /Cached answer before auth/u);
});

test('bootstrap hides cached work details until auth confirms the principal', async () => {
  let resolveAuth: ((response: unknown) => void) | null = null;
  const session = {
    id: 'session_cached_private',
    cwd: '/repo/private',
    projectId: 'project_private',
    firstUserInput: 'Public question',
    updatedAt: 10,
    settings: { metadata: {} },
  };
  const cachedTimeline = [
    { id: 'cached_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Public question' },
    { id: 'cached_commentary', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'commentary', text: 'PRIVATE_COMMENTARY' },
    { id: 'cached_final', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text: 'Public final answer' },
    { id: 'cached_error', kind: 'message', role: 'system', label: 'Error', meta: 'failed', severity: 'error', text: 'PRIVATE_STACK' },
    {
      id: 'approval_private',
      kind: 'approval',
      approvalId: 'approval_private',
      approvalKind: 'command',
      turnId: 'turn_private',
      summary: { command: 'cat /private/secret.txt' },
      resolved: false,
    },
  ];
  const privateBatch = {
    id: 'batch_private',
    kind: 'batch',
    turnId: 'turn_private',
    batchId: 'batch_private',
    batchKind: 'command',
    title: 'cat /private/secret.txt',
    status: 'completed',
    summary: { output: 'PRIVATE_COMMAND_OUTPUT' },
  };
  const { api, context, storage } = await loadAppHarness({
    storage: {
      codexWebToken: 'token',
      codexWebSessionsCache: JSON.stringify({ scopes: { all: [session] } }),
      codexWebWorkspaceState: JSON.stringify({ view: 'chat', sessionId: session.id }),
      codexWebTimelineCache: JSON.stringify({
        version: 3,
        entries: [{
          sessionId: session.id,
          savedAt: 10,
          timeline: cachedTimeline,
          history: cachedTimeline,
          historyComplete: true,
          batches: [['batch_private', privateBatch]],
          approvals: [['approval_private', cachedTimeline.at(-1)]],
        }],
      }),
    },
    fetch: async (path) => {
      if (path === '/api/auth/me') {
        return await new Promise((resolve) => {
          resolveAuth = resolve;
        });
      }
      if (path === '/api/settings') {
        return { ok: true, status: 200, json: async () => ({ settings: {}, permissions: {} }) };
      }
      if (path === '/api/models') {
        return { ok: true, status: 200, json: async () => ({ items: [], defaults: null }) };
      }
      if (path === '/api/projects') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/sessions') {
        return { ok: true, status: 200, json: async () => ({ items: [session] }) };
      }
      if (path === `/api/sessions/${session.id}/status`) {
        return { ok: true, status: 200, json: async () => ({ session }) };
      }
      if (path === `/api/sessions/${session.id}/timeline?limit=50`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: cachedTimeline.filter((item) => item.kind === 'message'), hasMore: false, nextBefore: null }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  const bootstrapHtml = context.document.querySelector('#app').innerHTML;
  assert.match(bootstrapHtml, /Public question/u);
  assert.match(bootstrapHtml, /Public final answer/u);
  assert.doesNotMatch(bootstrapHtml, /PRIVATE_COMMENTARY|PRIVATE_STACK|private\/secret/u);
  assert.equal(api.state.batches.size, 0);
  assert.equal(api.state.approvals.size, 0);
  assert.match(storage.get('codexWebTimelineCache') || '', /PRIVATE_COMMENTARY|PRIVATE_COMMAND_OUTPUT/u);

  resolveAuth?.({
    ok: true,
    status: 200,
    json: async () => ({ session: { id: 'auth_single', principal: { mode: 'single', isAdmin: false } } }),
  });
  await flushMicrotasks();
  await flushMicrotasks();

  assert.match(JSON.stringify(api.state.timeline), /PRIVATE_COMMENTARY/u);
  assert.match(JSON.stringify([...api.state.batches.values()]), /PRIVATE_COMMAND_OUTPUT/u);
});

test('bootstrap restores cached activity and reconnects SSE from the persisted cursor before auth', async () => {
  const fetchCalls: Array<{ path: string; options: Record<string, unknown> }> = [];
  const session = {
    id: 'session_cached_running',
    cwd: '/repo/cached',
    firstUserInput: 'Keep working',
    updatedAt: 20,
    activeTurnId: 'turn_cached',
    activityState: 'running',
    settings: { metadata: {} },
  };
  const cachedMessage = {
    id: 'cached_user',
    kind: 'message',
    role: 'user',
    label: 'You',
    meta: 'history',
    text: 'Keep working',
  };
  const { api } = await loadAppHarness({
    storage: {
      codexWebToken: 'token',
      codexWebSessionsCache: JSON.stringify({ scopes: { all: [session] } }),
      codexWebWorkspaceState: JSON.stringify({ view: 'chat', sessionId: session.id }),
      codexWebTimelineCache: JSON.stringify({
        version: 3,
        entries: [{
          sessionId: session.id,
          savedAt: 20,
          timeline: [cachedMessage],
          history: [cachedMessage],
          historyComplete: false,
          batches: [],
          approvals: [],
          streamCursor: { turnId: 'turn_cached', epoch: 'epoch_cached', sequence: 37 },
        }],
      }),
    },
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/auth/me') {
        return await new Promise(() => {});
      }
      if (path === '/api/turns/turn_cached/events?after=37&epoch=epoch_cached') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'epoch_cached' },
          body: {
            getReader: () => ({ read: async () => await new Promise(() => {}) }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  await flushMicrotasks();

  assert.equal(api.state.currentSession?.activityState, 'running');
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_cached');
  assert.equal(api.state.lastTurnEventSequence, 37);
  assert.equal(api.state.lastTurnEventEpoch, 'epoch_cached');
  assert.ok(fetchCalls.some((call) => call.path === '/api/turns/turn_cached/events?after=37&epoch=epoch_cached'));
});

test('auth restore keeps the active turn status instead of reporting Ready', async () => {
  const session = {
    id: 'session_auth_running',
    cwd: '/repo/running',
    activeTurnId: 'turn_auth_running',
    activityState: 'running',
    settings: { metadata: {} },
  };
  const { api } = await loadAppHarness({
    fetch: createRestoreAuthFetch({ sessions: [session] }),
  });
  api.state.token = 'token';
  api.state.sessionId = session.id;
  api.state.currentSession = session;

  await api.restoreAuth();

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_auth_running');
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.state.statusTone, 'warn');
  assert.equal(api.composerStatusLabel(), 'Working');
});

test('startup SSE drops approval details and replays them after the principal is confirmed', async () => {
  const fetchCalls: string[] = [];
  let releasePendingRead: ((result: unknown) => void) | null = null;
  let finishReplay: (() => void) | null = null;
  const replayFinished = new Promise<void>((resolve) => {
    finishReplay = resolve;
  });
  const batchEvent = {
    id: 'event_batch_private',
    type: 'batch.started',
    turnId: 'turn_pending_auth',
    batchId: 'batch_private',
    kind: 'command',
    title: 'cat /private/startup-secret.txt',
    sequence: 11,
  };
  const approvalEvent = {
    id: 'event_approval_private',
    type: 'approval.requested',
    turnId: 'turn_pending_auth',
    approvalId: 'approval_private',
    approvalKind: 'command',
    summary: {
      command: 'rm /private/startup-secret.txt',
      grantRoot: '/private',
      fileReadPermissions: ['/private/startup-secret.txt'],
      output: 'STARTUP_APPROVAL_SECRET',
    },
    sequence: 12,
  };
  const finalEvent = {
    id: 'event_final_safe',
    type: 'assistant.final',
    turnId: 'turn_pending_auth',
    itemId: 'item_final_safe',
    text: 'Safe final answer',
    sequence: 13,
  };
  const initialFrames = [batchEvent, approvalEvent, finalEvent]
    .map((event) => `id: ${event.sequence}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  const replayControl = {
    type: 'stream.reset',
    reset: true,
    epoch: 'epoch_pending_auth',
    snapshot: {
      complete: true,
      throughSequence: 13,
      events: [batchEvent, approvalEvent, finalEvent],
    },
  };
  let requestCount = 0;
  const { api, storage } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      requestCount += 1;
      if (requestCount === 1) {
        let readCount = 0;
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'epoch_pending_auth' },
          body: {
            getReader: () => ({
              read: async () => {
                if (readCount === 0) {
                  readCount += 1;
                  return { done: false, value: new TextEncoder().encode(initialFrames) };
                }
                return await new Promise((resolve) => {
                  releasePendingRead = resolve;
                });
              },
            }),
          },
        };
      }
      let readCount = 0;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'epoch_pending_auth' },
        body: {
          getReader: () => ({
            read: async () => {
              if (readCount === 0) {
                readCount += 1;
                return {
                  done: false,
                  value: new TextEncoder().encode(`event: control\ndata: ${JSON.stringify(replayControl)}\n\n`),
                };
              }
              finishReplay?.();
              return { done: true };
            },
          }),
        },
      };
    },
  });
  const safeUser = { id: 'user_safe', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Continue' };
  api.state.token = 'token';
  api.state.authSession = { id: 'cached' };
  api.state.sessionId = 'session_pending_auth';
  api.state.currentSession = { id: 'session_pending_auth', cwd: '/repo', settings: { metadata: {} } };
  api.state.sessions = [api.state.currentSession];
  api.state.timeline = [safeUser];
  api.state.sessionHistoryItems = [safeUser];
  api.state.turnId = 'turn_pending_auth';
  api.state.pendingTurn = true;
  api.state.lastTurnEventSequence = 10;
  api.state.lastTurnEventEpoch = 'epoch_pending_auth';
  api.state.timelineCache.set('session_pending_auth', {
    savedAt: 1,
    timeline: [safeUser],
    history: [safeUser],
    historyComplete: false,
    batches: new Map(),
    approvals: new Map(),
    streamCursor: { turnId: 'turn_pending_auth', sequence: 10, epoch: 'epoch_pending_auth' },
  });

  const pendingStream = api.streamTurnEvents('turn_pending_auth');
  await flushMicrotasks();

  assert.equal(api.state.lastTurnEventSequence, 10);
  assert.equal(api.state.batches.size, 0);
  assert.equal(api.state.approvals.size, 0);
  assert.doesNotMatch(JSON.stringify(api.state.timeline), /startup-secret|STARTUP_APPROVAL_SECRET/u);
  assert.doesNotMatch(storage.get('codexWebTimelineCache') || '', /startup-secret|STARTUP_APPROVAL_SECRET/u);

  api.state.authSession = { id: 'auth_single', principal: { mode: 'single', isAdmin: false } };
  api.enforceCurrentWorkDetailsAccess();
  await replayFinished;
  await flushMicrotasks();

  assert.equal(fetchCalls[0], '/api/turns/turn_pending_auth/events?after=10&epoch=epoch_pending_auth');
  assert.equal(fetchCalls[1], '/api/turns/turn_pending_auth/events');
  assert.equal(api.state.lastTurnEventSequence, 13);
  assert.match(JSON.stringify([...api.state.batches.values()]), /startup-secret/u);
  assert.match(JSON.stringify([...api.state.approvals.values()]), /STARTUP_APPROVAL_SECRET/u);
  releasePendingRead?.({ done: true });
  await pendingStream;
  api.state.pendingTurn = false;
});

test('desktop list and settings views preserve the active session workspace for reload', async () => {
  const { api, storage } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_desktop_restore';
  api.state.currentSession = { id: 'session_desktop_restore', cwd: '/repo', settings: { metadata: {} } };
  api.state.sessions = [api.state.currentSession];

  api.showSessionList();
  let persisted = JSON.parse(storage.get('codexWebWorkspaceState'));
  assert.equal(persisted.view, 'chat');
  assert.equal(persisted.sessionId, 'session_desktop_restore');

  api.openAppSettingsPage();
  persisted = JSON.parse(storage.get('codexWebWorkspaceState'));
  assert.equal(persisted.view, 'chat');
  assert.equal(persisted.sessionId, 'session_desktop_restore');
});

test('login form supports optional username for multi-user mode', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /name="username"/u);
  assert.match(app, /autocomplete="username"/u);
  assert.match(app, /const username = String\(form\.get\('username'\) \|\| ''\);/u);
  assert.match(app, /body: \{ username, password \}/u);
});

test('login page uses the bootstrap global website title before auth', async () => {
  const { api, context } = await loadAppHarness({
    bootstrapSiteTitle: 'Team Codex',
  });

  assert.equal(api.state.siteTitle, 'Team Codex');
  assert.equal(context.document.title, 'Team Codex');
  const html = context.document.querySelector('#app').innerHTML;
  assert.match(html, /<h1>Team Codex<\/h1>/u);
  assert.doesNotMatch(html, /<h1>Codex Web<\/h1>/u);
});

test('admin settings page shows the multi-user toggle without nesting the admin console entry', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true, mode: 'multi' } };
  api.state.view = 'settings';
  api.state.admin.settings = { multiUserEnabled: true };
  api.render();

  const html = api.context.document.querySelector('#app').innerHTML;
  assert.match(html, /id="admin-multi-user-toggle" type="checkbox" checked/u);
  assert.doesNotMatch(html, /id="open-admin-settings-button"/u);
});

test('opening app settings loads admin settings when the toggle state is not cached yet', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/webhook') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            webhook: {
              enabled: false,
              hasKey: false,
              keyHint: '',
              endpointPath: '/api/webhook',
            },
          }),
        };
      }
      if (path === '/api/admin/settings') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ settings: { multiUserEnabled: true } }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true, mode: 'multi' } };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  api.openAppSettingsPage();
  await flushMicrotasks();

  assert.deepEqual(fetchCalls, ['/api/webhook', '/api/admin/settings']);
  assert.equal(api.state.admin.settings?.multiUserEnabled, true);
  assert.match(api.context.document.querySelector('#app').innerHTML, /id="admin-multi-user-toggle" type="checkbox" checked/u);
});

test('admin console uses the session-list back navigation', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };

  const html = api.renderAdminConsole().innerHTML;
  assert.match(html, /id="back-to-list-button"/u);
  assert.doesNotMatch(html, /id="back-to-settings-button"/u);
});

test('admin console uses a page-level mobile scroll container for long management screens', async () => {
  const [styles, { api }] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    loadAppHarness(),
  ]);

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };

  const html = api.renderAdminConsole().innerHTML;
  assert.match(html, /class="screen page-screen admin-console-screen"/u);
  assert.match(styles, /\.admin-console-screen\s*\{[^}]*overflow-y:\s*auto;[^}]*-webkit-overflow-scrolling:\s*touch;/su);
  assert.match(styles, /\.admin-console-page\s*\{[^}]*overflow:\s*visible;/su);
});

test('restore auth also loads project display names for new sessions', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session: { id: 'auth_1', principal: { userId: 'user_1', isAdmin: false } } }),
        };
      }
      if (path === '/api/models') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/projects') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ id: 'project_a', displayName: 'Project Alpha' }] }),
        };
      }
      if (path === '/api/sessions') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';

  await api.restoreAuth();

  assert.equal(fetchCalls.includes('/api/projects'), true);
  assert.equal(JSON.stringify(api.state.projects), JSON.stringify([{ id: 'project_a', displayName: 'Project Alpha', favorite: false }]));
  assert.equal(api.state.projectsLoaded, true);
});

test('new session form uses project display names and posts selected project id', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            session: {
              id: 'session_project',
              projectId: 'project_a',
              projectDisplayName: 'Project Alpha',
              settings: {},
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = {
    id: 'auth_1',
    principal: {
      userId: 'user_1',
      username: 'viewer',
      roleIds: ['role_viewer'],
      isAdmin: false,
      mode: 'multi',
    },
  };
  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha' },
    { id: 'project_b', displayName: 'Project Beta' },
  ];
  api.state.projectsLoaded = true;
  api.state.newProjectId = 'project_b';

  const html = api.renderNewSession().innerHTML;
  assert.match(html, /<label for="new-project-select">Project<\/label>/u);
  assert.match(html, /<option value="project_a"/u);
  assert.match(html, />Project Alpha<\/option>/u);
  assert.doesNotMatch(html, /new-cwd-input/u);

  await api.ensureSession();

  assert.equal(fetchCalls[0]?.path, '/api/sessions');
  assert.equal(JSON.stringify(JSON.parse(fetchCalls[0]?.options.body)), JSON.stringify({
    projectId: 'project_b',
    settings: api.collectSettings(),
  }));
});

test('new session waits for projects before falling back to project path', async () => {
  let resolveProjects;
  const projectsReady = new Promise((resolve) => {
    resolveProjects = resolve;
  });
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/projects') {
        await projectsReady;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'project_admin', displayName: 'Admin Project', canCreate: true }],
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = {
    id: 'auth_1',
    principal: {
      userId: 'user_admin',
      username: 'admin',
      roleIds: ['role_admin'],
      isAdmin: true,
      mode: 'multi',
    },
  };
  api.state.view = 'sessions';
  api.state.projects = [];
  api.state.projectsLoaded = false;

  api.openNewSessionPage();

  assert.match(api.context.document.querySelector('#app').innerHTML, /Loading projects/u);
  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /Project path/u);

  resolveProjects();
  await flushMicrotasks();

  const html = api.context.document.querySelector('#app').innerHTML;
  assert.match(html, /id="new-project-select"/u);
  assert.match(html, /Admin Project/u);
  assert.doesNotMatch(html, /Project path/u);
});

test('multi-user new session without project access does not expose freeform path entry', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = {
    id: 'auth_1',
    principal: {
      userId: 'user_viewer',
      username: 'viewer',
      roleIds: ['role_viewer'],
      isAdmin: false,
      mode: 'multi',
    },
  };
  api.state.projects = [];
  api.state.projectsLoaded = true;

  const html = api.renderNewSession().innerHTML;
  assert.match(html, /<label for="new-project-select">Project<\/label>/u);
  assert.match(html, /<select id="new-project-select" name="projectId" disabled>/u);
  assert.match(html, />No projects available<\/option>/u);
  assert.doesNotMatch(html, /new-cwd-input/u);
  assert.match(html, /type="submit"[^>]*disabled/u);
});

test('multi-user new session without project access stays on project selection when start is submitted', async () => {
  const { api } = await loadAppHarness();

  api.state.token = 'token';
  api.state.authSession = {
    id: 'auth_1',
    principal: {
      userId: 'user_viewer',
      username: 'viewer',
      roleIds: ['role_viewer'],
      isAdmin: false,
      mode: 'multi',
    },
  };
  api.state.projects = [];
  api.state.projectsLoaded = true;
  api.openNewSessionPage();

  await assert.rejects(() => api.ensureSession(), /No projects are available for this account\./u);

  assert.equal(api.state.view, 'new');
  assert.equal(api.state.draftSessionActive, false);
  assert.equal(api.state.sessionId, null);
});

test('admin console opens from settings and loads management overview', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/admin/settings') {
        return { ok: true, status: 200, json: async () => ({ settings: { multiUserEnabled: true } }) };
      }
      if (path === '/api/admin/projects') {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'project_a', displayName: 'Project Alpha' }] }) };
      }
      if (path === '/api/admin/users') {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'user_1', username: 'alice', email: 'alice@example.com', enabled: true }] }) };
      }
      if (path === '/api/admin/roles') {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'role_user', name: 'User' }] }) };
      }
      if (path === '/api/admin/sessions') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ id: 'session_1', userId: 'user_1', projectDisplayName: 'Project Alpha' }] }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };

  await api.openAdminConsole();

  assert.equal(api.state.view, 'admin');
  assert.deepEqual(fetchCalls, [
    '/api/admin/settings',
    '/api/admin/projects',
    '/api/admin/users',
    '/api/admin/roles',
    '/api/admin/sessions',
  ]);
  const html = api.renderAdminConsole().innerHTML;
  assert.match(html, /Admin Console/u);
  assert.match(html, /Project Alpha/u);
  assert.match(html, /data-admin-page="users"/u);
  assert.match(html, /data-admin-page="sessions"/u);
  assert.equal(api.state.admin.users[0]?.username, 'alice');
  assert.equal(api.state.admin.sessions[0]?.id, 'session_1');
});

test('admin console stays open while restore auth finishes in the background', async () => {
  const pending: Array<{
    path: string;
    resolve: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
  }> = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => new Promise((resolve) => {
      pending.push({ path, resolve });
    }),
  });

  api.state.token = 'token';

  const restore = api.restoreAuth();
  await flushMicrotasks();

  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me']);
  pending[0]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({ session: { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } } }),
  });
  await flushMicrotasks();

  assert.deepEqual(pending.map((request) => request.path), [
    '/api/auth/me',
    '/api/settings',
    '/api/models',
    '/api/projects',
    '/api/sessions',
  ]);

  const openAdmin = api.openAdminConsole();
  await flushMicrotasks();

  assert.equal(api.state.view, 'admin');
  assert.deepEqual(pending.slice(5).map((request) => request.path), [
    '/api/admin/settings',
    '/api/admin/projects',
    '/api/admin/users',
    '/api/admin/roles',
    '/api/admin/sessions',
  ]);

  pending[1]?.resolve({ ok: true, status: 200, json: async () => ({ settings: { siteTitle: 'Codex Web' }, permissions: { canSetSiteTitle: true } }) });
  pending[2]?.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
  pending[3]?.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
  pending[4]?.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
  await restore;
  await flushMicrotasks();

  assert.equal(api.state.view, 'admin');
  assert.equal(api.state.admin.loading, true);

  pending[5]?.resolve({ ok: true, status: 200, json: async () => ({ settings: { multiUserEnabled: true } }) });
  pending[6]?.resolve({ ok: true, status: 200, json: async () => ({ items: [{ id: '/repo/admin', cwd: '/repo/admin', displayName: 'Admin Repo' }] }) });
  pending[7]?.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
  pending[8]?.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
  pending[9]?.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
  await openAdmin;

  assert.equal(api.state.view, 'admin');
  assert.equal(api.state.admin.loaded, true);
});

test('mobile keeps New visible while secondary actions live in the project drawer', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.sortMode = 'favorites';
  api.state.mobileSidebarOpen = true;

  const html = api.renderSessionList().innerHTML;
  const topbarMain = html.match(/<div class="topbar-main">([\s\S]*?)<\/div>\s*<\/header>/u)?.[1] || '';
  const drawerFooter = html.match(/<div class="project-rail-footer">([\s\S]*?)<\/div>/u)?.[1] || '';

  assert.match(topbarMain, /mobile-sidebar-toggle-button[\s\S]*mobile-session-sort-toggle/u);
  assert.doesNotMatch(topbarMain, /open-reports-button/u);
  assert.match(topbarMain, /open-new-session-button/u);
  assert.doesNotMatch(topbarMain, /open-app-settings-button/u);
  assert.doesNotMatch(drawerFooter, /open-reports-button|>Reports<\/button>/u);
  assert.doesNotMatch(drawerFooter, /open-new-session-button/u);
  assert.match(drawerFooter, /id="open-app-settings-button"[\s\S]*>Setting<\/button>/u);
  assert.match(drawerFooter, /id="open-admin-console-button"[\s\S]*>Admin Console<\/button>/u);
  assert.doesNotMatch(drawerFooter, /rail-show-sessions-button/u);
});

test('admin console renders four-page management layout with RBAC controls', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.admin.loaded = true;
  api.state.admin.settings = { multiUserEnabled: true };
  api.state.admin.projects = [{ id: 'project_a', cwd: '/repo/a', internalName: 'repo-a', displayName: 'vibecoding/a' }];
  api.state.admin.roles = [{ id: 'role_user', name: 'User', projectGrants: [{ projectId: 'project_a' }] }];
  api.state.admin.users = [{
    id: 'user_1',
    username: 'alice',
    email: 'alice@example.com',
    enabled: true,
    roleId: 'role_user',
    roleIds: ['role_user'],
    directProjectGrants: [{ projectId: 'project_a', canRead: true, canCreate: true, canWrite: true }],
  }];
  api.state.admin.sessions = [{ id: 'session_1', ownerUserId: 'user_1', projectId: 'project_a', projectDisplayName: '' }];

  let html = api.renderAdminConsole().innerHTML;
  assert.match(html, /class="admin-layout"/u);
  assert.match(html, /class="admin-sidebar"/u);
  assert.match(html, /data-admin-page="projects"/u);
  assert.match(html, /data-admin-page="roles"/u);
  assert.match(html, /data-admin-page="users"/u);
  assert.match(html, /data-admin-page="sessions"/u);

  assert.match(html, /id="admin-project-form"/u);
  assert.doesNotMatch(html, /Project ID/u);
  assert.match(html, /<th>CWD<\/th>/u);
  assert.doesNotMatch(html, /<th>Internal Name<\/th>/u);
  assert.match(html, /<th>Display Name<\/th>/u);
  assert.match(html, /<th>Work details<\/th>/u);
  assert.match(html, /name="cwd"/u);
  assert.match(html, /name="showWorkDetailsToMembers" type="checkbox" checked/u);
  assert.match(html, /Members can view work details/u);
  assert.match(html, /<td data-label="Display Name" data-i18n-skip>a<\/td>/u);
  assert.match(html, /<td data-label="Work details">Members<\/td>/u);
  assert.match(html, /data-admin-edit-project="project_a"/u);

  api.state.admin.editingProjectId = 'project_a';
  html = api.renderAdminConsole().innerHTML;
  assert.doesNotMatch(html, /name="internalName"/u);

  api.state.admin.page = 'roles';
  api.state.admin.editingProjectId = '';
  html = api.renderAdminConsole().innerHTML;
  assert.match(html, /id="admin-role-form"/u);
  assert.doesNotMatch(html, /name="isAdmin"/u);
  assert.doesNotMatch(html, /Admin role/u);
  assert.match(html, /name="projectIds" type="checkbox" value="project_a"/u);
  assert.match(html, /<span data-i18n-skip>a<\/span>/u);
  assert.match(html, /data-admin-edit-role="role_user"/u);

  api.state.admin.editingRoleId = 'role_user';
  html = api.renderAdminConsole().innerHTML;
  assert.match(html, /name="id" autocomplete="off" placeholder="role_writer" value="role_user"/u);
  assert.match(html, /name="projectIds" type="checkbox" value="project_a" checked/u);

  api.state.admin.page = 'users';
  html = api.renderAdminConsole().innerHTML;
  assert.match(html, /id="admin-user-form"/u);
  assert.doesNotMatch(html, /<span>User ID<\/span>/u);
  assert.match(html, /name="email"/u);
  assert.match(html, /<select id="admin-user-role-select" name="roleId" data-i18n-skip>/u);
  assert.doesNotMatch(html, /name="userProjectIds" type="checkbox"/u);
  assert.doesNotMatch(html, /name="canNewSession" type="checkbox"/u);
  assert.doesNotMatch(html, /class="admin-user-access-form"/u);
  assert.match(html, /data-admin-edit-user="user_1"/u);
  assert.match(html, /alice@example\.com/u);
  assert.doesNotMatch(html, /name="userEmail"/u);
  assert.doesNotMatch(html, /name="userCanNewSession" type="checkbox"/u);

  api.state.admin.editingUserId = 'user_1';
  html = api.renderAdminConsole().innerHTML;
  assert.match(html, /value="alice"/u);
  assert.match(html, /value="alice@example\.com"/u);
  assert.match(html, /id="admin-user-edit-cancel"/u);
  assert.doesNotMatch(html, /name="password"/u);

  api.state.admin.page = 'sessions';
  html = api.renderAdminConsole().innerHTML;
  assert.match(html, /id="admin-session-user-filter"/u);
  assert.match(html, /id="admin-session-project-filter"/u);
  assert.match(html, /<option value="project_a" data-i18n-skip>a<\/option>/u);
  assert.match(html, /class="admin-row-main" data-i18n-skip>a<\/span>/u);
  assert.match(html, /Observer Mode/u);
});

test('admin session audit renders session summaries', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.admin.loaded = true;
  api.state.admin.page = 'sessions';
  api.state.admin.projects = [{ id: 'project_a', cwd: '/repo/a', displayName: 'Project Alpha' }];
  api.state.admin.users = [{ id: 'user_1', username: 'alice', enabled: true }];
  api.state.admin.sessions = [{
    id: 'session_1',
    ownerUserId: 'user_1',
    projectId: 'project_a',
    projectDisplayName: 'Project Alpha',
    summary: 'Investigate why the mobile console session list is hard to audit',
  }];

  const html = api.renderAdminConsole().innerHTML;

  assert.match(html, /Investigate why the mobile console session list is hard to audit/u);
  assert.match(html, /class="admin-session-summary" data-i18n-skip/u);
});

test('admin session audit renders newest sessions first', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.admin.loaded = true;
  api.state.admin.page = 'sessions';
  api.state.admin.users = [{ id: 'user_1', username: 'alice', enabled: true }];
  api.state.admin.sessions = [
    {
      id: 'session_old',
      ownerUserId: 'user_1',
      projectId: 'project_a',
      projectDisplayName: 'Old Project',
      summary: 'zzz-old-session-summary',
      updatedAt: '2026-05-19T08:00:00.000Z',
    },
    {
      id: 'session_new',
      ownerUserId: 'user_1',
      projectId: 'project_b',
      projectDisplayName: 'New Project',
      summary: 'aaa-new-session-summary',
      updatedAt: '2026-05-19T10:00:00.000Z',
    },
  ];

  const html = api.renderAdminConsole().innerHTML;

  assert.ok(html.indexOf('aaa-new-session-summary') < html.indexOf('zzz-old-session-summary'));
});

test('admin management actions post project, role, and user changes', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (options.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({}) };
      }
      if (path === '/api/admin/settings') {
        return { ok: true, status: 200, json: async () => ({ settings: { multiUserEnabled: true } }) };
      }
      if (path === '/api/admin/projects') {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'project_a', displayName: 'Project Alpha' }] }) };
      }
      if (path === '/api/admin/users') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/admin/roles') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/admin/sessions') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };

  await api.saveAdminProject({
    cwd: '/repo/a',
    displayName: '',
    enabled: true,
  });
  await api.saveAdminRole({
    id: 'role_writer',
    name: 'Writer',
    projectIds: ['project_a'],
  });
  await api.saveAdminUser({
    username: 'writer',
    email: 'writer@example.com',
    password: 'writer-password',
    enabled: true,
    roleId: 'role_writer',
  });

  const posts = fetchCalls.filter((call) => call.options.method === 'POST');
  assert.deepEqual(posts.map((call) => call.path), [
    '/api/admin/projects',
    '/api/admin/roles',
    '/api/admin/users',
  ]);
  assert.deepEqual(JSON.parse(posts[0].options.body), {
    id: '/repo/a',
    cwd: '/repo/a',
    displayName: '',
    enabled: true,
    showWorkDetailsToMembers: true,
    activeSessionLimit: 30,
  });
  assert.deepEqual(JSON.parse(posts[1].options.body).projectGrants, [
    { projectId: 'project_a', canRead: true, canCreate: true, canWrite: true },
  ]);
  assert.equal(Object.hasOwn(JSON.parse(posts[1].options.body), 'isAdmin'), false);
  assert.deepEqual(JSON.parse(posts[2].options.body), {
    username: 'writer',
    email: 'writer@example.com',
    password: 'writer-password',
    enabled: true,
    roleId: 'role_writer',
    roleIds: ['role_writer'],
  });
});

test('admin project form creates with POST and edits with PATCH while retaining member work visibility', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (options.method === 'POST' && path === '/api/admin/projects') {
        return { ok: true, status: 201, json: async () => ({ project: { id: '/repo/limited' } }) };
      }
      if (options.method === 'PATCH' && path === '/api/admin/projects/project_existing') {
        return { ok: true, status: 200, json: async () => ({ project: { id: 'project_existing' } }) };
      }
      if (path === '/api/admin/settings') {
        return { ok: true, status: 200, json: async () => ({ settings: { multiUserEnabled: true } }) };
      }
      if (path === '/api/admin/projects') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/admin/users') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/admin/roles') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/admin/sessions') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.admin.loaded = true;

  const html = api.renderAdminConsole().innerHTML;
  assert.match(html, /name="activeSessionLimit"/u);
  assert.match(html, /name="showWorkDetailsToMembers" type="checkbox" checked/u);

  await api.saveAdminProject({
    cwd: '/repo/limited',
    displayName: 'Limited',
    enabled: true,
    showWorkDetailsToMembers: true,
    activeSessionLimit: 12,
  });

  const post = fetchCalls.find((call) => call.options.method === 'POST' && call.path === '/api/admin/projects');
  assert.deepEqual(JSON.parse(post.options.body), {
    id: '/repo/limited',
    cwd: '/repo/limited',
    displayName: 'Limited',
    enabled: true,
    showWorkDetailsToMembers: true,
    activeSessionLimit: 12,
  });

  await api.saveAdminProject({
    id: 'project_existing',
    cwd: '/repo/existing',
    displayName: 'Existing',
    enabled: true,
    showWorkDetailsToMembers: false,
    activeSessionLimit: 8,
  });

  const patch = fetchCalls.find((call) => call.options.method === 'PATCH');
  assert.equal(patch?.path, '/api/admin/projects/project_existing');
  assert.deepEqual(JSON.parse(patch.options.body), {
    id: 'project_existing',
    cwd: '/repo/existing',
    displayName: 'Existing',
    enabled: true,
    showWorkDetailsToMembers: false,
    activeSessionLimit: 8,
  });
});

test('admin user edit saves email role and enabled state without per-user project grants', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (options.method === 'PATCH' && path === '/api/admin/users/user_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: { id: 'user_1', username: 'alice', email: 'alice+updated@example.com', roleId: 'role_viewer', roleIds: ['role_viewer'] },
          }),
        };
      }
      if (path === '/api/admin/settings') {
        return { ok: true, status: 200, json: async () => ({ settings: { multiUserEnabled: true } }) };
      }
      if (path === '/api/admin/projects') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/admin/users') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/admin/roles') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/admin/sessions') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.admin.users = [{
    id: 'user_1',
    username: 'alice',
    email: 'alice@example.com',
    enabled: true,
    roleId: 'role_viewer',
    roleIds: ['role_viewer'],
    directProjectGrants: [{ projectId: 'project_a', canRead: true, canCreate: true, canWrite: true }],
  }];

  await api.saveAdminUserAccess({
    id: 'user_1',
    email: 'alice+updated@example.com',
    roleId: 'role_viewer',
    enabled: false,
  });

  const patch = fetchCalls.find((call) => call.options.method === 'PATCH');
  assert.equal(patch?.path, '/api/admin/users/user_1');
  assert.deepEqual(JSON.parse(patch.options.body), {
    email: 'alice+updated@example.com',
    enabled: false,
    roleId: 'role_viewer',
    roleIds: ['role_viewer'],
  });
});

test('admin user rows render explicit edit disable and delete actions', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.admin.loaded = true;
  api.state.admin.page = 'users';
  api.state.admin.roles = [{ id: 'role_user', name: 'User' }];
  api.state.admin.projects = [{ id: 'project_a', displayName: 'Project Alpha' }];
  api.state.admin.users = [{
    id: 'user_1',
    username: 'alice',
    email: 'alice@example.com',
    enabled: true,
    roleId: 'role_user',
    roleIds: ['role_user'],
    directProjectGrants: [{ projectId: 'project_a', canRead: true, canCreate: true, canWrite: true }],
  }];

  const html = api.renderAdminConsole().innerHTML;
  assert.match(html, /data-admin-edit-user="user_1"/u);
  assert.match(html, /data-admin-toggle-user-id="user_1"/u);
  assert.match(html, />Disable<\/button>/u);
  assert.match(html, /data-admin-delete-user-id="user_1"/u);
});

test('admin explicit user disable and delete actions call the patch and delete endpoints', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (options.method === 'PATCH' && path === '/api/admin/users/user_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: { id: 'user_1', username: 'alice', email: 'alice@example.com', enabled: false, roleId: 'role_viewer', roleIds: ['role_viewer'] },
          }),
        };
      }
      if (options.method === 'DELETE' && path === '/api/admin/users/user_1') {
        return {
          ok: true,
          status: 204,
        };
      }
      if (path === '/api/admin/settings') {
        return { ok: true, status: 200, json: async () => ({ settings: { multiUserEnabled: true } }) };
      }
      if (path === '/api/admin/projects') {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'project_a', displayName: 'Project Alpha' }] }) };
      }
      if (path === '/api/admin/users') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/admin/roles') {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'role_viewer', name: 'Viewer' }] }) };
      }
      if (path === '/api/admin/sessions') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.admin.users = [{
    id: 'user_1',
    username: 'alice',
    email: 'alice@example.com',
    enabled: true,
    roleId: 'role_viewer',
    roleIds: ['role_viewer'],
    directProjectGrants: [{ projectId: 'project_a', canRead: true, canCreate: true, canWrite: true }],
  }];

  await api.toggleAdminUserEnabled('user_1', false);
  await api.deleteAdminUser('user_1');

  const patch = fetchCalls.find((call) => call.options.method === 'PATCH');
  const remove = fetchCalls.find((call) => call.options.method === 'DELETE');
  assert.equal(patch?.path, '/api/admin/users/user_1');
  assert.deepEqual(JSON.parse(patch.options.body), {
    email: 'alice@example.com',
    enabled: false,
    roleId: 'role_viewer',
    roleIds: ['role_viewer'],
  });
  assert.equal(remove?.path, '/api/admin/users/user_1');
});

test('admin session audit refresh includes user and project filters', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/admin/sessions?userId=user_1&projectId=project_a') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ id: 'session_1', ownerUserId: 'user_1', projectId: 'project_a' }] }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.admin.filterUserId = 'user_1';

  const sessions = await api.refreshAdminSessions({ projectId: 'project_a', renderAfter: false });

  assert.deepEqual(fetchCalls, ['/api/admin/sessions?userId=user_1&projectId=project_a']);
  assert.deepEqual(sessions, [{ id: 'session_1', ownerUserId: 'user_1', projectId: 'project_a' }]);
});

test('admin session audit project filter includes projects discovered from sessions', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.admin.loaded = true;
  api.state.admin.page = 'sessions';
  api.state.admin.projects = [];
  api.state.admin.sessions = [
    { id: 'session_1', ownerUserId: 'user_1', projectId: 'project_legacy', projectDisplayName: 'Legacy Repo' },
  ];

  const html = api.renderAdminConsole().innerHTML;

  assert.match(html, /id="admin-session-project-filter"/u);
  assert.match(html, /<option value="project_legacy" data-i18n-skip>Legacy Repo<\/option>/u);
});

test('admin observed sessions open read-only history from the earliest message', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/admin/sessions/session_observed') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'observer',
            session: {
              id: 'session_observed',
              projectDisplayName: 'Project Alpha',
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'First observed question' },
                { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'First observed answer' },
                { id: 'm3', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Second observed question' },
                { id: 'm4', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Second observed answer' },
                { id: 'm5', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Latest observed question' },
                { id: 'm6', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Latest observed answer' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };

  await api.openAdminObservedSession('session_observed');

  const timeline = context.document.querySelector('#timeline');
  assert.equal(timeline.scrollTop, 0);
  assert.equal(api.state.currentSession.readOnly, true);
  assert.equal(api.state.sessionHistoryStartIndex, 0);
  assert.match(api.renderChat().innerHTML, /First observed question/u);
});

test('admin observed sessions stay selected when a running turn completes and metadata refreshes', async () => {
  const fetchCalls = [];
  let observedReadCount = 0;
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/admin/sessions/session_observed') {
        observedReadCount += 1;
        const running = observedReadCount === 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'observer',
            session: {
              id: 'session_observed',
              projectDisplayName: 'Project Alpha',
              activeTurnId: running ? 'turn_observed' : null,
              timeline: running
                ? [{ id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Observed question' }]
                : [
                    { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Observed question' },
                    { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text: 'Observed answer' },
                  ],
              thread: {
                turns: [{
                  id: 'turn_observed',
                  status: running ? 'in_progress' : 'completed',
                  items: [],
                }],
              },
            },
          }),
        };
      }
      if (path === '/api/sessions/session_observed/status') {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'session_not_found', message: 'session not found' }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = {
    id: 'auth_1',
    principal: { userId: 'admin', isAdmin: true, mode: 'multi' },
  };

  await api.openAdminObservedSession('session_observed');
  assert.equal(api.state.pendingTurn, true);

  await api.refreshCurrentSessionMetadata();

  assert.deepEqual(fetchCalls, [
    '/api/admin/sessions/session_observed',
    '/api/admin/sessions/session_observed',
  ]);
  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.sessionId, 'session_observed');
  assert.equal(api.state.currentSession?.mode, 'observer');
  assert.equal(api.state.currentSession?.readOnly, true);
  assert.equal(api.state.admin.observedSession?.id, 'session_observed');
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.error, '');
  assert.equal(api.state.timeline.some((item) => item.text === 'Observed answer'), true);
});

test('admin observed sessions stream turns through the scoped observer endpoint', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/admin/sessions/session_observed/turns/turn_observed/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({ read: async () => ({ done: true }) }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = {
    id: 'auth_1',
    principal: { userId: 'admin', isAdmin: true, mode: 'multi' },
  };
  api.state.view = 'chat';
  api.state.sessionId = 'session_observed';
  api.state.currentSession = { id: 'session_observed', mode: 'observer', readOnly: true };
  api.state.admin.observedSession = api.state.currentSession;

  await api.streamTurnEvents('turn_observed');

  assert.deepEqual(fetchCalls, [
    '/api/admin/sessions/session_observed/turns/turn_observed/events',
  ]);
});

test('returning from an admin observed session restores the session audit page', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/admin/sessions/session_observed') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'observer',
            session: {
              id: 'session_observed',
              projectDisplayName: 'Project Alpha',
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'First observed question' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.view = 'admin';
  api.state.admin.loaded = true;
  api.state.admin.page = 'sessions';
  api.state.admin.sessions = [{ id: 'session_observed', ownerUserId: 'user_1', projectDisplayName: 'Project Alpha' }];

  await api.openAdminObservedSession('session_observed');
  api.showSessionList();

  assert.equal(api.state.view, 'admin');
  assert.equal(api.state.admin.page, 'sessions');
  assert.equal(api.state.sessionId, null);
  assert.match(api.renderAdminConsole().innerHTML, /session_observed/u);
});

test('desktop admin observed sessions do not open inside the normal workspace session panes', async () => {
  const { api, context } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (path) => {
      if (path === '/api/admin/sessions/session_observed') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'observer',
            session: {
              id: 'session_observed',
              projectDisplayName: 'Project Alpha',
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'First observed question' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };
  api.state.view = 'admin';
  api.state.admin.loaded = true;
  api.state.admin.page = 'sessions';
  api.state.admin.sessions = [{ id: 'session_observed', ownerUserId: 'user_1', projectDisplayName: 'Project Alpha' }];

  await api.openAdminObservedSession('session_observed');

  const html = context.document.querySelector('#app').innerHTML;
  assert.doesNotMatch(html, /desktop-shell/u);
  assert.doesNotMatch(html, /desktop-session-pane/u);
  assert.match(html, /First observed question/u);

  api.showSessionList();

  assert.equal(api.state.view, 'admin');
  assert.match(api.renderAdminConsole().innerHTML, /session_observed/u);
});

test('observer sessions and share sessions render read-only chat without composer actions', async () => {
  const [styles, { api }] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    loadAppHarness(),
  ]);

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_observed';
  api.state.currentSession = {
    id: 'session_observed',
    projectDisplayName: 'Project Alpha',
    mode: 'observer',
    readOnly: true,
  };

  const html = api.renderChat().innerHTML;

  assert.match(html, /read-only-banner/u);
  assert.match(html, /Observer mode/u);
  assert.doesNotMatch(html, /id="prompt-input"/u);
  assert.doesNotMatch(html, /id="send-button"/u);
  assert.doesNotMatch(html, /id="settings-toggle"/u);
  assert.doesNotMatch(html, /id="share-session-button"/u);
  assert.match(styles, /\.read-only-banner\s*\{[^}]*display:\s*flex;/su);
  assert.match(styles, /\.read-only-banner\s*\{[^}]*border:\s*1px solid var\(--border\);/su);
});

test('settings drawer creates and copies share links for writable sessions', async () => {
  const fetchCalls = [];
  const clipboardWrites = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          token: 'cws_public_token',
          shareUrl: '/share/cws_public_token',
          reports: [{
            id: 'project-alpha/2026-07-16/summary.md',
            project: 'project-alpha',
            title: 'Session summary',
            kind: 'markdown',
          }],
        }),
      };
    },
  });
  api.context.window.location.origin = 'https://codex.example';
  api.context.navigator.clipboard = {
    writeText: async (text) => {
      clipboardWrites.push(text);
    },
  };
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { mode: 'multi' } };
  api.state.globalSettings.publicSharesEnabled = true;
  api.state.globalSettings.loaded = true;
  api.state.view = 'chat';
  api.state.sessionId = 'session_share';
  api.state.currentSession = {
    id: 'session_share',
    projectDisplayName: 'Project Alpha',
  };

  const closedHtml = api.renderChat().innerHTML;
  assert.doesNotMatch(closedHtml, /id="share-session-button"/u);
  assert.match(closedHtml, /id="settings-toggle"[^>]*aria-label="Session menu"[^>]*>[\s\S]*class="button-icon button-icon-more"[\s\S]*<\/button>/u);

  api.state.settingsOpen = true;
  const openHtml = api.renderChat().innerHTML;
  assert.match(openHtml, /class="settings-drawer"[\s\S]*id="share-session-button"/u);
  assert.equal(typeof api.shareCurrentSession, 'function');

  await api.shareCurrentSession();

  assert.deepEqual(fetchCalls.map((call) => ({
    path: call.path,
    method: call.options.method,
  })), [
    { path: '/api/sessions/session_share/share', method: 'POST' },
  ]);
  assert.deepEqual(clipboardWrites, ['https://codex.example/share/cws_public_token']);
  assert.equal(api.state.shareDialog?.url, 'https://codex.example/share/cws_public_token');
  assert.equal(api.state.status, 'Share link copied');
  assert.match(api.renderChat().innerHTML, /id="share-link-input"/u);
  assert.doesNotMatch(api.renderChat().innerHTML, /Reports in this share|Session summary/u);
});

test('share control stays visible but disabled while public sharing is unavailable', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = { id: 'auth_1', principal: { mode: 'multi' } };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.settingsOpen = true;
  api.state.globalSettings.publicSharesEnabled = false;
  api.state.globalSettings.loaded = true;

  const html = api.renderChat().innerHTML;
  assert.match(html, /Public sharing is disabled/u);
  assert.match(html, /id="share-session-button" disabled/u);
  assert.equal(await api.shareCurrentSession(), null);
});

test('share dialog copy falls back when Clipboard API is unavailable', async () => {
  const execCommands = [];
  const { api, context } = await loadAppHarness();
  const shareInput = {
    value: 'https://codex.example/share/cws_public_token',
    selectCalled: 0,
    selectionRanges: [],
    focusCalled: 0,
    select() {
      this.selectCalled += 1;
    },
    setSelectionRange(start, end) {
      this.selectionRanges.push([start, end]);
    },
    focus() {
      this.focusCalled += 1;
    },
  };
  context.__elements.set('#share-link-input', shareInput);
  context.document.execCommand = (command) => {
    execCommands.push(command);
    return command === 'copy';
  };

  api.state.shareDialog = {
    url: 'https://codex.example/share/cws_public_token',
    copied: false,
  };
  api.state.status = 'Share link ready';
  api.state.statusTone = 'success';

  const copied = await api.copyShareLink('https://codex.example/share/cws_public_token');

  assert.equal(copied, true);
  assert.deepEqual(execCommands, ['copy']);
  assert.equal(shareInput.focusCalled, 1);
  assert.equal(shareInput.selectCalled, 1);
  assert.deepEqual(shareInput.selectionRanges, [[0, shareInput.value.length]]);
  assert.equal(api.state.shareDialog?.copied, true);
  assert.equal(api.state.status, 'Share link copied');
});

test('share routes load public session history without auth and render read-only', async () => {
  const fetchCalls = [];
  const { api, storage } = await loadAppHarness({
    pathname: '/share/cws_public_token',
    storage: { codexWebToken: 'existing_device_token' },
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/share/cws_public_token/session') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'share',
            session: {
              id: 'session_shared',
              projectDisplayName: 'Project Alpha',
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Shared question' },
                { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Shared answer' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  await api.loadSharedSessionFromLocation();

  assert.deepEqual(fetchCalls, ['/api/share/cws_public_token/session']);
  assert.equal(api.state.authSession?.principal?.mode, 'share');
  assert.equal(api.state.token, '');
  assert.equal(storage.get('codexWebToken'), 'existing_device_token');
  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.currentSession.readOnly, true);
  const html = api.renderChat().innerHTML;
  assert.match(html, /Shared answer/u);
  assert.match(html, /Shared link/u);
  assert.doesNotMatch(html, /id="prompt-input"/u);
});

test('share routes keep old report message links compatible without a reports shelf or bearer auth', async () => {
  const fetchCalls = [];
  const reportId = 'project-alpha/2026-07-16/session-summary.md';
  const { api, context } = await loadAppHarness({
    pathname: '/share/cws_public_token',
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, headers: options.headers || {} });
      if (path === '/api/share/cws_public_token/session') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'share',
            reports: [{
              id: reportId,
              project: 'project-alpha',
              title: 'Session summary',
              kind: 'markdown',
            }],
            session: {
              id: 'session_shared_report',
              projectDisplayName: 'Project Alpha',
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Create a report' },
                {
                  id: 'm2',
                  kind: 'message',
                  role: 'assistant',
                  label: 'Assistant',
                  meta: 'final',
                  text: '[Session summary](/Users/alice/.codex-web/reports/project-alpha/2026-07-16/session-summary.md)',
                },
                { id: 'm3', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text: '[Project file](docs/audit.md)' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      if (path === `/api/share/cws_public_token/reports/${encodeURIComponent(reportId)}/content`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            report: {
              id: reportId,
              project: 'project-alpha',
              title: 'Session summary',
              kind: 'markdown',
            },
            content: '# Session summary\n\nShared report body.',
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  await api.loadSharedSessionFromLocation();

  let html = context.document.querySelector('#app').innerHTML;
  assert.doesNotMatch(html, /class="shared-session-reports"|data-report-id=/u);
  assert.match(html, /data-session-file-path="\/Users\/alice\/\.codex-web\/reports\/project-alpha\/2026-07-16\/session-summary\.md"/u);
  assert.doesNotMatch(html, /data-session-file-path="docs\/audit\.md"/u);

  await api.openSessionFileByPath('/Users/alice/.codex-web/reports/project-alpha/2026-07-16/session-summary.md');

  assert.equal(api.state.view, 'file');
  assert.equal(api.state.currentSessionFileContent, '# Session summary\n\nShared report body.');
  html = context.document.querySelector('#app').innerHTML;
  assert.match(html, /class="session-file-viewer"/u);
  assert.match(html, /<h1>Session summary<\/h1>/u);
  assert.deepEqual(fetchCalls.map((call) => call.path), [
    '/api/share/cws_public_token/session',
    `/api/share/cws_public_token/reports/${encodeURIComponent(reportId)}/content`,
  ]);
  assert.equal(fetchCalls.some((call) => Object.hasOwn(call.headers, 'Authorization')), false);

  api.closeSessionFileViewer();
  assert.equal(api.state.view, 'chat');
  assert.match(context.document.querySelector('#app').innerHTML, /Create a report/u);
});

test('share routes do not refresh private session metadata after loading', async () => {
  const fetchCalls = [];
  const { api, context } = await loadAppHarness({
    pathname: '/share/cws_public_token',
    storage: { codexWebToken: 'existing_device_token' },
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/share/cws_public_token/session') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'share',
            session: {
              id: 'session_shared',
              projectDisplayName: 'Project Alpha',
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Shared question' },
                { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Shared answer' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      if (path === '/api/sessions/session_shared') {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'unauthorized', message: 'Login required' }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  await api.loadSharedSessionFromLocation();
  await context.recoverActiveTurnAfterForeground();
  await api.refreshCurrentView();

  assert.deepEqual(fetchCalls, ['/api/share/cws_public_token/session']);
  assert.equal(api.state.authSession?.principal?.mode, 'share');
  assert.equal(api.state.view, 'chat');
  assert.equal(context.localStorage.getItem('codexWebToken'), 'existing_device_token');
});

test('share routes open read-only history from the earliest message', async () => {
  const { api, context } = await loadAppHarness({
    pathname: '/share/cws_public_token',
    fetch: async (path) => {
      if (path === '/api/share/cws_public_token/session') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'share',
            session: {
              id: 'session_shared',
              projectDisplayName: 'Project Alpha',
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'First shared question' },
                { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Latest shared answer' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  await api.loadSharedSessionFromLocation();

  const timeline = context.document.querySelector('#timeline');
  assert.equal(timeline.scrollTop, 0);
  assert.match(api.renderChat().innerHTML, /First shared question/u);
});

test('share routes render only the shared conversation without workspace navigation', async () => {
  const { api } = await loadAppHarness({
    pathname: '/share/cws_public_token',
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (path) => {
      if (path === '/api/share/cws_public_token/session') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'share',
            session: {
              id: 'session_shared',
              projectDisplayName: 'Private Project',
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Shared question' },
                { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Shared answer' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  await api.loadSharedSessionFromLocation();

  api.render();
  const html = api.context.document.querySelector('#app').innerHTML;
  assert.match(html, /Shared question/u);
  assert.match(html, /Shared answer/u);
  assert.match(html, /class="shared-session-page"/u);
  assert.doesNotMatch(html, /desktop-workspace/u);
  assert.doesNotMatch(html, /desktop-project-rail/u);
  assert.doesNotMatch(html, /desktop-session-pane/u);
  assert.doesNotMatch(html, /mobile-project-drawer/u);
  assert.doesNotMatch(html, /back-to-list-button/u);
  assert.doesNotMatch(html, /session-report-button/u);
  assert.doesNotMatch(html, /settings-toggle/u);
  assert.doesNotMatch(html, /read-only-banner/u);
  assert.doesNotMatch(html, /id="prompt-input"/u);
  assert.doesNotMatch(html, /id="send-button"/u);
  assert.doesNotMatch(html, /Reports/u);
  assert.doesNotMatch(html, /Sessions/u);
});

test('share routes render the full shared session context', async () => {
  const { api } = await loadAppHarness({
    pathname: '/share/cws_public_token',
    fetch: async (path) => {
      if (path === '/api/share/cws_public_token/session') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'share',
            session: {
              id: 'session_shared_full_context',
              projectDisplayName: 'Project Alpha',
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'First shared question' },
                { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'First shared answer' },
                { id: 'm3', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Second shared question' },
                { id: 'm4', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Second shared answer' },
                { id: 'm5', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Third shared question' },
                { id: 'm6', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Third shared answer' },
                { id: 'm7', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Latest shared question' },
                { id: 'm8', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Latest shared answer' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  await api.loadSharedSessionFromLocation();

  api.render();
  const html = api.context.document.querySelector('#app').innerHTML;
  assert.match(html, /First shared question/u);
  assert.match(html, /First shared answer/u);
  assert.match(html, /Second shared question/u);
  assert.match(html, /Second shared answer/u);
  assert.match(html, /Third shared question/u);
  assert.match(html, /Third shared answer/u);
  assert.match(html, /Latest shared question/u);
  assert.match(html, /Latest shared answer/u);
});

test('admin console uses dense mobile-safe management rows', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(styles, /\.admin-console-screen\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.admin-list\s*\{[^}]*display:\s*grid;/su);
  assert.match(styles, /\.admin-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/su);
  assert.match(styles, /\.admin-row-main\s*\{[^}]*overflow-wrap:\s*anywhere;/su);
  assert.match(styles, /\.admin-session-open\s*\{[^}]*text-align:\s*left;/su);
  assert.match(app, /class="admin-table admin-project-table"/u);
  assert.match(app, /<td data-label="\$\{escapeAttribute\(t\('CWD'\)\)\}"/u);
  assert.match(styles, /@media \(max-width:\s*719px\)[\s\S]*\.admin-project-table thead\s*\{[^}]*display:\s*none;/u);
  assert.match(styles, /\.admin-project-table td:first-child\s*\{[^}]*grid-column:\s*1 \/ -1;/su);
});


test('session home opens a settings page and keeps logout inside settings', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function renderAppSettings\(\)/u);
  assert.match(app, /id="open-app-settings-button"/u);
  assert.match(app, /id="settings-logout-button"/u);
  assert.doesNotMatch(app, /renderSessionList\(\)[\s\S]{0,900}id="logout-button"/u);
});

test('settings separate current-session controls from this-device new-session defaults', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = { id: 'auth_1', principal: { mode: 'single', isAdmin: false } };
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.models = [{
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6-Sol',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    defaultReasoningEffort: 'low',
  }];
  api.state.model = 'gpt-5.6-sol';
  api.state.reasoningEffort = 'ultra';

  const sessionHtml = api.renderSettingsDrawer();
  const appHtml = api.renderAppSettings().innerHTML;

  assert.match(sessionHtml, /class="settings-card settings-stop-row" data-session-state="idle"/u);
  assert.match(sessionHtml, />Current session is idle</u);
  assert.match(sessionHtml, />Model and reasoning</u);
  assert.match(sessionHtml, />Behavior and permissions</u);
  assert.match(sessionHtml, /class="settings-card settings-options-card"[\s\S]*id="model-select"/u);
  assert.doesNotMatch(sessionHtml, />Reports?</u);
  assert.doesNotMatch(sessionHtml, /id="runtime-reload-button"/u);
  assert.match(appHtml, />New sessions on this device</u);
  assert.match(appHtml, />Appearance</u);
  assert.match(appHtml, />Advanced</u);
  assert.match(appHtml, /id="runtime-reload-button"/u);
  assert.match(appHtml, /role="group" aria-labelledby="default-permissions-label"/u);
});

test('mobile settings page title is centered with back on the left', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 390 });

  const html = api.renderAppSettings().innerHTML;
  const pageNav = html.match(/<div class="page-nav">[\s\S]*?<\/div>\s*<\/div>/u)?.[0] || '';

  assert.match(pageNav, /class="ghost page-back-button" type="button" id="back-to-list-button" aria-label="Back">[\s\S]*class="button-icon button-icon-back"[\s\S]*<\/button>/u);
  assert.match(pageNav, /<div class="page-title">Settings<\/div>/u);
  assert.match(pageNav, /<div class="page-nav-spacer" aria-hidden="true"><\/div>/u);
  assert.doesNotMatch(pageNav, />Sessions<\/button>/u);
});

test('app settings persist theme and default thread settings', async () => {
  const { api, storage, context } = await loadAppHarness();

  assert.equal(api.state.theme, 'sunny');

  api.state.models = [
    { id: 'gpt-5.4', label: 'GPT 5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' },
  ];

  api.applyTheme('light');
  assert.equal(storage.get('codexWebTheme'), 'light');
  assert.equal(context.document.documentElement.dataset.theme, 'light');

  api.applyTheme('nord');
  assert.equal(storage.get('codexWebTheme'), 'nord');
  assert.equal(context.document.documentElement.dataset.theme, 'nord');

  api.applyTheme('catppuccin');
  assert.equal(storage.get('codexWebTheme'), 'catppuccin');
  assert.equal(context.document.documentElement.dataset.theme, 'catppuccin');

  api.applyTheme('unsupported');
  assert.equal(storage.get('codexWebTheme'), 'sunny');
  assert.equal(context.document.documentElement.dataset.theme, 'sunny');

  const settingsHtml = api.renderAppSettings().innerHTML;
  for (const theme of [
    'sunny',
    'light',
    'dark',
    'nord',
    'forest',
    'rose',
    'amber',
    'one-dark',
    'gruvbox',
    'catppuccin',
    'dracula',
  ]) {
    assert.match(settingsHtml, new RegExp(`data-app-theme="${theme}"`, 'u'));
  }

  api.applyMessageFontSize('small');
  assert.equal(storage.get('codexWebMessageFontSize'), 'small');
  assert.equal(context.document.documentElement.dataset.messageFontSize, 'small');

  api.applyDefaultThreadSettings({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'medium',
    collaborationMode: 'plan',
    accessPreset: 'default',
  });

  assert.equal(storage.get('codexWebDefaultThreadSettings'), JSON.stringify({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'medium',
    collaborationMode: 'plan',
    accessPreset: 'default',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    personality: 'pragmatic',
  }));

  api.applyDefaultSettings();
  assert.equal(api.state.model, 'gpt-5.4-mini');
  assert.equal(api.state.reasoningEffort, 'medium');
  assert.equal(api.state.collaborationMode, 'plan');
  assert.equal(api.state.permissionPreset, 'default');
  assert.equal(api.state.approvalPolicy, 'on-request');
  assert.equal(api.state.sandboxMode, 'workspace-write');
});

test('app settings render per-user webhook controls on mobile and desktop settings surfaces', async () => {
  const { api, context } = await loadAppHarness();
  context.window.location.origin = 'https://codex.example';
  api.state.authSession = {
    id: 'auth_single',
    principal: { userId: 'local-admin', mode: 'single', isAdmin: true },
  };
  api.state.webhook = {
    ...api.state.webhook,
    enabled: true,
    hasKey: true,
    key: 'cwwh_render_secret',
    keyHint: 'aa4f2a',
    endpointPath: '/api/webhook',
    loaded: true,
  };

  const mobileHtml = api.renderAppSettings().innerHTML;
  const defaultsIndex = mobileHtml.indexOf('default-thread-settings-section');
  const webhookIndex = mobileHtml.indexOf('webhook-settings-section');
  const advancedIndex = mobileHtml.indexOf('>Advanced<');

  assert.ok(defaultsIndex >= 0 && defaultsIndex < webhookIndex);
  assert.ok(webhookIndex < advancedIndex);
  assert.match(mobileHtml, /id="webhook-enabled-toggle" type="checkbox" checked/u);
  assert.match(mobileHtml, /id="webhook-endpoint-input"[^>]*value="https:\/\/codex\.example\/api\/webhook"/u);
  assert.match(mobileHtml, /id="webhook-key-input"[^>]*value="cwwh_render_secret"/u);
  assert.match(mobileHtml, /id="webhook-copy-endpoint-button"/u);
  assert.match(mobileHtml, /id="webhook-copy-key-button"[^>]*>Copy key<\/button>/u);
  assert.match(mobileHtml, /id="webhook-rotate-key-button"/u);

  api.state.webhook.key = '';
  const legacyHtml = api.renderAppSettings().innerHTML;
  assert.match(legacyHtml, /value="cwwh_\.\.\.aa4f2a"/u);
  assert.match(legacyHtml, /id="webhook-copy-key-button" disabled/u);
  assert.match(legacyHtml, /Regenerate this legacy key once to make it copyable\./u);
  api.state.webhook.key = 'cwwh_render_secret';

  api.state.authSession = {
    id: 'auth_member',
    principal: { userId: 'user_member', mode: 'multi', isAdmin: false },
  };
  assert.match(api.renderAppSettings().innerHTML, /webhook-settings-section/u);

  api.applyLanguage('zh-CN');
  const chineseHtml = api.renderAppSettings().innerHTML;
  assert.match(chineseHtml, /启用 Webhook/u);
  assert.match(chineseHtml, /Webhook 接口地址/u);
  assert.match(chineseHtml, /重新生成密钥/u);
  assert.match(chineseHtml, /https:\/\/codex\.example\/api\/webhook/u);
});

test('webhook settings keep the recoverable key in memory across refresh without browser persistence', async () => {
  const fetchCalls = [];
  let currentKey = '';
  let currentWebhook = {
    enabled: false,
    hasKey: false,
    keyHint: '',
    endpointPath: '/api/webhook',
  };
  const { api, storage } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/webhook' && (options.method || 'GET') === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ webhook: currentWebhook, key: currentKey || null }),
        };
      }
      if (path === '/api/webhook' && options.method === 'PATCH') {
        if (JSON.parse(options.body).enabled === true && !currentKey) {
          currentKey = 'cwwh_first_secret';
        }
        currentWebhook = {
          ...currentWebhook,
          enabled: JSON.parse(options.body).enabled === true,
          hasKey: Boolean(currentKey),
          keyHint: currentKey.slice(-6),
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({ webhook: currentWebhook, key: currentKey || null }),
        };
      }
      if (path === '/api/webhook/rotate' && options.method === 'POST') {
        currentKey = 'cwwh_rotated_secret';
        currentWebhook = {
          ...currentWebhook,
          enabled: true,
          hasKey: true,
          keyHint: currentKey.slice(-6),
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({ webhook: currentWebhook, key: currentKey }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'browser-session-token';
  api.state.authSession = {
    id: 'auth_member',
    principal: { userId: 'user_member', mode: 'multi', isAdmin: false },
  };

  await api.refreshWebhookSettings({ renderAfter: false });
  assert.equal(api.state.webhook.loaded, true);
  assert.equal(api.state.webhook.enabled, false);
  assert.equal(api.state.webhook.endpointPath, '/api/webhook');

  await api.setWebhookEnabled(true);
  assert.equal(api.state.webhook.enabled, true);
  assert.equal(api.state.webhook.key, 'cwwh_first_secret');
  assert.equal(api.state.webhook.keyHint, 'secret');
  assert.equal([...storage.values()].join('\n').includes('cwwh_first_secret'), false);
  assert.deepEqual(JSON.parse(fetchCalls[1].options.body), { enabled: true });
  assert.equal(fetchCalls[1].options.headers.Authorization, 'Bearer browser-session-token');

  await api.refreshWebhookSettings({ renderAfter: false });
  assert.equal(api.state.webhook.key, 'cwwh_first_secret');
  assert.equal(fetchCalls[2].path, '/api/webhook');

  assert.equal(api.requestWebhookKeyRotation({ id: 'webhook-rotate-key-button' }), true);
  assert.equal(api.state.webhookRotateConfirmOpen, true);
  assert.match(api.renderAppSettings().innerHTML, /Regenerate webhook key\?/u);

  await api.rotateWebhookKey();
  assert.equal(fetchCalls[3].path, '/api/webhook/rotate');
  assert.equal(fetchCalls[3].options.method, 'POST');
  assert.equal(api.state.webhook.key, 'cwwh_rotated_secret');
  assert.equal(api.state.webhook.keyHint, 'secret');
  assert.equal(api.state.webhookRotateConfirmOpen, false);
  assert.equal([...storage.values()].join('\n').includes('cwwh_rotated_secret'), false);

  api.setLoggedOut();
  assert.equal(api.state.webhook.loaded, false);
  assert.equal(api.state.webhook.key, '');
  assert.equal(api.state.webhookRotateConfirmOpen, false);
});

test('webhook endpoint and persistent key copy through the shared clipboard helper', async () => {
  const clipboardWrites = [];
  const { api, context } = await loadAppHarness();
  context.window.location.origin = 'https://codex.example';
  context.navigator.clipboard = {
    writeText: async (value) => {
      clipboardWrites.push(value);
    },
  };
  api.state.authSession = {
    id: 'auth_member',
    principal: { userId: 'user_member', mode: 'multi', isAdmin: false },
  };
  api.state.webhook = {
    ...api.state.webhook,
    enabled: true,
    hasKey: true,
    key: 'cwwh_copy_secret',
    keyHint: '00copy',
    endpointPath: '/api/webhook',
    loaded: true,
  };
  assert.equal(await api.copyWebhookEndpoint(), true);
  assert.equal(api.state.webhook.endpointCopied, true);
  assert.equal(await api.copyWebhookKey(), true);
  assert.equal(api.state.webhook.keyCopied, true);
  assert.deepEqual(clipboardWrites, [
    'https://codex.example/api/webhook',
    'cwwh_copy_secret',
  ]);

});

test('reasoning options follow the selected model metadata', async () => {
  const { api } = await loadAppHarness();

  api.state.models = [
    {
      id: 'gpt-5.5',
      label: 'GPT 5.5',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'xhigh',
    },
    {
      id: 'gpt-6',
      label: 'GPT 6',
      supportedReasoningEfforts: ['minimal', 'standard', 'deep'],
      defaultReasoningEffort: 'deep',
    },
  ];
  api.state.model = 'gpt-6';
  api.state.reasoningEffort = 'deep';

  const html = api.renderSettingsDrawer();

  assert.match(html, /<option value="minimal"/u);
  assert.match(html, /<option value="standard"/u);
  assert.match(html, /<option value="deep" selected/u);
  assert.doesNotMatch(html, /<option value="xhigh"/u);

  api.applyDefaultThreadSettings({ model: 'gpt-6', reasoningEffort: 'xhigh' });

  assert.equal(api.state.defaultThreadSettings.reasoningEffort, 'deep');
});

test('changing an active session model refreshes reasoning options immediately', async () => {
  const fetchCalls = [];
  const { api, context } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_model',
            cwd: '/repo',
            settings: JSON.parse(options.body),
          },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_model';
  api.state.currentSession = { id: 'session_model', cwd: '/repo', settings: {} };
  api.state.sessions = [api.state.currentSession];
  api.state.settingsOpen = true;
  api.state.models = [
    {
      id: 'gpt-5.4',
      displayName: 'GPT-5.4',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'xhigh',
    },
    {
      id: 'gpt-5.6-sol',
      displayName: 'GPT-5.6-Sol',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultReasoningEffort: 'low',
    },
  ];
  api.state.model = 'gpt-5.4';
  api.state.reasoningEffort = 'xhigh';
  api.state.timelineShouldFollowLatest = false;
  api.render();

  const renderCount = context.__appRenderCount;
  const modelSelect = context.document.querySelector('#model-select');
  const timeline = context.document.querySelector('#timeline');
  assert.ok(modelSelect);
  assert.ok(timeline);
  assert.doesNotMatch(context.document.querySelector('#reasoning-select').innerHTML, /value="ultra"/u);
  timeline.scrollTop = 240;

  modelSelect.value = 'gpt-5.6-sol';
  modelSelect.__listeners.get('change')?.({ target: modelSelect });

  const reasoningSelect = context.document.querySelector('#reasoning-select');
  const nextTimeline = context.document.querySelector('#timeline');
  assert.equal(nextTimeline.scrollTop, 240);
  assert.ok(context.__appRenderCount > renderCount);
  assert.match(reasoningSelect.innerHTML, /value="max"/u);
  assert.match(reasoningSelect.innerHTML, /value="ultra"/u);
  assert.match(reasoningSelect.innerHTML, /value="xhigh" selected/u);
  assert.equal(api.state.reasoningEffort, 'xhigh');
  assert.equal(fetchCalls[0]?.path, '/api/sessions/session_model/settings');
  assert.equal(fetchCalls[0]?.options.method, 'PATCH');
  const savedSettings = JSON.parse(fetchCalls[0]?.options.body);
  assert.equal(savedSettings.model, 'gpt-5.6-sol');
  assert.equal(savedSettings.reasoningEffort, 'xhigh');
});

test('choosing Codex defaults resets both model and reasoning while sending effective values', async () => {
  const fetchCalls = [];
  const { api, context } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: { id: 'session_inherit', cwd: '/repo', settings: JSON.parse(options.body) },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_inherit';
  api.state.currentSession = { id: 'session_inherit', cwd: '/repo', settings: {} };
  api.state.sessions = [api.state.currentSession];
  api.state.settingsOpen = true;
  api.state.codexConfigDefaults = { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' };
  api.state.models = [{
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6-Sol',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    defaultReasoningEffort: 'low',
  }];
  api.state.model = 'gpt-5.6-sol';
  api.state.reasoningEffort = 'ultra';
  api.render();

  const modelSelect = context.document.querySelector('#model-select');
  modelSelect.value = '';
  modelSelect.__listeners.get('change')?.({ target: modelSelect });
  await flushMicrotasks();

  assert.equal(api.state.model, '');
  assert.equal(api.state.reasoningEffort, '');
  assert.match(context.document.querySelector('#reasoning-select').innerHTML, /value="" selected/u);
  const savedSettings = JSON.parse(fetchCalls[0]?.options.body);
  assert.equal(savedSettings.model, 'gpt-5.6-sol');
  assert.equal(savedSettings.reasoningEffort, 'ultra');
});

test('global website title is editable only by single-user or admin principals', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1', principal: { userId: 'user_1', isAdmin: false, mode: 'multi' } };
  api.state.globalSettings = {
    siteTitle: 'Team Codex',
    canSetSiteTitle: false,
  };
  const userHtml = api.renderAppSettings().innerHTML;
  assert.doesNotMatch(userHtml, /id="site-title-input"/u);
  assert.doesNotMatch(userHtml, /Browser title/u);

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true, mode: 'multi' } };
  api.state.globalSettings.canSetSiteTitle = true;
  const adminHtml = api.renderAppSettings().innerHTML;
  assert.match(adminHtml, /id="site-title-input"/u);
  assert.match(adminHtml, /value="Team Codex"/u);

  api.state.authSession = { id: 'auth_1', principal: { userId: 'local-admin', isAdmin: true, mode: 'single' } };
  api.state.globalSettings.canSetSiteTitle = true;
  const singleHtml = api.renderAppSettings().innerHTML;
  assert.match(singleHtml, /id="site-title-input"/u);
});

test('global website title loads from the backend and saves through the settings API', async () => {
  const fetchCalls = [];
  const { api, context, storage } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: { id: 'auth_1', principal: { userId: 'admin', isAdmin: true, mode: 'multi' } },
          }),
        };
      }
      if (path === '/api/settings' && (options.method || 'GET') === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            settings: { siteTitle: 'Team Codex' },
            permissions: { canSetSiteTitle: true },
          }),
        };
      }
      if (path === '/api/settings' && options.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            settings: { siteTitle: JSON.parse(options.body).siteTitle },
            permissions: { canSetSiteTitle: true },
          }),
        };
      }
      if (path === '/api/models') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/projects' || path === '/api/sessions') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.siteTitle = 'Local Old Title';
  context.document.title = 'Local Old Title';

  await api.restoreAuth();

  assert.equal(api.state.siteTitle, 'Team Codex');
  assert.equal(context.document.title, 'Team Codex');
  assert.equal(api.state.globalSettings.canSetSiteTitle, true);
  assert.equal(storage.get('codexWebSiteTitle'), undefined);

  await api.saveSiteTitle('New Team Title');

  assert.equal(api.state.siteTitle, 'New Team Title');
  assert.equal(context.document.title, 'New Team Title');
  assert.deepEqual(fetchCalls.map((call) => call.path), [
    '/api/auth/me',
    '/api/settings',
    '/api/models',
    '/api/projects',
    '/api/sessions',
    '/api/settings',
  ]);
  assert.equal(JSON.parse(fetchCalls[5].options.body).siteTitle, 'New Team Title');
});

test('app language defaults to English and keeps send as a localized text control', async () => {
  const { api, storage, context } = await loadAppHarness();

  assert.equal(api.state.language, 'en');
  assert.equal(storage.get('codexWebLanguage'), undefined);
  assert.equal(context.document.documentElement.lang, 'en');

  api.state.view = 'chat';
  api.state.authSession = { id: 'auth_1' };
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };

  const settingsHtml = api.renderAppSettings().innerHTML;
  assert.match(settingsHtml, /data-app-language="en"[^>]*aria-pressed="true"[^>]*>English<\/button>/u);
  assert.match(settingsHtml, /data-app-language="zh-CN"[^>]*>中文<\/button>/u);

  const chatHtml = api.renderChat().innerHTML;
  assert.match(chatHtml, /id="send-button"[^>]*aria-label="Send"[^>]*>Send<\/button>/u);
});

test('Chinese language setting localizes settings, chat, and admin management UI', async () => {
  const { api, storage, context } = await loadAppHarness();

  assert.equal(api.translateUi('Settings', 'zh-CN'), '设置');
  api.applyLanguage('zh-CN');

  assert.equal(api.state.language, 'zh-CN');
  assert.equal(storage.get('codexWebLanguage'), 'zh-CN');
  assert.equal(context.document.documentElement.lang, 'zh-CN');

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true, mode: 'multi' } };
  api.state.admin.loaded = true;
  api.state.admin.settings = { multiUserEnabled: true };
  api.state.admin.projects = [{ id: 'project_a', cwd: '/repo/a', displayName: 'vibecoding/a' }];
  api.state.admin.roles = [{ id: 'role_user', name: 'User', projectGrants: [{ projectId: 'project_a' }] }];
  api.state.admin.users = [{
    id: 'user_1',
    username: 'alice',
    enabled: true,
    roleId: 'role_user',
    roleIds: ['role_user'],
  }];
  api.state.admin.sessions = [{ id: 'session_1', ownerUserId: 'user_1', projectId: 'project_a' }];

  const settingsHtml = api.renderAppSettings().innerHTML;
  assert.match(settingsHtml, /<div class="page-title">设置<\/div>/u);
  assert.match(settingsHtml, /语言/u);
  assert.match(settingsHtml, /网站标题/u);
  assert.match(settingsHtml, /此设备的新会话/u);
  assert.match(settingsHtml, /退出登录/u);
  for (const themeName of ['深石墨琥珀', '原子深色', '复古暖色', '摩卡柔彩', '德古拉深色']) {
    assert.match(settingsHtml, new RegExp(`>${themeName}<`, 'u'));
  }
  for (const themeName of ['Graphite Amber', 'One Dark Pro', 'Gruvbox Dark', 'Catppuccin Mocha', 'Dracula Dark']) {
    assert.doesNotMatch(settingsHtml, new RegExp(`>${themeName}<`, 'u'));
  }

  api.state.view = 'chat';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  const chatHtml = api.renderChat().innerHTML;
  assert.match(chatHtml, /placeholder="输入消息"/u);
  assert.match(chatHtml, /id="send-button"[^>]*aria-label="发送"[^>]*>发送<\/button>/u);
  assert.doesNotMatch(chatHtml, />Send<\/button>/u);

  const adminHtml = api.renderAdminConsole().innerHTML;
  assert.match(adminHtml, /管理控制台/u);
  assert.match(adminHtml, /项目管理/u);
  assert.match(adminHtml, /角色管理/u);
  assert.match(adminHtml, /用户管理/u);
  assert.match(adminHtml, /会话审计/u);
  assert.match(adminHtml, /多用户模式/u);
  assert.match(adminHtml, /保存项目/u);

  api.state.admin.page = 'users';
  const adminUsersHtml = api.renderAdminConsole().innerHTML;
  assert.match(adminUsersHtml, /保存用户/u);
});

test('Chinese UI keeps model and reasoning option labels untranslated', async () => {
  const { api } = await loadAppHarness();
  api.applyLanguage('zh-CN');
  api.state.models = [{
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6-Sol',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    defaultReasoningEffort: 'low',
  }];
  api.state.defaultThreadSettings.model = 'gpt-5.6-sol';
  api.state.defaultThreadSettings.reasoningEffort = 'ultra';
  api.state.model = 'gpt-5.6-sol';
  api.state.reasoningEffort = 'xhigh';

  const defaultHtml = api.renderAppSettings().innerHTML;
  const defaultReasoning = defaultHtml.match(/<select id="default-reasoning-select"[\s\S]*?<\/select>/u)?.[0] || '';
  const sessionHtml = api.renderSettingsDrawer();
  const sessionReasoning = sessionHtml.match(/<select id="reasoning-select"[\s\S]*?<\/select>/u)?.[0] || '';

  assert.match(defaultHtml, /<label for="default-model-select">模型<\/label>/u);
  assert.match(defaultHtml, /<label for="default-reasoning-select">推理<\/label>/u);
  assert.match(defaultReasoning, />Medium<\/option>/u);
  assert.match(defaultReasoning, />xhigh<\/option>/u);
  assert.match(defaultReasoning, />Ultra<\/option>/u);
  assert.doesNotMatch(defaultReasoning, />中<\/option>|>极高<\/option>/u);
  assert.match(sessionHtml, /<select id="model-select" name="model" data-i18n-skip>/u);
  assert.match(sessionHtml, /<select id="reasoning-select" name="reasoningEffort" data-i18n-skip>/u);
  assert.match(sessionReasoning, />Medium<\/option>/u);
  assert.match(sessionReasoning, />xhigh<\/option>/u);
  assert.match(sessionReasoning, />Ultra<\/option>/u);
  assert.doesNotMatch(sessionReasoning, />中<\/option>|>极高<\/option>/u);
});

test('Chinese session settings localize the running-state card and keep the close symbol compact', async () => {
  const { api } = await loadAppHarness();
  api.applyLanguage('zh-CN');
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.state.settingsOpen = true;

  const html = api.renderChat().innerHTML;

  assert.match(html, /data-session-state="running"[\s\S]*当前会话正在运行/u);
  assert.match(html, /id="stop-button"[^>]*>停止<\/button>/u);
  assert.match(html, /id="settings-drawer-close"[\s\S]*?<span aria-hidden="true">×<\/span>/u);
  assert.doesNotMatch(html, /&amp;times;|&times;/u);
});

test('Chinese language localization leaves conversation and session file markdown content untouched', async () => {
  const { api } = await loadAppHarness();

  api.applyLanguage('zh-CN');
  api.state.view = 'chat';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.timeline = [
    { kind: 'message', role: 'user', label: 'You', meta: '', text: 'Send', attachments: [] },
    {
      kind: 'message',
      role: 'assistant',
      label: 'Assistant',
      meta: 'final',
      text: [
        '| Action | Status |',
        '| --- | --- |',
        '| Send | Read only |',
        '',
        'Send',
        'Read only',
      ].join('\n'),
      attachments: [],
    },
  ];

  const chatHtml = api.renderChat().innerHTML;
  assert.match(chatHtml, /<span class="card-title">你<\/span>/u);
  assert.match(chatHtml, /<p class="message-text">Send<\/p>/u);
  assert.match(chatHtml, /<div class="message-text markdown-body">[\s\S]*<p>Send Read only<\/p>[\s\S]*<\/div>/u);
  assert.doesNotMatch(chatHtml, /Send 只读/u);

  api.state.currentSessionFile = {
    id: 'file_summary',
    name: 'summary.md',
    kind: 'markdown',
  };
  api.state.currentSessionFileContent = [
    '# Send',
    '',
    '| Action | Status |',
    '| --- | --- |',
    '| Send | Read only |',
    '',
    'Send',
    'Read only',
  ].join('\n');

  const fileHtml = api.renderSessionFileViewer().innerHTML;
  assert.match(fileHtml, /<div class="session-file-document markdown-body" data-i18n-skip>/u);
  assert.match(fileHtml, /<h1>Send<\/h1>/u);
  assert.match(fileHtml, /<p>Send Read only<\/p>/u);
  assert.doesNotMatch(fileHtml, /发送/u);
  assert.doesNotMatch(fileHtml, /Send 只读/u);
});

test('Chinese language localization leaves dynamic names and drafts untouched', async () => {
  const { api } = await loadAppHarness();

  api.applyLanguage('zh-CN');
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{
    id: 'session_1',
    cwd: '/repo/Send',
    projectDisplayName: 'Send',
    firstUserInput: 'Send',
    lastUserInput: 'Send',
    updatedAt: '2026-05-19T10:00:00.000Z',
    favorite: false,
  }];
  api.state.currentSession = {
    id: 'session_1',
    cwd: '/repo/Send',
    projectDisplayName: 'Send',
    goal: { status: 'active', objective: 'Send' },
  };
  api.state.sessionId = 'session_1';
  api.state.selectedProjectLabel = 'Send';
  api.state.queuedMessages = new Map([
    ['session_1', [{ id: 'queued_1', text: 'Send', status: 'pending' }]],
  ]);

  const sessionListHtml = api.renderSessionList().innerHTML;
  assert.match(sessionListHtml, /<span class="project-rail-item-main" data-i18n-skip>Send<\/span>/u);
  assert.match(sessionListHtml, /<span class="session-project" data-i18n-skip>Send<\/span>/u);
  assert.match(sessionListHtml, /<span class="session-title" data-i18n-skip>Send<\/span>/u);
  assert.match(sessionListHtml, /<button class="ghost compact-button session-archive"[^>]*aria-label="归档"/u);
  assert.doesNotMatch(sessionListHtml, /<span class="session-project">发送<\/span>/u);
  assert.doesNotMatch(sessionListHtml, /<span class="session-title">发送<\/span>/u);

  const chatHtml = api.renderChat().innerHTML;
  assert.match(chatHtml, /<span>Goal active<\/span>/u);
  assert.match(chatHtml, /<span class="goal-objective">Send<\/span>/u);
  assert.match(chatHtml, /<span class="queued-message-text" data-i18n-skip>Send<\/span>/u);
  assert.match(chatHtml, /aria-label="删除排队消息"/u);
  assert.doesNotMatch(chatHtml, /目标进行中/u);
  assert.doesNotMatch(chatHtml, /<span class="goal-objective">发送<\/span>/u);
  assert.doesNotMatch(chatHtml, /<span class="queued-message-text">发送<\/span>/u);

});

test('Chinese mobile project drawer toggles without rerendering the session list', async () => {
  const { api, context } = await loadAppHarness();

  api.applyLanguage('zh-CN');
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = Array.from({ length: 50 }, (_item, index) => ({
    id: `session_${index}`,
    cwd: `/repo/project-${index}`,
    projectDisplayName: `Project ${index}`,
    lastUserInput: `Send ${index}`,
    updatedAt: `2026-05-19T10:${String(index).padStart(2, '0')}:00.000Z`,
    settings: { metadata: {} },
  }));
  api.render();

  const renderCountBeforeOpen = context.__appRenderCount;
  const toggleButton = context.document.querySelector('#mobile-sidebar-toggle-button');
  assert.ok(toggleButton);
  toggleButton.click();

  assert.equal(api.state.mobileSidebarOpen, true);
  assert.equal(context.__appRenderCount, renderCountBeforeOpen);
  assert.equal(context.document.querySelector('#mobile-drawer-backdrop')?.classList.contains('is-open'), true);
  assert.equal(context.document.querySelector('.mobile-project-drawer')?.classList.contains('is-open'), true);

  const renderCountBeforeClose = context.__appRenderCount;
  const backdrop = context.document.querySelector('#mobile-drawer-backdrop');
  assert.ok(backdrop);
  backdrop.click();

  assert.equal(api.state.mobileSidebarOpen, false);
  assert.equal(context.__appRenderCount, renderCountBeforeClose);
  assert.equal(context.document.querySelector('#mobile-drawer-backdrop')?.classList.contains('is-open'), false);
  assert.equal(context.document.querySelector('.mobile-project-drawer')?.classList.contains('is-open'), false);
});

test('Chinese session list skips bulk localization when returning from chat', async () => {
  const { api, context } = await loadAppHarness();

  api.applyLanguage('zh-CN');
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_0';
  api.state.currentSession = { id: 'session_0', cwd: '/repo/project-0', settings: { metadata: {} } };
  api.state.sessions = Array.from({ length: 80 }, (_item, index) => ({
    id: `session_${index}`,
    cwd: `/repo/project-${index}`,
    projectDisplayName: `Project ${index}`,
    firstUserInput: `Send ${index}`,
    lastUserInput: `Send ${index}`,
    updatedAt: `2026-05-19T10:${String(index).padStart(2, '0')}:00.000Z`,
    settings: { metadata: {} },
  }));

  api.showSessionList();
  const html = context.document.querySelector('#app').innerHTML;

  assert.match(html, /<main class="session-list" aria-busy="false" data-i18n-skip>/u);
  assert.match(html, /<nav class="project-rail-list" data-i18n-skip>/u);
  assert.match(html, /<span class="project-rail-item-main">所有会话<\/span>/u);
  assert.match(html, /<button class="ghost compact-button session-archive"[^>]*aria-label="归档"/u);
  assert.match(html, /<button class="ghost compact-button session-favorite"[^>]*aria-label="收藏"/u);
  assert.match(html, /<span class="session-title" data-i18n-skip>Send 0<\/span>/u);
  assert.doesNotMatch(html, /<span class="session-title" data-i18n-skip>发送 0<\/span>/u);
});

test('Chinese chat timeline skips bulk localization for many conversation items', async () => {
  const { api } = await loadAppHarness();

  api.applyLanguage('zh-CN');
  api.state.view = 'chat';
  api.state.currentSession = { id: 'session_1', cwd: '/repo/Send', settings: { metadata: {} } };
  api.state.timeline = Array.from({ length: 80 }, (_item, index) => ({
    kind: 'message',
    role: index % 2 ? 'assistant' : 'user',
    label: index % 2 ? 'Assistant' : 'You',
    meta: index % 2 ? 'final' : '',
    text: `Send ${index}`,
    attachments: [],
  }));

  const html = api.renderChat().innerHTML;

  assert.match(html, /<main class="timeline" id="timeline" data-i18n-skip>/u);
  assert.match(html, /<span class="card-title">你<\/span>/u);
  assert.match(html, /<span class="card-title">助手<\/span>/u);
  assert.match(html, /<span class="card-kind">最终<\/span>/u);
  assert.match(html, /<p class="message-text">Send 0<\/p>/u);
  assert.doesNotMatch(html, /<p class="message-text">发送 0<\/p>/u);
});

test('Chinese bulk localization skips nested protected containers completely', async () => {
  const { api } = await loadAppHarness();

  api.applyLanguage('zh-CN');

  const html = api.localizeFragment(`
    <section>
      <div class="dynamic-list" data-i18n-skip>
        <div><span>Send</span></div>
        <p>Read only</p>
      </div>
      <button>Send</button>
    </section>
  `);

  assert.match(html, /<span>Send<\/span>/u);
  assert.match(html, /<p>Read only<\/p>/u);
  assert.match(html, /<button>发送<\/button>/u);
  assert.doesNotMatch(html, /<p>只读<\/p>/u);
});

test('Chinese localization preserves named and numeric UI symbols', async () => {
  const { api } = await loadAppHarness();

  api.applyLanguage('zh-CN');
  const html = api.localizeFragment(`
    <button><span>&times;</span></button>
    <span>&middot;</span>
    <span>&#9733;</span>
    <span>&#9734;</span>
    <span>&#8250;</span>
  `);

  assert.match(html, /<span>×<\/span>/u);
  assert.match(html, /<span>·<\/span>/u);
  assert.match(html, /<span>★<\/span>/u);
  assert.match(html, /<span>☆<\/span>/u);
  assert.match(html, /<span>›<\/span>/u);
  assert.doesNotMatch(html, /&amp;(?:times|middot|#\d+);/u);
});

test('Chinese admin lists skip bulk localization for many management rows', async () => {
  const { api } = await loadAppHarness();

  api.applyLanguage('zh-CN');
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true, mode: 'multi' } };
  api.state.view = 'admin';
  api.state.admin.loaded = true;
  api.state.admin.settings = { multiUserEnabled: true };
  api.state.admin.page = 'users';
  api.state.admin.roles = [{ id: 'role_user', name: 'User', projectGrants: [] }];
  api.state.admin.users = Array.from({ length: 120 }, (_item, index) => ({
    id: `user_${index}`,
    username: `Send user ${index}`,
    enabled: true,
    roleId: 'role_user',
    roleIds: ['role_user'],
  }));

  const html = api.renderAdminConsole().innerHTML;

  assert.match(html, /<div class="admin-list" data-i18n-skip>/u);
  assert.match(html, /<span class="admin-row-main" data-i18n-skip>Send user 0<\/span>/u);
  assert.match(html, /<button class="ghost compact-button" type="button" data-admin-edit-user="user_0">编辑<\/button>/u);
  assert.match(html, /data-admin-toggle-user-enabled="false">停用<\/button>/u);
  assert.match(html, /data-admin-delete-user-id="user_0">删除<\/button>/u);
  assert.doesNotMatch(html, /<span class="admin-row-main" data-i18n-skip>发送 user 0<\/span>/u);
});

test('Chinese new-session project picker skips bulk localization for many projects', async () => {
  const { api } = await loadAppHarness();

  api.applyLanguage('zh-CN');
  api.state.authSession = { id: 'auth_1', principal: { userId: 'user_1', isAdmin: false, mode: 'multi' } };
  api.state.view = 'new';
  api.state.projectsLoaded = true;
  api.state.projects = Array.from({ length: 120 }, (_item, index) => ({
    id: `project_${index}`,
    cwd: `/repo/project-${index}`,
    displayName: `Send project ${index}`,
    enabled: true,
  }));

  const html = api.renderNewSession().innerHTML;

  assert.match(html, /<select id="new-project-select" name="projectId" data-i18n-skip>/u);
  assert.match(html, /<option value="project_0" selected data-i18n-skip>Send project 0<\/option>/u);
  assert.match(html, /<button class="primary primary-action" type="submit">开始<\/button>/u);
  assert.doesNotMatch(html, /发送 project 0/u);
});

test('Chinese dynamic chat subcomponents localize fixed labels without translating user data', async () => {
  const { api } = await loadAppHarness();

  api.applyLanguage('zh-CN');
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo/Send', settings: { metadata: {} } };
  api.state.queuedMessages = new Map([
    ['session_1', [{ id: 'queued_1', text: 'Send queued', status: 'pending' }]],
  ]);
  api.state.composerAttachments = [{
    id: 'local_att_1',
    status: 'ready',
    fileName: 'Send.txt',
    sizeBytes: 12,
    uploaded: { storage: 'state' },
  }];
  api.state.timeline = [
    {
      kind: 'message',
      role: 'user',
      label: 'You',
      text: 'See attachment',
      attachments: [{ kind: 'image', fileName: 'Send.png', mimeType: 'image/png' }],
    },
    {
      id: 'batch_1',
      kind: 'batch',
      title: 'Batch',
      status: 'running',
      summary: { command: 'echo Send', approval: 'required' },
    },
  ];

  const html = api.renderChat().innerHTML;

  assert.match(html, /<span class="queued-message-text" data-i18n-skip>Send queued<\/span>/u);
  assert.match(html, /aria-label="删除排队消息"[^>]*>删除<\/button>/u);
  assert.match(html, /<span class="attachment-name" data-i18n-skip>Send\.txt<\/span>/u);
  assert.match(html, /<span class="attachment-status">已保存<\/span>/u);
  assert.match(html, /aria-label="移除 Send\.txt"/u);
  assert.match(html, /<span class="message-attachment-kind">图片<\/span>/u);
  assert.match(html, /<span class="message-attachment-name" data-i18n-skip>Send\.png<\/span>/u);
  assert.match(html, /<span class="card-kind">运行中<\/span>/u);
  assert.match(html, /<strong>命令<\/strong>/u);
  assert.match(html, /<strong>审批<\/strong>/u);
  assert.doesNotMatch(html, /发送 queued/u);
  assert.doesNotMatch(html, /发送\.txt/u);
});

test('pull refresh indicator keeps readable themed colors', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.pull-refresh-indicator\s*\{[^}]*background:\s*var\(--panel\);/su);
  assert.match(styles, /\.pull-refresh-indicator\s*\{[^}]*color:\s*var\(--text\);/su);
  assert.doesNotMatch(styles, /\.pull-refresh-indicator\s*\{[^}]*background:\s*rgba\(18,\s*23,\s*34/su);
});

test('session card titles reserve two lines while latest input stays compact', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.session-title\s*\{[^}]*display:\s*-webkit-box;/su);
  assert.match(styles, /\.session-title\s*\{[^}]*-webkit-box-orient:\s*vertical;/su);
  assert.match(styles, /\.session-title\s*\{[^}]*-webkit-line-clamp:\s*2;/su);
  assert.match(styles, /\.session-title\s*\{[^}]*min-height:\s*calc\(var\(--session-summary-line-height\)\s*\*\s*2\);/su);
  assert.doesNotMatch(styles, /\.session-title\s*\{[^}]*font-weight:\s*(?:600|650|700|bold);/su);
  assert.match(styles, /\.session-card-open\s*\{[^}]*font-weight:\s*400;/su);
  assert.match(styles, /body\s*\{[^}]*font-weight:\s*450;/su);
  assert.match(styles, /\.session-project\s*\{[^}]*font-weight:\s*650;/su);
  assert.match(styles, /\.session-preview\s*\{[^}]*white-space:\s*nowrap;/su);
  assert.match(styles, /\.session-preview\s*\{[^}]*text-overflow:\s*ellipsis;/su);
});

test('new session path entry and primary submit buttons are readable on mobile', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(app, /<textarea id="new-cwd-input"[^>]*name="cwd"[^>]*rows="3"/u);
  assert.doesNotMatch(app, /<input id="new-cwd-input"[^>]*type="text"/u);
  assert.match(styles, /\.new-session-page \.panel\s*\{[^}]*width:\s*100%;/su);
  assert.match(styles, /\.new-session-page textarea\s*\{[^}]*min-height:\s*92px;/su);
  assert.match(styles, /\.new-session-page textarea\s*\{[^}]*resize:\s*vertical;/su);
  assert.match(styles, /\.primary-action\s*\{[^}]*min-height:\s*48px;/su);
  assert.match(app, /<button class="\$\{desktop \? 'primary compact-button' : 'primary primary-action'\}" type="submit"\$\{startDisabled \? ' disabled' : ''\}>Start<\/button>/u);
  assert.match(app, /<button class="primary primary-action" type="submit">\$\{escapeHtml\(t\('Log in'\)\)\}<\/button>/u);
});

test('danger buttons use theme-aware readable colors', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.danger\s*\{[^}]*border-color:\s*color-mix\(in srgb,\s*var\(--danger\) 58%,\s*var\(--border\)\);/su);
  assert.match(styles, /\.danger\s*\{[^}]*color:\s*var\(--danger\);/su);
  assert.doesNotMatch(styles, /\.danger\s*\{[^}]*color:\s*#ffd9d9;/su);
});

test('sessions without saved settings use app default thread settings', async () => {
  const { api } = await loadAppHarness();

  api.applyDefaultThreadSettings({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    collaborationMode: 'plan',
    accessPreset: 'read-only',
  });

  api.applySessionSettings({ id: 'thread_without_settings', settings: {} });

  assert.equal(api.state.model, 'gpt-5.4-mini');
  assert.equal(api.state.reasoningEffort, 'low');
  assert.equal(api.state.collaborationMode, 'plan');
  assert.equal(api.state.permissionPreset, 'read-only');
  assert.equal(api.state.approvalPolicy, 'never');
  assert.equal(api.state.sandboxMode, 'read-only');
});

test('sessions navigation remains available during a pending turn', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.doesNotMatch(app, /id="back-to-list-button"[^>]*state\.pendingTurn \? 'disabled'/u);
  assert.doesNotMatch(app, /function showSessionList\(\)\s*\{\s*if \(state\.pendingTurn\)/u);
  assert.doesNotMatch(app, /function openNewSessionPage\(\)\s*\{\s*if \(state\.pendingTurn\)/u);
  assert.doesNotMatch(app, /async function selectSession\(sessionId\)\s*\{\s*if \(state\.pendingTurn\)/u);
});

test('message input starts one line and auto-grows to a compact capped height', async () => {
  const [styles, app] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
  ]);

  assert.match(app, /<textarea id="prompt-input"[^>]*rows="1"/u);
  assert.match(app, /id="composer-expand-button"/u);
  assert.match(app, /function updateComposerExpansionState\(textarea\)/u);
  assert.match(app, /function toggleComposerExpanded\(\)/u);
  assert.match(app, /class="composer-wrap \$\{composerClassName\}"/u);
  assert.match(app, /class="composer \$\{composerClassName\}"/u);
  assert.match(app, /class="message-editor-shell \$\{composerClassName\}"/u);
  assert.match(styles, /\.compact-composer-row textarea\s*\{[^}]*min-height:\s*38px;/su);
  assert.match(styles, /\.compact-composer-row textarea\s*\{[^}]*max-height:\s*116px;/su);
  assert.match(styles, /\.compact-composer-row textarea\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.composer\.is-expanded\s*\{/su);
  assert.match(styles, /\.message-editor-shell\s*\{[^}]*position:\s*relative;/su);
  assert.doesNotMatch(styles, /\.message-editor-shell\[data-editor-toggle-visible=/u);
  assert.doesNotMatch(styles, /\.message-editor-shell\.is-expanded textarea\s*\{[^}]*padding-left:/su);
  assert.doesNotMatch(styles, /\.composer-editor-toggle/u);
  assert.match(styles, /\.composer-leading-controls\s*\{[^}]*gap:\s*6px;/su);
  assert.match(styles, /\.icon-button\[hidden\]\s*\{[^}]*display:\s*none;/su);
  assert.match(styles, /\.icon-button,\s*\.compact-send,\s*\.compact-refresh\s*\{[^}]*min-height:\s*38px;/su);
  assert.match(styles, /\.icon-button,\s*\.compact-send,\s*\.compact-refresh\s*\{[^}]*padding:\s*0 8px;/su);
  assert.match(app, /function autoGrowPromptInput\(textarea\)/u);
  assert.match(app, /textarea\.style\.height = 'auto';/u);
  assert.match(app, /if \(state\.composerExpanded\) \{\s*textarea\.style\.height = '';\s*return;\s*\}/u);
  assert.match(app, /PROMPT_TEXTAREA_MAX_HEIGHT/u);
  assert.match(app, /PROMPT_EXPAND_LINE_THRESHOLD/u);
  assert.match(app, /Math\.min\(textarea\.scrollHeight, maxHeight\)/u);
  assert.match(app, /Math\.max\(38, nextHeight\)/u);
  assert.match(app, /autoGrowPromptInput\(promptInput\)/u);
  assert.match(styles, /\.composer\.is-expanded\s*\{[^}]*min-height:\s*min\(84dvh,\s*640px\);/su);
  assert.doesNotMatch(styles, /\.composer\.is-expanded \.compact-composer-row textarea\s*\{[^}]*min-height:\s*min\(72dvh,\s*560px\);/su);
  assert.doesNotMatch(styles, /\.composer\.is-expanded \.compact-composer-row textarea\s*\{[^}]*max-height:\s*min\(72dvh,\s*560px\);/su);
});

test('message input focus uses themed outline instead of browser default blue ring', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.composer textarea:focus\s*\{[^}]*outline:\s*none;/su);
  assert.match(styles, /\.composer textarea:focus\s*\{[^}]*border-color:\s*color-mix\(in srgb,\s*var\(--accent\)/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded textarea:focus\s*\{[^}]*box-shadow:\s*none;/su);
});

test('chat composer renders attachment control and keeps the session menu in the topbar', async () => {
  const { api } = await loadAppHarness();

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };

  const html = api.renderChat().innerHTML;
  assert.match(html, /id="attach-button"/u);
  assert.match(html, /id="attachment-input"/u);
  assert.match(html, /class="chat-header-actions"[\s\S]*id="settings-toggle"[^>]*aria-label="Session menu"[^>]*>[\s\S]*class="button-icon button-icon-more"[\s\S]*<\/button>/u);
  assert.doesNotMatch(html, /id="settings-toggle"[^>]*>Set<\/button>/u);
  const composerHtml = html.match(/<form class="composer[\s\S]*?<\/form>/u)?.[0] || '';
  assert.doesNotMatch(composerHtml, /id="settings-toggle"/u);
});

test('narrow desktop prompt paste uploads clipboard files through the attachment flow', async () => {
  const uploadRequests = [];
  const { api } = await loadAppHarness({
    viewportWidth: 900,
    viewportHeight: 1200,
    desktopPointer: true,
    fetch: async (path, options = {}) => {
      if (path !== '/api/sessions/session_1/attachments') {
        throw new Error(`unexpected fetch ${path}`);
      }
      const files = options.body.getAll('files');
      uploadRequests.push(files.map((file) => file.name));
      return {
        ok: true,
        status: 201,
        json: async () => ({
          items: files.map((file, index) => ({
            id: `attachment_${index}`,
            kind: file.type.startsWith('image/') ? 'image' : 'file',
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            storage: 'state',
            localPath: `/state/${file.name}`,
          })),
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.prompt = 'Keep this text';

  let textPastePrevented = false;
  const textHandled = await api.handlePromptPaste({
    clipboardData: { files: [], items: [{ kind: 'string' }] },
    preventDefault() {
      textPastePrevented = true;
    },
  });
  assert.equal(textHandled, false);
  assert.equal(textPastePrevented, false);

  const pastedFiles = [
    new File(['image'], 'pasted-image.png', { type: 'image/png' }),
    new File(['notes'], 'pasted-notes.txt', { type: 'text/plain' }),
  ];
  let filePastePrevented = false;
  const filesHandled = await api.handlePromptPaste({
    clipboardData: {
      files: pastedFiles,
      items: [{ kind: 'string' }],
    },
    preventDefault() {
      filePastePrevented = true;
    },
  });

  assert.equal(api.hasDesktopPointer(), true);
  assert.equal(api.isDesktopLayout(), false);
  assert.equal(filesHandled, true);
  assert.equal(filePastePrevented, true);
  assert.equal(api.state.prompt, 'Keep this text');
  assert.equal(JSON.stringify(uploadRequests), JSON.stringify([['pasted-image.png', 'pasted-notes.txt']]));
  assert.equal(JSON.stringify(api.state.composerAttachments.map((attachment) => ({
    status: attachment.status,
    kind: attachment.uploaded?.kind,
    fileName: attachment.uploaded?.fileName,
  }))), JSON.stringify([
    { status: 'ready', kind: 'image', fileName: 'pasted-image.png' },
    { status: 'ready', kind: 'file', fileName: 'pasted-notes.txt' },
  ]));
});

test('draft attachments upload without pre-creating a session', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    viewportWidth: 900,
    desktopPointer: true,
    fetch: async (path, options = {}) => {
      fetchCalls.push(path);
      assert.equal(path, '/api/session-submission-attachments?cwd=%2Frepo');
      const [file] = options.body.getAll('files');
      return {
        ok: true,
        status: 201,
        json: async () => ({
          items: [{
            id: 'draft_attachment_1',
            kind: 'file',
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            storage: 'state',
            localPath: `/state/${file.name}`,
          }],
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.draftSessionActive = true;
  api.state.cwd = '/repo';

  await api.handlePromptPaste({
    clipboardData: { files: [new File(['draft'], 'draft.txt', { type: 'text/plain' })] },
    preventDefault() {},
  });

  assert.deepEqual(fetchCalls, ['/api/session-submission-attachments?cwd=%2Frepo']);
  assert.equal(api.state.sessionId, null);
  assert.equal(api.state.draftSessionActive, true);
  assert.equal(api.state.composerAttachments[0]?.uploaded?.id, 'draft_attachment_1');
});

test('composer sends ready attachments with the next turn payload', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ turnId: 'turn_attachment' }),
        };
      }
      if (path === '/api/turns/turn_attachment/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.prompt = 'Read the upload';
  api.state.composerAttachments = [{
    id: 'local_att_1',
    status: 'ready',
    fileName: 'notes.txt',
    sizeBytes: 12,
    mimeType: 'text/plain',
    uploaded: {
      id: 'att_1',
      kind: 'file',
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      localPath: '/repo/uploads/local-admin/att_1-notes.txt',
      storage: 'project',
    },
  }];

  await api.onComposerSubmit({ preventDefault() {} });

  const turnBody = JSON.parse(fetchCalls[0]?.options.body);
  assert.deepEqual(turnBody.attachmentIds, ['att_1']);
  assert.deepEqual(turnBody.attachments, [{
    id: 'att_1',
    kind: 'file',
    fileName: 'notes.txt',
    mimeType: 'text/plain',
    localPath: '/repo/uploads/local-admin/att_1-notes.txt',
    storage: 'project',
  }]);
  assert.equal(api.state.composerAttachments.length, 0);
});

test('hydrated user messages hide attachment prompt metadata and render attachment cards', async () => {
  const { api } = await loadAppHarness();
  const rawPrompt = [
    '这是什么猫？',
    '',
    'Attachments:',
    '1. image',
    '   path: /repo/uploads/user_admin/att_1-IMG_4683.jpeg',
    '   filename: IMG_4683.jpeg',
    '   mime: image/jpeg',
    '   attached_as: localImage',
    '',
    'Use the local file paths above when you inspect these attachments.',
  ].join('\n');

  const timeline = api.hydrateTimelineFromSession({
    id: 'session_1',
    thread: {
      turns: [{
        id: 'turn_1',
        status: 'completed',
        items: [
          { type: 'message', role: 'user', text: rawPrompt },
          { type: 'message', role: 'assistant', text: 'Looks like a long-haired kitten.' },
        ],
      }],
    },
  });

  assert.equal(timeline[0].text, '这是什么猫？');
  assert.deepEqual(JSON.parse(JSON.stringify(timeline[0].attachments)), [{
    kind: 'image',
    localPath: '/repo/uploads/user_admin/att_1-IMG_4683.jpeg',
    fileName: 'IMG_4683.jpeg',
    mimeType: 'image/jpeg',
    sizeBytes: null,
  }]);

  const html = api.renderTimelineItem(timeline[0]);
  assert.match(html, /这是什么猫？/u);
  assert.match(html, /IMG_4683\.jpeg/u);
  assert.match(html, /Image/u);
  assert.match(html, /<button class="message-attachment is-image"[^>]*data-session-file-path="\/repo\/uploads\/user_admin\/att_1-IMG_4683\.jpeg"/u);
  assert.doesNotMatch(html, /Attachments:/u);
  assert.doesNotMatch(html, /attached_as/u);
  assert.doesNotMatch(html, /localImage/u);
});

test('composer shows external expand above Attach and keeps session menu in the topbar', async () => {
  const { api } = await loadAppHarness();

  api.state.view = 'chat';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.composerCanExpand = false;
  api.state.composerExpanded = false;

  const shortHtml = api.renderChat().innerHTML;
  assert.match(shortHtml, /id="settings-toggle"[^>]*aria-label="Session menu"[^>]*>[\s\S]*class="button-icon button-icon-more"[\s\S]*<\/button>/u);
  assert.doesNotMatch(shortHtml, /id="settings-toggle"[^>]*hidden/u);
  assert.match(shortHtml, /id="composer-expand-button"[^>]*hidden/u);
  assert.match(shortHtml, /class="chat-header-actions"[\s\S]*id="settings-toggle"[^>]*>[\s\S]*class="button-icon button-icon-more"[\s\S]*<\/button>/u);
  assert.match(shortHtml, /id="attach-button"[^>]*>\+<\/button>/u);
  assert.match(shortHtml, /class="message-editor-shell [^"]*"/u);
  assert.match(shortHtml, /<textarea id="prompt-input"[\s\S]*<button class="primary compact-send" type="submit" id="send-button"[^>]*aria-label="Send"[^>]*>Send<\/button>/u);
  assert.doesNotMatch(shortHtml, /id="composer-refresh-button"/u);
  assert.match(shortHtml, /class="composer-wrap "/u);
  const shortComposerHtml = shortHtml.match(/<form class="composer[\s\S]*?<\/form>/u)?.[0] || '';
  assert.doesNotMatch(shortComposerHtml, /id="settings-toggle"/u);

  api.state.composerCanExpand = true;
  const compactHtml = api.renderChat().innerHTML;
  assert.match(compactHtml, /class="composer-wrap is-expandable"/u);
  assert.match(compactHtml, /class="composer is-expandable"/u);
  assert.match(compactHtml, /class="message-editor-shell is-expandable"/u);
  assert.match(compactHtml, /<div class="composer-leading-controls">[\s\S]*id="composer-expand-button"[\s\S]*\^<\/button>[\s\S]*id="attach-button"[^>]*>\+<\/button>[\s\S]*<\/div>/u);
  assert.doesNotMatch(compactHtml, /id="settings-toggle"[^>]*hidden/u);

  api.state.composerExpanded = true;
  api.state.settingsOpen = true;
  api.state.error = 'Failure stays available after collapsing';
  const expandedHtml = api.renderChat().innerHTML;

  assert.match(expandedHtml, /class="chat-header-actions"[\s\S]*id="settings-toggle"[^>]*>[\s\S]*class="button-icon button-icon-more"[\s\S]*<\/button>/u);
  assert.doesNotMatch(expandedHtml, /id="settings-toggle"[^>]*hidden/u);
  assert.doesNotMatch(expandedHtml, /settings-drawer/u);
  assert.doesNotMatch(expandedHtml, /composer-status/u);
  assert.doesNotMatch(expandedHtml, /composer-error/u);
  assert.match(expandedHtml, /class="composer-wrap is-expanded"/u);
  assert.match(expandedHtml, /class="composer is-expanded"/u);
  assert.match(expandedHtml, /<div class="composer-leading-controls">[\s\S]*id="composer-expand-button"[\s\S]*v<\/button>[\s\S]*<\/div>/u);
  assert.doesNotMatch(expandedHtml, /id="attach-button"/u);
  assert.match(expandedHtml, /<div class="message-editor-shell is-expanded"[\s\S]*<textarea id="prompt-input"[\s\S]*<button class="primary compact-send" type="submit" id="send-button"[^>]*aria-label="Send"[^>]*>Send<\/button>[\s\S]*<\/div>/u);
  assert.doesNotMatch(expandedHtml, /id="composer-refresh-button"/u);
  assert.match(expandedHtml, /<textarea id="prompt-input"[\s\S]*id="send-button"/u);
});

test('session settings drawer closes when tapping outside the drawer', async () => {
  const { api } = await loadAppHarness();

  assert.equal(typeof api.handleSessionSettingsOutsideClick, 'function');

  api.state.view = 'chat';
  api.state.settingsOpen = true;
  const renderCountBeforeInsideTap = api.context.__appRenderCount;

  api.handleSessionSettingsOutsideClick({
    target: {
      closest: (selector) => selector.includes('.settings-drawer') ? {} : null,
    },
  });

  assert.equal(api.state.settingsOpen, true);
  assert.equal(api.context.__appRenderCount, renderCountBeforeInsideTap);
  const renderCountAfterInsideTap = api.context.__appRenderCount;

  api.handleSessionSettingsOutsideClick({
    target: {
      closest: () => null,
    },
  });

  assert.equal(api.state.settingsOpen, false);
  assert.ok(api.context.__appRenderCount > renderCountAfterInsideTap);
});

test('dialogs and drawers expose modal semantics, focus scopes, and live status regions', async () => {
  const app = await readFile(appUrl, 'utf8');
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.globalSettings.publicSharesEnabled = true;
  api.state.settingsOpen = true;
  api.state.shareDialog = { url: 'https://example.test/share/token', copied: false };

  const html = api.renderChat().innerHTML;
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" data-focus-scope="share-dialog"/u);
  assert.match(html, /id="share-link-input"[^>]*data-initial-focus/u);
  assert.match(html, /role="dialog" aria-modal="true" aria-label="Session settings" data-focus-scope="session-settings"/u);
  assert.match(html, /id="settings-drawer-close"[^>]*aria-label="Close session menu"[^>]*data-initial-focus/u);
  assert.doesNotMatch(html, /id="runtime-reload-button"[^>]*data-initial-focus/u);
  assert.match(html, /class="composer-status"[^>]*role="status"[^>]*aria-live="polite"/u);
  assert.match(app, /document\.addEventListener\('keydown', handleFocusScopeKeydown\)/u);
  assert.match(app, /function makeBackgroundInert\(scope\)/u);
  assert.match(app, /function resolveFocusReturnTarget\(target\)/u);
});

test('full renders clear managed inert state before replacing the DOM tree', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function render\(\)\s*\{[\s\S]*?detachTimelineScrollTracking\(\);\s*clearManagedInert\(\);\s*app\.innerHTML = '';/u);
  assert.match(app, /function detachTimelineScrollTracking\(\)[\s\S]*removeEventListener\('scroll', updateTimelineFollowState\)[\s\S]*removeEventListener\('wheel', handleTimelineWheel\)/u);
});

test('Escape closes the active settings drawer', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.settingsOpen = true;
  const event = {
    key: 'Escape',
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };

  api.handleFocusScopeKeydown(event);

  assert.equal(api.state.settingsOpen, false);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
});

test('Tab remains trapped inside the active modal focus scope', async () => {
  const { api, context } = await loadAppHarness();
  let firstFocusCount = 0;
  const first = { hidden: false, inert: false, getAttribute: () => null, focus() { firstFocusCount += 1; } };
  const last = { hidden: false, inert: false, getAttribute: () => null, focus() {} };
  const scope = {
    querySelectorAll: () => [first, last],
  };
  const originalQuerySelector = context.document.querySelector;
  context.document.querySelector = (selector) => selector === '[data-focus-scope="share-dialog"]'
    ? scope
    : originalQuerySelector(selector);
  Object.defineProperty(context.document, 'activeElement', { configurable: true, value: last });
  api.state.shareDialog = { url: 'https://example.test/share/token', copied: false };
  const event = {
    key: 'Tab',
    shiftKey: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };

  api.handleFocusScopeKeydown(event);

  assert.equal(event.prevented, true);
  assert.equal(firstFocusCount, 1);
});

test('expanded composer positions collapse and Send inside a single editor surface', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.composer\.is-expanded\s*\{[^}]*padding:\s*0;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded\s*\{[^}]*position:\s*relative;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded\s*\{[^}]*min-height:\s*min\(84dvh,\s*640px\);/su);
  assert.match(styles, /\.composer\.is-expanded \.composer-leading-controls #composer-expand-button\s*\{[^}]*position:\s*absolute;/su);
  assert.match(styles, /\.composer\.is-expanded \.composer-leading-controls #composer-expand-button\s*\{[^}]*top:\s*0;/su);
  assert.match(styles, /\.composer\.is-expanded \.composer-leading-controls #composer-expand-button\s*\{[^}]*left:\s*0;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded textarea\s*\{[^}]*height:\s*100%;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded textarea\s*\{[^}]*border-color:\s*transparent;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded textarea\s*\{[^}]*background:\s*transparent;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded textarea\s*\{[^}]*padding:\s*54px 12px 58px;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded \.composer-action-buttons\s*\{[^}]*position:\s*absolute;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded \.composer-action-buttons\s*\{[^}]*right:\s*8px;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded \.composer-action-buttons\s*\{[^}]*bottom:\s*8px;/su);
  assert.doesNotMatch(styles, /\.composer\.is-expanded \.compact-composer-row textarea\s*\{[^}]*max-height:\s*min\(72dvh,\s*560px\);/su);
});

test('running turns keep message sending available and expose Stop only in session settings', async () => {
  const app = await readFile(appUrl, 'utf8');
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.state.settingsOpen = false;

  const closedHtml = api.renderChat().innerHTML;

  assert.match(app, /<textarea id="prompt-input" name="prompt" rows="1" placeholder="Message">/u);
  assert.doesNotMatch(app, /<textarea id="prompt-input"[^>]*state\.pendingTurn \? 'disabled'/u);
  assert.match(app, /id="send-button"/u);
  assert.doesNotMatch(app, /id="\$\{state\.pendingTurn \? 'stop-button' : 'send-button'\}"/u);
  assert.doesNotMatch(closedHtml, /id="stop-button"/u);
  assert.doesNotMatch(closedHtml, /settings-stop-row/u);

  api.state.settingsOpen = true;
  const openHtml = api.renderChat().innerHTML;
  assert.match(openHtml, /class="settings-card settings-stop-row"[\s\S]*class="danger compact-button"[^>]*id="stop-button"[^>]*aria-label="Stop current turn"[^>]*>Stop<\/button>/u);
  assert.equal((openHtml.match(/id="stop-button"/gu) || []).length, 1);
  assert.doesNotMatch(openHtml, /turn-stop-button/u);
  assert.match(app, /function onComposerSubmit\(event\)[\s\S]*const text = state\.prompt\.trim\(\);/u);
  assert.doesNotMatch(app, /function onComposerSubmit\(event\)\s*\{[\s\S]{0,180}if \(state\.pendingTurn\)/u);
});

test('composer queues a new message while a turn is already running', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.state.prompt = 'Follow-up while running';

  await api.onComposerSubmit({
    preventDefault() {},
  });

  assert.deepEqual(fetchCalls, []);
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_1');
  assert.equal(api.state.prompt, '');
  assert.equal(api.queuedMessagesForCurrentSession().map((item) => item.text).join('\n'), 'Follow-up while running');
  assert.doesNotMatch(api.state.timeline.map((item) => item.text || '').join('\n'), /Follow-up while running/u);

  const html = api.renderChat().innerHTML;
  assert.match(html, /class="queued-message-row"/u);
  assert.match(html, /Follow-up while running/u);
  assert.match(html, /data-queued-message-id=/u);
});

test('queued composer messages can be deleted before they are sent', async () => {
  const { api } = await loadAppHarness();

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.enqueueQueuedMessage('session_1', 'Remove me');

  const queued = api.queuedMessagesForCurrentSession();
  assert.equal(queued.length, 1);
  api.removeQueuedMessage('session_1', queued[0].id);

  assert.equal(api.queuedMessagesForCurrentSession().length, 0);
  assert.doesNotMatch(api.renderChat().innerHTML, /Remove me/u);
});

test('queued composer message hides from the delete row while it is being sent', async () => {
  let resolveTurnRequest: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void = () => {};
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1/turns') {
        return new Promise((resolve) => {
          resolveTurnRequest = resolve;
        });
      }
      if (path === '/api/turns/turn_2/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.enqueueQueuedMessage('session_1', 'Queued now sending');

  const sendPromise = api.sendNextQueuedMessage('session_1');
  await flushMicrotasks();

  assert.deepEqual(fetchCalls.map((call) => call.path), ['/api/sessions/session_1/turns']);
  assert.equal(api.queuedMessagesForCurrentSession().length, 1);
  assert.equal(api.queuedMessagesForCurrentSession()[0]?.sending, true);
  const sendingHtml = api.renderChat().innerHTML;
  assert.match(sendingHtml, /Queued now sending/u);
  assert.doesNotMatch(sendingHtml, /class="queued-message-row"/u);
  assert.doesNotMatch(sendingHtml, /data-queued-message-id=/u);

  resolveTurnRequest({
    ok: true,
    status: 202,
    json: async () => ({ turnId: 'turn_2' }),
  });
  await sendPromise;
  await flushMicrotasks();

  assert.equal(api.queuedMessagesForCurrentSession().length, 0);
  assert.equal(JSON.parse(fetchCalls[0].options.body).text, 'Queued now sending');
});

test('turn completion sends the next queued message without interrupting the running turn', async () => {
  const fetchCalls = [];
  let eventRead = 0;
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/turns/turn_1/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => {
                eventRead += 1;
                if (eventRead === 1) {
                  return {
                    done: false,
                    value: new TextEncoder().encode('data: {"type":"turn.completed","turnId":"turn_1","status":"completed","sequence":1}\n\n'),
                  };
                }
                return { done: true };
              },
            }),
          },
        };
      }
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ turnId: 'turn_2' }),
        };
      }
      if (path === '/api/sessions/session_1/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session: { id: 'session_1', cwd: '/repo', settings: { metadata: {} }, thread: { turns: [] } } }),
        };
      }
      if (path === '/api/turns/turn_2/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.enqueueQueuedMessage('session_1', 'Queued follow-up');

  await api.streamTurnEvents('turn_1');
  await flushMicrotasks();

  assert.equal(fetchCalls[0]?.path, '/api/turns/turn_1/events');
  assert.ok(fetchCalls.some((call) => call.path === '/api/sessions/session_1/status'));
  assert.equal(fetchCalls.some((call) => call.path === '/api/sessions/session_1/timeline?limit=50'), false);
  assert.ok(fetchCalls.some((call) => call.path === '/api/turns/turn_2/events'));
  const queuedTurnRequest = fetchCalls.find((call) => call.path === '/api/sessions/session_1/turns');
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_2');
  assert.equal(api.queuedMessagesForCurrentSession().length, 0);
  assert.equal(JSON.parse(queuedTurnRequest.options.body).text, 'Queued follow-up');
});

test('starting a new turn does not reuse the previous turn event sequence in the SSE request', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ turnId: 'turn_2' }),
        };
      }
      if (path === '/api/turns/turn_2/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.prompt = 'Start fresh turn';
  api.state.lastTurnEventSequence = 99;

  await api.onComposerSubmit({ preventDefault() {} });
  await flushMicrotasks();

  const eventsCall = fetchCalls.find((call) => call.path.startsWith('/api/turns/turn_2/events'));
  assert.equal(eventsCall?.path, '/api/turns/turn_2/events');
});

test('session refresh keeps a just-started turn running when backend detail temporarily omits the active turn marker', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ turnId: 'turn_2' }),
        };
      }
      if (path === '/api/turns/turn_2/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              activeTurnId: null,
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_older_completed',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Older question' },
                      { type: 'message', role: 'assistant', text: 'Older answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.prompt = 'Keep running despite stale detail';

  await api.onComposerSubmit({ preventDefault() {} });
  await flushMicrotasks();

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_2');
  assert.equal(api.state.status, 'Turn running');

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_2');
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="work" role="status" aria-live="polite" aria-atomic="true"><span>Working</span></div>');
});

test('session refresh keeps a healthy active stream running when backend detail temporarily regresses to a completed view', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              activeTurnId: null,
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_previous_completed',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Previous request' },
                      { type: 'message', role: 'assistant', text: 'Previous answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = {
    id: 'session_1',
    cwd: '/repo',
    activeTurnId: 'turn_live',
    settings: { metadata: {} },
    thread: {
      turns: [
        {
          id: 'turn_live',
          status: 'in_progress',
          items: [
            { type: 'message', role: 'user', text: 'Build the PPT deck' },
          ],
        },
      ],
    },
  };
  api.state.turnId = 'turn_live';
  api.state.pendingTurn = true;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';
  api.state.streamWasBackgrounded = false;
  api.state.streamAbortController = new AbortController();
  api.state.lastTurnEventAt = Date.now();
  api.state.timeline = [
    {
      id: 'assistant_turn_live',
      kind: 'message',
      role: 'assistant',
      label: 'Assistant',
      meta: 'commentary',
      text: 'Writing the next slide...',
    },
  ];

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_live');
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="work" role="status" aria-live="polite" aria-atomic="true"><span>Working</span></div>');
});

test('stream completion without a terminal event refreshes session state and sends the next queued message', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/turns/turn_1/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Question that just finished' },
                      { type: 'message', role: 'assistant', text: 'Finished elsewhere' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ turnId: 'turn_2' }),
        };
      }
      if (path === '/api/turns/turn_2/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => new Promise(() => {}),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.enqueueQueuedMessage('session_1', 'Queued after silent stream end');

  await api.streamTurnEvents('turn_1');
  await flushMicrotasks();
  await flushMicrotasks();

  assert.equal(fetchCalls[0]?.path, '/api/turns/turn_1/events');
  assert.ok(fetchCalls.some((call) => call.path === '/api/sessions/session_1/status'));
  assert.ok(fetchCalls.some((call) => call.path === '/api/sessions/session_1/timeline?limit=50'));
  assert.ok(fetchCalls.some((call) => call.path === '/api/turns/turn_2/events'));
  const queuedTurnRequest = fetchCalls.find((call) => call.path === '/api/sessions/session_1/turns');
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_2');
  assert.equal(api.queuedMessagesForCurrentSession().length, 0);
  assert.equal(JSON.parse(queuedTurnRequest.options.body).text, 'Queued after silent stream end');
});

test('queued follow-up interrupts a running turn after tool batches complete and immediately starts the next turn', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/turns/turn_1/interrupt') {
        return {
          ok: true,
          status: 202,
          json: async () => ({}),
        };
      }
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'interrupted',
                    items: [
                      { type: 'message', role: 'user', text: 'Initial running prompt' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ turnId: 'turn_2' }),
        };
      }
      if (path === '/api/turns/turn_2/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => new Promise(() => {}),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.enqueueQueuedMessage('session_1', 'Take this new direction');

  let assistantEntry = null;
  assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_1',
    threadId: 'session_1',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_1',
    batchId: 'batch_1',
    kind: 'command',
    title: 'npm test',
  }, assistantEntry);

  api.applyTurnEvent({
    type: 'batch.completed',
    turnId: 'turn_1',
    batchId: 'batch_1',
    status: 'completed',
  }, assistantEntry);

  await flushMicrotasks();
  await flushMicrotasks();

  assert.equal(fetchCalls[0]?.path, '/api/turns/turn_1/interrupt');
  assert.ok(fetchCalls.some((call) => call.path === '/api/sessions/session_1/status'));
  assert.ok(fetchCalls.some((call) => call.path === '/api/sessions/session_1/timeline?limit=50'));
  assert.ok(fetchCalls.some((call) => call.path === '/api/turns/turn_2/events'));
  const queuedTurnRequest = fetchCalls.find((call) => call.path === '/api/sessions/session_1/turns');
  assert.equal(api.state.turnId, 'turn_2');
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.queuedMessagesForCurrentSession().length, 0);
  assert.equal(JSON.parse(queuedTurnRequest.options.body).text, 'Take this new direction');
});

test('queued interrupt acknowledgement timeouts stay hidden and keep the session working', async () => {
  const timeoutMessage = 'Timed out waiting for Codex JSON-RPC response to turn/interrupt';
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/turns/turn_1/interrupt') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'runtime_error', message: timeoutMessage }),
        };
      }
      if (path === '/api/sessions/session_1/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              activeTurnId: 'turn_1',
              activityState: 'running',
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', activeTurnId: 'turn_1' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';
  api.enqueueQueuedMessage('session_1', 'Wait for the running turn');

  api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_1',
    batchId: 'batch_1',
    kind: 'command',
    title: 'npm test',
  }, null);
  api.applyTurnEvent({
    type: 'batch.completed',
    turnId: 'turn_1',
    batchId: 'batch_1',
    status: 'completed',
  }, null);
  await flushMicrotasks();
  await flushMicrotasks();

  assert.deepEqual(fetchCalls, [
    '/api/turns/turn_1/interrupt',
    '/api/sessions/session_1/status',
  ]);
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_1');
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.state.statusTone, 'warn');
  assert.equal(api.state.error, '');
  assert.equal(api.queuedMessagesForCurrentSession().length, 1);
  assert.doesNotMatch(api.renderChat().innerHTML, /Timed out waiting|Failed/u);
});

test('turn interrupt timeout failures are removed from events and hydrated history', async () => {
  const timeoutMessage = 'Timed out waiting for Codex JSON-RPC response to turn/interrupt';
  const { api } = await loadAppHarness();
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  api.applyTurnEvent({
    type: 'turn.failed',
    turnId: 'turn_1',
    message: timeoutMessage,
  }, null);

  const hydrated = api.hydrateTimelineFromSession({
    id: 'session_1',
    timeline: [{
      id: 'error_turn_1',
      kind: 'message',
      role: 'system',
      label: 'Error',
      meta: 'failed',
      severity: 'error',
      text: timeoutMessage,
    }],
    thread: { turns: [] },
  });

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.state.timeline.some((item) => item.text === timeoutMessage), false);
  assert.equal(hydrated.length, 0);
});

test('composer renders handled goal slash command results without streaming a turn', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_goal/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            type: 'command',
            command: {
              name: 'goal',
              action: 'resume',
              message: 'Goal resumed: ship slash goal support',
              goal: {
                threadId: 'session_goal',
                objective: 'ship slash goal support',
                status: 'active',
              },
            },
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'command_user_resume', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/goal resume' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };
  api.state.prompt = '/goal resume';

  await api.onComposerSubmit({
    preventDefault() {},
  });

  assert.deepEqual(fetchCalls.map((call) => call.path), ['/api/sessions/session_goal/turns']);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.status, 'Ready');
  assert.equal(
    JSON.stringify(api.state.timeline.map((item) => item.text)),
    JSON.stringify(['/goal resume', 'Goal resumed: ship slash goal support']),
  );
});

test('goal command completion ignores stale stream load failures from a previous running turn', async () => {
  const fetchCalls = [];
  let rejectStaleFetch = null;
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_goal/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            type: 'command',
            command: {
              name: 'goal',
              action: 'resume',
              message: 'Goal resumed: ship slash goal support',
              goal: {
                threadId: 'session_goal',
                objective: 'ship slash goal support',
                status: 'active',
              },
            },
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'command_user_resume', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/goal resume' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      if (path === '/api/turns/turn_stale/events') {
        return await new Promise((_resolve, reject) => {
          rejectStaleFetch = () => reject(new Error('Load failed'));
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_stale';
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';
  api.state.prompt = '/goal resume';

  const staleStreamPromise = api.streamTurnEvents('turn_stale');

  await api.onComposerSubmit({
    preventDefault() {},
  });

  assert.equal(typeof rejectStaleFetch, 'function');
  rejectStaleFetch();
  await staleStreamPromise;

  assert.deepEqual(fetchCalls.slice(0, 2), [
    '/api/turns/turn_stale/events',
    '/api/sessions/session_goal/turns',
  ]);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.status, 'Ready');
  assert.equal(api.state.error, '');
  assert.doesNotMatch(api.state.timeline.map((item) => item.text || '').join('\n'), /Load failed/u);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Goal resumed: ship slash goal support/u);
});

test('composer renders handled help slash command results inline', async () => {
  const fetchCalls = [];
  const helpMessage = [
    '支持的命令：',
    '- `/help`',
    '- `/goal`',
  ].join('\n');
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_help/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            type: 'command',
            command: {
              name: 'help',
              action: 'show',
              message: helpMessage,
              goal: null,
            },
            session: {
              id: 'session_help',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'command_user_help', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/help' },
                {
                  id: 'command_help_show',
                  kind: 'message',
                  role: 'system',
                  label: '/help',
                  meta: 'show',
                  text: helpMessage,
                },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_help';
  api.state.currentSession = { id: 'session_help', cwd: '/repo' };
  api.state.prompt = '/help';

  await api.onComposerSubmit({
    preventDefault() {},
  });

  const latest = api.state.timeline.at(-1);
  const html = api.renderTimelineItem(latest);
  assert.deepEqual(fetchCalls.map((call) => call.path), ['/api/sessions/session_help/turns']);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(latest?.role, 'system');
  assert.equal(latest?.label, '/help');
  assert.match(html, /<code>\/help<\/code>/u);
  assert.match(html, /<code>\/goal<\/code>/u);
  assert.doesNotMatch(html, /data-session-file-path|\.codex-web\/reports/u);
});

test('settings drawer exposes runtime reload and posts to the runtime endpoint', async () => {
  const app = await readFile(appUrl, 'utf8');
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/runtime/reload') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, mcpServersReloaded: true }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  assert.match(app, /id="runtime-reload-button"/u);
  assert.match(app, /function reloadRuntime\(\)/u);
  assert.match(app, /apiFetch\('\/api\/runtime\/reload',\s*\{\s*method:\s*'POST'\s*\}\)/su);

  api.state.token = 'token';

  await api.reloadRuntime();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.path, '/api/runtime/reload');
  assert.equal(fetchCalls[0]?.options.method, 'POST');
  assert.equal(api.state.status, 'Runtime reloaded');
  assert.equal(api.state.statusTone, 'success');
});

test('settings drawer opens as a scrollable card panel without changing chat scroll geometry', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(app, /function toggleSettingsDrawer\(\)/u);
  assert.match(app, /withTimelineScrollPreserved\(\(\) => render\(\)\)/u);
  assert.match(app, /listenRendered\(settingsToggle, 'click', toggleSettingsDrawer\)/u);
  assert.match(styles, /\.composer\s*\{[^}]*position:\s*relative;/su);
  assert.match(styles, /\.settings-drawer\s*\{[^}]*position:\s*absolute;/su);
  assert.match(styles, /\.settings-drawer\s*\{[^}]*bottom:\s*calc\(100% \+ 6px\);/su);
  assert.match(styles, /\.settings-drawer\s*\{[^}]*max-height:\s*min\(78dvh,\s*700px\);/su);
  assert.match(styles, /\.settings-drawer\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.settings-card\s*\{[^}]*background:\s*var\(--panel\);/su);
  assert.doesNotMatch(styles, /\.settings-drawer\s*\{[^}]*margin-bottom:/su);
});

test('chat settings drawer no longer exposes activity detail controls', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.doesNotMatch(app, /activity-detail-toggle/u);
  assert.doesNotMatch(app, /Activity details/u);
  assert.doesNotMatch(app, /function setActivityDetailsEnabled\(/u);
  assert.doesNotMatch(styles, /\.settings-toggle-row/u);
});

test('app settings page exposes message font size controls scoped to chat messages', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(app, /const MESSAGE_FONT_SIZE_KEY = 'codexWebMessageFontSize';/u);
  assert.match(app, /class="toggle message-size-toggle"/u);
  assert.match(app, /function renderAppSettings\(\)[\s\S]*data-message-font-size="small"[\s\S]*data-message-font-size="medium"[\s\S]*data-message-font-size="large"/u);
  assert.doesNotMatch(app, /function renderSettingsDrawer\(\)[\s\S]*data-message-font-size="small"/u);
  assert.match(app, /for \(const button of document\.querySelectorAll\('\[data-message-font-size\]'\)\)/u);
  assert.match(styles, /\.message-card \.message-text,\s*\.message-card \.markdown-body\s*\{[^}]*font-size:\s*var\(--message-font-size\);/su);
  assert.match(styles, /\.message-card \.markdown-body h1,\s*\.message-card \.markdown-body h2,\s*\.message-card \.markdown-body h3\s*\{[^}]*font-size:\s*var\(--message-heading-font-size\);/su);
  assert.doesNotMatch(styles, /\.session-file-document\s*\{[^}]*font-size:\s*var\(--message-font-size\);/su);
  assert.match(styles, /\.message-size-toggle\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/su);
});

test('message font size loads from storage and applies root variables', async () => {
  const { api, storage, context } = await loadAppHarness({
    storage: {
      codexWebMessageFontSize: 'large',
    },
  });

  const styleCalls = [];
  context.document.documentElement.style.setProperty = (name, value) => {
    styleCalls.push([name, value]);
  };

  api.applyMessageFontSize(api.state.messageFontSize, { persist: false });

  assert.equal(api.state.messageFontSize, 'large');
  assert.equal(storage.get('codexWebMessageFontSize'), 'large');
  assert.equal(context.document.documentElement.dataset.messageFontSize, 'large');
  assert.deepEqual(styleCalls, [
    ['--message-font-size', '17px'],
    ['--message-heading-font-size', '16px'],
  ]);
});

test('changing message font size preserves timeline bottom offset', async () => {
  const { api, storage, context } = await loadAppHarness();

  let fontApplied = false;
  const timeline = {
    _scrollTop: 420,
    clientHeight: 500,
    get scrollTop() {
      return this._scrollTop;
    },
    set scrollTop(value) {
      this._scrollTop = value;
    },
    get scrollHeight() {
      return fontApplied ? 1180 : 1000;
    },
  };
  const appElement = context.document.querySelector('#app');
  context.document.documentElement.style.setProperty = (name) => {
    if (name === '--message-font-size') {
      fontApplied = true;
    }
  };
  context.document.querySelector = (selector) => {
    if (selector === '#timeline') {
      return timeline;
    }
    if (selector === '#app') {
      return appElement;
    }
    return null;
  };

  api.setMessageFontSize('large');

  assert.equal(api.state.messageFontSize, 'large');
  assert.equal(storage.get('codexWebMessageFontSize'), 'large');
  assert.equal(timeline.scrollTop, 600);
});

test('prompt focus protection keeps timeline scroll anchored during keyboard reflow', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /listenRendered\(promptInput, 'touchstart',\s*syncPromptFocusLayout,\s*\{\s*passive:\s*true\s*\}\)/u);
  assert.match(app, /listenRendered\(promptInput, 'focus',\s*syncPromptFocusLayout\)/u);
  assert.match(app, /function scheduleTimelineViewportRestore\(/u);
});

test('prompt focus refreshes textarea layout before input changes', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function syncPromptFocusLayout\(eventOrTextarea\)/u);
  assert.match(app, /function syncPromptInputLayout\(textarea\)/u);
  assert.match(app, /syncPromptFocusLayout[\s\S]*protectPromptFocusScroll\(\)/u);
  assert.match(app, /syncPromptFocusLayout[\s\S]*syncPromptInputLayout\(textarea\)/u);
  assert.match(app, /syncPromptFocusLayout[\s\S]*requestAnimationFrame\(\(\) => \{\s*syncPromptInputLayout\(textarea\);/u);
  assert.match(app, /syncPromptFocusLayout[\s\S]*promptFocusLayoutTimer = setTimeout\(\(\) => \{[\s\S]*syncPromptInputLayout\(textarea\);/u);
  assert.match(app, /promptFocusLayoutTimer/u);
  assert.match(app, /syncPromptInputLayout\(event\.target\);/u);
});

test('chat and session list use separate scroll containers', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /html,\s*body\s*\{[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /#app\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.shell\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.screen\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.timeline\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.timeline\s*\{[^}]*overscroll-behavior:\s*contain;/su);
  assert.match(styles, /\.session-list,\s*\.new-session-page,\s*\.app-settings-page\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.session-list,\s*\.new-session-page,\s*\.app-settings-page\s*\{[^}]*overscroll-behavior:\s*contain;/su);
});

test('session file viewer uses its own scroll container instead of the outer document', async () => {
  const { api, context } = await loadAppHarness();
  const appRoot = { innerHTML: '', appendChild() {} };
  const fileViewer = { id: 'session-file-viewer' };
  const documentScroll = { id: 'document-scroll' };

  api.state.view = 'file';
  context.document.scrollingElement = documentScroll;
  context.document.querySelector = (selector) => {
    if (selector === '.session-file-viewer') {
      return fileViewer;
    }
    if (selector === '#app') {
      return appRoot;
    }
    return null;
  };

  assert.equal(api.getActiveScrollContainer({}), fileViewer);
});

test('desktop workspace CSS waits for enough room before creating three panes', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /@media \(min-width:\s*1280px\) and \(orientation:\s*landscape\) and \(hover:\s*hover\) and \(pointer:\s*fine\)/u);
  assert.match(styles, /\.desktop-workspace\s*\{[^}]*display:\s*grid;/su);
  assert.match(styles, /\.desktop-workspace\s*\{[^}]*grid-template-columns:\s*240px minmax\(320px,\s*380px\) minmax\(640px,\s*1fr\);/su);
  assert.match(styles, /\.desktop-project-rail,\s*\.desktop-session-pane\s*\{[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.desktop-session-list\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.desktop-chat-pane\s*\{[^}]*position:\s*relative;/su);
  assert.match(styles, /\.desktop-chat-pane \.message-card\.assistant,\s*\.desktop-chat-pane \.message-card\.system\s*\{[^}]*max-width:\s*min\(72ch,\s*88%\);/su);
  assert.match(styles, /\.desktop-chat-pane \.message-card\.user\s*\{[^}]*max-width:\s*min\(64ch,\s*74%\);/su);
});

test('desktop sidebars use theme-aware panel backgrounds', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.desktop-project-rail\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--panel\) 92%,\s*var\(--bg\)\);/su);
  assert.match(styles, /\.desktop-session-pane\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--panel\) 78%,\s*var\(--bg\)\);/su);
  assert.match(styles, /\.desktop-session-pane-topbar\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--panel\) 78%,\s*var\(--bg\)\);/su);
  assert.doesNotMatch(styles, /\.desktop-project-rail\s*\{[^}]*background:\s*#[0-9a-f]{3,8}\b/siu);
});

test('desktop composer is anchored inside the right chat pane', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /@media \(min-width:\s*1280px\)[\s\S]*\.desktop-chat-pane \.composer-wrap\s*\{[^}]*position:\s*absolute;/su);
  assert.match(styles, /@media \(min-width:\s*1280px\)[\s\S]*\.desktop-chat-pane \.composer-wrap\s*\{[^}]*left:\s*0;/su);
  assert.match(styles, /@media \(min-width:\s*1280px\)[\s\S]*\.desktop-chat-pane \.composer-wrap\s*\{[^}]*right:\s*0;/su);
  assert.match(styles, /@media \(min-width:\s*1280px\)[\s\S]*\.desktop-chat-pane \.timeline\s*\{[^}]*padding-bottom:\s*var\(--composer-offset\);/su);
});

test('mobile session navigation still clears active session when returning to list', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 390 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Mobile only' }];

  api.showSessionList();

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, null);
  assert.equal(api.state.currentSession, null);
  assert.equal(api.state.timeline.length, 0);
});

test('composer bottom gap stays tight above the keyboard safe area', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.composer-wrap\s*\{[^}]*padding:\s*6px 10px calc\(env\(safe-area-inset-bottom,\s*0px\) \+ 4px\);/su);
});

test('timeline follows the latest messages until the user scrolls upward', async () => {
  const { api, context } = await loadAppHarness();
  const timeline = {
    _scrollTop: 800,
    clientHeight: 200,
    scrollHeight: 1000,
    get scrollTop() {
      return this._scrollTop;
    },
    set scrollTop(value) {
      this._scrollTop = value;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const appElement = context.document.querySelector('#app');
  context.document.querySelector = (selector) => {
    if (selector === '#timeline') {
      return timeline;
    }
    if (selector === '#app') {
      return appElement;
    }
    return null;
  };

  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', text: 'latest' }];

  api.attachTimelineScrollTracking();
  api.state.timeline.push({ id: 'm2', kind: 'message', role: 'assistant', text: 'new latest' });
  api.scrollTimelineToBottomIfFollowingLatest();
  assert.equal(timeline.scrollTop, 1000);

  timeline.scrollHeight = 1200;
  timeline._scrollTop = 700;
  api.updateTimelineFollowState();
  api.state.timeline.push({ id: 'm3', kind: 'message', role: 'assistant', text: 'should not snap' });
  api.scrollTimelineToBottomIfFollowingLatest();
  assert.equal(timeline.scrollTop, 700);
});

test('timeline moves to the latest message before the next animation frame', async () => {
  const animationFrames = [];
  const { api, context } = await loadAppHarness({
    requestAnimationFrame: (callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    },
  });
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_scroll_now';
  api.state.currentSession = { id: 'session_scroll_now', cwd: '/repo' };
  api.state.timeline = [{ id: 'message_1', kind: 'message', role: 'user', text: 'Sent now' }];
  api.state.timelineShouldFollowLatest = true;
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 900;
  timeline.clientHeight = 300;
  timeline.scrollTop = 0;
  animationFrames.length = 0;

  api.scrollTimelineToBottomIfFollowingLatest();

  assert.equal(timeline.scrollTop, 900);
  assert.equal(animationFrames.length, 1);
});

test('desktop workspace render keeps the chat timeline anchored to latest messages', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', text: 'latest' }];
  api.state.timelineShouldFollowLatest = true;

  api.render();

  const timeline = context.document.querySelector('#timeline');
  assert.equal(timeline.scrollTop, timeline.scrollHeight);
});

test('desktop workspace keeps streamed work out of the timeline while sessions view stays active', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'user', label: 'You', text: 'Run checks' }];
  api.render();

  api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_1',
    batchId: 'batch_1',
    kind: 'command',
    title: 'npm test',
  }, null);

  assert.equal(api.refreshChatDynamicUi(), true);
  assert.equal(api.state.batches.size, 1);
  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.doesNotMatch(context.document.querySelector('#timeline').innerHTML, /class="card work-card"/u);
  assert.doesNotMatch(context.document.querySelector('#timeline').innerHTML, /npm test/u);

  api.state.view = 'new';
  assert.equal(api.refreshChatDynamicUi(), false);
});

test('composer expand toggle stays hidden at two lines and appears at four lines', async () => {
  const { api, context } = await loadAppHarness();
  let expandButtonHidden = true;
  const textarea = {
    scrollHeight: 62,
    style: {},
  };
  const expandButton = {
    textContent: '',
    hidden: true,
    setAttribute() {},
    get hidden() {
      return expandButtonHidden;
    },
    set hidden(value) {
      expandButtonHidden = Boolean(value);
    },
  };

  context.window.getComputedStyle = () => ({
    lineHeight: '23px',
    paddingTop: '8px',
    paddingBottom: '8px',
  });
  const originalQuerySelector = context.document.querySelector;
  context.document.querySelector = (selector) => {
    if (selector === '#composer-expand-button') {
      return expandButton;
    }
    return originalQuerySelector(selector);
  };

  api.updateComposerExpansionState(textarea);
  assert.equal(api.state.composerCanExpand, false);
  assert.equal(expandButton.hidden, true);

  textarea.scrollHeight = 108;
  api.updateComposerExpansionState(textarea);
  assert.equal(api.state.composerCanExpand, true);
  assert.equal(expandButton.hidden, false);
});

test('composer expansion threshold ignores textarea padding when counting lines', async () => {
  const { api, context } = await loadAppHarness();
  const textarea = {
    scrollHeight: 56,
    style: {},
  };

  context.window.getComputedStyle = () => ({
    lineHeight: '16px',
    paddingTop: '12px',
    paddingBottom: '12px',
  });

  api.updateComposerExpansionState(textarea);
  assert.equal(api.state.composerCanExpand, false);

  textarea.scrollHeight = 88;
  api.updateComposerExpansionState(textarea);
  assert.equal(api.state.composerCanExpand, true);
});

test('composer expansion toggle removes the live attach button without a full rerender', async () => {
  const { api, context } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.composerExpanded = false;
  api.render();
  api.state.composerCanExpand = true;

  const renderCountBeforeExpand = context.__appRenderCount;
  assert.ok(context.document.querySelector('#attach-button'));

  api.toggleComposerExpanded();

  assert.equal(api.state.composerExpanded, true);
  assert.equal(context.__appRenderCount, renderCountBeforeExpand);
  assert.equal(context.document.querySelector('#attach-button'), null);
});

test('composer expansion state changes do not re-render the whole chat while typing', async () => {
  const app = await readFile(appUrl, 'utf8');
  const updateComposerExpansionState = app.match(/function updateComposerExpansionState\(textarea\)\s*\{[\s\S]*?\n\}/u)?.[0] || '';

  assert.ok(updateComposerExpansionState.length > 0);
  assert.doesNotMatch(updateComposerExpansionState, /render\(\)/u);
});

test('session list scroll position is restored when returning from chat or refresh', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /let sessionListRestoreScrollTop = null;/u);
  assert.match(app, /function restoreSessionListScroll\(\)/u);
  assert.match(app, /function rememberSessionListScroll\(\)/u);
  assert.match(app, /if \(state\.view === 'sessions'\) \{\s*restoreSessionListScroll\(\);/u);
  assert.match(app, /showSessionList\(\) \{\s*savePromptDraftForCurrentSession\(\);\s*saveCurrentTimeline\(\);[\s\S]*rememberSessionListScroll\(\);/u);
  assert.match(app, /function bindSessionCardEvents\(root = document\)[\s\S]*listenRendered\(root, 'click',[\s\S]*rememberSessionListScroll\(\);[\s\S]*selectSession\(sessionId\);/u);
  assert.match(app, /function refreshCurrentView\(\)[\s\S]*rememberSessionListScroll\(\);[\s\S]*await refreshSessionsList/u);
});

test('chat render keeps the timeline at the latest content by default', async () => {
  const { api, context } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.timelineShouldFollowLatest = true;
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'user', label: 'You', text: 'Question' },
    { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Latest answer' },
  ];

  api.render();
  const timeline = context.document.querySelector('#timeline');

  assert.equal(timeline.scrollTop, timeline.scrollHeight);
  assert.equal(api.state.timelineShouldFollowLatest, true);
});

test('mobile timeline reserves the measured composer height', async () => {
  const [styles, app] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
  ]);

  assert.match(styles, /--composer-offset:\s*320px;/u);
  assert.match(styles, /\.timeline\s*\{[^}]*padding:\s*12px 12px var\(--composer-offset\);/su);
  assert.match(styles, /\.timeline\s*\{[^}]*scroll-padding-bottom:\s*var\(--composer-offset\);/su);
  assert.match(app, /function syncComposerOffset\(\)/u);
  assert.match(app, /getBoundingClientRect\(\)\.height/u);
  assert.match(app, /new ResizeObserver/u);
  assert.match(app, /style\.setProperty\('--composer-offset'/u);
});

test('opening a session jumps straight to the latest timeline content', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function scrollTimelineToBottom\(\)[\s\S]*timeline\.scrollTop = timeline\.scrollHeight;/u);
  assert.doesNotMatch(app, /window\.scrollTo\(/u);
  assert.match(app, /async function selectSession\(sessionId\)[\s\S]*render\(\);\s*scrollTimelineToOpenPositionForSession\(nextSession\);/u);
  assert.match(app, /function scrollTimelineToOpenPositionForSession\(session\)[\s\S]*scrollTimelineToBottom\(\);/u);
});

test('opening a session renders from the list summary before the detail request finishes', async () => {
  let resolveFetch;
  const detailReady = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path !== '/api/sessions/session_slow') {
        throw new Error(`Unexpected fetch ${path}`);
      }
      await detailReady;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_slow',
            cwd: '/repo',
            settings: { metadata: {} },
            thread: {
              turns: [
                {
                  id: 'turn_1',
                  items: [
                    { type: 'message', role: 'user', text: 'Loaded detail' },
                    { type: 'message', role: 'assistant', text: 'Detail answer' },
                  ],
                },
              ],
            },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{
    id: 'session_slow',
    cwd: '/repo',
    firstUserInput: 'Summary prompt',
    settings: { metadata: {} },
  }];

  const opened = api.selectSession('session_slow');
  await Promise.resolve();

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.sessionId, 'session_slow');
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Summary prompt/u);

  resolveFetch();
  await opened;

  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Detail answer/u);
});

test('session summaries preserve cached pending messages while detail is unavailable', async () => {
  const { api } = await loadAppHarness();
  api.state.timelineCache.set('session_pending', {
    savedAt: Date.now(),
    timeline: [
      { id: 'history_old_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Earlier question' },
      { id: 'history_old_assistant', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Earlier answer' },
      { id: 'local_user_pending', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Weak network message' },
    ],
    batches: new Map(),
    approvals: new Map(),
  });

  api.restoreTimelineForSession({
    id: 'session_pending',
    firstUserInput: 'Earlier question',
    updatedAt: 10,
  });

  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Earlier question',
    'Earlier answer',
    'Weak network message',
  ]));
  assert.equal(api.state.timeline.at(-1)?.meta, 'pending');
});

test('stale session detail does not overwrite a cached pending message', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_pending');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_pending',
            cwd: '/repo',
            updatedAt: 10,
            settings: { metadata: {} },
            thread: {
              turns: [{
                id: 'turn_old',
                status: 'completed',
                items: [
                  { type: 'message', role: 'user', text: 'Earlier question' },
                  { type: 'message', role: 'assistant', text: 'Earlier answer' },
                ],
              }],
            },
          },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{ id: 'session_pending', cwd: '/repo', updatedAt: 20, firstUserInput: 'Earlier question', settings: { metadata: {} } }];
  api.state.timelineCache.set('session_pending', {
    savedAt: Date.now(),
    timeline: [
      { id: 'history_old_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Earlier question' },
      { id: 'history_old_assistant', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Earlier answer' },
      { id: 'local_user_pending', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Weak network message' },
    ],
    batches: new Map(),
    approvals: new Map(),
  });

  await api.selectSession('session_pending');

  assert.equal(api.state.timeline.some((item) => item.text === 'Weak network message' && item.meta === 'pending'), true);
});

test('stale detail does not mistake a repeated pending prompt for an earlier occurrence', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path.endsWith('/status') || path.includes('/timeline?')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'route_not_found' }),
        };
      }
      assert.equal(path, '/api/sessions/session_repeat');
      return {
        ok: true,
        status: 200,
        json: async () => ({
        session: {
          id: 'session_repeat',
          cwd: '/repo',
          updatedAt: 10,
          settings: { metadata: {} },
          thread: {
            turns: [{
              id: 'turn_old',
              status: 'completed',
              items: [
                { type: 'message', role: 'user', text: 'Continue' },
                { type: 'message', role: 'assistant', text: 'Earlier continuation' },
              ],
            }],
          },
        },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{ id: 'session_repeat', cwd: '/repo', updatedAt: 20, firstUserInput: 'Continue', settings: { metadata: {} } }];
  api.state.timelineCache.set('session_repeat', {
    savedAt: Date.now(),
    timeline: [
      { id: 'history_continue', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Continue' },
      { id: 'history_answer', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Earlier continuation' },
      { id: 'local_continue', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Continue' },
    ],
    batches: new Map(),
    approvals: new Map(),
  });

  await api.selectSession('session_repeat');

  const repeated = api.state.timeline.filter((item) => item.role === 'user' && item.text === 'Continue');
  assert.equal(repeated.length, 2);
  assert.equal(repeated.at(-1)?.meta, 'pending');
});

test('confirmed session detail replaces a matching cached pending message without duplication', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_confirmed');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_confirmed',
            cwd: '/repo',
            updatedAt: 30,
            settings: { metadata: {} },
            thread: {
              turns: [
                {
                  id: 'turn_old',
                  status: 'completed',
                  items: [
                    { type: 'message', role: 'user', text: 'Earlier question' },
                    { type: 'message', role: 'assistant', text: 'Earlier answer' },
                  ],
                },
                {
                  id: 'turn_new',
                  status: 'completed',
                  items: [
                    { type: 'message', role: 'user', text: 'Weak network message' },
                    { type: 'message', role: 'assistant', text: 'Confirmed answer' },
                  ],
                },
              ],
            },
          },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{ id: 'session_confirmed', cwd: '/repo', updatedAt: 30, firstUserInput: 'Earlier question', settings: { metadata: {} } }];
  api.state.timelineCache.set('session_confirmed', {
    savedAt: Date.now(),
    timeline: [
      { id: 'history_old_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Earlier question' },
      { id: 'history_old_assistant', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Earlier answer' },
      { id: 'local_user_pending', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Weak network message' },
    ],
    batches: new Map(),
    approvals: new Map(),
  });

  await api.selectSession('session_confirmed');

  const confirmedMessages = api.state.timeline.filter((item) => item.text === 'Weak network message');
  assert.equal(confirmedMessages.length, 1);
  assert.equal(confirmedMessages[0]?.meta, 'history');
  assert.equal(api.state.timeline.some((item) => item.text === 'Confirmed answer'), true);
});

test('confirmed attachment history replaces an acknowledged upload-path cache entry in turn order', async () => {
  const promptWithSnapshot = [
    'Inspect this screenshot',
    '',
    'Attachments:',
    '1. image',
    '   path: /state/turn-attachments/user/session/snapshot-image.png',
    '   filename: image.png',
    '   mime: image/png',
    '   attached_as: localImage',
    '',
    'Use the local file paths above when you inspect these attachments.',
  ].join('\n');
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path.endsWith('/status') || path.includes('/timeline?')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'route_not_found' }),
        };
      }
      assert.equal(path, '/api/sessions/session_attachment_confirmed');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
          id: 'session_attachment_confirmed',
          cwd: '/repo',
          updatedAt: 30,
          settings: { metadata: {} },
          thread: {
            turns: [{
              id: 'turn_attachment',
              status: 'completed',
              items: [
                { type: 'message', role: 'user', text: promptWithSnapshot },
                { type: 'message', role: 'assistant', text: 'Screenshot inspected' },
              ],
            }],
          },
          },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{ id: 'session_attachment_confirmed', cwd: '/repo', updatedAt: 30, settings: { metadata: {} } }];
  api.state.timelineCache.set('session_attachment_confirmed', {
    savedAt: Date.now(),
    timeline: [{
      id: 'local_attachment_pending',
      kind: 'message',
      role: 'user',
      label: 'You',
      meta: 'pending',
      deliveryLabel: 'Server received',
      text: 'Inspect this screenshot',
      attachments: [{
        kind: 'image',
        localPath: '/repo/uploads/user/att-image.png',
        fileName: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
      }],
    }],
    batches: new Map(),
    approvals: new Map(),
  });

  await api.selectSession('session_attachment_confirmed');

  assert.equal(
    JSON.stringify(api.state.timeline.map((item) => [item.role, item.text, item.meta])),
    JSON.stringify([
      ['user', 'Inspect this screenshot', 'history'],
      ['assistant', 'Screenshot inspected', 'final'],
    ]),
  );
});

test('fresh inactive session detail cache opens without another network request', async () => {
  let detailFetches = 0;
  const { api } = await loadAppHarness({
    fetch: async () => {
      detailFetches += 1;
      throw new Error('fresh cache should not fetch');
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{ id: 'session_fresh', cwd: '/repo', updatedAt: 100, settings: { metadata: {} } }];
  const cachedHistory = [
    { id: 'old_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Old question' },
    { id: 'old_assistant', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Old answer' },
    { id: 'recent_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Recent question' },
    { id: 'recent_assistant', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Recent answer' },
    { id: 'latest_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Latest question' },
    { id: 'latest_assistant', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Cached answer' },
  ];
  api.state.timelineCache.set('session_fresh', {
    savedAt: Date.now(),
    validatedAt: Date.now(),
    sessionUpdatedAt: 100,
    timeline: cachedHistory.slice(2),
    history: cachedHistory,
    historyComplete: true,
    batches: new Map(),
    approvals: new Map(),
  });

  await api.selectSession('session_fresh');

  assert.equal(detailFetches, 0);
  assert.equal(api.state.status, 'Ready');
  assert.equal(api.state.timeline.at(-1)?.text, 'Cached answer');
  assert.equal(api.showMoreSessionHistory(), true);
  assert.equal(api.state.timeline[0]?.text, 'Old question');
});

test('expired or active session caches refresh through compact endpoints', async () => {
  const fetched = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetched.push(path);
      const sessionId = path.split('/')[3];
      if (path.endsWith('/timeline?limit=50')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextBefore: null, hasMore: false }),
        };
      }
      assert.equal(path, `/api/sessions/${sessionId}/status`);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: sessionId,
            cwd: '/repo',
            updatedAt: 100,
            settings: { metadata: {} },
          },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [
    { id: 'session_expired', cwd: '/repo', updatedAt: 100, settings: { metadata: {} } },
    { id: 'session_active', cwd: '/repo', updatedAt: 100, activityState: 'waiting_approval', settings: { metadata: {} } },
    { id: 'session_legacy', cwd: '/repo', updatedAt: 100, settings: { metadata: {} } },
  ];
  for (const session of api.state.sessions) {
    api.state.timelineCache.set(session.id, {
      savedAt: Date.now(),
      validatedAt: session.id === 'session_expired'
        ? Date.now() - api.SESSION_DETAIL_CACHE_FRESH_MS - 1
        : Date.now(),
      sessionUpdatedAt: 100,
      timeline: [{ id: `history_${session.id}`, kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Cached answer' }],
      ...(session.id === 'session_legacy' ? {} : {
        history: [{ id: `history_${session.id}`, kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Cached answer' }],
        historyComplete: true,
      }),
      batches: new Map(),
      approvals: new Map(),
    });
  }

  await api.selectSession('session_expired');
  await api.selectSession('session_active');
  await api.selectSession('session_legacy');

  assert.deepEqual(fetched, [
    '/api/sessions/session_expired/status',
    '/api/sessions/session_expired/timeline?limit=50',
    '/api/sessions/session_active/status',
    '/api/sessions/session_active/timeline?limit=50',
    '/api/sessions/session_legacy/status',
    '/api/sessions/session_legacy/timeline?limit=50',
  ]);
  assert.ok(api.state.timelineCache.get('session_active')?.validatedAt > 0);
});

test('session open uses a compact timeline when status fails without requesting full detail', async () => {
  const fetchCalls: string[] = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_partial/status') {
        throw new Error('status network unavailable');
      }
      if (path === '/api/sessions/session_partial/timeline?limit=50') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'latest_answer', kind: 'message', role: 'assistant', text: 'Timeline survived' }],
            hasMore: false,
            nextBefore: null,
          }),
        };
      }
      throw new Error(`full detail should not be requested: ${path}`);
    },
  });
  api.state.token = 'token';

  const payload = await api.loadSessionOpenData({ id: 'session_partial', cwd: '/summary' });

  assert.deepEqual(fetchCalls, [
    '/api/sessions/session_partial/status',
    '/api/sessions/session_partial/timeline?limit=50',
  ]);
  assert.equal(payload.compact, true);
  assert.equal(payload.timelineSource, 'network');
  assert.equal(payload.session.cwd, '/summary');
  assert.equal(payload.session.timeline[0]?.text, 'Timeline survived');
});

test('session open keeps cached history when status succeeds and timeline fails', async () => {
  const fetchCalls: string[] = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_cached_partial/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session: { id: 'session_cached_partial', cwd: '/fresh', updatedAt: 20 } }),
        };
      }
      if (path === '/api/sessions/session_cached_partial/timeline?limit=50') {
        throw new Error('timeline network unavailable');
      }
      throw new Error(`full detail should not be requested: ${path}`);
    },
  });
  const validatedAt = 123;
  api.state.token = 'token';
  api.state.timelineCache.set('session_cached_partial', {
    savedAt: 100,
    validatedAt,
    sessionUpdatedAt: 10,
    timeline: [{ id: 'cached_answer', kind: 'message', role: 'assistant', text: 'Cached answer' }],
    history: [{ id: 'cached_answer', kind: 'message', role: 'assistant', text: 'Cached answer' }],
    historyComplete: true,
    batches: new Map(),
    approvals: new Map(),
  });

  const payload = await api.loadSessionOpenData({ id: 'session_cached_partial', cwd: '/old' });

  assert.deepEqual(fetchCalls, [
    '/api/sessions/session_cached_partial/status',
    '/api/sessions/session_cached_partial/timeline?limit=50',
  ]);
  assert.equal(payload.timelineSource, 'cache');
  assert.equal(payload.session.cwd, '/fresh');
  assert.equal(payload.session.timeline[0]?.text, 'Cached answer');
  assert.equal(api.state.timelineCache.get('session_cached_partial')?.validatedAt, validatedAt);
});

test('session open accepts status without history when no timeline source is available', async () => {
  const fetchCalls: string[] = [];
  let timelineRequestHeaders: Record<string, string> = {};
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_status_only/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: { id: 'session_status_only', activeTurnId: 'turn_status' },
            turnSnapshot: { turnId: 'turn_status', epoch: 'epoch_status', throughSequence: 7, events: [] },
          }),
        };
      }
      if (path === '/api/sessions/session_status_only/timeline?limit=50') {
        timelineRequestHeaders = options.headers || {};
        throw new Error('timeline unavailable');
      }
      throw new Error(`full detail should not be requested: ${path}`);
    },
  });
  api.state.token = 'token';

  const payload = await api.loadSessionOpenData({ id: 'session_status_only', firstUserInput: 'Summary preview' });

  assert.equal(payload.timelineSource, 'none');
  assert.equal(payload.session.activeTurnId, 'turn_status');
  assert.equal(payload.turnSnapshot?.turnId, 'turn_status');
  assert.equal(timelineRequestHeaders['X-Codex-Include-Turn-Snapshot'], 'false');
  assert.equal(Object.hasOwn(payload.session, 'timeline'), false);
  assert.equal(fetchCalls.length, 2);
});

test('timeline session metadata overrides a stale status response for cross-device active turns', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_cross_device/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: { id: 'session_cross_device', activityState: 'idle', activeTurnId: null },
            turnSnapshot: null,
          }),
        };
      }
      if (path === '/api/sessions/session_cross_device/timeline?limit=50') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: { id: 'session_cross_device', activityState: 'running', activeTurnId: 'turn_remote' },
            turnSnapshot: { turnId: 'turn_remote', epoch: 'epoch_remote', throughSequence: 4, complete: true, events: [] },
            items: [],
            hasMore: false,
            nextBefore: null,
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';

  const payload = await api.loadSessionOpenData({ id: 'session_cross_device' });

  assert.equal(payload.session.activityState, 'running');
  assert.equal(payload.session.activeTurnId, 'turn_remote');
  assert.equal(payload.turnSnapshot?.epoch, 'epoch_remote');
});

test('session open falls back to legacy full detail only when both compact endpoints are unavailable', async () => {
  const fetchCalls: string[] = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path.endsWith('/status') || path.includes('/timeline?')) {
        return { ok: false, status: 404, json: async () => ({ error: 'route_not_found' }) };
      }
      assert.equal(path, '/api/sessions/session_legacy_open');
      return {
        ok: true,
        status: 200,
        json: async () => ({ session: { id: 'session_legacy_open', thread: { turns: [] } } }),
      };
    },
  });
  api.state.token = 'token';

  const payload = await api.loadSessionOpenData({ id: 'session_legacy_open' });

  assert.equal(payload.compact, undefined);
  assert.deepEqual(fetchCalls, [
    '/api/sessions/session_legacy_open/status',
    '/api/sessions/session_legacy_open/timeline?limit=50',
    '/api/sessions/session_legacy_open',
  ]);
});

test('session open rejects auth failure without waiting for a hanging compact sibling', async () => {
  const fetchCalls: string[] = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_auth/status') {
        return { ok: false, status: 401, json: async () => ({ error: 'invalid_session' }) };
      }
      if (path === '/api/sessions/session_auth/timeline?limit=50') {
        return await new Promise(() => {});
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';

  await assert.rejects(
    () => api.loadSessionOpenData({ id: 'session_auth' }),
    (error) => error?.status === 401,
  );
  assert.deepEqual(fetchCalls, [
    '/api/sessions/session_auth/status',
    '/api/sessions/session_auth/timeline?limit=50',
  ]);
});

test('partial latest timeline merges stable cached history and stays incomplete until the final page', async () => {
  const fetchCalls: string[] = [];
  const cachedHistory = [
    { id: 'old_user', kind: 'message', role: 'user', text: 'Old question' },
    { id: 'old_assistant', kind: 'message', role: 'assistant', text: 'Old answer' },
    { id: 'shared_user', kind: 'message', role: 'user', text: 'Cached latest question' },
    { id: 'shared_assistant', kind: 'message', role: 'assistant', text: 'Cached latest answer' },
  ];
  const { api, storage } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_pages/status') {
        return { ok: true, status: 200, json: async () => ({ session: { id: 'session_pages', updatedAt: 2 } }) };
      }
      if (path === '/api/sessions/session_pages/timeline?limit=50') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'shared_user', kind: 'message', role: 'user', text: 'Server latest question' },
              { id: 'shared_assistant', kind: 'message', role: 'assistant', text: 'Server latest answer' },
              { id: 'new_user', kind: 'message', role: 'user', text: 'Newest question' },
              { id: 'new_assistant', kind: 'message', role: 'assistant', text: 'Newest answer' },
            ],
            hasMore: true,
            nextBefore: 50,
          }),
        };
      }
      if (path === '/api/sessions/session_pages/timeline?limit=50&before=50') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'very_old', kind: 'message', role: 'user', text: 'Very old question' }],
            hasMore: false,
            nextBefore: null,
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{ id: 'session_pages', cwd: '/repo', updatedAt: 2, settings: { metadata: {} } }];
  api.state.timelineCache.set('session_pages', {
    savedAt: 1,
    validatedAt: 0,
    sessionUpdatedAt: 1,
    timeline: cachedHistory,
    history: cachedHistory,
    historyComplete: true,
    batches: new Map(),
    approvals: new Map(),
  });

  await api.selectSession('session_pages');

  assert.equal(fetchCalls.includes('/api/sessions/session_pages'), false);
  assert.equal(JSON.parse(storage.get('codexWebWorkspaceState')).sessionId, 'session_pages');
  assert.equal(api.state.currentSession?.timelineNextBefore, 50);
  assert.equal(JSON.stringify(api.state.sessionHistoryItems.map((item) => item.text)), JSON.stringify([
    'Old question',
    'Old answer',
    'Server latest question',
    'Server latest answer',
    'Newest question',
    'Newest answer',
  ]));
  assert.equal(api.state.timelineCache.get('session_pages')?.historyComplete, false);
  assert.equal(JSON.parse(storage.get('codexWebTimelineCache')).entries[0]?.historyComplete, false);

  await api.loadOlderSessionTimelinePage();

  assert.equal(fetchCalls.at(-1), '/api/sessions/session_pages/timeline?limit=50&before=50');
  assert.equal(api.state.timelineCache.get('session_pages')?.historyComplete, true);
  assert.equal(api.state.sessionHistoryItems[0]?.text, 'Very old question');
});

test('switching sessions aborts a hanging older timeline page and lets the next session paginate', async () => {
  const fetchCalls: string[] = [];
  let oldPageSignal: AbortSignal | null = null;
  let oldPageAbortCount = 0;
  const { api } = await loadAppHarness({
    fetch: async (path, options: any = {}) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_old/timeline?limit=50&before=50') {
        oldPageSignal = options.signal;
        return await new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            oldPageAbortCount += 1;
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }
      if (path === '/api/sessions/session_new/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session: { id: 'session_new', cwd: '/new', settings: { metadata: {} } } }),
        };
      }
      if (path === '/api/sessions/session_new/timeline?limit=50') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'new_latest', kind: 'message', role: 'assistant', text: 'New latest answer' }],
            hasMore: true,
            nextBefore: 25,
          }),
        };
      }
      if (path === '/api/sessions/session_new/timeline?limit=50&before=25') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'new_older', kind: 'message', role: 'user', text: 'New older question' }],
            hasMore: false,
            nextBefore: null,
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessions = [
    { id: 'session_old', cwd: '/old', settings: { metadata: {} } },
    { id: 'session_new', cwd: '/new', settings: { metadata: {} } },
  ];
  api.state.sessionId = 'session_old';
  api.state.currentSession = {
    id: 'session_old',
    cwd: '/old',
    timelineComplete: false,
    timelineNextBefore: 50,
    settings: { metadata: {} },
  };

  const oldPage = api.loadOlderSessionTimelinePage();
  assert.equal(oldPageSignal?.aborted, false);

  await api.selectSession('session_new');

  assert.equal(oldPageSignal?.aborted, true);
  assert.equal(oldPageAbortCount, 1);
  assert.equal(await oldPage, false);
  assert.equal(api.state.currentSession?.timelineNextBefore, 25);
  assert.equal(await api.loadOlderSessionTimelinePage(), true);
  assert.equal(api.state.sessionHistoryItems[0]?.text, 'New older question');
  assert.ok(fetchCalls.includes('/api/sessions/session_new/timeline?limit=50&before=25'));
});

test('older timeline scroll restoration ignores a session selected before its animation frame', async () => {
  const frames: Array<() => void> = [];
  const { api } = await loadAppHarness({
    requestAnimationFrame: (callback: () => void) => {
      frames.push(callback);
      return frames.length;
    },
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_old/timeline?limit=50&before=50');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ id: 'old_older', kind: 'message', role: 'user', text: 'Old older question' }],
          hasMore: false,
          nextBefore: null,
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_old';
  api.state.currentSession = {
    id: 'session_old',
    cwd: '/old',
    timelineComplete: false,
    timelineNextBefore: 50,
  };
  api.state.timeline = [
    { id: 'old_latest', kind: 'message', role: 'assistant', text: 'Old latest answer' },
  ];
  api.state.sessionHistoryItems = [...api.state.timeline];
  api.render();
  frames.length = 0;

  assert.equal(await api.loadOlderSessionTimelinePage(), true);
  const oldSessionScrollRestore = frames.at(-1);
  assert.equal(typeof oldSessionScrollRestore, 'function');

  api.state.sessionId = 'session_new';
  api.state.currentSession = { id: 'session_new', cwd: '/new' };
  api.state.timeline = [
    { id: 'new_latest', kind: 'message', role: 'assistant', text: 'New latest answer' },
  ];
  api.state.sessionHistoryItems = [...api.state.timeline];
  api.render();
  const newTimeline = api.context.document.querySelector('#timeline');
  newTimeline.scrollHeight = 1_600;
  newTimeline.scrollTop = 321;

  oldSessionScrollRestore?.();

  assert.equal(newTimeline.scrollTop, 321);
});

test('older timeline page timeout settles a non-cooperative fetch and releases the retry slot', async () => {
  const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = [];
  const signals: AbortSignal[] = [];
  let fetchCount = 0;
  const { api } = await loadAppHarness({
    setTimeout: (callback: () => void, delay: number) => {
      timers.push({ callback, delay, cleared: false });
      return timers.length;
    },
    clearTimeout: (timerId: number) => {
      if (timers[timerId - 1]) {
        timers[timerId - 1].cleared = true;
      }
    },
    fetch: async (path, options: any = {}) => {
      assert.equal(path, '/api/sessions/session_timeout/timeline?limit=50&before=50');
      fetchCount += 1;
      signals.push(options.signal);
      return await new Promise(() => {});
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_timeout';
  api.state.currentSession = {
    id: 'session_timeout',
    cwd: '/repo',
    timelineComplete: false,
    timelineNextBefore: 50,
  };

  const firstPage = api.loadOlderSessionTimelinePage();
  const firstTimer = timers.find((timer) => timer.delay === 12_000 && !timer.cleared);
  assert.ok(firstTimer);
  firstTimer.callback();

  assert.equal(await firstPage, false);
  assert.equal(signals[0]?.aborted, true);

  const retryPage = api.loadOlderSessionTimelinePage();
  assert.equal(fetchCount, 2);
  const retryTimer = timers.findLast((timer) => timer.delay === 12_000 && !timer.cleared);
  assert.ok(retryTimer);
  retryTimer.callback();

  assert.equal(await retryPage, false);
  assert.equal(signals[1]?.aborted, true);
});

test('partial latest timeline drops disjoint cached history before prepending server pages', async () => {
  const fetchCalls: string[] = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_gap/status') {
        return { ok: true, status: 200, json: async () => ({ session: { id: 'session_gap', updatedAt: 2 } }) };
      }
      if (path === '/api/sessions/session_gap/timeline?limit=50') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'server_latest', kind: 'message', role: 'assistant', text: 'Server latest answer' }],
            hasMore: true,
            nextBefore: 50,
          }),
        };
      }
      if (path === '/api/sessions/session_gap/timeline?limit=50&before=50') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'server_previous', kind: 'message', role: 'user', text: 'Server previous question' }],
            hasMore: true,
            nextBefore: 25,
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{ id: 'session_gap', cwd: '/repo', updatedAt: 2, settings: { metadata: {} } }];
  const staleHistory = [
    { id: 'cached_old', kind: 'message', role: 'assistant', text: 'Stale cached answer' },
  ];
  api.state.timelineCache.set('session_gap', {
    savedAt: 1,
    validatedAt: 0,
    sessionUpdatedAt: 1,
    timeline: staleHistory,
    history: staleHistory,
    historyComplete: true,
    batches: new Map(),
    approvals: new Map(),
  });

  await api.selectSession('session_gap');

  assert.equal(JSON.stringify(api.state.sessionHistoryItems.map((item) => item.text)), JSON.stringify([
    'Server latest answer',
  ]));
  assert.equal(api.state.currentSession?.timelineComplete, false);
  assert.equal(api.state.currentSession?.timelineNextBefore, 50);

  await api.loadOlderSessionTimelinePage();

  assert.equal(fetchCalls.at(-1), '/api/sessions/session_gap/timeline?limit=50&before=50');
  assert.equal(JSON.stringify(api.state.sessionHistoryItems.map((item) => item.text)), JSON.stringify([
    'Server previous question',
    'Server latest answer',
  ]));
  assert.equal(api.state.currentSession?.timelineComplete, false);
  assert.equal(api.state.currentSession?.timelineNextBefore, 25);
});

test('switching sessions ignores stale SSE chunks from the previous session turn', async () => {
  let releaseStaleRead;
  let resolveSessionTwoDetail;
  let staleReadCount = 0;
  const sessionTwoDetailReady = new Promise((resolve) => {
    resolveSessionTwoDetail = resolve;
  });
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/turns/turn_1/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => {
                staleReadCount += 1;
                if (staleReadCount === 1) {
                  await new Promise((resolve) => {
                    releaseStaleRead = resolve;
                  });
                  return {
                    done: false,
                    value: new TextEncoder().encode(
                      'data: {"type":"assistant.delta","turnId":"turn_1","text":"Leaked from session 1","phase":"commentary","sequence":1}\n\n',
                    ),
                  };
                }
                return { done: true };
              },
            }),
          },
        };
      }
      if (path === '/api/sessions/session_2') {
        await sessionTwoDetailReady;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_2',
              cwd: '/repo/two',
              settings: { metadata: {} },
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessions = [
    { id: 'session_1', cwd: '/repo/one', firstUserInput: 'Session one summary', settings: { metadata: {} } },
    { id: 'session_2', cwd: '/repo/two', firstUserInput: 'Session two summary', settings: { metadata: {} } },
  ];
  api.state.sessionId = 'session_1';
  api.state.currentSession = api.state.sessions[0];
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.state.timeline = [
    { id: 'user_turn_1', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Prompt from session 1' },
  ];

  const staleStreamPromise = api.streamTurnEvents('turn_1');
  await flushMicrotasks();
  assert.equal(typeof releaseStaleRead, 'function');

  const switchPromise = api.selectSession('session_2');
  await Promise.resolve();

  assert.equal(api.state.sessionId, 'session_2');
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Session two summary/u);

  releaseStaleRead();
  await staleStreamPromise;

  assert.doesNotMatch(api.state.timeline.map((item) => item.text || '').join('\n'), /Leaked from session 1/u);

  resolveSessionTwoDetail();
  await switchPromise;
});

test('chat page uses app-style back header and left-edge swipe navigation', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(app, /renderBackButtonIcon\(\)/u);
  assert.match(app, /class="ghost chat-back-button" type="button" id="back-to-list-button" aria-label="Sessions">\$\{renderBackButtonIcon\(\)\}<\/button>/u);
  assert.match(app, /setupEdgeSwipeBackNavigation\(\)/u);
  assert.match(app, /const EDGE_SWIPE_START_PX = 24;/u);
  assert.match(app, /const EDGE_SWIPE_TRIGGER_PX = 72;/u);
  assert.match(app, /document\.addEventListener\('touchstart', onEdgeSwipeStart/u);
  assert.match(app, /document\.addEventListener\('touchend', onEdgeSwipeEnd/u);
  assert.match(app, /if \(state\.view !== 'chat'\)/u);
  assert.match(app, /showSessionList\(\);/u);
  assert.match(styles, /\.chat-nav\s*\{/u);
  assert.match(styles, /\.chat-back-button\s*\{/u);
  assert.match(styles, /\.chat-back-button\s*\{[^}]*border:\s*0;/su);
  assert.match(styles, /\.chat-back-button\s*\{[^}]*background:\s*transparent;/su);
  assert.match(styles, /\.chat-nav \.project-title\s*\{/u);
});

test('back and session menu icon buttons render without visible frames', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.page-back-button\s*\{[^}]*border:\s*0;/su);
  assert.match(styles, /\.page-back-button\s*\{[^}]*background:\s*transparent;/su);
  assert.match(styles, /\.chat-back-button\s*\{[^}]*border:\s*0;/su);
  assert.match(styles, /\.chat-back-button\s*\{[^}]*background:\s*transparent;/su);
  assert.match(styles, /\.settings-toggle-button\s*\{[^}]*border:\s*0;/su);
  assert.match(styles, /\.settings-toggle-button\s*\{[^}]*background:\s*transparent;/su);
});

test('mobile UI uses session list, compact composer, settings drawer, and history restore', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /view:\s*'sessions'/u);
  assert.match(app, /renderSessionList\(\)/u);
  assert.match(app, /renderNewSession\(\)/u);
  assert.match(app, /renderChat\(\)/u);
  assert.match(app, /timelineCache:\s*loadTimelineCache\(\)/u);
  assert.match(app, /saveCurrentTimeline\(\)/u);
  assert.match(app, /hydrateTimelineFromSession/u);
  assert.match(app, /data-permission-preset/u);
  assert.match(app, /danger-full-access/u);
  assert.match(app, /approvalPolicy = 'never'/u);
  assert.match(app, /settingsOpen/u);
  assert.match(app, /function renderComposerStatus\(\)/u);
  assert.match(app, /composer-status/u);
  assert.match(app, /<div class="composer-wrap \$\{composerClassName\}">\s*\$\{state\.composerExpanded \? '' : renderComposerStatus\(\)\}\s*\$\{renderQueuedMessages\(\)\}\s*<form class="composer \$\{composerClassName\}"/u);
  assert.doesNotMatch(app, /----- \$\{escapeHtml\(composerStatusLabel\(\)\)\} -----/u);
  assert.doesNotMatch(app, /Turn started/u);
  assert.doesNotMatch(app, /Turn completed/u);
  assert.doesNotMatch(app, /id="session-select"/u);
  assert.doesNotMatch(app, /id="cwd-input"/u);
  assert.doesNotMatch(app, /renderSessionOptions/u);
});

test('composer status renders a small bottom status separator', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  assert.match(api.renderComposerStatus(), /<div class="composer-status" data-tone="work" role="status" aria-live="polite" aria-atomic="true"><span>Working<\/span><\/div>/u);
  assert.match(api.renderComposerStatus(), /<span>Working<\/span>/u);
  assert.doesNotMatch(api.renderComposerStatus(), /----- Working -----/u);

  api.state.pendingTurn = false;
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  assert.match(api.renderComposerStatus(), /<span>Ready<\/span>/u);
});

test('hidden-member downgrade clears sensitive work data from live, history, approval, and cached state', async () => {
  const { api, storage } = await loadAppHarness();
  const safeUser = {
    id: 'user_safe',
    kind: 'message',
    role: 'user',
    label: 'You',
    meta: 'history',
    text: 'Keep this user request',
  };
  const safeAssistant = {
    id: 'assistant_safe',
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    meta: 'final',
    text: 'Keep this final answer',
  };
  const sensitiveBatch = {
    id: 'batch_secret',
    kind: 'batch',
    turnId: 'turn_secret',
    batchId: 'batch_secret',
    batchKind: 'command',
    title: 'cat packages/private/credentials.txt',
    status: 'started',
    summary: {
      command: 'cat packages/private/credentials.txt',
      output: 'secret-output-value',
      fileChanges: [{ path: 'packages/private/credentials.txt', action: 'read' }],
    },
  };
  const sensitiveApproval = {
    id: 'approval_secret',
    kind: 'approval',
    approvalId: 'approval_secret',
    approvalKind: 'command',
    summary: {
      command: 'rm build/private.tmp',
      reason: 'Clean generated build output',
      grantRoot: '/repo/build',
      networkPermission: true,
      fileReadPermissions: ['/repo/build/input.json'],
      fileWritePermissions: ['/repo/build/private.tmp'],
      execPolicyAmendment: ['rm build/private.tmp'],
      fileChanges: ['build/private.tmp'],
      availableDecisionKeys: ['accept', 'decline'],
      output: 'SECRET_APPROVAL_OUTPUT',
      diff: 'SECRET_APPROVAL_DIFF',
      patch: 'SECRET_APPROVAL_PATCH',
      cwd: 'SECRET_APPROVAL_CWD',
      stderr: 'SECRET_APPROVAL_STDERR',
      raw: 'SECRET_APPROVAL_RAW',
      exitCode: 42,
    },
    resolved: false,
  };
  const cachedWork = {
    id: 'work_turn_secret',
    kind: 'work',
    turnId: 'turn_secret',
    status: 'running',
    batches: [sensitiveBatch],
    approvals: [],
  };
  const cachedCommentary = {
    id: 'assistant_turn_secret',
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    meta: 'commentary',
    text: 'Reading packages/private/credentials.txt now',
  };
  const detailedSystemError = {
    id: 'error_turn_secret',
    kind: 'message',
    role: 'system',
    label: 'Error',
    meta: 'failed',
    severity: 'error',
    text: 'SECRET_RUNTIME_STACK at packages/private/runtime.ts:42',
  };

  api.state.authSession = {
    id: 'auth_member',
    principal: { userId: 'member', isAdmin: false, mode: 'multi' },
  };
  api.state.view = 'chat';
  api.state.sessionId = 'session_secret';
  api.state.currentSession = {
    id: 'session_secret',
    cwd: '/repo',
    projectId: 'project_secret',
    canViewWorkDetails: true,
    settings: { metadata: {} },
  };
  api.state.projectsLoaded = true;
  api.state.projects = [{
    id: 'project_secret',
    cwd: '/repo',
    showWorkDetailsToMembers: true,
    canViewWorkDetails: true,
  }];
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_secret';
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';
  api.state.batches.clear();
  api.state.batches.set('batch_secret', sensitiveBatch);
  api.state.approvals.clear();
  api.state.approvals.set('approval_secret', sensitiveApproval);
  api.state.timeline = [safeUser, cachedWork, cachedCommentary, detailedSystemError, sensitiveApproval, safeAssistant];
  api.state.sessionHistoryItems = [safeUser, cachedWork, cachedCommentary, detailedSystemError, sensitiveApproval, safeAssistant];
  api.state.error = 'SECRET_RUNTIME_STACK at packages/private/runtime.ts:42';
  api.state.timelineCache.set('session_secret', {
    savedAt: Date.now(),
    timeline: [safeUser, cachedWork, cachedCommentary, detailedSystemError, sensitiveApproval, safeAssistant],
    history: [safeUser, cachedWork, cachedCommentary, detailedSystemError, sensitiveApproval, safeAssistant],
    historyComplete: true,
    batches: [['batch_secret', sensitiveBatch]],
    approvals: [['approval_secret', sensitiveApproval]],
  });
  api.state.workDetailsOpen = true;

  assert.equal(api.canViewCurrentWorkDetails(), true);
  assert.match(api.renderComposerStatus(), /id="open-work-details-button"/u);
  assert.match(api.renderWorkDetailsDialog(), /cat packages\/private\/credentials\.txt/u);
  assert.match(api.renderWorkDetailsDialog(), /secret-output-value/u);

  api.upsertSession({
    ...api.state.currentSession,
    canViewWorkDetails: false,
  });

  assert.equal(api.canViewCurrentWorkDetails(), false);
  assert.equal(api.state.workDetailsOpen, false);
  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(api.state.timeline.some((item) => item.meta === 'commentary'), false);
  assert.equal(api.state.timeline.some((item) => item.text === 'Keep this user request'), true);
  assert.equal(api.state.timeline.some((item) => item.text === 'Keep this final answer'), true);
  assert.equal(api.state.sessionHistoryItems.some((item) => item.text === 'Keep this user request'), true);
  assert.equal(api.state.sessionHistoryItems.some((item) => item.text === 'Keep this final answer'), true);
  assert.match(api.renderComposerStatus(), /<span>Working · Needs approval<\/span>/u);
  assert.equal(api.renderWorkDetailsDialog(), '');

  const restrictedCache = api.state.timelineCache.get('session_secret');
  const restrictedSurfaces = [
    api.renderChatContent(),
    JSON.stringify(api.state.timeline),
    JSON.stringify(api.state.sessionHistoryItems),
    JSON.stringify([...api.state.batches.values()]),
    JSON.stringify([...api.state.approvals.values()]),
    JSON.stringify({
      timeline: restrictedCache?.timeline,
      history: restrictedCache?.history,
      batches: [...(restrictedCache?.batches?.values() || [])],
      approvals: [...(restrictedCache?.approvals?.values() || [])],
    }),
    api.state.error,
    storage.get('codexWebTimelineCache') || '',
  ];
  for (const value of restrictedSurfaces) {
    assert.doesNotMatch(
      value,
      /credentials\.txt|secret-output-value|Reading packages\/private|SECRET_RUNTIME_STACK|SECRET_APPROVAL_(?:OUTPUT|DIFF|PATCH|CWD|STDERR|RAW)|"exitCode":42/u,
    );
  }
  assert.match(JSON.stringify([...api.state.batches.values()]), /Running command/u);
  for (const items of [restrictedCache?.timeline || [], restrictedCache?.history || []]) {
    assert.equal(items.some((item) => item.text === 'Keep this user request'), true);
    assert.equal(items.some((item) => item.text === 'Keep this final answer'), true);
  }

  const approvalSurfaces = [
    api.state.approvals.get('approval_secret'),
    api.state.timeline.find((item) => item.kind === 'approval'),
    restrictedCache?.approvals?.get('approval_secret'),
    restrictedCache?.timeline?.find((item) => item.kind === 'approval'),
  ];
  assert.equal(approvalSurfaces.every(Boolean), true);
  for (const approval of approvalSurfaces) {
    assert.equal(approval.resolved, false);
    assert.equal(approval.summary.command, 'rm build/private.tmp');
    assert.equal(approval.summary.reason, 'Clean generated build output');
    assert.equal(approval.summary.grantRoot, '/repo/build');
    assert.equal(approval.summary.networkPermission, true);
    assert.equal(JSON.stringify(approval.summary.fileReadPermissions), JSON.stringify(['/repo/build/input.json']));
    assert.equal(JSON.stringify(approval.summary.fileWritePermissions), JSON.stringify(['/repo/build/private.tmp']));
    assert.equal(JSON.stringify(approval.summary.execPolicyAmendment), JSON.stringify(['rm build/private.tmp']));
    assert.equal(JSON.stringify(approval.summary.fileChanges), JSON.stringify(['build/private.tmp']));
    assert.equal(JSON.stringify(approval.summary.availableDecisionKeys), JSON.stringify(['accept', 'decline']));
    for (const forbiddenKey of ['output', 'diff', 'patch', 'cwd', 'stderr', 'raw', 'exitCode']) {
      assert.equal(Object.hasOwn(approval.summary, forbiddenKey), false);
    }
  }

  api.state.projects[0] = { ...api.state.projects[0], canViewWorkDetails: true };
  api.upsertSession({
    ...api.state.currentSession,
    canViewWorkDetails: true,
  });
  assert.equal(api.canViewCurrentWorkDetails(), true);
  assert.match(api.renderComposerStatus(), /id="open-work-details-button"/u);
});

test('multi-user work visibility fails closed until project access is authoritative', async () => {
  const { api, storage } = await loadAppHarness();
  const sensitiveBatch = {
    id: 'batch_fail_closed',
    kind: 'batch',
    turnId: 'turn_fail_closed',
    batchId: 'batch_fail_closed',
    batchKind: 'command',
    title: 'cat private/fail-closed.txt',
    status: 'started',
    summary: { output: 'FAIL_CLOSED_SECRET' },
  };

  api.state.authSession = {
    id: 'auth_member',
    principal: { userId: 'member', isAdmin: false, mode: 'multi' },
  };
  api.state.sessionId = 'session_fail_closed';
  api.state.currentSession = {
    id: 'session_fail_closed',
    cwd: '/repo',
    projectId: 'project_fail_closed',
    canViewWorkDetails: true,
    settings: { metadata: {} },
  };
  api.state.projects = [{
    id: 'project_fail_closed',
    cwd: '/repo',
    canViewWorkDetails: true,
  }];
  api.state.projectsLoaded = false;
  api.state.batches.set('batch_fail_closed', sensitiveBatch);
  api.state.timeline = [{
    id: 'commentary_fail_closed',
    kind: 'message',
    role: 'assistant',
    meta: 'commentary',
    text: 'FAIL_CLOSED_SECRET',
  }];
  api.state.sessionHistoryItems = api.state.timeline.map((item) => ({ ...item }));
  api.state.workDetailsOpen = true;
  api.saveCurrentTimeline();
  const persistedBeforePolicy = storage.get('codexWebTimelineCache') || '';
  assert.match(persistedBeforePolicy, /FAIL_CLOSED_SECRET|fail-closed\.txt/u);

  assert.equal(api.canViewCurrentWorkDetails(), false);
  assert.doesNotMatch(api.renderComposerStatus(), /id="open-work-details-button"/u);
  assert.equal(api.renderWorkDetailsDialog(), '');
  api.enforceCurrentWorkDetailsAccess();
  assert.equal(api.state.workDetailsOpen, false);
  assert.equal(api.state.workDetailsPolicyPendingSessionId, 'session_fail_closed');
  assert.doesNotMatch(JSON.stringify(api.state.timeline), /FAIL_CLOSED_SECRET/u);
  assert.doesNotMatch(JSON.stringify([...api.state.batches.values()]), /FAIL_CLOSED_SECRET|fail-closed\.txt/u);
  assert.match(JSON.stringify(api.state.timelineCache.get('session_fail_closed')), /FAIL_CLOSED_SECRET|fail-closed\.txt/u);
  assert.equal(storage.get('codexWebTimelineCache'), persistedBeforePolicy);
  api.saveCurrentTimeline();
  assert.equal(storage.get('codexWebTimelineCache'), persistedBeforePolicy);

  api.state.projectsLoaded = true;
  api.state.projects[0].canViewWorkDetails = true;
  api.resolvePendingWorkDetailsPolicy();
  assert.equal(api.state.workDetailsPolicyPendingSessionId, '');
  assert.equal(api.canViewCurrentWorkDetails(), true);
  assert.match(JSON.stringify(api.state.timeline), /FAIL_CLOSED_SECRET/u);
  assert.match(JSON.stringify([...api.state.batches.values()]), /fail-closed\.txt/u);
  assert.equal(storage.get('codexWebTimelineCache'), persistedBeforePolicy);

  api.state.projectsLoaded = false;
  api.enforceCurrentWorkDetailsAccess();
  assert.equal(api.state.workDetailsPolicyPendingSessionId, 'session_fail_closed');
  assert.doesNotMatch(JSON.stringify(api.state.timeline), /FAIL_CLOSED_SECRET/u);
  assert.equal(storage.get('codexWebTimelineCache'), persistedBeforePolicy);

  api.state.projectsLoaded = true;
  api.state.projects[0].canViewWorkDetails = false;
  api.state.currentSession.canViewWorkDetails = true;
  assert.equal(api.canViewCurrentWorkDetails(), false);
  api.resolvePendingWorkDetailsPolicy();
  assert.equal(api.state.workDetailsPolicyPendingSessionId, '');
  assert.doesNotMatch(JSON.stringify(api.state.timeline), /FAIL_CLOSED_SECRET/u);
  assert.doesNotMatch(JSON.stringify([...api.state.batches.values()]), /FAIL_CLOSED_SECRET|fail-closed\.txt/u);
  assert.doesNotMatch(JSON.stringify(api.state.timelineCache.get('session_fail_closed')), /FAIL_CLOSED_SECRET|fail-closed\.txt/u);
  assert.doesNotMatch(storage.get('codexWebTimelineCache') || '', /FAIL_CLOSED_SECRET|fail-closed\.txt/u);

  api.state.projects[0].canViewWorkDetails = true;
  api.state.currentSession.canViewWorkDetails = true;
  api.state.batches.set('batch_fail_closed', sensitiveBatch);
  api.state.timeline = [{
    id: 'commentary_fresh_capability',
    kind: 'message',
    role: 'assistant',
    meta: 'commentary',
    text: 'FRESH_CAPABILITY_SECRET',
  }];
  assert.equal(api.canViewCurrentWorkDetails(), true);

  api.upsertSession({
    ...api.state.currentSession,
    canViewWorkDetails: false,
  });

  assert.equal(api.canViewCurrentWorkDetails(), false);
  assert.equal(api.state.currentSession.canViewWorkDetails, false);
  assert.equal(api.state.projects[0].canViewWorkDetails, false);
  assert.doesNotMatch(JSON.stringify(api.state.timeline), /FRESH_CAPABILITY_SECRET/u);
  assert.doesNotMatch(JSON.stringify([...api.state.batches.values()]), /FAIL_CLOSED_SECRET|fail-closed\.txt/u);
  assert.match(JSON.stringify([...api.state.batches.values()]), /Running command/u);
});

test('restricted session hydration keeps successful legacy finals but drops failed commentary', async () => {
  const { api } = await loadAppHarness();
  const completedAnswer = 'Legacy completed answer';
  const failedCommentary = 'FAILED_PHASELESS_COMMENTARY_SECRET';
  api.state.authSession = {
    id: 'auth_member',
    principal: { userId: 'member', isAdmin: false, mode: 'multi' },
  };
  api.state.sessionId = 'session_legacy_final';
  api.state.currentSession = {
    id: 'session_legacy_final',
    projectId: 'project_legacy_final',
    canViewWorkDetails: false,
    thread: {
      turns: [
        {
          id: 'turn_completed',
          status: 'completed',
          items: [{ itemId: 'final_completed', type: 'assistant_message', role: 'assistant', phase: null, text: completedAnswer }],
        },
        {
          id: 'turn_failed',
          status: 'failed',
          items: [{ type: 'assistant_message', role: 'assistant', phase: null, text: failedCommentary }],
        },
      ],
    },
  };
  api.state.projectsLoaded = true;
  api.state.projects = [{ id: 'project_legacy_final', canViewWorkDetails: false }];
  api.state.timeline = [
    {
      id: 'assistant_turn_completed_final_completed',
      kind: 'message',
      role: 'assistant',
      meta: 'history',
      text: completedAnswer,
      turnId: 'turn_completed',
      itemId: 'final_completed',
      projectionKey: 'turn_completed\u0000final_completed',
    },
    { id: 'legacy_failed', kind: 'message', role: 'assistant', meta: 'history', text: failedCommentary },
  ];
  api.state.sessionHistoryItems = api.state.timeline.map((item) => ({ ...item }));

  api.enforceCurrentWorkDetailsAccess();

  assert.match(JSON.stringify(api.state.timeline), /Legacy completed answer/u);
  assert.doesNotMatch(JSON.stringify(api.state.timeline), /FAILED_PHASELESS_COMMENTARY_SECRET/u);
  assert.match(JSON.stringify(api.state.sessionHistoryItems), /Legacy completed answer/u);
  assert.doesNotMatch(JSON.stringify(api.state.sessionHistoryItems), /FAILED_PHASELESS_COMMENTARY_SECRET/u);
  const retainedFinal = api.state.timeline.find((item) => item.text === completedAnswer);
  const retainedHistoryFinal = api.state.sessionHistoryItems.find((item) => item.text === completedAnswer);
  assert.equal(retainedFinal?.turnId, 'turn_completed');
  assert.equal(retainedFinal?.itemId, 'final_completed');
  assert.equal(retainedFinal?.projectionKey, 'turn_completed\u0000final_completed');
  assert.equal(retainedFinal?.meta, 'final');
  assert.equal(retainedFinal?.phase, 'final_answer');
  assert.equal(retainedHistoryFinal?.phase, 'final_answer');
});

test('desktop session-list refresh immediately enforces a work visibility downgrade', async () => {
  const { api, storage } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (path) => {
      assert.equal(path, '/api/sessions');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{
            id: 'session_desktop_secret',
            cwd: '/repo',
            projectId: 'project_desktop',
            canViewWorkDetails: false,
            settings: { metadata: {} },
          }],
        }),
      };
    },
  });
  const sensitiveBatch = {
    id: 'batch_desktop_secret',
    kind: 'batch',
    turnId: 'turn_desktop_secret',
    batchId: 'batch_desktop_secret',
    batchKind: 'command',
    title: 'cat private/desktop-secret.txt',
    status: 'started',
    summary: { output: 'DESKTOP_REFRESH_SECRET' },
  };
  const sensitiveCommentary = {
    id: 'commentary_desktop_secret',
    kind: 'message',
    role: 'assistant',
    meta: 'commentary',
    text: 'DESKTOP_REFRESH_SECRET',
  };

  api.state.token = 'token';
  api.state.authSession = {
    id: 'auth_member',
    principal: { userId: 'member', isAdmin: false, mode: 'multi' },
  };
  api.state.view = 'sessions';
  api.state.sortMode = 'time';
  api.state.sessionId = 'session_desktop_secret';
  api.state.currentSession = {
    id: 'session_desktop_secret',
    cwd: '/repo',
    projectId: 'project_desktop',
    canViewWorkDetails: true,
    settings: { metadata: {} },
  };
  api.state.projectsLoaded = true;
  api.state.projects = [{ id: 'project_desktop', cwd: '/repo', canViewWorkDetails: true }];
  api.state.sessions = [api.state.currentSession];
  api.state.sessionsByScope.all = [api.state.currentSession];
  api.state.sessionsLoadedByScope.all = true;
  api.state.timeline = [sensitiveCommentary];
  api.state.sessionHistoryItems = [sensitiveCommentary];
  api.state.batches.set('batch_desktop_secret', sensitiveBatch);
  api.state.timelineCache.set('session_desktop_secret', {
    savedAt: Date.now(),
    timeline: [sensitiveCommentary],
    history: [sensitiveCommentary],
    batches: [['batch_desktop_secret', sensitiveBatch]],
    approvals: [],
  });
  api.state.workDetailsOpen = true;

  assert.equal(api.canViewCurrentWorkDetails(), true);
  await api.refreshSessionsList({ renderAfter: false, scope: 'all' });

  assert.equal(api.state.currentSession.canViewWorkDetails, false);
  assert.equal(api.canViewCurrentWorkDetails(), false);
  assert.equal(api.state.workDetailsOpen, false);
  const restrictedCache = api.state.timelineCache.get('session_desktop_secret');
  for (const value of [
    JSON.stringify(api.state.timeline),
    JSON.stringify(api.state.sessionHistoryItems),
    JSON.stringify([...api.state.batches.values()]),
    JSON.stringify(restrictedCache?.timeline || []),
    JSON.stringify(restrictedCache?.history || []),
    JSON.stringify([...(restrictedCache?.batches?.values() || [])]),
    storage.get('codexWebTimelineCache') || '',
  ]) {
    assert.doesNotMatch(value, /DESKTOP_REFRESH_SECRET|desktop-secret\.txt/u);
  }
});

test('work visibility downgrade aborts a full stream before buffered detail frames can land', async () => {
  let releaseRead;
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/turns/turn_buffered/events');
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => await new Promise((resolve) => {
              releaseRead = resolve;
            }),
          }),
        },
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = {
    id: 'auth_member',
    principal: { userId: 'member', isAdmin: false, mode: 'multi' },
  };
  api.state.sessionId = 'session_buffered';
  api.state.currentSession = {
    id: 'session_buffered',
    projectId: 'project_buffered',
    canViewWorkDetails: true,
  };
  api.state.projectsLoaded = true;
  api.state.projects = [{ id: 'project_buffered', canViewWorkDetails: true }];

  const streamPromise = api.streamTurnEvents('turn_buffered');
  await flushMicrotasks();
  assert.equal(api.state.streamIncludesWorkDetails, true);
  assert.ok(api.state.streamAbortController);

  api.upsertSession({
    ...api.state.currentSession,
    canViewWorkDetails: false,
  });
  assert.equal(api.state.streamAbortController, null);
  assert.equal(api.state.streamIncludesWorkDetails, false);

  releaseRead?.({
    done: false,
    value: new TextEncoder().encode('data: {"type":"assistant.delta","turnId":"turn_buffered","phase":"commentary","text":"BUFFERED_STREAM_SECRET"}\n\n'),
  });
  await streamPromise;

  assert.doesNotMatch(JSON.stringify(api.state.timeline), /BUFFERED_STREAM_SECRET/u);
  assert.doesNotMatch(JSON.stringify(api.state.timelineCache.get('session_buffered') || {}), /BUFFERED_STREAM_SECRET/u);
});

test('restricted event guard redacts full stream frames that survive a capability change', async () => {
  const { api, storage } = await loadAppHarness();
  api.state.authSession = {
    id: 'auth_member',
    principal: { userId: 'member', isAdmin: false, mode: 'multi' },
  };
  api.state.sessionId = 'session_guarded';
  api.state.currentSession = {
    id: 'session_guarded',
    projectId: 'project_guarded',
    canViewWorkDetails: false,
  };
  api.state.projectsLoaded = true;
  api.state.projects = [{ id: 'project_guarded', canViewWorkDetails: false }];
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_guarded';

  const rawEvents = [
    {
      type: 'assistant.delta',
      turnId: 'turn_guarded',
      phase: 'commentary',
      text: 'BUFFERED_FRAME_SECRET',
    },
    {
      type: 'batch.started',
      turnId: 'turn_guarded',
      batchId: 'batch_guarded',
      kind: 'command',
      title: 'cat private/buffered-frame.txt',
    },
    {
      type: 'batch.updated',
      turnId: 'turn_guarded',
      batchId: 'batch_guarded',
      summary: { output: 'BUFFERED_FRAME_SECRET', cwd: '/private/runtime' },
    },
    {
      type: 'approval.requested',
      turnId: 'turn_guarded',
      approvalId: 'approval_guarded',
      approvalKind: 'command',
      summary: {
        command: 'rm build/generated.tmp',
        reason: 'Remove generated output',
        grantRoot: '/repo/build',
        output: 'BUFFERED_FRAME_SECRET',
        diff: 'BUFFERED_FRAME_SECRET',
        cwd: '/private/runtime',
      },
    },
  ];
  for (const rawEvent of rawEvents) {
    const event = api.presentTurnEventForCurrentAudience(rawEvent);
    if (event) {
      api.applyTurnEvent(event, null);
    }
  }
  api.saveCurrentTimeline();

  const surfaces = [
    JSON.stringify(api.state.timeline),
    JSON.stringify([...api.state.batches.values()]),
    JSON.stringify([...api.state.approvals.values()]),
    storage.get('codexWebTimelineCache') || '',
  ];
  for (const value of surfaces) {
    assert.doesNotMatch(value, /BUFFERED_FRAME_SECRET|buffered-frame\.txt|\/private\/runtime/u);
  }
  assert.match(JSON.stringify([...api.state.batches.values()]), /Running command/u);
  const approval = api.state.approvals.get('approval_guarded');
  assert.equal(approval.summary.command, 'rm build/generated.tmp');
  assert.equal(approval.summary.grantRoot, '/repo/build');
  assert.equal(Object.hasOwn(approval.summary, 'output'), false);
  assert.equal(Object.hasOwn(approval.summary, 'diff'), false);
  assert.equal(Object.hasOwn(approval.summary, 'cwd'), false);
});

test('restricted final-answer delta frames append when the compact stream omits cumulative text', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = {
    id: 'auth_member',
    principal: { userId: 'member', isAdmin: false, mode: 'multi' },
  };
  api.state.sessionId = 'session_compact';
  api.state.currentSession = {
    id: 'session_compact',
    projectId: 'project_compact',
    canViewWorkDetails: false,
  };
  api.state.projectsLoaded = true;
  api.state.projects = [{ id: 'project_compact', canViewWorkDetails: false }];
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_compact';

  let entry = null;
  for (const delta of ['Hello', ' from the compact stream.']) {
    const event = api.presentTurnEventForCurrentAudience({
      type: 'assistant.delta',
      turnId: 'turn_compact',
      itemId: 'final_compact',
      eventType: 'delta',
      phase: 'final_answer',
      delta,
    });
    assert.equal(Object.hasOwn(event, 'text'), false);
    entry = api.applyTurnEvent(event, entry);
  }

  assert.equal(entry?.text, 'Hello from the compact stream.');
});

test('SSE keep-alive comments refresh stream activity and prevent a false stale state', async () => {
  let now = 1_000;
  let releasePendingRead;
  let readCount = 0;
  class TestDate extends Date {
    static now() {
      return now;
    }
  }
  const { api } = await loadAppHarness({
    Date: TestDate,
    fetch: async (path) => {
      assert.equal(path, '/api/turns/turn_heartbeat/events');
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                now += 31_000;
                return {
                  done: false,
                  value: new TextEncoder().encode(': keep-alive\n\n'),
                };
              }
              return await new Promise((resolve) => {
                releasePendingRead = resolve;
              });
            },
          }),
        },
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_heartbeat';
  api.state.currentSession = { id: 'session_heartbeat', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_heartbeat';

  const streamPromise = api.streamTurnEvents('turn_heartbeat');
  await flushMicrotasks();

  assert.equal(api.state.lastTurnEventAt, now);
  assert.equal(api.isTurnStreamHealthy(), true);

  api.state.streamAbortController.abort();
  releasePendingRead({ done: true });
  await streamPromise;
});

test('chat header renders current goal state under the project title', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.currentSession = {
    id: 'session_goal',
    cwd: '/repo',
    goal: {
      threadId: 'session_goal',
      objective: 'ship goal status indicator',
      status: 'paused',
    },
  };

  const html = api.renderChatContent();

  assert.match(html, /<div class="goal-status" data-status="paused" data-i18n-skip>/u);
  assert.match(html, /Goal paused/u);
  assert.match(html, /ship goal status indicator/u);
});

test('chat header renders active, pause, and done goal statuses without calling them running', async () => {
  const { api } = await loadAppHarness();

  api.state.currentSession = {
    id: 'session_goal',
    cwd: '/repo',
    goal: {
      threadId: 'session_goal',
      objective: 'ship goal status indicator',
      status: 'active',
    },
  };

  const activeHtml = api.renderChatContent();

  assert.match(activeHtml, /data-status="active"/u);
  assert.match(activeHtml, /Goal active/u);
  assert.doesNotMatch(activeHtml, /Goal running/u);

  api.state.currentSession.goal.status = 'pause';

  const pausedHtml = api.renderChatContent();

  assert.match(pausedHtml, /data-status="paused"/u);
  assert.match(pausedHtml, /Goal paused/u);
  assert.doesNotMatch(pausedHtml, /Goal running/u);

  api.state.currentSession.goal.status = 'done';

  const doneHtml = api.renderChatContent();

  assert.match(doneHtml, /data-status="done"/u);
  assert.match(doneHtml, /Goal done/u);
  assert.doesNotMatch(doneHtml, /Goal running/u);
});

test('goal status colors are distinct for each state', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.goal-status\[data-status="active"\]\s*\{[^}]*color:\s*var\(--success\);/su);
  assert.match(styles, /\.goal-status\[data-status="paused"\]\s*\{[^}]*color:\s*var\(--warn\);/su);
  assert.match(styles, /\.goal-status\[data-status="done"\]\s*\{[^}]*color:\s*var\(--info\);/su);
  assert.match(styles, /\.goal-status\[data-status="blocked"\]\s*\{[^}]*color:\s*var\(--danger\);/su);
  assert.match(styles, /\.goal-status\[data-status="unknown"\]\s*\{[^}]*color:\s*var\(--muted\);/su);
});

test('session summary updates do not clear a detailed current goal', async () => {
  const { api } = await loadAppHarness();

  api.state.sessionId = 'session_goal';
  api.state.currentSession = {
    id: 'session_goal',
    cwd: '/repo',
    goal: {
      threadId: 'session_goal',
      objective: 'ship goal status indicator',
      status: 'active',
    },
  };
  api.state.sessions = [api.state.currentSession];

  api.upsertSession({ id: 'session_goal', cwd: '/repo', lastUserInput: 'new prompt' });

  assert.equal(api.state.currentSession.goal.objective, 'ship goal status indicator');
});

test('session detail updates can clear the current goal', async () => {
  const { api } = await loadAppHarness();

  api.state.sessionId = 'session_goal';
  api.state.currentSession = {
    id: 'session_goal',
    cwd: '/repo',
    goal: {
      threadId: 'session_goal',
      objective: 'ship goal status indicator',
      status: 'active',
    },
  };
  api.state.sessions = [api.state.currentSession];

  api.upsertSession({ id: 'session_goal', cwd: '/repo', goal: null });

  assert.equal(api.state.currentSession.goal, null);
});

test('session lists retain summaries while only the current session retains full history', async () => {
  const { api } = await loadAppHarness();
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo/one', settings: { metadata: {} } };
  api.state.sessions = [api.state.currentSession];
  api.state.sessionsByScope.all = [api.state.currentSession];

  api.upsertSession({
    id: 'session_1',
    cwd: '/repo/one',
    lastUserInput: 'Keep the summary',
    settings: { metadata: {} },
    thread: { turns: [{ id: 'turn_1', items: [{ text: 'x'.repeat(100_000) }] }] },
    timeline: [{ id: 'history_1', text: 'y'.repeat(100_000) }],
  });

  assert.equal(api.state.currentSession.thread.turns[0].id, 'turn_1');
  assert.equal(api.state.currentSession.timeline[0].id, 'history_1');
  for (const session of [...api.state.sessions, ...api.state.sessionsByScope.all]) {
    assert.equal(Object.hasOwn(session, 'thread'), false);
    assert.equal(Object.hasOwn(session, 'timeline'), false);
    assert.equal(session.lastUserInput, 'Keep the summary');
  }
});

test('composer status separator uses continuous css rules outside the message box', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.composer-status::before,\s*\.composer-status::after\s*\{[^}]*flex:\s*1;/su);
  assert.match(styles, /\.composer-status::before,\s*\.composer-status::after\s*\{[^}]*border-top:\s*1px solid currentColor;/su);
  assert.match(styles, /\.composer-status\s*\{[^}]*width:\s*min\(40%,\s*288px\);/su);
  assert.match(styles, /\.composer-status\[data-tone="work"\]\s*\{[^}]*color:\s*var\(--success\);/su);
  assert.match(styles, /\.composer-status span\s*\{/u);
});

test('assistant messages render markdown while user messages stay plain text', async () => {
  const { api } = await loadAppHarness();

  const assistantHtml = api.renderTimelineItem({
    id: 'assistant_1',
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    meta: 'final',
    text: '## Done\n\n- item with **bold** and `code`\n\n```sh\nnpm test\n```',
  });
  assert.match(assistantHtml, /<div class="message-text markdown-body">/u);
  assert.match(assistantHtml, /<h2>Done<\/h2>/u);
  assert.match(assistantHtml, /<li>item with <strong>bold<\/strong> and <code>code<\/code><\/li>/u);
  assert.match(assistantHtml, /<pre><code>npm test\n<\/code><\/pre>/u);

  const userHtml = api.renderTimelineItem({
    id: 'user_1',
    kind: 'message',
    role: 'user',
    label: 'You',
    meta: 'pending',
    text: '**do not render**',
  });
  assert.match(userHtml, /<p class="message-text">\*\*do not render\*\*<\/p>/u);
});

test('work batches retain compact recovery metadata without raw transport payloads', async () => {
  const { api } = await loadAppHarness();

  let assistantEntry = null;
  assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_raw',
    threadId: 'session_1',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_raw',
    batchId: 'raw_batch',
    kind: 'command',
    title: 'npm test',
    raw: { method: 'item/started', params: { item: { id: 'raw_batch' } } },
  }, assistantEntry);

  const [workItem] = api.currentSessionWorkItems();
  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(workItem?.turnId, 'turn_raw');
  assert.equal(workItem?.batches.length, 1);
  assert.equal(api.state.batches.get('raw_batch')?.batchId, 'raw_batch');
  assert.equal(api.state.batches.get('raw_batch')?.summary?.raw, undefined);
  api.state.authSession = { principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = { id: 'session_raw_work', cwd: '/repo' };
  api.state.sessionId = 'session_raw_work';
  api.state.workDetailsOpen = true;
  api.state.workDetailsTurnId = 'turn_raw';
  api.state.workDetailsVisibleEndIndex = 1;
  const html = api.renderWorkDetailsDialog();
  assert.match(html, /class="work-turn"/u);
  assert.match(html, /Ran 1/u);
  assert.match(html, /npm test/u);
  assert.doesNotMatch(html, /item\/started/u);
});

test('file-change batches surface changed paths and line counts', async () => {
  const { api } = await loadAppHarness();

  api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_edit',
    batchId: 'edit_1',
    kind: 'file_change',
    title: 'Update runtime state',
  }, null);
  api.applyTurnEvent({
    type: 'batch.updated',
    turnId: 'turn_edit',
    batchId: 'edit_1',
    summary: {
      fileChanges: [
        { path: 'packages/codex-web/src/runtime.ts', action: 'update', additions: 8, deletions: 2 },
      ],
    },
  }, null);
  api.applyTurnEvent({
    type: 'batch.completed',
    turnId: 'turn_edit',
    batchId: 'edit_1',
    status: 'completed',
  }, null);

  const [workItem] = api.currentSessionWorkItems();
  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(workItem?.turnId, 'turn_edit');
  api.state.authSession = { principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = { id: 'session_edit_work', cwd: '/repo' };
  api.state.sessionId = 'session_edit_work';
  api.state.workDetailsOpen = true;
  api.state.workDetailsTurnId = 'turn_edit';
  api.state.workDetailsVisibleEndIndex = 1;
  const html = api.renderWorkDetailsDialog();
  assert.match(html, /Edited 1/u);
  assert.match(html, /packages\/codex-web\/src\/runtime\.ts/u);
  assert.match(html, /Modified/u);
  assert.match(html, /\+8 \/ -2/u);
});

test('work details normalize structured output and heterogeneous file-change shapes', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = { principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = { id: 'session_structured_work', cwd: '/repo' };
  api.state.sessionId = 'session_structured_work';
  api.state.workDetailsOpen = true;
  api.state.workDetailsTurnId = 'turn_structured';
  api.state.workDetailsVisibleEndIndex = 1;
  api.state.batches.set('edit_structured', {
    id: 'work_structured',
    turnId: 'turn_structured',
    batchId: 'edit_structured',
    batchKind: 'file_change',
    title: 'exec',
    status: 'completed',
    summary: {
      fileChanges: {
        'packages/codex-web/public/app.js': { action: 'updated', additions: 4, deletions: 1 },
        'packages/codex-web/public/styles.css': 'modified',
      },
      output: [
        { type: 'input_text', text: 'Script completed' },
        { type: 'input_text', text: 'Patch applied' },
      ],
    },
  });
  const html = api.renderWorkDetailsDialog();

  assert.match(html, /Edited 2/u);
  assert.match(html, /packages\/codex-web\/public\/app\.js/u);
  assert.match(html, /packages\/codex-web\/public\/styles\.css/u);
  assert.match(html, /Modified/u);
  assert.match(html, /\+4 \/ -1/u);
  assert.match(html, /Script completed\nPatch applied/u);
  assert.doesNotMatch(html, /\[object Object\]/u);
});

test('work dialog scopes activity to the current turn and windows long runs', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = { principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = { id: 'session_long_work', projectId: 'project_1' };
  api.state.sessionId = 'session_long_work';
  api.state.turnId = 'turn_current';
  api.state.pendingTurn = true;
  api.state.workDetailsOpen = true;
  api.state.batches.set('old_secret', {
    turnId: 'turn_old',
    batchId: 'old_secret',
    batchKind: 'command',
    title: 'OLD_SESSION_WORK_SHOULD_NOT_RENDER',
    status: 'completed',
    summary: {},
  });
  for (let index = 0; index < 200; index += 1) {
    api.state.batches.set(`current_${index}`, {
      turnId: 'turn_current',
      batchId: `current_${index}`,
      batchKind: 'command',
      title: `command-${index}`,
      status: 'completed',
      summary: { command: `command-${index}` },
    });
  }
  api.state.workDetailsTurnId = 'turn_current';
  api.state.workDetailsVisibleEventLimit = 20;
  api.state.workDetailsVisibleEndIndex = 200;
  api.state.workDetailsFollowLatest = true;

  const html = api.renderWorkDetailsDialog();
  assert.doesNotMatch(html, /OLD_SESSION_WORK_SHOULD_NOT_RENDER/u);
  assert.equal((html.match(/data-work-event-id=/gu) || []).length, 20);
  assert.match(html, /Show 20 earlier/u);
  assert.doesNotMatch(html, /command-179</u);
  assert.match(html, /command-180</u);
  assert.match(html, /command-199</u);

  api.state.workDetailsVisibleEventLimit = 40;
  const earlierHtml = api.renderWorkDetailsDialog();
  assert.equal((earlierHtml.match(/data-work-event-id=/gu) || []).length, 40);
  assert.match(earlierHtml, /command-160</u);

  api.state.workDetailsFollowLatest = false;
  api.state.workDetailsVisibleEventLimit = 20;
  api.state.batches.set('current_200', {
    turnId: 'turn_current',
    batchId: 'current_200',
    batchKind: 'command',
    title: 'command-200',
    status: 'running',
    summary: { command: 'command-200' },
  });
  const frozenHtml = api.renderWorkDetailsDialog();
  assert.match(frozenHtml, /1 new activity/u);
  assert.doesNotMatch(frozenHtml, /command-200</u);

  api.state.workDetailsFollowLatest = true;
  api.handleWorkDetailToggle({
    target: {
      open: true,
      matches: (selector) => selector === '.work-detail',
    },
  });
  assert.equal(api.state.workDetailsFollowLatest, false);
});

test('latest turns without tool activity do not reopen an older turn from the status bar', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = { principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = {
    id: 'session_latest_without_work',
    thread: {
      turns: [
        { id: 'turn_old_with_work', status: 'completed' },
        { id: 'turn_latest_without_work', status: 'completed' },
      ],
    },
  };
  api.state.sessionId = 'session_latest_without_work';
  api.state.pendingTurn = false;
  api.state.turnId = null;
  api.state.latestTurnId = '';
  api.state.batches.set('old_batch', {
    turnId: 'turn_old_with_work',
    batchId: 'old_batch',
    batchKind: 'command',
    title: 'old command',
    status: 'completed',
    summary: { command: 'old command' },
  });

  assert.doesNotMatch(api.renderComposerStatus(), /id="open-work-details-button"/u);
  api.state.workDetailsOpen = true;
  assert.equal(api.renderWorkDetailsDialog(), '');
});

test('returning to sessions and back keeps the unsent prompt draft', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.sessions = [{ id: 'session_1', cwd: '/repo', settings: { metadata: {} } }];
  api.state.prompt = 'unfinished draft';

  api.showSessionList();
  assert.equal(api.state.prompt, 'unfinished draft');

  await api.selectSession('session_1');
  assert.equal(api.state.prompt, 'unfinished draft');
});

test('switching sessions keeps unsent prompt drafts scoped to each session', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo/one', settings: { metadata: {} } };
  api.state.sessions = [
    { id: 'session_1', cwd: '/repo/one', settings: { metadata: {} } },
    { id: 'session_2', cwd: '/repo/two', settings: { metadata: {} } },
  ];
  api.state.prompt = 'draft for session one';

  await api.selectSession('session_2');

  assert.equal(api.state.prompt, '');

  api.state.prompt = 'draft for session two';
  await api.selectSession('session_1');

  assert.equal(api.state.prompt, 'draft for session one');
});

test('session refresh while chat is open keeps the latest timeline position', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.doesNotMatch(app, /if \(state\.view === 'sessions' \|\| hydrateTimeline\)[\s\S]*scrollTimelineToBottom\(\);/u);
  assert.match(app, /if \(state\.sessionId === sessionId\) \{\s*renderChatWithTimelineRestored\(\(\) => \{\}\);\s*if \(hydrateTimeline && state\.view === 'chat'\) \{\s*scrollTimelineToBottomIfFollowingLatest\(\);/u);
});

test('turn events update the chat timeline without replacing the focused composer', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.prompt = 'draft in progress';
  api.render();

  const promptInput = api.context.document.querySelector('#prompt-input');
  promptInput.focus();
  const originalAppRenderCount = api.context.__appRenderCount;
  const originalTimeline = api.context.document.querySelector('#timeline');

  api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_1',
    text: 'hello',
    phase: 'streaming',
  }, null);

  assert.equal(api.context.__appRenderCount, originalAppRenderCount);
  assert.equal(api.context.document.activeElement, promptInput);
  assert.equal(api.context.document.querySelector('#prompt-input'), promptInput);
  assert.equal(api.context.document.querySelector('#timeline'), originalTimeline);
  assert.match(originalTimeline.innerHTML, /hello/u);
});

test('streaming deltas coalesce timeline rendering and persistence', async () => {
  const frames: Array<() => void> = [];
  const timers: Array<() => void> = [];
  const { api, storage } = await loadAppHarness({
    requestAnimationFrame: (callback: () => void) => {
      frames.push(callback);
      return frames.length;
    },
    setTimeout: (callback: () => void) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout: () => {},
  });
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_stream';
  api.state.currentSession = { id: 'session_stream', cwd: '/repo', settings: { metadata: {} } };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_stream';
  api.render();
  frames.length = 0;
  timers.length = 0;

  let assistantEntry = null;
  for (let index = 0; index < 40; index += 1) {
    assistantEntry = api.applyTurnEvent({
      type: 'assistant.delta',
      turnId: 'turn_stream',
      text: String(index % 10),
      phase: 'streaming',
    }, assistantEntry);
  }

  assert.equal(frames.length, 1);
  assert.equal(timers.length, 1);
  assert.equal(storage.has('codexWebTimelineCache'), false);
  frames.shift()?.();
  assert.match(api.context.document.querySelector('#timeline').innerHTML, /0123456789/u);
  timers.shift()?.();
  assert.match(storage.get('codexWebTimelineCache') || '', /0123456789/u);
});

test('assistant item projections keep commentary reasoning summaries and finals as ordered blocks', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = { id: 'auth_1', principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = { id: 'session_items', cwd: '/repo' };
  api.state.sessionId = 'session_items';
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_items';

  let entry = null;
  entry = api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_items',
    itemId: 'commentary_a',
    eventType: 'started',
    phase: 'commentary',
    text: '',
    delta: '',
  }, entry);
  assert.doesNotMatch(api.renderTimelineItem(entry), />undefined</u);
  assert.doesNotMatch(api.renderChatContent(), /message-card/u);

  entry = api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_items',
    itemId: 'commentary_a',
    eventType: 'delta',
    phase: 'commentary',
    text: 'Checking the parser.',
    delta: 'Checking the parser.',
  }, entry);
  entry = api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_items',
    itemId: 'commentary_a',
    eventType: 'completed',
    phase: 'commentary',
    text: 'Checking the parser. Done.',
    delta: ' Done.',
  }, entry);
  api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_items',
    itemId: 'reasoning_summary_b',
    eventType: 'completed',
    phase: 'reasoning_summary',
    text: 'Compared both event paths.',
    delta: 'Compared both event paths.',
  }, entry);
  api.applyTurnEvent({
    type: 'assistant.final',
    turnId: 'turn_items',
    itemId: 'final_c',
    eventType: 'completed',
    text: 'The fix is complete.',
    delta: '',
  }, entry);

  const assistantItems = api.state.timeline.filter((item) => item.role === 'assistant');
  assert.equal(
    JSON.stringify(assistantItems.map((item) => [item.itemId, item.meta, item.text])),
    JSON.stringify([
      ['commentary_a', 'commentary', 'Checking the parser. Done.'],
      ['reasoning_summary_b', 'reasoning-summary', 'Compared both event paths.'],
      ['final_c', 'final', 'The fix is complete.'],
    ]),
  );
  assert.equal(assistantItems[0].text.includes('Checking the parser.Checking the parser.'), false);
});

test('stream reset snapshot restores a complete projection and ignores retained events below its watermark', async () => {
  const snapshot = {
    type: 'stream.reset',
    epoch: 'epoch_new',
    reset: true,
    snapshot: {
      throughSequence: 600,
      complete: true,
      events: [
        { type: 'assistant.delta', turnId: 'turn_reset', itemId: 'commentary_1', eventType: 'completed', phase: 'commentary', text: 'Snapshot commentary', delta: '', sequence: 10 },
        { type: 'batch.started', turnId: 'turn_reset', batchId: 'command_1', kind: 'command', title: 'npm test', sequence: 20 },
        { type: 'batch.updated', turnId: 'turn_reset', batchId: 'command_1', summary: { output: '643 passed' }, sequence: 590 },
        { type: 'batch.completed', turnId: 'turn_reset', batchId: 'command_1', status: 'completed', sequence: 591 },
        { type: 'assistant.delta', turnId: 'turn_reset', itemId: 'commentary_2', eventType: 'completed', phase: 'commentary', text: 'Snapshot verification', delta: '', sequence: 600 },
      ],
    },
  };
  const frames = [
    `event: control\ndata: ${JSON.stringify(snapshot)}\n\n`,
    'id: 599\ndata: {"type":"assistant.delta","turnId":"turn_reset","itemId":"commentary_1","eventType":"completed","phase":"commentary","text":"STALE RETAINED TEXT","delta":"","sequence":599}\n\n',
    'id: 601\ndata: {"type":"assistant.delta","turnId":"turn_reset","itemId":"commentary_2","eventType":"completed","phase":"commentary","text":"Snapshot verification complete","delta":" complete","sequence":601}\n\n',
  ];
  let readIndex = 0;
  const fetchCalls: string[] = [];
  const { api, storage } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_reset') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_reset',
              cwd: '/repo',
              activeTurnId: 'turn_reset',
              thread: {
                turns: [{
                  id: 'turn_reset',
                  status: 'in_progress',
                  items: [
                    { itemId: 'commentary_1', type: 'agentMessage', role: 'assistant', phase: 'commentary', text: 'Snapshot commentary' },
                    { itemId: 'commentary_2', type: 'agentMessage', role: 'assistant', phase: 'commentary', text: 'Snapshot verification' },
                  ],
                }],
              },
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            if (name === 'X-Codex-Event-Epoch') return 'epoch_new';
            if (name === 'X-Codex-Event-Reset') return 'true';
            return '';
          },
        },
        body: {
          getReader: () => ({
            read: async () => readIndex < frames.length
              ? { done: false, value: new TextEncoder().encode(frames[readIndex++]) }
              : { done: true },
          }),
        },
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = { id: 'session_reset', cwd: '/repo' };
  api.state.sessionId = 'session_reset';
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_reset';
  api.state.lastTurnEventSequence = 12;
  api.state.lastTurnEventEpoch = 'epoch_old';
  api.state.timeline = [
    {
      id: 'local_user_reset',
      kind: 'message',
      role: 'user',
      label: 'You',
      meta: 'pending',
      text: 'Keep this before the snapshot',
    },
    {
      id: 'assistant_turn_reset_partial',
      kind: 'message',
      role: 'assistant',
      label: 'Assistant',
      meta: 'commentary',
      text: 'Partial tail only',
      turnId: 'turn_reset',
      source: 'stream',
    },
  ];

  await api.streamTurnEvents('turn_reset');

  assert.equal(fetchCalls[0], '/api/turns/turn_reset/events?after=12&epoch=epoch_old');
  assert.equal(api.state.lastTurnEventEpoch, 'epoch_new');
  assert.equal(api.state.lastTurnEventSequence, 601);
  assert.doesNotMatch(JSON.stringify(api.state.timeline), /Partial tail only|STALE RETAINED TEXT/u);
  assert.equal(
    JSON.stringify(api.state.timeline.map((item) => item.kind === 'message' ? item.text : item.id)),
    JSON.stringify(['Keep this before the snapshot', 'Snapshot commentary', 'Snapshot verification complete']),
  );
  assert.equal(api.state.batches.get('command_1')?.summary?.output, '643 passed');
  const persisted = JSON.parse(storage.get('codexWebTimelineCache'));
  assert.equal(persisted.entries[0]?.streamCursor?.turnId, 'turn_reset');
  assert.equal(persisted.entries[0]?.streamCursor?.epoch, 'epoch_new');
  assert.equal(persisted.entries[0]?.streamCursor?.sequence, 600);
});

test('incomplete reset snapshots merge onto authoritative session commentary instead of clearing it', async () => {
  const control = {
    type: 'stream.reset',
    epoch: 'epoch_recovered',
    reset: true,
    snapshot: {
      throughSequence: 50,
      complete: false,
      events: [
        { type: 'turn.started', turnId: 'turn_incomplete', sequence: 40 },
        { type: 'assistant.delta', turnId: 'turn_incomplete', itemId: 'new_commentary', eventType: 'completed', phase: 'commentary', text: 'New process commentary', delta: '', sequence: 50 },
      ],
    },
  };
  let eventRead = false;
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_incomplete') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_incomplete',
              activeTurnId: 'turn_incomplete',
              thread: {
                turns: [{
                  id: 'turn_incomplete',
                  status: 'in_progress',
                  items: [{
                    itemId: 'old_commentary',
                    type: 'agentMessage',
                    role: 'assistant',
                    phase: 'commentary',
                    text: 'Commentary from before restart',
                  }],
                }],
              },
            },
          }),
        };
      }
      assert.equal(path, '/api/turns/turn_incomplete/events?after=25&epoch=epoch_before');
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name === 'X-Codex-Event-Epoch' ? 'epoch_recovered' : 'true' },
        body: {
          getReader: () => ({
            read: async () => {
              if (eventRead) return { done: true };
              eventRead = true;
              return {
                done: false,
                value: new TextEncoder().encode(`event: control\ndata: ${JSON.stringify(control)}\n\n`),
              };
            },
          }),
        },
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_single', principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = { id: 'session_incomplete', cwd: '/repo' };
  api.state.sessionId = 'session_incomplete';
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_incomplete';
  api.state.lastTurnEventSequence = 25;
  api.state.lastTurnEventEpoch = 'epoch_before';

  await api.streamTurnEvents('turn_incomplete');
  await flushMicrotasks();

  assert.equal(
    JSON.stringify(api.state.timeline.filter((item) => item.role === 'assistant').map((item) => item.text)),
    JSON.stringify(['Commentary from before restart', 'New process commentary']),
  );
  assert.equal(api.state.lastTurnEventSequence, 50);
});

test('stream completion refreshes chat chrome without replacing the focused composer', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/turns/turn_1/events');
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => ({ done: true }),
          }),
        },
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.render();

  const promptInput = api.context.document.querySelector('#prompt-input');
  promptInput.focus();
  const originalAppRenderCount = api.context.__appRenderCount;
  const originalTimeline = api.context.document.querySelector('#timeline');

  await api.streamTurnEvents('turn_1');

  assert.equal(api.context.__appRenderCount, originalAppRenderCount);
  assert.equal(api.context.document.activeElement, promptInput);
  assert.equal(api.context.document.querySelector('#prompt-input'), promptInput);
  assert.equal(api.context.document.querySelector('#timeline'), originalTimeline);
});

test('chat metadata refresh keeps the focused composer input', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_1/status');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_1',
            cwd: '/repo',
            settings: { metadata: {} },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.sessions = [api.state.currentSession];
  api.render();

  const promptInput = context.document.querySelector('#prompt-input');
  promptInput.focus();

  await api.refreshCurrentSessionMetadata();

  const nextPromptInput = context.document.querySelector('#prompt-input');
  assert.equal(context.document.activeElement, nextPromptInput);
});

test('chat metadata refresh preserves composer selection', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_1/status');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_1',
            cwd: '/repo',
            settings: { metadata: {} },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.sessions = [api.state.currentSession];
  api.state.prompt = 'draft in progress';
  api.render();

  const promptInput = context.document.querySelector('#prompt-input');
  promptInput.focus();
  promptInput.setSelectionRange(17, 17);

  await api.refreshCurrentSessionMetadata();

  const nextPromptInput = context.document.querySelector('#prompt-input');
  assert.equal(context.document.activeElement, nextPromptInput);
  assert.equal(nextPromptInput.value, 'draft in progress');
  assert.equal(nextPromptInput.selectionStart, 17);
  assert.equal(nextPromptInput.selectionEnd, 17);
});

test('chat refresh preserves the focused composer selection through status rerenders', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_1');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_1',
            cwd: '/repo',
            settings: { metadata: {} },
            thread: { turns: [] },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.prompt = 'keep my caret';
  api.render();

  const promptInput = context.document.querySelector('#prompt-input');
  promptInput.focus();
  promptInput.setSelectionRange(12, 12);

  await api.refreshCurrentView();

  const nextPromptInput = context.document.querySelector('#prompt-input');
  assert.equal(context.document.activeElement, nextPromptInput);
  assert.equal(nextPromptInput.value, 'keep my caret');
  assert.equal(nextPromptInput.selectionStart, 12);
  assert.equal(nextPromptInput.selectionEnd, 12);
});

test('sending a message keeps a following chat timeline at the latest content', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ turnId: 'turn_1' }),
        };
      }
      if (path === '/api/turns/turn_1/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.prompt = 'keep me anchored';
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1000;
  timeline.clientHeight = 200;
  timeline.scrollTop = 800;
  api.updateTimelineFollowState();

  await api.onComposerSubmit({ preventDefault() {} });

  const nextTimeline = context.document.querySelector('#timeline');
  assert.equal(nextTimeline.scrollTop, nextTimeline.scrollHeight);
});

test('opening a session markdown path shows loading then fetches content with bearer auth', async () => {
  let releaseResolve: (() => void) | null = null;
  const calls = [];
  const { api, context } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/api/sessions/session_1/files/resolve') {
        await new Promise<void>((resolve) => {
          releaseResolve = resolve;
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({ file: { id: 'file_audit', name: 'audit.md', kind: 'markdown', mimeType: 'text/markdown', sizeBytes: 18, contentUrl: '/api/sessions/session_1/files/signed-audit/content' } }),
        };
      }
      if (path === '/api/sessions/session_1/files/signed-audit/content') {
        return { ok: true, status: 200, text: async () => '# Audit' };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  const pending = api.openSessionFileByPath('docs/My%20audit.md#findings');
  await flushMicrotasks();

  assert.equal(api.state.view, 'file');
  assert.equal(api.state.currentSessionFileLoading, true);
  assert.match(context.document.querySelector('.session-file-viewer')?.innerHTML || '', /Loading file/u);

  releaseResolve?.();
  await pending;

  assert.equal(JSON.parse(calls[0].options.body).path, 'docs/My audit.md');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer token');
  assert.match(context.document.querySelector('.session-file-viewer')?.innerHTML || '', /<h1>Audit<\/h1>/u);
});

test('admin observed sessions open documents through scoped read-only routes and return to observer mode', async () => {
  const calls = [];
  const { api, context } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (requestPath, options = {}) => {
      calls.push({ path: requestPath, options });
      if (requestPath === '/api/admin/sessions/session_observed/files/resolve') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            file: {
              id: 'file_observed',
              name: 'observed.md',
              kind: 'markdown',
              mimeType: 'text/markdown',
              contentUrl: '/api/admin/sessions/session_observed/files/file_observed/content',
            },
          }),
        };
      }
      if (requestPath === '/api/admin/sessions/session_observed/files/file_observed/content') {
        return { ok: true, status: 200, text: async () => '# Observed document' };
      }
      throw new Error(`unexpected fetch ${requestPath}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = {
    id: 'auth_1',
    principal: { userId: 'admin', isAdmin: true, mode: 'multi' },
  };
  api.state.view = 'admin';
  api.state.sessionId = 'session_observed';
  api.state.currentSession = { id: 'session_observed', mode: 'observer', readOnly: true };
  api.state.admin.observedSession = api.state.currentSession;

  await api.openSessionFileByPath('docs/observed.md');

  assert.deepEqual(calls.map((call) => call.path), [
    '/api/admin/sessions/session_observed/files/resolve',
    '/api/admin/sessions/session_observed/files/file_observed/content',
  ]);
  assert.equal(api.state.view, 'file');
  assert.match(context.document.querySelector('#app').innerHTML, /Observed document/u);

  api.closeSessionFileViewer();

  assert.equal(api.state.view, 'admin');
  assert.equal(api.state.sessionId, 'session_observed');
  assert.equal(api.state.currentSession?.mode, 'observer');
});

test('opening a source link strips its line location before resolving the file', async () => {
  const calls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      calls.push({ path, options });
      return { ok: false, status: 404, json: async () => ({ error: 'file_not_found' }) };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  await api.openSessionFileByPath('/repo/packages/codex-web/public/app.js:3091');

  assert.equal(calls[0]?.path, '/api/sessions/session_1/files/resolve');
  assert.equal(JSON.parse(calls[0]?.options.body).path, '/repo/packages/codex-web/public/app.js');
});

test('closing a session file aborts late content and clears viewer state', async () => {
  let releaseText: ((value: string) => void) | null = null;
  let contentSignal: AbortSignal | null = null;
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      if (path === '/api/sessions/session_1/files/resolve') {
        return { ok: true, status: 200, json: async () => ({ file: { id: 'file_a', name: 'a.md', kind: 'markdown', contentUrl: '/api/sessions/session_1/files/a/content' } }) };
      }
      contentSignal = options.signal || null;
      return {
        ok: true,
        status: 200,
        text: async () => await new Promise<string>((resolve) => {
          releaseText = resolve;
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  const pending = api.openSessionFileByPath('a.md');
  await flushMicrotasks();
  api.closeSessionFileViewer();

  assert.equal(contentSignal?.aborted, true);
  releaseText?.('late content');
  await pending;
  assert.equal(api.state.currentSessionFile, null);
  assert.equal(api.state.currentSessionFileContent, '');
  assert.equal(api.state.currentSessionFileLoading, false);
});

test('session file viewer previews pdf and image blobs and revokes URLs on switch and close', async () => {
  const created = [];
  const revoked = [];
  const { api, context } = await loadAppHarness({
    URL: {
      createObjectURL: () => {
        const value = `blob:file-${created.length + 1}`;
        created.push(value);
        return value;
      },
      revokeObjectURL: (value) => revoked.push(value),
    },
    fetch: async (path) => {
      if (path === '/api/sessions/session_1/files/resolve') {
        const image = created.length > 0;
        return { ok: true, status: 200, json: async () => ({ file: { id: image ? 'image' : 'pdf', name: image ? 'preview.png' : 'brief.pdf', kind: image ? 'image' : 'pdf', mimeType: image ? 'image/png' : 'application/pdf', contentUrl: image ? '/api/sessions/session_1/files/image/content' : '/api/sessions/session_1/files/pdf/content' } }) };
      }
      return { ok: true, status: 200, blob: async () => new Blob(['binary']) };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', activityState: 'waiting_approval', settings: { metadata: {} } };

  await api.openSessionFileByPath('docs/brief.pdf');
  assert.match(context.document.querySelector('#app').innerHTML, /class="session-file-frame session-file-pdf"[^>]*src="blob:file-1"/u);
  assert.match(context.document.querySelector('#app').innerHTML, /Needs approval/u);
  assert.match(context.document.querySelector('#app').innerHTML, /id="session-file-download"[^>]*href="blob:file-1"/u);

  await api.openSessionFileByPath('images/preview.png');
  assert.deepEqual(revoked, ['blob:file-1']);
  assert.match(context.document.querySelector('#app').innerHTML, /class="session-file-image"[^>]*src="blob:file-2"/u);

  api.closeSessionFileViewer();
  assert.deepEqual(revoked, ['blob:file-1', 'blob:file-2']);
});

test('closing a session file restores the prior chat timeline position', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => path.endsWith('/resolve')
      ? { ok: true, status: 200, json: async () => ({ file: { id: 'file_a', name: 'a.md', kind: 'markdown', contentUrl: '/api/sessions/session_1/files/a/content' } }) }
      : { ok: true, status: 200, text: async () => '# A' },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', text: 'hello' }];
  api.render();
  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1400;
  timeline.clientHeight = 400;
  timeline.scrollTop = 640;
  api.updateTimelineFollowState();

  await api.openSessionFileByPath('a.md');
  api.closeSessionFileViewer();

  const restored = context.document.querySelector('#timeline');
  assert.equal(restored.scrollTop, restored.scrollHeight - restored.clientHeight - 360);
});

test('session file viewer renders a focused not-found error with retry', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async () => ({ ok: false, status: 404, json: async () => ({ error: 'file_not_found' }) }),
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  await api.openSessionFileByPath('missing.md');

  const html = context.document.querySelector('#app').innerHTML;
  assert.match(html, /File not found\./u);
  assert.match(html, /id="retry-session-file-button"/u);
});

test('session file viewer rejects non-content and cross-origin URLs before sending bearer auth', async () => {
  const calls = [];
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      calls.push(path);
      return {
        ok: true,
        status: 200,
        json: async () => ({ file: { id: 'file_bad', name: 'bad.pdf', kind: 'pdf', contentUrl: '/\\evil.example/file' } }),
      };
    },
  });
  api.state.token = 'secret-token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  await api.openSessionFileByPath('bad.pdf');

  assert.deepEqual(calls, ['/api/sessions/session_1/files/resolve']);
  assert.match(context.document.querySelector('#app').innerHTML, /Could not open this file\./u);
});

test('session file viewer explains oversized files', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async () => ({ ok: false, status: 413, json: async () => ({ error: 'file_too_large' }) }),
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  await api.openSessionFileByPath('large.pdf');

  assert.match(context.document.querySelector('#app').innerHTML, /This file is too large to open\./u);
});

test('session cards use the first task as identity and the latest input for orientation', async () => {
  const { api } = await loadAppHarness();

  api.state.sortMode = 'time';
  api.state.sessions = [{
    id: 'session_path',
    cwd: '/Users/alice/workspace/project-alpha',
    firstUserInput: 'First question about project alpha setup and initial constraints',
    lastUserInput: 'Latest follow-up that should not render in the card summary',
    updatedAt: 1716200000000,
    settings: { metadata: {} },
  }];

  const html = api.renderSessionCards();

  assert.match(html, /class="session-title" data-i18n-skip>First question about project alpha setup and initial constraints<\/span>/u);
  assert.match(html, /class="session-preview" data-i18n-skip>Latest follow-up that should not render in the card summary<\/span>/u);
  assert.match(html, /class="session-project" data-i18n-skip>project-alpha<\/span>/u);
  assert.doesNotMatch(html, /No cwd/u);
  assert.doesNotMatch(html, /Users\/alice\/workspace\/project-alpha/u);
});

test('session names prefer the last cwd segment over long stored project labels', async () => {
  const { api } = await loadAppHarness();

  api.state.sortMode = 'time';
  api.state.sessions = [{
    id: 'session_name',
    cwd: '/Users/alice/workspace/project-beta',
    projectDisplayName: 'workspace/project-beta',
    projectName: 'workspace/project-beta',
    updatedAt: 1716200000000,
    settings: { metadata: {} },
  }];
  api.state.currentSession = api.state.sessions[0];

  const listHtml = api.renderSessionCards();
  const chatHtml = api.renderChat().innerHTML;

  assert.match(listHtml, /class="session-project" data-i18n-skip>project-beta<\/span>/u);
  assert.doesNotMatch(listHtml, /workspace\/project-beta/u);
  assert.match(chatHtml, /class="project-title" data-i18n-skip>project-beta<\/div>/u);
});

test('session cards use a neutral title when no prompt exists', async () => {
  const { api } = await loadAppHarness();

  api.state.sortMode = 'time';
  api.state.sessions = [{
    id: 'session_empty',
    cwd: '/Users/alice/workspace/project-gamma',
    updatedAt: 1716200000000,
    settings: { metadata: {} },
  }];

  const html = api.renderSessionCards();

  assert.match(html, /class="session-project" data-i18n-skip>project-gamma<\/span>/u);
  assert.match(html, /class="session-title" data-i18n-skip>New Session<\/span>/u);
  assert.doesNotMatch(html, /class="session-preview"/u);
  assert.doesNotMatch(html, /No prompt preview/u);
  assert.doesNotMatch(html, /No cwd/u);
});

test('session cards use the first task as identity when a provider title also exists', async () => {
  const { api } = await loadAppHarness();
  api.state.sessions = [{
    id: 'session_identity',
    title: 'Generated provider title',
    firstUserInput: 'Original task request',
    lastUserInput: 'Latest follow-up',
    cwd: '/repo/example-project',
    settings: { metadata: {} },
  }];

  const html = api.renderSessionCards();

  assert.match(html, /class="session-title" data-i18n-skip>Original task request<\/span>/u);
  assert.match(html, /class="session-preview" data-i18n-skip>Latest follow-up<\/span>/u);
  assert.doesNotMatch(html, /Generated provider title/u);
});

test('session cards surface lightweight activity states and prioritize approvals', async () => {
  const { api } = await loadAppHarness();
  api.state.sortMode = 'time';
  api.state.sessions = [
    { id: 'session_recent', firstUserInput: 'Recent idle task', updatedAt: 300, settings: { metadata: {} } },
    { id: 'session_running', firstUserInput: 'Background task', updatedAt: 100, activityState: 'running', settings: { metadata: {} } },
    { id: 'session_approval', firstUserInput: 'Approval task', updatedAt: 50, activityState: 'waiting_approval', settings: { metadata: {} } },
  ];

  assert.deepEqual(
    JSON.parse(JSON.stringify(api.sortedSessions().map((session) => session.id))),
    ['session_approval', 'session_running', 'session_recent'],
  );
  const html = api.renderSessionCards();
  assert.match(html, /data-activity-state="waiting_approval"[\s\S]*data-state="waiting_approval">Needs approval<\/span>/u);
  assert.match(html, /data-activity-state="running"[\s\S]*data-state="running">Active<\/span>/u);
  assert.match(html, /data-session-favorite-id="session_approval"[^>]*aria-label="Favorite"[^>]*title="Favorite"/u);
  assert.match(html, /data-session-archive-request-id="session_approval"[^>]*aria-label="Archive"[^>]*title="Archive"/u);

  api.state.sessionId = 'session_running';
  api.state.pendingTurn = false;
  assert.match(api.renderSessionCards(), /data-session-id="session_running"[\s\S]*data-state="running">Active<\/span>/u);
});

test('session summaries follow local approval and terminal events without another request', async () => {
  const { api } = await loadAppHarness();
  api.state.sessionId = 'session_current';
  api.state.currentSession = {
    id: 'session_current',
    firstUserInput: 'Current task',
    activityState: 'running',
    activeTurnId: 'turn_stale',
    settings: { metadata: {} },
  };
  api.state.sessions = [api.state.currentSession];
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_stale';
  api.applyTurnEvent({
    type: 'approval.requested',
    turnId: 'turn_stale',
    threadId: 'session_current',
    approvalId: 'approval_stale',
    approvalKind: 'command',
    summary: {},
  }, null);

  assert.match(api.renderSessionCards(), /data-state="waiting_approval">Needs approval<\/span>/u);

  api.applyTurnEvent({
    type: 'turn.failed',
    turnId: 'turn_stale',
    threadId: 'session_current',
    message: 'Connection lost',
  }, null);

  assert.equal(api.state.pendingTurn, false);
  assert.doesNotMatch(api.renderSessionCards(), /data-activity-state=/u);
});

test('weak-network session failures keep cached sessions and require a manual retry', async () => {
  let requests = 0;
  let online = false;
  const cachedSession = {
    id: 'session_cached',
    firstUserInput: 'Cached task remains visible',
    updatedAt: 100,
    settings: { metadata: {} },
  };
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/sessions');
      requests += 1;
      return online
        ? { ok: true, status: 200, json: async () => ({ items: [cachedSession] }) }
        : { ok: false, status: 503, json: async () => ({ message: 'host unreachable' }) };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [cachedSession];
  api.state.sessionsByScope.all = [cachedSession];

  await assert.rejects(() => api.refreshSessionsList({ renderAfter: false, scope: 'all' }));
  assert.equal(requests, 1);
  assert.equal(api.state.sessionsError, 'Could not update sessions.');
  assert.match(api.renderSessionCards(), /role="alert"[\s\S]*Could not update sessions\.[\s\S]*id="retry-sessions-button"/u);
  assert.match(api.renderSessionCards(), /Cached task remains visible/u);

  online = true;
  await api.refreshSessionsList({ renderAfter: false, scope: 'all' });
  assert.equal(requests, 2);
  assert.equal(api.state.sessionsError, '');
});

test('a failed stale list request does not mark the newly selected cached scope as failed', async () => {
  let resolveAllRequest: ((response: {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }) => void) | null = null;
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/sessions');
      return new Promise((resolve) => {
        resolveAllRequest = resolve;
      });
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sortMode = 'time';
  api.state.sessionsByScope.favorites = [{
    id: 'session_favorite',
    favorite: true,
    settings: { metadata: {} },
  }];
  api.state.sessionsLoadedByScope.favorites = true;

  const staleAllRequest = api.refreshSessionsList({ renderAfter: false, scope: 'all' });
  await api.setSessionSortMode('favorites');
  assert.ok(resolveAllRequest);
  resolveAllRequest({
    ok: false,
    status: 503,
    json: async () => ({ message: 'host unreachable' }),
  });
  await assert.rejects(() => staleAllRequest);

  assert.equal(api.state.sortMode, 'favorites');
  assert.equal(api.state.sessionsError, '');
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_favorite']));
  assert.doesNotMatch(api.renderSessionCards(), /Loading sessions/u);
});

test('switching to a cached session scope clears an error from the previous scope', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = { id: 'auth_1' };
  api.state.sortMode = 'time';
  api.state.sessionsError = 'Could not update sessions.';
  api.state.sessionsByScope.favorites = [{
    id: 'session_favorite',
    favorite: true,
    settings: { metadata: {} },
  }];
  api.state.sessionsLoadedByScope.favorites = true;

  await api.setSessionSortMode('favorites');

  assert.equal(api.state.sessionsError, '');
  assert.doesNotMatch(api.renderSessionCards(), /Could not update sessions/u);
});

test('turn failures render as visible timeline error messages', async () => {
  const { api } = await loadAppHarness();

  let assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_error',
    threadId: 'session_1',
  }, null);
  assistantEntry = api.applyTurnEvent({
    type: 'turn.failed',
    turnId: 'turn_error',
    threadId: 'session_1',
    message: 'Codex app-server disconnected',
  }, assistantEntry);

  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_error');
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.error, '');
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.match(errorItem?.text || '', /Codex app-server disconnected/u);
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);

  const html = api.renderTimelineItem(errorItem);
  assert.match(html, /message-card system error-message/u);
  assert.match(html, /<span class="error-badge">Error<\/span>/u);
  assert.match(html, /Codex app-server disconnected/u);
});

test('request timeout failures use a generic failed status and message', async () => {
  const { api } = await loadAppHarness();
  api.state.sessionId = 'session_timeout';
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_timeout';

  api.applyTurnEvent({
    type: 'turn.failed',
    turnId: 'turn_timeout',
    threadId: 'session_timeout',
    message: 'request timed out',
  }, null);

  assert.equal(api.state.status, 'Turn failed');
  assert.equal(api.state.statusTone, 'danger');
  assert.equal(api.state.timeline.find((item) => item.id === 'error_turn_timeout')?.text, 'Turn failed');
  assert.doesNotMatch(api.renderChat().innerHTML, /request timed out/iu);
});

test('persisted failure wins over a completed runtime turn without a final answer', async () => {
  const { api } = await loadAppHarness();
  api.state.status = 'Ready';
  api.state.statusTone = 'success';
  const session = {
    id: 'session_timeout',
    activeTurnId: null,
    thread: {
      turns: [{ id: 'turn_timeout', status: 'completed', items: [] }],
    },
    timeline: [
      { id: 'user_turn_timeout', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Long task' },
      { id: 'error_turn_timeout', kind: 'message', role: 'system', label: 'Error', meta: 'failed', severity: 'error', text: 'request timed out' },
    ],
  };

  api.syncRuntimeStatusFromSession(session);

  assert.equal(api.state.status, 'Turn failed');
  assert.equal(api.state.statusTone, 'danger');
  const hydrated = api.hydrateTimelineFromSession(session);
  assert.equal(hydrated.find((item) => item.id === 'error_turn_timeout')?.text, 'Turn failed');
  assert.doesNotMatch(JSON.stringify(hydrated), /request timed out/iu);
});

test('turn failures prefer raw details when present', async () => {
  const { api } = await loadAppHarness();

  api.applyTurnEvent({
    type: 'turn.failed',
    turnId: 'turn_rate_limit',
    threadId: 'session_1',
    message: 'Codex request failed',
    details: '429 Too Many Requests: model rate limit reached',
  }, null);

  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_rate_limit');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /429 Too Many Requests/u);
  assert.doesNotMatch(errorItem?.text || '', /^Codex request failed$/u);

  const html = api.renderTimelineItem(errorItem);
  assert.match(html, /message-card system error-message/u);
  assert.match(html, /429 Too Many Requests/u);
});

test('impactful HTTP turn failures survive stale compact session reconciliation', async () => {
  for (const [status, message] of [
    [401, '401 Unauthorized: provider credentials expired'],
    [429, '429 Too Many Requests: model rate limit reached'],
    [503, '503 Service Unavailable: provider temporarily unavailable'],
  ]) {
    const sessionId = `session_http_${status}`;
    const turnId = `turn_http_${status}`;
    const userItem = {
      id: `user_${turnId}`,
      kind: 'message',
      role: 'user',
      label: 'You',
      meta: 'history',
      text: `Trigger ${status}`,
      turnId,
    };
    const { api } = await loadAppHarness({
      fetch: async (path: string, options: any = {}) => {
        if (path === `/api/sessions/${sessionId}/timeline` && options.method === 'POST') {
          return await new Promise(() => {});
        }
        if (path === `/api/sessions/${sessionId}/status`) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ session: { id: sessionId, activeTurnId: null } }),
          };
        }
        if (path === `/api/sessions/${sessionId}/timeline?limit=50`) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              session: { id: sessionId, activeTurnId: null },
              items: [userItem],
              hasMore: false,
            }),
          };
        }
        throw new Error(`unexpected fetch ${path}`);
      },
    });
    api.state.token = 'token';
    api.state.authSession = { id: 'auth_1', principal: { mode: 'single', isAdmin: true } };
    api.state.view = 'chat';
    api.state.sessionId = sessionId;
    api.state.currentSession = { id: sessionId, cwd: '/repo' };
    api.state.sessions = [api.state.currentSession];
    api.state.timeline = [userItem];

    api.applyTurnEvent({ type: 'turn.started', turnId, threadId: sessionId }, null);
    api.applyTurnEvent({ type: 'turn.failed', turnId, threadId: sessionId, details: message }, null);
    await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

    assert.equal(api.state.status, 'Turn failed', `status ${status}`);
    assert.equal(api.state.statusTone, 'danger', `tone ${status}`);
    assert.equal(
      api.state.timeline.find((item) => item.id === `error_${turnId}`)?.text,
      message,
      `timeline ${status}`,
    );
  }
});

test('stream failures render a visible timeline error instead of only composer status', async () => {
  const { api } = await loadAppHarness({
    fetch: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal_error', message: 'SSE failed hard' }),
    }),
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_stream_error';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = false;

  await api.streamTurnEvents('turn_stream_error');

  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_stream_error');
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.error, '');
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /SSE failed hard/u);
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);
});

test('missing observer turn streams reconcile the existing session without showing a false session error', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/admin/sessions/session_observed/turns/turn_stale/events') {
        return {
          ok: false,
          status: 404,
          json: async () => ({
            error: 'session_not_found',
            message: 'Selected session was not found.',
          }),
        };
      }
      if (path === '/api/admin/sessions/session_observed') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'observer',
            session: {
              id: 'session_observed',
              activeTurnId: null,
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Observed question' },
                { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text: 'Observed answer' },
              ],
              thread: {
                turns: [{ id: 'turn_stale', status: 'completed', items: [] }],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = {
    id: 'auth_1',
    principal: { userId: 'admin', isAdmin: true, mode: 'multi' },
  };
  api.state.view = 'chat';
  api.state.sessionId = 'session_observed';
  api.state.currentSession = {
    id: 'session_observed',
    activeTurnId: 'turn_stale',
    mode: 'observer',
    readOnly: true,
  };
  api.state.admin.observedSession = api.state.currentSession;
  api.state.turnId = 'turn_stale';
  api.state.pendingTurn = true;

  await api.streamTurnEvents('turn_stale');

  assert.deepEqual(fetchCalls, [
    '/api/admin/sessions/session_observed/turns/turn_stale/events',
    '/api/admin/sessions/session_observed',
  ]);
  assert.equal(api.state.sessionId, 'session_observed');
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.status, 'Ready');
  assert.equal(api.state.statusTone, 'success');
  assert.equal(api.state.error, '');
  assert.equal(api.state.timeline.some((item) => item.text === 'Selected session was not found.'), false);
  assert.equal(api.state.timeline.some((item) => item.text === 'Observed answer'), true);
});

test('stream failures persist visible errors through the backend session timeline', async () => {
  const fetchCalls: Array<{ path: string; options: any }> = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/turns/turn_stream_error/events') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'internal_error', message: 'SSE failed hard' }),
        };
      }
      if (path === '/api/sessions/session_1/timeline') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            entry: {
              id: 'error_turn_stream_error',
              kind: 'message',
              role: 'system',
              label: 'Error',
              meta: 'failed',
              text: 'SSE failed hard',
              severity: 'error',
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_stream_error';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = false;

  await api.streamTurnEvents('turn_stream_error');
  await flushMicrotasks();

  const persistCall = fetchCalls.find((call) => call.path === '/api/sessions/session_1/timeline');
  assert.ok(persistCall);
  assert.equal(persistCall?.options.method, 'POST');
  assert.deepEqual(JSON.parse(persistCall?.options.body), {
    id: 'error_turn_stream_error',
    role: 'system',
    label: 'Error',
    meta: 'failed',
    text: 'SSE failed hard',
    severity: 'error',
    afterHistoryIndex: 0,
  });
  assert.equal(api.state.timeline.find((item) => item.id === 'error_turn_stream_error')?.text, 'SSE failed hard');
});

test('thread work updates render failed command details and a visible error message', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = { principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.sessionId = 'session_1';

  let assistantEntry = null;
  assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_work_error',
    threadId: 'session_1',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_work_error',
    threadId: 'session_1',
    text: 'Working...',
    phase: 'commentary',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_work_error',
    batchId: 'cmd_error',
    kind: 'command',
    title: 'npm test',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.updated',
    turnId: 'turn_work_error',
    batchId: 'cmd_error',
    summary: {
      command: 'npm test',
      output: '1 failing',
      error: 'Command failed with exit code 1',
      exitCode: 1,
    },
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.completed',
    turnId: 'turn_work_error',
    batchId: 'cmd_error',
    status: 'failed',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'turn.failed',
    turnId: 'turn_work_error',
    threadId: 'session_1',
    message: 'Command failed with exit code 1',
  }, assistantEntry);

  const latest = api.state.timeline.at(-1);
  const [workItem] = api.currentSessionWorkItems();
  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(workItem?.status, 'failed');
  assert.equal(latest?.kind, 'message');
  assert.equal(latest?.role, 'system');
  assert.equal(latest?.severity, 'error');

  api.state.workDetailsOpen = true;
  api.state.workDetailsTurnId = 'turn_work_error';
  api.state.workDetailsVisibleEndIndex = 1;
  const workHtml = api.renderWorkDetailsDialog();
  assert.match(workHtml, /class="work-turn"/u);
  assert.doesNotMatch(workHtml, /work-error|error-badge/u);
  assert.match(workHtml, /Exit 1/u);
  assert.match(workHtml, /npm test/u);
  assert.match(workHtml, /1 failing/u);

  const errorHtml = api.renderTimelineItem(latest);
  assert.match(errorHtml, /<span class="error-badge">Error<\/span>/u);
  assert.match(errorHtml, /Command failed with exit code 1/u);
});

test('retryable submission failures stay quiet until three delivery attempts fail', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/session-submissions') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'internal_error', message: 'Codex refused the first turn' }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.cwd = '/repo';
  api.state.prompt = 'hello';

  await api.onComposerSubmit({ preventDefault() {} });

  const [submission] = [...api.state.submissionOutbox.values()];
  const userItem = api.state.timeline.find((item) => item.submissionId === submission?.id);
  assert.deepEqual(fetchCalls, ['/api/session-submissions']);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(submission?.status, 'failed');
  assert.equal(submission?.retryable, true);
  assert.equal(submission?.attempts, 1);
  assert.equal(userItem?.role, 'user');
  assert.equal(api.state.timeline.some((item) => item.role === 'system'), false);
  assert.equal(api.state.status, 'Waiting to send');
  assert.equal(api.state.statusTone, 'warn');
  assert.equal(api.state.error, '');
  assert.doesNotMatch(api.renderTimelineItem(userItem), /delivery-failed|data-submission-retry-id=/u);

  await api.drainSubmissionOutbox({ force: true });
  assert.equal(api.state.submissionOutbox.get(submission.id)?.attempts, 2);
  assert.doesNotMatch(api.renderTimelineItem(userItem), /delivery-failed|data-submission-retry-id=/u);

  await api.drainSubmissionOutbox({ force: true });
  const failed = api.state.submissionOutbox.get(submission.id);
  const failedHtml = api.renderTimelineItem(userItem);
  assert.equal(fetchCalls.length, 3);
  assert.equal(failed?.attempts, 3);
  assert.equal(api.state.status, 'Send failed');
  assert.equal(api.state.statusTone, 'danger');
  assert.match(failedHtml, /delivery-failed/u);
  assert.match(failedHtml, /data-submission-retry-id=/u);
  assert.match(failedHtml, /aria-label="Send failed\. Retry send"/u);
  assert.doesNotMatch(failedHtml, /submission-delivery-status|data-submission-cancel-id/u);
});

test('existing-session optimistic messages persist before the turn request can finish', async () => {
  let resolveTurn;
  const turnReady = new Promise((resolve) => {
    resolveTurn = resolve;
  });
  const { api, storage } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_weak/turns') {
        await turnReady;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            type: 'command',
            command: { name: 'help', action: 'show', message: 'Command complete' },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_weak';
  api.state.currentSession = { id: 'session_weak', cwd: '/repo', settings: { metadata: {} } };
  api.state.sessions = [api.state.currentSession];
  api.state.prompt = 'Persist me before the network returns';

  const sending = api.onComposerSubmit({ preventDefault() {} });

  const persisted = JSON.parse(storage.get('codexWebTimelineCache') || '{"entries":[]}');
  assert.equal(persisted.entries[0]?.sessionId, 'session_weak');
  assert.equal(persisted.entries[0]?.timeline.at(-1)?.text, 'Persist me before the network returns');
  assert.equal(persisted.entries[0]?.timeline.at(-1)?.meta, 'pending');

  resolveTurn();
  await sending;
});

test('a delayed turn response cannot attach itself to a newly selected session', async () => {
  let resolveTurn;
  const turnReady = new Promise((resolve) => {
    resolveTurn = resolve;
  });
  const streamRequests = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_old/turns') {
        await turnReady;
        return {
          ok: true,
          status: 200,
          json: async () => ({ turnId: 'turn_old_delayed' }),
        };
      }
      if (path === '/api/sessions/session_new') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_new',
              cwd: '/repo/new',
              settings: { metadata: {} },
              thread: { turns: [] },
            },
          }),
        };
      }
      if (path.includes('/api/turns/')) {
        streamRequests.push(path);
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessions = [
    { id: 'session_old', cwd: '/repo/old', firstUserInput: 'Old session', settings: { metadata: {} } },
    { id: 'session_new', cwd: '/repo/new', firstUserInput: 'New session', settings: { metadata: {} } },
  ];
  api.state.sessionId = 'session_old';
  api.state.currentSession = api.state.sessions[0];
  api.state.prompt = 'Message for the old session';

  const sending = api.onComposerSubmit({ preventDefault() {} });
  await flushMicrotasks();
  await api.selectSession('session_new');
  resolveTurn();
  await sending;

  assert.equal(api.state.sessionId, 'session_new');
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.timeline.some((item) => item.text === 'Message for the old session'), false);
  assert.deepEqual(streamRequests, []);
});

test('new-session submission persists before the network request can finish', async () => {
  let resolveSubmission;
  const submissionReady = new Promise((resolve) => {
    resolveSubmission = resolve;
  });
  const fetchCalls = [];
  const { api, storage } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/session-submissions') {
        await submissionReady;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            submission: { id: JSON.parse(options.body).submissionId, status: 'submitted', sessionId: 'session_new', turnId: 'turn_new', error: null },
            session: { id: 'session_new', cwd: '/repo', settings: {}, thread: { turns: [] } },
            turnId: 'turn_new',
          }),
        };
      }
      if (path === '/api/turns/turn_new/events') {
        return { ok: true, status: 200, body: { getReader: () => ({ read: async () => ({ done: true }) }) } };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.draftSessionActive = true;
  api.state.cwd = '/repo';
  api.state.prompt = 'Persist before sending';

  const sending = api.onComposerSubmit({ preventDefault() {} });
  await Promise.resolve();

  const [[outboxKey, outboxValue]] = submissionStorageEntries(storage);
  const persisted = JSON.parse(outboxValue).entry;
  const requestBody = JSON.parse(fetchCalls[0].options.body);
  assert.equal(persisted.text, 'Persist before sending');
  assert.equal(persisted.status, 'sending');
  assert.equal(persisted.id, requestBody.submissionId);
  assert.equal(fetchCalls[0].path, '/api/session-submissions');
  const sendingHtml = api.renderTimelineItem(api.state.timeline[0]);
  assert.doesNotMatch(sendingHtml, /Sending to server|Server received|Saved on this device/u);
  assert.doesNotMatch(sendingHtml, /submission-delivery-actions/u);
  assert.doesNotMatch(api.renderSessionCards(), /Sending to server|Server received|Saved on this device/u);

  resolveSubmission();
  await sending;
  assert.equal(storage.has(outboxKey), false);
  assert.equal(api.state.sessionId, 'session_new');
  assert.equal(api.state.turnId, 'turn_new');
  assert.equal(api.state.timeline[0]?.turnId, 'turn_new');
});

test('lost new-session response retries the same submission after reload', async () => {
  let firstSubmissionId = '';
  const first = await loadAppHarness({
    fetch: async (path, options = {}) => {
      assert.equal(path, '/api/session-submissions');
      firstSubmissionId = JSON.parse(options.body).submissionId;
      throw new Error('Failed to fetch');
    },
  });
  first.api.state.token = 'token';
  first.api.state.authSession = { id: 'auth_1' };
  first.api.state.view = 'chat';
  first.api.state.draftSessionActive = true;
  first.api.state.cwd = '/repo';
  first.api.state.prompt = 'Recover after reload';
  await first.api.onComposerSubmit({ preventDefault() {} });

  const storedOutbox = submissionStorageEntries(first.storage);
  assert.equal(storedOutbox.length, 1);
  const retryCalls = [];
  const second = await loadAppHarness({
    storage: Object.fromEntries(storedOutbox),
    fetch: async (path, options = {}) => {
      retryCalls.push({ path, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          submission: { id: firstSubmissionId, status: 'submitted', sessionId: 'session_recovered', turnId: 'turn_recovered', error: null },
          session: { id: 'session_recovered', cwd: '/repo', settings: {}, thread: { turns: [] } },
          turnId: 'turn_recovered',
        }),
      };
    },
  });
  second.api.state.token = 'token';
  second.api.state.authSession = { id: 'auth_2' };

  await second.api.drainSubmissionOutbox({ force: true });

  assert.equal(retryCalls.length, 1);
  assert.equal(retryCalls[0]?.path, '/api/session-submissions');
  assert.equal(retryCalls[0]?.body.submissionId, firstSubmissionId);
  assert.equal(submissionStorageEntries(second.storage).length, 0);
  assert.equal(second.api.state.sessions.some((session) => session.id === 'session_recovered'), true);
});

test('silently retrying new-session submissions remain visible and can be reopened', async () => {
  const { api } = await loadAppHarness({
    fetch: async () => {
      throw new Error('Network offline');
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.draftSessionActive = true;
  api.state.cwd = '/repo';
  api.state.prompt = 'Visible pending session';

  await api.onComposerSubmit({ preventDefault() {} });

  const [pending] = api.sortedSessions();
  assert.equal(pending?.localSubmission, true);
  assert.equal(pending?.deliveryState, 'failed');
  assert.match(api.renderSessionCards(), /Visible pending session/u);
  assert.doesNotMatch(api.renderSessionCards(), /Send failed|data-submission-retry-id/u);

  await api.selectSession(pending.id);
  assert.equal(api.state.activeSubmissionId, pending.submissionId);
  assert.equal(api.state.timeline[0]?.text, 'Visible pending session');
  assert.equal(api.state.status, 'Waiting to send');
  assert.doesNotMatch(api.renderTimelineItem(api.state.timeline[0]), /Retry send/u);
});

test('independent submission storage keys prevent stale tabs from overwriting each other', async () => {
  const sharedStorage = new Map();
  const first = await loadAppHarness({
    storage: sharedStorage,
    fetch: async () => { throw new Error('offline'); },
  });
  const second = await loadAppHarness({
    storage: sharedStorage,
    fetch: async () => { throw new Error('offline'); },
  });
  for (const [harness, prompt] of [[first, 'message from tab A'], [second, 'message from tab B']]) {
    harness.api.state.token = 'token';
    harness.api.state.authSession = { id: 'auth_1' };
    harness.api.state.view = 'chat';
    harness.api.state.draftSessionActive = true;
    harness.api.state.cwd = '/repo';
    harness.api.state.prompt = prompt;
    await harness.api.onComposerSubmit({ preventDefault() {} });
  }

  const stored = submissionStorageEntries(sharedStorage).map(([, value]) => JSON.parse(value).entry.text).sort();
  assert.deepEqual(stored, ['message from tab A', 'message from tab B']);
});

test('submission storage events synchronize another tab without replacing its entries', async () => {
  const { api, context } = await loadAppHarness();
  const entry = {
    id: 'submission_remote',
    ownerKey: 'single',
    text: 'saved in another tab',
    status: 'failed',
    sessionId: '',
    projectId: '',
    cwd: '/repo',
    settings: {},
    attachments: [],
    createdAt: 1,
    updatedAt: 2,
    attempts: 1,
    nextAttemptAt: 0,
    error: 'offline',
    retryable: true,
    queuedMessageId: '',
  };
  const key = api.submissionOutboxEntryStorageKey(entry.id);
  const value = JSON.stringify({ version: 1, entry });

  context.__dispatchWindowEvent('storage', { key, newValue: value });
  assert.equal(api.state.submissionOutbox.get(entry.id)?.text, 'saved in another tab');

  context.__dispatchWindowEvent('storage', { key, newValue: null });
  assert.equal(api.state.submissionOutbox.has(entry.id), false);
});

test('a full outbox rejects new messages without evicting saved submissions', async () => {
  const entries = Array.from({ length: 50 }, (_, index) => ({
    id: `submission_capacity_${index}`,
    ownerKey: 'single',
    text: `saved ${index}`,
    status: 'pending',
    sessionId: '',
    projectId: '',
    cwd: '/repo',
    settings: {},
    attachments: [],
    createdAt: index + 1,
    updatedAt: index + 1,
    attempts: 0,
    nextAttemptAt: 0,
    error: '',
    retryable: true,
    queuedMessageId: '',
  }));
  let fetchCount = 0;
  const { api, storage } = await loadAppHarness({
    storage: {
      codexWebSubmissionOutbox: JSON.stringify({ version: 1, entries }),
    },
    fetch: async () => {
      fetchCount += 1;
      throw new Error('unexpected fetch');
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.draftSessionActive = true;
  api.state.cwd = '/repo';
  api.state.prompt = 'do not evict another message';

  await api.onComposerSubmit({ preventDefault() {} });

  assert.equal(fetchCount, 0);
  assert.equal(api.state.submissionOutbox.size, 50);
  assert.equal(submissionStorageEntries(storage).length, 50);
  assert.match(api.state.error, /Too many messages/u);
});

test('submission persistence failures roll back memory and do not send', async () => {
  let fetchCount = 0;
  const { api, storage } = await loadAppHarness({
    onLocalStorageSetItem(key) {
      if (key.startsWith('codexWebSubmissionOutbox:')) {
        throw new Error('storage quota exceeded');
      }
    },
    fetch: async () => {
      fetchCount += 1;
      throw new Error('unexpected fetch');
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.draftSessionActive = true;
  api.state.cwd = '/repo';
  api.state.prompt = 'must remain unsent';

  await api.onComposerSubmit({ preventDefault() {} });

  assert.equal(fetchCount, 0);
  assert.equal(api.state.submissionOutbox.size, 0);
  assert.equal(submissionStorageEntries(storage).length, 0);
  assert.equal(api.state.prompt, 'must remain unsent');
  assert.match(api.state.error, /storage quota exceeded/u);
});

test('permanent submission conflicts are never automatically retried', async () => {
  let fetchCount = 0;
  const { api } = await loadAppHarness({
    fetch: async () => {
      fetchCount += 1;
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'submission_conflict', message: 'id was reused' }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.draftSessionActive = true;
  api.state.cwd = '/repo';
  api.state.prompt = 'conflicting payload';

  await api.onComposerSubmit({ preventDefault() {} });
  const [submission] = api.state.submissionOutbox.values();
  assert.equal(submission.retryable, false);

  await api.drainSubmissionOutbox({ force: true });
  assert.equal(fetchCount, 1);
});

test('turn conflicts remain retryable while other 409 responses do not', async () => {
  const { api } = await loadAppHarness({
    fetch: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'turn_conflict', message: 'turn already running' }),
    }),
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.prompt = 'retry after current turn';

  await api.onComposerSubmit({ preventDefault() {} });
  const [submission] = api.state.submissionOutbox.values();
  assert.equal(submission.retryable, true);
});

test('malformed successful responses retain the durable submission', async () => {
  const { api, storage } = await loadAppHarness({
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.draftSessionActive = true;
  api.state.cwd = '/repo';
  api.state.prompt = 'require an explicit acknowledgement';

  await api.onComposerSubmit({ preventDefault() {} });

  const [submission] = api.state.submissionOutbox.values();
  assert.equal(submission.status, 'failed');
  assert.equal(submission.retryable, true);
  assert.match(submission.error, /did not acknowledge/u);
  assert.equal(submissionStorageEntries(storage).length, 1);
});

test('submission requests time out and remain retryable', async () => {
  const timeoutHandle = {};
  const { api } = await loadAppHarness({
    setTimeout(callback, delay) {
      if (delay === 30_000) {
        queueMicrotask(callback);
        return timeoutHandle;
      }
      return setTimeout(callback, delay);
    },
    clearTimeout(handle) {
      if (handle !== timeoutHandle) {
        clearTimeout(handle);
      }
    },
    fetch: async (_path, options = {}) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.draftSessionActive = true;
  api.state.cwd = '/repo';
  api.state.prompt = 'timeout safely';

  await api.onComposerSubmit({ preventDefault() {} });

  const [submission] = api.state.submissionOutbox.values();
  assert.equal(api.SUBMISSION_REQUEST_TIMEOUT_MS, 30_000);
  assert.equal(submission.status, 'failed');
  assert.equal(submission.retryable, true);
  assert.match(submission.error, /acknowledgement timed out/u);
});

test('logout during delivery resets sending state for a later login', async () => {
  let submissionId = '';
  let requestCount = 0;
  const { api } = await loadAppHarness({
    fetch: async (_path, options = {}) => {
      requestCount += 1;
      submissionId = JSON.parse(options.body).submissionId;
      if (requestCount === 1) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          submission: { id: submissionId, status: 'submitted', sessionId: 'session_after_login', turnId: 'turn_after_login', error: null },
          session: { id: 'session_after_login', cwd: '/repo', settings: {}, thread: { turns: [] } },
          turnId: 'turn_after_login',
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.draftSessionActive = true;
  api.state.cwd = '/repo';
  api.state.prompt = 'survive logout';

  const sending = api.onComposerSubmit({ preventDefault() {} });
  await Promise.resolve();
  api.handleApiError({ status: 401, payload: { message: 'expired' } });
  await sending;

  assert.equal(api.state.submissionOutbox.get(submissionId)?.status, 'pending');
  api.state.token = 'replacement-token';
  api.state.authSession = { id: 'auth_2' };
  await api.drainSubmissionOutbox({ force: true });
  assert.equal(requestCount, 2);
  assert.equal(api.state.submissionOutbox.has(submissionId), false);
});

test('network failures during auth restore preserve the cached login and token', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/auth/me');
      throw new Error('network unavailable');
    },
  });
  const cachedAuth = { id: 'cached' };
  api.state.token = 'stored-token';
  api.state.authSession = cachedAuth;

  await api.restoreAuth();

  assert.equal(api.state.token, 'stored-token');
  assert.equal(api.state.authSession, cachedAuth);
  assert.equal(api.state.status, 'Offline');
  assert.match(api.state.error, /network unavailable/u);
});

test('new-session slash commands use the durable submission endpoint', async () => {
  const calls = [];
  const { api, storage } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      calls.push({ path, body: JSON.parse(options.body) });
      const submissionId = calls[0].body.submissionId;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          submission: { id: submissionId, status: 'submitted', sessionId: 'session_help', turnId: null, error: null },
          type: 'command',
          command: { name: 'help', action: 'show', message: 'Help text' },
          session: {
            id: 'session_help',
            cwd: '/repo',
            settings: {},
            timeline: [
              { id: 'help_user', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/help' },
              { id: 'help_result', kind: 'message', role: 'system', label: '/help', meta: 'show', text: 'Help text' },
            ],
            thread: { turns: [] },
          },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.draftSessionActive = true;
  api.state.cwd = '/repo';
  api.state.prompt = '/help';

  await api.onComposerSubmit({ preventDefault() {} });

  assert.equal(calls[0]?.path, '/api/session-submissions');
  assert.ok(calls[0]?.body.submissionId);
  assert.equal(api.state.sessionId, 'session_help');
  assert.equal(submissionStorageEntries(storage).length, 0);
});

test('timeline omits every empty message while retaining attachment-only messages', async () => {
  const { api } = await loadAppHarness();
  api.state.timeline = [
    { id: 'empty_user', kind: 'message', role: 'user', label: 'You', text: '   ' },
    { id: 'empty_assistant', kind: 'message', role: 'assistant', label: 'Assistant', text: '' },
    {
      id: 'attachment_user',
      kind: 'message',
      role: 'user',
      label: 'You',
      text: '',
      attachments: [{ kind: 'file', localPath: '/repo/file.txt', fileName: 'file.txt', mimeType: 'text/plain' }],
    },
  ];

  assert.deepEqual(api.visibleTimelineItems().map((item) => item.id), ['attachment_user']);
});

test('approval requests remain standalone actionable cards while work stays out of the timeline', async () => {
  const { api } = await loadAppHarness();

  let assistantEntry = null;
  assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_1',
    threadId: 'session_1',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_1',
    batchId: 'batch_read',
    kind: 'command',
    title: 'sed -n "1,80p" packages/codex-web/public/app.js',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.updated',
    turnId: 'turn_1',
    batchId: 'batch_read',
    summary: { output: 'const state = {}' },
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.completed',
    turnId: 'turn_1',
    batchId: 'batch_read',
    status: 'completed',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'approval.requested',
    turnId: 'turn_1',
    approvalId: 'approval_1',
    approvalKind: 'permission',
    summary: { command: 'npm install' },
  }, assistantEntry);

  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(api.state.batches.size, 1);
  assert.equal(api.state.timeline.some((item) => item.kind === 'batch'), false);
  assert.equal(api.state.timeline.filter((item) => item.kind === 'approval').length, 1);

  const approval = api.state.timeline.find((item) => item.kind === 'approval');
  assert.equal(approval.approvalId, 'approval_1');
  assert.equal(api.state.approvals.get('approval_1')?.resolved, false);
  const html = api.renderTimelineItem(approval);
  assert.match(html, /Approval requested/u);
  assert.match(html, /npm install/u);
  assert.match(html, /data-approval-action="accept"/u);
});

test('authorized work batches stay out of the timeline while details remain available in the dialog', async () => {
  const { api } = await loadAppHarness();
  api.state.authSession = { id: 'auth_single', principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = { id: 'session_inline', cwd: '/repo' };
  api.state.sessionId = 'session_inline';
  api.state.turnId = 'turn_inline';
  api.state.pendingTurn = true;

  api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_inline',
    itemId: 'commentary_before',
    eventType: 'completed',
    phase: 'commentary',
    text: 'I will run the focused test.',
    delta: '',
  }, null);
  api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_inline',
    batchId: 'batch_inline',
    kind: 'command',
    title: 'npm test -- --focused',
  }, null);
  api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_inline',
    itemId: 'commentary_after',
    eventType: 'completed',
    phase: 'commentary',
    text: 'The focused test passed.',
    delta: '',
  }, null);
  api.applyTurnEvent({
    type: 'batch.updated',
    turnId: 'turn_inline',
    batchId: 'batch_inline',
    summary: { output: '12 passed' },
  }, null);
  api.applyTurnEvent({
    type: 'assistant.final',
    turnId: 'turn_inline',
    itemId: 'final_inline',
    eventType: 'completed',
    text: 'Everything is green.',
    delta: '',
  }, null);

  assert.equal(
    JSON.stringify(api.state.timeline.map((item) => item.kind === 'message' ? item.text : item.id)),
    JSON.stringify([
      'I will run the focused test.',
      'The focused test passed.',
      'Everything is green.',
    ]),
  );
  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(api.renderTimelineItem({
    id: 'legacy_inline_work',
    kind: 'work',
    inline: true,
    turnId: 'turn_inline',
    batches: [...api.state.batches.values()],
  }), '');
  assert.equal(api.currentSessionWorkItems()[0]?.batches[0]?.summary?.output, '12 passed');
  const chatHtml = api.renderChat().innerHTML;
  assert.doesNotMatch(chatHtml, /inline-work-row|class="work-turn"/u);
  assert.match(chatHtml, /id="open-work-details-button"/u);
  api.state.workDetailsOpen = true;
  api.state.workDetailsTurnId = 'turn_inline';
  api.state.workDetailsVisibleEndIndex = 1;
  const detailsHtml = api.renderWorkDetailsDialog();
  assert.match(detailsHtml, /class="work-turn"/u);
  assert.match(detailsHtml, /npm test -- --focused/u);
  assert.match(detailsHtml, /12 passed/u);
});

test('assistant final messages stay at the bottom after hidden timeline work updates complete', async () => {
  const { api } = await loadAppHarness();

  let assistantEntry = null;
  assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_bottom',
    threadId: 'session_1',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_bottom',
    batchId: 'cmd_bottom',
    kind: 'command',
    title: 'npm test',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'assistant.final',
    turnId: 'turn_bottom',
    threadId: 'session_1',
    text: 'Final response',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.updated',
    turnId: 'turn_bottom',
    batchId: 'cmd_bottom',
    summary: { output: 'ok' },
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'turn.completed',
    turnId: 'turn_bottom',
    threadId: 'session_1',
    status: 'completed',
  }, assistantEntry);

  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(api.state.batches.size, 1);
  assert.equal(api.state.timeline.at(-1)?.id, 'assistant_turn_bottom_final');
  assert.equal(api.state.timeline.at(-1)?.kind, 'message');
  assert.match(api.renderTimelineItem(api.state.timeline.at(-1)), /Final response/u);
});

test('session status ignores stale in-progress history when activeTurnId is missing', async () => {
  const { api } = await loadAppHarness();
  const session = {
    id: 'session_restarted',
    activeTurnId: null,
    thread: {
      turns: [
        { id: 'turn_finished', status: 'completed', items: [] },
        { id: 'turn_running', status: 'inProgress', items: [] },
      ],
    },
  };
  api.state.sessionId = session.id;
  api.state.currentSession = session;
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  const result = api.syncRuntimeStatusFromSession(session);

  assert.equal(result.activeTurnId, null);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.composerStatusLabel(), 'Ready');
});

test('a stale terminal event cannot finish the current running turn', async () => {
  const { api } = await loadAppHarness();
  api.state.sessionId = 'session_1';
  api.state.turnId = 'turn_current';
  api.state.pendingTurn = true;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  api.applyTurnEvent({
    type: 'turn.completed',
    turnId: 'turn_stale',
    threadId: 'session_1',
    status: 'completed',
  }, null);

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_current');
  assert.equal(api.state.status, 'Turn running');
});

test('turn started events make the runtime state internally consistent', async () => {
  const { api } = await loadAppHarness();
  api.state.sessionId = 'session_started';
  api.state.currentSession = { id: 'session_started', cwd: '/repo' };
  api.state.pendingTurn = false;
  api.state.turnId = null;
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_started',
    threadId: 'session_started',
  }, null);

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_started');
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.state.statusTone, 'warn');
  assert.equal(api.composerStatusLabel(), 'Working');
});

test('mobile UI persists per-browser chat timelines across reloads', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /TIMELINE_CACHE_KEY/u);
  assert.match(app, /timelineCache:\s*loadTimelineCache\(\)/u);
  assert.match(app, /function loadTimelineCache\(\)/u);
  assert.match(app, /function persistTimelineCache\(\)/u);
  assert.match(app, /localStorage\.getItem\(TIMELINE_CACHE_KEY\)/u);
  assert.match(app, /localStorage\.setItem\(TIMELINE_CACHE_KEY/u);
  assert.match(app, /MAX_TIMELINE_CACHE_SESSIONS/u);
  assert.match(app, /savedAt:\s*Date\.now\(\)/u);
});

test('v2 timeline cache migration removes inline and aggregate work while retaining dialog batches', async () => {
  const legacyCache = {
    version: 2,
    entries: [{
      sessionId: 'session_cache_duplicate',
      savedAt: 10,
      timeline: [
        { id: 'history_turn_cache_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text: 'One final answer' },
        { id: 'assistant_turn_cache_final', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text: 'One final answer' },
        {
          id: 'work_turn_inline_batch_inline',
          kind: 'work',
          inline: true,
          turnId: 'turn_inline',
          batches: [{ batchId: 'batch_inline', turnId: 'turn_inline', batchKind: 'command', title: 'inline command', status: 'completed', summary: {} }],
        },
        {
          id: 'work_turn_aggregate',
          kind: 'work',
          turnId: 'turn_aggregate',
          batches: [{ batchId: 'batch_aggregate', turnId: 'turn_aggregate', batchKind: 'command', title: 'aggregate command', status: 'completed', summary: {} }],
        },
      ],
      history: [
        { id: 'history_turn_cache_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text: 'One final answer' },
        {
          id: 'work_turn_aggregate',
          kind: 'work',
          turnId: 'turn_aggregate',
          batches: [{ batchId: 'batch_aggregate', turnId: 'turn_aggregate', batchKind: 'command', title: 'aggregate command', status: 'completed', summary: {} }],
        },
      ],
      historyComplete: true,
      batches: [
        ['batch_inline', { id: 'batch_batch_inline', kind: 'batch', batchId: 'batch_inline', turnId: 'turn_inline', batchKind: 'command', title: 'inline command', status: 'completed', summary: {} }],
        ['batch_aggregate', { id: 'batch_batch_aggregate', kind: 'batch', batchId: 'batch_aggregate', turnId: 'turn_aggregate', batchKind: 'command', title: 'aggregate command', status: 'completed', summary: {} }],
      ],
      approvals: [],
    }],
  };
  const { api, storage } = await loadAppHarness({
    storage: {
      codexWebToken: 'cached-device-token',
      codexWebTimelineCache: JSON.stringify(legacyCache),
    },
    fetch: () => new Promise(() => {}),
  });

  const migrated = api.state.timelineCache.get('session_cache_duplicate');
  assert.equal(migrated?.timeline.length, 1);
  assert.equal(migrated?.timeline[0]?.id, 'assistant_turn_cache_final');
  assert.equal(migrated?.history.length, 1);
  assert.equal(migrated?.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(migrated?.history.some((item) => item.kind === 'work'), false);
  assert.equal(migrated?.batches.size, 2);
  const persisted = JSON.parse(storage.get('codexWebTimelineCache'));
  assert.equal(persisted.version, 3);
  assert.equal(persisted.entries[0]?.timeline.length, 1);
  assert.equal(persisted.entries[0]?.history.length, 1);
  assert.equal(persisted.entries[0]?.batches.length, 2);
  assert.equal(JSON.stringify(persisted.entries[0]).includes('"kind":"work"'), false);

  api.state.authSession = { principal: { mode: 'single', isAdmin: true } };
  api.state.currentSession = { id: 'session_cache_duplicate', cwd: '/repo' };
  api.state.sessionId = 'session_cache_duplicate';
  api.restoreTimelineForSession(api.state.currentSession);
  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.doesNotMatch(api.renderChat().innerHTML, /inline-work-row|class="work-turn"/u);
  api.state.workDetailsOpen = true;
  api.state.workDetailsTurnId = 'turn_aggregate';
  api.state.workDetailsVisibleEndIndex = 1;
  const detailsHtml = api.renderWorkDetailsDialog();
  assert.match(detailsHtml, /class="work-turn"/u);
  assert.match(detailsHtml, /aggregate command/u);
});

test('authoritative timeline merges keep approvals and real failures but discard work projections', async () => {
  const { api } = await loadAppHarness();
  const merged = api.mergeAuthoritativeTimelineAuxiliaryEntries(
    [{ id: 'message_1', kind: 'message', role: 'user', text: 'Authoritative question' }],
    [
      { id: 'message_1', kind: 'message', role: 'user', text: 'Authoritative question' },
      { id: 'work_1', kind: 'work', turnId: 'turn_1', batches: [] },
      { id: 'approval_1', kind: 'approval', approvalId: 'approval_1', turnId: 'turn_1' },
      { id: 'error_turn_1', kind: 'message', role: 'system', label: 'Error', meta: 'failed', severity: 'error', text: '503 Service Unavailable' },
      { id: 'error_interrupt', kind: 'message', role: 'system', label: 'Error', meta: 'failed', severity: 'error', text: 'Timed out waiting for Codex JSON-RPC response to turn/interrupt' },
    ],
  );

  assert.equal(merged.some((item) => item.kind === 'work'), false);
  assert.equal(merged.some((item) => item.kind === 'approval'), true);
  assert.equal(merged.some((item) => item.id === 'message_1'), true);
  assert.equal(merged.at(-1)?.id, 'error_turn_1');
  assert.equal(merged.filter((item) => item.id === 'message_1').length, 1);
  assert.equal(merged.some((item) => item.id === 'error_interrupt'), false);
});

test('mobile UI refreshes session metadata after turn completion', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /async function refreshCurrentSessionMetadata\(/u);
  assert.match(app, /function optimisticallyUpdateSessionInput\(text\)/u);
  assert.match(app, /optimisticallyUpdateSessionInput\(promptToSend\)/u);
  assert.match(app, /case 'turn\.completed':[\s\S]*void refreshCurrentSessionMetadata\(\);/u);
  assert.match(app, /const sessionId = state\.sessionId;[\s\S]*loadSessionOpenData\(state\.currentSession \|\| \{ id: sessionId \}/u);
});

test('session cards prefer the latest user input for orientation', async () => {
  const { api } = await loadAppHarness();

  const session = {
    id: 'session_1',
    cwd: '/Users/alice/project',
    firstUserInput: 'Original setup question',
    lastUserInput: 'Latest debugging question',
    updatedAt: 1,
    lastInputAt: 2,
  };

  assert.equal(api.previewInputForSession(session), 'Latest debugging question');
  assert.equal(api.firstInputForSession(session), 'Original setup question');
});

test('stale session detail cannot replace a newer optimistic list preview', async () => {
  const { api } = await loadAppHarness();
  api.state.sessions = [{
    id: 'session_preview',
    cwd: '/repo',
    firstUserInput: 'Original question',
    lastUserInput: 'Optimistic latest question',
    lastInputAt: 200,
    updatedAt: 200,
    settings: { metadata: {} },
  }];
  api.state.sessionsByScope.all = [...api.state.sessions];

  api.upsertSession({
    id: 'session_preview',
    cwd: '/repo',
    firstUserInput: 'Original question',
    lastUserInput: 'Older backend question',
    lastInputAt: 100,
    updatedAt: 100,
    settings: { metadata: {} },
  });

  assert.equal(api.state.sessions[0]?.lastUserInput, 'Optimistic latest question');
  assert.equal(api.state.sessions[0]?.lastInputAt, 200);
});

test('stale session refresh failures do not clear the active session after switching', async () => {
  let releaseFetch;
  const fetchReady = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  const { api } = await loadAppHarness({
    fetch: async () => {
      await fetchReady;
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'session_not_found', message: 'session not found' }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [
    { id: 'old_session', cwd: '/repo/old' },
    { id: 'new_session', cwd: '/repo/new' },
  ];
  api.state.sessionId = 'old_session';
  api.state.currentSession = api.state.sessions[0];

  const refresh = api.refreshCurrentSessionMetadata();
  api.state.sessionId = 'new_session';
  api.state.currentSession = api.state.sessions[1];
  releaseFetch();
  await refresh;

  assert.equal(api.state.sessionId, 'new_session');
  assert.equal(api.state.currentSession?.id, 'new_session');
  assert.deepEqual(api.state.sessions.map((session) => session.id), ['new_session']);
});

test('timeline cache bounds persisted batches and approvals', async () => {
  const { api, storage } = await loadAppHarness();

  api.state.sessionId = 'session_1';
  api.state.timeline = [];
  api.state.batches = new Map(Array.from({ length: 40 }, (_, index) => [
    `batch_${index}`,
    {
      id: `batch_${index}`,
      kind: 'batch',
      batchId: `batch_${index}`,
      summary: { output: 'x'.repeat(20000) },
    },
  ]));
  api.state.approvals = new Map(Array.from({ length: 40 }, (_, index) => [
    `approval_${index}`,
    {
      id: `approval_${index}`,
      kind: 'approval',
      approvalId: `approval_${index}`,
      summary: { command: 'y'.repeat(20000) },
    },
  ]));

  api.saveCurrentTimeline();

  const persisted = JSON.parse(storage.get('codexWebTimelineCache'));
  const entry = persisted.entries[0];
  assert.ok(entry.batches.length <= api.MAX_TIMELINE_CACHE_MAP_ITEMS);
  assert.ok(entry.approvals.length <= api.MAX_TIMELINE_CACHE_MAP_ITEMS);
  assert.ok(entry.batches.every(([, item]) => item.summary.output.length <= api.MAX_TIMELINE_SUMMARY_TEXT));
  assert.ok(entry.approvals.every(([, item]) => item.summary.command.length <= api.MAX_TIMELINE_SUMMARY_TEXT));
});

test('timeline cache keeps only the five most recently saved sessions', async () => {
  const entries = [2, 7, 1, 6, 3, 5, 4].map((savedAt) => ({
    sessionId: `session_${savedAt}`,
    savedAt,
    validatedAt: 0,
    sessionUpdatedAt: savedAt,
    timeline: [{
      id: `message_${savedAt}`,
      kind: 'message',
      role: 'user',
      label: 'You',
      text: `Question ${savedAt}`,
    }],
    batches: [],
    approvals: [],
  }));
  const { api, storage } = await loadAppHarness({
    storage: {
      codexWebToken: 'cached-device-token',
      codexWebTimelineCache: JSON.stringify({ entries }),
    },
    fetch: () => new Promise(() => {}),
  });

  assert.equal(api.MAX_TIMELINE_CACHE_SESSIONS, 5);
  assert.equal(
    JSON.stringify([...api.state.timelineCache.keys()]),
    JSON.stringify(['session_7', 'session_6', 'session_5', 'session_4', 'session_3']),
  );

  api.state.sessionId = 'session_8';
  api.state.timeline = [{ id: 'message_8', kind: 'message', role: 'user', label: 'You', text: 'Question 8' }];
  api.state.batches = new Map();
  api.state.approvals = new Map();
  api.saveCurrentTimeline();

  const persisted = JSON.parse(storage.get('codexWebTimelineCache'));
  assert.equal(persisted.entries.length, 5);
  assert.equal(
    JSON.stringify(persisted.entries.map((entry) => entry.sessionId)),
    JSON.stringify(['session_8', 'session_7', 'session_6', 'session_5', 'session_4']),
  );
});

test('timeline cache persists complete history for offline scroll expansion', async () => {
  const { api, storage } = await loadAppHarness();
  const session = {
    id: 'session_history_cache',
    cwd: '/repo',
    settings: { metadata: {} },
    thread: {
      turns: [
        {
          id: 'turn_old',
          items: [
            { type: 'message', role: 'user', text: 'Old cached question' },
            { type: 'message', role: 'assistant', text: 'Old cached answer' },
          ],
        },
        {
          id: 'turn_recent',
          items: [
            { type: 'message', role: 'user', text: 'Recent cached question' },
            { type: 'message', role: 'assistant', text: 'Recent cached answer' },
          ],
        },
        {
          id: 'turn_latest',
          items: [
            { type: 'message', role: 'user', text: 'Latest cached question' },
            { type: 'message', role: 'assistant', text: 'Latest cached answer' },
          ],
        },
      ],
    },
  };
  api.state.sessionId = session.id;
  api.state.currentSession = session;
  api.restoreTimelineForSession(session);
  api.saveCurrentTimeline();

  const persisted = JSON.parse(storage.get('codexWebTimelineCache'));
  assert.equal(persisted.entries[0]?.historyComplete, true);
  assert.equal(persisted.entries[0]?.history.length, 6);

  api.state.currentSession = { id: session.id, cwd: '/repo', settings: { metadata: {} } };
  api.state.view = 'chat';
  api.state.sessionHistoryItems = [];
  api.state.sessionHistoryStartIndex = 0;
  api.state.timeline = [];
  api.restoreTimelineForSession(api.state.currentSession);

  assert.equal(api.state.sessionHistoryItems.length, 6);
  assert.equal(api.showMoreSessionHistory(), true);
  assert.equal(api.state.timeline[0]?.text, 'Old cached question');
});

test('history hydration includes recent assistant app-server messages', async () => {
  const { api } = await loadAppHarness();

  const timeline = api.hydrateTimelineFromSession({
    id: 'session_history',
    firstUserInput: 'Preview only',
    thread: {
      turns: [
        {
          id: 'turn_1',
          items: [
            { type: 'message', role: 'user', text: 'First user question' },
            { type: 'agentMessage', role: null, text: 'First assistant answer' },
          ],
        },
        {
          id: 'turn_2',
          items: [
            { type: 'message', role: 'user', text: 'Second user question' },
            { type: 'assistantMessage', role: null, text: 'Second assistant answer' },
          ],
        },
        {
          id: 'turn_3',
          items: [
            { type: 'message', role: 'user', text: 'Third user question' },
            { type: 'message', role: 'assistant', text: 'Third assistant answer (part 1)' },
            { type: 'agentMessage', role: null, text: 'Third assistant answer (part 2)' },
          ],
        },
        {
          id: 'turn_4',
          items: [
            { type: 'message', role: 'user', text: 'Newest user question' },
            { type: 'message', role: 'assistant', text: 'Third assistant answer' },
          ],
        },
      ],
    },
  });

  assert.equal(
    JSON.stringify(timeline.map((item) => [item.role, item.text])),
    JSON.stringify([
      ['user', 'Third user question'],
      ['assistant', 'Third assistant answer (part 1)'],
      ['assistant', 'Third assistant answer (part 2)'],
      ['user', 'Newest user question'],
      ['assistant', 'Third assistant answer'],
    ]),
  );
});

test('history hydration restores reasoning summaries as separate safe assistant blocks', async () => {
  const { api } = await loadAppHarness();

  const timeline = api.hydrateTimelineFromSession({
    id: 'session_reasoning_history',
    thread: {
      turns: [{
        id: 'turn_reasoning_history',
        status: 'completed',
        items: [
          { id: 'user_reasoning', type: 'message', role: 'user', text: 'Check both paths' },
          { id: 'reasoning_summary', type: 'reasoning', role: null, text: 'Compared both implementations.' },
          { id: 'final_reasoning', type: 'agentMessage', role: 'assistant', phase: 'final_answer', text: 'Both paths are covered.' },
        ],
      }],
    },
  });

  assert.equal(
    JSON.stringify(timeline.map((item) => [item.itemId || '', item.meta, item.text])),
    JSON.stringify([
      ['user_reasoning', 'history', 'Check both paths'],
      ['reasoning_summary', 'reasoning-summary', 'Compared both implementations.'],
      ['final_reasoning', 'final', 'Both paths are covered.'],
    ]),
  );
});

test('history hydration prefers backend-managed session timeline entries', async () => {
  const { api } = await loadAppHarness();

  const timeline = api.hydrateTimelineFromSession({
    id: 'session_timeline_backend',
    timeline: [
      { id: 'history_1', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Earlier question' },
      { id: 'history_2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', phase: 'final_answer', text: 'Earlier answer' },
      { id: 'cmd_user_1', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/goal resume' },
      { id: 'cmd_system_1', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
    ],
    thread: {
      turns: [
        {
          id: 'turn_ignored',
          items: [
            { type: 'message', role: 'user', text: 'Stale question' },
            { type: 'message', role: 'assistant', text: 'Stale answer' },
          ],
        },
      ],
    },
  });

  assert.equal(
    JSON.stringify(timeline.map((item) => [item.role, item.text])),
    JSON.stringify([
      ['user', 'Earlier question'],
      ['assistant', 'Earlier answer'],
      ['user', '/goal resume'],
      ['system', 'Goal resumed: ship slash goal support'],
    ]),
  );
  assert.equal(timeline.find((item) => item.id === 'history_2')?.phase, 'final_answer');
});

test('history hydration falls back to the full available conversation when fewer than two answered turns exist', async () => {
  const { api } = await loadAppHarness();

  const timeline = api.hydrateTimelineFromSession({
    id: 'session_short_history',
    firstUserInput: 'Preview only',
    thread: {
      turns: [
        {
          id: 'turn_1',
          items: [
            { type: 'message', role: 'user', text: 'Only user question' },
            { type: 'agentMessage', role: null, text: 'Only assistant answer' },
          ],
        },
        {
          id: 'turn_2',
          items: [
            { type: 'agentMessage', role: null, text: 'Follow-up assistant note' },
          ],
        },
      ],
    },
  });

  assert.equal(
    JSON.stringify(timeline.map((item) => [item.role, item.text])),
    JSON.stringify([
      ['user', 'Only user question'],
      ['assistant', 'Only assistant answer'],
      ['assistant', 'Follow-up assistant note'],
    ]),
  );
});

test('history hydration includes failed turns as durable error messages', async () => {
  const { api } = await loadAppHarness();

  const timeline = api.hydrateTimelineFromSession({
    id: 'session_failed_history',
    thread: {
      turns: [
        {
          id: 'turn_403',
          status: 'failed',
          error: 'unexpected status 403 Forbidden: invalid credentials',
          items: [
            { type: 'message', role: 'user', text: 'Trigger auth failure' },
          ],
        },
      ],
    },
  });

  assert.equal(JSON.stringify(timeline.map((item) => [item.id, item.role, item.text])), JSON.stringify([
    ['history_turn_403_0', 'user', 'Trigger auth failure'],
    ['error_turn_403', 'system', 'unexpected status 403 Forbidden: invalid credentials'],
  ]));
  const errorItem = timeline.find((item) => item.id === 'error_turn_403');
  assert.equal(errorItem?.severity, 'error');
  assert.equal(errorItem?.label, 'Error');
  assert.match(api.renderTimelineItem(errorItem), /message-card system error-message/u);
});

test('session refresh keeps historical failed turn messages when later turns succeed', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_mixed') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_mixed',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_403',
                    status: 'failed',
                    error: 'unexpected status 403 Forbidden',
                    items: [
                      { type: 'message', role: 'user', text: 'Bad key attempt' },
                    ],
                  },
                  {
                    id: 'turn_recovered',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Continue after fixing key' },
                      { type: 'message', role: 'assistant', text: 'Recovered answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_mixed';
  api.state.currentSession = { id: 'session_mixed', cwd: '/repo' };
  api.state.timeline = [
    { id: 'history_turn_403_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Bad key attempt' },
    { id: 'error_turn_403', kind: 'message', role: 'system', severity: 'error', label: 'Error', meta: 'failed', text: 'unexpected status 403 Forbidden' },
  ];

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_403');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /403 Forbidden/u);
  assert.match(api.state.timeline.map((item) => item.text).join('\n'), /Recovered answer/u);
  assert.equal(api.state.error, '');
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);
});

test('session refresh preserves backend goal and error messages that are not present in thread history', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_goal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Original question' },
                { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Original answer' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
                { id: 'error_turn_stale', kind: 'message', role: 'system', severity: 'error', label: 'Error', meta: 'failed', text: 'Load failed' },
              ],
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Original question' },
                      { type: 'message', role: 'assistant', text: 'Original answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Original answer/u);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Goal resumed: ship slash goal support/u);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Load failed/u);
});

test('session refresh preserves backend goal and error messages when hydrated history adds missing assistant replies', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_goal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Original question' },
                { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Original answer' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
                { id: 'error_turn_stale', kind: 'message', role: 'system', severity: 'error', label: 'Error', meta: 'failed', text: 'Load failed' },
              ],
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Original question' },
                      { type: 'message', role: 'assistant', text: 'Original answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Original answer/u);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Goal resumed: ship slash goal support/u);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Load failed/u);
});

test('session refresh keeps backend goal and error messages in place instead of pinning them to the bottom', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_goal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Earlier question' },
                { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Earlier answer' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
                { id: 'error_turn_stale', kind: 'message', role: 'system', severity: 'error', label: 'Error', meta: 'failed', text: 'Load failed' },
                { id: 'history_turn_2_2', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Later question' },
                { id: 'history_turn_2_3', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Later answer' },
              ],
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Earlier question' },
                      { type: 'message', role: 'assistant', text: 'Earlier answer' },
                    ],
                  },
                  {
                    id: 'turn_2',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Later question' },
                      { type: 'message', role: 'assistant', text: 'Later answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Earlier question',
    'Earlier answer',
    'Goal resumed: ship slash goal support',
    'Load failed',
    'Later question',
    'Later answer',
  ]));
});

test('session refresh preserves backend slash commands before goal resumed system messages', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_goal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Earlier question' },
                { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Earlier answer' },
                { id: 'local_user_goal_resume', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: '/goal resume' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
              ],
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Earlier question' },
                      { type: 'message', role: 'assistant', text: 'Earlier answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Earlier question',
    'Earlier answer',
    '/goal resume',
    'Goal resumed: ship slash goal support',
  ]));
});

test('expanding session history uses backend help and goal messages in the visible timeline', async () => {
  const { api } = await loadAppHarness();
  const session = {
    id: 'session_history_expand_with_commands',
    firstUserInput: 'Preview only',
    thread: {
      turns: [
        {
          id: 'turn_1',
          items: [
            { type: 'message', role: 'user', text: 'First user question' },
            { type: 'message', role: 'assistant', text: 'First assistant answer' },
          ],
        },
        {
          id: 'turn_2',
          items: [
            { type: 'message', role: 'user', text: 'Second user question' },
            { type: 'message', role: 'assistant', text: 'Second assistant answer' },
          ],
        },
        {
          id: 'turn_3',
          items: [
            { type: 'message', role: 'user', text: 'Third user question' },
            { type: 'message', role: 'assistant', text: 'Third assistant answer' },
          ],
        },
        {
          id: 'turn_4',
          items: [
            { type: 'message', role: 'user', text: 'Newest user question' },
            { type: 'message', role: 'assistant', text: 'Newest assistant answer' },
          ],
        },
      ],
    },
  };

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = session.id;
  api.state.currentSession = session;
  api.restoreTimelineForSession(session);
  api.state.timeline = [
    { id: 'history_turn_2_2', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Second user question' },
    { id: 'history_turn_2_3', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Second assistant answer' },
    { id: 'history_turn_3_4', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Third user question' },
    { id: 'history_turn_3_5', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Third assistant answer' },
    { id: 'history_turn_4_6', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Newest user question' },
    { id: 'history_turn_4_7', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Newest assistant answer' },
  ];

  assert.equal(api.showMoreSessionHistory(), true);
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Second user question',
    'Second assistant answer',
    'Third user question',
    'Third assistant answer',
    'Newest user question',
    'Newest assistant answer',
  ]));

  assert.equal(api.showMoreSessionHistory(), true);
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'First user question',
    'First assistant answer',
    'Second user question',
    'Second assistant answer',
    'Third user question',
    'Third assistant answer',
    'Newest user question',
    'Newest assistant answer',
  ]));
});

test('expanding session history uses backend slash commands before goal resumed system messages', async () => {
  const { api } = await loadAppHarness();
  const session = {
    id: 'session_history_expand_with_goal_resume_command',
    firstUserInput: 'Preview only',
    thread: {
      turns: [
        {
          id: 'turn_1',
          items: [
            { type: 'message', role: 'user', text: 'First user question' },
            { type: 'message', role: 'assistant', text: 'First assistant answer' },
          ],
        },
        {
          id: 'turn_2',
          items: [
            { type: 'message', role: 'user', text: 'Second user question' },
            { type: 'message', role: 'assistant', text: 'Second assistant answer' },
          ],
        },
        {
          id: 'turn_3',
          items: [
            { type: 'message', role: 'user', text: 'Third user question' },
            { type: 'message', role: 'assistant', text: 'Third assistant answer' },
          ],
        },
      ],
    },
  };

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = session.id;
  api.state.currentSession = session;
  api.restoreTimelineForSession(session);
  api.state.timeline = [
    { id: 'history_turn_2_2', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Second user question' },
    { id: 'history_turn_2_3', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Second assistant answer' },
    { id: 'history_turn_3_4', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Third user question' },
    { id: 'history_turn_3_5', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Third assistant answer' },
  ];

  assert.equal(api.showMoreSessionHistory(), true);
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'First user question',
    'First assistant answer',
    'Second user question',
    'Second assistant answer',
    'Third user question',
    'Third assistant answer',
  ]));
});

test('session history defaults to two recent exchanges and expands older history on demand', async () => {
  const { api } = await loadAppHarness();
  const session = {
    id: 'session_history_expand',
    firstUserInput: 'Preview only',
    thread: {
      turns: [
        {
          id: 'turn_1',
          items: [
            { type: 'message', role: 'user', text: 'First user question' },
            { type: 'message', role: 'assistant', text: 'First assistant answer' },
          ],
        },
        {
          id: 'turn_2',
          items: [
            { type: 'message', role: 'user', text: 'Second user question' },
            { type: 'message', role: 'assistant', text: 'Second assistant answer' },
          ],
        },
        {
          id: 'turn_3',
          items: [
            { type: 'message', role: 'user', text: 'Third user question' },
            { type: 'message', role: 'assistant', text: 'Third assistant answer' },
          ],
        },
        {
          id: 'turn_4',
          items: [
            { type: 'message', role: 'user', text: 'Newest user question' },
            { type: 'message', role: 'assistant', text: 'Newest assistant answer' },
          ],
        },
      ],
    },
  };

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = session.id;
  api.state.currentSession = session;
  api.restoreTimelineForSession(session);

  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Third user question',
    'Third assistant answer',
    'Newest user question',
    'Newest assistant answer',
  ]));
  assert.equal(api.state.sessionHistoryItems.length, 8);

  assert.equal(api.showMoreSessionHistory(), true);
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Second user question',
    'Second assistant answer',
    'Third user question',
    'Third assistant answer',
    'Newest user question',
    'Newest assistant answer',
  ]));

  assert.equal(api.showMoreSessionHistory(), true);
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'First user question',
    'First assistant answer',
    'Second user question',
    'Second assistant answer',
    'Third user question',
    'Third assistant answer',
    'Newest user question',
    'Newest assistant answer',
  ]));
  assert.equal(api.showMoreSessionHistory(), false);
});

test('session list defaults to recents and supports favorites plus session actions', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /sortMode:\s*'time'/u);
  assert.match(app, /sessionsScope:\s*'all'/u);
  assert.match(app, /id="open-new-session-button"/u);
  assert.match(app, /id="open-app-settings-button"/u);
  assert.doesNotMatch(app, /id="rail-open-new-session-button"/u);
  assert.doesNotMatch(app, /sessionSearchQuery/u);
  assert.doesNotMatch(app, /renderSessionSearchField/u);
  assert.doesNotMatch(app, /id="session-search-input"/u);
  assert.match(app, /data-sort-mode="favorites"/u);
  assert.match(app, /data-sort-mode="time"/u);
  assert.match(app, /data-sort-mode="archived"/u);
  assert.match(app, /class="archive-sort-button"/u);
  assert.match(app, /aria-label="Archived sessions"/u);
  assert.match(app, /class="archive-sort-icon"/u);
  assert.match(app, /<span class="visually-hidden">Archived<\/span>/u);
  assert.doesNotMatch(app, /data-sort-mode="archived"[^>]*>Archived<\/button>/u);
  assert.match(app, /data-sort-mode="time"[^>]*>Recents<\/button>/u);
  assert.doesNotMatch(app, />Time<\/button>/u);
  assert.doesNotMatch(app, /data-sort-mode="project"/u);
  assert.doesNotMatch(app, /renderProjectFilter\(\)/u);
  assert.doesNotMatch(app, /data-project-filter/u);
  assert.match(app, /function filteredSessions\(\)/u);
  assert.match(app, /function isFavoriteSession\(session\)/u);
  assert.match(app, /data-session-favorite-id/u);
  assert.match(app, /data-session-archive-request-id/u);
  assert.doesNotMatch(app, /favoriteSortMode/u);
  assert.doesNotMatch(app, /favoriteSortDraft/u);
  assert.doesNotMatch(app, /favorite-sort-button/u);
  assert.doesNotMatch(app, /favorite-sort-save-button/u);
  assert.doesNotMatch(app, /favorite-sort-cancel-button/u);
  assert.doesNotMatch(app, /data-session-favorite-move-id/u);
  assert.doesNotMatch(app, /function enterFavoriteSortMode\(\)/u);
  assert.doesNotMatch(app, /function saveFavoriteSortOrder\(\)/u);
  assert.doesNotMatch(app, /function cancelFavoriteSortMode\(\)/u);
  assert.match(app, /function toggleSessionFavorite\(sessionId\)/u);
  assert.match(app, /async function archiveSession\(sessionId\)/u);
  assert.match(app, /apiFetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/archive`,\s*\{\s*method:\s*'POST'/su);
});

test('mobile session filters keep archive as a compact accessible icon', async () => {
  const [styles, { api }] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    loadAppHarness(),
  ]);

  const html = api.renderSessionList().innerHTML;

  assert.match(html, /class="toggle sort-toggle mobile-session-sort-toggle"/u);
  assert.match(html, /data-sort-mode="favorites"[\s\S]*data-sort-mode="time"[\s\S]*data-sort-mode="archived"/u);
  assert.match(html, /data-sort-mode="favorites"[^>]*>Favorites<\/button>/u);
  assert.match(html, /data-sort-mode="time"[^>]*>Recents<\/button>/u);
  assert.match(html, /class="archive-sort-button"[^>]*data-sort-mode="archived"[^>]*aria-label="Archived sessions"/u);
  assert.match(html, /class="archive-sort-icon"/u);
  assert.match(html, /<span class="visually-hidden">Archived<\/span>/u);
  assert.match(styles, /\.sort-toggle\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)\s+34px;/su);
  assert.match(styles, /\.mobile-session-actions\s*\{[^}]*flex:\s*1 1 0;/su);
  assert.match(styles, /\.mobile-session-sort-toggle\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)\s+44px;/su);
  assert.match(styles, /\.toggle \.archive-sort-button\s*\{[^}]*padding:\s*0;/su);
  assert.match(styles, /\.archive-sort-icon\s*\{[^}]*width:\s*17px;/su);
  assert.match(styles, /\.toggle\.mobile-session-sort-toggle button\s*\{[^}]*min-width:\s*0;/su);
});

test('archived session cards use a clear restore icon instead of a font glyph', async () => {
  const { api } = await loadAppHarness();
  api.state.sortMode = 'archived';
  api.state.sessions = [{
    id: 'session_archived',
    archived: true,
    readOnly: true,
    firstUserInput: 'Archived work',
    updatedAt: 1,
    settings: { metadata: {} },
  }];

  const html = api.renderSessionCards();

  assert.match(html, /data-session-unarchive-id="session_archived"[^>]*aria-label="Unarchive"/u);
  assert.match(html, /class="session-action-icon session-action-icon-stroke"/u);
  assert.doesNotMatch(html, /&#8638;|↾/u);
});

test('selecting cached archived sessions still rerenders the session list', async () => {
  const { api } = await loadAppHarness();

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sortMode = 'time';
  api.state.sessions = [{ id: 'session_active', updatedAt: 2, settings: { metadata: {} } }];
  api.state.sessionsByScope.archived = [
    { id: 'session_archived', archived: true, readOnly: true, updatedAt: 1, settings: { metadata: {} } },
  ];
  api.state.sessionsLoadedByScope.archived = true;
  api.render();

  await api.setSessionSortMode('archived');

  const html = api.context.document.querySelector('#app').innerHTML;
  assert.equal(api.state.sortMode, 'archived');
  assert.match(html, /data-session-id="session_archived"/u);
  assert.doesNotMatch(html, /data-session-id="session_active"/u);
});

test('clicking the archived filter switches to archived sessions', async () => {
  const fetchCalls = [];
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions?state=archived') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'session_archived', updatedAt: 1, settings: { metadata: {} } },
            ],
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.render();

  const archiveButton = context.document.querySelector('[data-sort-mode="archived"]');
  assert.ok(archiveButton);
  archiveButton.click();
  await flushMicrotasks();

  assert.deepEqual(fetchCalls, ['/api/sessions?state=archived']);
  assert.equal(api.state.sortMode, 'archived');
  assert.match(context.document.querySelector('#app').innerHTML, /data-session-id="session_archived"/u);
});

test('opening a read-only session from the session list starts at the earliest message', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_archived') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_archived',
              archived: true,
              readOnly: true,
              settings: { metadata: {} },
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'First archived question' },
                { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'First archived answer' },
                { id: 'm3', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Latest archived question' },
                { id: 'm4', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Latest archived answer' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [{ id: 'session_archived', archived: true, readOnly: true, updatedAt: 1, settings: { metadata: {} } }];

  await api.selectSession('session_archived');

  const timeline = context.document.querySelector('#timeline');
  assert.equal(timeline.scrollTop, 0);
  assert.equal(api.state.sessionHistoryStartIndex, 0);
  assert.match(api.renderChat().innerHTML, /First archived question/u);
});

test('layout mode uses desktop workspace only on sufficiently wide pointer-based windows', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1280, viewportHeight: 844, desktopPointer: true });

  assert.equal(api.DESKTOP_WORKSPACE_MIN_WIDTH, 1280);
  assert.equal(api.hasDesktopPointer(), true);
  assert.equal(api.isDesktopLayout(), true);

  context.window.innerWidth = 1279;
  assert.equal(api.isDesktopLayout(), false);

  context.window.innerWidth = 1440;
  context.window.innerHeight = 1920;
  assert.equal(api.hasDesktopPointer(), true);
  assert.equal(api.isDesktopLayout(), false);

  context.window.innerHeight = 844;
  context.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  assert.equal(api.isDesktopLayout(), false);
});

test('desktop resize preserves active session while narrow or portrait resize maps back to chat', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1280, viewportHeight: 844, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  api.handleLayoutResize();
  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, 'session_1');

  context.window.innerWidth = 1200;
  context.window.innerHeight = 1920;
  api.handleLayoutResize();

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.sessionId, 'session_1');
  assert.equal(api.state.currentSession?.id, 'session_1');
});

test('responsive mobile chat clears desktop passive selection before foreground recovery', async () => {
  const fetchCalls: string[] = [];
  const { api, context } = await loadAppHarness({
    viewportWidth: 1280,
    viewportHeight: 844,
    desktopPointer: true,
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_responsive/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session: { id: 'session_responsive', cwd: '/repo' } }),
        };
      }
      if (path === '/api/sessions/session_responsive/timeline?limit=50') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], hasMore: false, nextBefore: null }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [{ id: 'session_responsive', cwd: '/repo', settings: { metadata: {} } }];

  api.ensureDesktopActiveSession();
  await api.recoverActiveTurnAfterForeground();
  assert.deepEqual(fetchCalls, []);

  context.window.innerWidth = 390;
  context.window.innerHeight = 844;
  api.handleLayoutResize();
  assert.equal(api.state.view, 'chat');

  await api.recoverActiveTurnAfterForeground();
  assert.deepEqual(fetchCalls, [
    '/api/sessions/session_responsive/status',
    '/api/sessions/session_responsive/timeline?limit=50',
  ]);

  fetchCalls.length = 0;
  context.window.innerWidth = 1280;
  context.window.innerHeight = 844;
  api.handleLayoutResize();
  await api.recoverActiveTurnAfterForeground();
  assert.deepEqual(fetchCalls, [
    '/api/sessions/session_responsive/status',
    '/api/sessions/session_responsive/timeline?limit=50',
  ]);
});

test('mobile keyboard resize keeps the focused login input', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 390, viewportHeight: 844 });

  api.state.authSession = null;
  api.render();

  const usernameInput = context.document.querySelector('#username');
  usernameInput.focus();
  usernameInput.value = 'admin';
  const originalAppRenderCount = context.__appRenderCount;

  context.window.innerHeight = 520;
  context.__dispatchWindowEvent('resize');

  assert.equal(context.__appRenderCount, originalAppRenderCount);
  assert.equal(context.document.querySelector('#username'), usernameInput);
  assert.equal(context.document.activeElement, usernameInput);
  assert.equal(usernameInput.value, 'admin');
});

test('desktop renders a project rail, session pane, and chat pane', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha' },
    { id: 'project_b', displayName: 'Project Beta' },
  ];
  api.state.projectsLoaded = true;
  api.state.sortMode = 'time';
  api.state.sessions = [
    { id: 'session_1', projectId: 'project_a', projectDisplayName: 'Project Alpha', cwd: '/repo/a', favorite: true, firstUserInput: 'Build feature', lastUserInput: 'Build feature', updatedAt: 20, settings: { metadata: {} } },
    { id: 'session_2', projectId: 'project_b', projectDisplayName: 'Project Beta', cwd: '/repo/b', favorite: true, firstUserInput: 'Fix bug', lastUserInput: 'Fix bug', updatedAt: 10, settings: { metadata: {} } },
  ];
  api.state.sessionId = 'session_1';
  api.state.currentSession = api.state.sessions[0];
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Ready' },
  ];

  api.render();

  assert.match(context.document.querySelector('#app').innerHTML, /class="desktop-workspace"/u);
  assert.match(context.document.querySelector('#app').innerHTML, /class="desktop-project-rail"/u);
  assert.match(context.document.querySelector('#app').innerHTML, /class="desktop-session-pane"/u);
  assert.match(context.document.querySelector('#app').innerHTML, /class="desktop-chat-pane"/u);
  assert.match(context.document.querySelector('#app').innerHTML, /Project Alpha/u);
  assert.match(context.document.querySelector('#app').innerHTML, /Build feature/u);
  assert.match(context.document.querySelector('#app').innerHTML, /Ready/u);
});

test('mobile session view does not render desktop workspace wrappers', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 390 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.render();

  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /desktop-workspace/u);
  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /desktop-project-rail/u);
  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /desktop-session-pane/u);
  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /desktop-chat-pane/u);
});

test('desktop project selection filters sessions and opens the newest session for that project', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_newer') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_newer',
              projectId: 'project_a',
              projectDisplayName: 'Project Alpha',
              cwd: '/repo/a',
              settings: { metadata: {} },
              thread: {
                turns: [{
                  id: 'turn_1',
                  items: [
                    { type: 'message', role: 'assistant', text: 'Newest project session' },
                  ],
                }],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha' },
    { id: 'project_b', displayName: 'Project Beta' },
  ];
  api.state.projectsLoaded = true;
  api.state.sortMode = 'time';
  api.state.sessions = [
    { id: 'session_older', projectId: 'project_a', projectDisplayName: 'Project Alpha', cwd: '/repo/a', firstUserInput: 'Older alpha', lastUserInput: 'Older alpha', updatedAt: 10, settings: { metadata: {} } },
    { id: 'session_newer', projectId: 'project_a', projectDisplayName: 'Project Alpha', cwd: '/repo/a', firstUserInput: 'Newest alpha', lastUserInput: 'Newest alpha', updatedAt: 50, settings: { metadata: {} } },
    { id: 'session_beta', projectId: 'project_b', projectDisplayName: 'Project Beta', cwd: '/repo/b', firstUserInput: 'Beta work', lastUserInput: 'Beta work', updatedAt: 100, settings: { metadata: {} } },
  ];

  await api.selectProjectScope('project_a');

  assert.deepEqual(fetchCalls, [
    '/api/sessions/session_newer/status',
    '/api/sessions/session_newer/timeline?limit=50',
    '/api/sessions/session_newer',
  ]);
  assert.equal(api.state.selectedProjectId, 'project_a');
  assert.equal(api.state.sessionId, 'session_newer');
  assert.equal(JSON.stringify(api.sortedSessions().map((session) => session.id)), JSON.stringify(['session_newer', 'session_older']));
  assert.match(api.context.document.querySelector('#app').innerHTML, /Newest project session/u);
  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /Beta work/u);
});

test('desktop project selection prefers a running session over a newer completed session in the same project', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_running') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_running',
              projectId: 'project_a',
              projectDisplayName: 'Project Alpha',
              cwd: '/repo/a',
              activeTurnId: 'turn_active',
              settings: { metadata: {} },
              thread: {
                turns: [{
                  id: 'turn_active',
                  status: 'in_progress',
                  items: [
                    { type: 'message', role: 'assistant', text: 'Still running in this project' },
                  ],
                }],
              },
            },
          }),
        };
      }
      if (path === '/api/turns/turn_active/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha' },
    { id: 'project_b', displayName: 'Project Beta' },
  ];
  api.state.projectsLoaded = true;
  api.state.sortMode = 'time';
  api.state.sessions = [
    {
      id: 'session_completed_newer',
      projectId: 'project_a',
      projectDisplayName: 'Project Alpha',
      cwd: '/repo/a',
      firstUserInput: 'Completed newer',
      lastUserInput: 'Completed newer',
      updatedAt: 100,
      settings: { metadata: {} },
      thread: { turns: [{ id: 'turn_done', status: 'completed' }] },
    },
    {
      id: 'session_running',
      projectId: 'project_a',
      projectDisplayName: 'Project Alpha',
      cwd: '/repo/a',
      firstUserInput: 'Running older',
      lastUserInput: 'Running older',
      updatedAt: 50,
      activeTurnId: 'turn_active',
      settings: { metadata: {} },
      thread: { turns: [{ id: 'turn_active', status: 'in_progress' }] },
    },
    {
      id: 'session_beta',
      projectId: 'project_b',
      projectDisplayName: 'Project Beta',
      cwd: '/repo/b',
      firstUserInput: 'Beta work',
      lastUserInput: 'Beta work',
      updatedAt: 200,
      settings: { metadata: {} },
    },
  ];

  await api.selectProjectScope('project_a');

  assert.equal(fetchCalls[0], '/api/turns/turn_active/events');
  assert.ok(fetchCalls.includes('/api/sessions/session_running/status'));
  assert.ok(fetchCalls.includes('/api/sessions/session_running/timeline?limit=50'));
  assert.ok(fetchCalls.includes('/api/sessions/session_running'));
  assert.equal(api.state.sessionId, 'session_running');
  assert.equal(api.state.status, 'Turn running');
  assert.match(api.context.document.querySelector('#app').innerHTML, /Still running in this project/u);
});

test('desktop project selection opens new when the project has no sessions yet', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = {
    id: 'auth_1',
    principal: {
      userId: 'user_1',
      username: 'alice',
      roleIds: ['role_user'],
      isAdmin: false,
      mode: 'multi',
    },
  };
  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha' },
    { id: 'project_b', displayName: 'Project Beta' },
  ];
  api.state.projectsLoaded = true;
  api.state.sessions = [
    { id: 'session_alpha', projectId: 'project_a', projectDisplayName: 'Project Alpha', cwd: '/repo/a', updatedAt: 20, settings: { metadata: {} } },
  ];

  await api.selectProjectScope('project_b');

  assert.equal(api.state.view, 'new');
  assert.equal(api.state.newProjectId, 'project_b');
  assert.match(api.context.document.querySelector('#app').innerHTML, /id="new-session-form"/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /value="project_b" selected/u);
});

test('mobile project selection filters to project sessions without opening the newest session', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    viewportWidth: 390,
    fetch: async (path) => {
      fetchCalls.push(path);
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.authSession = { id: 'auth_1' };
  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha' },
    { id: 'project_b', displayName: 'Project Beta' },
  ];
  api.state.projectsLoaded = true;
  api.state.mobileSidebarOpen = true;
  api.state.view = 'chat';
  api.state.sessionId = 'session_existing';
  api.state.currentSession = { id: 'session_existing', cwd: '/repo/existing', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Existing chat' }];
  api.state.sessions = [
    { id: 'session_alpha_older', projectId: 'project_a', projectDisplayName: 'Project Alpha', cwd: '/repo/a', firstUserInput: 'Older alpha', lastUserInput: 'Older alpha', updatedAt: 10, settings: { metadata: {} } },
    { id: 'session_alpha_newer', projectId: 'project_a', projectDisplayName: 'Project Alpha', cwd: '/repo/a', firstUserInput: 'Newest alpha', lastUserInput: 'Newest alpha', updatedAt: 50, settings: { metadata: {} } },
    { id: 'session_beta', projectId: 'project_b', projectDisplayName: 'Project Beta', cwd: '/repo/b', firstUserInput: 'Beta work', lastUserInput: 'Beta work', updatedAt: 100, settings: { metadata: {} } },
  ];

  await api.selectProjectScope('project_a');

  assert.deepEqual(fetchCalls, []);
  assert.equal(api.state.selectedProjectId, 'project_a');
  assert.equal(api.state.mobileSidebarOpen, false);
  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, null);
  assert.equal(api.state.currentSession, null);
  assert.equal(api.state.timeline.length, 0);
  assert.equal(
    JSON.stringify(api.sortedSessions().map((session) => session.id)),
    JSON.stringify(['session_alpha_newer', 'session_alpha_older']),
  );
  const html = api.context.document.querySelector('#app').innerHTML;
  assert.match(html, /Newest alpha/u);
  assert.doesNotMatch(html, /Beta work/u);
  assert.doesNotMatch(html, /Existing chat/u);
});

test('workspace projects put favorites first and then sort by session count', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha', favorite: false },
    { id: 'project_b', displayName: 'Project Beta', favorite: true },
    { id: 'project_c', displayName: 'Project Gamma', favorite: false },
  ];
  api.state.projectsLoaded = true;
  api.state.sessions = [
    { id: 'alpha_1', projectId: 'project_a', projectDisplayName: 'Project Alpha', cwd: '/repo/a', updatedAt: 30, settings: { metadata: {} } },
    { id: 'alpha_2', projectId: 'project_a', projectDisplayName: 'Project Alpha', cwd: '/repo/a', updatedAt: 20, settings: { metadata: {} } },
    { id: 'alpha_3', projectId: 'project_a', projectDisplayName: 'Project Alpha', cwd: '/repo/a', updatedAt: 10, settings: { metadata: {} } },
    { id: 'beta_1', projectId: 'project_b', projectDisplayName: 'Project Beta', cwd: '/repo/b', updatedAt: 40, settings: { metadata: {} } },
    { id: 'gamma_1', projectId: 'project_c', projectDisplayName: 'Project Gamma', cwd: '/repo/c', updatedAt: 60, settings: { metadata: {} } },
    { id: 'gamma_2', projectId: 'project_c', projectDisplayName: 'Project Gamma', cwd: '/repo/c', updatedAt: 50, settings: { metadata: {} } },
  ];

  assert.equal(JSON.stringify(api.workspaceProjects().map((project) => project.id)), JSON.stringify(['project_b', 'project_a', 'project_c']));
});

test('project rail renders project favorite controls', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha', favorite: true },
    { id: 'project_b', displayName: 'Project Beta', favorite: false },
  ];
  api.state.sessions = [
    { id: 'session_alpha', projectId: 'project_a', projectDisplayName: 'Project Alpha', cwd: '/repo/a', updatedAt: 20, settings: { metadata: {} } },
    { id: 'session_beta', projectId: 'project_b', projectDisplayName: 'Project Beta', cwd: '/repo/b', updatedAt: 10, settings: { metadata: {} } },
  ];

  const html = api.renderDesktopProjectRail();

  assert.match(html, /data-project-favorite-id="project_a"/u);
  assert.match(html, /data-project-favorite-id="project_b"/u);
  assert.match(html, /aria-label="Unfavorite Project Alpha"/u);
  assert.match(html, /aria-label="Favorite Project Beta"/u);
});

test('project favorite action patches backend and updates the project list', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/projects/project_a/favorite') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ projectId: 'project_a', favorite: true }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha', favorite: false },
    { id: 'project_b', displayName: 'Project Beta', favorite: false },
  ];

  await api.toggleProjectFavorite('project_a');

  assert.deepEqual(fetchCalls.map((call) => call.path), ['/api/projects/project_a/favorite']);
  assert.equal(fetchCalls[0]?.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(fetchCalls[0]?.options.body), { favorite: true });
  assert.equal(api.state.projects.find((project) => project.id === 'project_a')?.favorite, true);
});

test('desktop session selection keeps the workspace view active', async () => {
  const { api } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_2');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_2',
            cwd: '/repo/two',
            settings: { metadata: {} },
            thread: {
              turns: [
                {
                  id: 'turn_1',
                  items: [
                    { type: 'message', role: 'user', text: 'Desktop question' },
                    { type: 'message', role: 'assistant', text: 'Desktop answer' },
                  ],
                },
              ],
            },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [
    { id: 'session_1', cwd: '/repo/one', favorite: true, settings: { metadata: {} } },
    { id: 'session_2', cwd: '/repo/two', favorite: true, settings: { metadata: {} } },
  ];
  api.state.sessionId = 'session_1';
  api.state.currentSession = api.state.sessions[0];

  await api.selectSession('session_2');

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, 'session_2');
  assert.equal(api.state.currentSession?.id, 'session_2');
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-workspace/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /Desktop answer/u);
});

test('narrow computer windows use the single-pane session flow', async () => {
  const { api } = await loadAppHarness({
    viewportWidth: 900,
    desktopPointer: true,
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_2');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_2',
            cwd: '/repo/two',
            settings: { metadata: {} },
            timeline: [
              { id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Right pane switched' },
            ],
            thread: { turns: [] },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [
    { id: 'session_1', cwd: '/repo/one', favorite: true, settings: { metadata: {} } },
    { id: 'session_2', cwd: '/repo/two', favorite: true, settings: { metadata: {} } },
  ];
  api.state.sessionId = 'session_1';
  api.state.currentSession = api.state.sessions[0];

  await api.selectSession('session_2');

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.sessionId, 'session_2');
  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /desktop-workspace/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /Right pane switched/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /chat-back-button/u);
});

test('desktop showSessionList keeps the active right pane instead of clearing it', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Still visible' }];

  api.showSessionList();

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, 'session_1');
  assert.equal(api.state.currentSession?.id, 'session_1');
  assert.equal(api.state.timeline.length, 1);
  assert.match(api.context.document.querySelector('#app').innerHTML, /Still visible/u);
});

test('desktop composer is larger, shows Refresh and Send, and does not render the expand control', async () => {
  const [styles, app] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
  ]);

  assert.match(styles, /@media \(min-width:\s*1280px\)[\s\S]*\.desktop-chat-pane \.composer\s*\{[^}]*width:\s*min\(100%,\s*960px\);/su);
  assert.match(styles, /@media \(hover:\s*hover\) and \(pointer:\s*fine\)[\s\S]*\.compact-composer-row textarea\s*\{[^}]*min-height:\s*96px;/su);
  assert.match(styles, /@media \(hover:\s*hover\) and \(pointer:\s*fine\)[\s\S]*\.compact-composer-row textarea\s*\{[^}]*max-height:\s*220px;/su);
  assert.match(styles, /\.message-card \.message-text,\s*\.message-card \.markdown-body\s*\{[^}]*font-weight:\s*400;/su);
  assert.match(styles, /\.compact-composer-row textarea\s*\{[^}]*font-weight:\s*400;/su);
  assert.match(app, /const maxHeight = hasDesktopPointer\(\) \? DESKTOP_PROMPT_TEXTAREA_MAX_HEIGHT : PROMPT_TEXTAREA_MAX_HEIGHT;/u);
  assert.doesNotMatch(styles, /@media \(min-width:\s*1280px\)[\s\S]*\.desktop-chat-pane \.compact-send\s*\{[^}]*display:\s*none;/su);
  assert.match(app, /if \(!isDesktopLayout\(\)\) \{[\s\S]*id="composer-expand-button"/u);
  assert.match(app, /id="composer-refresh-button"/u);
  assert.match(app, /class="composer-action-buttons"/u);
  assert.match(app, /function handlePromptKeydown\(event\)/u);
  assert.match(app, /listenRendered\(promptInput, 'keydown', handlePromptKeydown\)/u);
  assert.doesNotMatch(app, /document\.querySelector\('#composer-form'\)\?\.requestSubmit\(\)/u);
});

test('desktop prompt Enter does not submit the form', async () => {
  let submitCount = 0;
  const { api, context } = await loadAppHarness({ viewportWidth: 1280, viewportHeight: 844, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.render();

  const composerForm = {
    requestSubmit() {
      submitCount += 1;
    },
  };
  context.__elements.set('#composer-form', composerForm);

  const enterEvent = {
    key: 'Enter',
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  api.handlePromptKeydown(enterEvent);

  assert.equal(enterEvent.prevented, false);
  assert.equal(submitCount, 0);

  const shiftEnterEvent = {
    key: 'Enter',
    shiftKey: true,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  api.handlePromptKeydown(shiftEnterEvent);

  assert.equal(shiftEnterEvent.prevented, false);
  assert.equal(submitCount, 0);
});

test('desktop composer refresh button refreshes the current session without relying on browser reload', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [{
                  id: 'turn_1',
                  status: 'completed',
                  items: [
                    { type: 'message', role: 'user', text: 'Question' },
                    { type: 'message', role: 'assistant', text: 'Refreshed answer' },
                  ],
                }],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timelineShouldFollowLatest = true;
  api.render();

  await api.handleComposerRefresh();

  assert.deepEqual(fetchCalls, [
    '/api/sessions/session_1/status',
    '/api/sessions/session_1/timeline?limit=50',
    '/api/sessions/session_1',
  ]);
  assert.equal(api.state.timeline.some((item) => item.text === 'Refreshed answer'), true);
});

test('desktop queued-message rerenders keep the current scroll position when not following latest', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.state.prompt = 'queue this next';
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Older message' },
    { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Newest message' },
  ];
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1400;
  timeline.clientHeight = 400;
  timeline.scrollTop = 640;
  api.updateTimelineFollowState();

  await api.onComposerSubmit({ preventDefault() {} });

  const restoredTimeline = context.document.querySelector('#timeline');
  assert.equal(api.state.timelineShouldFollowLatest, false);
  assert.ok(restoredTimeline.scrollTop < restoredTimeline.scrollHeight);
});

test('single-pane desktop timeline wheel at the top expands older session history', async () => {
  const { api, context } = await loadAppHarness({
    viewportWidth: 1000,
    viewportHeight: 1600,
    desktopPointer: true,
  });
  const timeline = {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 400,
    addEventListener() {},
    removeEventListener() {},
  };
  context.__elements.set('#timeline', timeline);
  const appElement = context.document.querySelector('#app');
  context.document.querySelector = (selector) => {
    if (selector === '#timeline') {
      return timeline;
    }
    if (selector === '#app') {
      return appElement;
    }
    return null;
  };

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.sessionHistoryItems = [
    { id: 'old_user', kind: 'message', role: 'user', label: 'You', text: 'Old question' },
    { id: 'old_assistant', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Old answer' },
    { id: 'new_user', kind: 'message', role: 'user', label: 'You', text: 'New question' },
    { id: 'new_assistant', kind: 'message', role: 'assistant', label: 'Assistant', text: 'New answer' },
  ];
  api.state.sessionHistoryStartIndex = 2;
  api.state.timeline = api.state.sessionHistoryItems.slice(2);
  const wheelEvent = {
    deltaY: -80,
    target: timeline,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };

  api.handleTimelineWheel(wheelEvent);

  assert.equal(api.isDesktopLayout(), false);
  assert.equal(wheelEvent.defaultPrevented, true);
  assert.equal(api.state.sessionHistoryStartIndex, 0);
  assert.equal(api.state.timeline[0]?.text, 'Old question');
});

test('desktop new session opens in the workspace pane with the active project preselected', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = {
    id: 'auth_1',
    principal: {
      userId: 'user_1',
      username: 'alice',
      roleIds: ['role_user'],
      isAdmin: false,
      mode: 'multi',
    },
  };
  api.state.view = 'sessions';
  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha' },
    { id: 'project_b', displayName: 'Project Beta' },
  ];
  api.state.projectsLoaded = true;
  api.state.selectedProjectId = 'project_b';
  api.state.selectedProjectKey = 'project_b';
  api.state.selectedProjectLabel = 'Project Beta';
  api.openNewSessionPage();

  assert.equal(api.state.view, 'new');
  assert.equal(api.state.newProjectId, 'project_b');
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-workspace/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-session-pane/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /id="new-session-form"/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /value="project_b" selected/u);
});

test('mobile new session still uses the full-screen new page', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 390 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.openNewSessionPage();

  const html = api.context.document.querySelector('#app').innerHTML;
  const pageNav = html.match(/<div class="page-nav">[\s\S]*?<\/div>\s*<\/div>/u)?.[0] || '';

  assert.equal(api.state.view, 'new');
  assert.match(html, /class="new-session-page"/u);
  assert.match(pageNav, /class="ghost page-back-button" type="button" id="back-to-list-button" aria-label="Back">[\s\S]*class="button-icon button-icon-back"[\s\S]*<\/button>/u);
  assert.match(pageNav, /<div class="page-title">New Session<\/div>/u);
  assert.match(pageNav, /<div class="page-nav-spacer" aria-hidden="true"><\/div>/u);
  assert.doesNotMatch(pageNav, /mobile-sidebar-toggle-button/u);
  assert.doesNotMatch(pageNav, />Sessions<\/button>/u);
});

test('mobile sessions render drawer actions and keep favorites toggle beside the sidebar button', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 390 });

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true, mode: 'multi' } };
  api.state.siteTitle = 'Yan Shan Lab';
  api.state.view = 'sessions';
  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha' },
    { id: 'project_b', displayName: 'Project Beta' },
  ];
  api.state.projectsLoaded = true;
  api.state.mobileSidebarOpen = true;
  api.render();

  const html = api.context.document.querySelector('#app').innerHTML;
  assert.match(html, /mobile-sidebar-toggle-button/u);
  assert.match(html, /class="mobile-project-drawer/is);
  assert.match(html, /id="mobile-drawer-backdrop"/u);
  assert.match(html, /<div class="project-rail-brand" id="mobile-project-drawer-title">Yan Shan Lab<\/div>/u);
  assert.match(html, /id="mobile-drawer-close-button"[^>]*aria-label="Close projects"/u);
  assert.match(html, /All Sessions/u);
  assert.match(html, /Project Alpha/u);
  assert.match(html, /open-new-session-button/u);
  assert.doesNotMatch(html, /open-reports-button|>Reports<\/button>/u);
  assert.match(html, /open-app-settings-button/u);
  assert.doesNotMatch(html, /rail-show-sessions-button/u);
  assert.doesNotMatch(html, /rail-open-new-session-button/u);
  assert.match(html, /open-admin-console-button/u);

  const mobileHeader = html.match(/<header class="topbar page-topbar mobile-session-topbar">([\s\S]*?)<\/header>/u)?.[1] || '';
  const drawerFooter = html.match(/<div class="project-rail-footer">([\s\S]*?)<\/div>/u)?.[1] || '';
  assert.match(mobileHeader, /mobile-sidebar-toggle-button[\s\S]*mobile-session-sort-toggle/u);
  assert.match(mobileHeader, /data-sort-mode="favorites"[\s\S]*data-sort-mode="time"/u);
  assert.doesNotMatch(mobileHeader, /mobile-session-page-title/u);
  assert.doesNotMatch(mobileHeader, />Sessions<\/div>/u);
  assert.doesNotMatch(mobileHeader, /id="open-reports-button"/u);
  assert.match(mobileHeader, /id="open-new-session-button"/u);
  assert.match(drawerFooter, /id="open-app-settings-button"/u);
  assert.doesNotMatch(drawerFooter, /open-reports-button|>Reports<\/button>/u);
  assert.doesNotMatch(drawerFooter, /id="open-new-session-button"/u);
});

test('mobile project drawer closes from the uncovered backdrop area', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /id="mobile-drawer-backdrop"/u);
  assert.match(app, /id="mobile-drawer-close-button"/u);
  assert.match(app, /const mobileProjectDrawerBackdrop = document\.querySelector\('#mobile-drawer-backdrop'\);/u);
  assert.match(app, /listenRendered\(mobileProjectDrawerBackdrop, 'click',\s*\(event\) => \{/u);
  assert.match(app, /if \(event\.target !== mobileProjectDrawerBackdrop\) \{\s*return;\s*\}/u);
  assert.match(app, /closeMobileSidebar\(\);/u);
  assert.match(app, /function setMobileSidebarOpen\(open\)/u);
  assert.match(app, /drawer\?\.classList\.toggle\('is-open', state\.mobileSidebarOpen\)/u);
});

test('mobile project drawer title stays below the phone status bar', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.mobile-project-drawer-header\s*\{[^}]*padding-top:\s*calc\(env\(safe-area-inset-top,\s*0px\) \+ 18px\);/su);
});

test('mobile sidebar toggle uses a real touch target instead of a flat text button', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.mobile-sidebar-toggle-button\s*\{[^}]*width:\s*42px;/su);
  assert.match(styles, /\.mobile-sidebar-toggle-button\s*\{[^}]*min-height:\s*42px;/su);
  assert.match(styles, /\.mobile-sidebar-toggle-button\s*\{[^}]*border-radius:\s*12px;/su);
  assert.match(styles, /\.mobile-sidebar-toggle-button\s*\{[^}]*border:\s*1px solid var\(--border\);/su);
  assert.match(styles, /\.mobile-sidebar-toggle-button\s*\{[^}]*background:\s*var\(--panel\);/su);
  assert.match(styles, /\.mobile-session-sort-toggle\s*\{[^}]*flex:\s*1 1 auto;/su);
  assert.match(styles, /\.toggle\.mobile-session-sort-toggle button\s*\{[^}]*min-height:\s*32px;/su);
  assert.match(styles, /\.toggle\.mobile-session-sort-toggle button\s*\{[^}]*padding:\s*0 8px;/su);
  assert.match(styles, /\.toggle\.mobile-session-sort-toggle button\s*\{[^}]*font-size:\s*11px;/su);
});

test('mobile sidebar toggle renders the sidebar svg icon', async () => {
  const { api } = await loadAppHarness();

  api.state.view = 'sessions';
  api.state.projectsLoaded = true;

  const html = api.renderSessionList().innerHTML;

  assert.match(html, /id="mobile-sidebar-toggle-button"[^>]*>[\s\S]*class="button-icon button-icon-sidebar"[\s\S]*<\/button>/u);
});

test('admin console remains a full-screen page instead of rendering inside the workspace shell', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };

  await api.openAdminConsole();

  const html = api.context.document.querySelector('#app').innerHTML;
  assert.match(html, /admin-console-screen/u);
  assert.doesNotMatch(html, /desktop-workspace/u);
  assert.doesNotMatch(html, /desktop-project-rail/u);
});

test('desktop new session submit keeps the workspace shell and activates the draft session', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.newCwd = '/repo/new';

  api.onNewSessionSubmit({
    preventDefault() {},
  });

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.cwd, '/repo/new');
  assert.equal(api.state.sessionId, null);
  assert.equal(api.state.currentSession, null);
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-workspace/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /No context yet/u);
});

test('desktop new session submit does not auto-select an existing session', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [{ id: 'session_old', cwd: '/repo/old', favorite: true, settings: { favorite: true, metadata: {} } }];
  api.state.newCwd = '/repo/new';

  api.onNewSessionSubmit({
    preventDefault() {},
  });

  assert.equal(api.state.sessionId, null);
  assert.equal(api.state.currentSession, null);
  assert.equal(api.state.cwd, '/repo/new');
  assert.match(api.context.document.querySelector('#app').innerHTML, /No context yet/u);
});

test('desktop new session submit with the default cwd still shows the composer', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.newCwd = '';

  api.onNewSessionSubmit({
    preventDefault() {},
  });

  const html = api.context.document.querySelector('#app').innerHTML;
  assert.match(html, /id="composer-form"/u);
  assert.match(html, /id="prompt-input"/u);
  assert.doesNotMatch(html, /No active session/u);
});

test('desktop draft session clears after the first submitted message creates a backend session', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (path, options = {}) => {
      fetchCalls.push(path);
      if (path === '/api/session-submissions') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            submission: {
              id: JSON.parse(options.body).submissionId,
              status: 'submitted',
              sessionId: 'session_new',
              turnId: 'turn_new',
              error: null,
            },
            session: {
              id: 'session_new',
              cwd: '/repo/new',
              settings: {},
              thread: { turns: [] },
            },
            turnId: 'turn_new',
          }),
        };
      }
      if (path === '/api/turns/turn_new/events') {
        return {
          ok: true,
          status: 200,
          body: { getReader: () => ({ read: async () => ({ done: true }) }) },
        };
      }
      return { ok: true, status: 204, json: async () => ({}) };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.newCwd = '/repo/new';
  api.onNewSessionSubmit({ preventDefault() {} });
  api.state.prompt = 'hello';

  await api.onComposerSubmit({ preventDefault() {} });

  assert.equal(api.state.draftSessionActive, false);
  assert.equal(api.state.sessionId, 'session_new');
  assert.equal(fetchCalls[0], '/api/session-submissions');
});

test('desktop app settings opens as a panel without clearing the active session', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Keep me' }];

  api.openAppSettingsPage();

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.desktopSettingsOpen, true);
  assert.equal(api.state.sessionId, 'session_1');
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-settings-panel/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /Keep me/u);
});

test('desktop session file links open in the right-pane overlay and close back to the active session', async () => {
  const { api } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (url, options = {}) => {
      if (String(url) === '/api/sessions/session_a/files/resolve') {
        assert.equal(JSON.parse(options.body).path, 'docs/summary.md');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            file: {
              id: 'file_summary',
              name: 'summary.md',
              kind: 'markdown',
              contentUrl: '/api/sessions/session_a/files/file_summary/content',
            },
          }),
        };
      }
      if (String(url) === '/api/sessions/session_a/files/file_summary/content') {
        return {
          ok: true,
          status: 200,
          text: async () => '# Summary',
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_a';
  api.state.currentSession = { id: 'session_a', cwd: '/Users/alice/work/project-a', projectName: 'Project A', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Workspace text' }];

  await api.openSessionFileByPath('docs/summary.md');

  const viewerHtml = api.context.document.querySelector('#app').innerHTML;
  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.desktopOverlay, 'file');
  assert.equal(api.state.sessionId, 'session_a');
  assert.match(viewerHtml, /desktop-workspace/u);
  assert.match(viewerHtml, /desktop-session-pane/u);
  assert.match(viewerHtml, /role="dialog" aria-modal="true" aria-label="File preview" data-focus-scope="session-file"/u);
  assert.match(viewerHtml, /id="close-session-file-button"[^>]*data-initial-focus/u);
  assert.match(viewerHtml, /session-file-viewer/u);
  assert.match(viewerHtml, /<h1>Summary<\/h1>/u);

  const escapeEvent = {
    key: 'Escape',
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  api.handleFocusScopeKeydown(escapeEvent);

  const chatHtml = api.context.document.querySelector('#app').innerHTML;
  assert.equal(escapeEvent.prevented, true);
  assert.equal(escapeEvent.stopped, true);
  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.desktopOverlay, null);
  assert.equal(api.state.sessionId, 'session_a');
  assert.match(chatHtml, /Workspace text/u);
  assert.doesNotMatch(chatHtml, /session-file-viewer/u);
});

test('session topbar keeps New visually neutral and omits the redundant desktop Sessions action', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.sortMode = 'favorites';
  const favoritesHtml = api.renderDesktopSessionPane();
  const railHtml = api.renderDesktopProjectRail();

  assert.doesNotMatch(favoritesHtml, /id="favorite-sort-button"/u);
  assert.match(favoritesHtml, /id="open-new-session-button"[\s\S]*>New<\/button>/u);
  assert.doesNotMatch(favoritesHtml, /open-reports-button|>Reports<\/button>/u);
  assert.match(favoritesHtml, /class="ghost compact-button" type="button" id="open-new-session-button"/u);
  assert.doesNotMatch(railHtml, /id="rail-show-sessions-button"|>Sessions<\/button>/u);
  assert.match(railHtml, /class="project-rail-action" type="button" id="open-app-settings-button">Setting<\/button>/u);
  assert.doesNotMatch(favoritesHtml, /id="rail-open-new-session-button"/u);
  assert.doesNotMatch(favoritesHtml, /class="primary compact-button" type="button" id="open-new-session-button"/u);

  api.state.sortMode = 'time';
  const allHtml = api.renderDesktopSessionPane();

  assert.doesNotMatch(allHtml, /id="favorite-sort-button"/u);
  assert.match(allHtml, /id="open-new-session-button"/u);
  assert.doesNotMatch(allHtml, /open-reports-button|>Reports<\/button>/u);
  assert.doesNotMatch(allHtml, /id="rail-open-new-session-button"/u);
});

test('session topbar does not render long project names next to New', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });
  const longProjectName = 'Very Long Project Name '.repeat(12).trim();

  api.state.authSession = { id: 'auth_1' };
  api.state.projects = [{ id: 'project_long', displayName: longProjectName }];
  api.state.projectsLoaded = true;
  api.state.selectedProjectKey = 'project_long';
  api.state.selectedProjectId = 'project_long';
  api.state.selectedProjectLabel = longProjectName;

  const html = api.renderDesktopSessionPane();
  const topbarMain = html.match(/<div class="topbar-main">([\s\S]*?)<\/div>\s*<div class="list-actions">/u)?.[1] || '';

  assert.match(topbarMain, /<div class="page-title">Sessions<\/div>/u);
  assert.equal(topbarMain.includes(longProjectName), false);
  assert.doesNotMatch(topbarMain, /open-reports-button|>Reports<\/button>/u);
  assert.match(topbarMain, /id="open-new-session-button"[\s\S]*>New<\/button>/u);
});

test('session UI omits Reports without replacing Message textarea or session menu', async () => {
  const { api } = await loadAppHarness();

  const sessionsHtml = api.renderSessionList().innerHTML;
  assert.doesNotMatch(sessionsHtml, /open-reports-button|>Reports<\/button>/u);
  assert.doesNotMatch(sessionsHtml, /data-main-view/u);
  assert.doesNotMatch(sessionsHtml, /main-view-toggle/u);

  api.state.view = 'chat';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  const chatHtml = api.renderChat().innerHTML;
  assert.match(chatHtml, /id="settings-toggle"/u);
  assert.match(chatHtml, /<textarea id="prompt-input" name="prompt" rows="1" placeholder="Message">/u);
  assert.doesNotMatch(chatHtml, /<input class="prompt-input" id="prompt-input"/u);
});

test('session file viewer renders markdown and sandboxed html files', async () => {
  const { api } = await loadAppHarness();

  api.state.currentSessionFile = {
    id: 'file_summary',
    name: 'summary.md',
    kind: 'markdown',
  };
  api.state.currentSessionFileContent = '# Done\n\n- **item**\n\n| Col A | Col B | Col C |\n| :--- | :---: | ---: |\n| A \\| B | `x|y` | Gamma |\n';
  let html = api.renderSessionFileViewer().innerHTML;
  assert.match(html, /<div class="session-file-document markdown-body" data-i18n-skip>/u);
  assert.match(html, /<h1>Done<\/h1>/u);
  assert.match(html, /<strong>item<\/strong>/u);
  assert.match(html, /<table><thead><tr><th style="text-align: left;">Col A<\/th><th style="text-align: center;">Col B<\/th><th style="text-align: right;">Col C<\/th><\/tr><\/thead><tbody><tr><td style="text-align: left;">A \| B<\/td><td style="text-align: center;"><code>x\|y<\/code><\/td><td style="text-align: right;">Gamma<\/td><\/tr><\/tbody><\/table>/u);

  api.state.currentSessionFile = {
    id: 'file_audit',
    name: 'audit.html',
    kind: 'html',
  };
  api.state.currentSessionFileContent = '<h1>Audit</h1>';
  html = api.renderSessionFileViewer().innerHTML;
  assert.match(html, /<iframe class="session-file-frame session-file-html"[^>]*sandbox="" referrerpolicy="no-referrer"/u);
  assert.match(html, /srcdoc="&lt;meta http-equiv=&quot;Content-Security-Policy&quot; content=&quot;default-src &#39;none&#39;;[^>]*&gt;&lt;h1&gt;Audit&lt;\/h1&gt;">/u);
});

test('markdown session files wrap long text within the mobile viewport', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.session-file-document\s*\{[^}]*overflow-wrap:\s*anywhere;/su);
  assert.match(styles, /\.markdown-body p,\s*\.markdown-body li,\s*\.markdown-body blockquote,\s*\.markdown-body h1,\s*\.markdown-body h2,\s*\.markdown-body h3,\s*\.markdown-body td,\s*\.markdown-body th\s*\{[^}]*overflow-wrap:\s*anywhere;/su);
  assert.match(styles, /\.markdown-body pre,\s*\.markdown-body code\s*\{[^}]*white-space:\s*pre-wrap;/su);
  assert.doesNotMatch(styles, /\.markdown-body\s*\{[^}]*white-space:\s*nowrap;/su);
});

test('session file viewer renders markdown verification tables as real tables', async () => {
  const { api } = await loadAppHarness();

  api.state.currentSessionFile = {
    id: 'file_table',
    name: 'markdown-table-render.md',
    kind: 'markdown',
  };
  api.state.currentSessionFileContent = [
    '# Markdown Table Render Report',
    '',
    '## What Changed',
    '',
    '| Area | Status | Notes |',
    '| :--- | :---: | ---: |',
    '| Basic markdown tables | OK | `table`, `thead`, `tbody` render |',
    '| Alignment syntax | OK | `:---`, `:---:`, `---:` supported |',
    '| Escaped pipes | OK | `\\|` stays inside the same cell |',
    '| Inline code pipes | OK | `` `x|y` `` does not split columns |',
    '',
    '## Mixed Real-World Example',
    '',
    '| Field | Example | Result |',
    '| :--- | :---: | ---: |',
    '| Name | `renderMarkdown()` | pass |',
    '| Escaped text | A \\| B | pass |',
    '| Code sample | `foo|bar` | pass |',
    '| Numeric column | 42 | aligned right |',
  ].join('\n');

  const html = api.renderSessionFileViewer().innerHTML;
  assert.match(html, /<table>/u);
  assert.match(html, /<th style="text-align: left;">Area<\/th>/u);
  assert.match(html, /<td style="text-align: left;">Basic markdown tables<\/td>/u);
  assert.match(html, /<td style="text-align: right;"><code>table<\/code>, <code>thead<\/code>, <code>tbody<\/code> render<\/td>/u);
  assert.match(html, /<td style="text-align: left;">Escaped pipes<\/td>/u);
  assert.match(html, /<td style="text-align: right;"><code>\\\|<\/code> stays inside the same cell<\/td>/u);
  assert.match(html, /<td style="text-align: center;"><code>renderMarkdown\(\)<\/code><\/td>/u);
  assert.match(html, /<td style="text-align: center;"><code>foo\|bar<\/code><\/td>/u);
});

test('assistant project file links and explicit bare paths open in the session file viewer', async () => {
  const { api } = await loadAppHarness();

  const markdownHtml = api.renderTimelineItem({
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    text: '[审计](docs/audit.md) [相对审计](./docs/audit.md) [图片](images/preview.avif)',
  });
  assert.match(markdownHtml, /data-session-file-path="docs\/audit\.md"/u);
  assert.match(markdownHtml, /data-session-file-path="\.\/docs\/audit\.md"/u);
  assert.match(markdownHtml, /data-session-file-path="images\/preview\.avif"/u);
  assert.match(markdownHtml, /class="session-file-link"/u);

  const sourceHtml = api.renderTimelineItem({
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    text: '[app.js](/repo/packages/codex-web/public/app.js:3091) [server.ts](/repo/packages/codex-web/src/server.ts:1498)',
  });
  assert.match(sourceHtml, /data-session-file-path="\/repo\/packages\/codex-web\/public\/app\.js:3091"/u);
  assert.match(sourceHtml, /data-session-file-path="\/repo\/packages\/codex-web\/src\/server\.ts:1498"/u);
  assert.doesNotMatch(sourceHtml, /\[app\.js\]\(|\[server\.ts\]\(/u);

  const plainHtml = api.renderTimelineItem({
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    text: '文件在 docs/audit.md，也可看 images/preview.tiff。',
  });
  assert.match(plainHtml, /data-session-file-path="docs\/audit\.md"/u);
  assert.match(plainHtml, /data-session-file-path="images\/preview\.tiff"/u);
});

test('assistant web links stay external while unsupported local files stay plain', async () => {
  const { api } = await loadAppHarness();

  const markdownHtml = api.renderTimelineItem({
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    text: '[OpenAI](https://openai.com/docs) [Data](docs/data.csv)',
  });
  assert.match(markdownHtml, /href="https:\/\/openai\.com\/docs" target="_blank" rel="noopener noreferrer"/u);
  assert.doesNotMatch(markdownHtml, /data-session-file-path="docs\/data\.csv"/u);

  const plainHtml = api.renderTimelineItem({
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    text: '查看这个文件：docs/data.csv',
  });
  assert.doesNotMatch(plainHtml, /class="session-file-link"|data-session-file-path=/u);
  assert.match(plainHtml, /docs\/data\.csv/u);
});

test('session menu and navigation no longer expose reports UI', async () => {
  const { api } = await loadAppHarness();

  api.state.sessionId = 'session_a';
  api.state.currentSession = {
    id: 'session_a',
    cwd: '/Users/alice/work/project-a',
    projectName: 'Project A',
  };
  api.state.settingsOpen = true;

  const html = api.renderChat().innerHTML;

  assert.doesNotMatch(html, /Reports|session-report|data-report/u);
  assert.match(html, /id="settings-toggle"/u);
  assert.match(html, /<textarea id="prompt-input" name="prompt" rows="1" placeholder="Message">/u);
});

test('file and attachment controls meet mobile touch target sizing', async () => {
  const styles = await readFile(stylesUrl, 'utf8');
  assert.match(styles, /\.message-attachment\s*\{[^}]*min-height:\s*44px;/su);
  assert.match(styles, /\.attachment-main\s*\{[^}]*min-height:\s*44px;/su);
  assert.match(styles, /\.page-nav-action\s*\{[^}]*min-height:\s*44px;/su);
});

test('favorite filter shows only favorite sessions and all shows every session', async () => {
  const { api } = await loadAppHarness();

  api.state.sessions = [
    { id: 'old', updatedAt: 10, settings: { metadata: {} } },
    { id: 'older_favorite', favorite: true, favoriteOrder: 1, updatedAt: 20, settings: { favoriteOrder: 1, metadata: {} } },
    { id: 'newer_favorite', favorite: true, favoriteOrder: 99, updatedAt: 40, settings: { favoriteOrder: 99, metadata: {} } },
  ];

  api.state.sortMode = 'favorites';
  assert.equal(api.state.sortMode, 'favorites');
  assert.equal(JSON.stringify(api.filteredSessions().map((session) => session.id)), JSON.stringify(['older_favorite', 'newer_favorite']));
  assert.equal(JSON.stringify(api.sortedSessions().map((session) => session.id)), JSON.stringify(['newer_favorite', 'older_favorite']));

  api.state.sortMode = 'time';
  assert.equal(JSON.stringify(api.filteredSessions().map((session) => session.id).sort()), JSON.stringify(['newer_favorite', 'old', 'older_favorite']));
  assert.equal(JSON.stringify(api.sortedSessions().map((session) => session.id)), JSON.stringify(['newer_favorite', 'older_favorite', 'old']));
});

test('favorites tab fetches only favorites and recents loads all sessions on demand', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions?favorite=true') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'favorite_session', favorite: true, settings: { metadata: {} } }],
          }),
        };
      }
      if (path === '/api/sessions') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'favorite_session', favorite: true, settings: { metadata: {} } },
              { id: 'time_session', favorite: false, settings: { metadata: {} } },
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sortMode = 'favorites';

  await api.refreshSessionsList({ renderAfter: false });

  assert.deepEqual(fetchCalls, ['/api/sessions?favorite=true']);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session']));

  await api.setSessionSortMode('time');

  assert.deepEqual(fetchCalls, ['/api/sessions?favorite=true', '/api/sessions']);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session', 'time_session']));
});

test('session restore renders recents first and loads favorites only on demand', async () => {
  const pending: Array<{
    path: string;
    resolve: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
  }> = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => new Promise((resolve) => {
      pending.push({ path, resolve });
    }),
  });

  api.state.token = 'token';
  const restore = api.restoreAuth();
  await flushMicrotasks();

  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me']);
  pending[0]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({ session: { id: 'auth_1' } }),
  });
  await flushMicrotasks();

  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me', '/api/settings', '/api/models', '/api/projects', '/api/sessions']);
  pending[1]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({ settings: { siteTitle: 'Codex Web' }, permissions: { canSetSiteTitle: false } }),
  });
  pending[2]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({ items: [] }),
  });
  pending[3]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({ items: [] }),
  });
  pending[4]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        { id: 'all_session', favorite: false, updatedAt: 30, settings: { metadata: {} } },
        { id: 'favorite_session', favorite: true, updatedAt: 20, settings: { metadata: {} } },
      ],
    }),
  });
  await restore;
  await flushMicrotasks();

  assert.equal(api.state.sortMode, 'time');
  assert.equal(api.state.sessionsScope, 'all');
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['all_session', 'favorite_session']));
  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me', '/api/settings', '/api/models', '/api/projects', '/api/sessions']);

  const loadFavorites = api.setSessionSortMode('favorites');
  await flushMicrotasks();

  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me', '/api/settings', '/api/models', '/api/projects', '/api/sessions', '/api/sessions?favorite=true']);
  pending[5]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        { id: 'favorite_session', favorite: true, updatedAt: 20, settings: { metadata: {} } },
      ],
    }),
  });
  await loadFavorites;
  await flushMicrotasks();

  assert.equal(api.state.sortMode, 'favorites');
  assert.equal(api.state.sessionsScope, 'favorites');
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session']));
  assert.equal(JSON.stringify(api.state.sessionsByScope.favorites.map((session) => session.id)), JSON.stringify(['favorite_session']));
});

test('all tab does not show stale favorites while full sessions are loading', async () => {
  const pending: Array<{
    path: string;
    resolve: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
  }> = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => new Promise((resolve) => {
      pending.push({ path, resolve });
    }),
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sortMode = 'favorites';
  api.state.sessionsScope = 'favorites';
  api.state.sessions = [
    { id: 'old_favorite', favorite: true, updatedAt: 5, settings: { metadata: {} } },
  ];

  const favoritesRefresh = api.refreshSessionsList({ renderAfter: false, scope: 'favorites' });
  const timeSwitch = api.setSessionSortMode('time');

  assert.deepEqual(pending.map((request) => request.path), ['/api/sessions?favorite=true', '/api/sessions']);
  assert.equal(api.state.sortMode, 'time');
  assert.equal(api.state.sessionsLoading, true);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify([]));
  assert.match(api.renderSessionCards(), /Loading sessions/u);

  pending[0]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      items: [{ id: 'late_favorite', favorite: true, updatedAt: 10, settings: { metadata: {} } }],
    }),
  });
  await favoritesRefresh;

  assert.equal(api.state.sortMode, 'time');
  assert.equal(api.state.sessionsLoading, true);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify([]));

  pending[1]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        { id: 'favorite_session', favorite: true, updatedAt: 20, settings: { metadata: {} } },
        { id: 'time_session', favorite: false, updatedAt: 30, settings: { metadata: {} } },
      ],
    }),
  });
  await timeSwitch;

  assert.equal(api.state.sessionsLoading, false);
  assert.equal(api.state.sessionsScope, 'all');
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session', 'time_session']));
});

test('all tab rerenders in time order when session detail refresh finishes after returning to list', async () => {
  let resolveSessionDetail: ((response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | null = null;
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_recent/status') {
        return await new Promise((resolve) => {
          resolveSessionDetail = resolve;
        });
      }
      if (path === '/api/sessions/session_recent/timeline?limit=50') {
        return { ok: true, status: 200, json: async () => ({ items: [], hasMore: false, nextBefore: null }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sortMode = 'time';
  api.state.sessionsScope = 'all';
  api.state.sessionsLoadedByScope.all = true;
  api.state.sessions = [
    { id: 'session_other', cwd: '/repo/other', firstUserInput: 'Other first', lastUserInput: 'Other prompt', lastInputAt: 200, updatedAt: 200, settings: { metadata: {} } },
    { id: 'session_recent', cwd: '/repo/recent', firstUserInput: 'Old first', lastUserInput: 'Old prompt', lastInputAt: 100, updatedAt: 100, settings: { metadata: {} } },
  ];
  api.state.sessionsByScope.all = [...api.state.sessions];

  api.render();
  const selectPromise = api.selectSession('session_recent');
  api.showSessionList();

  assert.ok(context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_other"') < context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_recent"'));

  assert.equal(typeof resolveSessionDetail, 'function');
  resolveSessionDetail({
    ok: true,
    status: 200,
    json: async () => ({
      session: {
        id: 'session_recent',
        cwd: '/repo/recent',
        lastUserInput: 'Newest prompt',
        lastInputAt: 300,
        updatedAt: 300,
        settings: { metadata: {} },
        thread: { turns: [] },
      },
    }),
  });
  await selectPromise;
  await flushMicrotasks();

  assert.equal(api.state.view, 'sessions');
  assert.ok(context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_recent"') < context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_other"'));
});

test('all tab rerenders in time order when background session refresh finishes after returning to list', async () => {
  let resolveSessionRefresh: ((response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | null = null;
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_recent/status') {
        return await new Promise((resolve) => {
          resolveSessionRefresh = resolve;
        });
      }
      if (path === '/api/sessions/session_recent/timeline?limit=50') {
        return { ok: true, status: 200, json: async () => ({ items: [], hasMore: false, nextBefore: null }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sortMode = 'time';
  api.state.sessionsScope = 'all';
  api.state.sessionsLoadedByScope.all = true;
  api.state.sessionId = 'session_recent';
  api.state.currentSession = { id: 'session_recent', cwd: '/repo/recent', firstUserInput: 'Old first', lastUserInput: 'Old prompt', lastInputAt: 100, updatedAt: 100, settings: { metadata: {} } };
  api.state.sessions = [
    { id: 'session_other', cwd: '/repo/other', firstUserInput: 'Other first', lastUserInput: 'Other prompt', lastInputAt: 200, updatedAt: 200, settings: { metadata: {} } },
    api.state.currentSession,
  ];
  api.state.sessionsByScope.all = [...api.state.sessions];
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Old prompt' },
  ];

  api.render();
  const refreshPromise = api.refreshCurrentSessionMetadata();
  api.showSessionList();

  assert.ok(context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_other"') < context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_recent"'));

  assert.equal(typeof resolveSessionRefresh, 'function');
  resolveSessionRefresh({
    ok: true,
    status: 200,
    json: async () => ({
      session: {
        id: 'session_recent',
        cwd: '/repo/recent',
        lastUserInput: 'Newest prompt',
        lastInputAt: 300,
        updatedAt: 300,
        settings: { metadata: {} },
        thread: { turns: [] },
      },
    }),
  });
  await refreshPromise;
  await flushMicrotasks();

  assert.equal(api.state.view, 'sessions');
  assert.ok(context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_recent"') < context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_other"'));
});

test('all tab uses newer updatedAt when refreshed session omits lastInputAt', async () => {
  let resolveSessionRefresh: ((response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | null = null;
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_recent/status') {
        return await new Promise((resolve) => {
          resolveSessionRefresh = resolve;
        });
      }
      if (path === '/api/sessions/session_recent/timeline?limit=50') {
        return { ok: true, status: 200, json: async () => ({ items: [], hasMore: false, nextBefore: null }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sortMode = 'time';
  api.state.sessionsScope = 'all';
  api.state.sessionsLoadedByScope.all = true;
  api.state.sessionId = 'session_recent';
  api.state.currentSession = { id: 'session_recent', cwd: '/repo/recent', firstUserInput: 'Old first', lastUserInput: 'Old prompt', lastInputAt: 100, updatedAt: 100, settings: { metadata: {} } };
  api.state.sessions = [
    { id: 'session_other', cwd: '/repo/other', firstUserInput: 'Other first', lastUserInput: 'Other prompt', lastInputAt: 200, updatedAt: 200, settings: { metadata: {} } },
    api.state.currentSession,
  ];
  api.state.sessionsByScope.all = [...api.state.sessions];
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Old prompt' },
  ];

  api.render();
  const refreshPromise = api.refreshCurrentSessionMetadata();
  api.showSessionList();

  assert.ok(context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_other"') < context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_recent"'));

  assert.equal(typeof resolveSessionRefresh, 'function');
  resolveSessionRefresh({
    ok: true,
    status: 200,
    json: async () => ({
      session: {
        id: 'session_recent',
        cwd: '/repo/recent',
        lastUserInput: 'Newest prompt',
        updatedAt: 300,
        settings: { metadata: {} },
        thread: { turns: [] },
      },
    }),
  });
  await refreshPromise;
  await flushMicrotasks();

  assert.equal(api.state.view, 'sessions');
  assert.ok(context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_recent"') < context.document.querySelector('#app').innerHTML.indexOf('data-session-id="session_other"'));
});

test('favorites tab never renders manual ordering controls', async () => {
  const { api } = await loadAppHarness();

  api.state.sortMode = 'favorites';
  api.state.sessions = [
    { id: 'session_old', favorite: true, favoriteOrder: 1, updatedAt: 10, settings: { favoriteOrder: 1, metadata: {} } },
    { id: 'session_new', favorite: true, favoriteOrder: 99, updatedAt: 30, settings: { favoriteOrder: 99, metadata: {} } },
  ];

  const html = api.renderSessionCards();

  assert.equal(JSON.stringify(api.sortedSessions().map((session) => session.id)), JSON.stringify(['session_new', 'session_old']));
  assert.doesNotMatch(html, /data-session-favorite-move-id/u);
  assert.doesNotMatch(html, /data-session-favorite-move=/u);
  assert.match(html, /data-session-favorite-id="session_new"/u);
  assert.match(html, /data-session-archive-request-id="session_new"/u);
});

test('session list shows loading state while sessions are still syncing', async () => {
  const { api } = await loadAppHarness();

  api.state.sessions = [];
  api.state.sortMode = 'time';
  api.state.sessionsLoading = true;
  api.state.sessionsLoadingScope = 'all';

  assert.match(api.renderSessionCards(), /Loading sessions/u);

  api.state.sessionsLoading = false;
  api.state.sessionsLoadingScope = null;
  assert.match(api.renderSessionCards(), /No sessions yet/u);
});

test('session refresh keeps visible cached sessions while a slow network request is pending', async () => {
  let resolveFetch: ((value: unknown) => void) | null = null;
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions') {
        return await new Promise((resolve) => {
          resolveFetch = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sortMode = 'time';
  api.state.sessions = [
    { id: 'session_cached', cwd: '/repo', firstUserInput: 'Cached prompt', updatedAt: 10, settings: { metadata: {} } },
  ];
  api.state.sessionsByScope.all = [...api.state.sessions];
  api.state.sessionsLoadedByScope.all = true;

  const refresh = api.refreshSessionsList({ renderAfter: false, scope: 'all' });

  assert.equal(api.state.sessionsLoading, true);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_cached']));
  assert.match(api.renderSessionCards(), /Cached prompt/u);

  resolveFetch?.({
    ok: true,
    status: 200,
    json: async () => ({ items: [{ id: 'session_fresh', cwd: '/repo', firstUserInput: 'Fresh prompt', updatedAt: 20, settings: { metadata: {} } }] }),
  });
  await refresh;

  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_fresh']));
});

test('session list restores cached summaries from local storage before network sync completes', async () => {
  let resolveFetch: ((value: unknown) => void) | null = null;
  const { api, storage } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions') {
        return await new Promise((resolve) => {
          resolveFetch = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  storage.set('codexWebSessionsCache', JSON.stringify({
    scopes: {
      all: [
        { id: 'session_cached', cwd: '/repo', firstUserInput: 'Cached prompt', updatedAt: 10, settings: { metadata: {} } },
      ],
    },
  }));

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sortMode = 'time';

  const refresh = api.refreshSessionsList({ renderAfter: false, scope: 'all' });

  assert.equal(api.state.sessionsLoading, true);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_cached']));
  assert.match(api.renderSessionCards(), /Cached prompt/u);

  resolveFetch?.({
    ok: true,
    status: 200,
    json: async () => ({ items: [{ id: 'session_fresh', cwd: '/repo', firstUserInput: 'Fresh prompt', updatedAt: 20, settings: { metadata: {} } }] }),
  });
  await refresh;

  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_fresh']));
  assert.match(storage.get('codexWebSessionsCache') || '', /session_fresh/u);
});

test('auth expiration clears cached session summaries from local storage', async () => {
  const { api, storage } = await loadAppHarness();

  storage.set('codexWebToken', 'token');
  storage.set('codexWebSessionsCache', JSON.stringify({
    scopes: {
      all: [{ id: 'session_cached', cwd: '/repo', firstUserInput: 'Cached prompt' }],
    },
  }));
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };

  api.handleApiError({ status: 401, payload: { message: 'Session expired' } });

  assert.equal(storage.get('codexWebToken'), undefined);
  assert.equal(storage.get('codexWebSessionsCache'), undefined);
  assert.equal(api.state.authSession, null);
});

test('auth expiration prevents late session and file responses from restoring logged-out state', async () => {
  let releaseSessionDetail: ((payload: unknown) => void) | null = null;
  let releaseSessionList: ((payload: unknown) => void) | null = null;
  let releaseFileResolve: ((payload: unknown) => void) | null = null;
  const delayedJson = (release: (value: (payload: unknown) => void) => void) => ({
    ok: true,
    status: 200,
    json: async () => await new Promise((resolve) => {
      release(resolve);
    }),
  });
  const { api, storage } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_active/status') {
        return delayedJson((resolve) => {
          releaseSessionDetail = resolve;
        });
      }
      if (path === '/api/sessions') {
        return delayedJson((resolve) => {
          releaseSessionList = resolve;
        });
      }
      if (path === '/api/sessions/session_active/files/resolve') {
        return delayedJson((resolve) => {
          releaseFileResolve = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  storage.set('codexWebToken', 'token');
  storage.set('codexWebSessionsCache', JSON.stringify({
    scopes: {
      all: [{ id: 'session_active', cwd: '/repo', firstUserInput: 'Cached prompt' }],
    },
  }));
  storage.set('codexWebTimelineCache', JSON.stringify({
    entries: [{ sessionId: 'session_active', timeline: [{ id: 'cached_message', text: 'Cached answer' }] }],
  }));
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_active';
  api.state.currentSession = { id: 'session_active', cwd: '/repo', settings: { metadata: {} } };
  api.state.sessions = [api.state.currentSession];
  api.state.sessionsByScope.all = [api.state.currentSession];

  const pendingSessionDetail = api.refreshCurrentSessionMetadata();
  const pendingSessionList = api.refreshSessionsList({ renderAfter: false, scope: 'all' });
  const pendingFile = api.openSessionFileByPath('docs/late.md');
  await flushMicrotasks();

  assert.equal(typeof releaseSessionDetail, 'function');
  assert.equal(typeof releaseSessionList, 'function');
  assert.equal(typeof releaseFileResolve, 'function');

  api.handleApiError({ status: 401, payload: { message: 'Session expired' } });

  releaseSessionDetail?.({
    session: { id: 'session_active', cwd: '/late-detail', firstUserInput: 'Late detail response', settings: { metadata: {} } },
  });
  releaseSessionList?.({
    items: [{ id: 'session_late_list', cwd: '/late-list', firstUserInput: 'Late list response', settings: { metadata: {} } }],
  });
  releaseFileResolve?.({
    file: { id: 'file_late', name: 'late.md', kind: 'markdown', contentUrl: '/api/sessions/session_active/files/file_late/content' },
  });
  await Promise.all([pendingSessionDetail, pendingSessionList, pendingFile]);

  assert.equal(api.state.authSession, null);
  assert.equal(api.state.sessionId, null);
  assert.equal(api.state.currentSession, null);
  assert.equal(api.state.currentSessionFile, null);
  assert.equal(api.state.currentSessionFileContent, '');
  assert.equal(api.state.sessions.length, 0);
  assert.equal(api.state.sessionsByScope.favorites.length, 0);
  assert.equal(api.state.sessionsByScope.all.length, 0);
  assert.equal(api.state.sessionsByScope.archived.length, 0);
  assert.equal(storage.get('codexWebToken'), undefined);
  assert.equal(storage.get('codexWebSessionsCache'), undefined);
  assert.equal(storage.get('codexWebTimelineCache'), undefined);
  assert.doesNotMatch(JSON.stringify(api.state), /Late detail response|Late list response|file_late/u);
});

test('auth expiration prevents late session mutations from upserting or persisting session data', async () => {
  let releaseFavorite: ((payload: unknown) => void) | null = null;
  let releaseUnarchive: ((payload: unknown) => void) | null = null;
  let releaseSettings: ((payload: unknown) => void) | null = null;
  const delayedJson = (release: (value: (payload: unknown) => void) => void) => ({
    ok: true,
    status: 200,
    json: async () => await new Promise((resolve) => {
      release(resolve);
    }),
  });
  const { api, storage } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_active/favorite') {
        return delayedJson((resolve) => {
          releaseFavorite = resolve;
        });
      }
      if (path === '/api/sessions/session_active/unarchive') {
        return delayedJson((resolve) => {
          releaseUnarchive = resolve;
        });
      }
      if (path === '/api/sessions/session_active/settings') {
        return delayedJson((resolve) => {
          releaseSettings = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  const activeSession = {
    id: 'session_active',
    cwd: '/repo',
    archived: true,
    readOnly: true,
    settings: { metadata: {} },
  };
  storage.set('codexWebToken', 'token');
  storage.set('codexWebSessionsCache', JSON.stringify({
    scopes: { archived: [activeSession] },
  }));
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessionId = activeSession.id;
  api.state.currentSession = activeSession;
  api.state.sessions = [activeSession];
  api.state.sessionsByScope.archived = [activeSession];

  const pendingFavorite = api.toggleSessionFavorite(activeSession.id);
  const pendingUnarchive = api.unarchiveSession(activeSession.id);
  const pendingSettings = api.updateSessionSettings({ model: 'gpt-5-mini', reasoningEffort: 'low' });
  await flushMicrotasks();

  assert.equal(typeof releaseFavorite, 'function');
  assert.equal(typeof releaseUnarchive, 'function');
  assert.equal(typeof releaseSettings, 'function');

  api.handleApiError({ status: 401, payload: { message: 'Session expired' } });

  releaseFavorite?.({
    session: {
      id: activeSession.id,
      cwd: '/late-favorite',
      favorite: true,
      firstUserInput: 'Late favorite response',
      settings: { metadata: {} },
    },
  });
  releaseUnarchive?.({
    session: {
      id: activeSession.id,
      cwd: '/late-unarchive',
      archived: false,
      firstUserInput: 'Late unarchive response',
      settings: { metadata: {} },
    },
  });
  releaseSettings?.({
    session: {
      id: activeSession.id,
      cwd: '/late-settings',
      firstUserInput: 'Late settings response',
      settings: { metadata: { source: 'late-settings' } },
    },
  });
  await Promise.all([pendingFavorite, pendingUnarchive, pendingSettings]);

  assert.equal(api.state.authSession, null);
  assert.equal(api.state.sessionId, null);
  assert.equal(api.state.currentSession, null);
  assert.equal(api.state.sessions.length, 0);
  assert.equal(api.state.sessionsByScope.favorites.length, 0);
  assert.equal(api.state.sessionsByScope.all.length, 0);
  assert.equal(api.state.sessionsByScope.archived.length, 0);
  assert.equal(storage.get('codexWebToken'), undefined);
  assert.equal(storage.get('codexWebSessionsCache'), undefined);
  assert.doesNotMatch(JSON.stringify(api.state), /Late favorite response|Late unarchive response|Late settings response/u);
});

test('archived session scope requests the archived sessions endpoint and marks read-only summaries', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions?state=archived') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'session_archived', updatedAt: 10, settings: { metadata: {} } },
            ],
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'user_1', mode: 'multi' } };
  api.state.sortMode = 'archived';

  await api.refreshSessionsList({ renderAfter: false, scope: 'archived' });

  assert.deepEqual(fetchCalls, ['/api/sessions?state=archived']);
  assert.equal(api.state.sessionsScope, 'archived');
  assert.equal(api.state.sessions[0]?.id, 'session_archived');
  assert.equal(api.state.sessions[0]?.archived, true);
  assert.equal(api.state.sessions[0]?.readOnly, true);
  assert.equal(api.filteredSessions()[0]?.id, 'session_archived');
});

test('opening archived session details never writes them back into recents or favorites', async () => {
  const { api, storage } = await loadAppHarness();
  const archivedSession = {
    id: 'session_archived',
    cwd: '/repo',
    archived: true,
    readOnly: true,
    favorite: true,
    updatedAt: 1,
    settings: { metadata: {} },
  };
  api.state.authSession = { id: 'auth_1' };
  api.state.sortMode = 'archived';
  api.state.sessionsScope = 'archived';
  api.state.sessions = [archivedSession];
  api.state.sessionsByScope.archived = [archivedSession];

  api.upsertSession({
    id: archivedSession.id,
    cwd: '/repo',
    favorite: true,
    updatedAt: 2,
    settings: { metadata: {} },
  });

  assert.equal(api.state.sessionsByScope.all.length, 0);
  assert.equal(api.state.sessionsByScope.favorites.length, 0);
  assert.equal(api.state.sessionsByScope.archived.length, 1);
  api.state.sortMode = 'time';
  assert.equal(api.filteredSessions().length, 0);
  api.state.sortMode = 'favorites';
  assert.equal(api.filteredSessions().length, 0);
  const cached = JSON.parse(storage.get('codexWebSessionsCache'));
  assert.equal(cached.scopes.all.length, 0);
  assert.equal(cached.scopes.favorites.length, 0);
  assert.equal(cached.scopes.archived.length, 1);
});

test('recents cache restore drops archived summaries before a weak-network refresh', async () => {
  let resolveFetch: ((value: unknown) => void) | null = null;
  const activeSession = { id: 'session_active', updatedAt: 2, settings: { metadata: {} } };
  const archivedSession = { id: 'session_archived', archived: true, updatedAt: 1, settings: { metadata: {} } };
  const { api, storage } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions') {
        return await new Promise((resolve) => {
          resolveFetch = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  storage.set('codexWebSessionsCache', JSON.stringify({
    scopes: {
      all: [activeSession, archivedSession],
      favorites: [archivedSession],
      archived: [archivedSession],
    },
  }));
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };

  const refresh = api.refreshSessionsList({ renderAfter: false, scope: 'all' });

  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_active']));
  assert.equal(JSON.stringify(api.state.sessionsByScope.all.map((session) => session.id)), JSON.stringify(['session_active']));
  assert.equal(api.state.sessionsByScope.favorites.length, 0);
  resolveFetch?.({
    ok: true,
    status: 200,
    json: async () => ({ items: [activeSession] }),
  });
  await refresh;
});

test('archive action blocks a delayed active-list response from restoring the session', async () => {
  let releaseList: (() => void) | null = null;
  const session = { id: 'session_1', updatedAt: 1, settings: { metadata: {} } };
  const { api, storage } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions') {
        return await new Promise((resolve) => {
          releaseList = () => resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [session] }),
          });
        });
      }
      if (path === '/api/sessions/session_1/archive') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [session];
  api.state.sessionsByScope.all = [session];

  const refresh = api.refreshSessionsList({ renderAfter: false, scope: 'all' });
  await flushMicrotasks();
  assert.equal(typeof releaseList, 'function');
  await api.archiveSession(session.id);
  releaseList?.();
  await refresh;

  assert.equal(api.state.sessions.length, 0);
  assert.equal(api.state.sessionsByScope.all.length, 0);
  assert.equal(api.filteredSessions().length, 0);
  const cached = JSON.parse(storage.get('codexWebSessionsCache'));
  assert.equal(cached.scopes.all.length, 0);
});

test('favorite action patches session favorite state without opening the session', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_1',
            cwd: '/repo',
            favorite: JSON.parse(options.body).favorite,
            updatedAt: 1,
            settings: { metadata: {} },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{ id: 'session_1', settings: { metadata: {} } }];

  await api.toggleSessionFavorite('session_1');

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.path, '/api/sessions/session_1/favorite');
  assert.equal(fetchCalls[0]?.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(fetchCalls[0]?.options.body), {
    favorite: true,
  });
  assert.equal(api.state.sessions[0]?.favorite, true);
});

test('archive action requires a confirmation dialog before deleting a session', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(app, /archiveConfirmSessionId:\s*null/u);
  assert.match(app, /renderArchiveConfirmModal\(\)/u);
  assert.match(app, /role="dialog"/u);
  assert.match(app, /data-session-archive-request-id/u);
  assert.match(app, /data-session-archive-confirm-id/u);
  assert.match(app, /function requestArchiveSession\(sessionId\)/u);
  assert.match(app, /const archiveSessionId = button\.getAttribute\('data-session-archive-request-id'\);[\s\S]*requestArchiveSession\(archiveSessionId\);/u);
  assert.match(app, /archiveSession\(button\.getAttribute\('data-session-archive-confirm-id'\) \|\| ''\)/u);
  assert.doesNotMatch(app, /archiveSession\(button\.getAttribute\('data-session-archive-id'\) \|\| ''\)/u);
  assert.match(app, /<button class="ghost compact-button" type="button" id="archive-cancel-button" data-initial-focus>Cancel<\/button>/u);
  assert.match(app, /<button class="danger compact-button" type="button" data-session-archive-confirm-id="\$\{escapeAttribute\(session\.id\)\}">Archive<\/button>/u);
  assert.match(styles, /\.modal-backdrop\s*\{/u);
  assert.match(styles, /\.confirm-dialog\s*\{/u);
});

test('archive and unarchive actions use explicit archive endpoints', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1/archive' || path === '/api/sessions/session_1/unarchive') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            session: {
              id: 'session_1',
              archived: path.endsWith('/unarchive') ? false : true,
              settings: { metadata: {} },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{ id: 'session_1', updatedAt: 1, settings: { metadata: {} } }];
  api.state.sessionsByScope.all = [{ id: 'session_1', updatedAt: 1, settings: { metadata: {} } }];
  api.state.sessionsLoadedByScope.all = true;

  await api.archiveSession('session_1');
  assert.equal(fetchCalls[0]?.path, '/api/sessions/session_1/archive');
  assert.equal(fetchCalls[0]?.options.method, 'POST');

  api.state.sessions = [{ id: 'session_1', archived: true, readOnly: true, updatedAt: 1, settings: { metadata: {} } }];
  api.state.sessionsByScope.archived = [{ id: 'session_1', archived: true, readOnly: true, updatedAt: 1, settings: { metadata: {} } }];
  api.state.sessionsLoadedByScope.archived = true;
  api.state.sessionsScope = 'archived';

  await api.unarchiveSession('session_1');
  assert.equal(fetchCalls[1]?.path, '/api/sessions/session_1/unarchive');
  assert.equal(fetchCalls[1]?.options.method, 'POST');
});

test('archive action invalidates a previously empty archived session cache', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1/archive') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      }
      if (path === '/api/sessions?state=archived') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'session_1', archived: true, readOnly: true, updatedAt: 1, settings: { metadata: {} } },
            ],
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sortMode = 'time';
  api.state.sessions = [{ id: 'session_1', updatedAt: 1, settings: { metadata: {} } }];
  api.state.sessionsByScope.all = [{ id: 'session_1', updatedAt: 1, settings: { metadata: {} } }];
  api.state.sessionsLoadedByScope.all = true;
  api.state.sessionsByScope.archived = [];
  api.state.sessionsLoadedByScope.archived = true;

  await api.archiveSession('session_1');
  await api.setSessionSortMode('archived');

  assert.deepEqual(fetchCalls.map((call) => call.path), [
    '/api/sessions/session_1/archive',
    '/api/sessions?state=archived',
  ]);
  assert.equal(api.state.sessionsLoadedByScope.archived, true);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_1']));
});

test('session creation surfaces active session limit backend messages', async () => {
  const { api } = await loadAppHarness({
    fetch: async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'active_session_limit_reached',
        message: 'Archive an existing session before creating a new one.',
      }),
    }),
  });

  api.state.token = 'token';
  api.state.authSession = {
    id: 'auth_1',
    principal: {
      userId: 'user_1',
      username: 'alice',
      roleIds: ['role_user'],
      isAdmin: false,
      mode: 'multi',
    },
  };
  api.state.projects = [{ id: 'project_a', displayName: 'Project Alpha' }];
  api.state.projectsLoaded = true;
  api.state.newProjectId = 'project_a';

  await assert.rejects(() => api.ensureSession(), /Archive an existing session before creating a new one\./u);

  try {
    await api.ensureSession();
  } catch (error) {
    api.handleApiError(error);
  }

  assert.equal(api.state.error, 'Archive an existing session before creating a new one.');
  assert.equal(api.state.status, 'Request failed');
});

test('PWA standalone mode enables local pull-to-refresh without normal browser refresh hooks', async () => {
  const [index, app, serviceWorker, pullRefresh] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(serviceWorkerUrl, 'utf8'),
    readFile(pwaPullRefreshUrl, 'utf8'),
  ]);

  assert.match(index, /<script src="\/pwa-pull-refresh\.js\?v=__CODEX_WEB_BUILD_ID__"><\/script>/u);
  assert.match(serviceWorker, /'\/pwa-pull-refresh\.js'/u);
  assert.match(app, /function isStandalonePwa\(\)/u);
  assert.match(app, /navigator\.standalone === true/u);
  assert.match(app, /matchMedia\('\(display-mode: standalone\)'\)/u);
  assert.match(app, /function setupPwaPullToRefresh\(\)/u);
  assert.match(app, /window\.CodexPullToRefresh\.init/u);
  assert.match(app, /refreshCurrentView\(\)/u);
  assert.match(app, /threshold:\s*120/u);
  assert.doesNotMatch(app, /onRefresh:\s*\([^)]*\)\s*=>\s*window\.location\.reload\(\)/u);
  assert.match(pullRefresh, /window\.CodexPullToRefresh/u);
  assert.match(pullRefresh, /touchstart/u);
  assert.match(pullRefresh, /touchmove/u);
  assert.match(pullRefresh, /const DEFAULT_THRESHOLD = 112;/u);
});

test('PWA chat pull gestures expand timeline history while title pulls refresh the session', async () => {
  const [app, pullRefresh] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(pwaPullRefreshUrl, 'utf8'),
  ]);

  assert.match(pullRefresh, /startTarget/u);
  assert.match(pullRefresh, /getScrollContainer\(\{[\s\S]*target/su);
  assert.match(pullRefresh, /const target = startTarget/u);
  assert.match(pullRefresh, /onRefresh\(\{[\s\S]*target,/su);
  assert.match(app, /function handlePwaPullRefresh\(/u);
  assert.match(app, /function getActiveScrollContainer\(pull = \{\}\)/u);
  assert.match(app, /isTimelinePullTarget/u);
  assert.match(app, /showMoreSessionHistory\(\)/u);
  assert.match(app, /isChatTitlePullTarget/u);
  assert.match(app, /refreshCurrentView\(\)/u);
  assert.match(app, /onRefresh:\s*\(pull\)\s*=>\s*\{/u);
});

test('PWA pull refresh is disabled on the admin console so downward scroll does not trigger refresh', async () => {
  const [pullRefresh, { api }] = await Promise.all([
    readFile(pwaPullRefreshUrl, 'utf8'),
    loadAppHarness(),
  ]);

  api.state.view = 'admin';

  assert.equal(api.getActiveScrollContainer({ target: null }), false);
  assert.match(pullRefresh, /container === false/u);
});

test('PWA refresh updates the current view instead of reloading the app', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions?favorite=true' || path === '/api/sessions') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'session_fresh', favorite: true, settings: { metadata: {} } }],
          }),
        };
      }
      if (path === '/api/sessions/session_fresh') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_fresh',
              favorite: true,
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    items: [
                      { type: 'message', role: 'user', text: 'Latest question' },
                      { type: 'message', role: 'assistant', text: 'Latest answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';

  await api.refreshCurrentView();
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_fresh']));

  api.state.view = 'chat';
  api.state.sessionId = 'session_fresh';
  api.state.currentSession = api.state.sessions[0];
  await api.refreshCurrentView();

  assert.deepEqual(fetchCalls, [
    '/api/sessions',
    '/api/sessions/session_fresh/status',
    '/api/sessions/session_fresh/timeline?limit=50',
    '/api/sessions/session_fresh',
  ]);
  assert.match(api.state.timeline.map((item) => item.text).join('\n'), /Latest answer/u);
});

test('PWA foreground recovery refreshes session history and reconnects unhealthy turn streams', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/u);
  assert.match(app, /window\.addEventListener\('pageshow', onPageResume\)/u);
  assert.match(app, /window\.addEventListener\('focus', onPageResume\)/u);
  assert.match(app, /function onVisibilityChange\(\)/u);
  assert.match(app, /function onPageResume\(\)/u);
  assert.match(app, /state\.streamWasBackgrounded = true/u);
  assert.match(app, /function isTurnStreamHealthy\(\)/u);
  assert.match(app, /function recoverActiveTurnAfterForeground\(\)/u);
  assert.match(app, /recoverActiveTurnIfStreamUnhealthy\(\{[\s\S]*viewportSnapshot,/u);
  assert.match(app, /connectActiveTurnStream\(\{ forceReconnect: true \}\)/u);
  assert.match(app, /lastTurnEventSequence/u);
  assert.match(app, /after=\$\{encodeURIComponent\(String\(state\.lastTurnEventSequence\)\)\}/u);
});

test('stream watchdog does not poll session metadata while the open session is idle', async () => {
  let watchdog: (() => void) | null = null;
  const fetchCalls: string[] = [];
  const { api } = await loadAppHarness({
    setInterval: (callback) => {
      watchdog = callback;
      return 1;
    },
    fetch: async (path) => {
      fetchCalls.push(path);
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessionId = 'session_idle';
  api.state.currentSession = { id: 'session_idle', cwd: '/repo' };
  api.state.pendingTurn = false;
  api.state.turnId = null;

  assert.equal(typeof watchdog, 'function');
  watchdog?.();
  await flushMicrotasks();

  assert.deepEqual(fetchCalls, []);
});

test('duplicate foreground recovery triggers share one compact reconciliation', async () => {
  const fetchCalls: string[] = [];
  let releaseStatus: ((response: unknown) => void) | null = null;
  let releaseTimeline: ((response: unknown) => void) | null = null;
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_foreground/status') {
        return await new Promise((resolve) => {
          releaseStatus = resolve;
        });
      }
      if (path === '/api/sessions/session_foreground/timeline?limit=50') {
        return await new Promise((resolve) => {
          releaseTimeline = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_foreground';
  api.state.currentSession = { id: 'session_foreground', cwd: '/repo' };

  const first = api.recoverActiveTurnAfterForeground();
  const duplicate = api.recoverActiveTurnAfterForeground();

  assert.deepEqual(fetchCalls, [
    '/api/sessions/session_foreground/status',
    '/api/sessions/session_foreground/timeline?limit=50',
  ]);
  releaseStatus?.({
    ok: true,
    status: 200,
    json: async () => ({ session: { id: 'session_foreground', cwd: '/repo' } }),
  });
  releaseTimeline?.({
    ok: true,
    status: 200,
    json: async () => ({ items: [], hasMore: false, nextBefore: null }),
  });
  await Promise.all([first, duplicate]);
});

test('terminal event metadata refresh requests status without downloading timeline history', async () => {
  const fetchCalls: string[] = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_terminal_status/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session: { id: 'session_terminal_status', cwd: '/repo', activeTurnId: null } }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_terminal_status';
  api.state.currentSession = { id: 'session_terminal_status', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_terminal_status';

  api.applyTurnEvent({
    type: 'turn.completed',
    turnId: 'turn_terminal_status',
    status: 'completed',
  }, null);
  await flushMicrotasks();

  assert.deepEqual(fetchCalls, ['/api/sessions/session_terminal_status/status']);
});

test('active session refresh keeps the live assistant entry instead of replacing it with history', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              activeTurnId: 'turn_1',
              settings: { metadata: {} },
              thread: {
                turns: [{
                  id: 'turn_1',
                  status: 'in_progress',
                  items: [
                    { type: 'message', role: 'user', text: 'Keep working' },
                    { type: 'message', role: 'assistant', text: 'Checking the implementation.' },
                  ],
                }],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.timeline = [
    { id: 'local_user_1', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Keep working' },
    { id: 'assistant_turn_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'commentary', text: 'Checking the implementation.' },
  ];

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  const assistantItems = api.state.timeline.filter((item) => item.role === 'assistant');
  assert.equal(assistantItems.length, 1);
  assert.equal(assistantItems[0]?.id, 'assistant_turn_1');
});

test('history hydration deduplicates the same turn message across unstable provider ids', async () => {
  const { api } = await loadAppHarness();
  const timeline = api.hydrateTimelineFromSession({
    id: 'session_duplicate_projection',
    thread: {
      turns: [{
        id: 'turn_duplicate_projection',
        status: 'in_progress',
        items: [
          { id: 'user_first', type: 'message', role: 'user', text: 'Send this once' },
          { id: 'user_second', type: 'userMessage', role: 'user', text: 'Send this once' },
          { id: 'assistant_first', type: 'message', role: 'assistant', phase: 'commentary', text: 'Received once' },
          { id: 'assistant_second', type: 'agentMessage', role: 'assistant', phase: 'commentary', text: 'Received once' },
        ],
      }],
    },
  });

  assert.equal(JSON.stringify(timeline.map((item) => [item.role, item.text])), JSON.stringify([
    ['user', 'Send this once'],
    ['assistant', 'Received once'],
  ]));
});

test('initial SSE replay replaces active-turn history instead of duplicating it', async () => {
  let readCount = 0;
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/turns/turn_1/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => {
                readCount += 1;
                if (readCount === 1) {
                  return {
                    done: false,
                    value: new TextEncoder().encode(
                      'id: 1\ndata: {"type":"assistant.delta","turnId":"turn_1","text":"Checking the implementation.","phase":"commentary","sequence":1}\n\n',
                    ),
                  };
                }
                return { done: true };
              },
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.lastTurnEventSequence = null;
  api.state.timeline = [
    { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Keep working' },
    { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Checking the implementation.' },
  ];

  await api.streamTurnEvents('turn_1');

  const assistantItems = api.state.timeline.filter((item) => item.role === 'assistant');
  assert.equal(assistantItems.length, 1);
  assert.equal(assistantItems[0]?.id, 'assistant_turn_1');
  assert.equal(assistantItems[0]?.text, 'Checking the implementation.');
});

test('terminal session history is authoritative and rejects late started and final frames for the same turn', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_terminal');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_terminal',
            cwd: '/repo',
            activeTurnId: null,
            thread: {
              turns: [{
                id: 'turn_terminal',
                status: 'completed',
                items: [
                  { itemId: 'user_terminal', type: 'message', role: 'user', text: 'Finish it' },
                  { itemId: 'final_terminal', type: 'agentMessage', role: 'assistant', phase: 'final_answer', text: 'Authoritative final' },
                ],
              }],
            },
          },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_terminal';
  api.state.currentSession = { id: 'session_terminal', cwd: '/repo' };
  api.state.turnId = 'turn_terminal';
  api.state.pendingTurn = true;
  api.state.timeline = [{
    id: 'assistant_turn_terminal_partial',
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    meta: 'commentary',
    text: 'Temporary partial answer',
    turnId: 'turn_terminal',
    source: 'stream',
  }];

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });
  api.applyTurnEvent({ type: 'turn.started', turnId: 'turn_terminal' }, null);
  api.applyTurnEvent({
    type: 'assistant.final',
    turnId: 'turn_terminal',
    itemId: 'final_terminal',
    eventType: 'completed',
    text: 'Late duplicate final',
    delta: '',
  }, null);

  const assistantItems = api.state.timeline.filter((item) => item.role === 'assistant');
  assert.equal(assistantItems.length, 1);
  assert.equal(assistantItems[0]?.id, 'assistant_turn_terminal_final_terminal');
  assert.equal(assistantItems[0]?.text, 'Authoritative final');
  assert.equal(api.state.terminalTurnIds.has('turn_terminal'), true);
  assert.equal(api.state.pendingTurn, false);
});

test('approval resolution can settle after terminal while late assistant content stays rejected', async () => {
  const { api } = await loadAppHarness();
  api.state.currentSession = { id: 'session_terminal_approval', cwd: '/repo' };
  api.state.sessionId = 'session_terminal_approval';
  api.state.terminalTurnIds.add('turn_terminal_approval');
  api.state.approvals.set('approval_late', {
    id: 'approval_approval_late',
    kind: 'approval',
    approvalId: 'approval_late',
    turnId: 'turn_terminal_approval',
    summary: {},
    resolved: false,
  });
  api.state.batches.set('batch_late', {
    id: 'batch_batch_late',
    kind: 'batch',
    turnId: 'turn_terminal_approval',
    batchId: 'batch_late',
    batchKind: 'command',
    title: 'npm test',
    status: 'started',
    summary: {},
  });

  api.applyTurnEvent({
    type: 'approval.resolved',
    turnId: 'turn_terminal_approval',
    approvalId: 'approval_late',
    decision: 'accepted',
  }, null);
  api.applyTurnEvent({
    type: 'batch.completed',
    turnId: 'turn_terminal_approval',
    batchId: 'batch_late',
    status: 'completed',
  }, null);
  api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_terminal_approval',
    itemId: 'late_commentary',
    eventType: 'completed',
    phase: 'commentary',
    text: 'Must not appear',
    delta: '',
  }, null);

  assert.equal(api.state.approvals.get('approval_late')?.resolved, true);
  assert.equal(api.state.batches.get('batch_late')?.status, 'completed');
  assert.doesNotMatch(JSON.stringify(api.state.timeline), /Must not appear/u);
});

test('foreground recovery keeps the latest chat message visible after browser resume resets scroll to top', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              activeTurnId: 'turn_active',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from phone' },
                      { type: 'message', role: 'assistant', text: 'Latest answer from history' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Question from phone' },
    { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Latest answer from history' },
  ];
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1200;
  timeline.clientHeight = 400;
  timeline.scrollTop = 800;
  api.updateTimelineFollowState();

  context.document.visibilityState = 'hidden';
  context.onVisibilityChange();

  timeline.scrollTop = 0;
  context.document.visibilityState = 'visible';
  await context.recoverActiveTurnAfterForeground();

  const restoredTimeline = context.document.querySelector('#timeline');
  assert.equal(api.state.timelineShouldFollowLatest, true);
  assert.equal(restoredTimeline.scrollTop, restoredTimeline.scrollHeight);
});

test('foreground recovery keeps the latest chat message visible even when hidden lifecycle was skipped', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from phone' },
                      { type: 'message', role: 'assistant', text: 'Latest answer from history' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Question from phone' },
    { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Latest answer from history' },
  ];
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1200;
  timeline.clientHeight = 400;
  timeline.scrollTop = 800;
  api.updateTimelineFollowState();

  timeline.scrollTop = 0;
  await context.recoverActiveTurnAfterForeground();

  const restoredTimeline = context.document.querySelector('#timeline');
  assert.equal(api.state.timelineShouldFollowLatest, true);
  assert.equal(restoredTimeline.scrollTop, restoredTimeline.scrollHeight);
});

test('desktop foreground recovery ignores stale historical viewport and keeps latest visible', async () => {
  const { api, context } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Old question' },
                      { type: 'message', role: 'assistant', text: 'Old answer' },
                    ],
                  },
                  {
                    id: 'turn_2',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Latest question' },
                      { type: 'message', role: 'assistant', text: 'Latest answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [
    { id: 'old_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Old question' },
    { id: 'old_assistant', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Old answer' },
    { id: 'latest_user', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Latest question' },
    { id: 'latest_assistant', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Latest answer' },
  ];
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1600;
  timeline.clientHeight = 400;
  timeline.scrollTop = 0;
  api.updateTimelineFollowState();

  await context.recoverActiveTurnAfterForeground();

  const restoredTimeline = context.document.querySelector('#timeline');
  assert.equal(api.state.timelineShouldFollowLatest, true);
  assert.equal(restoredTimeline.scrollTop, restoredTimeline.scrollHeight);
});

test('PWA stream network failures keep the active turn recoverable when visibility stays visible', async () => {
  const { api } = await loadAppHarness({
    fetch: async () => {
      throw new Error('Load failed');
    },
  });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = false;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  await api.streamTurnEvents('turn_1');

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_1');
  assert.equal(api.state.streamWasBackgrounded, true);
  assert.equal(api.state.status, 'Stream paused');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="warn" role="status" aria-live="polite" aria-atomic="true"><span>Working · Reconnecting</span></div>');
});

test('PWA stream ending without a terminal event keeps the active turn recoverable', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/turns/turn_1/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = false;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  await api.streamTurnEvents('turn_1');

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_1');
  assert.equal(api.state.streamWasBackgrounded, true);
  assert.equal(api.state.status, 'Stream paused');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="warn" role="status" aria-live="polite" aria-atomic="true"><span>Working · Reconnecting</span></div>');
});

test('PWA stream recovery reconnects a paused active turn while the page stays visible', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              activeTurnId: 'turn_1',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'in_progress',
                    items: [
                      { type: 'message', role: 'user', text: 'Keep working' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      if (path === '/api/turns/turn_1/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => new Promise(() => {}),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = true;
  api.state.status = 'Stream paused';
  api.state.statusTone = 'warn';

  await api.recoverActiveTurnIfStreamUnhealthy();
  await flushMicrotasks();

  assert.deepEqual(fetchCalls, [
    '/api/turns/turn_1/events',
    '/api/sessions/session_1/status',
    '/api/sessions/session_1/timeline?limit=50',
    '/api/sessions/session_1',
    '/api/turns/turn_1/events',
  ]);
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_1');
  assert.equal(api.state.streamWasBackgrounded, false);
  assert.equal(api.state.status, 'Turn running');
  assert.ok(api.state.streamAbortController);
});

test('PWA history refresh completes a paused active turn from session history', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from PWA' },
                      { type: 'message', role: 'assistant', text: 'Final answer from history' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = true;
  api.state.timeline = [
    { id: 'local_user_1', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Question from PWA' },
  ];

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.streamWasBackgrounded, false);
  assert.match(api.state.timeline.map((item) => item.text).join('\n'), /Final answer from history/u);
});

test('PWA history refresh replaces optimistic message statuses with backend history when the texts match', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from PWA' },
                      { type: 'message', role: 'assistant', text: 'Final answer from history' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = true;
  api.state.timeline = [
    { id: 'local_user_1', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Question from PWA' },
    { id: 'assistant_turn_1_final', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'final', text: 'Final answer from history' },
  ];

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.streamWasBackgrounded, false);
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.meta)), JSON.stringify(['history', 'final']));
  assert.match(api.renderTimelineItem(api.state.timeline[0]), /<span class="card-kind">history<\/span>/u);
  assert.match(api.renderTimelineItem(api.state.timeline[1]), /<span class="card-kind">final<\/span>/u);
});

test('PWA history refresh surfaces the latest failed turn as a visible error', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_failed',
                    status: 'failed',
                    error: 'unexpected status 403 Forbidden: invalid credentials',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from PWA' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  await api.refreshCurrentView();

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.status, 'Turn failed');
  assert.equal(api.state.statusTone, 'danger');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="danger" role="status" aria-live="polite" aria-atomic="true"><span>Failed</span></div>');
  assert.equal(api.state.error, '');
  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_failed');
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /403 Forbidden/u);
  assert.match(api.renderTimelineItem(errorItem), /message-card system error-message/u);
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);
});

test('composer request failures keep the optimistic user message in the retryable outbox', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: false,
          status: 429,
          json: async () => ({
            error: 'rate_limit',
            message: '429 Too Many Requests',
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.prompt = 'Question before rate limit';

  await api.onComposerSubmit({ preventDefault() {} });

  assert.deepEqual(fetchCalls, ['/api/sessions/session_1/turns']);
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Question before rate limit',
  ]));
  assert.equal(api.state.timeline[0]?.role, 'user');
  assert.equal(api.state.timeline[0]?.meta, 'pending');
  const submission = api.state.submissionOutbox.get(api.state.timeline[0]?.submissionId);
  assert.equal(submission?.status, 'failed');
  assert.equal(submission?.retryable, true);
  assert.equal(submission?.error, '429 Too Many Requests');
  assert.equal(api.state.status, 'Waiting to send');
  assert.equal(api.state.error, '');
  assert.doesNotMatch(api.renderTimelineItem(api.state.timeline[0]), /Retry send|delivery-failed/u);
});

test('opening a session surfaces a failed terminal turn as a visible error', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_failed') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_failed',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_forbidden',
                    status: 'failed',
                    error: 'unexpected status 403 Forbidden',
                    items: [
                      { type: 'message', role: 'user', text: 'Trigger auth failure' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [{ id: 'session_failed', cwd: '/repo', settings: { metadata: {} } }];

  await api.selectSession('session_failed');

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.status, 'Turn failed');
  assert.equal(api.state.statusTone, 'danger');
  assert.equal(api.state.error, '');
  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_forbidden');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /403 Forbidden/u);
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);
});

test('failed terminal turns without details still render a fallback error', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_failed_without_details',
                    status: 'failed',
                    error: null,
                    items: [
                      { type: 'message', role: 'user', text: 'No details failure' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };

  await api.refreshCurrentView();

  assert.equal(api.state.error, '');
  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_failed_without_details');
  assert.equal(errorItem?.severity, 'error');
  assert.equal(errorItem?.text, 'Turn failed');
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);
});

test('interrupted turn events render as stopped instead of interrupted', async () => {
  const { api } = await loadAppHarness();

  api.state.pendingTurn = true;
  api.state.turnId = 'turn_stop';
  api.applyTurnEvent({
    type: 'turn.completed',
    turnId: 'turn_stop',
    threadId: 'session_1',
    status: 'interrupted',
  }, null);

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.status, 'Turn stopped');
  assert.equal(api.state.statusTone, 'warn');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="warn" role="status" aria-live="polite" aria-atomic="true"><span>Stopped</span></div>');
});

test('history refresh renders interrupted terminal turns as stopped', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_cancelled',
                    status: 'cancelled',
                    items: [
                      { type: 'message', role: 'user', text: 'Stop this' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };

  await api.refreshCurrentView();

  assert.equal(api.state.status, 'Turn stopped');
  assert.equal(api.state.statusTone, 'warn');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="warn" role="status" aria-live="polite" aria-atomic="true"><span>Stopped</span></div>');
});

test('PWA history refresh clears stale running state from the latest terminal turn', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_newer_completed',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from another client' },
                      { type: 'message', role: 'assistant', text: 'Completed elsewhere' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_stale';
  api.state.streamWasBackgrounded = true;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.streamWasBackgrounded, false);
  assert.equal(api.state.status, 'Ready');
  assert.equal(api.state.statusTone, 'success');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="success" role="status" aria-live="polite" aria-atomic="true"><span>Ready</span></div>');
});

test('PWA history refresh sends queued follow-up once the backgrounded turn is done', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_background_done',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from another client' },
                      { type: 'message', role: 'assistant', text: 'Completed elsewhere' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ turnId: 'turn_2' }),
        };
      }
      if (path === '/api/turns/turn_2/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => new Promise(() => {}),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_stale';
  api.state.streamWasBackgrounded = true;
  api.enqueueQueuedMessage('session_1', 'Queued after background completion');

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });
  await flushMicrotasks();
  await flushMicrotasks();

  assert.ok(fetchCalls.some((call) => call.path === '/api/sessions/session_1/status'));
  assert.ok(fetchCalls.some((call) => call.path === '/api/sessions/session_1/timeline?limit=50'));
  assert.ok(fetchCalls.some((call) => call.path === '/api/turns/turn_2/events'));
  const queuedTurnRequest = fetchCalls.find((call) => call.path === '/api/sessions/session_1/turns');
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_2');
  assert.equal(api.queuedMessagesForCurrentSession().length, 0);
  assert.equal(JSON.parse(queuedTurnRequest.options.body).text, 'Queued after background completion');
});

test('idle status refresh sends a queued follow-up even when local state was already Ready', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              activeTurnId: null,
              settings: { metadata: {} },
            },
          }),
        };
      }
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ turnId: 'turn_after_ready' }),
        };
      }
      if (path === '/api/turns/turn_after_ready/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => new Promise(() => {}),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.pendingTurn = false;
  api.state.turnId = null;
  api.state.status = 'Ready';
  api.state.statusTone = 'success';
  api.enqueueQueuedMessage('session_1', 'Send after Ready confirmation');

  await api.refreshCurrentSessionMetadata();
  await flushMicrotasks();
  await flushMicrotasks();

  const queuedTurnRequests = fetchCalls.filter((call) => call.path === '/api/sessions/session_1/turns');
  assert.equal(queuedTurnRequests.length, 1);
  assert.equal(JSON.parse(queuedTurnRequests[0].options.body).text, 'Send after Ready confirmation');
  assert.equal(api.queuedMessagesForCurrentSession().length, 0);
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_after_ready');
  assert.equal(api.state.status, 'Turn running');
});

test('session refresh sends a follow-up queued while the terminal metadata request is pending', async () => {
  const fetchCalls = [];
  let resolveSessionDetail = null;
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1') {
        return await new Promise((resolve) => {
          resolveSessionDetail = resolve;
        });
      }
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ turnId: 'turn_queued_during_refresh' }),
        };
      }
      if (path === '/api/turns/turn_queued_during_refresh/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => new Promise(() => {}),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_finishing';
  api.state.streamWasBackgrounded = true;

  const refresh = api.refreshCurrentSessionMetadata({ hydrateTimeline: true, forceDetail: true });
  assert.equal(typeof resolveSessionDetail, 'function');
  api.enqueueQueuedMessage('session_1', 'Queued while metadata was loading');
  resolveSessionDetail({
    ok: true,
    status: 200,
    json: async () => ({
      session: {
        id: 'session_1',
        cwd: '/repo',
        settings: { metadata: {} },
        thread: {
          turns: [{
            id: 'turn_finishing',
            status: 'completed',
            items: [
              { type: 'message', role: 'user', text: 'Original question' },
              { type: 'message', role: 'assistant', text: 'Finished answer' },
            ],
          }],
        },
      },
    }),
  });

  await refresh;
  await flushMicrotasks();
  await flushMicrotasks();

  const queuedTurnRequests = fetchCalls.filter((call) => call.path === '/api/sessions/session_1/turns');
  assert.equal(queuedTurnRequests.length, 1);
  assert.equal(JSON.parse(queuedTurnRequests[0].options.body).text, 'Queued while metadata was loading');
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_queued_during_refresh');
  assert.equal(api.queuedMessagesForCurrentSession().length, 0);
});

test('session refresh keeps a follow-up queued when pending metadata still reports an active turn', async () => {
  const fetchCalls = [];
  let resolveSessionDetail = null;
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1') {
        return await new Promise((resolve) => {
          resolveSessionDetail = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_still_running';

  const refresh = api.refreshCurrentSessionMetadata({ hydrateTimeline: true, forceDetail: true });
  assert.equal(typeof resolveSessionDetail, 'function');
  api.enqueueQueuedMessage('session_1', 'Wait until the active turn finishes');
  resolveSessionDetail({
    ok: true,
    status: 200,
    json: async () => ({
      session: {
        id: 'session_1',
        cwd: '/repo',
        activeTurnId: 'turn_still_running',
        settings: { metadata: {} },
        thread: {
          turns: [{
            id: 'turn_still_running',
            status: 'in_progress',
            items: [{ type: 'message', role: 'user', text: 'Original question' }],
          }],
        },
      },
    }),
  });

  await refresh;
  await flushMicrotasks();

  assert.deepEqual(fetchCalls.map((call) => call.path), ['/api/sessions/session_1']);
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_still_running');
  assert.equal(api.queuedMessagesForCurrentSession().length, 1);
  assert.equal(api.queuedMessagesForCurrentSession()[0]?.text, 'Wait until the active turn finishes');
});

test('terminal metadata for a previous session does not send its queued follow-up after switching sessions', async () => {
  const fetchCalls = [];
  let resolveSessionDetail = null;
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1') {
        return await new Promise((resolve) => {
          resolveSessionDetail = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  const oldSession = { id: 'session_1', cwd: '/repo/old', settings: { metadata: {} } };
  const nextSession = { id: 'session_2', cwd: '/repo/new', settings: { metadata: {} } };
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessions = [oldSession, nextSession];
  api.state.sessionId = oldSession.id;
  api.state.currentSession = oldSession;
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_old_finishing';

  const refresh = api.refreshCurrentSessionMetadata({ hydrateTimeline: true, forceDetail: true });
  assert.equal(typeof resolveSessionDetail, 'function');
  api.enqueueQueuedMessage(oldSession.id, 'Keep this follow-up with the old session');
  api.state.sessionId = nextSession.id;
  api.state.currentSession = nextSession;
  api.state.pendingTurn = false;
  api.state.turnId = null;
  resolveSessionDetail({
    ok: true,
    status: 200,
    json: async () => ({
      session: {
        ...oldSession,
        thread: {
          turns: [{
            id: 'turn_old_finishing',
            status: 'completed',
            items: [
              { type: 'message', role: 'user', text: 'Old session question' },
              { type: 'message', role: 'assistant', text: 'Old session answer' },
            ],
          }],
        },
      },
    }),
  });

  await refresh;
  await flushMicrotasks();

  assert.deepEqual(fetchCalls.map((call) => call.path), ['/api/sessions/session_1']);
  assert.equal(api.state.sessionId, 'session_2');
  assert.equal(api.state.currentSession?.id, 'session_2');
  assert.equal(api.state.queuedMessages.get('session_1')?.length, 1);
  assert.equal(api.state.queuedMessages.get('session_1')?.[0]?.text, 'Keep this follow-up with the old session');
  assert.equal(api.queuedMessagesForCurrentSession().length, 0);
});

test('session refresh retries a queued follow-up that was left in sending state after an interrupted turn', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_interrupted',
                    status: 'interrupted',
                    items: [
                      { type: 'message', role: 'user', text: 'Original question' },
                      { type: 'message', role: 'assistant', text: 'Stopped before follow-up was sent' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ turnId: 'turn_2' }),
        };
      }
      if (path === '/api/turns/turn_2/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => new Promise(() => {}),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_stale';
  api.state.streamWasBackgrounded = true;
  api.state.queuedMessages = new Map([
    ['session_1', [{ id: 'queued_1', text: 'Resume this follow-up', createdAt: '2026-06-09T02:00:00.000Z', sending: true }]],
  ]);

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });
  await flushMicrotasks();
  await flushMicrotasks();

  assert.ok(fetchCalls.some((call) => call.path === '/api/sessions/session_1/status'));
  assert.ok(fetchCalls.some((call) => call.path === '/api/sessions/session_1/timeline?limit=50'));
  assert.ok(fetchCalls.some((call) => call.path === '/api/turns/turn_2/events'));
  const queuedTurnRequest = fetchCalls.find((call) => call.path === '/api/sessions/session_1/turns');
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.state.turnId, 'turn_2');
  assert.equal(api.queuedMessagesForCurrentSession().length, 0);
  assert.equal(JSON.parse(queuedTurnRequest.options.body).text, 'Resume this follow-up');
});

test('session refresh restores running status when backend reports an active turn', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              activeTurnId: 'turn_active',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_active',
                    status: 'in_progress',
                    items: [
                      { type: 'message', role: 'user', text: 'Still working question' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      if (path === '/api/turns/turn_active/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = false;
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  await api.refreshCurrentView();

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_active');
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="work" role="status" aria-live="polite" aria-atomic="true"><span>Working</span></div>');
  assert.ok(fetchCalls.includes('/api/turns/turn_active/events'));
});

test('session refresh ignores in-progress history without an active marker after restart', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              activeTurnId: null,
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_stale',
                    status: 'in_progress',
                    items: [
                      { type: 'message', role: 'user', text: 'Old question before service restart' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = false;
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  await api.refreshCurrentView();

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.status, 'Ready');
  assert.equal(api.state.statusTone, 'success');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="success" role="status" aria-live="polite" aria-atomic="true"><span>Ready</span></div>');
  assert.equal(fetchCalls.includes('/api/turns/turn_stale/events'), false);
});

test('opening a session restores running status when the session has an active turn', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_active') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_active',
              cwd: '/repo',
              activeTurnId: 'turn_active',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_active',
                    status: 'in_progress',
                    items: [
                      { type: 'message', role: 'user', text: 'Active question' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      if (path === '/api/turns/turn_active/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [{ id: 'session_active', cwd: '/repo', settings: { metadata: {} } }];

  await api.selectSession('session_active');

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_active');
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="work" role="status" aria-live="polite" aria-atomic="true"><span>Working</span></div>');
  assert.ok(fetchCalls.includes('/api/turns/turn_active/events'));
});

test('opening a session uses backend timeline command messages without dropping them', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_goal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Original question' },
                { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Original answer' },
                { id: 'command_help_show', kind: 'message', role: 'system', label: '/help', meta: 'show', text: '支持的命令：/help /goal' },
                { id: 'command_goal_show', kind: 'message', role: 'system', label: '/goal', meta: 'show', text: 'Goal (active): ship slash goal support' },
                { id: 'history_turn_2_2', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Later question' },
                { id: 'history_turn_2_3', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Later answer' },
              ],
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Original question' },
                      { type: 'message', role: 'assistant', text: 'Original answer' },
                    ],
                  },
                  {
                    id: 'turn_2',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Later question' },
                      { type: 'message', role: 'assistant', text: 'Later answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [{ id: 'session_goal', cwd: '/repo', settings: { metadata: {} } }];

  await api.selectSession('session_goal');

  assert.ok(fetchCalls.includes('/api/sessions/session_goal'));
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Original question',
    'Original answer',
    '支持的命令：/help /goal',
    'Goal (active): ship slash goal support',
    'Later question',
    'Later answer',
  ]));
});

test('backgrounded PWA stream failures keep the active turn recoverable', async () => {
  const { api } = await loadAppHarness({
    fetch: async () => {
      throw new Error('Background fetch closed');
    },
  });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = true;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  await api.streamTurnEvents('turn_1');

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_1');
  assert.equal(api.state.streamWasBackgrounded, true);
  assert.notEqual(api.state.status, 'Stream failed');
});

function createRestoreAuthFetch({ models = [], defaults = null, sessions = [] } = {}) {
  return async (path: string) => {
    if (path === '/api/auth/me') {
      return { ok: true, status: 200, json: async () => ({ session: { id: 'auth_1' } }) };
    }
    if (path === '/api/settings') {
      return { ok: true, status: 200, json: async () => ({ settings: {}, permissions: {} }) };
    }
    if (path === '/api/models') {
      return { ok: true, status: 200, json: async () => ({ items: models, defaults }) };
    }
    if (path === '/api/sessions') {
      return { ok: true, status: 200, json: async () => ({ items: sessions }) };
    }
    if (path === '/api/projects') {
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
    throw new Error(`unexpected fetch ${path}`);
  };
}

async function loadAppHarness(overrides = {}) {
  const app = await readFile(appUrl, 'utf8');
  const storage = overrides.storage instanceof Map
    ? overrides.storage
    : new Map(Object.entries(overrides.storage || {}));
  const elements = new Map();
  let activeElement = null;
  const removeClasses = (element, classNames) => {
    const current = new Set(String(element.className || '').split(/\s+/u).filter(Boolean));
    for (const className of classNames) {
      current.delete(className);
    }
    element.className = [...current].join(' ');
  };
  const addClasses = (element, classNames) => {
    const current = new Set(String(element.className || '').split(/\s+/u).filter(Boolean));
    for (const className of classNames) {
      current.add(className);
    }
    element.className = [...current].join(' ');
  };
  const trackElement = (selector, element) => {
    elements.set(selector, element);
    return element;
  };
  const createTrackedElement = (selector, patch = {}) => {
    const initialValue = typeof patch.value === 'string' ? patch.value : '';
    return {
      innerHTML: '',
      style: {},
      className: '',
      value: initialValue,
      selectionStart: Number.isFinite(patch.selectionStart) ? Number(patch.selectionStart) : 0,
      selectionEnd: Number.isFinite(patch.selectionEnd) ? Number(patch.selectionEnd) : 0,
      selectionDirection: typeof patch.selectionDirection === 'string' ? patch.selectionDirection : 'none',
      __attributes: {},
      classList: {
      add(...classNames) {
        if (this.element) {
          addClasses(this.element, classNames);
        }
      },
      remove(...classNames) {
        if (this.element) {
          removeClasses(this.element, classNames);
        }
      },
      toggle(className, force) {
        const shouldAdd = force === undefined ? !this.contains(className) : Boolean(force);
        if (shouldAdd) {
          this.add(className);
          return true;
        }
        this.remove(className);
        return false;
      },
      contains(className) {
        return String(this.element?.className || '').split(/\s+/u).includes(className);
      },
      element: null,
      },
      hidden: false,
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      __listeners: new Map(),
      addEventListener(type, listener) {
        this.__listeners.set(type, listener);
      },
      removeEventListener() {},
      getAttribute(name) {
        return this.__attributes?.[name] ?? null;
      },
      setAttribute(name, value) {
        this.__attributes[name] = String(value);
      },
      setSelectionRange(start, end, direction = 'none') {
        this.selectionStart = Number(start);
        this.selectionEnd = Number(end);
        this.selectionDirection = direction;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ height: 0 }),
      click() {
        this.__listeners.get('click')?.({ target: this, stopPropagation() {} });
      },
      focus() {
        activeElement = this;
      },
      ...patch,
    };
  };
	  const createElementFromHtml = (selector, html, patch = {}) => {
	    const attributes = {};
	    for (const match of String(html || '').matchAll(/\s([A-Za-z0-9_-]+)="([^"]*)"/gu)) {
	      attributes[match[1]] = match[2];
	    }
	    const tagName = html.match(/^<([A-Za-z0-9_-]+)/u)?.[1]?.toUpperCase() || '';
	    const className = html.match(/\sclass="([^"]*)"/u)?.[1] || '';
	    const id = html.match(/\sid="([^"]*)"/u)?.[1] || '';
	    const element = createTrackedElement(selector, { className, id, tagName, type: attributes.type || '', __attributes: attributes, ...patch });
	    element.classList.element = element;
	    return element;
	  };
  const materializeSelectFromHtml = (html, id) => {
    const selector = `#${id}`;
    elements.delete(selector);
    const escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = String(html || '').match(new RegExp(
      `<select\\b[^>]*id="${escapedId}"[^>]*>([\\s\\S]*?)<\\/select>`,
      'u',
    ));
    if (!match) {
      return;
    }
    const openingTag = match[0].match(/^<select\b[^>]*>/u)?.[0] || '';
    const optionsHtml = match[1] || '';
    const selectedValue = optionsHtml.match(/<option\b[^>]*value="([^"]*)"[^>]*\sselected(?:\s|>)/u)?.[1]
      || optionsHtml.match(/<option\b[^>]*value="([^"]*)"/u)?.[1]
      || '';
    trackElement(selector, createElementFromHtml(selector, openingTag, {
      innerHTML: optionsHtml,
      value: selectedValue,
    }));
  };
  const materializeAppHtml = (html) => {
    materializeSelectFromHtml(html, 'model-select');
    materializeSelectFromHtml(html, 'reasoning-select');
    elements.delete('#timeline');
    elements.delete('#prompt-input');
    elements.delete('#username');
    elements.delete('#password');
    elements.delete('#attach-button');
    elements.delete('.session-file-viewer');
	    elements.delete('#mobile-sidebar-toggle-button');
	    elements.delete('#mobile-drawer-backdrop');
	    elements.delete('.mobile-project-drawer');
	    for (const key of [...elements.keys()]) {
	      if (key.startsWith('[data-sort-mode="')) {
	        elements.delete(key);
	      }
	    }
    if (String(html || '').includes('id="timeline"')) {
      const timelineHtml = String(html).match(/<main\b[^>]*class="timeline"[^>]*id="timeline"[^>]*>([\s\S]*?)<\/main>/u)?.[1] || '';
      trackElement('#timeline', createTrackedElement('#timeline', {
        innerHTML: timelineHtml,
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 400,
      }));
    }
    if (String(html || '').includes('id="prompt-input"')) {
      const promptValue = String(html).match(/<textarea\b[^>]*id="prompt-input"[^>]*>([\s\S]*?)<\/textarea>/u)?.[1] || '';
      trackElement('#prompt-input', createTrackedElement('#prompt-input', {
        value: promptValue,
        scrollHeight: 38,
      }));
    }
    if (String(html || '').includes('id="username"')) {
      const usernameHtml = String(html).match(/<input\b[^>]*id="username"[^>]*>/u)?.[0] || '';
      trackElement('#username', createElementFromHtml('#username', usernameHtml));
    }
    if (String(html || '').includes('id="password"')) {
      const passwordHtml = String(html).match(/<input\b[^>]*id="password"[^>]*>/u)?.[0] || '';
      trackElement('#password', createElementFromHtml('#password', passwordHtml));
    }
    if (String(html || '').includes('id="attach-button"')) {
      const attachHtml = String(html).match(/<button\b[^>]*id="attach-button"[^>]*>/u)?.[0] || '';
      trackElement('#attach-button', createElementFromHtml('#attach-button', attachHtml, {
        remove() {
          elements.delete('#attach-button');
        },
      }));
    }
    if (String(html || '').includes('class="session-file-viewer"')) {
      const fileHtml = String(html).match(/<main class="session-file-viewer">([\s\S]*?)<\/main>/u)?.[1] || '';
      trackElement('.session-file-viewer', createTrackedElement('.session-file-viewer', {
        innerHTML: fileHtml,
        scrollTop: 0,
        scrollHeight: 1200,
        clientHeight: 600,
      }));
    }
    if (String(html || '').includes('id="mobile-sidebar-toggle-button"')) {
      const toggleHtml = String(html).match(/<button\b[^>]*id="mobile-sidebar-toggle-button"[^>]*>/u)?.[0] || '';
      trackElement('#mobile-sidebar-toggle-button', createElementFromHtml('#mobile-sidebar-toggle-button', toggleHtml));
    }
    if (String(html || '').includes('id="mobile-drawer-backdrop"')) {
      const backdropHtml = String(html).match(/<div\b[^>]*id="mobile-drawer-backdrop"[^>]*>/u)?.[0] || '';
      trackElement('#mobile-drawer-backdrop', createElementFromHtml('#mobile-drawer-backdrop', backdropHtml));
    }
	    if (String(html || '').includes('class="mobile-project-drawer')) {
	      const drawerHtml = String(html).match(/<aside\b[^>]*class="[^"]*\bmobile-project-drawer\b[^"]*"[^>]*>/u)?.[0] || '';
	      trackElement('.mobile-project-drawer', createElementFromHtml('.mobile-project-drawer', drawerHtml));
	    }
	    for (const match of String(html || '').matchAll(/<button\b[^>]*data-sort-mode="([^"]+)"[^>]*>/gu)) {
	      const mode = match[1];
	      trackElement(`[data-sort-mode="${mode}"]`, createElementFromHtml(`[data-sort-mode="${mode}"]`, match[0]));
	    }
  };
  const windowListeners = new Map();
  const appElement = {
    _innerHTML: '',
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(value) {
      this._innerHTML = String(value || '');
      context.__appRenderCount += 1;
      materializeAppHtml(this._innerHTML);
    },
    appendChild(child) {
      this.innerHTML = child?.innerHTML || '';
    },
  };
  trackElement('#app', appElement);
  if (overrides.bootstrapSiteTitle) {
    trackElement('#codex-web-bootstrap', {
      textContent: JSON.stringify({ siteTitle: overrides.bootstrapSiteTitle }),
    });
  }
  const ContextURL = class extends URL {};
  ContextURL.createObjectURL = overrides.URL?.createObjectURL || (() => 'blob:codex-web-test');
  ContextURL.revokeObjectURL = overrides.URL?.revokeObjectURL || (() => {});
  const context = {
    console,
    __appRenderCount: 0,
    __elements: elements,
    localStorage: {
      get length() {
        return storage.size;
      },
      key: (index) => [...storage.keys()][index] ?? null,
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => {
        overrides.onLocalStorageSetItem?.(key, String(value));
        storage.set(key, String(value));
      },
      removeItem: (key) => {
        overrides.onLocalStorageRemoveItem?.(key);
        storage.delete(key);
      },
    },
    document: {
      body: { scrollHeight: 0 },
      visibilityState: 'visible',
      get activeElement() {
        return activeElement;
      },
      documentElement: {
        dataset: {},
        style: {
          removeProperty() {},
          setProperty() {},
        },
      },
      addEventListener() {},
	      querySelector: (selector) => elements.get(selector) || null,
	      querySelectorAll: (selector) => {
	        if (selector === '[data-sort-mode]') {
	          const seen = new Set();
	          return [...elements.values()].filter((element) => {
	            const mode = element?.getAttribute?.('data-sort-mode');
	            if (!mode || seen.has(mode)) {
	              return false;
	            }
	            seen.add(mode);
	            return true;
	          });
	        }
	        return [];
	      },
      createElement: () => ({
        className: '',
        innerHTML: '',
      }),
    },
    window: {
      innerWidth: overrides.viewportWidth ?? 390,
      innerHeight: overrides.viewportHeight ?? 844,
      location: {
        pathname: overrides.pathname || '/',
        origin: overrides.origin || 'http://codex.test',
        reload() {},
      },
      addEventListener(type, listener) {
        windowListeners.set(type, listener);
      },
      matchMedia: overrides.matchMedia || ((query: string) => ({
        matches: Boolean(overrides.desktopPointer) && query === '(hover: hover) and (pointer: fine)',
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })),
      screen: overrides.screen || {},
      scrollTo() {},
    },
    __dispatchWindowEvent(type, event = {}) {
      windowListeners.get(type)?.({ type, ...event });
    },
    screen: overrides.screen || {},
    navigator: {
      userAgent: 'Node test',
      onLine: overrides.onLine ?? true,
    },
    requestAnimationFrame: overrides.requestAnimationFrame || ((callback) => {
      callback();
    }),
    setTimeout: overrides.setTimeout || setTimeout,
    clearTimeout: overrides.clearTimeout || clearTimeout,
    setInterval: overrides.setInterval || (() => 1),
    clearInterval: overrides.clearInterval || (() => {}),
    fetch: overrides.fetch || (async () => ({ ok: true, status: 204 })),
    TextDecoder,
    AbortController,
    FormData,
    TextEncoder,
    Blob,
    URL: ContextURL,
    Date: overrides.Date || Date,
    ResizeObserver: class ResizeObserver {
      observe() {}
      disconnect() {}
    },
  };
  vm.runInNewContext(`${app}
globalThis.__codexWebTest = {
  state,
  get draftSessionActive() {
    return state.draftSessionActive;
  },
  context: globalThis,
  render: typeof render === 'function' ? render : null,
  DESKTOP_WORKSPACE_MIN_WIDTH: typeof DESKTOP_WORKSPACE_MIN_WIDTH === 'number' ? DESKTOP_WORKSPACE_MIN_WIDTH : null,
  MAX_TIMELINE_CACHE_SESSIONS: typeof MAX_TIMELINE_CACHE_SESSIONS === 'number' ? MAX_TIMELINE_CACHE_SESSIONS : null,
  hasDesktopPointer: typeof hasDesktopPointer === 'function' ? hasDesktopPointer : null,
  isDesktopLayout: typeof isDesktopLayout === 'function' ? isDesktopLayout : null,
  handleLayoutResize: typeof handleLayoutResize === 'function' ? handleLayoutResize : null,
  renderDesktopWorkspace: typeof renderDesktopWorkspace === 'function' ? renderDesktopWorkspace : null,
  renderDesktopProjectRail: typeof renderDesktopProjectRail === 'function' ? renderDesktopProjectRail : null,
  renderDesktopSessionPane: typeof renderDesktopSessionPane === 'function' ? renderDesktopSessionPane : null,
  renderDesktopChatPane: typeof renderDesktopChatPane === 'function' ? renderDesktopChatPane : null,
  ensureDesktopActiveSession: typeof ensureDesktopActiveSession === 'function' ? ensureDesktopActiveSession : null,
  MAX_TIMELINE_CACHE_MAP_ITEMS: typeof MAX_TIMELINE_CACHE_MAP_ITEMS === 'number' ? MAX_TIMELINE_CACHE_MAP_ITEMS : null,
  MAX_TIMELINE_SUMMARY_TEXT: typeof MAX_TIMELINE_SUMMARY_TEXT === 'number' ? MAX_TIMELINE_SUMMARY_TEXT : null,
  SESSION_DETAIL_CACHE_FRESH_MS: typeof SESSION_DETAIL_CACHE_FRESH_MS === 'number' ? SESSION_DETAIL_CACHE_FRESH_MS : null,
  firstInputForSession,
  previewInputForSession: typeof previewInputForSession === 'function' ? previewInputForSession : null,
  renderSessionCards: typeof renderSessionCards === 'function' ? renderSessionCards : null,
  renderSessionList: typeof renderSessionList === 'function' ? renderSessionList : null,
  renderNewSession: typeof renderNewSession === 'function' ? renderNewSession : null,
  renderAppSettings: typeof renderAppSettings === 'function' ? renderAppSettings : null,
  renderAdminConsole: typeof renderAdminConsole === 'function' ? renderAdminConsole : null,
  upsertSession: typeof upsertSession === 'function' ? upsertSession : null,
  renderChat: typeof renderChat === 'function' ? renderChat : null,
  renderChatContent: typeof renderChatContent === 'function' ? renderChatContent : null,
  renderSessionFileViewer: typeof renderSessionFileViewer === 'function' ? renderSessionFileViewer : null,
  renderSessionFileViewerContent: typeof renderSessionFileViewerContent === 'function' ? renderSessionFileViewerContent : null,
  renderTimelineItem: typeof renderTimelineItem === 'function' ? renderTimelineItem : null,
  renderComposerStatus: typeof renderComposerStatus === 'function' ? renderComposerStatus : null,
	  renderWorkDetailsDialog: typeof renderWorkDetailsDialog === 'function' ? renderWorkDetailsDialog : null,
	  mergeAuthoritativeTimelineAuxiliaryEntries: typeof mergeAuthoritativeTimelineAuxiliaryEntries === 'function' ? mergeAuthoritativeTimelineAuxiliaryEntries : null,
	  handleWorkDetailToggle: typeof handleWorkDetailToggle === 'function' ? handleWorkDetailToggle : null,
  currentSessionWorkItems: typeof currentSessionWorkItems === 'function' ? currentSessionWorkItems : null,
	  canViewCurrentWorkDetails: typeof canViewCurrentWorkDetails === 'function' ? canViewCurrentWorkDetails : null,
	  enforceCurrentWorkDetailsAccess: typeof enforceCurrentWorkDetailsAccess === 'function' ? enforceCurrentWorkDetailsAccess : null,
	  resolvePendingWorkDetailsPolicy: typeof resolvePendingWorkDetailsPolicy === 'function' ? resolvePendingWorkDetailsPolicy : null,
  refreshChatDynamicUi: typeof refreshChatDynamicUi === 'function' ? refreshChatDynamicUi : null,
  composerStatusLabel: typeof composerStatusLabel === 'function' ? composerStatusLabel : null,
  applyMessageFontSize: typeof applyMessageFontSize === 'function' ? applyMessageFontSize : null,
  setMessageFontSize: typeof setMessageFontSize === 'function' ? setMessageFontSize : null,
  updateComposerExpansionState: typeof updateComposerExpansionState === 'function' ? updateComposerExpansionState : null,
  toggleComposerExpanded: typeof toggleComposerExpanded === 'function' ? toggleComposerExpanded : null,
  hydrateTimelineFromSession,
  restoreTimelineForSession: typeof restoreTimelineForSession === 'function' ? restoreTimelineForSession : null,
  showMoreSessionHistory: typeof showMoreSessionHistory === 'function' ? showMoreSessionHistory : null,
  loadOlderSessionTimelinePage: typeof loadOlderSessionTimelinePage === 'function' ? loadOlderSessionTimelinePage : null,
  applySessionSettings: typeof applySessionSettings === 'function' ? applySessionSettings : null,
  updateSessionSettings: typeof updateSessionSettings === 'function' ? updateSessionSettings : null,
  collectSettings,
  refreshCurrentSessionMetadata,
  loadSessionOpenData: typeof loadSessionOpenData === 'function' ? loadSessionOpenData : null,
  applySessionTurnSnapshot: typeof applySessionTurnSnapshot === 'function' ? applySessionTurnSnapshot : null,
  syncRuntimeStatusFromSession: typeof syncRuntimeStatusFromSession === 'function' ? syncRuntimeStatusFromSession : null,
  refreshSessionsList: typeof refreshSessionsList === 'function' ? refreshSessionsList : null,
  refreshCurrentView: typeof refreshCurrentView === 'function' ? refreshCurrentView : null,
  restoreAuth: typeof restoreAuth === 'function' ? restoreAuth : null,
  loadSharedSessionFromLocation: typeof loadSharedSessionFromLocation === 'function' ? loadSharedSessionFromLocation : null,
  ensureSession: typeof ensureSession === 'function' ? ensureSession : null,
  refreshProjectsList: typeof refreshProjectsList === 'function' ? refreshProjectsList : null,
	  showSessionList: typeof showSessionList === 'function' ? showSessionList : null,
  openAppSettingsPage: typeof openAppSettingsPage === 'function' ? openAppSettingsPage : null,
  openAdminConsole: typeof openAdminConsole === 'function' ? openAdminConsole : null,
  openAdminObservedSession: typeof openAdminObservedSession === 'function' ? openAdminObservedSession : null,
  openNewSessionPage: typeof openNewSessionPage === 'function' ? openNewSessionPage : null,
  shareCurrentSession: typeof shareCurrentSession === 'function' ? shareCurrentSession : null,
  copyShareLink: typeof copyShareLink === 'function' ? copyShareLink : null,
	  openSessionFileByPath: typeof openSessionFileByPath === 'function' ? openSessionFileByPath : null,
	  closeSessionFileViewer: typeof closeSessionFileViewer === 'function' ? closeSessionFileViewer : null,
  getActiveScrollContainer: typeof getActiveScrollContainer === 'function' ? getActiveScrollContainer : null,
  setSessionSortMode: typeof setSessionSortMode === 'function' ? setSessionSortMode : null,
  selectSession: typeof selectSession === 'function' ? selectSession : null,
	  onComposerSubmit: typeof onComposerSubmit === 'function' ? onComposerSubmit : null,
	  onNewSessionSubmit: typeof onNewSessionSubmit === 'function' ? onNewSessionSubmit : null,
	  handlePromptKeydown: typeof handlePromptKeydown === 'function' ? handlePromptKeydown : null,
	  handlePromptPaste: typeof handlePromptPaste === 'function' ? handlePromptPaste : null,
	  attachTimelineScrollTracking: typeof attachTimelineScrollTracking === 'function' ? attachTimelineScrollTracking : null,
  updateTimelineFollowState: typeof updateTimelineFollowState === 'function' ? updateTimelineFollowState : null,
  scrollTimelineToBottomIfFollowingLatest: typeof scrollTimelineToBottomIfFollowingLatest === 'function' ? scrollTimelineToBottomIfFollowingLatest : null,
  handleTimelineWheel: typeof handleTimelineWheel === 'function' ? handleTimelineWheel : null,
  handleComposerRefresh: typeof handleComposerRefresh === 'function' ? handleComposerRefresh : null,
	  recoverActiveTurnIfStreamUnhealthy: typeof recoverActiveTurnIfStreamUnhealthy === 'function' ? recoverActiveTurnIfStreamUnhealthy : null,
	  recoverActiveTurnAfterForeground: typeof recoverActiveTurnAfterForeground === 'function' ? recoverActiveTurnAfterForeground : null,
	  revalidateWorkDetailsPolicyAfterStreamClose: typeof revalidateWorkDetailsPolicyAfterStreamClose === 'function' ? revalidateWorkDetailsPolicyAfterStreamClose : null,
  isTurnStreamHealthy: typeof isTurnStreamHealthy === 'function' ? isTurnStreamHealthy : null,
  checkForAppUpdate: typeof checkForAppUpdate === 'function' ? checkForAppUpdate : null,
  filteredSessions: typeof filteredSessions === 'function' ? filteredSessions : null,
  sortedSessions: typeof sortedSessions === 'function' ? sortedSessions : null,
  workspaceProjects: typeof workspaceProjects === 'function' ? workspaceProjects : null,
  selectProjectScope: typeof selectProjectScope === 'function' ? selectProjectScope : null,
  currentProjectScopeTitle: typeof currentProjectScopeTitle === 'function' ? currentProjectScopeTitle : null,
  toggleProjectFavorite: typeof toggleProjectFavorite === 'function' ? toggleProjectFavorite : null,
  toggleSessionFavorite: typeof toggleSessionFavorite === 'function' ? toggleSessionFavorite : null,
  archiveSession: typeof archiveSession === 'function' ? archiveSession : null,
  unarchiveSession: typeof unarchiveSession === 'function' ? unarchiveSession : null,
  reloadRuntime: typeof reloadRuntime === 'function' ? reloadRuntime : null,
  refreshGlobalSettings: typeof refreshGlobalSettings === 'function' ? refreshGlobalSettings : null,
  saveSiteTitle: typeof saveSiteTitle === 'function' ? saveSiteTitle : null,
  refreshWebhookSettings: typeof refreshWebhookSettings === 'function' ? refreshWebhookSettings : null,
  setWebhookEnabled: typeof setWebhookEnabled === 'function' ? setWebhookEnabled : null,
  requestWebhookKeyRotation: typeof requestWebhookKeyRotation === 'function' ? requestWebhookKeyRotation : null,
  cancelWebhookKeyRotation: typeof cancelWebhookKeyRotation === 'function' ? cancelWebhookKeyRotation : null,
  rotateWebhookKey: typeof rotateWebhookKey === 'function' ? rotateWebhookKey : null,
  copyWebhookEndpoint: typeof copyWebhookEndpoint === 'function' ? copyWebhookEndpoint : null,
  copyWebhookKey: typeof copyWebhookKey === 'function' ? copyWebhookKey : null,
  webhookEndpointUrl: typeof webhookEndpointUrl === 'function' ? webhookEndpointUrl : null,
  setLoggedOut: typeof setLoggedOut === 'function' ? setLoggedOut : null,
	  refreshAdminSessions: typeof refreshAdminSessions === 'function' ? refreshAdminSessions : null,
	  saveAdminProject: typeof saveAdminProject === 'function' ? saveAdminProject : null,
	  saveAdminRole: typeof saveAdminRole === 'function' ? saveAdminRole : null,
	  saveAdminUser: typeof saveAdminUser === 'function' ? saveAdminUser : null,
	  saveAdminUserAccess: typeof saveAdminUserAccess === 'function' ? saveAdminUserAccess : null,
	  toggleAdminUserEnabled: typeof toggleAdminUserEnabled === 'function' ? toggleAdminUserEnabled : null,
	  deleteAdminUser: typeof deleteAdminUser === 'function' ? deleteAdminUser : null,
	  applyTheme: typeof applyTheme === 'function' ? applyTheme : null,
	  applySiteTitle: typeof applySiteTitle === 'function' ? applySiteTitle : null,
	  applyLanguage: typeof applyLanguage === 'function' ? applyLanguage : null,
	  translateUi: typeof translateUi === 'function' ? translateUi : null,
	  localizeFragment: typeof localizeFragment === 'function' ? localizeFragment : null,
	  applyDefaultThreadSettings: typeof applyDefaultThreadSettings === 'function' ? applyDefaultThreadSettings : null,
	  applyDefaultSettings: typeof applyDefaultSettings === 'function' ? applyDefaultSettings : null,
	  renderSettingsDrawer: typeof renderSettingsDrawer === 'function' ? renderSettingsDrawer : null,
	  handleSessionSettingsOutsideClick: typeof handleSessionSettingsOutsideClick === 'function' ? handleSessionSettingsOutsideClick : null,
	  handleApiError: typeof handleApiError === 'function' ? handleApiError : null,
	  handleFocusScopeKeydown: typeof handleFocusScopeKeydown === 'function' ? handleFocusScopeKeydown : null,
	  syncFocusScope: typeof syncFocusScope === 'function' ? syncFocusScope : null,
	  streamTurnEvents,
	  presentTurnEventForCurrentAudience: typeof presentTurnEventForCurrentAudience === 'function' ? presentTurnEventForCurrentAudience : null,
	  applyTurnEvent: typeof applyTurnEvent === 'function' ? applyTurnEvent : null,
	  enqueueQueuedMessage: typeof enqueueQueuedMessage === 'function' ? enqueueQueuedMessage : null,
	  removeQueuedMessage: typeof removeQueuedMessage === 'function' ? removeQueuedMessage : null,
	  queuedMessagesForCurrentSession: typeof queuedMessagesForCurrentSession === 'function' ? queuedMessagesForCurrentSession : null,
	  sendNextQueuedMessage: typeof sendNextQueuedMessage === 'function' ? sendNextQueuedMessage : null,
	  drainSubmissionOutbox: typeof drainSubmissionOutbox === 'function' ? drainSubmissionOutbox : null,
	  retrySubmission: typeof retrySubmission === 'function' ? retrySubmission : null,
	  cancelSubmission: typeof cancelSubmission === 'function' ? cancelSubmission : null,
	  onSubmissionStorageChange: typeof onSubmissionStorageChange === 'function' ? onSubmissionStorageChange : null,
	  submissionOutboxEntryStorageKey: typeof submissionOutboxEntryStorageKey === 'function' ? submissionOutboxEntryStorageKey : null,
	  visibleTimelineItems: typeof visibleTimelineItems === 'function' ? visibleTimelineItems : null,
	  SUBMISSION_REQUEST_TIMEOUT_MS: typeof SUBMISSION_REQUEST_TIMEOUT_MS === 'number' ? SUBMISSION_REQUEST_TIMEOUT_MS : null,
	  saveCurrentTimeline,
	};`, context);
  return {
    api: context.__codexWebTest,
    storage,
    context,
  };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

function submissionStorageEntries(storage) {
  return [...storage.entries()].filter(([key]) => key.startsWith('codexWebSubmissionOutbox:'));
}
