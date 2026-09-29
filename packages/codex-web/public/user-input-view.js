(function install(scope) {
  const STORE_KEY = 'codex-web.question-drafts.v1';
  function submissionIdentity() {
    if (scope.crypto?.randomUUID) return scope.crypto.randomUUID();
    if (!scope.crypto?.getRandomValues) throw Error('Secure answer tracking is unavailable');
    return Array.from(scope.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function createDelivery({ apiFetch, identity, sessionId, storage, signal, randomUUID = submissionIdentity }) {
    const key = (requestId) => JSON.stringify([identity, sessionId, requestId]);
    function load() { try { const value = JSON.parse(storage?.getItem(STORE_KEY) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
    const memory = load();
    function save() {
      const entries = Object.entries(memory).slice(-32);
      const text = JSON.stringify(Object.fromEntries(entries));
      if (text.length > 128 * 1024) throw Error('Question drafts are full');
      storage?.setItem(STORE_KEY, text);
    }
    function draft(request, answers) {
      const previous = memory[key(request.requestId)] || {};
      const safe = {};
      for (const q of request.questions) if (!q.isSecret && answers[q.id]) safe[q.id] = answers[q.id];
      memory[key(request.requestId)] = { ...previous, answers: safe };
      try { save(); return true; } catch { return false; }
    }
    const get = (requestId) => memory[key(requestId)] || {};
    const base = `/api/sessions/${encodeURIComponent(sessionId)}/user-input`;
    async function check(requestId) {
      const state = get(requestId);
      if (!state.answerSubmissionId) return null;
      const result = await apiFetch(`${base}/receipts/${encodeURIComponent(state.answerSubmissionId)}`, { signal });
      state.status = result.receipt.status;
      try { save(); } catch { /* receipt identity already recorded before the write */ }
      return result;
    }
    async function submit(request, answers, verified) {
      if (!verified || request.status !== 'pending') throw Error('Reconnect to check whether this question is still open');
      const state = get(request.requestId);
      if (state.answerSubmissionId) return check(request.requestId);
      if (!storage) throw Error('Answer tracking is unavailable; enable browser storage before sending');
      if (!draft(request, answers)) throw Error('Could not save answer tracking; nothing was sent');
      const next = get(request.requestId);
      next.answerSubmissionId = randomUUID(); next.status = 'delivery_unknown';
      try { save(); } catch (error) { delete next.answerSubmissionId; delete next.status; throw error; }
      // Never repeat this POST: even a lost HTTP response can mean the answer was delivered.
      const result = await apiFetch(`${base}/${encodeURIComponent(request.requestId)}/answer`, {
        method: 'POST', signal, body: { answerSubmissionId: next.answerSubmissionId, answers },
      });
      next.status = result.receipt.status;
      try { save(); } catch { /* retain the durable submission identity */ }
      return result;
    }
    return { get, draft, submit, check };
  }
  function defaultStorage() { try { return scope.localStorage; } catch { return null; } }
  function createUserInputView({ container, apiFetch, getIdentity, getSessionId, storage = defaultStorage(), t = value => value }) {
    const translate = t;
    const chinese = {
      'Codex needs your answer': 'Codex 需要你回答', 'A question from Codex': 'Codex 的问题',
      'Send answer': '发送回答', 'Check answer status': '查询回答状态', 'Choose an answer': '选择一个答案',
      'Or write your answer': '或输入你的回答', 'This answer is not saved on this device.': '此回答不会保存在此设备上。',
      'Draft could not be saved on this device.': '无法在此设备上保存草稿。', 'Answer each question before sending.': '请先回答每个问题。',
      'Answer delivery is unknown. Check its status; do not send it again.': '回答送达情况待确认，请查询状态，不要重复发送。',
      'Codex resolved this question.': 'Codex 已处理此问题。',
      'This question has expired. Your saved answer remains available to copy.': '此问题已过期，已保存的回答仍可复制。',
      'Reconnect to check whether this question is still open': '请重新连接，确认此问题是否仍待回答',
      'Reconnect to check whether this question is still open.': '请重新连接，确认此问题是否仍待回答。',
      'Codex is waiting for your answer.': 'Codex 正在等待你的回答。', 'Codex may continue while you answer.': '你回答期间 Codex 可能继续执行。',
      'Question drafts are full': '问题草稿存储已满', 'Secure answer tracking is unavailable': '无法安全记录回答送达状态',
      'Answer tracking is unavailable; enable browser storage before sending': '无法记录回答状态，请启用浏览器存储后再发送',
      'Could not save answer tracking; nothing was sent': '无法保存回答状态，尚未发送',
    };
    t = value => { const result = translate(value); return result !== value ? result : /^zh/i.test(container.ownerDocument.documentElement.lang || '') ? chinese[value] || value : value; };
    let identity = '', sessionId = '', delivery = null, verified = false, destroyed = false;
    const cards = new Map();
    let controller = new AbortController();
    const window = container.ownerDocument.defaultView;
    function flushDrafts() { for (const card of cards.values()) card.flushDraft?.(); }
    window?.addEventListener('pagehide', flushDrafts);
    function visibilityChanged() { if (container.ownerDocument.visibilityState === 'hidden') flushDrafts(); }
    container.ownerDocument.addEventListener('visibilitychange', visibilityChanged);
    const element = (tag, text, className) => { const node = container.ownerDocument.createElement(tag); if (text) node.textContent = t(text); if (className) node.className = className; return node; };
    function render(requests, options = {}) {
      if (destroyed) return;
      const nextIdentity = String(getIdentity() || ''), nextSession = String(getSessionId() || '');
      if (identity !== nextIdentity || sessionId !== nextSession) {
        flushDrafts(); controller.abort(); controller = new AbortController();
        identity = nextIdentity; sessionId = nextSession; cards.clear(); container.replaceChildren();
        delivery = createDelivery({ apiFetch, identity, sessionId, storage, signal: controller.signal });
      }
      verified = options.verified === true && Boolean(identity && sessionId);
      const ids = new Set();
      for (const request of requests.slice(0, 20)) {
        ids.add(request.requestId);
        let card = cards.get(request.requestId);
        if (!card) { card = build(request); cards.set(request.requestId, card); container.append(card.node); }
        card.request = request; update(card);
      }
      for (const [id, card] of cards) if (!ids.has(id)) {
        // Keep drafts available for copying when a request disappears across epochs.
        card.request = { ...card.request, status: 'expired' }; update(card);
      }
      while (cards.size > 32) { const [id, card] = cards.entries().next().value; card.flushDraft?.(); card.node.remove(); cards.delete(id); }
      container.hidden = cards.size === 0;
    }
    function build(request) {
      const node = element('section', '', 'user-input-question');
      const heading = element('strong', request.isBlocking ? 'Codex needs your answer' : 'A question from Codex');
      node.append(heading);
      const card = { node, request, values: {}, controls: [], busy: false, status: element('p', '', 'user-input-status'), button: element('button', 'Send answer', 'primary'), check: element('button', 'Check answer status', 'ghost') };
      const saved = delivery.get(request.requestId).answers || {};
      for (const q of request.questions) {
        const fieldset = element('fieldset'); const legend = element('legend', q.question); fieldset.append(legend);
        const value = saved[q.id]?.answers?.[0] || ''; card.values[q.id] = value;
        let choice = null, written = null;
        if (Array.isArray(q.options) && q.options.length) {
          const select = element('select'); choice = select; select.setAttribute('aria-label', q.header || q.question);
          const placeholder = element('option', 'Choose an answer'); placeholder.value = ''; select.append(placeholder);
          for (const option of q.options) { const item = element('option', `${option.label} — ${option.description}`); item.value = option.label; select.append(item); }
          const explanation = element('p', '', 'user-input-option-description');
          explanation.setAttribute('aria-live', 'polite');
          function describeChoice() {
            explanation.textContent = q.options.find(option => option.label === select.value)?.description || '';
            explanation.hidden = !explanation.textContent;
          }
          select.value = value; describeChoice();
          select.addEventListener('change', () => { card.values[q.id] = select.value; if (written) written.value = ''; describeChoice(); persist(); });
          card.controls.push(select); fieldset.append(select, explanation);
        }
        if (q.isOther || !q.options?.length) {
          const input = element(q.isSecret ? 'input' : 'textarea'); written = input;
          if (q.isSecret) { input.type = 'password'; input.autocomplete = 'off'; } else { input.rows = 2; input.maxLength = 8192; }
          input.setAttribute('aria-label', q.options?.length ? t('Or write your answer') : q.question);
          input.placeholder = q.options?.length ? t('Or write your answer') : '';
          input.value = choice?.value ? '' : value; input.addEventListener('input', () => { card.values[q.id] = input.value; if (choice) { choice.value = ''; const explanation = fieldset.querySelector('.user-input-option-description'); if (explanation) { explanation.hidden = true; explanation.textContent = ''; } } persist(); });
          card.controls.push(input); fieldset.append(input);
          if (q.isSecret) fieldset.append(element('small', 'This answer is not saved on this device.'));
        }
        node.append(fieldset);
      }
      function answers() { return Object.fromEntries(Object.entries(card.values).map(([id, value]) => [id, { answers: [value] }])); }
      let draftTimer = null;
      card.flushDraft = () => {
        if (draftTimer === null) return;
        clearTimeout(draftTimer); draftTimer = null;
        if (!delivery.draft(card.request, answers())) card.status.textContent = t('Draft could not be saved on this device.');
      };
      function persist() { if (draftTimer !== null) clearTimeout(draftTimer); draftTimer = setTimeout(card.flushDraft, 250); }
      card.button.type = card.check.type = 'button'; card.status.setAttribute('role', 'status');
      async function perform(checkOnly) {
        if (card.busy) return;
        if (!checkOnly && Object.values(card.values).some(value => !String(value).trim())) { card.status.textContent = t('Answer each question before sending.'); return; }
        const owner = identity, session = sessionId; card.busy = true; update(card);
        try {
          const result = checkOnly ? await delivery.check(card.request.requestId) : await delivery.submit(card.request, answers(), verified);
          if (destroyed || owner !== identity || session !== sessionId) return;
          if (result?.request) card.request = result.request;
          update(card);
        } catch (error) {
          if (destroyed || owner !== identity || session !== sessionId) return;
          card.status.textContent = t(delivery.get(card.request.requestId).answerSubmissionId ? 'Answer delivery is unknown. Check its status; do not send it again.' : error.message);
        } finally { card.busy = false; if (!destroyed && owner === identity && session === sessionId) updateControls(card); }
      }
      card.button.addEventListener('click', () => perform(false)); card.check.addEventListener('click', () => perform(true));
      const actions = element('div', '', 'user-input-actions'); actions.append(card.button, card.check); node.append(card.status, actions);
      return card;
    }
    function updateControls(card) {
      const submitted = Boolean(delivery.get(card.request.requestId).answerSubmissionId);
      card.button.disabled = card.busy || !verified || card.request.status !== 'pending' || submitted;
      card.check.hidden = !submitted; card.check.disabled = card.busy || !verified;
      for (const control of card.controls) {
        if (control.tagName === 'SELECT') control.disabled = card.busy || submitted || card.request.status !== 'pending';
        else control.readOnly = card.busy || submitted || card.request.status !== 'pending';
      }
    }
    function update(card) {
      const state = delivery.get(card.request.requestId);
      const status = card.request.status === 'resolved' || card.request.status === 'expired' ? card.request.status : state.status || card.request.status;
      card.status.textContent = t(status === 'resolved' ? 'Codex resolved this question.' : status === 'expired' ? 'This question has expired. Your saved answer remains available to copy.' : status === 'delivery_unknown' ? 'Answer delivery is unknown. Check its status; do not send it again.' : !verified ? 'Reconnect to check whether this question is still open.' : card.request.isBlocking ? 'Codex is waiting for your answer.' : 'Codex may continue while you answer.');
      updateControls(card);
    }
    return { render, destroy() { flushDrafts(); destroyed = true; controller.abort(); window?.removeEventListener('pagehide', flushDrafts); container.ownerDocument.removeEventListener('visibilitychange', visibilityChanged); cards.clear(); container.replaceChildren(); } };
  }
  scope.CodexWebUserInput = { createUserInputView, createDelivery };
}(globalThis));

(function installOwnedQuestionView() {
  // Retain an optional view's owned DOM across host renders; no secret drafts enter HTML strings.
  function createOwnedView({ globalName, factory, selector, stylesheet, getOwner, getRequests, getVerified, context }) {
    let view, container, owner = '', pending, styles, ready = false, failed = false;
    const focused = () => container?.contains?.(document.activeElement) ? document.activeElement : null;
    function destroy() { view?.destroy(); view = null; container = null; owner = ''; }
    function sync() {
      const nextOwner = getOwner();
      const target = document.querySelector(selector);
      if (!nextOwner || !target) { destroy(); return; }
      if (owner && owner !== nextOwner) destroy();
      if ((view || failed) && container && target !== container) target.replaceWith(container);
      else container = target;
      const requests = getRequests();
      if (!requests.length && !view) return;
      owner = nextOwner;
      if (ready && globalThis[globalName]) {
        view ||= globalThis[globalName][factory]({ container, ...context });
        view.render(requests, { verified: getVerified() });
        return;
      }
      container.hidden = false;
      if (failed && container.querySelector('[data-question-retry]')) return;
      container.replaceChildren();
      const status = document.createElement('p'); status.className = 'meta'; status.setAttribute('role', 'status');
      status.textContent = context.t(failed ? 'Questions could not be loaded.' : 'Loading questions…'); container.append(status);
      if (failed) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'ghost'; retry.dataset.questionRetry = '';
        retry.textContent = context.t('Retry'); retry.addEventListener('click', () => { failed = false; sync(); }); container.append(retry); return;
      }
      if (pending) return;
      styles ||= globalThis.CodexWebLazyFeature.loadStylesheet(stylesheet).catch(error => { styles = null; throw error; });
      pending = styles.then(() => { ready = true; }).catch(() => { failed = true; }).finally(() => { pending = null; if (getOwner() && document.querySelector(selector)) sync(); });
    }
    return { sync, destroy, focused };
  }

 globalThis.CodexWebOwnedQuestionView = { createRenderer: createOwnedView };
}());
