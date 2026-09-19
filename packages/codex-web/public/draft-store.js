// @ts-check
/** @typedef {{prompt: string, attachments: object[], updatedAt: number}} Draft */
(function installDraftStore() {
  /** @param {unknown} value @returns {object[]} */
  function normalizeAttachments(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 20).filter((entry) => entry && typeof entry.id === 'string'
      && entry.status === 'ready' && typeof entry.uploaded?.localPath === 'string'
      && entry.uploaded.localPath.length <= 4096).map((entry) => ({
      id: entry.id.slice(0, 512), status: 'ready',
      fileName: String(entry.fileName || entry.uploaded.fileName || 'upload').slice(0, 1024),
      sizeBytes: Math.max(0, Number(entry.sizeBytes) || 0), mimeType: String(entry.mimeType || '').slice(0, 128),
      uploaded: Object.fromEntries(['id', 'localPath', 'fileName', 'mimeType', 'kind', 'url'].filter((key) => typeof entry.uploaded[key] === 'string').map((key) => [key, entry.uploaded[key].slice(0, 4096)])),
    }));
  }
  /** @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} storage */
  function createStore(storage) {
    /** @param {string} owner */
    const key = (owner) => `codexWebPromptDrafts:${owner}`;
    /** @param {string} owner @returns {Record<string, Draft>} */
    function read(owner) {
      if (!owner) return {};
      try {
        const data = JSON.parse(storage.getItem(key(owner)) || '{}');
        if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
        return Object.fromEntries(Object.entries(data).filter(([id, value]) => {
          const draft = /** @type {Draft | null} */ (value);
          return id.length < 1024 && draft && typeof draft.prompt === 'string'
            && draft.prompt.length <= 200000 && Date.now() - draft.updatedAt < 30 * 86400000;
        }).sort((a, b) => /** @type {Draft} */(b[1]).updatedAt - /** @type {Draft} */(a[1]).updatedAt).slice(0, 50).map(([id, value]) => [id, { .../** @type {Draft} */(value), attachments: normalizeAttachments(/** @type {Draft} */(value).attachments) }]));
      } catch { return {}; }
    }
    /** @param {string} owner @param {string} id @param {Draft | null} draft */
    function write(owner, id, draft) {
      if (!owner || !id) return false;
      const drafts = read(owner);
      if (draft && (draft.prompt || draft.attachments.length)) drafts[id] = { ...draft, attachments: normalizeAttachments(draft.attachments) };
      else delete drafts[id];
      const bounded = Object.fromEntries(Object.entries(drafts).sort((a,b) => b[1].updatedAt - a[1].updatedAt).slice(0, 50));
      let serialized = JSON.stringify(bounded);
      for (const oldest of Object.keys(bounded).reverse()) {
        if (serialized.length <= 1000000) break;
        if (oldest === id) continue;
        delete bounded[oldest];
        serialized = JSON.stringify(bounded);
      }
      try { storage.setItem(key(owner), serialized); return true; }
      catch { return false; }
    }
    /** @param {string} owner */
    function clear(owner) { try { if (owner) storage.removeItem(key(owner)); } catch { /* Authentication teardown must still proceed. */ } }
    return { read, write, clear };
  }
  Object.assign(globalThis, { CodexWebDrafts: { createStore } });
}());
