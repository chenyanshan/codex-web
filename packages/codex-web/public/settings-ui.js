// Settings presentation only. Existing handlers continue to own saving and access checks.
(function install(scope) {
  function renderGroups(groups) {
    const available = groups.filter(group => group.content);
    return `<div class="settings-workspace">
      <nav class="settings-group-nav" aria-label="Settings sections">
        ${available.map(group => `<button class="ghost" type="button" data-settings-group="${group.id}">${group.title}</button>`).join('')}
      </nav>
      <main class="app-settings-page settings-content" id="settings-content">
        ${available.map(group => `<div class="settings-group" id="settings-group-${group.id}">
          <header class="settings-group-heading"><h2 tabindex="-1" id="settings-heading-${group.id}">${group.title}</h2><p class="meta">${group.description}</p></header>
          ${group.content}
        </div>`).join('')}
      </main>
    </div>`;
  }
  function bindNavigation(root, listen) {
    for (const button of root.querySelectorAll('[data-settings-group]')) {
      listen(button, 'click', () => {
        const heading = root.querySelector(`#settings-heading-${button.dataset.settingsGroup}`);
        if (!heading) return;
        heading.scrollIntoView({ block: 'start', behavior: 'instant' });
        heading.focus({ preventScroll: true });
      });
    }
  }
  scope.CodexWebSettingsUI = { renderGroups, bindNavigation };
}(globalThis));
