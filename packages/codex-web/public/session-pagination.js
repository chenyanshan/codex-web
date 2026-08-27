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
      sessionListStatsByScope: scopeRecord(() => null),
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

    function applyStats(scope, payload) {
      const stats = normalizeSessionListStats(payload);
      state.sessionListStatsByScope[normalizeScope(scope)] = stats;
      return stats;
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
        applyStats(normalizedScope, payload);
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
        applyStats(normalizedScope, payload);
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
      applyStats,
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

  function normalizeSessionListStats(payload) {
    const totalCount = Number(payload?.totalCount);
    if (!Number.isInteger(totalCount) || totalCount < 0 || !Array.isArray(payload?.projectCounts)) {
      return null;
    }
    const projectCounts = [];
    const seen = new Set();
    for (const item of payload.projectCounts) {
      const projectKey = String(item?.projectKey || '').trim();
      const sessionCount = Number(item?.sessionCount);
      if (!projectKey || seen.has(projectKey) || !Number.isInteger(sessionCount) || sessionCount < 0) {
        continue;
      }
      seen.add(projectKey);
      projectCounts.push({
        projectKey,
        projectId: String(item?.projectId || '').trim(),
        projectDisplayName: String(item?.projectDisplayName || '').trim(),
        cwd: String(item?.cwd || '').trim(),
        sessionCount,
        latestAt: Math.max(0, Number(item?.latestAt) || 0),
      });
    }
    return { totalCount, projectCounts };
  }

  function summarizeWorkspaceProjects({
    projects = [],
    sessions = [],
    pendingSessions = [],
    stats = null,
    projectScope,
    projectVisibleName,
  }) {
    const normalizedStats = normalizeSessionListStats(stats);
    const authoritative = Boolean(normalizedStats);
    const aggregateStats = new Map();
    for (const item of normalizedStats?.projectCounts || []) {
      const scope = projectScope(item);
      if (!scope?.key) {
        continue;
      }
      const existing = aggregateStats.get(scope.key);
      aggregateStats.set(scope.key, existing
        ? {
            ...existing,
            sessionCount: existing.sessionCount + item.sessionCount,
            latestAt: Math.max(existing.latestAt, item.latestAt),
          }
        : { ...scope, sessionCount: item.sessionCount, latestAt: item.latestAt });
    }
    const items = new Map();
    for (const project of projects) {
      const id = String(project?.id || '').trim();
      if (!id) {
        continue;
      }
      const stat = aggregateStats.get(id);
      items.set(id, {
        key: id,
        id,
        label: projectVisibleName(project, id),
        defaultCwd: String(project?.cwd || ''),
        sessionCount: stat?.sessionCount || 0,
        latestAt: stat?.latestAt || 0,
        canCreate: project?.canCreate !== false,
        favorite: project?.favorite === true,
        source: 'managed',
        countAuthoritative: authoritative,
      });
    }
    for (const stat of aggregateStats.values()) {
      const existing = items.get(stat.key);
      if (existing) {
        existing.sessionCount = stat.sessionCount;
        existing.latestAt = Math.max(existing.latestAt, stat.latestAt);
        continue;
      }
      items.set(stat.key, {
        key: stat.key,
        id: stat.id || '',
        label: stat.label,
        defaultCwd: stat.defaultCwd || '',
        sessionCount: stat.sessionCount,
        latestAt: stat.latestAt,
        canCreate: Boolean(stat.id),
        favorite: false,
        source: stat.id ? 'managed' : 'legacy',
        countAuthoritative: true,
      });
    }
    const mergeSession = (session, pending) => {
      const scope = projectScope(session);
      if (!scope?.key) {
        return;
      }
      const existing = items.get(scope.key) || {
        key: scope.key,
        id: scope.id,
        label: scope.label,
        defaultCwd: scope.defaultCwd,
        sessionCount: 0,
        latestAt: 0,
        canCreate: Boolean(scope.id),
        favorite: false,
        source: scope.id ? 'managed' : 'legacy',
        countAuthoritative: authoritative,
      };
      existing.label = existing.label || scope.label;
      existing.defaultCwd = existing.defaultCwd || scope.defaultCwd;
      if (pending || !existing.countAuthoritative) {
        existing.sessionCount += 1;
      }
      existing.latestAt = Math.max(existing.latestAt || 0, scope.latestAt || 0);
      items.set(scope.key, existing);
    };
    sessions.forEach((session) => mergeSession(session, false));
    pendingSessions.forEach((session) => mergeSession(session, true));
    const sorted = [...items.values()].map(({ countAuthoritative: _ignored, ...item }) => item).sort((left, right) => (
      Number(Boolean(right.favorite)) - Number(Boolean(left.favorite))
      || right.sessionCount - left.sessionCount
      || right.latestAt - left.latestAt
      || String(left.label || '').localeCompare(String(right.label || ''))
    ));
    return {
      projects: sorted,
      totalCount: (normalizedStats?.totalCount ?? sessions.length) + pendingSessions.length,
    };
  }

  function transitionStatsByScope(statsByScope, {
    previous = null,
    next = null,
    projectScope,
    belongsToScope,
  }) {
    if (!statsByScope || typeof projectScope !== 'function' || typeof belongsToScope !== 'function') {
      return statsByScope;
    }
    for (const scope of scopes) {
      const scopedPrevious = previous && belongsToScope(previous, scope) ? previous : null;
      const scopedNext = next && belongsToScope(next, scope) ? next : null;
      if (!scopedPrevious && !scopedNext) {
        continue;
      }
      const adjusted = transitionSessionListStats(
        statsByScope[scope],
        scopedPrevious,
        scopedNext,
        projectScope,
      );
      if (adjusted) {
        statsByScope[scope] = adjusted;
      }
    }
    return statsByScope;
  }

  function transitionSessionListStats(stats, previous, next, projectScope) {
    const normalized = normalizeSessionListStats(stats);
    if (!normalized) {
      return null;
    }
    const projects = new Map();
    for (const item of normalized.projectCounts) {
      const scope = projectScope(item);
      if (scope?.key) {
        projects.set(scope.key, { ...item });
      }
    }
    const changeProjectCount = (session, delta) => {
      const scope = projectScope(session);
      if (!scope?.key) {
        return;
      }
      const existing = projects.get(scope.key);
      if (existing) {
        const sessionCount = existing.sessionCount + delta;
        if (sessionCount <= 0) {
          projects.delete(scope.key);
          return;
        }
        projects.set(scope.key, {
          ...existing,
          sessionCount,
          latestAt: delta > 0 ? Math.max(existing.latestAt, scope.latestAt || 0) : existing.latestAt,
        });
        return;
      }
      if (delta < 0) {
        return;
      }
      projects.set(scope.key, {
        projectKey: scope.key,
        projectId: scope.id || '',
        projectDisplayName: scope.label || '',
        cwd: scope.defaultCwd || '',
        sessionCount: delta,
        latestAt: scope.latestAt || 0,
      });
    };
    if (previous) {
      changeProjectCount(previous, -1);
    }
    if (next) {
      changeProjectCount(next, 1);
    }
    return {
      totalCount: Math.max(0, normalized.totalCount + Number(Boolean(next)) - Number(Boolean(previous))),
      projectCounts: [...projects.values()].sort((left, right) => (
        right.sessionCount - left.sessionCount
        || right.latestAt - left.latestAt
        || left.projectKey.localeCompare(right.projectKey)
      )),
    };
  }

  globalScope.CodexWebSessionPagination = Object.freeze({
    createController,
    createState,
    normalizeSessionListStats,
    resetAllState,
    summarizeWorkspaceProjects,
    transitionStatsByScope,
  });
})(globalThis);
