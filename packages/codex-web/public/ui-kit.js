(function installCodexWebUi(globalObject) {
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

  globalObject.CodexWebUi = Object.freeze({ icon, segmentedControl });
})(globalThis);
