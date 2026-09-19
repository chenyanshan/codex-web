(function installWorkView(globalScope) {
  function createRenderer({ t, escapeHtml, escapeAttribute, shorten, summarizeWorkItem, workDetailsForItem, workTurnStatus, formatWorkCounts, WORK_DETAILS_EVENT_PAGE_SIZE, formatWorkEventStatus, workKindLabel, normalizeWorkFileChanges, primitiveWorkText, formatWorkFileAction, formatWorkChangeStats, formatWorkTextValue, hasSummaryValue, MAX_TIMELINE_SUMMARY_TEXT }) {
    function renderWorkItem(item, { visibleEventLimit = Infinity, visibleEndIndex = Infinity } = {}) {
      const summary = summarizeWorkItem(item);
      const allDetails = workDetailsForItem(item);
      const endIndex = Math.min(allDetails.length, Math.max(0, visibleEndIndex));
      const startIndex = Math.max(0, endIndex - Math.max(1, visibleEventLimit));
      const details = allDetails.slice(startIndex, endIndex);
      const earlierCount = startIndex;
      const newerCount = allDetails.length - endIndex;
      const status = workTurnStatus(item);
      return `
        <section class="work-turn" data-work-turn-id="${escapeAttribute(item.turnId || '')}">
          <header class="work-turn-header">
            <div class="work-turn-copy">
              ${renderProgress(allDetails, status)}
              <p class="work-counts">${escapeHtml(formatWorkCounts(summary))}</p>
            </div>
            <div class="work-turn-aside">
              ${status ? `<span class="work-turn-status" data-tone="running">${escapeHtml(status)}</span>` : ''}
              ${newerCount ? `<div class="work-new-activity"><button type="button" class="ghost compact-button" data-work-show-latest>${escapeHtml(t(newerCount === 1 ? '{count} new activity' : '{count} new activities', { count: newerCount }))}</button></div>` : ''}
            </div>
          </header>
          ${details.length ? `
            <div class="work-events">
              ${earlierCount ? `<div class="work-history-control"><button type="button" class="ghost compact-button" data-work-show-earlier>${escapeHtml(t('Show {count} earlier', { count: Math.min(WORK_DETAILS_EVENT_PAGE_SIZE, earlierCount) }))}</button><span>${escapeHtml(t('{count} hidden', { count: earlierCount }))}</span></div>` : ''}
              ${details.map(renderWorkDetail).join('')}
            </div>
          ` : '<p class="meta">No tool activity yet.</p>'}
        </section>
      `;
    }

    function renderWorkDetail(detail) {
      const body = renderWorkDetailBody(detail);
      const eventStatus = formatWorkEventStatus(detail);
      return `
        <details class="work-detail" data-work-kind="${escapeAttribute(detail.kind)}" data-work-event-id="${escapeAttribute(detail.id || '')}">
          <summary>
            <span class="work-detail-chevron" aria-hidden="true"></span>
            <span class="work-event-kind">${escapeHtml(workKindLabel(detail.kind))}</span>
            <span class="work-event-title" data-i18n-skip title="${escapeAttribute(detail.title)}">${escapeHtml(shorten(cleanText(detail.title).split('\n')[0], 160))}</span>
            ${eventStatus.label ? `<span class="work-event-status" data-tone="${escapeAttribute(eventStatus.tone)}" data-i18n-skip>${escapeHtml(eventStatus.label)}</span>` : ''}
          </summary>
          <div class="work-detail-body">
            ${body || '<p class="meta">No additional details.</p>'}
          </div>
        </details>
      `;
    }

    function renderWorkDetailBody(detail) {
      const summary = detail.summary || {};
      const command = renderWorkTextBlock(detail.kind === 'tool' ? 'Tool input' : 'Command', summary.command || summary.input || summary.arguments || summary.code || (detail.kind === 'command' || detail.kind === 'read' ? detail.title : ''));
      const files = renderWorkFileChanges(detail.fileChanges || []);
      const diff = renderWorkTextBlock('Diff', summary.diff || summary.patch);
      const rows = renderWorkSummaryRows(summary);
      const output = renderWorkTextBlock('Output', summary.output ?? summary.stdout);
      const error = renderWorkTextBlock('Error', summary.error ?? summary.stderr);
      return [command, files, diff, rows, output, error].filter(Boolean).join('');
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

    function renderWorkTextBlock(label, value) {
      const text = cleanText(value);
      if (!text) {
        return '';
      }
      return `
        <div class="work-text-block">
          <strong class="work-section-label">${escapeHtml(t(label))}</strong>
          ${label === 'Diff' ? renderDiff(text) : `<pre class="work-output" tabindex="0" role="region" aria-label="${escapeAttribute(t(label))}" data-i18n-skip>${escapeHtml(shorten(text, MAX_TIMELINE_SUMMARY_TEXT))}</pre>`}
          ${text.length > MAX_TIMELINE_SUMMARY_TEXT ? `<span class="meta">${escapeHtml(t('Preview truncated.'))}</span>` : ''}
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

    function renderDiff(value) {
      let oldLine = null;
      let newLine = null;
      const lines = shorten(value, MAX_TIMELINE_SUMMARY_TEXT).split('\n').map(line => {
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

    function renderProgress(details, running) {
      const done = details.filter(detail => formatWorkEventStatus(detail).tone === 'done').length;
      const failed = details.filter(detail => formatWorkEventStatus(detail).tone === 'failed').length;
      const active = running && (details.find(detail => detail.kind === 'approval' && formatWorkEventStatus(detail).tone === 'running')
        || [...details].reverse().find(detail => formatWorkEventStatus(detail).tone === 'running'));
      const latest = active || details.at(-1);
      const label = active && running ? 'Current activity' : running ? 'Latest activity' : 'Last activity';
      return `<p class="work-progress-title">${escapeHtml(t(label))}${latest ? ` · ${escapeHtml(workKindLabel(latest.kind))}` : ''}</p>
        <p class="work-progress-current" data-i18n-skip title="${escapeAttribute(latest?.title || '')}">${escapeHtml(latest ? cleanText(latest.title).split('\n')[0] : t('Waiting for work activity'))}</p>
        <p class="work-progress-count">${escapeHtml(t('{done} of {total} activities completed', { done, total: details.length }))}${failed ? ` · <span class="work-progress-failed">${escapeHtml(t('{count} failed', { count: failed }))}</span>` : ''}</p>`;
    }
    return { renderWorkItem };
  }

  // Retain nested disclosures, horizontal reading offsets and keyboard focus across streamed updates.
  function captureReadingState(list) {
    return [...list.querySelectorAll('.work-detail')].map(detail => ({
      id: detail.getAttribute('data-work-event-id'),
      open: detail.open,
      rawOpen: Boolean(detail.querySelector('.work-raw')?.open),
      regions: [...detail.querySelectorAll('[role="region"]')].map(region => region.scrollLeft),
      focusIndex: [...detail.querySelectorAll('summary, [role="region"]')].indexOf(list.ownerDocument?.activeElement),
    }));
  }
  function restoreReadingState(list, snapshots) {
    const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
    for (const detail of list.querySelectorAll('.work-detail')) {
      const snapshot = byId.get(detail.getAttribute('data-work-event-id'));
      if (!snapshot) continue;
      detail.open = snapshot.open;
      const raw = detail.querySelector('.work-raw');
      if (raw) raw.open = snapshot.rawOpen;
      [...detail.querySelectorAll('[role="region"]')].forEach((region, index) => { region.scrollLeft = snapshot.regions[index] || 0; });
      if (snapshot.focusIndex >= 0) detail.querySelectorAll('summary, [role="region"]')[snapshot.focusIndex]?.focus({ preventScroll: true });
    }
  }
  function captureDialog(document) {
    const list = document.querySelector('.work-details-list');
    const turnId = list?.querySelector('.work-turn')?.getAttribute('data-work-turn-id');
    if (!turnId) return null;
    const top = list.getBoundingClientRect().top;
    const contentTop = list.querySelector('.work-turn-header')?.getBoundingClientRect().bottom || top;
    const anchor = [...list.querySelectorAll('.work-detail')].find(detail => detail.getBoundingClientRect().bottom > contentTop);
    return { turnId, reading: captureReadingState(list), scrollTop: list.scrollTop,
      anchorId: anchor?.getAttribute('data-work-event-id'), offset: anchor ? anchor.getBoundingClientRect().top - top : 0 };
  }
  function restoreDialog(document, snapshot) {
    if (!snapshot) return;
    const list = document.querySelector('.work-details-list');
    if (list?.querySelector('.work-turn')?.getAttribute('data-work-turn-id') !== snapshot.turnId) return;
    restoreReadingState(list, snapshot.reading);
    list.scrollTop = snapshot.scrollTop;
    const anchor = [...list.querySelectorAll('.work-detail')].find(detail => detail.getAttribute('data-work-event-id') === snapshot.anchorId);
    if (anchor) list.scrollTop += anchor.getBoundingClientRect().top - list.getBoundingClientRect().top - snapshot.offset;
  }
  globalScope.CodexWebWorkView = { createRenderer, captureReadingState, restoreReadingState, captureDialog, restoreDialog };
})(globalThis);
