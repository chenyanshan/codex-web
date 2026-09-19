// @ts-check
/** @typedef {{id: string, offset: number}} ReadingAnchor */
/** @typedef {{sessionId: string, owner: string, revision: number, scrollTop: number, bottomOffset: number, shouldFollowLatest: boolean, anchors: ReadingAnchor[], updatedAt: number}} ReadingPosition */
(function installSessionReading() {
  /** @param {{
   * getSessionId: () => string, getOwner: () => string,
   * getTimeline: () => HTMLElement | null,
   * getFollowing: () => boolean, setFollowing: (following: boolean) => void,
   * isLatestWindow: () => boolean,
   * storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
   * frame?: (callback: () => void) => unknown,
   * }} options */
  function createController(options) {
    let scope = '';
    let revision = 0;
    let restoration = 0;
    /** @type {{element: HTMLElement, top: number} | null} */
    let applied = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    /** @type {ReadingPosition | null} */
    let pending = null;
    const frame = options.frame || requestAnimationFrame;
    function currentScope() {
      const next = `${options.getOwner()}\u0000${options.getSessionId()}`;
      if (next !== scope) { scope = next; revision++; restoration++; applied = null; }
      return revision;
    }
    function input() { currentScope(); revision++; applied = null; }
    function scrolled() {
      const timeline = options.getTimeline();
      if (!timeline) return;
      currentScope();
      if (applied?.element === timeline && Math.abs(applied.top - timeline.scrollTop) < 1) return;
      revision++;
      options.setFollowing(options.isLatestWindow() && timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop <= 24);
    }
    /** @returns {ReadingPosition} */
    function capture() {
      currentScope();
      const timeline = options.getTimeline();
      const rect = timeline?.getBoundingClientRect();
      const nodes = Array.from(timeline?.querySelectorAll('[data-timeline-id]') || []);
      const anchors = rect ? nodes.filter(node => {
        const box = node.getBoundingClientRect();
        return box.bottom > rect.top && box.top < rect.bottom;
      }).slice(0, 3).map(node => ({ id: node.getAttribute('data-timeline-id') || '', offset: node.getBoundingClientRect().top - rect.top })) : [];
      const bottomOffset = timeline ? Math.max(0, timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop) : 0;
      return {
        sessionId: options.getSessionId(), owner: options.getOwner(), revision,
        scrollTop: timeline?.scrollTop || 0, bottomOffset,
        shouldFollowLatest: options.getFollowing() && options.isLatestWindow() && (!timeline || bottomOffset <= 24),
        anchors, updatedAt: Date.now(),
      };
    }
    /** @param {ReadingPosition | null | undefined} snapshot */
    function isCurrent(snapshot) {
      currentScope();
      return Boolean(snapshot && snapshot.owner === options.getOwner() && snapshot.sessionId === options.getSessionId() && snapshot.revision === revision);
    }
    /** @param {ReadingPosition} snapshot */
    function restore(snapshot) {
      if (!isCurrent(snapshot)) return false;
      const run = ++restoration;
      const apply = () => {
        if (run !== restoration || !isCurrent(snapshot)) return;
        const timeline = options.getTimeline();
        if (!timeline) return;
        if (snapshot.shouldFollowLatest && options.isLatestWindow()) {
          timeline.scrollTop = timeline.scrollHeight;
        } else {
          const nodes = Array.from(timeline.querySelectorAll('[data-timeline-id]'));
          const anchor = snapshot.anchors.find(item => nodes.some(node => node.getAttribute('data-timeline-id') === item.id));
          const node = anchor && nodes.find(item => item.getAttribute('data-timeline-id') === anchor.id);
          timeline.scrollTop = node && anchor
            ? timeline.scrollTop + node.getBoundingClientRect().top - timeline.getBoundingClientRect().top - anchor.offset
            : Math.max(0, snapshot.scrollTop);
        }
        applied = { element: timeline, top: timeline.scrollTop };
        options.setFollowing(snapshot.shouldFollowLatest && options.isLatestWindow());
        remember();
      };
      apply(); frame(apply);
      return true;
    }
    /** @param {string} owner @returns {Record<string, ReadingPosition>} */
    function read(owner) {
      try {
        const raw = JSON.parse(options.storage.getItem(`codexWebReading:${owner}`) || '{}');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        return Object.fromEntries(Object.entries(raw).filter(([id, value]) => {
          const item = /** @type {ReadingPosition} */ (value);
          return id.length <= 1024 && item?.owner === owner && item.sessionId === id
            && Number.isFinite(item.scrollTop) && item.scrollTop >= 0
            && typeof item.shouldFollowLatest === 'boolean' && Array.isArray(item.anchors) && item.anchors.length <= 3
            && item.anchors.every(anchor => typeof anchor?.id === 'string' && anchor.id.length <= 2048 && Number.isFinite(anchor.offset))
            && Date.now() - item.updatedAt < 7 * 86400000;
        }));
      } catch { return {}; }
    }
    function flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!pending) return;
      const snapshot = pending; pending = null;
      if (!snapshot.owner || !snapshot.sessionId || !snapshot.anchors.length) return;
      const data = read(snapshot.owner);
      data[snapshot.sessionId] = snapshot;
      const entries = [[snapshot.sessionId, snapshot], ...Object.entries(data).filter(([id]) => id !== snapshot.sessionId).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 19)];
      try { options.storage.setItem(`codexWebReading:${snapshot.owner}`, JSON.stringify(Object.fromEntries(entries))); } catch { /* Reading remains usable without local persistence. */ }
    }
    function remember() {
      const snapshot = capture();
      if (!snapshot.anchors.length || !snapshot.owner) return;
      if (pending && pending.owner !== snapshot.owner) flush();
      pending = snapshot;
      if (!timer) timer = setTimeout(flush, 150);
    }
    function saved() {
      currentScope();
      const owner = options.getOwner(), sessionId = options.getSessionId();
      const snapshot = pending?.owner === owner && pending.sessionId === sessionId ? pending : read(owner)[sessionId];
      return snapshot ? { ...snapshot, revision } : null;
    }
    function clear() {
      if (timer) clearTimeout(timer);
      timer = null; pending = null; revision++; restoration++;
      try { options.storage.removeItem(`codexWebReading:${options.getOwner()}`); } catch { /* Logout must remain possible. */ }
    }
    return { capture, restore, input, scrolled, isCurrent, remember, flush, saved, clear };
  }
  Object.assign(globalThis, { CodexWebSessionReading: { createController } });
}());
