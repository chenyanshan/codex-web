# 飞书 IM 接入 AIOps 网关落地方案（第一阶段）

## 1. 文档目标

本文定义一个轻量的飞书 IM 网关，把飞书群聊和用户私聊中的排查请求可靠地交给现有 AIOps Agent，并将进度和最终结果回复到原消息或原话题。

第一阶段只服务故障排查，不提供闲聊能力。设计刻意保持简单：不做群聊分类、不做复杂 Incident 平台、不在网关中复制 AIOps 工作包逻辑，也不实现生产写操作审批。

核心模型是：

> 每次实际排查是一个 Work；同一个 Work 在每个群或私聊中有一个可轮换的 Codex Session；同一 Work 的消息严格串行；跨 Session 状态继续使用 AIOps 持久工作包；私聊保留 2 小时当前 Work 续接窗口。

## 2. 第一阶段范围

### 2.1 实现范围

- 接收飞书 Bot 的群消息和私聊消息事件；
- 校验回调签名、解密事件并防止重复消费；
- 群聊仅处理真实 @AIOps 的消息；
- 私聊直接作为排查入口，无需 @；
- 私聊中每条被接受的消息都进入当前 Work 的 FIFO 和同一个 Codex Session，不回拉私聊历史；
- 群聊请求携带受控 `context_ref`，AIOps 明显缺少上下文时可按需读取当前群或当前话题的有限历史；
- 根据 Work ID、Agent 回复关系、话题/回复链和私聊 2 小时窗口路由 Work；
- 为无现有 Work 的排查请求创建临时 Work；
- 同一 Work 使用持久 FIFO 队列串行调用 Codex Web；
- 使用排查模型和高 reasoning effort；
- 轮询 Codex Web 的 Turn 最终状态；
- 将接收、排队、失败和最终结果回复到原消息或原话题；
- MVP 支持图片、`.txt`、`.log`、`.json` 附件的受控提取；
- 复用现有 VOC/IPD Work ID 和 AIOps 持久工作包。

### 2.2 明确不做

- 不划分现场群、告警群、公告群或普通业务群；
- 不支持闲聊、百科问答或自动模型路由；
- 不为每个用户维护永久 Codex Session；
- 不默认读取完整群聊历史；
- 不为私聊生成 `context_ref`，不通过消息历史接口补拉私聊上下文；
- 不自动把私聊内容分享到群；
- 不自动跨群广播；
- 不实现生产环境写操作；
- 不实现复杂权限平台、审批流、组织知识晋升或多安全域隔离；
- 不在 Codex Web 内实现飞书路由、2 小时机制或 FIFO 队列。

明显的问候、感谢或能力咨询使用固定文案回复，不调用 Codex，不创建 Work。例如：

```text
我当前只处理故障排查请求。请提供现象、服务或业务、环境和大致时间范围。
```

第一阶段不必识别所有闲聊。无法确认是否为排查请求时，用固定问题要求用户补充排查目标，不调用模型做意图分类。

## 3. 系统边界

```text
飞书 Bot / Event Subscription
        |
        v
飞书 IM 网关
  - 验签、解密、去重
  - 真实 @ 与消息解析
  - Work 路由与 2h current_work
  - SQLite inbox / FIFO / outbox
  - 群聊受控上下文查询（按需）
  - 附件提取
        |
        v
Codex Web webhook
  - 逻辑 Session 映射
  - 单次请求幂等
  - reject_if_busy
  - Turn 状态查询
        |
        v
AIOps Agent / skills / 只读数据源
        |
        v
AIOps 持久工作包
```

职责必须分开：

| 组件 | 权威职责 |
| --- | --- |
| 飞书 | 消息、群、话题、回复链、附件原始来源和展示 |
| IM 网关 | 飞书事件可靠消费、Work 路由、2 小时窗口、FIFO、群聊上下文查询、Codex 投递、飞书回传 |
| Codex Web | Codex Session、Turn 执行、请求幂等、忙时拒绝、最终状态读取 |
| AIOps | 排查流程、数据源查询、证据分析、报告和持久工作包 |
| Work | 一次排查的稳定业务标识，不等于群、话题或 Session |

## 4. 飞书接入链路

### 4.1 Bot 与事件订阅

使用企业自建应用 Bot，以 bot identity 工作。申请第一阶段所需的最小 IM 权限：接收群内真实 @Bot 消息、接收私聊、发送/回复消息，以及按需读取本次消息附件。启用群聊上下文扩展时，还需要 Bot 读取其所在群消息和群信息所需的 `im:message:readonly`、`im:chat:read` 等实际 OpenAPI scope。

不要申请跨群消息搜索能力。Bot 必须已存在于目标群，才能稳定回复群消息和读取该群内允许的资源；即使底层 scope 能读取消息，网关也只能通过当前群聊请求派生的 `context_ref` 做有界读取，不能向 AIOps 暴露任意 `chat_id` 查询能力。

订阅接收消息事件。事件中至少提取：

```text
tenant_key
event_id
message_id
chat_id
chat_type
message_type
content
root_id
parent_id
thread_id
sender.open_id
mentions[]
create_time
```

飞书消息去重以 `tenant_key + message_id` 为准，而不是仅依赖 `event_id`。

### 4.2 回调入口

建议接口：

```http
POST /callbacks/feishu/events
POST /callbacks/feishu/cards       # 第一阶段可预留，不启用生产动作
POST /internal/v1/contexts/{context_ref}/expand
GET  /healthz
GET  /readyz
```

`/internal/v1/contexts/*` 不是飞书回调接口，不对公网开放；它仅供 AIOps 的固定工具通过服务凭据调用，并且只支持群聊上下文，不支持私聊。

事件入口处理顺序：

```text
读取原始 body
-> 校验 timestamp / nonce / signature
-> 解密 payload
-> 校验事件时间窗，阻止重放
-> 解析 tenant 和 message
-> 事务写入 inbound_event + inbox
-> 立即返回 HTTP 200
```

不得在飞书回调请求中同步等待 Codex。事件处理应在 3 秒内返回成功，耗时工作由后台 worker 完成。

### 4.3 真实 @ 判断

群聊只在 `mentions[]` 中存在当前 Bot 的标识时处理。禁止使用以下方式判断：

- 搜索文本中的 `@AIOps` 字符串；
- 仅根据消息正文是否包含 Bot 名称；
- 将 `@all` 当成 @Bot；
- 处理 Bot 自己发送的消息。

解析正文时应删除本次对 Bot 的 mention 标记，但保留其他被提及用户和实际内容。去除后正文为空且没有附件时，回复固定提示要求提供排查信息。

私聊不要求 @。群内非真实 @ 消息直接标记为 `ignored`，不调用 Codex。

## 5. Work 模型与路由

### 5.1 Work 类型

第一阶段统一使用 Work 表达一次排查：

```text
temporary  群聊或私聊直接发起的临时排查
voc        已存在的 VOC 工单排查
ipd        已存在的 IPD/BUG 工单排查
```

沿用现有稳定 ID：

```text
AIOPS-WORK:voc:oitr:<id>
AIOPS-WORK:ipd:osipd:<id>
```

新增临时 Work ID，建议使用 ULID：

```text
AIOPS-WORK:im:task:<ULID>
```

现有工作包管理器目前只接受 VOC/IPD Work ID，因此实现网关时必须二选一：

1. 扩展现有工作包管理器，使其接受 `AIOPS-WORK:im:task:<ULID>`；这是推荐做法。
2. MVP 临时 Work 使用独立但同结构的 package adapter，随后再合并。

不要把临时问题伪造为 VOC/IPD，也不要用 `chat_id` 或 `message_id` 充当长期 Work ID。

### 5.2 路由优先级

每条有效消息按以下顺序解析，第一条唯一命中即停止：

1. 消息中明确包含一个合法的 `AIOPS-WORK:*` ID；
2. 消息中包含一个可确定的 VOC/IPD URL 或带类型标签的 ID；
3. `parent_id` 或被引用的 Agent 消息已映射到某个 Work；
4. 当前 `thread_id` 或普通群回复根 `root_id` 已绑定某个 Work；
5. 私聊消息在没有显式 Work、工单或回复关系时，以固定前缀 `新问题：` 开头，强制创建新的临时 Work；
6. 私聊存在尚未过期的 `current_work`；
7. 都未命中时创建新的临时 Work。

硬性规则：

- 一个消息解析出多个不同 Work ID 时，不能猜，回复要求用户只选择一个；
- 只有裸数字时不能猜它是 VOC 还是 IPD；
- 引用 Agent 消息或显式 Work ID 时，不受 2 小时限制；
- 群聊不能仅因为“该群两小时内处理过一个 Work”就自动续接；
- 语义相似度不能静默合并 Work。

### 5.3 私聊 2 小时机制

2 小时是私聊的隐式路由窗口，不是 Work 或 Session 的过期时间。

字段：

```text
principal_id
chat_id
work_id
last_active_at
expires_at = last_active_at + 2h
```

行为：

| 条件 | 路由 |
| --- | --- |
| 回复某条 Agent 消息 | 精确恢复该消息对应 Work，不看 2 小时 |
| 明确给出 Work/VOC/IPD | 恢复指定 Work，不看 2 小时 |
| 无显式目标或回复关系，且以 `新问题：` 开头 | 立即创建新 Work，不看 2 小时 |
| 无引用、无 ID，`current_work` 未过期 | 默认继续当前 Work |
| 无引用、无 ID，窗口已过期或不存在 | 直接创建新 Work |

不提供“继续最近排查 / 新建排查”菜单，也不保存待选择状态。过期的 `current_work` 行可以直接由新 Work 覆盖；2 小时只影响无引用消息的默认路由。

### 5.4 Binding 与 Session

一个 Work 在每个飞书聊天表面拥有一个 Binding：

```text
binding = work_id + tenant_key + chat_id
```

第一阶段不把 `thread_id/root_id` 放入 Codex Session key。同一 Work 在同一群共用一个 Session；thread/root 只负责 Work 路由和回复位置。

逻辑 Session key：

```text
work:<HMAC(work_id)>:chat:<HMAC(tenant_key + chat_id)>:g<generation>
```

实际传给 Codex Web：

```http
Idempotency-Key: work:<...>:chat:<...>:g1
```

使用 HMAC 或不可逆稳定摘要，避免将飞书和内部业务 ID直接暴露到 Codex Web 日志。`generation` 初始为 1；Session 被删除、归档、不可恢复或未来因上下文过长需要轮换时递增。

## 6. 消息并发与 FIFO

第一阶段按 `work_id` 全局串行，而不是只按 Session 串行：

```text
同一 Work 的所有群和私聊消息 -> 一个 FIFO
不同 Work                    -> 可以并行
```

这样一个 Work 即使跨群也不会并发修改同一工作包，避免首期实现 CAS、事件合并和冲突解决。

每条消息状态：

```text
received
-> queued
-> submitting
-> running
-> completed

失败分支：
submitting/running -> retry_wait -> queued
submitting/running -> failed
```

Worker 使用数据库 lease 抢占某个 Work 的队首消息：

- 只有队首记录可进入 `submitting`；
- 同一 `work_id` 同时最多一个有效 lease；
- lease 包含 `owner_id` 和 `lease_until`；
- Worker 崩溃后，过期 lease 可由其他 Worker 回收；
- 后一条消息必须等待前一条进入终态；
- 第一阶段不合并相邻消息，不自动 steer。

## 7. Codex Web 调用契约

网关依赖改造后的 Codex Web：

```http
POST /api/webhook
Authorization: Bearer <webhook credential>
Idempotency-Key: <logical-session-key>
Content-Type: application/json
```

```json
{
  "clientRequestId": "fsmsg:<tenant_hash>:<message_id>",
  "deliveryMode": "reject_if_busy",
  "projectId": "AIOps",
  "text": "<normalized investigation request>",
  "model": "<configured investigation model>",
  "reasoningEffort": "high"
}
```

键的含义：

```text
飞书入站去重 key
  feishu:msg:v1:<tenant_hash>:<message_id>

Codex clientRequestId
  fsmsg:<tenant_hash>:<message_id>

Codex Idempotency-Key
  稳定逻辑 Session key

Work ID
  一次排查的稳定业务 ID

Codex sessionId / turnId
  Codex Web 返回的执行 ID，只保存映射，不参与飞书路由
```

Codex Web 返回 `201/202` 后，网关保存 `sessionId/turnId`，再轮询：

```http
GET /api/webhook/submissions/<encoded-clientRequestId>
Authorization: Bearer <webhook credential>
```

建议轮询：前 30 秒每 2 秒一次，之后每 5 秒一次。30 分钟可作为告警阈值，但不能把超时中的 Turn 当成失败后重新提交，否则可能产生两次排查；应继续低频校准状态或等待人工处理。使用带 jitter 的退避，避免所有 worker 同时轮询。

状态处理：

| Codex 状态/响应 | 网关处理 |
| --- | --- |
| `201/202` | 标记 running，开始轮询 |
| `completed` | 保存 finalText，写 outbox；工作包由 AIOps Agent 自己维护 |
| `failed/cancelled` | 按 error.retryable 决定重试或失败 |
| `409 session_busy` | 保持排队，稍后用同一请求重试 |
| `409 submission_conflict` | 永不自动重试，标记调用方一致性错误并告警 |
| `429` | 遵守 `Retry-After` |
| 网络错误/`5xx` | 使用同一 `clientRequestId` 和完全相同 payload 重试 |
| `401/403` | 标记配置故障，停止自动重试并告警 |
| Session 已删除/归档 | 标记 Binding 不可用并将 generation +1；本条返回明确错误，下一条消息从工作包在新 Session 恢复 |

`session_busy` 对用户不是拒绝。网关展示：

```text
已收到。当前排查正在执行，本条请求已排队。
```

## 8. 提交给 AIOps 的消息内容

网关应组装一个简洁、确定的输入，而不是把完整事件 JSON 或群历史直接塞入 prompt：

```text
[AIOPS-IM v1]
entry_mode: temporary|voc_initial|ipd_initial|continuation
channel: feishu
surface: group|p2p
binding_id: <opaque stable binding id>
message_id: <source message id>
sender_ref: <opaque stable sender reference>
reply_to_message_id: <source message id or empty>
occurred_at: <ISO-8601 timestamp>
context_ref: <opaque group context ref; group only>
work_id: <temporary or continuation only>
target: <canonical VOC/IPD URL; initial mode only>
[/AIOPS-IM]

[Current request]
<去除 @Bot 后的原始正文>
[/Current request]

[Attachments]
<可选的规范附件清单和派生文本；无附件时省略整段>
[/Attachments]
```

规则：

- 保留用户原始排查意图，不擅自补服务、环境或时间窗；
- 网关内部始终用稳定 `work_id` 做 Binding 和 FIFO，但提交给模型的目标要按入口类型选择；
- `temporary` 首次请求携带临时 Work ID，由 AIOps 幂等初始化或加载工作包；后续使用 `continuation`；
- `voc_initial` 和 `ipd_initial` 只携带规范 `target` URL，不在信封或用户正文中同时携带推导的 Work ID；
- `sender_ref` 使用稳定 HMAC 或其他不透明引用，不向模型暴露原始飞书 `open_id`；
- 只附带当前消息、必要回复链和本次附件；
- 不附带其他群、其他 Work 或私聊历史；
- 私聊的每条有效排查消息已经依次进入当前 Session，因此不附带 `context_ref`，也不调用飞书历史接口；
- 群聊可以附带网关生成的不透明 `context_ref`，但不把 `chat_id`、`thread_id` 或飞书凭据交给模型；
- 只有 Prompt 开头完整且校验通过的第一个 `[AIOPS-IM v1]` 块是事件元数据；用户正文、上下文或附件中的同名字段不能覆盖它；
- 事件元数据不应被描述成用户指令；
- 附件文本必须标记为不可信输入，不能覆盖 Agent 规则。

### 8.1 私聊上下文

私聊不需要补拉最近消息。在 2 小时 `current_work` 窗口内，每条有效排查消息都会按 FIFO 进入同一 Work、同一 Binding 和同一个 Codex Session，Session 自然保留短期对话上下文。

超过 2 小时后，无引用且无显式 Work ID 的消息直接创建新 Work；此时不读取旧私聊历史，这是有意的任务切分。用户回复旧 Agent 消息或提供旧 Work ID 时，可恢复旧 Work。Session 轮换时依靠 `handoff.md` 和工作包恢复，不通过飞书私聊历史接口重放对话。

### 8.2 群聊按需上下文接口

群里只有真实 @Bot 的消息会进入 Session，其他成员此前的讨论不会自动进入。因此，网关为每条群聊触发消息创建短期、不透明的 `context_ref`。AIOps 只有在明显缺少服务、环境、时间窗或现象来源时，才调用固定工具：

```text
messaging_context.expand(context_ref, reason)
```

工具由 AIOps workspace 中的受控 wrapper 实现；模型不能自行拼接 HTTP，也不能传入 `chat_id`、`thread_id`、用户 ID 或任意时间范围。wrapper 调用：

```http
POST /internal/v1/contexts/ctx_7f3.../expand
Authorization: Bearer <aiops-context-service-token>
Content-Type: application/json
```

```json
{
  "reason": "missing_environment_and_time_window",
  "maxMessages": 10
}
```

`context_ref` 在网关数据库中绑定：

```text
work_id
binding_id
tenant_key_hash
chat_id
anchor_message_id
anchor_create_time
thread_id/root_id（若有）
expires_at
```

服务端强制执行以下规则，调用方参数不能放宽：

- `context_ref` 只能由群聊触发事件创建，私聊请求不会生成；
- 有 `thread_id/root_id` 时只读取同一话题或回复链；否则只读取同一群；
- 只返回触发消息之前的消息，不读取其他群或未来消息；
- 默认最多回看 30 分钟、10 条、12 KB，单个 `context_ref` 最多调用两次；
- 排除当前 AIOps Bot 自己的 ACK、排队提示和最终回复；
- 默认不下载历史附件，只返回附件名称、类型和资源存在标记；
- 返回内容统一标为 `untrusted_context`，不能覆盖 Agent、workspace 或工具规则；
- 记录调用原因、实际范围和返回的 `message_id`；仍缺信息时由 Agent 向群里提问，不继续扩大读取。

响应示例：

```json
{
  "scope": "same_thread_before_anchor",
  "messages": [
    {
      "messageId": "om_123",
      "authorId": "ou_hash",
      "sentAt": "2026-08-12T10:21:00+08:00",
      "text": "生产环境，十点左右开始超时",
      "relation": "same_thread"
    }
  ],
  "truncated": false
}
```

这项接口解决的是群聊中“未 @Bot 的前置讨论缺失”，不是通用飞书搜索 API，也不能用于恢复私聊。

### 8.3 Work 对话记录

每个 Work 按 Binding 保存一份可迁移的 Markdown 记录：

```text
work-items/<work-type>/<space>/<id>/
  handoff.md
  im/<binding_hash>/transcript.md
```

临时 Work 对应 `work-items/im/task/<ULID>/`。`transcript.md` 只追加以下内容：

- 实际进入 Codex Session 的用户消息；
- 群聊上下文接口实际返回并被本 Work 采用的消息，按 `message_id` 去重并标记为背景；
- 成功投递到飞书的最终 Agent 回复；
- 本次附件的名称、摘要、SHA-256 和工作包内相对路径。

不要记录 ACK、排队提示、chain-of-thought、逐 token 输出、完整工具日志或未读取的群历史。SQLite 仍是 inbox、FIFO、幂等和 outbox 状态的权威来源；`transcript.md` 用于追溯和迁移，`handoff.md` 才是 Session 轮换时优先读取的结构化排查摘要。

对 Markdown 的追加必须通过扩展后的工作包 helper 加锁并原子写入，不能由多个 worker 直接并发追加文件。

入口类型必须遵守以下规则：

| 入口 | 提交给 AIOps 的目标 | 工作包行为 |
| --- | --- | --- |
| 新临时问题 | `AIOPS-WORK:im:task:<ULID>` | 首个 AIOps Turn 使用扩展后的工作包管理器幂等初始化或加载；网关不直接写 AIOps 文件系统 |
| VOC/IPD URL 或带类型 ID | 规范化后的 VOC/IPD URL | 走现有首次工单工作流，由该工作流幂等初始化工作包；不要同时附加 `AIOPS-WORK:*` 以免误入续接流程 |
| 显式 `AIOPS-WORK:*` 或已绑定回复链 | 对应的 `AIOPS-WORK:*` | 走续接流程；包不存在时明确报错，不伪造历史 |

这一区分很重要：网关可以提前为 VOC/IPD 推导内部 `work_id`，但首次请求的模型输入仍应保留为工单 URL，让现有 AIOps 初次工作流负责读取工单、初始化工作包和执行其既有交付语义。

## 9. 飞书回复策略

### 9.1 回复位置

- 话题消息：使用原 `thread_id`，设置 thread reply；
- 普通群回复链：回复触发消息或绑定的根消息；
- 私聊：回复触发消息；
- 最终结果始终回到发起本条请求的表面，不自动发往 Work 的其他群。

保存每条 Bot 消息到 Work 的反向映射，使用户回复 Agent 消息时可精确恢复 Work。

### 9.2 用户可见消息

第一阶段建议只发三类消息，避免刷屏：

1. 接收确认：`已收到，排查编号：<short_work_id>。`
2. 排队提示：`当前排查正在执行，本条请求已排队。`
3. 最终回复：Codex `finalText`，必要时附 Work ID 或报告链接。

可选地在超过 60 秒时发送一次：

```text
排查仍在进行，完成后会回复此消息。
```

不要逐 token 或逐工具调用转发进度，也不要展示内部 reasoning/chain-of-thought。

### 9.3 出站幂等

所有飞书回复先写 `outbox`，由 sender worker 投递。出站幂等键：

```text
feishu:reply:v1:<inbound_message_id>:<kind>:<version>
```

其中 `kind` 为 `ack|queued|progress|final|error`。本地 outbox 是权威去重；飞书回复 API 的 UUID/幂等参数仅作为第二层保护，因为其去重窗口有限。

## 10. 附件方案

### 10.1 第一阶段支持范围

支持：

- 图片：PNG、JPEG、WebP，做 OCR 或交给受控图片解析流程；
- 文本：`.txt`、`.log`、`.json`；
- 单文件和单消息总大小设置明确上限，例如 20 MB；
- 文本提取后限制进入模型的字符数，其余保存在私有任务目录并提供摘要。

拒绝或后置：

- 压缩包；
- 可执行文件；
- Office 宏文档；
- 任意二进制；
- 超过上限的文件。

### 10.2 下载与处理

飞书资源通过匹配的 `message_id + file_key` 下载，不能只凭 `file_key`。处理链：

```text
message_id + file_key
-> 私有 quarantine 目录
-> 校验实际 MIME 与扩展名
-> SHA-256
-> 大小、编码和内容检查
-> secret/token 扫描
-> OCR 或文本提取
-> 生成任务级派生文本
-> 作为文本随本次请求提交
```

目录使用 `0700`，文件使用 `0600`。下载失败、文件已删除、保密消息禁止下载或类型不支持时，不重试无意义的权限错误；向用户指出具体附件未被处理。

第一阶段 Codex Web webhook 不接收原始附件。网关只提交派生文本和受控摘要。不要把飞书 `file_key` 或任意宿主路径直接交给模型。

## 11. 最小数据模型

第一阶段使用 SQLite WAL 即可。数据库位于运行状态目录，不放入源码仓库；文件权限 `0600`。

### 11.1 `inbound_events`

```sql
CREATE TABLE inbound_events (
  dedupe_key TEXT PRIMARY KEY,
  tenant_key_hash TEXT NOT NULL,
  event_id TEXT,
  message_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL,
  sender_open_id TEXT NOT NULL,
  thread_id TEXT,
  root_id TEXT,
  parent_id TEXT,
  message_type TEXT NOT NULL,
  normalized_payload_json TEXT NOT NULL,
  raw_event_encrypted BLOB,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL,
  ignore_reason TEXT
);
```

`normalized_payload_json` 只保存 router 所需的白名单字段、正文、mentions 和附件引用。生产实现可不保存完整解密事件；若为排错短期保存，必须加密并设置短 TTL。

### 11.2 `inbox`

```sql
CREATE TABLE inbox (
  inbox_id TEXT PRIMARY KEY,
  inbound_dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(inbound_dedupe_key) REFERENCES inbound_events(dedupe_key)
);
CREATE INDEX inbox_ready
  ON inbox(status, next_attempt_at, created_at);
```

`inbound_events` 与 `inbox` 必须在同一事务内写入。回调返回 200 只表示事件已经可靠落库；router worker 通过 lease 消费 `inbox`，进程退出后可重新领取未完成记录。

### 11.3 `works`

```sql
CREATE TABLE works (
  work_id TEXT PRIMARY KEY,
  work_type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  external_ref TEXT UNIQUE,
  package_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
```

### 11.4 `bindings`

```sql
CREATE TABLE bindings (
  binding_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  tenant_key_hash TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  conversation_key TEXT NOT NULL,
  codex_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(work_id, tenant_key_hash, chat_id),
  FOREIGN KEY(work_id) REFERENCES works(work_id)
);
```

### 11.5 `surface_routes`

```sql
CREATE TABLE surface_routes (
  route_key TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  tenant_key_hash TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  route_type TEXT NOT NULL,
  route_value TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  FOREIGN KEY(work_id) REFERENCES works(work_id)
);
```

`route_type` 可为 `thread|root|agent_message`。

### 11.6 `group_context_refs`

```sql
CREATE TABLE group_context_refs (
  context_ref_hash TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  anchor_message_id TEXT NOT NULL,
  anchor_create_time TEXT NOT NULL,
  thread_id TEXT,
  root_id TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_reason TEXT,
  last_returned_message_ids_json TEXT,
  last_accessed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(work_id) REFERENCES works(work_id),
  FOREIGN KEY(binding_id) REFERENCES bindings(binding_id)
);
```

只为群聊创建随机 `context_ref`，数据库仅保存其摘要。服务端通过 Binding 解析 tenant 和 `chat_id`，调用方不能指定或覆盖读取范围。私聊不得写入此表。

### 11.7 `dm_current_work`

```sql
CREATE TABLE dm_current_work (
  principal_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(principal_id, chat_id),
  FOREIGN KEY(work_id) REFERENCES works(work_id)
);
```

### 11.8 `work_queue`

```sql
CREATE TABLE work_queue (
  enqueue_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id TEXT NOT NULL UNIQUE,
  work_id TEXT NOT NULL,
  inbound_dedupe_key TEXT NOT NULL UNIQUE,
  client_request_id TEXT NOT NULL UNIQUE,
  binding_id TEXT NOT NULL,
  request_payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  codex_session_id TEXT,
  codex_turn_id TEXT,
  final_text TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(work_id) REFERENCES works(work_id),
  FOREIGN KEY(binding_id) REFERENCES bindings(binding_id)
);
CREATE INDEX work_queue_ready
  ON work_queue(status, next_attempt_at, created_at);
CREATE INDEX work_queue_work_order
  ON work_queue(work_id, enqueue_seq);
```

`enqueue_seq` 是严格 FIFO 的最终排序依据，不能只依赖可能相同的时间戳。`request_payload_json` 必须保存首次生成的规范化 payload。重试复用原字节语义，不重新根据变化的上下文生成，以免触发 Codex `submission_conflict`。

### 11.9 `outbox`

```sql
CREATE TABLE outbox (
  outbox_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  work_id TEXT NOT NULL,
  target_message_id TEXT NOT NULL,
  reply_in_thread INTEGER NOT NULL DEFAULT 0,
  message_kind TEXT NOT NULL,
  content_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  feishu_message_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 12. 核心事务与伪代码

### 12.1 入站事件

```python
def receive_event(raw_request):
    envelope = verify_and_decrypt(raw_request)
    message = parse_message(envelope)
    dedupe_key = f"feishu:msg:v1:{tenant_hash(message.tenant)}:{message.message_id}"

    with db.transaction():
        if db.inbound_exists(dedupe_key):
            return 200
        db.insert_inbound(message, dedupe_key)
        db.insert_inbox_reference(dedupe_key)

    return 200
```

### 12.2 路由与入队

```python
def route_inbound(dedupe_key):
    msg = db.load_inbound(dedupe_key)

    if msg.is_from_bot:
        return ignore("bot_message")
    if msg.is_group and not has_real_bot_mention(msg.mentions):
        return ignore("not_mentioned")

    text, attachments = normalize_message(msg)
    if is_fixed_non_investigation_message(text, attachments):
        return enqueue_fixed_reply(msg)

    resolution = (
        resolve_explicit_work(text)
        or resolve_external_voc_ipd(text)
        or resolve_agent_reply(msg.parent_id)
        or resolve_surface(msg.thread_id, msg.root_id)
    )

    if resolution.ambiguous:
        return enqueue_clarification(msg, resolution.options)

    if resolution.work:
        work = resolution.work
    elif msg.is_p2p and text.startswith("新问题："):
        work = create_temporary_work(msg, text.removeprefix("新问题："))
    else:
        work = resolve_unexpired_dm_current_work(msg) or create_temporary_work(msg, text)
    binding = get_or_create_binding(work, msg.tenant, msg.chat_id)
    payload = build_immutable_codex_payload(work, msg, text, attachments)

    with db.transaction():
        bind_surface_routes(work, msg)
        enqueue_work_message(work, binding, msg, payload)
        if msg.is_p2p:
            set_dm_current_work(msg.sender, msg.chat_id, work, ttl="2h")
        enqueue_ack(msg, work)
```

### 12.3 Work Worker

```python
def run_work(work_id):
    item = lease_head_of_work_queue(work_id)
    if not item:
        return

    response = codex.post_webhook(
        idempotency_key=item.conversation_key,
        body=item.immutable_payload,
    )

    if response.is_busy:
        schedule_retry(item, reason="session_busy")
        ensure_queued_reply(item)
        return

    if response.accepted:
        mark_running(item, response.session_id, response.turn_id)
        poll_until_terminal(item)
        return

    handle_submission_error(item, response)
```

### 12.4 完成处理

```python
def complete_item(item, status):
    with db.transaction():
        if status.completed:
            mark_completed(item, status.final_text)
            record_agent_message_mapping_pending(item.work_id)
            enqueue_final_reply(item, status.final_text)
        else:
            mark_failed(item, status.error)
            enqueue_error_reply(item, status.error)
```

发送 outbox 成功后，再用返回的飞书 `message_id` 建立 `agent_message -> work_id` 映射。

## 13. 失败重试与恢复

### 13.1 自动重试范围

可重试：

- `session_busy`；
- `429`；
- 网络连接/超时；
- 明确的 Codex Web `5xx`；
- 飞书发送接口的临时错误。

不可自动重试：

- `submission_conflict`；
- webhook credential 无效；
- 请求 payload 无效；
- Work ID 歧义或工作包不存在；
- 飞书附件权限永久拒绝；
- 不支持的附件类型。

退避建议：

```text
session_busy: 5s, 10s, 20s, 30s，之后保持 30s 上限并带 jitter
429: 严格使用 Retry-After
网络/5xx: 2s, 5s, 10s, 30s, 60s，带 jitter
飞书发送: 2s, 5s, 15s, 60s，最多有限次数后进入 DLQ
```

### 13.2 进程重启恢复

启动时执行 reconciler：

1. 回收已过期的 inbox、queue 和 outbox lease；
2. 对 `submitting/running` 项使用原 `clientRequestId` 查询 Codex 状态；
3. 已完成但未回复的项补写 outbox；
4. outbox 已发送但本地响应丢失时，先根据本地幂等状态和飞书回执校准，避免重复发送；
5. 恢复每个 Work 的队首任务；
6. 清理过期的 DM current pointer 和原始事件短期数据。

网关绝不能因为不知道上次 POST 是否成功就生成新 `clientRequestId`。必须复用原 ID，让 Codex Web 的幂等能力解决不确定结果。

## 14. 配置建议

配置放在源码仓库外的 service env 或 secret store：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_ENCRYPT_KEY
FEISHU_VERIFICATION_TOKEN        # 若当前回调模式仍需要
FEISHU_BOT_OPEN_ID

CODEX_WEB_BASE_URL
CODEX_WEB_WEBHOOK_TOKEN
CODEX_WEB_PROJECT_ID
CODEX_WEB_MODEL
CODEX_WEB_REASONING_EFFORT=high
AIOPS_CONTEXT_SERVICE_TOKEN

GATEWAY_STATE_DIR
GATEWAY_DATABASE_PATH
DM_CURRENT_WORK_TTL_SECONDS=7200
CODEX_TURN_TIMEOUT_SECONDS=1800
ATTACHMENT_MAX_BYTES=20971520
GROUP_CONTEXT_REF_TTL_SECONDS=3600
GROUP_CONTEXT_WINDOW_SECONDS=1800
GROUP_CONTEXT_MAX_MESSAGES=10
GROUP_CONTEXT_MAX_BYTES=12288
GROUP_CONTEXT_MAX_EXPANSIONS=2
WORKER_CONCURRENCY=4
```

日志中不得输出 app secret、webhook token、原始 Authorization、Encrypt Key 或附件中的认证秘密。

## 15. 部署与可观测性

建议使用一个 Python 服务进程加后台 worker，首期可采用 FastAPI/Starlette + SQLite；若希望减少依赖，也可以使用标准库 HTTP server，但事件处理、连接池和运维体验会更差。

进程组成：

```text
gateway HTTP server
inbound router workers
work execution workers
outbox sender workers
reconciler
```

单机服务用 systemd user service 或与 AIOps 当前部署一致的服务管理方式启动。不要用临时 `nohup` 作为生产运行方式。

必须提供指标：

```text
feishu_events_received_total
feishu_events_duplicate_total
feishu_events_ignored_total{reason}
work_created_total{type}
work_queue_depth
work_queue_oldest_age_seconds
codex_submissions_total{result}
codex_turn_duration_seconds
codex_session_busy_total
outbox_pending_total
outbox_failures_total
attachment_processing_failures_total{reason}
group_context_expansions_total{result}
group_context_messages_returned_total
```

告警至少覆盖：

- 队首等待超过 5 分钟；
- running 超过 Turn timeout；
- `submission_conflict` 出现；
- credential 失败；
- outbox 连续失败；
- 群聊上下文接口出现跨 Binding 校验失败或异常调用激增；
- SQLite 锁等待或损坏；
- reconciler 无法恢复 running 项。

## 16. 测试与验收

### 16.1 事件入口

- 有效签名事件进入 inbox 并快速返回 200；
- 签名错误、解密错误和过期重放被拒绝；
- 同一 `message_id` 重推只消费一次；
- 同一消息使用不同 `event_id` 仍只消费一次；
- Bot 自己的消息不会形成循环。

### 16.2 @ 与路由

- 群内真实 @Bot 才处理；
- 文本伪造 `@AIOps` 不处理；
- 私聊无需 @；
- 显式 Work ID 恢复正确 Work；
- 回复 Agent 消息恢复正确 Work；
- thread/root 恢复正确 Work；
- 裸数字和多个 Work ID进入澄清，不猜测；
- 群内新 root 创建新临时 Work。

### 16.3 2 小时机制

- 私聊窗口内无引用消息续接当前 Work；
- 超过 2 小时直接创建新 Work；
- 显式 Work ID 和回复消息不受 TTL 限制；
- `新问题：` 在窗口内也强制创建新 Work；
- 2 小时不会删除 Work、Session 或工作包。

### 16.4 FIFO 与 Codex

- 同一 Work 三条消息严格按顺序执行；
- 不同 Work 可以并行；
- 同一 Work 跨群仍串行；
- `session_busy` 不丢消息，稍后用同一 ID重试；
- 网络响应丢失后不会创建重复 Turn；
- Worker 崩溃后 lease 可恢复；
- `submission_conflict` 停止重试并告警；
- Codex 最终结果与正确 `turnId` 对应。

### 16.5 飞书回传与附件

- ACK、queued、final 各自最多发送一次；
- 话题回复回到原话题；
- 普通群和私聊回复到正确消息；
- Bot 最终消息可反向解析 Work；
- 支持类型正确提取；
- 超限、不支持、权限拒绝有明确用户提示；
- 附件内容不能变成系统指令；
- 日志和数据库中没有 credential 明文。

### 16.6 上下文扩展

- 群聊触发消息获得随机、短期的 `context_ref`；
- 私聊消息不生成 `context_ref`，且处理过程中不调用飞书历史读取 API；
- 同一私聊 Work 的连续消息按 FIFO 进入同一 Session；
- 群聊扩展只能读取锚点之前、同一群或同一话题的消息；
- 调用方即使伪造 `chat_id`、时间范围或数量，也不能扩大服务端绑定的范围；
- 过期、超次数、无效或跨 Work 的 `context_ref` 被拒绝；
- 返回消息满足条数、时间窗和总字节上限；
- Bot 自己的 ACK、排队和结果消息被过滤；
- 每次扩展的 reason、范围和返回 message ID 可审计；
- 被采用的群聊上下文按 Binding 追加到 `transcript.md`，重复读取不重复追加。

## 17. 实施步骤

### Step 1：可靠消息入口

- 飞书应用、Bot 和事件订阅；
- 验签、解密、`message_id` 去重；
- SQLite、inbound 和 outbox；
- 真实 @、私聊和固定提示；
- ACK 回复。

### Step 2：Work 路由

- 临时 Work ID 和工作包适配；
- VOC/IPD/Work ID 解析；
- agent message、thread/root binding；
- 私聊 2 小时 current Work；
- 歧义澄清。

### Step 3：Codex 执行闭环

- Work FIFO 和 lease；
- `clientRequestId`、`reject_if_busy`；
- 状态轮询；
- final/error outbox；
- 重启 reconciler。

### Step 4：群聊按需上下文

- 为群聊触发消息创建短期 `context_ref`；
- 实现 AIOps 固定 wrapper 和网关内部 expand 接口；
- 读取当前话题或当前群锚点之前的有限消息；
- 强制限额、审计和 `transcript.md` 原子追加；
- 验证私聊路径不会调用消息历史 API。

### Step 5：有限附件

- 图片和文本下载；
- MIME/大小/secret 检查；
- OCR/文本提取；
- 私有存储和 TTL 清理。

完成 Step 1～3 即可上线基础文本版；Step 4 用于群里经常先讨论、最后才 @Bot 的场景，可以独立启用。附件不应阻塞文本排查链路。

## 18. 后续再做的能力

只有真实使用反馈证明需要时再增加：

- Codex 完成 callback 替代轮询；
- Session 上下文阈值自动轮换；
- 同一 Work 跨群受控共享摘要；
- 更大时间窗、分页或跨群的历史读取；
- 更丰富的附件类型；
- 闲聊或知识问答通道；
- 生产写操作及动作级审批；
- 多安全域 runtime 和 credential 隔离。

## 19. 飞书平台约束参考

实现时以飞书官方文档为准：

- 接收消息事件：<https://open.feishu.cn/document/server-docs/im-v1/message/events/receive.md>
- 事件回调优化：<https://open.feishu.cn/document/event-subscription-guide/event-subscriptions/event-callback-optimization-guide.md>
- Encrypt Key 与签名校验：<https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/encrypt-key-encryption-configuration-case.md>
- 回复消息：<https://open.feishu.cn/document/server-docs/im-v1/message/reply.md>
- 获取会话历史消息：<https://open.feishu.cn/document/server-docs/im-v1/message/list.md>
- 下载消息资源：<https://open.feishu.cn/document/server-docs/im-v1/message/get-2.md>

需要特别遵守：消息事件按 `message_id` 去重；回调快速返回；真实 @ 从结构化 mentions 判断；资源下载绑定 `message_id + file_key`；回复 API 的有限时间幂等不能替代本地持久 outbox。
