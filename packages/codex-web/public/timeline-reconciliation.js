// @ts-check
/** @typedef {{id?: string, kind?: string, role?: string, meta?: string, text?: string, turnId?: string, clientMessageId?: string, submissionId?: string, deliveryLabel?: string, historyAnchorId?: string, source?: string, attachments?: unknown[], timeline?: {id: string, generation: string, revision?: number, position: number, version: number, aliases?: string[]}}} TimelineMessage */
(function installTimelineReconciliation() {
  /** @param {TimelineMessage} item */
  function stableIds(item) {
    return [...new Set([item.timeline?.id, item.id, item.clientMessageId, ...(item.timeline?.aliases || [])].filter(Boolean))];
  }
  /** @param {TimelineMessage} before @param {TimelineMessage} after */
  function preferVersion(before, after) {
    if (before.timeline?.id && before.timeline.id === after.timeline?.id
      && before.timeline.generation === after.timeline.generation
      && before.timeline.version > after.timeline.version) return before;
    if (!after.timeline && before.source === 'stream' && (before.text || '').startsWith(after.text || '')
      && (before.text || '').length > (after.text || '').length) return before;
    return after;
  }
  /** Reconcile all copies of one user message at its confirmed history slot.
   * @param {TimelineMessage[]} current @param {TimelineMessage} incoming
   * @param {(...groups: (unknown[] | undefined)[]) => unknown[]} mergeAttachments */
  function upsertUserMessage(current, incoming, mergeAttachments) {
    const ids = new Set(stableIds(incoming));
    const matches = current.filter(item => item.role === 'user' && stableIds(item).some(id => ids.has(id)));
    if (!matches.length) return [...current, incoming];
    let merged = matches.reduce((latest, item) => preferVersion(item, latest), incoming);
    const attachments = mergeAttachments(merged.attachments, ...matches.map(item => item.attachments));
    if (attachments.length) merged = { ...merged, attachments };
    const anchor = matches.find(item => item.timeline?.id && item.timeline.id === incoming.timeline?.id) || matches[0];
    const duplicates = new Set(matches);
    return current.flatMap(item => item === anchor ? [merged] : duplicates.has(item) ? [] : [item]);
  }
  /** Merge canonical records by identity, never text. Incoming owns the range;
   * newer live records outside that snapshot survive until confirmed.
   * @param {TimelineMessage[]} current @param {TimelineMessage[]} incoming
   * @param {{generation?: string, revision?: number} | null} checkpoint */
  function reconcileMessages(current, incoming, checkpoint = null) {
    const byId = new Map();
    for (const item of current) for (const id of stableIds(item)) byId.set(id, item);
    const seen = new Set();
    const merged = incoming.map(item => {
      const previous = stableIds(item).map(id => byId.get(id)).find(Boolean);
      if (previous) seen.add(previous);
      return previous ? preferVersion(previous, item) : item;
    });
    for (const item of current) {
      if (seen.has(item)) continue;
      if (item.timeline && checkpoint?.generation === item.timeline.generation
        && Number(item.timeline.revision) > Number(checkpoint.revision)) merged.push(item);
      else if (!checkpoint && item.source === 'stream' && item.role === 'assistant' && ['final', 'final_answer'].includes(item.meta || '')
        && !incoming.some(next => next.role === item.role && next.turnId === item.turnId && (next.text === item.text || ['final', 'final_answer'].includes(next.meta || '')))) merged.push(item);
    }
    // Sort only canonical slots; auxiliary entries retain their existing anchors.
    const canonical = merged.filter(item => item.timeline?.generation === checkpoint?.generation && item.timeline)
      .sort((a, b) => Number(a.timeline?.position) - Number(b.timeline?.position));
    let index = 0;
    return merged.map(item => item.timeline?.generation === checkpoint?.generation && item.timeline ? canonical[index++] : item);
  }
  /**
   * A latest history page owns the order of its overlap with cached history.
   * Concatenating and deduplicating would keep cached replies before newly
   * confirmed prompts whose optimistic copies were removed.
   * @template {TimelineMessage} T
   * @param {T[]} cached
   * @param {T[]} incoming
   * @param {(item: T) => string[]} identities
   * @returns {T[]}
   */
  function mergeLatestHistory(cached, incoming, identities) {
    const freshIds = new Set(incoming.flatMap(identities));
    const overlap = cached.findIndex(item => identities(item).some(id => freshIds.has(id)));
    return [
      ...(overlap < 0 ? [] : cached.slice(0, overlap).filter(item => item.meta !== 'pending')),
      ...incoming,
    ];
  }
  /**
   * Authoritative pages describe their own order. A cached "pending" display
   * flag is not a delivery receipt, especially when an older turn left the page.
   * @param {TimelineMessage[]} historyItems
   * @param {TimelineMessage[]} timelineItems
   * @param {{identity: (item: TimelineMessage) => string, turnId: (item: TimelineMessage) => string,
   * pendingSubmissionIds: Set<string>,
   * authoritative?: boolean, latestWindow?: boolean, completeHistory?: boolean}} options
   */
  function pendingMessages(historyItems, timelineItems, options) {
    const history = historyItems.filter(item => item?.kind === 'message');
    const local = timelineItems.filter(item => item?.kind === 'message');
    const identities = new Set(history.flatMap(stableIds));
    /** @type {Map<string, number>} */
    const historyCounts = new Map(), localCounts = new Map();
    /** @param {TimelineMessage} item */
    const keys = item => {
      const identity = options.identity(item), turnId = options.turnId(item);
      return [`all:${identity}`, ...(turnId ? [`turn:${turnId}\u0000${identity}`] : [])];
    };
    for (const item of history) for (const key of keys(item)) historyCounts.set(key, (historyCounts.get(key) || 0) + 1);
    return local.filter(item => {
      const itemKeys = keys(item), key = itemKeys.at(-1) || '';
      const previous = localCounts.get(key) || 0;
      for (const localKey of itemKeys) localCounts.set(localKey, (localCounts.get(localKey) || 0) + 1);
      if (item.meta !== 'pending') return false;
      if (stableIds(item).some(id => identities.has(id))) return false;
      const inOutbox = Boolean(item.submissionId && options.pendingSubmissionIds.has(item.submissionId));
      const anchoredReceipt = Boolean(item.historyAnchorId && (identities.has(item.historyAnchorId)
        || item.historyAnchorId === '@start' && options.completeHistory === true));
      if (options.authoritative) {
        if (options.latestWindow === false) return false;
        // A turn can span many pages. Neither its activity nor a legacy pending
        // flag proves that a cached message belongs after this page. Only the
        // durable outbox or a submission-time boundary can establish that.
        if (!inOutbox && !anchoredReceipt) return false;
      }
      // A saved submission is distinct even when a prior prompt has identical text.
      if (inOutbox) return true;
      // Distinct client IDs identify repeated prompts independently of content.
      if (item.clientMessageId) return true;
      return (historyCounts.get(key) || 0) <= previous;
    });
  }
  /** @param {TimelineMessage | undefined} previous @param {TimelineMessage | undefined} next
   * @param {{identity: (item: TimelineMessage) => string, turnId: (item: TimelineMessage) => string}} options */
  function transientDuplicate(previous, next, options) {
    if (previous?.timeline?.id && next?.timeline?.id && previous.timeline.id !== next.timeline.id) return false;
    if (previous?.kind !== 'message' || next?.kind !== 'message' || previous.role !== next.role
      || options.identity(previous) !== options.identity(next)) return false;
    if ((previous.clientMessageId || next.clientMessageId) && previous.clientMessageId !== next.clientMessageId) return false;
    if (previous.submissionId && next.submissionId && previous.submissionId !== next.submissionId) return false;
    if (previous.submissionId && previous.deliveryLabel !== 'Server received' || next.submissionId && next.deliveryLabel !== 'Server received') return false;
    if (previous.meta !== 'pending' && !previous.submissionId && next.meta !== 'pending' && !next.submissionId) return false;
    const beforeTurn = options.turnId(previous), afterTurn = options.turnId(next);
    return !beforeTurn || !afterTurn || beforeTurn === afterTurn;
  }
  Object.assign(globalThis, { CodexWebTimelineReconciliation: { pendingMessages, transientDuplicate, mergeLatestHistory, stableIds, preferVersion, reconcileMessages, upsertUserMessage } });
}());
