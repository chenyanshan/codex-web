(function initializeSessionRename(globalScope) {
  function createController({ state, t, escapeHtml, escapeAttribute, render, listen, apiFetch, isReadOnly, isShare, rememberFocus, restoreFocus, applyName }) {
    let dialog = null;
    let revision = 0;
    const changes = new Map();
    const canOpen = () => Boolean(state.sessionId && !state.draftSessionActive && !isShare() && !isReadOnly(state.currentSession)
      && state.currentSession?.canRename !== false && (state.authSession?.principal?.mode !== 'multi' || state.currentSession?.canRename === true));
    function invalidate() { dialog = null; }
    function close() { if (dialog?.saving) return; invalidate(); restoreFocus(); render(); }
    function open() {
      if (!canOpen()) return;
      rememberFocus(document.querySelector('#settings-toggle'));
      dialog = { id: state.sessionId, token: state.token, value: String(state.currentSession?.title || '').trim(), saving: false, error: '' };
      state.settingsOpen = false;
      render();
    }
    function validName(value) {
      const name = value.trim();
      return name.length > 0 && name.length <= 120 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
    }
    async function save(event) {
      event.preventDefault();
      const current = dialog;
      if (!current || current.saving || !validName(current.value) || !canOpen()) return;
      current.saving = true;
      current.error = '';
      render();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const payload = await apiFetch(`/api/sessions/${encodeURIComponent(current.id)}/name`, { method: 'PATCH', body: { name: current.value.trim() }, signal: controller.signal });
        if (dialog !== current || state.token !== current.token || state.sessionId !== current.id) return;
        if (payload?.session?.id !== current.id || typeof payload.session.title !== 'string') throw new Error('Invalid rename response');
        const title = payload.session.title;
        changes.set(current.id, { title, revision: ++revision, token: current.token });
        while (changes.size > 100) changes.delete(changes.keys().next().value);
        applyName(current.id, title);
        current.saving = false;
        close();
      } catch (_error) {
        if (dialog !== current || state.token !== current.token || state.sessionId !== current.id) return;
        current.saving = false;
        current.error = 'Could not save the session name. Try again.';
        render();
      } finally { clearTimeout(timeout); }
    }
    function capture() { return { revision, token: state.token }; }
    function reconcile(payload, request) {
      const update = (session) => {
        const change = changes.get(session?.id);
        return change && change.token === request.token && change.revision > request.revision
          ? { ...session, title: change.title, ...(session.thread ? { thread: { ...session.thread, title: change.title } } : {}) } : session;
      };
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (!payload.session && !Array.isArray(payload.items))) return payload;
      return { ...payload, ...(payload.session ? { session: update(payload.session) } : {}),
        ...(Array.isArray(payload.items) ? { items: payload.items.map(update) } : {}) };
    }
    function html() {
      if (!dialog) return '';
      return `<div class="modal-backdrop"><form class="confirm-dialog" id="session-name-form" role="dialog" aria-modal="true" aria-labelledby="session-name-title" data-focus-scope="session-rename">
        <h2 id="session-name-title">${escapeHtml(t('Rename session'))}</h2>
        <div class="field"><label for="session-name-input">${escapeHtml(t('Session name'))}</label>
        <input id="session-name-input" type="text" aria-invalid="${Boolean(dialog.error)}" maxlength="120" value="${escapeAttribute(dialog.value)}" autocomplete="off" data-i18n-skip data-initial-focus${dialog.saving ? ' disabled' : ''} aria-describedby="session-name-hint${dialog.error ? ' session-name-error' : ''}"></div>
        <p class="meta" id="session-name-hint">${escapeHtml(t('Up to 120 characters. Saved in Codex.'))}</p>
        ${dialog.error ? `<p class="error" role="alert" id="session-name-error">${escapeHtml(t(dialog.error))}</p>` : ''}
        <div class="actions"><button class="ghost compact-button" type="button" id="cancel-session-name"${dialog.saving ? ' disabled' : ''}>${escapeHtml(t('Cancel'))}</button><button class="primary compact-button" type="submit" id="save-session-name"${dialog.saving || !validName(dialog.value) ? ' disabled' : ''}>${escapeHtml(t(dialog.saving ? 'Saving…' : 'Save'))}</button></div>
      </form></div>`;
    }
    function bind() {
      const connect = (id, event, handler) => { const node = document.querySelector(`#${id}`); if (node) listen(node, event, handler); };
      connect('rename-session-button', 'click', open);
      connect('cancel-session-name', 'click', close);
      connect('session-name-form', 'submit', save);
      connect('session-name-input', 'input', (event) => {
        if (!dialog || dialog.saving) return;
        dialog.value = event.target.value;
        const saveButton = document.querySelector('#save-session-name');
        if (saveButton) saveButton.disabled = !validName(dialog.value);
      });
    }
    return { canOpen, open, close, invalidate, capture, reconcile, bind, render: html, isOpen: () => Boolean(dialog) };
  }
  globalScope.CodexWebSessionRename = { createController };
})(globalThis);
