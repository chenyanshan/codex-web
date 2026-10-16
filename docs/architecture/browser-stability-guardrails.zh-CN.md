# 浏览器稳定性约束与 AI 修改提示词

适用范围：会话加载、手动刷新、前后台恢复、网络重试、SSE、渲染与本地化、前端缓存与资源生命周期、启动脚本和 Service Worker。

根目录 [AGENTS.md](../../AGENTS.md) 放必须执行的规则；本文解释原因、实现入口和验证方式。[2026-10-12 修复记录](../audits/2026-10-12-browser-stability-repair.zh-CN.md) 保存当时的证据、修复和验证结果。修改仍须同时满足 [OPT-01 至 OPT-21 保留基线](2026-09-25-existing-optimizations-baseline.zh-CN.md)。

[2026-10-13 分配调查](../audits/2026-10-13-browser-allocation-repair.zh-CN.md) 记录刷新后再次快速增长，以及随后确认的 DOM 重建、原生日期格式化分配和文本展开缺陷。此前“好像不卡了”不能作为问题已消失的依据。

[2026-10-16 本地化分配修复](../audits/2026-10-16-localization-allocation-repair.zh-CN.md) 记录主浏览器再次崩溃后确认的整段 HTML 重复切片缺陷。累计切片字符量下降不等于实际峰值内存或线上泄漏下降相同比例；生产崩溃根因仍未闭环。

## 这次问题应留下什么经验

交接记录中有约 9 GB 和 8.7 GB 的 renderer 进程随后崩溃，也有 3.87 秒内同会话发起 178 个读取请求的观测。没有增长前后的生产堆快照，不能把这些数字直接写成“已经证明某个对象泄漏”或“V8 OOM”。

源码和回归中确认了三个可修复缺陷：不同入口的局部请求锁无法阻止共同底层读取重复；SSE 缓冲没有单帧上限，分帧和退出释放不完整；Rocket Loader 失败会一起阻塞应用入口和启动恢复脚本。修复后，受控 89 次重叠加载从 178 个请求降为 2 个。部署后用户反馈“好像不卡了”，这是响应改善的反馈，不能代替长期稳定性验收。

本次还发现两个容易在“优化”时引入的问题：共享结果中的事件可能被不同调用者原地修改；新增保护代码可能使首屏资源超预算。对应措施是隔离可变事件字段、保留大文本共享，以及把管理页专用样式移入已有的按需加载资源。

## 修改前先回答五件事

1. **触发链：** 用户操作、focus/visibility/online、SSE reset/终态和响应回调分别会调用哪里；多个入口同时到达时由哪一层合并。
2. **归属：** 请求、reader、监听器、定时器、DOM、Blob URL、共享结果属于哪个身份、会话和导航代次；切换后谁使它失效。
3. **容量：** 峰值并发、条目数量、单条大小和总保留量分别受什么约束；正常长输出和长历史如何继续访问。
4. **失败：** 部分成功、超时、取消、断流和鉴权失效后，哪些引用会释放、何时允许重试、旧内容是否仍可见。
5. **证据：** 哪个测试能在修复前失败、修复后通过；哪些真实设备或长时场景尚未验证。

这些信息可以直接写进实施说明，无须为已授权的常规修改另设确认步骤。

## 实现约束与禁止退化的行为

| 领域 | 应采用的方式 | 要防止的退化 |
| --- | --- | --- |
| 会话读取 | 优先复用 `CodexWebSessionLoader.createLoader`；按身份/导航代次、会话、路径和读取语义共享；单个订阅者退出不取消其他订阅者，最后一个退出时终止底层读取 | 仅在按钮、focus 或恢复入口各自加锁；用全局锁串行所有会话；合并不同分页/锚点；迟到数据串账号或会话 |
| 恢复 | 共享进行中操作；失败与部分失败退避；旧身份的等待链不能转而刷新新身份；手动重试可立即生效 | 在 render、progress、响应或终态处理中无条件再读；将连接失败当作任务失败；用心跳不断重置异常重试间隔 |
| SSE | 使用 `CodexWebNetworkRecovery.consumeSse`；按单帧限额逐段解码，支持跨 chunk UTF-8、LF/CRLF；成功、失效、取消、抛错均释放 reader/监听器/控制器 | `buffer += chunk` 无上限；只在正常 EOF 清理；等待永不完成的底层 cancel 后才释放锁；把整个回答累计长度当作单帧上限 |
| 回放调度与异步收尾 | 密集 SSE/快照重放按工作量和耗时让出真实浏览器任务，保留串行背压及全部正常输出；事件前后与调用方 await 返回后复核归属；本次 replay 自身终态可收尾 | 把 resolved Promise 或微任务当作绘制/输入让出；每个小 chunk 重置预算；外部终态校准/取消后旧快照仍写游标；用丢帧、截断或并行处理回避阻塞 |
| 共享结果 | 共享读取和大文本，复制会被修改的字段；事件可变标记不得污染其他调用者 | 为了共享直接复用可变对象；反过来在每个 delta 深复制全量历史/快照 |
| 内存与缓存 | 为新增集合明确容量与释放节点，检查数量及字节；复用已有缓存、分页与 Blob 清理 | 只限制条数却放任单条无限大；从一个 map 挪到另一个 map 却仍保留引用；任意截断权威历史、最终回复或终态去重状态 |
| 临时字符串与遍历 | 按原文区间收集片段，最后一次 join；有序保护区间用递增结束边界排除嵌套；用累计处理字符量检查长内容 | 每条消息都 slice/拼接/replace/序列化完整文档；每个区间扫描全部其他区间；只限制缓存条数，忽略每次渲染的临时工作量 |
| 增量渲染 | 区分可见消息与隐藏 work batch 的变化；有效 activity 立即更新模型并合并动态 UI；同帧仍包含 assistant 更新；相同/过期 revision 不触发 DOM 工作 | batch ID 不在可见时间线时整段重建历史；每个 activity 重建消息；合帧漏掉 composer/详情反馈或必要的用户问题渲染 |
| 日期与本地化 | 固定语言/样式复用有界 `Intl.DateTimeFormat`；保护标记采用输入中不存在的短 namespace，保留任意字面内容 | 每次 render 对所有会话调用带 options 的 `Date.toLocale*`；固定占位符递归展开用户内容；以不断增长的前缀回避碰撞，造成临时字符串放大 |
| 内容和阅读 | 恢复期间保留已显示内容、草稿和阅读锚点；用户新滚动优先 | 刷新/切前台先清空页面；用定时整页刷新掩盖卡顿；为回收内存清掉登录或草稿 |
| 启动 | 所有有序脚本的 `data-cfasync="false"` 放在 `src` 前；包含 boot recovery、依赖、module 入口以及服务端注入变体 | 只排除 app.js，仍让其依赖或超时提示受 Rocket Loader 控制；更改 HTML 属性后漏改服务端注入匹配 |
| PWA/体积 | 保持版本指纹、完整资源原子更新与旧完整缓存回退；可选功能按需加载；gzip ≤143,360 bytes | 清除所有缓存或用户存储来强推更新；新资源未完整就替换旧壳；调高测试阈值代替优化 |
| 复发现场与版本 | 核验用户故障标签实际加载的 HTML/版本化脚本与 Service Worker 状态，并建立 target→renderer client ID→OS PID 映射；同服务别名仍分别检查 origin 缓存 | 仅凭源站文件、`/version.json`、标签标题或独立诊断标签的数据认定现场已更新、稳定或属于某个大进程 |

当前 SSE 单帧上限是 8 Mi 个 UTF-16 code units，解码片段为 16 KiB；它是内存保护边界，不是对回答总长度的限制。调整时须对照服务端合法事件/快照预算并补测试，不能只为通过用例调高上限。已知活动会话的部分集合会随业务内容增长，应先通过留存路径判断原因；若要限制历史窗口，须保留分页可取回和阅读语义。

当前协作调度在约 8 ms 或 32 个工作单位后经 timer 让出真实任务，预算跨帧和解码片段延续。工作单位仍须完整处理，此阈值不是单次解析的硬时限。取消等待时释放 timer/listener，不能为保持响应而裁剪输出。快照结束不能只检查全局 terminal Set：只有本次 replay 自身处理终态并停止当前 transport，才可在该 stop 后继续必要收尾；外部取消、校准、换身份、导航或 controller 替换必须使旧工作失效。即使 helper 最后检查通过，caller 的 `await` 返回处仍有微任务交错，须再检查后才能写游标/缓存。

## 按影响选择回归

| 改动范围 | 最低相关验证入口 |
| --- | --- |
| 加载合并、取消、身份、分步通知 | [session_loader.test.ts](../../packages/codex-web/test/session_loader.test.ts)、[network_recovery.test.ts](../../packages/codex-web/test/network_recovery.test.ts)、[浏览器读取合并](../../packages/codex-web/test/browser/session-request-coalescing.spec.js) |
| SSE 分帧、取消、释放、重试与回放让出 | [sse_consumer.test.ts](../../packages/codex-web/test/sse_consumer.test.ts)、[网络恢复](../../packages/codex-web/test/network_recovery.test.ts)、[界面单测](../../packages/codex-web/test/public_ui.test.ts)、[弱网浏览器回归](../../packages/codex-web/test/browser/weak-network.spec.js)、[输出恢复](../../packages/codex-web/test/browser/session-output-recovery.spec.js)；涵盖单 chunk/连续就绪 chunks 的真实 task 交错、完整串行输出、让出期间 abort、最后 visitor 微任务切换，以及本次/外部终态来源 |
| 缓存、刷新、前后台与阅读 | [缓存稳定性](../../packages/codex-web/test/browser/session-cache-stability.spec.js)、[阅读位置](../../packages/codex-web/test/browser/session-reading.spec.js)、[界面单测](../../packages/codex-web/test/public_ui.test.ts) |
| 渲染分配、日期与本地化 | [本地化回归](../../packages/codex-web/test/ui_localization.test.ts)、[活动日期](../../packages/codex-web/test/work_details_dates.test.ts)、[界面单测](../../packages/codex-web/test/public_ui.test.ts)、[浏览器分配回归](../../packages/codex-web/test/browser/browser-allocation-regression.spec.js)；检查 DOM 身份/草稿、混合增量、任意字面占位符、嵌套保护顺序、格式化器构造次数及长文累计切片量；不得用易波动的耗时断言代替工作量上界 |
| 启动、构建、PWA、资源拆分 | [Rocket Loader 回归](../../packages/codex-web/test/browser/rocket-loader.spec.js)、[构建](../../packages/codex-web/test/build_public.test.ts)、[Service Worker](../../packages/codex-web/test/service_worker_cache.test.ts)、[首屏预算](../../packages/codex-web/test/frontend_budget.test.ts)；资源迁移还需相应页面浏览器回归 |

新增行为应有能抓住失败路径的回归，不必为纯文档改动重复整套应用测试。TypeScript/受检查前端代码变更仍须 `npm run typecheck`；生产资源变更检查构建与 `test:built-public`。不得删除或削弱已有断言来完成重构。

若声称“长期内存稳定”，用 [采样工具](../../scripts/diagnostics/README.md) 在同构建模式、浏览器版本、会话规模和操作条件下进行至少 30–60 分钟对照。分别记录输出中与完成/切换/GC 后的 JS 堆、DOM、监听器、进程内存、请求并发和 SSE；结合堆快照留存路径判断。区分 JS 堆、单 renderer MEM 与浏览器进程树 RSS。宿主内存压力警告时停止压测并写明未验证范围；短测、fixture 和用户感受不可替代生产根因证据。

对于“刷新暂时恢复，随后快速增长”，在增长前启动 `browser-allocation-profile.mjs`，按间隔保存 allocation sampling 与 CPU profile，保留刷新前现场。采样包含已被 GC 回收的分配，不能把累计分配量当作泄漏量。JS 堆平稳时仍须检查经验证 PID 的 renderer RSS 与原生分配；不要只盯 JS 对象，也不要把未映射到页面的进程采样归因于该站点。网络请求快、HTML 快，并不排除旧文档卸载或渲染阶段的主线程阻塞。

对于“卡住不输出，然后内存突增”，必须围绕同一故障标签建立时间轴：最后一次可见输出、后台是否仍在产出事件、客户端接收/处理与绘制、turn 终态、SSE 关闭/reset、历史/状态校准、增长开始。不能把界面停止更新误记为用户点击停止或任务自然结束。将这些事件与增长前后的 allocation/CPU 栈、JS 堆、DOM/监听器及已映射 PID 的原生内存对应；在系统压力下还应区分 RSS、physical footprint 与压缩/换出读数，不能用较低 RSS 证明没有大占用。采样、GC 和快照会改变现场，记录其时点，不自动用刷新或快照打断故障。

2026-10-13 用户确认两个 aiops 域名是同一服务。别名仍可能拥有不同的 Service Worker、浏览器缓存或旧文档；公开资源已更新不代表用户已打开标签执行的是新版。独立诊断页十分钟静置平稳、最近会话离线渲染未复现，都只能作为有限的对照。实际标签不可响应或某别名 HTTP 超时时，应明确记录版本、PID或栈证据缺失；不能据此认定旧缓存，也不能用另一站点/另一浏览器实例的结果填补缺口。

用户指定“主浏览器”时，先核对浏览器实例、既有标签和调试连接；工具默认启动的独立浏览器不能代替故障现场。转储可用于核对时间、进程和 origin，但读取异常地址、分配大小、虚拟映射、RSS 和 physical footprint 时必须区分字段含义。异常指令地址不是申请的字节数，虚拟映射也不是实际占用。没有符号化调用链、增长期采样或保留链时，应明确证据缺口，不据此宣布 OOM 类型、泄漏对象或根因。采样结束应停止 profiler 并断开自己的连接。

## 可直接复制给 AI 的提示词

```text
你正在修改 Codex Web。请先阅读根目录 AGENTS.md、
docs/architecture/2026-09-25-existing-optimizations-baseline.zh-CN.md 和
docs/architecture/browser-stability-guardrails.zh-CN.md。

先给出本次改动的触发链、身份/会话归属、容量与释放边界、失败重试行为、回归验证。
在已经授权的范围内直接实施，不为常规实现选择反复要求确认。

必须保持以下约束：
1. 多个入口的同语义会话读取在共享底层合并；锚点、分页、账号隔离、独立取消不退化。
2. 自动恢复有并发边界和失败/部分失败退避，不能形成响应—渲染—再次读取的循环。
3. SSE 有单帧边界，支持分片 UTF-8/CRLF，所有退出路径释放资源，正常累计输出不截断。
4. 共享响应不能串改可变事件；不得每个 delta 深复制完整历史。新增集合明确容量和释放时机。
5. 保留已有内容、草稿、阅读位置、回执身份和缓存权限；不得靠定时整页刷新或清用户数据修复卡顿。
6. 所有有序启动脚本保留 Rocket Loader opt-out；PWA 保持完整缓存原子更新。
7. 首屏 gzip 不超过 143,360 bytes。优化资源加载，不调高预算、不弱化断言。
8. 隐藏 work batch 变化不替换可见消息历史；同帧 assistant 更新不能漏掉；旧/相同 activity revision 不重渲染。
9. 高频日期格式化复用固定有界 Intl.DateTimeFormat；本地化保护标记与任意用户文本无碰撞，避免递归展开及长前缀放大。
10. 复发时核验用户故障标签实际加载的版本化脚本与Service Worker状态；同服务别名分别核验缓存。
    源站/version.json或独立诊断标签更新，不等于用户现场已更新或故障已消失。
11. 卡住不输出后突增须保留同一现场事件序列和allocation/CPU栈，核验target到OS PID映射，
    同步区分JS堆、DOM及原生内存、physical footprint、压缩/换出；不凭标题或大RSS认定归属。
12. 密集SSE/快照回放按耗时/工作量让出真实task；resolved Promise/微任务不算输入或绘制让出。
    预算跨帧/chunk延续，保持串行背压、取消清理和全部正常输出，不丢帧、不截断、不并行dispatch。
13. 新增await必须在事件前后及caller返回处复核身份/导航/turn/controller归属再写游标或缓存。
    仅本次replay自身终态停止transport可授权收尾，外部终态校准或取消不能冒充这一授权。
14. 每条消息处理不得重复复制或序列化完整HTML/历史；保护区间按原文收集片段、一次join，
    排序后用边界去嵌套。保留长文本累计切片上界和内容一致性回归，不能靠截断消息通过。
15. 主浏览器故障必须核验实际实例和标签。异常地址不是分配大小，虚拟映射不是实际内存；
    分配热点、短期静置平稳或累计切片减少，都不能单独证明生产崩溃根因或长期稳定。

为实际失败路径加入回归，按影响运行 focused tests、浏览器检查、typecheck 和构建验证。
交付时列出受影响的 OPT 编号、测试证据和未验证范围。性能结论必须有同条件测量，
不能将短测通过或用户感觉变快写成已证明生产泄漏根因。宿主内存压力异常时停止压测。
若刷新后再次快速增长，先在增长前启动并持续落盘 allocation sampling/CPU profile，
保留刷新前现场；区分累计分配、GC后留存、JS堆与经PID映射验证的renderer原生内存。
未取得对应证据时，不把新的加载/重试优化或某个候选函数称为已证明的生产根因。
真实任务饥饿可独立修复，但不等于阻止所有GC，也不证明用户多GB增长的原因。
静置平稳或离线内容未复现不能代替用户现场；页面不可响应/别名请求超时须写明证据缺口。
涉及发布时，沿用会话中的部署授权和仓库发布流程；核验上线构建与鉴权，不擅改外部代理配置。
```
