# 刷新后再次内存增长：分配调查与渲染修复

日期：2026-10-13。本地修复起点 `aff02a8`；远端服务源码起点 `f768d70`，两者前端源码相同。延续 [上一轮记录](2026-10-12-browser-stability-repair.zh-CN.md)。

## 结论与证据边界

用户报告同一 renderer PID 62829 在 98 秒内从约 931 MB 增至 6,444 MB，页面随后无法及时响应诊断，当日已有四次崩溃。刷新只暂时释放内存。HTML 获取很快，旧文档卸载明显滞后；不能继续用网络慢或 Rocket Loader 解释全部现象。

本轮确认并修复了三类分配/展开缺陷，以及无变化 activity 事件触发渲染的问题。**尚未取得用户这次多 GB 增长期间的分配调用栈或堆保留链，不能宣称已证明该生产崩溃的具体根因。**

线上首页构建 `c0be47112002b1405bd4` 已有 Rocket Loader opt-out。实际交付的未压缩 `app.js` 与本地修复前源码一致（去除运行时构建 ID 后逐字节比较）；Linux 服务使用源码 `public`，并非 Mac 的生产 `dist/public`，不能仅凭两端构建 ID 不同推断部署过期。

## 真实页面采样

在独立诊断标签中，先启动 allocation sampling 和 CPU profiling，再访问站点、登录、读取真实会话。使用已有 Chrome 153.0.8010.54，不重启用户浏览器、不清除登录/草稿、不重载其他标签。

- 第一段约 10 分钟，包含登录、最新会话和活动详情，末尾 JS 堆约 33.27 MB。
- 第二段约 22 分钟，中文界面、活动详情和另一条较长会话，651 个样本，JS 堆约 33.33–38.21 MB，末尾约 33.49 MB。
- 采样持续落盘，包含后来被 major/minor GC 回收的分配；保留 CPU profile 和一份继续交互前的堆快照。这些分配总量不能直接解释为留存量。
- 使用 `blink.user_timing` trace marker 将诊断页映射至 renderer PID 85608。另一份 PID 17133 的进程采样未建立页面归属，排除出站点结论；也没有把扩展启动分配当作扩展泄漏证据。
- 采样的真实消息中没有发现触发下述占位符碰撞的字面标记。

上述普通操作和被动观察未复现 6 GB 增长。它们没有覆盖用户原有标签的全部内容、生命周期和扩展状态。宿主 macOS 内存压力为 2，未继续合成高负载或长时压力实验；不扩大堆上限。

诊断原始资料存于本机私有 `~/.codex-web/diagnostics/memory-20261013/`，可能包含会话内容、源 URL 或认证信息，不提交到仓库。

## 已确认缺陷与修改

| 路径 | 修复前证据 | 修改与边界 |
| --- | --- | --- |
| `batch.updated` 动态刷新 | 隐藏 work batch ID 不存在于可见消息投影，局部查找失败后回退到整段 `timeline.innerHTML`；20 次工具更新导致 20 次历史重建 | 独立记录消息是否变化。纯 batch 帧更新详情/状态，消息 DOM 保留；混合 assistant/batch 帧仍更新消息，未知消息 ID 的必要回退保留。修复后同一回归为 0 次历史替换 |
| `turn.activity` revision | 相同/更旧活动事件没有更新模型，却仍递增时间线版本并 render | 在版本未前进时立即返回；更新版本仍正常渲染 |
| 日期格式化 | 每次会话列表 render 对多条日期调用带 options 的 `Date.toLocaleString`，重复构造 ICU 格式化资源；不能只看 JS 堆 | 本地化 renderer 仅缓存两种语言×两种样式，最多四个 `Intl.DateTimeFormat`；活动详情复用一个默认 locale formatter，保持格式及非法日期行为 |
| 中文本地化保护标记 | 固定占位符出现在消息原文时，恢复过程可把内容递归代回；小样例约 368 字符变成 55,556 字符、1,031 个消息标签 | 扫描本次输入中已有的数字 namespace，选未占用的短 namespace；保留任意字面内容及嵌套保护，不截断。局部 Set 不跨渲染保留 |

日期路径的同一 Chrome 小量探针，每组 240 次并在测量间 GC：

| 方式 | renderer RSS 前→后（bytes） | 增量 | 调用耗时 |
| --- | ---: | ---: | ---: |
| 复用 `Intl.DateTimeFormat` | 245,776,384 → 246,464,512 | 688,128 | 约 0.7 ms |
| 原带 options 的 `Date.toLocaleString` | 246,464,512 → 254,984,192 | 8,519,680 | 约 5.1 ms |

此时 JS 堆读数基本不变，约 40.38 MB。独立 Node/ICU 小量探针也观察到同类差异。这证明该调用存在原生分配放大，**不证明线性增长、不等同永久泄漏，也不能外推为 98 秒内增长 5.4 GB 的原因**。

审查还拦截了首版无碰撞实现的次生问题：用不断追加下划线寻找 namespace，会让含 4,096 下划线的约 7 KB 输入生成约 330 KB 临时 token。最终使用一次扫描的短数字 namespace；80 块轻量回归验证输出不变、前缀短小及下一次渲染释放 namespace 状态。

## 回归与优化保留

主要影响 OPT-09/10/11/20：历史分页和可取回内容不变，保留阅读位置、消息 DOM、草稿与工具详情，减少临时分配而不裁剪权威历史。OPT-17 的语言/日期展示保持原语义；OPT-18 保持首屏预算。未改认证、上传、提交身份、SSE 协议、后端存储与其他 OPT 能力。

| 检查 | 结果 |
| --- | --- |
| public UI、localization、work dates、loader、SSE、frontend budget 组合 | 511 项通过；短 namespace 后另跑 localization/work dates/budget，11 项通过 |
| `npm run typecheck` | 通过，短 namespace 修改后重跑通过 |
| 浏览器桌面/手机竖屏：新增分配回归、work details、session polish | 24 项通过，4 项按用例定义跳过不适用视口；短 namespace 后分配回归 4 项重跑通过 |
| 构建及真实 built-public 冒烟 | 最终代码重跑通过；无浏览器错误 |
| 生产首屏 gzip | Mac 本地 142,362 / 143,360 bytes；Linux 发布主机 142,578 / 143,360 bytes，余量 782 bytes；未提高阈值 |
| 诊断工具 mock | 5 项通过 |
| 诊断工具真实附着冒烟 | 8 秒、初始/周期/最终 heap profiles 与 CPU profile 成功落盘，正常退出，原页面继续运行 |

浏览器回归检查真实消息节点身份、输入草稿、活动输出以及中文原文占位符，未改 CSS 或视觉布局。原代码可使 batch 和中文碰撞回归失败。测试截图/私有性能资料保持在忽略目录，未覆盖上一轮审计截图。

新增 [browser-allocation-profile.mjs](../../scripts/diagnostics/browser-allocation-profile.mjs) 使用 Node 24 与原生 CDP，支持指定现有 target，或先对空白页采样再导航。默认 2 秒指标、5 秒 profile、命令超时与初始加最近 20 份留存；256 MiB JS 堆边界和宿主压力保护。工具不测 renderer RSS、不自动映射 PID、不刷新/关闭页面、不强制 GC。详见 [使用说明和证据边界](../../scripts/diagnostics/README.md)。

后续 AI 修改遵循 [稳定性约束与可复制提示词](../architecture/browser-stability-guardrails.zh-CN.md)，根目录 `AGENTS.md` 已加入渲染分配和增长前采样规则。

## 发布验收

修复提交 `aa5bf3e3dd89389d6e3670a87d342958afda4861` 已推送至 `origin/main`，并在 Linux 主机上线，源码资源 buildId 为 **`575af73af8eff8ed59fb`**。该服务在进程启动时缓存静态资源，单独拉取文件不会更新线上交付。

远端 GitHub TLS 连接失败且有界重试超时。主代理通过站点现有认证上传通道传入 32,656 bytes 增量 Git bundle，核验 SHA-256、前置提交和目标 ref 后快进；未改远端 origin URL，保留原六项未跟踪内容。远端 typecheck、494 项专项测试（零跳过）、build、built-public 和 gateway `--check` 通过。网关契约所检查的源码仍匹配，无须重写验证记录。

独立 `codex-web-memory-cutover-aa5bf3e.service` 等待部署 turn 正式完成，检查无其他已加载活跃线程/active goal、网关队列与未决提交后进入短切换窗口，暂停适用入站并在退出时恢复。**2026-10-13 13:02:47（Asia/Shanghai）**调用既有 systemd restart；没有终止其他活跃 turn、升级 CLI 或覆盖用户历史。

首次切换脚本在 13:03:48 因首页 hash 校验失败退出，**原失败记录保留，未执行源码回退**。原因是脚本将动态站点标题/JSON bootstrap 注入后的 HTML 与静态模板比较。随后新增只读验收，严格复用服务端 `injectAppShellBootstrap` 的转义与注入行为构造完整预期 HTML，再逐字节比较，而非忽略任意差异。13:10:40.256 完成的 **27 项检查全部通过、退出码 0**；没有再次重启或暂停服务。

最终证据：

- systemd 主服务 `active/running`，实际 Node 24.16.0，暂冻的三个入站服务均已恢复；原六项 untracked 保留。
- 公网 buildId 匹配；三个修改过的 JS 与候选源码逐字节相同。完整首页注入校验通过，28 个脚本的 Rocket Loader opt-out 正确，未出现 Rocket Loader runtime。
- 未认证私有 API 和页面实际使用的 `/api/turns/<turnId>/events` 均返回 401；原有浏览器登录保持有效，认证 `/api/auth/me` 与 `/api/health` 返回 200。
- 管理诊断中 app-server 已连接、运行版本 0.159.0；旧会话历史可读，认证 SSE 返回 200，受控只读真实任务正式 completed，最终验收结果已显示在页面。
- 浏览器冒烟未捕获页面异常。仅诊断标签为加载新版而刷新；没有刷新其他标签或清除任何登录/草稿。

远端回退资料和原失败日志位于 `~/.codex-web/upgrade-backups/2026-10-13-browser-memory-125155/`；新增 `post-verification.json` / `post-verification.log` 保存成功的只读验收，与原 `status.json` 分开。主代理的公网字节/鉴权校验与分配采样仍保存在本机私有诊断目录。

### 上线后普通操作观察

在新版载入前已启动分配采样，随后查看部署会话、接续真实只读任务并打开活动详情。第一段完整 3 分钟有 88 份指标，JS 堆为 25,388,300–30,583,436 bytes，末尾 25,988,216 bytes。之后通过 trace 再次确认同一 renderer PID 85608；05:11:18–05:13:49 UTC 的 16 份 RSS 读数为 188,809,216–248,872,960 bytes，首/末为 238,075,904 / 242,368,512 bytes，没有出现用户报告的多 GB 增长。未强制 GC，系统内存压力会影响 RSS，这些数据不能当作保留堆斜率。

这仍是有限普通操作观察，内容和生命周期未复刻用户原来的崩溃现场；不是 30–60 分钟同条件长时验收，也不把未再现写成已找到生产泄漏函数。后续若复发，应使用已落地的工具在增长前留存 allocation stacks，并将原生分配与 JS 保留链分别核对。

## 上线后再次复发：故障现场仍未定位

用户随后再次反馈新版仍会突然内存猛增，并补充“卡住不输出了，然后内存占用就快速上涨”的时序。这描述的是输出停滞，尚不能记为用户主动停止或任务结束。用户明确 `aiops.hihihiai.com` 与 `aiops.orvibo.com` 是同一服务，本次故障指向该服务。**这轮追加调查尚未定位多 GB 增长根因；另已完成可独立复现的任务饥饿与活动合帧修复并在 Linux 上线，完整只读发布验收已通过，见文末。** 上文已发布修复的回归结果仍有效，但不能据此宣布用户报告的问题已解决。

### 已取得的证据与不能外推的范围

| 观察 | 结果与边界 |
| --- | --- |
| 新版独立诊断标签继续静置约 10 分钟 | JS 堆约 24.66–24.71 MiB，未复现突增；仅代表该诊断标签，不是用户故障标签，也未重现同一次停止输出的事件序列 |
| 最近三个会话的离线渲染检查 | 未复现增长；离线内容检查不覆盖真实 SSE 终态、后台校准、DOM 生命周期、扩展或原生分配 |
| 诊断标签的 renderer 归属 | 页面经 trace 映射为 PID 85608，并以 process-internals 的 renderer client ID 与 OS 进程交叉核验；其平稳读数不能替代另一个标签的测量 |
| 诊断 renderer 的 OS 内存摘要 | 一次 `vmmap -summary` 为 physical footprint 300.6 MiB、历史峰值约 1.0 GiB，resident 464.6 MiB、swapped 292.3 MiB；当前未见隐藏的数 GB 占用，但单点不能说明停止输出时的增长原因，也不能把峰值直接解释为泄漏 |
| 此前高内存 PID 17133 | 后续以 renderer client ID 和 process-internals 确认为无关的 Gemini renderer；其大内存和进程采样不能归因 aiops。此映射补齐了上文原先未确认的归属 |
| 用户实际故障标签 | 尚未取得可确认的加载版本、活 renderer 映射及增长期间的分配/CPU 栈。已有旧域名 CDP target 不响应，不能以 target 列表中的旧 URL 或相同标题推断仍有对应活 renderer |

宿主内存压力为 2。上述调查阶段保持只读、小开销取证，没有刷新、激活或关闭用户页面，没有重启浏览器或服务，也没有用额外压力实验尝试逼出故障。后续服务发布另见文末。CDP 所连接的浏览器实例不覆盖全部 Chrome 窗口，无法读取某个 target 也不等于用户实际使用的页面不存在。

### 同服务别名的实际资源核验

同一后端服务不意味着两个 origin 的浏览器缓存、Service Worker 和已打开文档状态相同。需要核验**用户故障标签实际加载并执行的资源**，不能只检查源站文件或 `/version.json`。

- `aiops.hihihiai.com` 的公开 HTML 引用 build `575af73af8eff8ed59fb`。按该 HTML 中实际带版本参数的 URL 获取 `app.js`、`ui-localization.js`、`network-recovery.js`，响应与新版相符；三者均观察到 Cloudflare cache HIT。使用实际返回的本地化脚本运行小样例，368 字符输入保持 368 字符，没有旧版占位符膨胀。
- `aiops.orvibo.com` 的 HTML、`/version.json` 和明确版本的本地化脚本请求均超时。没有取到响应，**不能据此说该别名仍在返回旧版，也不能确认它已经更新**。未刷新旧域名标签来消除这一证据缺口。
- hihihiai 的 HTML 响应为 `max-age=0, stale-while-revalidate=86400`；`/service-worker.js` 响应观察到 `max-age=14400`。这些只是服务器/CDN 响应头，浏览器 Service Worker 有独立更新规则；尚未取得故障标签的 controller、缓存命中和实际执行脚本证据，不能仅凭头部宣称缓存导致复发或延迟了四小时。
- 另发现 Mac 站点仍交付不同构建 `945c030345e5f3b93b33`，其本地化旧代码的小样例确有膨胀。用户已明确排除该站点作为本轮故障对象；这一独立发现不能替代 aiops 的根因调查。

公开响应正文、缓存头、资源哈希和去敏映射保存在上述私有诊断目录。未将私有会话标识、页面正文或认证信息写入此记录。

### 下一步所需的同一现场证据

围绕用户实际发生“输出停滞→内存突增”的标签，先核验别名、该文档实际脚本版本/内容、Service Worker 状态及 target→renderer client ID→OS PID 归属。以同一时间轴记录最后一次可见输出、后台是否仍在产出、客户端接收/处理与绘制、turn 终态、SSE 结束/reset、历史或状态校准和增长开始，并在增长前保留 allocation sampling 和 CPU profile。同步比较 JS 堆、DOM/监听器与该 PID 的 RSS、physical footprint、压缩/换出数据；无法获得的数据明确留空，不以另一标签补齐。

静置平稳、离线渲染未复现、当前源站已更新，均不能排除该现场故障。只有对应事件序列和栈/留存证据支持后，才能把候选函数提升为已证实根因。可独立复现的代码缺陷可以先修复，但须单独说明其证据与覆盖范围。

## 追加修复：流回放让出任务与活动合帧

源码按服务端静态资产算法计算的 buildId 为 `3bf9afca89fd7d7391eb`，已在 Linux 运行，发布验收边界见下文。当 SSE 的许多帧或后续 chunk 已经就绪时，`await onFrame()`、`await reader.read()` 可能只延续微任务链，不保证定时任务、输入处理或绘制获得机会。另一个小型重放保留 32 条短消息，连续送入 240 个 revision 前进的 `turn.activity`，旧实现触发 240 次完整 `render()`，即使消息本身没有变化。

同一 Chrome 中向实际 consumer 提供 240 个小 SSE 帧，并在开始时排入零延迟 timer，结果如下：

| 指标 | 修复前 | 加入真实任务让出后 |
| --- | ---: | ---: |
| 最终完整串行处理帧数 | 240 | 240 |
| consumer 结束前 timer 是否已运行 | 否 | 是 |
| timer 运行时已处理帧数 | 240 | 1 |
| consumer 耗时 | 28.2 ms | 94.4 ms |
| timer 运行时点（相对开始） | 30.3 ms | 14.1 ms |
| reader lock 最终释放 | 是 | 是 |

测量时宿主内存压力为 2，耗时不作为可比的吞吐提升结论；任务让出本来就可能增加总完成时间。后测发生在最终 snapshot 终态守卫补齐前，之后 consumer 调度路径未再改变。该小样例证明的是**输入/定时等任务能够与完整、串行的帧处理交错**。它不证明任务饥饿阻止了所有 GC，也不证明这就是用户多 GB 增长的根因。

- `network-recovery.js` 的共享工作预算在累计达到 32 个工作单位或经过约 8 ms 时，通过零延迟 timer 让出真实任务。检查点覆盖帧处理和 16 KiB 解码片段，避免以大量已就绪小 chunk 绕过预算。8 ms 是工作单位结束后的检查阈值，不是对单次 JSON 解析或事件处理耗时的硬上限。
- 保留逐帧 `await` 和串行背压，不增加并行 dispatch，不丢弃或截断正常累计输出。原有单帧边界、UTF-8/CRLF 分片和 reader 退出释放不变；abort 可唤醒等待中的让出点，清理 timer 与 listener 后停止后续读取。
- reset snapshot 的逐事件重放也采用协作调度。身份/导航归属、turn 和 controller 在每次事件前后检查，调用方在 `await` 返回后再次检查，防止最后一次 visitor 排入的微任务先切换会话，再由旧调用写入游标或缓存。
- 本次 replay 的 `turn.completed` / `turn.failed` 若确实同步触发当前 controller 停止，可凭局部终态标记完成必要收尾。外部 metadata 校准只是把同一 turn 标为终态并 abort，不构成本次 replay 的继续授权；不能仅凭全局 terminal Set 和空 controller 放行。
- chat/桌面工作区的有效 `turn.activity` 立即更新状态，合入已有动态 UI 帧；不因 activity 重建消息历史。composer、运行反馈和已打开活动详情仍更新，同帧 assistant 更新仍保留。旧/相同 revision 继续忽略；非 chat 界面和 `user_input.updated` 的必要即时渲染不变。

独立审查以真实函数做小型 VM 复现，先证实再封堵两项新异步边界问题：最后 visitor 的微任务导航/controller 替换，以及让出期间的外部终态校准。最终四案结果为：前两类各返回 false、无游标/收尾写入；外部校准停在第 32 个事件、返回 false；本 replay 自身终态完整处理 40 个事件并正常写入游标、重排和保存。没有以丢弃真实历史或取消合法终态收尾来通过测试。

受影响基线为 OPT-01/02（取消、断点与快照收尾）、OPT-07（让出期间的前后台/恢复交错）、OPT-10/11（阅读与局部 UI）、OPT-12（快照后的缓存写入保留原合并入口）、OPT-13/21（跨 await 归属与身份检查）、OPT-20（有界资源与串行背压）；OPT-09 的完整历史/分页访问不变，OPT-18 的首屏预算检查保留。未改提交回执、草稿持久化、附件上传或后端访问控制，未提高输出和资源限制。

| 检查 | 本轮状态 |
| --- | --- |
| UI/SSE/预算等完整专项组合与恢复专项 | 最终终态守卫补齐前分别 502 项、28 项通过；不冒充最终全套重跑 |
| 最终终态守卫后的相关聚焦回归 | 28 项通过，覆盖快照归属/终态来源及相关终态行为，另有上述四案独立函数复核；任务交错、串行完整输出与 abort 唤醒由前轮 SSE 专项覆盖，之后 consumer 未再变化 |
| 最终 `npm run typecheck` 与 frontend budget | 通过；未调高预算阈值 |
| `npm run build` 与 `test:built-public` | 通过：46 个资产、32 个脚本；浏览器错误列表为空 |
| 本次业务修复发布与用户故障现场复测 | Linux 已运行新构建，独立只读发布验收 27 项通过；用户故障现场尚未复测，见下文 |

本轮回归支持任务调度、取消和 UI 更新语义；用户多 GB 增长仍需前述同一现场的栈和内存证据，不宣称已根治。

### 追加修复发布：切换初验失败，独立只读验收通过

提交 `54b3af7bd4b91db6ea5118f0955d1bf3a40e7874` 已推送并在 Linux 上运行，源码 buildId 为 `3bf9afca89fd7d7391eb`。远端 531 项专项测试零失败、零跳过，typecheck、build、built-public 与 gateway 检查通过；Linux 首屏 gzip 为 143,073 / 143,360 bytes，源码 app 为 499,783 bytes，未提高阈值。

**2026-10-13 14:58:47（Asia/Shanghai）**执行服务重启。14:59:49，独立 unit `codex-web-fairness-cutover-54b3af7.service` 在前五项通过后，第六项 `unique_owned_service_tree` 读到 native app-server 数量为 0，退出码 1。**未回退，原失败记录保留，不将这次自动验收记为成功。** 随后已确认唯一预期 app-server、主服务及三个入站服务 active/已解除暂冻、Node 24、gateway 检查通过；认证诊断显示 app-server 已连接、版本 0.159.0。

后续独立只读核验已确认：公网三个相关 JS 与发布源码逐字节匹配，28 个脚本保留 Rocket Loader opt-out；四个未登录私有 API（包含实际使用的 `/api/turns/<turnId>/events`）返回 401。**2026-10-13 15:07:55.336（Asia/Shanghai）**完成的 post-verification 27 项全部通过，实际退出码 0，覆盖动态首页、候选资产、唯一服务树、Node 24、鉴权、gateway、入站服务和 HEAD/untracked 保留。native app-server 仍严格要求数量为 1，未放宽为接受 0；原失败记录与 failed unit 保留，没有再次重启。新备份及原失败日志位于 `~/.codex-web/upgrade-backups/2026-10-13-browser-fairness-145132/`，`post-verification.json` / `post-verification.log` 独立保存本次成功结果。

实际载入新版的诊断标签已捕获本轮受控任务的 `/api/turns/<turnId>/events` 返回 200、`text/event-stream`，任务状态 completed；这验证了发布后的真实 SSE 路径，不替代用户内存故障现场复测。

15:09:39 的实际文档脚本版本为 `3bf9afca89fd7d7391eb`，DOM 显示本次最终验收的唯一时间 `15:07:55.336` 及“27 项通过”，页面异常数为 0。15:07:03–15:09:33 对既有新版诊断标签采样 150 秒、74 份指标：JS 堆首值 26,831,128、最低 26,766,940、最高 32,010,036、末值 27,277,352 bytes；DOM 节点 4,608→5,214，监听器 389→394。期间会话增加真实输出，未强制 GC。15:09:40 再以 trace 确认为同一 PID 85608，RSS 为 185,499,648 bytes、JS 堆为 27,315,044 bytes；所有采样已正常结束。此为短期普通流式操作观察，不是长期稳定性或多 GB 增长根因证据。

仅对自己的健康诊断标签正常刷新，未绕过缓存：第一次仍加载 `c0be47112002b1405bd4` 旧 shell，脚本来自 Service Worker；随后后台激活新 SW，观察到只保留新构建缓存；第二次正常刷新才加载 `3bf9afca89fd7d7391eb`，登录与历史均保留。未刷新用户页面、未清除任何缓存或草稿。这支持逐文档核验实际执行版本，**不能外推用户故障标签也用了旧版，不能据此认定内存根因**。`aiops.orvibo.com` 从本机仍报 `UND_ERR_CONNECT_TIMEOUT`，该别名验收仍有缺口。
