# 聊天顺序、弱网与刷新恢复改造

日期：2026-09-29，最终集成验证于 2026-09-30 完成。范围：本地代码、自动化测试和浏览器 fixture；不代表已部署或已通过真实手机、真实 app-server 验收。

## 为什么有序号仍然会错落

原来的 SSE `sequence` 说明事件的传输顺序。同一条消息可能经历多个 delta、最终事件、历史快照和本地缓存恢复；这些来源的身份、版本和排列顺序不一致时，仅按 SSE 序号仍然会重复、倒退或丢失内容。历史请求先发后到，也可能覆盖后来收到的实时输出。

本次将消息身份、消息位置、内容版本与传输游标分别处理：

| 字段 | 作用 |
| --- | --- |
| `timeline.id` | 同一消息在实时事件、HTTP 历史、本地缓存中使用相同身份；相同文本的不同消息仍然独立 |
| `timeline.position` | 服务器确定的会话内排列位置，不依赖客户端时间或网络到达顺序 |
| `timeline.version` | 同一代时间线内拒绝更旧内容；缺少完整文本的 delta 必须有连续的消息版本 |
| `timelineCheckpoint.generation` | 历史重排、回填、删除或保留范围变化时使旧排列、旧分页游标失效 |
| `timelineCheckpoint.revision` | 描述快照边界，合并并发到达的新消息时使用 |
| SSE `epoch` / `sequence` | 描述本轮事件流的断点；服务重启、游标过期时通过 reset 与快照恢复 |

核心实现：[canonical_timeline.ts](../../packages/codex-web/src/canonical_timeline.ts)、[runtime.ts](../../packages/codex-web/src/runtime.ts)、[timeline-reconciliation.js](../../packages/codex-web/public/timeline-reconciliation.js)、[app.js](../../packages/codex-web/public/app.js)。

## 存储与恢复约束

- 后端增加 `stateDir/canonical-timeline.sqlite`，默认在 `~/.codex-web/` 下。SQLite 事务提交消息投影后再发布事件；文件权限为 `0600`。
- 投影按现有配置限制条数与载荷字节数，会话检查点数量也有上限。SQLite 页、索引及事务元数据属于额外的有界开销，配置的载荷预算不是数据库文件的精确大小上限。
- 这是有限的消息投影，不是永久事件日志或完整历史备份。SSE 仍保留原有内存预算；超过回放范围或服务重启后，使用快照与原生历史恢复。投影裁剪不截断可通过 HTTP 遍历的原生历史。
- 分页使用包含会话、受众、时间线代次和位置的游标。先授权、过滤可见数据，再分页；代次不符返回明确的 `resetRequired`。
- 浏览器继续使用有界、按身份隔离的 localStorage 缓存。只有保存内容覆盖当前消息投影时才保存可继续使用的事件断点；截断或淘汰内容时同步作废断点。未引入 IndexedDB 迁移。
- 服务端回执与浏览器预先计算的消息身份都使用 `SHA256(submissionId).hex.slice(0, 24)`。浏览器实现同步计算，适用于局域网 HTTP，不依赖安全上下文中的 Web Crypto。
- 先持久化“服务器已收到”的回执，再保存消息投影、移除 outbox。存储失败保留未知/已收到状态，继续查询或恢复原回执，不自动重新 POST。

## 首屏与生产资源

为保留原有弱网首屏预算，将历史归一化与有界缓存序列化移入 `timeline-model.js`；文件查看器、Webhook 设置脚本和管理页样式按首次使用加载。新增的 `lazy-feature.js` 为可选视图提供加载超时、失败重试和身份检查，文件打开另外检查导航是否已失效。模块加载失败不清空草稿，也不把运行中的任务标为失败。

这些可选资源仍属于 Service Worker 的完整应用壳缓存；首次加载使用正常版本 URL，失败重试才增加尝试参数。首屏延后加载不改变完整更新与离线壳的判定。缓存恢复路径同时初始化历史和状态加载标记，防止完整刷新后状态为 `undefined`。

## 故障时的行为

| 场景 | 恢复行为 |
| --- | --- |
| 慢历史响应晚于实时消息 | 补齐缺失历史，保留更新的消息版本；旧请求不能覆盖新会话 |
| POST 已接收但响应丢失 | 根据原提交身份匹配历史/实时消息并查询回执，界面只保留一条消息 |
| 保存回执或缓存时配额不足 | 保留可恢复的提交状态；已确认接收时显示“服务器已收到”，避免误导重发 |
| 页面刷新时服务器不可达 | 已缓存窗口继续可读；显示同步失败状态，联网后再校准最新窗口 |
| 历史回填、回滚或顺序变化 | 更换时间线代次；旧分页游标和旧流快照触发校准，不能复活已移除的旧代消息 |
| SSE 缺少中间 delta | 不拼接残缺后缀、不推进该事件的断点；请求完整内容后重连 |
| 服务重启或事件缓存过期 | SSE reset；结合持久化投影和原生历史重建可读消息 |
| 原生历史暂未出现已接收消息 | 保留实时记录并按已知相邻消息/所属 turn 定位，避免落到后续 turn 之后 |
| 用户正在阅读旧消息 | 保留阅读锚点及其旧 ID 别名；正常重新打开会话仍按既有行为定位最新 |

## 验证入口

新增测试：

- `canonical_timeline.test.ts`：稳定身份、相同文本、回填重排、SQLite 重开、读写竞态、保留范围、分页游标与别名。
- `runtime_canonical_timeline.test.ts`：原生格式 provider fixture、初始发送/追问、流与历史身份一致、持久化失败后的未知结果。
- `server_timeline_sync.test.ts`：HTTP keyset、授权边界、旧代 SSE reset、已建立连接中的换代快照。
- `server_runtime_timeline_sync.test.ts`：真实 HTTP server、runtime 与 SQLite 配合原生格式 provider fixture，验证接收回执、重复 POST 只执行一次、原生历史归一化、重启后的身份与检查点、旧 epoch reset 和接口鉴权。
- `timeline_sync_recovery.test.ts`、`submission_delivery_recovery.test.ts`、`submission_identity.test.ts`、`session_reading_alias.test.ts`：合并协议、回执保存失败、哈希向量、阅读锚点。
- `browser/timeline-sync-recovery.spec.js`：桌面与手机尺寸下的刷新、弱网、缓存、未知回执、同序号换代、缺失 delta、迟到历史和跨会话响应。
- `browser/optional-feature-loading.spec.js`：可选资源延后请求、文件脚本失败后重试、草稿保留、Webhook 首次打开，以及迟到脚本不能重新打开之前的会话。

浏览器用例采用 HTTP/SSE fixture，其中部分用例注入真实前端函数以确定性地触发竞态。它们不模拟真实 app-server 的全部行为。Service Worker 离线壳与半更新保护另外由 `service_worker_cache.test.ts` 验证。

人工查看了 [手机离线历史窗口](2026-09-29-timeline-sync-recovery-evidence/mobile-portrait-cached-historical-window.png) 和 [桌面相同文本的两条独立消息](2026-09-29-timeline-sync-recovery-evidence/desktop-distinct-identities-after-reload.png)：缓存仍可读，错误提示不遮挡输入，独立消息在刷新后没有合并。

最终验证结果：

| 命令 / 范围 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，包含新集成测试和前端检查 |
| `npm test` | native-api 75 通过；codex-web 1083 通过、1 项已有失败。唯一失败为下述设置缓存基线问题；没有跳过或放宽断言 |
| `npm run app-server:test` | 单独补跑，5 通过；这是兼容性脚本单测，不是真实 app-server 执行验收 |
| server_auth、server_runtime_timeline_sync、server_timeline_sync、frontend_budget 定向测试 | 70 通过 |
| Playwright：timeline-sync-recovery、weak-network、session-reading、session-output-recovery、markdown-file-links、admin-navigation、optional-feature-loading，desktop / mobile-portrait | 分组执行并对修复后的阅读状态重新验证，去重后最终 112 通过、8 项因既有视口条件跳过；其中新增时间线恢复用例 28 通过 |
| 修复后的 session-reading 与 optional-feature-loading 两组浏览器回归 | 43 通过、5 项视口条件跳过，包含于上行范围 |
| `npm run build` | 通过，生成 42 个公共资源 |
| `npm run test:built-public --workspace packages/codex-web` | 通过：真实生产静态路由与手机尺寸 Chromium，30 个脚本响应成功、无浏览器异常；核对新模块、可选资源、压缩、ETag、304 与版本缓存 |
| ESLint：改动的主前端、身份/合并/回执/延后加载模块与生产检查脚本 | 通过 |

当前构建的首屏依赖共 30 个，gzip 合计 **143,121 bytes**，原限制 **143,360 bytes（140 KiB）**；`app.js` 源码 **499,126 bytes**，产物 **261,619 bytes**，原限制均为 **500,000 bytes**。没有提高预算；剩余余量较小，后续前端修改仍需运行预算测试。

测试运行日志保存在当前宿主的 `/tmp/codex-timeline-*.log`，不提交运行日志、临时数据库或构建输出。检查后还原了测试自动覆盖的旧日期截图，保留上面的本次验收截图。

## OPT-01 至 OPT-21 保留核对

| 编号 | 保留方式与验证入口 |
| --- | --- |
| 01 | 保留退避、超时、断网与终态分离；网络恢复单测、weak-network 浏览器测试及新 delta 缺口用例 |
| 02 | 扩展代次检查与一致快照；event_bus、server_timeline_sync、新浏览器 reset 用例 |
| 03 | 缓存仍有界；离线刷新保留旧窗口，新浏览器缓存用例与 public_ui |
| 04 | outbox 与已知回执保留；submission_delivery_recovery 及存储失败刷新用例 |
| 05 | 原提交身份查询，不盲目重发；server_session_submission、server_webhook、回执丢失浏览器用例 |
| 06 | 草稿代码与用户分区保持；draft_store/public_ui 既有断言 |
| 07 | 保留前后台恢复，并按当前身份/会话约束恢复任务；network_recovery、weak-network 与跨会话用例 |
| 08 | 保留分步加载；session_loader、public_ui 与慢历史浏览器用例 |
| 09 | 将数字偏移升级为有代次的稳定分页边界，保留旧客户端兼容；canonical_timeline、server_timeline_sync、长历史浏览器用例 |
| 10 | 使用身份别名保护旧阅读锚点；session_reading、session_reading_alias 与 session-reading 浏览器测试 |
| 11 | 保留局部 DOM 更新，分页按钮在时间线局部刷新后重新绑定；public_ui 与历史翻页浏览器用例 |
| 12 | 普通缓存仍合并写入；提交完成时增加必要的耐久检查点；public_ui 与存储失败用例 |
| 13 | 恢复任务、历史与分页响应增加 owner/导航/版本检查；request_context、public_ui、新迟到响应浏览器用例 |
| 14 | 上传协议和并发控制不变；乐观消息换成规范消息时保留附件；attachment_upload、server_session_files、session-output-recovery |
| 15 | 新身份、时间线模型与加载模块加入完整壳缓存；延后使用的资源仍参与完整缓存，半更新保留旧完整缓存；service_worker_cache、生产静态服务验证 |
| 16 | 未读状态模型不变；session_attention/public_ui 回归 |
| 17 | 延续原有样式；桌面/手机截图与阅读、恢复用例；未新增真机验收 |
| 18 | 保留压缩、ETag、资源缓存和原有首屏预算断言；可选视图延后加载；static_asset_cache、frontend_budget、server_auth、optional-feature-loading 与生产静态服务验证 |
| 19 | 保留版本感知的会话查询缓存；runtime_scaling、file_version_cache、session_list_page。基线设置缓存用例另见限制 |
| 20 | 原 SSE 条数/字节/慢客户端保护保持，新增投影有界；event_bus_memory、server_sse_backpressure、storage_governance、canonical_timeline |
| 21 | 授权后恢复与分页、持续流授权保持；server_auth、server_multi_user、server_session_submission、server_webhook 等既有断言 |

## 限制与回退

- 离线可以读已缓存内容、保存待发送文字；无法离线执行 Codex 或保证读取所有历史。浏览器清除存储、磁盘损坏和未上传附件不在“不丢数据”的保证内。
- 旧 provider 若不提供稳定原生 item ID，部分历史消息仍需要位置身份回退。不能据此宣称任意上游数据都能无条件正确去重。
- 被容量淘汰的历史身份记录仍依赖上游历史重新构建，不保证无限期保留所有别名。超大历史超过投影缓存边界的真实负载仍需专项压力验证。
- 同步 SQLite 写入的实际延迟取决于宿主磁盘；本次自动化测试耗时不能替代真实负载和设备验收。
- `runtime_scaling.test.ts` 的“1000 saved settings are loaded once per manifest revision”在未修改的 HEAD runtime 中也可复现 `2 !== 1`。这是已有的会话排序初始化使设置缓存再次加载，不通过放宽原断言掩盖。
- 未部署或重启当前用户服务；未操作真实对话执行任务。Safari/PWA 真机、长时间断线及真实 app-server 的全链路仍需上线前验收。
- 回退时只回退本次代码改动，保留用户原有修改、原生历史与 outbox；新 SQLite 投影可留存供后续版本读取。旧 SSE 客户端不识别新增字段时仍使用原有接口，旧数字分页请求继续兼容。
