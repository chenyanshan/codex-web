import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileReportStore, REPORT_PREVIEW_BYTES } from '../src/report_store.js';

test('file report store lists markdown and html reports grouped by project', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-reports-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'report-index.json');
  await fs.mkdir(path.join(reportsDir, 'codex-mobile-web-app', '2026-05-19'), { recursive: true });
  await fs.writeFile(path.join(reportsDir, 'codex-mobile-web-app', '2026-05-19', 'summary.md'), '# Summary\n', 'utf8');
  await fs.writeFile(path.join(reportsDir, 'codex-mobile-web-app', '2026-05-19', 'audit.html'), '<h1>Audit</h1>\n', 'utf8');
  await fs.writeFile(path.join(reportsDir, 'codex-mobile-web-app', '2026-05-19', 'notes.txt'), 'ignored\n', 'utf8');

  const store = new FileReportStore({ reportsDir, indexPath });
  const reports = await store.listReports();

  assert.deepEqual(reports.map((report) => ({
    id: report.id,
    project: report.project,
    title: report.title,
    kind: report.kind,
    favorite: report.favorite,
  })), [
    {
      id: 'codex-mobile-web-app/2026-05-19/audit.html',
      project: 'codex-mobile-web-app',
      title: 'audit',
      kind: 'html',
      favorite: false,
    },
    {
      id: 'codex-mobile-web-app/2026-05-19/summary.md',
      project: 'codex-mobile-web-app',
      title: 'summary',
      kind: 'markdown',
      favorite: false,
    },
  ]);
  await assert.rejects(fs.access(indexPath), /ENOENT/u);
});

test('file report store resolves absolute paths only under reports root', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-reports-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'report-index.json');
  const reportPath = path.join(reportsDir, 'project-a', '2026-05-19', 'summary.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '# Summary\n', 'utf8');

  const store = new FileReportStore({ reportsDir, indexPath });
  const resolved = await store.resolveReport(reportPath);

  assert.equal(resolved?.id, 'project-a/2026-05-19/summary.md');
  await assert.rejects(
    () => store.resolveReport(path.join(dir, 'outside.md')),
    /outside the reports directory/u,
  );
});

test('file report store rejects symlinks that escape reports root', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-reports-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'report-index.json');
  const outside = path.join(dir, 'outside.md');
  const link = path.join(reportsDir, 'project-a', '2026-05-19', 'outside.md');
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.writeFile(outside, '# Outside\n', 'utf8');
  await fs.symlink(outside, link);

  const store = new FileReportStore({ reportsDir, indexPath });

  await assert.rejects(
    () => store.readReport('project-a/2026-05-19/outside.md'),
    /outside the reports directory/u,
  );
});

test('report previews stay bounded on UTF-8 boundaries while the opened stream returns full bytes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-report-preview-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const full = 'a'.repeat(REPORT_PREVIEW_BYTES - 1) + '中文结尾'.repeat(3000);
  await fs.writeFile(path.join(dir, 'large.md'), full);
  const store = new FileReportStore({ reportsDir: dir, indexPath: path.join(dir, 'index.json') });
  const preview = await store.readContent('large.md');
  assert.equal(preview!.previewTruncated, true);
  assert.equal(preview!.totalBytes, Buffer.byteLength(full));
  assert.equal(preview!.content, 'a'.repeat(REPORT_PREVIEW_BYTES - 1));
  const opened = await store.openContent('large.md');
  const chunks = [];
  for await (const chunk of opened!.handle.createReadStream()) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), full);
});

test('report pagination bounds each page, applies permissions before selection, and sees index replacement', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-report-pages-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const indexPath = path.join(dir, 'index.json');
  const reports: Record<string, object> = {};
  for (let i = 0; i < 83; i++) { const id = `report-${String(i).padStart(3, '0')}.md`; reports[id] = { updatedAt: '2026-09-19T00:00:00Z', project: i % 2 ? 'visible' : 'hidden', favorite: i === 51 }; await fs.writeFile(path.join(dir, id), '# Report'); }
  await fs.writeFile(indexPath, JSON.stringify({ reports }));
  const store = new FileReportStore({ reportsDir: dir, indexPath });
  const found: string[] = []; let cursor = '';
  do {
    const page = await store.listPage({ cursor, limit: 7, scope: 'reader', visible: report => report.project === 'visible' });
    assert.ok(page.items.length <= 7); found.push(...page.items.map(report => report.id)); cursor = page.nextCursor || '';
    if (cursor) await assert.rejects(store.listPage({ cursor, scope: 'different-reader' }), /Invalid report cursor/u);
  } while (cursor);
  assert.equal(found.length, 41); assert.equal(new Set(found).size, 41); assert.equal(found[0], 'report-051.md');
  reports['report-001.md'] = { title: 'External rename', favorite: true, updatedAt: '2026-09-20T00:00:00Z' };
  await fs.writeFile(`${indexPath}.next`, JSON.stringify({ reports })); await fs.rename(`${indexPath}.next`, indexPath);
  const nextStore = new FileReportStore({ reportsDir: dir, indexPath });
  assert.equal((await nextStore.listPage({ limit: 1 })).items[0]!.title, 'External rename');
});
