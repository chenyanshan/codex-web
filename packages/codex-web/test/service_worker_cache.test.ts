import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const serviceWorkerUrl = new URL('../public/service-worker.js', import.meta.url);

test('service worker only stores canonical static assets', async () => {
  const source = await readFile(serviceWorkerUrl, 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const cacheWrites: string[] = [];
  const networkRequests: string[] = [];
  const context = {
    URL,
    Response,
    self: {
      location: { origin: 'https://codex.test' },
      addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches: {
      open: async () => ({
        addAll: async () => {},
        put: async (request: { url: string }) => {
          cacheWrites.push(request.url);
        },
      }),
      keys: async () => [],
      delete: async () => true,
      match: async () => null,
    },
    fetch: async (request: { url: string }) => {
      networkRequests.push(request.url);
      return new Response('asset', { status: 200 });
    },
  };
  vm.runInNewContext(source, context);
  const fetchListener = listeners.get('fetch');
  assert.ok(fetchListener);

  await dispatchFetch(fetchListener, 'https://codex.test/app.js');
  await dispatchFetch(fetchListener, 'https://codex.test/app.js?version-check=1');
  await dispatchFetch(fetchListener, 'https://codex.test/share/private-capability');

  assert.deepEqual(networkRequests, ['https://codex.test/app.js']);
  assert.deepEqual(cacheWrites, ['https://codex.test/app.js']);
});

async function dispatchFetch(listener: (event: any) => void, url: string): Promise<void> {
  const pending: Promise<unknown>[] = [];
  let responsePromise: Promise<unknown> | null = null;
  listener({
    request: { method: 'GET', url },
    respondWith(value: Promise<unknown>) {
      responsePromise = Promise.resolve(value);
    },
    waitUntil(value: Promise<unknown>) {
      pending.push(Promise.resolve(value));
    },
  });
  if (responsePromise) {
    await responsePromise;
  }
  await Promise.all(pending);
}
