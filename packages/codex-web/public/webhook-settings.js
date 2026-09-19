// Focused presentation boundary; all application capabilities are explicit.
(function install(globalScope) {
  function createRenderer(context) {
    const { state, t, escapeHtml, translateText, escapeAttribute, createWebhookSettingsState, handleApiError, isShareContext, getAuthRequestGeneration, render, apiFetch, isAuthRequestCurrent, rememberFocusReturn, requestFocusRestore, copyTextToClipboard } = context;
function renderWebhookSettingsSection() {
  const webhook = state.webhook;
  const busy = webhook.loading || webhook.saving;
  const endpoint = webhookEndpointUrl();
  const keyValue = webhook.key || (webhook.hasKey
    ? webhookKeyHintDisplay(webhook.keyHint)
    : t('Webhook key is not available.'));
  return `
        <section class="settings-section webhook-settings-section" aria-busy="${String(busy)}">
          <div class="settings-section-title">Webhook</div>
          <label class="settings-action-row webhook-toggle-row">
            <span class="webhook-toggle-copy">
              <strong>Enable webhook</strong>
              ${!webhook.loaded && webhook.loading ? '<span class="meta">Loading webhook settings...</span>' : ''}
            </span>
            <input id="webhook-enabled-toggle" type="checkbox"${webhook.enabled ? ' checked' : ''}${!webhook.loaded || busy ? ' disabled' : ''}>
          </label>
          ${webhook.error ? `<div class="meta webhook-settings-error" role="alert">${escapeHtml(translateText(webhook.error))}</div>` : ''}
          ${webhook.loaded && !webhook.enabled ? '<div class="meta">Webhook is disabled.</div>' : ''}
          ${webhook.loaded && webhook.enabled ? `
            <div class="webhook-settings-details">
              <div class="settings-field webhook-settings-field">
                <label class="settings-field-label" for="webhook-endpoint-input">Webhook endpoint</label>
                <div class="webhook-value-row">
                  <input id="webhook-endpoint-input" class="webhook-value-input" type="text" readonly spellcheck="false" value="${escapeAttribute(endpoint)}" data-i18n-skip>
                  <button class="ghost compact-button" type="button" id="webhook-copy-endpoint-button"${!endpoint || busy ? ' disabled' : ''}>${webhook.endpointCopied ? 'Copied' : 'Copy'}</button>
                </div>
                ${webhook.endpointCopied ? '<span class="meta" role="status">Webhook endpoint copied.</span>' : ''}
              </div>
              <div class="settings-field webhook-settings-field">
                <label class="settings-field-label" for="webhook-key-input">Webhook key</label>
                <div class="webhook-value-row">
                  <input id="webhook-key-input" class="webhook-value-input webhook-secret-input" type="text" readonly autocomplete="off" spellcheck="false" value="${escapeAttribute(keyValue)}" data-i18n-skip>
                  <div class="webhook-key-actions">
                    <button class="ghost compact-button" type="button" id="webhook-copy-key-button"${!webhook.key || busy ? ' disabled' : ''}>${webhook.keyCopied ? 'Copied' : 'Copy key'}</button>
                    <button class="ghost compact-button" type="button" id="webhook-rotate-key-button"${busy ? ' disabled' : ''}>Regenerate key</button>
                  </div>
                </div>
                ${webhook.keyCopied ? '<span class="meta" role="status">Webhook key copied.</span>' : ''}
                ${webhook.hasKey && !webhook.key ? '<span class="meta">Regenerate this legacy key once to make it copyable.</span>' : ''}
              </div>
            </div>
          ` : ''}
        </section>
  `;
}

function renderWebhookDialogs() {
  return renderWebhookRotateConfirmDialog();
}

function renderWebhookRotateConfirmDialog() {
  if (!state.webhookRotateConfirmOpen) {
    return '';
  }
  const saving = state.webhook.saving;
  return `
      <div class="modal-backdrop webhook-modal-backdrop" data-modal-dismiss="webhook-rotate">
        <section class="confirm-dialog webhook-dialog" role="dialog" aria-modal="true" aria-labelledby="webhook-rotate-title" data-focus-scope="webhook-rotate">
          <div>
            <h2 id="webhook-rotate-title">Regenerate webhook key?</h2>
            <p class="meta">The current key will stop working immediately.</p>
          </div>
          <div class="actions">
            <button class="ghost compact-button" type="button" id="webhook-rotate-cancel-button"${saving ? ' disabled' : ''} data-initial-focus>Cancel</button>
            <button class="danger compact-button" type="button" id="webhook-rotate-confirm-button"${saving ? ' disabled' : ''}>Regenerate</button>
          </div>
        </section>
      </div>
  `;
}

function normalizeWebhookEndpointPath(value) {
  const normalized = String(value || '').trim();
  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return '';
  }
  try {
    const parsed = new URL(normalized, 'http://codex-web.local');
    return `${parsed.pathname}${parsed.search}`;
  } catch (_error) {
    return '';
  }
}

function normalizeWebhookKeyHint(value) {
  return typeof value === 'string' ? value.trim().slice(-6) : '';
}

function webhookKeyHintDisplay(value) {
  const hint = normalizeWebhookKeyHint(value);
  return hint ? `cwwh_...${hint}` : 'cwwh_...******';
}

function webhookEndpointUrl() {
  const endpointPath = normalizeWebhookEndpointPath(state.webhook.endpointPath);
  const origin = String(window.location?.origin || '').trim().replace(/\/+$/u, '');
  if (!endpointPath || !origin) {
    return '';
  }
  try {
    const endpoint = new URL(endpointPath, `${origin}/`);
    const expectedOrigin = new URL(`${origin}/`).origin;
    return endpoint.origin === expectedOrigin ? endpoint.toString() : '';
  } catch (_error) {
    return '';
  }
}

function applyWebhookSettingsPayload(payload) {
  const webhook = payload?.webhook && typeof payload.webhook === 'object'
    ? payload.webhook
    : {};
  state.webhook = {
    ...createWebhookSettingsState(),
    enabled: webhook.enabled === true,
    hasKey: webhook.hasKey === true,
    key: webhookResponseKey(payload),
    keyHint: normalizeWebhookKeyHint(webhook.keyHint),
    endpointPath: normalizeWebhookEndpointPath(webhook.endpointPath),
    loaded: true,
  };
  return state.webhook;
}

function webhookResponseKey(payload) {
  return typeof payload?.key === 'string' ? payload.key.trim().slice(0, 1000) : '';
}

function webhookErrorMessage(error, fallback) {
  return String(error?.payload?.message || error?.message || fallback || 'Could not update webhook settings.');
}

function handleWebhookRequestError(error, fallback, previous = state.webhook) {
  if (error?.status === 401) {
    handleApiError(error);
    return;
  }
  state.webhook = {
    ...previous,
    loading: false,
    saving: false,
    endpointCopied: false,
    keyCopied: false,
    error: webhookErrorMessage(error, fallback),
  };
}

async function refreshWebhookSettings({ renderAfter = true } = {}) {
  if (!state.authSession || isShareContext() || state.webhook.loading) {
    return null;
  }
  const requestGeneration = getAuthRequestGeneration();
  state.webhook = {
    ...state.webhook,
    loading: true,
    endpointCopied: false,
    keyCopied: false,
    error: '',
  };
  if (renderAfter) {
    render();
  }
  try {
    const payload = await apiFetch('/api/webhook');
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    return applyWebhookSettingsPayload(payload);
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleWebhookRequestError(error, 'Could not load webhook settings.');
    return null;
  } finally {
    if (isAuthRequestCurrent(requestGeneration)) {
      state.webhook.loading = false;
      if (renderAfter) {
        render();
      }
    }
  }
}

async function setWebhookEnabled(enabled) {
  if (
    !state.authSession
    || isShareContext()
    || !state.webhook.loaded
    || state.webhook.loading
    || state.webhook.saving
  ) {
    return null;
  }
  const requestGeneration = getAuthRequestGeneration();
  const previous = { ...state.webhook };
  state.webhook = {
    ...state.webhook,
    enabled: enabled === true,
    saving: true,
    endpointCopied: false,
    keyCopied: false,
    error: '',
  };
  render();
  try {
    const payload = await apiFetch('/api/webhook', {
      method: 'PATCH',
      body: { enabled: enabled === true },
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    return applyWebhookSettingsPayload(payload);
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleWebhookRequestError(error, 'Could not update webhook settings.', previous);
    return null;
  } finally {
    if (isAuthRequestCurrent(requestGeneration)) {
      state.webhook.saving = false;
      render();
    }
  }
}

function requestWebhookKeyRotation(focusTarget = document.activeElement) {
  if (!state.webhook.loaded || !state.webhook.enabled || state.webhook.loading || state.webhook.saving) {
    return false;
  }
  rememberFocusReturn(focusTarget);
  state.webhookRotateConfirmOpen = true;
  state.webhook.error = '';
  render();
  return true;
}

function cancelWebhookKeyRotation() {
  if (!state.webhookRotateConfirmOpen || state.webhook.saving) {
    return false;
  }
  requestFocusRestore();
  state.webhookRotateConfirmOpen = false;
  render();
  return true;
}

async function rotateWebhookKey() {
  if (
    !state.authSession
    || isShareContext()
    || !state.webhookRotateConfirmOpen
    || !state.webhook.enabled
    || state.webhook.loading
    || state.webhook.saving
  ) {
    return null;
  }
  const requestGeneration = getAuthRequestGeneration();
  const previous = { ...state.webhook };
  state.webhook = {
    ...state.webhook,
    saving: true,
    endpointCopied: false,
    keyCopied: false,
    error: '',
  };
  render();
  try {
    const payload = await apiFetch('/api/webhook/rotate', { method: 'POST' });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    const webhook = applyWebhookSettingsPayload(payload);
    state.webhookRotateConfirmOpen = false;
    if (!webhook.key) {
      requestFocusRestore();
      state.webhook.error = 'Webhook key is not available.';
    }
    return webhook;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.webhookRotateConfirmOpen = false;
    requestFocusRestore();
    handleWebhookRequestError(error, 'Could not regenerate webhook key.', previous);
    return null;
  } finally {
    if (isAuthRequestCurrent(requestGeneration)) {
      state.webhook.saving = false;
      render();
    }
  }
}

async function copyWebhookEndpoint() {
  const endpoint = webhookEndpointUrl();
  if (!endpoint || state.webhook.loading || state.webhook.saving) {
    return false;
  }
  const copied = await copyTextToClipboard(endpoint, '#webhook-endpoint-input');
  state.webhook.endpointCopied = copied;
  state.webhook.error = copied ? '' : 'Could not copy webhook endpoint.';
  render();
  return copied;
}

async function copyWebhookKey() {
  const key = state.webhook.key || '';
  if (!key) {
    return false;
  }
  const copied = await copyTextToClipboard(key, '#webhook-key-input');
  if (state.webhook.key !== key) {
    return copied;
  }
  state.webhook = {
    ...state.webhook,
    keyCopied: copied,
    error: copied ? '' : 'Could not copy webhook key.',
  };
  render();
  return copied;
}


    return { renderWebhookSettingsSection, renderWebhookDialogs, renderWebhookRotateConfirmDialog, normalizeWebhookEndpointPath, normalizeWebhookKeyHint, webhookKeyHintDisplay, webhookEndpointUrl, applyWebhookSettingsPayload, webhookResponseKey, webhookErrorMessage, handleWebhookRequestError, refreshWebhookSettings, setWebhookEnabled, requestWebhookKeyRotation, cancelWebhookKeyRotation, rotateWebhookKey, copyWebhookEndpoint, copyWebhookKey };
  }
  globalScope.CodexWebWebhookSettings = { createRenderer };
}(globalThis));
