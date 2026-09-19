import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpMetrics, classifyHttpRoute } from '../src/http_metrics.js';

test('API latency excludes event lifetime and assets; groups, samples, aborts and errors stay bounded', t => {
  let now = 0; const metrics = new HttpMetrics(() => now); t.after(() => metrics.stop());
  const timeline = metrics.begin('/api/sessions/private-id/timeline'); now += 100; timeline(503); timeline(503);
  const status = metrics.begin('/api/sessions/other-id/status'); now += 12; status(200);
  const handshake = metrics.begin('/api/turns/private-id/events'); now += 5; handshake(200);
  const close = metrics.streamOpened();
  now += 600000;
  const asset = metrics.begin('/app.js'); now += 5000; asset(200);
  const aborted = metrics.begin('/api/sessions/private/attachments', 'POST'); now += 200; aborted(200, true);
  const forbidden = metrics.begin('/api/admin/users', 'POST'); forbidden(403);
  for (let i = 0; i < 1300; i++) { const request = metrics.begin(`/api/sessions/${i}/status`); now++; request(200); }
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.active, 0); assert.equal(snapshot.activeStreams, 1); assert.equal(snapshot.errors, 1); assert.equal(snapshot.aborted, 1);
  assert.ok(snapshot.requestP95Ms <= 100); assert.equal(snapshot.samples, 1024);
  assert.equal(snapshot.routes.history!.errors, 1); assert.equal(snapshot.routes.events!.requestP95Ms, 5);
  assert.equal(snapshot.routes.status!.samples, 256); assert.equal(snapshot.routes.admin!.clientErrors, 1);
  assert.equal(Object.keys(snapshot.routes).length, 13);
  assert.equal(JSON.stringify(snapshot).includes('private-id'), false);
  close(); close(); assert.equal(metrics.snapshot().activeStreams, 0);
  assert.equal(classifyHttpRoute('/api/share/token/reports/report/download'), 'files');
  assert.equal(classifyHttpRoute('/api/health'), 'health');
  metrics.historyPage(50); metrics.historyPage(13);
  assert.deepEqual(metrics.snapshot().history, { pages: 2, items: 63, pageItemsP95: 13 });
});
