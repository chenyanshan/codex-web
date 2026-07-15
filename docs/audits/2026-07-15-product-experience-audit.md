# Codex Web 产品体验深度审计

> 审计日期：2026-07-15  
> 审计对象：`codex-mobile-web-app` 当前工作区与运行实例  
> 目标用户：用手机远程控制本机 Codex 的个人用户，以及完全互信的小团队  
> 结论置信度：高。依据包括当前实现、测试、设计文档、桌面/手机截图和真实运行事故。

## 一页结论

Codex Web 已经具备一个可用远程控制台的主要能力：登录恢复、项目和 session 导航、实时输出、工作批次、审批、停止、消息排队、附件、报告、分享和管理后台都已形成闭环。

现在的主要问题不是“功能不够”，而是产品重心开始从“随时判断 Codex 正在做什么，并及时干预”偏向“管理项目、session、报告和用户这些对象”。对于手机远程控制场景，默认首页应首先回答四个问题：

1. 哪些 session 正在运行？
2. 哪些 session 正等我处理？
3. 哪些 session 失败或疑似卡住？
4. 我上次做到哪里，下一步该进入哪个 session？

当前 session 列表主要展示项目名、消息摘要、时间、收藏和归档，无法直接回答前三个问题。真实使用截图已经出现 99 个 session、单项目 39 至 46 个 session 的规模；此时仅靠“收藏/最近”不再足够。

最重要的产品方向是：**从 project-first workspace，演进为 project-aware、attention-first console。** 项目仍是边界，但默认排序和状态展示应围绕操作者注意力组织。

## 本次状态事故：已修复

本轮发现了两个互相关联、但语义不同的问题。

### 1. 新 goal 被直接显示 Done

根因不是模型主动完成了新目标，而是 Web runtime 更新 objective 时发送了：

```text
objective: 新目标
status: null
```

app-server 会保留旧 goal 的 `complete`，因此新 objective 继承旧状态并立即显示 Done。

修复后，设置或替换 objective 会显式发送 `status: active`。同一现场请求已从返回 `complete` 变为返回 `active`。

### 2. session 仍在运行，消息区却显示 Done

根因是 Web runtime 过去主要依赖当前 Node 进程内的 `activeTurns`。runtime reload、服务重启或长 turn 超时后，app-server 仍可能返回 `inProgress`，但 Web 进程已经丢失内存标记，前端于是把 session 解释为 Done。

修复后，runtime 会从 `thread/read(includeTurns=true)` 的真实 turn 状态恢复 `activeTurnId`，同时恢复 turn 与 thread 的映射。它也会阻止在 provider 已报告活跃 turn 时错误启动重叠 turn。

验证结果：

- Runtime 聚焦测试：52/52 通过
- Codex Web 全量测试：546/546 通过
- TypeScript typecheck：通过
- ESLint：通过
- 服务完成 detached restart，`http://127.0.0.1:43210/` 恢复 `200 OK`

这次修复解决了错误状态来源，但也暴露出更深的产品问题：goal、turn、stream 和 session 目前是四套状态，用户看到的却经常只是一个短词。

## 核心用户任务

### 手机操作者

高频任务不是配置系统，而是：

- 快速找到正在工作的 session
- 判断它在正常运行、等待审批、失败，还是已经卡住
- 查看当前命令和文件修改
- 接受或拒绝审批
- 停止错误方向
- 留下下一条消息，继续别的 session
- 网络切换或锁屏后恢复现场

### 桌面操作者

除上述任务外，还需要跨项目扫描、同时查看 session 列表和对话、创建 session、阅读长报告、调整模型和权限。

### 部署者或管理员

低频但高风险任务包括：用户和角色管理、项目授权、session 审计、分享治理、runtime reload、设备登录态和存储健康。

产品目前对桌面和管理员能力投入较完整，但手机操作者的“注意力分流”能力明显落后于 session 数量增长。

## 体验旅程评分

评分范围 1 至 10，分数代表当前完成度，不代表工程质量。

| 旅程 | 分数 | 判断 |
| --- | ---: | --- |
| 登录与返回应用 | 8 | token 恢复、缓存和 PWA 基础完整 |
| 创建 session | 7 | 路径/项目选择可用，但单用户路径输入偏技术化 |
| 找到目标 session | 4 | 无搜索、无状态过滤、同项目大量卡片难区分 |
| 判断是否正在运行 | 6 | chat 内清楚，列表内不足；本轮修复状态源 |
| 查看正在执行什么 | 7 | work card 已恢复，但缺持续进度与最后活动时间 |
| 审批、停止、继续输入 | 8 | Stop、审批卡、排队消息闭环较好 |
| 网络或服务异常恢复 | 6 | 有重连和恢复逻辑，用户可见解释仍弱 |
| 报告阅读与返回 | 7 | 查看器和返回路径完整，来源上下文不足 |
| 设置与管理 | 6 | 功能完整，但普通设置、运行治理、管理员配置混杂 |

## 优先级发现

## P0：把 session 列表改成注意力入口

### 现状

普通 session 卡只显示项目名、消息摘要、时间、收藏和归档。它不显示：

- Running
- Needs approval
- Failed
- Paused / stream disconnected
- 最后活动时间
- 当前 work 摘要

在示例桌面截图中已经有 99 个 session，两个主项目分别有 46 和 39 个 session。列表没有搜索入口，收藏与最近只能解决“我记得它在哪”，不能解决“现在什么需要我”。

### 用户影响

这是手机远程控制最核心的查找成本。状态越重要，用户越需要逐个点开确认，正好违背远程控制台应降低检查成本的目标。

### 建议

首页顶部新增一个紧凑的 Activity 区域，按以下顺序展示：

1. Needs approval
2. Running
3. Failed
4. Possibly stalled
5. Recently completed

普通 session 列表增加状态圆点或短标签、最后活动时间，并支持状态筛选。项目筛选仍保留，但不应隐藏跨项目的紧急状态。

### 验收标准

- 用户在打开首页后一次点击内进入任意待审批 session
- Running、Needs approval、Failed 在 session 列表可见，不必进入 chat
- 跨项目运行状态不被当前项目筛选完全隐藏
- 100 个 session 时，用户可在 10 秒内找到唯一一个待审批 session

## P0：建立统一、可解释的状态模型

### 现状

界面同时存在：

- Goal active / paused / done / blocked
- Turn running / completed / failed / stopped
- Stream paused / failed
- Session active / archived

chat 顶部显示 goal，输入框上方显示 Running 或 Done，work card 又显示 RUNNING。状态来源和对象不同，但视觉层级相似。裸露的 `Done` 特别容易被理解为“整个目标完成了”。

### 建议

在产品文案和数据模型中固定四个对象：

```text
Goal     长期目标：Active / Paused / Blocked / Complete
Turn     当前执行：Running / Waiting approval / Failed / Stopped / Finished
Stream   连接健康：Live / Reconnecting / Offline
Session  容器状态：Active / Archived
```

默认界面只突出最需要行动的状态；其余状态作为二级信息。不要再用没有对象的 `Done`，改为 `Turn finished` 或中文“本轮已完成”。

### 验收标准

- Goal Complete 不能让仍在运行的 turn 显示完成
- Turn Finished 不能暗示长期 goal 已完成
- Stream 中断时仍保留真实 Turn 状态，并明确显示“正在重连”
- 所有状态都能追溯到唯一后端来源，不依赖仅存在于浏览器或 Node 进程的推断

## P1：让长时间运行变得可判断

### 现状

chat 内能看到 Stop、Running 和 work card，但用户仍不知道：

- 已运行多久
- 最后一次事件是什么时候
- 当前命令是否仍有输出
- 是模型在思考、工具在执行、等待审批，还是连接断开
- 什么时候应该刷新、停止或继续等待

当前前端有 stream stale、后台恢复和 refresh 逻辑，但这些能力多数没有转化为清晰的用户解释。

### 建议

把重复的 Running 收敛成一条 sticky runtime strip：

```text
Running 12m · last activity 18s ago · Editing 3 files
```

超过阈值没有活动时显示“可能卡住”，并提供“重新连接”和“停止”两个明确动作。等待审批必须高于普通运行状态。

### 验收标准

- 运行中页面始终可见 elapsed time 与 last activity
- 锁屏、切换网络后，状态明确经过 Reconnecting 再恢复为 Running 或终态
- 无活动阈值基于事件时间，不把正常长推理直接判为失败
- work card 摘要能说明最近一次命令、文件修改或审批

## P1：解决 session 身份和查找问题

### 现状

同一项目的卡片标题重复显示项目名，主要依赖首条或最近一条用户消息区分。没有 session 搜索，也没有可编辑的 session 名称。session 数量增长后，摘要会变成弱标识。

### 建议

- 自动用首条任务生成短标题，并允许用户编辑
- 项目名降为二级信息
- 增加本地即时搜索，搜索标题、消息摘要和项目
- 最近访问、最近运行和最近完成分开，不只按最后输入时间排序
- 收藏动作改为星标图标，归档进入溢出菜单，降低卡片高度

### 验收标准

- 同项目 50 个 session 时，标题不再全部相同
- 搜索输入后 100 毫秒内过滤本地缓存结果
- 归档不占据每张卡片的永久主操作位
- 运行中和待审批 session 始终排在普通最近项之前，除非用户显式切换排序

## P1：重新平衡移动端顶栏与信息架构

### 现状

移动 chat 顶栏同时容纳返回、项目名、Stop、更多和 Reports。Reports 是重要能力，但通常不是运行中的最高频动作；New 只在 session 页，跨 session 工作需要返回列表。项目 drawer 里还承载 Reports、Setting 和 Admin Console。

### 建议

- 运行时顶栏只保留返回、标题、Stop 和溢出菜单
- Reports 放入溢出菜单，或在 turn 完成且产生报告时以情境入口出现
- 在 session 列表保持 New 常驻
- 增加全局 Activity 入口，用于跨项目切换运行中或待处理 session
- 管理后台继续放在 drawer 底部，不进入普通工作流主导航

### 验收标准

- 320px 宽度下，标题和三个关键动作不拥挤、不截断
- 用户从任意 chat 两次点击内进入另一个 Running session
- 没有报告的 session 不占用 Reports 顶栏位置

## P2：补齐首次使用、空状态和恢复动作

### 现状

多个空状态只显示文字：No sessions、No favorites、No reports、No context。桌面空 workspace 有创建按钮，但移动端空列表和报告空状态缺少情境动作。单用户新 session 仍以本机路径 textarea 为主要入口，对手机用户偏技术化。

### 建议

- No sessions：直接提供“新建 session”
- No favorites：提供“查看最近”
- No reports：提供“返回 session”
- No context：解释当前是新 session，并聚焦输入框
- 单用户优先显示最近项目选择，路径输入收进“自定义路径”
- 服务离线时显示主机不可达、认证失效、runtime 不可用三类不同恢复动作

## P2：拆分普通设置、运行治理和管理员配置

### 现状

普通设置同时包含站点标题、语言、主题、消息字号、新线程模型/推理/模式/权限、多用户开关和退出。session 菜单里还包含 Runtime Reload。对普通操作者来说，Reload 是低频且高影响的运维动作，容易与普通模型设置混淆。

### 建议

设置分为三组：

- Personal：语言、主题、消息字号
- Codex defaults：模型、推理、模式、权限
- Host & security：runtime 状态、reload、设备登录态、分享和存储

Admin Console 只负责项目、角色、用户和审计。Runtime Reload 增加确认、影响说明和运行中 turn 阻断。

## P2：增加设备登录态和安全可见性

后端已经保存 `deviceName` 与创建时间，但产品没有设备 session 列表、逐设备撤销或 TTL 管理。持久登录对手机体验很好，但用户丢失设备后缺少自助处置。

建议在 Host & security 中提供：

- 当前设备
- 其他登录设备及创建时间
- 逐设备撤销
- 撤销全部其他设备
- session 到期策略

这项不应压过核心控制体验，但属于远程访问产品必须补齐的治理能力。

## P2：加强报告与 session 的上下文关系

报告查看器、项目分组、收藏和返回路径已经完整。缺口是报告更像独立文件库，用户不容易判断它来自哪个 session、由哪次 turn 生成、是否仍然最新。

建议报告页增加：来源 session、生成时间、关联 goal、返回对话、相对项目最新修改时间。报告入口应在“产出报告”后出现，而不是默认占据每个 chat 顶栏。

## 多视角扫描

### 一线操作者

核心判断：Stop、审批、队列和 work card 已经可用，真正的摩擦转移到了“先找到哪个 session 值得看”。

容易忽略：用户可能只拿出手机 20 秒，不会逐个打开 session 做状态确认。

偏差：会低估权限、存储和长期维护风险。

### 产品与认知

核心判断：项目、session、turn、goal、report 都是合理对象，但用户首先关心的是行动，不是对象层级。

容易忽略：同一个 Done 对工程状态清楚，对用户却可能指 goal、turn 或整个任务。

偏差：可能过度追求信息架构一致性，而忽略实现成本。

### 可靠性与运行治理

核心判断：provider 是 turn 状态权威源；浏览器、Web runtime 和 stream 都只能缓存或传递，不能各自发明终态。

容易忽略：恢复逻辑即使正确，如果用户只看到 Done，仍然是产品失败。

偏差：可能加入过多诊断信息，破坏手机端简洁性。

### 安全与管理员

核心判断：完全互信团队边界已经写清楚，但持久设备 session、runtime reload、分享和存储健康需要可见治理。

容易忽略：管理员能力是低频场景，不应占用普通操作者主路径。

偏差：容易让治理需求压过单用户高频体验。

### 历史与比较

核心判断：产品从单用户 chat 逐步叠加项目、多人、报告、分享和定时任务，当前复杂度是正常路径依赖。下一阶段不应继续横向加入口，而应收敛控制面。

容易忽略：功能删减并非唯一答案，情境化展示可以保留能力同时降低噪声。

偏差：历史类比不能替代真实使用数据。

## 矛盾图

### 中心矛盾

**功能广度 vs 手机端控制效率**

产品需要保留 reports、admin、share、scheduled task 等差异化能力，但默认屏幕必须优先服务远程操作者的实时判断。

### 次级矛盾

- 极简 Running vs 足够判断是否卡住
- project-first 组织 vs 跨项目注意力
- 持久登录便利 vs 设备撤销能力
- 单用户默认 vs 管理后台复杂度
- 紧凑 session 卡 vs 收藏/归档等永久动作

### 高置信共识

- 状态正确性必须高于视觉简洁
- 待审批必须是全局最高优先级
- provider turn 状态必须是权威来源
- Reports 和 Admin 不应压过 Stop、状态和 session 切换
- 项目仍是权限与归属边界，但不应是唯一导航维度

### 能解决中心矛盾的问题

> 用户打开手机时，默认屏幕应该展示“我拥有哪些对象”，还是“现在什么需要我”？

建议选择后者，再用项目作为筛选和上下文。

## 建议路线图

### 第 0 阶段：已完成

- 新 goal 不再继承旧 complete
- runtime 从 provider 恢复运行中 turn
- 重叠 turn 防护使用真实 provider 状态
- 完成回归测试与服务重载

### 第 1 阶段：1 周内

- session 卡增加 Running、Needs approval、Failed 和 last activity
- 增加跨项目 Activity 区域
- 把裸 `Done` 改为 `Turn finished`
- Reports 移入溢出菜单，仅在有报告时显示情境入口
- 增加 session 本地搜索

### 第 2 阶段：2 至 3 周

- 自动和可编辑 session 标题
- sticky runtime strip：elapsed、last activity、current work、stream health
- 可能卡住提示与 reconnect 动作
- 移动端空状态 CTA 与最近项目选择

### 第 3 阶段：3 至 6 周

- 设置分组与 Host & security
- 设备 session 查看和撤销
- report 来源 session 与 turn 回链
- 关键旅程真实手机可用性测试和遥测

## 建议指标

不要只看功能使用次数，应看远程控制效率：

- 打开应用到进入待审批 session 的中位时间
- 打开应用到进入任一 Running session 的中位时间
- 错误显示 Finished/Done 的状态事故数
- stream 中断后恢复到真实状态的成功率和耗时
- 运行超过 10 分钟后被用户手动刷新或重复进入的比例
- 100 个 session 以上用户的搜索使用率
- session 创建后 24 小时内再次进入的成功定位率

## 不建议现在做的事

- 不建议继续增加顶层导航入口
- 不建议把所有诊断细节永久展示在 chat
- 不建议为解决状态问题再建立一套前端独立状态机作为权威源
- 不建议优先重做视觉主题，当前问题主要是信息优先级
- 不建议把多人管理能力继续扩展成 SaaS 式租户模型

## 同行评审

### 结论可靠度

- 注意力优先 session 列表：9/10
- 统一 goal/turn/stream/session 状态：10/10
- 长运行 elapsed 与 last activity：9/10
- session 标题与搜索：9/10
- Reports 移出固定顶栏：8/10
- 设置与管理拆分：8/10
- 设备登录态管理：8/10
- 报告来源回链：7/10

### 最弱主张

“Reports 应移出固定顶栏”的可靠度最低，因为缺少真实点击数据。若报告是核心高频产出，固定入口可能合理。验证方式是记录 chat 顶栏 Reports 的使用频率、进入来源和有无报告时的点击率，再决定隐藏还是情境化。

### 可能的严谨批评

本报告主要依据实现、测试、截图和一次真实状态事故，缺少 5 至 10 名用户的任务观察与量化遥测。因此优先级中的“高频”属于基于产品场景的强推断，而非统计事实。

这个批评不影响两个最高优先级结论：状态必须正确、待处理 session 必须可见。它主要影响 Reports、设置分组和视觉入口调整的先后顺序。

## 最终判断

Codex Web 已经越过“能不能远程用”的阶段，下一阶段应解决“能不能在 20 秒内知道该看哪里、发生了什么、是否需要行动”。

产品不需要再证明它能承载更多功能，而需要证明它能在 session 数量、运行时间和网络不稳定性增长后，仍然让操作者保持信任和方向感。

最值得投入的单一改动是：**用跨项目 Activity + session 状态标签，把首页变成注意力控制台。**

## 证据索引

- session 卡仅含项目、摘要、时间与收藏/归档：`packages/codex-web/public/app.js:2620`
- chat 顶栏包含 Stop、更多、Reports：`packages/codex-web/public/app.js:2194`
- goal 状态位于项目标题下：`packages/codex-web/public/app.js:2308`
- composer 将 Ready 显示为 Done：`packages/codex-web/public/app.js:2749`
- provider 状态恢复修复：`packages/codex-web/src/runtime.ts:951`
- 新 goal 显式 active：`packages/codex-web/src/runtime.ts:727`
- runtime 恢复测试：`packages/codex-web/test/runtime.test.ts:1740`
- goal 替换回归测试：`packages/codex-web/test/runtime.test.ts:1491`
- 移动端运行截图：`/tmp/codex-web-browser-mobile-portrait.png`
- 桌面工作区截图：`docs/assets/readme/desktop-workspace.png`
- 现有工程深度审计：`docs/audits/2026-07-15-project-deep-audit.md`
