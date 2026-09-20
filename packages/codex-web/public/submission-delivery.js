(function initializeSubmissionDelivery(globalScope) {
  function unknownOutcome(error) {
    if (typeof error?.payload?.outcomeUnknown === 'boolean') return error.payload.outcomeUnknown;
    return !Number.isFinite(error?.status) || error.status === 408 || error.status >= 500;
  }

  function invalidAcknowledgement(message) {
    return Object.assign(new Error(message), { payload: { error: 'invalid_submission_acknowledgement', message, retryable: true, outcomeUnknown: true } });
  }

  function normalizeResponse(payload, entry) {
    const submission = payload?.submission;
    const result = payload?.result || payload;
    const commandResult = result?.type === 'command' ? result : null;
    const turnId = String(submission?.turnId || payload?.turnId || result?.turnId || '').trim();
    const legacyAccepted = !submission && Boolean(entry.sessionId && (turnId || commandResult));
    if (submission && submission.id !== entry.id) throw invalidAcknowledgement('Server acknowledgement did not match the saved message.');
    if (!submission && !legacyAccepted) throw invalidAcknowledgement('Server response did not acknowledge the saved message.');
    let status = legacyAccepted ? 'submitted' : submission.status;
    if (status === 'failed' && submission.error?.outcomeUnknown === true) status = 'outcome_unknown';
    if (!['queued', 'creating', 'starting', 'outcome_unknown', 'submitted', 'failed'].includes(status)) throw invalidAcknowledgement('Server returned an invalid submission status.');
    const sessionId = String(submission?.sessionId || payload?.session?.id || result?.session?.id || entry.sessionId || '').trim();
    if (status === 'submitted' && !sessionId) throw invalidAcknowledgement('Server acknowledgement did not include a session.');
    return { status, sessionId, turnId, clientMessageId: String(submission?.clientMessageId || ''),
      session: payload?.session || result?.session || null, commandResult,
      error: submission?.error?.message || '', errorCode: submission?.error?.code || '', retryable: submission?.error?.retryable !== false };
  }

  function requestBody(entry) {
    return { submissionId: entry.id, text: entry.text, settings: entry.settings,
      ...(entry.sessionId ? {} : entry.projectId ? { projectId: entry.projectId } : { cwd: entry.cwd || null }),
      ...(entry.attachments.length ? { attachmentIds: entry.attachments.map(item => item.id), attachments: entry.attachments } : {}) };
  }

  function createController({ get, owns, save, request, controllers, generation, timeoutMs, retryDelay, schedule, changed, accepted, failed, reset, defer, authError, storageError }) {
    async function deliver(id, { interactive = false, force = false } = {}) {
      const entry = get(id);
      if (!entry || !owns(entry) || entry.retryable === false || controllers.has(id)) return null;
      if (!force && entry.nextAttemptAt > Date.now()) { schedule(); return null; }
      const checking = entry.status === 'outcome_unknown';
      const owner = generation();
      const controller = new AbortController();
      controllers.set(id, controller);
      let sending = entry;
      try {
        sending = save({ ...entry, status: checking ? 'outcome_unknown' : 'sending', updatedAt: Date.now(),
          attempts: entry.attempts + (checking ? 0 : 1), confirmationAttempts: checking ? (entry.confirmationAttempts || 0) + 1 : 0,
          nextAttemptAt: 0, error: '' });
      } catch (error) {
        controllers.delete(id);
        storageError(error);
        return null;
      }
      try {
        changed(sending, { interactive, checking });
        const payload = await request(checking ? `/api/session-submissions/${encodeURIComponent(id)}`
          : entry.sessionId ? `/api/sessions/${encodeURIComponent(entry.sessionId)}/turns` : '/api/session-submissions',
        { method: checking ? 'GET' : 'POST', ...(checking ? {} : { body: requestBody(sending) }), signal: controller.signal, timeoutMs });
        if (owner !== generation()) { reset(sending); return null; }
        if (!get(id)) return null;
        if (checking && !payload?.submission) throw invalidAcknowledgement('Server response did not acknowledge the saved message.');
        const result = normalizeResponse(payload, sending);
        if (result.status === 'submitted') return accepted(sending, result, payload, { recovered: checking });
        if (result.status === 'failed') {
          const error = { payload: { error: result.errorCode, message: result.error || 'Request failed', retryable: result.retryable, outcomeUnknown: false, manualRetryRequired: checking } };
          if (!checking && defer(sending, error)) return null;
          failed(sending, error);
        } else if (checking && payload.retryAllowed === true) {
          // Only explicit confirmation that execution never started permits POST.
          save({ ...sending, status: 'pending', nextAttemptAt: Date.now() + retryDelay(sending.attempts) });
          changed(get(id), { interactive: false, checking: false });
          schedule();
        } else {
          failed({ ...sending, resolvedSessionId: result.sessionId || sending.resolvedSessionId },
            { payload: { message: result.error, outcomeUnknown: true } });
        }
        return payload;
      } catch (error) {
        if (owner !== generation()) { reset(sending); return null; }
        if (!get(id)) return null;
        if (checking && error?.status === 404 && error?.payload?.error === 'submission_not_found') {
          // Receipts can expire. A missing receipt must not silently replay an
          // old message (including one migrated from a legacy failed outbox).
          failed(sending, { payload: { message: 'No receipt was found. Review the session before retrying.', retryable: true, outcomeUnknown: false, manualRetryRequired: true } });
        } else if (!checking && defer(sending, error)) {
          return null;
        } else {
          const message = error?.name === 'TimeoutError'
            ? 'Server acknowledgement timed out. Checking whether the message was received.'
            : error?.payload?.message || error?.message || 'Request failed';
          failed(sending, { ...error, message, payload: { ...error?.payload, message, outcomeUnknown: checking || unknownOutcome(error) } });
        }
        if (error?.status === 401 || error?.status === 403) authError(error);
        return null;
      } finally {
        if (controllers.get(id) === controller) controllers.delete(id);
        if (owner === generation()) changed(null, { interactive: false });
      }
    }
    return { deliver };
  }
  globalScope.CodexWebSubmissionDelivery = { createController };
})(globalThis);
