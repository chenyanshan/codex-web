# 会话未读蓝点修复

## 完成轮次信息被覆盖

真实 game-porter 最新会话只读核查：最新轮次为 completed，包含 final_answer；轻量状态查询返回 latestTurn: null。历史首次读取能够提供正确轮次，缓存命中路径原来却直接使用轻量元数据，丢失该轮次。前端并行合并状态和历史时也让空值覆盖了历史提供的完成轮次。

用户本地未读标记如果记着较旧的轮次，而最近一页已没有该轮次的助手消息，原有已读判断就无法清除蓝点。现在：

- runtime.readSessionTimeline 缓存命中时，在元数据未知 latestTurn 的情况下保留已缓存历史的轮次，不增加完整历史读取，不改变缓存容量、失效或当前活动轮次优先级。
- session-loader 合并时保留已知 latestTurn，遵守较新的执行元数据，不把未知值当成轮次消失。
- 同时修复桌面被动选中会话：有效消息区输入或回到最新会退出被动状态。被动展示本身、阅读旧消息、历史失败均不自动清除未读。

此前只修复被动选中路径不足以处理 game-porter 的轮次丢失；本记录和最终实现包含两处信息合并修复。

## 验证与保留能力

- OPT-16：浏览器用例预置旧完成轮次的未读缓存，模拟轻量状态为空但历史包含最新完成轮次；显式打开最新回复后蓝点清除，刷新保持已读。另覆盖被动选中、回到最新、阅读旧消息不误清除，以及既有运行／审批／失败和账号隔离行为。
- OPT-08、13、19、20：轻量元数据仍不读取完整历史；历史缓存回归证明两次分页读取只读取一次完整历史，保留既有缓存边界和失效检查。前端合并用例覆盖空值、较旧状态响应和较新的失败状态。
- OPT-07、10、11、17：保留阅读位置、前台恢复、局部渲染、手机及桌面布局。样式未改。
- 其余 OPT 项实现未变：无存储格式、提交、附件、PWA 缓存或权限策略修改。
- 类型检查通过。
- public_ui、session_attention、session_reading、frontend_budget、runtime_scaling、runtime_canonical_timeline：496 通过，关键路径 gzip 不超过 140 KiB。
- Chromium desktop/mobile-portrait：session-attention 与 session-reading 合计 52 通过、8 按设备条件跳过；其中新增手机刷新用例最初被每次初始化都重置未读的 fixture 影响，修正为仅首次注入旧缓存后，已读跨刷新断言通过。
- 正式构建及 test:built-public 通过，32 个脚本、无浏览器错误。
- 使用 CodexAppClient 和隔离内存 runtime 对真实 game-porter 会话做只读核查：首次和缓存历史都保留最新 completed 轮次及对应 final_answer，轻量状态仍可为 null。未向该会话发送任务，未修改其历史或已读缓存。

限制：用户真实浏览器的 localStorage 未直接读取；未测试真实手机 Safari。fixture 验收、真实会话只读核查和本机部署资源检查分别记录，不互相替代。

回退：恢复本次 app.js、session-loader.js、runtime.ts 并重新构建，无数据迁移。旧部署构建保存在用户目录 deployment-backups 下。
