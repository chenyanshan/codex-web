# 随身 Codex Web：官方能力代码对照

日期：2026-09-29。范围：只读代码审查及方案，不实现、不部署。

## 结论和证据边界

目标是手机随时查看、干预和继续宿主机上的 Codex，不是完整 IDE。优先接入官方执行器已经产出的状态与交互，不复制 Rust 执行引擎，不另建 Agent 调度器。

官方依据：`openai/codex` 提交 `68e1a421f55ec8a0e900c5a250aa83c13727b671`。项目协议来源记录为 `rust-v0.156.1`，见 `packages/codex-native-api/src/app_server/generated/manifest.json`。上游 main、生成类型、当前源码、已部署 dist 是四个不同证据层；本次没有做新接口运行验收。尤其生成在 stable 目录的类型仍可能包含 EXPERIMENTAL 注释，不能把目录名当支持承诺。

工作区同时存在消息同步改造及其他未提交修改，本报告描述检查时的代码，不声称这些修改已上线或通过验证。

不计算“官方功能覆盖率”：方法数不等于用户能力，同一能力可能跨多种请求、通知和 UI。按随身使用场景，筛选出 8 组交互能力，加上用户明确要求的 app-server 更新，共 9 组核心候选，另有 3 组可选能力；这是本报告的产品分组，不是官方功能总数。

## 已有能力：不要重复建设

`codex_app_client.ts` 已调用 thread 创建/恢复/读取/归档/改名、turn/start、turn/steer、turn/interrupt；已有目标、模型、配置、skills、plugins、apps、MCP 和账户额度的适配方法。`server.ts` 已有 steer、interrupt、审批和 usage 路由。`runtime.ts` 已有 plan/default 设置和目标命令。

已有这些接口不等于每项 UI 都完善，但不能再把“支持中断”“支持技能”“支持目标”列成全新功能。

`TurnObserver` 已按 thread/turn/item 身份处理官方终态和条目，有数量与字节上限。HTTP/SSE、登录、设备会话、权限、提交回执、PWA、缓存、分页、阅读位置是 Web 自身的必要职责，官方终端代码不能替代它们。

## 8 组优先候选

| 能力 | 官方代码证据 | 当前代码差距 | 轻量交付及优先级 |
| --- | --- | --- | --- |
| 1. 重试与连接健康 | `core/src/responses_retry.rs` 发重连消息；`tui/src/chatwidget/protocol.rs` 分流 will_retry；`streaming.rs` 更新状态栏 | `extractTurnErrorNotificationMessage` 对 willRetry=true 返回 null；Web 事件类型无重试健康状态 | 顶部状态行展示重试及详情，恢复后校准；P0 |
| 2. 等待用户回答 | 官方 ServerRequest 有 `item/tool/requestUserInput`，问题携带 isBlocking | `mapPendingApproval` 仅处理命令/文件/权限审批和旧审批；其他请求在 `handleServerRequest` 返回 -32601 | 对话内问题卡、自由文本/选项、答复状态；保留 RPC 生命周期、身份与重复回答防护；P0，复杂度中等 |
| 3. 当前计划 | 官方 TUI 消费 `TurnPlanUpdated` | Web event_model 无结构化计划；plan/default 是执行模式，不等于计划步骤展示 | 一个可折叠步骤卡，只显示真实事件，不编造完成百分比；P1 |
| 4. 子代理活动摘要 | 官方 `ThreadItem::CollabAgentToolCall` 包含 receiver_thread_ids、agents_states 等，TUI 有专门处理 | 工作事件类型只有 command/file_change/permission/unknown，缺子代理结构化视图 | 显示子任务状态和最近活动；子线程授权沿项目/用户归属验证；P1，不做多代理调度平台 |
| 5. 上下文压缩状态 | 官方 TUI 单独处理 ContextCompaction，支持快照恢复进行中状态 | Web 无对应状态事件，长静默可能无法解释 | 在状态行显示“整理上下文”；不要将它误报卡死；P1 |
| 6. 当前上下文用量 | 官方 `ThreadTokenUsageUpdated` 和 ThreadTokenUsage 的 last/total/modelContextWindow | 已有 readUsage 实际读取 account/rateLimits/read；不是当前会话上下文用量 | 详情中展示可得用量，区分累计 token、当前上下文和账户额度；无数据不估造；P2 |
| 7. 本轮改动摘要 | 官方 `TurnDiffUpdated` 和 TUI on_turn_diff | 已有文件变更批次/文件预览，但无对应 turn diff 事件 | 回复下可折叠文件列表和按需 diff；无需编辑器；P2 |
| 8. 细分工具活动 | 官方 TUI 分别处理 McpToolCall、WebSearch、ImageGeneration、TerminalInteraction | 当前工作事件投影主要表达命令/文件操作 | 同一活动组件展示工具类型及状态，输出按需加载并有界；P1/P2 |

前三项中，重试和计划偏向增加投影；结构化问答是请求/响应交互，不能按普通通知处理。网络重连后旧 RPC 可能已失效，必须重新核对，不能保存旧 request ID 后盲目回复。`ToolRequestUserInputParams` 明确带 EXPERIMENTAL 注释，要按目标 CLI 版本验收。

子代理摘要也不能仅靠一次“启动代理”工具条目推断实时状态。优先展示协议确实提供的信息；若需要子线程订阅，必须限制数量、释放订阅，并分别记录最后观测时间和实际工作进展。

## 3 组可选能力

1. **从这里另开分支**：项目生成协议已有 thread/fork，但当前 facade 无对应专用方法。适合尝试另一条思路；必须处理新线程归属、设置、附件及 pending submission 的边界，绝不能把分叉说成回滚文件。
2. **一键代码审查**：协议已有 review/start，当前 facade 无入口。只加轻量入口、复用对话结果；不是 PR 管理系统。
3. **手动整理上下文**：协议已有 thread/compact/start。可放高级菜单，先做自动压缩状态展示；压缩可能影响历史细节，不应作为通用“修复卡顿”按钮。

暂不做文件树编辑器、交互式终端工作台、全量配置中心、插件市场扩建、复杂多代理管理、实时语音或桌面环境复制。协议存在能力不代表手机必须提供入口。账号凭据继续留在宿主机。

## 第 9 组：app-server 更新与兼容

用户明确要求纳入。代码事实：

- `app_server/lifecycle.ts` 从 codexCliBin 启动 `codex app-server --listen ws://127.0.0.1:<port>`；断线时复用仍存活的子进程。app-server 随 Codex CLI 分发，不是本项目单独安装的 npm 包。
- `runtime.reloadRuntime()` 只调用 reloadMcpServers；`/api/runtime/reload` 不是升级 Codex、重启 app-server 或更新 Web 的接口。
- README 的 Updating An Existing macOS LaunchAgent Install 明确：更新 Web 仓库不会更新 CLI；运行时选择受 CODEX_REAL_BIN 影响。
- `scripts/app-server/compatibility.ts` 已有显式二进制路径、隔离 HOME/项目、schema 检查、真实进程初始化和可选真实模型冒烟。应复用，而不是另写一套探测。
- 上游 `tui/src/update_action.rs` 按安装来源选择 npm/brew/standalone 等更新动作，并标注在 TUI 退出后执行。上游 `app-server-daemon/src/manual_update.rs` 还有受管理安装的更新器，但本项目使用自有子进程生命周期，不能直接视为已接入官方 daemon 更新。

轻量建议：设置里一个“Codex 运行时”条目，区分运行中的版本、磁盘已安装版本、已验证兼容范围、待重启状态。更新 Web、更新 CLI、MCP reload、PWA 更新必须分开命名。

第一阶段先做版本可见、检测磁盘版本变化、空闲时应用已安装版本；复用现有宿主机升级方式，不急于支持所有包管理器的远程安装。若要求完整手机一键更新，再添加仅管理员可用的受控更新动作，按已确认安装来源执行，未知安装方式明确不支持。

更新过程：检查目标来源和兼容 → 准备候选版本 → 等待全局空闲并短暂阻止新执行进入 → 重新核对无任务/审批/问题/子代理活动 → 切换进程 → initialize 和只读健康核对 → 恢复接收任务。必须考虑 Webhook、定时任务和目标自动续跑，不只检查当前聊天页。等待空闲不可抢占活动任务；长任务持续占用时显示等待原因，并允许取消更新预约。

安装成功不等于正在运行新版本，initialize 成功也不等于所有新功能已兼容。真实模型冒烟会消耗额度，应与只读检查明确分开。升级后的可选接口只对明确 unsupported 降级，不能把认证或超时错误当作不支持。

保留旧二进制与启动配置有助于启动失败回退，但不承诺任意版本的状态格式可逆；共享运行状态被新版迁移后的回退必须有上游支持或隔离验证证据。初版不迁移到官方 daemon，不做活跃 turn 的热迁移，不因更新自动重发未确认消息。

受影响基线重点为 OPT-01/02/04/05/07/15/19/20/21。上述流程是建议方案，当前代码不具备完整闭环，本次没有更新或重启服务。

## 实施方式：减薄语义适配，保留 Web 可靠性

数据路径保持：官方 app-server → codex-native-api 类型化适配 → Web 状态投影与鉴权 → HTTP/SSE → 手机。

新增一个有界的执行状态投影，分开记录任务生命周期、观察连接、重试健康、正在等待的交互、当前活动。不要把所有情况折叠成 running，也不要因一条心跳就清除重试或无进展提示。

通知用于实时更新，快照用于刷新和重新进入时恢复；官方不提供历史可恢复状态时，要明确显示“当前未知”，而不是伪造跨重启重试次数。临时健康状态与持久消息时间线分开建模，并与正在进行的 canonical timeline 工作衔接，避免再建一套消息顺序来源。

页面新增面尽量压缩为：一条状态行、一个折叠活动面板、按需出现的问题卡、一个结果改动入口。子代理、计划、工具详情共用活动面板。薄适配不等于删除 SSE 回放、回执和本地缓存。

顺序：P0 先做重试可见和结构化问答；P1 合并活动视图及压缩、子代理、计划状态；P2 按需要做 token/diff，再决定可选入口。

不提供未经实施拆分的精确工期。工作量最大的不在新增方法，而在刷新恢复、断线期间答复、授权和事件乱序。当前 app.js 约 1.38 万行、server.ts 约 0.84 万行；新能力应按职责抽小模块，避免继续向两个文件堆分支，也不为此整体重写。

## 五种视角与取舍

| 视角 | 判断与依据 | 容易忽略的代价 |
| --- | --- | --- |
| 手机使用者 | 最需要知道是否在做事、是否要我回答、结果在哪里；现有卡顿案例支持优先状态 | 容易要求过密提示，造成小屏干扰 |
| 协议维护者 | 已有生成类型，接入结构化事件比解析文字更稳 | 类型存在不代表部署版支持；main 不能替代版本验收 |
| 可靠性审查者 | 问答、重试、子线程必须经得住刷新、断网和迟到事件 | 过度防御可能导致永久保留未知状态，需要清晰恢复路径 |
| 维护成本视角 | 优先复用官方执行器和现有 Web 组件，避免 UI 面积膨胀 | 接 API 的代码少不等于整个功能便宜 |
| 架构演进视角 | 现有官方协议改造已经走对方向，主要问题是语义丢失 | 不能为了靠近官方而丢掉手机/PWA 独有的可靠性保护 |

核心冲突是“更多官方信息”与“轻量界面”。共识不是少接状态，而是充分接收必要状态、默认只显示最需要行动的信息。最关键验证问题：用户能否在手机上不翻服务日志，就区分执行、重试、等待回答和观察中断？

缺少的证据是目标版本真实行为、手机操作成本和这些能力的实际使用频率。因此优先级高于具体 UI 方案的置信度；暂不以功能覆盖率作为成功指标。

## 验收与保留基线

影响 OPT-01/02/03/07/08/09/10/11/12/13/16/17/19/20/21；若问答持久化，复用 OPT-04/05 的送达原则，但不要把执行任务回执直接冒充 RPC 问答回执。不得破坏 OPT-06 草稿、OPT-14 附件、OPT-15 PWA 更新、OPT-18 资源传输。

后续实施需要验证：重试后成功/失败、长命令无输出、上下文压缩、子代理活动但父线程静默、问题回答丢响应、刷新后的问题过期、跨账号和分享权限、终态后迟到事件、慢 SSE 客户端，以及升级后不支持可选方法的明确降级。运行 typecheck、针对性单测、浏览器恢复测试和目标 CLI 的真实协议冒烟。本次只做审查，以上均未新增运行。

## 结论自审

1. 已有官方引擎，无需复制执行核心：可靠性 10/10，直接启动和 RPC 调用可核对。
2. 重试反馈在当前 facade 被过滤：10/10，有明确分支。
3. 结构化提问在当前 ServerRequest 路径不支持：10/10，有明确 -32601；不等于模型无法通过普通文本提问。
4. 结构化活动信息值得优先补齐：8/10，代码差距确定，用户价值是结合随身定位的判断。
5. 8 组核心候选能保持轻量：7/10，是待验证的产品设计判断；若界面和维护成本变大，应继续缩减入口。

最弱的是优先级与交互成本估计，而不是接口存在性。严格审查者会要求目标 CLI 上逐项证明“事件可收到、刷新可恢复、错误可处理”，这应是实施门槛。

## 源码索引

官方固定提交链接前缀：
https://github.com/openai/codex/tree/68e1a421f55ec8a0e900c5a250aa83c13727b671/codex-rs

- `core/src/responses_retry.rs`：重试、错误通知、传输回退。
- `tui/src/chatwidget/protocol.rs`：token、diff、plan、错误、压缩、子代理等分流。
- `tui/src/chatwidget/streaming.rs`：重连状态展示。
- `tui/src/chatwidget/compaction.rs`、`tool_lifecycle.rs`、`turn_runtime.rs`：各类活动投影。

项目：`packages/codex-native-api/src/codex_app_client.ts`、`app_server/client.ts`、`app_server/turn_observer.ts`、`provider.ts`；`packages/codex-web/src/event_model.ts`、`runtime.ts`、`server.ts`；`app_server/generated/stable/{ClientRequest,ServerRequest,ServerNotification}.ts`。

官方仓库为 Apache-2.0；若实际拷贝源码应保留适用许可/NOTICE。本方案主要复用官方进程与协议，不依赖拷贝 Rust UI 源码。
