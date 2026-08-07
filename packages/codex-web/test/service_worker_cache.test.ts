import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const serviceWorkerUrl = new URL('../public/service-worker.js', import.meta.url);
const buildId = '__CODEX_WEB_BUILD_ID__';

test('service worker caches only current versioned assets and leaves version probes alone', async () => {
  const source = await readFile(serviceWorkerUrl, 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const cacheWrites: string[] = [];
  const networkRequests: string[] = [];
  const context = createServiceWorkerContext({
    listeners,
    cacheWrites,
    networkRequests,
  });
  vm.runInNewContext(source, context);
  const fetchListener = listeners.get('fetch');
  assert.ok(fetchListener);

  await dispatchFetch(fetchListener, `https://codex.test/app.js?v=${buildId}`);
  await dispatchFetch(fetchListener, 'https://codex.test/app.js');
  await dispatchFetch(fetchListener, 'https://codex.test/app.js?version-check=1');
  await dispatchFetch(fetchListener, 'https://codex.test/version.json');
  await dispatchFetch(fetchListener, 'https://codex.test/share/private-capability');

  assert.deepEqual(networkRequests, [
    `https://codex.test/app.js?v=${buildId}`,
    'https://codex.test/app.js',
  ]);
  assert.deepEqual(cacheWrites, [`https://codex.test/app.js?v=${buildId}`]);
});

test('service worker independently precaches only critical shell assets', async () => {
  const source = await readFile(serviceWorkerUrl, 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const precached: string[] = [];
  const context = createServiceWorkerContext({ listeners, precached });
  vm.runInNewContext(source, context);
  const installListener = listeners.get('install');
  assert.ok(installListener);

  await dispatchLifecycle(installListener);

  assert.ok(precached.includes('/'));
  assert.ok(precached.includes(`/app.js?v=${buildId}`));
  assert.ok(precached.includes(`/styles.css?v=${buildId}`));
  assert.ok(precached.includes(`/ui-kit.js?v=${buildId}`));
  assert.ok(precached.includes(`/ui-copy.js?v=${buildId}`));
  assert.ok(precached.includes(`/attachment-utils.js?v=${buildId}`));
  assert.ok(precached.includes(`/markdown-renderer.js?v=${buildId}`));
  assert.ok(precached.includes(`/admin-ui.js?v=${buildId}`));
  assert.ok(precached.includes(`/session-pagination.js?v=${buildId}`));
  assert.ok(!precached.includes('/manifest.webmanifest'));
  assert.ok(!precached.includes(`/icon-192.png?v=${buildId}`));
  assert.ok(!precached.includes('/version.json'));
});

test('one failed critical precache does not prevent service worker installation', async () => {
  const source = await readFile(serviceWorkerUrl, 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const precached: string[] = [];
  const failedAsset = `/app.js?v=${buildId}`;
  const context = createServiceWorkerContext({
    listeners,
    precached,
    failedPrecacheAsset: failedAsset,
  });
  vm.runInNewContext(source, context);
  const installListener = listeners.get('install');
  assert.ok(installListener);

  await assert.doesNotReject(dispatchLifecycle(installListener));
  assert.ok(precached.includes(failedAsset));
  assert.ok(precached.includes(`/styles.css?v=${buildId}`));
});

test('service worker serves cached app shell when navigation network fails', async () => {
  const source = await readFile(serviceWorkerUrl, 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const context = createServiceWorkerContext({
    listeners,
    cachedShell: new Response('cached shell', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }),
    fetchFailure: new Error('offline'),
  });
  vm.runInNewContext(source, context);
  const fetchListener = listeners.get('fetch');
  assert.ok(fetchListener);

  const response = await dispatchFetch(fetchListener, 'https://codex.test/share/cws_token', 'navigate');
  const apiNavigation = await dispatchFetch(fetchListener, 'https://codex.test/api/health', 'navigate');

  assert.equal(await (response as Response).text(), 'cached shell');
  assert.equal(apiNavigation, null);
});

test('an incomplete update preserves and serves the previous complete build cache', async () => {
  const source = await readFile(serviceWorkerUrl, 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const deletedCaches: string[] = [];
  const previousBuildId = 'previous-build';
  const previousCache = `codex-web-static-${previousBuildId}`;
  const previousAssets = ['/', '/theme-init.js', '/styles.css', '/pwa-pull-refresh.js', '/ui-copy.js', '/ui-kit.js', '/attachment-utils.js', '/markdown-renderer.js', '/admin-ui.js', '/session-pagination.js', '/app.js'];
  const cacheContents = new Map<string, Map<string, Response>>([
    [previousCache, new Map(previousAssets.map((asset) => [
      new URL(asset, 'https://codex.test').toString(),
      new Response(asset === '/' ? 'previous shell' : 'previous asset', { status: 200 }),
    ]))],
    [`codex-web-static-${buildId}`, new Map([
      ['https://codex.test/', new Response('incomplete current shell', { status: 200 })],
    ])],
  ]);
  const context = createServiceWorkerContext({
    listeners,
    cacheContents,
    deletedCaches,
    fetchFailure: new Error('offline'),
  });
  vm.runInNewContext(source, context);

  const activateListener = listeners.get('activate');
  const fetchListener = listeners.get('fetch');
  assert.ok(activateListener);
  assert.ok(fetchListener);
  await dispatchLifecycle(activateListener);
  const response = await dispatchFetch(fetchListener, 'https://codex.test/', 'navigate');
  const legacyAsset = await dispatchFetch(fetchListener, 'https://codex.test/app.js');

  assert.deepEqual(deletedCaches, []);
  assert.equal(await (response as Response).text(), 'previous shell');
  assert.equal(await (legacyAsset as Response).text(), 'previous asset');
});

test('an incomplete update retries missing critical assets and promotes the current build', async () => {
  const source = await readFile(serviceWorkerUrl, 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const deletedCaches: string[] = [];
  const previousBuildId = 'previous-build';
  const previousCache = `codex-web-static-${previousBuildId}`;
  const previousAssets = ['/', '/theme-init.js', '/styles.css', '/pwa-pull-refresh.js', '/ui-copy.js', '/ui-kit.js', '/attachment-utils.js', '/markdown-renderer.js', '/admin-ui.js', '/session-pagination.js', '/app.js'];
  const cacheContents = new Map<string, Map<string, Response>>([
    [previousCache, new Map(previousAssets.map((asset) => [
      new URL(asset, 'https://codex.test').toString(),
      new Response('previous asset', { status: 200 }),
    ]))],
  ]);
  const failedOnce = new Map([[`/app.js?v=${buildId}`, 1]]);
  const context = createServiceWorkerContext({
    listeners,
    cacheContents,
    deletedCaches,
    precacheFailuresRemaining: failedOnce,
  });
  vm.runInNewContext(source, context);

  const installListener = listeners.get('install');
  const activateListener = listeners.get('activate');
  const fetchListener = listeners.get('fetch');
  assert.ok(installListener);
  assert.ok(activateListener);
  assert.ok(fetchListener);
  await dispatchLifecycle(installListener);
  assert.equal(failedOnce.get(`/app.js?v=${buildId}`), 0);
  await dispatchLifecycle(activateListener);
  const response = await dispatchFetch(fetchListener, 'https://codex.test/', 'navigate');

  assert.ok(deletedCaches.includes(previousCache));
  assert.equal(await (response as Response).text(), 'asset');
});

function createServiceWorkerContext({
  listeners,
  cacheWrites = [],
  networkRequests = [],
  precached = [],
  cachedShell = null,
  fetchFailure = null,
  failedPrecacheAsset = null,
  cacheContents = new Map(),
  deletedCaches = [],
  precacheFailuresRemaining = new Map(),
}: {
  listeners: Map<string, (event: any) => void>;
  cacheWrites?: string[];
  networkRequests?: string[];
  precached?: string[];
  cachedShell?: Response | null;
  fetchFailure?: Error | null;
  failedPrecacheAsset?: string | null;
  cacheContents?: Map<string, Map<string, Response>>;
  deletedCaches?: string[];
  precacheFailuresRemaining?: Map<string, number>;
}) {
  const absoluteUrl = (request: string | { url: string }) => {
    const value = typeof request === 'string' ? request : request.url;
    return new URL(value, 'https://codex.test').toString();
  };
  return {
    URL,
    Response,
    encodeURIComponent,
    self: {
      location: { origin: 'https://codex.test' },
      addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches: {
      open: async (cacheName: string) => ({
        add: async (asset: string) => {
          precached.push(asset);
          const failuresRemaining = precacheFailuresRemaining.get(asset) ?? 0;
          if (failuresRemaining > 0) {
            precacheFailuresRemaining.set(asset, failuresRemaining - 1);
            throw new Error('precache failed');
          }
          if (asset === failedPrecacheAsset || fetchFailure) {
            throw new Error('precache failed');
          }
          const cache = cacheContents.get(cacheName) ?? new Map<string, Response>();
          cache.set(absoluteUrl(asset), new Response('asset', { status: 200 }));
          cacheContents.set(cacheName, cache);
        },
        match: async (request: string | { url: string }) => {
          const response = cacheContents.get(cacheName)?.get(absoluteUrl(request));
          return response?.clone() ?? null;
        },
        put: async (request: string | { url: string }, response?: Response) => {
          cacheWrites.push(absoluteUrl(request));
          const cache = cacheContents.get(cacheName) ?? new Map<string, Response>();
          cache.set(absoluteUrl(request), response?.clone() ?? new Response('asset', { status: 200 }));
          cacheContents.set(cacheName, cache);
        },
      }),
      keys: async () => [...cacheContents.keys()],
      delete: async (cacheName: string) => {
        deletedCaches.push(cacheName);
        return cacheContents.delete(cacheName);
      },
      match: async (request: string | { url: string }, options: { cacheName?: string } = {}) => {
        const requestUrl = absoluteUrl(request);
        if (options.cacheName) {
          const response = cacheContents.get(options.cacheName)?.get(requestUrl);
          if (response) {
            return response.clone();
          }
        } else {
          for (const cache of cacheContents.values()) {
            const response = cache.get(requestUrl);
            if (response) {
              return response.clone();
            }
          }
        }
        return requestUrl === 'https://codex.test/' ? cachedShell : null;
      },
    },
    fetch: async (request: string | { url: string }) => {
      networkRequests.push(absoluteUrl(request));
      if (fetchFailure) {
        throw fetchFailure;
      }
      return new Response('asset', { status: 200 });
    },
  };
}

async function dispatchFetch(
  listener: (event: any) => void,
  url: string,
  mode = 'same-origin',
): Promise<unknown> {
  const pending: Promise<unknown>[] = [];
  let responsePromise: Promise<unknown> | null = null;
  listener({
    request: { method: 'GET', mode, url },
    respondWith(value: Promise<unknown>) {
      responsePromise = Promise.resolve(value);
    },
    waitUntil(value: Promise<unknown>) {
      pending.push(Promise.resolve(value));
    },
  });
  const response = responsePromise ? await responsePromise : null;
  await Promise.all(pending);
  return response;
}

async function dispatchLifecycle(listener: (event: any) => void): Promise<void> {
  const pending: Promise<unknown>[] = [];
  listener({
    waitUntil(value: Promise<unknown>) {
      pending.push(Promise.resolve(value));
    },
  });
  await Promise.all(pending);
}
