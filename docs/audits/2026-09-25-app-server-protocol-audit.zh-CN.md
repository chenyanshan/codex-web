# app-server 协议盘点与候选版本审计

日期：2026-09-25（Asia/Shanghai）。范围：S0 协议/补丁台账与 S5 候选验证；这是本轮未提交工作树的审计记录，不代表部署完成。最终产品测试、OPT-01—21 和切换结果由实施验收记录单列。

## 1. 来源及版本边界

- 工作区基准：`main`，HEAD `6a5733d81bea4931eacda94a3e793fe9b2eb353e`；本轮实现尚未提交，不能将 HEAD 当成完整实现快照。已有用户修改保留。
- 2026-09-25 重新查询 [官方 GitHub 最新稳定发布](https://github.com/openai/codex/releases/latest) 与 [npm latest](https://registry.npmjs.org/@openai/codex/latest)，均为 **0.156.1**，发布时间 `2026-09-23T02:41:36Z`。
- 标签 `rust-v0.156.1` → annotated tag `81e8e29b2956dfe9b092c63953a9ed282781e77c` → release commit `b412ff32c417f855c2b2d1581b77058eed87c84b`。使用该 release binary 生成协议，未使用此前 main 快照代替发布版。
- 候选通过显式 `npm install --prefix /tmp/codex-candidate-0.156.1 --ignore-scripts @openai/codex@0.156.1` 获取；未执行全局升级。原生路径 `/tmp/codex-candidate-0.156.1/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`，`--version` 为 `codex-cli 0.156.1`，SHA-256 `0b2e9301d6100dddda3b9d5c80ebaeaa3a2f1962388f2f36f6b96a9f08b1f33f`。
- 当前安装参照版本 `0.153.4`；运行中服务版本须另查受保护的管理员诊断。磁盘包装器/CLI 版本不能证明已有 app-server 子进程版本。
- Node `v24.16.0`。生成来源、npm integrity、Apache-2.0 LICENSE、1593 个 stable/experimental 文件的原始和 NodeNext 规范化 hash 见 [generated](../../packages/codex-native-api/src/app_server/generated/README.md)、`manifest.json`、`release-source.json`。只变更相对模块路径后缀，不改协议字段。

## 2. 全部客户端 RPC

以下从当前 `CodexAppClient` 的 `this.request(...)` 字面调用提取，并逐项核对 0.156.1 的 `stable/ClientRequest.ts` 与 `experimental/ClientRequest.ts`。**存在于 schema 只证明生成契约包含该方法，不证明账户权限、配置或真实执行已通过。** experimental 目录为完整扩展输出，不表示里面所有方法都是实验方法。

| RPC | 用户能力/调用职责 | stable | experimental 输出 | 处理决定 |
| --- | --- | --- | --- | --- |
| `thread/list` | 会话列表/分页 | 有 | 有 | 保留 facade，官方类型约束 |
| `thread/read` | 状态/历史/恢复 | 有 | 有 | 保留 facade，官方类型约束 |
| `thread/name/set` | 重命名 | 有 | 有 | 保留 facade，官方类型约束 |
| `thread/archive` | 归档 | 有 | 有 | 保留 facade，官方类型约束 |
| `thread/unarchive` | 恢复归档 | 有 | 有 | 保留 facade，官方类型约束 |
| `thread/start` | 创建会话 | 有 | 有 | 保留 facade，官方类型约束 |
| `thread/resume` | 继续历史会话 | 有 | 有 | 保留 facade，官方类型约束 |
| `thread/unsubscribe` | 订阅释放 | 有 | 有 | 保留 facade，官方类型约束 |
| `thread/goal/get` | 读取目标 | 有 | 有 | 保留 facade，官方类型约束 |
| `thread/goal/set` | 设置目标/可能自动开启 turn | 有 | 有 | 保留 facade，官方类型约束 |
| `thread/goal/clear` | 清除目标 | 有 | 有 | 保留 facade，官方类型约束 |
| `turn/start` | 发送任务 | 有 | 有 | 保留 facade，官方类型约束 |
| `turn/steer` | 执行中追加输入 | 有 | 有 | 保留 facade，官方类型约束 |
| `turn/interrupt` | 中断 | 有 | 有 | 保留 facade，官方类型约束 |
| `model/list` | 模型选择 | 有 | 有 | 保留 facade，官方类型约束 |
| `config/read` | 有效配置 | 有 | 有 | 保留 facade，官方类型约束 |
| `account/rateLimits/read` | 额度展示 | 有 | 有 | 保留 facade，官方类型约束 |
| `skills/list` | Skills 目录 | 有 | 有 | 保留 facade，官方类型约束 |
| `skills/config/write` | Skills 开关 | 有 | 有 | 保留 facade，官方类型约束 |
| `plugin/list` | 插件市场 | 有 | 有 | 保留 facade，官方类型约束 |
| `plugin/read` | 插件详情 | 有 | 有 | 保留 facade，官方类型约束 |
| `plugin/install` | 插件安装 | 有 | 有 | 保留 facade，官方类型约束 |
| `plugin/uninstall` | 插件卸载 | 有 | 有 | 保留 facade，官方类型约束 |
| `app/list` | 连接应用列表 | 有 | 有 | 保留 facade，官方类型约束 |
| `mcpServerStatus/list` | MCP 状态 | 有 | 有 | 保留 facade，官方类型约束 |
| `mcpServer/oauth/login` | MCP 授权 | 有 | 有 | 保留 facade，官方类型约束 |
| `config/mcpServer/reload` | MCP 配置重载 | 有 | 有 | 保留 facade，官方类型约束 |
| `config/value/write` | 配置保存 | 有 | 有 | 保留 facade，官方类型约束 |
| `initialize` | 初始化及运行诊断 | 有 | 有 | 保留 facade，官方类型约束 |

共 29 个不同 RPC。`initialized` 是客户端通知；审批决定是对服务端 request ID 的响应，不计入 RPC 方法数量。`approval/response` 是本地错误诊断标签，不是服务端 RPC。

请求经 `app_server/client.ts` → `transport.ts` 共用一条连接与关联表。JSON-RPC 超时/响应丢失不自动重发副作用请求。可选能力仅对原生 transport 转换后的 `rpcCode === -32601` 降级；401/403/429、参数错误、超时均不是“不支持”。

## 3. 消费的通知与服务端请求

| 消息 | 当前用途 | 0.156.1 生成依据/决定 |
| --- | --- | --- |
| `turn/started`、`turn/completed` | 任务身份、官方完成/失败/中断、早期事件接续 | stable 有；保留 |
| `item/started`、`item/completed` | assistant/命令/文件/工具生命周期，按 item ID 合并 | stable 有；保留 |
| `item/agentMessage/delta` | 文字增量 | stable 有；保留 |
| `item/reasoning/summaryTextDelta` | 摘要片段及 summaryIndex 顺序 | stable 有；保留摘要，不展示原始推理 |
| `item/commandExecution/outputDelta` | 有界命令输出增量 | stable 有；保留 |
| `item/fileChange/patchUpdated` | 文件补丁展示 | stable 有；保留 |
| `thread/status/changed`、`serverRequest/resolved` | 已审批执行的后续信号 | stable 有；保留 |
| `error` | 按 thread/turn 身份关联运行错误；短暂 reconnect 提示不单独判终态 | stable 有；保留 |
| `item/assistantMessage/delta`、`item/message/delta` | 历史命名兼容（实现先规范化名称） | stable/experimental 均无对应正式方法；保留兼容别名，待旧版本证据退出 |
| `codex/event/exec_command_output_delta` | 旧命令输出 | 两份 ServerNotification 均无；集中记录为 raw 兼容依赖 |
| `codex/event/agent_reasoning_delta`、`codex/event/reasoning_content_delta`、`codex/event/reasoning_raw_content_delta` | 初始化 opt-out 列表 | 不作为正常展示来源，继续禁止原始推理泄漏 |

服务端请求类型均对照 stable `ServerRequest.ts`。当前只处理以下审批集合，其余包括 tool user-input、elicitation、dynamic tool call 等走明确不支持分支，不能将“存在于 schema”说成 UI 已支持。

服务端请求处理：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`，以及 `execCommandApproval`、`applyPatchApproval` 旧审批类型，均通过 `mapPendingApproval` 映射为 Provider 审批。未知请求明确回复 `-32601`；缺少 thread 身份回复 `-32602`；达到审批容量上限回复错误，不自动接受。审批决策不自动重试；连接断开后的审批身份需重新校准。通知/请求结构检查和连接生命周期的最终修复结果以 native 聚焦测试及实施记录为准。

## 4. 实验与历史字段台账

| 依赖 | 0.156.1 实际生成观察 | 当前保留理由与退出条件 |
| --- | --- | --- |
| initialize `experimentalApi: true` | 初始化字段存在；仍全局启用 | 原有功能不能仅为关开关而丢失；逐功能证明可不启用后收敛 |
| goals 三个 RPC | **stable 已有**，不能再以“仅实验方法”描述 | 已移出实验登记；请求和响应使用 stable 类型，真实目标操作仍需单独验证 |
| plugins 四个 RPC | **stable 已有**，不能再以“仅实验方法”描述 | 已移出实验登记；schema 稳定不等于安装/授权真实操作已验证 |
| `thread/start.experimentalRawEvents` | 仅 experimental ThreadStartParams 有 | 旧工具/raw 投影仍使用；官方 item 历史等价验证后删除 |
| `thread/resume.experimentalRawEvents` | stable/experimental ResumeParams 均无 | `compat/request_params.ts` 显式旧字段扩展，不冒充当前官方字段 |
| `persistExtendedHistory` | 当前请求兼容扩展；旧 start `title` 已移除，名称使用正式 name/set | 支持窗口不再包含旧行为且 fixture 等价后移除；新服务忽略扩展不等于长期承诺 |
| `turn/start.collaborationMode` | 仅 experimental TurnStartParams 有，以 Pick 单字段扩展 | 原 plan/default 设置仍依赖；稳定替代字段及计划模式等价后退出 |
| OAuth `timeoutSecs` | ts-rs 类型为 bigint，JSON wire 用 number | typed boundary 单点转换，避免 bigint JSON 序列化问题 |

## 5. 兼容补丁与状态恢复台账

| 补丁/路径 | 当前范围和决定 | 删除/替换条件与验证入口 |
| --- | --- | --- |
| `native app_server/compat/rollout.ts` 内部 JSONL 解析 | 保留；`compat/policy.ts` 仅 0.153.x 或未初始化的旧注入客户端启用。已协商 0.156.1 与未知新版不走磁盘终态/工具补齐 | 退出 0.153.x 支持且原 Responses facade 的 raw item/媒体历史等价；`codex_app_client_work_events.test.ts` 等 |
| `TurnObserver` + `thread/read` | 官方 thread/turn/item 身份为现代主路径；完成、失败、中断及无文字完成均使用官方状态 | 生命周期/早到/重复/迟到/断线 fixture；真实模型和历史恢复另外验证 |
| 受控校准轮询 | 保留失败处理；现代轮询从 1 秒退避，最大 30 秒，官方终态唤醒可提前结束；旧分支 1 秒 | 不能用删轮询掩盖断线/材料化竞态；有替代恢复证据后进一步收敛 |
| ephemeral includeTurns、不支持 list_turns、尚未 materialize | 保留明确错误匹配兼容；不能把所有异常都当可选能力缺失 | 对目标版本异常形态和恢复窗口分别验证；不是通用 -32601 能力发现 |
| stderr | 仅子进程启动/崩溃诊断仍可保留；本轮普通 turn 错误不再从全进程 stderr 归因 | 代码仍有历史 baseline 参数，不据此声称 stderr 推断全部清理；共享进程错误必须有 thread/turn 关联 |
| Web `compat/rollout_turn_snapshot.ts` | 保留旧版本历史例外；`runtime.readTurnSnapshot` 官方 items 主路径。legacyRecovery 才允许缺失 turn/空或旧 response-item 投影补最终结果；现代空历史不从磁盘补齐，非空官方 tool-only items 权威 | 0.153.x 缺口退出后删除；保留用户已有 currentTurnId 外层边界优先逻辑，相关 runtime fixture |
| Web `runtime.readArchivedThreadFromFile`、归档目录/元数据索引 | **原实现保留，尚非本轮彻底替换项** | 官方归档列表/历史在所有已支持版本等价后再迁移；不得宣称“所有磁盘读取已移除” |
| Web 观察断开 | 产生 additive `turn.observation_interrupted` 和待同步状态；不写成任务失败历史，恢复观察有 5 秒 cooldown | runtime/event/subscription 与浏览器恢复测试；不触发重投任务 |

这里的“保留”不代表无限期兼容保证；删除前必须补对应版本/错误路径的证据。未知版本默认尝试官方能力，不因版本号陌生全面拒绝，也不为未知版本启用旧磁盘格式猜测。

## 6. Web 元数据与优化职责

官方 runtime 管执行与历史；Web 继续拥有账号/角色、session 归属、项目权限、收藏、设置、附件、提交 ID/查询回执、Webhook 关联、审计和展示投影。不能用官方 thread 列表替代 Web 授权，也不能用浏览器缓存覆盖较新的官方状态。

本审计涉及 OPT-01/02/05/07/13：断线与终态区分、身份关联、早期事件有界缓冲、幂等回执与恢复不重发；OPT-19/20：查询/事件/子进程资源边界；OPT-21：恢复和共享宿主机状态中的身份权限。前端草稿、附件、分页、阅读位置、PWA、主题、静态压缩等职责仍由既有模块保留。本表不是这些能力全部通过的声明；逐项 OPT 验证由最终实施记录汇总。

## 7. 本文可确认的验证证据

- `scripts/app-server/compatibility.ts` 复用真实 `CodexAppClient`，独立 HOME/CODEX_HOME、临时项目、随机 loopback 端口，不复制登录文件。
- 0.156.1 与 0.153.4 的无推理报告分别为 `/tmp/codex-compat-0.156.1.json`、`/tmp/codex-compat-0.153.4.json`；2026-09-25 北京时间运行，status 均 passed。通过：必需 stable 方法生成检查、initialize、thread/start、读取已加载快照、thread/list、config/read、Skills/MCP 响应结构和 unsubscribe。
- 无推理模式没有生成持久化 turn，因此 **thread/resume 持久化历史、真实模型、审批、文件执行、断线恢复**不能由上述报告声称通过。显式模型冒烟会检查 marker、官方完成、持久化历史及 unsubscribe/resume；最终实际运行结果由 root 实施记录归档。
- `scripts/app-server` 5 项聚焦测试通过（manifest/hash/模块路径、环境隔离、精确 unsupported 降级、实际 transport rpcCode 错误形态、可选响应结构）；`tsc -p scripts/app-server/tsconfig.json` 通过。
- 本轮曾运行 `npm run typecheck`：native/generated 通过，当时 Web 的新增事件类型尚在其他 agent 改写中；不将该中间结果冒充全仓最终通过。最终 typecheck/build/lint/browser 以实施记录为准。
- 这是开发候选验证；本文未记录生产重启、在线任务切换或运行数据回退已执行。

可重复命令与空闲切换/数据回退限制见 [升级手册](../operations/app-server-upgrades.zh-CN.md)。临时报告路径为本次宿主机证据，不承诺长期保存；可长期复现的命令与来源在仓库内。

## 8. 验收期间发现的原有缓存缺陷（OPT-19/21）

全量测试暴露 `file_version_cache.test.ts` 同大小原地改写后仍读到旧内容。只读复现实验连续执行 1500 次真实 write/stat/write/stat，**1459 次 mtimeNs 和 ctimeNs 同时相等**；当前文件系统字段虽以纳秒表示，连续写入仍可处于同一时钟 tick。原 inode/size/mtimeNs/ctimeNs 缓存判据不足以立即发现改写；不能用测试 sleep 掩盖。

`FileVersionCache` 现在在最新 mtime/ctime 距当前时间不超过 2 秒时重新打开并验证内容 SHA-256；同内容仍复用同一冻结对象，不重新 JSON parse。摘要加入 snapshot version，确保同 tick 改写/撤权也能使下游版本缓存失效。时间戳较旧且未变化时保留 stat-only 快路径；文件缺失仍立即清理元数据关联。

代价是在最近写入的 2 秒窗口增加读取和 hash，不增加重复解析；未来时钟值也按近期写入保守复验。该窗口覆盖普通文件系统及 1–2 秒粗粒度时间戳，不宣称可检测恶意伪造所有元数据或任意更粗粒度的远程文件系统。读前后仍保留句柄和路径版本交叉检查，最多重试三次。

确定性回归固定所有 metadata 与时钟，验证相同内容对象复用、同大小 enabled true→false 立即可见、version 改变，以及窗口后不再 open/read；无 sleep，未降低原断言。缓存与 runtime_scaling 聚焦测试共 13 项通过；identity_store、identity_admin_invariant、server_auth 共 94 项通过。修复后 `npm run typecheck` 全仓通过（含脚本配置）。最终其余构建/浏览器/部署结果另记在实施验收记录。
