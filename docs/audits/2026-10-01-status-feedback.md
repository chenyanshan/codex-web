# 状态提示样式统一

范围：下拉刷新、加载历史、会话列表加载与失败重试、手机项目列表按钮和会话顶部状态。

设计：延续现有主题令牌（复古主题 #fcf9f2 背景、#ffffff 面板、#e8decc 边框、#4a4a4a 正文），沿用系统字体。提示采用 12px 文字、10px 圆角、左侧说明与右侧重试按钮；下拉提示使用相同表面和小型 CSS 转圈。去掉普通网络失败的大面积红色和刷新时的品牌色描边；按用户追加要求，列表更新失败使用主题 warn 警告色描边，正文与重试按钮保持中性。项目按钮触摸只保留按压反馈，键盘焦点仍由全局 focus-visible 提供。

按用户纠正：移除手机会话顶部 runtime-feedback，消息／输入框上方 composer-status 完整保留；桌面顶部状态与手机设置中的状态保留。

受影响：OPT-01、07、08、10、11、17。网络重试、刷新手势阈值与加载 Promise、请求归属、列表 DOM 和阅读锚点逻辑保留，仅改变提示表现。其余优化不涉及：没有改动缓存、发送、附件、后端协议、鉴权、服务生命周期或存储机制。

验证：
- npm run typecheck 通过。
- public_ui.test.ts 与 theme_palette.test.ts 合计 487 项通过。
- status-feedback、weak-network、connection-status 浏览器测试：手机 320/390px 合计 12 项通过，8 项按原项目条件跳过。
- 最终提示与历史手势回归：7 项通过，1 项按原项目条件跳过。
- frontend_budget.test.ts 通过，未提高 140 KiB 限额。
- 已查看 Playwright 生成的 refresh.png/retry.png（test-results 下），布局与点击面积符合预期。

限制：浏览器验证使用 Chromium fixture；未验证实体 iPhone/Safari，未部署线上。五主题令牌测试通过，未逐主题截图。工作区原有其他修改未作为本次修改清理或提交。

回退：仅回退本次 app.js 的加载提示 span/类名与手机顶部 runtime-feedback 条件、pwa-pull-refresh.js 和 styles.css 对应变更；不要覆盖工作区已有其他修改。

## 2026-10-12 GitHub 发布检查

从最新 origin/main（2da075f）建立隔离工作区，仅纳入本次状态提示变更。类型检查通过；public_ui、theme_palette、frontend_budget 合计 484 项通过；status-feedback、connection-status、weak-network 在手机与桌面合计 16 项通过，4 项按项目条件跳过。未纳入其他任务的未提交改动。
