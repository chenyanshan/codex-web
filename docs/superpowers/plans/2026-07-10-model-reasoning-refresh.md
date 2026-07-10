# Model And Reasoning Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh model-dependent reasoning controls immediately, honor saved browser-local `gpt-5.6-sol + ultra` defaults, keep dynamic option labels untranslated, and document the complete macOS upgrade flow.

**Architecture:** Keep the existing dynamic `/api/models` contract and reasoning normalization functions. Fix the active-session model change at the UI event boundary by rendering after state normalization, remove translation from provider-owned option labels, and preserve the existing browser-local default settings data flow. Document that repository and Codex runtime upgrades are separate concerns.

**Tech Stack:** Browser JavaScript, Node.js test runner with `tsx`, TypeScript test harness, Markdown documentation.

---

### Task 1: Refresh Active-Session Reasoning Options On Model Change

**Files:**
- Modify: `packages/codex-web/test/public_ui.test.ts:1748`
- Modify: `packages/codex-web/test/public_ui.test.ts:10033`
- Modify: `packages/codex-web/public/app.js:3450`

- [ ] **Step 1: Extend the UI harness to materialize select controls**

Add this helper after `createElementFromHtml` in `loadAppHarness()`:

```ts
  const materializeSelectFromHtml = (html, id) => {
    const selector = `#${id}`;
    elements.delete(selector);
    const escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = String(html || '').match(new RegExp(
      `<select\\b[^>]*id="${escapedId}"[^>]*>([\\s\\S]*?)<\\/select>`,
      'u',
    ));
    if (!match) {
      return;
    }
    const openingTag = match[0].match(/^<select\b[^>]*>/u)?.[0] || '';
    const optionsHtml = match[1] || '';
    const selectedValue = optionsHtml.match(/<option\b[^>]*value="([^"]*)"[^>]*\sselected(?:\s|>)/u)?.[1]
      || optionsHtml.match(/<option\b[^>]*value="([^"]*)"/u)?.[1]
      || '';
    trackElement(selector, createElementFromHtml(selector, openingTag, {
      innerHTML: optionsHtml,
      value: selectedValue,
    }));
  };
```

Call it at the start of `materializeAppHtml()`:

```ts
    materializeSelectFromHtml(html, 'model-select');
    materializeSelectFromHtml(html, 'reasoning-select');
```

- [ ] **Step 2: Write the failing interaction test**

Add this test after `reasoning options follow the selected model metadata`:

```ts
test('changing an active session model refreshes reasoning options immediately', async () => {
  const fetchCalls = [];
  const { api, context } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_model',
            cwd: '/repo',
            settings: JSON.parse(options.body),
          },
        }),
      };
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_model';
  api.state.currentSession = { id: 'session_model', cwd: '/repo', settings: {} };
  api.state.sessions = [api.state.currentSession];
  api.state.settingsOpen = true;
  api.state.models = [
    {
      id: 'gpt-5.4',
      displayName: 'GPT-5.4',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'xhigh',
    },
    {
      id: 'gpt-5.6-sol',
      displayName: 'GPT-5.6-Sol',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultReasoningEffort: 'low',
    },
  ];
  api.state.model = 'gpt-5.4';
  api.state.reasoningEffort = 'xhigh';
  api.render();

  const renderCount = context.__appRenderCount;
  const modelSelect = context.document.querySelector('#model-select');
  assert.ok(modelSelect);
  assert.doesNotMatch(context.document.querySelector('#reasoning-select').innerHTML, /value="ultra"/u);

  modelSelect.value = 'gpt-5.6-sol';
  modelSelect.__listeners.get('change')?.({ target: modelSelect });

  const reasoningSelect = context.document.querySelector('#reasoning-select');
  assert.ok(context.__appRenderCount > renderCount);
  assert.match(reasoningSelect.innerHTML, /value="max"/u);
  assert.match(reasoningSelect.innerHTML, /value="ultra"/u);
  assert.match(reasoningSelect.innerHTML, /value="xhigh" selected/u);
  assert.equal(api.state.reasoningEffort, 'xhigh');
  assert.equal(fetchCalls[0]?.path, '/api/sessions/session_model/settings');
});
```

- [ ] **Step 3: Run the interaction test and verify RED**

Run:

```bash
node --import tsx --test \
  --test-name-pattern='changing an active session model refreshes reasoning options immediately' \
  packages/codex-web/test/public_ui.test.ts
```

Expected: FAIL because the render count does not increase and the existing reasoning select does not contain `ultra`.

- [ ] **Step 4: Render immediately after normalizing the new model**

Change the active-session model listener in `packages/codex-web/public/app.js` to:

```js
  const modelSelect = document.querySelector('#model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', (event) => {
      state.model = event.target.value;
      state.reasoningEffort = reasoningEffortForModel(state.model, state.reasoningEffort);
      render();
      void updateSessionSettings();
    });
  }
```

- [ ] **Step 5: Run the interaction test and verify GREEN**

Run the command from Step 3.

Expected: PASS with `xhigh` selected and `max` plus `ultra` present immediately.

- [ ] **Step 6: Commit the active-session fix**

```bash
git add packages/codex-web/public/app.js packages/codex-web/test/public_ui.test.ts
git commit -m "fix: refresh reasoning options on model change"
```

### Task 2: Preserve Ultra Defaults And Keep Dynamic Labels Untranslated

**Files:**
- Modify: `packages/codex-web/test/public_ui.test.ts:193`
- Modify: `packages/codex-web/test/public_ui.test.ts:1894`
- Modify: `packages/codex-web/public/app.js:2448`
- Modify: `packages/codex-web/public/app.js:2902`

- [ ] **Step 1: Add a browser-local default characterization test**

Add this test after `saved Codex Web default thread settings override Codex model defaults`:

```ts
test('saved gpt-5.6-sol ultra defaults seed the new session request', async () => {
  let createBody = null;
  const savedDefaults = {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
    collaborationMode: 'default',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    personality: 'pragmatic',
  };
  const { api } = await loadAppHarness({
    storage: {
      codexWebDefaultThreadSettings: JSON.stringify(savedDefaults),
    },
    fetch: async (path, options = {}) => {
      if (path === '/api/sessions' && options.method === 'POST') {
        createBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_ultra',
              cwd: '/repo',
              settings: createBody.settings,
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });
  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.cwd = '/repo';
  api.state.models = [{
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6-Sol',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    defaultReasoningEffort: 'low',
  }];
  api.applyDefaultSettings();

  await api.ensureSession();

  assert.equal(createBody.settings.model, 'gpt-5.6-sol');
  assert.equal(createBody.settings.reasoningEffort, 'ultra');
});
```

- [ ] **Step 2: Run the default characterization test**

Run:

```bash
node --import tsx --test \
  --test-name-pattern='saved gpt-5.6-sol ultra defaults seed the new session request' \
  packages/codex-web/test/public_ui.test.ts
```

Expected: PASS, confirming the existing browser-local default data flow already reaches the create-session request.

- [ ] **Step 3: Write the failing Chinese localization test**

Add this test after `Chinese language setting localizes settings, chat, and admin management UI`:

```ts
test('Chinese UI keeps model and reasoning option labels untranslated', async () => {
  const { api } = await loadAppHarness();
  api.applyLanguage('zh-CN');
  api.state.models = [{
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6-Sol',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    defaultReasoningEffort: 'low',
  }];
  api.state.defaultThreadSettings.model = 'gpt-5.6-sol';
  api.state.defaultThreadSettings.reasoningEffort = 'ultra';
  api.state.model = 'gpt-5.6-sol';
  api.state.reasoningEffort = 'xhigh';

  const defaultHtml = api.renderAppSettings().innerHTML;
  const defaultReasoning = defaultHtml.match(/<select id="default-reasoning-select"[\s\S]*?<\/select>/u)?.[0] || '';
  const sessionHtml = api.renderSettingsDrawer();
  const sessionReasoning = sessionHtml.match(/<select id="reasoning-select"[\s\S]*?<\/select>/u)?.[0] || '';

  assert.match(defaultHtml, /<label for="default-model-select">模型<\/label>/u);
  assert.match(defaultHtml, /<label for="default-reasoning-select">推理<\/label>/u);
  assert.match(defaultReasoning, />Medium<\/option>/u);
  assert.match(defaultReasoning, />xhigh<\/option>/u);
  assert.match(defaultReasoning, />Ultra<\/option>/u);
  assert.doesNotMatch(defaultReasoning, />中<\/option>|>极高<\/option>/u);
  assert.match(sessionHtml, /<select id="model-select" name="model" data-i18n-skip>/u);
  assert.match(sessionHtml, /<select id="reasoning-select" name="reasoningEffort" data-i18n-skip>/u);
  assert.match(sessionReasoning, />Medium<\/option>/u);
  assert.match(sessionReasoning, />xhigh<\/option>/u);
  assert.match(sessionReasoning, />Ultra<\/option>/u);
  assert.doesNotMatch(sessionReasoning, />中<\/option>|>极高<\/option>/u);
});
```

- [ ] **Step 4: Run the localization test and verify RED**

Run:

```bash
node --import tsx --test \
  --test-name-pattern='Chinese UI keeps model and reasoning option labels untranslated' \
  packages/codex-web/test/public_ui.test.ts
```

Expected: FAIL because `Medium` and `xhigh` are translated and the active-session selects lack `data-i18n-skip`.

- [ ] **Step 5: Mark active selects as dynamic content and stop translating efforts**

Update the active-session controls to:

```js
          <select id="model-select" name="model" data-i18n-skip>${renderModelOptions()}</select>
```

```js
          <select id="reasoning-select" name="reasoningEffort" data-i18n-skip>
```

Update `renderOptions()` to keep the English display label:

```js
function renderOptions(values, current) {
  return values.map((value) => {
    const selected = value === current ? ' selected' : '';
    const label = value === 'xhigh' ? 'xhigh' : startCase(value);
    return `<option value="${escapeAttribute(value)}"${selected} data-i18n-skip>${escapeHtml(label)}</option>`;
  }).join('');
}
```

- [ ] **Step 6: Run both Task 2 tests and verify GREEN**

Run:

```bash
node --import tsx --test \
  --test-name-pattern='saved gpt-5.6-sol ultra defaults|Chinese UI keeps model and reasoning option labels untranslated' \
  packages/codex-web/test/public_ui.test.ts
```

Expected: both tests PASS.

- [ ] **Step 7: Commit default and localization coverage**

```bash
git add packages/codex-web/public/app.js packages/codex-web/test/public_ui.test.ts
git commit -m "fix: keep dynamic model settings untranslated"
```

### Task 3: Document Cross-Machine Upgrade Requirements

**Files:**
- Modify: `packages/codex-web/test/install_docs.test.ts:30`
- Modify: `README.md:301`
- Modify: `README.zh-CN.md:279`

- [ ] **Step 1: Write the failing documentation test**

Extend `README files point AI installers to install.md and include PWA setup guidance` with:

```ts
  assert.match(readme, /git pull --ff-only[\s\S]*npm install[\s\S]*restart-codex-web-launchd-user\.sh/u);
  assert.match(readme, /CODEX_REAL_BIN[\s\S]*ultra/iu);
```

```ts
  assert.match(readmeZh, /git pull --ff-only[\s\S]*npm install[\s\S]*restart-codex-web-launchd-user\.sh/u);
  assert.match(readmeZh, /CODEX_REAL_BIN[\s\S]*ultra/iu);
```

- [ ] **Step 2: Run the documentation test and verify RED**

Run:

```bash
node --import tsx --test \
  --test-name-pattern='README files point AI installers' \
  packages/codex-web/test/install_docs.test.ts
```

Expected: FAIL because neither README contains the complete upgrade sequence or the Codex capability note.

- [ ] **Step 3: Add the English upgrade section**

Insert this section before `## Service Install` in `README.md`:

```markdown
## Updating An Existing macOS Install

Repository updates do not hot-reload the running Codex Web backend. From the
repository root, update dependencies and restart the LaunchAgent:

\`\`\`bash
git pull --ff-only
npm install
scripts/service/restart-codex-web-launchd-user.sh
\`\`\`

Then reopen or refresh the installed PWA. Dynamic reasoning choices come from
the Codex CLI selected by \`CODEX_REAL_BIN\`. The selected model must advertise
\`ultra\`; pulling this repository does not upgrade the Codex CLI or add runtime
capabilities that the local app-server does not expose.
```

- [ ] **Step 4: Add the Chinese upgrade section**

Insert this section before `## 服务安装` in `README.zh-CN.md`:

```markdown
## 更新已有的 macOS 安装

拉取仓库代码不会热加载正在运行的 Codex Web 后端。在仓库根目录更新依赖并重启
LaunchAgent：

\`\`\`bash
git pull --ff-only
npm install
scripts/service/restart-codex-web-launchd-user.sh
\`\`\`

随后重新打开或刷新已安装的 PWA。动态思考强度来自 \`CODEX_REAL_BIN\` 指向的
Codex CLI；所选模型必须在元数据中声明支持 \`ultra\`。仅更新本仓库不会升级
Codex CLI，也不会增加本地 app-server 没有暴露的运行时能力。
```

- [ ] **Step 5: Run the documentation test and verify GREEN**

Run the command from Step 2.

Expected: PASS for both English and Chinese README assertions.

- [ ] **Step 6: Commit the upgrade documentation**

```bash
git add README.md README.zh-CN.md packages/codex-web/test/install_docs.test.ts
git commit -m "docs: add Codex Web upgrade steps"
```

### Task 4: Verify The Complete Change

**Files:**
- Verify: `packages/codex-web/public/app.js`
- Verify: `packages/codex-web/test/public_ui.test.ts`
- Verify: `packages/codex-web/test/install_docs.test.ts`
- Verify: `README.md`
- Verify: `README.zh-CN.md`

- [ ] **Step 1: Run the focused Codex Web tests**

```bash
node --import tsx --test packages/codex-web/test/public_ui.test.ts packages/codex-web/test/install_docs.test.ts
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run the full workspace test suite**

```bash
npm test
```

Expected: all workspace tests PASS with zero failures.

- [ ] **Step 3: Run TypeScript validation**

```bash
npm run typecheck
```

Expected: both workspaces complete with zero TypeScript errors.

- [ ] **Step 4: Check patch hygiene**

```bash
git diff --check
git status --short
```

Expected: `git diff --check` emits no output; the worktree contains only the intended plan or implementation changes.
