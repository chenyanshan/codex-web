// @ts-check
/** @typedef {{id: string, status: string, fileName: string, sizeBytes: number, mimeType: string, progress?: number, error?: string, uploaded?: any}} UploadAttachment */
/** @typedef {{owner: string, key: string, generation: number, token: string, path: string}} UploadScope */
(function installAttachmentUpload() {
  /** @param {string} path @param {File[]} files @param {{token: string, signal?: AbortSignal, onProgress?: (percent: number) => void}} options */
  function upload(path, files, { token, signal, onProgress }) {
    const body = new FormData();
    for (const file of files) body.append('files', file, file.name || 'upload');
    const headers = { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    if (typeof XMLHttpRequest === 'undefined') return fetch(path, { method: 'POST', body, headers, signal }).then(async response => {
      const payload = await response.json();
      if (!response.ok) throw Object.assign(new Error(payload?.message || 'Upload failed'), { status: response.status, payload });
      return payload;
    });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const aborted = () => xhr.abort();
      /** @param {Error | null} [error] @param {any} [payload] */
      const finish = (error = null, payload = null) => { signal?.removeEventListener('abort', aborted); if (error) reject(error); else resolve(payload); };
      xhr.open('POST', path); xhr.timeout = 10 * 60_000;
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.min(99, Math.floor(event.loaded / event.total * 100))); };
      xhr.onload = () => {
        let payload;
        try { payload = JSON.parse(xhr.responseText); } catch { payload = {}; }
        if (xhr.status >= 200 && xhr.status < 300) finish(null, payload);
        else finish(Object.assign(new Error(payload?.message || 'Upload failed'), { status: xhr.status, payload }));
      };
      xhr.onerror = () => finish(new Error('Upload interrupted. Retry the file.'));
      xhr.ontimeout = () => finish(new Error('Upload timed out. Retry the file.'));
      xhr.onabort = () => finish(Object.assign(new Error('Upload cancelled'), { name: 'AbortError' }));
      if (signal?.aborted) { reject(Object.assign(new Error('Upload cancelled'), { name: 'AbortError' })); return; }
      signal?.addEventListener('abort', aborted, { once: true }); xhr.send(body);
    });
  }

  /** @param {{current: () => UploadScope, attachments: () => UploadAttachment[], changed: (scope: UploadScope, items: UploadAttachment[], progressOnly: boolean) => void, normalize: (uploaded: any, fallback: UploadAttachment) => any}} context */
  function createController(context) {
    /** @type {Map<string, UploadAttachment[]>} */
    const drafts = new Map();
    /** @type {Map<string, {file: File | null, attachment: UploadAttachment, scope: UploadScope, controller: AbortController | null}>} */
    const operations = new Map();
    /** @type {Set<string>} */
    const queued = new Set();
    let queue = Promise.resolve();
    /** @param {string} owner @param {string} key */
    const id = (owner, key) => JSON.stringify([owner, key]);
    /** @param {UploadScope} scope @param {boolean} [progressOnly] */
    function changed(scope, progressOnly = false) {
      const current = context.current();
      if (scope.owner !== current.owner || scope.generation !== current.generation) return;
      context.changed(scope, drafts.get(id(scope.owner, scope.key)) || [], progressOnly);
    }
    /** @param {string} attachmentId */
    async function perform(attachmentId) {
      const entry = operations.get(attachmentId);
      if (!entry?.file || entry.controller) return;
      const current = context.current();
      if (current.owner !== entry.scope.owner || current.generation !== entry.scope.generation) return;
      const controller = new AbortController(); entry.controller = controller;
      Object.assign(entry.attachment, { status: 'uploading', progress: 0, error: '' }); changed(entry.scope);
      try {
        const payload = /** @type {any} */ (await upload(entry.scope.path, [entry.file], { token: entry.scope.token, signal: controller.signal,
          onProgress: progress => { entry.attachment.progress = progress; changed(entry.scope, true); },
        }));
        if (controller.signal.aborted || operations.get(attachmentId) !== entry) return;
        const uploaded = payload?.items?.[0];
        if (!uploaded?.localPath) throw new Error('Upload response did not include a readable file path.');
        Object.assign(entry.attachment, { status: 'ready', progress: 100, uploaded: context.normalize(uploaded, entry.attachment) });
        entry.file = null;
      } catch (error) {
        if (operations.get(attachmentId) !== entry) return;
        entry.attachment.status = 'failed';
        entry.attachment.error = error instanceof Error ? error.message : 'Upload failed';
      } finally { entry.controller = null; changed(entry.scope); }
    }
    /** @param {string} attachmentId */
    function retry(attachmentId) {
      const entry = operations.get(attachmentId);
      if (!entry?.file || entry.controller || queued.has(attachmentId)) return queue;
      queued.add(attachmentId);
      Object.assign(entry.attachment, { status: 'uploading', progress: 0, error: '' }); changed(entry.scope);
      queue = queue.then(() => perform(attachmentId)).finally(() => queued.delete(attachmentId));
      return queue;
    }
    /** @param {File[]} files */
    async function add(files) {
      const scope = context.current(), key = id(scope.owner, scope.key);
      const attachments = drafts.get(key) || [...context.attachments()]; drafts.set(key, attachments);
      if (files.length + attachments.length > 20) throw new Error('You can attach up to 20 files.');
      const entries = files.map(file => {
        const attachment = { id: `local_att_${Date.now()}_${Math.random().toString(16).slice(2)}`, status: 'uploading', fileName: file.name || 'upload', sizeBytes: file.size || 0, mimeType: file.type || '', progress: 0 };
        attachments.push(attachment); operations.set(attachment.id, { file, attachment, scope, controller: null }); return attachment;
      });
      changed(scope);
      // Bound uploads per device; every file has an independent retry and cancel path.
      for (const attachment of entries) await retry(attachment.id);
    }
    /** @param {string} attachmentId */
    function remove(attachmentId) {
      const entry = operations.get(attachmentId); entry?.controller?.abort(); operations.delete(attachmentId);
      const scope = entry?.scope || context.current(), key = id(scope.owner, scope.key);
      drafts.set(key, (drafts.get(key) || context.attachments()).filter(item => item.id !== attachmentId)); changed(scope);
    }
    /** @param {string} owner @param {string} key */
    function clearDraft(owner, key) {
      for (const [attachmentId, entry] of operations) if (entry.scope.owner === owner && entry.scope.key === key) { entry.controller?.abort(); operations.delete(attachmentId); }
      drafts.delete(id(owner, key));
    }
    function clear() { for (const entry of operations.values()) entry.controller?.abort(); operations.clear(); drafts.clear(); }
    /** @param {string} owner @param {string} key @param {UploadAttachment[]} fallback */
    const restore = (owner, key, fallback) => drafts.get(id(owner, key)) || fallback;
    return { add, retry, remove, clear, clearDraft, restore };
  }
  Object.assign(globalThis, { CodexWebAttachmentUpload: { createController, upload } });
}());
