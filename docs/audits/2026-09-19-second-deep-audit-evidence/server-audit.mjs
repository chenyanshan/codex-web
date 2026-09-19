import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { FileIdentityStore } from '../../../packages/codex-web/src/identity_store.ts';
import { AuthStore } from '../../../packages/codex-web/src/auth_store.ts';
import { HybridAuthStore } from '../../../packages/codex-web/src/hybrid_auth_store.ts';
import { FileReportStore } from '../../../packages/codex-web/src/report_store.ts';
import { createCodexWebServer } from '../../../packages/codex-web/src/server.ts';

const output = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-second-audit-'));
const results = { measuredAt: new Date().toISOString(), environment: 'Real HTTP server/auth/stores; temporary synthetic state; stub Codex runtime; no real users or tasks', cases: [] };
let server;
try {
  const identityPath = path.join(dir, 'identity.json');
  const store = new FileIdentityStore({ identityPath });
  const legacy = new AuthStore({ authPath: path.join(dir, 'auth.json') });
  const auth = new HybridAuthStore({ legacyAuth: legacy, identityStore: store });
  const password = 'SyntheticAuditPasswordOnly2026';
  await legacy.setPassword(password); await auth.setMultiUserEnabled(true);
  let login = await auth.login({ username: 'admin', password });
  let runtimeSessions = [], listCalls = [];
  const runtime = {
    listSessions: async (options = {}) => { listCalls.push(options); return runtimeSessions.filter(item => Boolean(item.archived) === Boolean(options.archived)); },
    listModels: async () => [], readUsage: async () => null,
    readSession: async threadId => runtimeSessions.find(item => item.id === threadId) || null,
    getTurnEvents: () => [], subscribeToTurn: () => () => {},
  };
  const config = { host: '127.0.0.1', port: 0, defaultCwd: dir, codexBin: 'codex', stateDir: dir, authPath: path.join(dir, 'auth.json'), reportsDir: path.join(dir, 'reports'), reportIndexPath: path.join(dir, 'report-index.json'), envPath: path.join(dir, 'unused.env'), debug: false, publicSharesEnabled: false, publicShareTtlSeconds: 3600 };
  server = createCodexWebServer({ auth, identityStore: store, runtime, config }); await server.start();
  const headers = () => ({ Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' });
  const before = await fetch(`${server.baseUrl}/api/admin/users`, { headers: headers() }); await before.arrayBuffer();
  const disabled = await fetch(`${server.baseUrl}/api/admin/users/user_admin`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ enabled: false, roleId: 'role_admin' }) }); await disabled.arrayBuffer();
  const after = await fetch(`${server.baseUrl}/api/admin/users`, { headers: headers() }); await after.arrayBuffer();
  const lockedState = await store.readState();
  results.cases.push({ name: 'last_admin_can_disable_self', beforeStatus: before.status, mutationStatus: disabled.status, subsequentAdminRequestStatus: after.status, enabledAdminsRemaining: lockedState.users.filter(user => user.enabled && user.roleIds.some(id => lockedState.roles.some(role => role.id === id && role.isAdmin))).length });
  await store.updateUserAccess({ id: 'user_admin', enabled: true, roleIds: ['role_admin'] });
  login = await auth.login({ username: 'admin', password });
  await store.upsertProject({ id: 'audit-project', internalName: 'audit', cwd: dir, displayName: 'Synthetic audit project', enabled: true, activeSessionLimit: 30, showWorkDetailsToMembers: true });
  const baseState = await store.readState();
  const scale = [];
  for (const count of [1000, 10000]) {
    const state = { ...baseState, sessions: Array.from({ length: count }, (_, i) => ({ id: `audit_app_${i}`, codexThreadId: `audit_thread_${i}`, projectId: 'audit-project', ownerUserId: 'user_admin', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z', archived: false, archivedAt: null, archivedByUserId: null, archiveSource: null })) };
    await fs.writeFile(identityPath, JSON.stringify(state));
    const elapsed = [];
    for (let i = 0; i < 10; i++) { const start = performance.now(); await store.readState(); elapsed.push(performance.now() - start); }
    elapsed.sort((a,b) => a-b);
    scale.push({ sessions: count, fileBytes: (await fs.stat(identityPath)).size, readStateMedianMs: elapsed[5], readStateMaxMs: elapsed.at(-1) });
    if (count === 1000) {
      runtimeSessions = state.sessions.map(item => ({ id: item.codexThreadId, cwd: dir, title: `Custom title ${item.id}`, firstUserInput: `Initial prompt ${item.id}`, settings: {}, archived: false }));
      listCalls = [];
      const start = performance.now(); const response = await fetch(`${server.baseUrl}/api/admin/sessions?limit=30`, { headers: headers() }); const payload = await response.json();
      results.cases.push({ name: 'admin_list_ignores_page_size', status: response.status, requestedLimit: 30, returned: payload.items?.length, hasCursor: Object.hasOwn(payload, 'nextCursor'), responseBytes: Buffer.byteLength(JSON.stringify(payload)), durationMs: performance.now() - start, upstreamListCalls: listCalls.map(call => ({ ...call })), firstItemHasTitle: Object.hasOwn(payload.items[0], 'title'), firstItemSummary: payload.items[0].summary });
      await store.upsertSession({ ...state.sessions[0], archived:true }); runtimeSessions[0].archived=true;
      const defaultList = await (await fetch(`${server.baseUrl}/api/admin/sessions`, { headers:headers() })).json();
      const allList = await (await fetch(`${server.baseUrl}/api/admin/sessions?state=all`, { headers:headers() })).json();
      results.cases.push({ name:'admin_all_filter_contract', frontendAllSelectionOmitsStateQuery:true, defaultCount:defaultList.items.length, explicitAllCount:allList.items.length, archivedInDefault:defaultList.items.some(item => item.archived), archivedInExplicitAll:allList.items.some(item => item.archived) });
    }
  }
  results.cases.push({ name: 'identity_document_scale', samplesPerSize: 10, observations: scale });
  const reportsDir = path.join(dir, 'reports'); await fs.mkdir(path.join(reportsDir, 'audit-project'), { recursive: true });
  await fs.writeFile(path.join(reportsDir, 'audit-project', 'report.md'), '# Synthetic report');
  const indexPath = path.join(dir, 'report-index.json');
  const index = title => JSON.stringify({ version: 1, reports: { 'audit-project/report.md': { title, favorite: true } } });
  await fs.writeFile(indexPath, index('Old report title'));
  const reportStore = new FileReportStore({ reportsDir, indexPath });
  const initial = await reportStore.readReport('audit-project/report.md');
  await fs.writeFile(indexPath, index('Updated report title'));
  const sameInstance = await reportStore.readReport('audit-project/report.md');
  const freshInstance = await new FileReportStore({ reportsDir, indexPath }).readReport('audit-project/report.md');
  results.cases.push({ name: 'report_index_external_update', initialTitle: initial.title, titleAfterExternalUpdate: sameInstance.title, newStoreTitle: freshInstance.title });
  for (const source of ['public', 'dist/public']) {
    const sourceDir = path.join(root, 'packages/codex-web', source);
    const html = await fs.readFile(path.join(sourceDir, 'index.html'), 'utf8');
    const names = ['index.html', ...new Set([...html.matchAll(/(?:src|href)="\/([^"?]+)(?:\?[^" ]*)?"/gu)].map(match => match[1]).filter(name => /\.(js|css)$/u.test(name)))];
    let bytes = 0, gzipBytes = 0;
    for (const file of names) { const data = await fs.readFile(path.join(sourceDir, file)); bytes += data.length; gzipBytes += gzipSync(data, { level: 6 }).length; }
    results.cases.push({ name: `startup_assets_${source.replace('/', '_')}`, scope: 'HTML and its direct JS/CSS dependencies, gzip level 6, excluding icons/dynamic admin module', files: names.length, bytes, gzipBytes });
  }
  results.sourceSha256 = {};
  for (const name of ['identity_store.ts','server.ts','report_store.ts','http_metrics.ts']) results.sourceSha256[name] = createHash('sha256').update(await fs.readFile(path.join(root, 'packages/codex-web/src', name))).digest('hex');
} finally { await server?.stop(); await fs.rm(dir, { recursive: true, force: true }); }
results.completedAt = new Date().toISOString();
await fs.writeFile(`${output}/server-checks.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
