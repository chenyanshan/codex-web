# 现有优化能力保留基线

记录日期：2026-09-25。\
来源：当前代码、现有测试用例及用户确认的 21 项优化清单。\
要求：后续 app-server 改造及其他相关变更必须保留这些能力；允许等价替换内部实现，不能因精简代码或升级协议而让能力退化。

本文记录已经存在的措施，不将候选优化列为已实现功能。本次仅做记录，没有重新运行功能或性能验收；存在实现或测试不等于任意环境下绝对不会失败。

## 1. 使用规则

1. 修改协议、任务状态、网络、缓存、界面、附件、存储或服务生命周期前，标出影响的 `OPT-01` 至 `OPT-21`。
2. 保留用户可感知的效果、失败处理、容量边界和权限约束，不要求永久保留原函数或技术实现。
3. 删除旧实现前，为新实现提供对应行为的验证证据；仅有官方类似接口或类型检查通过不足以证明等价。
4. 每个变更集记录受影响编号、旧新实现位置、验证用例与结果、剩余限制及回退方式。未验证项明确记录，不得写成通过。
5. 重构最终验收逐项核对 21 项；没有受影响的项目注明理由，确有影响的项目必须验证。不能删掉或弱化原有断言来掩盖退化。
6. 前端使用项目内 `frontend-design`，延续当前风格；可以优化可读性、布局细节和交互，但弱网、输入、阅读、缓存和权限能力不能因此损失。

## 2. 21 项保留清单

| 编号 | 现有措施 | 必须保留的行为与边界 | 重点验证场景 |
| --- | --- | --- | --- |
| OPT-01 | 弱网自动恢复 | 请求有超时/取消处理；SSE 使用退避与随机抖动重连；连接故障与任务终态分开，避免高频重试 | 高延迟、间歇断网、代理错误、静默断流、恢复后重试收敛 |
| OPT-02 | 事件断点接续 | 保存事件游标并接续；游标过期或服务重启时通过快照/reset 校准，缓存和回放有界 | 游标有效/过期、epoch 改变、重复或早到事件；不重复提交任务 |
| OPT-03 | 本地会话缓存 | 保存摘要与最近 5 个会话的有界内容，已有内容先显示再校准；缓存不是完整历史备份 | 网络慢/离线打开、后台校准失败、缓存淘汰、换账号 |
| OPT-04 | 待发送消息保存 | 持久化未完成同步的纯文本/乐观消息与待确认提交，恢复后按原提交身份继续处理 | 断网发送、刷新、重新联网、存储失败；不能擅自丢弃待确认状态 |
| OPT-05 | 回执与重复提交防护 | 以提交 ID 查询是否收到；结果未知先查回执，不盲目重发；回执不存在不等于从未执行 | POST 已接收但响应丢失、查询超时、回执过期、显式允许重试 |
| OPT-06 | 草稿保存 | 按用户与会话保存文字、已上传附件引用；切换时保留各自草稿，不受迟到响应覆盖 | 切会话、刷新、长草稿、已上传附件、浏览器存储不可用 |
| OPT-07 | 前后台恢复 | 切后台时保存对话与阅读状态；回前台/联网/页面恢复后检查连接、校准执行并处理 outbox | 手机锁屏/切应用、前台恢复、反复 focus/online、不重复执行 |
| OPT-08 | 分步加载 | 可用的会话内容先展示；模型等慢请求不阻塞查看会话和编辑输入 | 模型目录阻塞、历史与状态先后返回、部分请求失败 |
| OPT-09 | 长会话分页 | 会话历史按需加载与分段展示，避免一次渲染全部；保持边界、顺序和可继续读取能力 | 长历史、连续翻页、慢分页、切会话后旧分页结果返回 |
| OPT-10 | 阅读位置保护 | 加载旧消息、流式更新、前台校准和调整窗口时保护阅读锚点；用户滚动优先；重新打开会话仍按现有逻辑定位最新 | 看旧消息时收到输出、窗口最大化、布局切换、用户在慢刷新中继续滚动 |
| OPT-11 | 局部界面更新 | 复用部分 DOM、时间线和输入相关状态，减少整体替换导致的闪动与操作中断 | 流式输出、设置更新、焦点/输入/选择文本、布局调整 |
| OPT-12 | 缓存写入合并 | 对高频缓存/草稿保存合并写入，离开或切换时按需 flush；存储失败不能卡死主界面 | 高频输出、连续输入、切会话/后台、配额不足 |
| OPT-13 | 异步请求防串会话 | 检查身份、会话、请求代次并丢弃失效响应；用户新选择不能被旧请求覆盖 | 快速切会话、换账号、迟到设置/模型结果、取消请求 |
| OPT-14 | 附件上传管理 | 进度反馈、逐文件重试/取消、并发控制与归属检查；普通重试不等于断点续传 | 单文件失败、多文件上传、取消、切会话/换账号、错误响应 |
| OPT-15 | PWA 离线页面与更新保护 | 缓存应用壳与版本化资源；新资源不完整时保留旧完整缓存，避免半更新页面 | 离线导航、单个资源下载失败、旧完整/新不完整缓存、版本恢复 |
| OPT-16 | 未读结果提醒 | 未读结果状态可跨刷新保留并按用户区分，不能因短暂摘要缺失就丢失 | 后台任务完成、刷新、缺少摘要、读取结果、换账号 |
| OPT-17 | 响应式与偏好保存 | 保留手机/桌面和横竖屏适配、主题/布局/字号/语言偏好；保持现有风格，允许有依据的局部优化 | 窄屏、横屏、桌面分栏边界、两种布局、主题切换、长输入 |
| OPT-18 | 静态资源传输优化 | 压缩、ETag/条件请求及已压缩结果缓存继续有效，缓存本身有界 | Brotli/Gzip/不压缩协商、304、资源更新、重复请求 |
| OPT-19 | 服务端查询缓存 | 对部分文件读取、会话列表与排序结果复用缓存；变化时正确失效，不能牺牲数据新鲜度和授权 | 文件改变、列表分页与变动、并发读取、授权数据更新 |
| OPT-20 | 内存与存储控制 | 事件条数/字节上限、慢客户端队列保护、受管理存储的配额/过期清理继续生效；不把用户项目当作通用清理目标 | 大输出、长会话、慢 SSE 客户端、配额满、过期附件 |
| OPT-21 | 缓存与恢复过程中的权限检查 | 缓存/请求/详情按身份和会话处理；持续流检查权限；未确认身份不能恢复敏感详情，撤权不能被缓存绕过 | 退出/换账号、角色变化、撤权、分享过期/撤销、附件访问 |

## 3. 现有代码与验证入口

以下入口帮助后续定位，不代表所有边界都已覆盖。实施者需要检查具体断言并按影响补充测试。

| 对应编号 | 主要代码 | 现有验证入口 |
| --- | --- | --- |
| 01、02、07、08、13 | [网络恢复](../../packages/codex-web/public/network-recovery.js)、[主界面](../../packages/codex-web/public/app.js)、[事件缓存](../../packages/codex-web/src/event_bus.ts) | [网络单测](../../packages/codex-web/test/network_recovery.test.ts)、[弱网浏览器测试](../../packages/codex-web/test/browser/weak-network.spec.js)、[连接状态](../../packages/codex-web/test/browser/connection-status.spec.js)、[输出恢复](../../packages/codex-web/test/browser/session-output-recovery.spec.js) |
| 03、04、05、06、12 | [草稿](../../packages/codex-web/public/draft-store.js)、[提交送达](../../packages/codex-web/public/submission-delivery.js)、[回执存储](../../packages/codex-web/src/session_submission_store.ts)、[主界面](../../packages/codex-web/public/app.js) | [UI 单测](../../packages/codex-web/test/public_ui.test.ts)、[提交存储](../../packages/codex-web/test/session_submission_store.test.ts)、[提交接口](../../packages/codex-web/test/server_session_submission.test.ts) |
| 09、10、11、17 | [阅读位置](../../packages/codex-web/public/session-reading.js)、[历史校准](../../packages/codex-web/public/timeline-reconciliation.js)、[列表分页](../../packages/codex-web/public/session-pagination.js)、[样式](../../packages/codex-web/public/styles.css) | [阅读单测](../../packages/codex-web/test/session_reading.test.ts)、[历史校准单测](../../packages/codex-web/test/timeline_reconciliation.test.ts)、[阅读浏览器测试](../../packages/codex-web/test/browser/session-reading.spec.js)、[工作区](../../packages/codex-web/test/browser/workspace.spec.js)、[主题](../../packages/codex-web/test/theme_palette.test.ts) |
| 14 | [上传管理](../../packages/codex-web/public/attachment-upload.js)、[文件预览](../../packages/codex-web/public/session-file-viewer.js) | [附件浏览器测试](../../packages/codex-web/test/browser/attachment-upload.spec.js)、[文件接口](../../packages/codex-web/test/server_session_files.test.ts) |
| 15 | [Service Worker](../../packages/codex-web/public/service-worker.js) | [资源缓存测试](../../packages/codex-web/test/service_worker_cache.test.ts) |
| 16 | [未读状态](../../packages/codex-web/public/session-attention.js) | [未读单测](../../packages/codex-web/test/session_attention.test.ts)、[未读浏览器测试](../../packages/codex-web/test/browser/session-attention.spec.js) |
| 18、19 | [静态资源缓存](../../packages/codex-web/src/static_asset_cache.ts)、[文件版本缓存](../../packages/codex-web/src/file_version_cache.ts)、[列表分页](../../packages/codex-web/src/session_list_page.ts) | [静态资源测试](../../packages/codex-web/test/static_asset_cache.test.ts)、[文件版本测试](../../packages/codex-web/test/file_version_cache.test.ts)、[列表分页测试](../../packages/codex-web/test/session_list_page.test.ts) |
| 20 | [事件容量控制](../../packages/codex-web/src/event_memory.ts)、[HTTP/SSE](../../packages/codex-web/src/server.ts)、[存储治理](../../packages/codex-web/src/storage_governance.ts) | [事件内存测试](../../packages/codex-web/test/event_bus_memory.test.ts)、[SSE 背压](../../packages/codex-web/test/server_sse_backpressure.test.ts)、[存储测试](../../packages/codex-web/test/storage_governance.test.ts) |
| 21 | [HTTP/SSE](../../packages/codex-web/src/server.ts)、[Web 权限](../../packages/codex-web/src/access_control.ts)、[主界面](../../packages/codex-web/public/app.js) | [接口鉴权](../../packages/codex-web/test/server_auth.test.ts)、[多用户](../../packages/codex-web/test/server_multi_user.test.ts)、[文件接口](../../packages/codex-web/test/server_session_files.test.ts) |

## 4. 必须保留的措辞边界

- 离线可显示缓存、保存输入，不等于离线运行 Codex、读取全部历史或完成文件上传。
- 本地会话缓存有数量与内容上限，不是历史备份。浏览器存储不可用或容量不足时，应保持主界面可用并按既有语义反馈，不能承诺绝对不丢数据。
- 附件上传重试不是断点续传；只有已上传附件引用可随草稿保存，未上传文件不保证刷新后可恢复。
- 发送结果未知不是发送失败，更不能仅因超时或回执过期自动重新执行。
- 阅读位置保护与重新打开会话定位最新是不同场景，不能以“记住位置”为名擅自更改后者。
- 文件缓存必须正确失效，资源和事件容量控制必须保持；“更快”不能以陈旧权限或无限增长为代价。
- 代码盘点、fixture 测试、真实 app-server 测试和真实设备测试分别记录，不能相互冒充；性能改善需在一致条件下测量。

## 5. 与实施计划的关系

[app-server 实施计划](../superpowers/plans/2026-09-25-app-server-integration-refactor.md) 的 S0 建立这 21 项的验证基线，S1—S5 随影响逐项回归，S6 做最终覆盖核对。该清单也适用于后续前端优化和 CLI 升级相关变更。

每个变更集可使用以下记录格式，不需要为纯文档变更运行整套应用测试：

```text
受影响编号：OPT-xx、OPT-yy
能力保留方式：原实现保留 / 等价替换
代码位置：
验证用例与结果：
未验证项与限制：
性能/截图对比（适用时）：
回退方式（适用时）：
其余编号未受影响的依据：
```
