(function install(globalScope) {
  const completed = status => ['completed', 'complete', 'succeeded', 'success', 'finished'].includes(String(status || '').toLowerCase());
  function createController({ storage, owner }) {
    let storageKey = '', markers = {};
    function load() {
      const key = `codexWebSessionRead:${owner()}`;
      if (key === storageKey) return;
      storageKey = key;
      try {
        const saved = JSON.parse(storage.getItem(key) || '{}');
        markers = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
      } catch { markers = {}; }
    }
    function save() {
      markers = Object.fromEntries(Object.entries(markers).slice(-2000));
      try { storage.setItem(storageKey, JSON.stringify(markers)); } catch {}
    }
    function latestTurn(session) {
      load();
      if (!session?.id) return null;
      const reported = session.latestTurn || session.thread?.turns?.at(-1);
      const entry = markers[session.id];
      const known = entry?.latestTurn;
      if (!reported?.id) return known || null;
      if (known?.id === reported.id && known.status === reported.status) return known;
      // A delayed in-progress snapshot cannot erase an observed terminal result.
      if (known?.id === reported.id && ['completed', 'failed', 'interrupted'].includes(known.status)
        && ['inProgress', 'in_progress', 'running'].includes(reported.status)) return known;
      const turn = { id: String(reported.id), status: String(reported.status || '') };
      delete markers[session.id];
      markers[session.id] = { read: typeof entry === 'string' ? entry : entry?.read || '', latestTurn: turn };
      save();
      return turn;
    }
    function resultKey(session) {
      const turn = latestTurn(session);
      return turn?.id && completed(turn.status) ? String(turn.id) : '';
    }
    function unread(session) {
      load();
      const result = resultKey(session);
      const entry = markers[session.id];
      return Boolean(result && (typeof entry === 'string' ? entry : entry?.read) !== result);
    }
    function markRead(session) {
      load();
      const result = resultKey(session);
      if (!result || markers[session.id]?.read === result) return false;
      const latestTurn = markers[session.id]?.latestTurn;
      delete markers[session.id];
      markers[session.id] = { read: result, latestTurn };
      save();
      return true;
    }
    return { unread, markRead, latestTurn };
  }
  globalScope.CodexWebSessionAttention = { createController };
})(globalThis);
