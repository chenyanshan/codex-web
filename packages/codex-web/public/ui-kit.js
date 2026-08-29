(function installCodexWebUi(globalObject) {
  const SESSION_LAYOUT_KEY = 'codexWebSessionLayout';
  const SESSION_LAYOUTS = Object.freeze(['current', 'console']);
  const DEFAULT_SESSION_LAYOUT = 'current';
  const iconPaths = Object.freeze({
    admin: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    archive: '<rect x="3" y="5" width="18" height="4" rx="1"/><path d="M5 9v10h14V9M9 13h6"/>',
    arrowLeft: '<path d="m15 18-6-6 6-6"/>',
    attachment: '<path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3Z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.7-2.5L20 12M4 12l2.2 5.5A7 7 0 0 0 18 15"/>',
    report: '<path d="M5 3h14v18H5Z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    send: '<path d="m3 3 3.75 9L3 21l18-9L3 3Z"/><path d="M6.75 12H21"/>',
    sessions: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-5 3.5-7 8-7s7.2 2 8 7"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c.6-4 2.6-6 6-6s5.4 2 6 6M16 5a3 3 0 0 1 0 6m0 3c3 0 4.5 2 5 6"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
  });

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;')
      .replace(/'/gu, '&#39;');
  }

  function icon(name, { className = 'ui-icon', label = '' } = {}) {
    const path = iconPaths[name] || iconPaths.file;
    const accessibility = label
      ? `role="img" aria-label="${escapeHtml(label)}"`
      : 'aria-hidden="true" focusable="false"';
    return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" ${accessibility} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  function segmentedControl({ className = '', items = [] } = {}) {
    return `
      <div class="segmented-control${className ? ` ${escapeHtml(className)}` : ''}" role="group">
        ${items.map((item) => `
          <button type="button" data-sort-mode="${escapeHtml(item.value)}" aria-pressed="${String(item.pressed === true)}"${item.ariaLabel ? ` aria-label="${escapeHtml(item.ariaLabel)}"` : ''}${item.title ? ` title="${escapeHtml(item.title)}"` : ''}>
            ${item.icon ? icon(item.icon, { className: 'segmented-icon' }) : ''}
            ${item.label ? `<span>${escapeHtml(item.label)}</span>` : ''}
          </button>
        `).join('')}
      </div>
    `;
  }

  function hideTooltip(tooltip = globalObject.document?.querySelector('#global-tooltip')) {
    tooltip?.classList.remove('is-visible');
    tooltip?.setAttribute('aria-hidden', 'true');
  }

  function bindSidebarTooltips(sidebar, tooltip, signal) {
    hideTooltip(tooltip);
    if (!sidebar || !tooltip || !signal) {
      return;
    }
    const show = ({ currentTarget: item }) => {
      const label = item.dataset.tooltip?.trim();
      if (!label || sidebar.classList.contains('expanded')) {
        return;
      }
      const itemRect = item.getBoundingClientRect();
      tooltip.textContent = label;
      tooltip.classList.add('is-visible');
      tooltip.setAttribute('aria-hidden', 'false');
      const tooltipRect = tooltip.getBoundingClientRect();
      const right = Math.max(itemRect.right, sidebar.getBoundingClientRect().right) + 12;
      tooltip.style.left = `${Math.round(right + tooltipRect.width <= globalObject.innerWidth - 8
        ? right
        : Math.max(8, itemRect.left - tooltipRect.width - 12))}px`;
      tooltip.style.top = `${Math.round(Math.min(
        globalObject.innerHeight - tooltipRect.height - 8,
        Math.max(8, itemRect.top + ((itemRect.height - tooltipRect.height) / 2)),
      ))}px`;
    };
    const listenerOptions = { signal };
    for (const item of sidebar.querySelectorAll('[data-tooltip]')) {
      item.addEventListener('mouseenter', show, listenerOptions);
      item.addEventListener('mouseleave', () => hideTooltip(tooltip), listenerOptions);
      item.addEventListener('focus', show, listenerOptions);
      item.addEventListener('blur', () => hideTooltip(tooltip), listenerOptions);
    }
    sidebar.querySelector('.project-rail-list')?.addEventListener(
      'scroll',
      () => hideTooltip(tooltip),
      { signal, passive: true },
    );
    globalObject.addEventListener('resize', () => hideTooltip(tooltip), { signal, passive: true });
  }

  function readStoredBoolean(key) {
    const value = globalObject.localStorage.getItem(key);
    return value === null ? null : value === 'true';
  }

  function storeBoolean(key, value) {
    try {
      globalObject.localStorage.setItem(key, String(Boolean(value)));
    } catch (_error) {
      // The UI state still applies for this page when browser storage is unavailable.
    }
  }

  function normalizeSessionLayout(layout) {
    return SESSION_LAYOUTS.includes(layout) ? layout : DEFAULT_SESSION_LAYOUT;
  }

  function readSessionLayout() {
    try {
      return normalizeSessionLayout(globalObject.localStorage.getItem(SESSION_LAYOUT_KEY));
    } catch (_error) {
      return DEFAULT_SESSION_LAYOUT;
    }
  }

  function applySessionLayout(state, layout, options = {}) {
    const nextLayout = normalizeSessionLayout(layout);
    state.sessionLayout = nextLayout;
    globalObject.document.documentElement.dataset.sessionLayout = nextLayout;
    if (options.persist !== false) {
      globalObject.localStorage.setItem(SESSION_LAYOUT_KEY, nextLayout);
    }
    return nextLayout;
  }

  function renderAppearanceSettings({ state, themes = [] } = {}) {
    return `
        <section class="settings-section">
          <div class="settings-section-title">Appearance</div>
          <div class="settings-field">
            <div class="settings-field-label">Language</div>
            <div class="toggle language-toggle" role="group" aria-label="Language">
              <button type="button" data-app-language="en" aria-pressed="${String(state.language === 'en')}">English</button>
              <button type="button" data-app-language="zh-CN" aria-pressed="${String(state.language === 'zh-CN')}">中文</button>
            </div>
          </div>
          <div class="settings-field">
            <div class="settings-field-label">Theme</div>
            <div class="theme-picker" role="group" aria-label="Theme">
              ${themes.map((theme) => `
                <button class="theme-option" type="button" data-app-theme="${escapeHtml(theme.id)}" aria-pressed="${String(state.theme === theme.id)}">
                  <span class="theme-swatch" aria-hidden="true">
                    <span class="theme-swatch-surface"></span>
                    <span class="theme-swatch-accent"></span>
                  </span>
                  <span class="theme-option-name">${escapeHtml(theme.label)}</span>
                </button>
              `).join('')}
            </div>
          </div>
          <div class="settings-field">
            <div class="settings-field-label">Session layout</div>
            <div class="toggle session-layout-toggle" role="group" aria-label="Session layout">
              <button type="button" data-session-layout-mode="current" aria-pressed="${String(state.sessionLayout === 'current')}">Current</button>
              <button type="button" data-session-layout-mode="console" aria-pressed="${String(state.sessionLayout === 'console')}">Console</button>
            </div>
          </div>
          <div class="settings-field">
            <div class="settings-field-label">Message Size</div>
            <div class="toggle message-size-toggle" role="group" aria-label="Message Size">
              <button type="button" data-message-font-size="small" aria-pressed="${String(state.messageFontSize === 'small')}">Small</button>
              <button type="button" data-message-font-size="medium" aria-pressed="${String(state.messageFontSize === 'medium')}">Medium</button>
              <button type="button" data-message-font-size="large" aria-pressed="${String(state.messageFontSize === 'large')}">Large</button>
            </div>
          </div>
        </section>
    `;
  }

  function renderConsoleSessionIntro({ ariaLabel, siteTitle, sessionLabel, modelLabel, modelStatus, directoryLabel, location } = {}) {
    return `
    <section class="console-session-intro" aria-label="${escapeHtml(ariaLabel)}">
      <div class="console-session-intro-heading">
        <span class="console-session-prompt" aria-hidden="true">&rsaquo;_</span>
        <strong data-i18n-skip>${escapeHtml(siteTitle)}</strong>
        <span>${escapeHtml(sessionLabel)}</span>
      </div>
      <dl class="console-session-meta">
        <div><dt>${escapeHtml(modelLabel)}:</dt><dd data-i18n-skip>${escapeHtml(modelStatus)}</dd></div>
        <div><dt>${escapeHtml(directoryLabel)}:</dt><dd data-i18n-skip title="${escapeHtml(location)}">${escapeHtml(location)}</dd></div>
      </dl>
    </section>
    `;
  }

  function renderConsoleComposerStatus({ tone, content, modelStatus, location } = {}) {
    return `
      <div class="composer-status console-composer-status" data-tone="${escapeHtml(tone)}" role="status" aria-live="polite" aria-atomic="true">
        <span class="console-status-model" data-i18n-skip>${escapeHtml(modelStatus)}</span>
        <span class="console-status-separator" aria-hidden="true">·</span>
        ${content || ''}
        <span class="console-status-path" data-i18n-skip title="${escapeHtml(location)}">${escapeHtml(location)}</span>
      </div>
    `;
  }

  function createComposerRenderer(context) {
    const state = () => context.getState();
    const disabled = (value) => value ? ' disabled' : '';

    function renderSettingsButton() {
      return `<button class="ghost icon-button compact-refresh new-session-settings-button" type="button" id="new-session-settings-button" aria-label="Model and thinking effort" title="Model and thinking effort" aria-expanded="${String(state().newSessionSettingsOpen)}">${icon('settings', { className: 'button-icon' })}<span class="visually-hidden">Model and thinking effort</span></button>`;
    }

    function renderSettingsPopover() {
      const current = state();
      if (!context.canConfigureNewSessionDraft() || !current.newSessionSettingsOpen) {
        return '';
      }
      return `
          <div class="new-session-settings-popover" role="dialog" aria-label="Model and thinking effort">
            <div class="control-group">
              <label for="new-session-model-select">Model</label>
              <select id="new-session-model-select" name="newSessionModel" data-i18n-skip>${context.renderModelOptions(current.model)}</select>
            </div>
            <div class="control-group">
              <label for="new-session-reasoning-select">Thinking effort</label>
              <select id="new-session-reasoning-select" name="newSessionReasoningEffort" data-i18n-skip>
                ${context.renderReasoningOptions(current.reasoningEffort, current.model)}
              </select>
            </div>
          </div>
      `;
    }

    function renderLeadingControls() {
      const current = state();
      const expandButton = context.isDesktopLayout() ? '' : `<button class="ghost icon-button composer-expand-button${current.composerExpanded ? ' is-expanded' : ''}" type="button" id="composer-expand-button" aria-label="${current.composerExpanded ? 'Collapse message editor' : 'Expand message editor'}" aria-expanded="${String(current.composerExpanded)}"${current.composerCanExpand || current.composerExpanded ? '' : ' hidden'}>${icon('chevronDown', { className: 'button-icon' })}</button>`;
      const attachButton = current.composerExpanded ? '' : `<button class="ghost icon-button attach-button" type="button" id="attach-button" aria-label="Attach files" title="Attach files"${disabled(current.pendingTurn || current.submissionSending || context.hasUploadingComposerAttachments())}>${icon('attachment', { className: 'button-icon' })}</button>`;
      return `<div class="composer-leading-controls">${expandButton}${attachButton}</div>`;
    }

    function renderTrailingControls({ includeNewSessionSettings = false } = {}) {
      const settingsButton = includeNewSessionSettings && context.canConfigureNewSessionDraft()
        ? renderSettingsButton()
        : '';
      return `<div class="composer-trailing-controls${settingsButton ? ' has-new-session-settings' : ''}">${settingsButton}<button class="primary icon-button compact-send" type="submit" id="send-button" aria-label="Send" title="Send"${disabled(state().submissionSending || context.hasUploadingComposerAttachments())}>${icon('send', { className: 'button-icon' })}<span class="visually-hidden">Send</span></button></div>`;
    }

    function renderMessageEditor({ desktop = false } = {}) {
      const current = state();
      const className = context.composerStateClassName();
      const textarea = `<textarea id="prompt-input" name="prompt" rows="1" placeholder="Message">${context.escapeHtml(current.prompt)}</textarea>`;
      if (!desktop) {
        return `<div class="message-editor-shell ${className}">${textarea}</div>`;
      }
      const secondaryAction = context.canConfigureNewSessionDraft()
        ? renderSettingsButton()
        : `<button class="ghost icon-button compact-refresh" type="button" id="composer-refresh-button" aria-label="Refresh session" title="Refresh session">${icon('refresh', { className: 'button-icon' })}<span class="visually-hidden">Refresh</span></button>`;
      return `<div class="message-editor-shell ${className}">${textarea}<div class="composer-toolbar">${renderLeadingControls()}<div class="composer-action-buttons">${secondaryAction}<button class="primary icon-button compact-send" type="submit" id="send-button" aria-label="Send" title="Send"${disabled(current.submissionSending || context.hasUploadingComposerAttachments())}>${icon('send', { className: 'button-icon' })}<span class="visually-hidden">Send</span></button></div></div></div>`;
    }

    function toggleSettings() {
      if (!context.canConfigureNewSessionDraft()) {
        return;
      }
      const current = state();
      const opening = !current.newSessionSettingsOpen;
      if (opening) context.rememberFocusReturn(context.document.activeElement);
      else context.requestFocusRestore();
      current.settingsOpen = false;
      current.newSessionSettingsOpen = opening;
      context.render();
      if (opening) context.document.querySelector('#new-session-model-select')?.focus?.();
    }

    function bindSettings() {
      const button = context.document.querySelector('#new-session-settings-button');
      if (button) context.listenRendered(button, 'click', toggleSettings);
      const model = context.document.querySelector('#new-session-model-select');
      if (model) {
        context.listenRendered(model, 'change', (event) => {
          const current = state();
          current.model = event.target.value;
          current.reasoningEffort = current.model
            ? context.reasoningEffortForModel(current.model, current.reasoningEffort)
            : '';
          context.render();
          context.document.querySelector('#new-session-reasoning-select')?.focus?.();
        });
      }
      const reasoning = context.document.querySelector('#new-session-reasoning-select');
      if (reasoning) {
        context.listenRendered(reasoning, 'change', (event) => {
          state().reasoningEffort = event.target.value;
        });
      }
    }

    function handleSettingsOutsideClick(event) {
      if (!state().newSessionSettingsOpen || event?.target?.closest?.('#new-session-settings-button, .new-session-settings-popover')) {
        return;
      }
      context.requestFocusRestore();
      state().newSessionSettingsOpen = false;
      context.render();
    }

    function preservePromptFocus(event) {
      const prompt = context.document.querySelector('#prompt-input');
      if (prompt && context.document.activeElement === prompt) event.preventDefault();
    }

    return Object.freeze({
      bindSettings,
      handleSettingsOutsideClick,
      preservePromptFocus,
      renderLeadingControls,
      renderMessageEditor,
      renderSettingsPopover,
      renderTrailingControls,
    });
  }

  globalObject.CodexWebUi = Object.freeze({
    DEFAULT_SESSION_LAYOUT,
    applySessionLayout,
    bindSidebarTooltips,
    createComposerRenderer,
    hideTooltip,
    icon,
    readStoredBoolean,
    readSessionLayout,
    renderAppearanceSettings,
    renderConsoleComposerStatus,
    renderConsoleSessionIntro,
    normalizeSessionLayout,
    segmentedControl,
    storeBoolean,
  });
})(globalThis);
