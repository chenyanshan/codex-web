# Codex Web

[English](README.md) | 中文

这是一个自托管 Web 控制台，用来从手机、平板或桌面浏览器控制本机已经登录的
Codex runtime。

浏览器只是远程 UI。Mac 或 Linux 主机负责保存 Codex 凭据、启动 Codex
runtime、读写本地项目文件、执行 shell 命令，以及保存应用状态。公网访问、
tunnel、反向代理不属于本仓库范围。

> 让 Codex 直接安装：
> `帮我安装 https://github.com/chenyanshan/codex-mobile-web-app/blob/main/README.md`

## 核心亮点

### 1. 配合内网穿透，可远程随时操控 Codex

Codex Web 把 Codex 凭据、shell 执行能力和本地文件访问能力保留在宿主机上，
手机或浏览器只作为远程控制台使用。配合你自己的 tunnel、内网穿透或反向代理之
后，就可以在不把执行环境搬进浏览器的前提下，随时远程连回自己的 Codex。

| 手机远程控制台 | 桌面工作区 |
| --- | --- |
| ![手机最近会话视图](docs/assets/readme/mobile-recents.png) | ![桌面工作区视图](docs/assets/readme/desktop-workspace.png) |

- 面向手机、平板和桌面浏览器的远程 UI。
- project-first workspace，实时展示会话列表、聊天和 turn 状态。
- 既适合局域网内访问，也适合接在你自己的远程访问入口之后使用。

### 2. 面向完全互信团队的多人 facade

Codex Web 提供 Web 层多用户 facade，只适用于成员彼此完全信任的团队。RBAC 仅控制
Web UI 和 HTTP API 暴露的内容，不提供 tenant、OS 用户、进程、Codex runtime 或
文件系统隔离。所有 turn 仍以同一个宿主机用户身份执行，并继承该 Codex runtime
允许的访问能力。不受信任用户必须拆分到独立 OS 用户、容器或主机。

| 手机管理审计 | 桌面用户管理 |
| --- | --- |
| ![手机管理控制台与会话审计](docs/assets/readme/mobile-admin-audit.png) | ![桌面管理控制台与用户角色管理](docs/assets/readme/admin-user-management.png) |

- 为完全互信团队提供多用户模式、项目管理、角色管理和用户管理。
- 提供 Web 层项目授权、admin 操作和 observer mode。
- 支持会话审计视图，按用户、项目、session 查看活动记录。

## 功能概览

- 密码保护的单主机 Codex Web 控制台。
- 适合手机安装的 PWA，按设备持久保存浏览器 session。
- project-first workspace：桌面端是项目栏、session 列表、chat 三栏；移动端是
  项目 drawer。
- Codex turn 实时流：assistant delta、最终回答、命令批次、文件改动批次、
  approval 请求和 runtime 报错。
- 面向完全互信用户的多用户/RBAC facade：项目授权、admin 管理和 observer mode。
- 可选只读分享链接会打开独立对话页；公开分享默认关闭，必须由部署者显式开启。
- turn 文件和图片附件。后端在本机保存文件，并把安全 local path 交给 Codex。
- 已鉴权 reports 列表和报告查看器，以及仓库自带的 `codex-mobile-report`
  skill。
- 仓库自带 `codex-web-user-context` skill，可在需要时读取当前 Codex Web
  登录用户和项目上下文。
- macOS launchd 和 Linux systemd 服务脚本。
- English / 简体中文 UI 语言设置，以及 admin/单用户可管理的站点标题。
- 6 套经过对比度校验的主题，首次使用默认日光黄，并提供纸白、石墨、北境蓝、
  森林绿和柔和玫瑰配色。

## 仓库结构

```text
packages/codex-native-api   可复用 Codex app-server 集成层
packages/codex-web          HTTP API、auth、runtime bridge 和 Web UI
scripts/install             面向 AI 的安装脚本
scripts/service             launchd 服务脚本
skills/codex-mobile-report  配套报告 skill
skills/codex-web-user-context  当前 Codex Web 用户/项目上下文 skill
docs/superpowers/specs      设计文档
docs/superpowers/plans      实现计划
docs/rendering              本地 Markdown/report 渲染验证材料
```

本仓库从 `CodexBridge-main` 拆分出来。

## 环境要求

- Node.js `>=24`
- npm
- 已安装本机 Codex CLI
- 本机 Codex 登录态位于 `~/.codex/auth.json` 或 `CODEX_HOME/auth.json`

## 快速开始

安装依赖：

```bash
npm install
```

设置 Web 密码：

```bash
npm run codex-web -- auth set-password
```

启动 Web 服务：

```bash
npm run serve
```

默认监听 `0.0.0.0:43210`，同一局域网内的手机可以访问。Mac 本机仅使用
`http://127.0.0.1:43210`。手机输入密码前，应在服务前接入你自己的 HTTPS 反向
代理、tunnel 或私有网络 HTTPS 入口；明文局域网 HTTP 无法保护密码和 bearer
token，Service Worker 也要求安全上下文。

运行检查：

```bash
npm run typecheck
npm test
```

## AI 安装入口

如果你希望让 Codex 或其他 coding agent 安装这个项目，请使用根目录的
[install.md](install.md)。它适用于 GitHub blob 链接和本地 checkout。

约定的 agent 行为：

- 如果用户发来 GitHub `README.md` 或 `install.md` blob 链接，先还原仓库根
  目录，再执行 `install.md`。
- 如果用户在本地 checkout 里说“帮我安装这个项目”，先定位仓库根目录，再执行
  `install.md`。
- macOS 上只询问是否安装 launchd 开机自启动。不要让用户在 agent 对话里发送
  密码；安装器会直接打开关闭回显的终端密码提示。
- Windows 上停止安装，并说明当前仓库没有 Windows 安装器。

macOS 自动安装流使用：

```text
install.md
scripts/install/install-codex-web-macos.sh
```

安装脚本会处理依赖安装、密码设置、服务启动、可选 launchd 自启动，以及安装仓库
自带的两个 skill。

## 配置

运行时状态保存在仓库外。

默认路径：

```text
~/.config/codex-web/service.env
~/.codex-web/auth.json
~/.codex-web/logs/
~/.codex-web/reports/
~/.codex-web/report-index.json
~/.codex-web/uploads/
```

`~/.codex-web/auth.json` 只保存加盐密码哈希和哈希后的 session token。浏览器只
保存不透明 session token。不要把 `CODEX_WEB_PASSWORD` 写入 `service.env`。

非交互首次启动支持一次性 `CODEX_WEB_PASSWORD` 环境变量，但只能由本机 secret
manager 注入。不要把明文密码写进 shell history 或 service env 文件。

生成的 service env 默认类似：

```env
CODEX_WEB_HOST=0.0.0.0
CODEX_WEB_PORT=43210
CODEX_WEB_DEFAULT_CWD=/Users/you/path/to/codex-web
CODEX_REAL_BIN=codex
CODEX_WEB_DEBUG=0
CODEX_WEB_PUBLIC_SHARES_ENABLED=false
CODEX_WEB_PUBLIC_SHARE_TTL_SECONDS=86400
```

如需修改监听地址、端口、默认工作目录或 Codex 可执行文件，编辑
`~/.config/codex-web/service.env`。如果只允许本机访问：

```env
CODEX_WEB_HOST=127.0.0.1
```

除非设置 `CODEX_WEB_PUBLIC_SHARES_ENABLED=true`，分享入口会保持隐藏，所有
`/api/share/*` 路由也会返回未找到。开启后，新链接默认 TTL 为 24 小时，由
`CODEX_WEB_PUBLIC_SHARE_TTL_SECONDS` 配置，最长不超过 7 天。链接被撤销或多人模式
关闭后也会立即失效。分享 URL 本质上是 bearer capability，必须按凭据保护。

### 存储生命周期

Codex Web 只会按受管文件名或报告扩展名清理由自身管理的文件，不跟随符号链接，
也不会删除项目中的无关文件。清理发生在启动、受管写入前和读取报告前。达到配额
时先删除过期文件，再从最旧的受管文件开始删除。

| 受管数据 | 默认策略 | 配置项 |
| --- | --- | --- |
| 状态目录 upload、turn 快照、报告、runtime context | 总计 2 GiB | `CODEX_WEB_MANAGED_STORAGE_MAX_BYTES` |
| 项目内 upload | 每项目 512 MiB | `CODEX_WEB_PROJECT_UPLOAD_MAX_BYTES` |
| 上传源文件 | TTL 7 天 | `CODEX_WEB_UPLOAD_TTL_SECONDS` |
| turn 附件快照 | TTL 30 天 | `CODEX_WEB_TURN_ATTACHMENT_TTL_SECONDS` |
| 报告 | TTL 365 天 | `CODEX_WEB_REPORT_TTL_SECONDS` |
| runtime context 文件 | TTL 30 天 | `CODEX_WEB_RUNTIME_CONTEXT_TTL_SECONDS` |
| 应用 timeline | 每 session 500 条、总计 16 MiB | `CODEX_WEB_TIMELINE_MAX_ENTRIES_PER_SESSION`、`CODEX_WEB_TIMELINE_MAX_BYTES` |

报告 favorite 只是展示元数据，不是长期归档保证。需要长期保留的材料应移出
`~/.codex-web/reports/`，或提高对应 retention 与 quota 配置。

## 附件

消息输入框可以为下一次 Codex turn 上传文件和图片。所有上传接口都需要鉴权。

项目目录可写时：

```text
<project-cwd>/uploads/<user-id>/
```

回退存储：

```text
~/.codex-web/uploads/projects/<project-key>/<user-id>/
```

后端会返回实际 `localPath`，并在启动 turn 前校验附件路径必须位于允许的 upload
roots 内。图片会作为 local image 传给 Codex；其他文件会以本机路径形式写入
turn prompt。

上传限制：

```text
32 MiB request body
25 MiB per file
```

上传源文件和不可变 turn 快照还会受上面的存储生命周期策略约束。

## 报告 Skill

配套 skill 位于：

```text
skills/codex-mobile-report
```

安装到本机 Codex skills：

```bash
mkdir -p ~/.codex/skills
mkdir -p ~/.codex/skills/codex-mobile-report
cp -R skills/codex-mobile-report/. ~/.codex/skills/codex-mobile-report/
```

开发时建议使用软链接：

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/codex-mobile-report" ~/.codex/skills/codex-mobile-report
```

该 skill 会把手机可读 Markdown 或自包含 HTML 报告写入
`~/.codex-web/reports/`。Codex Web 会通过已鉴权 API 暴露这些报告，并在应用内
打开报告链接。

## 用户上下文 Skill

Codex Web 用户上下文 skill 位于：

```text
skills/codex-web-user-context
```

安装到本机 Codex skills：

```bash
mkdir -p ~/.codex/skills
mkdir -p ~/.codex/skills/codex-web-user-context
cp -R skills/codex-web-user-context/. ~/.codex/skills/codex-web-user-context/
```

开发时建议使用软链接：

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/codex-web-user-context" ~/.codex/skills/codex-web-user-context
```

这个 skill 和前面的配套 skill 一样，仓库内自带，安装目标也是本机系统 Codex
skills 目录 `~/.codex/skills/`。在 Codex Web turn 里，服务端会把当前会话的
runtime context 文件路径注入到 turn 指令中，skill 再通过这个文件读取当前登录
用户、邮箱和项目上下文。

## Runtime 状态

输入框上方的状态表示 runtime 状态，不只是请求 spinner。它会根据实时 turn 事件
和刷新后的 session history 校准。

- 活跃 turn 显示 `Running`。
- 成功结束显示 `Done`。
- `interrupted`、`cancelled`、`aborted` 显示 `Stopped`。
- `401`、`403`、`429` 或 unexpected provider status 等 provider/runtime 报错
  会作为红色 system 消息展示在时间线中。

如果 Codex Web 服务在 turn 运行中重启，Codex 可能把该 turn 标为
`interrupted` 且没有 error payload。此时 UI 显示 `Stopped`，不显示红色报错，
因为这是服务生命周期打断。

## 更新已有的 macOS LaunchAgent 安装

拉取仓库更新不会热重载正在运行的 Codex Web 后端。对于由用户级 LaunchAgent
管理的现有 macOS 安装，请在仓库检出目录中拉取更新、安装依赖，然后重启服务：

```bash
git pull --ff-only
npm install
scripts/service/restart-codex-web-launchd-user.sh
```

重启后，请重新打开或刷新已安装的 PWA。

Codex Web 中显示的推理选项由 `CODEX_REAL_BIN` 所选择的 Codex CLI 动态提供。
只有当所选模型声明支持 `ultra` 时，界面才会显示该选项。仅拉取本仓库不会升级
Codex CLI，也不会为所选运行时增加新能力。

## 服务安装

### macOS launchd

安装用户级 LaunchAgent：

```bash
scripts/service/install-codex-web-launchd-user.sh
```

服务管理脚本：

```bash
scripts/service/status-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user-detached.sh
scripts/service/logs-codex-web-launchd-user.sh
scripts/service/rotate-codex-web-logs.sh
scripts/service/stop-codex-web-launchd-user.sh
scripts/service/uninstall-codex-web-launchd-user.sh
```

当需要从 Codex 控制中的运行时重启 Codex Web 自身时，使用 detached 重启脚本。
卸载脚本会保留 `~/.config/codex-web/service.env` 和 `~/.codex-web/`。部署需要
自定义服务 label 时可设置 `CODEX_WEB_LAUNCHD_LABEL`。
安装器还会创建每小时运行一次的 `${CODEX_WEB_LAUNCHD_LABEL}.logrotate`
LaunchAgent。它通过 copy-truncate 轮转，不重启正在运行的服务；默认每个日志达到
10 MiB 时轮转并保留 5 代，阈值和代数由 `service.env` 中的
`CODEX_WEB_LOG_MAX_BYTES`、`CODEX_WEB_LOG_GENERATIONS` 控制。

### Linux systemd

创建服务环境文件：

```bash
mkdir -p ~/.config/codex-web ~/.codex-web/logs
cat > ~/.config/codex-web/service.env <<EOF
CODEX_WEB_HOST=0.0.0.0
CODEX_WEB_PORT=43210
CODEX_WEB_DEFAULT_CWD=$(pwd)
CODEX_REAL_BIN=codex
CODEX_WEB_DEBUG=0
EOF
chmod 600 ~/.config/codex-web/service.env
```

创建并启动用户服务：

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/codex-web.service <<EOF
[Unit]
Description=Codex Web mobile console
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
EnvironmentFile=%h/.config/codex-web/service.env
ExecStart=/usr/bin/env npm run serve --workspace packages/codex-web
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now codex-web.service
systemctl --user status codex-web.service
```

查看日志：

```bash
journalctl --user -u codex-web.service -f
```

## 安装为 PWA

服务启动后，用手机浏览器打开 Codex Web，并在该设备上完成一次登录。

iPhone / iPad：用 Safari 打开，点 `分享`，再点 `添加到主屏幕`。

Android：用 Chrome 打开，打开浏览器菜单，再点 `Install app` 或
`Add to Home screen`。

更多说明见 [docs/pwa-setup.md](docs/pwa-setup.md)。

## 设计文档

当前设计和实现记录：

```text
docs/superpowers/specs/2026-05-17-codex-web-design.md
docs/superpowers/specs/2026-05-19-codex-mobile-reports-design.md
docs/superpowers/specs/2026-05-23-codex-web-desktop-workspace-design.md
docs/superpowers/specs/2026-05-27-codex-web-multi-user-rbac-design.md
docs/superpowers/specs/2026-05-28-role-project-new-session-design.md
docs/superpowers/specs/2026-05-29-codex-web-workspace-redesign-design.md
docs/superpowers/specs/2026-05-30-codex-web-attachments-design.md
docs/superpowers/specs/2026-06-01-session-card-first-message-design.md

docs/superpowers/plans/2026-05-17-codex-web-mvp.md
docs/superpowers/plans/2026-05-23-codex-web-desktop-workspace.md
docs/superpowers/plans/2026-05-27-codex-web-multi-user-rbac.md
docs/superpowers/plans/2026-05-28-role-project-new-session.md
docs/superpowers/plans/2026-05-29-codex-web-workspace-redesign.md
docs/superpowers/plans/2026-05-30-codex-web-attachments.md
docs/superpowers/plans/2026-06-01-session-card-first-message.md
docs/superpowers/plans/2026-06-01-timeline-error-ordering.md
```

视觉参考：

```text
docs/assets/codex-web-reference.jpg
```
