(function installCodexWebAdminUi(globalObject) {
  function createRenderer(context) {
    const state = () => context.getState();
    const h = context.escapeHtml;
    const a = context.escapeAttribute;
    const t = context.t;

    function pageItemCount(page) {
      const admin = state().admin;
      if (page === 'projects') return admin.projects.length;
      if (page === 'roles') return admin.roles.length;
      if (page === 'users') return admin.users.length;
      return admin.sessions.length;
    }

    function renderNavIcon(page) {
      const paths = {
        sessions: '<path d="M4 5h16v14H4zM8 9h8M8 13h5"/>',
        projects: '<path d="M3 6h7l2 2h9v11H3z"/>',
        roles: '<path d="M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-7 16c.7-4 3-6 7-6s6.3 2 7 6"/>',
        users: '<path d="M9 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm7 2a2.5 2.5 0 1 1 0 5M3 20c.5-4 2.5-6 6-6s5.5 2 6 6m1-5c3 0 4.5 1.7 5 5"/>',
      };
      return `<svg class="admin-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[page] || paths.sessions}</svg>`;
    }

    function renderSidebar() {
      const currentPage = context.currentAdminPage();
      const pages = [
        ['sessions', 'Session Audit'],
        ['projects', 'Project Management'],
        ['roles', 'Role Management'],
        ['users', 'User Management'],
      ];
      return `<nav class="admin-sidebar" aria-label="Admin sections">${pages.map(([id, label]) => `
        <button class="admin-sidebar-button" type="button" data-admin-page="${a(id)}" aria-pressed="${String(currentPage === id)}"${currentPage === id ? ' aria-current="page"' : ''}>
          ${renderNavIcon(id)}<span>${h(t(label))}</span><span class="admin-nav-count" data-i18n-skip>${h(String(pageItemCount(id)))}</span>
        </button>`).join('')}</nav>`;
    }

    function renderPageHeading(title, count, countName) {
      return `<header class="admin-page-heading"><h2>${h(t(title))}</h2><span class="admin-page-count" data-i18n-skip>${h(t(`{count} ${countName}`, { count }))}</span></header>`;
    }

    function renderProjectForm() {
      const project = context.adminEditingProject();
      return `
        <form class="admin-form" id="admin-project-form">
          <div class="admin-form-grid">
            <label class="field"><span>Display Name</span><input name="displayName" autocomplete="off" placeholder="auto from CWD" value="${a(project?.displayName || '')}"></label>
            <label class="field"><span>CWD</span><input name="cwd" autocomplete="off" placeholder="/Users/name/repo" value="${a(project?.cwd || '')}" required></label>
            <label class="field"><span>Active sessions</span><input name="activeSessionLimit" type="number" min="1" step="1" inputmode="numeric" placeholder="30" value="${a(project?.activeSessionLimit == null ? '' : String(project.activeSessionLimit))}"></label>
          </div>
          <label class="admin-check-row"><input name="enabled" type="checkbox"${project?.enabled === false ? '' : ' checked'}><span>Enabled</span></label>
          <label class="admin-check-row"><input name="showWorkDetailsToMembers" type="checkbox"${project?.showWorkDetailsToMembers === false ? '' : ' checked'}><span>Members can view work details</span></label>
          <div class="admin-form-actions"><button class="primary compact-button" type="submit">Save Project</button>${project ? '<button class="ghost compact-button" type="button" id="admin-project-edit-cancel">Cancel</button>' : ''}</div>
        </form>`;
    }

    function renderProjectCheckboxes(selectedProjectIds = [], { name = 'projectIds', legend = 'Projects' } = {}) {
      const projects = state().admin.projects;
      if (!projects.length) return `<div class="meta">${h(t('No projects available.'))}</div>`;
      const selected = new Set(selectedProjectIds);
      return `<fieldset class="admin-fieldset"><legend>${h(t(legend))}</legend>${projects.map((project) => `
        <label class="admin-check-row"><input name="${a(name)}" type="checkbox" value="${a(project.id)}"${selected.has(project.id) ? ' checked' : ''}><span data-i18n-skip>${h(context.adminProjectVisibleName(project))}</span></label>`).join('')}</fieldset>`;
    }

    function renderRoleForm() {
      const role = context.adminEditingRole();
      return `
        <form class="admin-form" id="admin-role-form">
          <div class="admin-form-grid">
            <label class="field"><span>Role ID</span><input name="id" autocomplete="off" placeholder="role_writer" value="${a(role?.id || '')}" required${role ? ' readonly' : ''}></label>
            <label class="field"><span>Name</span><input name="name" autocomplete="off" placeholder="Writer" value="${a(role?.name || '')}" required></label>
          </div>
          ${renderProjectCheckboxes(context.adminRoleProjectIds(role))}
          <div class="admin-form-actions"><button class="primary compact-button" type="submit">Save Role</button>${role ? '<button class="ghost compact-button" type="button" id="admin-role-edit-cancel">Cancel</button>' : ''}</div>
        </form>`;
    }

    function renderRoleSelect({ id = 'admin-user-role-select', name = 'roleId', value = '' } = {}) {
      const roles = state().admin.roles;
      if (!roles.length) return `<select id="${a(id)}" name="${a(name)}" data-i18n-skip><option value="">${h(t('No roles available'))}</option></select>`;
      const selectedValue = String(value || '');
      return `<select id="${a(id)}" name="${a(name)}" data-i18n-skip><option value=""${selectedValue ? '' : ' selected'}>${h(t('No role'))}</option>${roles.map((role) => `<option value="${a(role.id)}"${role.id === selectedValue ? ' selected' : ''} data-i18n-skip>${h(role.name || role.id)}</option>`).join('')}</select>`;
    }

    function renderUserForm() {
      const user = context.adminEditingUser();
      const isEditing = Boolean(user);
      return `
        <form class="admin-form" id="admin-user-form">
          <div class="admin-form-grid">
            <label class="field"><span>Username</span><input name="username" autocomplete="username" placeholder="writer" value="${a(user?.username || '')}" required${isEditing ? ' readonly' : ''}></label>
            <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" placeholder="writer@example.com" value="${a(user?.email || '')}"></label>
            ${isEditing ? '' : '<label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" placeholder="At least 8 chars" minlength="8" required></label>'}
          </div>
          <label class="admin-check-row"><input name="enabled" type="checkbox"${user?.enabled === false ? '' : ' checked'}><span>Enabled</span></label>
          <label class="field"><span>Role</span>${renderRoleSelect({ value: context.adminUserRoleId(user) })}</label>
          <div class="admin-form-actions"><button class="primary compact-button" type="submit">${h(t(isEditing ? 'Save' : 'Save User'))}</button>${isEditing ? '<button class="ghost compact-button" type="button" id="admin-user-edit-cancel">Cancel</button>' : ''}</div>
        </form>`;
    }

    function renderProjects() {
      const projects = state().admin.projects;
      if (!projects.length) return `<div class="meta">${h(t('No projects configured.'))}</div>`;
      return `<table class="admin-table admin-project-table"><thead><tr>
        <th>${h(t('CWD'))}</th><th>${h(t('Display Name'))}</th><th>${h(t('Status'))}</th><th>${h(t('Active session limit'))}</th><th>${h(t('Work details'))}</th><th>${h(t('Action'))}</th>
        </tr></thead><tbody>${projects.map((project) => `<tr>
          <td data-label="${a(t('CWD'))}" data-i18n-skip>${h(project.cwd || project.id || '')}</td>
          <td data-label="${a(t('Display Name'))}" data-i18n-skip>${h(context.adminProjectVisibleName(project))}</td>
          <td data-label="${a(t('Status'))}"><span class="admin-status-badge" data-tone="${project.enabled === false ? 'muted' : 'success'}">${h(t(project.enabled === false ? 'Disabled' : 'Active'))}</span></td>
          <td data-label="${a(t('Active session limit'))}" data-i18n-skip>${h(String(project.activeSessionLimit ?? 30))}</td>
          <td data-label="${a(t('Work details'))}">${h(t(project.showWorkDetailsToMembers === false ? 'Admin only' : 'Members'))}</td>
          <td data-label="${a(t('Action'))}"><button class="ghost compact-button" type="button" data-admin-edit-project="${a(project.id || '')}">${h(t('Edit'))}</button></td>
        </tr>`).join('')}</tbody></table>`;
    }

    function renderUsers() {
      const users = state().admin.users;
      if (!users.length) return `<div class="meta">${h(t('No users configured.'))}</div>`;
      return users.map((user) => {
        const currentAccount = String(state().authSession?.principal?.userId || '') === String(user?.id || '');
        return `<article class="admin-row admin-user-row"><div class="admin-user-identity">
          <div class="admin-row-title-line"><span class="admin-row-main" data-i18n-skip>${h(user.username || user.id)}</span><span class="admin-status-badge" data-tone="${user.enabled === false ? 'muted' : 'success'}">${h(t(user.enabled === false ? 'Disabled' : 'Active'))}</span>${currentAccount ? `<span class="admin-status-badge">${h(t('Current account'))}</span>` : ''}</div>
          <span class="admin-row-meta" data-i18n-skip>${h(context.adminUserMeta(user))}</span></div>
          <div class="admin-user-action-row"><button class="ghost compact-button" type="button" data-admin-edit-user="${a(user.id || '')}">${h(t('Edit'))}</button><button class="ghost compact-button" type="button" data-admin-toggle-user-id="${a(user.id || '')}" data-admin-toggle-user-enabled="${user.enabled === false ? 'true' : 'false'}"${currentAccount ? ' disabled' : ''}>${h(t(user.enabled === false ? 'Enable' : 'Disable'))}</button><button class="danger compact-button" type="button" data-admin-delete-user-id="${a(user.id || '')}"${currentAccount ? ' disabled' : ''}>${h(t('Delete'))}</button></div>
        </article>`;
      }).join('');
    }

    function renderRoles() {
      const roles = state().admin.roles;
      if (!roles.length) return `<div class="meta">${h(t('No roles configured.'))}</div>`;
      return roles.map((role) => {
        const projectNames = context.adminRoleProjectIds(role).map((projectId) => context.adminProjectNameById(projectId, projectId));
        return `<article class="admin-row admin-role-row"><div><div class="admin-row-title-line"><span class="admin-row-main" data-i18n-skip>${h(role.name || role.id)}</span>${role.isAdmin ? `<span class="admin-status-badge">${h(t('admin'))}</span>` : ''}</div><span class="admin-row-meta" data-i18n-skip>${h(role.id || '')}</span>${projectNames.length ? `<span class="admin-role-projects" data-i18n-skip>${h(projectNames.join(' · '))}</span>` : ''}</div><button class="ghost compact-button" type="button" data-admin-edit-role="${a(role.id || '')}">${h(t('Edit'))}</button></article>`;
      }).join('');
    }

    function renderSessions() {
      if (!state().admin.sessions.length) return `<div class="meta">${h(t('No sessions found.'))}</div>`;
      return context.sortedAdminSessions().map((session) => {
        const owner = context.adminUserName(session.ownerUserId || session.userId);
        const modeLabel = session.archived === true ? t('Read only') : t('Observer Mode');
        const summary = String(session.summary || '').trim();
        const selected = String(state().admin.observedSession?.id || '') === String(session.id || '');
        const updatedAt = String(session.updatedAt || session.createdAt || '');
        const timestamp = context.formatShortDateTime(updatedAt);
        return `<article class="admin-row admin-session-row" data-selected="${String(selected)}"><button class="admin-session-open" type="button" data-admin-session-id="${a(session.id)}" aria-pressed="${String(selected)}"><span class="admin-row-title-line"><span class="admin-row-main" data-i18n-skip>${h(context.adminProjectNameById(session.projectId, session.projectDisplayName))}</span><span class="admin-status-badge" data-tone="${session.archived === true ? 'muted' : 'success'}">${h(modeLabel)}</span></span><span class="admin-session-summary${summary ? '' : ' is-empty'}"${summary ? ' data-i18n-skip' : ''}>${h(summary || t('No prompt preview'))}</span><span class="admin-session-footer"><span class="admin-row-meta" data-i18n-skip title="${a(session.id)}">${h(`${owner} · ${context.shorten(session.id, 18)}`)}</span>${timestamp ? `<time class="admin-row-meta" datetime="${a(updatedAt)}" data-i18n-skip>${h(timestamp)}</time>` : ''}</span></button></article>`;
      }).join('');
    }

    function renderProjectPage() {
      const admin = state().admin;
      return `<section class="admin-management-page">${renderPageHeading('Project Management', admin.projects.length, 'projects')}<div class="admin-management-grid"><section class="admin-editor-panel"><h3>${h(t(context.adminEditingProject() ? 'Edit Project' : 'Add Project'))}</h3>${renderProjectForm()}</section><section class="admin-collection-panel"><div class="admin-section-heading"><h3>${h(t('Configured Projects'))}</h3><span class="admin-section-count" data-i18n-skip>${h(t('{count} projects', { count: admin.projects.length }))}</span></div><div class="admin-list" data-i18n-skip>${renderProjects()}</div></section></div></section>`;
    }

    function renderRolePage() {
      const admin = state().admin;
      return `<section class="admin-management-page">${renderPageHeading('Role Management', admin.roles.length, 'roles')}<div class="admin-management-grid"><section class="admin-editor-panel"><h3>${h(t(context.adminEditingRole() ? 'Edit Role' : 'Add Role'))}</h3>${renderRoleForm()}</section><section class="admin-collection-panel"><div class="admin-section-heading"><h3>${h(t('Configured Roles'))}</h3><span class="admin-section-count" data-i18n-skip>${h(t('{count} roles', { count: admin.roles.length }))}</span></div><div class="admin-list" data-i18n-skip>${renderRoles()}</div></section></div></section>`;
    }

    function renderUserPage() {
      const admin = state().admin;
      return `<section class="admin-management-page">${renderPageHeading('User Management', admin.users.length, 'users')}<div class="admin-management-grid"><section class="admin-editor-panel"><h3>${h(t(context.adminEditingUser() ? 'Edit User' : 'Add User'))}</h3>${renderUserForm()}</section><section class="admin-collection-panel"><div class="admin-section-heading"><h3>${h(t('Team Members'))}</h3><span class="admin-section-count" data-i18n-skip>${h(t('{count} users', { count: admin.users.length }))}</span></div><div class="admin-list" data-i18n-skip>${renderUsers()}</div></section></div></section>`;
    }

    function renderAuditPage() {
      const admin = state().admin;
      const hasFilters = Boolean(admin.filterUserId || admin.filterProjectId || admin.filterState !== 'all');
      return `<section class="admin-audit-page"><div class="admin-audit-heading">${renderPageHeading('Session Audit', admin.sessions.length, 'sessions')}<div class="admin-heading-actions">${hasFilters ? `<button class="ghost compact-button" type="button" id="admin-session-clear-filters">${h(t('Clear filters'))}</button>` : ''}<button class="ghost compact-button" type="button" id="admin-session-refresh"${admin.loading ? ' disabled' : ''}>${h(t('Refresh'))}</button></div></div>
        <div class="admin-filter-row" aria-label="Session filters">
          <label class="field" for="admin-session-user-filter"><span>${h(t('User'))}</span><select id="admin-session-user-filter" name="adminUserFilter" data-i18n-skip${admin.loading ? ' disabled' : ''}><option value="">${h(t('All users'))}</option>${admin.users.map((user) => `<option value="${a(user.id)}"${admin.filterUserId === user.id ? ' selected' : ''} data-i18n-skip>${h(user.username || user.id)}</option>`).join('')}</select></label>
          <label class="field" for="admin-session-project-filter"><span>${h(t('Project'))}</span><select id="admin-session-project-filter" name="adminProjectFilter" data-i18n-skip${admin.loading ? ' disabled' : ''}><option value="">${h(t('All projects'))}</option>${context.adminAuditProjects().map((project) => `<option value="${a(project.id)}"${admin.filterProjectId === project.id ? ' selected' : ''} data-i18n-skip>${h(context.projectVisibleName(project, project.id))}</option>`).join('')}</select></label>
          <label class="field" for="admin-session-state-filter"><span>${h(t('Session'))}</span><select id="admin-session-state-filter" name="adminSessionStateFilter" data-i18n-skip${admin.loading ? ' disabled' : ''}><option value="all"${admin.filterState === 'all' ? ' selected' : ''}>${h(t('All Sessions'))}</option><option value="active"${admin.filterState === 'active' ? ' selected' : ''}>${h(t('Active sessions'))}</option><option value="archived"${admin.filterState === 'archived' ? ' selected' : ''}>${h(t('Archived sessions'))}</option></select></label>
        </div>${admin.loading ? `<div class="admin-inline-status" role="status">${h(t('Refreshing'))}</div>` : ''}<div class="admin-list admin-session-list" data-i18n-skip>${renderSessions()}</div></section>`;
    }

    function renderContent() {
      const admin = state().admin;
      if (admin.loading && !admin.loaded) return '<div class="empty-state admin-loading-state" role="status">Loading admin console...</div>';
      const page = context.currentAdminPage();
      if (page === 'roles') return renderRolePage();
      if (page === 'users') return renderUserPage();
      if (page === 'sessions') return renderAuditPage();
      return renderProjectPage();
    }

    function renderObservedPanel() {
      const admin = state().admin;
      if (context.currentAdminPage() !== 'sessions' || !context.isDesktopLayout()) return '';
      if (admin.observedSessionLoading) return `<section class="admin-observed-panel" aria-label="${a(t('Session detail'))}" aria-busy="true"><div class="empty-state">${h(t('Loading session'))}</div></section>`;
      if (!admin.observedSession) return `<section class="admin-observed-panel is-empty" aria-label="${a(t('Session detail'))}"><header class="admin-observed-placeholder-header"><strong>${h(t('Session detail'))}</strong><span class="admin-status-badge">${h(t('Read only'))}</span></header><div class="empty-state">${h(t('No session selected'))}</div></section>`;
      return `<section class="admin-observed-panel" aria-label="${a(t('Session detail'))}" data-i18n-skip>${context.renderChatContent({ desktop: true })}</section>`;
    }

    function renderSections() {
      const page = context.currentAdminPage();
      return `<div class="admin-layout" data-admin-current-page="${a(page)}" aria-busy="${String(state().admin.loading)}"><aside class="admin-navigation">${context.renderAdminSettingsSection()}${renderSidebar()}</aside><section class="admin-content" aria-live="polite">${renderContent()}</section>${renderObservedPanel()}</div>`;
    }

    function renderAdminConsole() {
      const shell = context.document.createElement('div');
      shell.className = 'shell';
      shell.innerHTML = `<div class="screen page-screen admin-console-screen">${context.renderPageNav('Admin Console')}<main class="admin-console-page">${renderSections()}</main></div>`;
      return context.localizeElement(shell);
    }

    return Object.freeze({ renderAdminConsole });
  }

  globalObject.CodexWebAdminUi = Object.freeze({ createRenderer });
})(globalThis);
