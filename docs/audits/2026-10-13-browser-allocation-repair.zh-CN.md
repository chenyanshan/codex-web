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
| 生产首屏 gzip | 142,362 / 143,360 bytes，余量 998 bytes；未提高阈值 |
| 诊断工具 mock | 5 项通过 |
| 诊断工具真实附着冒烟 | 8 秒、初始/周期/最终 heap profiles 与 CPU profile 成功落盘，正常退出，原页面继续运行 |

浏览器回归检查真实消息节点身份、输入草稿、活动输出以及中文原文占位符，未改 CSS 或视觉布局。原代码可使 batch 和中文碰撞回归失败。测试截图/私有性能资料保持在忽略目录，未覆盖上一轮审计截图。

新增 [browser-allocation-profile.mjs](../../scripts/diagnostics/browser-allocation-profile.mjs) 使用 Node 24 与原生 CDP，支持指定现有 target，或先对空白页采样再导航。默认 2 秒指标、5 秒 profile、命令超时与初始加最近 20 份留存；256 MiB JS 堆边界和宿主压力保护。工具不测 renderer RSS、不自动映射 PID、不刷新/关闭页面、不强制 GC。详见 [使用说明和证据边界](../../scripts/diagnostics/README.md)。

后续 AI 修改遵循 [稳定性约束与可复制提示词](../architecture/browser-stability-guardrails.zh-CN.md)，根目录 `AGENTS.md` 已加入渲染分配和增长前采样规则。

## 发布验收

待在已授权的 Linux 服务同步验证提交，并完成网关契约校验、空闲检查、独立 systemd 重启和公网资源/鉴权核对后补记。服务会在进程启动时缓存静态资源，单独拉取文件不会更新线上交付；不能以 Git 更新成功代替部署成功。
