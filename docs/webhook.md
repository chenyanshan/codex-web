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

## 5. 选择模型和思考强度

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

## 6. 请求参数

| 字段 | 是否必填 | 说明 |
| --- | --- | --- |
| `text` | 是 | 本次发送的新消息，不能为空。 |
| `projectId` | 多人模式必填 | Codex Web 中显示的项目名，也兼容精确内部项目 ID。单用户模式不能传。 |
| `title` | 否 | session 标题，只在第一次创建 session 时使用。 |
| `model` | 否 | 新 turn 使用的模型 ID，区分大小写。 |
| `reasoningEffort` | 否 | 新 turn 使用的思考强度。 |

只接受以上字段。不能通过 Webhook 传入 `cwd`、`sessionId`、`attachments`、sandbox 或
approval policy。

`Idempotency-Key` header 必填，去除首尾空格后长度必须为 1 到 256 个字符。

## 7. 成功响应

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
回调，执行进度和最终答案需要在 Codex Web 对应 session 中查看。

## 8. 多用户隔离示例

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

## 9. 常见错误

| HTTP 状态 | 错误码 | 含义 |
| --- | --- | --- |
| `400` | `invalid_idempotency_key` | 缺少 `Idempotency-Key`，或长度不合法。 |
| `400` | `invalid_webhook_payload` | 缺少 `text`、项目参数不符合当前模式，或包含不支持的字段。 |
| `401` | `Unauthorized` | Webhook 未开启、key 错误、已轮转或用户已停用。 |
| `404` | `project_not_found` | 项目名不存在，或用户无权在该项目创建 session。 |
| `404` | `session_not_found` | 原 session 已删除，或用户不再有写权限。 |
| `409` | `active_turn_not_steerable` | 当前 review/compact turn 不能 steer，完成后重试。 |
| `409` | `webhook_conversation_conflict` | 同一个 `Idempotency-Key` 尝试切换项目。 |
| `409` | `session_archived` | 原 session 已归档，取消归档后重试。 |
| `409` | `active_session_limit_reached` | 项目 active session 已达到上限，先归档一个 session。 |
| `429` | `rate_limited` | 请求过快，按 `Retry-After` 等待后再试。 |

当前每个 Webhook key 最多 10 次请求/分钟。

## 10. 重试注意事项

`Idempotency-Key` 只负责把请求路由到同一个 session，不负责单条消息去重。

如果请求已经成功，但 HTTP 响应在网络中丢失，直接重试可能发送两条相同消息。对重复
消息敏感的调用方，应在业务侧记录请求状态，并在决定重试前核对 Codex Web 中的 session。

## 11. 安全说明

- Webhook key 是 bearer credential，应按密码保护。
- key 必须放在 `Authorization` header，不能放在 URL。
- 不要把 key 写入公开仓库、前端代码或请求日志。
- Webhook 可以在宿主 Mac 上触发 Codex 工作。当前默认 runtime 权限为
  `danger-full-access` 和 `approvalPolicy=never`。
