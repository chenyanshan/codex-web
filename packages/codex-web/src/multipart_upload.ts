import busboy from 'busboy';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface ParsedUploadFile { fileName: string; mimeType: string | null; tempPath: string; sizeBytes: number }
export const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = 32 * 1024 * 1024;
let activeUploads = 0;

function uploadError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** Backpressure to disk, at most four concurrent 32 MiB requests, no whole-body copies. */
export async function withMultipartFiles<T>(request: IncomingMessage, operation: (files: ParsedUploadFile[]) => Promise<T>, options: { bodyLimit?: number; fileLimit?: number; tempRoot?: string } = {}): Promise<T> {
  if (activeUploads >= 4) throw uploadError(429, 'upload_busy', 'Other uploads are in progress. Retry shortly.');
  const bodyLimit = options.bodyLimit ?? MAX_UPLOAD_BODY_BYTES, fileLimit = options.fileLimit ?? MAX_UPLOAD_FILE_BYTES;
  if (Number(request.headers['content-length']) > bodyLimit) throw uploadError(413, 'payload_too_large', 'Upload request is too large.');
  let parser: ReturnType<typeof busboy>;
  try { parser = busboy({ headers: request.headers, defParamCharset: 'utf8', limits: { files: 20, parts: 24, fields: 4, fieldSize: 4096, fileSize: fileLimit + 1 } }); }
  catch { throw uploadError(400, 'invalid_upload', 'Upload request must use multipart/form-data.'); }
  activeUploads++;
  let directory = '';
  const files: ParsedUploadFile[] = [], writes: Promise<void>[] = [];
  let bytes = 0, failure: Error | null = null;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > bodyLimit ? uploadError(413, 'payload_too_large', 'Upload request is too large.') : null, chunk);
  } });
  const fail = (error: Error) => { failure ||= error; parser.destroy(error); };
  const aborted = () => fail(uploadError(400, 'upload_aborted', 'Upload was cancelled.'));
  const idle = () => fail(uploadError(408, 'upload_timeout', 'Upload stopped receiving data. Retry the file.'));
  const deadline = setTimeout(idle, 10 * 60_000); deadline.unref();
  meter.on('error', fail);
  parser.on('filesLimit', () => fail(uploadError(413, 'payload_too_large', 'Too many uploaded files.')));
  parser.on('partsLimit', () => fail(uploadError(413, 'payload_too_large', 'Too many upload parts.')));
  parser.on('file', (name, stream, info) => {
    if (!['files', 'file'].includes(name) || !info.filename) { stream.resume(); return; }
    const file: ParsedUploadFile = { fileName: path.basename(info.filename.replace(/\\/gu, '/')) || 'upload', mimeType: info.mimeType || null, tempPath: path.join(directory, String(files.length)), sizeBytes: 0 };
    files.push(file);
    stream.on('data', (chunk: Buffer) => { file.sizeBytes += chunk.length; if (file.sizeBytes > fileLimit) fail(uploadError(413, 'payload_too_large', 'Uploaded file is too large.')); });
    const write = pipeline(stream, createWriteStream(file.tempPath, { flags: 'wx', mode: 0o600 })).catch(error => { fail(error); });
    writes.push(write);
  });
  request.on('aborted', aborted); request.on('error', fail); request.setTimeout(60_000, idle);
  const parsed = new Promise<void>((resolve, reject) => { parser.on('finish', resolve); parser.on('error', reject); });
  // Attach a handler before asynchronous filesystem setup can finish or the peer can abort.
  void parsed.catch(() => {});
  try {
    directory = await fs.mkdtemp(path.join(options.tempRoot ?? os.tmpdir(), 'codex-web-upload-'));
    if (request.aborted || failure) throw failure || uploadError(400, 'upload_aborted', 'Upload was cancelled.');
    request.pipe(meter).pipe(parser);
    await parsed; await Promise.all(writes);
    if (failure) throw failure;
    if (!files.length) throw uploadError(400, 'invalid_upload', 'Upload request must include at least one file.');
    return await operation(files);
  } finally {
    request.unpipe(meter); meter.unpipe(parser);
    request.off('aborted', aborted); request.off('error', fail); request.off('timeout', idle); request.setTimeout(0);
    clearTimeout(deadline); meter.destroy(); parser.destroy();
    await Promise.allSettled(writes);
    try { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
    finally { activeUploads--; }
  }
}
