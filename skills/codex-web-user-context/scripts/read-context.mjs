#!/usr/bin/env node

const threadId = process.env.CODEX_THREAD_ID?.trim();
const localApiUrl = process.env.CODEX_WEB_LOCAL_API_URL?.trim();

if (!threadId) {
  fail('Codex Web user context is unavailable: CODEX_THREAD_ID is not set.');
}
if (!localApiUrl) {
  fail('Codex Web user context is unavailable: CODEX_WEB_LOCAL_API_URL is not set.');
}

let baseUrl;
try {
  baseUrl = new URL(localApiUrl);
} catch {
  fail('Codex Web user context is unavailable: the local API URL is invalid.');
}

const loopbackHosts = new Set(['127.0.0.1', '[::1]']);
if (
  baseUrl.protocol !== 'http:'
  || !loopbackHosts.has(baseUrl.hostname.toLowerCase())
  || baseUrl.username
  || baseUrl.password
  || (baseUrl.pathname !== '/' && baseUrl.pathname !== '')
  || baseUrl.search
  || baseUrl.hash
) {
  fail('Codex Web user context is unavailable: the local API URL must be a loopback HTTP origin.');
}

const endpoint = new URL(`/api/local/thread-context/${encodeURIComponent(threadId)}`, baseUrl);

let response;
try {
  response = await fetch(endpoint, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(3_000),
  });
} catch {
  fail('Codex Web user context is unavailable: the local service could not be reached.');
}

if (!response.ok) {
  fail(response.status === 404
    ? 'Codex Web user context is unavailable for this thread.'
    : `Codex Web user context request failed with HTTP ${response.status}.`);
}

let context;
try {
  context = await response.json();
} catch {
  fail('Codex Web user context is unavailable: the local service returned invalid JSON.');
}

if (
  context?.schemaVersion !== 1
  || context.codexThreadId !== threadId
  || typeof context.appSessionId !== 'string'
  || typeof context.owner?.userId !== 'string'
  || typeof context.owner?.username !== 'string'
  || (context.owner.email !== null && typeof context.owner.email !== 'string')
  || typeof context.project?.id !== 'string'
  || typeof context.project?.displayName !== 'string'
) {
  fail('Codex Web user context is unavailable: the local service returned an unexpected response.');
}

process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
