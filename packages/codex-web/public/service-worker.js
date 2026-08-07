const BUILD_ID = '__CODEX_WEB_BUILD_ID__';
const STATIC_CACHE_PREFIX = 'codex-web-static-';
const STATIC_CACHE = 'codex-web-static-__CODEX_WEB_BUILD_ID__';
const APP_SHELL_URL = '/';
const VERSIONED_STATIC_ASSET_PATHS = new Set([
  '/theme-init.js',
  '/styles.css',
  '/pwa-pull-refresh.js',
  '/ui-copy.js',
  '/ui-kit.js',
  '/attachment-utils.js',
  '/markdown-renderer.js',
  '/admin-ui.js',
  '/session-pagination.js',
  '/app.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]);
const versionedUrl = (pathname) => `${pathname}?v=${encodeURIComponent(BUILD_ID)}`;
const CRITICAL_STATIC_ASSETS = [
  APP_SHELL_URL,
  ...[
    '/theme-init.js',
    '/styles.css',
    '/pwa-pull-refresh.js',
    '/ui-copy.js',
    '/ui-kit.js',
    '/attachment-utils.js',
    '/markdown-renderer.js',
    '/admin-ui.js',
    '/session-pagination.js',
    '/app.js',
  ].map(versionedUrl),
];
const LEGACY_CRITICAL_STATIC_ASSETS = [
  APP_SHELL_URL,
  '/theme-init.js',
  '/styles.css',
  '/pwa-pull-refresh.js',
  '/ui-copy.js',
  '/ui-kit.js',
  '/attachment-utils.js',
  '/markdown-renderer.js',
  '/admin-ui.js',
  '/session-pagination.js',
  '/app.js',
];

const criticalAssetsForBuild = (buildId) => [
  APP_SHELL_URL,
  ...[
    '/theme-init.js',
    '/styles.css',
    '/pwa-pull-refresh.js',
    '/ui-copy.js',
    '/ui-kit.js',
    '/attachment-utils.js',
    '/markdown-renderer.js',
    '/admin-ui.js',
    '/session-pagination.js',
    '/app.js',
  ].map((pathname) => `${pathname}?v=${encodeURIComponent(buildId)}`),
];

const buildIdFromCacheName = (cacheName) => cacheName.startsWith(STATIC_CACHE_PREFIX)
  ? cacheName.slice(STATIC_CACHE_PREFIX.length)
  : '';

async function isBuildCacheComplete(cacheName, buildId) {
  if (!cacheName || !buildId) {
    return false;
  }
  const versionedMatches = await Promise.all(
    criticalAssetsForBuild(buildId).map((asset) => caches.match(asset, { cacheName })),
  );
  if (versionedMatches.every(Boolean)) {
    return true;
  }
  const legacyMatches = await Promise.all(
    LEGACY_CRITICAL_STATIC_ASSETS.map((asset) => caches.match(asset, { cacheName })),
  );
  return legacyMatches.every(Boolean);
}

async function fillMissingCurrentCriticalAssets() {
  const cache = await caches.open(STATIC_CACHE);
  const missing = [];
  for (const asset of CRITICAL_STATIC_ASSETS) {
    if (!await cache.match(asset)) {
      missing.push(asset);
    }
  }
  if (missing.length) {
    await Promise.allSettled(missing.map((asset) => cache.add(asset)));
  }
}

async function pruneOldStaticCachesIfCurrentComplete() {
  if (!await isBuildCacheComplete(STATIC_CACHE, BUILD_ID)) {
    return;
  }
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(STATIC_CACHE_PREFIX) && key !== STATIC_CACHE)
      .map((key) => caches.delete(key)),
  );
}

async function matchBestAppShell() {
  if (await isBuildCacheComplete(STATIC_CACHE, BUILD_ID)) {
    const current = await caches.match(APP_SHELL_URL, { cacheName: STATIC_CACHE });
    if (current) {
      return current;
    }
  }
  const keys = (await caches.keys())
    .filter((key) => key.startsWith(STATIC_CACHE_PREFIX) && key !== STATIC_CACHE)
    .reverse();
  for (const key of keys) {
    const buildId = buildIdFromCacheName(key);
    if (!await isBuildCacheComplete(key, buildId)) {
      continue;
    }
    const cached = await caches.match(APP_SHELL_URL, { cacheName: key });
    if (cached) {
      return cached;
    }
  }
  return caches.match(APP_SHELL_URL, { cacheName: STATIC_CACHE });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => Promise.allSettled(
      CRITICAL_STATIC_ASSETS.map((asset) => cache.add(asset)),
    )),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    fillMissingCurrentCriticalAssets()
      .then(() => pruneOldStaticCachesIfCurrentComplete()),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  const isAppShellNavigation = request.mode === 'navigate'
    && (url.pathname === '/' || url.pathname === '/index.html' || /^\/share\/[^/]+$/u.test(url.pathname));
  if (isAppShellNavigation) {
    const networkResponse = fetch(request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(STATIC_CACHE);
        await cache.put(APP_SHELL_URL, response.clone());
        await fillMissingCurrentCriticalAssets();
        await pruneOldStaticCachesIfCurrentComplete();
      }
      return response;
    });
    event.waitUntil(networkResponse.then(() => undefined).catch(() => undefined));
    event.respondWith(
      matchBestAppShell()
        .then((cached) => cached || networkResponse)
        .catch(() => networkResponse.catch(() => Response.error())),
    );
    return;
  }
  const assetBuildId = url.searchParams.get('v');
  const isVersionedAsset = Boolean(assetBuildId)
    && [...url.searchParams.keys()].length === 1
    && VERSIONED_STATIC_ASSET_PATHS.has(url.pathname);
  const isLegacyCachedAsset = !url.search && VERSIONED_STATIC_ASSET_PATHS.has(url.pathname);
  if (!isVersionedAsset && !isLegacyCachedAsset) {
    return;
  }
  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) {
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response.ok && isVersionedAsset && assetBuildId === BUILD_ID) {
          const cache = await caches.open(STATIC_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (_error) {
        return Response.error();
      }
    }),
  );
});
