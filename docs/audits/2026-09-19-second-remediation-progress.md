# 二次审计整改与验收记录

依据：[二次全项目深度审计](2026-09-19-second-deep-audit.md)。日期：2026-09-19。沿用当前工作区与既有产品边界；普通会话列表的搜索和状态筛选保持移除。

二次审计的功能整改及后续用户反馈已完成本轮实现与验收，构建版已上线。最终版本为 `5fa5a3f77899c8cad919`，2026-09-19 22:07:44（Asia/Shanghai）重启完成；线上资源与本地构建逐字一致。修复包括旧消息乱序、重复图片、新消息消失、缩放和三栏/单栏切换空白，普通会话进入到最新，以及管理只读查看从开头、固定列表和移除详情冗余控件。下表逐项列出实现和验收证据；真机专项与长期架构建议另列边界，不计作已验证完成。

## 逐项对照

路径中的 `public/`、`src/`、`test/` 均相对 `packages/codex-web/`。

| 项目 | 已实现的行为 | 主要实现与验证证据 |
| --- | --- | --- |
| S1 · 所有设备读取历史 | 普通浏览器、桌面、模拟 PWA 都有可聚焦的历史按钮；加载中、失败重试、历史起点有明确反馈；展示窗口与服务端分页相接 | `public/session-reading.js`、`src/session_timeline_page.ts`；`test/session_reading.test.ts`、`test/session_timeline_page.test.ts`、`test/browser/session-reading.spec.js` |
| S2 · 恢复/重绘跳位 | 当前会话内上翻后，focus、resize、只读重绘、权限状态更新保留可见消息锚点；本来跟随最新时继续跟随 | 上述阅读控制器及浏览器测试，锚点位移断言 ≤2px |
| S3 · 迟到响应 | 用户输入版本、会话/账户归属共同约束恢复；刷新、状态、最新页请求的旧结果不会覆盖更新的阅读或导航意图 | `test/browser/session-reading.spec.js` 的延迟状态、刷新期间滚动、换会话、取消最新页替换场景 |
| S4 · 刷新失败 | 历史与执行状态分别记录错误；保留消息和草稿，显示失败与重试，成功后清除错误 | 刷新失败后的真实浏览器交互及 [手机截图](2026-09-19-second-remediation-evidence/session-refresh-failure-mobile-portrait.png) |
| S5 · 手势语义 | 消息区拉取更早历史、标题区刷新，文案区分并支持中文；指示器等待实际分页 Promise | `public/pwa-pull-refresh.js`；浏览器 PWA 手势和慢分页测试 |
| S6 · 进入位置（按用户最新要求更新） | **普通会话进入、重新进入、整页重载及从管理台返回均到最新；管理台只读查看从第一条开始**。当前页面内刷新保持阅读位置。已有深历史书签不覆盖进入意图，非最新缓存页不作为最新页恢复 | `app.js` 会话打开/启动恢复路径；普通会话重新进入、reload、深历史缓存，以及 120 条管理只读消息的浏览器测试。按用户要求覆盖原审计的进入位置建议 |
| S7 · 上传归属与状态 | 上传绑定账户、认证版本和原草稿；切换会话不串结果；实际字节进度、逐个排队、单文件取消/重试；登出即时中止 | `public/attachment-upload.js`；`test/browser/attachment-upload.spec.js` |
| C1/C4 · 管理表单 | 按对象隔离草稿；文本、选择、勾选失败后保留；提交去重；A 保存完成不会关闭 B；密码只保留在内存 | `public/admin-editor.js`；`test/admin_state.test.ts`、`test/browser/admin-correctness.spec.js` |
| C2 · 旁观导航 | 成功、错误、finally 都检查导航归属；退出或选 B 后 A 的迟到响应失效 | 管理浏览器导航竞态与退出测试 |
| C3 · 最后管理员 | 停用、删除、换角色、编辑角色在同一身份写锁内保留至少一位可登录管理员；冲突返回 409 | `src/identity_store.ts`；`test/identity_admin_invariant.test.ts`、`test/server_admin_invariant.test.ts` |
| C5 · 独立加载 | 管理资源独立加载、缓存、报错、重试；失败不冒充 0 条记录；必要依赖缺失时禁用提交 | `public/admin-data.js`；管理状态与真实浏览器单资源故障注入 |
| C6–C8 · 管理会话 | 每页 30 条、稳定游标；游标绑定权限和过滤条件；复用原生/自定义会话标题；“全部”明确传 `state=all` | `src/admin_session_page.ts`；分页单元测试、真实 HTTP 多用户测试、浏览器查询契约测试 |
| UI · 布局与主题 | 管理表单保留按需编辑；会话审查按用户要求恢复 **360px 固定列表与独立详情区**，打开前后不挤压列表，窄屏独立详情。普通会话桌面顶部缩至 56px，停止改为低干扰图标，回到最新改为 44px 圆形向下箭头。系统页显示实际指标、版本、设备和配额 | `public/admin-ui.js`、`styles.css`；[布局与五主题检查](2026-09-19-second-remediation-evidence/visual-checks.json)。管理元信息 ≥12px，抽样文字对比度最低 4.77:1；系统表格局部滚动支持键盘 |
| F1 · 构建交付 | launchd 默认使用 dist；先构建并验收静态依赖；备份 plist；已完成真实 dist → source → dist 交付模式切换 | `scripts/service/`；[线上交付检查](2026-09-19-second-remediation-evidence/delivery-checks.json)。重启故障与恢复机制见下文 |
| F2 · 身份读取 | 复用不可变快照，以 inode/dev/size/mtimeNs/ctimeNs 校验版本；外部替换、同大小更新、撤销、删除和损坏均重新判断，不用 TTL 延迟授权变化 | `src/file_version_cache.ts`；`test/file_version_cache.test.ts`、身份/认证真实 HTTP 测试 |
| F3 · 报告索引 | 同路径共享有界版本缓存；外部替换/修改后失效；一次扫描复用一个索引快照 | `src/report_store.ts`；报告外部索引更新测试 |
| F4 · 有界上传 | 流式 multipart 与背压、私有临时目录；请求 32 MiB、单文件 25 MiB、20 文件、最多 4 并发，第 5 个返回 429；中止/失败/完成释放临时文件与并发名额 | `src/multipart_upload.ts`；真实 HTTP 二进制/Unicode、尺寸限制、并发、取消清理测试 |
| F5 · 报告读取 | UTF-8 安全截断的 512 KiB 预览；显式截断与完整下载；鉴权后流式传输；列表默认 50/max100，权限过滤后选择有界页面与稳定游标 | `src/report_store.ts`、`src/report_download.ts`；大文件、跨用户、分享范围和未认证下载测试 |
| F6 · 诊断指标 | 13 类有界路由指标；API P95 排除静态文件/文件流/SSE 寿命；SSE 握手和活动连接分别记录；错误、取消、历史页大小与存储指标 | `src/http_metrics.ts`；`test/http_metrics.test.ts`；管理系统页真实数据与失败恢复测试 |
| 工程 | 提取阅读、上传、管理编辑/数据及消息补偿控制器；7 个状态模块严格 checkJs；静态入口依赖逐个 HTTP 验收；不提高资源预算 | `tsconfig.frontend.json`、`test/frontend_budget.test.ts`、构建启动冒烟测试 |

## 追加修复：旧消息出现在末尾

已用隔离浏览器缓存复现：服务端最近一页没有很早的提问，本地缓存却仍把已接收消息标成 `pending`；旧补偿逻辑便把这些消息追加到最新回答后面。含附件的历史和上传阶段还可能具有不同的文件路径/展示字段，进一步妨碍仅靠显示内容匹配。用户随后提供的 reload 截图说明第一版修复仍有遗漏；本次只读核对该会话中几条已反馈消息的原始记录与 `CodexAppClient.readThread()` 顺序，原始顺序正常，没有修改原始历史。

进一步复现了三个前端分支：同一长任务跨越多页时，“活动轮次”条件仍保留页外旧回执；旧版缓存归一化丢失 `submissionId`、`deliveryLabel` 和 `historyAnchorId` 后，单凭 `pending` 标记继续补回；从缓存恢复的 assistant 内容仍标为 `source=stream`，使页面误以为当前实时输出拥有时间线，从而跳过历史校正。

`public/timeline-reconciliation.js` 现在只用真实发件箱或提交时仍处于当前页内的历史边界保留未同步消息，不再用任务是否活跃推断消息新旧。缓存归一化保留回执字段；打开会话时将缓存回复标为缓存来源，真实收到的新流事件才恢复实时来源。历史页合并不把本地 pending 项当作服务端历史；后台确认写回原会话缓存；稳定消息 ID 区分重复文字的新提问。历史请求失败时仍保留本地副本，不凭网络失败清除内容。

两项单元测试与浏览器长任务场景先确认旧版失败，再验证修复；浏览器覆盖 50 条最新页、旧版污染缓存、状态先于历史、当前长任务、刷新和 reload。向上分页仍能找到三个原提问，且位于近期消息之前。消息合并模块共 12 项测试，另有缓存回执字段的归一化回归。证据：[长任务桌面](2026-09-19-second-remediation-evidence/session-long-goal-order-desktop.png) · [长任务手机](2026-09-19-second-remediation-evidence/session-long-goal-order-mobile-portrait.png) · [跨轮次桌面](2026-09-19-second-remediation-evidence/session-order-desktop.png) · [跨轮次手机](2026-09-19-second-remediation-evidence/session-order-mobile-portrait.png)。

## 追加修复：重复图片、重复气泡与新消息消失

用户后续截图显示同一气泡里两张图片，并同时出现另一条带单张图片的相同提问。进一步通过真实 HTTP 复现：浏览器请求同时携带 `attachmentIds` 和 `attachments`，服务端直接拼接后，对同一个源文件创建了两份不同路径的快照；两张不同图片的合成请求实际产生了四份附件。附件数量不同又妨碍本地回执和服务端历史匹配。

服务端现在按规范化后的源文件路径合并同一附件的 ID/明细引用，再校验与创建快照。保留原请求格式，确保升级前持久化发件箱的重试仍使用相同请求内容；不同源文件即使同名也保留。真实 HTTP 回归覆盖旧格式和仅传 ID 的格式，以及快照数量、内容与现有鉴权边界。

已经存在的历史重复由 `src/attachment_history.ts` 在响应展示时修复：只检查当前获授权会话的服务端快照，只合并附件元信息相同且 SHA-256 内容相同的文件，保留原顺序。普通分页只检查当前返回页，摘要不扫描附件；文件按块读取，版本缓存最多 512 项，单文件上限 25 MiB。原始 Codex 历史和附件文件不改写；文件不存在、过期、越界或是符号链接时保留原记录，避免凭文件名猜测。浏览器回归覆盖已有污染缓存、当前运行轮次、刷新和 reload，结果为一个消息气泡、一张附件卡片：[桌面](2026-09-19-second-remediation-evidence/session-attachment-repair-desktop.png) · [手机](2026-09-19-second-remediation-evidence/session-attachment-repair-mobile-portrait.png)。

新消息消失也补充了两个复现：发件箱中的新提问被相同文字的旧记录抵消；服务端历史/执行状态迟到时，已接收但尚未进入历史的消息被过早清除。现在待发送消息不按文字抵消；运行中的补充消息回执带稳定 `clientMessageId`，确认与历史用同一个标识；本地回执记住提交时的历史边界，在迟到状态、刷新和 reload 中保留，远端确认出现后再合并。连续发送相同文字仍是独立消息，缓存序列化也遵循此规则。成功的 steering 同时使服务端历史缓存失效，不再等待下一个模型事件才更新。证据：[桌面](2026-09-19-second-remediation-evidence/session-message-receipt-desktop.png) · [手机](2026-09-19-second-remediation-evidence/session-message-receipt-mobile-portrait.png)。

## 追加修复：三栏/单栏切换后会话空白

浏览器复现确认，消息内容未变时渲染优化省略了新 DOM 的时间线内容，期望复用原节点；跨布局切换却替换了它的父容器，最终新容器内是空时间线。最终实现直接保证节点复用：如果外层替换产生新的时间线容器，在同一次同步渲染中把已有消息节点接回新容器；尺寸变化无需重新解析全部 Markdown，也无需等网络更新修补空白。尺寸变化同时保留阅读意图：正在跟随最新时继续到底部，阅读历史时保留锚点。

用户追加“单栏 session 拉大后过一会才显示”的截图后，又验证了带输入焦点的纵横比例切换：桌面窗口宽度不变而高度变化时，被错误当成手机软键盘弹出，跳过布局更新。键盘特例现只适用于没有桌面指针的设备，桌面缩放始终执行布局更新。

回归在 1440、1200、980、979、768px 和桌面纵向尺寸间反复切换，检查会话归属、消息数量、草稿、最新位置及浏览器错误。追加 70 条消息的连续窗口缩放测试，覆盖用户截图的 1937×1262、正方形两侧、仅高度变化和输入框焦点；逐帧检查消息与真实视口相交，检查首帧后的布局和消息数量，断言不依赖额外历史请求。证据：[逐帧记录](2026-09-19-second-remediation-evidence/session-resize-frames.json) · [拉大窗口](2026-09-19-second-remediation-evidence/session-maximized-1937.png) · [979px 单栏](2026-09-19-second-remediation-evidence/session-resize-979.png) · [1440px 三栏](2026-09-19-second-remediation-evidence/session-resize-1440.png)。

## 追加修复：管理台返回、只读起点与固定列表

管理台此前清空普通会话的选择，返回时由桌面自动选择第一条会话，而且没有执行普通会话的最新位置策略；只读查看则沿用了直接到最新的策略。现记录进入管理台前的普通会话，返回时复用正常的会话打开流程，保留草稿并到最新。手机返回管理列表与桌面退出整个管理台分别处理，避免把旁观会话留在普通工作区。

只读进入时先展示完整历史中的第一段 80 条，再定位到顶部；否则仅设置 `scrollTop=0` 会落在最后一段消息的开头。浏览器用 120 条消息覆盖首次打开、再次打开、跳到最新与返回更早消息，桌面和手机均通过。已有请求归属与迟到响应丢弃逻辑保留。

用户进一步明确不满意的是列表打开详情后的宽度变化。桌面管理会话页恢复固定 360px 列表，详情占剩余空间；未选择会话时保留详情占位。980、1200、1440px 均检查打开与切换详情时的列表宽度一致，切换后保留列表滚动，详情不被裁切。用户/角色/项目表单不因这次澄清改动。按用户追加要求，详情的“关闭详情”按钮与底部“观察模式 / 只读”提示条已移除；桌面通过列表切换会话，手机保留顶部返回。消息区使用腾出的高度，底部不再保留输入区的空白。

已查看：[桌面只读起点](2026-09-19-second-remediation-evidence/admin-beginning-desktop.png) · [手机只读起点](2026-09-19-second-remediation-evidence/admin-beginning-mobile-portrait.png) · [980px 布局](2026-09-19-second-remediation-evidence/admin-observer-980.png)。顶部控件另经长标题、长项目名、运行中 goal、320/390/980/1440px 实测，圆形箭头不遮挡输入框，键盘操作能回到最新并发送停止请求：[桌面](2026-09-19-second-remediation-evidence/session-controls-desktop-1440.png) · [390px](2026-09-19-second-remediation-evidence/session-controls-mobile-portrait-390.png) · [320px](2026-09-19-second-remediation-evidence/session-controls-mobile-compact-320.png)。

## 重启掉线原因与修复

本次构建切换引入过一次实际掉线，已在机器端直接恢复。隔离 launchd 实验复现了原因：`bootout` 是异步的，旧任务短暂仍能被 `print` 查到；旧脚本跳过 bootstrap 后调用 kickstart，得到 37（Operation already in progress）便退出，最终没有常驻任务可供 KeepAlive 恢复。

现在辅助任务等待旧任务真正卸载，重试临时加载失败，确认新 PID 持续运行；失败时恢复备份 plist。辅助任务只执行一次，不保留每日重启定时器；内嵌脚本快照，避免后台 shell 读取 Documents 的 macOS 权限限制。不会在 crash throttle 下反复执行阻塞的 kickstart。失败回退成功的辅助任务退出码为 2，正常完成为 0，日志明确记录结果。

`node scripts/service/verify-launchd-lifecycle.mjs` 使用独立临时服务验证了：服务内部发起 reload、故意启动失败后的自动恢复、普通重启。此次合成服务的故障恢复约 27 秒。真实常驻服务的源码模式、构建模式均验证首页、版本、直接 JS/CSS 资源以及私有 API/SSE 未登录返回 401。这里的回退是**同一份代码的交付模式回退**，不等价于应用代码版本回滚；README 已写明区别。

## 验证状态

最终源码对应的检查均已完成：

| 检查 | 最终结果 |
| --- | --- |
| `npm test` | native 58 + web 970，共 **1028 通过，0 失败** |
| `npm run test:browser -- --workers=5` | **154 通过，0 失败**；291 项按设备/项目适用条件跳过，不计作通过 |
| `npm run typecheck` | 通过，含 7 个前端状态模块的严格 checkJs |
| `npm run lint`、`git diff --check` | 通过 |
| launchd 安装器中的构建与编译后浏览器启动 | 构建 30 个静态资源；编译后实际加载 21 个脚本，浏览器错误 0 |
| 隔离 launchd 生命周期 | 服务内部发起重启、交付模式切换、故意启动失败后的自动恢复和普通重启均通过；服务脚本 11 项测试通过 |
| 最终线上交付 | dist 模式，版本 `5fa5a3f77899c8cad919`；首页、22 项直接 JS/CSS 依赖及 6 项私有接口/事件流鉴权检查通过；私有路由未登录返回 401 |
| 资源预算 | 源码 app.js 499,693 bytes；HTML + 22 项唯一直接 JS/CSS 的构建 gzip level 6 合计 **140,094 bytes**，低于 143,360 bytes 上限。原始构建 app.js 343,475 bytes，服务器替换构建号后为 343,473 bytes |
| 视觉与交互 | 已实际查看桌面、390/320px 手机及 980px 中间布局截图；五主题管理文字抽样对比度最低 4.77:1；系统表格支持键盘局部滚动 |

最新的逐帧缩放记录没有空白帧、没有额外历史请求、没有浏览器异常。管理台 120 条消息场景覆盖第一段 80 条窗口、重复进入、跳到最新、向上继续阅读；固定列表测试覆盖打开与切换详情时 360px 宽度及原列表位置保持。

命令结果、95 个交付源码文件的 SHA-256、构建号、线上核验和覆盖范围已记录到 [verification.json](2026-09-19-second-remediation-evidence/verification.json)，资源逐项体积见 [asset-sizes.json](2026-09-19-second-remediation-evidence/asset-sizes.json)。工作区保留未提交改动，没有创建提交。

## 验证边界

1. 浏览器自动化为 Chromium，包括触摸/standalone 模拟；没有把它说成真实 iPhone Safari/PWA、系统软键盘、地址栏、系统手势或蜂窝切网验收。
2. 报告分页限制返回量和保留内存，但每页仍扫描目录；并非已建成 O(page) 的数据库索引。目录规模显著增长时仍需以实际扫描耗时决定索引方案。
3. 上传临时数据能取消和清理，目标文件写入仍不是多文件事务；目标写入部分失败后的文件治理继续依赖已有配额/TTL 清理。
4. 指标是有界服务端观测与系统页展示，不等同于真实手机端到端弱网恢复耗时或生产负载压测。共享主机信任边界、鉴权、凭据只留在 Mac 的产品约束保持不变。
5. `app.js`/`server.ts` 仍有较大体积；本轮提取高风险状态边界，没有以框架迁移或全面路由重写扩大整改范围。
