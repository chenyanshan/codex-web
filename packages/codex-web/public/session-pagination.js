(function initializeSessionPagination(globalScope) {
  const scopes = ['favorites', 'all', 'archived'];

  function scopeRecord(valueFactory) {
    return Object.fromEntries(scopes.map((scope) => [scope, valueFactory()]));
  }

  function createState() {
    return {
      sessions: [],
      sessionsByScope: scopeRecord(() => []),
      sessionsLoadedByScope: scopeRecord(() => false),
      sessionsNextCursorByScope: scopeRecord(() => null),
      sessionsQueryByScope: scopeRecord(() => ''),
      sessionsLoading: false,
      sessionsLoadingScope: null,
      sessionsLoadingMore: false,
      sessionsLoadingMoreScope: null,
      sessionsError: '',
      sessionsErrorMode: '',
      sessionsRequestId: 0,
    };
  }

  function resetAllState(state, { incrementRequestId = false } = {}) {
    const previousRequestId = Number(state.sessionsRequestId) || 0;
    Object.assign(state, createState());
    state.sessionsRequestId = incrementRequestId ? previousRequestId + 1 : previousRequestId;
  }

  function normalizeScope(scope) {
    return scope === 'favorites' || scope === 'archived' ? scope : 'all';
  }

  function sessionListPath(state, scope, { cursor = '', includeProject = true } = {}) {
    const normalizedScope = normalizeScope(scope);
    const params = [];
    if (normalizedScope === 'favorites') {
      params.push('favorite=true');
    } else if (normalizedScope === 'archived') {
      params.push('state=archived');
    }
    if (includeProject) {
      const projectId = String(state.selectedProjectId || '').trim();
      const projectKey = String(state.selectedProjectKey || '').trim();
      if (projectId) {
        params.push(`projectId=${encodeURIComponent(projectId)}`);
      } else if (projectKey.startsWith('cwd:') && projectKey.slice(4)) {
        params.push(`cwd=${encodeURIComponent(projectKey.slice(4))}`);
      }
    }
    if (cursor) {
      params.push(`cursor=${encodeURIComponent(cursor)}`);
    }
    return params.length ? `/api/sessions?${params.join('&')}` : '/api/sessions';
  }

  function createController({
    state,
    apiFetch,
    getAuthRequestGeneration,
    isAuthRequestCurrent,
    normalizeSessionsForScope,
    restoreSessionsFromCacheForScope,
    discardSupersededFailedSubmissions,
    syncCurrentWorkDetailsAccessFromSessions,
    enforceKnownWorkDetailsAccess,
    persistSessionsCache,
    currentSessionScope,
    syncCurrentSessionFromList,
    mergeSessionSummary,
    sessionSummaryOnly,
    render,
    translate,
    escapeHtml,
    icon,
  }) {
    const listPath = (scope, options) => sessionListPath(state, scope, options);
    const baseListPath = (scope) => listPath(scope, { includeProject: false });
    const queryKey = (scope) => listPath(scope);

    function scopeMatchesQuery(scope, expectedQuery = queryKey(scope)) {
      const normalizedScope = normalizeScope(scope);
      const storedQuery = state.sessionsQueryByScope[normalizedScope];
      if (storedQuery === expectedQuery) {
        return true;
      }
      return !storedQuery
        && state.sessionsLoadedByScope[normalizedScope] === true
        && expectedQuery === baseListPath(normalizedScope);
    }

    function resetScope(scope, { preserveItems = false } = {}) {
      const normalizedScope = normalizeScope(scope);
      if (!preserveItems) {
        state.sessionsByScope[normalizedScope] = [];
      }
      state.sessionsLoadedByScope[normalizedScope] = false;
      state.sessionsNextCursorByScope[normalizedScope] = null;
      state.sessionsQueryByScope[normalizedScope] = '';
    }

    function mergePage(existing, incoming) {
      const merged = [...existing];
      const indexes = new Map(merged.map((session, index) => [session.id, index]));
      for (const session of incoming) {
        const index = indexes.get(session.id);
        if (typeof index === 'number') {
          merged[index] = sessionSummaryOnly(mergeSessionSummary(merged[index], session));
          continue;
        }
        indexes.set(session.id, merged.length);
        merged.push(session);
      }
      return merged;
    }

    async function refreshSessionsList({
      renderAfter = true,
      scope = state.sortMode === 'favorites' ? 'favorites' : 'all',
      background = false,
      request = null,
      append = false,
      cursor = null,
    } = {}) {
      const requestGeneration = getAuthRequestGeneration();
      const normalizedScope = normalizeScope(scope);
      const expectedQuery = queryKey(normalizedScope);
      const queryMatches = scopeMatchesQuery(normalizedScope, expectedQuery);
      if (queryMatches && !state.sessionsQueryByScope[normalizedScope]) {
        state.sessionsQueryByScope[normalizedScope] = expectedQuery;
      }
      const pageCursor = append
        ? String(cursor || (queryMatches ? state.sessionsNextCursorByScope[normalizedScope] : '') || '')
        : '';
      if (append && !pageCursor) {
        return [...(state.sessionsByScope[normalizedScope] || [])];
      }
      const path = listPath(normalizedScope, { cursor: pageCursor });
      if (background) {
        const payload = await (request || apiFetch(path));
        if (!isAuthRequestCurrent(requestGeneration)) {
          return [];
        }
        const sessions = normalizeSessionsForScope(payload, normalizedScope);
        state.sessionsByScope[normalizedScope] = sessions;
        state.sessionsLoadedByScope[normalizedScope] = true;
        state.sessionsNextCursorByScope[normalizedScope] = normalizeCursor(payload?.nextCursor);
        state.sessionsQueryByScope[normalizedScope] = expectedQuery;
        discardSupersededFailedSubmissions(sessions);
        syncCurrentWorkDetailsAccessFromSessions(sessions);
        enforceKnownWorkDetailsAccess();
        persistSessionsCache();
        return sessions;
      }
      const requestId = state.sessionsRequestId + 1;
      state.sessionsRequestId = requestId;
      if (append) {
        state.sessionsLoadingMore = true;
        state.sessionsLoadingMoreScope = normalizedScope;
      } else {
        state.sessionsLoading = true;
        state.sessionsLoadingScope = normalizedScope;
      }
      state.sessionsError = '';
      state.sessionsErrorMode = '';
      if (!append && !queryMatches) {
        resetScope(normalizedScope, { preserveItems: true });
      }
      if (!append) {
        restoreSessionsFromCacheForScope(normalizedScope, expectedQuery);
      }
      state.sessionsScope = normalizedScope;
      state.sessions = normalizedScope === currentSessionScope()
        ? [...(state.sessionsByScope[normalizedScope] || [])]
        : [];
      if (renderAfter) {
        render();
      }
      try {
        const payload = await (request || apiFetch(path));
        if (!isAuthRequestCurrent(requestGeneration)) {
          return [];
        }
        const pageSessions = normalizeSessionsForScope(payload, normalizedScope);
        if (requestId !== state.sessionsRequestId || expectedQuery !== queryKey(normalizedScope)) {
          return pageSessions;
        }
        const sessions = append
          ? mergePage(state.sessionsByScope[normalizedScope] || [], pageSessions)
          : pageSessions;
        state.sessionsByScope[normalizedScope] = sessions;
        state.sessionsLoadedByScope[normalizedScope] = true;
        state.sessionsNextCursorByScope[normalizedScope] = normalizeCursor(payload?.nextCursor);
        state.sessionsQueryByScope[normalizedScope] = expectedQuery;
        discardSupersededFailedSubmissions(sessions);
        syncCurrentWorkDetailsAccessFromSessions(sessions);
        enforceKnownWorkDetailsAccess();
        persistSessionsCache();
        if (
          requestId !== state.sessionsRequestId
          || normalizedScope !== currentSessionScope()
          || expectedQuery !== queryKey(normalizedScope)
        ) {
          return sessions;
        }
        state.sessions = [...sessions];
        state.sessionsScope = normalizedScope;
        syncCurrentSessionFromList();
        return state.sessions;
      } catch (error) {
        if (
          requestId === state.sessionsRequestId
          && normalizedScope === currentSessionScope()
          && isAuthRequestCurrent(requestGeneration)
        ) {
          state.sessionsError = append ? 'Could not load older sessions.' : 'Could not update sessions.';
          state.sessionsErrorMode = append ? 'more' : 'refresh';
        }
        throw error;
      } finally {
        if (requestId === state.sessionsRequestId) {
          if (append) {
            state.sessionsLoadingMore = false;
            state.sessionsLoadingMoreScope = null;
          } else {
            state.sessionsLoading = false;
            state.sessionsLoadingScope = null;
          }
        }
        if (renderAfter && isAuthRequestCurrent(requestGeneration)) {
          render();
        }
      }
    }

    async function loadMoreSessions() {
      if (state.sessionsLoading || state.sessionsLoadingMore) {
        return [...state.sessions];
      }
      const scope = currentSessionScope();
      const expectedQuery = queryKey(scope);
      if (state.sessionsQueryByScope[scope] !== expectedQuery) {
        return refreshSessionsList({ renderAfter: true, scope });
      }
      const cursor = state.sessionsNextCursorByScope[scope];
      if (!cursor) {
        return [...state.sessions];
      }
      return refreshSessionsList({
        renderAfter: true,
        scope,
        append: true,
        cursor,
      });
    }

    function renderPagination() {
      const scope = currentSessionScope();
      if (state.sessionsLoadingMore && state.sessionsLoadingMoreScope === scope) {
        return `<div class="session-list-pagination" role="status">${escapeHtml(translate('Loading older sessions...'))}</div>`;
      }
      if (!scopeMatchesQuery(scope) || !state.sessionsNextCursorByScope[scope]) {
        return '';
      }
      return `
        <div class="session-list-pagination">
          <button class="ghost session-list-load-more" type="button" id="load-more-sessions-button">
            ${icon('chevronDown', { className: 'button-icon' })}
            <span>${escapeHtml(translate('Load older sessions'))}</span>
          </button>
        </div>
      `;
    }

    return Object.freeze({
      baseListPath,
      listPath,
      loadMoreSessions,
      normalizeScope,
      queryKey,
      refreshSessionsList,
      renderPagination,
      resetAllState: (options) => resetAllState(state, options),
      resetScope,
      scopeMatchesQuery,
    });
  }

  function normalizeCursor(value) {
    return typeof value === 'string' && value ? value : null;
  }

  globalScope.CodexWebSessionPagination = Object.freeze({
    createController,
    createState,
    resetAllState,
  });
})(globalThis);
