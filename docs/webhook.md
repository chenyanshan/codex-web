# Webhook 使用指南

Codex Web 的 Webhook 用于从外部系统发送消息并触发 Codex 工作。每个用户只有一个
Webhook key；同一个 key 可以通过不同的 `Idempotency-Key` 管理多段独立对话。

## 1. 开启 Webhook

1. 登录 Codex Web。
2. 打开“设置”。
3. 找到“Webhook”并开启。
4. 复制页面显示的 endpoint 和 key。

key 会一直显示并可复制，直到主动轮转。轮转后旧 key 立即失效，新 key 仍可继续访问
此前由该用户创建的 Webhook 对话。

请求地址固定为：

```text
POST https://你的域名/api/webhook
```

## 2. 单用户模式

单用户模式不需要、也不能传 `projectId`。任务运行目录是服务端配置的
`CODEX_WEB_DEFAULT_CWD`。

第一次发送：

```bash
curl --request POST 'https://codex-web.example/api/webhook' \
  --header 'Authorization: Bearer cwwh_REPLACE_ME' \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: task-001' \
  --data '{
    "title": "外部任务",
    "text": "检查当前项目的代码并运行测试"
  }'
```

## 3. 多人模式

多人模式必须传 `projectId`。这里可以直接填写 Codex Web 界面显示的项目名，例如当前
项目显示为 `CodeX Web`，就直接传 `CodeX Web`，不需要查内部 ID。项目名匹配不区分
大小写。

```bash
curl --request POST 'https://codex-web.example/api/webhook' \
  --header 'Authorization: Bearer cwwh_REPLACE_ME' \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: task-001' \
  --data '{
    "projectId": "CodeX Web",
    "title": "外部任务",
    "text": "检查当前项目的代码并运行测试"
  }'
```

第一次使用某个 `Idempotency-Key` 时，key 所属用户必须有权在目标项目创建 session。

## 4. 连续对话

`Idempotency-Key` 表示一段对话：

- 第一次使用某个值：创建一个新 session，并发送第一条消息。
- 继续使用同一个值：把新消息发送到原 session。
- 换一个值：创建另一段独立对话。
- 相同内容连续发送两次：会被当作两条消息，不会去重。

如果调用方需要避免单条消息因网络重试而重复执行，可以同时传入 `clientRequestId`。
两个 key 的语义不同：

- `Idempotency-Key`：逻辑会话键，决定消息进入哪个 Codex session。
- `clientRequestId`：单条消息幂等键，在同一个 Webhook key owner 下唯一。

相同 `clientRequestId` 和完全相同的请求重试会返回原 submission，不会创建第二个 turn。
如果同一个 `clientRequestId` 被用于不同的会话键、文本、项目、模型、思考强度或投递模式，
返回 `409 submission_conflict`。

继续上面的 `task-001`：

```bash
curl --request POST 'https://codex-web.example/api/webhook' \
  --header 'Authorization: Bearer cwwh_REPLACE_ME' \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: task-001' \
  --data '{
    "projectId": "CodeX Web",
    "text": "继续检查，并总结最重要的失败项"
  }'
```

如果原 session 当前空闲，这条消息会启动一个新 turn。如果普通 turn 仍在运行，消息会
通过 `turn/steer` 加入当前 turn，不会先中断它。

review 或 compact turn 不能接收 steer。此时请求返回
`409 active_turn_not_steerable`，应等当前 turn 完成后用相同参数重试。

同一个 `Idempotency-Key` 不能在后续请求中改到另一个项目。映射 session 被归档、删除
或不再有写权限时，也不会自动创建替代 session。

调用方不希望向 active turn 追加消息时，可以传：

```json
{
  "clientRequestId": "external-message-001",
  "deliveryMode": "reject_if_busy",
  "text": "等待 session 空闲后再执行"
}
```

如果 session 正忙，Codex Web 不会 start、steer 或 interrupt，而是返回
`409 session_busy`、当前 `activeTurnId` 和 `retryable: true`。调用方应保留原请求，等待后使用
完全相同的 `Idempotency-Key`、`clientRequestId` 和 JSON 内容重试。Codex Web 不会为 busy
请求建立后台队列。

## 5. 传入原始附件

IM 网关可以直接使用同一枚 Webhook key 将文件上传到受限的附件端点：

```text
POST /api/session-submission-attachments?projectId=<project-id>
Authorization: Bearer <webhook-key>
Content-Type: multipart/form-data
```

这里的 `Authorization` 使用 Webhook key（不是普通网页登录 token）。该 key 只在这个
附件上传端点获得额外的上传权限，不能因此访问其他普通 API。单用户模式也可以使用
`cwd=<configured-project-cwd>`。响应中的 `items[].id` 是短期
`attachmentId`，服务端会保存其用户、项目/工作目录、文件元数据和过期时间。随后将 ID
放入 Webhook JSON；不要把本地路径或二进制内容放入 Webhook 请求：

```json
{
  "text": "检查这个 PDF 和截图",
  "projectId": "CodeX Web",
  "attachmentIds": ["att_0123456789abcdef0123"]
}
```

`attachmentIds` 必须是最多 32 个不重复的非空字符串。每个 ID 都会在提交时重新校验
归属、项目范围、过期时间、普通文件类型、存储根目录和 25 MiB 单文件限制。PDF 作为
文件附件传入，PNG/JPEG/WebP 等图片保留图片附件语义并支持 `localImage`。

## 6. 选择模型和思考强度

`model` 和 `reasoningEffort` 都是可选字段：

```bash
curl --request POST 'https://codex-web.example/api/webhook' \
  --header 'Authorization: Bearer cwwh_REPLACE_ME' \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: task-model-001' \
  --data '{
    "projectId": "CodeX Web",
    "title": "深度检查",
    "text": "检查代码中的并发问题",
    "model": "gpt-5.6-sol",
    "reasoningEffort": "high"
  }'
```

可用模型和思考强度以 Codex Web 设置页显示的选项为准。也可以使用普通登录 token
请求 `GET /api/models`，读取 `items[].id` 和 `supportedReasoningEfforts`；Webhook key
本身不能读取该接口。

模型参数只在启动新 turn 时生效。如果消息被 steer 到正在运行的 turn，它会沿用当前
turn 的模型和思考强度。

## 7. 请求参数

| 字段 | 是否必填 | 说明 |
| --- | --- | --- |
| `text` | 是 | 本次发送的新消息，不能为空。 |
| `projectId` | 多人模式必填 | Codex Web 中显示的项目名，也兼容精确内部项目 ID。单用户模式不能传。 |
| `title` | 否 | session 标题，只在第一次创建 session 时使用。 |
| `model` | 否 | 新 turn 使用的模型 ID，区分大小写。 |
| `reasoningEffort` | 否 | 新 turn 使用的思考强度。 |
| `clientRequestId` | 否 | 单条消息幂等键；1 到 128 个安全字符。 |
| `deliveryMode` | 否 | `steer` 或 `reject_if_busy`，默认 `steer`。 |
| `attachmentIds` | 否 | 受认证上传接口返回的附件 ID，最多 32 个。 |

只接受以上字段。不能通过 Webhook 传入 `cwd`、`sessionId`、`attachments`、sandbox 或
approval policy。

`Idempotency-Key` header 必填，去除首尾空格后长度必须为 1 到 256 个字符。

## 8. 成功响应

第一次创建对话：

```text
HTTP 201 Created
```

继续已有对话，无论启动新 turn 还是 steer 当前 turn：

```text
HTTP 202 Accepted
```

响应示例：

```json
{
  "submission": {
    "id": "webhook:...",
    "status": "submitted",
    "sessionId": "session_...",
    "turnId": "turn_...",
    "error": null,
    "result": {
      "turnId": "turn_..."
    }
  },
  "turnId": "turn_..."
}
```

`201` 或 `202` 表示消息已经被接受，不表示 Codex 已完成任务。当前 Webhook 不提供完成
回调。带 `clientRequestId` 的请求可以通过以下接口轮询：

```text
GET /api/webhook/submissions/<encoded-clientRequestId>
Authorization: Bearer cwwh_...
```

示例响应：

```json
{
  "clientRequestId": "external-message-001",
  "status": "completed",
  "sessionId": "session_...",
  "turnId": "turn_...",
  "finalText": "最终回答",
  "error": null,
  "createdAt": "2026-08-12T10:00:00.000Z",
  "updatedAt": "2026-08-12T10:00:05.000Z"
}
```

状态包括 `queued`、`running`、`completed`、`failed` 和 `cancelled`。最终文本严格来自响应中
`turnId` 对应的 final assistant message，不包含 commentary 或内部 reasoning。建议运行中每
2 秒轮询一次，连续错误时指数退避到 10 秒。

## 9. 多用户隔离示例

`Idempotency-Key` 按 Webhook 用户隔离。Alice 和 Bob 即使使用相同的业务 ID，也会进入
各自独立的 session：

```bash
# Alice
curl -X POST 'https://codex-web.example/api/webhook' \
  -H 'Authorization: Bearer cwwh_ALICE' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: customer-42' \
  -d '{"projectId":"CodeX Web","text":"处理 Alice 的任务"}'

# Bob
curl -X POST 'https://codex-web.example/api/webhook' \
  -H 'Authorization: Bearer cwwh_BOB' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: customer-42' \
  -d '{"projectId":"CodeX Web","text":"处理 Bob 的任务"}'
```

## 10. 常见错误

| HTTP 状态 | 错误码 | 含义 |
| --- | --- | --- |
| `400` | `invalid_idempotency_key` | 缺少 `Idempotency-Key`，或长度不合法。 |
| `400` | `invalid_webhook_payload` | 缺少 `text`、项目参数不符合当前模式，或包含不支持的字段。 |
| `401` | `Unauthorized` | Webhook 未开启、key 错误、已轮转或用户已停用。 |
| `404` | `project_not_found` | 项目名不存在，或用户无权在该项目创建 session。 |
| `404` | `session_not_found` | 原 session 已删除，或用户不再有写权限。 |
| `409` | `active_turn_not_steerable` | 当前 review/compact turn 不能 steer，完成后重试。 |
| `409` | `session_busy` | `reject_if_busy` 请求遇到 active turn；原样稍后重试。 |
| `409` | `submission_conflict` | `clientRequestId` 已用于不同的请求内容，不应重试。 |
| `409` | `webhook_conversation_conflict` | 同一个 `Idempotency-Key` 尝试切换项目。 |
| `409` | `session_archived` | 原 session 已归档，取消归档后重试。 |
| `409` | `active_session_limit_reached` | 项目 active session 已达到上限，先归档一个 session。 |
| `429` | `rate_limited` | 请求过快，按 `Retry-After` 等待后再试。 |
| `404` | `submission_not_found` | 当前 Webhook owner 下没有对应 submission。 |

当前每个 Webhook key 最多 10 次请求/分钟。

## 11. 重试注意事项

`Idempotency-Key` 只负责把请求路由到同一个 session，不负责单条消息去重。需要安全重试时
必须提供稳定的 `clientRequestId`。

网络错误或 `5xx` 应使用相同 payload 重试；`429` 按 `Retry-After` 重试；`session_busy`
等待后原样重试；`submission_conflict`、`400`、`401` 和 `403` 不应自动重试。

当前 1.0 只保证服务持续运行期间的请求幂等和状态查询，不承诺 Codex Web 进程重启窗口内
的幂等恢复或终态恢复。

## 12. 安全说明

- Webhook key 是 bearer credential，应按密码保护。
- key 必须放在 `Authorization` header，不能放在 URL。
- 不要把 key 写入公开仓库、前端代码或请求日志。
- Webhook 可以在宿主 Mac 上触发 Codex 工作。当前默认 runtime 权限为
  `danger-full-access` 和 `approvalPolicy=never`。
