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
        system: '<path d="M5 5h14v10H5zM8 20h8M12 15v5"/>',
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
        ['system', 'System'],
      ];
      return `<label class="field admin-mobile-navigation"><span>${h(t('Admin sections'))}</span><select id="admin-page-select">${pages.map(([id, label]) => `<option value="${a(id)}"${id === currentPage ? ' selected' : ''}>${h(t(label))}</option>`).join('')}</select></label><nav class="admin-sidebar" aria-label="Admin sections">${pages.map(([id, label]) => `
        <button class="admin-sidebar-button" type="button" data-admin-page="${a(id)}" aria-pressed="${String(currentPage === id)}"${currentPage === id ? ' aria-current="page"' : ''}>
          ${renderNavIcon(id)}<span>${h(t(label))}</span><span class="admin-nav-count"${id === 'system' ? ' hidden' : ''} data-i18n-skip>${id === 'system' ? '' : h(context.resources.get(id).loaded ? String(pageItemCount(id)) : '—')}</span>
        </button>`).join('')}</nav>`;
    }

    function renderPageHeading(title, count, countName) {
      return `<header class="admin-page-heading"><h2>${h(t(title))}</h2><span class="admin-page-count" data-i18n-skip>${h(t(`{count} ${countName}`, { count }))}</span></header>`;
    }

    function editorForm(kind, entity, draft, fields, label) {
      const id = entity?.id || '';
      const dependency = kind === 'user' ? context.resources.get('roles') : kind === 'role' ? context.resources.get('projects') : null;
      const unavailable = dependency?.key && !dependency.loaded;
      return `<form class="admin-form" id="admin-${kind}-form" data-admin-editor="${kind}" data-entity-id="${a(id)}" data-reconcile-key="${a(`${kind}:${id || 'new'}`)}" aria-busy="${String(draft.saving)}"${draft.error ? ` aria-describedby="admin-${kind}-error"` : ''}>
        <fieldset class="admin-editor-fields"${draft.saving || unavailable ? ' disabled' : ''}>${fields}
          <div class="admin-form-actions"><button class="primary compact-button" type="submit">${h(t(draft.saving ? 'Saving...' : label))}</button><button class="ghost compact-button" type="button" id="admin-${kind}-edit-cancel">${h(t('Cancel'))}</button></div>
        </fieldset>${draft.error ? `<div class="admin-editor-error" id="admin-${kind}-error" role="alert" tabindex="-1" data-i18n-skip>${h(draft.error)}</div>` : ''}
      </form>`;
    }

    function renderProjectForm() {
      const entity = context.adminEditingProject();
      const draft = context.editors.get('project', entity?.id || '', {
        displayName: entity?.displayName || '', cwd: entity?.cwd || '', activeSessionLimit: entity?.activeSessionLimit ?? '',
        enabled: entity?.enabled !== false, showWorkDetailsToMembers: entity?.showWorkDetailsToMembers !== false,
      });
      const project = draft.values;
      return editorForm('project', entity, draft, `
          <div class="admin-form-grid">
            <label class="field"><span>Display Name</span><input name="displayName" autocomplete="off" placeholder="auto from CWD" value="${a(project.displayName)}"></label>
            <label class="field"><span>CWD</span><input name="cwd" autocomplete="off" placeholder="/Users/name/repo" value="${a(project.cwd)}" required></label>
            <label class="field"><span>Active sessions</span><input name="activeSessionLimit" type="number" min="1" step="1" inputmode="numeric" placeholder="30" value="${a(String(project.activeSessionLimit))}"></label>
          </div>
          <label class="admin-check-row"><input name="enabled" type="checkbox"${project.enabled ? ' checked' : ''}><span>Enabled</span></label>
          <label class="admin-check-row"><input name="showWorkDetailsToMembers" type="checkbox"${project.showWorkDetailsToMembers ? ' checked' : ''}><span>Members can view work details</span></label>`, 'Save Project');
    }

    function renderProjectCheckboxes(selectedProjectIds = [], { name = 'projectIds', legend = 'Projects' } = {}) {
      const projects = state().admin.projects;
      if (!projects.length) return `<div class="meta">${h(t('No projects available.'))}</div>`;
      const selected = new Set(selectedProjectIds);
      return `<fieldset class="admin-fieldset"><legend>${h(t(legend))}</legend>${projects.map((project) => `
        <label class="admin-check-row"><input name="${a(name)}" type="checkbox" value="${a(project.id)}"${selected.has(project.id) ? ' checked' : ''}><span data-i18n-skip>${h(context.adminProjectVisibleName(project))}</span></label>`).join('')}</fieldset>`;
    }

    function renderRoleForm() {
      const entity = context.adminEditingRole();
      const draft = context.editors.get('role', entity?.id || '', { id: entity?.id || '', name: entity?.name || '', projectIds: context.adminRoleProjectIds(entity) });
      const role = draft.values;
      return editorForm('role', entity, draft, `
          <div class="admin-form-grid">
            <label class="field"><span>Role ID</span><input name="id" autocomplete="off" placeholder="role_writer" value="${a(role.id)}" required${entity ? ' readonly' : ''}></label>
            <label class="field"><span>Name</span><input name="name" autocomplete="off" placeholder="Writer" value="${a(role.name)}" required></label>
          </div>
          ${renderProjectCheckboxes(role.projectIds)}`, 'Save Role');
    }

    function renderRoleSelect({ id = 'admin-user-role-select', name = 'roleId', value = '' } = {}) {
      const roles = state().admin.roles;
      if (!roles.length) return `<select id="${a(id)}" name="${a(name)}" data-i18n-skip><option value="">${h(t('No roles available'))}</option></select>`;
      const selectedValue = String(value || '');
      return `<select id="${a(id)}" name="${a(name)}" data-i18n-skip><option value=""${selectedValue ? '' : ' selected'}>${h(t('No role'))}</option>${roles.map((role) => `<option value="${a(role.id)}"${role.id === selectedValue ? ' selected' : ''} data-i18n-skip>${h(role.name || role.id)}</option>`).join('')}</select>`;
    }

    function renderUserForm() {
      const entity = context.adminEditingUser();
      const draft = context.editors.get('user', entity?.id || '', { username: entity?.username || '', email: entity?.email || '', password: '', enabled: entity?.enabled !== false, roleId: context.adminUserRoleId(entity) });
      const user = draft.values;
      return editorForm('user', entity, draft, `
          <div class="admin-form-grid">
            <label class="field"><span>Username</span><input name="username" autocomplete="username" placeholder="writer" value="${a(user.username)}" required${entity ? ' readonly' : ''}></label>
            <label class="field"><span>${h(t('Email'))}</span><input name="email" type="email" autocomplete="email" placeholder="writer@example.com" value="${a(user.email)}"></label>
            ${entity ? '' : `<label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" placeholder="At least 8 chars" minlength="8" value="${a(user.password)}" required></label>`}
          </div>
          <label class="admin-check-row"><input name="enabled" type="checkbox"${user.enabled ? ' checked' : ''}><span>Enabled</span></label>
          <label class="field"><span>Role</span>${renderRoleSelect({ value: user.roleId })}</label>`, entity ? 'Save' : 'Save User');
    }

    function renderProjects() {
      const projects = state().admin.projects;
      if (!projects.length) return `<div class="meta">${h(t('No projects configured.'))}</div>`;
      return projects.map(project => `<article class="admin-row admin-project-row"><div class="admin-record-content">
        <div class="admin-row-title-line"><span class="admin-row-main" data-i18n-skip>${h(context.adminProjectVisibleName(project))}</span><span class="admin-status-badge" data-tone="${project.enabled === false ? 'muted' : 'success'}">${h(t(project.enabled === false ? 'Disabled' : 'Active'))}</span></div>
        <span class="admin-record-path" data-i18n-skip>${h(project.cwd || project.id || '')}</span>
        <dl class="admin-record-facts"><div><dt>${h(t('Active session limit'))}</dt><dd>${h(String(project.activeSessionLimit ?? 30))}</dd></div><div><dt>${h(t('Work details'))}</dt><dd>${h(t(project.showWorkDetailsToMembers === false ? 'Admin only' : 'Members'))}</dd></div></dl>
        </div><button class="ghost compact-button" type="button" data-admin-edit-project="${a(project.id || '')}">${h(t('Edit'))}</button></article>`).join('');
    }

    function renderUsers() {
      const users = state().admin.users;
      if (!users.length) return `<div class="meta">${h(t('No users configured.'))}</div>`;
      return users.map((user) => {
        const role = state().admin.roles.find(item => item.id === context.adminUserRoleId(user));
        const currentAccount = String(state().authSession?.principal?.userId || '') === String(user?.id || '');
        const draft = context.editors.get('user', user.id, { username: user.username || '', email: user.email || '', password: '', enabled: user.enabled !== false, roleId: context.adminUserRoleId(user) });
        return `<article class="admin-row admin-user-row"><div class="admin-user-identity">
          <div class="admin-row-title-line"><span class="admin-row-main" data-i18n-skip>${h(user.username || user.id)}</span><span class="admin-status-badge" data-tone="${user.enabled === false ? 'muted' : 'success'}">${h(t(user.enabled === false ? 'Disabled' : 'Active'))}</span>${currentAccount ? `<span class="admin-status-badge">${h(t('Current account'))}</span>` : ''}</div>
          <span class="admin-row-meta" data-i18n-skip>${h(user.email || '')}</span><span class="admin-role-projects">${h(t('Role'))}: <span data-i18n-skip>${h(role?.name || role?.id || context.adminUserRoleId(user) || t('No role'))}</span></span><details class="admin-record-identifiers"><summary>${h(t('Account details'))}</summary><span data-i18n-skip>${h(user.id || '')}<br>${h(context.adminUserRoleId(user) || '')}</span></details></div>
          <div class="admin-user-action-row"><button class="ghost compact-button" type="button" data-admin-edit-user="${a(user.id || '')}">${h(t('Edit'))}</button><details class="admin-row-more"><summary>${h(t('More'))}</summary><div class="admin-row-secondary"><button class="ghost compact-button" type="button" data-admin-toggle-user-id="${a(user.id || '')}" data-admin-toggle-user-enabled="${user.enabled === false ? 'true' : 'false'}"${currentAccount || draft.saving ? ' disabled' : ''}>${h(t(draft.saving ? 'Saving...' : user.enabled === false ? 'Enable' : 'Disable'))}</button><button class="danger compact-button" type="button" data-admin-delete-user-id="${a(user.id || '')}"${currentAccount || draft.saving ? ' disabled' : ''}>${h(t('Delete'))}</button></div></details></div>
          ${draft.error ? `<div class="admin-editor-error" role="alert" data-i18n-skip>${h(draft.error)}</div>` : ''}
        </article>`;
      }).join('');
    }

    function renderRoles() {
      const roles = state().admin.roles;
      if (!roles.length) return `<div class="meta">${h(t('No roles configured.'))}</div>`;
      return roles.map((role) => {
        const projectNames = context.adminRoleProjectIds(role).map((projectId) => {
          const grant = role.projectGrants?.find(item => item.projectId === projectId);
          const permissions = [[grant?.canRead, 'Read'], [grant?.canCreate, 'Create sessions'], [grant?.canWrite, 'Write']].filter(([enabled]) => enabled).map(([, label]) => t(label));
          return { name: context.adminProjectNameById(projectId, projectId), permissions };
        });
        return `<article class="admin-row admin-role-row"><div><div class="admin-row-title-line"><span class="admin-row-main" data-i18n-skip>${h(role.name || role.id)}</span>${role.isAdmin ? `<span class="admin-status-badge">${h(t('admin'))}</span>` : ''}</div><span class="admin-row-meta" data-i18n-skip>${h(role.id || '')}</span><span class="admin-role-projects">${h(t(role.isAdmin ? 'Administrative access' : 'Project access'))}</span>${projectNames.length ? `<ul class="admin-project-access">${projectNames.map(name => `<li data-i18n-skip>${h(name.name)}${name.permissions.length ? ` <span class="admin-row-meta">(${h(name.permissions.join(', '))})</span>` : ''}</li>`).join('')}</ul>` : role.isAdmin ? '' : `<span class="admin-row-meta">${h(t('No projects assigned'))}</span>`}</div><button class="ghost compact-button" type="button" data-admin-edit-role="${a(role.id || '')}">${h(t('Edit'))}</button></article>`;
      }).join('');
    }

    function renderSessions() {
      if (!state().admin.sessions.length) return `<div class="meta">${h(t('No sessions found.'))}</div>`;
      return context.sortedAdminSessions().slice((state().admin.sessionsPage || 0) * 30, ((state().admin.sessionsPage || 0) + 1) * 30).map((session) => {
        const owner = context.adminUserName(session.ownerUserId || session.userId);
        const modeLabel = session.archived === true ? t('Read only') : t('Observer Mode');
        const summary = String(session.summary || '').trim();
        const selected = String(state().admin.observedSession?.id || '') === String(session.id || '');
        const updatedAt = String(session.updatedAt || session.createdAt || '');
        const timestamp = context.formatShortDateTime(updatedAt);
        return `<article class="admin-row admin-session-row" data-selected="${String(selected)}"><button class="admin-session-open" type="button" data-admin-session-id="${a(session.id)}" aria-pressed="${String(selected)}"><span class="admin-row-title-line"><span class="admin-row-main" data-i18n-skip>${h(context.sessionDisplayTitle({ ...session, firstUserInput: session.summary }))}</span><span class="admin-status-badge" data-tone="${session.archived === true ? 'muted' : 'success'}">${h(modeLabel)}</span></span><span class="admin-session-summary${summary ? '' : ' is-empty'}"${summary ? ' data-i18n-skip' : ''}>${h(summary || t('No prompt preview'))}</span><span class="admin-session-footer"><span class="admin-row-meta" data-i18n-skip title="${a(session.id)}">${h(`${owner} · ${context.adminProjectNameById(session.projectId, session.projectDisplayName)}`)}</span>${timestamp ? `<time class="admin-row-meta" datetime="${a(updatedAt)}" data-i18n-skip>${h(timestamp)}</time>` : ''}</span></button></article>`;
      }).join('');
    }

    function resourceFeedback(name) {
      const info = context.resources.get(name);
      if (info.error) return `<div class="admin-resource-error" role="alert"><span>${h(t('Could not load {resource}.', { resource: t({ projects: 'Projects', roles: 'Roles', users: 'Users', settings: 'System', sessions: 'Sessions', metrics: 'Service metrics', version: 'Build', devices: 'Signed-in devices' }[name]) }))} <span data-i18n-skip>${h(info.error)}</span></span><button class="ghost compact-button" type="button" data-admin-retry="${name}">${h(t('Retry'))}</button></div>`;
      return info.loading ? `<div class="admin-inline-status" role="status">${h(t(info.loaded ? 'Refreshing' : 'Loading...'))}</div>` : '';
    }

    function renderManagementPage(kind, title, collection, entity, form, records) {
      const admin = state().admin, name = `${kind}s`, info = context.resources.get(name);
      const isOpen = admin.editorKind === kind || Boolean(entity);
      return `<section class="admin-management-page"><div class="admin-audit-heading">${renderPageHeading(title, info.key && !info.loaded ? '—' : admin[name].length, name)}${isOpen ? '' : `<button class="primary compact-button" type="button" data-admin-add="${kind}">${h(t(`Add ${kind[0].toUpperCase()}${kind.slice(1)}`))}</button>`}</div>
        ${resourceFeedback(name)}<div class="admin-management-grid${isOpen ? ' has-editor' : ''}">
          <section class="admin-collection-panel"><div class="admin-section-heading"><h3>${h(t(collection))}</h3></div><div class="admin-list" data-i18n-skip>${info.key && !info.loaded ? '' : records()}</div></section>
          ${isOpen ? `<section class="admin-editor-panel"><h3>${h(t(`${entity ? 'Edit' : 'Add'} ${kind[0].toUpperCase()}${kind.slice(1)}`))}</h3>${form()}</section>` : ''}
        </div></section>`;
    }

    function renderProjectPage() { return renderManagementPage('project', 'Project Management', 'Configured Projects', context.adminEditingProject(), renderProjectForm, renderProjects); }
    function renderRolePage() { return `${resourceFeedback('projects')}${renderManagementPage('role', 'Role Management', 'Configured Roles', context.adminEditingRole(), renderRoleForm, renderRoles)}`; }
    function renderUserPage() { return `${resourceFeedback('roles')}${renderManagementPage('user', 'User Management', 'Team Members', context.adminEditingUser(), renderUserForm, renderUsers)}`; }

    function renderAuditPage() {
      const admin = state().admin;
      const hasFilters = Boolean(admin.filterUserId || admin.filterProjectId || admin.filterState !== 'all');
      return `<section class="admin-audit-page"><div class="admin-audit-heading">${renderPageHeading('Session Audit', admin.sessions.length, 'sessions')}<div class="admin-heading-actions">${hasFilters ? `<button class="ghost compact-button" type="button" id="admin-session-clear-filters">${h(t('Clear filters'))}</button>` : ''}<button class="ghost compact-button" type="button" id="admin-session-refresh"${admin.loading ? ' disabled' : ''}>${h(t('Refresh'))}</button></div></div>
        <div class="admin-filter-row" aria-label="Session filters">
          <label class="field" for="admin-session-user-filter"><span>${h(t('User'))}</span><select id="admin-session-user-filter" name="adminUserFilter" data-i18n-skip${admin.loading ? ' disabled' : ''}><option value="">${h(t('All users'))}</option>${admin.users.map((user) => `<option value="${a(user.id)}"${admin.filterUserId === user.id ? ' selected' : ''} data-i18n-skip>${h(user.username || user.id)}</option>`).join('')}</select></label>
          <label class="field" for="admin-session-project-filter"><span>${h(t('Project'))}</span><select id="admin-session-project-filter" name="adminProjectFilter" data-i18n-skip${admin.loading ? ' disabled' : ''}><option value="">${h(t('All projects'))}</option>${context.adminAuditProjects().map((project) => `<option value="${a(project.id)}"${admin.filterProjectId === project.id ? ' selected' : ''} data-i18n-skip>${h(context.projectVisibleName(project, project.id))}</option>`).join('')}</select></label>
          <label class="field" for="admin-session-state-filter"><span>${h(t('Session'))}</span><select id="admin-session-state-filter" name="adminSessionStateFilter" data-i18n-skip${admin.loading ? ' disabled' : ''}><option value="all"${admin.filterState === 'all' ? ' selected' : ''}>${h(t('All Sessions'))}</option><option value="active"${admin.filterState === 'active' ? ' selected' : ''}>${h(t('Active sessions'))}</option><option value="archived"${admin.filterState === 'archived' ? ' selected' : ''}>${h(t('Archived sessions'))}</option></select></label>
        </div>${['sessions', 'users', 'projects'].map(resourceFeedback).join('')}${admin.observedSessionError ? `<div class="admin-resource-error" role="alert">${h(admin.observedSessionError)}</div>` : ''}<div class="admin-list admin-session-list" data-i18n-skip>${context.resources.get('sessions').key && !context.resources.get('sessions').loaded ? '' : renderSessions()}</div>${renderSessionPagination()}</section>`;
    }

    function renderSessionPagination() {
      const admin = state().admin, page = admin.sessionsPage || 0;
      const newer = (page + 1) * 30 < admin.sessions.length || admin.sessionsHasMore;
      if (!page && !newer) return '';
      return `<nav class="admin-pagination" aria-label="${a(t('Session pages'))}"><button class="ghost compact-button" type="button" data-admin-session-page="${page - 1}"${page === 0 || admin.loading ? ' disabled' : ''}>${h(t('Previous page'))}</button><span class="meta">${page + 1}</span><button class="ghost compact-button" type="button" data-admin-session-page="${page + 1}"${!newer || admin.loading ? ' disabled' : ''}>${h(t('Next page'))}</button></nav>`;
    }

    function renderContent() {
      const page = context.currentAdminPage();
      if (page === 'roles') return renderRolePage();
      if (page === 'users') return renderUserPage();
      if (page === 'sessions') return renderAuditPage();
      if (page === 'system') return renderSystemPage();
      return renderProjectPage();
    }

    function renderSystemPage() {
      const admin = state().admin, metrics = admin.metrics, http = metrics?.http, storage = metrics?.storage;
      const number = value => Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '—';
      const bytes = value => Number.isFinite(value) ? `${number(value / 1048576)} MiB` : '—';
      const row = (label, value) => `<div><dt>${h(t(label))}</dt><dd data-i18n-skip>${h(value)}</dd></div>`;
      const labels = { sessions: 'Sessions', status: 'Execution status', history: 'History', admin: 'Administration', upload: 'Uploads', report: 'Reports', files: 'File transfers', events: 'Event connection', auth: 'Authentication', api: 'Other API', static: 'Static files', health: 'Health checks', other: 'Other' };
      return `<section class="admin-system-page"><div class="admin-audit-heading"><h2>${h(t('System'))}</h2><button class="ghost compact-button" type="button" id="admin-system-refresh"${admin.loading ? ' disabled' : ''}>${h(t('Refresh'))}</button></div>
        ${['version', 'metrics', 'devices', 'settings'].map(resourceFeedback).join('')}
        <section class="admin-system-section"><h3>${h(t('Service overview'))}</h3><dl class="admin-system-facts">${row('Build', admin.version?.buildId || '—')}${row('Uptime', Number.isFinite(http?.uptimeSeconds) ? `${Math.floor(http.uptimeSeconds / 86400)}d ${Math.floor(http.uptimeSeconds % 86400 / 3600)}h ${Math.floor(http.uptimeSeconds % 3600 / 60)}m (${number(http.uptimeSeconds)} s)` : '—')}${row('API P95 (ms)', http?.samples ? number(http.requestP95Ms) : '—')}${row('Active event connections', number(http?.activeStreams))}${row('Stream recoveries / resets', http ? `${number(http.sseReplays)} / ${number(http.sseResets)}` : '—')}</dl></section><section class="admin-system-section"><h3>${h(t('Managed storage'))}</h3><dl class="admin-system-facts">${row('Managed storage limit', bytes(storage?.managedStorageMaxBytes))}${row('Project upload limit', bytes(storage?.projectUploadMaxBytes))}${row('Storage cleanup failures', number(storage?.backgroundFailures))}</dl></section>
        ${http?.routes ? `<section class="admin-system-section"><h3>${h(t('Service metrics'))}</h3><p class="meta">${h(t('P95 uses recent completed requests; event connections measure the handshake.'))}</p><div class="admin-metrics-scroll" role="region" aria-label="${h(t('Service metrics'))}" tabindex="0"><table class="admin-table"><thead><tr>${['Request type', 'Requests', 'Errors (5xx)', 'Client errors (4xx)', 'P95 (ms)'].map(label => `<th>${h(t(label))}</th>`).join('')}</tr></thead><tbody>${Object.entries(http.routes).map(([name, value]) => `<tr><td>${h(t(labels[name] || name))}</td><td>${number(value.requests)}</td><td>${number(value.errors)}</td><td>${number(value.clientErrors)}</td><td>${value.samples ? number(value.requestP95Ms) : '—'}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
        <section class="admin-system-section"><h3>${h(t('Signed-in devices'))}</h3><ul class="auth-devices">${(admin.devices || []).map(device => `<li><span data-i18n-skip>${h(device.deviceName || t('Device'))}${device.current ? ` · ${h(t('This device'))}` : ''}<small>${h(context.formatShortDateTime(device.lastSeenAt))}</small></span></li>`).join('')}</ul></section>
        ${context.renderAdminSettingsSection({ showLoadingNote: true })}
      </section>`;
    }

    function renderObservedPanel() {
      const admin = state().admin;
      if (context.currentAdminPage() !== 'sessions' || !context.isDesktopLayout()) return '';
      if (admin.observedSessionLoading) return `<section class="admin-observed-panel" aria-label="${a(t('Session detail'))}" aria-busy="true"><div class="empty-state">${h(t('Loading session'))}</div></section>`;
      if (!admin.observedSession) return `<section class="admin-observed-panel is-empty" aria-label="${a(t('Session detail'))}"><header class="admin-observed-placeholder-header"><strong>${h(t('Session detail'))}</strong><span class="admin-status-badge">${h(t('Read only'))}</span></header><div class="empty-state"><div><h3>${h(t('Choose a session to review'))}</h3><p>${h(t('View recorded messages and work details in read-only mode.'))}</p></div></div></section>`;
      return `<section class="admin-observed-panel" aria-label="${a(t('Session detail'))}" data-i18n-skip>${context.renderChatContent({ desktop: true })}</section>`;
    }

    function renderSections() {
      const page = context.currentAdminPage();
      return `<div class="admin-layout" data-admin-current-page="${a(page)}" aria-busy="${String(state().admin.loading)}"><aside class="admin-navigation">${renderSidebar()}</aside><section class="admin-content">${state().admin.notice ? `<div class="admin-inline-status" role="status">${h(state().admin.notice)}</div>` : ''}${renderContent()}</section>${renderObservedPanel()}</div>`;
    }

    function renderAdminConsole() {
      const shell = context.document.createElement('div');
      shell.className = 'shell';
      shell.innerHTML = context.localizeFragment(`<div class="screen page-screen admin-console-screen">${context.renderPageNav('Admin Console')}<main class="admin-console-page">${renderSections()}</main></div>`);
      return context.localizeElement(shell);
    }

    return Object.freeze({ renderAdminConsole });
  }

  function confirmAction({ title, description, confirmLabel, cancelLabel, valid = () => true }) {
    const document = globalObject.document;
    if (!valid() || document.querySelector('.admin-confirm-dialog')) return Promise.resolve(false);
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'admin-confirm-dialog';
      dialog.setAttribute('aria-labelledby', 'admin-confirm-title');
      dialog.setAttribute('aria-describedby', 'admin-confirm-description');
      const heading = document.createElement('h2'); heading.id = 'admin-confirm-title'; heading.textContent = title;
      const copy = document.createElement('p'); copy.id = 'admin-confirm-description'; copy.textContent = description;
      const actions = document.createElement('div'); actions.className = 'admin-form-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'ghost'; cancel.textContent = cancelLabel; cancel.autofocus = true;
      const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'danger'; confirm.textContent = confirmLabel;
      let settled = false;
      const finish = value => { if (settled) return; settled = true; observer.disconnect(); dialog.close(); dialog.remove(); resolve(value && valid()); };
      cancel.addEventListener('click', () => finish(false));
      confirm.addEventListener('click', () => finish(true));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
      dialog.addEventListener('keydown', event => event.stopPropagation());
      const observer = new MutationObserver(() => { if (!valid()) finish(false); });
      actions.append(cancel, confirm); dialog.append(heading, copy, actions); document.body.append(dialog);
      observer.observe(document.body, { childList: true, subtree: true });
      dialog.showModal(); cancel.focus();
    });
  }

  // Observer history uses the same cursor contract as ordinary sessions. This
  // module is lazy so the administrative reader adds no startup transport cost.
  async function loadObserverPage(apiFetch, id, { signal, first = false, anchors = [] } = {}) {
    const query = first ? '&after=0' : anchors.slice(0, 3).map(anchor => `&anchor=${encodeURIComponent(anchor.id)}`).join('');
    const payload = await apiFetch(`/api/admin/sessions/${encodeURIComponent(id)}/timeline?limit=50${query}`, { signal });
    if (!Array.isArray(payload?.items) || !payload.session) throw new Error('History could not be loaded. Retry to recover your messages.');
    return { ...payload, session: {
      ...payload.session, mode: 'observer', readOnly: true, timeline: payload.items,
      timelineComplete: payload.hasMore !== true, timelineNextBefore: payload.nextBefore ?? null,
      timelineHasNewer: payload.hasNewer === true, timelineNextAfter: payload.nextAfter ?? null,
    } };
  }

  async function refreshObserver(context, { viewportSnapshot = null, signal = null, latest = false } = {}) {
    const { state, SESSION_READING } = context;
    const sessionId = state.sessionId;
    if (!context.owns()) return null;
    const startedViewport = viewportSnapshot || context.captureTimelineViewport();
    try {
      const payload = await loadObserverPage(context.apiFetch, sessionId, {
        signal, anchors: !latest && !startedViewport.shouldFollowLatest ? startedViewport.anchors : [],
      });
      if (!context.owns() || latest && !SESSION_READING.isCurrent(startedViewport)) return null;
      const snapshot = SESSION_READING.isCurrent(startedViewport) ? startedViewport : context.captureTimelineViewport();
      const session = payload.session;
      // Input during a refresh wins: keep its loaded page if the response no
      // longer contains the currently visible reading anchors.
      if (!latest && !snapshot.shouldFollowLatest && snapshot.anchors.length
        && !snapshot.anchors.some(anchor => session.timeline.some(item => item.id === anchor.id))) {
        for (const key of ['timeline', 'timelineComplete', 'timelineNextBefore', 'timelineNextAfter', 'timelineHasNewer']) session[key] = state.currentSession[key];
      }
      state.sessionHistoryError = ''; state.sessionStatusError = '';
      state.admin.observedSession = session;
      state.currentSession = session;
      state.cwd = session.cwd || '';
      context.applySessionSettings(session);
      context.restoreTimelineForSession(session, { fullHistory: true });
      const runtimeStatus = context.syncRuntimeStatusFromSession(session);
      if (runtimeStatus.activeTurnId && state.turnId) context.restoreTurnEventCursor(sessionId, state.turnId, { onlyIfUnset: true });
      context.setTimelineOpenPositionForSession(session, snapshot);
      context.renderChatWithTimelineRestored(() => {});
      return session;
    } catch (error) {
      if (!context.owns()) return null;
      if ([401, 403].includes(error?.status)) context.handleApiError(error);
      else if (context.isMissingSessionError(error)) context.handleMissingSession(error, '');
      else if (error?.name !== 'AbortError') {
        state.sessionHistoryError = error?.message || 'Request failed';
        state.sessionStatusError = state.sessionHistoryError;
        context.renderChatWithTimelineRestored(() => {});
      }
      return null;
    }
  }

  let observerScrollIntent = '';
  function observerInput(event, sessionId) {
    const downward = event.type === 'wheel' ? event.deltaY > 0
      : event.type !== 'keydown' || ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key);
    observerScrollIntent = downward ? sessionId : '';
  }
  function observerScroll({ state, timeline, busy, moveTimelineWindow }) {
    if (observerScrollIntent !== state.sessionId || busy || state.sessionHistoryError
      || timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop > 120) return;
    // Consume once per user gesture. Restoring an anchor or a failed request
    // cannot recursively fetch the remainder of a large history.
    observerScrollIntent = '';
    moveTimelineWindow(1);
  }

  globalObject.CodexWebAdminUi = Object.freeze({ createRenderer, confirmAction, loadObserverPage, refreshObserver, observerInput, observerScroll });
})(globalThis);
