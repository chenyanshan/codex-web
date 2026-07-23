const APP_BUILD_ID = '__CODEX_WEB_BUILD_ID__';
const TOKEN_KEY = 'codexWebToken';
const SESSIONS_CACHE_KEY = 'codexWebSessionsCache';
const TIMELINE_CACHE_KEY = 'codexWebTimelineCache';
const WORKSPACE_STATE_KEY = 'codexWebWorkspaceState';
const TIMELINE_CACHE_VERSION = 3;
const QUEUED_MESSAGES_KEY = 'codexWebQueuedMessages';
const SUBMISSION_OUTBOX_KEY = 'codexWebSubmissionOutbox';
const SUBMISSION_OUTBOX_ENTRY_PREFIX = `${SUBMISSION_OUTBOX_KEY}:`;
const SUBMISSION_OUTBOX_VERSION = 1;
const THEME_KEY = 'codexWebTheme';
const SITE_TITLE_KEY = 'codexWebSiteTitle';
const DEFAULT_THREAD_SETTINGS_KEY = 'codexWebDefaultThreadSettings';
const DEFAULT_THREAD_SETTINGS_VERSION_KEY = 'codexWebDefaultThreadSettingsVersion';
const DEFAULT_THREAD_SETTINGS_VERSION = '2';
const MESSAGE_FONT_SIZE_KEY = 'codexWebMessageFontSize';
const LANGUAGE_KEY = 'codexWebLanguage';
const MAX_TIMELINE_CACHE_SESSIONS = 5;
const MAX_TIMELINE_CACHE_ITEMS = 80;
const MAX_TIMELINE_CACHE_MAP_ITEMS = 24;
const MAX_TIMELINE_ITEM_TEXT = 12000;
const MAX_TIMELINE_SUMMARY_TEXT = 4000;
const MAX_TIMELINE_SUMMARY_ARRAY_ITEMS = 24;
const MAX_TIMELINE_SUMMARY_OBJECT_KEYS = 32;
const MAX_TIMELINE_SUMMARY_DEPTH = 4;
const MAX_SUBMISSION_OUTBOX_ITEMS = 50;
const SUBMISSION_RETRY_BASE_MS = 5_000;
const SUBMISSION_RETRY_MAX_MS = 5 * 60_000;
const SUBMISSION_REQUEST_TIMEOUT_MS = 30_000;
const SUBMISSION_VISIBLE_FAILURE_ATTEMPT = 3;
const WORK_DETAILS_EVENT_PAGE_SIZE = 20;
const MIN_HYDRATED_COMPLETE_EXCHANGES = 2;
const DEFAULT_MODEL = '';
const DEFAULT_REASONING_EFFORT = '';
const LEGACY_DEFAULT_MODEL = 'gpt-5.4';
const LEGACY_DEFAULT_REASONING_EFFORT = 'xhigh';
const FALLBACK_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const DEFAULT_COLLABORATION_MODE = 'default';
const DEFAULT_PERMISSION_PRESET = 'full-access';
const DEFAULT_APPROVAL_POLICY = 'never';
const DEFAULT_SANDBOX_MODE = 'danger-full-access';
const THEMES = Object.freeze([
  { id: 'sunny', label: 'Sunlit', chromeColor: '#f8f3e3' },
  { id: 'light', label: 'Paper', chromeColor: '#f6f8fa' },
  { id: 'dark', label: 'Graphite', chromeColor: '#181a1f' },
  { id: 'nord', label: 'Nordic', chromeColor: '#252a35' },
  { id: 'forest', label: 'Forest', chromeColor: '#101613' },
  { id: 'rose', label: 'Rose', chromeColor: '#f9f4f5' },
]);
const THEME_IDS = THEMES.map((theme) => theme.id);
const DEFAULT_THEME = 'sunny';
const DEFAULT_SITE_TITLE = 'Codex Web';
const DEFAULT_MESSAGE_FONT_SIZE = 'medium';
const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = ['en', 'zh-CN'];
const PROMPT_TEXTAREA_MAX_HEIGHT = 116;
const DESKTOP_PROMPT_TEXTAREA_MAX_HEIGHT = 220;
const PROMPT_EXPAND_LINE_THRESHOLD = 4;
const STREAM_STALE_MS = 30_000;
const STREAM_RECOVERY_CHECK_MS = 10_000;
const STREAM_HANDSHAKE_TIMEOUT_MS = 12_000;
const STREAM_RETRY_BASE_MS = 1_000;
const STREAM_RETRY_MAX_MS = 30_000;
const STREAM_RETRY_JITTER = 0.25;
const SESSION_RECONCILE_TIMEOUT_MS = 12_000;
const SESSION_TIMELINE_PAGE_TIMEOUT_MS = 12_000;
const APP_VERSION_CHECK_COOLDOWN_MS = 15_000;
const TIMELINE_PERSIST_DEBOUNCE_MS = 750;
const FIRST_TURN_RECOVERY_DELAY_MS = 10_000;
const LOCAL_TURN_SYNC_GRACE_MS = 10_000;
const SESSION_DETAIL_CACHE_FRESH_MS = 3 * 60_000;
const DESKTOP_WORKSPACE_MIN_WIDTH = 1280;
const EDGE_SWIPE_START_PX = 24;
const EDGE_SWIPE_TRIGGER_PX = 72;
const EDGE_SWIPE_MAX_VERTICAL_PX = 48;
const TIMELINE_FOLLOW_LATEST_TOLERANCE_PX = 24;
const SESSION_FILE_HTML_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";
const NON_RUNTIME_STATUS_LABELS = new Set([
  'Checking auth',
  'Loading',
  'Restoring session',
  'Syncing sessions',
  'Logging in',
  'Login required',
  'Refreshing',
  'Starting session',
  'Loading session',
  'Starting turn',
  'Waiting for first response',
  'Request failed',
  'Stream failed',
  'Reloading runtime',
  'Runtime reloaded',
  'Approval sent',
  'Approval resolved',
  'Interrupt requested',
  'Session archived',
  'Session favorited',
  'Favorite removed',
  'Creating share link',
  'Share link copied',
  'Share link ready',
  'Uploading attachment',
  'Attachment uploaded',
  'Upload failed',
]);
const UI_TRANSLATIONS = {
  'zh-CN': {
    'Checking auth': '正在检查登录',
    Loading: '正在加载',
    'Restoring session': '正在恢复会话',
    'Syncing sessions': '正在同步会话',
    'Could not update sessions.': '无法更新会话。',
    Retry: '重试',
    'Logging in': '正在登录',
    'Login required': '需要登录',
    Refreshing: '正在刷新',
    'Starting session': '正在启动会话',
    'Loading session': '正在加载会话',
    'Starting turn': '正在开始',
    'Saved on this device': '已保存在本机',
    'Sending to server': '正在发送',
    'Server received': '服务器已接收',
    'Send failed': '发送失败',
    'Waiting to send': '等待发送',
    'Retry send': '重试发送',
    'Cancel send': '取消发送',
    'Offline': '网络不可用',
    'Too many messages are waiting to send. Retry or cancel one before sending another.': '待发送消息已达上限。请先重试或取消一条消息。',
    'Waiting for first response': '正在等待首次响应',
    'Request failed': '请求失败',
    'Stream failed': '连接流失败',
    'Reloading runtime': '正在重载运行时',
    'Runtime reloaded': '运行时已重载',
    'Approval sent': '已发送审批',
    'Approval resolved': '审批已处理',
    'Interrupt requested': '已请求停止',
    'Session archived': '会话已归档',
    'Session favorited': '已收藏会话',
    'Favorite removed': '已取消收藏',
    'Creating share link': '正在创建分享链接',
    'Share link copied': '分享链接已复制',
    'Share link ready': '分享链接已准备好',
    'Uploading attachment': '正在上传附件',
    'Attachment uploaded': '附件已上传',
    'Upload failed': '上传失败',
    Ready: '就绪',
    Active: '活动中',
    'Needs approval': '等待审批',
    Reconnecting: '正在重连',
    Working: '工作中',
    'Running command': '执行命令',
    'Editing files': '修改文件',
    'Using tool': '使用工具',
    'Work details': '工作详情',
    'Close work details': '关闭工作详情',
    'Members can view work details': '普通成员可查看工作详情',
    'Admin only': '仅管理员',
    Members: '普通成员',
    'Close session menu': '关闭会话菜单',
    'Turn running': '正在运行',
    'Stream paused': '连接流已暂停',
    'Turn failed': '运行失败',
    'Turn interrupted': '运行已中断',
    'Turn stopped': '已停止',
    Paused: '已暂停',
    Running: '运行中',
    Failed: '失败',
    Done: '完成',
    Stopped: '已停止',
    Idle: '空闲',
    'Setup required': '需要初始化',
    'Password not configured.': '尚未配置密码。',
    'Password login for this device.': '使用密码登录此设备。',
    Username: '用户名',
    Password: '密码',
    'Log in': '登录',
    Sessions: '会话',
    Open: '打开',
    New: '新建',
    Setting: '设置',
    Settings: '设置',
    Appearance: '外观',
    Advanced: '高级',
    Account: '账户',
    Webhook: 'Webhook',
    'Enable webhook': '启用 Webhook',
    'Webhook endpoint': 'Webhook 接口地址',
    'Webhook key': 'Webhook 密钥',
    'Regenerate key': '重新生成密钥',
    'Regenerate webhook key?': '重新生成 Webhook 密钥？',
    'Copy key': '复制密钥',
    'The current key will stop working immediately.': '当前密钥将立即失效。',
    'Webhook endpoint copied.': '已复制 Webhook 接口地址。',
    'Webhook key copied.': 'Webhook 密钥已复制。',
    'Loading webhook settings...': '正在加载 Webhook 设置...',
    'Webhook is disabled.': 'Webhook 已停用。',
    'Webhook key is not available.': 'Webhook 密钥不可用。',
    'Regenerate this legacy key once to make it copyable.': '请重新生成一次旧密钥，之后即可随时复制。',
    'Could not load webhook settings.': '无法加载 Webhook 设置。',
    'Could not update webhook settings.': '无法更新 Webhook 设置。',
    'Could not regenerate webhook key.': '无法重新生成 Webhook 密钥。',
    Regenerate: '重新生成',
    'Could not copy webhook endpoint.': '无法复制 Webhook 接口地址。',
    'Could not copy webhook key.': '无法复制 Webhook 密钥。',
    Rotate: '轮换',
    Copied: '已复制',
    Administration: '管理',
    'Current session': '当前会话',
    'Current session is running': '当前会话正在运行',
    'Current session is idle': '当前会话已空闲',
    'Model and reasoning': '模型与推理',
    Behavior: '行为',
    'Behavior and permissions': '行为与权限',
    Actions: '操作',
    Language: '语言',
    English: 'English',
    'Chinese (Simplified)': '中文',
    'No active session': '没有活动会话',
    'Select a session in the middle pane or start a new one.': '请选择一个会话，或新建会话。',
    'Start a new session': '新建会话',
    Favorites: '收藏',
    Recents: '最近',
    favorite: '收藏',
    File: '文件',
    'File not loaded.': '文件尚未加载。',
    'File preview': '文件预览',
    'Loading file...': '正在加载文件...',
    'Could not open this file.': '无法打开此文件。',
    'File not found.': '文件不存在或已被清理。',
    'File access denied.': '无法访问此文件。',
    'This file cannot be previewed.': '此文件无法预览。',
    'This file is too large to open.': '文件过大，无法打开。',
    'File preview is busy. Try again.': '文件预览繁忙，请重试。',
    Download: '下载',
    Close: '关闭',
    'Website title': '网站标题',
    'Browser title': '浏览器标题',
    Theme: '主题',
    Sunlit: '日光黄',
    Paper: '纸白',
    Graphite: '石墨',
    Nordic: '北境蓝',
    Forest: '森林绿',
    Rose: '柔和玫瑰',
    'Message Size': '消息字号',
    Small: '小',
    Medium: '中',
    Large: '大',
    'New Thread': '默认新会话',
    'New sessions on this device': '此设备的新会话',
    'Use Codex default': '跟随 Codex 配置',
    Model: '模型',
    Reasoning: '推理',
    Mode: '模式',
    Default: '默认',
    Plan: '计划',
    Permissions: '权限',
    Read: '只读',
    Ask: '询问',
    Full: '完全',
    'Ask before changes': '修改前询问',
    'Full access': '完全访问',
    Admin: '管理',
    'Log out': '退出登录',
    System: '系统',
    'Multi-user mode': '多用户模式',
    'Loading admin settings...': '正在加载管理设置...',
    'Admin Console': '管理控制台',
    'Loading admin console...': '正在加载管理控制台...',
    'Project Management': '项目管理',
    'Role Management': '角色管理',
    'User Management': '用户管理',
    'Session Audit': '会话审计',
    'Admin sections': '管理分区',
    User: '用户',
    Project: '项目',
    'All users': '所有用户',
    'All projects': '所有项目',
    'Display Name': '显示名称',
    'auto from CWD': '从 CWD 自动生成',
    CWD: 'CWD',
    Enabled: '启用',
    'Save Project': '保存项目',
    Cancel: '取消',
    'Role ID': '角色 ID',
    Name: '名称',
    Writer: '写作者',
    'Save Role': '保存角色',
    'User ID': '用户 ID',
    'At least 8 chars': '至少 8 个字符',
    Role: '角色',
    'Save User': '保存用户',
    'No roles available': '暂无可用角色',
    'No role': '无角色',
    Projects: '项目',
    'No projects available.': '暂无可用项目。',
    'No projects configured.': '尚未配置项目。',
    Action: '操作',
    Edit: '编辑',
    'No users configured.': '尚未配置用户。',
    Save: '保存',
    Enable: '启用',
    Disable: '停用',
    Delete: '删除',
    'No roles configured.': '尚未配置角色。',
    admin: '管理员',
    'No sessions found.': '未找到会话。',
    'Observer Mode': '观察模式',
    'New Session': '新会话',
    Start: '开始',
    'Loading projects...': '正在加载项目...',
    'No projects available': '暂无可用项目',
    'Ask an admin to assign a project before starting a session.': '开始会话前请让管理员分配项目。',
    'Project path': '项目路径',
    'Use server default': '使用服务端默认值',
    'Session menu': '会话菜单',
    'Share link': '分享链接',
    'Copied to clipboard.': '已复制到剪贴板。',
    'Copy this read-only session link.': '复制此只读会话链接。',
    Copy: '复制',
    'Delete queued message': '删除排队消息',
    'Queued messages': '排队消息',
    'Shared link': '分享链接',
    'Observer mode': '观察模式',
    'Read only': '只读',
    Attachments: '附件',
    'Attach files': '添加文件',
    'Refresh session': '刷新会话',
    Refresh: '刷新',
    Send: '发送',
    Message: '输入消息',
    Uploading: '上传中',
    Saved: '已保存',
    Image: '图片',
    upload: '上传',
    'Expand message editor': '展开消息编辑器',
    'Collapse message editor': '收起消息编辑器',
    Runtime: '运行时',
    Reload: '重载',
    Share: '分享',
    'Checking sharing availability': '正在检查分享可用性',
    'Public sharing is disabled': '公开分享尚未启用',
    'Available in trusted-team mode': '仅在可信团队模式下可用',
    'Current turn is running.': '当前任务正在运行。',
    Stop: '停止',
    'No context yet.': '暂无上下文。',
    Error: '错误',
    'Approval requested': '请求审批',
    Accept: '接受',
    Session: '会话',
    Deny: '拒绝',
    Work: '工作',
    'Turn activity': '本轮活动',
    'In progress': '进行中',
    'Files changed': '修改的文件',
    Requested: '等待处理',
    Added: '新增',
    Deleted: '删除',
    Modified: '修改',
    'Show {count} earlier': '查看更早的 {count} 条',
    '{count} hidden': '已隐藏 {count} 条',
    '{count} new activity': '{count} 条新活动',
    '{count} new activities': '{count} 条新活动',
    'Read {count}': '读取 {count}',
    'Ran {count}': '执行 {count}',
    'Edited {count}': '修改 {count} 个文件',
    'Approval {count}': '审批 {count}',
    'Exit {code}': '退出码 {code}',
    'No tool activity yet.': '暂无工具活动。',
    'No additional details.': '暂无更多详情。',
    Output: '输出',
    Diff: '差异',
    Ran: '运行',
    Edited: '编辑',
    Approval: '审批',
    Tool: '工具',
    Batch: '批次',
    'Default model': '默认模型',
    Unfavorite: '取消收藏',
    Favorite: '收藏',
    Archive: '归档',
    Unarchive: '取消归档',
    'Archive session?': '归档会话？',
    'No prompt preview': '无提示预览',
    'No cwd': '无 CWD',
    'All Sessions': '所有会话',
    Archived: '归档',
    'No archived sessions yet.': '暂无已归档会话。',
    'Active sessions': '活动会话',
    'Archived sessions': '已归档会话',
    'Untitled Project': '未命名项目',
    'Unknown project': '未知项目',
    unknown: '未知',
    You: '你',
    Assistant: '助手',
    Command: '命令',
    completed: '已完成',
    final: '最终',
    streaming: '流式输出',
    history: '历史',
    pending: '等待中',
    preview: '预览',
    failed: '失败',
    started: '已开始',
    running: '运行中',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '极高',
    'Remove failed uploads before sending.': '发送前请移除上传失败的附件。',
    'Wait for uploads to finish before sending.': '请等待附件上传完成后再发送。',
    'Wait for the current turn to finish before attaching files.': '请等待当前任务结束后再添加附件。',
    'Wait for the current attachment upload to finish.': '请等待当前附件上传完成。',
    'Attachments cannot be queued while a turn is running.': '任务运行中不能排队发送附件。',
    'No projects are available for this account.': '此账号暂无可用项目。',
    'Selected session was unavailable. Choose another session or create a new one.': '所选会话不可用。请选择其他会话或新建会话。',
    'Selected session was unavailable and was removed from the list.': '所选会话不可用，已从列表移除。',
    'Share link was not returned.': '未返回分享链接。',
    'Remove {fileName}': '移除 {fileName}',
    'Favorite {label}': '收藏 {label}',
    'Unfavorite {label}': '取消收藏 {label}',
  },
};

const INITIAL_SITE_TITLE = normalizeSiteTitle(readBootstrapSiteTitle() || localStorage.getItem(SITE_TITLE_KEY));

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  authSession: null,
  models: [],
  codexConfigDefaults: { model: '', reasoningEffort: '' },
  projects: [],
  projectsLoaded: false,
  newProjectId: '',
  admin: {
    loading: false,
    loaded: false,
    settings: null,
    projects: [],
    users: [],
    roles: [],
    sessions: [],
    page: 'projects',
    filterUserId: '',
    filterProjectId: '',
    filterState: 'all',
    editingProjectId: '',
    editingRoleId: '',
    observedSession: null,
    observedSessionLoading: false,
  },
  sessions: [],
  sessionsByScope: {
    favorites: [],
    all: [],
    archived: [],
  },
  sessionsLoadedByScope: {
    favorites: false,
    all: false,
    archived: false,
  },
  sessionArchiveOverrides: new Map(),
  sessionsLoading: false,
  sessionsLoadingScope: null,
  sessionsError: '',
  sessionsRequestId: 0,
  reports: [],
  currentSessionFile: null,
  currentSessionFilePath: '',
  currentSessionFileContent: '',
  currentSessionFileBlob: null,
  currentSessionFileObjectUrl: '',
  currentSessionFileLoading: false,
  currentSessionFileError: '',
  currentSession: null,
  sessionId: null,
  activeSubmissionId: '',
  chatReturnView: 'sessions',
  draftSessionActive: false,
  view: 'sessions',
  selectedProjectKey: '',
  selectedProjectId: '',
  selectedProjectLabel: '',
  mobileSidebarOpen: false,
  desktopSettingsOpen: false,
  desktopOverlay: null,
  theme: normalizeTheme(localStorage.getItem(THEME_KEY)),
  siteTitle: INITIAL_SITE_TITLE,
  globalSettings: {
    siteTitle: INITIAL_SITE_TITLE,
    canSetSiteTitle: false,
    publicSharesEnabled: false,
    loaded: false,
  },
  webhook: createWebhookSettingsState(),
  webhookRotateConfirmOpen: false,
  messageFontSize: normalizeMessageFontSize(localStorage.getItem(MESSAGE_FONT_SIZE_KEY)),
  language: normalizeLanguage(localStorage.getItem(LANGUAGE_KEY)),
  defaultThreadSettings: loadDefaultThreadSettings(),
  sortMode: 'time',
  sessionsScope: 'all',
  archiveConfirmSessionId: null,
  cwd: '',
  newCwd: '',
  turnId: null,
  pendingTurn: false,
  submissionSending: false,
  setupRequired: false,
  setupMessage: '',
  loginError: '',
  error: '',
  status: 'Checking auth',
  statusTone: 'warn',
  prompt: '',
  promptDrafts: new Map(),
  composerAttachments: [],
  queuedMessages: loadQueuedMessages(),
  submissionOutbox: loadSubmissionOutbox(),
  queuedMessageSending: false,
  queuedInterruptRequestedTurnId: null,
  queuedInterruptEligibleTurnId: null,
  composerCanExpand: false,
  composerExpanded: false,
  timelineShouldFollowLatest: true,
  model: DEFAULT_MODEL,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
  collaborationMode: DEFAULT_COLLABORATION_MODE,
  settingsOpen: false,
  permissionPreset: DEFAULT_PERMISSION_PRESET,
  approvalPolicy: DEFAULT_APPROVAL_POLICY,
  sandboxMode: DEFAULT_SANDBOX_MODE,
  timeline: [],
  sessionHistoryItems: [],
  sessionHistoryStartIndex: 0,
  timelineCache: loadTimelineCache(),
  batches: new Map(),
  approvals: new Map(),
  streamAbortController: null,
  streamIncludesWorkDetails: false,
  locallyStartedTurnId: null,
  locallyStartedTurnAt: 0,
  latestTurnId: '',
  lastTurnEventSequence: null,
  lastTurnEventEpoch: '',
  lastTurnEventAt: 0,
  terminalTurnIds: new Set(),
  streamWasBackgrounded: false,
  shareDialog: null,
  workDetailsOpen: false,
  workDetailsTurnId: '',
  workDetailsVisibleEventLimit: WORK_DETAILS_EVENT_PAGE_SIZE,
  workDetailsVisibleEndIndex: 0,
  workDetailsFollowLatest: true,
  workDetailsPolicyPendingSessionId: '',
};

const app = document.querySelector('#app');
let composerResizeObserver = null;
let composerOffsetRun = 0;
let pullToRefreshCleanup = null;
let edgeSwipeStart = null;
let allSessionsPreloadPromise = null;
let promptFocusRestoreTimer = null;
let promptFocusLayoutTimer = null;
let promptRestoreRun = 0;
let sessionListRestoreScrollTop = null;
let timelineScrollTrackingElement = null;
let sessionFileTimelineSnapshot = null;
let chatTimelineForegroundSnapshot = null;
let chatTimelineViewportSnapshot = null;
let nextTimelineRestoreSnapshot = null;
let sharedSessionLoadPromise = null;
let streamRecoveryTimer = null;
let streamRecoveryPromise = null;
let sessionReconcilePromise = null;
let sessionReconcileForceDetail = false;
let streamReconnectTimer = null;
let streamReconnectAttempt = 0;
let activeStreamTurnId = '';
let workspaceRestoredFromCache = false;
let passiveDesktopSessionId = '';
let appVersionCheckPromise = null;
let lastAppVersionCheckAt = 0;
let timelinePersistTimer = null;
let chatDynamicUiFramePending = false;
const dirtyTimelineEntryIds = new Set();
let sessionFileLoadAbortController = null;
let sessionTimelinePageRequest = null;
let renderEventController = null;
let timelineEventController = null;
let authRequestGeneration = 0;
let lastViewportWidth = typeof window?.innerWidth === 'number' ? window.innerWidth : 0;
let lastViewportHeight = typeof window?.innerHeight === 'number' ? window.innerHeight : 0;
let activeFocusScopeKey = '';
let focusReturnTarget = null;
let pendingFocusRestore = false;
let submissionDrainPromise = null;
let submissionRetryTimer = null;
const submissionRequestControllers = new Map();

bootstrap();
applyTheme(state.theme, { persist: false });
applySiteTitle(state.siteTitle, { persist: false });
applyMessageFontSize(state.messageFontSize, { persist: false });
applyLanguage(state.language, { persist: false });
registerServiceWorker();
setupPwaPullToRefresh();
setupEdgeSwipeBackNavigation();
setupAppVersionRefresh();
setupStreamRecoveryWatchdog();
document.addEventListener('visibilitychange', onVisibilityChange);
document.addEventListener('click', handleSessionSettingsOutsideClick);
document.addEventListener('keydown', handleFocusScopeKeydown);
window.addEventListener('resize', handleWindowResize);
window.addEventListener('pageshow', onPageResume);
window.addEventListener('focus', onPageResume);
window.addEventListener('online', onNetworkOnline);
window.addEventListener('storage', onSubmissionStorageChange);
window.addEventListener('pagehide', flushScheduledTimelineSave);

function bootstrap() {
  if (isShareRoute()) {
    render();
    void loadSharedSessionFromLocation();
    return;
  }
  if (!state.token) {
    render();
    setLoggedOut();
    return;
  }
  state.authSession = createCachedAuthSession();
  state.sessionsLoading = true;
  state.sessionsLoadingScope = currentSessionScope();
  state.status = 'Loading';
  state.statusTone = 'warn';
  restoreSessionsFromCacheForScope('all');
  restoreWorkspaceStateFromCache();
  render();
  void restoreAuth();
  if (workspaceRestoredFromCache) {
    connectActiveTurnStream({ forceReconnect: true });
  }
}

function isShareRoute() {
  return /^\/share\/[^/]+$/u.test(window.location?.pathname || '');
}

function shareTokenFromLocation() {
  const match = String(window.location?.pathname || '').match(/^\/share\/([^/]+)$/u);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

async function loadSharedSessionFromLocation() {
  if (sharedSessionLoadPromise) {
    return sharedSessionLoadPromise;
  }
  sharedSessionLoadPromise = loadSharedSessionFromLocationOnce().catch((error) => {
    sharedSessionLoadPromise = null;
    throw error;
  });
  return sharedSessionLoadPromise;
}

async function loadSharedSessionFromLocationOnce() {
  const token = shareTokenFromLocation();
  if (!token) {
    setLoggedOut('Shared session not found');
    return null;
  }
  state.token = '';
  state.authSession = {
    id: 'share',
    createdAt: '',
    lastSeenAt: '',
    principal: {
      mode: 'share',
      isAdmin: false,
    },
  };
  state.status = 'Loading session';
  state.statusTone = 'warn';
  state.view = 'chat';
  state.chatReturnView = 'sessions';
  render();
  try {
    const payload = await apiFetch(`/api/share/${encodeURIComponent(token)}/session`, { skipAuth: true });
    const session = {
      ...(payload?.session || {}),
      mode: payload?.mode || 'share',
      readOnly: true,
    };
    state.sessionId = session.id;
    state.currentSession = session;
    state.cwd = '';
    state.reports = normalizeReports({ items: payload?.reports });
    state.timelineCache = new Map();
    applySessionSettings(session);
    restoreTimelineForSession(session, { fullHistory: true });
    syncRuntimeStatusFromSession(session);
    state.timelineShouldFollowLatest = false;
    state.status = 'Ready';
    state.statusTone = 'success';
    state.error = '';
    render();
    scrollTimelineToTop();
    return session;
  } catch (error) {
    state.currentSession = null;
    state.sessionId = null;
    state.error = error?.payload?.message || error?.message || 'Shared session not found';
    state.status = 'Shared session not found';
    state.statusTone = 'danger';
    render();
    return null;
  }
}

async function restoreAuth() {
  const requestGeneration = authRequestGeneration;
  try {
    state.status = 'Restoring session';
    render();
    const { session } = await apiFetch('/api/auth/me');
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    const principalWasPending = isCachedAuthPrincipalPending();
    state.authSession = session;
    if (principalWasPending) {
      replayActiveTurnAfterPrincipalConfirmation();
    }
    resolvePendingWorkDetailsPolicy();
    state.status = 'Syncing sessions';
    state.statusTone = 'warn';
    render();
    const [settingsPayload, modelsPayload] = await Promise.all([
      refreshGlobalSettings({ renderAfter: false }).catch(() => null),
      apiFetch('/api/models').catch(() => ({ items: [], defaults: null })),
      refreshProjectsList({ renderAfter: false }).catch(() => []),
      refreshSessionsList({ renderAfter: false, scope: 'all' }).catch(() => null),
    ]);
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    state.authSession = session;
    applyGlobalSettingsPayload(settingsPayload, { renderAfter: false });
    state.models = Array.isArray(modelsPayload.items) ? modelsPayload.items : [];
    initializeDefaultThreadSettingsFromCodex(modelsPayload.defaults);
    if (!state.sessionId) {
      restoreWorkspaceStateFromCache();
    }
    if (state.sessionId && state.currentSession) {
      applySessionSettings(state.currentSession);
      const runtimeStatus = syncRuntimeStatusFromSession(state.currentSession, { source: 'stale' });
      if (runtimeStatus.activeTurnId) {
        restoreTurnEventCursor(state.sessionId, runtimeStatus.activeTurnId);
      }
    } else {
      applyDefaultSettings();
    }
    if (!state.pendingTurn) {
      state.status = 'Ready';
      state.statusTone = 'success';
    }
    state.error = '';
    render();
    if (state.sessionId && workspaceRestoredFromCache) {
      connectActiveTurnStream({ forceReconnect: true });
      void reconcileCurrentSessionInBackground();
    }
    void drainSubmissionOutbox({ force: true });
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    if (error?.status === 401 || error?.status === 403) {
      handleApiError(error, { auth: true });
      return;
    }
    state.status = 'Offline';
    state.statusTone = 'warn';
    state.error = error?.payload?.message || error?.message || 'Could not reconnect';
    render();
  }
}

function createCachedAuthSession() {
  return {
    id: 'cached',
    createdAt: '',
    lastSeenAt: '',
  };
}

function readWorkspaceState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_STATE_KEY) || 'null');
    const sessionId = typeof parsed?.sessionId === 'string' ? parsed.sessionId.trim() : '';
    return {
      view: parsed?.view === 'chat' && sessionId ? 'chat' : 'sessions',
      sessionId,
    };
  } catch (_error) {
    localStorage.removeItem(WORKSPACE_STATE_KEY);
    return { view: 'sessions', sessionId: '' };
  }
}

function restoreWorkspaceStateFromCache() {
  const saved = readWorkspaceState();
  if (saved.view !== 'chat' || !saved.sessionId || isShareRoute()) {
    return false;
  }
  const session = state.sessions.find((item) => item.id === saved.sessionId) || null;
  if (!session || isReadOnlySession(session)) {
    return false;
  }
  state.sessionId = session.id;
  state.currentSession = session;
  state.cwd = session.cwd || '';
  state.view = 'chat';
  state.chatReturnView = 'sessions';
  state.draftSessionActive = false;
  restorePromptDraftForSession(session.id);
  applySessionSettings(session);
  restoreTimelineForSession(session, readOnlyTimelineRestoreOptions(session));
  const runtimeStatus = syncRuntimeStatusFromSession(session, { source: 'stale' });
  if (runtimeStatus.activeTurnId) {
    restoreTurnEventCursor(session.id, runtimeStatus.activeTurnId);
  }
  setTimelineOpenPositionForSession(session);
  workspaceRestoredFromCache = true;
  passiveDesktopSessionId = '';
  return true;
}

function persistWorkspaceState({ view = state.view, sessionId = state.sessionId } = {}) {
  if (!state.token || isShareContext()) {
    return;
  }
  const normalizedSessionId = String(sessionId || '').trim();
  const canRestoreChat = view === 'chat'
    && normalizedSessionId
    && state.chatReturnView !== 'admin'
    && !normalizedSessionId.startsWith('local-submission:')
    && !isReadOnlySession(state.currentSession);
  try {
    localStorage.setItem(WORKSPACE_STATE_KEY, JSON.stringify({
      view: canRestoreChat ? 'chat' : 'sessions',
      sessionId: canRestoreChat ? normalizedSessionId : '',
      savedAt: Date.now(),
    }));
  } catch (error) {
    console.warn('[codex-web] workspace state persist failed', error);
  }
}

function clearWorkspaceState() {
  localStorage.removeItem(WORKSPACE_STATE_KEY);
}

function setLoggedOut(message = '') {
  authRequestGeneration += 1;
  workspaceRestoredFromCache = false;
  passiveDesktopSessionId = '';
  resetSendingSubmissionsAfterAuthChange();
  for (const controller of submissionRequestControllers.values()) {
    controller.abort();
  }
  submissionRequestControllers.clear();
  submissionDrainPromise = null;
  if (submissionRetryTimer) {
    clearTimeout(submissionRetryTimer);
    submissionRetryTimer = null;
  }
  cancelSessionFileLoad();
  clearSessionFileState();
  clearScheduledTimelineSave();
  localStorage.removeItem(SESSIONS_CACHE_KEY);
  localStorage.removeItem(TIMELINE_CACHE_KEY);
  clearWorkspaceState();
  state.authSession = null;
  state.sessions = [];
  state.sessionsByScope = {
    favorites: [],
    all: [],
    archived: [],
  };
  state.sessionsLoadedByScope = {
    favorites: false,
    all: false,
    archived: false,
  };
  state.sessionArchiveOverrides = new Map();
  state.sessionsLoading = false;
  state.sessionsLoadingScope = null;
  state.sessionsError = '';
  state.sessionsRequestId += 1;
  allSessionsPreloadPromise = null;
  state.reports = [];
  state.projects = [];
  state.projectsLoaded = false;
  state.newProjectId = '';
  resetAdminState();
  state.admin = {
    loading: false,
    loaded: false,
    settings: null,
    projects: [],
    users: [],
    roles: [],
    sessions: [],
    page: 'projects',
    filterUserId: '',
    filterProjectId: '',
    filterState: 'all',
    editingProjectId: '',
    editingRoleId: '',
    editingUserId: '',
    observedSession: null,
    observedSessionLoading: false,
  };
  state.sessionId = null;
  state.currentSession = null;
  state.activeSubmissionId = '';
  state.draftSessionActive = false;
  state.view = 'sessions';
  state.selectedProjectKey = '';
  state.selectedProjectId = '';
  state.selectedProjectLabel = '';
  state.mobileSidebarOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  state.shareDialog = null;
  state.webhook = createWebhookSettingsState();
  state.webhookRotateConfirmOpen = false;
  state.workDetailsOpen = false;
  state.workDetailsPolicyPendingSessionId = '';
  state.globalSettings = {
    siteTitle: state.siteTitle,
    canSetSiteTitle: false,
    publicSharesEnabled: false,
    loaded: false,
  };
  state.sortMode = 'time';
  state.sessionsScope = 'all';
  state.archiveConfirmSessionId = null;
  state.cwd = '';
  state.newCwd = '';
  state.turnId = null;
  state.pendingTurn = false;
  state.submissionSending = false;
  state.lastTurnEventSequence = null;
  state.lastTurnEventEpoch = '';
  state.lastTurnEventAt = 0;
  state.terminalTurnIds = new Set();
  state.streamWasBackgrounded = false;
  state.streamIncludesWorkDetails = false;
  state.timeline = [];
  resetSessionHistoryWindow();
  state.timelineCache = new Map();
  state.batches = new Map();
  state.approvals = new Map();
  state.status = 'Login required';
  state.statusTone = 'warn';
  state.error = '';
  state.loginError = message;
  state.prompt = '';
  state.promptDrafts = new Map();
  state.composerAttachments = [];
  applyDefaultSettings();
  stopStream();
  render();
}

function isAuthRequestCurrent(requestGeneration) {
  return requestGeneration === authRequestGeneration;
}

function render() {
  const shouldRestoreLatestTimeline = state.timelineShouldFollowLatest;
  const promptRestoreSnapshot = capturePromptRestoreState();
  beginRenderEventBindings();
  detachTimelineScrollTracking();
  clearManagedInert();
  app.innerHTML = '';
  if (state.setupRequired) {
    app.appendChild(renderSetup());
    bindGlobalEvents();
    bindTimelineActionEvents();
    resetComposerOffset();
    return;
  }
  if (!state.authSession) {
    app.appendChild(renderLogin());
    bindGlobalEvents();
    bindTimelineActionEvents();
    resetComposerOffset();
    return;
  }
  app.appendChild(renderMain());
  bindGlobalEvents();
  bindTimelineActionEvents();
  syncFocusScope();
  const timeline = document.querySelector('#timeline');
  if (timeline) {
    syncComposerOffset();
    const shouldStartAtEarliest = shouldOpenTimelineAtEarliest();
    attachTimelineScrollTracking({ updateInitial: !shouldRestoreLatestTimeline && !shouldStartAtEarliest });
    if (shouldStartAtEarliest) {
      scrollTimelineToTop();
      return;
    }
    if (shouldRestoreLatestTimeline) {
      scrollTimelineToBottom();
    }
  } else {
    resetComposerOffset();
  }
  if (state.view === 'sessions') {
    restoreSessionListScroll();
  }
  schedulePromptRestore(promptRestoreSnapshot);
}

function rememberFocusReturn(element = document.activeElement) {
  if (!element) {
    return;
  }
  const id = String(element.id || '').trim();
  if (id) {
    focusReturnTarget = { id };
    return;
  }
  for (const attribute of ['data-session-archive-request-id', 'data-session-id', 'data-session-file-path']) {
    const value = element.getAttribute?.(attribute);
    if (value) {
      focusReturnTarget = { attribute, value };
      return;
    }
  }
}

function requestFocusRestore() {
  pendingFocusRestore = true;
  activeFocusScopeKey = '';
}

function activeFocusScope() {
  if (state.webhookRotateConfirmOpen) {
    return { key: 'webhook-rotate', element: document.querySelector('[data-focus-scope="webhook-rotate"]') };
  }
  if (state.workDetailsOpen) {
    return { key: 'work-details', element: document.querySelector('[data-focus-scope="work-details"]') };
  }
  if (state.shareDialog?.url) {
    return { key: 'share-dialog', element: document.querySelector('[data-focus-scope="share-dialog"]') };
  }
  if (state.archiveConfirmSessionId) {
    return { key: 'archive-dialog', element: document.querySelector('[data-focus-scope="archive-dialog"]') };
  }
  if (state.desktopOverlay === 'file') {
    return { key: 'session-file', element: document.querySelector('[data-focus-scope="session-file"]') };
  }
  if (state.mobileSidebarOpen) {
    return { key: 'mobile-projects', element: document.querySelector('[data-focus-scope="mobile-projects"]') };
  }
  if (state.settingsOpen) {
    return { key: 'session-settings', element: document.querySelector('[data-focus-scope="session-settings"]') };
  }
  if (state.desktopSettingsOpen) {
    return { key: 'desktop-settings', element: document.querySelector('[data-focus-scope="desktop-settings"]') };
  }
  return { key: '', element: null };
}

function syncFocusScope() {
  clearManagedInert();
  const scope = activeFocusScope();
  const shouldRestore = pendingFocusRestore;
  if (scope.element) {
    makeBackgroundInert(scope.element);
  }
  if (shouldRestore) {
    pendingFocusRestore = false;
    activeFocusScopeKey = scope.key;
    const returnTarget = focusReturnTarget;
    focusReturnTarget = null;
    requestAnimationFrame(() => {
      (resolveFocusReturnTarget(returnTarget) || focusFallbackElement())?.focus?.();
    });
    return;
  }
  if (!scope.element) {
    activeFocusScopeKey = scope.key;
    return;
  }
  if (
    scope.key === activeFocusScopeKey
    && scope.element.contains?.(document.activeElement) === true
  ) {
    return;
  }
  activeFocusScopeKey = scope.key;
  requestAnimationFrame(() => {
    const latest = activeFocusScope();
    if (latest.key !== scope.key || !latest.element) {
      return;
    }
    const initial = latest.element.querySelector?.('[data-initial-focus]')
      || focusableElements(latest.element)[0]
      || latest.element;
    if (initial === latest.element && !latest.element.hasAttribute?.('tabindex')) {
      latest.element.setAttribute?.('tabindex', '-1');
    }
    initial.focus?.();
  });
}

function makeBackgroundInert(scope) {
  let current = scope;
  while (current && current !== app) {
    const parent = current.parentElement;
    if (!parent) {
      break;
    }
    for (const sibling of parent.children || []) {
      if (sibling !== current) {
        markManagedInert(sibling);
      }
    }
    current = parent;
  }
}

function markManagedInert(element) {
  if (!element || element.hasAttribute?.('data-codex-managed-inert')) {
    return;
  }
  element.setAttribute?.('data-codex-managed-inert', 'true');
  element.setAttribute?.('data-codex-previous-inert', String(Boolean(element.inert)));
  const previousAriaHidden = element.getAttribute?.('aria-hidden');
  element.setAttribute?.('data-codex-previous-aria-hidden', previousAriaHidden == null ? '' : previousAriaHidden);
  element.inert = true;
  element.setAttribute?.('aria-hidden', 'true');
}

function clearManagedInert() {
  for (const element of document.querySelectorAll('[data-codex-managed-inert]')) {
    const previousInert = element.getAttribute?.('data-codex-previous-inert') === 'true';
    const previousAriaHidden = element.getAttribute?.('data-codex-previous-aria-hidden');
    element.inert = previousInert;
    if (previousAriaHidden) {
      element.setAttribute?.('aria-hidden', previousAriaHidden);
    } else {
      element.removeAttribute?.('aria-hidden');
    }
    element.removeAttribute?.('data-codex-managed-inert');
    element.removeAttribute?.('data-codex-previous-inert');
    element.removeAttribute?.('data-codex-previous-aria-hidden');
  }
}

function focusableElements(scope) {
  if (!scope?.querySelectorAll) {
    return [];
  }
  return [...scope.querySelectorAll('a[href], button:not([disabled]), iframe, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.inert !== true && element.getAttribute?.('aria-hidden') !== 'true');
}

function resolveFocusReturnTarget(target) {
  if (!target) {
    return null;
  }
  if (target.id) {
    return document.querySelector(`#${target.id}`);
  }
  if (target.attribute && target.value) {
    return [...document.querySelectorAll(`[${target.attribute}]`)]
      .find((element) => element.getAttribute?.(target.attribute) === target.value) || null;
  }
  return null;
}

function focusFallbackElement() {
  return document.querySelector('#settings-toggle')
    || document.querySelector('#mobile-sidebar-toggle-button')
    || document.querySelector('#open-new-session-button')
    || document.querySelector('main');
}

function handleFocusScopeKeydown(event) {
  if (event.key === 'Escape' && closeFocusScope()) {
    event.preventDefault?.();
    event.stopPropagation?.();
    return;
  }
  if (event.key !== 'Tab') {
    return;
  }
  const scope = activeFocusScope().element;
  if (!scope) {
    return;
  }
  const focusable = focusableElements(scope);
  if (!focusable.length) {
    event.preventDefault?.();
    scope.focus?.();
    return;
  }
  const currentIndex = focusable.indexOf(document.activeElement);
  if (event.shiftKey && currentIndex <= 0) {
    event.preventDefault?.();
    focusable.at(-1)?.focus?.();
  } else if (!event.shiftKey && (currentIndex < 0 || currentIndex === focusable.length - 1)) {
    event.preventDefault?.();
    focusable[0]?.focus?.();
  }
}

function closeFocusScope(kind = '') {
  if ((!kind || kind === 'webhook-rotate') && state.webhookRotateConfirmOpen) {
    cancelWebhookKeyRotation();
    return true;
  }
  if ((!kind || kind === 'work-details') && state.workDetailsOpen) {
    closeWorkDetails();
    return true;
  }
  if ((!kind || kind === 'share') && state.shareDialog?.url) {
    closeShareDialog();
    return true;
  }
  if ((!kind || kind === 'archive') && state.archiveConfirmSessionId) {
    cancelArchiveSession();
    return true;
  }
  if ((!kind || kind === 'session-file') && (state.desktopOverlay === 'file' || state.view === 'file')) {
    closeSessionFileViewer();
    return true;
  }
  if ((!kind || kind === 'mobile-projects') && state.mobileSidebarOpen) {
    closeMobileSidebar();
    return true;
  }
  if ((!kind || kind === 'settings') && state.settingsOpen) {
    requestFocusRestore();
    state.settingsOpen = false;
    withTimelineScrollPreserved(() => render());
    return true;
  }
  if ((!kind || kind === 'desktop-settings') && state.desktopSettingsOpen) {
    requestFocusRestore();
    state.desktopSettingsOpen = false;
    render();
    return true;
  }
  return false;
}

function closeShareDialog() {
  if (!state.shareDialog) {
    return;
  }
  requestFocusRestore();
  state.shareDialog = null;
  render();
}

function resetSessionHistoryWindow() {
  cancelSessionTimelinePageLoad();
  state.sessionHistoryItems = [];
  state.sessionHistoryStartIndex = 0;
  state.timelineShouldFollowLatest = true;
}

function currentPromptDraftKey() {
  return state.sessionId || (state.draftSessionActive ? `draft:${state.cwd || 'default'}` : '');
}

function savePromptDraftForCurrentSession() {
  const key = currentPromptDraftKey();
  if (!key) {
    return;
  }
  const prompt = String(state.prompt || '');
  if (prompt) {
    state.promptDrafts.set(key, prompt);
  } else {
    state.promptDrafts.delete(key);
  }
}

function restorePromptDraftForSession(sessionId) {
  state.prompt = state.promptDrafts.get(sessionId) || '';
}

function clearPromptDraftForCurrentSession() {
  const key = currentPromptDraftKey();
  if (key) {
    state.promptDrafts.delete(key);
  }
  state.prompt = '';
}

function migrateDraftPromptToSession(sessionId) {
  if (!sessionId) {
    return;
  }
  const draftKey = `draft:${state.cwd || 'default'}`;
  if (state.promptDrafts.has(draftKey) && !state.promptDrafts.has(sessionId)) {
    state.promptDrafts.set(sessionId, state.promptDrafts.get(draftKey) || '');
  }
  state.promptDrafts.delete(draftKey);
}

function currentQueuedSessionId() {
  return state.sessionId || '';
}

function queuedMessagesForSession(sessionId) {
  if (!sessionId) {
    return [];
  }
  const messages = state.queuedMessages.get(sessionId);
  return Array.isArray(messages) ? messages : [];
}

function queuedMessagesForCurrentSession() {
  return queuedMessagesForSession(currentQueuedSessionId());
}

function pendingQueuedMessagesForSession(sessionId) {
  return queuedMessagesForSession(sessionId).filter((message) => message?.sending !== true);
}

function pendingQueuedMessagesForCurrentSession() {
  return pendingQueuedMessagesForSession(currentQueuedSessionId());
}

function enqueueQueuedMessage(sessionId, text) {
  const normalizedText = String(text || '').trim();
  if (!sessionId || !normalizedText) {
    return null;
  }
  const message = {
    id: `queued_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text: normalizedText,
    createdAt: new Date().toISOString(),
  };
  state.queuedMessages.set(sessionId, [...queuedMessagesForSession(sessionId), message]);
  persistQueuedMessages();
  return message;
}

function setQueuedMessageSending(sessionId, messageId, sending, { renderAfter = false } = {}) {
  if (!sessionId || !messageId) {
    return false;
  }
  const messages = queuedMessagesForSession(sessionId);
  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }
    changed = true;
    return {
      ...message,
      sending: Boolean(sending),
    };
  });
  if (!changed) {
    return false;
  }
  state.queuedMessages.set(sessionId, nextMessages);
  persistQueuedMessages();
  if (renderAfter) {
    render();
  }
  return true;
}

function restoreStaleQueuedMessagesForSession(sessionId) {
  if (!sessionId || state.pendingTurn || state.queuedMessageSending) {
    return false;
  }
  const messages = queuedMessagesForSession(sessionId);
  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message?.sending !== true) {
      return message;
    }
    changed = true;
    return {
      ...message,
      sending: false,
    };
  });
  if (!changed) {
    return false;
  }
  state.queuedMessages.set(sessionId, nextMessages);
  persistQueuedMessages();
  return true;
}

function removeQueuedMessage(sessionId, messageId) {
  if (!sessionId || !messageId) {
    return;
  }
  const nextMessages = queuedMessagesForSession(sessionId).filter((message) => message.id !== messageId);
  if (nextMessages.length) {
    state.queuedMessages.set(sessionId, nextMessages);
  } else {
    state.queuedMessages.delete(sessionId);
  }
  persistQueuedMessages();
  render();
}

function renderSetup() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="center-screen">
      <section class="panel stack">
        <div>
          <h1>${escapeHtml(t('Setup required'))}</h1>
          <p class="meta">${escapeHtml(translateText(state.setupMessage || 'Password not configured.'))}</p>
        </div>
        <pre class="command">codex-web auth set-password</pre>
      </section>
    </div>
  `;
  return localizeElement(shell);
}

function renderLogin() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="center-screen">
      <form class="panel stack" id="login-form">
        <div>
          <h1>${escapeHtml(state.siteTitle)}</h1>
          <p class="meta">${escapeHtml(t('Password login for this device.'))}</p>
        </div>
        <div class="field">
          <label for="username">${escapeHtml(t('Username'))}</label>
          <input id="username" name="username" type="text" autocomplete="username">
        </div>
        <div class="field">
          <label for="password">${escapeHtml(t('Password'))}</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        ${state.loginError ? `<p class="meta" style="color: var(--danger);">${escapeHtml(translateText(state.loginError))}</p>` : ''}
        <div class="actions">
          <button class="primary primary-action" type="submit">${escapeHtml(t('Log in'))}</button>
        </div>
      </form>
    </div>
  `;
  return localizeElement(shell);
}

function renderMain() {
  if (isShareView()) {
    return renderSharedSessionPage();
  }
  if (isDesktopWorkspaceView()) {
    return renderDesktopWorkspace();
  }
  if (state.view === 'settings') {
    return renderAppSettings();
  }
  if (state.view === 'admin') {
    return renderAdminConsole();
  }
  if (state.view === 'file') {
    return renderSessionFileViewer();
  }
  if (state.view === 'new') {
    return renderNewSession();
  }
  if (state.view === 'chat') {
    return renderChat();
  }
  return renderSessionList();
}

function isShareView() {
  return state.authSession?.principal?.mode === 'share'
    || state.currentSession?.mode === 'share'
    || isShareRoute();
}

function isShareContext() {
  return isShareView();
}

function renderSharedSessionPage() {
  const shell = document.createElement('div');
  shell.className = 'shell shared-session-shell';
  const loading = state.status === 'Loading session' && !state.currentSession;
  const errorText = state.error || state.loginError || '';
  const fileOpen = state.currentSession && state.view === 'file';
  shell.innerHTML = `
    <div class="shared-session-page${fileOpen ? ' shared-file-page' : ''}">
      ${fileOpen ? renderSessionFileViewerContent() : state.currentSession ? `
        <main class="timeline shared-session-timeline" id="timeline" data-i18n-skip>${renderTimeline()}</main>
      ` : `
        <main class="shared-session-empty">
          <div class="empty-state">${escapeHtml(loading ? t('Loading session') : translateText(errorText || 'Shared session not found'))}</div>
        </main>
      `}
    </div>
  `;
  return localizeElement(shell);
}

function renderDesktopWorkspace() {
  ensureDesktopActiveSession();
  const shell = document.createElement('div');
  shell.className = 'shell desktop-shell';
  shell.innerHTML = `
    <div class="desktop-workspace">
      ${renderDesktopProjectRail()}
      ${renderDesktopSessionPane()}
      <div class="desktop-workspace-pane-stack">
        ${renderDesktopChatPane()}
        ${state.desktopSettingsOpen ? renderDesktopSettingsPanel() : ''}
        ${state.desktopOverlay === 'file' ? renderDesktopSessionFileOverlay() : ''}
      </div>
    </div>
    ${renderArchiveConfirmModal()}
    ${renderWebhookDialogs()}
  `;
  return localizeElement(shell);
}

function renderDesktopProjectRail() {
  return `
    <aside class="desktop-project-rail">
      <header class="project-rail-header">
        <div class="project-rail-brand">${escapeHtml(state.siteTitle)}</div>
        <div class="project-rail-meta">${escapeHtml(currentProjectScopeTitle())}</div>
      </header>
      <nav class="project-rail-list" aria-label="${escapeAttribute(t('Projects'))}" data-i18n-skip>
        ${renderWorkspaceProjectList()}
      </nav>
      <div class="project-rail-footer">
        ${renderWorkspaceRailActions()}
      </div>
    </aside>
  `;
}

function renderDesktopSessionPane() {
  return `
    <section class="desktop-session-pane">
      ${renderSessionListHeader({ desktop: true })}
      <main class="session-list desktop-session-list" aria-busy="${String(isCurrentSessionScopeLoading())}" data-i18n-skip>${renderSessionCards()}</main>
    </section>
  `;
}

function renderDesktopChatPane() {
  if (state.view === 'new') {
    return `
      <section class="desktop-chat-pane desktop-new-pane">
        ${renderNewSessionContent({ desktop: true })}
      </section>
    `;
  }
  if (!state.currentSession && !state.sessionId && !state.cwd && !state.draftSessionActive) {
    return `
      <section class="desktop-chat-pane desktop-empty-pane">
        <div class="desktop-empty-state">
          <h2>No active session</h2>
          <p class="meta">Select a session in the middle pane or start a new one.</p>
          <button class="primary primary-action" type="button" id="desktop-empty-new-session-button">Start a new session</button>
        </div>
      </section>
    `;
  }
  return `
    <section class="desktop-chat-pane">
      ${renderChatContent({ desktop: true })}
    </section>
  `;
}

function ensureDesktopActiveSession() {
  if (!isDesktopLayout() || state.view === 'new' || state.sessionId || state.currentSession || state.draftSessionActive) {
    return;
  }
  const [firstSession] = sortedSessions();
  if (!firstSession) {
    return;
  }
  state.sessionId = firstSession.id;
  state.currentSession = firstSession;
  state.cwd = firstSession.cwd || '';
  passiveDesktopSessionId = firstSession.id;
  applySessionSettings(firstSession);
  restoreTimelineForSession(firstSession);
  syncRuntimeStatusFromSession(firstSession, { source: 'stale' });
}

function hasDesktopPointer() {
  return typeof window?.matchMedia === 'function'
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
    : false;
}

function isDesktopLayout() {
  const viewportWidth = typeof window?.innerWidth === 'number' ? window.innerWidth : 0;
  const viewportHeight = typeof window?.innerHeight === 'number' ? window.innerHeight : 0;
  return hasDesktopPointer()
    && viewportWidth >= DESKTOP_WORKSPACE_MIN_WIDTH
    && viewportWidth > viewportHeight;
}

function isDesktopWorkspaceView() {
  return isDesktopLayout() && ['sessions', 'chat', 'new'].includes(state.view);
}

function handleWindowResize() {
  const previousWidth = lastViewportWidth;
  const previousHeight = lastViewportHeight;
  const nextWidth = typeof window?.innerWidth === 'number' ? window.innerWidth : previousWidth;
  const nextHeight = typeof window?.innerHeight === 'number' ? window.innerHeight : previousHeight;
  lastViewportWidth = nextWidth;
  lastViewportHeight = nextHeight;
  if (isMobileKeyboardResize(previousWidth, previousHeight, nextWidth, nextHeight)) {
    return;
  }
  handleLayoutResize();
  render();
}

function isMobileKeyboardResize(previousWidth, previousHeight, nextWidth, nextHeight) {
  if (isDesktopLayout() || previousWidth <= 0 || previousHeight <= 0) {
    return false;
  }
  if (previousWidth !== nextWidth || previousHeight === nextHeight) {
    return false;
  }
  return isTextEntryElement(document.activeElement);
}

function isTextEntryElement(element) {
  const tagName = String(element?.tagName || '').toLowerCase();
  return tagName === 'textarea'
    || tagName === 'select'
    || (tagName === 'input' && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(String(element?.type || '').toLowerCase()));
}

function handleLayoutResize() {
  if (isDesktopLayout()) {
    state.mobileSidebarOpen = false;
    if (state.view === 'file') {
      state.view = 'sessions';
      state.desktopOverlay = 'file';
    }
    return;
  }
  passiveDesktopSessionId = '';
  state.desktopSettingsOpen = false;
  if (state.desktopOverlay === 'file') {
    state.desktopOverlay = null;
    state.view = 'file';
    return;
  }
  state.desktopOverlay = null;
  if (state.sessionId) {
    state.view = 'chat';
    return;
  }
  state.view = 'sessions';
}

function renderSessionList() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    ${renderMobileProjectDrawer()}
    <div class="screen page-screen">
      ${renderSessionListHeader()}
      <main class="session-list" aria-busy="${String(isCurrentSessionScopeLoading())}" data-i18n-skip>${renderSessionCards()}</main>
    </div>
    ${renderArchiveConfirmModal()}
  `;
  return localizeElement(shell);
}

function renderSessionListHeader({ desktop = false } = {}) {
  const sortToggle = renderSessionSortToggle({ mobile: !desktop });
  if (!desktop) {
    return `
      <header class="topbar page-topbar mobile-session-topbar">
        <div class="topbar-main">
          <button class="ghost page-back-button mobile-sidebar-toggle-button" type="button" id="mobile-sidebar-toggle-button" aria-label="Projects">${renderSidebarButtonIcon()}</button>
          <div class="mobile-session-actions">
            ${sortToggle}
            <button class="ghost icon-button mobile-new-session-button" type="button" id="open-new-session-button" aria-label="New session" title="New session"><span aria-hidden="true">+</span></button>
          </div>
        </div>
      </header>
  `;
  }
  return `
      <header class="topbar page-topbar${desktop ? ' desktop-session-pane-topbar' : ''}">
        <div class="topbar-main">
          <div class="page-title">Sessions</div>
          <div class="topbar-actions">
            <button class="ghost compact-button" type="button" id="open-new-session-button">New</button>
          </div>
        </div>
        <div class="list-actions">
          ${sortToggle}
        </div>
      </header>
  `;
}

function renderSessionSortToggle({ mobile = false } = {}) {
  return `
          <div class="toggle sort-toggle${mobile ? ' mobile-session-sort-toggle' : ''}">
            <button type="button" data-sort-mode="favorites" aria-pressed="${String(state.sortMode === 'favorites')}">Favorites</button>
            <button type="button" data-sort-mode="time" aria-pressed="${String(state.sortMode === 'time')}">Recents</button>
            <button class="archive-sort-button" type="button" data-sort-mode="archived" aria-pressed="${String(state.sortMode === 'archived')}" aria-label="Archived sessions" title="Archived sessions">
              <svg class="archive-sort-icon" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
                <path d="M224 322.6h576c16.6 0 30-13.4 30-30s-13.4-30-30-30H224c-16.6 0-30 13.4-30 30 0 16.5 13.5 30 30 30zM290.1 178.4h443.8c16.6 0 30-13.4 30-30s-13.4-30-30-30H290.1c-16.6 0-30 13.4-30 30s13.4 30 30 30zM629.6 613.9H394.4c-16.6 0-30 13.4-30 30s13.4 30 30 30h235.2c16.6 0 30-13.4 30-30s-13.4-30-30-30z"></path>
                <path d="M850.3 403.9H173.7c-33 0-60 27-60 60v360c0 33 27 60 60 60h676.6c33 0 60-27 60-60v-360c0-33-27-60-60-60z m-0.1 419.8l-0.1 0.1H173.9l-0.1-0.1V464l0.1-0.1h676.2l0.1 0.1v359.7z"></path>
              </svg>
              <span class="visually-hidden">Archived</span>
            </button>
          </div>
        `;
}

function renderDesktopSessionFileOverlay() {
  return localizeFragment(`
    <section class="desktop-overlay desktop-session-file-overlay" role="dialog" aria-modal="true" aria-label="File preview" data-focus-scope="session-file">
      <div class="desktop-overlay-card desktop-session-file-card">
        ${renderSessionFileViewerContent()}
      </div>
    </section>
  `);
}

function renderSessionFileViewer() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen page-screen session-file-screen">
      ${renderSessionFileViewerContent()}
    </div>
  `;
  return localizeElement(shell);
}

function renderSessionFileViewerContent(file = state.currentSessionFile) {
  const title = file?.name || fileNameFromPath(state.currentSessionFilePath) || t('File');
  const canDownload = Boolean(state.currentSessionFileObjectUrl && file);
  const activityState = sessionActivityState(state.currentSession);
  const activityLabel = activityState === 'waiting_approval'
    ? 'Needs approval'
    : activityState === 'running'
      ? 'Working'
      : '';
  return `
    <header class="topbar page-topbar session-file-topbar">
      <div class="page-nav">
        <button class="ghost page-back-button" type="button" id="close-session-file-button" aria-label="Back" data-initial-focus>${renderBackButtonIcon()}</button>
        <div class="session-file-title-stack">
          <div class="page-title" data-i18n-skip title="${escapeAttribute(title)}">${escapeHtml(title)}</div>
          ${activityLabel ? `<span class="session-file-activity" data-state="${escapeAttribute(activityState)}">${escapeHtml(t(activityLabel))}</span>` : ''}
        </div>
        ${canDownload
          ? `<a class="ghost page-nav-action session-file-download" id="session-file-download" href="${escapeAttribute(state.currentSessionFileObjectUrl)}" download="${escapeAttribute(title)}" aria-label="Download" title="Download">${renderDownloadButtonIcon()}</a>`
          : `<button class="ghost page-nav-action session-file-download" type="button" aria-label="Download" title="Download" disabled>${renderDownloadButtonIcon()}</button>`}
      </div>
    </header>
    <main class="session-file-viewer">${renderSessionFileViewerBody(file)}</main>
  `;
}

function renderSessionFileViewerBody(file = state.currentSessionFile) {
  if (state.currentSessionFileLoading) {
    return localizeFragment('<div class="empty-state session-file-loading">Loading file...</div>');
  }
  if (state.currentSessionFileError) {
    return `
      <div class="session-file-error" role="alert">
        <strong>${escapeHtml(t(sessionFileErrorMessage(state.currentSessionFileError)))}</strong>
        <button class="ghost compact-button" type="button" id="retry-session-file-button">${escapeHtml(t('Retry'))}</button>
      </div>
    `;
  }
  if (!file) {
    return `<div class="empty-state">${escapeHtml(t('File not loaded.'))}</div>`;
  }
  return renderSessionFileDocument(file);
}

function renderSessionFileDocument(file) {
  if (file.kind === 'html') {
    return `<iframe class="session-file-frame session-file-html" title="${escapeAttribute(file.name || t('File'))}" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeAttribute(sandboxedSessionFileHtml(state.currentSessionFileContent || ''))}"></iframe>`;
  }
  if (file.kind === 'pdf' && state.currentSessionFileObjectUrl) {
    return `<iframe class="session-file-frame session-file-pdf" title="${escapeAttribute(file.name || t('File'))}" src="${escapeAttribute(state.currentSessionFileObjectUrl)}"></iframe>`;
  }
  if (file.kind === 'image' && state.currentSessionFileObjectUrl) {
    return `<div class="session-file-image-stage"><img class="session-file-image" src="${escapeAttribute(state.currentSessionFileObjectUrl)}" alt="${escapeAttribute(file.name || t('File'))}"></div>`;
  }
  if (file.kind === 'file') {
    return `
      <div class="session-file-generic">
        <strong data-i18n-skip>${escapeHtml(file.name || t('File'))}</strong>
        <span class="meta" data-i18n-skip>${escapeHtml(sessionFileMetadata(file))}</span>
        ${state.currentSessionFileObjectUrl ? `<a class="primary compact-button" href="${escapeAttribute(state.currentSessionFileObjectUrl)}" download="${escapeAttribute(file.name || 'download')}">${escapeHtml(t('Download'))}</a>` : ''}
      </div>
    `;
  }
  return `<div class="session-file-document markdown-body" data-i18n-skip>${renderMarkdown(state.currentSessionFileContent || '')}</div>`;
}

function sandboxedSessionFileHtml(content) {
  return `<meta http-equiv="Content-Security-Policy" content="${SESSION_FILE_HTML_CSP}">${String(content || '')}`;
}

function renderAppSettings() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen page-screen">
      ${renderPageNav('Settings')}
      <main class="app-settings-page">
        ${renderAppSettingsSections()}
      </main>
    </div>
    ${renderWebhookDialogs()}
  `;
  return localizeElement(shell);
}

function renderDesktopSettingsPanel() {
  return localizeFragment(`
    <aside class="desktop-settings-panel" role="dialog" aria-modal="true" aria-labelledby="desktop-settings-title" data-focus-scope="desktop-settings">
      <header class="desktop-panel-header">
        <h2 id="desktop-settings-title">Settings</h2>
        <button class="ghost compact-button" type="button" id="desktop-settings-close-button" data-initial-focus>Close</button>
      </header>
      <main class="app-settings-page desktop-settings-body">
        ${renderAppSettingsSections()}
      </main>
    </aside>
  `);
}

function renderAppSettingsSections() {
  return `
        ${renderSiteTitleSettingsSection()}
        ${renderAppearanceSettingsSection()}
        ${renderDefaultThreadSettingsSection()}
        ${renderWebhookSettingsSection()}
        ${renderAdminSettingsSection({ title: 'Administration', showLoadingNote: true })}
        ${renderRuntimeSettingsSection()}
        <section class="settings-section">
          <div class="settings-section-title">Account</div>
          <button class="danger compact-button full-width-button" type="button" id="settings-logout-button">Log out</button>
        </section>
  `;
}

function renderAppearanceSettingsSection() {
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
              ${THEMES.map((theme) => `
                <button class="theme-option" type="button" data-app-theme="${escapeAttribute(theme.id)}" aria-pressed="${String(state.theme === theme.id)}">
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

function renderDefaultThreadSettingsSection() {
  return `
        <section class="settings-section default-thread-settings-section">
          <div class="settings-section-title">New sessions on this device</div>
          ${renderThreadSettingsControls({ defaults: true })}
        </section>
  `;
}

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

function renderRuntimeSettingsSection() {
  if (isManagedMultiUserPrincipal()) {
    return '';
  }
  return `
        <section class="settings-section">
          <div class="settings-section-title">Advanced</div>
          <div class="settings-action-row">
            <span class="meta">Runtime</span>
            <button class="ghost compact-button" type="button" id="runtime-reload-button">Reload</button>
          </div>
        </section>
  `;
}

function renderSiteTitleSettingsSection() {
  if (!canSetSiteTitle()) {
    return '';
  }
  const siteTitle = normalizeSiteTitle(state.globalSettings.siteTitle || state.siteTitle);
  return `
        <section class="settings-section">
          <div class="settings-section-title">Website title</div>
          <div class="control-group">
            <label for="site-title-input">Browser title</label>
            <input id="site-title-input" name="siteTitle" type="text" value="${escapeAttribute(siteTitle)}" placeholder="${escapeAttribute(DEFAULT_SITE_TITLE)}">
          </div>
        </section>
  `;
}

function renderAdminSettingsSection({ title = 'System', showLoadingNote = false } = {}) {
  if (!isAdminPrincipal()) {
    return '';
  }
  const adminSettingsLoaded = state.admin.settings !== null;
  return `
        <section class="settings-section${title === 'System' ? ' admin-summary-section' : ''}">
          <div class="settings-section-title">${escapeHtml(title)}</div>
          <label class="settings-action-row admin-toggle-row">
            <span class="meta">Multi-user mode</span>
            <input id="admin-multi-user-toggle" type="checkbox"${state.admin.settings?.multiUserEnabled === true ? ' checked' : ''}${adminSettingsLoaded ? '' : ' disabled'}>
          </label>
          ${showLoadingNote && !adminSettingsLoaded ? '<div class="meta">Loading admin settings...</div>' : ''}
        </section>
  `;
}

function renderAdminConsole() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen page-screen admin-console-screen">
      ${renderPageNav('Admin Console')}
      <main class="admin-console-page">
        ${renderAdminSections()}
      </main>
    </div>
  `;
  return localizeElement(shell);
}

function renderAdminSections() {
  if (state.admin.loading && !state.admin.loaded) {
    return localizeFragment('<div class="empty-state">Loading admin console...</div>');
  }
  return `
        ${renderAdminSettingsSection()}
        <div class="admin-layout">
          ${renderAdminSidebar()}
          <section class="admin-content">
            ${renderAdminContent()}
          </section>
          ${renderAdminObservedSessionPanel()}
        </div>
  `;
}

function renderAdminSidebar() {
  const page = currentAdminPage();
  const pages = [
    ['projects', 'Project Management'],
    ['roles', 'Role Management'],
    ['users', 'User Management'],
    ['sessions', 'Session Audit'],
  ];
  return `
    <nav class="admin-sidebar" aria-label="Admin sections">
      ${pages.map(([id, label]) => `
        <button class="admin-sidebar-button" type="button" data-admin-page="${escapeAttribute(id)}" aria-pressed="${String(page === id)}">${escapeHtml(t(label))}</button>
      `).join('')}
    </nav>
  `;
}

function renderAdminContent() {
  switch (currentAdminPage()) {
    case 'roles':
      return renderAdminRolePage();
    case 'users':
      return renderAdminUserPage();
    case 'sessions':
      return renderAdminSessionAuditPage();
    case 'projects':
    default:
      return renderAdminProjectPage();
  }
}

function renderAdminProjectPage() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">${escapeHtml(t('Project Management'))}</div>
          ${renderAdminProjectForm()}
          <div class="admin-list" data-i18n-skip>${renderAdminProjects()}</div>
        </section>
  `;
}

function renderAdminRolePage() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">${escapeHtml(t('Role Management'))}</div>
          ${renderAdminRoleForm()}
          <div class="admin-list" data-i18n-skip>${renderAdminRoles()}</div>
        </section>
  `;
}

function renderAdminUserPage() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">${escapeHtml(t('User Management'))}</div>
          ${renderAdminUserForm()}
          <div class="admin-list" data-i18n-skip>${renderAdminUsers()}</div>
        </section>
        `;
}

function renderBackButtonIcon() {
  return `
    <svg class="button-icon button-icon-back" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d="M631.04 161.941333a42.666667 42.666667 0 0 1 63.061333 57.386667l-2.474666 2.730667-289.962667 292.245333 289.706667 287.402667a42.666667 42.666667 0 0 1 2.730666 57.6l-2.474666 2.752a42.666667 42.666667 0 0 1-57.6 2.709333l-2.752-2.474667-320-317.44a42.666667 42.666667 0 0 1-2.709334-57.6l2.474667-2.752 320-322.56z"></path>
    </svg>
  `;
}

function renderDownloadButtonIcon() {
  return `
    <svg class="button-icon button-icon-download" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function renderMoreButtonIcon() {
  return `
    <svg class="button-icon button-icon-more" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d="M288 512m-64 0a64 64 0 1 0 128 0 64 64 0 1 0-128 0Z"></path>
      <path d="M512 512m-64 0a64 64 0 1 0 128 0 64 64 0 1 0-128 0Z"></path>
      <path d="M736 512m-64 0a64 64 0 1 0 128 0 64 64 0 1 0-128 0Z"></path>
    </svg>
  `;
}

function renderSidebarButtonIcon() {
  return `
    <svg class="button-icon button-icon-sidebar" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d="M66.488889 211.781818h891.022222c28.198788 0 50.980202-22.238384 50.980202-49.648485 0-27.397172-22.768485-49.648485-50.980202-49.648485H66.488889C38.341818 112.484848 15.508687 134.723232 15.508687 162.133333s22.833131 49.648485 50.980202 49.648485z m891.009293 248.242424H66.488889C38.277172 460.024242 15.508687 482.262626 15.508687 509.672727s22.768485 49.648485 50.980202 49.648485h891.022222c28.198788 0 50.980202-22.238384 50.980202-49.648485-0.012929-27.410101-22.923636-49.648485-50.993131-49.648485z m0 351.63798H66.488889c-28.134141 0-50.980202 22.238384-50.980202 49.648485s22.833131 49.648485 50.980202 49.648485h891.022222c28.198788 0 50.980202-22.238384 50.980202-49.648485-0.012929-27.397172-22.781414-49.648485-50.993131-49.648485z m0 0"></path>
    </svg>
  `;
}

function renderAdminSessionAuditPage() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">${escapeHtml(t('Session Audit'))}</div>
          <div class="admin-filter-row">
            <label class="field" for="admin-session-user-filter">
              <span>${escapeHtml(t('User'))}</span>
              <select id="admin-session-user-filter" name="adminUserFilter" data-i18n-skip>
                <option value="">${escapeHtml(t('All users'))}</option>
                ${state.admin.users.map((user) => `
              <option value="${escapeAttribute(user.id)}"${state.admin.filterUserId === user.id ? ' selected' : ''} data-i18n-skip>${escapeHtml(user.username || user.id)}</option>
                `).join('')}
              </select>
            </label>
            <label class="field" for="admin-session-project-filter">
              <span>${escapeHtml(t('Project'))}</span>
              <select id="admin-session-project-filter" name="adminProjectFilter" data-i18n-skip>
                <option value="">${escapeHtml(t('All projects'))}</option>
                ${adminAuditProjects().map((project) => `
                  <option value="${escapeAttribute(project.id)}"${state.admin.filterProjectId === project.id ? ' selected' : ''} data-i18n-skip>${escapeHtml(projectVisibleName(project, project.id))}</option>
                `).join('')}
              </select>
            </label>
            <label class="field" for="admin-session-state-filter">
              <span>${escapeHtml(t('Session'))}</span>
              <select id="admin-session-state-filter" name="adminSessionStateFilter" data-i18n-skip>
                <option value="all"${state.admin.filterState === 'all' ? ' selected' : ''}>${escapeHtml(t('All Sessions'))}</option>
                <option value="active"${state.admin.filterState === 'active' ? ' selected' : ''}>${escapeHtml(t('Active sessions'))}</option>
                <option value="archived"${state.admin.filterState === 'archived' ? ' selected' : ''}>${escapeHtml(t('Archived sessions'))}</option>
              </select>
            </label>
          </div>
          <div class="admin-list" data-i18n-skip>${renderAdminSessions()}</div>
        </section>
  `;
}

function renderAdminObservedSessionPanel() {
  if (currentAdminPage() !== 'sessions' || !isDesktopLayout()) {
    return '';
  }
  if (state.admin.observedSessionLoading && !state.admin.observedSession) {
    return `
      <section class="admin-observed-panel">
        <div class="empty-state">${escapeHtml(t('Loading session'))}</div>
      </section>
    `;
  }
  if (!state.admin.observedSession) {
    return '';
  }
  return `
      <section class="admin-observed-panel" data-i18n-skip>
        ${renderChatContent({ desktop: true })}
      </section>
  `;
}

function renderLegacyAdminSections() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">Sessions</div>
          <div class="field">
            <label for="admin-session-user-filter">User</label>
            <select id="admin-session-user-filter" name="adminUserFilter">
              <option value="">All users</option>
              ${state.admin.users.map((user) => `
                <option value="${escapeAttribute(user.id)}"${state.admin.filterUserId === user.id ? ' selected' : ''} data-i18n-skip>${escapeHtml(user.username || user.id)}</option>
              `).join('')}
            </select>
          </div>
          <div class="admin-list">${renderAdminSessions()}</div>
        </section>
  `;
}

function renderAdminProjectForm() {
  const project = adminEditingProject();
  return `
    <form class="admin-form" id="admin-project-form">
      <div class="admin-form-grid">
        <label class="field">
          <span>Display Name</span>
          <input name="displayName" autocomplete="off" placeholder="auto from CWD" value="${escapeAttribute(project?.displayName || '')}">
        </label>
        <label class="field">
          <span>CWD</span>
          <input name="cwd" autocomplete="off" placeholder="/Users/name/repo" value="${escapeAttribute(project?.cwd || '')}">
        </label>
        <label class="field">
          <span>Active sessions</span>
          <input name="activeSessionLimit" type="number" min="1" inputmode="numeric" placeholder="30" value="${escapeAttribute(project?.activeSessionLimit == null ? '' : String(project.activeSessionLimit))}">
        </label>
      </div>
      <label class="admin-check-row">
        <input name="enabled" type="checkbox"${project?.enabled === false ? '' : ' checked'}>
        <span>Enabled</span>
      </label>
      <label class="admin-check-row">
        <input name="showWorkDetailsToMembers" type="checkbox"${project?.showWorkDetailsToMembers === false ? '' : ' checked'}>
        <span>Members can view work details</span>
      </label>
      <div class="admin-form-actions">
        <button class="primary compact-button" type="submit">Save Project</button>
        ${project ? '<button class="ghost compact-button" type="button" id="admin-project-edit-cancel">Cancel</button>' : ''}
      </div>
    </form>
  `;
}

function renderAdminRoleForm() {
  const role = adminEditingRole();
  return `
    <form class="admin-form" id="admin-role-form">
      <div class="admin-form-grid">
        <label class="field">
          <span>Role ID</span>
          <input name="id" autocomplete="off" placeholder="role_writer" value="${escapeAttribute(role?.id || '')}">
        </label>
        <label class="field">
          <span>Name</span>
          <input name="name" autocomplete="off" placeholder="Writer" value="${escapeAttribute(role?.name || '')}">
        </label>
      </div>
      ${renderAdminProjectCheckboxes(adminRoleProjectIds(role))}
      <div class="admin-form-actions">
        <button class="primary compact-button" type="submit">Save Role</button>
        ${role ? '<button class="ghost compact-button" type="button" id="admin-role-edit-cancel">Cancel</button>' : ''}
      </div>
    </form>
  `;
}

function renderAdminUserForm() {
  const user = adminEditingUser();
  const isEditing = Boolean(user);
  return `
    <form class="admin-form" id="admin-user-form">
      <div class="admin-form-grid">
        <label class="field">
          <span>Username</span>
          <input name="username" autocomplete="username" placeholder="writer" value="${escapeAttribute(user?.username || '')}"${isEditing ? ' readonly' : ''}>
        </label>
        <label class="field">
          <span>Email</span>
          <input name="email" type="email" autocomplete="email" placeholder="writer@example.com" value="${escapeAttribute(user?.email || '')}">
        </label>
        ${isEditing ? '' : `
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" autocomplete="new-password" placeholder="At least 8 chars">
        </label>
        `}
      </div>
      <label class="admin-check-row">
        <input name="enabled" type="checkbox"${user?.enabled === false ? '' : ' checked'}>
        <span>Enabled</span>
      </label>
      <label class="field">
        <span>Role</span>
        ${renderAdminRoleSelect({ id: 'admin-user-role-select', name: 'roleId', value: adminUserRoleId(user) })}
      </label>
      <div class="admin-form-actions">
        <button class="primary compact-button" type="submit">${escapeHtml(t(isEditing ? 'Save' : 'Save User'))}</button>
        ${isEditing ? '<button class="ghost compact-button" type="button" id="admin-user-edit-cancel">Cancel</button>' : ''}
      </div>
    </form>
  `;
}

function renderAdminRoleSelect({ id = 'admin-user-role-select', name = 'roleId', value = '' } = {}) {
  if (!state.admin.roles.length) {
    return `<select id="${escapeAttribute(id)}" name="${escapeAttribute(name)}" data-i18n-skip><option value="">${escapeHtml(t('No roles available'))}</option></select>`;
  }
  const selectedValue = String(value || '');
  return `
    <select id="${escapeAttribute(id)}" name="${escapeAttribute(name)}" data-i18n-skip>
      <option value=""${selectedValue ? '' : ' selected'}>${escapeHtml(t('No role'))}</option>
      ${state.admin.roles.map((role) => `
        <option value="${escapeAttribute(role.id)}"${role.id === selectedValue ? ' selected' : ''} data-i18n-skip>${escapeHtml(role.name || role.id)}</option>
      `).join('')}
    </select>
  `;
}

function renderAdminProjectCheckboxes(selectedProjectIds = [], { name = 'projectIds', legend = 'Projects' } = {}) {
  if (!state.admin.projects.length) {
    return `<div class="meta">${escapeHtml(t('No projects available.'))}</div>`;
  }
  const selected = new Set(selectedProjectIds);
  return `
    <fieldset class="admin-fieldset">
      <legend>${escapeHtml(t(legend))}</legend>
      ${state.admin.projects.map((project) => `
        <label class="admin-check-row">
          <input name="${escapeAttribute(name)}" type="checkbox" value="${escapeAttribute(project.id)}"${selected.has(project.id) ? ' checked' : ''}>
          <span data-i18n-skip>${escapeHtml(adminProjectVisibleName(project))}</span>
        </label>
      `).join('')}
    </fieldset>
  `;
}

function renderAdminProjects() {
  if (!state.admin.projects.length) {
    return `<div class="meta">${escapeHtml(t('No projects configured.'))}</div>`;
  }
  return `
    <table class="admin-table admin-project-table">
      <thead>
        <tr>
          <th>${escapeHtml(t('CWD'))}</th>
          <th>${escapeHtml(t('Display Name'))}</th>
          <th>${escapeHtml(t('Work details'))}</th>
          <th>${escapeHtml(t('Action'))}</th>
        </tr>
      </thead>
      <tbody>
        ${state.admin.projects.map((project) => `
          <tr>
            <td data-label="${escapeAttribute(t('CWD'))}" data-i18n-skip>${escapeHtml(project.cwd || project.id || '')}</td>
            <td data-label="${escapeAttribute(t('Display Name'))}" data-i18n-skip>${escapeHtml(adminProjectVisibleName(project))}</td>
            <td data-label="${escapeAttribute(t('Work details'))}">${escapeHtml(t(project.showWorkDetailsToMembers === false ? 'Admin only' : 'Members'))}</td>
            <td data-label="${escapeAttribute(t('Action'))}"><button class="ghost compact-button" type="button" data-admin-edit-project="${escapeAttribute(project.id || '')}">${escapeHtml(t('Edit'))}</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderAdminUsers() {
  if (!state.admin.users.length) {
    return `<div class="meta">${escapeHtml(t('No users configured.'))}</div>`;
  }
  return state.admin.users.map((user) => {
    return `
      <article class="admin-row admin-user-row">
        <div>
          <span class="admin-row-main" data-i18n-skip>${escapeHtml(user.username || user.id)}</span>
          <span class="admin-row-meta" data-i18n-skip>${escapeHtml(adminUserMeta(user))}</span>
        </div>
        <div class="admin-user-action-row">
          <button class="ghost compact-button" type="button" data-admin-edit-user="${escapeAttribute(user.id || '')}">${escapeHtml(t('Edit'))}</button>
          <button class="ghost compact-button" type="button" data-admin-toggle-user-id="${escapeAttribute(user.id || '')}" data-admin-toggle-user-enabled="${user?.enabled === false ? 'true' : 'false'}">${escapeHtml(t(user?.enabled === false ? 'Enable' : 'Disable'))}</button>
          <button class="danger compact-button" type="button" data-admin-delete-user-id="${escapeAttribute(user.id || '')}">${escapeHtml(t('Delete'))}</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderAdminRoles() {
  if (!state.admin.roles.length) {
    return `<div class="meta">${escapeHtml(t('No roles configured.'))}</div>`;
  }
  return state.admin.roles.map((role) => `
    <article class="admin-row">
      <span class="admin-row-main" data-i18n-skip>${escapeHtml(role.name || role.id)}</span>
      <span class="admin-row-meta"${role.isAdmin ? '' : ' data-i18n-skip'}>${role.isAdmin ? escapeHtml(t('admin')) : escapeHtml(role.id || '')}</span>
      <button class="ghost compact-button" type="button" data-admin-edit-role="${escapeAttribute(role.id || '')}">${escapeHtml(t('Edit'))}</button>
    </article>
  `).join('');
}

function renderAdminSessions() {
  if (!state.admin.sessions.length) {
    return `<div class="meta">${escapeHtml(t('No sessions found.'))}</div>`;
  }
  return sortedAdminSessions().map((session) => {
    const owner = adminUserName(session.ownerUserId || session.userId);
    const modeLabel = session.archived === true ? t('Read only') : t('Observer Mode');
    const summary = String(session.summary || '').trim();
    return `
      <article class="admin-row admin-session-row">
        <button class="admin-session-open" type="button" data-admin-session-id="${escapeAttribute(session.id)}">
          <span class="admin-row-main" data-i18n-skip>${escapeHtml(adminProjectNameById(session.projectId, session.projectDisplayName))}</span>
          ${summary ? `<span class="admin-session-summary" data-i18n-skip>${escapeHtml(summary)}</span>` : ''}
          <span class="admin-row-meta"><span data-i18n-skip>${escapeHtml(`${owner} · ${session.id}`)}</span> · ${escapeHtml(modeLabel)}</span>
        </button>
      </article>
    `;
  }).join('');
}

function renderNewSession() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    ${renderMobileProjectDrawer()}
    <div class="screen page-screen">
      ${renderNewSessionContent()}
    </div>
  `;
  return localizeElement(shell);
}

function renderNewSessionContent({ desktop = false } = {}) {
  const sessionTargetPicker = renderNewSessionTargetPicker();
  const startDisabled = isMultiUserMode() && !currentNewProjectId();
  return localizeFragment(`
    ${desktop
      ? `
        <header class="topbar chat-topbar desktop-chat-topbar">
          <div class="chat-nav">
            <div class="chat-nav-spacer" aria-hidden="true"></div>
            <div class="chat-title-stack">
              <div class="project-title">New Session</div>
              <div class="goal-status" data-status="unknown">${escapeHtml(currentProjectScopeTitle())}</div>
            </div>
            <div class="chat-nav-spacer" aria-hidden="true"></div>
          </div>
        </header>
      `
      : `
        ${renderPageNav('New Session')}
      `}
    <main class="new-session-page${desktop ? ' desktop-new-session-page' : ''}">
      <form class="panel stack" id="new-session-form">
        ${sessionTargetPicker}
        <div class="actions">
          ${desktop ? '<button class="ghost compact-button" type="button" id="back-to-list-button">Sessions</button>' : ''}
          <button class="${desktop ? 'primary compact-button' : 'primary primary-action'}" type="submit"${startDisabled ? ' disabled' : ''}>Start</button>
        </div>
      </form>
    </main>
  `);
}

function renderNewSessionTargetPicker() {
  if (isMultiUserMode()) {
    return renderMultiUserNewSessionProjectPicker();
  }
  return renderNewSessionPathPicker();
}

function renderMultiUserNewSessionProjectPicker() {
  if (!state.projectsLoaded) {
    return `
      <div class="field">
        <label>Project</label>
        <div class="meta">Loading projects...</div>
      </div>
    `;
  }
  const projects = availableProjects();
  if (!projects.length) {
    return `
      <div class="field">
        <label for="new-project-select">Project</label>
        <select id="new-project-select" name="projectId" disabled>
          <option value="">No projects available</option>
        </select>
        <div class="meta">Ask an admin to assign a project before starting a session.</div>
      </div>
    `;
  }
  const currentProjectId = state.newProjectId || projects[0]?.id || '';
  return `
        <div class="field">
          <label for="new-project-select">Project</label>
          <select id="new-project-select" name="projectId" data-i18n-skip>
            ${projects.map((project) => `
              <option value="${escapeAttribute(project.id)}"${project.id === currentProjectId ? ' selected' : ''} data-i18n-skip>${escapeHtml(projectVisibleName(project, project.id))}</option>
            `).join('')}
          </select>
        </div>
  `;
}

function renderNewSessionPathPicker() {
  return `
        <div class="field">
          <label for="new-cwd-input">Project path</label>
          <textarea id="new-cwd-input" name="cwd" rows="3" placeholder="Use server default">${escapeHtml(state.newCwd || state.cwd)}</textarea>
        </div>
        ${renderPathChoices()}
  `;
}

function renderChat() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen">
      ${renderChatContent()}
    </div>
    ${renderArchiveConfirmModal()}
  `;
  return localizeElement(shell);
}

function renderChatContent({ desktop = false } = {}) {
  const composerClassName = composerStateClassName();
  const readOnly = isReadOnlySession(state.currentSession);
  return localizeFragment(`
      <header class="topbar chat-topbar${desktop ? ' desktop-chat-topbar' : ''}">
        <div class="chat-nav">
          ${desktop ? '<div class="chat-nav-spacer" aria-hidden="true"></div>' : `<button class="ghost chat-back-button" type="button" id="back-to-list-button" aria-label="Sessions">${renderBackButtonIcon()}</button>`}
          <div class="chat-title-stack">
            <div class="project-title" data-i18n-skip>${escapeHtml(projectNameForSession(state.currentSession, state.cwd))}</div>
            ${renderGoalStatus()}
          </div>
          ${renderChatHeaderActions({ readOnly })}
        </div>
      </header>
      <main class="timeline" id="timeline" data-i18n-skip>${renderTimeline()}</main>
      ${readOnly ? renderReadOnlyComposerNotice(state.currentSession) : renderComposer(composerClassName, { desktop })}
      ${renderShareDialog()}
      ${renderWorkDetailsDialog()}
  `);
}

function renderChatHeaderActions({ readOnly }) {
  const canOpenSettings = !readOnly;
  if (!canOpenSettings) {
    return '<div class="chat-nav-spacer" aria-hidden="true"></div>';
  }
  return `
          <div class="chat-header-actions">
            ${canOpenSettings ? `<button class="ghost icon-button settings-toggle-button" type="button" id="settings-toggle" aria-label="Session menu" title="Session menu" aria-expanded="${String(state.settingsOpen)}">${renderMoreButtonIcon()}</button>` : ''}
          </div>
  `;
}

function canShareCurrentSession() {
  return Boolean(
    state.globalSettings.publicSharesEnabled === true
      && state.authSession?.principal?.mode === 'multi'
      && state.sessionId
      && !state.draftSessionActive
      && !isReadOnlySession(state.currentSession),
  );
}

function canShowShareCurrentSession() {
  return Boolean(
    state.sessionId
      && !state.draftSessionActive
      && !isReadOnlySession(state.currentSession),
  );
}

function shareUnavailableReason() {
  if (!state.globalSettings.loaded) {
    return 'Checking sharing availability';
  }
  if (state.globalSettings.publicSharesEnabled !== true) {
    return 'Public sharing is disabled';
  }
  if (state.authSession?.principal?.mode !== 'multi') {
    return 'Available in trusted-team mode';
  }
  return '';
}

function renderShareDialog() {
  if (!state.shareDialog?.url) {
    return '';
  }
  return `
      <div class="modal-backdrop share-modal-backdrop" data-modal-dismiss="share">
        <section class="confirm-dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" data-focus-scope="share-dialog">
          <div>
            <h2 id="share-dialog-title">Share link</h2>
            <p class="meta">${escapeHtml(state.shareDialog.copied ? 'Copied to clipboard.' : 'Copy this read-only session link.')}</p>
          </div>
          <input id="share-link-input" class="share-link-input" type="text" readonly value="${escapeAttribute(state.shareDialog.url)}" data-initial-focus>
          <div class="actions">
            <button class="ghost compact-button" type="button" id="copy-share-link-button">Copy</button>
            <button class="primary compact-button" type="button" id="close-share-dialog-button">Done</button>
          </div>
        </section>
      </div>
  `;
}

function renderWorkDetailsDialog() {
  if (!state.workDetailsOpen || !canViewCurrentWorkDetails()) {
    return '';
  }
  const workItem = currentWorkDetailsItem();
  if (!workItem) {
    return '';
  }
  return `
      <div class="modal-backdrop work-details-backdrop" data-modal-dismiss="work-details">
        <section class="confirm-dialog work-details-dialog" role="dialog" aria-modal="true" aria-labelledby="work-details-title" data-focus-scope="work-details">
          <header class="work-details-header">
            <h2 id="work-details-title">${escapeHtml(t('Turn activity'))}</h2>
            <button class="ghost icon-button work-details-close" type="button" id="close-work-details-button" aria-label="Close work details" title="Close work details" data-initial-focus><span aria-hidden="true">&times;</span></button>
          </header>
          <div class="work-details-list">
            ${renderWorkItem(workItem, currentWorkDetailsWindow(workItem))}
          </div>
        </section>
      </div>
  `;
}

function renderComposer(composerClassName, { desktop = false } = {}) {
  return `
      <div class="composer-wrap ${composerClassName}">
        ${state.composerExpanded ? '' : renderComposerStatus()}
        ${renderQueuedMessages()}
        <form class="composer ${composerClassName}" id="composer-form">
          ${state.settingsOpen && !state.composerExpanded ? renderSettingsDrawer() : ''}
          ${state.error && !state.composerExpanded ? `<div class="composer-error" role="alert">${escapeHtml(shorten(state.error, 96))}</div>` : ''}
          ${renderAttachmentTray()}
          <input class="visually-hidden" id="attachment-input" type="file" multiple aria-label="Upload files">
          <div class="compact-composer-row">
            ${renderComposerLeadingControls()}
            ${renderMessageEditor({ desktop })}
          </div>
        </form>
      </div>
  `;
}

function renderQueuedMessages() {
  const queued = pendingQueuedMessagesForCurrentSession();
  if (!queued.length) {
    return '';
  }
  return `
        <div class="queued-messages" aria-label="${escapeAttribute(t('Queued messages'))}" data-i18n-skip>
          ${queued.map((message) => `
            <div class="queued-message-row">
              <span class="queued-message-text" data-i18n-skip>${escapeHtml(message.text)}</span>
              <button class="ghost queued-message-delete" type="button" data-queued-message-id="${escapeAttribute(message.id)}" aria-label="${escapeAttribute(t('Delete queued message'))}">${escapeHtml(t('Delete'))}</button>
            </div>
          `).join('')}
        </div>
  `;
}

async function sendNextQueuedMessage(sessionId = state.sessionId) {
  if (!sessionId
    || sessionId !== state.sessionId
    || state.currentSession?.id !== sessionId
    || state.queuedMessageSending
    || state.pendingTurn
    || isReadOnlySession(state.currentSession)) {
    return false;
  }
  const [message] = pendingQueuedMessagesForSession(sessionId);
  if (!message) {
    return false;
  }
  state.queuedMessageSending = true;
  setQueuedMessageSending(sessionId, message.id, true, { renderAfter: true });
  try {
    await sendComposerMessage(message.text, {
      queuedMessageId: message.id,
      sessionId,
      includeComposerAttachments: false,
    });
    return true;
  } finally {
    state.queuedMessageSending = false;
  }
}

function renderReadOnlyComposerNotice(session) {
  const mode = session?.mode === 'share' ? 'Shared link' : 'Observer mode';
  return `
      <div class="composer-wrap read-only-composer-wrap">
        <div class="read-only-banner">
          <strong>${escapeHtml(mode)}</strong>
          <span>Read only</span>
        </div>
      </div>
  `;
}

function renderGoalStatus() {
  const goal = state.currentSession?.goal;
  const objective = String(goal?.objective || '').trim();
  if (!objective) {
    return '';
  }
  const { status, label } = goalStatusDisplay(goal.status);
  return `
    <div class="goal-status" data-status="${escapeAttribute(status)}" data-i18n-skip>
      <span>${escapeHtml(label)}</span>
      <span class="goal-objective">${escapeHtml(objective)}</span>
    </div>
  `;
}

function goalStatusDisplay(status) {
  const normalized = normalizeGoalStatus(status);
  if (normalized === 'paused') {
    return { status: 'paused', label: 'Goal paused' };
  }
  if (normalized === 'done') {
    return { status: 'done', label: 'Goal done' };
  }
  if (normalized === 'blocked') {
    return { status: 'blocked', label: 'Goal blocked' };
  }
  if (normalized === 'active') {
    return { status: 'active', label: 'Goal active' };
  }
  return { status: 'unknown', label: `Goal ${String(status || '').trim() || 'set'}` };
}

function normalizeGoalStatus(status) {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s_-]+/gu, '');
  if (!normalized || normalized === 'active' || normalized === 'running' || normalized === 'inprogress') {
    return 'active';
  }
  if (normalized === 'pause' || normalized === 'paused') {
    return 'paused';
  }
  if (['done', 'complete', 'completed', 'success', 'succeeded', 'finished'].includes(normalized)) {
    return 'done';
  }
  if (['blocked', 'failed', 'cancelled', 'canceled'].includes(normalized)) {
    return 'blocked';
  }
  return 'unknown';
}

function renderPageNav(title, options = {}) {
  const backId = options.backId || 'back-to-list-button';
  const skipTitleI18n = options.skipTitleI18n === true;
  return `
    <header class="topbar page-topbar">
      <div class="page-nav">
        <button class="ghost page-back-button" type="button" id="${escapeAttribute(backId)}" aria-label="Back">${renderBackButtonIcon()}</button>
        <div class="page-title"${skipTitleI18n ? ' data-i18n-skip' : ''}>${escapeHtml(title)}</div>
        <div class="page-nav-spacer" aria-hidden="true"></div>
      </div>
    </header>
  `;
}

function composerStateClassName() {
  if (state.composerExpanded) {
    return 'is-expanded';
  }
  if (state.composerCanExpand) {
    return 'is-expandable';
  }
  return '';
}

function renderComposerLeadingControls() {
  let expandButton = '';
  if (!isDesktopLayout()) {
    expandButton = `<button class="ghost icon-button" type="button" id="composer-expand-button" aria-label="${state.composerExpanded ? 'Collapse message editor' : 'Expand message editor'}" aria-expanded="${String(state.composerExpanded)}"${state.composerCanExpand || state.composerExpanded ? '' : ' hidden'}>${state.composerExpanded ? 'v' : '^'}</button>`;
  }
  const attachDisabled = state.pendingTurn || state.submissionSending || hasUploadingComposerAttachments() ? ' disabled' : '';
  const attachButton = state.composerExpanded
    ? ''
    : `<button class="ghost icon-button attach-button" type="button" id="attach-button" aria-label="Attach files" title="Attach files"${attachDisabled}>+</button>`;
  return `
    <div class="composer-leading-controls">
      ${expandButton}
      ${attachButton}
    </div>
  `;
}

function renderMessageEditor({ desktop = false } = {}) {
  const composerClassName = composerStateClassName();
  const sendDisabled = state.submissionSending || hasUploadingComposerAttachments() ? ' disabled' : '';
  const actionButtons = desktop
    ? `<div class="composer-action-buttons">
        <button class="ghost compact-refresh" type="button" id="composer-refresh-button" aria-label="Refresh session">Refresh</button>
        <button class="primary compact-send" type="submit" id="send-button" aria-label="Send" title="Send"${sendDisabled}>Send</button>
      </div>`
    : `<button class="primary compact-send" type="submit" id="send-button" aria-label="Send" title="Send"${sendDisabled}>Send</button>`;
  return `
    <div class="message-editor-shell ${composerClassName}">
      <textarea id="prompt-input" name="prompt" rows="1" placeholder="Message">${escapeHtml(state.prompt)}</textarea>
      ${actionButtons}
    </div>
  `;
}

function renderAttachmentTray() {
  const attachments = Array.isArray(state.composerAttachments) ? state.composerAttachments : [];
  if (!attachments.length) {
    return '';
  }
  return `
          <div class="attachment-tray" aria-label="${escapeAttribute(t('Attachments'))}" data-i18n-skip>
            ${attachments.map(renderAttachmentChip).join('')}
          </div>
  `;
}

function renderAttachmentChip(attachment) {
  const status = String(attachment?.status || 'ready');
  const fileName = String(attachment?.fileName || attachment?.uploaded?.fileName || 'upload');
  const sizeLabel = formatAttachmentSize(attachment?.sizeBytes || attachment?.uploaded?.sizeBytes || 0);
  const statusLabel = attachmentStatusLabel(attachment);
  const statusClass = status === 'failed' ? ' is-failed' : status === 'uploading' ? ' is-uploading' : '';
  const localPath = String(attachment?.uploaded?.localPath || '').trim();
  return `
            <div class="attachment-chip${statusClass}" data-attachment-id="${escapeAttribute(attachment.id || '')}">
              <button class="attachment-main attachment-open" type="button"${localPath && status === 'ready' ? ` data-session-file-path="${escapeAttribute(localPath)}"` : ' disabled'}>
                <span class="attachment-name" data-i18n-skip>${escapeHtml(fileName)}</span>
                <span class="attachment-meta">${escapeHtml(sizeLabel)}</span>
              </button>
              <span class="attachment-status">${escapeHtml(t(statusLabel))}</span>
              <button class="ghost attachment-remove" type="button" data-attachment-remove-id="${escapeAttribute(attachment.id || '')}" aria-label="${escapeAttribute(t('Remove {fileName}', { fileName }))}">x</button>
            </div>
  `;
}

function attachmentStatusLabel(attachment) {
  const status = String(attachment?.status || 'ready');
  if (status === 'uploading') {
    return 'Uploading';
  }
  if (status === 'failed') {
    return 'Failed';
  }
  const storage = String(attachment?.uploaded?.storage || '').trim();
  return storage === 'state' ? 'Saved' : 'Ready';
}

function formatAttachmentSize(sizeBytes) {
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function hasUploadingComposerAttachments() {
  return (Array.isArray(state.composerAttachments) ? state.composerAttachments : [])
    .some((attachment) => attachment?.status === 'uploading');
}

function hasFailedComposerAttachments() {
  return (Array.isArray(state.composerAttachments) ? state.composerAttachments : [])
    .some((attachment) => attachment?.status === 'failed');
}

function readyComposerAttachments() {
  return (Array.isArray(state.composerAttachments) ? state.composerAttachments : [])
    .filter((attachment) => attachment?.status === 'ready' && attachment.uploaded)
    .map((attachment) => attachment.uploaded);
}

function normalizeTimelineMessageDisplay(role, text, attachments) {
  const rawText = typeof text === 'string' ? text.trim() : '';
  const parsed = role === 'user'
    ? parseAttachmentPromptText(rawText)
    : { text: rawText, attachments: [] };
  return {
    text: parsed.text,
    attachments: mergeTimelineAttachments(
      normalizeTimelineAttachments(attachments),
      parsed.attachments,
    ),
  };
}

function parseAttachmentPromptText(text) {
  const rawText = typeof text === 'string' ? text.trim() : '';
  const footer = 'Use the local file paths above when you inspect these attachments.';
  const footerIndex = rawText.lastIndexOf(`\n${footer}`);
  if (footerIndex < 0) {
    return { text: rawText, attachments: [] };
  }
  const beforeFooter = rawText.slice(0, footerIndex).trimEnd();
  const marker = '\n\nAttachments:\n';
  let markerIndex = beforeFooter.lastIndexOf(marker);
  let blockStart = markerIndex >= 0 ? markerIndex + marker.length : -1;
  if (markerIndex < 0 && beforeFooter.startsWith('Attachments:\n')) {
    markerIndex = 0;
    blockStart = 'Attachments:\n'.length;
  }
  if (markerIndex < 0 || blockStart < 0) {
    return { text: rawText, attachments: [] };
  }
  const parsedAttachments = parseAttachmentPromptBlock(beforeFooter.slice(blockStart));
  if (!parsedAttachments.length) {
    return { text: rawText, attachments: [] };
  }
  const displayText = beforeFooter.slice(0, markerIndex).trim();
  return {
    text: displayText === 'User sent attachments without additional text.' ? '' : displayText,
    attachments: parsedAttachments,
  };
}

function parseAttachmentPromptBlock(blockText) {
  const attachments = [];
  let current = null;
  const pushCurrent = () => {
    if (!current?.localPath) {
      return;
    }
    attachments.push({
      kind: current.kind === 'image' ? 'image' : 'file',
      localPath: current.localPath,
      fileName: current.fileName || fileNameFromPath(current.localPath),
      mimeType: current.mimeType || null,
    });
  };
  for (const line of String(blockText || '').split('\n')) {
    const itemMatch = line.match(/^\d+\.\s+(.+?)\s*$/u);
    if (itemMatch) {
      pushCurrent();
      const label = String(itemMatch[1] || '').toLowerCase();
      current = {
        kind: label.includes('image') ? 'image' : 'file',
        localPath: '',
        fileName: '',
        mimeType: '',
      };
      continue;
    }
    const fieldMatch = line.match(/^\s+(path|filename|mime):\s*(.*?)\s*$/u);
    if (!fieldMatch || !current) {
      continue;
    }
    const value = String(fieldMatch[2] || '').trim();
    if (fieldMatch[1] === 'path') {
      current.localPath = value;
    } else if (fieldMatch[1] === 'filename') {
      current.fileName = value;
    } else if (fieldMatch[1] === 'mime') {
      current.mimeType = value;
    }
  }
  pushCurrent();
  return attachments;
}

function normalizeTimelineAttachments(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => normalizeTimelineAttachment(attachment))
    .filter(Boolean);
}

function normalizeTimelineAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return null;
  }
  const localPath = typeof attachment.localPath === 'string' ? attachment.localPath.trim() : '';
  const fileName = typeof attachment.fileName === 'string' ? attachment.fileName.trim() : '';
  const mimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.trim() : '';
  if (!localPath && !fileName) {
    return null;
  }
  return {
    kind: attachment.kind === 'image' ? 'image' : 'file',
    localPath,
    fileName: fileName || fileNameFromPath(localPath) || 'upload',
    mimeType: mimeType || null,
    sizeBytes: Number.isFinite(attachment.sizeBytes) ? Number(attachment.sizeBytes) : null,
  };
}

function mergeTimelineAttachments(...attachmentGroups) {
  const merged = [];
  const seen = new Set();
  for (const attachment of attachmentGroups.flatMap((group) => normalizeTimelineAttachments(group))) {
    const key = attachment.localPath || `${attachment.kind}:${attachment.fileName}:${attachment.mimeType || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(attachment);
  }
  return merged;
}

function fileNameFromPath(filePath) {
  const parts = String(filePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function renderSessionCards() {
  const sessions = sortedSessions();
  if (!sessions.length) {
    if (isCurrentSessionScopeLoading()) {
      return `<div class="empty-state">${escapeHtml(t('Loading sessions...'))}</div>`;
    }
    if (state.sessionsError) {
      return renderSessionsError();
    }
    const message = state.sortMode === 'favorites'
      ? 'No favorites yet.'
      : state.sortMode === 'archived'
        ? 'No archived sessions yet.'
        : 'No sessions yet.';
    return `<div class="empty-state">${escapeHtml(t(message))}</div>`;
  }
  const errorBanner = state.sessionsError ? renderSessionsError({ compact: true }) : '';
  return errorBanner + sessions.map((session) => {
    const activityState = sessionActivityState(session);
    const pendingDelivery = session.localSubmission === true
      ? null
      : pendingSubmissionEntries().find((entry) => entry.sessionId === session.id);
    const deliveryState = session.localSubmission === true ? session.deliveryState : pendingDelivery?.status || '';
    const deliveryFailureVisible = session.localSubmission === true
      ? session.deliveryFailureVisible === true
      : submissionFailureIsVisible(pendingDelivery);
    const favorite = isFavoriteSession(session);
    const favoriteLabel = t(favorite ? 'Unfavorite' : 'Favorite');
    const archiveLabel = t(session.archived === true ? 'Unarchive' : 'Archive');
    const latestPreview = sessionLatestPreview(session);
    return `
      <article class="session-card${state.sessionId === session.id || state.activeSubmissionId === session.submissionId ? ' is-active' : ''}"${activityState ? ` data-activity-state="${escapeAttribute(activityState)}"` : ''}${deliveryState ? ` data-delivery-state="${escapeAttribute(deliveryState)}"` : ''}>
        <button class="session-card-open" type="button" data-session-id="${escapeAttribute(session.id)}">
          <span class="session-card-main">
            <span class="session-card-title-row">
              <span class="session-title" data-i18n-skip>${escapeHtml(sessionDisplayTitle(session))}</span>
              ${deliveryState === 'failed' && deliveryFailureVisible
                ? `<span class="session-attention-state" data-state="${escapeAttribute(deliveryState)}">${escapeHtml(t(submissionDeliveryLabel(deliveryState)))}</span>`
                : activityState ? `<span class="session-attention-state" data-state="${escapeAttribute(activityState)}">${escapeHtml(t(activityState === 'waiting_approval' ? 'Needs approval' : 'Active'))}</span>` : ''}
            </span>
            ${latestPreview ? `<span class="session-preview" data-i18n-skip>${escapeHtml(latestPreview)}</span>` : ''}
          </span>
          <span class="session-card-meta">
            <span class="session-project" data-i18n-skip>${escapeHtml(projectNameForSession(session))}</span>
            <span aria-hidden="true">&middot;</span>
            <span>${escapeHtml(formatShortDateTime(lastInputAtForSession(session)))}</span>
          </span>
        </button>
        ${session.localSubmission === true ? `
          <div class="session-card-actions submission-session-actions">
            ${session.deliveryFailureVisible === true && session.retryable !== false ? `<button class="ghost compact-button" type="button" data-submission-retry-id="${escapeAttribute(session.submissionId)}" aria-label="${escapeAttribute(t('Retry send'))}" title="${escapeAttribute(t('Retry send'))}"><span aria-hidden="true">&#8635;</span></button>` : ''}
            ${session.deliveryState !== 'sending' ? `<button class="ghost compact-button" type="button" data-submission-cancel-id="${escapeAttribute(session.submissionId)}" aria-label="${escapeAttribute(t('Cancel send'))}" title="${escapeAttribute(t('Cancel send'))}"><span aria-hidden="true">&times;</span></button>` : ''}
          </div>
        ` : `
          <div class="session-card-actions">
            <button class="ghost compact-button session-favorite" type="button" data-session-favorite-id="${escapeAttribute(session.id)}" aria-label="${escapeAttribute(favoriteLabel)}" title="${escapeAttribute(favoriteLabel)}" aria-pressed="${String(favorite)}"><span class="session-action-symbol" aria-hidden="true">${favorite ? '&#9733;' : '&#9734;'}</span></button>
            ${session.archived === true
              ? `<button class="ghost compact-button session-archive" type="button" data-session-unarchive-id="${escapeAttribute(session.id)}" aria-label="${escapeAttribute(archiveLabel)}" title="${escapeAttribute(archiveLabel)}">${renderUnarchiveActionIcon()}</button>`
              : `<button class="ghost compact-button session-archive" type="button" data-session-archive-request-id="${escapeAttribute(session.id)}" aria-label="${escapeAttribute(archiveLabel)}" title="${escapeAttribute(archiveLabel)}">${renderArchiveActionIcon()}</button>`}
          </div>
        `}
      </article>
    `;
  }).join('');
}

function renderSessionsError({ compact = false } = {}) {
  return `
    <div class="session-list-error${compact ? ' is-compact' : ''}" role="alert">
      <span>${escapeHtml(t(state.sessionsError || 'Could not update sessions.'))}</span>
      <button class="ghost compact-button" type="button" id="retry-sessions-button">${escapeHtml(t('Retry'))}</button>
    </div>
  `;
}

function sessionDisplayTitle(session) {
  return normalizeSessionCardText(session?.firstUserInput)
    || normalizeSessionCardText(session?.title)
    || normalizeSessionCardText(session?.preview)
    || t('New Session');
}

function sessionLatestPreview(session) {
  const latest = normalizeSessionCardText(session?.lastUserInput);
  if (!latest) {
    return '';
  }
  const identity = normalizeSessionCardText(session?.firstUserInput)
    || normalizeSessionCardText(session?.title)
    || normalizeSessionCardText(session?.preview);
  return latest === identity ? '' : latest;
}

function normalizeSessionCardText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function sessionActivityState(session) {
  if (session?.id === state.sessionId && state.pendingTurn) {
    const waitingApproval = [...state.approvals.values()].some((approval) => approval?.resolved === false);
    if (waitingApproval) {
      return 'waiting_approval';
    }
    return 'running';
  }
  return sessionActivityStateFromSummary(session);
}

function setSessionSummaryActivity(sessionId, activityState, activeTurnId = '') {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return false;
  }
  const normalizedActivity = activityState === 'running' || activityState === 'waiting_approval'
    ? activityState
    : null;
  const normalizedTurnId = String(activeTurnId || '').trim();
  let changed = false;
  const update = (session) => {
    if (!session || session.id !== normalizedSessionId) {
      return session;
    }
    const previousActivity = sessionActivityStateFromSummary(session);
    const previousTurnId = String(session.activeTurnId || '').trim();
    const nextTurnId = normalizedActivity ? (normalizedTurnId || previousTurnId) : '';
    if (previousActivity === normalizedActivity && previousTurnId === nextTurnId) {
      return session;
    }
    changed = true;
    const next = {
      ...session,
      activeTurnId: nextTurnId || null,
    };
    if (normalizedActivity) {
      next.activityState = normalizedActivity;
    } else {
      delete next.activityState;
    }
    return next;
  };

  state.sessions = state.sessions.map(update);
  for (const scope of Object.keys(state.sessionsByScope)) {
    state.sessionsByScope[scope] = (state.sessionsByScope[scope] || []).map(update);
  }
  state.currentSession = update(state.currentSession);
  return changed;
}

function sessionActivityStateFromSummary(session) {
  if (session?.activityState === 'waiting_approval' || session?.activityState === 'running') {
    return session.activityState;
  }
  return String(session?.activeTurnId || '').trim() ? 'running' : null;
}

function renderArchiveActionIcon() {
  return `
    <svg class="session-action-icon" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d="M224 322.6h576c16.6 0 30-13.4 30-30s-13.4-30-30-30H224c-16.6 0-30 13.4-30 30s13.5 30 30 30zM290.1 178.4h443.8c16.6 0 30-13.4 30-30s-13.4-30-30-30H290.1c-16.6 0-30 13.4-30 30s13.4 30 30 30zM629.6 613.9H394.4c-16.6 0-30 13.4-30 30s13.4 30 30 30h235.2c16.6 0 30-13.4 30-30s-13.4-30-30-30z"></path>
      <path d="M850.3 403.9H173.7c-33 0-60 27-60 60v360c0 33 27 60 60 60h676.6c33 0 60-27 60-60v-360c0-33-27-60-60-60zM850.2 823.7l-.1.1H173.9l-.1-.1V464l.1-.1h676.2l.1.1v359.7z"></path>
    </svg>
  `;
}

function renderUnarchiveActionIcon() {
  return `
    <svg class="session-action-icon session-action-icon-stroke" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="4" rx="1"></rect>
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"></path>
      <path d="m9 14 3-3 3 3"></path>
      <path d="M12 11v7"></path>
    </svg>
  `;
}

function renderArchiveConfirmModal() {
  const session = state.sessions.find((item) => item.id === state.archiveConfirmSessionId);
  if (!session) {
    return '';
  }
  return `
    <div class="modal-backdrop" data-modal-dismiss="archive">
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-confirm-title" data-focus-scope="archive-dialog">
        <div>
          <h2 id="archive-confirm-title">Archive session?</h2>
          <p class="meta" data-i18n-skip>${escapeHtml(projectNameForSession(session))}</p>
          <p class="meta"${previewInputForSession(session) ? ' data-i18n-skip' : ''}>${escapeHtml(shorten(previewInputForSession(session), 120) || 'No prompt preview')}</p>
        </div>
        <div class="actions">
          <button class="ghost compact-button" type="button" id="archive-cancel-button" data-initial-focus>Cancel</button>
          <button class="danger compact-button" type="button" data-session-archive-confirm-id="${escapeAttribute(session.id)}">Archive</button>
        </div>
      </section>
    </div>
  `;
}

function renderPathChoices() {
  const paths = uniqueSessionPaths();
  if (!paths.length) {
    return '';
  }
  return `
    <div class="path-choices" data-i18n-skip>
      ${paths.map((cwd) => `
        <button type="button" class="path-choice" data-cwd-choice="${escapeAttribute(cwd)}">
          <span data-i18n-skip>${escapeHtml(projectNameFromCwd(cwd))}</span>
          <small data-i18n-skip>${escapeHtml(shorten(cwd, 62))}</small>
        </button>
      `).join('')}
    </div>
  `;
}

function renderSettingsDrawer() {
  return `
    <div class="settings-drawer" role="dialog" aria-modal="true" aria-label="Session settings" data-focus-scope="session-settings">
      <div class="settings-drawer-header">
        <span class="settings-drawer-title">Current session</span>
        <button class="ghost icon-button settings-drawer-close" type="button" id="settings-drawer-close" aria-label="Close session menu" title="Close session menu" data-initial-focus><span aria-hidden="true">×</span></button>
      </div>
      ${renderStopTurnSettingsControl()}
      ${renderSessionActionsSettingsSection()}
      <div class="settings-drawer-section">
        <div class="settings-drawer-section-title">Model and reasoning</div>
        <div class="settings-card settings-options-card">
          ${renderThreadSettingsControls({ modelOnly: true })}
        </div>
      </div>
      <div class="settings-drawer-section">
        <div class="settings-drawer-section-title">Behavior and permissions</div>
        <div class="settings-card settings-options-card settings-behavior-card">
          ${renderThreadSettingsControls({ behaviorOnly: true })}
        </div>
      </div>
    </div>
  `;
}

function renderThreadSettingsControls({ defaults = false, modelOnly = false, behaviorOnly = false } = {}) {
  const prefix = defaults ? 'default-' : '';
  const settings = defaults ? state.defaultThreadSettings : state;
  const accessPreset = defaults ? defaultThreadAccessPreset() : state.permissionPreset;
  const defaultModelControls = `
        <div class="control-group">
          <label for="${prefix}model-select">Model</label>
          <select id="${prefix}model-select" name="${defaults ? 'defaultModel' : 'model'}" data-i18n-skip>${renderModelOptions(settings.model)}</select>
        </div>
        <div class="control-group">
          <label for="${prefix}reasoning-select">Reasoning</label>
          <select id="${prefix}reasoning-select" name="${defaults ? 'defaultReasoningEffort' : 'reasoningEffort'}" data-i18n-skip>
            ${renderReasoningOptions(settings.reasoningEffort, settings.model)}
          </select>
        </div>
  `;
  const sessionModelControls = `
        <label class="settings-option-row" for="model-select">
          <span class="settings-option-label">Model</span>
          <span class="settings-select-shell">
            <select id="model-select" name="model" data-i18n-skip>${renderModelOptions(settings.model)}</select>
          </span>
        </label>
        <label class="settings-option-row" for="reasoning-select">
          <span class="settings-option-label">Reasoning</span>
          <span class="settings-select-shell">
            <select id="reasoning-select" name="reasoningEffort" data-i18n-skip>
              ${renderReasoningOptions(settings.reasoningEffort, settings.model)}
            </select>
          </span>
        </label>
  `;
  const modelControls = defaults ? defaultModelControls : sessionModelControls;
  const modeAttribute = defaults ? 'data-default-mode' : 'data-mode';
  const permissionAttribute = defaults ? 'data-default-permission-preset' : 'data-permission-preset';
  const behaviorControls = `
        <div class="control-group thread-setting-wide${defaults ? '' : ' settings-option-row'}">
          <label class="settings-option-label" id="${prefix}mode-label">Mode</label>
          <div class="toggle" role="group" aria-labelledby="${prefix}mode-label">
            <button type="button" ${modeAttribute}="default" aria-pressed="${String(settings.collaborationMode === 'default')}">Default</button>
            <button type="button" ${modeAttribute}="plan" aria-pressed="${String(settings.collaborationMode === 'plan')}">Plan</button>
          </div>
        </div>
        <div class="control-group thread-setting-wide${defaults ? '' : ' settings-option-row'}">
          <label class="settings-option-label" id="${prefix}permissions-label">Permissions</label>
          <div class="toggle permission-toggle" role="group" aria-labelledby="${prefix}permissions-label">
            <button type="button" ${permissionAttribute}="read-only" aria-pressed="${String(accessPreset === 'read-only')}">Read only</button>
            <button type="button" ${permissionAttribute}="default" aria-pressed="${String(accessPreset === 'default')}">Ask before changes</button>
            <button type="button" ${permissionAttribute}="full-access" aria-pressed="${String(accessPreset === 'full-access')}">Full access</button>
          </div>
        </div>
  `;
  return `<div class="thread-settings-grid">${behaviorOnly ? behaviorControls : modelOnly ? modelControls : `${modelControls}${behaviorControls}`}</div>`;
}

function renderSessionActionsSettingsSection() {
  const controls = [
    renderShareSettingsControl(),
    renderSessionManagementControl(),
  ].filter(Boolean).join('');
  if (!controls) {
    return '';
  }
  return `
      <div class="settings-card settings-drawer-actions">
        ${controls}
      </div>
  `;
}

function renderStopTurnSettingsControl() {
  const running = Boolean(state.pendingTurn && state.turnId);
  return `
      <div class="settings-card settings-stop-row" data-session-state="${running ? 'running' : 'idle'}">
        <span class="settings-session-state">
          <span class="settings-session-state-dot" aria-hidden="true"></span>
          <strong>${running ? 'Current session is running' : 'Current session is idle'}</strong>
        </span>
        ${running ? '<button class="danger compact-button" type="button" id="stop-button" aria-label="Stop current turn">Stop</button>' : ''}
      </div>
  `;
}

function renderSessionManagementControl() {
  if (!state.sessionId || state.draftSessionActive || isReadOnlySession(state.currentSession)) {
    return '';
  }
  return `
      <div class="settings-action-row">
        <strong>Session</strong>
        <button class="ghost compact-button" type="button" data-session-archive-request-id="${escapeAttribute(state.sessionId)}"${state.pendingTurn ? ' disabled' : ''}>Archive</button>
      </div>
  `;
}

function renderShareSettingsControl() {
  if (!canShowShareCurrentSession()) {
    return '';
  }
  const unavailableReason = shareUnavailableReason();
  return `
      <div class="settings-action-row">
        <strong>Share</strong>
        <button class="ghost compact-button" type="button" id="share-session-button"${unavailableReason ? ` disabled aria-describedby="share-unavailable-reason" title="${escapeAttribute(t(unavailableReason))}"` : ''}>Share</button>
        ${unavailableReason ? `<span class="visually-hidden" id="share-unavailable-reason">${escapeHtml(t(unavailableReason))}</span>` : ''}
      </div>
  `;
}

function renderTimeline() {
  const visibleItems = visibleTimelineItems();
  if (!visibleItems.length) {
    return `<div class="empty-state">${escapeHtml(t('No context yet.'))}</div>`;
  }
  return visibleItems.map((item) => renderTimelineItem(item)).join('');
}

function visibleTimelineItems() {
  return state.timeline.filter((item) => {
    if (item?.kind === 'work') {
      return false;
    }
    if (item?.kind === 'message') {
      if (item.role === 'system' && isTurnInterruptTimeoutMessage(item.text)) {
        return false;
      }
      const display = normalizeTimelineMessageDisplay(item.role, item.text, item.attachments);
      return Boolean(String(display.text || '').trim() || display.attachments.length);
    }
    return true;
  });
}

function renderComposerStatus() {
  const label = localizedComposerStatusLabel();
  const canOpenWork = canViewCurrentWorkDetails() && Boolean(currentWorkDetailsItem());
  const content = canOpenWork
    ? `<button class="composer-status-action" type="button" id="open-work-details-button" aria-haspopup="dialog" aria-expanded="${String(state.workDetailsOpen)}" aria-label="${escapeAttribute(`${label}. ${t('Work details')}`)}"><span>${escapeHtml(label)}</span><span class="composer-status-disclosure" aria-hidden="true">&#8250;</span></button>`
    : `<span>${escapeHtml(label)}</span>`;
  return `<div class="composer-status${canOpenWork ? ' can-open-work' : ''}" data-tone="${escapeAttribute(composerStatusTone())}" role="status" aria-live="polite" aria-atomic="true">${content}</div>`;
}

function composerStatusLabel() {
  if (state.submissionSending) {
    return 'Sending to server';
  }
  if (state.pendingTurn) {
    if (state.status === 'Stream paused') {
      return 'Working|Reconnecting';
    }
    const activity = currentSafeWorkActivityLabel();
    return activity ? `Working|${activity}` : 'Working';
  }
  if (state.statusTone === 'danger') {
    return 'Failed';
  }
  if (state.status === 'Ready') {
    return 'Ready';
  }
  if (state.status === 'Turn stopped') {
    return 'Stopped';
  }
  return state.status || 'Idle';
}

function localizedComposerStatusLabel() {
  return composerStatusLabel().split('|').map((part) => t(part)).join(' · ');
}

function composerStatusTone() {
  if (state.submissionSending) {
    return 'warn';
  }
  if (state.pendingTurn && state.status !== 'Stream paused') {
    return 'work';
  }
  return state.statusTone;
}

function renderTimelineItem(item) {
  if (item.kind === 'message') {
    const usesMarkdown = (item.role === 'assistant' || item.role === 'system') && item.streaming !== true;
    const display = normalizeTimelineMessageDisplay(item.role, item.text, item.attachments);
    const body = usesMarkdown
      ? `<div class="message-text markdown-body">${renderMarkdown(display.text)}</div>`
      : display.text
        ? `<p class="message-text">${escapeHtml(display.text)}</p>`
        : '';
    const attachments = renderMessageAttachments(display.attachments);
    const submission = item.submissionId ? state.submissionOutbox.get(item.submissionId) : null;
    const meta = item.meta || '';
    const deliveryFailed = item.role === 'user' && (
      submissionFailureIsVisible(submission)
      || (!submission && item.deliveryLabel === 'Send failed')
    );
    return `
      <article class="card message-card ${escapeHtml(item.role)}${item.severity === 'error' ? ' error-message' : ''}${item.meta === 'reasoning-summary' ? ' reasoning-summary' : ''}${deliveryFailed ? ' delivery-failed' : ''}" data-timeline-id="${escapeAttribute(item.id || '')}">
        <div class="card-header">
          <span class="card-title">${escapeHtml(t(item.label))}</span>
          <span class="card-kind">${escapeHtml(t(meta))}</span>
        </div>
        ${item.severity === 'error' ? `<span class="error-badge">${escapeHtml(t('Error'))}</span>` : ''}
        ${body}
        ${attachments}
        ${renderSubmissionDeliveryActions(item, submission)}
      </article>
    `;
  }
  if (item.kind === 'work') {
    return '';
  }
  if (item.kind === 'batch') {
    return `
      <article class="card">
        <div class="card-header">
          <span class="card-title"${item.title === 'Batch' ? '' : ' data-i18n-skip'}>${escapeHtml(item.title === 'Batch' ? t('Batch') : item.title)}</span>
          <span class="card-kind">${escapeHtml(t(item.status || item.batchKind))}</span>
        </div>
        ${renderSummary(item.summary)}
      </article>
    `;
  }
  if (item.kind === 'approval') {
    return `
    <article class="card" aria-live="polite">
      <div class="card-header">
        <span class="card-title">${escapeHtml(t('Approval requested'))}</span>
        <span class="card-kind" data-i18n-skip>${escapeHtml(item.approvalKind)}</span>
      </div>
      ${renderSummary(item.summary)}
      <div class="approval-actions">
          <button type="button" class="primary" data-approval-action="accept" data-approval-id="${escapeAttribute(item.approvalId)}" ${item.resolved ? 'disabled' : ''}>${escapeHtml(t('Accept'))}</button>
          <button type="button" class="ghost" data-approval-action="accept-for-session" data-approval-id="${escapeAttribute(item.approvalId)}" ${item.resolved ? 'disabled' : ''}>${escapeHtml(t('Session'))}</button>
          <button type="button" class="danger" data-approval-action="deny" data-approval-id="${escapeAttribute(item.approvalId)}" ${item.resolved ? 'disabled' : ''}>${escapeHtml(t('Deny'))}</button>
      </div>
    </article>
    `;
  }
  return `
    <article class="card">
      <div class="card-header">
        <span class="card-title" data-i18n-skip>${escapeHtml(item.title)}</span>
        <span class="card-kind" data-i18n-skip>${escapeHtml(item.meta || '')}</span>
      </div>
      <p class="meta">${escapeHtml(item.text || '')}</p>
    </article>
  `;
}

function submissionDeliveryLabel(status) {
  if (status === 'sending') {
    return 'Sending to server';
  }
  if (status === 'failed') {
    return 'Send failed';
  }
  if (status === 'submitted') {
    return 'Server received';
  }
  return 'Saved on this device';
}

function renderSubmissionDeliveryActions(item, submission) {
  const failed = submissionFailureIsVisible(submission)
    || (!submission && item?.deliveryLabel === 'Send failed');
  if (item?.role !== 'user' || !failed) {
    return '';
  }
  const retryLabel = `${t('Send failed')}. ${t('Retry send')}`;
  const indicator = submission && submission.retryable !== false
    ? `<button class="submission-retry-button" type="button" data-submission-retry-id="${escapeAttribute(submission.id)}" aria-label="${escapeAttribute(retryLabel)}" title="${escapeAttribute(t('Retry send'))}"><span aria-hidden="true">&#8635;</span></button>`
    : `<span class="submission-failed-indicator" role="img" aria-label="${escapeAttribute(t('Send failed'))}" title="${escapeAttribute(t('Send failed'))}"><span aria-hidden="true">!</span></span>`;
  return `
        <div class="submission-delivery-actions">
          ${indicator}
        </div>
  `;
}

function submissionFailureIsVisible(submission) {
  if (!submission || submission.status !== 'failed') {
    return false;
  }
  return submission.retryable === false
    || Number(submission.attempts || 0) >= SUBMISSION_VISIBLE_FAILURE_ATTEMPT;
}

function renderMessageAttachments(attachments) {
  const normalized = normalizeTimelineAttachments(attachments);
  if (!normalized.length) {
    return '';
  }
  return `
        <div class="message-attachments" aria-label="Message attachments">
          ${normalized.map(renderMessageAttachment).join('')}
        </div>
  `;
}

function renderMessageAttachment(attachment) {
  const kindLabel = attachment.kind === 'image' ? t('Image') : t('File');
  const fileName = attachment.fileName || fileNameFromPath(attachment.localPath) || 'upload';
  const meta = [
    typeof attachment.sizeBytes === 'number' && attachment.sizeBytes > 0 ? formatAttachmentSize(attachment.sizeBytes) : '',
    attachment.mimeType || '',
  ].filter(Boolean).join(' · ');
  const canOpen = Boolean(attachment.localPath && canRenderSessionFileLink(attachment.localPath));
  return `
            <button class="message-attachment ${attachment.kind === 'image' ? 'is-image' : 'is-file'}" type="button"${canOpen ? ` data-session-file-path="${escapeAttribute(attachment.localPath)}"` : ' disabled'}>
              <span class="message-attachment-kind">${escapeHtml(kindLabel)}</span>
              <span class="message-attachment-name" data-i18n-skip>${escapeHtml(fileName)}</span>
              ${meta ? `<span class="message-attachment-meta" data-i18n-skip>${escapeHtml(meta)}</span>` : ''}
              ${canOpen ? '<span class="message-attachment-open" aria-hidden="true">&#8250;</span>' : ''}
            </button>
  `;
}

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
      ${newerCount ? `<div class="work-new-activity"><button type="button" class="ghost compact-button" data-work-show-latest>${escapeHtml(t(newerCount === 1 ? '{count} new activity' : '{count} new activities', { count: newerCount }))}</button></div>` : ''}
      <header class="work-turn-header">
        <div class="work-turn-copy">
          <p class="work-counts">${escapeHtml(formatWorkCounts(summary))}</p>
        </div>
        ${status ? `<span class="work-turn-status" data-tone="running">${escapeHtml(status)}</span>` : ''}
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

function summarizeWorkItem(item) {
  const summary = {
    reads: 0,
    commands: 0,
    edits: 0,
    approvals: Array.isArray(item.approvals) ? item.approvals.length : 0,
  };
  for (const batch of item.batches || []) {
    const kind = classifyWorkBatch(batch);
    if (kind === 'read') {
      summary.reads += 1;
    } else if (kind === 'edit') {
      summary.edits += Math.max(1, workChangedFiles(batch).length);
    } else if (kind === 'command') {
      summary.commands += 1;
    }
  }
  return summary;
}

function workTurnStatus(item) {
  const status = String(item?.status || '').trim().toLowerCase();
  return !status || status === 'started' || status === 'running' || status === 'pending'
    ? t('In progress')
    : '';
}

function workBatchHasError(batch) {
  const status = String(batch?.status || '').toLowerCase();
  const exitCode = Number(batch?.summary?.exitCode);
  return Boolean(batch?.summary?.error)
    || status === 'failed'
    || status === 'error'
    || (Number.isFinite(exitCode) && exitCode !== 0);
}

function formatWorkCounts(summary) {
  const parts = [];
  if (summary.reads) {
    parts.push(t('Read {count}', { count: summary.reads }));
  }
  if (summary.commands) {
    parts.push(t('Ran {count}', { count: summary.commands }));
  }
  if (summary.edits) {
    parts.push(t('Edited {count}', { count: summary.edits }));
  }
  if (summary.approvals) {
    parts.push(t('Approval {count}', { count: summary.approvals }));
  }
  return parts.join(' · ') || 'No activity';
}

function workDetailsForItem(item) {
  const orderedDetails = [];
  for (const [index, batch] of (item.batches || []).entries()) {
    const kind = classifyWorkBatch(batch);
    const fileChanges = workFileChanges(batch);
    orderedDetails.push({
      order: workTimelineEntryOrder(inlineWorkTimelineId(item.turnId, batch.batchId), index),
      fallbackOrder: index,
      detail: {
        id: batch.batchId || batch.id || `${item.turnId || 'turn'}-batch-${index}`,
        kind,
        title: workDetailTitle(batch, kind, fileChanges),
        status: batch.status || '',
        summary: batch.summary || {},
        fileChanges,
      },
    });
  }
  const batchCount = orderedDetails.length;
  for (const [index, approval] of (item.approvals || []).entries()) {
    const fallbackOrder = batchCount + index;
    orderedDetails.push({
      order: workTimelineEntryOrder(`approval_${approval.approvalId || ''}`, fallbackOrder),
      fallbackOrder,
      detail: {
        id: approval.approvalId || approval.id || `${item.turnId || 'turn'}-approval-${index}`,
        kind: 'approval',
        title: approval.summary?.command || approval.summary?.reason || approval.approvalKind || 'Approval requested',
        status: approval.resolved ? approval.summary?.decision || 'resolved' : 'requested',
        summary: approval.summary || {},
        fileChanges: [],
      },
    });
  }
  return orderedDetails
    .sort((left, right) => left.order - right.order || left.fallbackOrder - right.fallbackOrder)
    .map((entry) => entry.detail);
}

function workTimelineEntryOrder(entryId, fallbackOrder) {
  const index = state.timeline.findIndex((item) => item?.id === entryId);
  return index >= 0 ? index : state.timeline.length + fallbackOrder;
}

function workDetailTitle(batch, kind, fileChanges) {
  const summary = batch?.summary || {};
  if (kind === 'command' || kind === 'read') {
    return primitiveWorkText(summary.command) || primitiveWorkText(batch?.title) || 'Command';
  }
  if (kind === 'edit' && fileChanges.length) {
    const firstPath = primitiveWorkText(fileChanges[0]?.path);
    if (firstPath) {
      return fileChanges.length === 1
        ? firstPath
        : `${firstPath} +${fileChanges.length - 1}`;
    }
  }
  return primitiveWorkText(batch?.title)
    || primitiveWorkText(workTitleFromSummary(summary))
    || 'Tool activity';
}

function renderWorkDetail(detail) {
  const body = renderWorkDetailBody(detail);
  const eventStatus = formatWorkEventStatus(detail);
  return `
    <details class="work-detail" data-work-kind="${escapeAttribute(detail.kind)}" data-work-event-id="${escapeAttribute(detail.id || '')}">
      <summary>
        <span class="work-detail-chevron" aria-hidden="true"></span>
        <span class="work-event-kind">${escapeHtml(workKindLabel(detail.kind))}</span>
        <span class="work-event-title" data-i18n-skip>${escapeHtml(detail.title)}</span>
        ${eventStatus.label ? `<span class="work-event-status" data-tone="${escapeAttribute(eventStatus.tone)}" data-i18n-skip>${escapeHtml(eventStatus.label)}</span>` : ''}
      </summary>
      <div class="work-detail-body">
        ${body || '<p class="meta">No additional details.</p>'}
      </div>
    </details>
  `;
}

function formatWorkEventStatus(detail) {
  const exitCode = finiteWorkNumber(detail?.summary?.exitCode);
  if (exitCode !== null && exitCode !== 0) {
    return { label: t('Exit {code}', { code: exitCode }), tone: 'failed' };
  }
  const status = String(detail?.status || '').trim().toLowerCase();
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

function renderWorkDetailBody(detail) {
  const summary = detail.summary || {};
  const files = renderWorkFileChanges(detail.fileChanges || []);
  const diff = renderWorkTextBlock('Diff', summary.diff || summary.patch);
  const rows = renderWorkSummaryRows(summary);
  const output = renderWorkTextBlock('Output', summary.output ?? summary.stdout ?? summary.stderr);
  return [files, diff, rows, output].filter(Boolean).join('');
}

function renderWorkSummaryRows(summary) {
  const excludedKeys = [
    'fileChanges', 'file_changes', 'changes', 'files',
    'output', 'stdout', 'stderr', 'diff', 'patch', 'raw',
    'command', 'title', 'name', 'status', 'exitCode',
    'path', 'file', 'target', 'source',
  ];
  const entries = Object.entries(summary || {})
    .filter(([key, value]) => !excludedKeys.includes(key) && hasSummaryValue(value));
  if (!entries.length) {
    return '';
  }
  return `<div class="work-summary">${entries.map(([key, value]) => `
    <div class="work-row"><strong>${escapeHtml(startCase(key))}</strong><span data-i18n-skip>${escapeHtml(shorten(formatSummaryValue(value), 800))}</span></div>
  `).join('')}</div>`;
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
    `;
  }).join('')}</div>
  </div>`;
}

function renderWorkTextBlock(label, value) {
  const text = formatWorkTextValue(value);
  if (!text) {
    return '';
  }
  return `
    <div class="work-text-block">
      <strong class="work-section-label">${escapeHtml(t(label))}</strong>
      <pre class="work-output">${escapeHtml(shorten(text, MAX_TIMELINE_SUMMARY_TEXT))}</pre>
    </div>
  `;
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

function primitiveWorkText(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
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

function finiteWorkNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function hasSummaryValue(value) {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}

function classifyWorkBatch(batch) {
  if (batch.batchKind === 'file_change') {
    return 'edit';
  }
  if (batch.batchKind === 'command' && isReadCommand(batch.title || batch.summary?.command || '')) {
    return 'read';
  }
  if (batch.batchKind === 'command') {
    return 'command';
  }
  if (batch.batchKind === 'permission') {
    return 'approval';
  }
  return 'tool';
}

function currentSafeWorkActivityLabel() {
  if ([...state.approvals.values()].some((approval) => approval?.resolved === false)) {
    return 'Needs approval';
  }
  const turnId = String(state.turnId || '').trim();
  if (!turnId) {
    return '';
  }
  const batches = [...state.batches.values()].filter((batch) => batch?.turnId === turnId);
  const active = [...batches].reverse().find((batch) => {
    const status = String(batch?.status || '').trim().toLowerCase();
    return !status || status === 'started' || status === 'running' || status === 'pending';
  });
  if (active?.batchKind === 'command') {
    return 'Running command';
  }
  if (active?.batchKind === 'file_change') {
    return 'Editing files';
  }
  if (active?.batchKind === 'permission') {
    return 'Needs approval';
  }
  return active ? 'Using tool' : '';
}

function currentSessionWorkItems() {
  const grouped = new Map();
  for (const batch of state.batches.values()) {
    const turnId = String(batch?.turnId || '').trim();
    if (!turnId) {
      continue;
    }
    const batches = grouped.get(turnId) || [];
    batches.push(batch);
    grouped.set(turnId, batches);
  }
  return [...grouped.entries()]
    .map(([turnId, batches]) => buildWorkTimelineItem(turnId, batches))
    .filter(Boolean);
}

function workDetailsItemForTurn(turnId) {
  const normalizedTurnId = String(turnId || '').trim();
  if (!normalizedTurnId) {
    return null;
  }
  const batches = [...state.batches.values()].filter((batch) => batch?.turnId === normalizedTurnId);
  const approvals = [...state.approvals.values()].filter((approval) => approval?.turnId === normalizedTurnId);
  return buildWorkTimelineItem(normalizedTurnId, batches, '', approvals);
}

function currentWorkDetailsItem() {
  const currentTurnId = String(state.turnId || '').trim();
  let targetTurnId = '';
  if (state.workDetailsOpen && state.workDetailsTurnId) {
    targetTurnId = state.workDetailsTurnId;
  } else if (state.pendingTurn && currentTurnId) {
    targetTurnId = currentTurnId;
  } else {
    targetTurnId = String(state.latestTurnId || latestSessionTurnId() || '').trim();
  }
  if (!targetTurnId) {
    return null;
  }
  return workDetailsItemForTurn(targetTurnId);
}

function latestSessionTurnId() {
  const turns = Array.isArray(state.currentSession?.thread?.turns)
    ? state.currentSession.thread.turns
    : [];
  const latestTurn = turns.at(-1);
  return String(latestTurn?.id || latestTurn?.turnId || '').trim();
}

function currentWorkDetailsWindow(item) {
  const total = workDetailsForItem(item).length;
  const sameTurn = state.workDetailsTurnId === item.turnId;
  return {
    visibleEventLimit: sameTurn
      ? Math.max(WORK_DETAILS_EVENT_PAGE_SIZE, state.workDetailsVisibleEventLimit)
      : WORK_DETAILS_EVENT_PAGE_SIZE,
    visibleEndIndex: sameTurn
      ? Math.min(total, Math.max(0, state.workDetailsVisibleEndIndex))
      : total,
  };
}

function resetWorkDetailsWindow(item = currentWorkDetailsItem()) {
  const total = item ? workDetailsForItem(item).length : 0;
  state.workDetailsTurnId = item?.turnId || '';
  state.workDetailsVisibleEventLimit = WORK_DETAILS_EVENT_PAGE_SIZE;
  state.workDetailsVisibleEndIndex = total;
  state.workDetailsFollowLatest = true;
}

function canViewCurrentWorkDetails() {
  return canViewWorkDetailsForSession(state.currentSession);
}

function canViewWorkDetailsForSession(session) {
  if (!session || isShareContext()) {
    return false;
  }
  const principal = state.authSession?.principal;
  if (principal?.isAdmin === true || principal?.mode === 'single') {
    return true;
  }
  if (principal?.mode !== 'multi') {
    return false;
  }
  if (
    session.canViewWorkDetails === false
    || !state.projectsLoaded
    || state.workDetailsPolicyPendingSessionId === session.id
  ) {
    return false;
  }
  const projectId = String(session.projectId || '').trim();
  if (!projectId) {
    return false;
  }
  const project = state.projects.find((item) => String(item?.id || '').trim() === projectId);
  return project?.canViewWorkDetails === true;
}

function enforceCurrentWorkDetailsAccess() {
  if (canViewCurrentWorkDetails()) {
    restartTurnStreamForCurrentAudience();
    return;
  }
  const shouldPersistSanitization = shouldSanitizeRestrictedSession(state.currentSession);
  const shouldDeferPolicy = shouldDeferWorkDetailsPolicy(state.currentSession);
  const authPrincipalPending = isCachedAuthPrincipalPending();
  if (!shouldPersistSanitization && !shouldDeferPolicy) {
    state.workDetailsOpen = false;
    return;
  }
  const session = state.currentSession;
  if (shouldDeferPolicy && state.sessionId) {
    state.workDetailsPolicyPendingSessionId = state.sessionId;
  } else if (state.workDetailsPolicyPendingSessionId === state.sessionId) {
    state.workDetailsPolicyPendingSessionId = '';
  }
  state.workDetailsOpen = false;
  state.timeline = authPrincipalPending
    ? sanitizeUnverifiedTimelineEntries(state.timeline, session)
    : sanitizeRestrictedTimelineEntries(state.timeline, session);
  state.sessionHistoryItems = authPrincipalPending
    ? sanitizeUnverifiedTimelineEntries(state.sessionHistoryItems, session)
    : sanitizeRestrictedTimelineEntries(state.sessionHistoryItems, session);
  state.sessionHistoryStartIndex = visibleStartIndexForTimeline(state.sessionHistoryItems, state.timeline);
  state.batches = authPrincipalPending ? new Map() : sanitizeRestrictedWorkBatches(state.batches);
  state.approvals = authPrincipalPending ? new Map() : sanitizeRestrictedApprovals(state.approvals);
  if (state.error) {
    state.error = 'Turn failed';
  }
  if (state.currentSession) {
    state.currentSession = sanitizeRestrictedSessionDetails(state.currentSession);
  }
  if (shouldPersistSanitization && sanitizeCachedWorkDetailsForSession(state.sessionId, session)) {
    persistTimelineCache();
  }
  restartTurnStreamForCurrentAudience();
}

function restartTurnStreamForCurrentAudience() {
  if (!state.streamAbortController) {
    return;
  }
  const shouldIncludeWorkDetails = !shouldRestrictCurrentTurnEvents();
  if (state.streamIncludesWorkDetails === shouldIncludeWorkDetails) {
    return;
  }
  const turnId = String(state.turnId || '').trim();
  const shouldReconnect = Boolean(state.pendingTurn && turnId);
  if (!state.streamIncludesWorkDetails && shouldIncludeWorkDetails) {
    resetTurnEventCursorForReplay();
  }
  stopStream();
  if (shouldReconnect) {
    void streamTurnEvents(turnId, { forceReconnect: true });
  }
}

function replayActiveTurnAfterPrincipalConfirmation() {
  if (!state.pendingTurn || !state.turnId || !state.sessionId) {
    return false;
  }
  resetTurnEventCursorForReplay();
  return connectActiveTurnStream({ forceReconnect: true });
}

function resetTurnEventCursorForReplay() {
  state.lastTurnEventSequence = null;
  state.lastTurnEventEpoch = '';
  if (!state.sessionId) {
    return;
  }
  const cached = state.timelineCache.get(state.sessionId);
  if (!cached || !Object.prototype.hasOwnProperty.call(cached, 'streamCursor')) {
    return;
  }
  const next = { ...cached };
  delete next.streamCursor;
  state.timelineCache.set(state.sessionId, next);
  persistTimelineCache();
}

function enforceKnownWorkDetailsAccess() {
  const sessions = [
    state.currentSession,
    ...state.sessions,
    ...Object.values(state.sessionsByScope || {}).flat(),
  ].filter(Boolean);
  const seen = new Set();
  let changed = false;
  for (const session of sessions) {
    if (!session?.id || seen.has(session.id)) {
      continue;
    }
    seen.add(session.id);
    if (shouldSanitizeRestrictedSession(session)) {
      changed = sanitizeCachedWorkDetailsForSession(session.id, session) || changed;
    }
  }
  enforceCurrentWorkDetailsAccess();
  if (changed) {
    persistTimelineCache();
  }
}

function shouldSanitizeRestrictedSession(session) {
  if (!session || isShareContext()) {
    return false;
  }
  const principal = state.authSession?.principal;
  if (principal?.isAdmin === true || principal?.mode === 'single') {
    return false;
  }
  if (principal?.mode !== 'multi') {
    return false;
  }
  if (session.canViewWorkDetails === false) {
    return true;
  }
  if (!state.projectsLoaded) {
    return false;
  }
  return !canViewWorkDetailsForSession(session);
}

function shouldDeferWorkDetailsPolicy(session) {
  const principal = state.authSession?.principal;
  return Boolean(
    session
    && !isShareContext()
    && (
      isCachedAuthPrincipalPending()
      || (
        principal?.mode === 'multi'
        && principal.isAdmin !== true
        && session.canViewWorkDetails !== false
        && (
          !state.projectsLoaded
          || state.workDetailsPolicyPendingSessionId === session.id
        )
      )
    ),
  );
}

function isCachedAuthPrincipalPending() {
  return state.authSession?.id === 'cached' && !state.authSession?.principal;
}

function sanitizeUnverifiedTimelineEntries(entries, session = null) {
  return sanitizeRestrictedTimelineEntries(entries, session)
    .filter((item) => item?.kind === 'message');
}

function resolvePendingWorkDetailsPolicy() {
  const pendingSessionId = state.workDetailsPolicyPendingSessionId;
  if (!pendingSessionId || pendingSessionId !== state.sessionId || !state.currentSession) {
    state.workDetailsPolicyPendingSessionId = '';
    return;
  }
  state.workDetailsPolicyPendingSessionId = '';
  if (canViewCurrentWorkDetails()) {
    restoreTimelineForSession(state.currentSession, readOnlyTimelineRestoreOptions(state.currentSession));
    return;
  }
  enforceCurrentWorkDetailsAccess();
}

function sanitizeCachedWorkDetailsForSession(sessionId, session = null) {
  if (!sessionId) {
    return false;
  }
  const cached = state.timelineCache.get(sessionId);
  if (!cached) {
    return false;
  }
  state.timelineCache.set(sessionId, {
    ...cached,
    validatedAt: 0,
    historyComplete: false,
    timeline: sanitizeRestrictedTimelineEntries(cached.timeline, session),
    history: sanitizeRestrictedTimelineEntries(cached.history, session),
    batches: sanitizeRestrictedWorkBatches(cached.batches),
    approvals: sanitizeRestrictedApprovals(cached.approvals),
  });
  return true;
}

function sanitizeRestrictedSessionDetails(session) {
  if (!session || typeof session !== 'object') {
    return session;
  }
  const turns = Array.isArray(session.thread?.turns)
    ? session.thread.turns.map((turn) => ({
      id: turn?.id,
      status: turn?.status,
      error: turn?.error ? 'Turn failed' : turn?.error,
      items: restrictedConversationItemsForTurn(turn),
    }))
    : [];
  return {
    ...session,
    ...(session.thread ? { thread: { turns } } : {}),
    ...(Array.isArray(session.timeline)
      ? { timeline: sanitizeRestrictedTimelineEntries(session.timeline, session) }
      : {}),
  };
}

function restrictedConversationItemsForTurn(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const finalItems = new Set(restrictedFinalAssistantItemsForTurn(turn));
  return items
    .filter((item) => isUserConversationItem(item) || finalItems.has(item))
    .map((item) => ({
      ...(item?.itemId || item?.id ? { itemId: item.itemId || item.id } : {}),
      type: item?.type,
      role: item?.role,
      phase: item?.phase,
      text: item?.text,
    }));
}

function restrictedFinalAnswerTextCounts(session) {
  const counts = new Map();
  for (const turn of session?.thread?.turns || []) {
    for (const item of restrictedFinalAssistantItemsForTurn(turn)) {
      const value = String(item?.text || '').trim();
      if (value) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
  }
  return counts;
}

function restrictedFinalAssistantTimelineIndexes(entries, session) {
  const remainingByText = restrictedFinalAnswerTextCounts(session);
  const allowed = new Set();
  const timeline = Array.isArray(entries) ? entries : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.kind !== 'message' || item.role !== 'assistant') {
      continue;
    }
    const text = String(item.text || '').trim();
    const remaining = remainingByText.get(text) || 0;
    if (!text || remaining <= 0) {
      continue;
    }
    allowed.add(index);
    remainingByText.set(text, remaining - 1);
  }
  return allowed;
}

function restrictedFinalAssistantItemsForTurn(turn) {
  const assistantItems = (Array.isArray(turn?.items) ? turn.items : []).filter(isAssistantConversationItem);
  const explicitFinals = assistantItems.filter((item) => String(item?.phase || '').trim().toLowerCase() === 'final_answer');
  if (explicitFinals.length || !isSuccessTurnStatus(turn?.status)) {
    return explicitFinals;
  }
  for (let index = assistantItems.length - 1; index >= 0; index -= 1) {
    if (!String(assistantItems[index]?.phase || '').trim()) {
      return [assistantItems[index]];
    }
  }
  return [];
}

function isUserConversationItem(item) {
  const role = String(item?.role || '').trim().toLowerCase();
  const type = String(item?.type || '').replace(/[^a-z]/giu, '').toLowerCase();
  return role === 'user' || (!role && type.includes('user') && type.includes('message'));
}

function isAssistantConversationItem(item) {
  const role = String(item?.role || '').trim().toLowerCase();
  const type = String(item?.type || '').replace(/[^a-z]/giu, '').toLowerCase();
  const assistantRole = role === 'assistant' || (!role && (type.includes('assistant') || type.includes('agent')));
  return assistantRole && (!type || type === 'message' || type.includes('message'));
}

function sanitizeRestrictedTimelineEntries(entries, session = null) {
  const timeline = Array.isArray(entries) ? entries : [];
  const allowedFinalIndexes = restrictedFinalAssistantTimelineIndexes(timeline, session);
  return timeline.flatMap((item, index) => {
    if (item?.kind === 'approval') {
      return [sanitizeRestrictedApproval(item)];
    }
    if (item?.kind !== 'message') {
      return [];
    }
    if (item.role === 'user') {
      return [cloneTimelineItem(item)].filter(Boolean);
    }
    if (item.role === 'system') {
      return item.severity === 'error'
        ? [{
          id: item.id || 'restricted_turn_error',
          kind: 'message',
          role: 'system',
          label: 'Error',
          meta: 'failed',
          text: 'Turn failed',
          severity: 'error',
        }]
        : [];
    }
    if (item.role !== 'assistant') {
      return [];
    }
    const text = String(item.text || '').trim();
    const meta = String(item.meta || '').trim().toLowerCase();
    const explicitlyFinal = meta === 'final' || meta === 'final_answer';
    if (!text || (!explicitlyFinal && !allowedFinalIndexes.has(index))) {
      return [];
    }
    return [{
      id: item.id || `restricted_assistant_${text.slice(0, 24)}`,
      kind: 'message',
      role: 'assistant',
      label: 'Assistant',
      meta: 'final',
      phase: 'final_answer',
      text,
      ...(timelineTurnId(item) ? { turnId: timelineTurnId(item) } : {}),
      ...(typeof item.itemId === 'string' && item.itemId ? { itemId: item.itemId } : {}),
      ...(typeof item.projectionKey === 'string' && item.projectionKey ? { projectionKey: item.projectionKey } : {}),
      lifecycle: 'completed',
    }];
  });
}

function sanitizeRestrictedApprovals(value) {
  const entries = value instanceof Map
    ? [...value.entries()]
    : Array.isArray(value)
      ? value.filter(isCacheMapPair)
      : [];
  return new Map(entries.map(([approvalId, approval]) => [approvalId, sanitizeRestrictedApproval(approval)]));
}

function sanitizeRestrictedApproval(approval) {
  return {
    id: typeof approval?.id === 'string' ? approval.id : `approval_${approval?.approvalId || ''}`,
    kind: 'approval',
    approvalId: typeof approval?.approvalId === 'string' ? approval.approvalId : '',
    approvalKind: typeof approval?.approvalKind === 'string' ? approval.approvalKind : '',
    turnId: typeof approval?.turnId === 'string' ? approval.turnId : '',
    summary: sanitizeRestrictedApprovalSummary(approval?.summary),
    resolved: approval?.resolved === true,
  };
}

function sanitizeRestrictedApprovalSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return {};
  }
  const result = {};
  const availableDecisionKeys = Array.isArray(summary.availableDecisionKeys)
    ? summary.availableDecisionKeys.filter((key) => typeof key === 'string' && key.trim())
    : [];
  if (availableDecisionKeys.length) {
    result.availableDecisionKeys = availableDecisionKeys;
  }
  for (const key of ['command', 'reason', 'grantRoot']) {
    if (typeof summary[key] === 'string' && summary[key].trim()) {
      result[key] = summary[key];
    }
  }
  if (typeof summary.networkPermission === 'boolean') {
    result.networkPermission = summary.networkPermission;
  }
  for (const key of ['fileReadPermissions', 'fileWritePermissions', 'execPolicyAmendment']) {
    const values = Array.isArray(summary[key])
      ? summary[key].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())
      : [];
    if (values.length) {
      result[key] = values;
    }
  }
  if (Array.isArray(summary.fileChanges)) {
    result.fileChanges = summary.fileChanges.map((change) => {
      if (typeof change === 'string') {
        return change.trim() ? change : null;
      }
      if (!change || typeof change !== 'object' || Array.isArray(change)) {
        return null;
      }
      return Object.fromEntries(
        ['path', 'target']
          .filter((key) => Object.prototype.hasOwnProperty.call(change, key))
          .map((key) => [key, sanitizeCacheValue(change[key])]),
      );
    }).filter(Boolean);
  }
  return result;
}

function syncProjectWorkDetailsCapability(session) {
  const principal = state.authSession?.principal;
  if (principal?.mode !== 'multi' || principal.isAdmin === true || session?.canViewWorkDetails !== false) {
    return;
  }
  const projectId = String(session.projectId || '').trim();
  if (!projectId) {
    return;
  }
  state.projects = state.projects.map((project) => (
    String(project?.id || '').trim() === projectId
      ? { ...project, canViewWorkDetails: false }
      : project
  ));
}

function sanitizeRestrictedWorkBatches(value) {
  const entries = value instanceof Map
    ? [...value.entries()]
    : Array.isArray(value)
      ? value.filter(isCacheMapPair)
      : [];
  return new Map(entries.map(([batchId, batch]) => [batchId, {
    id: typeof batch?.id === 'string' ? batch.id : `batch_${batchId}`,
    kind: 'batch',
    turnId: typeof batch?.turnId === 'string' ? batch.turnId : '',
    batchId: typeof batch?.batchId === 'string' ? batch.batchId : batchId,
    batchKind: ['command', 'file_change', 'permission'].includes(batch?.batchKind) ? batch.batchKind : 'unknown',
    title: safeWorkTitleForKind(batch?.batchKind),
    status: typeof batch?.status === 'string' ? batch.status : '',
    summary: {},
  }]));
}

function safeWorkTitleForKind(kind) {
  if (kind === 'command') {
    return 'Running command';
  }
  if (kind === 'file_change') {
    return 'Editing files';
  }
  if (kind === 'permission') {
    return 'Needs approval';
  }
  return 'Using tool';
}

function openWorkDetails(trigger = document.activeElement, turnId = '') {
  const item = turnId ? workDetailsItemForTurn(turnId) : currentWorkDetailsItem();
  if (!canViewCurrentWorkDetails() || !item) {
    return;
  }
  rememberFocusReturn(trigger);
  resetWorkDetailsWindow(item);
  state.workDetailsOpen = true;
  render();
  requestAnimationFrame(() => {
    const list = document.querySelector('.work-details-list');
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  });
}

function closeWorkDetails() {
  if (!state.workDetailsOpen) {
    return;
  }
  requestFocusRestore();
  state.workDetailsOpen = false;
  resetWorkDetailsWindow(null);
  render();
}

function isReadCommand(command) {
  return /^(rg|sed|cat|less|head|tail|ls|find|git\s+(show|diff|status|log|grep)|wc)\b/u.test(String(command || '').trim());
}

function workChangedFiles(batch) {
  return workFileChanges(batch)
    .map((change) => primitiveWorkText(change?.path))
    .filter(Boolean)
    .map(String);
}

function workFileChanges(batch) {
  const summary = batch?.summary || {};
  for (const value of [summary.fileChanges, summary.file_changes, summary.changes, summary.files]) {
    const changes = normalizeWorkFileChanges(value);
    if (changes.length) {
      return changes;
    }
  }
  const path = workFilePath(summary.path ?? summary.file ?? summary.target ?? summary.source);
  return path ? [{ path }] : [];
}

function normalizeWorkFileChanges(value, fallbackPath = '', depth = 0) {
  if (depth > 4 || value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeWorkFileChanges(entry, '', depth + 1));
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      return [];
    }
    if (fallbackPath) {
      return [{ path: fallbackPath, ...(isWorkFileAction(text) ? { action: text } : {}) }];
    }
    return [{ path: text }];
  }
  if (!value || typeof value !== 'object') {
    return fallbackPath ? [{ path: fallbackPath }] : [];
  }
  const directPath = workFilePath(value.path ?? value.file ?? value.target ?? value.source) || fallbackPath;
  if (directPath) {
    const action = primitiveWorkText(value.action ?? value.type ?? value.status);
    const additions = finiteWorkNumber(value.additions ?? value.added ?? value.linesAdded);
    const deletions = finiteWorkNumber(value.deletions ?? value.deleted ?? value.linesDeleted);
    return [{
      path: directPath,
      ...(action ? { action } : {}),
      ...(additions !== null ? { additions } : {}),
      ...(deletions !== null ? { deletions } : {}),
    }];
  }
  for (const key of ['fileChanges', 'file_changes', 'changes', 'files']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }
    const nested = normalizeWorkFileChanges(value[key], '', depth + 1);
    if (nested.length) {
      return nested;
    }
  }
  return Object.entries(value).flatMap(([path, change]) => {
    const normalizedPath = primitiveWorkText(path);
    return normalizedPath
      ? normalizeWorkFileChanges(change, normalizedPath, depth + 1)
      : [];
  });
}

function workFilePath(value) {
  const direct = primitiveWorkText(value);
  if (direct) {
    return direct;
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  return primitiveWorkText(value.path ?? value.value ?? value.text ?? value.name);
}

function isWorkFileAction(value) {
  return /^(?:add|added|create|created|delete|deleted|modify|modified|remove|removed|update|updated)$/iu.test(value);
}

function workTitleFromSummary(summary) {
  return summary?.command || summary?.reason || '';
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

function renderSummary(summary) {
  const entries = Object.entries(summary || {}).filter(([, value]) => hasSummaryValue(value));
  if (!entries.length) {
    return `<p class="meta">${escapeHtml(t('No additional details.'))}</p>`;
  }
  return `<div class="summary-list">${entries.map(([key, value]) => `
    <div class="summary-item">
      <strong>${escapeHtml(t(startCase(key)))}</strong>
      <span data-i18n-skip>${escapeHtml(formatSummaryValue(value))}</span>
    </div>
  `).join('')}</div>`;
}

function renderModelOptions(currentValue = state.model) {
  const current = currentValue || '';
  const options = [{ id: '', label: t('Use Codex default') }];
  if (!state.models.length) {
    if (current) {
      options.push({ id: current, label: current });
    }
  } else {
    for (const model of state.models) {
      options.push({
        id: modelId(model),
        label: modelLabel(model),
      });
    }
    if (current && !options.some((option) => option.id === current)) {
      options.unshift({ id: current, label: current });
    }
  }
  return options.map((option) => {
    const value = option.id || '';
    const selected = value === current ? ' selected' : '';
    const fallbackLabel = !state.models.length && !current ? t(option.label) : option.label;
    return `<option value="${escapeAttribute(value)}"${selected} data-i18n-skip>${escapeHtml(fallbackLabel)}</option>`;
  }).join('');
}

function renderReasoningOptions(currentValue = state.reasoningEffort, modelValue = state.model) {
  const selected = reasoningEffortForModel(modelValue, currentValue);
  const options = uniqueStrings([
    ...reasoningEffortsForModel(modelValue),
    selected,
  ]);
  const inherited = selected ? '' : ' selected';
  return `<option value=""${inherited} data-i18n-skip>${escapeHtml(t('Use Codex default'))}</option>${renderOptions(options, selected)}`;
}

function renderOptions(values, current) {
  return values.map((value) => {
    const selected = value === current ? ' selected' : '';
    const label = value === 'xhigh' ? 'xhigh' : startCase(value);
    return `<option value="${escapeAttribute(value)}"${selected} data-i18n-skip>${escapeHtml(label)}</option>`;
  }).join('');
}

function modelId(model) {
  return normalizeNonEmptyString(model?.id)
    || normalizeNonEmptyString(model?.model)
    || normalizeNonEmptyString(model?.name)
    || '';
}

function modelLabel(model) {
  return normalizeNonEmptyString(model?.label)
    || normalizeNonEmptyString(model?.displayName)
    || normalizeNonEmptyString(model?.model)
    || normalizeNonEmptyString(model?.id)
    || normalizeNonEmptyString(model?.name)
    || 'Unnamed model';
}

function findModelInfo(modelValue) {
  const target = normalizeNonEmptyString(modelValue);
  if (!target) {
    return null;
  }
  return state.models.find((model) => {
    const ids = [
      model?.id,
      model?.model,
      model?.name,
    ].map(normalizeNonEmptyString);
    return ids.includes(target);
  }) || null;
}

function codexDefaultModelInfo() {
  return state.models.find((model) => model?.isDefault === true) || state.models[0] || null;
}

function reasoningEffortsForModel(modelValue) {
  const model = findModelInfo(modelValue);
  const supported = normalizeReasoningEffortList(model?.supportedReasoningEfforts);
  const defaultEffort = normalizeNonEmptyString(model?.defaultReasoningEffort);
  if (supported.length) {
    return uniqueStrings([...supported, defaultEffort]);
  }
  return uniqueStrings([defaultEffort, ...FALLBACK_REASONING_EFFORTS]);
}

function reasoningEffortForModel(modelValue, effortValue) {
  const model = findModelInfo(modelValue);
  const requested = normalizeNonEmptyString(effortValue);
  if (!requested) {
    return '';
  }
  const supported = normalizeReasoningEffortList(model?.supportedReasoningEfforts);
  if (!supported.length) {
    return requested || normalizeNonEmptyString(model?.defaultReasoningEffort) || DEFAULT_REASONING_EFFORT;
  }
  if (requested && supported.includes(requested)) {
    return requested;
  }
  return normalizeNonEmptyString(model?.defaultReasoningEffort) || supported[0] || DEFAULT_REASONING_EFFORT;
}

function normalizeReasoningEffortList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return uniqueStrings(values.map((entry) => {
    if (typeof entry === 'string') {
      return entry;
    }
    return entry?.reasoningEffort;
  }));
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeNonEmptyString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function beginRenderEventBindings() {
  renderEventController?.abort();
  timelineEventController?.abort();
  renderEventController = new AbortController();
  timelineEventController = null;
}

function beginTimelineEventBindings() {
  timelineEventController?.abort();
  timelineEventController = new AbortController();
}

function listenRendered(target, type, listener, options = {}) {
  listenWithSignal(target, type, listener, options, renderEventController?.signal);
}

function listenTimeline(target, type, listener, options = {}) {
  listenWithSignal(target, type, listener, options, timelineEventController?.signal);
}

function listenWithSignal(target, type, listener, options, signal) {
  if (!target || !signal) {
    return;
  }
  const normalizedOptions = typeof options === 'boolean'
    ? { capture: options, signal }
    : { ...(options || {}), signal };
  target.addEventListener(type, listener, normalizedOptions);
}

function bindGlobalEvents() {
  const loginForm = document.querySelector('#login-form');
  if (loginForm) {
    listenRendered(loginForm, 'submit', onLoginSubmit);
  }

  const composerForm = document.querySelector('#composer-form');
  if (composerForm) {
    listenRendered(composerForm, 'submit', onComposerSubmit);
  }

  for (const button of document.querySelectorAll('[data-queued-message-id]')) {
    listenRendered(button, 'click', () => {
      removeQueuedMessage(currentQueuedSessionId(), button.getAttribute('data-queued-message-id') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-submission-retry-id]')) {
    listenRendered(button, 'click', () => {
      void retrySubmission(button.getAttribute('data-submission-retry-id') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-submission-cancel-id]')) {
    listenRendered(button, 'click', () => {
      cancelSubmission(button.getAttribute('data-submission-cancel-id') || '');
    });
  }

  const logoutButton = document.querySelector('#logout-button');
  if (logoutButton) {
    listenRendered(logoutButton, 'click', onLogout);
  }

  const settingsLogoutButton = document.querySelector('#settings-logout-button');
  if (settingsLogoutButton) {
    listenRendered(settingsLogoutButton, 'click', onLogout);
  }

  const openAppSettingsButton = document.querySelector('#open-app-settings-button');
  if (openAppSettingsButton) {
    listenRendered(openAppSettingsButton, 'click', () => {
      openAppSettingsPage();
    });
  }

  const openNewSessionButton = document.querySelector('#open-new-session-button');
  if (openNewSessionButton) {
    listenRendered(openNewSessionButton, 'click', () => {
      openNewSessionPage();
    });
  }

  const openAdminConsoleButton = document.querySelector('#open-admin-console-button');
  if (openAdminConsoleButton) {
    listenRendered(openAdminConsoleButton, 'click', () => {
      void openAdminConsole();
    });
  }

  const stopButton = document.querySelector('#stop-button');
  if (stopButton) {
    listenRendered(stopButton, 'click', onStopTurn);
  }

  bindComposerStatusAction();

  const closeWorkDetailsButton = document.querySelector('#close-work-details-button');
  if (closeWorkDetailsButton) {
    listenRendered(closeWorkDetailsButton, 'click', closeWorkDetails);
  }

  const workDetailsList = document.querySelector('.work-details-list');
  if (workDetailsList) {
    listenRendered(workDetailsList, 'click', handleWorkDetailsListClick);
    listenRendered(workDetailsList, 'scroll', updateWorkDetailsFollowState, { passive: true });
    listenRendered(workDetailsList, 'toggle', handleWorkDetailToggle, { capture: true });
  }

  const runtimeReloadButton = document.querySelector('#runtime-reload-button');
  if (runtimeReloadButton) {
    listenRendered(runtimeReloadButton, 'click', () => {
      void reloadRuntime();
    });
  }

  const composerRefreshButton = document.querySelector('#composer-refresh-button');
  if (composerRefreshButton) {
    listenRendered(composerRefreshButton, 'click', () => {
      void handleComposerRefresh();
    });
  }

  const attachButton = document.querySelector('#attach-button');
  const attachmentInput = document.querySelector('#attachment-input');
  if (attachButton) {
    listenRendered(attachButton, 'click', openAttachmentPicker);
  }
  if (attachmentInput) {
    listenRendered(attachmentInput, 'change', handleAttachmentInputChange);
  }

  for (const button of document.querySelectorAll('[data-attachment-remove-id]')) {
    listenRendered(button, 'click', () => {
      removeComposerAttachment(button.getAttribute('data-attachment-remove-id') || '');
    });
  }

  const mobileSidebarToggleButton = document.querySelector('#mobile-sidebar-toggle-button');
  if (mobileSidebarToggleButton) {
    listenRendered(mobileSidebarToggleButton, 'click', () => {
      rememberFocusReturn(mobileSidebarToggleButton);
      setMobileSidebarOpen(true);
    });
  }

  const mobileDrawerCloseButton = document.querySelector('#mobile-drawer-close-button');
  if (mobileDrawerCloseButton) {
    listenRendered(mobileDrawerCloseButton, 'click', closeMobileSidebar);
  }

  const mobileProjectDrawerBackdrop = document.querySelector('#mobile-drawer-backdrop');
  if (mobileProjectDrawerBackdrop) {
    listenRendered(mobileProjectDrawerBackdrop, 'click', (event) => {
      if (event.target !== mobileProjectDrawerBackdrop) {
        return;
      }
      closeMobileSidebar();
    });
  }

  for (const button of document.querySelectorAll('[data-project-scope-key]')) {
    listenRendered(button, 'click', () => {
      void selectProjectScope(button.getAttribute('data-project-scope-key') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-project-favorite-id]')) {
    listenRendered(button, 'click', (event) => {
      event.stopPropagation();
      void toggleProjectFavorite(button.getAttribute('data-project-favorite-id') || '');
    });
  }

  const desktopEmptyNewSessionButton = document.querySelector('#desktop-empty-new-session-button');
  if (desktopEmptyNewSessionButton) {
    listenRendered(desktopEmptyNewSessionButton, 'click', () => {
      openNewSessionPage();
    });
  }

  const desktopSettingsCloseButton = document.querySelector('#desktop-settings-close-button');
  if (desktopSettingsCloseButton) {
    listenRendered(desktopSettingsCloseButton, 'click', () => {
      requestFocusRestore();
      state.desktopSettingsOpen = false;
      render();
    });
  }

  const shareSessionButton = document.querySelector('#share-session-button');
  if (shareSessionButton) {
    listenRendered(shareSessionButton, 'click', () => {
      void shareCurrentSession();
    });
  }

  const copyShareLinkButton = document.querySelector('#copy-share-link-button');
  if (copyShareLinkButton) {
    listenRendered(copyShareLinkButton, 'click', () => {
      void copyShareLink(state.shareDialog?.url || '');
    });
  }

  const closeShareDialogButton = document.querySelector('#close-share-dialog-button');
  if (closeShareDialogButton) {
    listenRendered(closeShareDialogButton, 'click', closeShareDialog);
  }

  for (const backdrop of document.querySelectorAll('[data-modal-dismiss]')) {
    listenRendered(backdrop, 'click', (event) => {
      if (event.target === backdrop) {
        event.stopPropagation?.();
        closeFocusScope(backdrop.getAttribute('data-modal-dismiss') || '');
      }
    });
  }

  for (const control of document.querySelectorAll('[data-session-file-path]')) {
    if (control.closest?.('#timeline')) {
      continue;
    }
    listenRendered(control, 'click', (event) => {
      event.preventDefault();
      void openSessionFileByPath(control.getAttribute('data-session-file-path') || '');
    });
  }

  const closeSessionFileButton = document.querySelector('#close-session-file-button');
  if (closeSessionFileButton) {
    listenRendered(closeSessionFileButton, 'click', closeSessionFileViewer);
  }

  const retrySessionFileButton = document.querySelector('#retry-session-file-button');
  if (retrySessionFileButton) {
    listenRendered(retrySessionFileButton, 'click', () => {
      void openSessionFileByPath(state.currentSessionFilePath, { preserveSnapshot: true });
    });
  }

  const backToListButton = document.querySelector('#back-to-list-button');
  if (backToListButton) {
    listenRendered(backToListButton, 'click', () => {
      showSessionList();
    });
  }

  bindSessionCardEvents();

  for (const button of document.querySelectorAll('[data-sort-mode]')) {
    listenRendered(button, 'click', () => {
      void setSessionSortMode(button.getAttribute('data-sort-mode') || 'favorites');
    });
  }

  for (const button of document.querySelectorAll('[data-session-archive-confirm-id]')) {
    listenRendered(button, 'click', () => {
      void archiveSession(button.getAttribute('data-session-archive-confirm-id') || '');
    });
  }

  const archiveCancelButton = document.querySelector('#archive-cancel-button');
  if (archiveCancelButton) {
    listenRendered(archiveCancelButton, 'click', () => {
      cancelArchiveSession();
    });
  }

  const newSessionForm = document.querySelector('#new-session-form');
  if (newSessionForm) {
    listenRendered(newSessionForm, 'submit', onNewSessionSubmit);
  }

  const newCwdInput = document.querySelector('#new-cwd-input');
  if (newCwdInput) {
    listenRendered(newCwdInput, 'input', (event) => {
      state.newCwd = event.target.value;
    });
  }

  const newProjectSelect = document.querySelector('#new-project-select');
  if (newProjectSelect) {
    listenRendered(newProjectSelect, 'change', (event) => {
      state.newProjectId = event.target.value;
    });
  }

  const adminMultiUserToggle = document.querySelector('#admin-multi-user-toggle');
  if (adminMultiUserToggle) {
    listenRendered(adminMultiUserToggle, 'change', (event) => {
      void updateAdminSettings({ multiUserEnabled: event.target.checked });
    });
  }

  const adminSessionUserFilter = document.querySelector('#admin-session-user-filter');
  if (adminSessionUserFilter) {
    listenRendered(adminSessionUserFilter, 'change', (event) => {
      void refreshAdminSessions({ userId: event.target.value, renderAfter: true });
    });
  }

  const adminSessionProjectFilter = document.querySelector('#admin-session-project-filter');
  if (adminSessionProjectFilter) {
    listenRendered(adminSessionProjectFilter, 'change', (event) => {
      void refreshAdminSessions({ projectId: event.target.value, renderAfter: true });
    });
  }

  const adminSessionStateFilter = document.querySelector('#admin-session-state-filter');
  if (adminSessionStateFilter) {
    listenRendered(adminSessionStateFilter, 'change', (event) => {
      void refreshAdminSessions({ state: event.target.value, renderAfter: true });
    });
  }

  for (const button of document.querySelectorAll('[data-admin-page]')) {
    listenRendered(button, 'click', () => {
      state.admin.page = normalizeAdminPage(button.getAttribute('data-admin-page') || '');
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-admin-edit-project]')) {
    listenRendered(button, 'click', () => {
      state.admin.editingProjectId = button.getAttribute('data-admin-edit-project') || '';
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-admin-edit-role]')) {
    listenRendered(button, 'click', () => {
      state.admin.editingRoleId = button.getAttribute('data-admin-edit-role') || '';
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-admin-edit-user]')) {
    listenRendered(button, 'click', () => {
      state.admin.editingUserId = button.getAttribute('data-admin-edit-user') || '';
      render();
    });
  }

  const adminProjectEditCancel = document.querySelector('#admin-project-edit-cancel');
  if (adminProjectEditCancel) {
    listenRendered(adminProjectEditCancel, 'click', () => {
      state.admin.editingProjectId = '';
      render();
    });
  }

  const adminRoleEditCancel = document.querySelector('#admin-role-edit-cancel');
  if (adminRoleEditCancel) {
    listenRendered(adminRoleEditCancel, 'click', () => {
      state.admin.editingRoleId = '';
      render();
    });
  }

  const adminUserEditCancel = document.querySelector('#admin-user-edit-cancel');
  if (adminUserEditCancel) {
    listenRendered(adminUserEditCancel, 'click', () => {
      state.admin.editingUserId = '';
      render();
    });
  }

  const adminProjectForm = document.querySelector('#admin-project-form');
  if (adminProjectForm) {
    listenRendered(adminProjectForm, 'submit', (event) => {
      void onAdminProjectSubmit(event);
    });
  }

  const adminRoleForm = document.querySelector('#admin-role-form');
  if (adminRoleForm) {
    listenRendered(adminRoleForm, 'submit', (event) => {
      void onAdminRoleSubmit(event);
    });
  }

  const adminUserForm = document.querySelector('#admin-user-form');
  if (adminUserForm) {
    listenRendered(adminUserForm, 'submit', (event) => {
      void onAdminUserSubmit(event);
    });
  }

  for (const button of document.querySelectorAll('[data-admin-toggle-user-id]')) {
    listenRendered(button, 'click', () => {
      void toggleAdminUserEnabled(
        button.getAttribute('data-admin-toggle-user-id') || '',
        button.getAttribute('data-admin-toggle-user-enabled') === 'true',
      );
    });
  }

  for (const button of document.querySelectorAll('[data-admin-delete-user-id]')) {
    listenRendered(button, 'click', () => {
      void deleteAdminUser(button.getAttribute('data-admin-delete-user-id') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-admin-session-id]')) {
    listenRendered(button, 'click', () => {
      void openAdminObservedSession(button.getAttribute('data-admin-session-id') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-cwd-choice]')) {
    listenRendered(button, 'click', () => {
      state.newCwd = button.getAttribute('data-cwd-choice') || '';
      render();
    });
  }

  const promptInput = document.querySelector('#prompt-input');
  if (promptInput) {
    listenRendered(promptInput, 'touchstart', syncPromptFocusLayout, { passive: true });
    listenRendered(promptInput, 'focus', syncPromptFocusLayout);
    listenRendered(promptInput, 'keydown', handlePromptKeydown);
    listenRendered(promptInput, 'paste', (event) => {
      void handlePromptPaste(event);
    });
    listenRendered(promptInput, 'input', (event) => {
      state.prompt = event.target.value;
      savePromptDraftForCurrentSession();
      syncPromptInputLayout(event.target);
    });
    updateComposerExpansionState(promptInput);
    autoGrowPromptInput(promptInput);
  }

  const settingsToggle = document.querySelector('#settings-toggle');
  if (settingsToggle) {
    listenRendered(settingsToggle, 'click', toggleSettingsDrawer);
  }

  const settingsDrawerClose = document.querySelector('#settings-drawer-close');
  if (settingsDrawerClose) {
    listenRendered(settingsDrawerClose, 'click', toggleSettingsDrawer);
  }

  const composerExpandButton = document.querySelector('#composer-expand-button');
  if (composerExpandButton) {
    listenRendered(composerExpandButton, 'click', toggleComposerExpanded);
  }

  for (const button of document.querySelectorAll('[data-message-font-size]')) {
    listenRendered(button, 'click', () => {
      setMessageFontSize(button.getAttribute('data-message-font-size') || DEFAULT_MESSAGE_FONT_SIZE);
    });
  }

  for (const button of document.querySelectorAll('[data-app-language]')) {
    listenRendered(button, 'click', () => {
      applyLanguage(button.getAttribute('data-app-language') || DEFAULT_LANGUAGE);
      render();
    });
  }

  const modelSelect = document.querySelector('#model-select');
  if (modelSelect) {
    listenRendered(modelSelect, 'change', (event) => {
      state.model = event.target.value;
      state.reasoningEffort = state.model
        ? reasoningEffortForModel(state.model, state.reasoningEffort)
        : '';
      withTimelineScrollPreserved(() => render());
      void updateSessionSettings();
    });
  }

  const reasoningSelect = document.querySelector('#reasoning-select');
  if (reasoningSelect) {
    listenRendered(reasoningSelect, 'change', (event) => {
      state.reasoningEffort = event.target.value;
      void updateSessionSettings();
    });
  }

  for (const button of document.querySelectorAll('[data-mode]')) {
    listenRendered(button, 'click', () => {
      state.collaborationMode = button.getAttribute('data-mode') || 'default';
      void updateSessionSettings();
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-permission-preset]')) {
    listenRendered(button, 'click', () => {
      applyPermissionPreset(button.getAttribute('data-permission-preset') || 'default');
      void updateSessionSettings();
      render();
    });
  }

  const defaultModelSelect = document.querySelector('#default-model-select');
  if (defaultModelSelect) {
    listenRendered(defaultModelSelect, 'change', (event) => {
      applyDefaultThreadSettings({
        model: event.target.value,
        reasoningEffort: event.target.value
          ? reasoningEffortForModel(event.target.value, state.defaultThreadSettings.reasoningEffort)
          : '',
      });
      render();
    });
  }

  const defaultReasoningSelect = document.querySelector('#default-reasoning-select');
  if (defaultReasoningSelect) {
    listenRendered(defaultReasoningSelect, 'change', (event) => {
      applyDefaultThreadSettings({ reasoningEffort: event.target.value });
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-app-theme]')) {
    listenRendered(button, 'click', () => {
      applyTheme(button.getAttribute('data-app-theme') || DEFAULT_THEME);
      render();
    });
  }

  const siteTitleInput = document.querySelector('#site-title-input');
  if (siteTitleInput) {
    listenRendered(siteTitleInput, 'change', (event) => {
      void saveSiteTitle(event.target.value);
    });
  }

  const webhookEnabledToggle = document.querySelector('#webhook-enabled-toggle');
  if (webhookEnabledToggle) {
    listenRendered(webhookEnabledToggle, 'change', (event) => {
      rememberFocusReturn(webhookEnabledToggle);
      void setWebhookEnabled(event.target.checked === true);
    });
  }

  const webhookCopyEndpointButton = document.querySelector('#webhook-copy-endpoint-button');
  if (webhookCopyEndpointButton) {
    listenRendered(webhookCopyEndpointButton, 'click', () => {
      void copyWebhookEndpoint();
    });
  }

  const webhookRotateKeyButton = document.querySelector('#webhook-rotate-key-button');
  if (webhookRotateKeyButton) {
    listenRendered(webhookRotateKeyButton, 'click', () => {
      requestWebhookKeyRotation(webhookRotateKeyButton);
    });
  }

  const webhookRotateCancelButton = document.querySelector('#webhook-rotate-cancel-button');
  if (webhookRotateCancelButton) {
    listenRendered(webhookRotateCancelButton, 'click', cancelWebhookKeyRotation);
  }

  const webhookRotateConfirmButton = document.querySelector('#webhook-rotate-confirm-button');
  if (webhookRotateConfirmButton) {
    listenRendered(webhookRotateConfirmButton, 'click', () => {
      void rotateWebhookKey();
    });
  }

  const webhookCopyKeyButton = document.querySelector('#webhook-copy-key-button');
  if (webhookCopyKeyButton) {
    listenRendered(webhookCopyKeyButton, 'click', () => {
      void copyWebhookKey();
    });
  }

  for (const button of document.querySelectorAll('[data-default-mode]')) {
    listenRendered(button, 'click', () => {
      applyDefaultThreadSettings({ collaborationMode: button.getAttribute('data-default-mode') || DEFAULT_COLLABORATION_MODE });
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-default-permission-preset]')) {
    listenRendered(button, 'click', () => {
      applyDefaultThreadSettings({ accessPreset: button.getAttribute('data-default-permission-preset') || DEFAULT_PERMISSION_PRESET });
      render();
    });
  }

}

function bindSessionCardEvents(root = document) {
  listenRendered(root, 'click', (event) => {
    const button = event.target?.closest?.([
      '#retry-sessions-button',
      '[data-session-id]',
      '[data-session-favorite-id]',
      '[data-session-archive-request-id]',
      '[data-session-unarchive-id]',
    ].join(','));
    if (!button || (root !== document && !root.contains?.(button))) {
      return;
    }
    if (button.id === 'retry-sessions-button') {
      void refreshSessionsList({ renderAfter: true, scope: currentSessionScope() }).catch(() => {});
      return;
    }
    const sessionId = button.getAttribute('data-session-id');
    if (sessionId) {
      rememberSessionListScroll();
      void selectSession(sessionId);
      return;
    }
    const favoriteSessionId = button.getAttribute('data-session-favorite-id');
    if (favoriteSessionId) {
      void toggleSessionFavorite(favoriteSessionId);
      return;
    }
    const archiveSessionId = button.getAttribute('data-session-archive-request-id');
    if (archiveSessionId) {
      requestArchiveSession(archiveSessionId);
      return;
    }
    const unarchiveSessionId = button.getAttribute('data-session-unarchive-id');
    if (unarchiveSessionId) {
      void unarchiveSession(unarchiveSessionId);
    }
  });
}

function openAttachmentPicker() {
  document.querySelector('#attachment-input')?.click?.();
}

function resetComposerOffset() {
  composerOffsetRun += 1;
  if (composerResizeObserver) {
    composerResizeObserver.disconnect();
    composerResizeObserver = null;
  }
  document.documentElement.style.removeProperty('--composer-offset');
}

function syncComposerOffset() {
  composerOffsetRun += 1;
  const run = composerOffsetRun;
  if (composerResizeObserver) {
    composerResizeObserver.disconnect();
    composerResizeObserver = null;
  }
  requestAnimationFrame(() => {
    if (run !== composerOffsetRun) {
      return;
    }
    const composerWrap = document.querySelector('.composer-wrap');
    if (!composerWrap) {
      resetComposerOffset();
      return;
    }
    const applyComposerOffset = () => {
      const height = Math.ceil(composerWrap.getBoundingClientRect().height);
      const offset = Math.max(220, height + 16);
      document.documentElement.style.setProperty('--composer-offset', `${offset}px`);
    };
    applyComposerOffset();
    if ('ResizeObserver' in window) {
      composerResizeObserver = new ResizeObserver(applyComposerOffset);
      composerResizeObserver.observe(composerWrap);
    }
  });
}

function toggleSettingsDrawer() {
  const opening = !state.settingsOpen;
  if (opening) {
    rememberFocusReturn(document.activeElement);
  } else {
    requestFocusRestore();
  }
  state.settingsOpen = opening;
  withTimelineScrollPreserved(() => render());
}

function handleSessionSettingsOutsideClick(event) {
  if (!state.settingsOpen) {
    return;
  }
  const target = event?.target;
  if (state.shareDialog?.url || state.archiveConfirmSessionId || target?.closest?.('#settings-toggle, .settings-drawer, .modal-backdrop')) {
    return;
  }
  requestFocusRestore();
  state.settingsOpen = false;
  withTimelineScrollPreserved(() => render());
}

function toggleComposerExpanded() {
  if (!state.composerCanExpand && !state.composerExpanded) {
    return;
  }
  state.composerExpanded = !state.composerExpanded;
  state.settingsOpen = false;
  withTimelineBottomOffsetPreserved(() => {
    syncComposerPresentation();
    const promptInput = document.querySelector('#prompt-input');
    if (promptInput) {
      autoGrowPromptInput(promptInput);
    }
    syncComposerOffset();
  });
}

function updateComposerExpansionState(textarea) {
  if (!textarea) {
    return;
  }
  const styles = window.getComputedStyle?.(textarea);
  const lineHeight = Number.parseFloat(styles?.lineHeight || textarea.style?.lineHeight || '') || 22;
  const paddingTop = Number.parseFloat(styles?.paddingTop || '0') || 0;
  const paddingBottom = Number.parseFloat(styles?.paddingBottom || '0') || 0;
  const contentHeight = Math.max(0, textarea.scrollHeight - paddingTop - paddingBottom);
  const visibleLineCount = Math.ceil(contentHeight / Math.max(1, lineHeight));
  const canExpand = visibleLineCount >= PROMPT_EXPAND_LINE_THRESHOLD;
  if (canExpand === state.composerCanExpand) {
    return;
  }
  state.composerCanExpand = canExpand;
  if (!canExpand) {
    state.composerExpanded = false;
  }
  withTimelineBottomOffsetPreserved(() => {
    syncComposerPresentation();
    autoGrowPromptInput(textarea);
    syncComposerOffset();
  });
}

function syncComposerPresentation() {
  const composerForm = document.querySelector('#composer-form');
  const composerWrap = document.querySelector('.composer-wrap');
  const messageEditor = document.querySelector('.message-editor-shell');
  const composerClassName = composerStateClassName();
  const classTargets = [composerWrap, composerForm, messageEditor];
  for (const target of classTargets) {
    if (!target?.classList) {
      continue;
    }
    target.classList.remove('is-expandable', 'is-expanded');
    if (composerClassName) {
      target.classList.add(composerClassName);
    }
  }
  const settingsToggle = document.querySelector('#settings-toggle');
  if (settingsToggle) {
    settingsToggle.setAttribute('aria-expanded', String(state.settingsOpen));
  }
  const composerExpandButton = document.querySelector('#composer-expand-button');
  if (composerExpandButton) {
    const showExpandButton = state.composerCanExpand || state.composerExpanded;
    composerExpandButton.hidden = !showExpandButton;
    composerExpandButton.setAttribute('aria-expanded', String(state.composerExpanded));
    composerExpandButton.setAttribute('aria-label', state.composerExpanded ? 'Collapse message editor' : 'Expand message editor');
    composerExpandButton.textContent = state.composerExpanded ? 'v' : '^';
  }
  syncComposerAttachButton();
}

function syncComposerAttachButton() {
  const attachButton = document.querySelector('#attach-button');
  if (state.composerExpanded) {
    attachButton?.remove?.();
    return;
  }
  const leadingControls = document.querySelector('.composer-leading-controls');
  if (!leadingControls) {
    return;
  }
  const attachDisabled = state.pendingTurn || hasUploadingComposerAttachments();
  if (attachButton) {
    attachButton.disabled = attachDisabled;
    return;
  }
  const button = htmlToElement(`<button class="ghost icon-button attach-button" type="button" id="attach-button" aria-label="Attach files" title="Attach files"${attachDisabled ? ' disabled' : ''}>+</button>`);
  listenRendered(button, 'click', openAttachmentPicker);
  leadingControls.appendChild(button);
}

function refreshChatDynamicUi({ dirtyEntryIds = [] } = {}) {
  if (state.view !== 'chat' && !(state.view === 'sessions' && isDesktopLayout())) {
    return false;
  }
  const timeline = document.querySelector('#timeline');
  if (!timeline) {
    render();
    return false;
  }
  beginTimelineEventBindings();
  if (!updateTimelineProjectionDom(timeline, dirtyEntryIds)) {
    timeline.innerHTML = renderTimeline();
  }
  bindTimelineActionEvents({ reset: false });
  syncComposerStatusDisplay();
  syncWorkDetailsDialogContent();
  syncComposerErrorDisplay();
  syncComposerOffset();
  return true;
}

function updateTimelineProjectionDom(timeline, dirtyEntryIds) {
  const ids = [...new Set(Array.isArray(dirtyEntryIds) ? dirtyEntryIds.filter(Boolean) : [])];
  if (!ids.length || !timeline?.querySelectorAll || timeline.querySelector?.('.empty-state')) {
    return false;
  }
  const templateProbe = document.createElement?.('template');
  if (!templateProbe?.content) {
    return false;
  }
  const visibleItems = visibleTimelineItems();
  const visibleById = new Map(visibleItems.map((item) => [item.id, item]));
  const nodesById = new Map(
    [...timeline.querySelectorAll('[data-timeline-id]')]
      .map((node) => [node.getAttribute('data-timeline-id') || '', node])
      .filter(([id]) => id),
  );
  for (const id of ids) {
    const item = visibleById.get(id);
    if (!item) {
      return false;
    }
    const replacement = htmlToElement(renderTimelineItem(item));
    if (!replacement) {
      return false;
    }
    const current = nodesById.get(id);
    if (current?.replaceWith) {
      current.replaceWith(replacement);
      nodesById.set(id, replacement);
      continue;
    }
    if (visibleItems.at(-1)?.id !== id || !timeline.appendChild) {
      return false;
    }
    timeline.appendChild(replacement);
    nodesById.set(id, replacement);
  }
  return true;
}

function syncWorkDetailsDialogContent() {
  const list = document.querySelector('.work-details-list');
  if (!list || !state.workDetailsOpen || !canViewCurrentWorkDetails()) {
    return;
  }
  const item = currentWorkDetailsItem();
  if (!item) {
    closeWorkDetails();
    return;
  }
  if (state.workDetailsTurnId !== item.turnId) {
    resetWorkDetailsWindow(item);
  }
  const totalEvents = workDetailsForItem(item).length;
  if (state.workDetailsFollowLatest) {
    state.workDetailsVisibleEndIndex = totalEvents;
  } else {
    state.workDetailsVisibleEndIndex = Math.min(state.workDetailsVisibleEndIndex, totalEvents);
  }
  const scrollTop = list.scrollTop;
  const anchor = captureWorkDetailsAnchor(list);
  const activeElement = document.activeElement;
  const focusedDetail = activeElement?.closest?.('.work-detail');
  const focusedEventId = focusedDetail?.getAttribute('data-work-event-id') || '';
  const shouldRestoreSummaryFocus = activeElement?.tagName === 'SUMMARY';
  const openEvents = new Set([...list.querySelectorAll('.work-detail[open]')]
    .map((item) => item.getAttribute('data-work-event-id') || '')
    .filter(Boolean));
  list.innerHTML = renderWorkItem(item, currentWorkDetailsWindow(item));
  for (const detail of list.querySelectorAll('.work-detail')) {
    detail.open = openEvents.has(detail.getAttribute('data-work-event-id') || '');
  }
  if (state.workDetailsFollowLatest) {
    list.scrollTop = list.scrollHeight;
  } else if (!restoreWorkDetailsAnchor(list, anchor)) {
    list.scrollTop = Math.min(scrollTop, Math.max(0, list.scrollHeight - list.clientHeight));
  }
  if (focusedEventId && shouldRestoreSummaryFocus) {
    const summary = [...list.querySelectorAll('.work-detail')]
      .find((detail) => detail.getAttribute('data-work-event-id') === focusedEventId)
      ?.querySelector('summary');
    summary?.focus?.({ preventScroll: true });
  }
}

function captureWorkDetailsAnchor(list) {
  if (typeof list?.getBoundingClientRect !== 'function') {
    return null;
  }
  const listRect = list.getBoundingClientRect();
  for (const detail of list.querySelectorAll('.work-detail')) {
    if (typeof detail?.getBoundingClientRect !== 'function') {
      continue;
    }
    const rect = detail.getBoundingClientRect();
    if (rect.bottom > listRect.top + 1) {
      return {
        id: detail.getAttribute('data-work-event-id') || '',
        offset: rect.top - listRect.top,
      };
    }
  }
  return null;
}

function restoreWorkDetailsAnchor(list, anchor) {
  if (!anchor?.id || typeof list?.getBoundingClientRect !== 'function') {
    return false;
  }
  const detail = [...list.querySelectorAll('.work-detail')]
    .find((candidate) => candidate.getAttribute('data-work-event-id') === anchor.id);
  if (!detail || typeof detail.getBoundingClientRect !== 'function') {
    return false;
  }
  const listRect = list.getBoundingClientRect();
  const detailRect = detail.getBoundingClientRect();
  list.scrollTop += detailRect.top - listRect.top - anchor.offset;
  return true;
}

function handleWorkDetailsListClick(event) {
  const button = event.target?.closest?.('[data-work-show-earlier], [data-work-show-latest]');
  if (!button) {
    return;
  }
  if (button.hasAttribute('data-work-show-earlier')) {
    state.workDetailsFollowLatest = false;
    state.workDetailsVisibleEventLimit += WORK_DETAILS_EVENT_PAGE_SIZE;
    syncWorkDetailsDialogContent();
    return;
  }
  const item = currentWorkDetailsItem();
  if (!item) {
    return;
  }
  state.workDetailsVisibleEventLimit = WORK_DETAILS_EVENT_PAGE_SIZE;
  state.workDetailsVisibleEndIndex = workDetailsForItem(item).length;
  state.workDetailsFollowLatest = true;
  syncWorkDetailsDialogContent();
}

function updateWorkDetailsFollowState(event) {
  const list = event.currentTarget;
  const item = currentWorkDetailsItem();
  if (!list || !item) {
    return;
  }
  const totalEvents = workDetailsForItem(item).length;
  if (state.workDetailsVisibleEndIndex < totalEvents) {
    state.workDetailsFollowLatest = false;
    return;
  }
  const distanceFromBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
  state.workDetailsFollowLatest = distanceFromBottom <= 32;
}

function handleWorkDetailToggle(event) {
  const detail = event.target;
  if (!detail?.matches?.('.work-detail') || !detail.open) {
    return;
  }
  state.workDetailsFollowLatest = false;
}

function refreshVisibleSessionCards() {
  const sessionList = document.querySelector('.desktop-session-list')
    || (state.view === 'sessions' ? document.querySelector('.session-list') : null);
  if (!sessionList) {
    return false;
  }
  const scrollTop = sessionList.scrollTop;
  sessionList.setAttribute('aria-busy', String(isCurrentSessionScopeLoading()));
  sessionList.innerHTML = renderSessionCards();
  sessionList.scrollTop = scrollTop;
  return true;
}

function scheduleChatDynamicUiRefresh(entryId = '') {
  if (entryId) {
    dirtyTimelineEntryIds.add(entryId);
  }
  if (chatDynamicUiFramePending) {
    return;
  }
  chatDynamicUiFramePending = true;
  requestAnimationFrame(() => {
    chatDynamicUiFramePending = false;
    const dirtyEntryIds = [...dirtyTimelineEntryIds];
    dirtyTimelineEntryIds.clear();
    refreshChatDynamicUi({ dirtyEntryIds });
    scrollTimelineToBottomIfFollowingLatest();
  });
}

function syncComposerStatusDisplay() {
  const composerWrap = document.querySelector('.composer-wrap');
  if (!composerWrap) {
    return;
  }
  const current = composerWrap.querySelector?.('.composer-status');
  if (state.composerExpanded) {
    current?.remove?.();
    return;
  }
  const statusHtml = renderComposerStatus();
  if (current) {
    current.outerHTML = statusHtml;
    bindComposerStatusAction();
    return;
  }
  const composerForm = document.querySelector('#composer-form');
  if (composerForm && composerWrap.insertBefore) {
    composerWrap.insertBefore(htmlToElement(statusHtml), composerForm);
    bindComposerStatusAction();
  }
}

function bindComposerStatusAction() {
  const button = document.querySelector('#open-work-details-button');
  if (button) {
    listenRendered(button, 'click', () => openWorkDetails(button));
  }
}

function syncComposerErrorDisplay() {
  const composerForm = document.querySelector('#composer-form');
  if (!composerForm) {
    return;
  }
  const current = composerForm.querySelector?.('.composer-error');
  if (!state.error || state.composerExpanded) {
    current?.remove?.();
    return;
  }
  const errorHtml = localizeFragment(`<div class="composer-error" role="alert">${escapeHtml(shorten(state.error, 96))}</div>`);
  if (current) {
    current.outerHTML = errorHtml;
    return;
  }
  const row = composerForm.querySelector?.('.compact-composer-row');
  if (row && composerForm.insertBefore) {
    composerForm.insertBefore(htmlToElement(errorHtml), row);
  }
}

async function handleAttachmentInputChange(event) {
  const files = Array.from(event?.target?.files || []);
  if (event?.target) {
    event.target.value = '';
  }
  if (!files.length) {
    return;
  }
  await handleComposerAttachmentFiles(files);
}

async function handlePromptPaste(event) {
  if (!hasDesktopPointer()) {
    return false;
  }
  const files = clipboardFilesFromPasteEvent(event);
  if (!files.length) {
    return false;
  }
  event?.preventDefault?.();
  await handleComposerAttachmentFiles(files);
  return true;
}

function clipboardFilesFromPasteEvent(event) {
  const directFiles = Array.from(event?.clipboardData?.files || []).filter(Boolean);
  if (directFiles.length) {
    return directFiles;
  }
  const files = [];
  for (const item of Array.from(event?.clipboardData?.items || [])) {
    if (item?.kind !== 'file') {
      continue;
    }
    const file = item.getAsFile?.();
    if (file) {
      files.push(file);
    }
  }
  return files;
}

async function handleComposerAttachmentFiles(files) {
  const normalizedFiles = Array.from(files || []).filter(Boolean);
  if (!normalizedFiles.length) {
    return false;
  }
  if (state.pendingTurn) {
    state.error = 'Wait for the current turn to finish before attaching files.';
    state.status = 'Turn running';
    state.statusTone = 'warn';
    renderChatAtLatestIfFollowing(() => {});
    return false;
  }
  if (hasUploadingComposerAttachments()) {
    state.error = 'Wait for the current attachment upload to finish.';
    state.status = 'Uploading attachment';
    state.statusTone = 'warn';
    renderChatAtLatestIfFollowing(() => {});
    return false;
  }
  await uploadComposerAttachments(normalizedFiles);
  return true;
}

async function uploadComposerAttachments(files) {
  const pendingAttachments = files.map(createPendingComposerAttachment);
  state.composerAttachments.push(...pendingAttachments);
  state.error = '';
  state.status = 'Uploading attachment';
  state.statusTone = 'warn';
  renderChatAtLatestIfFollowing(() => {});

  try {
    const payload = state.sessionId
      ? await uploadSessionAttachments(state.sessionId, files)
      : await uploadSubmissionAttachments(files);
    const uploadedItems = Array.isArray(payload?.items) ? payload.items : [];
    pendingAttachments.forEach((attachment, index) => {
      const uploaded = uploadedItems[index];
      if (!uploaded?.localPath) {
        updateComposerAttachment(attachment.id, {
          status: 'failed',
          error: 'Upload response did not include a readable file path.',
        });
        return;
      }
      updateComposerAttachment(attachment.id, {
        status: 'ready',
        uploaded: normalizeUploadedAttachment(uploaded, attachment),
      });
    });
    if (hasFailedComposerAttachments()) {
      state.status = 'Upload failed';
      state.statusTone = 'danger';
      state.error = 'Upload response did not include a readable file path.';
    } else {
      state.status = 'Attachment uploaded';
      state.statusTone = 'success';
      state.error = '';
    }
  } catch (error) {
    const message = error?.payload?.message || error?.message || 'Upload failed';
    for (const attachment of pendingAttachments) {
      updateComposerAttachment(attachment.id, {
        status: 'failed',
        error: message,
      });
    }
    state.status = 'Upload failed';
    state.statusTone = 'danger';
    state.error = message;
  }
  renderChatAtLatestIfFollowing(() => {});
}

function createPendingComposerAttachment(file) {
  return {
    id: `local_att_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    status: 'uploading',
    fileName: String(file?.name || 'upload'),
    sizeBytes: Number.isFinite(file?.size) ? Number(file.size) : 0,
    mimeType: String(file?.type || ''),
  };
}

function updateComposerAttachment(attachmentId, patch) {
  const index = state.composerAttachments.findIndex((attachment) => attachment.id === attachmentId);
  if (index < 0) {
    return false;
  }
  state.composerAttachments[index] = {
    ...state.composerAttachments[index],
    ...patch,
  };
  return true;
}

function removeComposerAttachment(attachmentId) {
  const next = state.composerAttachments.filter((attachment) => attachment.id !== attachmentId);
  if (next.length === state.composerAttachments.length) {
    return;
  }
  state.composerAttachments = next;
  if (!hasFailedComposerAttachments() && state.error === 'Remove failed uploads before sending.') {
    state.error = '';
  }
  renderChatAtLatestIfFollowing(() => {});
}

async function uploadSessionAttachments(sessionId, files) {
  return uploadAttachments(`/api/sessions/${encodeURIComponent(sessionId)}/attachments`, files);
}

async function uploadSubmissionAttachments(files) {
  const projectId = currentNewProjectId();
  if (isMultiUserMode() && !projectId) {
    throw new Error('No projects are available for this account.');
  }
  const query = isMultiUserMode()
    ? `projectId=${encodeURIComponent(projectId)}`
    : `cwd=${encodeURIComponent(state.cwd.trim())}`;
  return uploadAttachments(`/api/session-submission-attachments?${query}`, files);
}

async function uploadAttachments(path, files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file, file?.name || 'upload');
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: formData,
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return response.json();
}

function normalizeUploadedAttachment(uploaded, fallback) {
  return {
    id: String(uploaded.id || fallback.id),
    kind: uploaded.kind === 'image' ? 'image' : 'file',
    fileName: String(uploaded.fileName || fallback.fileName || 'upload'),
    mimeType: typeof uploaded.mimeType === 'string' ? uploaded.mimeType : fallback.mimeType || null,
    sizeBytes: Number.isFinite(uploaded.sizeBytes) ? Number(uploaded.sizeBytes) : fallback.sizeBytes || 0,
    storage: uploaded.storage === 'state' ? 'state' : 'project',
    localPath: String(uploaded.localPath || ''),
    displayPath: typeof uploaded.displayPath === 'string' ? uploaded.displayPath : undefined,
  };
}

function htmlToElement(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '').trim();
  return template.content.firstElementChild;
}

function bindTimelineActionEvents({ reset = true } = {}) {
  if (reset) {
    beginTimelineEventBindings();
  }
  const timeline = document.querySelector('#timeline');
  if (!timeline) {
    return;
  }
  for (const button of timeline.querySelectorAll?.('[data-approval-action]') || []) {
    listenTimeline(button, 'click', () => {
      void resolveApproval(
        button.getAttribute('data-approval-id'),
        button.getAttribute('data-approval-action'),
      );
    });
  }

  for (const control of timeline.querySelectorAll?.('[data-session-file-path]') || []) {
    listenTimeline(control, 'click', (event) => {
      event.preventDefault();
      void openSessionFileByPath(control.getAttribute('data-session-file-path') || '');
    });
  }

  for (const control of timeline.querySelectorAll?.('[data-work-details-turn]') || []) {
    listenTimeline(control, 'click', () => {
      openWorkDetails(control, control.getAttribute('data-work-details-turn') || '');
    });
  }
}

function rememberSessionListScroll() {
  const sessionList = document.querySelector('.session-list');
  if (!sessionList) {
    return;
  }
  sessionListRestoreScrollTop = sessionList.scrollTop || 0;
}

function restoreSessionListScroll() {
  if (sessionListRestoreScrollTop === null) {
    return;
  }
  requestAnimationFrame(() => {
    const sessionList = document.querySelector('.session-list');
    if (!sessionList) {
      return;
    }
    sessionList.scrollTop = sessionListRestoreScrollTop;
    sessionListRestoreScrollTop = null;
  });
}

function captureTimelineViewport() {
  const timeline = document.querySelector('#timeline');
  const promptRestoreSnapshot = capturePromptRestoreState();
  if (!timeline) {
    return {
      bottomOffset: 0,
      shouldFollowLatest: state.timelineShouldFollowLatest,
      hadPromptFocus: promptRestoreSnapshot?.hadFocus === true,
      promptSelectionStart: promptRestoreSnapshot?.selectionStart ?? null,
      promptSelectionEnd: promptRestoreSnapshot?.selectionEnd ?? null,
      promptSelectionDirection: promptRestoreSnapshot?.selectionDirection || 'none',
    };
  }
  const bottomOffset = Math.max(0, timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop);
  const shouldFollowLatest = bottomOffset <= TIMELINE_FOLLOW_LATEST_TOLERANCE_PX;
  state.timelineShouldFollowLatest = shouldFollowLatest;
  return {
    bottomOffset,
    shouldFollowLatest,
    hadPromptFocus: promptRestoreSnapshot?.hadFocus === true,
    promptSelectionStart: promptRestoreSnapshot?.selectionStart ?? null,
    promptSelectionEnd: promptRestoreSnapshot?.selectionEnd ?? null,
    promptSelectionDirection: promptRestoreSnapshot?.selectionDirection || 'none',
  };
}

function restoreTimelineViewport(snapshot) {
  if (!snapshot) {
    return;
  }
  const apply = () => {
    const timeline = document.querySelector('#timeline');
    if (!timeline) {
      return;
    }
    if (snapshot.shouldFollowLatest) {
      timeline.scrollTop = timeline.scrollHeight;
    } else {
      timeline.scrollTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight - Number(snapshot.bottomOffset || 0));
    }
    state.timelineShouldFollowLatest = snapshot.shouldFollowLatest !== false;
    rememberCurrentTimelineViewport();
    restorePromptRestoreState({
      hadFocus: snapshot.hadPromptFocus === true,
      selectionStart: snapshot.promptSelectionStart,
      selectionEnd: snapshot.promptSelectionEnd,
      selectionDirection: snapshot.promptSelectionDirection,
    });
  };
  apply();
  requestAnimationFrame(apply);
}

function renderChatWithTimelineRestored(callback) {
  const snapshot = nextTimelineRestoreSnapshot || captureTimelineViewport();
  nextTimelineRestoreSnapshot = null;
  callback();
  render();
  restoreTimelineViewport(snapshot);
}

function latestTimelineViewportSnapshot() {
  const promptRestoreSnapshot = capturePromptRestoreState();
  return {
    bottomOffset: 0,
    shouldFollowLatest: true,
    hadPromptFocus: promptRestoreSnapshot?.hadFocus === true,
    promptSelectionStart: promptRestoreSnapshot?.selectionStart ?? null,
    promptSelectionEnd: promptRestoreSnapshot?.selectionEnd ?? null,
    promptSelectionDirection: promptRestoreSnapshot?.selectionDirection || 'none',
  };
}

function renderChatAtLatest(callback) {
  const snapshot = latestTimelineViewportSnapshot();
  state.timelineShouldFollowLatest = true;
  callback();
  render();
  restoreTimelineViewport(snapshot);
}

function renderChatAtLatestIfFollowing(callback) {
  const snapshot = captureTimelineViewport();
  const shouldFollowLatest = snapshot.shouldFollowLatest;
  callback();
  render();
  restoreTimelineViewport({
    ...snapshot,
    bottomOffset: shouldFollowLatest ? 0 : snapshot.bottomOffset,
    shouldFollowLatest,
  });
}

function captureSessionFileViewerViewport() {
  const fileViewer = document.querySelector('.session-file-viewer');
  if (!fileViewer) {
    return null;
  }
  return {
    scrollTop: fileViewer.scrollTop || 0,
  };
}

function restoreSessionFileViewerViewport(snapshot) {
  if (!snapshot) {
    return;
  }
  requestAnimationFrame(() => {
    const fileViewer = document.querySelector('.session-file-viewer');
    if (fileViewer) {
      fileViewer.scrollTop = Math.max(0, Number(snapshot.scrollTop || 0));
    }
  });
}

function renderSessionFileWithScrollPreserved(callback) {
  const snapshot = captureSessionFileViewerViewport();
  callback();
  render();
  restoreSessionFileViewerViewport(snapshot);
}

function withTimelineScrollPreserved(callback) {
  const timeline = document.querySelector('#timeline');
  const previousScrollTop = timeline?.scrollTop ?? null;
  const previousScrollHeight = timeline?.scrollHeight ?? null;
  callback();
  requestAnimationFrame(() => {
    const nextTimeline = document.querySelector('#timeline');
    if (!nextTimeline || previousScrollTop === null || previousScrollHeight === null) {
      return;
    }
    const heightDelta = nextTimeline.scrollHeight - previousScrollHeight;
    nextTimeline.scrollTop = Math.max(0, previousScrollTop + heightDelta);
  });
}

function withTimelineBottomOffsetPreserved(callback) {
  const timeline = document.querySelector('#timeline');
  const previousScrollHeight = timeline?.scrollHeight ?? null;
  const previousClientHeight = timeline?.clientHeight ?? null;
  const previousScrollTop = timeline?.scrollTop ?? null;
  const previousBottomOffset = previousScrollHeight !== null && previousClientHeight !== null && previousScrollTop !== null
    ? Math.max(0, previousScrollHeight - previousClientHeight - previousScrollTop)
    : null;
  callback();
  if (previousBottomOffset === null) {
    return;
  }
  scheduleTimelineViewportRestore(previousBottomOffset);
}

function scheduleTimelineViewportRestore(bottomOffset) {
  requestAnimationFrame(() => {
    const timeline = document.querySelector('#timeline');
    if (!timeline) {
      return;
    }
    timeline.scrollTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight - Number(bottomOffset || 0));
  });
}

function protectPromptFocusScroll() {
  const timeline = document.querySelector('#timeline');
  if (!timeline) {
    return;
  }
  const bottomOffset = Math.max(0, timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop);
  scheduleTimelineViewportRestore(bottomOffset);
  if (promptFocusRestoreTimer) {
    clearTimeout(promptFocusRestoreTimer);
  }
  promptFocusRestoreTimer = setTimeout(() => {
    scheduleTimelineViewportRestore(bottomOffset);
    promptFocusRestoreTimer = null;
  }, 160);
}

function syncPromptFocusLayout(eventOrTextarea) {
  passiveDesktopSessionId = '';
  const textarea = eventOrTextarea?.target ?? eventOrTextarea;
  protectPromptFocusScroll();
  syncPromptInputLayout(textarea);
  requestAnimationFrame(() => {
    syncPromptInputLayout(textarea);
  });
  if (promptFocusLayoutTimer) {
    clearTimeout(promptFocusLayoutTimer);
  }
  promptFocusLayoutTimer = setTimeout(() => {
    syncPromptInputLayout(textarea);
    promptFocusLayoutTimer = null;
  }, 180);
}

function syncPromptInputLayout(textarea) {
  if (!textarea) {
    return;
  }
  updateComposerExpansionState(textarea);
  autoGrowPromptInput(textarea);
  syncComposerOffset();
}

function handlePromptKeydown(event) {
  return;
}

function autoGrowPromptInput(textarea) {
  if (!textarea?.style) {
    return;
  }
  if (state.composerExpanded) {
    textarea.style.height = '';
    return;
  }
  textarea.style.height = 'auto';
  const maxHeight = hasDesktopPointer() ? DESKTOP_PROMPT_TEXTAREA_MAX_HEIGHT : PROMPT_TEXTAREA_MAX_HEIGHT;
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${Math.max(38, nextHeight)}px`;
}

function capturePromptRestoreState() {
  const promptInput = document.querySelector('#prompt-input');
  if (!promptInput) {
    return null;
  }
  const hadFocus = document.activeElement === promptInput;
  const selectionStart = Number.isFinite(promptInput.selectionStart) ? Number(promptInput.selectionStart) : null;
  const selectionEnd = Number.isFinite(promptInput.selectionEnd) ? Number(promptInput.selectionEnd) : null;
  return {
    hadFocus,
    selectionStart,
    selectionEnd,
    selectionDirection: typeof promptInput.selectionDirection === 'string' ? promptInput.selectionDirection : 'none',
  };
}

function schedulePromptRestore(snapshot) {
  promptRestoreRun += 1;
  const run = promptRestoreRun;
  if (!snapshot?.hadFocus) {
    return;
  }
  requestAnimationFrame(() => {
    if (run !== promptRestoreRun) {
      return;
    }
    restorePromptRestoreState(snapshot);
  });
}

function restorePromptRestoreState(snapshot) {
  if (!snapshot?.hadFocus) {
    return;
  }
  const promptInput = document.querySelector('#prompt-input');
  if (!promptInput) {
    return;
  }
  promptInput.focus?.();
  if (typeof promptInput.setSelectionRange !== 'function') {
    return;
  }
  const valueLength = String(promptInput.value || '').length;
  const selectionStart = clampPromptSelectionIndex(snapshot.selectionStart, valueLength);
  const selectionEnd = clampPromptSelectionIndex(snapshot.selectionEnd, valueLength);
  promptInput.setSelectionRange(selectionStart, selectionEnd, snapshot.selectionDirection || 'none');
}

function clampPromptSelectionIndex(value, max) {
  const normalizedMax = Math.max(0, Number(max) || 0);
  if (!Number.isFinite(value)) {
    return normalizedMax;
  }
  return Math.max(0, Math.min(normalizedMax, Number(value)));
}

function attachTimelineScrollTracking({ updateInitial = true } = {}) {
  const timeline = document.querySelector('#timeline');
  if (!timeline || timelineScrollTrackingElement === timeline) {
    return;
  }
  detachTimelineScrollTracking();
  timeline.addEventListener('scroll', updateTimelineFollowState, { passive: true });
  timeline.addEventListener('wheel', handleTimelineWheel, { passive: false });
  timelineScrollTrackingElement = timeline;
  if (updateInitial) {
    updateTimelineFollowState();
  }
}

function detachTimelineScrollTracking() {
  if (!timelineScrollTrackingElement) {
    return;
  }
  timelineScrollTrackingElement.removeEventListener('scroll', updateTimelineFollowState);
  timelineScrollTrackingElement.removeEventListener('wheel', handleTimelineWheel);
  timelineScrollTrackingElement = null;
}

function handleTimelineWheel(event) {
  const isVisibleDesktopChat = hasDesktopPointer()
    && (state.view === 'chat' || isDesktopWorkspaceView());
  if (!isVisibleDesktopChat || !state.sessionId || Number(event?.deltaY || 0) >= 0) {
    return;
  }
  const timeline = document.querySelector('#timeline');
  if (!timeline || timeline.scrollTop > 0) {
    return;
  }
  if (showMoreSessionHistory()) {
    event?.preventDefault?.();
  }
}

function updateTimelineFollowState() {
  const timeline = document.querySelector('#timeline');
  if (!timeline) {
    return;
  }
  const bottomOffset = Math.max(0, timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop);
  state.timelineShouldFollowLatest = bottomOffset <= TIMELINE_FOLLOW_LATEST_TOLERANCE_PX;
  rememberCurrentTimelineViewport();
}

function scrollTimelineToBottomIfFollowingLatest() {
  if (!state.timelineShouldFollowLatest) {
    return;
  }
  scrollTimelineToBottom();
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = String(form.get('username') || '');
  const password = String(form.get('password') || '');
  state.loginError = '';
  state.status = 'Logging in';
  state.statusTone = 'warn';
  const requestGeneration = authRequestGeneration;
  render();
  try {
    const payload = await apiFetch('/api/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: { username, password },
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    state.token = payload.token;
    localStorage.setItem(TOKEN_KEY, payload.token);
    state.authSession = payload.session || createCachedAuthSession();
    state.sessionsLoading = true;
    state.sessionsLoadingScope = currentSessionScope();
    state.setupRequired = false;
    state.setupMessage = '';
    state.status = 'Syncing sessions';
    state.statusTone = 'warn';
    render();
    void restoreAuth();
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    handleApiError(error, { login: true });
  }
}

async function onLogout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (_error) {
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSIONS_CACHE_KEY);
  localStorage.removeItem(TIMELINE_CACHE_KEY);
  state.token = '';
  setLoggedOut();
}

function showSessionList() {
  savePromptDraftForCurrentSession();
  saveCurrentTimeline();
  stopStream();
  const returnView = state.chatReturnView;
  rememberSessionListScroll();
  if (returnView === 'admin' && isAdminPrincipal()) {
    state.view = 'admin';
    state.chatReturnView = 'sessions';
    state.sessionId = null;
    state.currentSession = null;
    state.admin.observedSession = null;
    state.admin.observedSessionLoading = false;
    state.cwd = '';
    state.draftSessionActive = false;
    state.turnId = null;
    state.pendingTurn = false;
    state.composerExpanded = false;
    state.composerAttachments = [];
    state.mobileSidebarOpen = false;
    state.desktopSettingsOpen = false;
    state.desktopOverlay = null;
    cancelSessionFileLoad();
    clearSessionFileState();
    sessionFileTimelineSnapshot = null;
    state.error = '';
    resetTurnState();
    resetSessionHistoryWindow();
    persistWorkspaceState({ view: 'sessions', sessionId: '' });
    render();
    return;
  }
  state.view = 'sessions';
  cancelSessionFileLoad();
  clearSessionFileState();
  sessionFileTimelineSnapshot = null;
  state.archiveConfirmSessionId = null;
  state.mobileSidebarOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  if (!isDesktopLayout()) {
    state.sessionId = null;
    state.currentSession = null;
    state.draftSessionActive = false;
    state.turnId = null;
    state.pendingTurn = false;
    state.composerExpanded = false;
    state.composerAttachments = [];
    resetTurnState();
    resetSessionHistoryWindow();
  }
  state.error = '';
  state.chatReturnView = 'sessions';
  persistWorkspaceState(isDesktopLayout() && state.sessionId
    ? { view: 'chat', sessionId: state.sessionId }
    : { view: 'sessions', sessionId: '' });
  render();
}

function openAppSettingsPage() {
  savePromptDraftForCurrentSession();
  saveCurrentTimeline();
  state.archiveConfirmSessionId = null;
  cancelSessionFileLoad();
  clearSessionFileState();
  sessionFileTimelineSnapshot = null;
  state.mobileSidebarOpen = false;
  state.error = '';
  if (isDesktopLayout()) {
    persistWorkspaceState(state.sessionId
      ? { view: 'chat', sessionId: state.sessionId }
      : { view: 'sessions', sessionId: '' });
    rememberFocusReturn(document.activeElement);
    state.view = 'sessions';
    state.desktopSettingsOpen = true;
    state.desktopOverlay = null;
    render();
    if (!state.webhook.loaded && !state.webhook.loading) {
      void refreshWebhookSettings();
    }
    if (isAdminPrincipal() && state.admin.settings === null) {
      void refreshAdminSettings({ renderAfter: true });
    }
    return;
  }
  persistWorkspaceState({ view: 'sessions', sessionId: '' });
  stopStream();
  state.view = 'settings';
  state.sessionId = null;
  state.currentSession = null;
  resetTurnState();
  render();
  if (!state.webhook.loaded && !state.webhook.loading) {
    void refreshWebhookSettings();
  }
  if (isAdminPrincipal() && state.admin.settings === null) {
    void refreshAdminSettings({ renderAfter: true });
  }
}

async function openAdminConsole() {
  if (!isAdminPrincipal()) {
    return;
  }
  saveCurrentTimeline();
  stopStream();
  cancelSessionFileLoad();
  clearSessionFileState();
  sessionFileTimelineSnapshot = null;
  state.mobileSidebarOpen = false;
  state.view = 'admin';
  state.sessionId = null;
  state.currentSession = null;
  resetTurnState();
  state.error = '';
  persistWorkspaceState({ view: 'sessions', sessionId: '' });
  render();
  await refreshAdminConsole({ renderAfter: true });
}

function openNewSessionPage() {
  savePromptDraftForCurrentSession();
  saveCurrentTimeline();
  if (!state.projectsLoaded) {
    void refreshProjectsList({ renderAfter: true });
  }
  initializeNewProjectSelection();
  seedNewSessionTargetFromSelection();
  state.mobileSidebarOpen = false;
  state.activeSubmissionId = '';
  if (isDesktopLayout()) {
    applyDefaultSettings();
    state.view = 'new';
    state.desktopSettingsOpen = false;
    state.desktopOverlay = null;
    state.archiveConfirmSessionId = null;
    cancelSessionFileLoad();
    clearSessionFileState();
    sessionFileTimelineSnapshot = null;
    state.composerAttachments = [];
    state.error = '';
    persistWorkspaceState({ view: 'sessions', sessionId: '' });
    render();
    return;
  }
  stopStream();
  applyDefaultSettings();
  state.view = 'new';
  state.archiveConfirmSessionId = null;
  state.sessionId = null;
  state.currentSession = null;
  cancelSessionFileLoad();
  clearSessionFileState();
  sessionFileTimelineSnapshot = null;
  state.composerAttachments = [];
  resetTurnState();
  state.error = '';
  persistWorkspaceState({ view: 'sessions', sessionId: '' });
  render();
}

function onNewSessionSubmit(event) {
  event.preventDefault();
  savePromptDraftForCurrentSession();
  const form = new FormData(event.currentTarget);
  const selectedProjectId = String(form.get('projectId') || state.newProjectId || '').trim();
  if (isMultiUserMode() && !selectedProjectId) {
    state.error = 'No projects are available for this account.';
    render();
    return;
  }
  saveCurrentTimeline();
  stopStream();
  cancelSessionFileLoad();
  clearSessionFileState();
  sessionFileTimelineSnapshot = null;
  applyDefaultSettings();
  state.view = isDesktopLayout() ? 'sessions' : 'chat';
  state.chatReturnView = 'sessions';
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  state.archiveConfirmSessionId = null;
  state.mobileSidebarOpen = false;
  state.sessionId = null;
  state.currentSession = null;
  state.activeSubmissionId = '';
  state.draftSessionActive = true;
  state.newProjectId = selectedProjectId || state.newProjectId;
  if (selectedProjectId) {
    applySelectedProjectById(selectedProjectId);
  } else if (state.newCwd.trim()) {
    applySelectedLegacyProjectFromCwd(state.newCwd.trim());
  }
  state.cwd = selectedProjectId ? '' : state.newCwd.trim();
  state.prompt = '';
  state.composerAttachments = [];
  state.composerExpanded = false;
  state.settingsOpen = false;
  resetTurnState();
  state.status = 'Ready';
  state.statusTone = 'success';
  state.error = '';
  render();
}

async function selectSession(sessionId) {
  const requestGeneration = authRequestGeneration;
  const localSubmission = pendingSubmissionSessionSummaries()
    .find((session) => session.id === sessionId);
  if (localSubmission) {
    openPendingSubmission(localSubmission.submissionId);
    return;
  }
  const nextSession = state.sessions.find((session) => session.id === sessionId) || null;
  if (!nextSession) {
    openNewSessionPage();
    return;
  }
  passiveDesktopSessionId = '';
  savePromptDraftForCurrentSession();
  saveCurrentTimeline();
  stopStream();
  cancelSessionFileLoad();
  clearSessionFileState();
  sessionFileTimelineSnapshot = null;
  resetTurnState();
  resetSessionHistoryWindow();
  state.sessionId = nextSession.id;
  state.currentSession = nextSession;
  state.activeSubmissionId = '';
  state.draftSessionActive = false;
  state.archiveConfirmSessionId = null;
  state.cwd = nextSession.cwd || '';
  restorePromptDraftForSession(nextSession.id);
  applySessionSettings(nextSession);
  restoreTimelineForSession(nextSession, readOnlyTimelineRestoreOptions(nextSession));
  const cachedTimeline = state.timelineCache.get(nextSession.id);
  const hasCachedTimeline = Boolean(cachedTimeline?.timeline?.length);
  const useFreshDetailCache = canUseFreshSessionDetailCache(nextSession, cachedTimeline);
  const restoredRuntimeStatus = syncRuntimeStatusFromSession(nextSession, { source: 'stale' });
  state.view = isDesktopLayout() ? 'sessions' : 'chat';
  state.chatReturnView = 'sessions';
  state.mobileSidebarOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  state.composerExpanded = false;
  state.settingsOpen = false;
  state.composerAttachments = [];
  state.error = '';
  state.status = restoredRuntimeStatus.changed && restoredRuntimeStatus.activeTurnId
    ? 'Turn running'
    : useFreshDetailCache
      ? 'Ready'
      : hasCachedTimeline
        ? 'Refreshing'
        : 'Loading session';
  state.statusTone = useFreshDetailCache ? 'success' : 'warn';
  setTimelineOpenPositionForSession(nextSession);
  persistWorkspaceState({ view: 'chat', sessionId: nextSession.id });
  render();
  scrollTimelineToOpenPositionForSession(nextSession);
  if (restoredRuntimeStatus.activeTurnId && state.turnId) {
    restoreTurnEventCursor(nextSession.id, state.turnId);
    connectActiveTurnStream({ forceReconnect: true });
  }
  if (useFreshDetailCache) {
    return;
  }
  let detailSession = null;
  let openPayload = null;
  try {
    openPayload = await loadSessionOpenData(nextSession);
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    detailSession = openPayload.session;
    upsertSession(detailSession);
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    if (handleMissingSession(error, '')) {
      return;
    }
    if (error?.status === 401 || error?.status === 403) {
      handleApiError(error);
      return;
    }
    if (hasCachedTimeline && state.sessionId === sessionId) {
      state.error = '';
      state.status = 'Ready';
      state.statusTone = 'warn';
      render();
      return;
    }
    handleApiError(error);
    return;
  }
  if (state.sessionId !== sessionId) {
    renderSessionListAfterBackgroundUpdate();
    return;
  }
  const refreshedSession = state.currentSession?.id === sessionId ? state.currentSession : nextSession;
  state.currentSession = refreshedSession;
  state.cwd = refreshedSession.cwd || '';
  restorePromptDraftForSession(refreshedSession.id);
  applySessionSettings(refreshedSession);
  if (isReadOnlySession(refreshedSession)) {
    restoreTimelineForSession(refreshedSession, { fullHistory: true });
  } else {
    hydrateCurrentTimelineFromSession(refreshedSession);
  }
  saveCurrentTimeline();
  if (!openPayload?.compact || openPayload.timelineSource === 'network') {
    markTimelineCacheValidated(detailSession || refreshedSession);
  }
  const refreshedRuntimeStatus = syncRuntimeStatusFromSession(refreshedSession);
  if (refreshedRuntimeStatus.activeTurnId && state.turnId) {
    restoreTurnEventCursor(refreshedSession.id, state.turnId, { onlyIfUnset: true });
    await applySessionTurnSnapshot(openPayload?.turnSnapshot, state.turnId);
  }
  state.error = '';
  state.view = isDesktopLayout() ? 'sessions' : 'chat';
  state.chatReturnView = 'sessions';
  if (!refreshedRuntimeStatus.changed) {
    state.status = 'Ready';
    state.statusTone = 'success';
  }
  setTimelineOpenPositionForSession(refreshedSession);
  render();
  scrollTimelineToOpenPositionForSession(refreshedSession);
  if (refreshedRuntimeStatus.activeTurnId && state.turnId) {
    connectActiveTurnStream();
  }
}

async function loadSessionOpenData(sessionSummary, { signal = null } = {}) {
  const sessionId = String(sessionSummary?.id || '').trim();
  if (!sessionId) {
    throw new Error('Session id is required.');
  }
  const encodedSessionId = encodeURIComponent(sessionId);
  const requestController = new AbortController();
  const abortFromCaller = () => requestController.abort();
  if (signal?.aborted) {
    requestController.abort();
  } else {
    signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  }
  const requestCompactData = async (path, options = {}) => {
    try {
      return {
        ok: true,
        payload: await apiFetch(path, { ...options, signal: requestController.signal }),
      };
    } catch (error) {
      if (isFatalSessionOpenError(error)) {
        requestController.abort();
        throw error;
      }
      return { ok: false, error };
    }
  };
  let statusResult;
  let timelineResult;
  try {
    [statusResult, timelineResult] = await Promise.all([
      requestCompactData(`/api/sessions/${encodedSessionId}/status`),
      requestCompactData(`/api/sessions/${encodedSessionId}/timeline?limit=50`, {
        headers: { 'X-Codex-Include-Turn-Snapshot': 'false' },
      }),
    ]);
  } finally {
    signal?.removeEventListener?.('abort', abortFromCaller);
  }
  const statusPayload = statusResult.ok ? statusResult.payload : null;
  const timelinePayload = timelineResult.ok ? timelineResult.payload : null;
  const statusSession = statusPayload?.session && typeof statusPayload.session === 'object'
    ? statusPayload.session
    : null;
  const timelineSession = timelinePayload?.session && typeof timelinePayload.session === 'object'
    ? timelinePayload.session
    : null;
  const hasRemoteTimeline = Array.isArray(timelinePayload?.items);
  const cached = state.timelineCache.get(sessionId);
  const cachedTimeline = Array.isArray(cached?.history) && cached.history.length
    ? cached.history
    : Array.isArray(cached?.timeline) && cached.timeline.length
      ? cached.timeline
      : null;
  if (statusSession || timelineSession || hasRemoteTimeline) {
    const canJoinCachedTimeline = hasRemoteTimeline
      && timelinePayload.hasMore === true
      && cachedTimeline
      && timelinesHaveStableOverlap(cachedTimeline, timelinePayload.items);
    const timeline = hasRemoteTimeline
      ? canJoinCachedTimeline
        ? dedupeTimelineProjectionEntries([...cachedTimeline, ...timelinePayload.items])
        : timelinePayload.items
      : cachedTimeline;
    return {
      session: {
        ...sessionSummary,
        ...(statusSession || {}),
        ...(timelineSession || {}),
        ...(timeline ? {
          timeline: timeline.map((item) => ({ ...item })),
          timelineComplete: hasRemoteTimeline
            ? timelinePayload.hasMore !== true
            : cached?.historyComplete === true,
          timelineNextBefore: hasRemoteTimeline ? timelinePayload.nextBefore ?? null : null,
        } : {}),
      },
      turnSnapshot: timelinePayload?.turnSnapshot || statusPayload?.turnSnapshot || null,
      compact: true,
      timelineSource: hasRemoteTimeline ? 'network' : cachedTimeline ? 'cache' : 'none',
    };
  }
  return apiFetch(`/api/sessions/${encodedSessionId}`, { signal });
}

function timelinesHaveStableOverlap(first, second) {
  const firstIdentities = new Set(
    (Array.isArray(first) ? first : []).flatMap(timelineContinuityIdentities),
  );
  return firstIdentities.size > 0 && (Array.isArray(second) ? second : [])
    .some((item) => timelineContinuityIdentities(item).some((identity) => firstIdentities.has(identity)));
}

function timelineContinuityIdentities(item) {
  if (!item || typeof item !== 'object') {
    return [];
  }
  const identities = [];
  const projectionKey = typeof item.projectionKey === 'string' ? item.projectionKey.trim() : '';
  const turnId = timelineTurnId(item);
  const itemId = typeof item.itemId === 'string' ? item.itemId.trim() : '';
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  if (projectionKey) {
    identities.push(`projection:${projectionKey}`);
  }
  if (turnId && itemId) {
    identities.push(`item:${turnId}\u0000${itemId}`);
  }
  if (id) {
    identities.push(`id:${id}`);
  }
  return identities;
}

function isFatalSessionOpenError(error) {
  return error?.name === 'AbortError'
    || error?.status === 401
    || error?.status === 403
    || isMissingSessionError(error);
}

async function applySessionTurnSnapshot(snapshot, turnId) {
  if (!snapshot || String(snapshot.turnId || '') !== String(turnId || '')) {
    return false;
  }
  const throughSequence = Number(snapshot.throughSequence);
  const sameEpoch = !snapshot.epoch || !state.lastTurnEventEpoch || snapshot.epoch === state.lastTurnEventEpoch;
  if (sameEpoch
    && Number.isFinite(throughSequence)
    && state.lastTurnEventSequence != null
    && Number(state.lastTurnEventSequence) >= throughSequence) {
    return false;
  }
  return applyTurnStreamControl({
    type: 'stream.reset',
    reset: true,
    epoch: snapshot.epoch,
    snapshot: {
      complete: snapshot.complete === true,
      throughSequence: snapshot.throughSequence,
      events: Array.isArray(snapshot.events) ? snapshot.events : [],
    },
  }, turnId, state.streamAbortController, { alreadyHydrated: false });
}

function submissionTimelineItem(entry) {
  return {
    id: `local_user_${entry.id}`,
    kind: 'message',
    role: 'user',
    label: 'You',
    meta: 'pending',
    text: entry.text,
    submissionId: entry.id,
    ...(entry.attachments.length ? { attachments: entry.attachments } : {}),
  };
}

function openPendingSubmission(submissionId) {
  const entry = state.submissionOutbox.get(submissionId);
  if (!entry || !submissionBelongsToCurrentOwner(entry)) {
    return false;
  }
  savePromptDraftForCurrentSession();
  saveCurrentTimeline();
  stopStream();
  resetTurnState();
  state.activeSubmissionId = entry.id;
  state.sessionId = null;
  state.currentSession = null;
  state.draftSessionActive = true;
  state.cwd = entry.cwd;
  state.newProjectId = entry.projectId || state.newProjectId;
  if (entry.projectId) {
    applySelectedProjectById(entry.projectId);
  } else if (entry.cwd) {
    applySelectedLegacyProjectFromCwd(entry.cwd);
  }
  applySessionSettings({ settings: entry.settings });
  state.timeline = [submissionTimelineItem(entry)];
  state.prompt = '';
  state.composerAttachments = [];
  state.view = isDesktopLayout() ? 'sessions' : 'chat';
  state.chatReturnView = 'sessions';
  const visibleFailure = submissionFailureIsVisible(entry);
  state.status = entry.status === 'failed' && !visibleFailure
    ? 'Waiting to send'
    : submissionDeliveryLabel(entry.status);
  state.statusTone = visibleFailure ? 'danger' : 'warn';
  state.error = visibleFailure ? entry.error : '';
  render();
  scrollTimelineToBottom();
  return true;
}

function renderSessionListAfterBackgroundUpdate() {
  if (state.view !== 'sessions' && !isDesktopWorkspaceView()) {
    return;
  }
  rememberSessionListScroll();
  render();
}

async function onComposerSubmit(event) {
  event.preventDefault();
  passiveDesktopSessionId = '';
  if (state.submissionSending) {
    return;
  }
  const text = state.prompt.trim();
  if (!text) {
    return;
  }
  if (hasUploadingComposerAttachments()) {
    state.error = 'Wait for uploads to finish before sending.';
    state.status = 'Uploading attachment';
    state.statusTone = 'warn';
    renderChatAtLatestIfFollowing(() => {});
    return;
  }
  if (hasFailedComposerAttachments()) {
    state.error = 'Remove failed uploads before sending.';
    state.status = 'Upload failed';
    state.statusTone = 'danger';
    renderChatAtLatestIfFollowing(() => {});
    return;
  }
  if (state.pendingTurn && state.sessionId && !isSlashCommandText(text)) {
    if (readyComposerAttachments().length) {
      state.error = 'Attachments cannot be queued while a turn is running.';
      state.status = 'Turn running';
      state.statusTone = 'warn';
      renderChatAtLatestIfFollowing(() => {});
      return;
    }
    enqueueQueuedMessage(state.sessionId, text);
    state.queuedInterruptRequestedTurnId = state.turnId || null;
    clearPromptDraftForCurrentSession();
    state.status = 'Turn running';
    state.statusTone = 'warn';
    renderChatAtLatestIfFollowing(() => {});
    void maybeInterruptRunningTurnForQueuedMessage();
    return;
  }
  await sendComposerMessage(text);
}

function isSlashCommandText(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return normalized === '/help' || normalized === '/goal' || normalized.startsWith('/goal ');
}

async function sendComposerMessage(text, options = {}) {
  return sendDurableComposerMessage(text, options);
}

function createComposerSubmission(text, {
  queuedMessageId = '',
  sessionId: preferredSessionId = '',
  includeComposerAttachments = true,
} = {}) {
  const existing = queuedMessageId
    ? pendingSubmissionEntries().find((entry) => entry.queuedMessageId === queuedMessageId)
    : null;
  if (existing) {
    return existing;
  }
  const ownerKey = currentSubmissionOwnerKey();
  if (!ownerKey) {
    throw new Error('Sign in before sending a message.');
  }
  if (pendingSubmissionEntries().length >= MAX_SUBMISSION_OUTBOX_ITEMS) {
    throw new Error('Too many messages are waiting to send. Retry or cancel one before sending another.');
  }
  const sessionId = String(preferredSessionId || state.sessionId || '').trim();
  const attachments = includeComposerAttachments ? readyComposerAttachments() : [];
  return upsertSubmissionOutboxEntry({
    id: createSubmissionId(),
    ownerKey,
    text,
    status: 'pending',
    sessionId,
    projectId: sessionId ? '' : currentNewProjectId(),
    cwd: sessionId ? '' : state.cwd.trim(),
    settings: collectSettings(),
    attachments,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    error: '',
    retryable: true,
    queuedMessageId,
  });
}

async function sendDurableComposerMessage(text, options = {}) {
  let submission;
  try {
    submission = createComposerSubmission(text, options);
  } catch (error) {
    state.error = error?.message || 'Could not save this message for delivery.';
    state.status = 'Send failed';
    state.statusTone = 'danger';
    render();
    return null;
  }
  const optimisticUserEntry = submissionTimelineItem(submission);
  state.lastTurnEventSequence = null;
  state.lastTurnEventEpoch = '';
  state.lastTurnEventAt = Date.now();
  state.streamWasBackgrounded = false;
  appendOrReplace(optimisticUserEntry, (item) => item?.submissionId === submission.id);
  if (state.sessionId) {
    saveCurrentTimeline();
  }
  clearPromptDraftForCurrentSession();
  state.composerAttachments = [];
  state.activeSubmissionId = state.sessionId ? '' : submission.id;
  renderChatAtLatest(() => {});
  return deliverSubmission(submission.id, { interactive: true });
}

async function deliverSubmission(submissionId, { interactive = false, force = false } = {}) {
  const current = state.submissionOutbox.get(submissionId);
  if (!current || !submissionBelongsToCurrentOwner(current)) {
    return null;
  }
  if (current.retryable === false || submissionRequestControllers.has(submissionId)) {
    return null;
  }
  if (!force && current.nextAttemptAt > Date.now()) {
    scheduleSubmissionRetry();
    return null;
  }
  const requestGeneration = authRequestGeneration;
  const wasNewSession = !current.sessionId;
  const wasActiveDraft = state.activeSubmissionId === current.id || (wasNewSession && state.draftSessionActive && !state.sessionId);
  let sending;
  try {
    sending = upsertSubmissionOutboxEntry({
      ...current,
      status: 'sending',
      updatedAt: Date.now(),
      attempts: current.attempts + 1,
      nextAttemptAt: 0,
      error: '',
    });
  } catch (error) {
    if (wasActiveDraft || state.sessionId === current.sessionId) {
      state.status = 'Send failed';
      state.statusTone = 'danger';
      state.error = error?.message || 'Could not save this message for delivery.';
      renderChatAtLatestIfFollowing(() => {});
    }
    return null;
  }
  state.submissionSending = interactive;
  if (wasActiveDraft || state.sessionId === sending.sessionId) {
    state.status = 'Sending to server';
    state.statusTone = 'warn';
    state.error = '';
    renderChatAtLatestIfFollowing(() => {});
  } else {
    renderSessionListAfterBackgroundUpdate();
  }

  const controller = new AbortController();
  let requestTimedOut = false;
  const timeoutId = setTimeout(() => {
    requestTimedOut = true;
    controller.abort();
  }, SUBMISSION_REQUEST_TIMEOUT_MS);
  timeoutId?.unref?.();
  submissionRequestControllers.set(submissionId, controller);
  try {
    const body = submissionRequestBody(sending);
    const payload = await apiFetch(
      wasNewSession
        ? '/api/session-submissions'
        : `/api/sessions/${encodeURIComponent(sending.sessionId)}/turns`,
      { method: 'POST', body, signal: controller.signal },
    );
    if (!isAuthRequestCurrent(requestGeneration)) {
      resetSubmissionAfterAuthChange(sending);
      return null;
    }
    const normalized = normalizeSubmissionResponse(payload, sending);
    if (normalized.status === 'failed') {
      const error = new Error(normalized.error || 'Request failed');
      error.payload = {
        error: normalized.errorCode || 'submission_failed',
        message: normalized.error || 'Request failed',
        retryable: normalized.retryable,
      };
      throw error;
    }
    if (normalized.status !== 'submitted') {
      state.submissionSending = false;
      upsertSubmissionOutboxEntry({
        ...sending,
        status: 'pending',
        updatedAt: Date.now(),
        nextAttemptAt: Date.now() + submissionRetryDelay(sending.attempts),
      });
      scheduleSubmissionRetry();
      return payload;
    }
    state.submissionSending = false;
    return completeDeliveredSubmission(sending, normalized, payload, { wasActiveDraft });
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      resetSubmissionAfterAuthChange(sending);
      return null;
    }
    if (requestTimedOut) {
      const timeoutError = new Error('Server acknowledgement timed out. The message remains saved and will be retried.');
      timeoutError.status = 408;
      timeoutError.payload = {
        error: 'submission_timeout',
        message: timeoutError.message,
        retryable: true,
      };
      error = timeoutError;
    }
    state.submissionSending = false;
    failSubmissionDelivery(sending, error, { wasActiveDraft });
    return null;
  } finally {
    clearTimeout(timeoutId);
    if (submissionRequestControllers.get(submissionId) === controller) {
      submissionRequestControllers.delete(submissionId);
    }
    state.submissionSending = false;
  }
}

function submissionRequestBody(entry) {
  return {
    submissionId: entry.id,
    text: entry.text,
    settings: entry.settings,
    ...(entry.sessionId ? {} : entry.projectId ? { projectId: entry.projectId } : { cwd: entry.cwd || null }),
    ...(entry.attachments.length
      ? {
          attachmentIds: entry.attachments.map((attachment) => attachment.id),
          attachments: entry.attachments,
        }
      : {}),
  };
}

function normalizeSubmissionResponse(payload, fallback) {
  const submission = payload?.submission && typeof payload.submission === 'object'
    ? payload.submission
    : null;
  const result = payload?.result && typeof payload.result === 'object' ? payload.result : payload;
  const rawStatus = String(submission?.status || '').trim();
  const responseSubmissionId = String(submission?.id || '').trim();
  if (submission && responseSubmissionId !== fallback.id) {
    throw invalidSubmissionAcknowledgement('Server acknowledgement did not match the saved message.');
  }
  const failed = rawStatus === 'failed';
  const turnId = String(submission?.turnId || payload?.turnId || result?.turnId || '').trim();
  const commandResult = result?.type === 'command' ? result : null;
  const legacyAccepted = !submission && Boolean(fallback.sessionId && (turnId || commandResult));
  if (!submission && !legacyAccepted) {
    throw invalidSubmissionAcknowledgement('Server response did not acknowledge the saved message.');
  }
  if (submission && !failed && !['queued', 'creating', 'starting', 'submitted'].includes(rawStatus)) {
    throw invalidSubmissionAcknowledgement('Server returned an invalid submission status.');
  }
  const sessionId = String(submission?.sessionId || payload?.session?.id || result?.session?.id || fallback.sessionId || '').trim();
  if ((rawStatus === 'submitted' || legacyAccepted) && !sessionId) {
    throw invalidSubmissionAcknowledgement('Server acknowledgement did not include a session.');
  }
  return {
    status: failed ? 'failed' : legacyAccepted ? 'submitted' : rawStatus,
    sessionId,
    turnId,
    session: payload?.session || result?.session || null,
    commandResult,
    error: String(submission?.error?.message || '').trim(),
    errorCode: String(submission?.error?.code || '').trim(),
    retryable: submission?.error?.retryable !== false,
  };
}

function invalidSubmissionAcknowledgement(message) {
  const error = new Error(message);
  error.payload = {
    error: 'invalid_submission_acknowledgement',
    message,
    retryable: true,
  };
  return error;
}

function completeDeliveredSubmission(entry, normalized, payload, { wasActiveDraft = false } = {}) {
  const sessionId = normalized.sessionId;
  const session = normalized.session;
  if (session) {
    upsertSession(session);
  }
  const shouldAdoptSession = Boolean(sessionId && (
    state.sessionId === entry.sessionId
    || (!state.sessionId && wasActiveDraft)
  ));
  if (shouldAdoptSession) {
    state.sessionId = sessionId;
    state.activeSubmissionId = '';
    state.draftSessionActive = false;
    state.currentSession = session || state.sessions.find((candidate) => candidate.id === sessionId) || {
      id: sessionId,
      cwd: entry.cwd,
      settings: entry.settings,
    };
    state.cwd = state.currentSession.cwd || entry.cwd || state.cwd;
    migrateDraftPromptToSession(sessionId);
    optimisticallyUpdateSessionInput(entry.text);
  }
  const timelineEntry = state.timeline.find((item) => item?.submissionId === entry.id);
  if (timelineEntry) {
    timelineEntry.deliveryLabel = 'Server received';
    if (normalized.turnId) {
      timelineEntry.turnId = normalized.turnId;
    }
  }
  markCachedSubmissionDelivered(entry, sessionId);
  removeSubmissionOutboxEntry(entry.id);
  if (entry.queuedMessageId && sessionId) {
    removeQueuedMessage(sessionId, entry.queuedMessageId);
  }
  if (shouldAdoptSession) {
    saveCurrentTimeline();
  }
  if (normalized.commandResult) {
    if (shouldAdoptSession) {
      handleCommandResult(normalized.commandResult);
    }
    renderSessionListAfterBackgroundUpdate();
    return payload;
  }
  if (normalized.turnId) {
    setSessionSummaryActivity(sessionId, 'running', normalized.turnId);
    if (shouldAdoptSession) {
      state.turnId = normalized.turnId;
      state.latestTurnId = normalized.turnId;
      state.pendingTurn = true;
      markLocallyStartedTurn(normalized.turnId);
      state.status = 'Turn running';
      state.statusTone = 'warn';
      state.error = '';
      renderChatAtLatest(() => {});
      void streamTurnEvents(normalized.turnId);
    } else {
      renderSessionListAfterBackgroundUpdate();
    }
  }
  return payload;
}

function markCachedSubmissionDelivered(entry, sessionId) {
  if (!sessionId || state.sessionId === sessionId) {
    return;
  }
  const cached = state.timelineCache.get(sessionId);
  if (!cached) {
    return;
  }
  const mark = (items) => (Array.isArray(items) ? items : []).map((item) => (
    item?.submissionId === entry.id
      ? { ...item, deliveryLabel: 'Server received' }
      : item
  ));
  state.timelineCache.set(sessionId, {
    ...cached,
    timeline: mark(cached.timeline),
    history: mark(cached.history),
  });
  persistTimelineCache();
}

function failSubmissionDelivery(entry, error, { wasActiveDraft = false } = {}) {
  const message = String(error?.payload?.message || error?.message || 'Request failed');
  const retryable = isSubmissionDeliveryRetryable(error);
  const retrySilently = retryable && entry.attempts < SUBMISSION_VISIBLE_FAILURE_ATTEMPT;
  const failed = upsertSubmissionOutboxEntry({
    ...entry,
    status: 'failed',
    updatedAt: Date.now(),
    error: message,
    retryable,
    nextAttemptAt: retrySilently ? Date.now() + submissionRetryDelay(entry.attempts) : 0,
  });
  if (entry.queuedMessageId && entry.sessionId) {
    setQueuedMessageSending(entry.sessionId, entry.queuedMessageId, false);
  }
  const visible = state.timeline.find((item) => item?.submissionId === entry.id);
  if (!visible && wasActiveDraft) {
    state.timeline = [submissionTimelineItem(failed)];
  }
  if (wasActiveDraft || state.sessionId === entry.sessionId) {
    state.pendingTurn = false;
    state.status = retrySilently ? 'Waiting to send' : 'Send failed';
    state.statusTone = retrySilently ? 'warn' : 'danger';
    state.error = retrySilently ? '' : message;
    renderChatAtLatestIfFollowing(() => {});
  } else {
    renderSessionListAfterBackgroundUpdate();
  }
  if (retrySilently) {
    scheduleSubmissionRetry();
  }
}

function isSubmissionDeliveryRetryable(error) {
  if (typeof error?.payload?.retryable === 'boolean') {
    return error.payload.retryable;
  }
  if (!Number.isFinite(error?.status)) {
    return true;
  }
  if (error.status === 409) {
    return error?.payload?.error === 'turn_conflict';
  }
  return error.status === 408
    || error.status === 425
    || error.status === 429
    || error.status >= 500;
}

function resetSubmissionAfterAuthChange(entry) {
  const current = state.submissionOutbox.get(entry?.id);
  if (!current || current.status !== 'sending') {
    return false;
  }
  try {
    upsertSubmissionOutboxEntry({
      ...current,
      status: 'pending',
      updatedAt: Date.now(),
      nextAttemptAt: 0,
      error: '',
      retryable: true,
    });
    return true;
  } catch (error) {
    console.warn('[codex-web] could not reset submission after auth change', error);
    return false;
  }
}

function resetSendingSubmissionsAfterAuthChange() {
  for (const entry of state.submissionOutbox.values()) {
    if (entry.status === 'sending') {
      resetSubmissionAfterAuthChange(entry);
    }
  }
}

function submissionRetryDelay(attempts) {
  return Math.min(
    SUBMISSION_RETRY_MAX_MS,
    SUBMISSION_RETRY_BASE_MS * (2 ** Math.max(0, Math.min(6, attempts - 1))),
  );
}

async function sendComposerMessageLegacy(text, { queuedMessageId = '', sessionId: preferredSessionId = '', includeComposerAttachments = true } = {}) {
  const requestGeneration = authRequestGeneration;
  state.error = '';
  state.pendingTurn = true;
  state.lastTurnEventSequence = null;
  state.lastTurnEventEpoch = '';
  state.lastTurnEventAt = Date.now();
  state.streamWasBackgrounded = false;
  state.status = 'Starting turn';
  state.statusTone = 'warn';
  const attachments = includeComposerAttachments ? readyComposerAttachments() : [];
  const optimisticUserEntry = {
    id: `local_user_${Date.now()}`,
    kind: 'message',
    role: 'user',
    label: 'You',
    meta: 'pending',
    text,
    ...(attachments.length ? { attachments } : {}),
  };
  appendMessage(optimisticUserEntry);
  if (state.sessionId) {
    saveCurrentTimeline();
  }
  const promptToSend = text;
  clearPromptDraftForCurrentSession();
  renderChatAtLatest(() => {});

  const wasNewSession = !state.sessionId;
  let submittedSessionId = '';
  try {
    const sessionId = preferredSessionId || await ensureSession();
    if (!isAuthRequestCurrent(requestGeneration) || !sessionId) {
      return;
    }
    submittedSessionId = sessionId;
    clearPromptDraftForCurrentSession();
    optimisticallyUpdateSessionInput(promptToSend);
    saveCurrentTimeline();
    const settings = collectSettings();
    const turn = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: 'POST',
      body: {
        text: promptToSend,
        settings,
        ...(attachments.length
          ? {
              attachmentIds: attachments.map((attachment) => attachment.id),
              attachments,
            }
          : {}),
      },
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    if (attachments.length) {
      state.composerAttachments = [];
    }
    if (queuedMessageId) {
      removeQueuedMessage(sessionId, queuedMessageId);
    }
    if (turn?.type === 'command') {
      if (state.sessionId === sessionId) {
        handleCommandResult(turn);
      } else if (turn.session) {
        upsertSession(turn.session);
      }
      return;
    }
    if (turn.session) {
      upsertSession(turn.session);
      if (state.sessionId === sessionId) {
        state.currentSession = state.currentSession?.id === sessionId ? state.currentSession : turn.session;
        state.cwd = turn.session.cwd || state.cwd;
        resetSessionHistoryWindow();
        optimisticallyUpdateSessionInput(promptToSend);
      }
    }
    if (state.sessionId !== sessionId) {
      setSessionSummaryActivity(sessionId, 'running', turn.turnId);
      return;
    }
    state.turnId = turn.turnId;
    state.latestTurnId = turn.turnId;
    markLocallyStartedTurn(turn.turnId);
    state.status = 'Turn running';
    state.statusTone = 'warn';
    renderChatAtLatest(() => {});
    void streamTurnEvents(turn.turnId);
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    const failedQueuedSessionId = submittedSessionId || preferredSessionId || state.sessionId;
    if (queuedMessageId && failedQueuedSessionId) {
      setQueuedMessageSending(failedQueuedSessionId, queuedMessageId, false);
    }
    if (handleMissingSession(error, promptToSend)) {
      return;
    }
    if (handleTurnConflict(error, {
      promptText: promptToSend,
      optimisticEntryId: optimisticUserEntry.id,
      queuedMessageId,
      sessionId: submittedSessionId || preferredSessionId || state.sessionId,
    })) {
      return;
    }
    if (scheduleFirstTurnRecovery({
      error,
      promptText: promptToSend,
      sessionId: submittedSessionId || state.sessionId,
      wasNewSession,
    })) {
      return;
    }
    state.pendingTurn = false;
    surfaceTimelineError(state.turnId || `request_${Date.now()}`, error?.payload?.message || error?.message || 'Request failed');
    handleApiError(error, { suppressComposerError: true });
  }
}

function handleTurnConflict(error, {
  promptText,
  optimisticEntryId,
  queuedMessageId = '',
  sessionId = '',
} = {}) {
  if (error?.status !== 409 || error?.payload?.error !== 'turn_conflict') {
    return false;
  }
  removeTimelineEntryById(optimisticEntryId);
  const activeTurnId = String(error?.payload?.activeTurnId || '').trim();
  if (queuedMessageId && sessionId) {
    const stillQueued = queuedMessagesForSession(sessionId).some((message) => message.id === queuedMessageId);
    if (stillQueued) {
      setQueuedMessageSending(sessionId, queuedMessageId, false);
    } else {
      enqueueQueuedMessage(sessionId, promptText);
    }
    state.prompt = '';
  } else {
    state.prompt = promptText || state.prompt;
    savePromptDraftForCurrentSession();
  }
  state.pendingTurn = Boolean(activeTurnId);
  state.turnId = activeTurnId || state.turnId;
  if (activeTurnId) {
    state.latestTurnId = activeTurnId;
  }
  if (!activeTurnId) {
    clearLocallyStartedTurn();
  }
  state.status = activeTurnId ? 'Turn running' : 'Request blocked';
  state.statusTone = 'warn';
  state.error = '';
  renderChatAtLatestIfFollowing(() => {});
  if (activeTurnId) {
    connectActiveTurnStream({ forceReconnect: true });
  }
  return true;
}

function handleCommandResult(result) {
  stopStream();
  state.pendingTurn = false;
  state.turnId = null;
  state.lastTurnEventSequence = null;
  state.lastTurnEventEpoch = '';
  state.streamWasBackgrounded = false;
  state.lastTurnEventAt = 0;
  state.status = 'Ready';
  state.statusTone = 'success';
  state.error = '';
  if (result?.session && commandResultSessionHasTimeline(result)) {
    upsertSession(result.session);
    if (state.sessionId === result.session.id) {
      state.currentSession = state.currentSession?.id === result.session.id ? state.currentSession : result.session;
      state.cwd = result.session.cwd || state.cwd;
      hydrateCurrentTimelineFromSession(result.session);
    }
    saveCurrentTimeline();
    renderChatAtLatestIfFollowing(() => {});
    return;
  }
  const command = result?.command || {};
  const message = String(command.message || 'Command completed.');
  appendMessage({
    id: `command_${command.name || 'slash'}_${Date.now()}`,
    kind: 'message',
    role: 'system',
    label: command.name ? `/${command.name}` : 'Command',
    meta: command.action || 'completed',
    text: message,
  });
  saveCurrentTimeline();
  renderChatAtLatestIfFollowing(() => {});
}

function commandResultSessionHasTimeline(result) {
  const items = normalizeSessionTimeline(result?.session?.timeline);
  if (!items.length) {
    return false;
  }
  const commandName = String(result?.command?.name || '');
  const commandMessage = String(result?.command?.message || '').trim();
  return items.some((item) => item.role === 'system'
    && (!commandName || item.label === `/${commandName}`)
    && (!commandMessage || item.text === commandMessage));
}

async function ensureSession() {
  if (state.sessionId) {
    return state.sessionId;
  }
  state.status = 'Starting session';
  render();
  const projectId = currentNewProjectId();
  if (isMultiUserMode() && !projectId) {
    const error = new Error('No projects are available for this account.');
    error.status = 400;
    error.payload = {
      error: 'project_required',
      message: 'No projects are available for this account.',
    };
    throw error;
  }
  const body = isMultiUserMode()
    ? {
        projectId,
        settings: collectSettings(),
      }
    : {
        cwd: state.cwd.trim() || null,
        settings: collectSettings(),
      };
  const requestGeneration = authRequestGeneration;
  const payload = await apiFetch('/api/sessions', {
    method: 'POST',
    body,
  });
  if (!isAuthRequestCurrent(requestGeneration)) {
    return null;
  }
  state.currentSession = payload.session;
  state.sessionId = payload.session.id;
  migrateDraftPromptToSession(payload.session.id);
  state.draftSessionActive = false;
  state.cwd = payload.session.cwd || state.cwd;
  upsertSession(payload.session);
  applySessionSettings(payload.session);
  persistWorkspaceState({ view: 'chat', sessionId: payload.session.id });
  return state.sessionId;
}

function isAdminPrincipal() {
  return state.authSession?.principal?.isAdmin === true;
}

function isMultiUserMode() {
  return state.authSession?.principal?.mode === 'multi';
}

function isManagedMultiUserPrincipal() {
  return isMultiUserMode() && !isAdminPrincipal();
}

function canSetSiteTitle() {
  return state.globalSettings.canSetSiteTitle === true
    || state.authSession?.principal?.mode === 'single'
    || state.authSession?.principal?.isAdmin === true;
}

function requestArchiveSession(sessionId) {
  if (!sessionId || state.pendingTurn) {
    render();
    return;
  }
  rememberFocusReturn(document.activeElement);
  state.archiveConfirmSessionId = sessionId;
  state.error = '';
  render();
}

function cancelArchiveSession() {
  requestFocusRestore();
  state.archiveConfirmSessionId = null;
  render();
}

async function archiveSession(sessionId) {
  if (!sessionId || state.pendingTurn) {
    render();
    return;
  }
  const requestGeneration = authRequestGeneration;
  state.archiveConfirmSessionId = null;
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, { method: 'POST' });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    state.sessionArchiveOverrides.set(sessionId, true);
    removeSession(sessionId);
    state.sessionsLoadedByScope.archived = false;
    state.timelineCache.delete(sessionId);
    persistTimelineCache();
    if (state.sessionId === sessionId) {
      stopStream();
      state.sessionId = null;
      state.currentSession = null;
      state.draftSessionActive = false;
      resetTurnState();
      state.view = 'sessions';
    }
    state.status = 'Session archived';
    state.statusTone = 'success';
    state.error = '';
    render();
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    if (isMissingSessionError(error)) {
      removeSession(sessionId);
      state.error = 'Selected session was unavailable and was removed from the list.';
      render();
      return;
    }
    handleApiError(error);
  }
}

async function unarchiveSession(sessionId) {
  if (!sessionId || state.pendingTurn) {
    render();
    return;
  }
  const requestGeneration = authRequestGeneration;
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/unarchive`, { method: 'POST' });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    state.sessionArchiveOverrides.set(sessionId, false);
    removeSession(sessionId);
    if (payload?.session) {
      upsertSession(payload.session);
    }
    state.status = 'Ready';
    state.statusTone = 'success';
    state.error = '';
    render();
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    if (isMissingSessionError(error)) {
      removeSession(sessionId);
      render();
      return;
    }
    handleApiError(error);
  }
}

async function shareCurrentSession() {
  const sessionId = state.sessionId || state.currentSession?.id || '';
  if (!sessionId || !canShareCurrentSession()) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  rememberFocusReturn(document.activeElement);
  try {
    state.status = 'Creating share link';
    state.statusTone = 'warn';
    render();
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/share`, {
      method: 'POST',
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    const shareUrl = absoluteShareUrl(payload?.shareUrl || '');
    if (!shareUrl) {
      throw new Error('Share link was not returned.');
    }
    const copied = await copyShareLink(shareUrl, { renderAfter: false });
    state.shareDialog = {
      url: shareUrl,
      copied,
    };
    state.status = copied ? 'Share link copied' : 'Share link ready';
    state.statusTone = 'success';
    state.error = '';
    render();
    return shareUrl;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

async function copyShareLink(url, { renderAfter = true } = {}) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    return false;
  }
  if (await copyTextToClipboard(normalizedUrl, '#share-link-input')) {
    return finalizeShareCopySuccess(normalizedUrl, { renderAfter });
  }
  state.status = 'Share link ready';
  state.statusTone = 'success';
  if (renderAfter) {
    render();
  }
  return false;
}

async function copyTextToClipboard(value, inputSelector = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(normalized);
      return true;
    }
  } catch (_error) {
  }
  return legacyCopyText(normalized, inputSelector);
}

function legacyCopyText(value, inputSelector) {
  const input = inputSelector ? document.querySelector(inputSelector) : null;
  if (!input || typeof document.execCommand !== 'function') {
    return false;
  }
  try {
    input.focus?.();
    input.select?.();
    if (typeof input.setSelectionRange === 'function') {
      input.setSelectionRange(0, String(input.value || value).length);
    }
    return document.execCommand('copy') === true;
  } catch (_error) {
    return false;
  }
}

function finalizeShareCopySuccess(url, { renderAfter = true } = {}) {
  if (state.shareDialog?.url === url) {
    state.shareDialog = { ...state.shareDialog, copied: true };
  }
  state.status = 'Share link copied';
  state.statusTone = 'success';
  state.error = '';
  if (renderAfter) {
    render();
  }
  return true;
}

function absoluteShareUrl(shareUrl) {
  const value = String(shareUrl || '').trim();
  if (!value) {
    return '';
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) {
    return value;
  }
  const origin = String(window.location?.origin || '').replace(/\/+$/u, '');
  if (origin && value.startsWith('/')) {
    return `${origin}${value}`;
  }
  if (origin) {
    return `${origin}/${value.replace(/^\/+/u, '')}`;
  }
  try {
    return new URL(value, window.location.origin || window.location.href).toString();
  } catch (_error) {
    return value;
  }
}

async function toggleSessionFavorite(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) {
    return;
  }
  const requestGeneration = authRequestGeneration;
  const favorite = !isFavoriteSession(session);
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/favorite`, {
      method: 'PATCH',
      body: { favorite },
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    if (payload?.session) {
      upsertSession(payload.session);
    }
    state.status = favorite ? 'Session favorited' : 'Favorite removed';
    state.statusTone = 'success';
    state.error = '';
    render();
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    if (handleMissingSession(error, '')) {
      return;
    }
    handleApiError(error);
  }
}

async function streamTurnEvents(turnId, options = {}) {
  cancelStreamReconnect();
  stopStream({ preserveRetryState: true });
  const controller = new AbortController();
  state.streamAbortController = controller;
  state.streamIncludesWorkDetails = !shouldRestrictCurrentTurnEvents();
  activeStreamTurnId = turnId;
  const activeStreamController = controller;
  state.lastTurnEventAt = Date.now();
  state.streamWasBackgrounded = false;
  let handshakeTimedOut = false;
  let handshakeTimer = null;
  let assistantEntry = state.timeline.find((item) => item.id === `assistant_${turnId}`) || null;
  let buffer = '';
  let eventName = 'message';
  let eventId = '';
  let dataLines = [];
  let sawTerminalEvent = false;
  let shouldReconcileQueuedCompletion = false;
  const replayingTurnHistory = state.lastTurnEventSequence == null;
  let reconciledReplayedAssistant = false;
  let hydratedForStreamReset = false;

  try {
    const after = state.lastTurnEventSequence == null
      ? ''
      : `after=${encodeURIComponent(String(state.lastTurnEventSequence))}`;
    const epoch = state.lastTurnEventEpoch
      ? `epoch=${encodeURIComponent(state.lastTurnEventEpoch)}`
      : '';
    const query = [after, epoch].filter(Boolean).join('&');
    const responsePromise = fetch(`/api/turns/${encodeURIComponent(turnId)}/events${query ? `?${query}` : ''}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
        Accept: 'text/event-stream',
        ...(state.lastTurnEventEpoch ? { 'X-Codex-Event-Epoch': state.lastTurnEventEpoch } : {}),
      },
      signal: controller.signal,
    });
    handshakeTimer = scheduleNetworkTimer(() => {
      handshakeTimedOut = true;
      controller.abort();
    }, STREAM_HANDSHAKE_TIMEOUT_MS);
    const response = await responsePromise;
    clearNetworkTimer(handshakeTimer);
    handshakeTimer = null;

    if (!response.ok || !response.body) {
      throw await buildApiError(response);
    }

    const responseEpoch = streamResponseHeader(response, 'X-Codex-Event-Epoch');
    const responseReset = parseStreamResetValue(streamResponseHeader(response, 'X-Codex-Event-Reset'));
    const epochChanged = Boolean(
      responseEpoch
      && state.lastTurnEventEpoch
      && responseEpoch !== state.lastTurnEventEpoch
    );
    if (responseEpoch) {
      state.lastTurnEventEpoch = responseEpoch;
    }
    if (responseReset || epochChanged) {
      reconciledReplayedAssistant = true;
      assistantEntry = null;
      hydratedForStreamReset = false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (controller.signal.aborted || state.streamAbortController !== activeStreamController) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (controller.signal.aborted || state.streamAbortController !== activeStreamController) {
          return;
        }
        await processSseFrame(rawFrame);
        boundary = buffer.indexOf('\n\n');
      }
    }

    if (buffer.trim() && !controller.signal.aborted && state.streamAbortController === activeStreamController) {
      await processSseFrame(buffer);
    }
    shouldReconcileQueuedCompletion = !sawTerminalEvent
      && !controller.signal.aborted
      && pendingQueuedMessagesForCurrentSession().length > 0;
    if (!sawTerminalEvent
      && !controller.signal.aborted
      && state.pendingTurn
      && state.turnId === turnId
      && !isLocallyStartedTurnInSyncGrace(turnId)) {
      markStreamPaused();
      void revalidateWorkDetailsPolicyAfterStreamClose();
      scheduleStreamReconnect();
    }
  } catch (error) {
    if (controller.signal.aborted) {
      if (handshakeTimedOut && state.pendingTurn && state.turnId === turnId) {
        markStreamPaused();
        scheduleStreamReconnect();
      }
      return;
    }
    if (isRecoverableBackgroundStreamError(turnId, error)) {
      markStreamPaused();
      void revalidateWorkDetailsPolicyAfterStreamClose();
      scheduleStreamReconnect();
      return;
    }
    state.pendingTurn = false;
    state.status = 'Stream failed';
    state.statusTone = 'danger';
    surfaceTimelineError(turnId, error?.payload?.message || error?.message || 'Stream failed');
    handleApiError(error, { suppressComposerError: true });
  } finally {
    clearNetworkTimer(handshakeTimer);
    if (state.streamAbortController === controller) {
      state.streamAbortController = null;
      state.streamIncludesWorkDetails = false;
      activeStreamTurnId = '';
    }
    refreshChatDynamicUi();
  }

  if (shouldReconcileQueuedCompletion) {
    await reconcileQueuedCompletion(turnId);
  }

  async function processSseFrame(frame) {
    if (controller.signal.aborted || state.streamAbortController !== activeStreamController) {
      resetFrame();
      return;
    }
    if (!frame.trim()) {
      return;
    }
    state.lastTurnEventAt = Date.now();
    streamReconnectAttempt = 0;
    cancelStreamReconnect();
    for (const line of frame.split(/\r?\n/u)) {
      if (!line || line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('id:')) {
        eventId = line.slice(3).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (!dataLines.length) {
      resetFrame();
      return;
    }
    try {
      const rawPayload = JSON.parse(dataLines.join('\n'));
      if (eventName === 'control') {
        const resetApplied = await applyTurnStreamControl(rawPayload, turnId, activeStreamController, {
          alreadyHydrated: hydratedForStreamReset,
        });
        if (resetApplied) {
          assistantEntry = null;
          reconciledReplayedAssistant = true;
          hydratedForStreamReset = true;
        }
        resetFrame();
        return;
      }
      if (eventName !== 'message') {
        resetFrame();
        return;
      }
      const payload = presentTurnEventForCurrentAudience(rawPayload);
      if (!payload) {
        resetFrame();
        return;
      }
      if ((payload.type === 'turn.completed' || payload.type === 'turn.failed')
        && (!payload.turnId || payload.turnId === turnId)) {
        sawTerminalEvent = true;
      }
      if (eventId && !payload.sequence) {
        payload.sequence = eventId;
      }
      const sequence = Number(payload.sequence);
      if (Number.isFinite(sequence)) {
        if (state.lastTurnEventSequence != null && sequence <= Number(state.lastTurnEventSequence)) {
          resetFrame();
          return;
        }
        if (!isCachedAuthPrincipalPending()) {
          state.lastTurnEventSequence = sequence;
        }
      }
      if (replayingTurnHistory
        && !reconciledReplayedAssistant
        && !payload.itemId
        && (payload.type === 'assistant.delta' || payload.type === 'assistant.final')) {
        removeAssistantTimelineEntriesForTurn(turnId);
        assistantEntry = null;
        reconciledReplayedAssistant = true;
      }
      assistantEntry = applyTurnEvent(payload, assistantEntry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      surfaceTimelineError(turnId, message);
    }
    resetFrame();
  }

  function resetFrame() {
    eventName = 'message';
    eventId = '';
    dataLines = [];
  }
}

function streamResponseHeader(response, name) {
  return String(response?.headers?.get?.(name) || '').trim();
}

function parseStreamResetValue(value) {
  return ['1', 'true', 'yes', 'reset'].includes(String(value || '').trim().toLowerCase());
}

async function applyTurnStreamControl(payload, turnId, activeStreamController, { alreadyHydrated = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const epoch = String(payload.epoch || '').trim();
  const epochChanged = Boolean(epoch && state.lastTurnEventEpoch && epoch !== state.lastTurnEventEpoch);
  if (epoch) {
    state.lastTurnEventEpoch = epoch;
  }
  const reset = payload.type === 'stream.reset' || payload.reset === true || epochChanged;
  if (!reset) {
    return false;
  }
  const snapshotComplete = payload.snapshot?.complete === true;
  if (snapshotComplete) {
    resetTurnProjectionForReplay(turnId);
  }
  const snapshotEvents = Array.isArray(payload.events)
    ? payload.events
    : Array.isArray(payload.snapshot?.events)
      ? payload.snapshot.events
      : [];
  if (snapshotEvents.length) {
    for (const rawEvent of snapshotEvents) {
      const event = presentTurnEventForCurrentAudience(rawEvent);
      if (event) {
        applyTurnEvent(event, null);
      }
    }
    reorderTurnSnapshotProjection(turnId, snapshotEvents);
  }
  const rawThroughSequence = payload.snapshot?.throughSequence;
  const throughSequence = Number(rawThroughSequence);
  if (rawThroughSequence != null && Number.isFinite(throughSequence) && !isCachedAuthPrincipalPending()) {
    state.lastTurnEventSequence = throughSequence;
  }
  saveCurrentTimeline();
  if (!snapshotComplete && !alreadyHydrated) {
    void recoverTurnProjectionAfterStreamReset(turnId, activeStreamController);
  }
  return true;
}

function reorderTurnSnapshotProjection(turnId, snapshotEvents) {
  const orderedIds = [];
  const seen = new Set();
  for (const event of snapshotEvents) {
    const id = snapshotTimelineEntryId(event);
    if (id && !seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  }
  if (!orderedIds.length) {
    return;
  }
  const byId = new Map(state.timeline.map((item) => [item?.id, item]));
  const projected = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  if (!projected.length) {
    return;
  }
  const projectedIds = new Set(projected.map((item) => item.id));
  const preserved = state.timeline.filter((item) => !projectedIds.has(item?.id));
  let insertionIndex = -1;
  for (let index = 0; index < preserved.length; index += 1) {
    if (timelineTurnId(preserved[index]) === turnId) {
      insertionIndex = index;
    }
  }
  if (insertionIndex < 0) {
    for (let index = preserved.length - 1; index >= 0; index -= 1) {
      if (preserved[index]?.kind === 'message' && preserved[index]?.role === 'user') {
        insertionIndex = index;
        break;
      }
    }
  }
  preserved.splice(insertionIndex + 1, 0, ...projected);
  state.timeline = preserved;
}

function snapshotTimelineEntryId(event) {
  const turnId = String(event?.turnId || '').trim();
  if (!turnId) {
    return '';
  }
  if (event.type === 'assistant.delta' || event.type === 'assistant.final') {
    const final = event.type === 'assistant.final';
    const phase = normalizeAssistantProjectionPhase(event.phase, final);
    return assistantTimelineEntryId(turnId, String(event.itemId || '').trim(), phase, final);
  }
  if (event.type === 'batch.started' || event.type === 'batch.updated' || event.type === 'batch.completed') {
    return inlineWorkTimelineId(turnId, event.batchId);
  }
  if (event.type === 'approval.requested' || event.type === 'approval.resolved') {
    return event.approvalId ? `approval_${event.approvalId}` : '';
  }
  return '';
}

async function recoverTurnProjectionAfterStreamReset(turnId, activeStreamController) {
  const sessionId = state.sessionId;
  if (shouldRestrictCurrentTurnEvents()) {
    state.timeline = sanitizeRestrictedTimelineEntries(state.timeline, state.currentSession);
    state.sessionHistoryItems = sanitizeRestrictedTimelineEntries(state.sessionHistoryItems, state.currentSession);
    state.batches = sanitizeRestrictedWorkBatches(state.batches);
    state.approvals = sanitizeRestrictedApprovals(state.approvals);
    if (state.currentSession) {
      state.currentSession = sanitizeRestrictedSessionDetails(state.currentSession);
    }
    enforceCurrentWorkDetailsAccess();
  }
  const backup = {
    timeline: state.timeline.map((item) => ({ ...item })),
    batches: new Map(state.batches),
    approvals: new Map(state.approvals),
    terminal: state.terminalTurnIds.has(turnId),
  };
  const session = await reconcileCurrentSessionInBackground({ forceDetail: true });
  if (!session || state.sessionId !== sessionId || state.turnId !== turnId) {
    return;
  }
  mergeIncompleteTurnAssistantProjection(turnId, backup.timeline);
  state.lastTurnEventAt = Date.now();
  if (state.turnId === turnId && state.pendingTurn) {
    state.streamWasBackgrounded = false;
  }
}

function mergeIncompleteTurnAssistantProjection(turnId, backupTimeline) {
  const normalizedTurnId = String(turnId || '').trim();
  if (!normalizedTurnId) {
    return;
  }
  const source = shouldRestrictCurrentTurnEvents()
    ? sanitizeRestrictedTimelineEntries(backupTimeline, state.currentSession)
    : (Array.isArray(backupTimeline) ? backupTimeline : []);
  const preserved = source.filter((item) => (
    item?.kind === 'message'
    && item.role === 'assistant'
    && timelineTurnId(item) === normalizedTurnId
  ));
  if (!preserved.length) {
    return;
  }
  for (const item of preserved) {
    const identity = timelineReplayMergeIdentity(item);
    if (identity && state.timeline.some((candidate) => timelineReplayMergeIdentity(candidate) === identity)) {
      continue;
    }
    const sourceIndex = source.indexOf(item);
    let insertionIndex = -1;
    for (let index = sourceIndex - 1; index >= 0; index -= 1) {
      const anchor = timelineReplayMergeIdentity(source[index]);
      const currentIndex = anchor
        ? state.timeline.findIndex((candidate) => timelineReplayMergeIdentity(candidate) === anchor)
        : -1;
      if (currentIndex >= 0) {
        insertionIndex = currentIndex + 1;
        break;
      }
    }
    if (insertionIndex < 0) {
      for (let index = sourceIndex + 1; index < source.length; index += 1) {
        const anchor = timelineReplayMergeIdentity(source[index]);
        const currentIndex = anchor
          ? state.timeline.findIndex((candidate) => timelineReplayMergeIdentity(candidate) === anchor)
          : -1;
        if (currentIndex >= 0) {
          insertionIndex = currentIndex;
          break;
        }
      }
    }
    if (insertionIndex < 0) {
      let lastTurnIndex = -1;
      for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
        if (timelineTurnId(state.timeline[index]) === normalizedTurnId) {
          lastTurnIndex = index;
          break;
        }
      }
      insertionIndex = lastTurnIndex >= 0 ? lastTurnIndex + 1 : state.timeline.length;
    }
    state.timeline.splice(insertionIndex, 0, { ...item });
  }
  saveCurrentTimeline();
}

function timelineReplayMergeIdentity(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  if (item.kind === 'message') {
    return timelineProjectionIdentity(item);
  }
  return typeof item.id === 'string' && item.id ? `id:${item.id}` : '';
}

function resetTurnProjectionForReplay(turnId, { preserveAuxiliary = false } = {}) {
  const normalizedTurnId = String(turnId || '').trim();
  if (!normalizedTurnId) {
    return;
  }
  state.lastTurnEventSequence = null;
  state.terminalTurnIds.delete(normalizedTurnId);
  state.timeline = state.timeline.filter((item) => !(
    timelineTurnId(item) === normalizedTurnId
    && (
      (item?.kind === 'message' && item.role === 'assistant')
      || (!preserveAuxiliary && item?.kind === 'work')
      || (!preserveAuxiliary && item?.kind === 'approval')
    )
  ));
  if (!preserveAuxiliary) {
    state.batches = new Map([...state.batches.entries()].filter(([, batch]) => batch?.turnId !== normalizedTurnId));
    state.approvals = new Map([...state.approvals.entries()].filter(([, approval]) => approval?.turnId !== normalizedTurnId));
  }
}

function shouldRestrictCurrentTurnEvents() {
  if (isShareContext()) {
    return true;
  }
  const principal = state.authSession?.principal;
  return isCachedAuthPrincipalPending()
    || principal?.mode === 'multi'
    && principal.isAdmin !== true
    && !canViewCurrentWorkDetails();
}

function presentTurnEventForCurrentAudience(event) {
  if (!shouldRestrictCurrentTurnEvents()) {
    return event;
  }
  if (!event || typeof event !== 'object') {
    return null;
  }
  const base = {
    id: typeof event.id === 'string' ? event.id : '',
    type: typeof event.type === 'string' ? event.type : '',
    turnId: typeof event.turnId === 'string' ? event.turnId : '',
    ...(typeof event.itemId === 'string' && event.itemId ? { itemId: event.itemId } : {}),
    ...(typeof event.eventType === 'string' && event.eventType ? { eventType: event.eventType } : {}),
    ...(Number.isFinite(Number(event.sequence)) ? { sequence: Number(event.sequence) } : {}),
  };
  const authPrincipalPending = isCachedAuthPrincipalPending();
  switch (event.type) {
    case 'turn.started':
      return base;
    case 'assistant.delta':
      return event.phase === 'final_answer'
        ? {
          ...base,
          ...(Object.prototype.hasOwnProperty.call(event, 'text')
            ? { text: String(event.text || '') }
            : {}),
          delta: String(event.delta || ''),
          phase: 'final_answer',
        }
        : null;
    case 'assistant.final':
      return { ...base, text: String(event.text || ''), delta: String(event.delta || '') };
    case 'batch.started':
      if (authPrincipalPending) {
        return null;
      }
      return {
        ...base,
        batchId: typeof event.batchId === 'string' ? event.batchId : '',
        kind: ['command', 'file_change', 'permission'].includes(event.kind) ? event.kind : 'unknown',
        title: safeWorkTitleForKind(event.kind),
      };
    case 'batch.updated':
      return null;
    case 'batch.completed':
      if (authPrincipalPending) {
        return null;
      }
      return {
        ...base,
        batchId: typeof event.batchId === 'string' ? event.batchId : '',
        status: safeRestrictedWorkStatus(event.status),
      };
    case 'approval.requested':
      if (authPrincipalPending) {
        return null;
      }
      return {
        ...base,
        approvalId: typeof event.approvalId === 'string' ? event.approvalId : '',
        approvalKind: typeof event.approvalKind === 'string' ? event.approvalKind : '',
        summary: sanitizeRestrictedApprovalSummary(event.summary),
      };
    case 'approval.resolved':
      if (authPrincipalPending) {
        return null;
      }
      return {
        ...base,
        approvalId: typeof event.approvalId === 'string' ? event.approvalId : '',
        decision: typeof event.decision === 'string' ? event.decision : '',
      };
    case 'turn.completed':
      if (authPrincipalPending) {
        return null;
      }
      return { ...base, status: safeRestrictedWorkStatus(event.status) };
    case 'turn.failed':
      if (authPrincipalPending) {
        return null;
      }
      return { ...base, message: 'Turn failed.' };
    default:
      return null;
  }
}

function safeRestrictedWorkStatus(status) {
  const value = String(status || '').trim();
  return [
    'active',
    'cancelled',
    'complete',
    'completed',
    'denied',
    'failed',
    'in_progress',
    'inProgress',
    'interrupted',
    'pending',
    'running',
    'started',
  ].includes(value) ? value : 'completed';
}

async function reconcileQueuedCompletion(turnId) {
  const sessionId = state.sessionId;
  if (!sessionId || state.turnId !== turnId) {
    return;
  }
  await refreshCurrentSessionMetadata({ hydrateTimeline: true });
  if (state.sessionId !== sessionId) {
    return;
  }
  if (!state.pendingTurn && pendingQueuedMessagesForSession(sessionId).length > 0) {
    void sendNextQueuedMessage(sessionId);
  }
}

function isRecoverableBackgroundStreamError(turnId, error) {
  return state.pendingTurn
    && state.turnId === turnId
    && (state.streamWasBackgrounded || document.visibilityState === 'hidden' || isRetryableStreamError(error));
}

function markStreamPaused() {
  state.streamWasBackgrounded = true;
  state.status = 'Stream paused';
  state.statusTone = 'warn';
}

async function revalidateWorkDetailsPolicyAfterStreamClose() {
  const sessionId = state.sessionId;
  if (!sessionId || !state.currentSession || !isManagedMultiUserPrincipal() || isShareContext()) {
    return;
  }
  state.workDetailsPolicyPendingSessionId = sessionId;
  enforceCurrentWorkDetailsAccess();
  render();
  await Promise.allSettled([
    refreshProjectsList({ renderAfter: false }),
    refreshCurrentSessionMetadata({ hydrateTimeline: true }),
  ]);
  if (state.sessionId === sessionId) {
    render();
  }
}

async function onStopTurn() {
  if (!state.turnId) {
    return;
  }
  try {
    await apiFetch(`/api/turns/${encodeURIComponent(state.turnId)}/interrupt`, { method: 'POST' });
    state.status = 'Interrupt requested';
    state.statusTone = 'warn';
    render();
  } catch (error) {
    handleApiError(error);
  }
}

async function reloadRuntime() {
  try {
    state.status = 'Reloading runtime';
    state.statusTone = 'warn';
    render();
    await apiFetch('/api/runtime/reload', { method: 'POST' });
    state.status = 'Runtime reloaded';
    state.statusTone = 'success';
    state.error = '';
    render();
  } catch (error) {
    handleApiError(error);
  }
}

async function resolveApproval(approvalId, action) {
  if (!approvalId || !action) {
    return;
  }
  try {
    await apiFetch(`/api/approvals/${encodeURIComponent(approvalId)}/${action}`, { method: 'POST' });
    const item = state.approvals.get(approvalId);
    if (item) {
      item.resolved = true;
    }
    const hasPendingApproval = [...state.approvals.values()].some((approval) => approval?.resolved === false);
    setSessionSummaryActivity(
      state.sessionId,
      state.pendingTurn ? (hasPendingApproval ? 'waiting_approval' : 'running') : null,
      state.turnId,
    );
    state.status = 'Approval sent';
    state.statusTone = 'warn';
    render();
  } catch (error) {
    handleApiError(error);
  }
}

function applyTurnEvent(event, assistantEntry) {
  if (event.type === 'turn.failed'
    && isTurnInterruptTimeoutMessage(event.details || event.message)) {
    state.error = '';
    void refreshCurrentSessionMetadata();
    return assistantEntry;
  }
  if ((event.type === 'turn.completed' || event.type === 'turn.failed')
    && state.turnId
    && event.turnId
    && event.turnId !== state.turnId) {
    return assistantEntry;
  }
  if (event.turnId
    && state.terminalTurnIds.has(event.turnId)
    && !['approval.resolved', 'batch.completed'].includes(event.type)) {
    return assistantEntry;
  }
  if (event.turnId) {
    state.latestTurnId = event.turnId;
  }
  let sessionActivityChanged = false;
  switch (event.type) {
    case 'turn.started':
      state.terminalTurnIds.delete(event.turnId);
      if (state.turnId !== event.turnId) {
        state.queuedInterruptRequestedTurnId = null;
        state.queuedInterruptEligibleTurnId = null;
      }
      clearLocallyStartedTurn();
      state.pendingTurn = true;
      state.turnId = event.turnId;
      state.streamWasBackgrounded = false;
      state.status = 'Turn running';
      state.statusTone = 'warn';
      sessionActivityChanged = setSessionSummaryActivity(state.sessionId, 'running', event.turnId);
      break;
    case 'assistant.delta':
      assistantEntry = upsertAssistantProjection(event, { final: false });
      break;
    case 'assistant.final':
      assistantEntry = upsertAssistantProjection(event, { final: true });
      break;
    case 'batch.started':
      state.queuedInterruptEligibleTurnId = event.turnId;
      upsertWorkBatch(event.turnId, event.batchId, {
        id: `batch_${event.batchId}`,
        batchId: event.batchId,
        batchKind: event.kind,
        title: event.title || 'Batch',
        status: 'started',
        summary: {},
      });
      break;
    case 'batch.updated':
      upsertWorkBatch(event.turnId, event.batchId, {
        summary: sanitizeWorkSummary(event.summary),
      });
      break;
    case 'batch.completed':
      upsertWorkBatch(event.turnId, event.batchId, {
        status: event.status || 'completed',
        summary: {},
      });
      void maybeInterruptRunningTurnForQueuedMessage();
      break;
    case 'approval.requested': {
      state.queuedInterruptEligibleTurnId = event.turnId;
      const approval = {
        id: `approval_${event.approvalId}`,
        kind: 'approval',
        approvalId: event.approvalId,
        approvalKind: event.approvalKind,
        turnId: event.turnId,
        summary: sanitizeWorkSummary(event.summary),
        resolved: false,
      };
      state.approvals.set(event.approvalId, approval);
      appendOrReplace(approval, (item) => item.id === approval.id);
      sessionActivityChanged = setSessionSummaryActivity(state.sessionId, 'waiting_approval', event.turnId);
      break;
    }
    case 'approval.resolved': {
      const approval = state.approvals.get(event.approvalId);
      if (approval) {
        approval.resolved = true;
        approval.summary = {
          ...approval.summary,
          decision: event.decision,
        };
        appendOrReplace(approval, (item) => item.id === approval.id);
      }
      state.status = 'Approval resolved';
      state.statusTone = 'warn';
      {
        const hasPendingApproval = [...state.approvals.values()].some((item) => item?.resolved === false);
        sessionActivityChanged = setSessionSummaryActivity(
          state.sessionId,
          state.pendingTurn ? (hasPendingApproval ? 'waiting_approval' : 'running') : null,
          event.turnId || state.turnId,
        );
      }
      void maybeInterruptRunningTurnForQueuedMessage();
      break;
    }
    case 'turn.completed':
      state.terminalTurnIds.add(event.turnId);
      setWorkStatus(event.turnId, event.status || 'completed');
      state.pendingTurn = false;
      sessionActivityChanged = setSessionSummaryActivity(state.sessionId, null);
      state.streamWasBackgrounded = false;
      state.queuedInterruptRequestedTurnId = null;
      state.queuedInterruptEligibleTurnId = null;
      {
        const completedSessionId = state.sessionId;
        restoreStaleQueuedMessagesForSession(completedSessionId);
        const hasQueuedMessage = pendingQueuedMessagesForSession(completedSessionId).length > 0;
        if (hasQueuedMessage) {
          state.status = 'Starting turn';
          state.statusTone = 'warn';
          state.turnId = null;
          stopStream();
          void refreshCurrentSessionMetadata();
          void sendNextQueuedMessage(completedSessionId);
          break;
        }
      }
      {
        const runtimeStatus = runtimeStatusForTurnStatus(event.status);
        state.status = runtimeStatus.status;
        state.statusTone = runtimeStatus.tone;
      }
      state.turnId = null;
      stopStream();
      void refreshCurrentSessionMetadata();
      break;
    case 'turn.failed':
      state.terminalTurnIds.add(event.turnId);
      setWorkStatus(event.turnId, 'failed');
      state.pendingTurn = false;
      sessionActivityChanged = setSessionSummaryActivity(state.sessionId, null);
      state.streamWasBackgrounded = false;
      state.queuedInterruptRequestedTurnId = null;
      state.queuedInterruptEligibleTurnId = null;
      state.status = 'Turn failed';
      state.statusTone = 'danger';
      state.turnId = null;
      stopStream();
      surfaceTimelineError(event.turnId, event.details || event.message || 'Turn failed');
      break;
  }
  if (!state.pendingTurn && state.sessionId) {
    restoreStaleQueuedMessagesForSession(state.sessionId);
  }
  if (sessionActivityChanged) {
    persistSessionsCache();
    refreshVisibleSessionCards();
  }
  const shouldCoalesceDynamicUpdate = event.type === 'assistant.delta' || event.type === 'batch.updated';
  if (shouldCoalesceDynamicUpdate) {
    scheduleCurrentTimelineSave();
  } else {
    saveCurrentTimeline();
  }
  if (!state.pendingTurn && state.sessionId && pendingQueuedMessagesForCurrentSession().length && event.type !== 'turn.completed') {
    void sendNextQueuedMessage(state.sessionId);
  }
  if (shouldCoalesceDynamicUpdate) {
    const dirtyTimelineId = event.type === 'assistant.delta'
      ? assistantEntry?.id || ''
      : inlineWorkTimelineId(event.turnId, event.batchId);
    scheduleChatDynamicUiRefresh(dirtyTimelineId);
  } else {
    refreshChatDynamicUi();
    scrollTimelineToBottomIfFollowingLatest();
  }
  return assistantEntry;
}

function upsertAssistantProjection(event, { final = false } = {}) {
  const turnId = String(event?.turnId || state.turnId || '').trim();
  if (!turnId) {
    return null;
  }
  const phase = normalizeAssistantProjectionPhase(event?.phase, final);
  const itemId = String(event?.itemId || '').trim();
  const projectionKey = itemId ? `${turnId}\u0000${itemId}` : '';
  const id = assistantTimelineEntryId(turnId, itemId, phase, final);
  let index = state.timeline.findIndex((item) => (
    item?.kind === 'message'
    && item.role === 'assistant'
    && (
      (projectionKey && item.projectionKey === projectionKey)
      || item.id === id
    )
  ));
  const current = index >= 0 ? state.timeline[index] : null;
  const hasDeltaContract = Object.prototype.hasOwnProperty.call(event || {}, 'delta')
    || typeof event?.eventType === 'string';
  const eventText = typeof event?.text === 'string' ? event.text : '';
  const delta = typeof event?.delta === 'string'
    ? event.delta
    : hasDeltaContract
      ? ''
      : eventText;
  const text = final
    ? eventText || current?.text || ''
    : hasDeltaContract && typeof event?.text === 'string'
      ? eventText
      : `${current?.text || ''}${delta}`;
  const entry = {
    ...(current || {}),
    id,
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    meta: assistantProjectionMeta(phase, final),
    text,
    turnId,
    ...(itemId ? { itemId, projectionKey } : {}),
    source: 'stream',
    lifecycle: final ? 'completed' : String(event?.eventType || 'delta'),
    streaming: !final && event?.eventType !== 'completed',
    ...(Number.isFinite(Number(event?.sequence)) ? { sequence: Number(event.sequence) } : {}),
  };
  if (index < 0 && text) {
    index = state.timeline.findIndex((item) => (
      item?.kind === 'message'
      && item.role === 'assistant'
      && timelineTurnId(item) === turnId
      && item.text === text
      && assistantTimelineMetaCompatible(item.meta, entry.meta)
    ));
  }
  if (index >= 0) {
    state.timeline[index] = entry;
  } else {
    appendMessage(entry);
  }
  return entry;
}

function normalizeAssistantProjectionPhase(phase, final = false) {
  if (final) {
    return 'final_answer';
  }
  return String(phase || 'commentary').trim().toLowerCase().replace(/[\s-]+/gu, '_');
}

function assistantProjectionMeta(phase, final = false) {
  if (final || phase === 'final_answer' || phase === 'final') {
    return 'final';
  }
  if (phase.includes('reasoning') && phase.includes('summary')) {
    return 'reasoning-summary';
  }
  if (phase === 'commentary' || phase === 'analysis') {
    return 'commentary';
  }
  return phase || 'commentary';
}

function assistantTimelineEntryId(turnId, itemId, phase = '', final = false) {
  if (itemId) {
    return `assistant_${turnId}_${itemId}`;
  }
  return final || phase === 'final_answer' || phase === 'final'
    ? `assistant_${turnId}_final`
    : `assistant_${turnId}`;
}

function assistantTimelineMetaCompatible(left, right) {
  const leftMeta = String(left || '').trim().toLowerCase();
  const rightMeta = String(right || '').trim().toLowerCase();
  if (leftMeta === 'history') {
    return true;
  }
  const normalize = (value) => value === 'final_answer' ? 'final' : value;
  return normalize(leftMeta) === normalize(rightMeta);
}

function inlineWorkTimelineId(turnId, batchId) {
  return turnId && batchId ? `work_${turnId}_${batchId}` : '';
}

function sanitizeWorkSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return {};
  }
  const displaySummary = { ...summary };
  delete displaySummary.raw;
  const sanitized = sanitizeCacheValue(displaySummary);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? sanitized : {};
}

function upsertWorkBatch(turnId, batchId, patch) {
  const current = state.batches.get(batchId)
    || {
      id: `batch_${batchId}`,
      kind: 'batch',
      turnId,
      batchId,
      batchKind: 'unknown',
      title: 'Batch',
      status: '',
      summary: {},
    };
  const next = {
    ...current,
    ...patch,
    turnId: current.turnId || turnId,
    summary: { ...current.summary, ...(patch.summary || {}) },
  };
  state.batches.set(batchId, next);
}

function buildWorkTimelineItem(turnId, batches, terminalStatus = '', approvals = []) {
  const normalizedTurnId = String(turnId || '').trim();
  const normalizedBatches = Array.isArray(batches) ? batches : [];
  const normalizedApprovals = Array.isArray(approvals) ? approvals : [];
  if (!normalizedTurnId || (!normalizedBatches.length && !normalizedApprovals.length)) {
    return null;
  }
  const status = terminalStatus || workTimelineStatus(normalizedBatches);
  return {
    id: `work_${normalizedTurnId}`,
    kind: 'work',
    turnId: normalizedTurnId,
    status,
    batches: normalizedBatches,
    approvals: normalizedApprovals,
  };
}

function workTimelineStatus(batches) {
  if (!batches.length) {
    return 'running';
  }
  if (batches.some(workBatchHasError)) {
    return 'failed';
  }
  if (batches.some((batch) => {
    const status = String(batch?.status || '').trim().toLowerCase();
    return !status || status === 'started' || status === 'running' || status === 'pending';
  })) {
    return 'running';
  }
  return 'completed';
}

function upsertWorkApproval(_turnId, approval) {
  appendOrReplace(approval, (item) => item.id === approval.id);
}

function hasPendingWorkForTurn(turnId = state.turnId) {
  if (!turnId) {
    return false;
  }
  for (const batch of state.batches.values()) {
    if (batch?.turnId !== turnId) {
      continue;
    }
    const normalizedStatus = String(batch?.status || '').trim().toLowerCase();
    if (!normalizedStatus || normalizedStatus === 'started' || normalizedStatus === 'running' || normalizedStatus === 'pending') {
      return true;
    }
  }
  for (const approval of state.approvals.values()) {
    if (approval?.resolved !== false) {
      continue;
    }
    return true;
  }
  return false;
}

async function maybeInterruptRunningTurnForQueuedMessage() {
  const sessionId = state.sessionId;
  const turnId = state.turnId;
  if (!sessionId || !turnId || !state.pendingTurn) {
    return;
  }
  if (!pendingQueuedMessagesForSession(sessionId).length) {
    return;
  }
  if (state.queuedInterruptEligibleTurnId !== turnId) {
    return;
  }
  if (state.queuedInterruptRequestedTurnId && state.queuedInterruptRequestedTurnId !== turnId) {
    return;
  }
  if (hasPendingWorkForTurn(turnId)) {
    return;
  }
  state.queuedInterruptRequestedTurnId = turnId;
  try {
    await apiFetch(`/api/turns/${encodeURIComponent(turnId)}/interrupt`, { method: 'POST' });
    await refreshCurrentSessionMetadata({ hydrateTimeline: true });
    if (state.sessionId === sessionId && !state.pendingTurn && pendingQueuedMessagesForSession(sessionId).length > 0) {
      void sendNextQueuedMessage(sessionId);
    }
  } catch (error) {
    if (!isTurnInterruptTimeoutMessage(error?.payload?.message || error?.message)) {
      console.warn('[codex-web] queued turn interrupt was not confirmed', error);
    }
    if (state.sessionId !== sessionId) {
      return;
    }
    state.error = '';
    state.status = 'Turn running';
    state.statusTone = 'warn';
    refreshChatDynamicUi();
    await refreshCurrentSessionMetadata();
    if (state.sessionId === sessionId && !state.pendingTurn && pendingQueuedMessagesForSession(sessionId).length > 0) {
      void sendNextQueuedMessage(sessionId);
    }
  }
}

function setWorkStatus(turnId, status) {
  for (const batch of state.batches.values()) {
    if (batch?.turnId === turnId) {
      batch.status = status;
      state.batches.set(batch.batchId, batch);
      const inlineId = inlineWorkTimelineId(turnId, batch.batchId);
      const inlineIndex = state.timeline.findIndex((item) => item?.id === inlineId);
      if (inlineIndex >= 0) {
        state.timeline[inlineIndex] = {
          ...state.timeline[inlineIndex],
          status,
          batches: [batch],
        };
      }
    }
  }
}

function resetTurnState() {
  clearLocallyStartedTurn();
  state.turnId = null;
  state.latestTurnId = '';
  state.pendingTurn = false;
  state.lastTurnEventSequence = null;
  state.lastTurnEventEpoch = '';
  state.lastTurnEventAt = 0;
  state.terminalTurnIds = new Set();
  state.streamWasBackgrounded = false;
  state.timeline = [];
  resetSessionHistoryWindow();
  state.batches = new Map();
  state.approvals = new Map();
  state.workDetailsOpen = false;
  state.workDetailsPolicyPendingSessionId = '';
}

function handleMissingSession(error, promptToRestore) {
  if (!isMissingSessionError(error)) {
    return false;
  }
  const missingSessionId = state.sessionId;
  if (missingSessionId) {
    state.sessions = state.sessions.filter((session) => session.id !== missingSessionId);
  }
  stopStream();
  state.sessionId = null;
  state.currentSession = null;
  state.activeSubmissionId = '';
  state.draftSessionActive = false;
  state.turnId = null;
  state.pendingTurn = false;
  state.timeline = [];
  resetSessionHistoryWindow();
  state.batches = new Map();
  state.approvals = new Map();
  if (promptToRestore) {
    state.prompt = promptToRestore;
    savePromptDraftForCurrentSession();
  }
  state.status = 'Ready';
  state.statusTone = 'warn';
  state.error = 'Selected session was unavailable. Choose another session or create a new one.';
  persistWorkspaceState({ view: 'sessions', sessionId: '' });
  render();
  return true;
}

function isMissingSessionError(error) {
  const code = error?.payload?.error;
  const message = error?.payload?.message || error?.message || '';
  return error?.status === 404 && code === 'session_not_found'
    || /thread not found|session not found|unknown session|unknown thread/i.test(message);
}

function isUnavailableSessionError(error) {
  const message = error?.payload?.message || error?.message || '';
  return /thread not loaded|no rollout found for thread id|rollout .* is empty/i.test(message);
}

function scheduleFirstTurnRecovery({
  error,
  promptText,
  sessionId,
  wasNewSession,
}) {
  if (!wasNewSession || !sessionId || !isUnavailableSessionError(error)) {
    return false;
  }
  const message = error?.payload?.message || error?.message || 'Request failed';
  state.pendingTurn = true;
  state.status = 'Waiting for first response';
  state.statusTone = 'warn';
  state.error = '';
  renderChatAtLatestIfFollowing(() => {});
  setTimeout(() => {
    void recoverFirstTurnAfterDelay({
      sessionId,
      promptText,
      message,
    });
  }, FIRST_TURN_RECOVERY_DELAY_MS);
  return true;
}

async function recoverFirstTurnAfterDelay({ sessionId, promptText, message }) {
  if (state.sessionId !== sessionId || !state.pendingTurn) {
    return;
  }
  const session = await refreshCurrentSessionMetadata({ hydrateTimeline: true });
  if (session && hasRecoveredFirstTurn(session, promptText)) {
    state.pendingTurn = false;
    state.streamWasBackgrounded = false;
    state.turnId = null;
    state.status = 'Ready';
    state.statusTone = 'success';
    state.error = '';
    renderChatAtLatest(() => {});
    return;
  }
  state.pendingTurn = false;
  state.status = 'Request failed';
  state.statusTone = 'danger';
  surfaceTimelineError(`request_${sessionId}`, message);
  renderChatAtLatest(() => {});
}

function hasRecoveredFirstTurn(session, promptText) {
  const turns = Array.isArray(session?.thread?.turns) ? session.thread.turns : [];
  const activeTurn = findActiveTurn(session);
  if (activeTurn?.id) {
    state.turnId = activeTurn.id;
    return true;
  }
  const prompt = String(promptText || '').trim();
  for (const turn of turns) {
    if (!isTerminalTurnStatus(turn?.status)) {
      continue;
    }
    const items = Array.isArray(turn?.items) ? turn.items : [];
    const hasPrompt = !prompt || items.some((item) => item?.role === 'user' && String(item.text || '').trim() === prompt);
    const hasAssistantAnswer = items.some((item) => item?.role === 'assistant' && String(item.text || '').trim());
    if (hasPrompt && hasAssistantAnswer) {
      return true;
    }
  }
  return false;
}

async function refreshCurrentSessionMetadata({
  hydrateTimeline = false,
  viewportSnapshot = null,
  signal = null,
  forceDetail = false,
} = {}) {
  if (!state.sessionId || isShareContext()) {
    return null;
  }
  if (!hydrateTimeline && !forceDetail) {
    return refreshCurrentSessionStatus({ viewportSnapshot, signal });
  }
  const sessionId = state.sessionId;
  const requestGeneration = authRequestGeneration;
  const snapshot = viewportSnapshot || (isDesktopWorkspaceView() ? latestTimelineViewportSnapshot() : captureTimelineViewport());
  try {
    const payload = forceDetail
      ? await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { signal })
      : await loadSessionOpenData(state.currentSession || { id: sessionId }, { signal });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    if (payload?.session) {
      upsertSession(payload.session);
      const session = state.currentSession?.id === sessionId
        ? state.currentSession
        : state.sessions.find((item) => item.id === sessionId) || null;
      if (state.sessionId === sessionId) {
        state.currentSession = payload.compact && session
          ? { ...session, ...payload.session }
          : session;
        if (payload.compact && state.currentSession) {
          delete state.currentSession.thread;
        }
        const currentSession = state.currentSession;
        state.cwd = session?.cwd || state.cwd;
        if (hydrateTimeline && currentSession) {
          hydrateCurrentTimelineFromSession(currentSession, { forceAuthoritative: forceDetail });
          const runtimeStatus = syncRuntimeStatusFromSession(currentSession);
          if (runtimeStatus.activeTurnId && state.turnId) {
            restoreTurnEventCursor(sessionId, state.turnId, { onlyIfUnset: true });
            await applySessionTurnSnapshot(payload.turnSnapshot, state.turnId);
          }
        }
        if (!state.pendingTurn) {
          restoreStaleQueuedMessagesForSession(sessionId);
        }
      }
      if (state.sessionId === sessionId) {
        nextTimelineRestoreSnapshot = snapshot;
      }
      if (state.sessionId === sessionId) {
        renderChatWithTimelineRestored(() => {});
        if (hydrateTimeline && state.view === 'chat') {
          scrollTimelineToBottomIfFollowingLatest();
        }
        nextTimelineRestoreSnapshot = null;
        if (hydrateTimeline && !state.pendingTurn && pendingQueuedMessagesForSession(sessionId).length > 0) {
          void sendNextQueuedMessage(sessionId);
        }
      } else {
        renderSessionListAfterBackgroundUpdate();
      }
      return state.sessionId === sessionId ? state.currentSession : session;
    }
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    if (isMissingSessionError(error)) {
      if (state.sessionId === sessionId) {
        handleMissingSession(error, '');
      } else {
        removeSession(sessionId);
        if (state.view === 'sessions') {
          render();
        }
      }
      return null;
    }
    if (error?.status === 401 || error?.status === 403) {
      handleApiError(error);
      return null;
    }
    if (error?.name !== 'AbortError') {
      console.warn('[codex-web] session refresh failed', error);
    }
  }
  return null;
}

async function refreshCurrentSessionStatus({ viewportSnapshot = null, signal = null } = {}) {
  if (!state.sessionId || isShareContext()) {
    return null;
  }
  const sessionId = state.sessionId;
  const requestGeneration = authRequestGeneration;
  let payload = null;
  try {
    payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/status`, { signal });
  } catch (error) {
    if (error?.status === 404 && error?.payload?.error !== 'session_not_found') {
      return refreshCurrentSessionMetadata({ hydrateTimeline: true, viewportSnapshot, signal });
    }
    if (error?.name === 'AbortError') {
      return null;
    }
    if (error?.status === 401 || error?.status === 403) {
      handleApiError(error);
      return null;
    }
    if (isMissingSessionError(error)) {
      if (state.sessionId === sessionId) {
        handleMissingSession(error, '');
      } else {
        removeSession(sessionId);
        renderSessionListAfterBackgroundUpdate();
      }
      return null;
    }
    console.warn('[codex-web] session status refresh failed', error);
    return null;
  }
  if (!isAuthRequestCurrent(requestGeneration) || !payload?.session) {
    return null;
  }
  upsertSession(payload.session);
  const session = state.currentSession?.id === sessionId
    ? state.currentSession
    : state.sessions.find((item) => item.id === sessionId) || null;
  if (!session) {
    return null;
  }
  if (state.sessionId !== sessionId) {
    renderSessionListAfterBackgroundUpdate();
    return session;
  }
  state.currentSession = session;
  state.cwd = session.cwd || state.cwd;
  const runtimeStatus = syncRuntimeStatusFromSession(session);
  if (runtimeStatus.activeTurnId && state.turnId) {
    restoreTurnEventCursor(sessionId, state.turnId, { onlyIfUnset: true });
  }
  nextTimelineRestoreSnapshot = viewportSnapshot;
  renderChatWithTimelineRestored(() => {});
  nextTimelineRestoreSnapshot = null;
  if (!state.pendingTurn && pendingQueuedMessagesForSession(sessionId).length > 0) {
    void sendNextQueuedMessage(sessionId);
  }
  return session;
}

async function refreshSessionsList({
  renderAfter = true,
  scope = state.sortMode === 'favorites' ? 'favorites' : 'all',
  background = false,
} = {}) {
  const requestGeneration = authRequestGeneration;
  const normalizedScope = normalizeSessionScope(scope);
  const path = sessionListPath(normalizedScope);
  if (background) {
    const payload = await apiFetch(path);
    if (!isAuthRequestCurrent(requestGeneration)) {
      return [];
    }
    const sessions = normalizeSessionsForScope(payload, normalizedScope);
    state.sessionsByScope[normalizedScope] = sessions;
    state.sessionsLoadedByScope[normalizedScope] = true;
    syncCurrentWorkDetailsAccessFromSessions(sessions);
    enforceKnownWorkDetailsAccess();
    persistSessionsCache();
    return sessions;
  }
  const requestId = state.sessionsRequestId + 1;
  state.sessionsRequestId = requestId;
  state.sessionsLoading = true;
  state.sessionsLoadingScope = normalizedScope;
  state.sessionsError = '';
  restoreSessionsFromCacheForScope(normalizedScope);
  state.sessionsScope = normalizedScope;
  state.sessions = normalizedScope === currentSessionScope()
    ? [...(state.sessionsByScope[normalizedScope] || [])]
    : [];
  if (renderAfter) {
    render();
  }
  try {
    const payload = await apiFetch(path);
    if (!isAuthRequestCurrent(requestGeneration)) {
      return [];
    }
    const sessions = normalizeSessionsForScope(payload, normalizedScope);
    state.sessionsByScope[normalizedScope] = sessions;
    state.sessionsLoadedByScope[normalizedScope] = true;
    syncCurrentWorkDetailsAccessFromSessions(sessions);
    enforceKnownWorkDetailsAccess();
    persistSessionsCache();
    if (requestId !== state.sessionsRequestId || normalizedScope !== currentSessionScope()) {
      return sessions;
    }
    state.sessions = [...sessions];
    state.sessionsScope = normalizedScope;
    syncCurrentSessionFromList();
    return state.sessions;
  } catch (error) {
    if (
      requestId === state.sessionsRequestId
      && normalizedScope === currentSessionScope()
      && isAuthRequestCurrent(requestGeneration)
    ) {
      state.sessionsError = 'Could not update sessions.';
    }
    throw error;
  } finally {
    if (requestId === state.sessionsRequestId) {
      state.sessionsLoading = false;
      state.sessionsLoadingScope = null;
    }
    if (renderAfter && isAuthRequestCurrent(requestGeneration)) {
      render();
    }
  }
}

function createWebhookSettingsState() {
  return {
    enabled: false,
    hasKey: false,
    key: '',
    keyHint: '',
    endpointPath: '',
    loaded: false,
    loading: false,
    saving: false,
    endpointCopied: false,
    keyCopied: false,
    error: '',
  };
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
  const requestGeneration = authRequestGeneration;
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
  const requestGeneration = authRequestGeneration;
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
  const requestGeneration = authRequestGeneration;
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

async function refreshGlobalSettings({ renderAfter = true } = {}) {
  const requestGeneration = authRequestGeneration;
  try {
    const payload = await apiFetch('/api/settings');
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    applyGlobalSettingsPayload(payload, { renderAfter });
    return payload;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

function applyGlobalSettingsPayload(payload, { renderAfter = true } = {}) {
  if (!payload) {
    return null;
  }
  const siteTitle = normalizeSiteTitle(payload.settings?.siteTitle);
  state.globalSettings = {
    siteTitle,
    canSetSiteTitle: payload.permissions?.canSetSiteTitle === true,
    publicSharesEnabled: payload.features?.publicSharesEnabled === true,
    loaded: true,
  };
  applySiteTitle(siteTitle, { persist: false });
  localStorage.removeItem(SITE_TITLE_KEY);
  if (renderAfter) {
    render();
  }
  return state.globalSettings;
}

async function saveSiteTitle(siteTitle) {
  if (!canSetSiteTitle()) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  try {
    const payload = await apiFetch('/api/settings', {
      method: 'PATCH',
      body: { siteTitle },
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.error = '';
    return applyGlobalSettingsPayload(payload);
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

async function refreshProjectsList({ renderAfter = true } = {}) {
  const requestGeneration = authRequestGeneration;
  try {
    const payload = await apiFetch('/api/projects');
    if (!isAuthRequestCurrent(requestGeneration)) {
      return [];
    }
    state.projects = normalizeProjects(payload);
    state.projectsLoaded = true;
    initializeNewProjectSelection();
    resolvePendingWorkDetailsPolicy();
    enforceKnownWorkDetailsAccess();
    return state.projects;
  } finally {
    if (renderAfter && isAuthRequestCurrent(requestGeneration)) {
      render();
    }
  }
}

async function toggleProjectFavorite(projectId) {
  const normalizedId = String(projectId || '').trim();
  if (!normalizedId) {
    return null;
  }
  const existing = state.projects.find((project) => project.id === normalizedId);
  if (!existing) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  const previousFavorite = Boolean(existing.favorite);
  const nextFavorite = !previousFavorite;
  state.projects = state.projects.map((project) => (
    project.id === normalizedId ? { ...project, favorite: nextFavorite } : project
  ));
  render();
  try {
    const payload = await apiFetch(`/api/projects/${encodeURIComponent(normalizedId)}/favorite`, {
      method: 'PATCH',
      body: { favorite: nextFavorite },
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    const savedFavorite = typeof payload?.favorite === 'boolean' ? payload.favorite : nextFavorite;
    state.projects = state.projects.map((project) => (
      project.id === normalizedId ? { ...project, favorite: savedFavorite } : project
    ));
    return state.projects.find((project) => project.id === normalizedId) || null;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.projects = state.projects.map((project) => (
      project.id === normalizedId ? { ...project, favorite: previousFavorite } : project
    ));
    handleApiError(error);
    return null;
  } finally {
    if (isAuthRequestCurrent(requestGeneration)) {
      render();
    }
  }
}

async function refreshAdminConsole({ renderAfter = true } = {}) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  state.admin.loading = true;
  if (renderAfter) {
    render();
  }
  try {
    const [settingsPayload, projectsPayload, usersPayload, rolesPayload, sessionsPayload] = await Promise.all([
      apiFetch('/api/admin/settings'),
      apiFetch('/api/admin/projects'),
      apiFetch('/api/admin/users'),
      apiFetch('/api/admin/roles'),
      apiFetch(adminSessionsPath(state.admin.filterUserId, state.admin.filterProjectId, state.admin.filterState)),
    ]);
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.admin.settings = settingsPayload?.settings || null;
    state.admin.projects = normalizeAdminItems(projectsPayload);
    state.admin.users = normalizeAdminItems(usersPayload);
    state.admin.roles = normalizeAdminItems(rolesPayload);
    state.admin.sessions = normalizeAdminItems(sessionsPayload);
    state.admin.loaded = true;
    state.error = '';
    return state.admin;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  } finally {
    if (isAuthRequestCurrent(requestGeneration)) {
      state.admin.loading = false;
      if (renderAfter) {
        render();
      }
    }
  }
}

async function refreshAdminSettings({ renderAfter = true } = {}) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  try {
    const payload = await apiFetch('/api/admin/settings');
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.admin.settings = payload?.settings || null;
    state.error = '';
    return state.admin.settings;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  } finally {
    if (renderAfter && isAuthRequestCurrent(requestGeneration)) {
      render();
    }
  }
}

async function refreshAdminSessions({
  userId = state.admin.filterUserId,
  projectId = state.admin.filterProjectId,
  state: sessionState = state.admin.filterState,
  renderAfter = true,
} = {}) {
  if (!isAdminPrincipal()) {
    return [];
  }
  const requestGeneration = authRequestGeneration;
  state.admin.filterUserId = String(userId || '');
  state.admin.filterProjectId = String(projectId || '');
  state.admin.filterState = normalizeAdminSessionState(sessionState);
  state.admin.loading = true;
  if (renderAfter) {
    render();
  }
  try {
    const payload = await apiFetch(adminSessionsPath(state.admin.filterUserId, state.admin.filterProjectId, state.admin.filterState));
    if (!isAuthRequestCurrent(requestGeneration)) {
      return [];
    }
    state.admin.sessions = normalizeAdminItems(payload);
    state.error = '';
    return state.admin.sessions;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return [];
    }
    handleApiError(error);
    return [];
  } finally {
    if (isAuthRequestCurrent(requestGeneration)) {
      state.admin.loading = false;
      if (renderAfter) {
        render();
      }
    }
  }
}

async function updateAdminSettings(patch = {}) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  try {
    const payload = await apiFetch('/api/admin/settings', {
      method: 'PATCH',
      body: patch,
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.admin.settings = payload?.settings || state.admin.settings;
    state.error = '';
    render();
    return state.admin.settings;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

async function onAdminProjectSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const project = adminEditingProject();
  await saveAdminProject({
    id: String(project?.id || '').trim(),
    cwd: String(form.get('cwd') || '').trim(),
    displayName: String(form.get('displayName') || '').trim(),
    enabled: form.get('enabled') === 'on',
    showWorkDetailsToMembers: form.get('showWorkDetailsToMembers') === 'on',
    activeSessionLimit: normalizeActiveSessionLimitInput(form.get('activeSessionLimit')),
  });
}

async function onAdminRoleSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await saveAdminRole({
    id: String(form.get('id') || '').trim(),
    name: String(form.get('name') || '').trim(),
    projectIds: form.getAll('projectIds').map((value) => String(value || '').trim()).filter(Boolean),
  });
}

async function onAdminUserSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const editingUserId = String(state.admin.editingUserId || '').trim();
  const baseUser = {
    id: editingUserId,
    username: String(form.get('username') || '').trim(),
    email: String(form.get('email') || '').trim(),
    enabled: form.get('enabled') === 'on',
    roleId: String(form.get('roleId') || '').trim(),
  };
  if (editingUserId) {
    await saveAdminUserAccess(baseUser);
    return;
  }
  await saveAdminUser({
    ...baseUser,
    password: String(form.get('password') || ''),
  });
}

async function saveAdminProject(project) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const cwd = String(project.cwd || '').trim();
  const existingId = String(project.id || '').trim();
  const id = existingId || cwd;
  const isEditing = Boolean(existingId);
  const requestGeneration = authRequestGeneration;
  try {
    const payload = await apiFetch(isEditing ? `/api/admin/projects/${encodeURIComponent(id)}` : '/api/admin/projects', {
      method: isEditing ? 'PATCH' : 'POST',
      body: {
        id,
        cwd,
        displayName: String(project.displayName || '').trim(),
        enabled: project.enabled !== false,
        showWorkDetailsToMembers: project.showWorkDetailsToMembers !== false,
        activeSessionLimit: project.activeSessionLimit == null ? 30 : project.activeSessionLimit,
      },
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.error = '';
    state.admin.editingProjectId = '';
    await refreshAdminConsole({ renderAfter: true });
    return payload?.project || null;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

async function saveAdminRole(role) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  try {
    const payload = await apiFetch('/api/admin/roles', {
      method: 'POST',
      body: {
        id: String(role.id || '').trim(),
        name: String(role.name || '').trim(),
        projectIds: Array.isArray(role.projectIds) ? role.projectIds : [],
        projectGrants: projectGrantsFromProjectIds(role.projectIds),
      },
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.error = '';
    state.admin.editingRoleId = '';
    await refreshAdminConsole({ renderAfter: true });
    return payload?.role || null;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

async function saveAdminUser(user) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  try {
    const roleId = String(user.roleId || '').trim();
    const body = {
      username: String(user.username || '').trim(),
      email: String(user.email || '').trim(),
      password: String(user.password || ''),
      enabled: user.enabled !== false,
      roleId,
      roleIds: roleId
        ? [roleId]
        : Array.isArray(user.roleIds) ? user.roleIds.slice(0, 1) : [],
    };
    const payload = await apiFetch('/api/admin/users', {
      method: 'POST',
      body,
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.error = '';
    state.admin.editingUserId = '';
    await refreshAdminConsole({ renderAfter: true });
    return payload?.user || null;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

async function saveAdminUserAccess(user) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const userId = String(user.id || '').trim();
  if (!userId) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  const roleId = String(user.roleId || '').trim();
  try {
    const body = {
      email: String(user.email || '').trim(),
      enabled: user.enabled !== false,
      roleId,
      roleIds: roleId ? [roleId] : [],
    };
    const payload = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body,
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.error = '';
    state.admin.editingUserId = '';
    await refreshAdminConsole({ renderAfter: true });
    return payload?.user || null;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

async function toggleAdminUserEnabled(userId, enabled) {
  const user = adminUserById(userId);
  if (!user) {
    return null;
  }
  return saveAdminUserAccess({
    id: user.id,
    email: String(user.email || '').trim(),
    enabled: enabled === true,
    roleId: adminUserRoleId(user),
  });
}

async function deleteAdminUser(userId) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  try {
    await apiFetch(`/api/admin/users/${encodeURIComponent(normalizedUserId)}`, {
      method: 'DELETE',
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    state.error = '';
    await refreshAdminConsole({ renderAfter: true });
    return true;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

function projectGrantsFromProjectIds(projectIds) {
  const uniqueIds = [...new Set((Array.isArray(projectIds) ? projectIds : [])
    .map((projectId) => String(projectId || '').trim())
    .filter(Boolean))];
  return uniqueIds.map((projectId) => ({
    projectId,
    canRead: true,
    canCreate: true,
    canWrite: true,
  }));
}

async function openAdminObservedSession(sessionId) {
  if (!sessionId || !isAdminPrincipal()) {
    return;
  }
  saveCurrentTimeline();
  stopStream();
  state.status = 'Loading session';
  state.statusTone = 'warn';
  state.admin.observedSessionLoading = true;
  state.error = '';
  const requestGeneration = authRequestGeneration;
  render();
  try {
    const payload = await apiFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}`);
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    const session = {
      ...(payload?.session || {}),
      mode: payload?.mode || payload?.session?.mode || 'observer',
      readOnly: true,
    };
    state.admin.observedSession = session;
    state.sessionId = session.id;
    state.currentSession = session;
    state.cwd = session.cwd || '';
    applySessionSettings(session);
    restoreTimelineForSession(session, { fullHistory: true });
    syncRuntimeStatusFromSession(session);
    state.chatReturnView = 'admin';
    state.view = isDesktopLayout() ? 'admin' : 'chat';
    state.admin.page = 'sessions';
    state.timelineShouldFollowLatest = false;
    state.status = 'Ready';
    state.statusTone = 'success';
    state.error = '';
    render();
    scrollTimelineToTop();
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    handleApiError(error);
  } finally {
    if (isAuthRequestCurrent(requestGeneration)) {
      state.admin.observedSessionLoading = false;
      render();
    }
  }
}

async function openSessionFileByPath(filePath, { preserveSnapshot = false } = {}) {
  const normalizedPath = decodeHtmlEntityText(filePath).trim();
  const resolvablePath = decodeSessionFilePath(stripSessionFileLocationSuffix(normalizedPath.replace(/[?#].*$/u, '')));
  if (!resolvablePath) {
    return;
  }
  if (isShareContext()) {
    if (!isLegacyReportPath(resolvablePath)) {
      return;
    }
    await openSharedReportById(reportFromPath(resolvablePath).id, { path: resolvablePath, preserveSnapshot });
    return;
  }
  if (!state.sessionId || state.draftSessionActive) {
    return;
  }

  const desktop = isDesktopLayout();
  if (!preserveSnapshot) {
    rememberFocusReturn(document.activeElement);
  }
  if (!preserveSnapshot || !sessionFileTimelineSnapshot) {
    sessionFileTimelineSnapshot = captureTimelineViewport();
  }
  const loadController = beginSessionFileLoad();
  clearSessionFileState({ preservePath: true });
  state.currentSessionFilePath = resolvablePath;
  state.currentSessionFile = sessionFilePlaceholder(resolvablePath);
  state.currentSessionFileLoading = true;
  state.settingsOpen = false;
  state.desktopSettingsOpen = false;
  state.error = '';
  if (desktop) {
    state.view = 'sessions';
    state.desktopOverlay = 'file';
  } else {
    state.view = 'file';
  }
  render();
  if (desktop) {
    restoreTimelineViewport(sessionFileTimelineSnapshot);
  }

  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/files/resolve`, {
      method: 'POST',
      body: { path: resolvablePath },
      signal: loadController.signal,
    });
    if (!isActiveSessionFileLoad(loadController)) {
      return;
    }
    const file = normalizeSessionFile(payload?.file, resolvablePath);
    if (!file?.contentUrl) {
      throw sessionFileProtocolError();
    }
    state.currentSessionFile = file;
    await loadResolvedSessionFile(file, loadController);
  } catch (error) {
    if (!isActiveSessionFileLoad(loadController)) {
      return;
    }
    state.currentSessionFileLoading = false;
    state.currentSessionFileError = sessionFileErrorCode(error);
    if (error?.status === 401) {
      handleApiError(error);
      return;
    }
    renderSessionFileWithScrollPreserved(() => {});
  } finally {
    releaseSessionFileLoad(loadController);
  }
}

async function loadResolvedSessionFile(file, loadController, { skipAuth = false } = {}) {
  const response = await fetchSessionFileContent(file.contentUrl, {
    signal: loadController.signal,
    skipAuth,
  });
  if (!isActiveSessionFileLoad(loadController)) {
    return;
  }
  if (file.kind === 'markdown' || file.kind === 'html') {
    const content = await response.text();
    if (!isActiveSessionFileLoad(loadController)) {
      return;
    }
    state.currentSessionFileContent = content;
    state.currentSessionFileBlob = createTextFileBlob(content, file.mimeType);
  } else {
    const blob = await response.blob();
    if (!isActiveSessionFileLoad(loadController)) {
      return;
    }
    state.currentSessionFileBlob = blob;
  }
  state.currentSessionFileObjectUrl = createSessionFileObjectUrl(state.currentSessionFileBlob);
  state.currentSessionFileLoading = false;
  state.currentSessionFileError = '';
  renderSessionFileWithScrollPreserved(() => {});
}

async function fetchSessionFileContent(contentUrl, { signal, skipAuth = false } = {}) {
  if (!isSafeSessionFileContentUrl(contentUrl)) {
    throw sessionFileProtocolError();
  }
  const response = await fetch(contentUrl, {
    headers: {
      Accept: '*/*',
      ...(skipAuth ? {} : state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    signal,
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return response;
}

async function openSharedReportById(reportId, { path = '', preserveSnapshot = false } = {}) {
  const token = shareTokenFromLocation();
  const report = state.reports.find((item) => item.id === reportId);
  if (!token || !report) {
    return;
  }
  if (!preserveSnapshot || !sessionFileTimelineSnapshot) {
    sessionFileTimelineSnapshot = captureTimelineViewport();
  }
  const loadController = beginSessionFileLoad();
  clearSessionFileState({ preservePath: true });
  state.view = 'file';
  state.currentSessionFilePath = path || report.id;
  state.currentSessionFile = normalizeSessionFile({
    id: report.id,
    name: report.title || fileNameFromPath(report.id),
    kind: report.kind === 'html' ? 'html' : 'markdown',
    mimeType: report.kind === 'html' ? 'text/html' : 'text/markdown',
    sizeBytes: report.sizeBytes,
  }, path || report.id);
  state.currentSessionFileLoading = true;
  state.error = '';
  render();
  try {
    const payload = await apiFetch(
      `/api/share/${encodeURIComponent(token)}/reports/${encodeURIComponent(reportId)}/content`,
      { skipAuth: true, signal: loadController.signal },
    );
    if (!isActiveSessionFileLoad(loadController)) {
      return;
    }
    const content = payload?.content || '';
    state.currentSessionFileContent = content;
    state.currentSessionFileBlob = createTextFileBlob(content, state.currentSessionFile?.mimeType);
    state.currentSessionFileObjectUrl = createSessionFileObjectUrl(state.currentSessionFileBlob);
    state.currentSessionFileLoading = false;
    state.currentSessionFileError = '';
    renderSessionFileWithScrollPreserved(() => {});
  } catch (error) {
    if (!isActiveSessionFileLoad(loadController)) {
      return;
    }
    state.currentSessionFileLoading = false;
    state.currentSessionFileError = sessionFileErrorCode(error);
    renderSessionFileWithScrollPreserved(() => {});
  } finally {
    releaseSessionFileLoad(loadController);
  }
}

function beginSessionFileLoad() {
  cancelSessionFileLoad();
  sessionFileLoadAbortController = new AbortController();
  return sessionFileLoadAbortController;
}

function isActiveSessionFileLoad(controller) {
  return sessionFileLoadAbortController === controller && !controller.signal.aborted;
}

function releaseSessionFileLoad(controller) {
  if (sessionFileLoadAbortController === controller) {
    sessionFileLoadAbortController = null;
  }
}

function cancelSessionFileLoad() {
  if (!sessionFileLoadAbortController) {
    return;
  }
  sessionFileLoadAbortController.abort();
  sessionFileLoadAbortController = null;
}

function clearSessionFileState({ preservePath = false } = {}) {
  revokeSessionFileObjectUrl();
  state.currentSessionFile = null;
  if (!preservePath) {
    state.currentSessionFilePath = '';
  }
  state.currentSessionFileContent = '';
  state.currentSessionFileBlob = null;
  state.currentSessionFileLoading = false;
  state.currentSessionFileError = '';
}

function closeSessionFileViewer() {
  requestFocusRestore();
  cancelSessionFileLoad();
  clearSessionFileState();
  const snapshot = sessionFileTimelineSnapshot;
  sessionFileTimelineSnapshot = null;
  if (isDesktopLayout()) {
    state.view = 'sessions';
    state.desktopOverlay = null;
    render();
    restoreTimelineViewport(snapshot);
    return;
  }
  state.view = state.sessionId ? 'chat' : 'sessions';
  state.error = '';
  render();
  if (state.view === 'chat') {
    restoreTimelineViewport(snapshot);
  }
}

async function setSessionSortMode(mode) {
  const previousScope = currentSessionScope();
  const nextMode = normalizeSortMode(mode);
  state.sortMode = nextMode;
  const scope = currentSessionScope();
  if (scope !== previousScope) {
    state.sessionsError = '';
  }
  const cached = state.sessionsByScope[scope] || [];
  const isLoaded = state.sessionsLoadedByScope[scope] === true;
  state.sessions = isLoaded ? [...cached] : [];
  state.sessionsScope = scope;
  if (nextMode === 'time' && !isLoaded) {
    await refreshSessionsList({ renderAfter: true, scope: 'all' });
    return;
  }
  if (nextMode === 'favorites' && !isLoaded) {
    await refreshSessionsList({ renderAfter: true, scope: 'favorites' });
    return;
  }
  if (nextMode === 'archived' && !isLoaded) {
    await refreshSessionsList({ renderAfter: true, scope: 'archived' });
    return;
  }
  render();
}

function preloadAllSessionsInBackground() {
  if (!state.token || state.sessionsLoadedByScope.all === true || allSessionsPreloadPromise) {
    return allSessionsPreloadPromise;
  }
  const preloadPromise = refreshSessionsList({ renderAfter: false, scope: 'all', background: true })
    .catch((error) => {
      console.warn('[codex-web] all sessions preload failed', error);
      return null;
    })
    .finally(() => {
      if (allSessionsPreloadPromise === preloadPromise) {
        allSessionsPreloadPromise = null;
      }
    });
  allSessionsPreloadPromise = preloadPromise;
  return preloadPromise;
}

async function refreshCurrentView() {
  if (isShareContext()) {
    return;
  }
  if (!state.token) {
    return;
  }
  const requestGeneration = authRequestGeneration;
  const wasPending = state.pendingTurn;
  if (!wasPending) {
    state.status = 'Refreshing';
    state.statusTone = 'warn';
    render();
  }
  try {
    if (state.view === 'chat' && state.sessionId) {
      await refreshCurrentSessionMetadata({ hydrateTimeline: true });
      if (!isAuthRequestCurrent(requestGeneration)) {
        return;
      }
      if (state.pendingTurn && state.turnId && !isTurnStreamHealthy()) {
        connectActiveTurnStream({ forceReconnect: true });
      }
    } else {
      rememberSessionListScroll();
      await refreshSessionsList({
        renderAfter: false,
        scope: state.sortMode === 'favorites' ? 'favorites' : 'all',
      });
      if (!isAuthRequestCurrent(requestGeneration)) {
        return;
      }
      render();
    }
    if (!state.pendingTurn && !isRuntimeStatusLabel(state.status)) {
      state.status = 'Ready';
      state.statusTone = 'success';
      render();
    }
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    handleApiError(error);
  }
}

async function handleComposerRefresh() {
  if (!state.sessionId) {
    return;
  }
  passiveDesktopSessionId = '';
  const requestGeneration = authRequestGeneration;
  const wasPending = state.pendingTurn;
  if (!wasPending) {
    state.status = 'Refreshing';
    state.statusTone = 'warn';
    render();
  }
  state.timelineShouldFollowLatest = true;
  try {
    await refreshCurrentSessionMetadata({
      hydrateTimeline: true,
      viewportSnapshot: {
        bottomOffset: 0,
        shouldFollowLatest: true,
        hadPromptFocus: document.activeElement === document.querySelector('#prompt-input'),
      },
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    if (state.pendingTurn && state.turnId && !isTurnStreamHealthy()) {
      connectActiveTurnStream({ forceReconnect: true });
    }
    if (!state.pendingTurn && !isRuntimeStatusLabel(state.status)) {
      state.status = 'Ready';
      state.statusTone = 'success';
      render();
    }
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return;
    }
    handleApiError(error);
  }
}

function hydrateCurrentTimelineFromSession(session, { forceAuthoritative = false } = {}) {
  const fullHistory = fullHydratedTimelineFromSession(session);
  const hydrated = selectVisibleHydratedTimelineItems(fullHistory);
  if (!fullHistory.length) {
    return false;
  }
  syncTerminalTurnIdsFromSession(session);
  const previousStart = state.sessionHistoryItems.length && !isPreviewOnlySessionHistory()
    ? Math.min(state.sessionHistoryStartIndex, fullHistory.length)
    : visibleHydratedStartIndex(fullHistory);
  setSessionHistoryWindow(fullHistory, previousStart);
  if (!hydrated.length) {
    return false;
  }
  const currentText = timelineMessageSignature(state.timeline);
  const visibleHydrated = currentVisibleHydratedTimelineItems(fullHistory);
  const hydratedText = timelineMessageSignature(visibleHydrated);
  const currentDisplay = timelineMessageDisplaySignature(state.timeline);
  const hydratedDisplay = timelineMessageDisplaySignature(visibleHydrated);
  const sameMessageText = hydratedText === currentText;
  const sameMessageDisplay = sameMessageText && hydratedDisplay === currentDisplay;
  const activeTurn = findActiveTurn(session);
  const hasLiveAssistantEntry = state.timeline.some((item) => (
    item?.kind === 'message'
    && item.role === 'assistant'
    && timelineTurnId(item) === state.turnId
    && (item.source === 'stream' || String(item.id || '').startsWith(`assistant_${state.turnId || ''}`))
  ));
  const currentStreamOwnsTimeline = Boolean(
    state.pendingTurn
    && state.turnId
    && activeTurn?.id === state.turnId
    && hasLiveAssistantEntry
  );
  if (currentStreamOwnsTimeline && !forceAuthoritative) {
    return false;
  }
  if (!hydratedText || sameMessageDisplay) {
    return false;
  }
  const unmatchedPendingMessages = pendingTimelineMessagesMissingFromHistory(fullHistory, state.timeline);
  const historyWithPending = [
    ...fullHistory,
    ...unmatchedPendingMessages.map((item) => ({ ...item })),
  ];
  if (unmatchedPendingMessages.length) {
    setSessionHistoryWindow(historyWithPending, Math.min(previousStart, fullHistory.length));
  }
  const authoritative = [
    ...visibleHydrated.map((item) => ({ ...item })),
    ...unmatchedPendingMessages.map((item) => ({ ...item })),
  ];
  state.timeline = dedupeTimelineProjectionEntries(
    mergeAuthoritativeTimelineAuxiliaryEntries(authoritative, state.timeline),
  );
  saveCurrentTimeline();
  return true;
}

function syncTerminalTurnIdsFromSession(session) {
  for (const turn of sessionTurns(session)) {
    const turnId = String(turn?.id || '').trim();
    if (!turnId) {
      continue;
    }
    if (isTerminalTurnStatus(turn.status)) {
      state.terminalTurnIds.add(turnId);
    } else if (isActiveTurnStatus(turn.status)) {
      state.terminalTurnIds.delete(turnId);
    }
  }
}

function mergeAuthoritativeTimelineAuxiliaryEntries(authoritative, current) {
  const messages = (Array.isArray(authoritative) ? authoritative : [])
    .filter((item) => item?.kind !== 'work')
    .map((item) => ({ ...item }));
  const currentItems = Array.isArray(current) ? current : [];
  const authoritativeIdentities = new Set(messages.flatMap(timelineMergeIdentities));
  const auxiliary = currentItems.filter((item) => (
    item?.kind === 'approval'
    || isPersistentTimelineFailure(item)
  ) && !timelineMergeIdentities(item).some((identity) => authoritativeIdentities.has(identity)));
  if (!auxiliary.length || !messages.length) {
    return [...messages, ...auxiliary.map((item) => ({ ...item }))];
  }
  const messageIndexes = new Map();
  messages.forEach((item, index) => {
    const identity = timelineProjectionIdentity(item);
    const indexes = messageIndexes.get(identity) || [];
    indexes.push(index);
    messageIndexes.set(identity, indexes);
  });
  const buckets = new Map();
  for (const item of auxiliary) {
    const currentIndex = currentItems.indexOf(item);
    let anchorIndex = -1;
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      if (currentItems[index]?.kind !== 'message') {
        continue;
      }
      const matches = messageIndexes.get(timelineProjectionIdentity(currentItems[index])) || [];
      if (matches.length) {
        anchorIndex = matches.at(-1);
        break;
      }
    }
    const bucket = buckets.get(anchorIndex) || [];
    bucket.push({ ...item });
    buckets.set(anchorIndex, bucket);
  }
  const merged = [...(buckets.get(-1) || [])];
  messages.forEach((item, index) => {
    merged.push(item, ...(buckets.get(index) || []));
  });
  return merged;
}

function timelineMergeIdentities(item) {
  if (!item || typeof item !== 'object') {
    return [];
  }
  const id = String(item.id || '').trim();
  const projection = timelineProjectionIdentity(item);
  return [
    ...(id ? [`id:${id}`] : []),
    ...(projection ? [`projection:${projection}`] : []),
  ];
}

function isPersistentTimelineFailure(item) {
  return item?.kind === 'message'
    && item.role === 'system'
    && item.severity === 'error'
    && item.meta === 'failed'
    && !isTurnInterruptTimeoutMessage(item.text);
}

function isPreviewOnlySessionHistory() {
  return state.sessionHistoryItems.length === 1
    && state.sessionHistoryItems[0]?.kind === 'message'
    && state.sessionHistoryItems[0]?.meta === 'preview';
}

function timelineMessageSignature(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.kind === 'message')
    .map((item) => `${item.role}:${item.text || ''}`)
    .join('\n');
}

function timelineMessageDisplaySignature(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.kind === 'message')
    .map((item) => {
      const attachments = normalizeTimelineAttachments(item.attachments)
        .map((attachment) => [
          attachment.kind || '',
          attachment.localPath || '',
          attachment.fileName || '',
          attachment.mimeType || '',
          typeof attachment.sizeBytes === 'number' ? attachment.sizeBytes : '',
        ].join(':'))
        .join('|');
      return [
        item.role || '',
        item.text || '',
        item.meta || '',
        item.severity || '',
        attachments,
      ].join('\u0000');
    })
    .join('\n');
}

function pendingTimelineMessagesMissingFromHistory(historyItems, timelineItems) {
  const historyMessages = (Array.isArray(historyItems) ? historyItems : [])
    .filter((item) => item?.kind === 'message');
  const localMessages = (Array.isArray(timelineItems) ? timelineItems : [])
    .filter((item) => item?.kind === 'message');
  return localMessages.filter((item, index) => {
    if (item?.meta !== 'pending') {
      return false;
    }
    const identity = timelineMessageIdentity(item);
    const priorOccurrences = localMessages
      .slice(0, index)
      .filter((candidate) => timelineMessageIdentity(candidate) === identity)
      .length;
    const historyOccurrences = historyMessages
      .filter((candidate) => timelineMessageIdentity(candidate) === identity)
      .length;
    return historyOccurrences <= priorOccurrences;
  });
}

function timelineMessageIdentity(item) {
  const attachments = normalizeTimelineAttachments(item?.attachments)
    .map((attachment) => [
      attachment.kind || '',
      attachment.fileName || '',
      attachment.mimeType || '',
    ].join(':'))
    .join('|');
  return [item?.role || '', item?.text || '', attachments].join('\u0000');
}

function syncRuntimeStatusFromSession(session, { source = 'detail' } = {}) {
  const turns = sessionTurns(session);
  const activeTurn = findActiveTurn(session);
  if (!activeTurn?.id) {
    if (shouldPreserveLocallyStartedTurn(session, { source, turns }) || shouldPreserveHealthyActiveStream(session, { source })) {
      return setRuntimeStatus('Turn running', 'warn', {
        activeTurnId: state.turnId,
        terminalTurnId: null,
      });
    }
    const timelineFailure = latestTimelineTerminalFailure(session);
    if (timelineFailure) {
      clearRuntimeTurnState();
      return setRuntimeStatus('Turn failed', 'danger', {
        activeTurnId: null,
        terminalTurnId: timelineFailure.turnId,
        errorMessage: timelineFailure.message,
      });
    }
    const latestTurn = latestRuntimeTurn(turns);
    if (!latestTurn) {
      if (source === 'detail') {
        clearRuntimeTurnState();
        return setRuntimeStatus('Ready', 'success', { activeTurnId: null, terminalTurnId: null });
      }
      return { changed: false, activeTurnId: null, terminalTurnId: null };
    }
    const normalizedStatus = normalizeTurnStatus(latestTurn.status);
    if (isSuccessTurnStatus(normalizedStatus)) {
      clearRuntimeTurnState();
      return setRuntimeStatus('Ready', 'success', { activeTurnId: null, terminalTurnId: latestTurn.id || null });
    }
    if (isFailureTurnStatus(normalizedStatus)) {
      clearRuntimeTurnState();
      if (runtimeTurnHasInterruptTimeout(latestTurn)) {
        return setRuntimeStatus('Ready', 'success', { activeTurnId: null, terminalTurnId: latestTurn.id || null });
      }
      const message = surfaceRuntimeTurnErrorFromSession(session, latestTurn);
      return setRuntimeStatus('Turn failed', 'danger', { activeTurnId: null, terminalTurnId: latestTurn.id || null, errorMessage: message });
    }
    if (isInterruptedTurnStatus(normalizedStatus)) {
      clearRuntimeTurnState();
      return setRuntimeStatus('Turn stopped', 'warn', { activeTurnId: null, terminalTurnId: latestTurn.id || null });
    }
    clearRuntimeTurnState();
    return setRuntimeStatus('Ready', 'success', { activeTurnId: null, terminalTurnId: latestTurn.id || null });
  }
  clearLocallyStartedTurn();
  state.pendingTurn = true;
  state.turnId = activeTurn.id;
  state.streamWasBackgrounded = true;
  state.lastTurnEventAt = 0;
  return setRuntimeStatus('Turn running', 'warn', { activeTurnId: activeTurn.id, terminalTurnId: null });
}

function clearRuntimeTurnState() {
  if (state.pendingTurn || state.turnId) {
    stopStream();
  }
  clearLocallyStartedTurn();
  state.pendingTurn = false;
  state.turnId = null;
  state.streamWasBackgrounded = false;
  state.lastTurnEventAt = 0;
}

function markLocallyStartedTurn(turnId) {
  const normalizedTurnId = String(turnId || '').trim();
  state.locallyStartedTurnId = normalizedTurnId || null;
  state.locallyStartedTurnAt = normalizedTurnId ? Date.now() : 0;
}

function clearLocallyStartedTurn() {
  state.locallyStartedTurnId = null;
  state.locallyStartedTurnAt = 0;
}

function isLocallyStartedTurnInSyncGrace(turnId) {
  const localTurnId = String(state.locallyStartedTurnId || '').trim();
  if (!localTurnId || localTurnId !== String(turnId || '').trim() || !state.locallyStartedTurnAt) {
    return false;
  }
  return Date.now() - state.locallyStartedTurnAt <= LOCAL_TURN_SYNC_GRACE_MS;
}

function shouldPreserveLocallyStartedTurn(session, { source = 'detail', turns = sessionTurns(session) } = {}) {
  if (source !== 'detail') {
    return false;
  }
  const localTurnId = String(state.locallyStartedTurnId || '').trim();
  if (!localTurnId || state.turnId !== localTurnId || !state.pendingTurn) {
    return false;
  }
  if (String(session?.activeTurnId || '').trim()) {
    return false;
  }
  if (!isLocallyStartedTurnInSyncGrace(localTurnId)) {
    return false;
  }
  const matchingTurn = (Array.isArray(turns) ? turns : []).find((turn) => turn?.id === localTurnId) || null;
  if (matchingTurn && isTerminalTurnStatus(matchingTurn.status)) {
    return false;
  }
  return true;
}

function shouldPreserveHealthyActiveStream(session, { source = 'detail' } = {}) {
  if (source !== 'detail') {
    return false;
  }
  if (!state.pendingTurn || !state.turnId || !isTurnStreamHealthy()) {
    return false;
  }
  if (String(session?.id || '') !== String(state.sessionId || '')) {
    return false;
  }
  if (String(session?.activeTurnId || '').trim()) {
    return false;
  }
  return true;
}

function setRuntimeStatus(status, tone, result) {
  const previousStatus = state.status;
  const previousTone = state.statusTone;
  const canReplace = isRuntimeStatusLabel(previousStatus) || NON_RUNTIME_STATUS_LABELS.has(previousStatus);
  if (canReplace) {
    state.status = status;
    state.statusTone = tone;
  }
  return {
    changed: previousStatus !== state.status || previousTone !== state.statusTone || Boolean(result.activeTurnId || result.terminalTurnId),
    ...result,
  };
}

function isRuntimeStatusLabel(status) {
  const value = String(status || '');
  return value === 'Ready'
    || value === 'Turn running'
    || value === 'Stream paused'
    || value === 'Turn failed'
    || value === 'Turn interrupted'
    || value === 'Turn stopped'
    || /^Turn /u.test(value);
}

function runtimeStatusForTurnStatus(status) {
  if (isSuccessTurnStatus(status)) {
    return { status: 'Ready', tone: 'success' };
  }
  if (isFailureTurnStatus(status)) {
    return { status: 'Turn failed', tone: 'danger' };
  }
  if (isInterruptedTurnStatus(status)) {
    return { status: 'Turn stopped', tone: 'warn' };
  }
  return { status: `Turn ${status || 'completed'}`, tone: 'warn' };
}

function surfaceRuntimeTurnErrorFromSession(session, turn) {
  const message = runtimeTurnErrorMessage(turn);
  if (state.view === 'chat' && state.sessionId === session?.id) {
    surfaceTimelineError(turn?.id || `session_${session?.id || 'unknown'}_failed`, message);
    saveCurrentTimeline();
  }
  return message;
}

function runtimeTurnErrorMessage(turn) {
  const message = normalizeRuntimeErrorText(turn?.details)
    || normalizeRuntimeErrorText(turn?.error)
    || normalizeRuntimeErrorText(turn?.message)
    || runtimeTurnItemErrorMessage(turn)
    || 'Turn failed';
  return publicRuntimeTurnFailureMessage(message);
}

function latestTimelineTerminalFailure(session) {
  const local = state.sessionId && state.sessionId === session?.id
    ? normalizeSessionTimeline(state.timeline)
    : [];
  const items = local.length ? local : normalizeSessionTimeline(session?.timeline);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== 'message') {
      continue;
    }
    if (item.role === 'user') {
      return null;
    }
    if (item.role === 'assistant' && isFinalAssistantTimelineItem(item)) {
      return null;
    }
    if (item.role !== 'system' || item.severity !== 'error' || item.meta !== 'failed') {
      continue;
    }
    if (isTurnInterruptTimeoutMessage(item.text)) {
      continue;
    }
    const id = String(item.id || '');
    return {
      turnId: id.startsWith('error_') ? id.slice('error_'.length) || null : null,
      message: publicRuntimeTurnFailureMessage(item.text),
    };
  }
  return null;
}

function isFinalAssistantTimelineItem(item) {
  const meta = String(item?.meta || '').trim().toLowerCase();
  const phase = String(item?.phase || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
  return meta === 'final' || meta === 'final_answer' || phase === 'final' || phase === 'final_answer';
}

function publicRuntimeTurnFailureMessage(value) {
  const message = normalizeRuntimeErrorText(value) || 'Turn failed';
  return /\brequest\s+(?:timed\s*out|timeout)\b|\btimed\s*out\s+waiting\s+for\s+codex\s+turn\b/iu.test(message)
    ? 'Turn failed'
    : message;
}

function runtimeTurnHasInterruptTimeout(turn) {
  return [turn?.details, turn?.error, turn?.message]
    .some(isTurnInterruptTimeoutMessage)
    || (Array.isArray(turn?.items) ? turn.items : []).some((item) => (
      [item?.details, item?.error, item?.message, item?.text, item?.result,
        item?.raw?.details, item?.raw?.error, item?.raw?.message]
        .some(isTurnInterruptTimeoutMessage)
    ));
}

function isTurnInterruptTimeoutMessage(value) {
  const message = normalizeRuntimeErrorText(value);
  return /timed out waiting for Codex JSON-RPC response to turn\/interrupt/iu.test(message);
}

function runtimeTurnItemErrorMessage(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const marker = [
      item?.type,
      item?.phase,
      item?.status,
      item?.severity,
      item?.raw?.type,
      item?.raw?.status,
    ].map((value) => String(value || '').toLowerCase()).join(' ');
    const hasErrorMarker = /error|fail|denied|unauthorized|forbidden|rate[_\s-]*limit/u.test(marker);
    const candidate = normalizeRuntimeErrorText(item?.details)
      || normalizeRuntimeErrorText(item?.error)
      || normalizeRuntimeErrorText(item?.message)
      || normalizeRuntimeErrorText(item?.result)
      || normalizeRuntimeErrorText(item?.raw?.details)
      || normalizeRuntimeErrorText(item?.raw?.message)
      || normalizeRuntimeErrorText(item?.raw?.error);
    if (candidate && (hasErrorMarker || /unexpected status|unauthorized|forbidden|too many requests|rate limit|error|failed|failure|401|403|429/u.test(candidate.toLowerCase()))) {
      return candidate;
    }
    const text = normalizeRuntimeErrorText(item?.text);
    if (text && hasErrorMarker) {
      return text;
    }
  }
  return null;
}

function normalizeRuntimeErrorText(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value;
  return normalizeRuntimeErrorText(record.details)
    || normalizeRuntimeErrorText(record.rawMessage)
    || normalizeRuntimeErrorText(record.errorMessage)
    || normalizeRuntimeErrorText(record.message)
    || normalizeRuntimeErrorText(record.error)
    || normalizeRuntimeErrorText(record.stderr)
    || normalizeRuntimeErrorText(record.stack)
    || null;
}

function sessionTurns(session) {
  return Array.isArray(session?.thread?.turns) ? session.thread.turns : [];
}

function latestRuntimeTurn(turns) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.id || turn?.status) {
      return turn;
    }
  }
  return null;
}

function findActiveTurn(session) {
  const activeTurnId = String(session?.activeTurnId || '').trim();
  const turns = sessionTurns(session);
  if (!activeTurnId) {
    return null;
  }
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.id === activeTurnId) {
      return isActiveTurnStatus(turn.status) ? turn : null;
    }
  }
  return { id: activeTurnId, status: 'in_progress' };
}

function isActiveTurnStatus(status) {
  const value = normalizeTurnStatus(status);
  if (!value) {
    return false;
  }
  return !isTerminalTurnStatus(value);
}

function isTerminalTurnStatus(status) {
  return isSuccessTurnStatus(status) || isFailureTurnStatus(status) || isInterruptedTurnStatus(status);
}

function isSuccessTurnStatus(status) {
  return ['completed', 'complete', 'succeeded', 'success', 'finished'].includes(normalizeTurnStatus(status));
}

function isFailureTurnStatus(status) {
  return ['failed', 'error', 'timedout', 'timeout'].includes(normalizeTurnStatus(status));
}

function isInterruptedTurnStatus(status) {
  return ['cancelled', 'canceled', 'interrupted', 'aborted'].includes(normalizeTurnStatus(status));
}

function normalizeTurnStatus(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function removeSession(sessionId) {
  if (!sessionId) {
    return;
  }
  state.sessions = state.sessions.filter((session) => session.id !== sessionId);
  for (const scope of Object.keys(state.sessionsByScope)) {
    state.sessionsByScope[scope] = (state.sessionsByScope[scope] || []).filter((session) => session.id !== sessionId);
  }
  if (state.currentSession?.id === sessionId) {
    state.currentSession = null;
  }
  persistSessionsCache();
}

function optimisticallyUpdateSessionInput(text) {
  const input = String(text || '').trim();
  if (!state.sessionId || !input) {
    return;
  }
  const previous = state.sessions.find((session) => session.id === state.sessionId)
    || state.currentSession
    || { id: state.sessionId, cwd: state.cwd };
  const now = Date.now();
  upsertSession({
    ...previous,
    cwd: previous.cwd || state.cwd,
    projectName: previous.projectName || projectNameFromCwd(previous.cwd || state.cwd),
    preview: previous.preview || input,
    firstUserInput: previous.firstUserInput || input,
    lastUserInput: input,
    lastInputAt: now,
    updatedAt: Math.max(previous.updatedAt || 0, now),
  });
}

function normalizeSessions(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .filter((session) => session && typeof session.id === 'string' && session.id)
    .map((session) => {
      const normalized = {
        ...session,
        cwd: typeof session.cwd === 'string' ? session.cwd : '',
        projectName: typeof session.projectName === 'string' ? cwdLeafName(session.projectName) : '',
        title: typeof session.title === 'string' ? session.title : '',
        preview: typeof session.preview === 'string' ? session.preview : '',
        firstUserInput: typeof session.firstUserInput === 'string' ? session.firstUserInput : '',
        lastUserInput: typeof session.lastUserInput === 'string' ? session.lastUserInput : '',
        lastInputAt: typeof session.lastInputAt === 'number' ? session.lastInputAt : null,
        updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : null,
        activityState: session.activityState === 'running' || session.activityState === 'waiting_approval'
          ? session.activityState
          : null,
        settings: session.settings && typeof session.settings === 'object' ? session.settings : null,
      };
      delete normalized.thread;
      delete normalized.timeline;
      if (typeof session.projectId === 'string') {
        normalized.projectId = session.projectId;
      }
      if (typeof session.projectDisplayName === 'string') {
        normalized.projectDisplayName = cwdLeafName(session.projectDisplayName);
      }
      if (typeof session.ownerUserId === 'string') {
        normalized.ownerUserId = session.ownerUserId;
      }
      if (typeof session.mode === 'string') {
        normalized.mode = session.mode;
      }
      if (session.readOnly === true) {
        normalized.readOnly = true;
      }
      if (session.archived === true) {
        normalized.archived = true;
      }
      if (typeof session.archivedAt === 'string') {
        normalized.archivedAt = session.archivedAt;
      }
      if (typeof session.archivedByUserId === 'string') {
        normalized.archivedByUserId = session.archivedByUserId;
      }
      if (typeof session.archiveSource === 'string') {
        normalized.archiveSource = session.archiveSource;
      }
      if (Object.prototype.hasOwnProperty.call(session, 'goal')) {
        normalized.goal = session.goal && typeof session.goal === 'object' ? session.goal : null;
      }
      return normalized;
    });
}

function normalizeSessionsForScope(payload, scope) {
  const sessions = normalizeSessions(payload)
    .map((session) => scope === 'archived'
      ? { ...session, archived: true, readOnly: true }
      : session)
    .map(applySessionArchiveOverride);
  return sessions.filter((session) => sessionBelongsToScope(session, scope));
}

function restoreSessionsFromCacheForScope(scope) {
  const normalizedScope = normalizeSessionScope(scope);
  if (state.sessionsByScope[normalizedScope]?.length) {
    return;
  }
  const cachedScopes = loadSessionsCacheScopes();
  const cached = cachedScopes[normalizedScope] || [];
  if (!cached.length) {
    return;
  }
  state.sessionsByScope[normalizedScope] = cached;
  if (normalizedScope === currentSessionScope()) {
    state.sessions = [...cached];
  }
}

function loadSessionsCacheScopes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSIONS_CACHE_KEY) || '{"scopes":{}}');
    const scopes = parsed && typeof parsed === 'object' && parsed.scopes && typeof parsed.scopes === 'object'
      ? parsed.scopes
      : {};
    return {
      all: normalizeSessionsForScope({ items: scopes.all }, 'all'),
      favorites: normalizeSessionsForScope({ items: scopes.favorites }, 'favorites'),
      archived: normalizeSessionsForScope({ items: scopes.archived }, 'archived'),
    };
  } catch (_error) {
    localStorage.removeItem(SESSIONS_CACHE_KEY);
    return {
      all: [],
      favorites: [],
      archived: [],
    };
  }
}

function persistSessionsCache() {
  const scopes = {
    all: (state.sessionsByScope.all || []).filter((session) => sessionBelongsToScope(session, 'all')).map(serializeSessionSummaryForCache).filter(Boolean),
    favorites: (state.sessionsByScope.favorites || []).filter((session) => sessionBelongsToScope(session, 'favorites')).map(serializeSessionSummaryForCache).filter(Boolean),
    archived: (state.sessionsByScope.archived || []).filter((session) => sessionBelongsToScope(session, 'archived')).map(serializeSessionSummaryForCache).filter(Boolean),
  };
  try {
    localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify({ scopes, savedAt: Date.now() }));
  } catch (error) {
    console.warn('[codex-web] sessions cache persist failed', error);
  }
}

function serializeSessionSummaryForCache(session) {
  const [normalized] = normalizeSessions({ items: [session] });
  if (!normalized) {
    return null;
  }
  const summary = {
    id: normalized.id,
    cwd: normalized.cwd,
    projectName: normalized.projectName,
    title: normalized.title,
    preview: normalized.preview,
    firstUserInput: normalized.firstUserInput,
    lastUserInput: normalized.lastUserInput,
    lastInputAt: normalized.lastInputAt,
    updatedAt: normalized.updatedAt,
    settings: normalized.settings,
  };
  for (const key of ['projectId', 'projectDisplayName', 'ownerUserId', 'mode', 'archivedAt', 'archivedByUserId', 'archiveSource']) {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) {
      summary[key] = normalized[key];
    }
  }
  if (normalized.readOnly === true) {
    summary.readOnly = true;
  }
  if (normalized.archived === true) {
    summary.archived = true;
  }
  if (typeof normalized.activeTurnId === 'string' && normalized.activeTurnId.trim()) {
    summary.activeTurnId = normalized.activeTurnId.trim();
  }
  if (normalized.activityState === 'running' || normalized.activityState === 'waiting_approval') {
    summary.activityState = normalized.activityState;
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'goal')) {
    summary.goal = normalized.goal;
  }
  return summary;
}

function normalizeProjects(payload) {
  return (Array.isArray(payload?.items) ? payload.items : [])
    .map((project) => {
      const id = typeof project?.id === 'string' ? project.id.trim() : '';
      const cwd = typeof project?.cwd === 'string' ? project.cwd.trim() : '';
      const displayName = typeof project?.displayName === 'string' && project.displayName.trim()
        ? cwdLeafName(project.displayName.trim())
        : cwdLeafName(cwd) || id;
      if (!id || !displayName) {
        return null;
      }
      return {
        ...project,
        id,
        displayName,
        favorite: project?.favorite === true,
      };
    })
    .filter(Boolean);
}

function normalizeAdminItems(payload) {
  return Array.isArray(payload?.items) ? payload.items.filter((item) => item && typeof item === 'object') : [];
}

function syncCurrentSessionFromList() {
  if (!state.sessionId) {
    return;
  }
  const session = state.sessions.find((item) => item.id === state.sessionId);
  if (!session) {
    state.sessionId = null;
    state.currentSession = null;
    state.draftSessionActive = false;
    return;
  }
  syncProjectWorkDetailsCapability(session);
  state.currentSession = state.currentSession?.id === session.id
    ? mergeSessionSummary(state.currentSession, session)
    : session;
  state.cwd = session.cwd || '';
  enforceCurrentWorkDetailsAccess();
}

function syncCurrentWorkDetailsAccessFromSessions(sessions) {
  if (!state.sessionId || !state.currentSession) {
    return;
  }
  const session = (Array.isArray(sessions) ? sessions : []).find((item) => item?.id === state.sessionId);
  if (!session || typeof session.canViewWorkDetails !== 'boolean') {
    return;
  }
  syncProjectWorkDetailsCapability(session);
  state.currentSession = {
    ...state.currentSession,
    projectId: session.projectId || state.currentSession.projectId,
    canViewWorkDetails: session.canViewWorkDetails,
  };
  enforceCurrentWorkDetailsAccess();
}

function upsertSession(session) {
  if (!session?.id) {
    return;
  }
  const [normalizedSession] = normalizeSessions({ items: [session] });
  const normalized = applySessionArchiveOverride(normalizedSession);
  if (!normalized) {
    return;
  }
  syncProjectWorkDetailsCapability(normalized);
  const currentDetail = state.currentSession?.id === session.id ? state.currentSession : null;
  const index = state.sessions.findIndex((item) => item.id === normalized.id);
  const previous = index >= 0 ? state.sessions[index] : currentDetail;
  const next = applySessionArchiveOverride(sessionSummaryOnly(mergeSessionSummary(previous, normalized)));
  const currentScope = currentSessionScope();
  if (sessionBelongsToScope(next, currentScope)) {
    if (index >= 0) {
      state.sessions[index] = next;
    } else {
      state.sessions.unshift(next);
    }
  } else if (index >= 0) {
    state.sessions.splice(index, 1);
  }
  for (const scope of ['all', 'favorites', 'archived']) {
    if (sessionBelongsToScope(next, scope)) {
      upsertSessionInScope(scope, next);
    } else {
      removeSessionFromScope(scope, next.id);
    }
  }
  if (state.sessionId === next.id) {
    state.currentSession = applySessionArchiveOverride(mergeSessionSummary(currentDetail, session));
    enforceCurrentWorkDetailsAccess();
  } else if (!canViewWorkDetailsForSession(normalized) && sanitizeCachedWorkDetailsForSession(normalized.id, normalized)) {
    persistTimelineCache();
  }
  persistSessionsCache();
}

function applySessionArchiveOverride(session) {
  if (!session?.id || !state.sessionArchiveOverrides.has(session.id)) {
    return session;
  }
  if (state.sessionArchiveOverrides.get(session.id) === true) {
    return { ...session, archived: true, readOnly: true };
  }
  return { ...session, archived: false };
}

function isSessionArchived(session) {
  if (session?.id && state.sessionArchiveOverrides.has(session.id)) {
    return state.sessionArchiveOverrides.get(session.id) === true;
  }
  return session?.archived === true;
}

function sessionBelongsToScope(session, scope) {
  const archived = isSessionArchived(session);
  if (scope === 'archived') {
    return archived;
  }
  if (archived) {
    return false;
  }
  return scope !== 'favorites' || isFavoriteSession(session);
}

function currentSessionScope() {
  if (state.sortMode === 'favorites') {
    return 'favorites';
  }
  if (state.sortMode === 'archived') {
    return 'archived';
  }
  return 'all';
}

function isCurrentSessionScopeLoading() {
  return state.sessionsLoading === true && state.sessionsLoadingScope === currentSessionScope();
}

function upsertSessionInScope(scope, session) {
  const list = state.sessionsByScope[scope] || [];
  const index = list.findIndex((item) => item.id === session.id);
  const next = sessionSummaryOnly(mergeSessionSummary(index >= 0 ? list[index] : null, session));
  if (index >= 0) {
    list[index] = next;
  } else {
    list.unshift(next);
  }
  state.sessionsByScope[scope] = list;
}

function removeSessionFromScope(scope, sessionId) {
  state.sessionsByScope[scope] = (state.sessionsByScope[scope] || []).filter((session) => session.id !== sessionId);
}

function mergeSessionSummary(previous, next) {
  if (!previous) {
    return next;
  }
  const previousUpdatedAt = previous.updatedAt || 0;
  const nextUpdatedAt = next.updatedAt || 0;
  const previousInputAt = previous.lastInputAt || previousUpdatedAt;
  const nextInputAt = next.lastInputAt || nextUpdatedAt;
  const latestInput = nextInputAt >= previousInputAt ? next : previous;
  const olderInput = latestInput === next ? previous : next;
  return {
    ...previous,
    ...next,
    cwd: next.cwd || previous.cwd,
    projectName: next.projectName || previous.projectName,
    title: next.title || previous.title,
    preview: next.preview || previous.preview,
    firstUserInput: next.firstUserInput || previous.firstUserInput,
    lastUserInput: latestInput.lastUserInput || olderInput.lastUserInput,
    lastInputAt: Math.max(previousInputAt, nextInputAt) || null,
    updatedAt: Math.max(previousUpdatedAt, nextUpdatedAt) || null,
  };
}

function sessionSummaryOnly(session) {
  const summary = { ...(session || {}) };
  delete summary.thread;
  delete summary.timeline;
  return summary;
}

function saveCurrentTimeline() {
  clearScheduledTimelineSave();
  if (!state.sessionId) {
    return;
  }
  if (state.workDetailsPolicyPendingSessionId === state.sessionId) {
    return;
  }
  const timeline = cloneTimelineEntries(state.timeline);
  const previous = state.timelineCache.get(state.sessionId);
  const streamCursor = streamCursorForCache(previous?.streamCursor);
  if (!timeline.length && !state.batches.size && !state.approvals.size && !streamCursor) {
    state.timelineCache.delete(state.sessionId);
    persistTimelineCache();
    return;
  }
  const historySnapshot = timelineHistorySnapshotForCache(previous);
  state.timelineCache.set(state.sessionId, {
    savedAt: Date.now(),
    validatedAt: previous?.validatedAt || 0,
    sessionUpdatedAt: previous?.sessionUpdatedAt || 0,
    timeline,
    ...historySnapshot,
    batches: cloneCacheMap(state.batches),
    approvals: cloneCacheMap(state.approvals),
    ...(streamCursor ? { streamCursor } : {}),
  });
  persistTimelineCache();
}

function streamCursorForCache(previousCursor = null) {
  const turnId = String(state.turnId || '').trim();
  const sequence = Number(state.lastTurnEventSequence);
  if (turnId && state.lastTurnEventSequence != null && Number.isFinite(sequence)) {
    return {
      turnId,
      sequence,
      epoch: String(state.lastTurnEventEpoch || '').trim(),
    };
  }
  return normalizeStreamCursor(previousCursor);
}

function normalizeStreamCursor(cursor) {
  const turnId = typeof cursor?.turnId === 'string' ? cursor.turnId.trim() : '';
  const sequence = Number(cursor?.sequence);
  if (!turnId || cursor?.sequence == null || !Number.isFinite(sequence)) {
    return null;
  }
  return {
    turnId,
    sequence,
    epoch: typeof cursor?.epoch === 'string' ? cursor.epoch.trim() : '',
  };
}

function restoreTurnEventCursor(sessionId, turnId, { onlyIfUnset = false } = {}) {
  const normalizedTurnId = String(turnId || '').trim();
  if (!sessionId || !normalizedTurnId) {
    return false;
  }
  if (onlyIfUnset && (state.lastTurnEventSequence != null || state.lastTurnEventEpoch)) {
    return false;
  }
  const cursor = normalizeStreamCursor(state.timelineCache.get(sessionId)?.streamCursor);
  if (!cursor || cursor.turnId !== normalizedTurnId) {
    return false;
  }
  state.lastTurnEventSequence = cursor.sequence;
  state.lastTurnEventEpoch = cursor.epoch;
  return true;
}

function timelineHistorySnapshotForCache(previous) {
  const hasAuthoritativeHistory = hasAuthoritativeSessionHistory(state.currentSession)
    && state.sessionHistoryItems.length > 0;
  const hasHydratedHistory = state.sessionHistoryItems.length > 0;
  const baseHistory = hasHydratedHistory
    ? state.sessionHistoryItems
    : Array.isArray(previous?.history)
      ? previous.history
      : [];
  const pendingMessages = pendingTimelineMessagesMissingFromHistory(baseHistory, state.timeline);
  const combinedHistory = [
    ...baseHistory,
    ...pendingMessages.map((item) => ({ ...item })),
  ];
  const history = cloneTimelineEntries(combinedHistory);
  const baseHistoryComplete = state.currentSession?.timelineComplete === false
    ? false
    : hasAuthoritativeHistory || previous?.historyComplete === true;
  return {
    history,
    historyComplete: Boolean(baseHistoryComplete && history.length === combinedHistory.length),
  };
}

function scheduleCurrentTimelineSave() {
  if (timelinePersistTimer || !state.sessionId) {
    return;
  }
  timelinePersistTimer = setTimeout(() => {
    timelinePersistTimer = null;
    saveCurrentTimeline();
  }, TIMELINE_PERSIST_DEBOUNCE_MS);
}

function clearScheduledTimelineSave() {
  if (!timelinePersistTimer) {
    return;
  }
  clearTimeout(timelinePersistTimer);
  timelinePersistTimer = null;
}

function flushScheduledTimelineSave() {
  if (!timelinePersistTimer) {
    return;
  }
  clearScheduledTimelineSave();
  saveCurrentTimeline();
}

function restoreTimelineForSession(session, options = {}) {
  resetSessionHistoryWindow();
  syncTerminalTurnIdsFromSession(session);
  const fullHistory = fullHydratedTimelineFromSession(session);
  if (options.fullHistory) {
    state.timeline = fullHistory.map((item) => ({ ...item }));
    setSessionHistoryWindow(fullHistory, 0);
    state.batches = new Map();
    state.approvals = new Map();
    enforceCurrentWorkDetailsAccess();
    return;
  }
  const cached = state.timelineCache.get(session.id);
  if (cached) {
    state.batches = new Map(cached.batches);
    state.approvals = new Map(cached.approvals);
    state.timeline = cached.timeline.map((item) => ({ ...item }));
    const cachedHistory = Array.isArray(cached.history) ? cached.history : [];
    const historyItems = cachedHistory.length
      ? cachedHistory
      : hasAuthoritativeSessionHistory(session)
        ? fullHistory
        : [];
    if (historyItems.length) {
      const currentStart = visibleStartIndexForTimeline(historyItems, cached.timeline);
      setSessionHistoryWindow(historyItems, currentStart);
    }
    enforceCurrentWorkDetailsAccess();
    return;
  }
  state.timeline = selectVisibleHydratedTimelineItems(fullHistory);
  setSessionHistoryWindow(fullHistory, visibleHydratedStartIndex(fullHistory));
  state.batches = new Map();
  state.approvals = new Map();
  enforceCurrentWorkDetailsAccess();
}

function hasAuthoritativeSessionHistory(session) {
  return Object.prototype.hasOwnProperty.call(session || {}, 'timeline') && session?.timelineComplete !== false
    || Array.isArray(session?.thread?.turns);
}

function canUseFreshSessionDetailCache(session, cached = state.timelineCache.get(session?.id)) {
  if (!session?.id
    || state.workDetailsPolicyPendingSessionId === session.id
    || !cached?.timeline?.length
    || !cached?.history?.length
    || cached?.historyComplete !== true
    || isReadOnlySession(session)) {
    return false;
  }
  if (sessionActivityStateFromSummary(session) || findActiveTurn(session)) {
    return false;
  }
  if (cached.timeline.some((item) => item?.kind === 'message' && (
    item?.meta === 'pending'
    || (item?.role === 'assistant' && ['analysis', 'commentary', 'streaming'].includes(item?.meta))
  ))) {
    return false;
  }
  const approvals = cached.approvals instanceof Map ? cached.approvals : new Map();
  if ([...approvals.values()].some((approval) => approval?.resolved === false)) {
    return false;
  }
  const validatedAt = Number(cached.validatedAt) || 0;
  if (!validatedAt || Date.now() - validatedAt > SESSION_DETAIL_CACHE_FRESH_MS) {
    return false;
  }
  return sessionRevision(session) <= (Number(cached.sessionUpdatedAt) || 0);
}

function sessionRevision(session) {
  return Math.max(Number(session?.updatedAt) || 0, Number(session?.lastInputAt) || 0);
}

function markTimelineCacheValidated(session) {
  if (!session?.id || state.workDetailsPolicyPendingSessionId === session.id) {
    return;
  }
  const cached = state.timelineCache.get(session.id);
  if (!cached?.timeline?.length) {
    return;
  }
  state.timelineCache.set(session.id, {
    ...cached,
    validatedAt: Date.now(),
    sessionUpdatedAt: sessionRevision(session),
  });
  persistTimelineCache();
}

function loadTimelineCache() {
  const cache = new Map();
  try {
    const parsed = JSON.parse(localStorage.getItem(TIMELINE_CACHE_KEY) || '{"entries":[]}');
    const entries = Array.isArray(parsed?.entries)
      ? parsed.entries
      : Array.isArray(parsed)
        ? parsed
        : [];
    const cacheEntries = entries
      .map((entry) => deserializeTimelineCacheEntry(entry))
      .filter(Boolean)
      .sort((left, right) => right.value.savedAt - left.value.savedAt);
    for (const cacheEntry of cacheEntries) {
      if (!cache.has(cacheEntry.sessionId)) {
        cache.set(cacheEntry.sessionId, cacheEntry.value);
      }
      if (cache.size >= MAX_TIMELINE_CACHE_SESSIONS) {
        break;
      }
    }
    if (parsed?.version !== TIMELINE_CACHE_VERSION && cache.size) {
      const migratedEntries = [...cache.entries()]
        .map(([sessionId, value]) => serializeTimelineCacheEntry(sessionId, value))
        .filter(Boolean);
      localStorage.setItem(TIMELINE_CACHE_KEY, JSON.stringify({
        version: TIMELINE_CACHE_VERSION,
        entries: migratedEntries,
      }));
    }
  } catch (_error) {
    localStorage.removeItem(TIMELINE_CACHE_KEY);
  }
  return cache;
}

function persistTimelineCache() {
  const entries = [...state.timelineCache.entries()]
    .map(([sessionId, value]) => serializeTimelineCacheEntry(sessionId, value))
    .filter(Boolean)
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, MAX_TIMELINE_CACHE_SESSIONS);
  state.timelineCache = new Map(entries.map((entry) => {
    const cacheEntry = deserializeTimelineCacheEntry(entry);
    return [entry.sessionId, cacheEntry.value];
  }));
  try {
    localStorage.setItem(TIMELINE_CACHE_KEY, JSON.stringify({
      version: TIMELINE_CACHE_VERSION,
      entries,
    }));
  } catch (error) {
    console.warn('[codex-web] timeline cache persist failed', error);
  }
}

function loadQueuedMessages() {
  const queue = new Map();
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUED_MESSAGES_KEY) || '{"sessions":[]}');
    const sessions = Array.isArray(parsed?.sessions)
      ? parsed.sessions
      : [];
    for (const session of sessions) {
      const sessionId = typeof session?.sessionId === 'string' ? session.sessionId : '';
      const messages = Array.isArray(session?.messages)
        ? session.messages
          .map((message) => normalizeQueuedMessage(message))
          .filter(Boolean)
          .slice(0, 20)
        : [];
      if (sessionId && messages.length) {
        queue.set(sessionId, messages);
      }
    }
  } catch (_error) {
    localStorage.removeItem(QUEUED_MESSAGES_KEY);
  }
  return queue;
}

function persistQueuedMessages() {
  const sessions = [...state.queuedMessages.entries()]
    .map(([sessionId, messages]) => ({
      sessionId,
      messages: (Array.isArray(messages) ? messages : []).map((message) => normalizeQueuedMessage(message)).filter(Boolean).slice(0, 20),
    }))
    .filter((entry) => entry.sessionId && entry.messages.length)
    .slice(-50);
  try {
    localStorage.setItem(QUEUED_MESSAGES_KEY, JSON.stringify({ sessions }));
  } catch (error) {
    console.warn('[codex-web] queued messages persist failed', error);
  }
}

function normalizeQueuedMessage(message) {
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  if (!text) {
    return null;
  }
  const id = typeof message?.id === 'string' && message.id
    ? message.id
    : `queued_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = typeof message?.createdAt === 'string' && message.createdAt
    ? message.createdAt
    : new Date().toISOString();
  return {
    id,
    text: text.slice(0, 12000),
    createdAt,
  };
}

function loadSubmissionOutbox() {
  const outbox = new Map();
  const legacyEntries = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(SUBMISSION_OUTBOX_KEY) || '{"entries":[]}');
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    for (const candidate of entries) {
      const entry = normalizeSubmissionOutboxEntry(candidate, { restore: true });
      if (entry) {
        legacyEntries.push(entry);
      }
    }
  } catch (error) {
    console.warn('[codex-web] legacy submission outbox read failed', error);
  }
  for (const key of submissionOutboxStorageKeys()) {
    const entry = readStoredSubmissionOutboxEntry(localStorage.getItem(key), { restore: true });
    if (!entry) {
      continue;
    }
    const current = outbox.get(entry.id);
    if (!current || entry.updatedAt >= current.updatedAt) {
      outbox.set(entry.id, entry);
    }
    try {
      persistSubmissionOutboxEntry(entry);
    } catch (error) {
      console.warn('[codex-web] submission outbox recovery persist failed', error);
    }
  }
  let migrated = true;
  for (const entry of legacyEntries) {
    const current = outbox.get(entry.id);
    if (!current || entry.updatedAt >= current.updatedAt) {
      outbox.set(entry.id, entry);
    }
    try {
      persistSubmissionOutboxEntry(outbox.get(entry.id));
    } catch (error) {
      migrated = false;
      console.warn('[codex-web] submission outbox migration failed', error);
    }
  }
  if (legacyEntries.length && migrated) {
    try {
      localStorage.removeItem(SUBMISSION_OUTBOX_KEY);
    } catch (error) {
      console.warn('[codex-web] legacy submission outbox cleanup failed', error);
    }
  }
  return outbox;
}

function submissionOutboxStorageKeys() {
  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (typeof key === 'string' && key.startsWith(SUBMISSION_OUTBOX_ENTRY_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

function submissionOutboxEntryStorageKey(submissionId) {
  return `${SUBMISSION_OUTBOX_ENTRY_PREFIX}${encodeURIComponent(submissionId)}`;
}

function persistSubmissionOutboxEntry(entry) {
  localStorage.setItem(submissionOutboxEntryStorageKey(entry.id), JSON.stringify({
    version: SUBMISSION_OUTBOX_VERSION,
    entry,
  }));
}

function readStoredSubmissionOutboxEntry(value, { restore = false } = {}) {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return normalizeSubmissionOutboxEntry(parsed?.entry || parsed, { restore });
  } catch (_error) {
    return null;
  }
}

function onSubmissionStorageChange(event) {
  const key = String(event?.key || '');
  if (!key.startsWith(SUBMISSION_OUTBOX_ENTRY_PREFIX)) {
    return;
  }
  const encodedId = key.slice(SUBMISSION_OUTBOX_ENTRY_PREFIX.length);
  let submissionId = '';
  try {
    submissionId = decodeURIComponent(encodedId);
  } catch (_error) {
    return;
  }
  let changedEntry = null;
  if (!event.newValue) {
    state.submissionOutbox.delete(submissionId);
  } else {
    const entry = readStoredSubmissionOutboxEntry(event.newValue);
    if (!entry || entry.id !== submissionId) {
      return;
    }
    state.submissionOutbox.set(entry.id, entry);
    changedEntry = entry;
  }
  scheduleSubmissionRetry();
  if (state.authSession) {
    render();
  }
  if (
    changedEntry
    && submissionBelongsToCurrentOwner(changedEntry)
    && changedEntry.status !== 'sending'
    && changedEntry.retryable !== false
    && changedEntry.nextAttemptAt <= Date.now()
    && navigator.onLine !== false
  ) {
    void drainSubmissionOutbox();
  }
}

function normalizeSubmissionOutboxEntry(entry, { restore = false } = {}) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const id = String(entry.id || '').trim();
  const text = String(entry.text || '').trim().slice(0, 12000);
  const ownerKey = String(entry.ownerKey || '').trim();
  if (!id || !text || !ownerKey) {
    return null;
  }
  const rawStatus = String(entry.status || '').trim();
  const status = restore && rawStatus === 'sending'
    ? 'pending'
    : ['pending', 'sending', 'failed'].includes(rawStatus)
      ? rawStatus
      : 'pending';
  const createdAt = Number(entry.createdAt) || Date.now();
  const updatedAt = Number(entry.updatedAt) || createdAt;
  const settings = entry.settings && typeof entry.settings === 'object' && !Array.isArray(entry.settings)
    ? sanitizeCacheValue(entry.settings)
    : {};
  const attachments = (Array.isArray(entry.attachments) ? entry.attachments : [])
    .map(normalizeSubmissionAttachment)
    .filter(Boolean)
    .slice(0, 20);
  return {
    id,
    ownerKey,
    text,
    status,
    sessionId: String(entry.sessionId || '').trim(),
    projectId: String(entry.projectId || '').trim(),
    cwd: String(entry.cwd || '').trim(),
    settings,
    attachments,
    createdAt,
    updatedAt,
    attempts: Math.max(0, Number(entry.attempts) || 0),
    nextAttemptAt: Math.max(0, Number(entry.nextAttemptAt) || 0),
    error: String(entry.error || '').slice(0, 1000),
    retryable: entry.retryable !== false,
    queuedMessageId: String(entry.queuedMessageId || '').trim(),
  };
}

function normalizeSubmissionAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return null;
  }
  const id = String(attachment.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    kind: attachment.kind === 'image' ? 'image' : 'file',
    fileName: String(attachment.fileName || 'upload').slice(0, 500),
    mimeType: typeof attachment.mimeType === 'string' ? attachment.mimeType.slice(0, 200) : null,
    ...(Number.isFinite(attachment.sizeBytes) ? { sizeBytes: Number(attachment.sizeBytes) } : {}),
    storage: attachment.storage === 'state' ? 'state' : 'project',
    localPath: String(attachment.localPath || '').slice(0, 4000),
    ...(typeof attachment.displayPath === 'string' ? { displayPath: attachment.displayPath.slice(0, 4000) } : {}),
  };
}

function createSubmissionId() {
  const generated = globalThis.crypto?.randomUUID?.();
  return generated || `submission_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function currentSubmissionOwnerKey() {
  const principal = state.authSession?.principal;
  if (principal?.mode === 'multi') {
    const userId = String(principal.userId || '').trim();
    return userId ? `multi:${userId}` : '';
  }
  return state.authSession ? 'single' : '';
}

function submissionBelongsToCurrentOwner(entry) {
  const ownerKey = currentSubmissionOwnerKey();
  return Boolean(ownerKey && entry?.ownerKey === ownerKey);
}

function pendingSubmissionEntries() {
  return [...state.submissionOutbox.values()]
    .filter(submissionBelongsToCurrentOwner)
    .sort((left, right) => left.createdAt - right.createdAt);
}

function upsertSubmissionOutboxEntry(entry) {
  const normalized = normalizeSubmissionOutboxEntry(entry);
  if (!normalized) {
    throw new Error('Could not save this message for delivery.');
  }
  try {
    persistSubmissionOutboxEntry(normalized);
  } catch (error) {
    console.warn('[codex-web] submission outbox persist failed', error);
    throw error;
  }
  state.submissionOutbox.set(normalized.id, normalized);
  return normalized;
}

function removeSubmissionOutboxEntry(submissionId) {
  if (!submissionId || !state.submissionOutbox.has(submissionId)) {
    return false;
  }
  try {
    localStorage.removeItem(submissionOutboxEntryStorageKey(submissionId));
  } catch (error) {
    console.warn('[codex-web] submission outbox removal failed', error);
    throw error;
  }
  state.submissionOutbox.delete(submissionId);
  return true;
}

function drainSubmissionOutbox({ force = false } = {}) {
  if (submissionDrainPromise) {
    return submissionDrainPromise.then(() => drainSubmissionOutbox({ force }));
  }
  submissionDrainPromise = drainSubmissionOutboxOnce({ force }).finally(() => {
    submissionDrainPromise = null;
  });
  return submissionDrainPromise;
}

async function drainSubmissionOutboxOnce({ force = false } = {}) {
  if (!state.authSession || isShareContext() || navigator.onLine === false) {
    return false;
  }
  let attempted = false;
  for (const entry of pendingSubmissionEntries()) {
    if (entry.status === 'sending' || entry.retryable === false) {
      continue;
    }
    if (submissionFailureIsVisible(entry)) {
      continue;
    }
    if (!force && entry.nextAttemptAt > Date.now()) {
      continue;
    }
    attempted = true;
    await deliverSubmission(entry.id, {
      interactive: state.activeSubmissionId === entry.id || state.sessionId === entry.sessionId,
      force,
    });
  }
  scheduleSubmissionRetry();
  return attempted;
}

function scheduleSubmissionRetry() {
  if (submissionRetryTimer) {
    clearTimeout(submissionRetryTimer);
    submissionRetryTimer = null;
  }
  if (!state.authSession || navigator.onLine === false) {
    return;
  }
  const nextAttemptAt = pendingSubmissionEntries()
    .filter((entry) => entry.status !== 'sending' && entry.retryable !== false && entry.nextAttemptAt > 0)
    .reduce((earliest, entry) => earliest === 0 ? entry.nextAttemptAt : Math.min(earliest, entry.nextAttemptAt), 0);
  if (!nextAttemptAt) {
    return;
  }
  submissionRetryTimer = setTimeout(() => {
    submissionRetryTimer = null;
    void drainSubmissionOutbox();
  }, Math.max(0, nextAttemptAt - Date.now()));
  submissionRetryTimer?.unref?.();
}

async function retrySubmission(submissionId) {
  const current = state.submissionOutbox.get(submissionId);
  if (!current || !submissionBelongsToCurrentOwner(current) || current.status === 'sending') {
    return null;
  }
  upsertSubmissionOutboxEntry({
    ...current,
    status: 'pending',
    error: '',
    retryable: true,
    nextAttemptAt: 0,
    updatedAt: Date.now(),
  });
  return deliverSubmission(submissionId, { interactive: true, force: true });
}

function cancelSubmission(submissionId) {
  const current = state.submissionOutbox.get(submissionId);
  if (!current || !submissionBelongsToCurrentOwner(current) || current.status === 'sending') {
    return false;
  }
  removeSubmissionOutboxEntry(submissionId);
  if (current.queuedMessageId && current.sessionId) {
    removeQueuedMessage(current.sessionId, current.queuedMessageId);
  }
  state.timeline = state.timeline.filter((item) => item?.submissionId !== submissionId);
  if (state.activeSubmissionId === submissionId) {
    state.activeSubmissionId = '';
    state.draftSessionActive = true;
    state.status = 'Ready';
    state.statusTone = 'success';
    state.error = '';
  }
  if (state.sessionId) {
    saveCurrentTimeline();
  }
  render();
  return true;
}

function serializeTimelineCacheEntry(sessionId, value) {
  if (!sessionId || !value) {
    return null;
  }
  return {
    sessionId,
    savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0,
    validatedAt: typeof value.validatedAt === 'number' ? value.validatedAt : 0,
    sessionUpdatedAt: typeof value.sessionUpdatedAt === 'number' ? value.sessionUpdatedAt : 0,
    timeline: cloneTimelineEntries(value.timeline || []),
    history: cloneTimelineEntries(value.history || []),
    historyComplete: value.historyComplete === true,
    batches: [...cloneCacheMap(value.batches).entries()],
    approvals: [...cloneCacheMap(value.approvals).entries()],
    ...(normalizeStreamCursor(value.streamCursor) ? { streamCursor: normalizeStreamCursor(value.streamCursor) } : {}),
  };
}

function deserializeTimelineCacheEntry(entry) {
  if (!entry || typeof entry.sessionId !== 'string' || !entry.sessionId) {
    return null;
  }
  const batches = Array.isArray(entry.batches)
    ? entry.batches.filter(isCacheMapPair)
    : [];
  const approvals = Array.isArray(entry.approvals)
    ? entry.approvals.filter(isCacheMapPair)
    : [];
  return {
    sessionId: entry.sessionId,
    value: {
      savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : 0,
      validatedAt: typeof entry.validatedAt === 'number' ? entry.validatedAt : 0,
      sessionUpdatedAt: typeof entry.sessionUpdatedAt === 'number' ? entry.sessionUpdatedAt : 0,
      timeline: cloneTimelineEntries(Array.isArray(entry.timeline) ? entry.timeline : []),
      history: cloneTimelineEntries(Array.isArray(entry.history) ? entry.history : []),
      historyComplete: entry.historyComplete === true,
      batches: new Map(batches),
      approvals: new Map(approvals),
      ...(normalizeStreamCursor(entry.streamCursor) ? { streamCursor: normalizeStreamCursor(entry.streamCursor) } : {}),
    },
  };
}

function isCacheMapPair(pair) {
  return Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string';
}

function cloneCacheMap(map) {
  const entries = map instanceof Map
    ? [...map.entries()]
    : Array.isArray(map)
      ? map.filter(isCacheMapPair)
      : [];
  return new Map(entries.slice(-MAX_TIMELINE_CACHE_MAP_ITEMS).map(([key, value]) => [
    key,
    sanitizeCacheValue(value),
  ]));
}

function sanitizeCacheValue(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_TIMELINE_SUMMARY_TEXT
      ? value.slice(0, MAX_TIMELINE_SUMMARY_TEXT)
      : value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_TIMELINE_SUMMARY_DEPTH) {
      return [];
    }
    return value.slice(0, MAX_TIMELINE_SUMMARY_ARRAY_ITEMS)
      .map((item) => sanitizeCacheValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= MAX_TIMELINE_SUMMARY_DEPTH) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_TIMELINE_SUMMARY_OBJECT_KEYS)
        .map(([key, item]) => [key, sanitizeCacheValue(item, depth + 1)]),
    );
  }
  return String(value);
}

function cloneTimelineEntries(entries) {
  return dedupeTimelineProjectionEntries(Array.isArray(entries) ? entries : [])
    .filter((item) => item?.kind !== 'work')
    .slice(-MAX_TIMELINE_CACHE_ITEMS)
    .map(cloneTimelineItem)
    .filter(Boolean);
}

function cloneTimelineItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const clone = { ...item };
  if (typeof clone.text === 'string' && clone.text.length > MAX_TIMELINE_ITEM_TEXT) {
    clone.text = `${clone.text.slice(0, MAX_TIMELINE_ITEM_TEXT)}...`;
  }
  return clone;
}

function hydrateTimelineFromSession(session) {
  return selectVisibleHydratedTimelineItems(fullHydratedTimelineFromSession(session));
}

function fullHydratedTimelineFromSession(session) {
  const storedTimeline = normalizeSessionTimeline(session?.timeline);
  if (storedTimeline.length) {
    return dedupeTimelineProjectionEntries(canonicalizeStoredTimelineEntries(
      markKnownFinalTimelineEntries(storedTimeline, session),
      session,
    ));
  }
  const items = [];
  const turns = Array.isArray(session.thread?.turns) ? session.thread.turns : [];
  for (const turn of turns) {
    const finalAssistantItems = new Set(restrictedFinalAssistantItemsForTurn(turn));
    for (const [itemIndex, item] of (turn.items || []).entries()) {
      const role = timelineRoleForThreadItem(item);
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!role || !text) {
        continue;
      }
      const itemId = threadTimelineItemId(item);
      const isFinal = role === 'assistant' && finalAssistantItems.has(item);
      const phase = historicalAssistantProjectionPhase(item, isFinal);
      const normalized = normalizeSessionTimelineItem({
        id: role === 'assistant' && (itemId || isFinal)
          ? assistantTimelineEntryId(turn.id, itemId, phase, isFinal)
          : `history_${turn.id}_${itemIndex}`,
        kind: 'message',
        role,
        label: role === 'user' ? 'You' : 'Assistant',
        meta: role === 'assistant' ? assistantProjectionMeta(phase, isFinal) : 'history',
        text,
        turnId: turn.id,
        ...(itemId ? { itemId, projectionKey: `${turn.id}\u0000${itemId}` } : {}),
        lifecycle: 'completed',
      });
      if (normalized) {
        items.push(normalized);
      }
    }
    if (isFailureTurnStatus(turn?.status)) {
      const text = runtimeTurnErrorMessage(turn);
      items.push({
        id: `error_${turn?.id || `history_failed_${items.length}`}`,
        kind: 'message',
        role: 'system',
        severity: 'error',
        label: 'Error',
        meta: 'failed',
        text,
      });
    }
  }
  if (!items.length) {
    const preview = firstInputForSession(session);
    return preview ? [{
      id: `history_preview_${session.id}`,
      kind: 'message',
      role: 'user',
      label: 'You',
      meta: 'preview',
      text: preview,
    }] : [];
  }
  return dedupeTimelineProjectionEntries(items);
}

function markKnownFinalTimelineEntries(entries, session) {
  const finalIndexes = restrictedFinalAssistantTimelineIndexes(entries, session);
  return entries.map((item, index) => (
    finalIndexes.has(index) && item?.meta !== 'final' && item?.meta !== 'final_answer'
      ? { ...item, meta: 'final' }
      : item
  ));
}

function canonicalizeStoredTimelineEntries(entries, session) {
  const candidates = [];
  for (const turn of sessionTurns(session)) {
    const finalItems = new Set(restrictedFinalAssistantItemsForTurn(turn));
    for (const [itemIndex, item] of (turn.items || []).entries()) {
      const role = timelineRoleForThreadItem(item);
      const text = typeof item?.text === 'string' ? item.text.trim() : '';
      if (!role || !text) {
        continue;
      }
      const itemId = threadTimelineItemId(item);
      const isFinal = role === 'assistant' && finalItems.has(item);
      const phase = historicalAssistantProjectionPhase(item, isFinal);
      candidates.push({
        turnId: turn.id,
        itemIndex,
        itemId,
        role,
        text,
        isFinal,
        phase,
      });
    }
  }
  const used = new Set();
  let cursor = 0;
  return entries.map((entry) => {
    if (entry?.kind !== 'message' || (entry.role !== 'user' && entry.role !== 'assistant')) {
      return entry;
    }
    let candidateIndex = candidates.findIndex((candidate, index) => (
      index >= cursor
      && !used.has(index)
      && candidate.role === entry.role
      && candidate.text === entry.text
    ));
    if (candidateIndex < 0) {
      candidateIndex = candidates.findIndex((candidate, index) => (
        !used.has(index)
        && candidate.role === entry.role
        && candidate.text === entry.text
      ));
    }
    if (candidateIndex < 0) {
      return entry;
    }
    used.add(candidateIndex);
    cursor = Math.max(cursor, candidateIndex + 1);
    const candidate = candidates[candidateIndex];
    if (entry.role === 'user') {
      return { ...entry, turnId: candidate.turnId };
    }
    const id = candidate.itemId || candidate.isFinal
      ? assistantTimelineEntryId(candidate.turnId, candidate.itemId, candidate.phase, candidate.isFinal)
      : entry.id;
    return {
      ...entry,
      id,
      turnId: candidate.turnId,
      meta: assistantProjectionMeta(candidate.phase, candidate.isFinal),
      lifecycle: 'completed',
      ...(candidate.itemId
        ? {
          itemId: candidate.itemId,
          projectionKey: `${candidate.turnId}\u0000${candidate.itemId}`,
        }
        : {}),
    };
  });
}

function threadTimelineItemId(item) {
  const direct = String(item?.itemId || item?.id || '').trim();
  if (direct) {
    return direct;
  }
  return String(item?.raw?.itemId || item?.raw?.id || '').trim();
}

function historicalAssistantProjectionPhase(item, isFinal = false) {
  const type = String(item?.type || '').replace(/[^a-z]/giu, '').toLowerCase();
  if (type.includes('reasoning')) {
    return 'reasoning_summary';
  }
  return normalizeAssistantProjectionPhase(item?.phase, isFinal);
}

function timelineTurnId(item) {
  const direct = String(item?.turnId || '').trim();
  if (direct) {
    return direct;
  }
  const id = String(item?.id || '');
  const historyMatch = id.match(/^history_(.+)_\d+$/u);
  if (historyMatch?.[1]) {
    return historyMatch[1];
  }
  const finalMatch = id.match(/^assistant_(.+)_final$/u);
  if (finalMatch?.[1]) {
    return finalMatch[1];
  }
  if (id.startsWith('assistant_')) {
    return id.slice('assistant_'.length);
  }
  return '';
}

function timelineProjectionIdentity(item) {
  if (typeof item?.projectionKey === 'string' && item.projectionKey) {
    return `projection:${item.projectionKey}`;
  }
  const turnId = timelineTurnId(item);
  if (turnId && item?.itemId) {
    return `projection:${turnId}\u0000${item.itemId}`;
  }
  return [
    'message',
    turnId,
    item?.role || '',
    item?.text || '',
  ].join('\u0000');
}

function dedupeTimelineProjectionEntries(entries) {
  const source = (Array.isArray(entries) ? entries : []).filter((item) => (
    Boolean(item)
    && !(item?.kind === 'message' && item.role === 'system' && isTurnInterruptTimeoutMessage(item.text))
  ));
  const actualFinalKeys = new Set(source.flatMap((item) => {
    const turnId = timelineTurnId(item);
    const meta = String(item?.meta || '').trim().toLowerCase();
    const final = item?.kind === 'message'
      && item.role === 'assistant'
      && (meta === 'final' || meta === 'final_answer' || String(item.id || '').endsWith('_final'));
    return final && turnId && item.text ? [`${turnId}\u0000${item.text}`] : [];
  }));
  const result = [];
  const indexes = new Map();
  for (const original of source) {
    let item = { ...original };
    const turnId = timelineTurnId(item);
    const finalKey = item?.kind === 'message' && item.role === 'assistant' && turnId && item.text
      ? `${turnId}\u0000${item.text}`
      : '';
    const semanticKey = timelineSemanticProjectionKey(item, turnId);
    const key = finalKey && actualFinalKeys.has(finalKey)
      ? `final:${finalKey}`
      : semanticKey
        ? semanticKey
      : item.projectionKey
        ? `projection:${item.projectionKey}`
        : item.id
          ? `id:${item.id}`
          : '';
    if (finalKey && actualFinalKeys.has(finalKey) && !item.itemId) {
      item = {
        ...item,
        id: assistantTimelineEntryId(turnId, '', 'final_answer', true),
        turnId,
        meta: 'final',
        lifecycle: 'completed',
        streaming: false,
      };
    }
    if (key && indexes.has(key)) {
      result[indexes.get(key)] = item;
    } else if (timelineEntriesAreTransientDuplicates(result.at(-1), item)) {
      result[result.length - 1] = preferredTimelineDuplicate(result.at(-1), item);
    } else {
      if (key) {
        indexes.set(key, result.length);
      }
      result.push(item);
    }
  }
  return result;
}

function timelineSemanticProjectionKey(item, turnId = timelineTurnId(item)) {
  if (item?.kind !== 'message' || !turnId || !item.text || !['user', 'assistant'].includes(item.role)) {
    return '';
  }
  if (item.role === 'user') {
    return `semantic:${turnId}\u0000user\u0000${timelineMessageIdentity(item)}`;
  }
  const meta = String(item.meta || '').trim().toLowerCase();
  const phase = meta === 'history' ? '' : meta === 'final_answer' ? 'final' : meta;
  return `semantic:${turnId}\u0000assistant\u0000${phase}\u0000${item.text}`;
}

function timelineEntriesAreTransientDuplicates(previous, next) {
  if (previous?.kind !== 'message' || next?.kind !== 'message' || previous.role !== next.role) {
    return false;
  }
  if (timelineMessageIdentity(previous) !== timelineMessageIdentity(next)) {
    return false;
  }
  const previousPending = previous.meta === 'pending' || Boolean(previous.submissionId);
  const nextPending = next.meta === 'pending' || Boolean(next.submissionId);
  if (!previousPending && !nextPending) {
    return false;
  }
  const previousTurnId = timelineTurnId(previous);
  const nextTurnId = timelineTurnId(next);
  return !previousTurnId || !nextTurnId || previousTurnId === nextTurnId;
}

function preferredTimelineDuplicate(previous, next) {
  const previousPending = previous?.meta === 'pending' || Boolean(previous?.submissionId);
  const nextPending = next?.meta === 'pending' || Boolean(next?.submissionId);
  if (previousPending !== nextPending) {
    return previousPending ? next : previous;
  }
  return next;
}

function normalizeSessionTimeline(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeSessionTimelineItem(item))
    .filter(Boolean);
}

function normalizeSessionTimelineItem(item) {
  if (!item || item.kind !== 'message') {
    return null;
  }
  const role = item.role === 'user' || item.role === 'assistant' || item.role === 'system'
    ? item.role
    : null;
  const display = normalizeTimelineMessageDisplay(role, item.text, item.attachments);
  if (role === 'system' && isTurnInterruptTimeoutMessage(display.text)) {
    return null;
  }
  if (!role || (!display.text && !display.attachments.length)) {
    return null;
  }
  const isFailure = role === 'system' && item.severity === 'error' && item.meta === 'failed';
  const text = isFailure ? publicRuntimeTurnFailureMessage(display.text) : display.text;
  return {
    id: typeof item.id === 'string' && item.id ? item.id : `timeline_${role}_${text.slice(0, 24)}`,
    kind: 'message',
    role,
    label: typeof item.label === 'string' && item.label ? item.label : role === 'user' ? 'You' : role === 'assistant' ? 'Assistant' : 'System',
    meta: typeof item.meta === 'string' ? item.meta : '',
    text,
    ...(typeof item.turnId === 'string' && item.turnId ? { turnId: item.turnId } : {}),
    ...(typeof item.itemId === 'string' && item.itemId ? { itemId: item.itemId } : {}),
    ...(typeof item.projectionKey === 'string' && item.projectionKey ? { projectionKey: item.projectionKey } : {}),
    ...(typeof item.phase === 'string' && item.phase ? { phase: item.phase } : {}),
    ...(typeof item.lifecycle === 'string' && item.lifecycle ? { lifecycle: item.lifecycle } : {}),
    ...(item.streaming === true ? { streaming: true } : {}),
    ...(typeof item.source === 'string' && item.source ? { source: item.source } : {}),
    ...(display.attachments.length ? { attachments: display.attachments } : {}),
    severity: item.severity === 'error' ? 'error' : undefined,
  };
}

function selectVisibleHydratedTimelineItems(items) {
  return items.slice(visibleHydratedStartIndex(items));
}

function currentVisibleHydratedTimelineItems(items) {
  if (!state.sessionHistoryItems.length) {
    return selectVisibleHydratedTimelineItems(items);
  }
  return state.sessionHistoryItems.slice(state.sessionHistoryStartIndex);
}

function visibleHydratedStartIndex(items) {
  const completeExchangeStarts = findCompleteExchangeStarts(items);
  const startIndex = completeExchangeStarts.length < MIN_HYDRATED_COMPLETE_EXCHANGES
    ? 0
    : completeExchangeStarts[completeExchangeStarts.length - MIN_HYDRATED_COMPLETE_EXCHANGES];
  return includeAdjacentSystemTimelineItems(items, startIndex);
}

function includeAdjacentSystemTimelineItems(items, startIndex) {
  let index = Math.max(0, Number.isFinite(startIndex) ? Math.floor(startIndex) : 0);
  while (index > 0 && isStandaloneSystemTimelineItem(items[index - 1])) {
    index -= 1;
  }
  return index;
}

function isStandaloneSystemTimelineItem(item) {
  return item?.kind === 'message' && item?.role === 'system';
}

function setSessionHistoryWindow(items, startIndex) {
  state.sessionHistoryItems = (Array.isArray(items) ? items : []).map((item) => ({ ...item }));
  state.sessionHistoryStartIndex = Math.max(0, Math.min(
    Number.isFinite(startIndex) ? Math.floor(startIndex) : 0,
    state.sessionHistoryItems.length,
  ));
}

function visibleStartIndexForTimeline(historyItems, timelineItems) {
  const historySignature = timelineMessageSignature(historyItems);
  const timelineSignature = timelineMessageSignature(timelineItems);
  if (!historySignature || !timelineSignature) {
    return visibleHydratedStartIndex(historyItems);
  }
  if (historySignature === timelineSignature) {
    return 0;
  }
  for (let index = 0; index < historyItems.length; index += 1) {
    if (timelineMessageSignature(historyItems.slice(index)) === timelineSignature) {
      return index;
    }
  }
  return visibleHydratedStartIndex(historyItems);
}

function showMoreSessionHistory() {
  if ((!isDesktopWorkspaceView() && state.view !== 'chat') || !state.sessionId) {
    return false;
  }
  let historyItems = state.sessionHistoryItems;
  if (!historyItems.length && state.currentSession) {
    historyItems = fullHydratedTimelineFromSession(state.currentSession);
    setSessionHistoryWindow(historyItems, visibleStartIndexForTimeline(historyItems, state.timeline));
  }
  if (!state.sessionHistoryItems.length || state.sessionHistoryStartIndex <= 0) {
    if (state.currentSession?.timelineComplete === false && state.currentSession?.timelineNextBefore != null) {
      void loadOlderSessionTimelinePage();
      return true;
    }
    return false;
  }
  const previousStarts = findCompleteExchangeStarts(state.sessionHistoryItems)
    .filter((index) => index < state.sessionHistoryStartIndex);
  const nextStart = previousStarts.length
    ? previousStarts[previousStarts.length - 1]
    : 0;
  if (nextStart === state.sessionHistoryStartIndex) {
    return false;
  }
  const oldScrollHeight = document.querySelector('#timeline')?.scrollHeight || 0;
  state.sessionHistoryStartIndex = nextStart;
  state.timeline = state.sessionHistoryItems.slice(nextStart).map((item) => ({ ...item }));
  state.batches = new Map();
  state.approvals = new Map();
  saveCurrentTimeline();
  render();
  restoreExpandedTimelineScroll(oldScrollHeight);
  return true;
}

function loadOlderSessionTimelinePage() {
  const sessionId = state.sessionId;
  if (!sessionId || state.currentSession?.timelineNextBefore == null) {
    return Promise.resolve(false);
  }
  const before = String(state.currentSession.timelineNextBefore);
  if (sessionTimelinePageRequest) {
    if (sessionTimelinePageRequest.sessionId === sessionId && sessionTimelinePageRequest.before === before) {
      return sessionTimelinePageRequest.promise;
    }
    cancelSessionTimelinePageLoad();
  }
  const oldScrollHeight = document.querySelector('#timeline')?.scrollHeight || 0;
  const controller = new AbortController();
  const cancelledResult = {};
  let settleCancellation = null;
  const cancellation = new Promise((resolve) => {
    settleCancellation = resolve;
  });
  const request = {
    sessionId,
    before,
    controller,
    timeoutTimer: null,
    promise: null,
    cancel: () => settleCancellation?.(cancelledResult),
  };
  request.timeoutTimer = scheduleNetworkTimer(() => {
    request.timeoutTimer = null;
    if (sessionTimelinePageRequest === request) {
      sessionTimelinePageRequest = null;
    }
    request.cancel();
    controller.abort();
  }, SESSION_TIMELINE_PAGE_TIMEOUT_MS);
  const promise = Promise.race([
    apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/timeline?limit=50&before=${encodeURIComponent(before)}`, {
      signal: controller.signal,
    }),
    cancellation,
  ])
    .then((payload) => {
      if (payload === cancelledResult
        || state.sessionId !== sessionId
        || state.currentSession?.id !== sessionId
        || !Array.isArray(payload?.items)) {
        return false;
      }
      const olderItems = normalizeSessionTimeline(payload.items);
      const combinedHistory = dedupeTimelineProjectionEntries([
        ...olderItems,
        ...state.sessionHistoryItems,
      ]);
      state.currentSession = {
        ...state.currentSession,
        timeline: combinedHistory,
        timelineComplete: payload.hasMore !== true,
        timelineNextBefore: payload.nextBefore ?? null,
      };
      state.sessionHistoryItems = combinedHistory.map((item) => ({ ...item }));
      state.sessionHistoryStartIndex = 0;
      state.timeline = dedupeTimelineProjectionEntries([
        ...olderItems,
        ...state.timeline,
      ]);
      saveCurrentTimeline();
      render();
      restoreExpandedTimelineScroll(oldScrollHeight, sessionId);
      return true;
    })
    .catch((error) => {
      if (error?.name === 'AbortError') {
        return false;
      }
      if (error?.status === 401 || error?.status === 403) {
        handleApiError(error);
      } else if (isMissingSessionError(error)) {
        handleMissingSession(error, '');
      } else {
        console.warn('[codex-web] older session timeline load failed', error);
      }
      return false;
    })
    .finally(() => {
      if (request.timeoutTimer != null) {
        clearNetworkTimer(request.timeoutTimer);
        request.timeoutTimer = null;
      }
      if (sessionTimelinePageRequest === request) {
        sessionTimelinePageRequest = null;
      }
    });
  request.promise = promise;
  sessionTimelinePageRequest = request;
  return promise;
}

function cancelSessionTimelinePageLoad() {
  const request = sessionTimelinePageRequest;
  if (!request) {
    return false;
  }
  sessionTimelinePageRequest = null;
  if (request.timeoutTimer != null) {
    clearNetworkTimer(request.timeoutTimer);
    request.timeoutTimer = null;
  }
  request.cancel();
  request.controller.abort();
  return true;
}

function restoreExpandedTimelineScroll(previousScrollHeight, expectedSessionId = '') {
  requestAnimationFrame(() => {
    if (expectedSessionId
      && (state.sessionId !== expectedSessionId || state.currentSession?.id !== expectedSessionId)) {
      return;
    }
    const timeline = document.querySelector('#timeline');
    if (!timeline || !previousScrollHeight) {
      return;
    }
    timeline.scrollTop = Math.max(0, timeline.scrollHeight - previousScrollHeight);
  });
}

function findCompleteExchangeStarts(items) {
  const starts = [];
  let userIndex = -1;
  let hasAssistantAnswer = false;
  for (let index = 0; index < items.length; index += 1) {
    const role = items[index]?.role;
    if (role === 'user') {
      if (userIndex >= 0 && hasAssistantAnswer) {
        starts.push(userIndex);
      }
      userIndex = index;
      hasAssistantAnswer = false;
      continue;
    }
    if (role === 'assistant' && userIndex >= 0) {
      hasAssistantAnswer = true;
    }
  }
  if (userIndex >= 0 && hasAssistantAnswer) {
    starts.push(userIndex);
  }
  return starts;
}

function normalizeMessageRole(role) {
  const value = typeof role === 'string' ? role.toLowerCase() : '';
  if (value === 'user' || value === 'assistant') {
    return value;
  }
  return null;
}

function timelineRoleForThreadItem(item) {
  const role = normalizeMessageRole(item.role);
  if (role) {
    return role;
  }
  const type = String(item.type || '').replace(/[^a-z]/giu, '').toLowerCase();
  if (type.includes('reasoning')) {
    return 'assistant';
  }
  if (type.includes('assistant') || type.includes('agent')) {
    return 'assistant';
  }
  if (type.includes('user')) {
    return 'user';
  }
  return null;
}

function sortedSessions() {
  const sessions = filteredSessions();
  if (state.sortMode === 'favorites') {
    return sortedFavoriteSessions();
  }
  return sessions.sort(compareSessionsForSelection);
}

function localSubmissionSessionId(submissionId) {
  return `local-submission:${submissionId}`;
}

function pendingSubmissionSessionSummaries() {
  const knownSessionIds = new Set(state.sessions.map((session) => session.id));
  return pendingSubmissionEntries()
    .filter((entry) => !entry.sessionId || !knownSessionIds.has(entry.sessionId))
    .map((entry) => {
      const project = (Array.isArray(state.projects) ? state.projects : [])
        .find((candidate) => candidate?.id === entry.projectId);
      return {
        id: localSubmissionSessionId(entry.id),
        submissionId: entry.id,
        localSubmission: true,
        deliveryState: entry.status,
        deliveryFailureVisible: submissionFailureIsVisible(entry),
        retryable: entry.retryable,
        projectId: entry.projectId || undefined,
        projectDisplayName: projectVisibleName(project, entry.projectId),
        cwd: entry.cwd,
        firstUserInput: entry.text,
        lastUserInput: entry.text,
        preview: entry.text,
        lastInputAt: entry.updatedAt,
        updatedAt: entry.updatedAt,
        settings: entry.settings,
      };
    });
}

function sessionListCandidates() {
  return [...pendingSubmissionSessionSummaries(), ...state.sessions];
}

function filteredSessions() {
  const sessions = projectScopedSessions();
  if (state.sortMode === 'favorites') {
    return sessions.filter((session) => sessionBelongsToScope(session, 'favorites'));
  }
  if (state.sortMode === 'archived') {
    return sessions.filter((session) => sessionBelongsToScope(session, 'archived'));
  }
  return sessions.filter((session) => sessionBelongsToScope(session, 'all'));
}

function sortedFavoriteSessions() {
  return projectScopedSessions()
    .filter((session) => sessionBelongsToScope(session, 'favorites'))
    .sort(compareSessionsForSelection);
}

function projectScopedSessions() {
  const selectedKey = String(state.selectedProjectKey || '').trim();
  if (!selectedKey) {
    return sessionListCandidates();
  }
  return sessionListCandidates().filter((session) => sessionProjectScope(session).key === selectedKey);
}

function currentProjectScopeTitle() {
  return String(state.selectedProjectLabel || '').trim() || 'All Sessions';
}

function workspaceProjects() {
  const items = new Map();
  for (const project of Array.isArray(state.projects) ? state.projects : []) {
    const id = String(project?.id || '').trim();
    if (!id) {
      continue;
    }
    items.set(id, {
      key: id,
      id,
      label: projectVisibleName(project, id),
      defaultCwd: typeof project?.cwd === 'string' ? project.cwd : '',
      sessionCount: 0,
      latestAt: 0,
      canCreate: project?.canCreate !== false,
      favorite: project?.favorite === true,
      source: 'managed',
    });
  }
  for (const session of sessionListCandidates()) {
    const scope = sessionProjectScope(session);
    if (!scope.key) {
      continue;
    }
    const existing = items.get(scope.key) || {
      key: scope.key,
      id: scope.id,
      label: scope.label,
      defaultCwd: scope.defaultCwd,
      sessionCount: 0,
      latestAt: 0,
      canCreate: Boolean(scope.id),
      favorite: false,
      source: scope.id ? 'managed' : 'legacy',
    };
    existing.label = existing.label || scope.label;
    existing.defaultCwd = existing.defaultCwd || scope.defaultCwd;
    existing.sessionCount += 1;
    existing.latestAt = Math.max(existing.latestAt || 0, scope.latestAt || 0);
    if (!existing.id && scope.id) {
      existing.id = scope.id;
    }
    items.set(scope.key, existing);
  }
  return [...items.values()].sort((left, right) => {
    if (Boolean(right.favorite) !== Boolean(left.favorite)) {
      return Number(Boolean(right.favorite)) - Number(Boolean(left.favorite));
    }
    if (right.sessionCount !== left.sessionCount) {
      return right.sessionCount - left.sessionCount;
    }
    if ((right.latestAt || 0) !== (left.latestAt || 0)) {
      return (right.latestAt || 0) - (left.latestAt || 0);
    }
    return String(left.label || '').localeCompare(String(right.label || ''));
  });
}

function currentSelectedProject() {
  const selectedKey = String(state.selectedProjectKey || '').trim();
  if (!selectedKey) {
    return {
      key: '',
      id: '',
      label: 'All Sessions',
      defaultCwd: '',
      sessionCount: state.sessions.length,
      latestAt: 0,
      canCreate: true,
      favorite: false,
      source: 'all',
    };
  }
  const match = workspaceProjects().find((project) => project.key === selectedKey);
  if (match) {
    if (state.selectedProjectId !== match.id || state.selectedProjectLabel !== match.label) {
      state.selectedProjectId = match.id || '';
      state.selectedProjectLabel = match.label || '';
    }
    return match;
  }
  state.selectedProjectKey = '';
  state.selectedProjectId = '';
  state.selectedProjectLabel = '';
  return currentSelectedProject();
}

function sessionProjectScope(session) {
  const projectId = String(session?.projectId || '').trim();
  const displayName = cwdLeafName(session?.projectDisplayName || '');
  const cwdName = cwdLeafName(session?.cwd || '');
  const projectName = cwdLeafName(session?.projectName || '');
  const legacyLabel = displayName || cwdName || projectName || String(session?.title || '').trim() || 'Untitled Project';
  if (projectId) {
    return {
      key: projectId,
      id: projectId,
      label: displayName || legacyLabel || projectId,
      defaultCwd: typeof session?.cwd === 'string' ? session.cwd : '',
      latestAt: lastInputAtForSession(session),
    };
  }
  const cwd = String(session?.cwd || '').trim();
  const key = cwd ? `cwd:${cwd}` : `legacy:${legacyLabel.toLowerCase()}`;
  return {
    key,
    id: '',
    label: legacyLabel,
    defaultCwd: cwd,
    latestAt: lastInputAtForSession(session),
  };
}

function renderWorkspaceProjectList() {
  const currentKey = String(currentSelectedProject().key || '');
  const entries = [
    {
      key: '',
      id: '',
      label: t('All Sessions'),
      sessionCount: sessionListCandidates().length,
      favorite: false,
      source: 'all',
    },
    ...workspaceProjects(),
  ];
  return entries.map((project) => {
    const isActive = project.key === currentKey;
    const count = project.sessionCount ? String(project.sessionCount) : project.source === 'all' ? String(sessionListCandidates().length) : '0';
    const canFavorite = project.source !== 'all' && Boolean(project.id);
    const favorite = Boolean(project.favorite);
    const favoriteLabel = `${favorite ? 'Unfavorite' : 'Favorite'} ${project.label}`;
    return `
    <div class="project-rail-item${canFavorite ? ' has-favorite-control' : ''}${isActive ? ' is-active' : ''}${favorite ? ' is-favorite' : ''}">
      <button class="project-rail-select-button" type="button" data-project-scope-key="${escapeAttribute(project.key)}" aria-pressed="${String(isActive)}">
        <span class="project-rail-item-main"${project.source === 'all' ? '' : ' data-i18n-skip'}>${escapeHtml(project.label)}</span>
        <span class="project-rail-item-meta">${escapeHtml(count)}</span>
      </button>
      ${canFavorite ? `<button class="project-rail-favorite-button${favorite ? ' is-favorite' : ''}" type="button" data-project-favorite-id="${escapeAttribute(project.id)}" aria-pressed="${String(favorite)}" aria-label="${escapeAttribute(t(favorite ? 'Unfavorite {label}' : 'Favorite {label}', { label: project.label }))}" title="${escapeAttribute(t(favorite ? 'Unfavorite {label}' : 'Favorite {label}', { label: project.label }))}">${favorite ? '★' : '☆'}</button>` : ''}
    </div>
  `;
  }).join('');
}

function renderWorkspaceRailActions({ mobile = false } = {}) {
  const showAdmin = isAdminPrincipal();
  const settingsActive = state.view === 'settings' || state.desktopSettingsOpen;
  if (mobile) {
    return `
    <button class="project-rail-action${settingsActive ? ' is-active' : ''}" type="button" id="open-app-settings-button">Setting</button>
    ${showAdmin ? '<button class="project-rail-action project-rail-admin-action" type="button" id="open-admin-console-button">Admin Console</button>' : ''}
  `;
  }
  return `
    <button class="project-rail-action${settingsActive ? ' is-active' : ''}" type="button" id="open-app-settings-button">Setting</button>
    ${showAdmin ? '<button class="project-rail-action project-rail-admin-action" type="button" id="open-admin-console-button">Admin Console</button>' : ''}
  `;
}

function renderMobileProjectDrawer() {
  if (isDesktopLayout()) {
    return '';
  }
  return `
    <div class="mobile-drawer-backdrop${state.mobileSidebarOpen ? ' is-open' : ''}" id="mobile-drawer-backdrop" aria-hidden="${String(!state.mobileSidebarOpen)}">
      <aside class="mobile-project-drawer${state.mobileSidebarOpen ? ' is-open' : ''}" role="dialog" aria-modal="true" aria-labelledby="mobile-project-drawer-title" data-focus-scope="mobile-projects"${state.mobileSidebarOpen ? '' : ' inert'}>
        <header class="project-rail-header mobile-project-drawer-header">
          <div class="project-rail-brand" id="mobile-project-drawer-title">${escapeHtml(state.siteTitle)}</div>
          <button class="ghost page-back-button" type="button" id="mobile-drawer-close-button" aria-label="Close projects" data-initial-focus>${renderBackButtonIcon()}</button>
        </header>
        <nav class="project-rail-list" data-i18n-skip>
          ${renderWorkspaceProjectList()}
        </nav>
        <div class="project-rail-footer">
          ${renderWorkspaceRailActions({ mobile: true })}
        </div>
      </aside>
    </div>
  `;
}

function setMobileSidebarOpen(open) {
  state.mobileSidebarOpen = Boolean(open);
  const backdrop = document.querySelector('#mobile-drawer-backdrop');
  const drawer = document.querySelector('.mobile-project-drawer');
  backdrop?.classList.toggle('is-open', state.mobileSidebarOpen);
  backdrop?.setAttribute?.('aria-hidden', String(!state.mobileSidebarOpen));
  drawer?.classList.toggle('is-open', state.mobileSidebarOpen);
  if (drawer) {
    drawer.inert = !state.mobileSidebarOpen;
  }
  syncFocusScope();
}

function closeMobileSidebar() {
  requestFocusRestore();
  setMobileSidebarOpen(false);
}

function seedNewSessionTargetFromSelection() {
  if (!state.selectedProjectKey && state.selectedProjectId) {
    applySelectedProjectById(state.selectedProjectId);
  }
  const selectedProject = currentSelectedProject();
  if (isMultiUserMode()) {
    initializeNewProjectSelection();
    if (selectedProject.id && availableProjects().some((project) => project.id === selectedProject.id)) {
      state.newProjectId = selectedProject.id;
    }
    state.newCwd = '';
    return;
  }
  if (selectedProject.defaultCwd) {
    state.newCwd = selectedProject.defaultCwd;
    return;
  }
  state.newCwd = hasProjectChoices() ? '' : state.cwd || '';
}

function applySelectedProjectById(projectId) {
  const normalizedId = String(projectId || '').trim();
  if (!normalizedId) {
    state.selectedProjectKey = '';
    state.selectedProjectId = '';
    state.selectedProjectLabel = '';
    return;
  }
  const match = workspaceProjects().find((project) => project.id === normalizedId || project.key === normalizedId);
  if (match) {
    state.selectedProjectKey = match.key;
    state.selectedProjectId = match.id || normalizedId;
    state.selectedProjectLabel = match.label || normalizedId;
    return;
  }
  const fallback = (Array.isArray(state.projects) ? state.projects : []).find((project) => String(project?.id || '').trim() === normalizedId) || null;
  state.selectedProjectKey = normalizedId;
  state.selectedProjectId = normalizedId;
  state.selectedProjectLabel = projectVisibleName(fallback, normalizedId);
}

function applySelectedLegacyProjectFromCwd(cwd) {
  const normalizedCwd = String(cwd || '').trim();
  if (!normalizedCwd) {
    return;
  }
  state.selectedProjectKey = `cwd:${normalizedCwd}`;
  state.selectedProjectId = '';
  state.selectedProjectLabel = cwdLeafName(normalizedCwd) || normalizedCwd;
}

function resetWorkspaceSessionContext() {
  cancelSessionFileLoad();
  clearSessionFileState();
  sessionFileTimelineSnapshot = null;
  state.sessionId = null;
  state.currentSession = null;
  state.activeSubmissionId = '';
  state.draftSessionActive = false;
  state.cwd = '';
  state.prompt = '';
  state.composerAttachments = [];
  state.timeline = [];
  state.sessionHistoryItems = [];
  state.sessionHistoryStartIndex = 0;
  state.turnId = null;
  state.pendingTurn = false;
  state.settingsOpen = false;
  state.composerExpanded = false;
  resetTurnState();
}

async function selectProjectScope(projectKey) {
  const normalizedKey = String(projectKey || '').trim();
  if (!normalizedKey) {
    state.selectedProjectKey = '';
    state.selectedProjectId = '';
    state.selectedProjectLabel = '';
    state.mobileSidebarOpen = false;
    cancelSessionFileLoad();
    clearSessionFileState();
    sessionFileTimelineSnapshot = null;
    if (!isDesktopLayout()) {
      showSessionList();
      return null;
    }
    state.view = 'sessions';
    render();
    return null;
  }
  const selectedProject = workspaceProjects().find((project) => project.key === normalizedKey) || null;
  state.selectedProjectKey = normalizedKey;
  state.selectedProjectId = selectedProject?.id || '';
  state.selectedProjectLabel = selectedProject?.label || '';
  state.mobileSidebarOpen = false;
  state.archiveConfirmSessionId = null;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  cancelSessionFileLoad();
  clearSessionFileState();
  sessionFileTimelineSnapshot = null;
  if (!isDesktopLayout()) {
    showSessionList();
    return null;
  }
  const [latestSession] = projectScopedSessions()
    .sort(compareSessionsForSelection);
  if (latestSession) {
    await selectSession(latestSession.id);
    return latestSession;
  }
  resetWorkspaceSessionContext();
  openNewSessionPage();
  return null;
}

function uniqueSessionPaths() {
  const paths = [];
  const seen = new Set();
  const sessions = [...state.sessions].sort(compareSessionsForSelection);
  for (const session of sessions) {
    const cwd = session.cwd || '';
    if (!cwd || seen.has(cwd)) {
      continue;
    }
    seen.add(cwd);
    paths.push(cwd);
  }
  return paths;
}

function availableProjects() {
  return Array.isArray(state.projects)
    ? state.projects.filter((project) => project?.id && project.canCreate !== false)
    : [];
}

function hasProjectChoices() {
  return availableProjects().length > 0;
}

function initializeNewProjectSelection() {
  const projects = availableProjects();
  if (!projects.length) {
    state.newProjectId = '';
    return;
  }
  if (!projects.some((project) => project.id === state.newProjectId)) {
    state.newProjectId = projects[0]?.id || '';
  }
}

function currentNewProjectId() {
  initializeNewProjectSelection();
  return state.newProjectId || '';
}

function isReadOnlySession(session) {
  return session?.readOnly === true || session?.mode === 'observer' || session?.mode === 'share';
}

function readOnlyTimelineRestoreOptions(session) {
  return isReadOnlySession(session) ? { fullHistory: true } : {};
}

function setTimelineOpenPositionForSession(session) {
  state.timelineShouldFollowLatest = !isReadOnlySession(session);
}

function scrollTimelineToOpenPositionForSession(session) {
  if (isReadOnlySession(session)) {
    scrollTimelineToTop();
    return;
  }
  scrollTimelineToBottom();
}

function shouldOpenTimelineAtEarliest() {
  return state.view === 'chat'
    && isReadOnlySession(state.currentSession)
    && state.timelineShouldFollowLatest === false;
}

function resetAdminState() {
  state.admin.loading = false;
  state.admin.loaded = false;
  state.admin.settings = null;
  state.admin.projects = [];
  state.admin.users = [];
  state.admin.roles = [];
  state.admin.sessions = [];
  state.admin.page = 'projects';
  state.admin.filterUserId = '';
  state.admin.filterProjectId = '';
  state.admin.filterState = 'all';
  state.admin.editingProjectId = '';
  state.admin.editingRoleId = '';
  state.admin.editingUserId = '';
  state.admin.observedSession = null;
  state.admin.observedSessionLoading = false;
}

function adminSessionsPath(userId = '', projectId = '', filterState = 'all') {
  const normalizedUserId = String(userId || '').trim();
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedState = normalizeAdminSessionState(filterState);
  const params = [];
  if (normalizedUserId) {
    params.push(`userId=${encodeURIComponent(normalizedUserId)}`);
  }
  if (normalizedProjectId) {
    params.push(`projectId=${encodeURIComponent(normalizedProjectId)}`);
  }
  if (normalizedState !== 'all') {
    params.push(`state=${encodeURIComponent(normalizedState)}`);
  }
  const query = params.join('&');
  return query ? `/api/admin/sessions?${query}` : '/api/admin/sessions';
}

function normalizeAdminSessionState(value) {
  return value === 'active' || value === 'archived' ? value : 'all';
}

function normalizeSortMode(mode) {
  if (mode === 'favorites' || mode === 'archived') {
    return mode;
  }
  return 'time';
}

function normalizeSessionScope(scope) {
  if (scope === 'favorites' || scope === 'archived') {
    return scope;
  }
  return 'all';
}

function sessionListPath(scope) {
  if (scope === 'favorites') {
    return '/api/sessions?favorite=true';
  }
  if (scope === 'archived') {
    return '/api/sessions?state=archived';
  }
  return '/api/sessions';
}

function normalizeActiveSessionLimitInput(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return 30;
  }
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
}

function adminUserName(userId) {
  const value = String(userId || '');
  return state.admin.users.find((user) => user.id === value)?.username || value || 'unknown';
}

function adminUserById(userId) {
  const value = String(userId || '').trim();
  return state.admin.users.find((user) => user.id === value) || null;
}

function adminUserMeta(user) {
  const status = user?.enabled === false ? 'disabled' : user?.id || '';
  const roleId = adminUserRoleId(user);
  return [status, user?.email || '', roleId].filter(Boolean).join(' · ');
}

function adminUserRoleId(user) {
  return user?.roleId || (Array.isArray(user?.roleIds) ? user.roleIds[0] : '') || '';
}

function adminUserProjectIds(user) {
  return Array.isArray(user?.directProjectGrants)
    ? user.directProjectGrants.map((grant) => String(grant?.projectId || '').trim()).filter(Boolean)
    : [];
}

function projectVisibleName(project, fallback = '') {
  const displayName = cwdLeafName(String(project?.displayName || '').trim());
  if (displayName) {
    return displayName;
  }
  const cwd = String(project?.cwd || '').trim();
  const cwdName = cwdLeafName(cwd);
  if (cwdName) {
    return cwdName;
  }
  const normalizedFallback = String(fallback || '').trim();
  if (normalizedFallback) {
    return normalizedFallback;
  }
  const id = String(project?.id || '').trim();
  if (id) {
    return id;
  }
  return 'Unknown project';
}

function adminProjectVisibleName(project) {
  return projectVisibleName(project);
}

function adminProjectNameById(projectId, fallback = '') {
  const normalizedId = String(projectId || '').trim();
  const project = state.admin.projects.find((item) => String(item?.id || '').trim() === normalizedId);
  if (project) {
    return adminProjectVisibleName(project);
  }
  const normalizedFallback = String(fallback || '').trim();
  if (normalizedFallback && normalizedFallback !== normalizedId) {
    return normalizedFallback;
  }
  return 'Unknown project';
}

function adminAuditProjects() {
  const byId = new Map();
  for (const project of state.admin.projects) {
    const id = String(project?.id || '').trim();
    if (!id) {
      continue;
    }
    byId.set(id, {
      id,
      displayName: adminProjectVisibleName(project),
    });
  }
  for (const session of state.admin.sessions) {
    const id = String(session?.projectId || '').trim();
    if (!id || byId.has(id)) {
      continue;
    }
    byId.set(id, {
      id,
      displayName: adminProjectNameById(id, session?.projectDisplayName),
    });
  }
  return [...byId.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function sortedAdminSessions() {
  return [...state.admin.sessions].sort(compareAdminSessions);
}

function compareAdminSessions(left, right) {
  return adminSessionSortTime(right) - adminSessionSortTime(left)
    || String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || ''))
    || String(right?.createdAt || '').localeCompare(String(left?.createdAt || ''))
    || String(left?.id || '').localeCompare(String(right?.id || ''));
}

function adminSessionSortTime(session) {
  const updated = Date.parse(String(session?.updatedAt || ''));
  if (Number.isFinite(updated)) {
    return updated;
  }
  const created = Date.parse(String(session?.createdAt || ''));
  return Number.isFinite(created) ? created : 0;
}

function adminEditingProject() {
  const id = String(state.admin.editingProjectId || '');
  return state.admin.projects.find((project) => project.id === id) || null;
}

function adminEditingRole() {
  const id = String(state.admin.editingRoleId || '');
  return state.admin.roles.find((role) => role.id === id) || null;
}

function adminEditingUser() {
  const id = String(state.admin.editingUserId || '');
  return state.admin.users.find((user) => user.id === id) || null;
}

function adminRoleProjectIds(role) {
  return Array.isArray(role?.projectGrants)
    ? role.projectGrants.map((grant) => String(grant?.projectId || '').trim()).filter(Boolean)
    : [];
}

function currentAdminPage() {
  return normalizeAdminPage(state.admin.page);
}

function normalizeAdminPage(page) {
  const value = String(page || '').trim();
  return ['projects', 'roles', 'users', 'sessions'].includes(value) ? value : 'projects';
}

function projectNameForSession(session, fallbackCwd = '') {
  return cwdLeafName(session?.projectDisplayName || '')
    || cwdLeafName(session?.cwd || fallbackCwd)
    || cwdLeafName(session?.projectName || '')
    || String(session?.title || '').trim()
    || 'New Session';
}

function isFavoriteSession(session) {
  return session?.favorite === true || session?.settings?.favorite === true || session?.settings?.metadata?.favorite === true;
}

function normalizeReports(payload) {
  const reports = Array.isArray(payload?.items) ? payload.items : [];
  return reports
    .map(normalizeReport)
    .filter(Boolean);
}

function normalizeSessionFile(file, fallbackPath = '') {
  if (!file || typeof file !== 'object') {
    return null;
  }
  const name = typeof file.name === 'string' && file.name.trim()
    ? file.name.trim()
    : fileNameFromPath(fallbackPath || file.id) || 'file';
  const kind = normalizeSessionFileKind(file.kind, name || fallbackPath);
  return {
    id: typeof file.id === 'string' ? file.id : '',
    name,
    kind,
    mimeType: typeof file.mimeType === 'string' ? file.mimeType : '',
    sizeBytes: Number.isFinite(file.sizeBytes) ? Number(file.sizeBytes) : 0,
    updatedAt: typeof file.updatedAt === 'string' ? file.updatedAt : '',
    source: typeof file.source === 'string' ? file.source : '',
    contentUrl: typeof file.contentUrl === 'string' ? file.contentUrl : '',
    downloadUrl: typeof file.downloadUrl === 'string' ? file.downloadUrl : '',
  };
}

function sessionFilePlaceholder(filePath) {
  return normalizeSessionFile({
    name: fileNameFromPath(filePath),
    kind: sessionFileKindFromPath(filePath),
  }, filePath);
}

function normalizeSessionFileKind(kind, filePath = '') {
  const normalized = String(kind || '').toLowerCase();
  if (['markdown', 'html', 'pdf', 'image', 'file'].includes(normalized)) {
    return normalized;
  }
  return sessionFileKindFromPath(filePath);
}

function sessionFileKindFromPath(filePath) {
  const normalized = String(filePath || '').split(/[?#]/u)[0].toLowerCase();
  if (/\.(?:md|markdown)$/u.test(normalized)) {
    return 'markdown';
  }
  if (/\.html?$/u.test(normalized)) {
    return 'html';
  }
  if (/\.pdf$/u.test(normalized)) {
    return 'pdf';
  }
  if (/\.(?:png|jpe?g|gif|webp|bmp|avif|tiff?)$/u.test(normalized)) {
    return 'image';
  }
  return 'file';
}

function sessionFileMetadata(file) {
  return [
    file?.mimeType || '',
    Number(file?.sizeBytes) > 0 ? formatAttachmentSize(file.sizeBytes) : '',
  ].filter(Boolean).join(' · ');
}

function isSafeSessionFileContentUrl(value) {
  const contentUrl = String(value || '').trim();
  const origin = String(window.location?.origin || '').trim();
  if (!contentUrl || !origin) {
    return false;
  }
  try {
    const resolved = new URL(contentUrl, `${origin}/`);
    return resolved.origin === origin
      && !resolved.username
      && !resolved.password
      && /^\/api\/sessions\/[^/]+\/files\/[^/]+\/content$/u.test(resolved.pathname);
  } catch (_error) {
    return false;
  }
}

function sessionFileProtocolError() {
  const error = new Error('Could not open this file.');
  error.payload = { error: 'invalid_file_response' };
  return error;
}

function sessionFileErrorCode(error) {
  return String(error?.payload?.error || error?.message || 'file_error');
}

function sessionFileErrorMessage(code) {
  if (code === 'file_not_found') {
    return 'File not found.';
  }
  if (code === 'file_access_denied') {
    return 'File access denied.';
  }
  if (code === 'unsupported_file') {
    return 'This file cannot be previewed.';
  }
  if (code === 'file_too_large') {
    return 'This file is too large to open.';
  }
  if (code === 'file_busy') {
    return 'File preview is busy. Try again.';
  }
  return 'Could not open this file.';
}

function decodeSessionFilePath(value) {
  try {
    return decodeURIComponent(String(value || '')).trim();
  } catch (_error) {
    return String(value || '').trim();
  }
}

function createTextFileBlob(content, mimeType = '') {
  if (typeof Blob === 'undefined') {
    return null;
  }
  return new Blob([String(content || '')], { type: mimeType || 'text/plain;charset=utf-8' });
}

function createSessionFileObjectUrl(blob) {
  if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return '';
  }
  return URL.createObjectURL(blob);
}

function revokeSessionFileObjectUrl() {
  const objectUrl = state.currentSessionFileObjectUrl;
  state.currentSessionFileObjectUrl = '';
  if (!objectUrl || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return;
  }
  URL.revokeObjectURL(objectUrl);
}

function normalizeReport(report) {
  if (!report || typeof report.id !== 'string' || !report.id) {
    return null;
  }
  return {
    id: report.id,
    project: typeof report.project === 'string' && report.project ? report.project : reportProjectFromId(report.id),
    title: typeof report.title === 'string' && report.title ? report.title : reportTitleFromId(report.id),
    kind: report.kind === 'html' ? 'html' : 'markdown',
    updatedAt: report.updatedAt || '',
    createdAt: report.createdAt || '',
    sizeBytes: Number.isFinite(report.sizeBytes) ? Number(report.sizeBytes) : 0,
  };
}

function reportTitleFromId(reportId) {
  const file = String(reportId || '').split('/').filter(Boolean).pop() || 'report';
  return file.replace(/\.[^.]+$/u, '');
}

function reportProjectFromId(reportId) {
  return String(reportId || '').split('/').filter(Boolean)[0] || 'reports';
}

function reportKindFromId(reportId) {
  return /\.html?$/iu.test(String(reportId || '')) ? 'html' : 'markdown';
}

function reportFromPath(reportPath) {
  const value = String(reportPath || '');
  const reportRootMarker = '/.codex-web/reports/';
  const markerIndex = value.indexOf(reportRootMarker);
  const reportId = markerIndex >= 0
    ? value.slice(markerIndex + reportRootMarker.length)
    : value.split('/').filter(Boolean).slice(-3).join('/');
  return {
    id: reportId || value,
    title: reportTitleFromId(reportId || value),
    kind: reportKindFromId(reportId || value),
    project: reportProjectFromId(reportId || value),
  };
}

function projectNameFromCwd(cwd) {
  return cwdLeafName(cwd);
}

function cwdLeafName(cwd) {
  const parts = String(cwd || '').split(/[\\/]+/u).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function firstInputForSession(session) {
  return session?.firstUserInput || session?.preview || session?.title || '';
}

function previewInputForSession(session) {
  return session?.lastUserInput || firstInputForSession(session);
}

function lastInputAtForSession(session) {
  return Math.max(session?.lastInputAt || 0, session?.updatedAt || 0);
}

function compareSessionsForSelection(left, right) {
  const leftPriority = sessionAttentionPriority(left);
  const rightPriority = sessionAttentionPriority(right);
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }
  return lastInputAtForSession(right) - lastInputAtForSession(left);
}

function sessionAttentionPriority(session) {
  const activityState = sessionActivityState(session);
  if (activityState === 'waiting_approval') {
    return 2;
  }
  if (activityState === 'running' || findActiveTurn(session)) {
    return 1;
  }
  return 0;
}

function applyPermissionPreset(preset) {
  state.permissionPreset = preset;
  if (preset === 'read-only') {
    state.approvalPolicy = 'never';
    state.sandboxMode = 'read-only';
    return;
  }
  if (preset === 'full-access') {
    state.approvalPolicy = 'never';
    state.sandboxMode = 'danger-full-access';
    return;
  }
  state.approvalPolicy = 'on-request';
  state.sandboxMode = 'workspace-write';
}

function applyDefaultThreadPermissionPreset(settings, preset) {
  settings.accessPreset = preset;
  if (preset === 'read-only') {
    settings.approvalPolicy = 'never';
    settings.sandboxMode = 'read-only';
    return;
  }
  if (preset === 'full-access') {
    settings.approvalPolicy = 'never';
    settings.sandboxMode = 'danger-full-access';
    return;
  }
  settings.approvalPolicy = 'on-request';
  settings.sandboxMode = 'workspace-write';
}

function applyDefaultSettings() {
  const defaults = state.defaultThreadSettings || createDefaultThreadSettings();
  state.model = defaults.model || state.codexConfigDefaults.model || DEFAULT_MODEL;
  const inheritedReasoningEffort = state.model === state.codexConfigDefaults.model
    ? state.codexConfigDefaults.reasoningEffort
    : DEFAULT_REASONING_EFFORT;
  state.reasoningEffort = reasoningEffortForModel(
    state.model,
    defaults.reasoningEffort || inheritedReasoningEffort,
  );
  state.collaborationMode = defaults.collaborationMode || DEFAULT_COLLABORATION_MODE;
  applyPermissionPreset(defaults.accessPreset || DEFAULT_PERMISSION_PRESET);
}

function defaultThreadAccessPreset() {
  return state.defaultThreadSettings?.accessPreset || DEFAULT_PERMISSION_PRESET;
}

function applySessionSettings(session) {
  const settings = session?.settings;
  if (!settings || typeof settings !== 'object' || settings.metadata?.codexWebDefaultsOnly === true || !hasSavedThreadSettings(settings)) {
    applyDefaultSettings();
    return;
  }
  const savedModel = typeof settings.model === 'string' ? settings.model : '';
  const savedReasoningEffort = typeof settings.reasoningEffort === 'string' ? settings.reasoningEffort : '';
  const isLegacyDefault = savedModel === LEGACY_DEFAULT_MODEL
    && savedReasoningEffort === LEGACY_DEFAULT_REASONING_EFFORT
    && (Number(settings.modelDefaultsVersion) || 0) < Number(DEFAULT_THREAD_SETTINGS_VERSION)
    && state.codexConfigDefaults.model
    && state.codexConfigDefaults.model !== LEGACY_DEFAULT_MODEL;
  state.model = isLegacyDefault
    ? state.codexConfigDefaults.model
    : savedModel || state.codexConfigDefaults.model || DEFAULT_MODEL;
  const inheritedReasoningEffort = state.model === state.codexConfigDefaults.model
    ? state.codexConfigDefaults.reasoningEffort
    : DEFAULT_REASONING_EFFORT;
  state.reasoningEffort = reasoningEffortForModel(
    state.model,
    isLegacyDefault ? state.codexConfigDefaults.reasoningEffort : savedReasoningEffort || inheritedReasoningEffort,
  );
  state.collaborationMode = typeof settings.collaborationMode === 'string' && settings.collaborationMode
    ? settings.collaborationMode
    : DEFAULT_COLLABORATION_MODE;
  const preset = typeof settings.accessPreset === 'string' && settings.accessPreset
    ? settings.accessPreset
    : permissionPresetFromSettings(settings);
  state.permissionPreset = preset;
  state.approvalPolicy = typeof settings.approvalPolicy === 'string' && settings.approvalPolicy
    ? settings.approvalPolicy
    : approvalPolicyForPreset(preset);
  state.sandboxMode = typeof settings.sandboxMode === 'string' && settings.sandboxMode
    ? settings.sandboxMode
    : sandboxModeForPreset(preset);
}

function createDefaultThreadSettings() {
  return {
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    collaborationMode: DEFAULT_COLLABORATION_MODE,
    accessPreset: DEFAULT_PERMISSION_PRESET,
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE,
    personality: 'pragmatic',
  };
}

function hasSavedThreadSettings(settings) {
  return ['model', 'reasoningEffort', 'collaborationMode', 'accessPreset', 'approvalPolicy', 'sandboxMode']
    .some((key) => typeof settings[key] === 'string' && settings[key]);
}

function loadDefaultThreadSettings() {
  try {
    return normalizeThreadSettings(JSON.parse(localStorage.getItem(DEFAULT_THREAD_SETTINGS_KEY) || 'null'));
  } catch (_error) {
    return createDefaultThreadSettings();
  }
}

function initializeDefaultThreadSettingsFromCodex(defaults = null) {
  const defaultModel = codexDefaultModelInfo();
  const configModel = normalizeNonEmptyString(defaults?.model);
  const configReasoningEffort = normalizeNonEmptyString(defaults?.reasoningEffort);
  const codexDefaults = {
    model: configModel || modelId(defaultModel),
    reasoningEffort: configReasoningEffort || normalizeNonEmptyString(defaultModel?.defaultReasoningEffort),
  };
  state.codexConfigDefaults = codexDefaults;
  if (!hasSavedDefaultThreadSettings()) {
    state.defaultThreadSettings = normalizeThreadSettings({
      ...createDefaultThreadSettings(),
      ...codexDefaults,
    });
    return;
  }
  if (localStorage.getItem(DEFAULT_THREAD_SETTINGS_VERSION_KEY) === DEFAULT_THREAD_SETTINGS_VERSION) {
    return;
  }
  if (!configModel) {
    return;
  }
  const saved = state.defaultThreadSettings;
  if (
    saved.model === LEGACY_DEFAULT_MODEL
    && saved.reasoningEffort === LEGACY_DEFAULT_REASONING_EFFORT
    && codexDefaults.model
    && codexDefaults.model !== LEGACY_DEFAULT_MODEL
  ) {
    state.defaultThreadSettings = normalizeThreadSettings({
      ...saved,
      ...codexDefaults,
    });
    localStorage.setItem(DEFAULT_THREAD_SETTINGS_KEY, JSON.stringify(state.defaultThreadSettings));
  }
  localStorage.setItem(DEFAULT_THREAD_SETTINGS_VERSION_KEY, DEFAULT_THREAD_SETTINGS_VERSION);
}

function hasSavedDefaultThreadSettings() {
  const raw = localStorage.getItem(DEFAULT_THREAD_SETTINGS_KEY);
  if (!raw) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  } catch (_error) {
    return false;
  }
}

function applyDefaultThreadSettings(patch = {}) {
  const next = normalizeThreadSettings({
    ...state.defaultThreadSettings,
    ...patch,
  });
  next.reasoningEffort = reasoningEffortForModel(next.model, next.reasoningEffort);
  if (typeof patch.accessPreset === 'string') {
    applyDefaultThreadPermissionPreset(next, patch.accessPreset);
  }
  state.defaultThreadSettings = next;
  localStorage.setItem(DEFAULT_THREAD_SETTINGS_KEY, JSON.stringify(next));
  localStorage.setItem(DEFAULT_THREAD_SETTINGS_VERSION_KEY, DEFAULT_THREAD_SETTINGS_VERSION);
  if (!state.sessionId) {
    applyDefaultSettings();
  }
}

function normalizeThreadSettings(value) {
  const next = createDefaultThreadSettings();
  if (!value || typeof value !== 'object') {
    return next;
  }
  if (typeof value.model === 'string' && value.model) {
    next.model = value.model;
  }
  if (typeof value.reasoningEffort === 'string' && value.reasoningEffort.trim()) {
    next.reasoningEffort = value.reasoningEffort.trim();
  }
  if (value.collaborationMode === 'plan' || value.collaborationMode === 'default') {
    next.collaborationMode = value.collaborationMode;
  }
  const preset = ['read-only', 'default', 'full-access'].includes(value.accessPreset)
    ? value.accessPreset
    : DEFAULT_PERMISSION_PRESET;
  applyDefaultThreadPermissionPreset(next, preset);
  return next;
}

function applyTheme(theme, options = {}) {
  const nextTheme = normalizeTheme(theme);
  state.theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  const themeColor = THEMES.find((item) => item.id === nextTheme)?.chromeColor;
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColor && themeColorMeta) {
    themeColorMeta.setAttribute('content', themeColor);
  }
  if (options.persist !== false) {
    localStorage.setItem(THEME_KEY, nextTheme);
  }
}

function applySiteTitle(title, options = {}) {
  const nextTitle = normalizeSiteTitle(title);
  state.siteTitle = nextTitle;
  document.title = nextTitle;
  if (options.persist !== false) {
    localStorage.setItem(SITE_TITLE_KEY, nextTitle);
  }
}

function normalizeSiteTitle(title) {
  const value = String(title || '').trim();
  return value || DEFAULT_SITE_TITLE;
}

function readBootstrapSiteTitle() {
  const element = document.querySelector('#codex-web-bootstrap');
  if (!element) {
    return '';
  }
  try {
    const payload = JSON.parse(element.textContent || '{}');
    return typeof payload?.siteTitle === 'string' ? payload.siteTitle : '';
  } catch (_error) {
    return '';
  }
}

function normalizeTheme(theme) {
  return THEME_IDS.includes(theme) ? theme : DEFAULT_THEME;
}

function normalizeLanguage(language) {
  return SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
}

function translateUi(key, language = state.language, params = {}) {
  const source = String(key || '');
  const dictionary = UI_TRANSLATIONS[normalizeLanguage(language)] || {};
  const template = dictionary[source] || source;
  return Object.entries(params || {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value ?? '')),
    template,
  );
}

function t(key, params = {}) {
  return translateUi(key, state.language, params);
}

function translateText(text) {
  const value = String(text || '');
  if (!value) {
    return '';
  }
  const exact = t(value);
  if (exact !== value) {
    return exact;
  }
  return value
    .replace(/\bObserver Mode\b/gu, t('Observer Mode'))
    .replace(/\bRead only\b/gu, t('Read only'));
}

function localizeUiHtml(html) {
  if (state.language === DEFAULT_LANGUAGE) {
    return String(html || '');
  }
  return localizeUiHtmlOutsideProtectedHtml(String(html || ''));
}

function localizeUiHtmlOutsideProtectedHtml(html) {
  const protectedBlocks = [];
  const protect = (block) => {
    const token = `__CODEX_WEB_I18N_BLOCK_${protectedBlocks.length}__`;
    protectedBlocks.push(block);
    return token;
  };
  const tokenized = protectUiContentBlocks(String(html || ''), protect)
    .replace(/<(pre|code|script|style|iframe)\b[\s\S]*?<\/\1>/giu, protect)
    .replace(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/giu, (_match, attrs, content) => (
      `<textarea${attrs}>${protect(content)}</textarea>`
    ));
  const localized = tokenized
    .replace(/\s(aria-label|title|placeholder)="([^"]*)"/gu, (_match, name, value) => (
      ` ${name}="${escapeAttribute(translateText(unescapeBasicHtml(value)))}"`
    ))
    .replace(/>([^<>]+)</gu, (_match, text) => {
      if (/__CODEX_WEB_I18N_BLOCK_\d+__/u.test(text)) {
        return `>${text}<`;
      }
      if (!text.trim()) {
        return `>${text}<`;
      }
      const leading = text.match(/^\s*/u)?.[0] || '';
      const trailing = text.match(/\s*$/u)?.[0] || '';
      const body = text.slice(leading.length, text.length - trailing.length);
      return `>${leading}${escapeHtml(translateText(unescapeBasicHtml(body)))}${trailing}<`;
    });
  return restoreProtectedUiContentBlocks(localized, protectedBlocks);
}

function restoreProtectedUiContentBlocks(html, protectedBlocks) {
  let result = String(html || '');
  for (let pass = 0; pass <= protectedBlocks.length; pass += 1) {
    const next = result.replace(/__CODEX_WEB_I18N_BLOCK_(\d+)__/gu, (token, index) => (
      protectedBlocks[Number(index)] ?? token
    ));
    if (next === result) {
      return result;
    }
    result = next;
  }
  return result;
}

function protectUiContentBlocks(html, protect) {
  const ranges = findProtectedUiContentRanges(html);
  let nextHtml = String(html || '');
  for (const range of ranges.sort((left, right) => right.start - left.start)) {
    nextHtml = `${nextHtml.slice(0, range.start)}${protect(nextHtml.slice(range.start, range.end))}${nextHtml.slice(range.end)}`;
  }
  return nextHtml;
}

function findProtectedUiContentRanges(html) {
  const ranges = [];
  const stack = [];
  const tagPattern = /<\/?([a-z][\w:-]*)\b[^>]*>/giu;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  let match;
  while ((match = tagPattern.exec(html))) {
    const tag = match[0];
    const tagName = String(match[1] || '').toLowerCase();
    const closing = /^<\//u.test(tag);
    const selfClosing = /\/\s*>$/u.test(tag) || voidTags.has(tagName);
    if (!closing && !selfClosing) {
      stack.push({
        tagName,
        start: match.index,
        protect: hasHtmlAttribute(tag, 'data-i18n-skip') || isProtectedUiContentTag(tagName, tag),
      });
      continue;
    }
    if (!closing) {
      continue;
    }
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].tagName !== tagName) {
        continue;
      }
      const opening = stack.splice(index, 1)[0];
      if (opening.protect) {
        ranges.push({ start: opening.start, end: tagPattern.lastIndex });
      }
      break;
    }
  }
  return ranges
    .sort((left, right) => (left.start - right.start) || (right.end - left.end))
    .filter((range, index, sortedRanges) => (
      !sortedRanges.some((other, otherIndex) => (
        otherIndex < index && other.start <= range.start && range.end <= other.end
      ))
    ));
}

function isProtectedUiContentTag(tagName, tag) {
  if (tagName === 'p') {
    return hasHtmlClass(tag, 'message-text');
  }
  return tagName === 'div'
    && hasHtmlClass(tag, 'markdown-body')
    && hasHtmlClass(tag, 'message-text');
}

function hasHtmlClass(tag, className) {
  const match = String(tag || '').match(/\sclass=(["'])(.*?)\1/iu);
  if (!match) {
    return false;
  }
  return match[2].split(/\s+/u).includes(className);
}

function hasHtmlAttribute(tag, attributeName) {
  const escapedName = String(attributeName || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`\\s${escapedName}(?:\\s|=|>|/)`, 'iu').test(String(tag || ''));
}

function localizeElement(element) {
  if (element?.innerHTML !== undefined) {
    element.innerHTML = localizeUiHtml(element.innerHTML);
  }
  return element;
}

function localizeFragment(html) {
  return localizeUiHtml(html);
}

function unescapeBasicHtml(value) {
  return String(value || '')
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&(times|middot);/gu, (_match, name) => ({
      times: '×',
      middot: '·',
    })[name])
    .replace(/&#x([0-9a-f]+);/giu, (match, codePoint) => decodeHtmlCodePoint(match, codePoint, 16))
    .replace(/&#([0-9]+);/gu, (match, codePoint) => decodeHtmlCodePoint(match, codePoint, 10))
    .replace(/&amp;/gu, '&');
}

function decodeHtmlCodePoint(match, value, radix) {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint)
    && codePoint >= 0
    && codePoint <= 0x10ffff
    && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
    ? String.fromCodePoint(codePoint)
    : match;
}

function applyLanguage(language, options = {}) {
  const nextLanguage = normalizeLanguage(language);
  state.language = nextLanguage;
  document.documentElement.lang = nextLanguage;
  document.documentElement.dataset.language = nextLanguage;
  if (options.persist !== false) {
    localStorage.setItem(LANGUAGE_KEY, nextLanguage);
  }
}

function normalizeMessageFontSize(size) {
  return ['small', 'medium', 'large'].includes(size) ? size : DEFAULT_MESSAGE_FONT_SIZE;
}

function messageFontSizeTokens(size) {
  switch (normalizeMessageFontSize(size)) {
    case 'small':
      return {
        fontSize: '13px',
        headingFontSize: '13px',
      };
    case 'large':
      return {
        fontSize: '17px',
        headingFontSize: '16px',
      };
    default:
      return {
        fontSize: '15px',
        headingFontSize: '14px',
      };
  }
}

function applyMessageFontSize(size, options = {}) {
  const nextSize = normalizeMessageFontSize(size);
  const tokens = messageFontSizeTokens(nextSize);
  state.messageFontSize = nextSize;
  document.documentElement.dataset.messageFontSize = nextSize;
  document.documentElement.style.setProperty('--message-font-size', tokens.fontSize);
  document.documentElement.style.setProperty('--message-heading-font-size', tokens.headingFontSize);
  if (options.persist !== false) {
    localStorage.setItem(MESSAGE_FONT_SIZE_KEY, nextSize);
  }
}

function setMessageFontSize(size) {
  const nextSize = normalizeMessageFontSize(size);
  if (nextSize === state.messageFontSize) {
    return;
  }
  withTimelineBottomOffsetPreserved(() => {
    applyMessageFontSize(nextSize);
    withTimelineScrollPreserved(() => render());
  });
}

function permissionPresetFromSettings(settings) {
  if (settings?.sandboxMode === 'read-only') {
    return 'read-only';
  }
  if (settings?.sandboxMode === 'danger-full-access' || settings?.approvalPolicy === 'never') {
    return 'full-access';
  }
  return 'default';
}

function approvalPolicyForPreset(preset) {
  return preset === 'default' ? 'on-request' : 'never';
}

function sandboxModeForPreset(preset) {
  if (preset === 'read-only') {
    return 'read-only';
  }
  if (preset === 'full-access') {
    return 'danger-full-access';
  }
  return 'workspace-write';
}

async function updateSessionSettings(patch = {}) {
  const settings = {
    ...collectSettings(),
    ...patch,
  };
  settings.reasoningEffort = reasoningEffortForModel(settings.model, settings.reasoningEffort) || null;
  if (!state.sessionId) {
    return null;
  }
  const requestGeneration = authRequestGeneration;
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/settings`, {
      method: 'PATCH',
      body: settings,
    });
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    if (payload?.session) {
      upsertSession(payload.session);
    }
    state.error = '';
    return payload?.session || null;
  } catch (error) {
    if (!isAuthRequestCurrent(requestGeneration)) {
      return null;
    }
    if (handleMissingSession(error, '')) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

function appendMessage(entry) {
  state.timeline.push(entry);
}

function removeAssistantTimelineEntriesForTurn(turnId) {
  if (!turnId) {
    return;
  }
  const liveId = `assistant_${turnId}`;
  const finalId = `${liveId}_final`;
  const historyPrefix = `history_${turnId}_`;
  state.timeline = state.timeline.filter((item) => !(
    item?.kind === 'message'
    && item.role === 'assistant'
    && (item.id === liveId || item.id === finalId || String(item.id || '').startsWith(historyPrefix))
  ));
}

function removeTimelineEntryById(entryId) {
  if (!entryId) {
    return;
  }
  const index = state.timeline.findIndex((item) => item?.id === entryId);
  if (index >= 0) {
    state.timeline.splice(index, 1);
  }
}

function surfaceTimelineError(turnId, message) {
  if (isTurnInterruptTimeoutMessage(message)) {
    state.error = '';
    return;
  }
  appendTimelineError(turnId, message);
  state.error = '';
  if (!state.sessionId) {
    return;
  }
  void persistTimelineError(turnId, message);
}

function appendTimelineError(turnId, message) {
  if (isTurnInterruptTimeoutMessage(message)) {
    return;
  }
  const text = publicRuntimeTurnFailureMessage(message);
  const id = `error_${turnId || Date.now()}`;
  appendOrReplace({
    id,
    kind: 'message',
    role: 'system',
    severity: 'error',
    label: 'Error',
    meta: 'failed',
    text,
  }, (item) => item.id === id, { moveToEnd: true });
}

async function persistTimelineError(turnId, message) {
  if (isTurnInterruptTimeoutMessage(message)) {
    return;
  }
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/timeline`, {
      method: 'POST',
      body: {
        id: `error_${turnId || Date.now()}`,
        role: 'system',
        label: 'Error',
        meta: 'failed',
        text: publicRuntimeTurnFailureMessage(message),
        severity: 'error',
        afterHistoryIndex: currentHydratedHistoryLength(),
      },
    });
  } catch (error) {
    if (handleMissingSession(error, '')) {
      return;
    }
  }
}

function appendOrReplace(entry, matcher, options = {}) {
  const index = state.timeline.findIndex(matcher);
  if (index >= 0) {
    if (options.moveToEnd) {
      state.timeline.splice(index, 1);
      state.timeline.push(entry);
    } else {
      state.timeline[index] = entry;
    }
  } else {
    state.timeline.push(entry);
  }
}

function currentHydratedHistoryLength() {
  if (!state.currentSession) {
    return 0;
  }
  return fullHydratedTimelineFromSession(state.currentSession)
    .filter((item) => item?.kind === 'message' && item?.meta === 'history')
    .length;
}

function collectSettings() {
  const model = state.model || state.codexConfigDefaults.model || null;
  const configuredReasoningEffort = model && model === state.codexConfigDefaults.model
    ? state.codexConfigDefaults.reasoningEffort
    : '';
  return {
    model,
    reasoningEffort: reasoningEffortForModel(
      model,
      state.reasoningEffort || configuredReasoningEffort || DEFAULT_REASONING_EFFORT,
    ) || null,
    collaborationMode: state.collaborationMode || DEFAULT_COLLABORATION_MODE,
    accessPreset: state.permissionPreset || DEFAULT_PERMISSION_PRESET,
    approvalPolicy: state.approvalPolicy || DEFAULT_APPROVAL_POLICY,
    sandboxMode: state.sandboxMode || DEFAULT_SANDBOX_MODE,
    personality: 'pragmatic',
  };
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.warn('[codex-web] service worker registration failed', error);
    });
  });
}

function isStandalonePwa() {
  return window.navigator?.standalone === true
    || navigator.standalone === true
    || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

function setupPwaPullToRefresh() {
  if (!isStandalonePwa()) {
    return;
  }
  if (!window.CodexPullToRefresh || typeof window.CodexPullToRefresh.init !== 'function') {
    return;
  }
  pullToRefreshCleanup = window.CodexPullToRefresh.init({
    root: document.querySelector('#app'),
    getScrollContainer: getActiveScrollContainer,
    threshold: 120,
    onRefresh: (pull) => {
      return handlePwaPullRefresh(pull);
    },
  });
}

function handlePwaPullRefresh(pull = {}) {
  if (state.view === 'chat') {
    if (isTimelinePullTarget(pull.target)) {
      if (showMoreSessionHistory()) {
        return Promise.resolve();
      }
      return Promise.resolve();
    }
    if (isChatTitlePullTarget(pull.target)) {
      return refreshCurrentView();
    }
    return Promise.resolve();
  }
  return refreshCurrentView();
}

function isTimelinePullTarget(target) {
  return Boolean(target?.closest?.('.timeline'));
}

function isChatTitlePullTarget(target) {
  return Boolean(target?.closest?.('.chat-topbar, .project-title'));
}

function getActiveScrollContainer(pull = {}) {
  if (state.view === 'admin') {
    return false;
  }
  if (state.view === 'chat' && isChatTitlePullTarget(pull.target)) {
    return null;
  }
  return document.querySelector('.timeline')
    || document.querySelector('.session-file-viewer')
    || document.querySelector('.session-list')
    || document.querySelector('.new-session-page')
    || document.scrollingElement;
}

function setupEdgeSwipeBackNavigation() {
  document.addEventListener('touchstart', onEdgeSwipeStart, { passive: true });
  document.addEventListener('touchmove', onEdgeSwipeMove, { passive: true });
  document.addEventListener('touchend', onEdgeSwipeEnd, { passive: true });
  document.addEventListener('touchcancel', resetEdgeSwipeNavigation, { passive: true });
}

function onEdgeSwipeStart(event) {
  if (state.view !== 'chat') {
    return;
  }
  if (!event.touches || event.touches.length !== 1) {
    return;
  }
  const touch = event.touches[0];
  if (touch.clientX > EDGE_SWIPE_START_PX) {
    return;
  }
  edgeSwipeStart = {
    x: touch.clientX,
    y: touch.clientY,
    shouldReturn: false,
  };
}

function onEdgeSwipeMove(event) {
  if (!edgeSwipeStart || !event.touches || event.touches.length !== 1) {
    return;
  }
  const touch = event.touches[0];
  const deltaX = touch.clientX - edgeSwipeStart.x;
  const deltaY = Math.abs(touch.clientY - edgeSwipeStart.y);
  if (deltaX < 0 || deltaY > EDGE_SWIPE_MAX_VERTICAL_PX) {
    resetEdgeSwipeNavigation();
    return;
  }
  edgeSwipeStart.shouldReturn = deltaX >= EDGE_SWIPE_TRIGGER_PX;
}

function onEdgeSwipeEnd() {
  const shouldReturn = edgeSwipeStart?.shouldReturn;
  resetEdgeSwipeNavigation();
  if (shouldReturn && state.view === 'chat') {
    showSessionList();
  }
}

function resetEdgeSwipeNavigation() {
  edgeSwipeStart = null;
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    flushScheduledTimelineSave();
    if (state.view === 'chat' && state.sessionId) {
      chatTimelineForegroundSnapshot = captureTimelineViewport();
    }
    if (state.pendingTurn) {
      state.streamWasBackgrounded = true;
    }
    return;
  }
  if (document.visibilityState === 'visible') {
    void checkForAppUpdate();
    void drainSubmissionOutbox();
    void recoverActiveTurnAfterForeground();
  }
}

function onPageResume() {
  if (document.visibilityState === 'hidden') {
    return;
  }
  void checkForAppUpdate();
  void drainSubmissionOutbox();
  void recoverActiveTurnAfterForeground();
}

function onNetworkOnline() {
  void drainSubmissionOutbox({ force: true });
  cancelStreamReconnect();
  void recoverActiveTurnIfStreamUnhealthy({ forceReconnect: true, reconcile: true });
}

function setupAppVersionRefresh() {
  if (!isStandalonePwa()) {
    return;
  }
  window.addEventListener('load', () => {
    void checkForAppUpdate();
  });
}

function checkForAppUpdate() {
  if (!isStandalonePwa()) {
    return Promise.resolve();
  }
  if (appVersionCheckPromise) {
    return appVersionCheckPromise;
  }
  const now = Date.now();
  if (now - lastAppVersionCheckAt < APP_VERSION_CHECK_COOLDOWN_MS) {
    return Promise.resolve();
  }
  lastAppVersionCheckAt = now;
  appVersionCheckPromise = checkForAppUpdateOnce().finally(() => {
    appVersionCheckPromise = null;
  });
  return appVersionCheckPromise;
}

async function checkForAppUpdateOnce() {
  try {
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    const buildId = typeof payload?.buildId === 'string' ? payload.buildId.trim() : '';
    if (buildId && buildId !== APP_BUILD_ID) {
      window.location.reload();
    }
  } catch (_error) {
  }
}

function isTurnStreamHealthy() {
  if (!state.pendingTurn || !state.turnId) {
    return true;
  }
  if (!state.streamAbortController || state.streamWasBackgrounded) {
    return false;
  }
  return Date.now() - (state.lastTurnEventAt || 0) < STREAM_STALE_MS;
}

function connectActiveTurnStream({ forceReconnect = false } = {}) {
  const turnId = String(state.turnId || '').trim();
  if (!state.token || !state.authSession || !state.sessionId || !state.pendingTurn || !turnId || isShareContext()) {
    return false;
  }
  if (document.visibilityState === 'hidden' || navigator.onLine === false) {
    markStreamPaused();
    return false;
  }
  restoreTurnEventCursor(state.sessionId, turnId, { onlyIfUnset: true });
  const sameStream = state.streamAbortController && activeStreamTurnId === turnId;
  if (sameStream && !forceReconnect) {
    return true;
  }
  cancelStreamReconnect();
  void streamTurnEvents(turnId, { forceReconnect });
  return true;
}

function recoverActiveTurnAfterForeground() {
  if (!state.authSession || !state.sessionId || isPassivelySelectedDesktopSession() || isShareContext()) {
    return Promise.resolve(null);
  }
  const viewportSnapshot = isDesktopWorkspaceView()
    ? latestTimelineViewportSnapshot()
    : rememberedTimelineViewport()
      || chatTimelineForegroundSnapshot
      || latestTimelineViewportSnapshot();
  return recoverActiveTurnIfStreamUnhealthy({
    viewportSnapshot,
    forceReconnect: state.streamWasBackgrounded || !isTurnStreamHealthy(),
    reconcile: true,
  });
}

function setupStreamRecoveryWatchdog() {
  if (streamRecoveryTimer || typeof setInterval !== 'function') {
    return;
  }
  streamRecoveryTimer = setInterval(() => {
    void recoverActiveTurnIfStreamUnhealthy({ reconcile: false });
  }, STREAM_RECOVERY_CHECK_MS);
}

async function recoverActiveTurnIfStreamUnhealthy({
  viewportSnapshot = null,
  forceReconnect = false,
  reconcile = true,
} = {}) {
  if (streamRecoveryPromise) {
    return streamRecoveryPromise;
  }
  streamRecoveryPromise = recoverActiveTurnIfStreamUnhealthyOnce({
    viewportSnapshot,
    forceReconnect,
    reconcile,
  })
    .finally(() => {
      streamRecoveryPromise = null;
    });
  return streamRecoveryPromise;
}

async function recoverActiveTurnIfStreamUnhealthyOnce({
  viewportSnapshot = null,
  forceReconnect = false,
  reconcile = true,
} = {}) {
  if (!state.authSession || !state.sessionId || isPassivelySelectedDesktopSession() || isShareContext()) {
    return null;
  }
  if (document.visibilityState === 'hidden') {
    return null;
  }
  const shouldReconnect = state.pendingTurn
    && state.turnId
    && (forceReconnect || !isTurnStreamHealthy());
  if (shouldReconnect) {
    connectActiveTurnStream({ forceReconnect: true });
  } else if (!reconcile) {
    return null;
  }
  const snapshot = viewportSnapshot || (isDesktopWorkspaceView()
    ? latestTimelineViewportSnapshot()
    : rememberedTimelineViewport()
      || latestTimelineViewportSnapshot());
  const session = reconcile
    ? await reconcileCurrentSessionInBackground({ viewportSnapshot: snapshot })
    : null;
  chatTimelineForegroundSnapshot = null;
  if (state.pendingTurn && state.turnId && !isTurnStreamHealthy()) {
    connectActiveTurnStream({ forceReconnect: true });
  }
  return session;
}

function isPassivelySelectedDesktopSession() {
  return Boolean(
    isDesktopWorkspaceView()
    && passiveDesktopSessionId
    && passiveDesktopSessionId === state.sessionId,
  );
}

function reconcileCurrentSessionInBackground({ viewportSnapshot = null, forceDetail = false } = {}) {
  if (!state.authSession || !state.sessionId || isShareContext()) {
    return Promise.resolve(null);
  }
  if (sessionReconcilePromise) {
    if (forceDetail && !sessionReconcileForceDetail) {
      return sessionReconcilePromise.then(() => reconcileCurrentSessionInBackground({
        viewportSnapshot,
        forceDetail: true,
      }));
    }
    return sessionReconcilePromise;
  }
  const controller = new AbortController();
  const timer = scheduleNetworkTimer(() => controller.abort(), SESSION_RECONCILE_TIMEOUT_MS);
  sessionReconcileForceDetail = forceDetail;
  const operation = forceDetail
    ? refreshCurrentSessionMetadata({
      hydrateTimeline: true,
      viewportSnapshot,
      signal: controller.signal,
      forceDetail: true,
    })
    : refreshCurrentSessionMetadata({
      hydrateTimeline: true,
      viewportSnapshot,
      signal: controller.signal,
    });
  const promise = operation.finally(() => {
    clearNetworkTimer(timer);
    if (sessionReconcilePromise === promise) {
      sessionReconcilePromise = null;
      sessionReconcileForceDetail = false;
    }
  });
  sessionReconcilePromise = promise;
  return promise;
}

function scheduleStreamReconnect({ immediate = false } = {}) {
  if (streamReconnectTimer || !state.pendingTurn || !state.turnId || !state.sessionId) {
    return;
  }
  if (document.visibilityState === 'hidden' || navigator.onLine === false) {
    return;
  }
  const attempt = streamReconnectAttempt;
  const baseDelay = Math.min(STREAM_RETRY_MAX_MS, STREAM_RETRY_BASE_MS * (2 ** Math.min(attempt, 8)));
  const jitter = 1 + ((Math.random() * 2 - 1) * STREAM_RETRY_JITTER);
  const delay = immediate ? 0 : Math.max(0, Math.round(baseDelay * jitter));
  const sessionId = state.sessionId;
  const turnId = state.turnId;
  streamReconnectAttempt += 1;
  streamReconnectTimer = scheduleNetworkTimer(() => {
    streamReconnectTimer = null;
    if (state.sessionId !== sessionId || state.turnId !== turnId || !state.pendingTurn) {
      return;
    }
    void recoverActiveTurnIfStreamUnhealthy({ forceReconnect: true, reconcile: false });
  }, delay);
}

function cancelStreamReconnect() {
  if (!streamReconnectTimer) {
    return;
  }
  clearNetworkTimer(streamReconnectTimer);
  streamReconnectTimer = null;
}

function scheduleNetworkTimer(callback, delay) {
  const schedule = typeof window?.setTimeout === 'function' ? window.setTimeout.bind(window) : setTimeout;
  const timer = schedule(callback, delay);
  timer?.unref?.();
  return timer;
}

function clearNetworkTimer(timer) {
  if (timer == null) {
    return;
  }
  const clear = typeof window?.clearTimeout === 'function' ? window.clearTimeout.bind(window) : clearTimeout;
  clear(timer);
}

function stopStream({ preserveRetryState = false } = {}) {
  if (!preserveRetryState) {
    cancelStreamReconnect();
    streamReconnectAttempt = 0;
  }
  if (state.streamAbortController) {
    state.streamAbortController.abort();
    state.streamAbortController = null;
  }
  activeStreamTurnId = '';
  state.streamIncludesWorkDetails = false;
}

function isNetworkStreamError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /load failed|network|fetch|terminated|abort|connection|offline/i.test(message);
}

function isRetryableStreamError(error) {
  return isNetworkStreamError(error);
}

async function apiFetch(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.skipAuth ? {} : state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...options.headers,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function buildApiError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
  }
  const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  error.status = response.status;
  error.payload = payload;
  return error;
}

function handleApiError(error, options = {}) {
  const payload = error?.payload || null;
  const code = payload?.error;
  const message = payload?.message || error?.message || 'Request failed';
  if (isTurnInterruptTimeoutMessage(message)) {
    state.error = '';
    if (state.pendingTurn) {
      state.status = 'Turn running';
      state.statusTone = 'warn';
    } else if (state.statusTone === 'danger') {
      state.status = 'Ready';
      state.statusTone = 'success';
    }
    render();
    return;
  }
  if (code === 'setup_required') {
    state.setupRequired = true;
    state.setupMessage = message;
    localStorage.removeItem(TOKEN_KEY);
    state.token = '';
    stopStream();
    render();
    return;
  }
  if (error?.status === 401 || (options.auth && error?.status === 403)) {
    localStorage.removeItem(TOKEN_KEY);
    state.token = '';
    state.setupRequired = false;
    setLoggedOut(options.login ? message : 'Session expired');
    return;
  }
  state.error = options.suppressComposerError ? '' : message;
  if (options.login) {
    state.loginError = message;
    state.status = 'Login required';
    state.statusTone = 'danger';
  } else {
    state.status = 'Request failed';
    state.statusTone = 'danger';
  }
  render();
}

function inferDeviceName() {
  return navigator.userAgent.includes('iPhone')
    ? 'iPhone Safari'
    : navigator.userAgent.includes('Android')
      ? 'Android Browser'
      : 'Phone browser';
}

function scrollTimelineToBottom() {
  const apply = () => {
    const timeline = document.querySelector('#timeline');
    if (timeline) {
      timeline.scrollTop = timeline.scrollHeight;
      state.timelineShouldFollowLatest = true;
      rememberCurrentTimelineViewport();
    }
  };
  apply();
  requestAnimationFrame(apply);
}

function scrollTimelineToTop() {
  requestAnimationFrame(() => {
    const timeline = document.querySelector('#timeline');
    if (timeline) {
      timeline.scrollTop = 0;
      state.timelineShouldFollowLatest = false;
      rememberCurrentTimelineViewport();
    }
  });
}

function rememberCurrentTimelineViewport() {
  if (!state.sessionId || (!isDesktopWorkspaceView() && state.view !== 'chat')) {
    return;
  }
  const snapshot = captureTimelineViewport();
  chatTimelineViewportSnapshot = {
    ...snapshot,
    sessionId: state.sessionId,
  };
}

function rememberedTimelineViewport() {
  if (!state.sessionId || chatTimelineViewportSnapshot?.sessionId !== state.sessionId) {
    return null;
  }
  const { sessionId: _sessionId, ...snapshot } = chatTimelineViewportSnapshot;
  return { ...snapshot };
}

function startCase(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function formatSummaryValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join(', ');
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatShortDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatShortDateTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shorten(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function renderMarkdown(value) {
  const text = String(value || '').replace(/\r\n?/gu, '\n');
  const lines = text.split('\n');
  const blocks = [];
  let paragraph = [];
  let listItems = [];
  let quoteLines = [];
  let codeLines = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };
  const flushQuote = () => {
    if (!quoteLines.length) {
      return;
    }
    blocks.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join('')}</blockquote>`);
    quoteLines = [];
  };
  const flushCode = () => {
    blocks.push(`<pre><code>${escapeHtml(`${codeLines.join('\n')}\n`)}</code></pre>`);
    codeLines = [];
  };
  const flushTextBlocks = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/u.test(line.trim())) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushTextBlocks();
        inCode = true;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushTextBlocks();
      continue;
    }
    const table = parseMarkdownTable(lines, index);
    if (table) {
      flushTextBlocks();
      blocks.push(renderMarkdownTable(table.header, table.rows, table.alignments));
      index = table.lastLineIndex;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      flushTextBlocks();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = line.match(/^\s*[-*]\s+(.+)$/u);
    if (listItem) {
      flushParagraph();
      flushQuote();
      listItems.push(listItem[1]);
      continue;
    }
    const quote = line.match(/^>\s?(.+)$/u);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  if (inCode) {
    flushCode();
  } else {
    flushTextBlocks();
  }
  return blocks.join('');
}

function parseMarkdownTable(lines, startIndex) {
  const header = parseMarkdownTableRow(lines[startIndex]);
  if (!header || startIndex + 1 >= lines.length) {
    return null;
  }
  const alignments = parseMarkdownTableDivider(lines[startIndex + 1], header.length);
  if (!alignments) {
    return null;
  }

  const rows = [];
  let cursor = startIndex + 2;
  while (cursor < lines.length) {
    const row = parseMarkdownTableRow(lines[cursor]);
    if (!row || row.length !== header.length) {
      break;
    }
    rows.push(row);
    cursor += 1;
  }

  return {
    header,
    alignments,
    rows,
    lastLineIndex: cursor - 1,
  };
}

function parseMarkdownTableRow(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || !trimmed.includes('|')) {
    return null;
  }
  const cells = [];
  let current = '';
  let index = trimmed.startsWith('|') ? 1 : 0;
  let codeDelimiterLength = 0;
  let endedWithDelimiter = false;

  while (index < trimmed.length) {
    const character = trimmed[index];
    const nextCharacter = trimmed[index + 1];
    if (codeDelimiterLength === 0 && character === '\\' && nextCharacter === '|') {
      current += '|';
      index += 2;
      endedWithDelimiter = false;
      continue;
    }
    if (character === '`') {
      const runLength = countRepeatedCharacter(trimmed, index, '`');
      if (codeDelimiterLength === 0) {
        codeDelimiterLength = runLength;
      } else if (runLength === codeDelimiterLength) {
        codeDelimiterLength = 0;
      }
      current += '`'.repeat(runLength);
      index += runLength;
      endedWithDelimiter = false;
      continue;
    }
    if (codeDelimiterLength === 0 && character === '|') {
      cells.push(current.trim());
      current = '';
      index += 1;
      endedWithDelimiter = true;
      continue;
    }
    current += character;
    index += 1;
    endedWithDelimiter = false;
  }
  if (!endedWithDelimiter || current.length > 0) {
    cells.push(current.trim());
  }
  if (cells.length < 2) {
    return null;
  }
  return cells;
}

function countRepeatedCharacter(value, startIndex, character) {
  let index = startIndex;
  while (index < value.length && value[index] === character) {
    index += 1;
  }
  return index - startIndex;
}

function parseMarkdownTableDivider(line, expectedColumns) {
  const cells = parseMarkdownTableRow(line);
  if (!cells || cells.length !== expectedColumns) {
    return null;
  }
  const alignments = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/u.test(cell)) {
      return null;
    }
    const leftAligned = cell.startsWith(':');
    const rightAligned = cell.endsWith(':');
    if (leftAligned && rightAligned) {
      alignments.push('center');
    } else if (rightAligned) {
      alignments.push('right');
    } else {
      alignments.push('left');
    }
  }
  return alignments;
}

function renderMarkdownTable(header, rows, alignments = []) {
  const getAlignmentStyle = (index) => ` style="text-align: ${escapeAttribute(alignments[index] || 'left')};"`;
  const headHtml = header.map((cell, index) => `<th${getAlignmentStyle(index)}>${renderInlineMarkdown(cell)}</th>`).join('');
  const bodyHtml = rows.map((row) => `<tr>${row.map((cell, index) => `<td${getAlignmentStyle(index)}>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('');
  return `<div class="markdown-table"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function renderInlineMarkdown(value) {
  const tokens = [];
  const reserve = (html) => {
    const token = `\u0001${tokens.length}\u0002`;
    tokens.push(html);
    return token;
  };
  let source = String(value || '');
  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (match, label, href) => {
    const decodedHref = decodeHtmlEntityText(href);
    if (/^https?:\/\//iu.test(decodedHref)) {
      return reserve(`<a href="${escapeAttribute(decodedHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
    }
    if (isSessionFilePath(decodedHref) && canRenderSessionFileLink(decodedHref)) {
      return reserve(renderSessionFileLink(escapeHtml(label), decodedHref));
    }
    return match;
  });
  source = source.replace(/`([^`]+)`/gu, (_match, code) => {
    return reserve(`<code>${linkPlainSessionFilePaths(escapeHtml(code))}</code>`);
  });
  let html = escapeHtml(source)
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/gu, '<em>$1</em>');
  html = linkPlainSessionFilePaths(html);
  return html.replace(/\u0001(\d+)\u0002/gu, (_match, index) => tokens[Number(index)] || '');
}

function linkPlainSessionFilePaths(html) {
  return String(html || '').replace(
    /(^|[\s:：>（(])((?:(?:~?\/|\.\.?\/)?(?:[^\s\/<>"'`()]+\/)*[^\s\/<>"'`(),，。！？!?；;]+\.(?:md|markdown|html?|pdf|png|jpe?g|gif|webp|bmp|avif|tiff?)))(?=$|[\s<),，。！？!?；;:：])/giu,
    (_match, prefix, filePath) => {
      if (!isSessionFilePath(filePath) || !canRenderSessionFileLink(filePath)) {
        return `${prefix}${filePath}`;
      }
      return `${prefix}${renderSessionFileLink(filePath, filePath)}`;
    },
  );
}

function renderSessionFileLink(label, href) {
  const filePath = decodeHtmlEntityText(href);
  return `<a href="#" class="session-file-link" data-session-file-path="${escapeAttribute(filePath)}">${label}</a>`;
}

function isSessionFilePath(value) {
  const filePath = stripSessionFileLocationSuffix(decodeHtmlEntityText(value).trim());
  if (!filePath || /^(?:[a-z][a-z\d+.-]*:|#)/iu.test(filePath)) {
    return false;
  }
  return /\.(?:md|markdown|html?|pdf|png|jpe?g|gif|webp|bmp|avif|tiff?|[cm]?[jt]sx?|jsonc?|ya?ml|toml|css|scss|less|sh|bash|zsh|fish|py|rb|rs|go|java|kt|swift|c|cc|cpp|h|hpp)(?:[?#][^\s]*)?$/iu.test(filePath);
}

function stripSessionFileLocationSuffix(value) {
  return String(value || '').replace(/:\d+(?::\d+)?$/u, '');
}

function canRenderSessionFileLink(value) {
  return !isShareContext() || isLegacyReportPath(value);
}

function isLegacyReportPath(value) {
  return /(?:^|[\\/])\.codex-web[\\/]reports[\\/].+\.(?:md|markdown|html?)$/iu.test(decodeHtmlEntityText(value));
}

function decodeHtmlEntityText(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
