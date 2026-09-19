import type { ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { FileReportStore, CodexWebReport } from './report_store.js';

/** Caller has authenticated; permission is checked again against the opened file's metadata. */
export async function writeReportDownload(response: ServerResponse, store: FileReportStore, id: string, visible: (report: CodexWebReport) => boolean = () => true) {
  const opened = await store.openContent(id);
  if (!opened) { response.writeHead(404, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'report_not_found' })); return; }
  const { report, handle } = opened;
  try {
    if (!visible(report)) { response.writeHead(404, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'report_not_found' })); return; }
    response.writeHead(200, {
      'Content-Type': report.kind === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Content-Length': report.sizeBytes,
      'Content-Disposition': `attachment; filename="report.${report.kind === 'html' ? 'html' : 'md'}"; filename*=UTF-8''${encodeURIComponent(report.id.split('/').at(-1)!)}`,
      'Cache-Control': 'private, no-store',
    });
    await pipeline(handle.createReadStream({ autoClose: false }), response);
  } finally { await handle.close(); }
}
