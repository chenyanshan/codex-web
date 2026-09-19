// @ts-check
/** @typedef {{id?: string, kind?: string, role?: string, meta?: string, text?: string, turnId?: string, clientMessageId?: string, submissionId?: string, deliveryLabel?: string, historyAnchorId?: string}} TimelineMessage */
(function installTimelineReconciliation() {
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
    const identities = new Set(history.flatMap(item => [
      ...(item.id ? [`id:${item.id}`] : []),
      ...(item.clientMessageId ? [`client:${item.clientMessageId}`] : []),
    ]));
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
      if (item.id && identities.has(`id:${item.id}`) || item.clientMessageId && identities.has(`client:${item.clientMessageId}`)) return false;
      const inOutbox = Boolean(item.submissionId && options.pendingSubmissionIds.has(item.submissionId));
      const anchoredReceipt = Boolean(item.historyAnchorId && (identities.has(`id:${item.historyAnchorId}`)
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
    if (previous?.kind !== 'message' || next?.kind !== 'message' || previous.role !== next.role
      || options.identity(previous) !== options.identity(next)) return false;
    if ((previous.clientMessageId || next.clientMessageId) && previous.clientMessageId !== next.clientMessageId) return false;
    if (previous.submissionId && next.submissionId && previous.submissionId !== next.submissionId) return false;
    if (previous.submissionId && previous.deliveryLabel !== 'Server received' || next.submissionId && next.deliveryLabel !== 'Server received') return false;
    if (previous.meta !== 'pending' && !previous.submissionId && next.meta !== 'pending' && !next.submissionId) return false;
    const beforeTurn = options.turnId(previous), afterTurn = options.turnId(next);
    return !beforeTurn || !afterTurn || beforeTurn === afterTurn;
  }
  Object.assign(globalThis, { CodexWebTimelineReconciliation: { pendingMessages, transientDuplicate } });
}());
