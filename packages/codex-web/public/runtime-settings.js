(function installRuntimeSettings(globalObject) {
const runtimeChineseCopy = Object.freeze({
      "Codex version": "Codex 版本",
      "Web build": "Web 构建版本",
      "Installed CLI": "已安装 CLI",
      "Running app-server": "运行中的 app-server",
      "Protocol baseline": "协议基准版本",
      "Unknown": "未知",
      "Waiting for idle": "等待任务结束",
      "Installing pinned version": "正在安装指定版本",
      "Checking compatibility": "正在检查兼容性",
      "Applying installed version": "正在应用已安装版本",
      "Running version confirmed": "已确认运行版本",
      "Reservation cancelled": "已取消预约",
      "Maintenance failed": "维护失败",
      "Outcome unknown — inspect versions before another operation": "结果未知，请先核对版本再发起其他操作",
      "Version information is loaded on demand.": "按需加载版本信息。",
      "Previous request delivery is uncertain. Refresh status before attempting another operation.": "上次请求是否送达尚未确认。请刷新状态后再考虑其他操作。",
      "Refresh status": "刷新状态",
      "Check for updates": "检查更新",
      "Apply installed when idle": "空闲后应用已安装版本",
      "Install {version} when idle": "空闲后安装 {version}",
      "Check for an update first": "请先检查更新",
      "Cancel reservation": "取消预约",
      "Could not read runtime status. Existing information is retained.": "暂时无法读取运行状态，已保留上次信息。",
      "Request outcome is unknown. Refresh status; do not repeat the operation.": "请求结果未知。请刷新状态，不要重复操作。",
      "Updates replace the npm installation after all tasks finish. Compatibility is checked before switching. Automatic rollback is unavailable.": "所有任务结束后更新 npm 安装，并在切换前检查兼容性。不支持自动回退。",
      "This installation cannot be updated here. Update it manually, then apply the installed version.": "当前安装方式不支持在此更新。请手动更新后应用已安装版本。",
      "Maintenance did not complete during {phase}. Check the installed and running versions; no automatic retry or rollback.": "维护未能完成（{phase}）。请核对已安装和运行中的版本；不会自动重试或回退。",
      "Service restarted during maintenance; inspect installed/running versions before creating a new operation. No automatic retry.": "维护期间服务已重启。请核对已安装和运行中的版本后再创建操作，不会自动重试。",
      "Waiting for global idle": "等待所有任务结束",
      "Execution admission in progress": "正在接收执行请求",
      "Global activity is unknown": "无法确认全部任务状态",
      "{count} scheduled executions active": "有 {count} 个定时任务执行尚未结束",
      "Active turns": "存在运行中的任务",
      "Active goals": "存在活动目标",
      "Pending approvals": "存在待处理审批",
      "Unresolved questions": "存在未完成的问题",
      "Global activity unavailable": "无法获取全部任务状态",
      "Loaded thread state unknown": "无法确认已加载会话的状态",
      "Unexpected loaded thread state": "已加载会话状态异常",
      "Loaded thread inspection limit reached; global idle is unknown": "已达到会话检查上限，无法确认全部任务已结束",
      "Loaded thread pagination is incomplete": "已加载会话的分页检查尚未完成",
      "Loaded thread active or idle state unconfirmed": "仍有已加载会话运行中，或无法确认其已空闲",
      "; ": "；",
});
// Loaded only when an administrator opens runtime settings. No independent polling.
function mountRuntimeSettings(root, { apiFetch, identityKey, isCurrent = () => true, t: translate = key => key }) {
  const t = (key, values = {}) => {
    const translated = translate(key);
    const text = translated !== key ? translated : document.documentElement.lang === 'zh-CN' ? runtimeChineseCopy[key] || key : key;
    return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
  };
  if (root.dataset.runtimeMounted) return;
  root.dataset.runtimeMounted = 'true';
  const storageKey = `codex.runtime-maintenance:${identityKey}`;
  let snapshot = null;
  let targetVersion = null;
  let busy = false;
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { /* Storage is optional. */ }
  const alive = () => root.isConnected && isCurrent();
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = t(text); if (className) node.className = className; return node; };
  function savePending(value) { pending = value; try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* Keep in-memory uncertainty. */ } }
  function render(message = '') {
    if (!alive()) return;
    root.replaceChildren();
    root.append(element('div', 'Codex version', 'settings-section-title'));
    for (const [label, value] of [['Web build', snapshot?.webBuild], ['Installed CLI', snapshot?.installedVersion], ['Running app-server', snapshot?.runningVersion], ['Protocol baseline', snapshot?.protocolVersion]]) {
      const row = element('div', '', 'settings-action-row'); row.append(element('span', label, 'meta'), element('span', value || 'Unknown')); root.append(row);
    }
    const operation = snapshot?.operation;
    const labels = { waiting: 'Waiting for idle', installing: 'Installing pinned version', verifying: 'Checking compatibility', applying: 'Applying installed version', succeeded: 'Running version confirmed', cancelled: 'Reservation cancelled', failed: 'Maintenance failed', outcome_unknown: 'Outcome unknown — inspect versions before another operation' };
    const status = element('p', message || (operation ? `${t(labels[operation.phase] || operation.phase)}${operation.targetVersion ? ` · ${operation.targetVersion}` : ''}` : 'Version information is loaded on demand.'), 'meta');
    status.setAttribute('role', 'status'); root.append(status);
    if (operation?.reasons?.length) root.append(element('p', operation.reasons.map(reason => {
      const scheduled = reason.match(/^(\d+) scheduled execution\(s\) active$/);
      return scheduled ? t('{count} scheduled executions active', { count: scheduled[1] }) : t(reason);
    }).join(t('; ')), 'meta'));
    if (operation?.error) {
      const phase = operation.error.match(/^Maintenance (\w+) did not complete\./)?.[1];
      root.append(element('p', phase ? t('Maintenance did not complete during {phase}. Check the installed and running versions; no automatic retry or rollback.', { phase: t(labels[phase] || phase) }) : t(operation.error), 'meta'));
    }
    if (snapshot?.limitation) root.append(element('p', snapshot.updateSupported
      ? 'Updates replace the npm installation after all tasks finish. Compatibility is checked before switching. Automatic rollback is unavailable.'
      : 'This installation cannot be updated here. Update it manually, then apply the installed version.', 'meta'));
    if (pending && pending.id !== operation?.id) root.append(element('p', 'Previous request delivery is uncertain. Refresh status before attempting another operation.', 'meta'));
    const actions = element('div', '', 'settings-action-row'); actions.style.flexWrap = 'wrap'; actions.style.gap = '8px';
    const button = (label, action, disabled = false) => { const node = element('button', label, 'ghost compact-button'); node.type = 'button'; node.disabled = busy || disabled; node.addEventListener('click', action); actions.append(node); };
    button('Refresh status', () => void load(false));
    button('Check for updates', () => void load(true));
    const active = operation && ['waiting', 'installing', 'verifying', 'applying'].includes(operation.phase);
    button('Apply installed when idle', () => void schedule('apply_installed'), !snapshot?.installedVersion || !!active || !!pending);
    if (snapshot?.updateSupported) button(targetVersion ? t('Install {version} when idle', { version: targetVersion }) : 'Check for an update first', () => void schedule('upgrade'), !targetVersion || !!active || !!pending);
    if (operation?.phase === 'waiting') button('Cancel reservation', () => void mutate('/api/runtime/maintenance/cancel', { id: operation.id }));
    root.append(actions);
  }
  async function load(check) {
    if (busy || !alive()) return; busy = true; render();
    try {
      const value = await apiFetch(check ? '/api/runtime/check' : '/api/runtime/status', check ? { method: 'POST' } : undefined);
      if (!alive()) return;
      snapshot = value;
      if (check) targetVersion = value.targetVersion || null;
      if (pending && value.operation?.id === pending.id) savePending(null);
      busy = false; render();
    } catch { busy = false; render('Could not read runtime status. Existing information is retained.'); }
  }
  async function mutate(url, body) {
    if (busy || !alive()) return; busy = true; render();
    try {
      const value = await apiFetch(url, { method: 'POST', body });
      if (!alive()) return;
      snapshot = { ...snapshot, operation: value.operation };
      if (pending?.id === value.operation?.id) savePending(null);
      busy = false; render();
    } catch { busy = false; render('Request outcome is unknown. Refresh status; do not repeat the operation.'); }
  }
  async function schedule(kind) {
    const body = { id: crypto.randomUUID(), kind, ...(kind === 'upgrade' ? { targetVersion } : {}) };
    savePending(body);
    await mutate('/api/runtime/maintenance', body);
  }
  render(); void load(false);
  return { refresh: () => load(false) };
}

globalObject.CodexWebRuntimeSettings = Object.freeze({ mountRuntimeSettings });
})(globalThis);
