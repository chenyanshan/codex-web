(function initializeSessionLoader(globalScope) {
  function createLoader({ state, apiFetch, isFatalSessionOpenError, timelinesHaveStableOverlap, mergeLatestTimelineHistory, getOwner = () => state.token }) {
    const pending = new Map();
    const aborted = () => Object.assign(new Error('Session read cancelled.'), { name: 'AbortError' });
    function cancel() {
      for (const entry of pending.values()) entry.controller.abort();
      pending.clear();
    }
    function sharedRequest(path, options, signal, owner, leases, semantics = '') {
      if (signal.aborted || owner !== getOwner()) return Promise.reject(aborted());
      for (const [key, entry] of pending) {
        if (entry.owner !== owner) { pending.delete(key); entry.controller.abort(); }
      }
      const key = JSON.stringify([owner, path, semantics]);
      let entry = pending.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = { controller, owner, users: 0, promise: null, key };
        pending.set(key, entry);
        // Cancellation also settles callers if a transport ignores AbortSignal.
        const cancellation = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(aborted()), { once: true }));
        let accept, fail;
        const transport = new Promise((resolve, reject) => { accept = resolve; fail = reject; });
        entry.promise = Promise.race([transport, cancellation]);
        try { accept(apiFetch(path, { ...options, signal: controller.signal })); } catch (error) { fail(error); }
      }
      const current = entry;
      // Retain each result until its entire load finishes, including progress.
      // A status-first callback may reenter while the timeline is still pending.
      if (!leases.has(current)) { current.users++; leases.add(current); }
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (done, value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', abort);
          done(value);
        };
        const abort = () => finish(reject, aborted());
        signal.addEventListener('abort', abort, { once: true });
        current.promise.then(value => owner === getOwner() ? finish(resolve, value) : abort(), error => finish(reject, error));
      });
    }
    async function loadSessionOpenData(sessionSummary, { signal = null, onProgress = null, anchors = [], latest = false } = {}) {
      const sessionId = String(sessionSummary?.id || '').trim();
      if (!sessionId) throw new Error('Session id is required.');
      const owner = getOwner();
      const leases = new Set();
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      if (signal?.aborted) abort(); else signal?.addEventListener?.('abort', abort, { once: true });
      let statusResult = null;
      let timelineResult = null;
      let progress = Promise.resolve();
      const unsupported = (result) => result && !result.ok && [404, 405, 501].includes(result.error?.status);
      const request = async (path, options) => {
        try { return { ok: true, payload: await sharedRequest(path, options, controller.signal, owner, leases, path.includes('/timeline?') ? String(latest) : '') }; }
        catch (error) {
          if (controller.signal.aborted || error?.name === 'AbortError' || isFatalSessionOpenError(error)) { controller.abort(); throw error; }
          return { ok: false, error };
        }
      };
      function build() {
        const statusPayload = statusResult?.ok ? statusResult.payload : null;
        const timelinePayload = timelineResult?.ok ? timelineResult.payload : null;
        const statusSession = statusPayload?.session;
        const timelineSession = timelinePayload?.session;
        const freshness = (session) => Math.max(0, ...['updatedAt', 'lastInputAt', 'lastBusinessActivityAt'].map((key) => Number(session?.[key]) || 0));
        const statusAt = freshness(statusSession); const timelineAt = freshness(timelineSession);
        const active = (session) => typeof session?.activeTurnId === 'string' && session.activeTurnId.trim();
        const execution = statusSession && timelineSession
          ? statusAt && timelineAt && statusAt !== timelineAt
            ? statusAt > timelineAt ? statusSession : timelineSession
            : active(statusSession) ? statusSession : active(timelineSession) ? timelineSession : statusSession
          : statusSession || timelineSession;
        const executionFields = Object.fromEntries(['activeTurnId', 'activityState', 'turnStartedAt', 'lastBusinessActivityAt'].filter((key) => execution && Object.hasOwn(execution, key)).map((key) => [key, execution[key]]));
        const turnSnapshot = [statusPayload?.turnSnapshot, timelinePayload?.turnSnapshot].find((snapshot) => snapshot?.turnId === active(execution)) || null;
        const hasRemoteTimeline = Array.isArray(timelinePayload?.items);
        const cached = state.timelineCache.get(sessionId);
        const cachedTimeline = cached?.history?.length ? cached.history : cached?.timeline?.length ? cached.timeline : null;
        const joined = hasRemoteTimeline && !latest && cached?.hasNewer !== true && timelinePayload.hasNewer !== true && timelinePayload.hasMore === true && cachedTimeline && timelinesHaveStableOverlap(cachedTimeline, timelinePayload.items);
        const timeline = hasRemoteTimeline ? joined ? mergeLatestTimelineHistory(cachedTimeline, timelinePayload.items) : timelinePayload.items : cachedTimeline;
        return {
          session: {
            ...sessionSummary, ...(timelineSession || {}), ...(statusSession || {}), ...executionFields,
            // Turn-free status snapshots mean unknown, not that the history's
            // completed result disappeared. Keep its identity for read markers.
            latestTurn: execution?.latestTurn ?? timelineSession?.latestTurn ?? statusSession?.latestTurn ?? sessionSummary.latestTurn ?? null,
            ...(timelinePayload?.timelineCheckpoint ? { timelineCheckpoint: timelinePayload.timelineCheckpoint } : {}),
            ...(timeline ? {
              timeline: timeline.map((item) => ({ ...item })),
              timelineComplete: hasRemoteTimeline ? timelinePayload.hasMore !== true : cached?.historyComplete === true,
              timelineNextBefore: hasRemoteTimeline ? timelinePayload.nextBefore ?? null : cached?.nextBefore ?? null,
              timelineNextAfter: hasRemoteTimeline ? timelinePayload.nextAfter ?? null : cached?.nextAfter ?? null,
              timelineHasNewer: hasRemoteTimeline ? timelinePayload.hasNewer === true : cached?.hasNewer === true,
            } : {}),
          },
          turnSnapshot: turnSnapshot ? { ...turnSnapshot, events: turnSnapshot.events?.map(event => ({ ...event })) } : null,
          compact: true, hasStatusData: Boolean(statusSession), hasTimelineData: hasRemoteTimeline,
          statusPending: !statusResult, historyPending: !timelineResult,
          timelineSource: hasRemoteTimeline ? 'network' : cachedTimeline ? 'cache' : 'none',
          statusError: !statusResult || statusSession ? '' : 'Execution status could not be refreshed.',
          historyError: !timelineResult || hasRemoteTimeline ? '' : cachedTimeline ? 'History could not be synchronized. Cached messages are shown.' : 'History could not be loaded. Retry to recover your messages.',
        };
      }
      function notify() {
        if (!onProgress || controller.signal.aborted || owner !== getOwner()) return;
        if ((!statusResult || unsupported(statusResult)) && (!timelineResult || unsupported(timelineResult))) return;
        const payload = build();
        progress = progress.then(() => { if (!controller.signal.aborted && owner === getOwner()) return onProgress(payload); });
        return progress;
      }
      try {
        await Promise.all([
          request(`/api/sessions/${encodeURIComponent(sessionId)}/status`).then((result) => { statusResult = result; return notify(); }),
          request(`/api/sessions/${encodeURIComponent(sessionId)}/timeline?limit=50${anchors.slice(0, 3).map(anchor => `&anchor=${encodeURIComponent(anchor.id)}`).join('')}`, { headers: { 'X-Codex-Include-Turn-Snapshot': 'false' } }).then((result) => { timelineResult = result; return notify(); }),
        ]);
        const payload = build();
        if (payload.hasStatusData || payload.hasTimelineData || timelineResult?.payload?.session) return payload;
        if (!unsupported(statusResult) || !unsupported(timelineResult)) throw timelineResult?.error || statusResult?.error || new Error('Session data unavailable');
        const fallback = structuredClone(await sharedRequest(`/api/sessions/${encodeURIComponent(sessionId)}`, {}, controller.signal, owner, leases));
        if (onProgress) await onProgress(fallback);
        return fallback;
      } finally {
        signal?.removeEventListener?.('abort', abort);
        controller.abort();
        for (const entry of leases) {
          if (--entry.users === 0) {
            if (pending.get(entry.key) === entry) pending.delete(entry.key);
            entry.controller.abort();
          }
        }
      }
    }
    loadSessionOpenData.cancel = cancel;
    return loadSessionOpenData;
  }
  globalScope.CodexWebSessionLoader = { createLoader };
})(globalThis);
