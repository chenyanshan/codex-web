// Pure timeline representation and bounded cache serialization.
(function installTimelineModel() {
  function createModel(context) {
    const { MAX_TIMELINE_CACHE_ITEMS, MAX_TIMELINE_CACHE_MAP_ITEMS, MAX_TIMELINE_ITEM_TEXT, MAX_TIMELINE_SUMMARY_TEXT, MAX_TIMELINE_SUMMARY_ARRAY_ITEMS, MAX_TIMELINE_SUMMARY_OBJECT_KEYS, MAX_TIMELINE_SUMMARY_DEPTH, normalizeStreamCursor, restrictedFinalAssistantItemsForTurn, timelineRoleForThreadItem, isFailureTurnStatus, runtimeTurnErrorMessage, firstInputForSession, restrictedFinalAssistantTimelineIndexes, sessionTurns, assistantTimelineEntryId, assistantProjectionMeta, normalizeAssistantProjectionPhase, isTurnInterruptTimeoutMessage, timelineMessageIdentity, normalizeTimelineMessageDisplay, isBackgroundMcpTransportFailure, isRecoverableToolRouterFailure, publicRuntimeTurnFailureMessage } = context;
function serializeTimelineCacheEntry(sessionId, value) {
  if (!sessionId || !value) {
    return null;
  }
  return {
    sessionId,
    savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0,
    validatedAt: typeof value.validatedAt === 'number' ? value.validatedAt : 0,
    sessionUpdatedAt: typeof value.sessionUpdatedAt === 'number' ? value.sessionUpdatedAt : 0,
    timeline: cloneTimelineEntries(value.timeline || []),
    history: cloneTimelineEntries(value.history || []),
    historyComplete: value.historyComplete === true,
    checkpointComplete: value.checkpointComplete === true,
    timelineCheckpoint: value.timelineCheckpoint || null,
    hasNewer: value.hasNewer === true, nextBefore: value.nextBefore ?? null, nextAfter: value.nextAfter ?? null,
    batches: [...cloneCacheMap(value.batches).entries()],
    approvals: [...cloneCacheMap(value.approvals).entries()],
    ...(value.checkpointComplete === true && normalizeStreamCursor(value.streamCursor) ? { streamCursor: normalizeStreamCursor(value.streamCursor) } : {}),
  };
}

function deserializeTimelineCacheEntry(entry) {
  if (!entry || typeof entry.sessionId !== 'string' || !entry.sessionId) {
    return null;
  }
  const checkpointComplete = entry.checkpointComplete === true || entry.checkpointComplete == null
    && Array.isArray(entry.timeline) && entry.timeline.length < MAX_TIMELINE_CACHE_ITEMS
    && entry.timeline.every(item => typeof item?.text !== 'string' || item.text.length <= MAX_TIMELINE_ITEM_TEXT);
  const batches = Array.isArray(entry.batches)
    ? entry.batches.filter(isCacheMapPair)
    : [];
  const approvals = Array.isArray(entry.approvals)
    ? entry.approvals.filter(isCacheMapPair)
    : [];
  return {
    sessionId: entry.sessionId,
    value: {
      savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : 0,
      validatedAt: typeof entry.validatedAt === 'number' ? entry.validatedAt : 0,
      sessionUpdatedAt: typeof entry.sessionUpdatedAt === 'number' ? entry.sessionUpdatedAt : 0,
      timeline: cloneTimelineEntries(Array.isArray(entry.timeline) ? entry.timeline : []),
      history: cloneTimelineEntries(Array.isArray(entry.history) ? entry.history : []),
      historyComplete: entry.historyComplete === true,
      checkpointComplete,
      timelineCheckpoint: entry.timelineCheckpoint || null,
      hasNewer: entry.hasNewer === true, nextBefore: entry.nextBefore ?? null, nextAfter: entry.nextAfter ?? null,
      batches: new Map(batches),
      approvals: new Map(approvals),
      ...(checkpointComplete && normalizeStreamCursor(entry.streamCursor) ? { streamCursor: normalizeStreamCursor(entry.streamCursor) } : {}),
    },
  };
}

function isCacheMapPair(pair) {
  return Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string';
}

function cloneCacheMap(map) {
  const entries = map instanceof Map
    ? [...map.entries()]
    : Array.isArray(map)
      ? map.filter(isCacheMapPair)
      : [];
  return new Map(entries.slice(-MAX_TIMELINE_CACHE_MAP_ITEMS).map(([key, value]) => [
    key,
    sanitizeCacheValue(value),
  ]));
}

function sanitizeCacheValue(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_TIMELINE_SUMMARY_TEXT
      ? value.slice(0, MAX_TIMELINE_SUMMARY_TEXT)
      : value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_TIMELINE_SUMMARY_DEPTH) {
      return [];
    }
    return value.slice(0, MAX_TIMELINE_SUMMARY_ARRAY_ITEMS)
      .map((item) => sanitizeCacheValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= MAX_TIMELINE_SUMMARY_DEPTH) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_TIMELINE_SUMMARY_OBJECT_KEYS)
        .map(([key, item]) => [key, sanitizeCacheValue(item, depth + 1)]),
    );
  }
  return String(value);
}

function cloneTimelineEntries(entries) {
  return dedupeTimelineProjectionEntries(Array.isArray(entries) ? entries : [])
    .filter((item) => item?.kind !== 'work')
    .slice(-MAX_TIMELINE_CACHE_ITEMS)
    .map(cloneTimelineItem)
    .filter(Boolean);
}

function cloneTimelineItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const clone = { ...item };
  if (clone.submissionId && !clone.clientMessageId && globalThis.CodexWebSubmissionIdentity) clone.clientMessageId = globalThis.CodexWebSubmissionIdentity.clientMessageId(clone.submissionId);
  if (typeof clone.text === 'string' && clone.text.length > MAX_TIMELINE_ITEM_TEXT) {
    clone.text = `${clone.text.slice(0, MAX_TIMELINE_ITEM_TEXT)}...`;
  }
  return clone;
}

function fullHydratedTimelineFromSession(session) {
  const storedTimeline = normalizeSessionTimeline(session?.timeline);
  if (!storedTimeline.length && session?.timelineCheckpoint && Array.isArray(session.timeline) && session.timelineComplete !== false) return [];
  if (storedTimeline.length) {
    return dedupeTimelineProjectionEntries(canonicalizeStoredTimelineEntries(
      markKnownFinalTimelineEntries(storedTimeline, session),
      session,
    ));
  }
  const items = [];
  const turns = Array.isArray(session.thread?.turns) ? session.thread.turns : [];
  for (const turn of turns) {
    const finalAssistantItems = new Set(restrictedFinalAssistantItemsForTurn(turn));
    for (const [itemIndex, item] of (turn.items || []).entries()) {
      const role = timelineRoleForThreadItem(item);
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!role || !text) {
        continue;
      }
      const itemId = threadTimelineItemId(item);
      const clientMessageId = typeof item?.clientMessageId === 'string' ? item.clientMessageId.trim() : '';
      const isFinal = role === 'assistant' && finalAssistantItems.has(item);
      const phase = historicalAssistantProjectionPhase(item, isFinal);
      const normalized = normalizeSessionTimelineItem({
        id: role === 'assistant' && (itemId || isFinal)
          ? assistantTimelineEntryId(turn.id, itemId, phase, isFinal)
          : `history_${turn.id}_${itemIndex}`,
        kind: 'message',
        role,
        label: role === 'user' ? 'You' : 'Assistant',
        meta: role === 'assistant' ? assistantProjectionMeta(phase, isFinal) : 'history',
        text,
        turnId: turn.id,
        ...(itemId ? { itemId, projectionKey: `${turn.id}\u0000${itemId}` } : {}),
        ...(clientMessageId ? { clientMessageId } : {}),
        lifecycle: 'completed',
      });
      if (normalized) {
        items.push(normalized);
      }
    }
    if (isFailureTurnStatus(turn?.status)) {
      const text = runtimeTurnErrorMessage(turn);
      items.push({
        id: `error_${turn?.id || `history_failed_${items.length}`}`,
        kind: 'message',
        role: 'system',
        severity: 'error',
        label: 'Error',
        meta: 'failed',
        text,
      });
    }
  }
  if (!items.length) {
    const preview = firstInputForSession(session);
    return preview ? [{
      id: `history_preview_${session.id}`,
      kind: 'message',
      role: 'user',
      label: 'You',
      meta: 'preview',
      text: preview,
    }] : [];
  }
  return dedupeTimelineProjectionEntries(items, { legacyProviderIds: true });
}

function markKnownFinalTimelineEntries(entries, session) {
  const finalIndexes = restrictedFinalAssistantTimelineIndexes(entries, session);
  return entries.map((item, index) => (
    finalIndexes.has(index) && item?.meta !== 'final' && item?.meta !== 'final_answer'
      ? { ...item, meta: 'final' }
      : item
  ));
}

function canonicalizeStoredTimelineEntries(entries, session) {
  const candidates = [];
  for (const turn of sessionTurns(session)) {
    const finalItems = new Set(restrictedFinalAssistantItemsForTurn(turn));
    for (const [itemIndex, item] of (turn.items || []).entries()) {
      const role = timelineRoleForThreadItem(item);
      const text = typeof item?.text === 'string' ? item.text.trim() : '';
      if (!role || !text) {
        continue;
      }
      const itemId = threadTimelineItemId(item);
      const isFinal = role === 'assistant' && finalItems.has(item);
      const phase = historicalAssistantProjectionPhase(item, isFinal);
      candidates.push({
        turnId: turn.id,
        itemIndex,
        itemId,
        role,
        text,
        isFinal,
        phase,
      });
    }
  }
  const used = new Set();
  let cursor = 0;
  return entries.map((entry) => {
    if (entry?.timeline?.id || entry?.kind !== 'message' || (entry.role !== 'user' && entry.role !== 'assistant')) {
      return entry;
    }
    let candidateIndex = candidates.findIndex((candidate, index) => (
      index >= cursor
      && !used.has(index)
      && candidate.role === entry.role
      && candidate.text === entry.text
    ));
    if (candidateIndex < 0) {
      candidateIndex = candidates.findIndex((candidate, index) => (
        !used.has(index)
        && candidate.role === entry.role
        && candidate.text === entry.text
      ));
    }
    if (candidateIndex < 0) {
      return entry;
    }
    used.add(candidateIndex);
    cursor = Math.max(cursor, candidateIndex + 1);
    const candidate = candidates[candidateIndex];
    if (entry.role === 'user') {
      return { ...entry, turnId: candidate.turnId };
    }
    const id = candidate.itemId || candidate.isFinal
      ? assistantTimelineEntryId(candidate.turnId, candidate.itemId, candidate.phase, candidate.isFinal)
      : entry.id;
    return {
      ...entry,
      id,
      turnId: candidate.turnId,
      meta: assistantProjectionMeta(candidate.phase, candidate.isFinal),
      lifecycle: 'completed',
      ...(candidate.itemId
        ? {
          itemId: candidate.itemId,
          projectionKey: `${candidate.turnId}\u0000${candidate.itemId}`,
        }
        : {}),
    };
  });
}

function threadTimelineItemId(item) {
  const direct = String(item?.itemId || item?.id || '').trim();
  if (direct) {
    return direct;
  }
  return String(item?.raw?.itemId || item?.raw?.id || '').trim();
}

function historicalAssistantProjectionPhase(item, isFinal = false) {
  const type = String(item?.type || '').replace(/[^a-z]/giu, '').toLowerCase();
  if (type.includes('reasoning')) {
    return 'reasoning_summary';
  }
  return normalizeAssistantProjectionPhase(item?.phase, isFinal);
}

function timelineTurnId(item) {
  const direct = String(item?.turnId || '').trim();
  if (direct) {
    return direct;
  }
  const id = String(item?.id || '');
  const historyMatch = id.match(/^history_(.+)_\d+$/u);
  if (historyMatch?.[1]) {
    return historyMatch[1];
  }
  const finalMatch = id.match(/^assistant_(.+)_final$/u);
  if (finalMatch?.[1]) {
    return finalMatch[1];
  }
  if (id.startsWith('assistant_')) {
    return id.slice('assistant_'.length);
  }
  return '';
}

function timelineProjectionIdentity(item) {
  if (item?.timeline?.id) return `canonical:${item.timeline.id}`;
  if (typeof item?.projectionKey === 'string' && item.projectionKey) {
    return `projection:${item.projectionKey}`;
  }
  const turnId = timelineTurnId(item);
  if (turnId && item?.itemId) {
    return `projection:${turnId}\u0000${item.itemId}`;
  }
  return [
    'message',
    turnId,
    item?.role || '',
    item?.text || '',
  ].join('\u0000');
}

function dedupeTimelineProjectionEntries(entries, { legacyProviderIds = false } = {}) {
  const source = (Array.isArray(entries) ? entries : []).filter((item) => (
    Boolean(item)
    && !(item?.kind === 'message' && item.role === 'system' && isTurnInterruptTimeoutMessage(item.text))
  ));
  const actualFinalKeys = new Set(source.flatMap((item) => {
    const turnId = timelineTurnId(item);
    const meta = String(item?.meta || '').trim().toLowerCase();
    const final = item?.kind === 'message'
      && item.role === 'assistant'
      && (meta === 'final' || meta === 'final_answer' || String(item.id || '').endsWith('_final'));
    return final && turnId && item.text ? [`${turnId}\u0000${item.text}`] : [];
  }));
  const result = [];
  const indexes = new Map();
  for (const original of source) {
    let item = { ...original };
    const turnId = timelineTurnId(item);
    const finalKey = item?.kind === 'message' && item.role === 'assistant' && turnId && item.text
      ? `${turnId}\u0000${item.text}`
      : '';
    const semanticKey = timelineSemanticProjectionKey(item, turnId);
    const key = item.timeline?.id ? `canonical:${item.timeline.id}`
      : !legacyProviderIds && item.itemId && turnId ? `item:${turnId}\u0000${item.itemId}`
      : finalKey && actualFinalKeys.has(finalKey)
      ? `final:${finalKey}`
      : semanticKey
        ? semanticKey
      : item.projectionKey
        ? `projection:${item.projectionKey}`
        : item.id
          ? `id:${item.id}`
          : '';
    if (finalKey && actualFinalKeys.has(finalKey) && !item.itemId && !item.timeline?.id) {
      item = {
        ...item,
        id: assistantTimelineEntryId(turnId, '', 'final_answer', true),
        turnId,
        meta: 'final',
        lifecycle: 'completed',
        streaming: false,
      };
    }
    if (key && indexes.has(key)) {
      result[indexes.get(key)] = globalThis.CodexWebTimelineReconciliation.preferVersion(result[indexes.get(key)], item);
    } else if (timelineEntriesAreTransientDuplicates(result.at(-1), item)) {
      const index = result.length - 1;
      result[index] = preferredTimelineDuplicate(result.at(-1), item);
      if (key) {
        indexes.set(key, index);
      }
    } else {
      if (key) {
        indexes.set(key, result.length);
      }
      result.push(item);
    }
  }
  return result;
}

function timelineSemanticProjectionKey(item, turnId = timelineTurnId(item)) {
  if (item?.kind !== 'message' || !turnId || !item.text || !['user', 'assistant'].includes(item.role)) {
    return '';
  }
  if (item.role === 'user') {
    const clientMessageId = String(item.clientMessageId || '').trim();
    if (clientMessageId) {
      return `semantic:${turnId}\u0000user-client\u0000${clientMessageId}`;
    }
    return `semantic:${turnId}\u0000user\u0000${timelineMessageIdentity(item)}`;
  }
  const meta = String(item.meta || '').trim().toLowerCase();
  const phase = meta === 'history' ? '' : meta === 'final_answer' ? 'final' : meta;
  return `semantic:${turnId}\u0000assistant\u0000${phase}\u0000${item.text}`;
}

function timelineEntriesAreTransientDuplicates(previous, next) {
  return globalThis.CodexWebTimelineReconciliation.transientDuplicate(previous, next, {
    identity: timelineMessageIdentity, turnId: timelineTurnId,
  });
}

function preferredTimelineDuplicate(previous, next) {
  const previousPending = previous?.meta === 'pending' || Boolean(previous?.submissionId);
  const nextPending = next?.meta === 'pending' || Boolean(next?.submissionId);
  if (previousPending !== nextPending) {
    return previousPending ? next : previous;
  }
  return next;
}

function normalizeSessionTimeline(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeSessionTimelineItem(item))
    .filter(Boolean);
}

function normalizeSessionTimelineItem(item) {
  if (!item || item.kind !== 'message') {
    return null;
  }
  const role = item.role === 'user' || item.role === 'assistant' || item.role === 'system'
    ? item.role
    : null;
  const display = normalizeTimelineMessageDisplay(role, item.text, item.attachments);
  if (role === 'system' && isTurnInterruptTimeoutMessage(display.text)) {
    return null;
  }
  if (role === 'system' && (
    isBackgroundMcpTransportFailure(display.text)
    || isRecoverableToolRouterFailure(display.text)
  )) {
    return null;
  }
  if (!role || (!display.text && !display.attachments.length)) {
    return null;
  }
  const isFailure = role === 'system' && item.severity === 'error' && item.meta === 'failed';
  const text = isFailure ? publicRuntimeTurnFailureMessage(display.text) : display.text;
  return {
    id: typeof item.id === 'string' && item.id ? item.id : `timeline_${role}_${text.slice(0, 24)}`,
    kind: 'message',
    role,
    label: typeof item.label === 'string' && item.label ? item.label : role === 'user' ? 'You' : role === 'assistant' ? 'Assistant' : 'System',
    meta: typeof item.meta === 'string' ? item.meta : '',
    text,
    ...(item.timeline?.id ? { timeline: { ...item.timeline, aliases: [...(item.timeline.aliases || [])] } } : {}),
    ...(typeof item.turnId === 'string' && item.turnId ? { turnId: item.turnId } : {}),
    ...(typeof item.itemId === 'string' && item.itemId ? { itemId: item.itemId } : {}),
    ...(typeof item.projectionKey === 'string' && item.projectionKey ? { projectionKey: item.projectionKey } : {}),
    ...(typeof item.clientMessageId === 'string' && item.clientMessageId
      ? { clientMessageId: item.clientMessageId }
      : {}),
    ...Object.fromEntries(['submissionId', 'deliveryLabel', 'historyAnchorId'].filter(key => typeof item[key] === 'string' && item[key]).map(key => [key, item[key]])),
    ...(typeof item.phase === 'string' && item.phase ? { phase: item.phase } : {}),
    ...(typeof item.lifecycle === 'string' && item.lifecycle ? { lifecycle: item.lifecycle } : {}),
    ...(item.streaming === true ? { streaming: true } : {}),
    ...(typeof item.source === 'string' && item.source ? { source: item.source } : {}),
    ...(display.attachments.length ? { attachments: display.attachments } : {}),
    severity: item.severity === 'error' ? 'error' : undefined,
  };
}

    return { serializeTimelineCacheEntry, deserializeTimelineCacheEntry, isCacheMapPair, cloneCacheMap, sanitizeCacheValue, cloneTimelineEntries, cloneTimelineItem, fullHydratedTimelineFromSession, markKnownFinalTimelineEntries, canonicalizeStoredTimelineEntries, threadTimelineItemId, historicalAssistantProjectionPhase, timelineTurnId, timelineProjectionIdentity, dedupeTimelineProjectionEntries, timelineSemanticProjectionKey, timelineEntriesAreTransientDuplicates, preferredTimelineDuplicate, normalizeSessionTimeline, normalizeSessionTimelineItem };
  }
function workDetailsForItem(item, { classifyWorkBatch, workFileChanges, workTimelineEntryOrder, inlineWorkTimelineId, primitiveWorkText }) {
function workDetailTitle(batch, kind, fileChanges) {
  const summary = batch?.summary || {};
  if (kind === 'command' || kind === 'read') {
    return primitiveWorkText(summary.command) || primitiveWorkText(batch?.title) || 'Command';
  }
  if (kind === 'edit' && fileChanges.length) {
    const firstPath = primitiveWorkText(fileChanges[0]?.path);
    if (firstPath) {
      return fileChanges.length === 1
        ? firstPath
        : `${firstPath} +${fileChanges.length - 1}`;
    }
  }
  return primitiveWorkText(batch?.title)
    || primitiveWorkText(summary?.command || summary?.reason)
    || 'Tool activity';
}



  const orderedDetails = [];
  for (const [index, batch] of (item.batches || []).entries()) {
    const kind = classifyWorkBatch(batch);
    const fileChanges = workFileChanges(batch);
    orderedDetails.push({
      order: workTimelineEntryOrder(inlineWorkTimelineId(item.turnId, batch.batchId), index),
      fallbackOrder: index,
      detail: {
        id: batch.batchId || batch.id || `${item.turnId || 'turn'}-batch-${index}`,
        kind,
        title: workDetailTitle(batch, kind, fileChanges),
        status: batch.status || '',
        summary: batch.summary || {},
        fileChanges,
      },
    });
  }
  const batchCount = orderedDetails.length;
  for (const [index, approval] of (item.approvals || []).entries()) {
    const fallbackOrder = batchCount + index;
    orderedDetails.push({
      order: workTimelineEntryOrder(`approval_${approval.approvalId || ''}`, fallbackOrder),
      fallbackOrder,
      detail: {
        id: approval.approvalId || approval.id || `${item.turnId || 'turn'}-approval-${index}`,
        kind: 'approval',
        title: approval.summary?.command || approval.summary?.reason || approval.approvalKind || 'Approval requested',
        status: approval.resolved ? approval.summary?.decision || 'resolved' : 'requested',
        summary: approval.summary || {},
        fileChanges: [],
      },
    });
  }
  return orderedDetails
    .sort((left, right) => left.order - right.order || left.fallbackOrder - right.fallbackOrder)
    .map((entry) => entry.detail);
}

  globalThis.CodexWebTimelineModel = { createModel, workDetailsForItem };
}());
