# 2026-10-20 性能与连接稳定性扫描及整改

扫描对象是 Codex Web 的前端流式渲染、状态反馈、会话恢复、SSE 事件分发和 runtime 生命周期。扫描依据为 `AGENTS.md`、OPT-01 至 OPT-21 保留基线，以及浏览器稳定性约束。整改由 GPT-6 Astra medium 完成；本记录区分了可由代码和回归复现的缺陷，以及尚未能归因的生产 renderer 内存增长。

## 扫描结论

已复现并修复的高置信问题有四类：

1. 流式 assistant/system 文本每个增量都走完整消息卡片替换，反复解析 HTML、创建节点并改变滚动锚点和事件绑定。现在对仍处于纯文本流式阶段的卡片只更新 `.message-text`，结构变化、Markdown、附件或其他角色仍走完整替换路径。
2. 桌面 runtime 状态反馈每秒创建并替换整个状态节点。现在只更新状态文本节点和计时节点，并在移动端没有状态节点时直接返回，避免每次动态刷新创建临时对象。
3. runtime 停止时原先只等待部分读取集合，timeline 写入、重命名、排序、审批和活动 turn 可能继续持有 runtime 引用。现在统一停止 provider 后排空所有受管理的 in-flight 集合，再释放缓存和订阅。
4. EventBus 将同一个可变事件对象直接传给所有 listener，某个订阅者修改 `raw`、`summary` 或嵌套元数据会污染其他订阅者和回放投影。现在对有界元数据做递归隔离，大文本仍共享；单个 listener 异常也不会中断其他订阅者。

会话列表摘要启动 SSE 的路径也增加了归属保护：打开会话时只有新鲜 detail cache 确认 active turn 后才从缓存游标重连，避免滞后的列表摘要触发重复尾部回放。已有的 session loader、SSE consumer、恢复退避、分页、阅读锚点、草稿、回执和 Service Worker 保护未被移除。

## 代码与边界

- `packages/codex-web/public/app.js`：流式卡片局部更新、runtime feedback 就地更新、滞后摘要重连保护。
- `packages/codex-web/src/runtime.ts`：`drainInFlightOperations()` 统一等待并清理 timeline reads/writes、thread scans、列表刷新、fallback、rename/order、审批和 active turns。provider stop 会先让 pending RPC/turn 失效；每个 map 随后清空。
- `packages/codex-web/src/event_bus.ts`：复制 `raw`、`summary`、`request`、`activity`、timeline metadata，递归深度和节点预算有界；大文本字段不做全量深复制。
- `packages/codex-web/test/runtime_lifecycle.test.ts`：验证停止会中断并排空目录扫描。
- `packages/codex-web/test/event_bus.test.ts`：验证嵌套字段隔离和 listener 异常隔离。
- `packages/codex-web/test/public_ui.test.ts`：验证 work batch 不替换历史、流式消息保留 DOM 身份、runtime 状态节点保留身份。

本次影响 OPT-01、OPT-02、OPT-07、OPT-09、OPT-10、OPT-11、OPT-13 和 OPT-20；它们分别对应恢复/断点、生命周期清理、分页与阅读位置、局部渲染、迟到响应防护和事件/引用容量。OPT-03、OPT-04、OPT-05、OPT-06、OPT-08、OPT-12、OPT-14、OPT-15、OPT-16、OPT-17、OPT-18、OPT-19、OPT-21 的现有实现没有改动，相关回归仍通过。

## 验证证据

以下检查在当前工作树通过：

- `npm run typecheck`
- EventBus、事件内存、runtime lifecycle、SSE backpressure 聚焦测试：18 项通过。
- `packages/codex-web/test/public_ui.test.ts`：492 项通过。
- `packages/codex-web/test/frontend_budget.test.ts`：2 项通过；`app.js` 源码 499,949 bytes，未提高 500,000 bytes 或 140 KiB gzip 阈值。
- `npm run build --workspace @codex-mobile-web-app/codex-web`
- `npm run --workspace @codex-mobile-web-app/codex-web test:built-public`：构建产物 smoke 通过，32 个脚本和 browser error 检查通过。
- Playwright 稳定性矩阵（allocation、status、connection、session output recovery、weak network）：80 个用例中 33 个通过、47 个按项目条件跳过；最终构建后针对 desktop 与 mobile-portrait 的 allocation/status：10 个用例中 7 个通过、3 个按项目条件跳过。截图和控制台错误检查未发现新增错误。

这些测试证明了局部渲染、连接恢复、状态反馈和资源释放的受控行为，不能等同于生产长时间内存稳定性证明。

## 未闭环问题与后续方案

现有证据没有把生产 renderer 的多 GB 增长归因到某个 JavaScript retaining path，也没有完成同条件 30–60 分钟采样。因此本次不声明“已修复生产内存泄漏根因”。下一轮应在用户实际浏览器和受影响标签上，先核验版本化 app.js、Service Worker 和 target→renderer client ID→OS PID 映射，再开始 allocation sampling 与 CPU profile；在增长前、完成后、切换会话后和 GC 后分别记录 JS heap、DOM/监听器、SSE 并发、renderer RSS/native footprint。若宿主出现内存压力，应停止实验并保留证据，不能通过增加 heap 或刷新页面掩盖问题。

建议的验收顺序是：

1. 固定浏览器版本、会话规模、网络条件和构建，连续执行流式输出、切会话、前后台切换、断网恢复和长历史分页 30–60 分钟。
2. 对照记录每个阶段的请求数、DOM 节点数、监听器数量、事件队列和 GC 后 retained heap；将页面 renderer 的 native/RSS 与其他浏览器进程分开。
3. 只有在完成/导航/GC 后 retained bytes 和 renderer footprint 都不再持续增长，且保留路径可解释时，才可把“长期内存稳定”写入结论；否则保留未验证范围并继续定位。

回退方式是恢复 `app.js`、`runtime.ts`、`event_bus.ts` 及对应测试的上一版本；不应通过删除已有的 SSE、缓存、权限或容量断言来回退预算压力。
