# CLI 与 app-server 0.163.0 升级记录

日期：2026-10-16（Asia/Shanghai）。目标是兼容最新稳定 Codex CLI；app-server 随 CLI npm 包发布，二者使用同一版本。

## 版本来源

- npm `@openai/codex@0.163.0`：registry tarball integrity 为 `sha512-HNd7vR9oTK6M2ikxFnvNDCdYUgAsyo9VVnd5KnEd2ON0GYI++7MiX9XNPUkhtdgGKFPsWS+CEppQ1UU63uVhUw==`。
- GitHub 稳定 tag：`rust-v0.163.0`，发布于 `2026-10-15T21:30:38Z`，tag peeled commit `83086188ae0614bd882818ff1aa23f3194962012`。
- 生成协议的原生 darwin-arm64 binary SHA-256：`8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31`。

## 代码适配

使用隔离的临时 `HOME`、`CODEX_HOME` 和项目目录从 0.163.0 生成 stable/experimental TypeScript 协议。旧版本使用的 RPC 没有删除；新增方法包括附件归属、thread read state 和 prediction。网页目标管理命令现在传递 `origin: "user"`，匹配新版 app-server 对用户指令持久化的要求。新增 `partial_answer` 阶段不会覆盖最终答案。

## 验证

- 0.163.0 隔离 app-server：initialize、thread/start/read/list/resume、config/read、skills/list、MCP 状态、unsubscribe 全部通过；未复制凭据，未执行真实模型推理。
- 0.159.0 与 0.163.0 的用户目标 set/read/clear 隔离回归均通过。
- 全仓测试：1173 passed；app-server 生成协议测试：5 passed；构建和 built-public smoke 通过；TypeScript typecheck 通过。
- 生成协议差异未删除现有 RPC。新增字段与类型变化由生成文件和回归测试覆盖。

## 安装与切换状态

管理员已登录并建立维护操作 `upgrade-0163-20261016`。`/opt/homebrew/bin/codex` 已安装到 `0.163.0`，但承载当前 Codex Web 操作的活动 turn 仍在运行；维护状态因此保持 `waiting`，原因是 `Active turns` 和 `Loaded thread active or idle state unconfirmed`。不会强制终止该 turn。活动 turn 完成后，已有维护操作会自动运行隔离兼容检查并重启其拥有的 app-server；随后应再次检查 `/api/runtime/status` 中的 `runningVersion` 和协议版本。Web 服务进程仍需在安全空闲窗口加载本次构建，以使运行时协议报告从 0.159.0 切换为 0.163.0。

证据文件：`2026-10-16-cli-upgrade-evidence/compat-0.163.0.json`、`goals.json`。

受影响优化：OPT-01、OPT-02、OPT-07、OPT-08、OPT-13、OPT-20、OPT-21（协议和运行时生命周期）；保留现有活动检查、epoch、取消、鉴权和不自动重试边界。OPT-03/04/05/06/09/10/11/12/14/15/16/17/18/19 未修改其实现。真实模型推理、浏览器端登录恢复和最终空闲切换尚未在本记录中宣称通过。
