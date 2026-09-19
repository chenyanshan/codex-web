// @ts-check
/** @typedef {{key: string, loaded: boolean, loading: boolean, error: string}} ResourceState */
(function installAdminData() {
  /** @param {{request: (path: string, options: {signal: AbortSignal}) => Promise<any>, onError: (error: any) => void}} options */
  function createStore(options) {
    /** @type {Map<string, ResourceState>} */
    const states = new Map();
    /** @type {Map<string, {controller: AbortController, promise: Promise<any>}>} */
    const active = new Map();
    /** @param {string} name */
    function get(name) {
      if (!states.has(name)) states.set(name, { key: '', loaded: false, loading: false, error: '' });
      return /** @type {ResourceState} */ (states.get(name));
    }
    /** @param {string} name @param {string} path @param {(data: any) => void} apply @param {{force?: boolean, retain?: boolean}} [settings] */
    function load(name, path, apply, { force = false, retain = false } = {}) {
      const info = get(name), pending = active.get(name);
      if (info.key === path && pending) return pending.promise;
      if (info.key === path && info.loaded && !force) return Promise.resolve(null);
      pending?.controller.abort();
      if (info.key !== path && !retain) info.loaded = false;
      info.key = path; info.loading = true; info.error = '';
      const controller = new AbortController();
      const operation = { controller, promise: /** @type {Promise<any>} */ (Promise.resolve(null)) };
      active.set(name, operation);
      operation.promise = Promise.resolve().then(() => options.request(path, { signal: controller.signal })).then(data => {
        if (active.get(name) !== operation || controller.signal.aborted) return null;
        apply(data); info.loaded = true;
        return data;
      }).catch(error => {
        if (active.get(name) !== operation || controller.signal.aborted) return null;
        info.error = error?.payload?.message || error?.message || 'Request failed';
        options.onError(error);
        return null;
      }).finally(() => {
        if (active.get(name) !== operation) return;
        active.delete(name); info.loading = false;
      });
      return operation.promise;
    }
    function clear() { for (const entry of active.values()) entry.controller.abort(); active.clear(); states.clear(); }
    return { get, load, clear };
  }
  /** @param {any} context */
  function createFacade(context) {
    const { state, store, currentPage, isAdmin, generation, isCurrent, sessionsPath, normalizeItems, render } = context;
    /** @param {string} [page] @returns {string[]} */
    function pageResources(page = currentPage()) {
      const pages = /** @type {Record<string, string[]>} */ ({ projects: ['projects'], roles: ['roles', 'projects'], users: ['users', 'roles'], sessions: ['sessions', 'users', 'projects'], system: ['settings', 'metrics', 'version', 'devices'] });
      return pages[page] || [];
    }
    /** @param {string} name @param {{force?: boolean, renderAfter?: boolean, cursor?: string}} [options] */
    async function load(name, { force = false, renderAfter = true, cursor = '' } = {}) {
      if (!isAdmin()) return null;
      const started = generation();
      const paths = /** @type {Record<string, string>} */ ({ metrics: '/api/metrics', version: '/version.json', devices: '/api/auth/sessions' });
      const path = name === 'sessions' ? sessionsPath(state.admin.filterUserId, state.admin.filterProjectId, state.admin.filterState, cursor) : paths[name] || `/api/admin/${name}`;
      const request = store.load(name, path, (/** @type {any} */ payload) => {
        if (!isCurrent(started)) return;
        if (name === 'settings') state.admin.settings = payload?.settings || null;
        else if (name === 'sessions') {
          const items = normalizeItems(payload);
          state.admin.sessions = cursor ? [...state.admin.sessions, ...items.filter((/** @type {any} */ item) => !state.admin.sessions.some((/** @type {any} */ old) => old.id === item.id))] : items;
          state.admin.sessionsPage = cursor ? Math.floor(Math.max(0, state.admin.sessions.length - items.length) / 30) : 0;
          state.admin.sessionsNextCursor = payload?.nextCursor || null;
          state.admin.sessionsHasMore = payload?.hasMore === true;
        } else if (name === 'devices') state.admin.devices = payload?.sessions || [];
        else state.admin[name] = ['metrics', 'version'].includes(name) ? payload : normalizeItems(payload);
        state.admin.loaded = true;
      }, { force, retain: Boolean(cursor) });
      state.admin.loading = pageResources().some(key => store.get(key).loading);
      if (renderAfter) render();
      const payload = await request;
      if (isCurrent(started)) { state.admin.loading = pageResources().some(key => store.get(key).loading); if (renderAfter) render(); }
      return payload;
    }
    /** @param {{renderAfter?: boolean, force?: boolean}} [options] */
    async function refresh({ renderAfter = true, force = true } = {}) {
      await Promise.allSettled(pageResources().map(name => load(name, { renderAfter, force })));
      return state.admin;
    }
    return { pageResources, load, refresh };
  }
  /** @param {unknown} projectIds */
  function projectGrantsFromProjectIds(projectIds) {
    const uniqueIds = [...new Set((Array.isArray(projectIds) ? projectIds : [])
      .map((projectId) => String(projectId || '').trim())
      .filter(Boolean))];
    return uniqueIds.map((projectId) => ({
      projectId,
      canRead: true,
      canCreate: true,
      canWrite: true,
    }));
  }

  /** @param {string} [userId] @param {string} [projectId] @param {string} [filterState] @param {string} [cursor] */
  function adminSessionsPath(userId = '', projectId = '', filterState = 'all', cursor = '') {
    const normalizedUserId = String(userId || '').trim();
    const normalizedProjectId = String(projectId || '').trim();
    const normalizedState = normalizeAdminSessionState(filterState);
    const params = [];
    if (normalizedUserId) {
      params.push(`userId=${encodeURIComponent(normalizedUserId)}`);
    }
    if (normalizedProjectId) {
      params.push(`projectId=${encodeURIComponent(normalizedProjectId)}`);
    }
    params.push(`state=${encodeURIComponent(normalizedState)}`, 'limit=30');
    if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
    const query = params.join('&');
    return query ? `/api/admin/sessions?${query}` : '/api/admin/sessions';
  }

  /** @param {unknown} value */
  function normalizeAdminSessionState(value) {
    return value === 'active' || value === 'archived' ? value : 'all';
  }

  Object.assign(globalThis, { CodexWebAdminData: { createStore, createFacade, adminSessionsPath, normalizeAdminSessionState, projectGrantsFromProjectIds } });
}());
