(function (root) {
  'use strict';

  // Keep option 2 aligned with buildV2CommandApprovalDecision: amendments take
  // precedence over session approval. The transport endpoint name is legacy.
  function actionsFor(item) {
    const summary = item.summary || {};
    const keys = Array.isArray(summary.availableDecisionKeys) ? summary.availableDecisionKeys : [];
    const actions = [];
    if (!summary.detailsIncomplete && (!keys.length || keys.includes('accept'))) actions.push({ action: 'accept', label: 'Allow once', tone: 'primary' });
    if (keys.includes('decline')) actions.push({ action: 'deny', label: 'Deny', tone: 'ghost' });
    else if (keys.includes('cancel')) actions.push({ action: 'deny', label: 'Cancel turn', tone: 'ghost' });
    if (summary.detailsIncomplete) return actions;
    if (item.approvalKind === 'command' && keys.includes('acceptWithExecpolicyAmendment') && summary.execPolicyAmendment?.length) {
      actions.push({ action: 'accept-for-session', label: 'Allow with command rule', scope: 'rule', tone: 'ghost' });
    } else if (keys.includes('acceptForSession')) {
      actions.push({ action: 'accept-for-session', label: 'Allow for this session', scope: 'session', tone: 'ghost' });
    }
    return actions;
  }

  function sanitizeSummary(summary, sanitize) {
    const result = sanitize(summary);
    if (!summary || typeof summary !== 'object') return result;
    // Retain existing bounds. A shortened command or scope must never look like
    // a complete request that can safely be approved from this view.
    const keys = ['command', 'reason', 'cwd', 'grantRoot', 'availableDecisionKeys', 'execPolicyAmendment', 'networkPermission', 'fileReadPermissions', 'fileWritePermissions', 'fileChanges'];
    if (summary.detailsIncomplete || keys.some(key => summary[key] != null && JSON.stringify(summary[key]) !== JSON.stringify(result[key]))) {
      // Place the marker first so the bounded object-key cache cannot evict it.
      delete result.detailsIncomplete;
      return { detailsIncomplete: true, ...result };
    }
    return result;
  }

  function render(item, { t, escapeHtml: e, escapeAttribute: a, sending = false }) {
    const summary = item.summary || {};
    const status = item.expired ? 'expired' : item.resolved ? 'resolved' : sending ? 'sending' : item.decisionUncertain ? 'uncertain' : 'pending';
    const decisionLabel = { accepted: 'Allowed', denied: 'Denied', accepted_for_session: 'Approval sent' }[summary.decision] || 'Approval resolved';
    const labels = { expired: 'Approval no longer available', resolved: decisionLabel, sending: 'Sending approval…', uncertain: 'Delivery unconfirmed', pending: 'Waiting for your decision' };
    const title = { command: 'Run a command', file_change: 'Change files', permissions: 'Grant permissions' }[item.approvalKind] || 'Approval requested';
    const button = action => `<button type="button" class="${action.tone}" data-approval-action="${a(action.action)}" data-approval-id="${a(item.approvalId)}" ${status !== 'pending' ? 'disabled' : ''}>${e(t(action.label))}</button>`;
    const code = (label, value) => value ? `<div class="approval-operation"><span class="approval-field-label">${e(t(label))}</span><pre tabindex="0" aria-label="${a(t(label))}" data-i18n-skip><code>${e(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}</code></pre></div>` : '';
    const field = (label, value) => value ? `<div class="approval-field"><span class="approval-field-label">${e(t(label))}</span><span data-i18n-skip>${e(value)}</span></div>` : '';
    const body = `${summary.reason ? `<p class="approval-reason" data-i18n-skip>${e(summary.reason)}</p>` : ''}
      ${code('Command', summary.command)}
      ${field('Working directory', summary.cwd)}
      ${field('Access root', summary.grantRoot)}
      ${summary.networkPermission != null ? field('Network access', t(summary.networkPermission ? 'Requested' : 'Not requested')) : ''}
      ${code('Read access', summary.fileReadPermissions?.length ? summary.fileReadPermissions : null)}
      ${code('Write access', summary.fileWritePermissions?.length ? summary.fileWritePermissions : null)}
      ${code('File changes', summary.fileChanges?.length ? summary.fileChanges : null)}`;
    const actions = actionsFor(item);
    const extended = actions.find(action => action.scope);
    const closed = status === 'resolved' || status === 'expired';
    return `<article class="approval-card is-${status}" aria-live="polite" aria-busy="${sending}">
      <header class="approval-heading"><h3>${e(t(title))}</h3><span class="approval-state" role="status">${e(t(labels[status]))}</span></header>
      ${closed ? `<details class="approval-review"><summary>${e(t('Review request'))}</summary>${body}${code('Command rule', summary.execPolicyAmendment?.length ? summary.execPolicyAmendment : null)}</details>` : body}
      ${status === 'uncertain' ? `<p class="approval-feedback" role="status">${e(t('Approval delivery is unconfirmed. Refresh the session before trying again.'))}</p>` : ''}
      ${summary.detailsIncomplete ? `<p class="approval-feedback" role="status">${e(t('Request details exceed the display limit. Approval is unavailable here.'))}</p>` : ''}
      ${!closed ? `<div class="approval-actions">${actions.filter(action => !action.scope).map(button).join('')}</div>
      ${extended ? `<div class="approval-scope">${extended.scope === 'rule' ? `${code('Command rule', summary.execPolicyAmendment)}<p>${e(t('This also approves the command rule shown above.'))}</p>` : `<p>${e(t('Allow matching requests for this session.'))}</p>`}${button(extended)}</div>` : ''}` : ''}
    </article>`;
  }

  root.CodexWebApprovalUi = { actionsFor, render, sanitizeSummary };
})(globalThis);
