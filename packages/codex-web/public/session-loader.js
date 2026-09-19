(function initializeSessionLoader(globalScope) {
  function createLoader({ state, apiFetch, isFatalSessionOpenError, timelinesHaveStableOverlap, dedupeTimelineProjectionEntries }) {
    return async function loadSessionOpenData(sessionSummary, { signal = null, onProgress = null, anchors = [], latest = false } = {}) {
      const sessionId = String(sessionSummary?.id || '').trim();
      if (!sessionId) throw new Error('Session id is required.');
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      if (signal?.aborted) abort(); else signal?.addEventListener?.('abort', abort, { once: true });
      let statusResult = null;
      let timelineResult = null;
      let progress = Promise.resolve();
      const unsupported = (result) => result && !result.ok && [404, 405, 501].includes(result.error?.status);
      const request = async (path, options) => {
        try { return { ok: true, payload: await apiFetch(path, { ...options, signal: controller.signal }) }; }
        catch (error) {
          if (controller.signal.aborted || isFatalSessionOpenError(error)) { controller.abort(); throw error; }
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
        const timeline = hasRemoteTimeline ? joined ? dedupeTimelineProjectionEntries([...cachedTimeline.filter(item => item.meta !== 'pending'), ...timelinePayload.items]) : timelinePayload.items : cachedTimeline;
        return {
          session: {
            ...sessionSummary, ...(timelineSession || {}), ...(statusSession || {}), ...executionFields,
            ...(timeline ? {
              timeline: timeline.map((item) => ({ ...item })),
              timelineComplete: hasRemoteTimeline ? timelinePayload.hasMore !== true : cached?.historyComplete === true,
              timelineNextBefore: hasRemoteTimeline ? timelinePayload.nextBefore ?? null : cached?.nextBefore ?? null,
              timelineNextAfter: hasRemoteTimeline ? timelinePayload.nextAfter ?? null : cached?.nextAfter ?? null,
              timelineHasNewer: hasRemoteTimeline ? timelinePayload.hasNewer === true : cached?.hasNewer === true,
            } : {}),
          },
          turnSnapshot,
          compact: true, hasStatusData: Boolean(statusSession), hasTimelineData: hasRemoteTimeline,
          statusPending: !statusResult, historyPending: !timelineResult,
          timelineSource: hasRemoteTimeline ? 'network' : cachedTimeline ? 'cache' : 'none',
          statusError: !statusResult || statusSession ? '' : 'Execution status could not be refreshed.',
          historyError: !timelineResult || hasRemoteTimeline ? '' : cachedTimeline ? 'History could not be synchronized. Cached messages are shown.' : 'History could not be loaded. Retry to recover your messages.',
        };
      }
      function notify() {
        if (!onProgress || controller.signal.aborted) return;
        if ((!statusResult || unsupported(statusResult)) && (!timelineResult || unsupported(timelineResult))) return;
        const payload = build();
        progress = progress.then(() => onProgress(payload));
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
        const fallback = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { signal: controller.signal });
        if (onProgress) await onProgress(fallback);
        return fallback;
      } finally { signal?.removeEventListener?.('abort', abort); }
    };
  }
  globalScope.CodexWebSessionLoader = { createLoader };
})(globalThis);
