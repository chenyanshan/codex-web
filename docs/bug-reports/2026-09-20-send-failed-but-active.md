# 发送失败但会话仍显示“活动中”

日期：2026-09-20
现象来源：用户截图（10:08 的消息显示“发送失败”，10:09 的同类消息显示“活动中”）

## 结论

这是一次“客户端确认超时/失败”和“服务端已经继续执行”之间的状态分叉。它不是 SQL Server 权限判断结果，也不是 Codex 已经明确拒绝了请求。

前端发送采用本地 durable outbox：提交前先保存一条消息，HTTP 请求等待 30 秒；超时后把该条标记为 `failed`，同时保留重试能力。服务端可能已经创建了 session/turn，或仍在处理图片附件。随后自动重试或用户再次发送会创建另一条活动中的 turn，于是列表同时出现：

- 原消息：红色“发送失败”（本地 outbox 的失败投影）；
- 新消息：绿色“活动中”（另一个已被服务端接受、正在运行的 turn）。

因此“发送失败”和“活动中”并不互相矛盾，但当前产品把它们渲染成两张相似消息，容易让用户误以为同一次请求既失败又成功，且可能造成重复执行。

## 代码证据

1. `packages/codex-web/public/app.js:50-52` 将 `SUBMISSION_REQUEST_TIMEOUT_MS` 固定为 `30_000`。
2. `packages/codex-web/public/app.js:6558-6627` 超时后主动 `AbortController.abort()`，生成 `submission_timeout`，然后进入 `failSubmissionDelivery()`。
3. `packages/codex-web/public/app.js:6818-6858` 将消息写成 `status: 'failed'`，但保留在 outbox；可见失败后仍显示重试按钮。
4. `packages/codex-web/public/app.js:6530-6545` 和 `11224-11237` 会自动/手动重试同一消息。若服务端在第一次请求中已创建 turn，重试前缺少可靠的“结果未知”查询，UI 就会同时保留失败投影和新的活动 turn。
5. `packages/codex-web/src/server.ts:2907-3000` 服务端在收到请求后可能先创建 session、解析/快照附件，再调用 `runtime.startTurn()`；这些步骤可以超过前端 30 秒。异常路径还会把提交持久化为 failed（`3022-3032`），而成功路径将 submission 写为 submitted（`2989-3000`）。
6. 当前运行数据中，截图对应附件已落盘为 `att_497db6ed26aa4220b1b3`、`att_f0da1f37cf444958bb70`；对应提交最终记录为 `9b6f9db3-9b6c-4c2f-b575-f3668cc3f340`，服务端记录 `status: submitted`、turn `01a0bc93-f756-7d12-997e-c66bbd60e350`。这支持“前端失败显示与服务端最终接受不一致”的判断。

## 需要原始仓库修复的内容

### P0：把“结果未知”从 failed 中分离

- 超时、连接断开、502/网关超时必须进入 `outcome_unknown`，不能直接展示为“发送失败”。
- 服务端提交记录增加明确的 `starting/submitted/failed/outcome_unknown` 状态；对于 `outcome_unknown`，客户端先轮询 `GET /api/session-submissions/:id` 或按 submission/clientMessageId 查询结果，再决定是否重试。
- 重试前必须做幂等恢复：服务端按 submissionId、clientMessageId、turnBaseline 检查是否已创建 turn；已创建则返回原 turn，禁止再次 `startTurn`。

### P0：禁止未知结果时自动创建第二个 turn

- `deliverSubmission()` 遇到 `submission_timeout` 时不应直接进入普通 retry 队列。
- 恢复查询期间按钮文案改为“确认发送结果”；确认已提交后只打开原 session；确认未提交后才允许重试。
- 前端列表将本地 submission 与真实 session 合并显示，避免同一 prompt 出现两张卡片。

### P1：修复活动状态清理

- `turn.completed` / `turn.failed` / `turn.cancelled`、SSE 重连和页面刷新都必须清除同一 `activeTurnId`。
- 列表显示“活动中”必须同时满足 `activeTurnId` 仍存在且 runtime 查询确认 turn 处于 active；不能只依赖缓存字段。
- 对活动 turn 增加 stale TTL，超过 TTL 自动刷新 runtime，失败时显示“状态未知/需要刷新”，不能永久活动。

### P1：附件处理阶段提供可观测性

为以下阶段写入同一个 submissionId 的结构化日志和耗时：`accepted`、`session_created`、`attachment_resolved`、`attachment_snapshotted`、`turn_started`、`ack_sent`、`turn_failed`。当前日志只能看到 HTTP 结果，无法直接判断是附件快照、Codex 启动还是响应丢失。

## 验收标准

1. 人工制造服务端处理超过 30 秒：页面不得出现“发送失败 + 活动中”两条重复消息；应显示“确认发送结果”。
2. 服务端已创建 turn、客户端断网后恢复：查询原 submission 返回原 session/turn，重试不会产生第二个 turn。
3. 服务端明确拒绝（例如权限或参数错误）：只显示一条失败消息，并保留错误码和可重试性。
4. turn 已完成但 SSE 丢失：刷新后显示完成/失败，不得继续显示“活动中”。
5. 两个附件和纯文本请求都要覆盖上述测试，并验证 submissionId、turnId、clientMessageId 全链路一致。

## 现有环境的历史风险

2026-09-15 日志还记录过 `ENOSPC: no space left on device`、Codex thread history SQLite `database or disk is full`。这会造成真实请求失败和状态读取失败，应作为独立的基础设施告警处理；本次截图时磁盘已恢复可用，不能把该历史事件直接当作本次唯一根因。
