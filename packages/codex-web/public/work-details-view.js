(function installWorkView(globalScope) {
  function formatTokenCount(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    const units = ['', 'K', 'M', 'B'];
    let index = 0, amount = value;
    while (amount >= 1000 && index < units.length - 1) { amount /= 1000; index++; }
    amount = Number(amount.toFixed(index ? 2 : 0));
    if (amount >= 1000 && index < units.length - 1) { amount /= 1000; index++; }
    return `${amount}${units[index]}`;
  }
  function createRenderer({ icon = () => '', loadTurnDiff, finiteWorkNumber, startCase, t: translate, escapeHtml, escapeAttribute, shorten, workDetailsForItem, workTurnStatus, WORK_DETAILS_EVENT_PAGE_SIZE, normalizeWorkFileChanges, primitiveWorkText, hasSummaryValue, MAX_TIMELINE_SUMMARY_TEXT }) {
    const localCopy = {"Assigned task": "下发的任务", "Task prompt unavailable": "未记录任务提示词", "Agent ID": "子代理 ID", "Last response": "最近一次响应", "Thread total": "会话累计", "Context window limit": "上下文窗口上限", "Input": "输入", "Output": "输出", "Cached input": "缓存命中", "Usage is not current context occupancy.": "累计用量不代表当前上下文占用。","Completed": "完成", "Interrupted": "已中断", "Pending": "待处理", "Turn diff": "本轮差异", "Load retained diff": "加载已保留差异", "Loading diff…": "正在加载差异…", "Only retained diff is available.": "仅显示已保留的差异。", "Diff is no longer available.": "差异已不可用。", "Could not load diff.": "差异加载失败。", "Run command": "运行命令", "Read file": "读取文件", "Modify files": "修改文件", "Use tool": "使用工具", "Activity log": "活动记录", "{count} activities": "已收到 {count} 条活动", "Activity": "活动", "View retained content": "查看已保留内容", "Back to preview": "返回预览", "Offline, showing last record": "离线，显示上次记录", "Last observed: {time}": "最后观测：{time}", "Plan: {done}/{total} steps": "计划：完成 {done}/{total} 步", "Agents ({count})": "子代理（{count}）", "Tool status": "工具状态", "Token usage": "Token 用量", "Last response: {count} tokens": "最近一次响应：{count} tokens", "Thread total: {count} tokens": "本会话累计：{count} tokens", "Some older activity was not retained.": "部分较早活动未被保留。", "Context window limit: {count} tokens": "上下文窗口上限：{count} tokens", "Current activity": "当前正在进行", "Latest activity": "最近一项活动", "Last activity": "最后一项活动", "Waiting for work activity": "等待工作动态", "{done} of {total} activities completed": "已完成 {done} / {total} 项活动", "{count} failed": "{count} 项失败", "Raw data": "原始数据", "Duration (ms)": "耗时（毫秒）", "Preview truncated.": "预览内容已截断。", "Show {count} earlier": "查看更早的 {count} 条", "{count} hidden": "已隐藏 {count} 条", "{count} new activity": "{count} 条新活动", "{count} new activities": "{count} 条新活动", "Read {count}": "读取 {count}", "Ran {count}": "执行 {count}", "Edited {count}": "修改 {count} 个文件", "Approval {count}": "审批 {count}", "Tool input": "工具输入", "Files changed": "修改的文件", "No tool activity yet.": "暂无工具活动。"};
    const t = (key, values = {}) => {
      const label = globalScope.document?.documentElement?.lang?.startsWith('zh') ? localCopy[key] : null;
      return label ? label.replace(/\{([^}]+)\}/gu, (_, name) => String(values[name] ?? `{${name}}`)) : translate(key, values);
    };
function formatWorkEventStatus(detail) {
  const exitCode = finiteWorkNumber(detail?.summary?.exitCode);
  if (exitCode !== null && exitCode !== 0) {
    return { label: t('Exit {code}', { code: exitCode }), tone: 'failed' };
  }
  const status = String(detail?.status || '').trim().toLowerCase();
  if (detail?.kind === 'approval' && ['accept', 'accept-for-session', 'deny', 'cancel'].includes(status)) {
    return { label: t(status === 'deny' || status === 'cancel' ? 'Declined' : 'Accepted'), tone: 'done' };
  }
  if (status === 'failed' || status === 'error' || hasSummaryValue(detail?.summary?.error)) {
    return { label: t('Failed'), tone: 'failed' };
  }
  if (!status || status === 'started' || status === 'running' || status === 'pending') {
    return { label: t('In progress'), tone: 'running' };
  }
  if (status === 'requested') {
    return { label: t('Requested'), tone: 'running' };
  }
  if (status === 'completed' || status === 'complete' || status === 'success' || status === 'succeeded' || status === 'resolved') {
    return { label: t('Done'), tone: 'done' };
  }
  return { label: startCase(status), tone: 'done' };
}

function formatWorkTextValue(value, seen = new Set()) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return '';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => formatWorkTextValue(entry, seen)).filter(Boolean).join('\n');
  }
  for (const key of ['text', 'delta', 'content', 'value', 'message', 'output']) {
    const text = formatWorkTextValue(value[key], seen);
    if (text) {
      return text;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function formatWorkFileAction(value) {
  const action = primitiveWorkText(value).toLowerCase();
  const label = {
    add: 'Added',
    added: 'Added',
    create: 'Added',
    created: 'Added',
    delete: 'Deleted',
    deleted: 'Deleted',
    remove: 'Deleted',
    removed: 'Deleted',
    update: 'Modified',
    updated: 'Modified',
    modify: 'Modified',
    modified: 'Modified',
  }[action] || (action ? startCase(action) : '');
  return label ? t(label) : '';
}

function formatWorkChangeStats(change) {
  const additions = finiteWorkNumber(change?.additions ?? change?.added ?? change?.linesAdded);
  const deletions = finiteWorkNumber(change?.deletions ?? change?.deleted ?? change?.linesDeleted);
  if (additions === null && deletions === null) {
    return '';
  }
  return `+${additions ?? 0} / -${deletions ?? 0}`;
}

function workKindLabel(kind) {
  return t({
    read: 'Read',
    command: 'Ran',
    edit: 'Edited',
    approval: 'Approval',
    tool: 'Tool',
  }[kind] || 'Tool');
}

    let currentDetails = new Map();
    const previewLimit = Math.min(MAX_TIMELINE_SUMMARY_TEXT, 1200);
    function activityLabel(detail) {
      return t({ command: 'Run command', read: 'Read file', edit: 'Modify files', tool: 'Use tool', approval: 'Approval' }[detail.kind] || workKindLabel(detail.kind));
    }
    function renderWorkItem(item, { visibleEventLimit = Infinity, visibleEndIndex = Infinity, activityState = null } = {}) {
      const allDetails = workDetailsForItem(item);
      currentDetails = new Map(allDetails.map(detail => [String(detail.id || ''), detail]));
      const endIndex = Math.min(allDetails.length, Math.max(0, visibleEndIndex));
      const startIndex = Math.max(0, endIndex - Math.max(1, visibleEventLimit));
      const details = allDetails.slice(startIndex, endIndex);
      const earlierCount = startIndex;
      const newerCount = allDetails.length - endIndex;
      const status = workTurnStatus(item);
      return `
        <section class="work-turn" data-work-turn-id="${escapeAttribute(item.turnId || '')}">
          <div class="work-overview"><header class="work-turn-header">
            <div class="work-turn-copy">
              ${renderProgress(allDetails, status, activityState)}

            </div>
          </header>
          ${renderActivityState(activityState, allDetails)}</div>
          ${details.length ? `
            <div class="work-history-heading"><span>${escapeHtml(t('Activity log'))}</span><span class="work-progress-count">${escapeHtml(t('{count} activities', { count: allDetails.length }))}</span></div>
            <div class="work-events">
              ${earlierCount ? `<div class="work-history-control"><button type="button" class="ghost compact-button" data-work-show-earlier>${escapeHtml(t('Show {count} earlier', { count: Math.min(WORK_DETAILS_EVENT_PAGE_SIZE, earlierCount) }))}</button><span>${escapeHtml(t('{count} hidden', { count: earlierCount }))}</span></div>` : ''}
              ${details.map(renderWorkDetail).join('')}
            </div>
          ` : `<p class="meta">${escapeHtml(t('No tool activity yet.'))}</p>`}
              ${newerCount ? `<div class="work-new-activity"><button type="button" class="ghost compact-button" data-work-show-latest>${escapeHtml(t(newerCount === 1 ? '{count} new activity' : '{count} new activities', { count: newerCount }))}</button></div>` : ''}
        </section>
      `;
    }

    function renderWorkDetail(detail) {
      const eventStatus = formatWorkEventStatus(detail);
      return `
        <details class="work-detail" data-work-kind="${escapeAttribute(detail.kind)}" data-work-event-id="${escapeAttribute(detail.id || '')}">
          <summary>
            <span class="work-event-icon" aria-hidden="true">${icon({ read: 'search', edit: 'file', approval: 'user', tool: 'settings' }[detail.kind] || 'sessions')}</span>
            <span class="work-event-copy"><span class="work-event-kind">${escapeHtml(activityLabel(detail))}</span>
            <span class="work-event-meta"><span class="work-event-title" data-i18n-skip>${escapeHtml(shorten(cleanText(detail.title).split('\n')[0], 160))}</span>
            ${eventStatus.label ? `<span class="work-event-status" data-tone="${escapeAttribute(eventStatus.tone)}" data-i18n-skip>${escapeHtml(eventStatus.label)}</span>` : ''}</span></span>
            <span class="work-detail-chevron" aria-hidden="true"></span>
          </summary>
          <div class="work-detail-body"></div>
        </details>
      `;
    }

    function renderWorkDetailBody(detail, full = false) {
      renderingFull = full;
      const summary = detail.summary || {};
      const title = renderWorkTextBlock('Activity', detail.title);
      const command = renderWorkTextBlock(detail.kind === 'tool' ? 'Tool input' : 'Command', summary.command || summary.input || summary.arguments || summary.code || (detail.kind === 'command' || detail.kind === 'read' ? detail.title : ''));
      const files = renderWorkFileChanges(detail.fileChanges || []);
      const diff = renderWorkTextBlock('Diff', summary.diff || summary.patch);
      const rows = renderWorkSummaryRows(summary);
      const output = renderWorkTextBlock('Output', summary.output ?? summary.stdout);
      const error = renderWorkTextBlock('Error', summary.error ?? summary.stderr);
      return [command || (files ? '' : title), files, diff, rows, output, error].filter(Boolean).join('');
    }

    function renderWorkSummaryRows(summary) {
      const excludedKeys = [
        'fileChanges', 'file_changes', 'changes', 'files',
        'output', 'stdout', 'stderr', 'diff', 'patch', 'raw',
        'command', 'title', 'name', 'status', 'exitCode',
        'path', 'file', 'target', 'source', 'input', 'arguments', 'code', 'error',
      ];
      const entries = Object.entries(summary || {})
        .filter(([key, value]) => !excludedKeys.includes(key) && hasSummaryValue(value));
      if (!entries.length) {
        return '';
      }
      const visible = entries.filter(([key, value]) => ['cwd', 'durationMs', 'reason', 'message'].includes(key) && typeof value !== 'object');
      const raw = entries.filter(entry => !visible.includes(entry));
      return `<div class="work-summary">${visible.map(([key, value]) => `
        <div class="work-row"><strong>${escapeHtml(t({ cwd: 'Directory', durationMs: 'Duration (ms)', reason: 'Reason', message: 'Message' }[key]))}</strong><span data-i18n-skip>${escapeHtml(shorten(cleanText(value), 800))}</span></div>
      `).join('')}</div>${raw.length ? `<details class="work-raw"><summary>${escapeHtml(t('Raw data'))}</summary>${renderWorkTextBlock('Details', Object.fromEntries(raw))}</details>` : ''}`;
    }

    function renderWorkFileChanges(changes) {
      const normalizedChanges = normalizeWorkFileChanges(changes);
      if (!normalizedChanges.length) {
        return '';
      }
      return `<div class="work-files">
        <strong class="work-section-label">${escapeHtml(t('Files changed'))}</strong>
        <div class="work-file-list">${normalizedChanges.map((change) => {
        const path = primitiveWorkText(change?.path);
        const action = formatWorkFileAction(change?.action || change?.type || change?.status);
        const stats = formatWorkChangeStats(change);
        return `
          <div class="work-file-change">
            <span class="work-file-path" data-i18n-skip>${escapeHtml(path)}</span>
            ${action ? `<span class="work-file-action" data-i18n-skip>${escapeHtml(action)}</span>` : ''}
            ${stats ? `<span class="work-file-stats">${escapeHtml(stats)}</span>` : ''}
          </div>
          ${change.diff ? renderWorkTextBlock('Diff', change.diff) : ''}
        `;
      }).join('')}</div>
      </div>`;
    }

    let renderingFull = false;
    function renderWorkTextBlock(label, value) {
      const text = cleanText(value);
      if (!text) {
        return '';
      }
      return `
        <div class="work-text-block">
          <strong class="work-section-label">${escapeHtml(t(label))}</strong>
          ${label === 'Diff' ? renderDiff(text, renderingFull ? text.length : previewLimit) : `<pre class="work-output" tabindex="0" role="region" aria-label="${escapeAttribute(t(label))}" data-i18n-skip>${escapeHtml(shorten(text, renderingFull ? text.length : previewLimit))}</pre>`}
          ${!renderingFull && text.length > previewLimit ? `<button type="button" class="ghost work-content-open" data-work-content-open>${escapeHtml(t('View retained content'))}</button>` : ''}
          ${!renderingFull && text.length > previewLimit ? `<span class="meta">${escapeHtml(t('Preview truncated.'))}</span>` : ''}
        </div>
      `;
    }

    function cleanText(value, depth = 0) {
      if (depth > 5) return '';
      if (typeof value === 'string') {
        const text = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '').trim();
        if (/^[{\[]/u.test(text)) {
          try { return cleanText(JSON.parse(text), depth + 1); } catch {}
        }
        return text;
      }
      if (Array.isArray(value)) return value.map(entry => cleanText(entry, depth + 1)).filter(Boolean).join('\n');
      if (value && typeof value === 'object') {
        for (const key of ['text', 'cmd', 'command', 'code', 'content', 'output', 'message']) {
          if (value[key] != null) return cleanText(value[key], depth + 1);
        }
      }
      return formatWorkTextValue(value);
    }

    function renderDiff(value, limit) {
      let oldLine = null;
      let newLine = null;
      const lines = shorten(value, limit).split('\n').map(line => {
        if (/^(?:diff |--- |\+\+\+ |\*\*\*)/u.test(line)) { oldLine = null; newLine = null; }
        const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
        if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); }
        const meta = hunk || /^(?:diff |index |--- |\+\+\+ |@@|\*\*\*|\\ No newline)/u.test(line);
        const kind = meta ? 'header' : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context';
        const oldNumber = !meta && kind !== 'added' && oldLine !== null ? oldLine++ : '';
        const newNumber = !meta && kind !== 'removed' && newLine !== null ? newLine++ : '';
        return `<div class="work-diff-line" data-change="${kind}"><span class="work-line-number" aria-hidden="true">${oldNumber}</span><span class="work-line-number" aria-hidden="true">${newNumber}</span><code>${escapeHtml(line || ' ')}</code></div>`;
      }).join('');
      return `<div class="work-diff" tabindex="0" role="region" aria-label="${escapeAttribute(t('Diff'))}" data-i18n-skip>${lines}</div>`;
    }

    function renderProgress(details, running, activity) {
      const failed = details.filter(detail => formatWorkEventStatus(detail).tone === 'failed').length;
      const active = running && (details.find(detail => detail.kind === 'approval' && formatWorkEventStatus(detail).tone === 'running')
        || [...details].reverse().find(detail => formatWorkEventStatus(detail).tone === 'running'));
      const latest = active || details.at(-1);
      const health = activity?.health?.status;
      const stateLabel = activity?.observation === 'disconnected' ? t('Offline, showing last record')
        : health === 'retrying' ? t('Model connection retrying')
        : health === 'failed' ? t('Failed')
        : activity?.compaction === 'running' ? t('Compacting context')
        : health === 'completed' ? t('Completed')
        : health === 'interrupted' ? t('Interrupted')
        : active ? activityLabel(active) : running || t('Last activity');
      return `<p class="work-progress-title" data-tone="${health === 'retrying' ? 'warning' : health === 'failed' ? 'failed' : ''}">${escapeHtml(stateLabel)}</p>
        <p class="work-progress-current" data-i18n-skip>${escapeHtml(latest ? cleanText(latest.title).split('\n')[0] : t('Waiting for work activity'))}</p>
        ${failed ? `<p class="work-progress-failed">${escapeHtml(t('{count} failed', { count: failed }))}</p>` : ''}`;
    }

    function observedTime(value) {
      return Number.isFinite(value) ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    }
    function renderActivityState(activity, details) {
      if (!activity) return '';
      const parts = [];
      if (activity.observation === 'disconnected' && activity.observedAt) parts.push(`<p class="meta">${escapeHtml(t('Last observed: {time}', { time: observedTime(activity.observedAt) }))}</p>`);
      if (activity.health?.lastError && ['retrying', 'failed'].includes(activity.health.status)) parts.push(`<p class="work-activity-error" data-tone="${activity.health.status === 'retrying' ? 'warning' : 'failed'}" data-i18n-skip>${escapeHtml(activity.health.lastError)}</p>`);
      const section = (key, label, body) => `<details class="work-supplement" data-work-section="${key}"><summary>${escapeHtml(label)}</summary><div class="work-supplement-body">${body}</div></details>`;
      if (activity.plan?.steps?.length) {
        const steps = activity.plan.steps;
        parts.push(section('plan', t('Plan: {done}/{total} steps', { done: steps.filter(step => step.status === 'completed').length, total: steps.length }),
          `${activity.plan.explanation ? `<p data-i18n-skip>${escapeHtml(activity.plan.explanation)}</p>` : ''}<ol class="work-plan">${steps.map(step => `<li><span data-i18n-skip>${escapeHtml(step.step)}</span><span class="work-event-status">${escapeHtml(t({ completed: 'Completed', inProgress: 'In progress', in_progress: 'In progress', pending: 'Pending' }[step.status] || step.status))}</span></li>`).join('')}</ol>`));
      }
      if (activity.agents?.length) parts.push(section('agents', t('Agents ({count})', { count: activity.agents.length }), activity.agents.map(agent => {
        const status = { running: 'In progress', completed: 'Completed', errored: 'Failed', shutdown: 'Completed', pendingInit: 'Pending', unknown: 'Unknown' }[agent.status] || agent.status;
        return `<article class="work-agent" data-work-agent="${escapeAttribute(agent.threadId)}"><div class="work-agent-heading"><span class="work-agent-label">${escapeHtml(t('Assigned task'))}</span><span class="work-agent-status">${escapeHtml(t(status))}</span></div>
          <p class="work-agent-prompt" data-i18n-skip>${escapeHtml(agent.prompt || t('Task prompt unavailable'))}</p>
          ${agent.message ? `<p class="work-agent-result" data-i18n-skip>${escapeHtml(agent.message)}</p>` : ''}
          <details class="work-agent-meta"><summary>${escapeHtml(t('Agent ID'))}</summary><span data-i18n-skip>${escapeHtml(agent.threadId)}</span><small>${escapeHtml(t('Last observed: {time}', { time: observedTime(agent.observedAt) }))}</small></details></article>`;
      }).join('')));
      const tools = (activity.tools || []).filter(tool => !details.some(detail => detail.id === tool.itemId));
      if (tools.length) parts.push(section('tools', t('Tool status'), tools.map(tool => `<div class="work-row"><span data-i18n-skip>${escapeHtml(tool.title)}</span><span>${escapeHtml(t(tool.status))}</span></div>`).join('')));
      if (activity.diff?.available && loadTurnDiff) parts.push(section('diff', t('Turn diff'), `<button type="button" class="ghost" data-work-load-diff>${escapeHtml(t('Load retained diff'))}</button>`));
      if (activity.tokenUsage) {
        const usage = activity.tokenUsage;
        const metric = (label, count) => `<div><dt>${escapeHtml(t(label))}</dt><dd title="${escapeAttribute(Number.isFinite(count) ? count.toLocaleString('en-US') : '—')}">${formatTokenCount(count)}</dd></div>`;
        parts.push(section('usage', t('Token usage'), `<dl class="work-token-metrics">${metric('Thread total', usage.total?.totalTokens)}${metric('Last response', usage.last?.totalTokens)}${metric('Context window limit', usage.modelContextWindow)}</dl>
          <dl class="work-token-breakdown">${metric('Input', usage.total?.inputTokens)}${metric('Output', usage.total?.outputTokens)}${metric('Cached input', usage.total?.cachedInputTokens)}</dl><p class="work-token-note">${escapeHtml(t('Usage is not current context occupancy.'))}</p>`));
      }
      if (activity.truncated) parts.push(`<p class="meta">${escapeHtml(t('Some older activity was not retained.'))}</p>`);
      return parts.length ? `<div class="work-supplements">${parts.join('')}</div>` : '';
    }

    function hydrate(detail, full = false) {
      const body = detail.querySelector('.work-detail-body');
      const data = currentDetails.get(detail.getAttribute('data-work-event-id'));
      if (!body || !data || body.childElementCount) return;
      body.dataset.full = String(full);
      body.innerHTML = `${full ? `<button type="button" class="ghost" data-work-content-back>${escapeHtml(t('Back to preview'))}</button>` : ''}${renderWorkDetailBody(data, full)}`;
    }
    function bind(list) {
      if (!list) return;
      list.workHydrate = hydrate;
      const diffBody = list.querySelector('[data-work-section="diff"] .work-supplement-body');
      const turnId = list.querySelector('.work-turn')?.getAttribute('data-work-turn-id');
      if (diffBody && list.workDiff?.turnId === turnId) diffBody.innerHTML = list.workDiff.html;
      if (list.workViewBound) return;
      list.workViewBound = true;
      list.addEventListener('toggle', event => {
        if (event.target.matches('.work-detail') && event.target.open) hydrate(event.target);
      }, true);
      list.addEventListener('click', event => {
        if (event.target.closest('[data-work-load-diff]')) { void fetchDiff(list); return; }
        const button = event.target.closest('[data-work-content-open], [data-work-content-back]');
        const detail = button?.closest('.work-detail');
        const data = detail && currentDetails.get(detail.getAttribute('data-work-event-id'));
        if (!data) return;
        const full = button.hasAttribute('data-work-content-open');
        const body = detail.querySelector('.work-detail-body');
        if (full) detail.workReturnTop = list.scrollTop;
        body.dataset.full = String(full);
        body.innerHTML = `${full ? `<button type="button" class="ghost" data-work-content-back>${escapeHtml(t('Back to preview'))}</button>` : ''}${renderWorkDetailBody(data, full)}`;
        if (!full) list.scrollTop = detail.workReturnTop ?? list.scrollTop;
        (body.querySelector(full ? '[data-work-content-back]' : '[data-work-content-open]') || detail.querySelector('summary')).focus({ preventScroll: true });
      });
    }
    async function fetchDiff(list) {
      const section = list.querySelector('[data-work-section="diff"]');
      const body = section?.querySelector('.work-supplement-body');
      const turnId = list.querySelector('.work-turn')?.getAttribute('data-work-turn-id');
      if (!body || !turnId || list.workDiffRequest) return;
      const controller = new AbortController();
      list.workDiffRequest = controller;
      const loading = `<p class="meta" role="status">${escapeHtml(t('Loading diff…'))}</p>`;
      list.workDiff = { turnId, html: loading };
      body.innerHTML = loading;
      try {
        const diff = await loadTurnDiff(turnId, { signal: controller.signal });
        if (controller.signal.aborted || !list.isConnected || list.querySelector('.work-turn')?.getAttribute('data-work-turn-id') !== turnId) return;
        const html = diff?.text ? `${diff.truncated ? `<p class="meta">${escapeHtml(t('Only retained diff is available.'))}</p>` : ''}${renderDiff(diff.text, diff.text.length)}` : `<p class="meta">${escapeHtml(t('Diff is no longer available.'))}</p>`;
        list.workDiff = { turnId, html };
      } catch {
        if (controller.signal.aborted || !list.isConnected) return;
        list.workDiff = { turnId, html: `<p class="meta" role="status">${escapeHtml(t('Could not load diff.'))}</p><button type="button" class="ghost" data-work-load-diff>${escapeHtml(t('Retry'))}</button>` };
      } finally {
        list.workDiffRequest = null;
        if (!controller.signal.aborted && list.isConnected && list.querySelector('.work-turn')?.getAttribute('data-work-turn-id') === turnId) {
          const target = list.querySelector('[data-work-section="diff"] .work-supplement-body');
          if (target) target.innerHTML = list.workDiff.html;
        }
      }
    }
    function dispose(list) { list?.workDiffRequest?.abort(); if (list) list.workDiff = null; currentDetails = new Map(); }
    return { renderWorkItem, bind, dispose };
  }

  // Retain nested disclosures, horizontal reading offsets and keyboard focus across streamed updates.
  function captureReadingState(list) {
    const snapshots = [...list.querySelectorAll('.work-detail')].map(detail => ({
      id: detail.getAttribute('data-work-event-id'),
      open: detail.open,
      full: detail.querySelector('.work-detail-body')?.dataset.full === 'true',
      returnTop: detail.workReturnTop,
      rawOpen: Boolean(detail.querySelector('.work-raw')?.open),
      regions: [...detail.querySelectorAll('[role="region"]')].map(region => region.scrollLeft),
      focusIndex: [...detail.querySelectorAll('summary, [role="region"], button')].indexOf(list.ownerDocument?.activeElement),
    }));
    snapshots.supplements = [...list.querySelectorAll('[data-work-section]')].map(section => ({ key: section.dataset.workSection, open: section.open, focusIndex: [...section.querySelectorAll('summary, button, [role="region"]')].indexOf(list.ownerDocument?.activeElement), regions: [...section.querySelectorAll('[role="region"]')].map(region => region.scrollLeft) }));
    snapshots.agents = [...list.querySelectorAll('.work-agent')].filter(agent => agent.querySelector('details')?.open).map(agent => agent.dataset.workAgent);
    snapshots.overviewTop = list.querySelector('.work-overview')?.scrollTop || 0;
    return snapshots;
  }
  function restoreReadingState(list, snapshots) {
    for (const agent of list.querySelectorAll('.work-agent')) agent.querySelector('details').open = (snapshots.agents || []).includes(agent.dataset.workAgent);
    for (const section of list.querySelectorAll('[data-work-section]')) {
      const snapshot = (snapshots.supplements || []).find(saved => saved.key === section.dataset.workSection);
      if (!snapshot) continue;
      section.open = snapshot.open;
      [...section.querySelectorAll('[role="region"]')].forEach((region, index) => { region.scrollLeft = snapshot.regions[index] || 0; });
      if (snapshot.focusIndex >= 0) section.querySelectorAll('summary, button, [role="region"]')[snapshot.focusIndex]?.focus({ preventScroll: true });
    }
    const overview = list.querySelector('.work-overview');
    if (overview) overview.scrollTop = snapshots.overviewTop || 0;
    const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
    for (const detail of list.querySelectorAll('.work-detail')) {
      const snapshot = byId.get(detail.getAttribute('data-work-event-id'));
      if (!snapshot) continue;
      detail.open = snapshot.open;
      if (snapshot.open) list.workHydrate?.(detail, snapshot.full);
      detail.workReturnTop = snapshot.returnTop;
      const raw = detail.querySelector('.work-raw');
      if (raw) raw.open = snapshot.rawOpen;
      [...detail.querySelectorAll('[role="region"]')].forEach((region, index) => { region.scrollLeft = snapshot.regions[index] || 0; });
      if (snapshot.focusIndex >= 0) detail.querySelectorAll('summary, [role="region"], button')[snapshot.focusIndex]?.focus({ preventScroll: true });
    }
  }
  function captureDialog(document) {
    const list = document.querySelector('.work-details-list');
    const turnId = list?.querySelector('.work-turn')?.getAttribute('data-work-turn-id');
    if (!turnId) return null;
    const top = list.getBoundingClientRect().top;
    const contentTop = list.querySelector('.work-overview')?.getBoundingClientRect().bottom || top;
    const anchor = [...list.querySelectorAll('.work-detail')].find(detail => detail.getBoundingClientRect().bottom > contentTop);
    const diff = list.workDiffRequest ? null : list.workDiff;
    list.workDiffRequest?.abort();
    return { turnId, diff, reading: captureReadingState(list), scrollTop: list.scrollTop,
      anchorId: anchor?.getAttribute('data-work-event-id'), offset: anchor ? anchor.getBoundingClientRect().top - top : 0 };
  }
  function restoreDialog(document, snapshot) {
    if (!snapshot) return;
    const list = document.querySelector('.work-details-list');
    if (list?.querySelector('.work-turn')?.getAttribute('data-work-turn-id') !== snapshot.turnId) return;
    if (snapshot.diff?.turnId === snapshot.turnId) {
      list.workDiff = snapshot.diff;
      const body = list.querySelector('[data-work-section="diff"] .work-supplement-body');
      if (body) body.innerHTML = snapshot.diff.html;
    }
    restoreReadingState(list, snapshot.reading);
    list.scrollTop = snapshot.scrollTop;
    const anchor = [...list.querySelectorAll('.work-detail')].find(detail => detail.getAttribute('data-work-event-id') === snapshot.anchorId);
    if (anchor) list.scrollTop += anchor.getBoundingClientRect().top - list.getBoundingClientRect().top - snapshot.offset;
  }
  globalScope.CodexWebWorkView = { formatTokenCount, createRenderer, captureReadingState, restoreReadingState, captureDialog, restoreDialog };
})(globalThis);
