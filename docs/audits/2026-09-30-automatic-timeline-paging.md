# 消息历史自动续载验收

## 行为

- 向上／向下滚动，距离消息窗口边缘不超过一屏（最少 240px）时自动续载。
- 已下载的消息直接切换本地渲染窗口，不发起分页请求；服务端历史仍按 50 条一页获取，DOM 仍最多 80 条。
- 移除“查看较早／较新消息”按钮；请求进行中显示低干扰的加载状态，失败保留重试入口，并重试原分页方向。
- 打开普通会话仍定位最新消息，管理员观察仍从最早页开始；保留“回到最新”快捷入口。
- 用户输入触发续载；程序化定位和锚点恢复不递归加载。分页进行中合并重复操作，失败后不会随滚动反复重试。
- 使用统一阅读快照恢复可见消息，保留 PWA 顶部下拉手势的加载提示。

实现位置：`packages/codex-web/public/app.js` 的 `renderTimeline`、`moveTimelineWindow`、滚动输入绑定、`autoPageTimeline`、分页重试；`styles.css` 移除分页按钮的悬停样式。

## 优化能力映射

| 编号 | 保留方式与验证 |
| --- | --- |
| OPT-01、13 | 沿用分页超时、取消、请求去重、鉴权及会话代次校验。验证延迟页、失败停止、原方向重试和切会话后旧页不覆盖。 |
| OPT-09、20 | 等价替换手动分页入口；保留 50 条服务端分页和 80 条 DOM 窗口。200 条本地历史双向滚动只发起初次历史请求；管理员 235 条历史逐页读取。未改变已有缓存／存储容量边界。 |
| OPT-10、11 | 窗口切换改用统一阅读快照；验证双向滚动锚点、流式输出、前台校准、慢刷新期间用户滚动、布局变化和输入框复用。 |
| OPT-17 | 延续现有颜色、字体、布局；手机触摸、桌面滚轮、滚动条及键盘入口覆盖，PWA 下拉提示回归通过。 |

OPT-02～08、12、14～16、18～19、21 的底层协议、缓存、草稿、附件、资源传输、授权和服务生命周期均未修改；相关已有恢复、草稿、身份和消息顺序用例随本次 UI 回归执行。不将这些回归视为全部 21 项的完整端到端验收。

## 验证

- `npm run typecheck`：通过。
- `public_ui.test.ts`、`session_reading.test.ts`、`timeline_reconciliation.test.ts`、`theme_palette.test.ts`：504 通过。
- Chromium `desktop`、`mobile-portrait` 下运行 `session-reading`、`admin-history`、`admin-navigation`、`remediation`、`timeline-sync-recovery`：103 通过，17 按原有设备条件跳过。
- 修改的滚动入口和新增测试辅助函数 ESLint 通过；`git diff --check` 通过。
- 已检查手机、桌面截图。运行时截图位于 `test-results/playwright/` 的 `automatic-history.png` 和 `automatic-window-paging.png`，不覆盖既有审计图片。

限制：浏览器 fixture 验证，未测试真实手机 Safari 或真实 app-server 的分页交互；网络耗时超过预加载提前量时仍可能短暂显示加载状态。没有全量下载历史，也没有扩大既有内存缓存上限。

回退：还原本次前端文件及对应测试即可恢复手动分页，无数据迁移。


## 本机部署

2026-09-30 通过现有 macOS launchd 服务部署正式 dist 构建。`npm run build` 和 `test:built-public` 通过（32 个脚本、无浏览器错误）；独立重启任务退出码为 0，主服务保持 running。

新 buildId 为 `d7e070e8c292b154a7ec`。本机首页、JS、CSS 返回 200，实际响应与 dist 构建一致；未登录访问会话 API 返回 401。旧 dist 已备份到用户目录下的部署备份目录。此次未改服务配置、凭据或用户数据。
