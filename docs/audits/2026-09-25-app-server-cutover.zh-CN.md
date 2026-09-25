# app-server 0.156.1 生产切换

日期：2026-09-25。用户明确要求“切换我看看效果”。

状态：首次切换在启动检查阶段失败，造成 Web 502；2026-09-25 02:18:16（北京时间）完成校验后，systemd 已恢复服务。公网首页和新版资源均返回 200，页面版本为 `81b582c9a575ae1cd3ce`；运行中的官方 app-server 0.156.1、旧会话历史读取和一次真实模型回复均已验证。

[首次切换状态](2026-09-25-app-server-evidence/cutover-status.json)保留原始 `failed` 结果，不改写成成功；恢复后的实际检查见[恢复验收](2026-09-25-app-server-evidence/recovery-status.json)。Web 恢复、磁盘 CLI 版本、实际 app-server 初始化和登录后功能分别记录，不能相互替代。

## 502 原因与恢复

现有 systemd 服务有 `gateway-contract.conf` 附加配置，其 `ExecStartPre` 要求部署源码与最近一次通过的网关兼容性验证记录一致。此次重构修改了被检查的 Web/runtime 源码，但首次切换前没有检查这份附加配置，也没有重新运行验证。服务在主程序启动前被拒绝，日志为 `Source or interpreter changed since verification; run scripts/verify.py`；Nginx 连接不到本地上游，因此返回 502。

恢复时使用与 systemd 相同的 `/usr/bin/python3` 和 Node 24 路径运行原有完整验证。网关 433 项测试、相关工作流契约 96 项测试全部通过，零失败、零跳过；格式、lint、类型检查通过。验证程序生成与当前源码匹配的记录后，systemd 原有自动重试成功启动服务。再次执行启动前的只读校验已通过。

未禁用校验、未降低断言、未修改 service.env 或服务单元、未回退 CLI 或用备份覆盖用户历史；本次恢复没有修改产品源码。磁盘 CLI 仍为 0.156.1。运行时按原设计在认证请求到达时惰性启动；恢复验收通过连接 `codex-web.service` 内唯一 app-server 的 loopback WebSocket，确认 initialize 返回实际版本 0.156.1，已有对话的官方历史可读。

已验证本地和公网首页、版本与主要脚本返回 200，未登录的模型、诊断、会话和事件接口仍返回 401。390×844 与 1440×900 浏览器视口均可见密码登录页，零页面脚本错误。02:25:53（北京时间）在运行中的 app-server 上使用临时目录、ephemeral thread、read-only 沙盒和 `gpt-6-astra` 完成一次真实模型测试，精确回复 `CODEX_RECOVERY_OK` 并返回正式 `completed` 状态；随后释放测试订阅与临时目录。此测试消耗一次推理额度，没有重复提交。

登录后的完整聊天 UI、SSE 断点恢复、审批和附件交互未在这次生产恢复检查中重跑，不能用登录页或直接 app-server 测试替代；保留先前回归证据及验收限制。

防止重现：升级手册已要求停服前读取完整 unit/drop-ins，在服务所用解释器下执行附加校验；验证过期时先重跑完整契约测试，再次确认 `--check` 通过后才能进入停服步骤。旧的一次性切换脚本未补此检查，且原 PID/备份前置条件已经失效，不能再次直接执行。

优化映射：服务恢复检查覆盖 OPT-01/02/07 的服务端可达性前提、OPT-15/18 的新版资源可达性、OPT-20 的既有服务进程管理、OPT-21 的未登录接口拒绝。未更改这 21 项产品实现；不把恢复 HTTP 服务称作已重新验证弱网重连、草稿、阅读位置或登录后的全部交互。原有实现与回归证据继续保留。

## 已执行的准备

- 再次确认 GitHub/npm 最新稳定版均为 0.156.1。
- 全局 CLI 已安装到原 Node 24 prefix，service.env 的 `CODEX_REAL_BIN` 路径保持不变；安装后的真实协议检查通过，原生 SHA-256 与已验证候选完全一致。
- 源码与此前 1,094 项测试通过时的 manifest 一致；没有再改产品代码。
- 切换前仅当前对话 active，其他 loaded threads idle；没有 Codex systemd 定时任务，也没有第二套本机 app-server。
- 独立 systemd unit 可在目标服务 cgroup 外运行，已实际验证；一次性切换脚本通过 Node 语法检查及只读 dry-run。

## 执行方式

一次性 unit 为 `codex-web-cutover-20260925.service`，脚本和私有配置在 `~/.codex-web/upgrade-backups/2026-09-25-app-server-refactor/`。它不定时更新，不在以后启动时重跑，也不改变原服务的启动模式或密码配置。

脚本等待所有已加载会话连续空闲至少 5 秒，最多等 10 分钟，临切换前再核对状态、源码和原服务进程。期间若有新任务则继续等待；超时放弃重启。没有取消其他用户任务，也不把观察断线当成任务完成。

随后通过 systemd 停止原服务，在停写时复制 Codex 会话/归档、执行状态数据库、Web 元数据和托管附件到 `state-before-cutover/`，使用权限受限的本机目录。排除 Codex 凭据、诊断日志库、临时缓存和用户项目文件。该状态快照用于人工核实恢复条件，不会自动覆盖现有历史。备份后通过既有 `restart-codex-web-systemd-user.sh` 启动新版。

预期短暂断开。浏览器按原弱网/PWA 机制恢复；如果没有浏览器恢复请求，新 runtime 可能因惰性启动而尚未建立，自动检查会明确报告等待超时。该流程是本次授权的服务维护，不保证 HTTP 收单与空闲观测之间完全无竞态，也不宣称零停机升级。

## 首次切换原定自动检查（未执行到）

原计划检查：页面/新资源版本、未登录 API 和事件入口仍返回 401、只有预期的新 app-server 进程、initialize 返回的实际 0.156.1 版本、当前已有对话的官方历史可读，以及新运行服务上的一次只读模型标记任务。首次任务在启动服务时失败，未执行这些检查；恢复期间重新执行了这些检查，并增加手机/桌面登录页验证，具体结果以恢复验收为准。

原计划的模型测试在临时项目和 ephemeral thread 内执行，指定 `gpt-6-astra`、never 审批、read-only 沙盒，要求只回复 `CODEX_CUTOVER_OK` 且不使用工具。恢复测试采用相同约束，改用 `CODEX_RECOVERY_OK` 标记。它会消耗一次测试推理，失败不重放；有已知 turn ID 的未完成测试会尝试中断，然后释放订阅和临时目录。

自动检查不绕过网页登录鉴权，不创建管理员凭据，也不把无凭据 401 检查称作已验证登录后的全部 UI。真实手机、带宽/内存趋势、登录后 SSE 与审批/附件交互仍保留原验收限制。需要查看 systemd 状态时可使用：

```bash
systemctl --user status codex-web-cutover-20260925.service --no-pager
cat ~/.codex-web/upgrade-backups/2026-09-25-app-server-refactor/cutover-status.json
scripts/service/status-codex-web-systemd-user.sh
```

关联：[实现记录](2026-09-25-app-server-implementation.zh-CN.md)、[升级与回退手册](../operations/app-server-upgrades.zh-CN.md)。原记录中的“未切换”是此前核查时点；此次新授权切换后的运行状态以上述最新结果为准。
