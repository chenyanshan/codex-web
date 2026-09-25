# app-server 改造实现与验收记录

日期：2026-09-25（Asia/Shanghai）。状态：**代码改造和本地回归通过；生产切换与上线观察尚未完成。** 本文对应[实施计划](../superpowers/plans/2026-09-25-app-server-integration-refactor.md)，不将候选验证写成生产部署结果。

后续更新：用户已明确要求切换，已安装 0.156.1 并安排独立任务在当前会话结束后执行。最新运行状态和真实切换结果见[生产切换记录](2026-09-25-app-server-cutover.zh-CN.md)；本文后面的“未切换”保留原验收时点，不覆盖后续记录。

## 1. 已交付的行为

项目原本就在使用官方 app-server。本轮重构的是 Web 与 app-server 之间的适配层，继续通过 Codex CLI 获取官方执行服务：

- `codex-native-api/src/app_server/` 集中官方生成类型、传输、进程生命周期、能力登记、官方事件投影与有限的旧版兼容；保留 `CodexAppClient` 对外入口，共用一条连接和请求关联表。
- 最新版主要从官方 thread/turn/item 事件与快照取得执行状态、结果和历史。官方无文字成功也能完成；全进程 stderr 不再用于判断单个任务失败。
- 连接中断表示“状态待同步”，保留任务身份和已有内容；恢复观察不会重投任务。发出请求后结果未知时，保留 Web 回执和不确定状态，禁止自动重放。
- 审批提交时禁用互斥决策，保留结果不确定提示；迟到响应不修改新会话。审批身份包含客户端实例和连接代次，过期审批不能误命中新连接复用的请求编号。
- 官方协议/运行版本诊断进入已有管理员指标接口；普通用户不能读取宿主机路径。未知可选方法只在明确的 JSON-RPC `-32601` 时降级。
- 通过 `app-server:check`、`app-server:generate`、`app-server:test` 重复验证候选 CLI；不在生产启动时生成源码，也没有新增自动升级守护进程。

前端遵循项目 `frontend-design`，保留五种主题、两种布局、现有字体和样式。具体设计、截图及范围见[前端记录](2026-09-25-app-server-frontend-design.md)。

## 2. 来源和兼容范围

2026-09-25 再次交叉查询 [GitHub 最新稳定发布](https://github.com/openai/codex/releases/tag/rust-v0.156.1) 与 [npm latest](https://registry.npmjs.org/@openai/codex/latest)，结果均为 **0.156.1**，发布于 `2026-09-23T02:41:36Z`（北京时间 09-23 10:41:36）。生成类型来自该发布版，release commit 为 `b412ff32c417f855c2b2d1581b77058eed87c84b`。

| 版本 | 无推理真实协议检查 | 真实模型及持久化恢复 | 角色 |
| --- | --- | --- | --- |
| 0.156.1 | 通过 | 最终源码重新验证通过 | 本次最新稳定目标 |
| 0.153.4 | 通过 | 通过 | 迁移前已使用版本，保留有限回退兼容 |

无推理检查包含 stable 必需方法、initialize、thread/start/read/list、config/read、Skills/MCP 响应结构与取消订阅。模型检查使用 `gpt-6-astra`，要求返回固定标记，不使用工具；验证官方完成、持久化历史及 unsubscribe/resume。两版均在临时 HOME/CODEX_HOME、项目和随机 loopback 端口执行，使用现有测试授权，经环境变量传递凭据，没有复制登录文件或修改生产配置。

最终 0.156.1 模型报告时间为 `2026-09-24T17:19:07Z`—`17:19:12Z`。报告保留二进制 SHA-256、Node 版本与检查结果，移除了本机二进制绝对路径及随机端口：

- [0.156.1 协议检查](2026-09-25-app-server-evidence/compatibility-0.156.1.json)、[0.153.4 协议检查](2026-09-25-app-server-evidence/compatibility-0.153.4.json)
- [0.156.1 模型检查](2026-09-25-app-server-evidence/model-smoke-0.156.1.json)、[0.153.4 模型检查](2026-09-25-app-server-evidence/model-smoke-0.153.4.json)

这些结果不等于所有功能都经过真实模型验证。真实命令/文件写入/审批、目标操作和插件安装未在该冒烟中执行；相关行为有 fixture/模块测试。未知后续版本可运行同一验证入口，不能承诺未来版本零适配。默认追随最新稳定版；预发布版不是本次验收目标。

## 3. 最终检查及现有失败归因

执行环境为 Node `v24.16.0`。汇总及原始测试日志 hash 见[验证结果](2026-09-25-app-server-evidence/validation-results.json)。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 全仓通过，包含前端与升级脚本类型检查 |
| `npm run lint` | 通过 |
| `npm run build` | 通过，生成 33 个 public 资源 |
| `npm test` | 1,094 通过：native 75、Web 1,014、升级工具 5；失败/跳过均为 0 |
| 首轮浏览器广泛回归 | 380 项：140 通过、229 跳过、11 失败；失败来自 3 个旧 workspace 用例，已归因和修正 |
| 最终浏览器重点回归 | 215 项：93 通过、122 按既有视口规则跳过、0 失败 |
| 审批主题/布局矩阵 | 5 主题 × 2 布局 × 6 宽度，共 60 次实际检查通过 |
| 构建产物浏览器冒烟 | 生产静态服务路径加载 24 个脚本、0 页面异常；版本资源与懒加载通过 |

最终浏览器命令：

```bash
npx playwright test workspace.spec.js approval-delivery.spec.js connection-status.spec.js weak-network.spec.js session-output-recovery.spec.js --workers=4
```

覆盖全部五个配置视口：320×568、390×844、844×390、1440×900、1440×1920。新增审批用例没有按视口跳过，共运行 20 个 project case。首轮另外覆盖阅读、附件、工作详情、会话控制和未读提醒；它们通过后未无理由重跑。两轮存在重叠，不能相加作为独立通过数，也不能称 380 项全部通过。

本机 Playwright 默认 Chromium revision 未安装，浏览器回归使用已有 Chromium 1228。构建产物冒烟也仅覆盖 `chromium.launch` 的 executablePath 到同一浏览器，执行原 `smoke-built-public.mjs` 的全部断言，未修改产品行为或弱化测试。其 runtime 是隔离的 inert provider，不是真实 Codex Web 业务端到端验证。

改造前完整单测有 1 个现有失败：关键前端 gzip 体积为 145,497 字节，超过原 143,360 字节上限。本轮仅让已作为 module 加载的 `app.js` 按 ESM 压缩，最终为 **134,115 字节**，减少 **11,382 字节（约 7.8%）**，原预算未放宽。该指标只证明传输字节减少，不代表首屏或运行速度提升。

首轮浏览器 11 个失败已在 HEAD 前端、相同 fixture 上复现：两个旧用例仍按文字查询现在的可访问状态图标；一个 CSP 用例只监听主 target，遗漏 sandbox frame 的拦截。修正为精确 role/name 与 frame CSP 检查；仍要求远端请求为零、脚本不执行、刷新不跳转，产品 CSP 未修改。

回归还暴露原文件版本缓存缺陷：同大小快速改写可能有完全相同的 mtime/ctime。现对最近 2 秒写入增加内容 hash 验证，保持同内容对象复用、较旧未变化文件的 stat 快路径和最多 3 次一致性重试；版本号包含内容 hash，避免陈旧授权缓存。对应确定性回归通过。额外代价是近期写入窗口内的文件读取和 hash，详见[缓存修复证据](2026-09-25-app-server-protocol-audit.zh-CN.md#8-验收期间发现的原有缓存缺陷opt-1921)。

## 4. OPT-01—OPT-21 逐项核对

以下均以[保留基线](../architecture/2026-09-25-existing-optimizations-baseline.zh-CN.md)的行为和边界为准。“通过”指列出的自动化范围，不能外推真实手机、任意代理或所有未来版本。

| 编号 | 保留方式和实现位置 | 本轮验证与边界 |
| --- | --- | --- |
| OPT-01 弱网 | 保留 `network-recovery.js`；native transport、observer 和 Web runtime 将观测中断与终态分开 | network/runtime/transport 单测及 connection-status/weak-network 浏览器回归通过；未实测带宽整形 |
| OPT-02 事件接续 | 保留 event_bus 的 epoch/reset、游标、界限；新增 observation 事件占用稳定投影键 | events、event_bus_memory、runtime_thread_subscription 与浏览器恢复通过 |
| OPT-03 会话缓存 | 最近 5 会话与摘要的有界缓存仍由 `app.js` 管理；校准不抹除已有内容 | public_ui、弱网及阅读回归通过 |
| OPT-04 待发送保存 | 原 outbox/submission-delivery 保留；不确定记录可跨刷新/后端重启存在 | public_ui、session_submission_store、server_session_submission 通过 |
| OPT-05 回执/去重 | 保留提交身份；typed 不确定响应持久化，审批在前后端防并发和重放 | 新增丢失确认、重启后重试不执行、未知审批交付与重复点击回归通过 |
| OPT-06 草稿 | 原 draft-store 与已上传附件引用机制保留，审批反馈复用局部渲染 | public_ui、审批慢响应及会话导航浏览器用例通过；不保证未上传文件刷新恢复 |
| OPT-07 前后台恢复 | 原 lifecycle/focus/online 恢复保留；新增观察恢复有 5 秒冷却 | network/public_ui/阅读恢复通过；真实手机锁屏未测 |
| OPT-08 分步加载 | 模型、状态和历史独立加载保留；官方快照优先 | weak-network 阻塞模型/状态/历史及 runtime 回归通过 |
| OPT-09 长历史分页 | `session-pagination.js`、历史窗口与顺序原实现保留 | public_ui、分页、timeline_reconciliation、session-reading 通过 |
| OPT-10 阅读位置 | `session-reading.js` 与用户滚动优先保留；审批不替换输入和阅读容器 | 阅读/窗口边界/流式/慢刷新测试通过；重新打开仍定位最新 |
| OPT-11 局部更新 | DOM 复用保留，审批状态补充到时间线 fingerprint | public_ui、审批反馈/草稿及 session-reading 通过 |
| OPT-12 合并写入 | 缓存/草稿 debounce 与切换 flush 未改 | public_ui 的持久化、存储失败测试通过 |
| OPT-13 防串会话 | 保留请求 generation；审批加入身份和导航代次检查 | public_ui、runtime 与审批迟到响应浏览器用例通过 |
| OPT-14 附件 | upload、preview、取消、并发和归属模块未改 | 附件浏览器回归、server_session_files 通过；没有改称断点续传 |
| OPT-15 PWA 更新 | 版本化构建与完整缓存保护保留，module 压缩不改资源图 | service_worker_cache、public_build、构建产物冒烟通过 |
| OPT-16 未读 | session-attention 身份/持久化机制保留 | attention 单测与浏览器回归通过 |
| OPT-17 响应式/偏好 | CSS、字体、5 主题/2 布局/语言偏好保留；仅现有组件增加文案和禁用态 | 60 次主题布局宽度检查无溢出/异常，全部互斥按钮禁用；代表性截图人工复核 |
| OPT-18 资源传输 | static_asset_cache 的 Brotli/Gzip、ETag 和容量机制未改 | 静态资源/构建/预算测试通过；gzip 134,115 字节 |
| OPT-19 查询缓存 | 保留列表/排序缓存；FileVersionCache 增加近期内容检查 | 缓存、runtime_scaling、目录和分页测试通过；额外 IO 窗口如上 |
| OPT-20 容量边界 | 保留 event_memory、SSE 背压、存储配额；传输/审批 map 各上限 1,024，校准有界 | native 资源/生命周期、event_bus_memory、server_sse_backpressure、storage_governance 通过；未做长时内存压测 |
| OPT-21 权限 | 原用户/项目/分享/文件授权和持续流鉴权保留；版本诊断仅管理员可见 | auth、multi_user、files、share、身份不变量、撤权缓存回归通过；不宣称共享宿主机隔离 |

## 5. 仍保留的兼容实现

完整 RPC/通知/请求和退出条件见[协议台账](2026-09-25-app-server-protocol-audit.zh-CN.md)。

- native 与 Web 的 rollout 终态修复集中到 `compat/`，仅对已协商的 0.153.x 或旧未初始化注入式 provider 启用。0.156.1 和未知新版的普通执行/历史校准使用官方快照。
- 归档文件读取、旧 raw/命名别名和部分旧请求扩展仍保留；不能宣称已经删除所有磁盘读取或所有旧字段。
- raw 事件与现有 collaborationMode 仍需实验开关。0.156.1 的 goals/plugins 已在 stable schema 中，移出实验依赖登记；该事实不证明所有账号都具备真实操作权限。
- 请求关联、断线、启动/关闭仍由项目维护；官方更新不会自动生成新的 Web 产品功能。

## 6. 工作区、视觉和回退材料

实现尚未提交。起点 HEAD 为 `6a5733d81bea4931eacda94a3e793fe9b2eb353e`；[源码 manifest](2026-09-25-app-server-evidence/implementation-source-manifest.json) 标识实际测试的未提交源码，不能把 HEAD 当成完成后的实现版本。

已有 staged/unstaged 修改和无关未跟踪文件保留。预先存在的 rollout 外层 turn 身份修复及其回归仍保留，现位于 Web compat 模块。浏览器测试覆写的旧审计素材已从任务开始快照恢复，203 个 tracked audit 文件逐字节核对一致；新截图保存在本次日期目录，未将旧基线更新来掩盖差异。

fresh-light 与 OLED 的审批 resting/pending/after 使用同 fixture 数据和视口。浅色 resting 前后像素一致；OLED 只有少量渲染时序像素差异。协调者复核了浅色手机和 OLED 桌面 pending：现有布局、按钮触达、输入区和信息层级保持，新反馈使用原 meta 与 disabled 样式。其余矩阵只证明受影响审批状态，不是每种主题的全部功能验收。

改造前 tracked 源码（含原 staged/unstaged 补丁）与实际运行的 0.153.4 原生二进制保存于宿主机 `~/.codex-web/upgrade-backups/2026-09-25-app-server-refactor/`，目录仅本用户访问，manifest 记录 hash。源码包不包含原先未跟踪文档/服务脚本、依赖目录或运行状态；不是完整机器备份。恢复时应在独立目录重建并验证，不能解压覆盖当前用户工作区。尚未在停写状态下做生产数据一致性快照，也未执行回退演练。

## 7. 生产切换与尚未完成的验收

[只读生产检查](2026-09-25-app-server-evidence/production-status-before-cutover.json)确认 systemd user 服务仍运行 **0.153.4**，5 个 loaded thread 中 4 个 idle、1 个 active。诊断连接没有启动自己的 app-server，也未创建任务。当前本轮对话的工具进程属于 `codex-web.service` cgroup；直接 restart 会杀死本轮对话，因此不能在此任务仍执行时完成自身替换并声称已验收。

未修改全局 CLI、service.env、服务单元或真实会话数据；未安排定时重启。当前外部切换步骤、命令及完成检查见[升级手册](../operations/app-server-upgrades.zh-CN.md#6-本次主机的外部切换交接)。需在本轮结束后，通过不属于该服务的宿主机终端执行，先停止新任务进入并等待现有任务结束，再升级 CLI 和重启既有 systemd 服务。部署后的鉴权、SSE、历史和受控任务需补实测结果。

以下保持未验收，不能将整体 S0—S6 标为全部完成：

1. 生产空闲切换、实际运行新版确认和上线观察；适配/二进制回退演练与必要时的数据兼容确认。
2. 真实手机/PWA 的系统级后台、锁屏和网络切换；自动化仅有浏览器事件/网络故障模拟。
3. 同条件带宽整形、首屏/切换/恢复耗时、长任务和内存趋势的改造前后测量；本次唯一量化的性能变化是构建字节。
4. S0 要求的所有页面类别的同数据改造前截图未全部新采集；完整前后对照集中在实际受影响的审批场景，其他页面依赖原有基线和回归。

后续升级默认继续以届时最新稳定 Codex 为目标，使用上述协议/模型/产品检查决定能否切换；维护成本集中在薄适配层、回归验证和 Web 产品本身。
