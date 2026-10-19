# Codex app-server `context_mcp` 子进程累积诊断与修复方案

- 日期：2026-08-17
- 状态：诊断完成，尚未实施修复
- 影响主机：当前 Linux Codex Web 主机
- 结论置信度：高

## 1. 结论

根因不在 `im_gateway.context_mcp` 自身的 EOF 或进程退出实现，而在 Codex
Web 对 Codex app-server thread subscription 的生命周期管理。

`CodexAppClient` 通过一条长期存在的 WebSocket 连接调用 `thread/start` 或
`thread/resume`。Codex app-server 会自动把该连接订阅到对应 thread，并为每个
loaded thread 创建独立的 MCP runtime，因此启动一个
`python3 -m im_gateway.context_mcp` stdio 子进程。

当前 `CodexAppClient` 没有封装或调用 app-server 0.145.0 已提供的
`thread/unsubscribe`。只要这条 WebSocket 不断开，所有曾被 start/resume 的 thread
就一直有订阅者，app-server 的空闲卸载条件永远不成立，MCP 子进程也不会关闭。

正确修复是：

1. 在 `CodexAppClient` 增加 `thread/unsubscribe` 支持。
2. 在 Codex Web runtime 中引入 thread subscription lease，在 turn 结束且不存在
   审批、goal continuation 或其他活动后取消订阅。
3. 保留 app-server 自带的 30 分钟无订阅空闲卸载作为最终回收机制。
4. 发布后做一次受控的 Codex Web 服务重启，立即清掉当前存量进程。

不要用定时 `kill` Python、提高内存上限或周期性重启代替生命周期修复。

## 2. 现场证据

### 2.1 进程与内存

诊断开始前已有 103 个 `context_mcp`。本次诊断会话被 app-server 加载后又新增了
一个，因此采样时为 104 个。全部进程的直接父进程均为同一个 Codex app-server：

```text
codex app-server PID: 3307547
Codex CLI:            0.145.0
service started:      2026-08-13 15:16:49 CST
context_mcp parent:   3307547（全部）
process state:        sleeping / ep_poll（全部）
threads per process:  3（已完成启动的进程）
```

104 个进程的内存采样：

| 指标 | 合计 | 单进程中位数 | 范围 |
| --- | ---: | ---: | ---: |
| RSS | 3,942.7 MiB | 38.1 MiB | 3.2-53.4 MiB |
| PSS | 3,925.1 MiB | 38.0 MiB | 1.1-47.4 MiB |
| Private | 3,922.3 MiB | 38.0 MiB | 0.7-45.1 MiB |

PSS 和 private memory 与 RSS 很接近，所以约 3.9 GiB 不是共享页重复统计造成的假象。

### 2.2 管道仍由 app-server 持有

每个 Python 子进程的 stdin/stdout/stderr 都是 pipe。app-server 当时共有 571 个
文件描述符，其中 318 个为 pipe，数量与约 104 组 stdio transport 对应。

Python 进程不是父进程退出后残留的孤儿。相反，app-server 仍持有 transport，
没有关闭 stdin，所以 FastMCP 的 stdio loop 正常阻塞在 `ep_poll`。

### 2.3 loaded thread 与 MCP 数量对应

使用独立诊断 WebSocket 调用只读的 `thread/loaded/list`，app-server 返回 105 个
loaded thread。该数量与 104 个已启动的 `context_mcp` 基本一一对应；少量瞬时差异
可能来自正在初始化或不包含该 MCP runtime 的 thread。

进程启动时间也与 Codex Web session 的 start/resume 时间对应。例如本次会话在
2026-08-17 11:39:14 启动了一个新的 `context_mcp`，与本次 session context 的写入
时间一致。

### 2.4 Python MCP 的退出路径存在

[`context_mcp.py`](../../../agent-messaging-gateway/src/im_gateway/context_mcp.py)
使用 `await server.run_stdio_async()`，并在 `finally` 中关闭 `httpx.AsyncClient`。
现有 stdio 测试也会在客户端 context manager 退出后结束服务端进程。

因此，子进程不退出的直接原因是父端没有关闭 transport，不是 Python 端吞掉 EOF。

## 3. 完整因果链

```text
Codex Web 读取冷 session / 创建 session / 开始 turn
  -> CodexAppClient 调用 thread/start 或 thread/resume
  -> app-server 将长期 WebSocket 订阅到 thread
  -> thread 创建自己的 MCP runtime
  -> 启动一个 context_mcp stdio 子进程
  -> turn 完成，但 Codex Web 不调用 thread/unsubscribe
  -> thread 始终被认为有 subscriber
  -> app-server 的“无订阅且空闲 30 分钟”卸载条件无法满足
  -> thread、MCP transport、三个 pipe 和 Python 进程持续保留
  -> 每使用一个新 thread 约增加 38 MiB private memory
```

当前仓库中的关键调用点：

- `packages/codex-native-api/src/codex_app_client.ts` 的 `startThread()` 调用
  `thread/start`。
- 同文件的 `resumeThread()` 调用 `thread/resume`。
- 该 client 目前没有 `thread/unsubscribe` 方法。
- `packages/codex-web/src/runtime.ts` 会在冷读取、turn 前准备和恢复活动 turn 时
  resume thread，但 turn 终态清理只清理 Web runtime 的内存映射，没有释放
  app-server subscription。

Codex 0.145.0 上游行为（tag `rust-v0.145.0`，commit
`25af12f7e61572b0bc18ddb1008be543b91519b0`）：

- app-server protocol 定义了 `thread/unsubscribe`，返回 `notLoaded`、
  `notSubscribed` 或 `unsubscribed`。
- `thread/start` / `thread/resume` 会把请求连接附加到 thread。
- `THREAD_UNLOADING_DELAY` 固定为 30 分钟。
- 只有 thread 同时满足“无 subscriber”和“非 active”达到 30 分钟才执行 shutdown。
- session shutdown 会调用 MCP runtime shutdown；stdio process handle 随后显式终止
  MCP 子进程。

上游参考：

- <https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs>
- <https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/app-server/src/request_processors/thread_lifecycle.rs>
- <https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/app-server/src/request_processors/thread_processor.rs>
- <https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/core/src/session/handlers.rs>
- <https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/codex-mcp/src/connection_manager.rs>

## 4. 推荐修复设计

### 4.1 Native client：补齐 unsubscribe API

在 `CodexAppClient` 增加：

```ts
type ThreadUnsubscribeStatus = 'notLoaded' | 'notSubscribed' | 'unsubscribed';

async unsubscribeThread(threadId: string): Promise<ThreadUnsubscribeStatus> {
  const result = await this.request(
    'thread/unsubscribe',
    { threadId },
    { timeoutMs: 10_000 },
  );
  return result.status;
}
```

三个状态都应按幂等成功处理。只有 RPC、连接或协议错误才进入重试/告警。

可同时增加 `thread/loaded/list` 的只读封装，用于运行指标和诊断，但它不是修复的
必要条件。

### 4.2 Web runtime：subscription lease

建议在 `CodexWebRuntime` 中维护每个 thread 的租约代次和延迟释放 timer：

- `thread/start` 或 `thread/resume` 成功后标记为 subscribed。
- turn 开始、恢复活动 turn、收到审批请求或 goal continuation 时取消释放 timer。
- terminal turn（成功、失败、取消）完成后，若无活动 turn、无 pending approval、
  无需要继续运行的 active goal，则安排短暂 grace period 后 unsubscribe。
- 仅为读取历史而 cold-resume 的 thread，也必须安排释放；否则打开旧会话仍会泄漏。
- 创建了 session 但尚未开始 turn 时，也必须安排释放。
- 新操作到来时递增租约 generation。旧 timer 触发时先核对 generation，防止它把
  已开始新 turn 的 thread 取消订阅。
- runtime stop 时清除所有 timer。服务停止本身会终止 app-server，不必逐个等待
  unsubscribe。

建议 Codex Web grace period 先设为 60 秒。取消订阅后 app-server 还会保留该 thread
30 分钟，足够吸收短时间内的再次访问。按当前约每小时一个新 thread 的速率，稳态
`context_mcp` 数量应从 100+ 降到个位数，而不是随服务 uptime 单调增长。

### 4.3 竞态与恢复

实现时必须处理以下竞态：

1. terminal 事件到达后马上开始下一 turn：新租约必须使旧 timer 失效。
2. approval 尚未决议：不得 unsubscribe，否则后续 approval/turn 通知会丢失。
3. active goal 自动继续：在 goal 真正结束、暂停或阻塞前保持订阅；或者保证每次
   continuation 前先 resume 并重新订阅。
4. app-server 正在执行 30 分钟卸载时收到 `thread/resume`：对
   `thread ... is closing; retry after the thread is closed` 做一次有界退避重试。
5. WebSocket 重连：旧连接关闭后其订阅会自动清除；新连接只应恢复真正活动或
   需要继续观察的 thread，不要批量 resume 全部历史 session。
6. unsubscribe RPC 失败：记录结构化 warning 并有限重试，不能影响已经完成的
   turn 结果持久化或返回。

### 4.4 不建议只在 UI 页面关闭时释放

浏览器 SSE 是否在线不是 app-server subscription 的准确生命周期。Codex Web 后端
可能需要在手机离线时继续接收运行中 turn、审批和 goal 的通知。因此释放条件应由
后端的 thread 活动状态决定，而不是由某个页面的 mount/unmount 决定。

## 5. 存量恢复步骤（本次未执行）

代码修复只能阻止继续累积。当前 100+ 个 thread 都由现有 Codex Web WebSocket
订阅，其他诊断连接不能替它取消订阅。发布修复时建议安排一次受控重启：

1. 确认没有运行中的 turn、待审批请求和 active goal continuation。
2. 部署并完成 typecheck、单元测试和集成验证。
3. 执行：

   ```bash
   scripts/service/restart-codex-web-systemd-user.sh
   ```

4. 检查服务与日志：

   ```bash
   scripts/service/status-codex-web-systemd-user.sh
   scripts/service/logs-codex-web-systemd-user.sh
   ```

5. 检查进程数量和内存：

   ```bash
   ps -eo pid,ppid,rss,etimes,args | awk '$0 ~ /[i]m_gateway.context_mcp/'
   ```

重启会立即终止旧 app-server 及其子进程并回收约 3.9 GiB，但也会中断仍在运行的
turn 和未决审批，所以必须先排空。持久化 session/rollout 不应丢失，恢复后可按需
resume。

不要单独 `kill` 这些 Python PID。那只会破坏 app-server 已持有的 MCP transport，
并可能在后续调用时触发错误或重连，无法释放 loaded thread。

## 6. 测试计划

### 6.1 `codex-native-api` 单元测试

- `unsubscribeThread` 发送准确的 `thread/unsubscribe` 方法和 `{ threadId }`。
- 正确映射三个返回状态。
- `notLoaded` 和 `notSubscribed` 按幂等成功处理。
- RPC timeout/断连产生可识别错误，不泄漏 pending request。

### 6.2 Codex Web runtime 单元测试

使用 fake timers 覆盖：

- terminal 成功、失败、取消后安排 unsubscribe。
- cold history resume 和空 session create 后安排 unsubscribe。
- 活动 turn、pending approval、active goal 不释放。
- grace period 内新 turn 使旧 timer 失效。
- 同一 thread 多次 schedule 只发一次有效 unsubscribe。
- unsubscribe 失败不改变 terminal turn 的用户可见结果。
- runtime stop 清理 timer。
- recovered active turn 完成后也进入同一释放路径。

### 6.3 真实 app-server 集成验证

使用一个轻量 stdio MCP fixture：

1. 连续 start/resume 多个 thread，确认每个 thread 会启动 MCP fixture。
2. 完成 turn 后由客户端调用 `thread/unsubscribe`。
3. 确认 `thread/loaded/list` 不再随所有历史 thread 永久增长。
4. 在超过 app-server 30 分钟卸载窗口的耐久测试中，确认 fixture 子进程退出、pipe
   FD 和 PSS 回落。
5. 卸载后再次 resume 同一 thread，确认历史、后续 turn 和事件流正常。

## 7. 验收标准与监控

功能验收：

- 历史 session 可读取并可继续对话。
- 运行中 turn、审批、interrupt、goal continuation 不丢事件。
- 服务重连和 app-server thread unload 后能透明 resume。

资源验收：

- `context_mcp` 数量不再随 Codex Web uptime 单调增长。
- 所有 terminal 且无订阅的 thread 在 grace period 加 30 分钟后释放 MCP 子进程。
- 40 分钟稳态窗口内，进程数接近“当前活动 thread + 最近 30 分钟访问的 thread”，
  而不是历史 session 总数。
- app-server pipe FD 数随 MCP 进程一起回落。

建议暴露或定期采集：

- app-server `thread/loaded/list` 数量；
- Codex Web 当前 subscribed、active、pending approval thread 数；
- `context_mcp` 子进程数量、RSS/PSS 合计；
- app-server FD 和 pipe 数；
- unsubscribe 请求次数、状态和失败次数；
- thread unload 后首次 resume 的延迟与失败率。

## 8. 可选的第二阶段优化

将 `messaging-context` 从“每个 thread 一个 stdio Python 进程”改为单个受 systemd
管理的 Streamable HTTP MCP 服务，可以进一步去掉每个 loaded thread 约 38 MiB 的
Python 固定成本。Codex thread 仍会各自持有一个轻量 HTTP client/session，但不会
复制完整 Python 解释器和依赖。

这属于架构降本，不应替代 `thread/unsubscribe`：即使换成 HTTP transport，不释放
subscription 仍会让 loaded thread 和 app-server 内部状态持续累积。

## 9. 排除项

以下做法不是根因修复：

- 定时查找并 `kill` `context_mcp`；
- 只给 systemd 增加 `MemoryMax`；
- 定时重启 Codex Web；
- 每次 turn 完成就 archive session；
- 调用 `config/mcpServer/reload`；
- 只修改 Python MCP 的 signal handler。

其中 systemd 内存保护和定时重启可以作为临时保险，但不能取代明确的 subscription
生命周期和可观测性。
