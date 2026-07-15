# Codex Web 项目深度审计

日期：2026-07-15

## 执行摘要

项目的单用户基础链路已经相当完整：密码和 token 的后端存储方式合理，Codex
app-server 复用正确，登录限流、SSE 清理、附件体积限制、报告路径校验、launchd
基础生命周期和 500 余项自动化测试都已存在。

但审计时最大的风险不是代码能否运行，而是产品边界已经从“单用户自托管工具”扩展成
“多人/RBAC/企业内部 Agent 基座”，底层却仍是一个共享 Mac 用户、一个 Codex 登录态
和可由请求控制的 `danger-full-access` runtime。现有 RBAC 只能约束部分 HTTP 路由，
不能成为主机 shell 和文件系统的隔离边界。多人模式目前不应向不受信任用户开放。

本轮已经完成主题系统改造、对比度修复、真实浏览器验证、干净构建门禁修复和 native
CLI shebang 修复，并在审计后继续完成路由默认拒绝、DTO 白名单、附件不可变快照、任务
完成顺序、跨进程文件锁、work card、可访问性、生命周期治理和工程门禁修复。权威产品
边界现已明确为“单用户默认；多人 facade 仅限完全互信团队”，不再承诺共享主机上的
tenant、OS 用户或文件系统隔离。

本报告保留原始发现和取证，便于追溯。详细章节中的“建议”描述的是审计时状态；修复后
结论以风险总表和“审计后复审”段落为准。超大文件、前端非 TypeScript、伪 DOM/源码
正则测试以及 11 份旧 implementation plan 中约 213 个未维护 checkbox 仍是结构债务，
没有因本轮增加 CI、Playwright 和 lint 而被标记为完成。

## 本轮已完成

1. 新增 6 套完整主题：日光黄、纸白、石墨、北境蓝、森林绿、柔和玫瑰。
2. 首次使用默认日光黄；已有用户明确保存的主题继续保留。
3. HTML、manifest、PWA 顶栏、首屏预加载脚本和 Service Worker 使用一致的默认色，
   避免启动时先闪深色。
4. 主题补齐 `on-accent`、强控件边框、代码块、遮罩、状态色等语义 token；主操作、
   小字、状态色、控件边界和代码块均加入自动对比度门禁。
5. 主题选择器改为带色板预览的响应式网格；修复桌面窄设置面板四列控件挤成竖排。
6. 增加主题焦点样式、中文主题名称和 README 说明。
7. Web 测试显式使用 native 源码条件；Web typecheck 前重建 native 声明，避免继续
   静默依赖被 Git 忽略的旧 `dist`。
8. `codex-native-api` CLI 增加标准 Node shebang。
9. 多人请求改为默认拒绝路由，普通用户执行策略由服务端收紧；session/report/event
   DTO 使用白名单，公开 share 默认关闭并增加 TTL、撤销和失效条件。
10. 附件校验拒绝 symlink/TOCTOU，并在私有目录创建只读不可变 turn 快照。
11. scheduled task 严格等待 terminal 后再 archive/stop，scheduler 保存完整 argv/env，
    文件锁支持跨进程和 stale recovery；identity/settings/timeline mutation 每次重读。
12. 恢复 command/file work card；补 modal/drawer 焦点作用域、Escape、焦点恢复、
    `aria-live`、横屏和窄桌面回归。
13. 静态、API、错误和 SSE 统一增加 CSP、nosniff、frame、referrer 等安全响应头；受管
    upload/快照/report/runtime-context 增加 2 GiB 总配额和分类 TTL，timeline 增加条数/
    字节上限，launchd 增加无重启日志轮转、stop 和 uninstall。
14. 新增 ESLint、三视口 Playwright 回归和 GitHub Actions 门禁；这些门禁不等于已偿还
    超大文件、严格类型、axe/真实读屏或旧计划状态债务。
15. 修复服务进程内 active-turn 映射缺失时把仍在运行的 provider turn 显示为 `Done` 的
    状态漂移；session detail、SSE/Stop 所需的 turn ownership 和前端状态均可从
    `thread.turns` 恢复，旧 turn 的终态事件不会结束当前 turn。

主要实现见：

- `packages/codex-web/public/styles.css`
- `packages/codex-web/public/app.js`
- `packages/codex-web/public/theme-init.js`
- `packages/codex-web/test/theme_palette.test.ts`
- `packages/codex-web/package.json`
- `packages/codex-native-api/src/cli.ts`

## 风险总表

| 级别 | 发现 | 状态 | 可靠度 |
| --- | --- | --- | --- |
| P0 | 多人 RBAC 无法隔离共享 Mac 的 shell/文件系统执行 | 结构风险保留；产品边界已降级为完全互信团队 | 10/10 |
| P1 | 多人路由未命中后回落到单用户高权限路由 | 已修复：多人路由默认拒绝 | 10/10 |
| P1 | 普通用户/分享响应泄露内部 thread、cwd 或 raw event | 已修复：DTO/event 白名单与 share 生命周期 | 9/10 |
| P1 | 附件路径校验可被 upload 目录内 symlink 绕过 | 已修复：NOFOLLOW 校验与不可变快照 | 9/10 |
| P1 | 定时任务安装、等待完成、锁和状态并发链路不可靠 | 已修复并增加真实子进程/跨进程测试 | 10/10 |
| P1 | 命令和文件变更事件被主动隐藏，核心可审计性缺失 | 已修复：恢复可折叠 work card | 10/10 |
| P1 | 默认 LAN 明文 HTTP 与密码/token/PWA 目标冲突 | 文档/安装已修复；TLS 仍由部署者提供 | 9/10 |
| P2 | JSON 文件 store 只有进程内锁且长期缓存 | 主要 lost-update 风险已修；SQLite/WAL/备份仍未完成 | 9/10 |
| P2 | 键盘、读屏、横屏和窄桌面体验不完整 | 主要交互已修；axe/真实读屏验证仍待补 | 8/10 |
| P2 | 超大单文件、伪 DOM 正则测试、无 CI/浏览器门禁 | CI/Playwright/lint 已补；结构和旧测试债务保留 | 10/10 |
| P2 | 磁盘、日志、share/session 生命周期和文档缺乏治理 | 大部修复；session token TTL/磁盘余量告警仍待补 | 9/10 |
| Done | 六主题、黄色默认、对比度和首屏一致性 | 已修复 | 10/10 |
| Done | 测试/类型门禁不再静默消费旧 native 产物 | 已修复 | 10/10 |

## 详细发现

> 复审说明：以下内容保留审计时的源码证据，行号会随本轮修复漂移。不要把其中的
> “当前/没有”描述当作修复后的实现状态；风险总表给出最新结论。

### P0：多人模式不是执行隔离边界

`effectiveProjectGrant()` 只要看到任一项目 grant，就把 read/create 合并并强制
`canWrite: true`（`packages/codex-web/src/access_control.ts:51`）。runtime 的默认和
实际 turn 参数仍是 `danger-full-access + approval never`
（`packages/codex-web/src/runtime.ts:330`、`:548`、`:1808`）。

这意味着项目级 RBAC 并不能阻止普通用户通过 Codex 读取项目外文件、执行任意 shell，
或影响同一 Mac 用户可访问的其他目录。多用户设计把 Web 后端称为隔离边界
（`docs/superpowers/specs/2026-05-27-codex-web-multi-user-rbac-design.md:14`），
这个结论在当前执行模型下不成立。

建议：

- 立即把多人模式标记为“仅限完全互信用户/实验性”。
- 普通用户不能提交 sandbox/approval；服务端强制至少 `workspace-write + on-request`。
- 真正面向不互信用户时，使用独立 OS 用户、容器或虚拟机作为进程和文件系统边界。

### P1：多人路由会回落到单用户路由

多人 handler 返回 `false` 后，请求继续进入旧单用户路由
（`packages/codex-web/src/server.ts:388`、`:1571`）。未被多人 handler 覆盖的
usage、reports、timeline、favorite 和 runtime reload 因而只检查“有 token”，没有
统一执行 owner/project/admin 检查。

临时内存服务已经复现：普通 Alice token 可以向 Bob 的内部 thread timeline 写入，
也可以触发全局 runtime reload。核心原因可直接从 `server.ts:454` 和 `:521` 看到。

建议：多人模式使用默认拒绝的独立路由表；任何未显式授权的路径直接 404/403，绝不
fallback。所有 session API 只接受 app session id，再统一解析 owner/project/thread。

### P1：DTO 脱敏和公开分享边界互相冲突

`presentSessionForUser()` 只删除 runtime session 顶层 `cwd`，随后把其余对象全部展开
（`packages/codex-web/src/server.ts:2134`）；嵌套 `thread.cwd/threadId` 因而可能原样
返回。事件模型也把 `threadId` 和 `raw` 放进普通 SSE DTO
（`packages/codex-web/src/event_model.ts:9`）。

公开 share API 在 bearer 鉴权前处理（`packages/codex-web/src/server.ts:362`），测试
明确固定“without bearer auth”（`packages/codex-web/test/server_multi_user.test.ts:1432`）。
这与根 `AGENTS.md:53`、`:94` 的“不得暴露未鉴权 API / 所有 API 和事件流均需 bearer”
直接冲突。share 还没有 TTL、单链接撤销或关闭多人模式后失效机制。

建议先做产品决定：若保留 capability link，应更新权威规范，并增加 TTL、撤销、feature
flag 和严格白名单 DTO；若遵守当前根规范，则 share API 必须要求登录。

### P1：附件路径存在 symlink/TOCTOU 风险

turn 附件接受浏览器回传的绝对 `localPath`，只做 `path.resolve`、词法目录包含检查和
`fs.access`（`packages/codex-web/src/server.ts:2400`）。upload 目录中的 symlink 可以
指向目录外文件；检查完成后换链还存在 TOCTOU 窗口。

建议浏览器只提交服务端签发并绑定 user/session 的 opaque attachment id。服务端拒绝
symlink，使用 `realpath/lstat`，或把文件复制/打开到不可变私有位置后再交给 runtime。

### P1：定时任务链路目前不能信任

存在四个叠加问题：

1. `startTurn()` 在收到 turn id 后就返回，后台 runPromise 仍未完成；task runner 随即
   archive，CLI 随即 `runtime.stop()`（`task_runner.ts:70`、`cli.ts:196`）。
2. scheduler 默认把 `process.argv[1]` 当独立可执行文件写进 plist；源码启动时它是不可
   执行的 `src/cli.ts`（`cli.ts:221`、`task_scheduler.ts:47`）。
3. plist 设置 `CODEX_WEB_ENV_PATH`，`loadServiceConfig()` 却没有读取这个环境变量。
4. `.lock` 只有 EEXIST 判断；崩溃留下锁文件后任务会永久被视为正在运行。

建议新增 `awaitTurnResult`，严格验证 `start -> terminal -> archive -> stop`；scheduler
保存完整 executable + argv；实现 stale-lock recovery，并用真实子进程做 smoke test。

### P1：命令/文件变更被隐藏

前端收到 `batch.started/updated/completed` 后只写 `state.batches`，不写 timeline
（`packages/codex-web/public/app.js:5400`）。已经存在的 `renderWorkItem()` 无调用方
（`:2639`），测试还明确断言 timeline 中不能出现 work 卡
（`packages/codex-web/test/public_ui.test.ts:4440`）。

这同时违背主设计、README 和视觉参考所承诺的 command/file-change batch，可导致用户
在手机上看不到 Codex 正在运行什么命令、修改什么文件。建议恢复可折叠 work card，
默认显示摘要，失败自动展开，详细输出按需展开并做长度限制。

### P1：明文 LAN、PWA 与安装秘密处理冲突

默认 `0.0.0.0` 和文档的 `http://<lan-ip>` 会让密码与 bearer token 在同网段明文传输；
非 localhost HTTP 也不是 Service Worker secure context，Android PWA 行为与文档承诺
不一致（`packages/codex-web/src/config.ts:36`、`docs/pwa-setup.md:7`）。

同时 `install.md:45` 指示 agent 询问密码并通过 `--password` argv 传入安装器，密码可能
进入 agent 工具记录、shell history 和进程列表。应改为隐藏交互输入或受控文件描述符，
并把 HTTPS 明确写成手机 PWA/远程访问前置条件。

### P2：文件状态不支持多进程

settings/timeline store 缓存整份 JSON，遇到任何读/解析错误又静默当空文件
（`session_settings_store.ts:56`、`session_timeline_store.ts:63`）。主服务和 scheduled
task 是独立进程，实例内锁与 read-modify-rename 无法防止相互覆盖或长期读取旧缓存。

优先建议 SQLite + WAL。最低限度也需要跨进程锁、每次 mutation 重读、版本/CAS、损坏
文件 fail-closed 与备份恢复。

### P2：可访问性与响应式

本轮已增加主题化 `:focus-visible` 并修复桌面设置侧板控件挤压，但仍缺：

- modal/drawer 的初始焦点、焦点陷阱、Escape 关闭、焦点恢复和背景 inert；
- 状态/审批/错误的 `aria-live` 或 `role=status`；
- 非必要的强制竖屏仍存在；
- 820px 即启用 240px + 320px + chat 三栏，窄桌面右栏空间不足；
- Stop、New、连接状态和 work 摘要在移动端入口过深。

### P2：维护性和测试真实性

当前主要文件规模：`app.js` 9847 行、`public_ui.test.ts` 10638 行、`server.ts` 3093 行、
`codex_app_client.ts` 5217 行、`native_api_server.ts` 3092 行。前端未进入 TypeScript，
多数 UI 测试依赖源码正则和伪 DOM，还会固定隐藏 batch、强制竖屏等争议行为。

本轮干净 `dist` 演练还证明：若 Web 的 strict typecheck 直接消费 native 源码，会出现
122 处错误；native 自身仍是 `strict: false`。本轮已让测试走源码、typecheck 前重建
native declaration，但严格类型债务仍需分批偿还。

审计后已经新增 GitHub Actions，执行干净安装、build、typecheck、unit test、lint 和
三视口 Playwright 回归；构建后 CLI smoke 也已补测试。仍未完成的是超大文件拆分、前端
TypeScript 迁移、axe/真实读屏、覆盖率阈值、format 门禁，以及替换大量伪 DOM/源码正则
测试。11 份旧 implementation plan 中约 213 个 checkbox 也仍未逐项核对，不能代表
真实完成状态。

### P2：生命周期、磁盘和文档治理

审计后已完成：受管 state 总配额、项目 upload 配额、分类 TTL、timeline 条数/字节上限、
launchd 小时级私有日志轮转、stop/uninstall、share feature flag/TTL/撤销、统一 CSP/
`X-Content-Type-Options`/frame/referrer policy，以及 AGENTS/spec/README 的可信团队边界同步。

仍未完成：浏览器 session token TTL/设备级管理撤销面、磁盘剩余空间主动告警、默认
launchd label 去个人化、SQLite/WAL 与备份恢复，以及约 213 个旧 plan checkbox 的逐项
核验。报告 favorite 只是展示元数据，不是生命周期豁免；长期归档仍需移出受管目录。

## 多视角扫描

| 视角 | 核心判断 | 容易忽略的点 | 该视角的偏差 |
| --- | --- | --- | --- |
| 一线操作者 | work card 已恢复，主链路可审计性改善 | 手机端 Stop、New、状态入口仍需持续验证 | 容易低估后端结构风险 |
| 安全工程 | 多人模式不能靠 Web RBAC 隔离同一 OS 用户的 full-access Codex | 路由 fallback、raw DTO、symlink 会互相放大 | 可能对可信家庭/个人部署过于保守 |
| 维护者 | CI/Playwright/lint 已补，但超大文件、严格类型和伪 DOM 债务仍在 | 测试可以主动固定错误产品行为 | 可能优先重构而延后用户价值 |
| 产品/治理 | 权威边界已收敛为单用户默认、完全互信团队 facade | capability share 必须持续保持默认关闭 | 可能低估兼容成本 |
| 历史/比较 | 功能是从单用户基线逐层叠加，fallback 和 JSON store 是典型路径依赖 | 新功能继承了旧信任模型 | 类比不能替代具体威胁模型 |

## 矛盾图

高置信共识：

- 单用户、完全互信、HTTPS 前置的部署仍有实际价值。
- 现有认证哈希/token、CodexAppClient 复用、SSE 清理等基础不应重写。
- 多人宣传、full-access runtime 和共享 OS 用户三者不能同时成立。
- 自动化测试数量多不等于真实浏览器、安全边界和干净构建已经被证明。

审计时的直接冲突与当前处理：

- `AGENTS.md` 全部 bearer vs public share：已定义默认关闭的 capability-token 认证例外；
- 项目级 RBAC vs 主机级执行能力：通过完全互信产品边界缓解，真实隔离仍未实现；
- README 承诺 batch vs 前端隐藏 batch：已恢复 work card；
- LAN HTTP vs token/PWA：文档已要求手机/远程入口使用部署者提供的 HTTPS；
- scheduled task “onCompletion” vs 只等待 turn id：已严格等待 terminal。

能解决中心矛盾的问题：

> 这个产品未来是“一个可信用户远程控制自己的 Mac”，还是“多个互不完全信任的用户
> 共享同一台执行主机”？

前者应删除或明确降级多人宣传；后者必须先投入真实执行隔离、默认拒绝路由和事务存储。

## 剩余路线图

### 0. 持续部署约束

- 在 P0/P1 修复前，只向完全互信用户开放多人模式。
- 未有 HTTPS 时不要通过不可信 LAN/tunnel 输入密码或 token。
- public share 保持默认关闭；开启后按 bearer capability 保护 URL。

### 1. 真实隔离与会话治理

- 若要接纳不互信用户，使用独立 OS 用户、容器或主机，不把 Web RBAC 当执行隔离。
- 增加浏览器 session token TTL、设备列表和逐设备撤销管理面。
- 评估把附件 local path 协议进一步收敛为服务端 opaque id。

### 2. 任务与持久化

- 评估迁移 SQLite/WAL，并补正式备份恢复和磁盘余量告警。

### 3. 核心体验

- 增加 axe 和真实读屏验证，持续校验横屏、窄桌面与触控键盘路径。
- 继续验证 Stop、连接状态和 New 在移动端高频路径中的可发现性。

### 4. 工程治理

- 拆分 server/runtime/app/test 超大文件。
- 增加覆盖率阈值、format 门禁，并逐步用真实 DOM/browser 测试替换伪 DOM 正则断言。
- 逐项核对或归档约 213 个旧 plan checkbox，不把历史计划当完成清单。

## 已验证的优点

- 密码使用加盐 PBKDF2；token 使用随机值且后端仅保存 hash；敏感状态以 `0600` 原子写入。
- 登录有限流和请求体限制；工作区 API 有集中 bearer 校验，opt-in share 使用有 TTL、
  可撤销且后端只存 hash 的 URL capability token。
- `CodexAppClient` 确实复用，没有重新实现 JSON-RPC。
- 报告路径使用 realpath 防目录逃逸；SSE disconnect 和 server stop 有清理逻辑。
- 默认状态/env 在仓库外；launchd 使用 RunAtLoad/KeepAlive。

## 验证与局限

- 修改前基线：typecheck 通过；native 23 项、Web 489 项测试通过。
- 主题对比度测试覆盖 6 套主题的正文、次要文字、主操作、控件边界、状态色和代码块。
- 隔离 Chrome 在 390x844 与 1440x900 下逐个切换 6 套主题，共 12 个真实渲染状态；
  无 page error、无横向溢出、主题色和 meta 顶栏色一致，截图均为非空 PNG。
- 暂时移走 native `dist` 后，Web typecheck 会先重建声明，Web 全量测试仍可从源码通过。
- 生命周期/安全/任务/CLI/多人路由聚焦测试 137/137 通过；launchd 轮转脚本另有真实
  文件轮转测试，未重启或干扰 `43210` 上正在运行的服务。
- 三视口 Playwright 使用 `activeTurnId` 缺失但 provider turn 为 `inProgress` 的 fixture，
  在 390x844、844x390 和 1440x900 下均验证 `Running`、Stop、New、work card 和无横向
  溢出；同时捕获并修复了桌面 workspace 收到 SSE batch 后不刷新 work card 的问题。
- 未对正在运行的真实服务执行破坏性渗透；跨用户 fallback 通过临时内存服务复现。
- share 规范冲突已收敛：默认关闭，显式开启后 URL capability token 本身承担认证；其他
  API/SSE 仍要求 bearer header。

## 同行审阅

最强结论是多人执行隔离、路由 fallback、隐藏 batch 和 task completion：都有直接源码、
测试或临时复现证据，可靠度 9-10/10。

最弱结论是不同移动平台对 LAN HTTP PWA 安装的具体表现：Service Worker secure-context
限制明确，但 iOS/Android 某些版本仍可能允许创建普通主屏快捷方式。因此应把结论限定为
“PWA/离线能力和传输保密不能被保证”，而不是“所有设备绝对无法添加到主屏”。

严谨评审者最可能的批评是：个人自用工具不需要企业级隔离。这个批评对单用户模式成立；
README 现已撤下企业级隔离暗示，并明确多人 facade 只适用于完全互信团队。

项目现已把不互信多人使用明确列为非目标，因此 P0 作为结构风险和未来方向门槛保留，
而不是当前完全互信部署的未交付承诺。若未来重新接纳不互信用户，真实执行隔离必须先于
所有多人 UI 与功能扩张。
