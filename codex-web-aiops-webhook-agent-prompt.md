# Codex Web AIOps Webhook 增强开发提示词

你需要在当前 Codex Web 仓库中，实现 AIOps 飞书接入所需的最小 webhook 增强。

先完整阅读仓库中的 `AGENTS.md`、webhook 文档，以及 webhook、session submission、runtime、timeline 相关源码和测试。完成代码、测试和文档，不要只输出设计方案。

## 一、背景与边界

外部 AIOps 网关负责：

- 飞书事件验签、解密和 `message_id` 去重；
- 真实 @ 检测；
- Work 创建和路由；
- 私聊 2 小时 `current_work` 机制；
- Work 级 FIFO 消息队列；
- 工作包持久化；
- 飞书原消息或话题回复；
- Codex Web busy 后的排队和重试。

上述能力不要放进 Codex Web。

AIOps 当前不具备生产环境写能力。本阶段不实现：

- 用户级权限体系；
- 飞书身份与 Codex Web 用户映射；
- credential profile；
- 生产动作审批；
- webhook 原生附件；
- 完成 callback、SSE 或 WebSocket；
- 闲聊 Session；
- 意图分类或模型路由；
- Codex Web 内部 FIFO 消息队列。

每次排查由 AIOps 网关提交：

- `Idempotency-Key`：稳定的逻辑 Session key，例如 `work:<work_id>:<chat_id>:g1`；
- `clientRequestId`：单条飞书消息的唯一标识，例如 `fsmsg:<tenant_hash>:<message_id>`；
- `deliveryMode: reject_if_busy`；
- 排查模型；
- `reasoningEffort: high`。

## 二、必须保持的现有语义

现有 `POST /api/webhook` 使用 `Idempotency-Key` 将一个 webhook owner 下的逻辑会话绑定到 Codex Session。

必须保持：

- 第一次使用某个 `Idempotency-Key` 时创建 Session；
- 后续使用同一个 key 时继续原 Session；
- 不同 key 创建不同 Session；
- 老请求没有单条消息幂等能力；
- Session 有普通 active Turn 时，老请求默认 steer；
- 现有 webhook credential、项目权限和会话映射继续有效。

不要改变 `Idempotency-Key` 的含义，也不要把它改成单条请求去重键。

## 三、目标一：单条 webhook 请求幂等

扩展 `POST /api/webhook`，接受可选字段：

```json
{
  "clientRequestId": "fsmsg:<tenant_hash>:<message_id>",
  "deliveryMode": "reject_if_busy",
  "projectId": "AIOps",
  "text": "排查内容",
  "model": "<model-id>",
  "reasoningEffort": "high"
}
```

两个 key 的语义必须明确分离：

```text
Idempotency-Key
  = 逻辑会话键
  = 决定进入哪个 Codex Session

clientRequestId
  = 单条消息键
  = 防止同一条消息创建多个 Turn
```

### 3.1 幂等范围

`clientRequestId` 在同一个 webhook owner 下全局唯一。

逻辑主键等价于：

```text
ownerUserId + clientRequestId
```

幂等指纹至少必须包含：

```text
conversationKeyHash
projectId
text
model
reasoningEffort
deliveryMode
```

可以包含实现所需的其他稳定字段，但不能包含时间戳、随机数等不稳定值。

### 3.2 行为要求

1. 同一个 owner、同一个 `clientRequestId`、同一个会话键和完全相同的有效 payload 重试：
   - 返回原 submission；
   - 不创建第二个 Session；
   - 不创建第二个 Turn；
   - 不重复 steer。

2. 同一个 owner 下，相同 `clientRequestId` 被用于不同请求内容时，返回：

```http
HTTP 409
```

```json
{
  "error": "submission_conflict",
  "message": "This clientRequestId was already used with different request content."
}
```

冲突范围包括：

- 不同 `Idempotency-Key`；
- 不同文本；
- 不同项目；
- 不同模型；
- 不同 reasoning effort；
- 不同 delivery mode。

3. 不同 webhook owner 可以使用相同 `clientRequestId`，互不影响。
4. 并发重复请求和 Codex Web 进程重启后仍满足幂等。
5. `clientRequestId` 只能作为可信元数据和幂等标识，不能进入模型提示词。
6. 未传 `clientRequestId` 时保持现有行为：继续会话时为每个请求生成新的 submission ID，不增加消息去重。
7. 优先复用现有 session submission store、payload hash、submission operation lock 和 uncertain-outcome recovery，不要新建一套功能重复的幂等存储。
8. 可以使用由 `clientRequestId` 稳定派生的内部 submission ID，但不能在日志、路径或持久文件 key 中直接信任未经处理的外部输入。
9. 为 `clientRequestId` 增加明确的长度和字符校验。除非现有规范有更合适的限制，建议兼容现有 submission ID 的安全字符集和 128 字符上限。

## 四、目标二：忙时拒绝，不自动 steer

新增可选字段：

```json
{
  "deliveryMode": "reject_if_busy"
}
```

支持的模式：

```text
steer
reject_if_busy
```

默认值必须是 `steer`，从而保持老调用方行为不变。

### 4.1 `reject_if_busy` 行为

Session 空闲时：

- 正常启动新 Turn。

Session 已有 active Turn 时：

- 不调用 `turn/steer`；
- 不中断当前 Turn；
- 不启动新的 Turn；
- 返回：

```http
HTTP 409
```

```json
{
  "error": "session_busy",
  "message": "The session already has an active turn.",
  "activeTurnId": "turn_...",
  "retryable": true
}
```

AIOps 网关会保留该消息，等待当前 Turn 完成，然后使用完全相同的 `Idempotency-Key`、`clientRequestId` 和 payload 重新提交。

### 4.2 busy 与幂等要求

1. busy 请求必须保留其幂等占位和请求指纹。
2. 使用相同内容重试时不得发生 `submission_conflict`。
3. Session 空闲后，相同请求只能启动一次。
4. 使用同一个 `clientRequestId` 修改内容后重试必须返回冲突。
5. 如果检查 Session 空闲后，`startTurn` 又因竞态发现 active Turn，将该冲突统一映射为 `409 session_busy`。
6. 不能因为 busy 而在 Codex Web 内建立后台 FIFO 队列。
7. busy 可以持久化为 retryable failure；状态接口应明确返回 `retryable: true`。
8. 默认 `steer` 模式必须继续兼容当前行为，包括普通 active Turn 的 steer 和不可 steer Turn 的既有错误语义。

## 五、目标三：查询 Turn 最终状态

新增由 webhook bearer credential 访问的接口：

```http
GET /api/webhook/submissions/<encoded-clientRequestId>
Authorization: Bearer cwwh_...
```

该接口只要求查询带 `clientRequestId` 创建的新请求，不要求为旧历史 webhook submission 建立反向索引。

### 5.1 响应格式

```json
{
  "clientRequestId": "fsmsg:<tenant_hash>:<message_id>",
  "status": "running",
  "sessionId": "session_...",
  "turnId": "turn_...",
  "finalText": null,
  "error": null,
  "createdAt": "2026-08-12T10:00:00.000Z",
  "updatedAt": "2026-08-12T10:00:05.000Z"
}
```

统一对外状态：

```text
queued
running
completed
failed
cancelled
```

建议映射：

```text
请求已登记但尚未获得 Turn
  -> queued

Turn 已启动且尚未终止
  -> running

对应 Turn 正常终止
  -> completed

提交失败或 Turn 执行失败
  -> failed

Turn 被明确取消或中断
  -> cancelled
```

### 5.2 状态查询要求

1. `completed` 时返回该 `turnId` 对应的最终 assistant 文本。
2. 必须按 `turnId` 筛选结果，不能返回同一 Session 中其他 Turn 的答案。
3. 不得返回 commentary、内部 reasoning 或 chain-of-thought。
4. `failed` 和 `cancelled` 返回结构化错误，例如：

```json
{
  "code": "session_busy",
  "message": "The session already has an active turn.",
  "retryable": true
}
```

5. 不存在时返回：

```http
HTTP 404
```

```json
{
  "error": "submission_not_found"
}
```

6. webhook credential 只能查询其 owner 创建的 submission。
7. 不同 owner 使用相同 `clientRequestId` 时，查询结果必须隔离。
8. GET 不得创建 Session、启动 Turn、steer、重试失败提交，或调用任何具有推进副作用的 submission 方法。
9. GET 可以读取 runtime Session、Turn 和 timeline，并持久化观察到的终态，但不能触发执行行为。
10. 服务重启后，能够结合持久 submission 记录及 Session/Turn 历史恢复状态。
11. 如果 outcome 曾经 unknown，应使用已有 client message ID、turn baseline 和 Turn 历史进行只读校准，不能盲目重提。
12. 状态查询使用独立的读限流策略，不能消耗现有 `POST /api/webhook` 的限额。
13. 本阶段只实现轮询，不实现 callback、SSE、WebSocket 或新的 Event Bridge。

优先复用现有 runtime Session status、timeline、Turn notification 和 submission recovery 能力，不重新实现 `codex app-server` JSON-RPC。

## 六、向后兼容要求

这是硬性验收条件。

### 6.1 API 兼容

1. `clientRequestId` 是可选字段。
2. `deliveryMode` 是可选字段。
3. 未传 `clientRequestId` 时：
   - 保持当前每次请求创建独立 submission 的行为；
   - 相同文本重复提交仍视为两条消息。
4. 未传 `deliveryMode` 时默认使用现有 steer 行为。
5. 老请求的 HTTP 状态、响应结构、Session 续接和 steer 行为不得发生破坏性变化。
6. 不改变现有 webhook endpoint 和 bearer credential 格式。

### 6.2 配置兼容

1. 现有 webhook credential 继续有效。
2. 不要求用户轮换、重新生成或重新绑定 credential。
3. 不新增老调用方必须配置的环境变量。
4. 新状态接口复用现有 webhook credential。

### 6.3 持久化兼容

1. 保留现有 `Idempotency-Key -> sessionId` 映射。
2. 不重建、不复制现有 Session。
3. 现有 webhook conversation 记录必须继续可读。
4. 现有 session submission 记录必须继续可读。
5. 旧记录缺少新增字段时，由 normalization 提供安全默认值。
6. 尽量保持现有文件版本；如果确实需要升级：
   - 实现向后兼容读取；
   - 使用原子写；
   - 不破坏现有数据；
   - 添加迁移和重启测试。
7. 旧的归档、删除、项目冲突和 credential owner 行为保持不变。

### 6.4 推荐部署顺序

系统必须支持：

```text
1. 先升级 Codex Web
2. 老 AIOps webhook 请求继续运行
3. AIOps 网关逐步开始发送 clientRequestId
4. 再启用 deliveryMode=reject_if_busy
```

中间任何阶段都不能中断老链路。

## 七、建议的请求和重试流程

新 AIOps 请求：

```http
POST /api/webhook
Authorization: Bearer cwwh_...
Idempotency-Key: work:WRK-123:chat-456:g1
Content-Type: application/json
```

```json
{
  "clientRequestId": "fsmsg:tenant-hash:message-id",
  "deliveryMode": "reject_if_busy",
  "projectId": "AIOps",
  "text": "查询支付服务最近一小时的错误日志",
  "model": "<configured-investigation-model>",
  "reasoningEffort": "high"
}
```

处理规则：

```text
201/202
  -> 保存 sessionId 和 turnId
  -> 轮询状态接口

409 session_busy
  -> AIOps 网关保持消息 queued
  -> 等当前 Turn 完成
  -> 使用同一请求重试

409 submission_conflict
  -> 不重试
  -> 记录路由或调用方错误

429
  -> 按 Retry-After 重试

网络错误或 5xx
  -> 使用相同 clientRequestId 和 payload 重试

401/403
  -> 不自动重试
  -> 报告 credential/configuration 错误
```

## 八、实现约束

1. 复用 `CodexAppClient` 和现有 runtime，不重复实现 app-server transport。
2. 保持文件聚焦，避免把所有新增逻辑继续堆入一个大型 handler。
3. 如果 server handler 复杂度明显增加，可提取小型、职责明确的 webhook submission helper/store。
4. 不允许请求方通过新增字段控制 cwd、sandbox、approval policy、runtime environment、credential 或任意 callback URL。
5. 不修改与本任务无关的 UI。
6. 不修改外部 AIOps 项目。
7. 不处理飞书特有的 Work、chat、thread 或 2 小时逻辑。
8. 保留工作树中用户已有的无关修改，不得回滚或覆盖。
9. 不提交生成的 secret、runtime state、日志或本地 env 文件。

## 九、测试要求

优先扩展现有 webhook 和 session submission 测试。至少覆盖以下场景。

### 9.1 幂等

- 相同 `clientRequestId`、相同请求重试只创建一个 Turn；
- 响应丢失后重试仍只创建一个 Turn；
- 并发重复提交只执行一次；
- 进程重启后重试仍只执行一次；
- 相同 ID、不同 text 返回 `submission_conflict`；
- 相同 ID、不同会话键返回 `submission_conflict`；
- 相同 ID、不同 model、reasoning effort 或 delivery mode 返回冲突；
- 不同 owner 使用相同 ID 相互隔离；
- `clientRequestId` 不进入模型输入。

### 9.2 busy

- `reject_if_busy` 发现 active Turn 时不调用 start；
- `reject_if_busy` 发现 active Turn 时不调用 steer；
- 返回 `409 session_busy`、`activeTurnId` 和 `retryable: true`；
- busy 后使用相同 ID 重试，空闲时最终只启动一次；
- busy 后修改 payload 重试返回冲突；
- 空闲检查与 start 之间的 active-turn 竞态映射为 `session_busy`；
- 默认模式仍执行当前 steer 行为。

### 9.3 状态查询

- queued 状态；
- running 状态；
- completed 状态及正确 `finalText`；
- 同一 Session 有多个 Turn 时只返回目标 Turn 的 final；
- 不返回 commentary 或内部 reasoning；
- failed 状态；
- cancelled 状态；
- retryable busy 状态；
- submission not found；
- 跨 owner 查询隔离；
- 服务重启后状态恢复；
- GET 查询不会 start、steer 或重试 Turn；
- GET 不占用 POST webhook 限流配额。

### 9.4 向后兼容

- 老请求不带新字段时仍正常创建和续接 Session；
- 老请求相同文本提交两次仍产生两次输入；
- 老请求 Session busy 时仍默认 steer；
- 现有 webhook credential 无需变更；
- 现有 conversation mapping 重启后仍可读取；
- 旧 submission 记录缺少新字段时仍可读取；
- 既有错误码和项目绑定行为不变。

## 十、文档要求

更新 webhook 文档，明确说明：

1. `Idempotency-Key` 是逻辑会话键；
2. `clientRequestId` 是单条消息幂等键；
3. 两者的作用域和冲突行为；
4. 新字段均为可选字段；
5. 默认 `deliveryMode=steer`；
6. `reject_if_busy` 和 `409 session_busy`；
7. 状态查询 endpoint、认证方式和响应字段；
8. `queued/running/completed/failed/cancelled` 的含义；
9. 推荐轮询间隔和退避策略；
10. 网络错误、429、busy 和不可重试错误的处理方式；
11. 老 credential、老配置和老请求无需迁移；
12. `201/202` 仍只表示已受理，不表示 Turn 已完成。

## 十一、验证要求

先检查仓库脚本，再运行适合本仓库的命令。

至少执行：

```bash
npm run typecheck
```

运行 webhook 和 session submission 相关 focused tests，随后尽可能运行：

```bash
npm test
```

如果完整测试因环境问题无法完成，必须说明具体失败原因和已通过的 focused tests，不得声称所有测试通过。

## 十二、最终交付说明

最终回复需要包含：

1. 修改了哪些文件；
2. 新增或变更的 API；
3. 老 webhook 如何保持兼容；
4. 幂等主键和冲突语义；
5. busy 请求如何重试；
6. 状态如何从 submission、Turn 和 timeline 恢复；
7. 运行了哪些测试及结果；
8. 尚未实现的后置能力；
9. 仍存在的技术风险。

不要在完成实现和验证之前结束任务。
