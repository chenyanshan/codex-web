# app-server 候选版本验证、升级与回退

适用于 Codex Web 的本机 CLI；默认不下载、不更新、不重启任何服务。运行命令前将 Node 24 的目录放在 PATH 首位。本机为 `/home/ubuntu/workspace/.local/node-v24.16.0/bin`。

## 1. 选择候选并记录来源

从官方 [GitHub 稳定发布](https://github.com/openai/codex/releases/latest) 与 [npm registry](https://registry.npmjs.org/@openai/codex/latest) 交叉确认。2026-09-25 北京时间核实最新稳定为 **0.156.1**，发布于 `2026-09-23T02:41:36Z`，标签 `rust-v0.156.1` 对应提交 `b412ff32c417f855c2b2d1581b77058eed87c84b`。不要把 main 当作发布版。

可由维护者明确执行隔离安装，版本必须写死，并保存 npm 的 integrity/lock 信息：

```bash
candidate_dir=$(mktemp -d /tmp/codex-candidate.XXXXXX)
npm install --prefix "$candidate_dir" --no-audit --no-fund --ignore-scripts @openai/codex@0.156.1
"$candidate_dir/node_modules/.bin/codex" --version
```

候选目录不是生产安装位置。不要运行全局升级后直接重启。包装器路径和实际 native binary 可能不同；报告记录传入文件解析符号链接后的路径及其 SHA-256。如果传的是 JS 包装器，该 hash 仅证明包装器内容；原生文件 hash 另行记录。运行中的 app-server 路径/版本以服务管理员诊断为准，磁盘上的 `codex --version` 不能证明正在运行的版本。

## 2. 不使用推理额度的核心检查

```bash
node --conditions=development --import tsx scripts/app-server/compatibility.ts --codex-bin /absolute/path/to/codex --report /tmp/codex-compat.json
node --import tsx --test scripts/app-server/support.test.ts
```

入口复用项目 `CodexAppClient`；创建临时项目、独立 HOME/CODEX_HOME、随机 loopback 端口，只继承 PATH 和基本 locale，不读取真实登录文件、配置或项目。报告包括精确版本/路径/hash、检查结果、未执行项。关闭自己启动的子进程后删除临时状态；不会触碰生产 service/env 或历史。

检查：稳定生成协议的必需方法、initialize、thread/start、读取已加载快照、thread/list、config/read、skills/list、MCP 状态和取消订阅。未知版本也可以通过检查，版本号没有白名单。可选接口仅在 JSON-RPC `-32601` 时报告不支持；鉴权、超时和服务故障必须失败。

新线程在第一次 turn 前没有持久化历史，因此默认模式明确把**持久化恢复和真实模型执行标为未执行**；它不是全部功能通过证明。审批、文件写入、断线恢复和浏览器显示仍需各自的回归测试。

## 3. 显式真实模型冒烟

该命令消耗一次真实推理额度。仅在已授权的测试账号/服务上执行。将现有密钥通过安全的环境变量注入方式提供给进程，不在 shell 历史、命令参数、报告或仓库写入密钥；不复制 `auth.json`。

```bash
node --conditions=development --import tsx scripts/app-server/compatibility.ts --codex-bin /absolute/path/to/codex --report /tmp/codex-smoke.json --model-smoke --model MODEL_ID --api-key-env CODEX_COMPAT_API_KEY --base-url https://provider.example/v1
```

`CODEX_COMPAT_API_KEY` 必须事先存在于调用进程环境。只把选定变量传给临时 app-server，临时 config.toml 只记录变量名和非敏感 provider 参数。默认 prompt 要求返回 `CODEX_COMPAT_OK` 且不使用工具，read-only sandbox、never 审批、low effort、90 秒等待上限。检查真实完成终态、官方历史及取消订阅后的恢复；不将 mock provider 当作真实模型验证。失败报告故意不输出原始 provider 错误，避免泄露凭据；按失败阶段定位，并在本地受控环境排查。

## 4. 类型更新和兼容判定

```bash
node scripts/app-server/generate-protocol.mjs --codex-bin /absolute/path/to/codex --out packages/codex-native-api/src/app_server/generated --source-commit RELEASE_COMMIT
npm run typecheck
```

`stable/` 和完整 `experimental/` 分开保存；manifest 记录原始及 NodeNext 路径规范化后的每文件 hash、版本、二进制 hash、生成命令。复核新增/删除方法、字段、枚举和实验标记；不要将生成成功等同运行兼容。只为现有功能使用实验接口。启动生产服务不会生成源码。

本轮无推理检查：**0.156.1 与 0.153.4 通过**。0.156.1 原生二进制 SHA-256 为 `0b2e9301d6100dddda3b9d5c80ebaeaa3a2f1962388f2f36f6b96a9f08b1f33f`。真实模型冒烟及产品验收结果另见实施记录；仅这两个版本的上述检查有证据，不能外推其他版本或完整支持范围。

两版的真实模型、官方完成和持久化恢复也已通过，0.156.1 在最终源码上重跑。可持久查看的报告及其测试范围见[实现与验收记录](../audits/2026-09-25-app-server-implementation.zh-CN.md)。

## 5. 空闲切换及回退

1. 保存当前适配代码版本、构建、CLI 原生路径/hash/版本、候选报告和配置位置。确认当前服务由 systemd 管理且 Node 24 在 PATH 前部。读取 `systemctl --user cat codex-web.service` 的完整 unit 和附加配置，检查 `ExecStartPre`、依赖服务、解释器路径和日志位置；仅查看 `ExecStart` 不足以完成部署预检。
2. **停服前完成所有适用的只读启动校验**。本机有网关契约源码验证，按第 6 节执行 `verify.py --check`；记录过期时使用服务相同的 Python/Node 路径重跑完整验证，全部通过后再执行 `--check`。不得手工伪造验证记录、删除启动检查，或等旧服务已经停止后才发现验证过期。其他主机以实际 unit 为准，不应盲目重复执行可能有副作用的 `ExecStartPre` 命令。
3. 暂停新任务入口，核对活跃 turn、待审批、定时任务和 Webhook 入站；等待活跃任务结束。不能把观察断线视为任务结束，也不能为了重启静默终止用户任务。临停服前再次确认校验记录仍匹配源码；后续又改源码时重新验证。
4. 停写并保存一致性状态快照，再通过既有 `scripts/service/restart-codex-web-systemd-user.sh` 切换，禁止另开 nohup 服务。验证 systemd active、直连及公网 HTTP 200、新资源版本与未登录 API 401；核实管理员诊断中的实际运行版本，再检查登录鉴权、SSE、历史恢复及一条受控任务。只完成后台启动或计划了重启，不能宣布切换成功。
5. 观察恢复失败、重复事件、未知终态和子进程数量，保留不含原始敏感内容的报告。
6. **适配代码回退**：恢复已保存的代码/构建并重复健康检查及源码契约验证。**CLI 回退**：先确认新版配置、历史、数据库仍可被旧版读取；未知或不兼容时停止自动回退。停写后做一致性备份，另行制定恢复路径。不要让旧二进制直接打开不兼容数据，也不要静默用旧备份覆盖新历史。

相关优化映射：本工具检查/隔离涉及 OPT-01（有界超时）、OPT-20（拥有的子进程及临时状态清理）、OPT-21（凭据/状态隔离）。未替换这些产品实现；前端缓存、草稿、阅读位置、附件和 SSE 的其余 OPT 项不由此脚本验证，必须保留各自回归证据。

## 6. 本机部署结果与附加启动校验

2026-09-25 更新：CLI 0.156.1 已安装并完成真实协议复验。首次独立切换任务因未更新网关源码验证记录而启动失败，造成 Web 502。完成 529 项相关测试并更新验证记录后，systemd 于北京时间 02:18:16 恢复服务；公网返回新版资源，buildId 为 `81b582c9a575ae1cd3ce`。已进一步确认实际运行的 app-server 为 0.156.1、旧会话历史可读，并完成一次临时只读真实模型回复。原失败结果、恢复证据和验收限制见[生产切换记录](../audits/2026-09-25-app-server-cutover.zh-CN.md)。不要重复执行原一次性切换任务。

后续维护若当前对话在 `codex-web.service` 的 cgroup 内运行，重启会终止它；在独立 SSH/宿主机终端执行经过预检的切换，并持续观察结果。不能将延时任务已排队当作恢复成功。

本机附加启动检查位于 `~/.config/systemd/user/codex-web.service.d/gateway-contract.conf`。在任何停服操作前，以与 unit 相同的解释器执行以下只读命令：

```bash
/usr/bin/python3 /home/ubuntu/workspace/agent-messaging-gateway/scripts/verify.py \
  --check \
  --aiops-root /home/ubuntu/workspace/AIOps \
  --codex-web-root /home/ubuntu/workspace/codex-mobile-web-app \
  --node-bin /home/ubuntu/workspace/.local/node-v24.16.0/bin/node \
  --stamp /home/ubuntu/workspace/agent-messaging-gateway/state/verification.json
```

若提示源码/解释器变化，保持旧服务运行，使用相同命令移除 `--check` 来执行完整验证。只有测试、格式、lint、类型检查全部通过且零跳过，验证程序才会写入新记录。然后再次运行上述只读命令。测试失败时先修复具体兼容性问题，不能绕过校验继续重启。此验证依赖本机的网关与工作流仓库；不要求没有安装该附加配置的主机运行它。

本机 service.env 中 `CODEX_REAL_BIN` 仍指向 `/home/ubuntu/workspace/.local/node-v24.16.0/bin/codex`。后续追新仍需先隔离验证具体候选，再更新到相同安装位置，不能把未经验证的 `@latest` 混入一次已验证的切换。

此次材料保存在 `~/.codex-web/upgrade-backups/2026-09-25-app-server-refactor/`：原 tracked 源码与用户原有补丁、实际运行的 0.153.4 原生二进制、hash manifest，以及首次停服后保存的 `state-before-cutover/` 状态快照。依赖、原未跟踪源码、凭据、诊断日志和用户项目不属于完整备份范围；源码恢复需在独立目录重建/验证，数据恢复必须先确认新版写入情况和兼容性，不得直接解压覆盖当前工作区或历史。

按第 5 节完成预检后再暂停新会话提交、定时任务与 Webhook 入站，并确认既有 turn、审批均已结束。仅看到页面“断线”不能判定空闲。本项目当前没有可在服务外原子封锁全部入口的发布闸门；不能称无中断自动升级。如果仍有新任务进入，延后切换。切换后依次验证：

1. `scripts/service/status-codex-web-systemd-user.sh` 显示 active，Node 24 仍在 PATH 前部，只有一套预期的服务/app-server 进程。
2. 使用管理员会话检查 `/api/metrics` 中 runtime 的 `appServer.server.version` 为 0.156.1，同时核对 binary/初始化时间。磁盘 `codex --version` 不能代替本项。未登录或非管理员不能得到该诊断。
3. 打开旧会话确认历史和已有附件，验证 SSE 接续；提交一次明确的受控测试任务并确认正式完成。浏览器缓存中的旧版本界面应按现有 PWA 完整资源更新逻辑恢复。
4. 观察恢复失败、重复事件、错误终态及进程/队列变化，确认后恢复入口，并将实测时间、运行版本和结果补入实施记录，才能勾选 S6 上线验收。

出现问题时先检查完整 unit、启动检查及重定向日志，再按第 5 节区分启动环境修复、代码和 CLI 回退。运行中的用户数据若已被新版写入，先核实兼容性；服务恢复不自动授权用旧备份覆盖新历史。
