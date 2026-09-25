# 前端改造实施与验收

日期：2026-09-25。依据[全项目审查](2026-09-25-frontend-design-review.zh-CN.md)实施；用户明确要求手机同步优化、使用 GPT-6 Astra medium 子代理，会话和会话列表最后处理且能单独回退。

## 设计和实施顺序

使用项目 [frontend-design](../../.agents/skills/frontend-design/SKILL.md)，延续五套现有主题、系统字体、会话布局及控件语言。默认 Fresh Light 继续使用画布 `#f4f5f7`、面板 `#ffffff`、正文 `#1f2937`、次要文字 `#6b7280`、强调色 `#10b981`、边界 `#e5e7eb`；其他主题全部引用原变量。管理台和设置采用 22 / 18 / 14px 左对齐层级，审批字号随消息偏好调整。

先由三个 GPT-6 Astra medium 子代理分别重做审批、全局设置和管理台，再由主代理合并资源、中文、启动恢复、焦点与分享错误状态。三个界面均完成手机与桌面检查后，保存第二份源码检查点，最后修补附件、会话语言及用户追加反馈的手机顶部信息拥挤。会话列表、聊天主布局和输入框保持原有结构。

| 区域 | 结果 | 详细记录 |
| --- | --- | --- |
| 审批 | 目的、完整可滚动命令、访问范围与操作分层；本次/会话/命令规则语义匹配协议；未知送达不重发；明确截断时禁止允许操作 | [审批改造](2026-09-25-approval-redesign.md) |
| 全局设置 | 桌面居中遮罩窗口；手机独立页面与分区跳转；区分本设备、共享服务器、账户；Webhook 密钥默认隐藏，保留复制/换钥/焦点恢复 | [设置改造](2026-09-25-settings-redesign.md) |
| 管理台 | 统一导航、列表、编辑与真实指标层级；账户标识可展开；主题内确认对话框；保留编辑草稿、分页及只读审计 | [管理台改造](2026-09-25-admin-redesign.md) |
| 启动 | 独立脚本处理依赖加载失败，15 秒仍未启动显示恢复入口；静态链接能覆盖恢复脚本自身失败；不清缓存、不自动刷新 | `boot-recovery.js`、`frontend-recovery.spec.js` |
| 浏览器存储 | 可选偏好/缓存读取与清理不再阻止登录页；存储 getter 延迟到控制器既有保护内；草稿与 outbox 写失败仍保留原反馈 | `app.js`、`ui-kit.js`、既有草稿/提交回归 |
| 键盘 | Tab 可经过折叠详情 summary，过滤隐藏/禁用/折叠内容，原生确认窗口使用自身焦点管理 | `focusableElements`、新增键盘浏览器测试 |
| 分享错误 | 401/403/404/410 显示相同不可用提示；临时故障由用户显式重试；不暴露原始错误、不携带设备凭证、不保留失败会话内容 | 新增分享浏览器测试 |
| 会话最后一批 | 手机顶部只保留标题、简短运行/连接状态和导航/停止/菜单；完整标题、项目、目标和计时移入已有会话菜单，长目标默认折叠；附件失败独立两行布局，重试与移除至少 44px；新会话标题与日期跟随所选语言 | [手机顶部记录](2026-09-25-mobile-session-header.md)、[独立补丁](2026-09-25-frontend-redesign-evidence/session-polish.patch) |

## 资源与弱网约束

六个新增资源同步进入 HTML、服务端允许清单、构建版本和 Service Worker 完整资源判定。管理台 JS 继续按需加载。生产首屏 gzip 总量 **143,168 字节**，低于原有 **143,360 字节**上限；未抬高预算。源码 app.js 为 498,694 字节，构建后 259,073 字节，均满足原限制。此为同一预算算法的大小检查，不宣称真实网络速度提升。

源 HTTP 与生产构建分别检查新增资源的 200、MIME、版本、Brotli/gzip（小于既有 1 KiB 阈值时不压缩）、ETag/304、旧版本不使用 immutable。PWA 仍要求当前资源完整才淘汰旧完整缓存。详见[首屏大小](2026-09-25-frontend-redesign-evidence/startup-budget.json)。

## 21 项能力核对

以下映射遵循[保留基线](../architecture/2026-09-25-existing-optimizations-baseline.zh-CN.md)。未修改的运行时能力仍用既有回归验证；不将 fixture 或测试视口称作真实手机网络测试。

| 能力 | 保留方式及验证入口 |
| --- | --- |
| OPT-01 / 02 / 07 | 原 SSE/退避/游标与前后台恢复未替换；weak-network、connection-status、session-output-recovery、network_recovery |
| OPT-03 / 08 / 09 | 有界缓存、分步加载和历史分页未替换；public_ui、session-reading、weak-network |
| OPT-04 / 05 / 06 | outbox、回执与草稿控制器保留；storage 包装不吞写错误；public_ui、frontend_contracts、server_session_submission、attachment-upload |
| OPT-10 / 11 | 继续局部更新和阅读锚点保护；session-reading、work-details、管理编辑回归和重复渲染内存检查 |
| OPT-12 / 13 | 原合并写入与身份/请求代次保护保留；public_ui、admin-correctness、approval-delivery、settings-redesign |
| OPT-14 | 仅改附件失败布局和触控尺寸，上传管理器未修改；attachment-upload、session-polish |
| OPT-15 | 新资源参与原原子升级完整性检查；service_worker_cache、workspace PWA 检查 |
| OPT-16 | 未读控制器仅延迟访问存储，身份和容量约束不变；session_attention、session-attention |
| OPT-17 | 五主题、两布局、320/390/844/1440 宽度、中英文与字号偏好；各区域实际截图及浏览器断言 |
| OPT-18 | 仅扩展静态文件允许清单；原压缩、有界缓存和条件请求保持；server_auth、static_asset_cache、built smoke |
| OPT-19 / 20 | 文件/列表缓存、事件容量、慢客户端及托管存储实现未修改；全量单测覆盖对应模块 |
| OPT-21 | 原后端权限保持；分享错误不泄露详情，控制台确认在身份失效后不得写入；server_auth、server_multi_user、frontend-recovery、admin-redesign |

## 验证结果

- `npm run typecheck`、`npm run lint`、`npm run build`：通过。
- `npm test`：1,099 项通过，0 失败、0 跳过（core 75、web 1,019、升级工具 5）。
- 构建后真实 HTTP/浏览器冒烟：27 个脚本、六个新增资源通过；零浏览器脚本错误。
- 全量浏览器初轮：293 通过、349 按原适用范围跳过、3 失败。两项仍查找旧审批文案，另一项在键盘滚动动画结束前就读取横向位置；修正文案断言及等待实际 `scrollend`，原内存、焦点、展开和精确位置限制保留。
- 最后手机顶部改动后，阅读位置、输出恢复、工作详情、工作区、弱网和附件/语言回归：137 通过、203 按原适用范围跳过；三项初轮失败均在此轮通过。手机顶部/控制/连接检查：8 通过、7 范围跳过，包含 60 组手机主题/语言/布局几何与触控断言。详见[验证记录](2026-09-25-frontend-redesign-evidence/verification.json)；跨批次不累加成独立用例数，跳过不计入通过。
- 各区域截图已由主代理及子代理实际查看；旧审查截图被测试重写时，保存本轮结果并还原原文件，避免覆盖历史证据。

限制：测试浏览器为 Chromium 149，手机使用触控/视口模拟，键盘通过缩小可用高度检查；未使用真实 iPhone Safari、VoiceOver 或真实弱网手机。本轮未重新验证真实在线审批执行；协议语义由源码、集成与 fixture 检查支持。历史旧缓存无法证明以前是否截断，新增截断标记只覆盖能检测到的情况。浏览器禁止持久存储时可进入登录页，不承诺保存登录、偏好或草稿。

## 会话部分独立回退

第一份源码检查点：`~/.codex-web/source-checkpoints/frontend-20260924T190158Z/`。会话修改前检查点：`~/.codex-web/source-checkpoints/frontend-nonsession-20260924T191637Z/`。备份包括工作区当时已有的 app-server 未提交改动，不含服务凭据或运行状态。

在仓库根目录执行下列检查与回退，只撤回最后一批手机会话顶部/菜单信息、附件尺寸/失败布局、新会话标题、日期格式及对应测试；审批、管理台、全局设置、启动恢复等改动继续保留：

```bash
git apply --reverse --check docs/audits/2026-09-25-frontend-redesign-evidence/session-polish.patch
git apply --reverse docs/audits/2026-09-25-frontend-redesign-evidence/session-polish.patch
```

已在隔离临时目录实际反向应用完整会话补丁，核对受影响文件与会话修改前版本，再正向应用并确认与最终工作区字节一致；独立审批测试更新也保留。手机追加反馈前另有检查点 `~/.codex-web/source-checkpoints/frontend-mobile-header-before/`。主工作区保留新版。以后源码再次变化，先检查补丁是否适用，不能用整文件覆盖 app.js 回退。生产生效仍需重新构建、执行实际主机前置校验并在任务空闲后切换服务。回退不清除浏览器或服务数据。

## 生产生效

本轮运行在 `codex-web.service` 内，直接重启会中断当前对话。因此先完成构建、HTTP/浏览器验证和完整 systemd 附加校验；激活状态另记在本机一次性维护目录，不把计划切换称作已经生效。未修改 CLI、service.env、系统服务配置、网关校验或用户历史。

已通过实际 app-server 只读状态检查、网关源码校验及准备阶段快照核对。独立 systemd 单元 `codex-web-frontend-activate-20260925.service` 的 cgroup 与运行中的 Web 服务分离；最初交付时为 `waiting_for_idle`。随后在任务空闲后完成重启，2026-09-25 03:45:59（北京时间）自动验收状态为 `passed`，静态版本为 `d4ce3d6ba8e28ce0b570`。

切换结果写在 `~/.codex-web/source-checkpoints/frontend-activation/status.json`；直连和公网首页/版本、六个新资源、PWA manifest/Service Worker 和未登录私有 API 检查均已通过。用户随后要求重启时，再次确认服务为 active/running、本地及公网首页和版本接口均返回 200 且版本匹配，确认新版已生效。该状态与本轮 fixture/构建验收分开记录。
