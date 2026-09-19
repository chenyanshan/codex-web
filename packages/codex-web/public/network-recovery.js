(function initializeNetworkRecovery(globalScope) {
  function retryable(error) {
    const status = Number(error?.status);
    if (status) return [408, 425, 429, 500, 502, 503, 504].includes(status);
    return error?.name === 'TimeoutError' || /load failed|network|fetch|terminated|abort|connection|offline/i.test(String(error?.message || error || ''));
  }
  function bounded(task, { signal, timeoutMs = 12000 } = {}) {
    const controller = new AbortController();
    let timer;
    let rejectWait;
    const waiting = new Promise((_resolve, reject) => { rejectWait = reject; });
    const abort = () => {
      const error = signal?.reason || Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
      controller.abort(error); rejectWait(error);
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener?.('abort', abort, { once: true });
    if (timeoutMs > 0) timer = setTimeout(() => {
      const error = Object.assign(new Error('Request timed out. Try again.'), { name: 'TimeoutError' });
      controller.abort(error); rejectWait(error);
    }, timeoutMs);
    let operation;
    try { operation = controller.signal.aborted ? waiting : Promise.resolve(task(controller.signal)); } catch (error) { operation = Promise.reject(error); }
    return Promise.race([operation, waiting]).finally(() => {
      clearTimeout(timer); signal?.removeEventListener?.('abort', abort);
    });
  }

  // Connection health is independent of a turn's success/failure and cached UI state.
  function createConnectionState({ owner, state, changed, request, canCheck, recover }) {
    const failures = new Map();
    let currentOwner = owner();
    let sequence = 0;
    let recoveredSequence = 0;
    let checking = null;
    let checkingOwner = '';
    function ticket() {
      if (currentOwner !== owner()) { currentOwner = owner(); failures.clear(); sequence += 1; }
      return { owner: currentOwner, sequence };
    }
    const current = snapshot => snapshot?.owner === ticket().owner;
    function failed(scope, error, snapshot = ticket()) {
      if (!current(snapshot) || snapshot.sequence < recoveredSequence || error?.name === 'AbortError' || !retryable(error)) return;
      const previous = failures.get(scope);
      failures.delete(scope);
      failures.set(scope, { sequence: ++sequence, status: Number(error?.status) || previous?.status || 0, message: error?.message });
      if (failures.size > 32) failures.delete(failures.keys().next().value);
      changed();
    }
    function succeeded(scope, snapshot) {
      const failure = failures.get(scope);
      if (current(snapshot) && failure && snapshot.sequence >= failure.sequence) {
        if (state.error === failure.message) state.error = '';
        failures.delete(scope); changed();
      }
    }
    function label(t = value => value) {
      ticket();
      if (!failures.size) return '';
      const last = [...failures.values()].reverse().find(failure => failure.status) || [...failures.values()].at(-1);
      return [t('Connection interrupted'), last.status ? `HTTP ${last.status}` : '', t('Reconnecting')].filter(Boolean).join(' · ');
    }
    function check() {
      if (!canCheck()) return Promise.resolve();
      const snapshot = ticket();
      if (checking && checkingOwner === snapshot.owner) return checking;
      checkingOwner = snapshot.owner;
      const task = (async () => {
        try {
          await request('/api/health', { trackConnection: false, timeoutMs: 5000 });
          if (!current(snapshot)) return;
          const recovering = failures.size > 0;
          if (recovering && await recover() === false) return;
          if (!current(snapshot) || sequence !== snapshot.sequence) return;
          for (const [scope, failure] of failures) {
            if (scope === 'stream' && state.pendingTurn) continue;
            if (state.error === failure.message) state.error = '';
            failures.delete(scope);
          }
          if (recovering && !failures.size) recoveredSequence = ++sequence;
          changed();
        } catch (error) { failed('probe', error, snapshot); }
      })().finally(() => { if (checking === task) checking = null; });
      checking = task;
      return task;
    }
    return { ticket, failed, succeeded, label, check };
  }

  async function buildApiError(response) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    return Object.assign(new Error(payload?.message || payload?.error || `HTTP ${response.status}`), { status: response.status, payload });
  }

  function createApiClient({ state, rename, connection }) {
    async function request(path, options = {}) {
      const snapshot = connection.ticket();
      const nameRequest = rename.capture();
      const scope = `api:${path.split('?')[0]}`;
      const headers = { Accept: 'application/json', ...(options.skipAuth ? {} : state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      try {
        const result = await bounded(async signal => {
          const response = await fetch(path, { method: options.method || 'GET', headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined, signal });
          if (!response.ok) throw await buildApiError(response);
          return response.status === 204 ? null : rename.reconcile(await response.json(), nameRequest);
        }, { signal: options.signal, timeoutMs: options.timeoutMs ?? ((!options.method || options.method === 'GET') ? 12000 : 0) });
        if (options.trackConnection !== false) connection.succeeded(scope, snapshot);
        return result;
      } catch (error) {
        if (options.trackConnection !== false) connection.failed(scope, error, snapshot);
        throw error;
      }
    }
    return { request };
  }
  function createAuthRecovery(context) {
    const { state, apiFetch, getGeneration, isAuthRequestCurrent, render, isCachedAuthPrincipalPending, currentSubmissionOwnerKey,
      replayActiveTurnAfterPrincipalConfirmation, resolvePendingWorkDetailsPolicy, refreshProjectsList, refreshSessionsList,
      applyGlobalSettingsPayload, initializeDefaultThreadSettingsFromCodex, restoreWorkspaceStateFromCache, applySessionSettings,
      syncRuntimeStatusFromSession, restoreTurnEventCursor, applyDefaultSettings, connectActiveTurnStream, reconcileCurrentSessionInBackground,
      drainSubmissionOutbox, handleApiError, wasWorkspaceRestored, t, escapeHtml } = context;
    let pending = null;
    let pendingKey = '';
    let failed = false;
    let lastRecoveryAt = 0;
    let modelsPending = null;
    let modelsKey = '';
    let scheduledRecovery = null;
    let scheduledKey = '';
    const key = () => `${getGeneration()}:${state.token}`;
    const valid = (generation, token) => isAuthRequestCurrent(generation) && state.token === token;
    const needsRecovery = () => Boolean(state.token && (failed || state.authSession?.id === 'cached'));
    function applyStartupDefaults() {
      const retained = Object.fromEntries(Object.keys(state.draftSettingsEdited || {}).map((field) => [field, state[field]]));
      applyDefaultSettings();
      Object.assign(state, retained);
    }
    function loadModels(request = null) {
      const owner = key();
      if (modelsPending && modelsKey === owner) return modelsPending;
      const generation = getGeneration(); const token = state.token;
      state.modelsLoading = true; state.modelsError = '';
      modelsKey = owner;
      const task = (async () => {
        try {
          const payload = await (request || apiFetch('/api/models'));
          if (!valid(generation, token)) return;
          state.models = Array.isArray(payload.items) ? payload.items : [];
          initializeDefaultThreadSettingsFromCodex(payload.defaults);
          if (!state.sessionId) applyStartupDefaults();
        } catch (error) {
          if (!valid(generation, token)) return;
          state.modelsError = 'Models could not be loaded.';
          if ([401, 403].includes(error?.status)) handleApiError(error, { auth: true });
        } finally {
          if (valid(generation, token)) { state.modelsLoading = false; render(); }
        }
      })().finally(() => { if (modelsPending === task) modelsPending = null; });
      modelsPending = task;
      return task;
    }
    function modelFeedback() {
      if (state.modelsLoading) return `<p class="meta" role="status">${escapeHtml(t('Loading models…'))}</p>`;
      return state.modelsError ? `<p class="meta" role="status">${escapeHtml(t(state.modelsError))} <button class="ghost compact-button" type="button" data-retry-models>${escapeHtml(t('Retry'))}</button></p>` : '';
    }
    function restore({ automatic = false } = {}) {
      if (!state.token) return Promise.resolve(false);
      const owner = key();
      if (pending && pendingKey === owner) return pending;
      if (automatic && Date.now() - lastRecoveryAt < 1000) {
        if (scheduledRecovery && scheduledKey === owner) return scheduledRecovery;
        scheduledKey = owner;
        const deferred = new Promise((resolve) => setTimeout(() => resolve(key() === owner && needsRecovery() ? restore() : false), 1000 - (Date.now() - lastRecoveryAt)))
          .finally(() => { if (scheduledRecovery === deferred) scheduledRecovery = null; });
        scheduledRecovery = deferred; return deferred;
      }
      lastRecoveryAt = Date.now(); pendingKey = owner;
      const task = restoreOnce().finally(() => { if (pending === task) pending = null; });
      pending = task;
      return task;
    }
    async function restoreOnce() {
      const generation = getGeneration(); const token = state.token;
      const current = () => valid(generation, token);
      try {
        state.status = 'Restoring session'; render();
        const requests = Object.fromEntries(['auth/me', 'settings', 'models', 'projects', 'sessions'].map((path) => {
          const request = apiFetch(`/api/${path}`); void request.catch(() => {}); return [path, request];
        }));
        const { session } = await requests['auth/me'];
        if (!current()) return false;
        const wasPending = isCachedAuthPrincipalPending();
        state.authSession = session; failed = false;
        try { localStorage.setItem('codexWebDraftOwner', JSON.stringify({ owner: currentSubmissionOwnerKey(), token })); } catch {}
        if (wasPending) replayActiveTurnAfterPrincipalConfirmation();
        resolvePendingWorkDetailsPolicy();
        state.status = 'Syncing sessions'; state.statusTone = 'warn'; state.error = '';
        void requests.settings.then((payload) => { if (current()) applyGlobalSettingsPayload(payload); }).catch((error) => {
          if (current() && [401, 403].includes(error?.status)) handleApiError(error, { auth: true });
        });
        void loadModels(requests.models);
        void refreshProjectsList({ renderAfter: true, request: requests.projects }).catch((error) => {
          if (current() && [401, 403].includes(error?.status)) handleApiError(error, { auth: true });
        });
        render();
        await refreshSessionsList({ renderAfter: true, scope: 'all', request: requests.sessions }).catch((error) => {
          if (current() && [401, 403].includes(error?.status)) handleApiError(error, { auth: true });
        });
        if (!current()) return false;
        if (!state.sessionId) restoreWorkspaceStateFromCache();
        if (state.sessionId && state.currentSession) {
          applySessionSettings(state.currentSession);
          const runtimeStatus = syncRuntimeStatusFromSession(state.currentSession, { source: 'stale' });
          if (runtimeStatus.activeTurnId) restoreTurnEventCursor(state.sessionId, runtimeStatus.activeTurnId);
        } else applyStartupDefaults();
        if (!state.pendingTurn) { state.status = 'Ready'; state.statusTone = 'success'; }
        render();
        if (state.sessionId && wasWorkspaceRestored()) {
          connectActiveTurnStream({ forceReconnect: true }); void reconcileCurrentSessionInBackground();
        }
        void drainSubmissionOutbox({ force: true });
        return true;
      } catch (error) {
        if (!current()) return false;
        if ([401, 403].includes(error?.status)) { failed = false; handleApiError(error, { auth: true }); return false; }
        failed = true;
        state.sessionsLoading = false; state.sessionsLoadingScope = null;
        state.sessionsError = 'Could not update sessions.';
        state.status = 'Offline'; state.statusTone = 'warn'; state.error = error?.message || 'Could not reconnect';
        render(); return false;
      }
    }
    return { restore, needsRecovery, loadModels, modelFeedback };
  }
  globalScope.CodexWebNetworkRecovery = { bounded, retryable, createAuthRecovery, createConnectionState, createApiClient, buildApiError };
})(globalThis);
