# Codex Web 整改完成与验收报告

依据：[原始审计报告](2026-09-19-remediation-and-optimization-report.md)，基线 `23fb2a9`。原始报告与证据保持不变，修复后的数据另存于[整改证据](2026-09-19-remediation-evidence/measurements.json)。

报告列出的 B1–B6、F1–F6、U1–U5、E1–E3、O1–O4 共 24 项已完成本轮实施和自动化验收。按用户要求，产品实现由 GPT‑6、medium 推理强度的三个代理承担，主代理负责接口协调、代码复核、独立实验与最终集成。

改动保留在当前工作区，尚未提交。后续已按用户要求移除会话列表搜索和状态筛选、统一展示 Codex 会话名称、增加用户重命名能力、完成首轮弱网修复，并重启本机服务，最新结果见第 7–10 节。第 1–6 节保留首次整改完成时的验证快照；其中性能数字来自同一台 Mac 上的隔离合成实验，不代表真实手机或生产负载的服务等级，原有截图和代码哈希也不代表后续版本。

后续二次审计和用户追加问题的最终实现、界面规则及上线版本，见[二次整改验收记录](2026-09-19-second-remediation-progress.md)。本报告下方的首次验收数字为历史快照。

## 1. 主要结果

| 可比项目 | 审计基线 | 整改后 |
| --- | ---: | ---: |
| 500 条已加载消息的页面 DOM 节点 | 26,467 | 4,220，减少约 84% |
| 500 条消息下全局 render，4 倍 CPU 降速 | 505.6–559.9ms | 首次 40.9ms；后续 1.0–2.9ms |
| 同样长历史下实际菜单点击 | 未单独记录 | 同步处理 10.8–55.5ms；到下一帧 14.8–91.9ms |
| 1,000 会话、每上游页延迟 10ms，首屏 30 条 | 137.73ms，等待 10 页 | 24.25ms，只等待第 1 页 |
| 同目录 20 次后续 HTTP 列表读取 | 未单独记录 | 中位 0.72ms，P95 1.34ms；不增加上游页读取 |
| 15MiB 历史库，读取中位 | 8.33ms | 0.07ms（迁移后的缓存读取） |
| 15MiB 历史库，追加中位 | 48.12ms | 3.97ms |
| 250ms 锁竞争时，主线程零延迟计时器的实际延迟 | 292.14ms | 0.22ms |
| 100 次身份验证的主认证文件提交 | 100 次 | 1 次，显示用 lastSeen 合并写 |
| 重复 app.js Brotli 请求，中位 | 5.29ms | 1.28ms |
| 首屏 HTML + 实际 JS/CSS 依赖图，gzip level 6 | 143,441 bytes | 124,955 bytes；预算仍为 143,360 bytes |
| 完整 npm 依赖审计 | 2 个 high 开发依赖包 | 0；生产依赖也是 0 |

首次迁移 15MiB 旧存储另需约 100.51ms；它没有被隐藏在暖缓存数字中。目录响应时第二页可能已经在后台启动，但首屏只等待一页；完整 1,000 会话仍总共读取 10 页。全局搜索会等待完整目录，覆盖首屏之外的会话。

500 条消息样本包含约 342,220 字符，使用和原审计相同的内容及 4 倍 Chromium CPU 降速。80 条消息组成一个 DOM 窗口，较早/较新的窗口可切换，重叠区保留滚动锚点。首次 100 条样本的渲染为 94.9ms，说明第一次创建窗口仍有成本。菜单的“下一帧”是实验计时，不是用户遥测 INP。

## 2. 逐项整改与证据

下表所有项目均已验证；测试文件位于 `packages/codex-web/test/`，实现位于同包 `src/` 与 `public/`。

| 项目 | 实际变化 | 主要验证 |
| --- | --- | --- |
| B1 会话导航竞争 | 请求 generation、AbortController 和响应归属覆盖成功、失败、清理；离开会话取消打开请求 | `frontend_contracts.test.ts`、`browser/remediation.spec.js`；独立迟到 404 实验中，新会话、消息与卡片均保留 |
| B2 历史部分失败 | 历史与执行状态分别报错；缓存有明确说明；提供重试；compact 和兼容回退都有截止时间，只有不支持 compact 才回退 | 真实 compact 浏览器回归覆盖历史失败、状态失败、二者失败与重试；500 不触发完整详情读取 |
| B3 provider 兼容 | 完整遍历活动/归档分页；处理空页、cursor 循环、并发合并及上游错误；不支持历史时明确返回 history_unavailable | `runtime_scaling.test.ts`、`runtime.test.ts` |
| B4 认证并发 | 跨进程异步锁内重读、原子提交；改密、退出与迟到 touch 不再复活旧凭据；team 登录核对已验证的密码版本 | `auth_store.test.ts` 的真实子进程写前屏障、`hybrid_auth_store.test.ts`；独立改密实验 |
| B5 已有 SSE 授权 | 分享准确到期；异步授权后与逐帧再次检查；令牌、用户、会话、项目和权限变化均重验；无关变更不误断连 | `server_multi_user.test.ts`、`server_sse_backpressure.test.ts`；独立 HTTP 实验确认到期后旧流关闭且不再收到消息 |
| B6 草稿 | 按已确认账户与会话保存文本、已上传附件引用，以及未创建会话的项目草稿；发送/退出清理；损坏数据过滤，配额失败有可见反馈 | 草稿与新会话刷新恢复、账户隔离、附件、存储拒绝时仍可退出的单元和浏览器回归 |
| F1 前端渲染 | 稳定保留 timeline 与 textarea；菜单、状态、队列、附件及错误提示使用固定插槽；80 条 DOM 窗口与 Markdown 缓存；设置面板有界复用 | 实际菜单开关及附件/错误插入后节点、文本和光标选择不变；500 条压力实验；原内存阈值下重复 3 次及全量浏览器通过 |
| F2 列表与历史 | 目录首屏先返回，完整目录后台建立；完整搜索；稳定排序/游标快照；metadata 不读取 turns；历史投影复用；team 按授权范围缓存 DTO | `runtime_scaling.test.ts`、`session_list_page.test.ts`、`server_multi_user.test.ts`；1,000 会话 HTTP 实验；两页历史只读取一次完整 turns |
| F3 存储 | 异步文件与锁；会话分片、原子 manifest、有界缓存；旧格式迁移备份；当前与前一版本可恢复；配额与后台孤儿清理 | 跨进程读写、迁移重启、损坏恢复、保留版本上限与配额测试；提交后清理失败不误报保存失败 |
| F4 认证写入 | 单用户按文件版本缓存 token 索引；lastSeen 每设备最多 30 秒一次；team 以持久化 session 为准 | 即时撤销回归；100 次校验只产生一次主文件提交，不以认证 TTL 缓存替代实时撤销 |
| F5 资源交付 | esbuild 生产压缩；静态原文/gzip/br/ETag 有界缓存；管理模块按需加载；SW 按旧 shell 自身依赖判定完整性 | 构建、真实编译后服务启动、预算、6 个缓存兼容回归；CI 新增编译后浏览器启动检查 |
| F6 大文件/治理 | 文本预览最多 256KiB；超过 8MiB 的非文本不自动预览；显式下载；服务端 64MiB 上限、Range、64KiB 流缓冲和最多 4 个句柄；读请求移出递归治理 | `server_session_files.test.ts`、浏览器截断预览/完整下载、描述符异常释放、硬配额与后台维护回归 |
| U1 核心触摸 | 工作详情、停止、审批等核心触摸目标至少 44px；状态 12px；“本会话允许”替代“会话” | 320/390px coarse pointer 实测、截图和浏览器尺寸断言 |
| U2 可读性 | 次要文字采用直接语义色，摘要/元信息 12px；测量实际组件及选中背景 | 五主题选中/未选中均 ≥4.5:1，最低 6.71:1；不是只检查 token |
| U3 运行反馈 | 常驻停止；执行、连接、elapsed、最后业务活动分开；业务时间不由心跳刷新；失败与长期无业务活动可筛选 | 运行/失败状态测试、真实审批/停止流程；独立观察时间从 0s 增至 2s，无需全局重绘 |
| U4 查找/层级 | 全目录搜索、活动筛选，包含归档范围；异步查询归属与缓存隔离；任务标题优先，项目次级；长历史窗口及工具明细保留 | 搜索请求合约、首屏之外命中、失败筛选、归档范围、长历史与工作明细滚动回归 |
| U5 响应式 | 320px 中文权限纵向布局；980px 起提供紧凑导航/列表/正文；宽屏布局延续；状态、草稿与焦点保留 | 320、390、768、979/980、1100、1279/1280、1440px 截图；720×450 CSS 视口补查缩放等效空间 |
| E1 浏览器门禁 | 修正 CSP 观测层级，继续要求脚本不执行、父页不导航、资源无成功传输；fixture 补齐 /status、/timeline | 全量浏览器通过；CDP 确认 blockedReason=csp，response 和 route 接收均为空 |
| E2 边界与类型 | 提取 request-context、draft-store、本地化、文件视图、Webhook 视图、目录、分片存储、静态缓存和指标模块；能力显式注入；前两个前端状态模块 strict checkJs | 新模块契约、前端类型检查、构建启动及原 UI 回归；源码 app.js 499,331 bytes，未提高 500,000 上限 |
| E3 依赖 | brace-expansion 1.1.21、js-yaml 4.3.2；显式固定构建依赖 esbuild 0.28.1 | 官方 registry 完整/生产 audit 均 0；lint、构建及测试通过 |
| O1 定时任务 | 默认 6 小时终态截止；调用方取消及运行时关闭/重启感知；失败时有界中断、释放订阅和锁，不归档未完成会话 | `task_runner.test.ts` 的截止、取消、重启及后续锁可用回归 |
| O2 服务停止 | 先关闭 SSE；普通连接最多 1 秒 drain，随后销毁剩余 socket；存储维护等待收尾 | 服务端连接 drain 与事件流回归 |
| O3 设备与恢复 | 登录设备列表、撤销单设备/其他设备；90 天 token TTL；认证备份、损坏后关闭与显式本地重置 | 后端设备与到期测试，前端控件、退出存储失败测试；恢复说明见架构文档 |
| O4 观测 | 管理员认证后的聚合指标：请求、事件循环、SSE replay/reset、存储扫描和缓存命中；不记录 prompt、token、原始文件 | 指标授权/结构测试与真实 HTTP 读取；实验事件循环 P95 12.61ms，普通读链路扫描数 0 |

## 3. 最终自动化门禁

| 检查 | 最终结果 |
| --- | --- |
| `npm run build` | 通过；包括 TypeScript 与生产前端资源 |
| `npm run typecheck` | 通过；包括新增前端 checkJs |
| `npm run lint` | 通过 |
| `npm test` | native 57 + web 911，共 968 通过，0 失败 |
| Playwright 全量，5 workers | 74 通过，0 失败；151 项按视口条件跳过，不计为通过 |
| `npm run test:built-public --workspace @codex-mobile-web-app/codex-web` | 通过；编译后服务加载 13 个脚本，0 浏览器错误 |
| 官方 registry 完整及 `--omit=dev` audit | 均 0 项告警 |
| `git diff --check` | 通过 |

没有提高性能预算、降低对比度要求或放宽内存阈值来消除失败。集成时补修了原生下拉框节点残留、控件保存失败回滚、菜单/附件插入导致 textarea 更换，以及异步 Webhook 与 outbox 恢复的等待契约。旧 PWA 缓存使用旧页面实际依赖判定，不要求它包含新版新增模块。

构建保留可读源码，输出到 `dist/public`；源码开发入口仍读 `public`，编译后的服务使用构建产物。构建清单记录源文件、产物及构建器哈希，编译后启动检查会拒绝过期或损坏的构建；CI 已接入该检查。

## 4. 视觉与交互复核

最终检查 URL 为隔离 fixture `http://127.0.0.1:41743`，另有随机端口的编译后真实服务启动检查。已实际查看桌面、手机、中间宽度与窄屏设置截图；10 组 CSS 视口均无页面横向溢出或 JavaScript 页面错误。720×450 是 1440×900 在 200% 下的等效内容空间检查，不冒充实际浏览器缩放或 iOS 真机测试。

- [390px 手机工作区](2026-09-19-remediation-evidence/final-phone-chat.png)
- [320px 审批操作](2026-09-19-remediation-evidence/final-compact-chat.png) · [中文权限设置](2026-09-19-remediation-evidence/final-compact-permissions.png)
- [1100px 中间布局](2026-09-19-remediation-evidence/final-intermediate-chat.png) · [1440px 桌面布局](2026-09-19-remediation-evidence/final-desktop-chat.png)
- [手机完整权限选项](2026-09-19-remediation-evidence/final-phone-permissions.png) · [缩放等效空间](2026-09-19-remediation-evidence/final-zoom-equivalent-permissions.png)
- [迟到 404 后仍保留正确会话](2026-09-19-remediation-evidence/race-missing-session.png) · [历史失败的明确重试入口](2026-09-19-remediation-evidence/partial-history-error.png)

五主题实际次要文字的最低对比度分别为 fresh-light 7.09、retro 6.71、terminal 8.65、dark-gold 8.34、oled-black 9.37。检测覆盖选中与未选中背景，关闭颜色过渡后取稳定渲染值。

## 5. 运行与迁移说明

首次访问旧设置/时间线存储时，会保留旧文件与 `.migration-backup`，再创建会话分片和 manifest。不会自动用陈旧备份回滚已接受的新数据。当前与前一提交都保留，恢复快照可能额外占用一份 live quota；恢复步骤见[运行时与存储说明](2026-09-19-runtime-storage-remediation.md)。

认证数据损坏时拒绝访问，需要使用现有本地 `codex-web auth set-password` 进行显式恢复并撤销旧设备。已有无 expiresAt 的设备也按创建时间计算 90 天期限。分享仍默认关闭，共享 Mac 账户仍仅面向完全互信用户。详情见[认证与 HTTP 生命周期](../architecture/auth-and-http-lifecycle.md)。

## 6. 验证边界与剩余规模成本

本轮关闭的是报告列项及整改过程中复现的回归，不承诺未来没有缺陷。以下限制已明确保留：

- 尚未执行真实 iOS Safari/PWA、系统键盘、读屏、物理弱网及生产长任务验证；没有真实用户 INP/CLS 遥测，也没有长期内存和磁盘寿命数据。
- provider 首次读取某会话的完整 turns 仍有一次成本；外部历史变化最多约 5 秒后刷新，目录通常 30 秒刷新。历史缓存限制为 32 会话/64MiB，超大单会话不会强行驻留。
- 写入时的硬容量校验仍需权威扫描；后台清理已移出普通读请求，未用缓存牺牲跨进程配额正确性。
- 前端完整下载仍可使用 Blob；非文本预览限制为 8MiB，服务端下载流与文件上限有界。未实现浏览器原生持久流式保存或 PDF 按页远程渲染。
- 模块拆分与类型化按本轮边界推进；app/server 等历史文件仍较大，尚未整体迁移框架或全量前端 TypeScript。macOS 已实跑，Ubuntu 只完成兼容性审查并新增 CI，未把本地结果称为 Linux 实测。

所有测量、截图与代码 SHA-256 汇总在[持久化验收证据](2026-09-19-remediation-evidence/measurements.json)。原始发现仍保留在原审计报告，避免把整改后状态覆盖为“问题从未存在”。

## 7. 后续调整：移除列表搜索与状态筛选

2026-09-19，按用户要求撤回 U4 中的会话搜索和活动/状态筛选入口，同时移除关联的前端状态、事件绑定、样式、专用文案及 `q` / `activity` 查询参数生成。收藏、最近、归档、项目导航和游标分页保持可用，运行/审批反馈及后端目录优化继续保留。第 2 节中关于前端搜索、失败和停滞筛选的描述由本节取代。

本次验证：459 项聚焦前端测试通过；浏览器 75 项通过、150 项按视口条件跳过、0 失败；typecheck、build、lint、构建新鲜度和 `git diff --check` 通过。编译后服务启动检查同步改为等待会话列表就绪，并验证两个控件不存在；加载 13 个脚本，0 浏览器错误。

独立检查覆盖 1440×900、390×844 触摸、1100×900、320×568 触摸：分页和打开会话正常，没有横向溢出或页面错误，请求未携带 `q` / `activity`。证据：[检查数据](2026-09-19-list-simplification-evidence/checks.json)、[桌面列表](2026-09-19-list-simplification-evidence/desktop-list.png)、[手机列表](2026-09-19-list-simplification-evidence/phone-list.png)、[中间宽度会话](2026-09-19-list-simplification-evidence/intermediate-chat.png)。

已通过独立 launchd helper 重启 `com.chenyanshan.codex-web`，保留原来的源码开发启动配置。进程从 50607 更新为 52403，页面版本为 `6fa49c9bc80eb6124869`；首页返回 200，实际提供的 app.js 与当前源码一致，未登录的私有会话 API 返回 401。

## 8. 后续调整：复用 Codex 会话名称

本机 `codex-cli 0.153.4` 生成的协议将 `Thread.name` 定义为可空的用户可见标题，`preview` 通常是首条用户消息。已有 `CodexAppClient` 在列表和详情中把 `name` 映射为 `title`，runtime 与 HTTP DTO 也已保留该字段；本次问题位于前端：列表优先展示首条输入，压过了已取得的名称。

现在列表与会话顶栏共用 `sessionDisplayTitle()`：Codex 名称 → 首条输入 → 预览 → 新会话；空白名称按无名处理。最近输入作为次级摘要，与实际标题相同时隐藏。标题保留原文和 HTML 转义，项目名称继续作为次级上下文。名称变化沿用现有列表和会话元信息刷新流程；本次直接复用已有名称，未增加自动命名请求。协议虽有 `thread/name/set` 和 `thread/name/updated`，这本身不能证明官方客户端自动命名的生成时机或模型策略。

后续核对官方命名机制时，OpenAI Docs 域名请求返回 403，因此使用本机 CLI 生成的协议和安装包内证据。Codex CLI 0.153.4 的二进制包含 `codex_tui::app::thread_title` 下的 `generate_thread_title`、`thread_title_prompt`、`recent_conversation_thread_title_prompt`、`parse_thread_title`；内置提示词要求用用户语言生成简短单行任务标题，尽可能少于五词、以祈使动词开头、保留工单引用，避免引号/Markdown/末尾标点，并优先考虑当前任务和最近实质性请求。这证明该版本 CLI 有专门的标题生成流程；尚未确认自动触发时机、使用模型和具体字符上限，也未将 CLI 证据扩展为桌面客户端的实现结论。

本次验证：460 项聚焦前端测试通过；浏览器 77 项通过、153 项按视口条件跳过、0 失败；typecheck、build、lint、构建新鲜度、编译后启动检查和 `git diff --check` 均通过。独立适配器实验确认列表/详情保留 native name，空名称保持为空。

独立浏览器检查覆盖 1440×900、390×844、980×900、320×568，并实际查看截图；短名称、空白回退、HTML 字面值、超长中文/连续英文、切换会话、刷新名称和保留草稿均正常，没有横向溢出、页面错误或静态资源加载失败。[检查数据](2026-09-19-session-title-evidence/checks.json) · [手机列表](2026-09-19-session-title-evidence/phone-list.png) · [手机会话](2026-09-19-session-title-evidence/phone-chat.png) · [桌面列表](2026-09-19-session-title-evidence/desktop-list.png) · [中间布局](2026-09-19-session-title-evidence/intermediate-chat.png)。

已再次重启原 launchd 服务，进程从 52403 更新为 56699，页面版本为 `c8f19e0986122fd3d08b`；首页 200，实际 app.js 与当前源码一致，未登录私有 API 401。见[重启验证](2026-09-19-session-title-evidence/restart-check.json)。

## 9. 后续调整：用户自定义会话名称

打开会话右上角菜单，选择「重命名」，输入名称并保存。名称通过现有 `CodexAppClient` 的原生 `thread/name/set` 写入 Codex，网页列表和顶栏随即更新，刷新后仍保留。名称去除首尾空白后为 1–120 个 JavaScript 字符串长度单位，拒绝控制字符与换行；该上限属于本产品输入约束。保存不发起模型任务、不读取完整历史，也不修改输入与排序时间。

新增认证后的 `PATCH /api/sessions/:id/name`。多人模式沿用会话所有权与项目写权限，显式提供 `canRename` 能力；只读项目、其他用户会话、管理员旁观和归档会话不能改名。服务端成功写入后才更新元信息、列表和目录缓存，同一会话的写入按顺序执行；较早发出的列表与状态响应不能覆盖刚保存的名称，后续新读取仍允许反映其他客户端的改名。

重命名窗口支持键盘焦点、取消、保存等待、失败保留输入与重试；保存中防止重复提交和误关闭，切换会话或身份后忽略迟到结果，未发送草稿继续保留。手机输入框字号 16px、高度 44px，触摸按钮均不小于 44px。

本次最终验证：723 项定向测试通过；浏览器 80 项通过、160 项按视口条件跳过、0 失败；typecheck、build、lint、`git diff --check` 和生产构建启动检查通过。编译后的服务加载 14 个脚本，0 浏览器错误；源码 `app.js` 为 498,584 bytes，维持原 500,000 bytes 预算。[检查汇总与源码哈希](2026-09-19-session-rename-evidence/verification.json)。

独立 HTTP 验证使用真实服务、runtime 和 native adapter，以及隔离的合成 provider，验证原生调用参数、运行时重建后的名称保留、错误不覆盖旧名、权限与归档限制；没有修改真实会话。并发实验确认原生名称与缓存最终一致。[接口验证](2026-09-19-session-rename-evidence/integration-checks.json) · [并发验证](2026-09-19-session-rename-evidence/concurrency-check.json)。

独立浏览器检查覆盖 1440×900、390×844、980×900、320×568，并实际查看桌面、手机、中间与窄屏截图；取消、失败重试、刷新、HTML 字面值和草稿保留均正常，无横向溢出、页面错误或静态资源失败。[交互与尺寸数据](2026-09-19-session-rename-evidence/checks.json) · [手机窗口](2026-09-19-session-rename-evidence/phone-dialog.png) · [失败重试](2026-09-19-session-rename-evidence/phone-failure.png) · [桌面窗口](2026-09-19-session-rename-evidence/desktop-dialog.png)。

已重启原 launchd 服务并验证新模块上线。此次重启前实际进程为 78670，重启后为 97903，页面版本为 `36e07a0a6454d38f1f38`；首页 200，实际提供的 `app.js` 和 `session-rename.js` 均与当前源码一致，未登录的列表及改名接口均返回 401。[部署验证](2026-09-19-session-rename-evidence/restart-check.json)。

## 10. 后续调整：首轮弱网修复

已修复弱网专项审计的四项 P1：模型请求不再阻塞会话列表；状态与历史各自渲染；SSE 临时网关错误保留任务并自动重连；初始认证网络失败后可在联网、回到前台或定时检查时合并恢复。新增普通 GET 的 12 秒截止时间、模型独立重试，并约束身份未确认时不能排空发送箱。迟到的模型默认值不覆盖用户编辑，历史与状态按新鲜度和活动任务证据协调，保留草稿、滚动位置与会话切换归属。

隔离故障注入中，慢状态下历史由原来的 4,335ms 等待降为 202ms 显示；模型请求挂起时列表 84ms 显示；SSE 502/503 分别约 841/1,152ms 自动恢复；离线刷新 44ms 恢复历史与草稿。数值用于验证机制，不代表物理蜂窝网络或线上 P95。完整结果见[弱网报告第 5 节](2026-09-19-weak-network-experience-report.md#5-已完成的修复与部署)。

468 项定向测试、91 项浏览器测试通过；179 项按视口/项目条件跳过、0 失败。typecheck、build、lint、差异格式检查和编译后服务启动检查通过；生产页面加载 16 个脚本，0 浏览器错误。独立验收 11 个场景，实际查看桌面、手机、中间宽度及窄屏截图，无页面横向溢出。[验证汇总](2026-09-19-weak-network-remediation-evidence/verification.json) · [浏览器证据](2026-09-19-weak-network-remediation-evidence/checks.json)。

现有 launchd 服务已重启：PID 97903 → 4266，页面版本 `aff5f81501d4d8edb820`。首页 200，实际 app.js、session-rename.js、network-recovery.js、session-loader.js 均匹配当前源码，未登录的列表和改名接口返回 401；原启动配置保持不变。[部署验证](2026-09-19-weak-network-remediation-evidence/restart-check.json)。

## 11. 二次深入审计：新增待整改项

按用户继续深入检查整体 UI、管理控制台，并重点检查 session 上下滚动与刷新的要求，新增[二次全项目深度审计报告](2026-09-19-second-deep-audit.md)。本轮只审计与记录，没有修改产品源码。报告中的新问题不属于第 10 节已关闭的四项弱网问题；后续应优先处理阅读位置、刷新反馈、管理表单对象混用、旁观竞态及最后管理员保护。
