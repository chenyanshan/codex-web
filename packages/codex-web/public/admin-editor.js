// @ts-check
/** @typedef {string | boolean | number | null | string[]} AdminField */
/** @typedef {{values: Record<string, AdminField>, dirty: boolean, saving: boolean, error: string}} AdminDraft */
(function installAdminEditor() {
  function createStore() {
    /** @type {Map<string, AdminDraft>} */
    const drafts = new Map();
    /** @type {Map<string, symbol>} */
    const writes = new Map();
    /** @param {string} kind @param {string} id */
    const key = (kind, id) => JSON.stringify([kind, id]);
    /** @param {string} kind @param {string} id @param {Record<string, AdminField>} [initial] */
    function get(kind, id, initial = {}) {
      const entryKey = key(kind, id);
      let draft = drafts.get(entryKey);
      if (!draft) {
        draft = { values: Object.fromEntries(Object.entries(initial).map(([name, value]) => [name, Array.isArray(value) ? [...value] : value])), dirty: false, saving: false, error: '' };
        drafts.set(entryKey, draft);
      }
      return draft;
    }
    /** @param {string} kind @param {string} id @param {string} name @param {AdminField} value */
    function edit(kind, id, name, value) {
      const draft = get(kind, id);
      if (draft.saving) return;
      draft.values[name] = Array.isArray(value) ? [...value] : value;
      draft.dirty = true;
    }
    /** @param {string} kind @param {string} id */
    function begin(kind, id) {
      const entryKey = key(kind, id);
      if (writes.has(entryKey)) return null;
      const draft = get(kind, id), token = Symbol(entryKey);
      writes.set(entryKey, token); draft.saving = true; draft.error = '';
      return {
        /** @param {string} message */
        fail(message) { if (writes.get(entryKey) === token) draft.error = message; },
        succeed() { if (writes.get(entryKey) === token) drafts.delete(entryKey); },
        finish() { if (writes.get(entryKey) === token) { writes.delete(entryKey); draft.saving = false; } },
      };
    }
    /** @param {string} kind @param {string} id */
    function discard(kind, id) { if (!writes.has(key(kind, id))) drafts.delete(key(kind, id)); }
    function clear() { drafts.clear(); writes.clear(); }
    return { get, edit, begin, discard, clear };
  }
  /** @param {any} context */
  function createWriter(context) {
    const { state, ADMIN_EDITORS, isAdminPrincipal, getGeneration, isAuthRequestCurrent, apiFetch, loadAdminResource, handleApiError, render, t } = context;
/** @param {string} kind @param {string} editorId @param {string} path @param {string} method @param {any} body @param {string} resultKey */
async function saveAdminRecord(kind, editorId, path, method, body, resultKey) {
  if (!isAdminPrincipal()) return null;
  const operation = ADMIN_EDITORS.begin(kind, editorId);
  if (!operation) return null;
  const generation = getGeneration();
  render();
  try {
    const payload = await apiFetch(path, { method, body });
    if (!isAuthRequestCurrent(generation)) return null;
    operation.succeed();
    const field = `editing${kind[0].toUpperCase()}${kind.slice(1)}Id`;
    if (state.admin[field] === editorId) { state.admin[field] = ''; if (state.admin.editorKind === kind) state.admin.editorKind = ''; }
    state.admin.notice = t('Saved');
    state.error = '';
    await loadAdminResource(`${kind}s`, { force: true });
    return payload?.[resultKey] || null;
  } catch (caught) {
    const error = /** @type {any} */ (caught);
    if (!isAuthRequestCurrent(generation)) return null;
    operation.fail(error?.payload?.message || error?.message || 'Request failed');
    if ([401, 403].includes(error?.status)) handleApiError(error);
    return null;
  } finally {
    operation.finish();
    if (isAuthRequestCurrent(generation)) render();
  }
}

/** @param {any} [patch] */
async function updateAdminSettings(patch = {}) {
  if (!isAdminPrincipal()) {
    return null;
  }
  if (state.admin.settingsSaving) return null;
  state.admin.settingsSaving = true; state.admin.settingsError = ''; render();
  const requestGeneration = getGeneration();
  try {
    const payload = await apiFetch('/api/admin/settings', {
      method: 'PATCH',
      body: patch,
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.admin.settings = payload?.settings || state.admin.settings;
    state.error = '';
    render();
    return state.admin.settings;
  } catch (caught) {
    const error = /** @type {any} */ (caught);
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.admin.settingsError = error?.payload?.message || error?.message || 'Request failed';
    if ([401, 403].includes(error?.status)) handleApiError(error);
    return null;
  } finally {
    if (isAuthRequestCurrent(requestGeneration)) { state.admin.settingsSaving = false; render(); }
  }
}

    return { saveAdminRecord, updateAdminSettings };
  }
  Object.assign(globalThis, { CodexWebAdminEditor: { createStore, createWriter } });
}());
