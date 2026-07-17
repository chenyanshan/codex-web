# Codex Web

English | [中文](README.zh-CN.md)

Self-hosted web console for controlling a local logged-in Codex runtime from a
phone, tablet, or desktop browser.

The browser is only a remote UI. The Mac or Linux host keeps Codex credentials,
starts the Codex runtime, reads and writes local project files, executes shell
commands, and stores app state. Tunnel and reverse-proxy setup are intentionally
outside this repository.

> Ask Codex to install it:
> `Help me install https://github.com/chenyanshan/codex-web/blob/main/README.md`

## Core Highlights

### 1. Remote Codex control from anywhere

Codex Web keeps Codex credentials, shell execution, and local file access on the
host machine, while your phone or browser becomes a remote console. When
combined with your own tunnel or reverse proxy, it becomes a practical way to
reconnect and operate Codex remotely at any time without moving execution into
the browser.

| Mobile remote console | Desktop workspace |
| --- | --- |
| ![Mobile recent sessions view](docs/assets/readme/mobile-recents.png) | ![Desktop workspace view](docs/assets/readme/desktop-workspace.png) |

- Remote UI for phone, tablet, and desktop browsers.
- Project-first workspace with live sessions, chat, and turn status.
- Fits LAN-only installs and remote-access setups built with your own network
  edge.

### 2. Multi-user facade for fully trusted teams

Codex Web includes a Web-layer multi-user facade for teams whose members fully
trust one another. RBAC controls what the Web UI and HTTP API expose, but it is
not tenant, OS-user, process, Codex-runtime, or filesystem isolation. Every turn
still executes as the same host user with access allowed by that Codex runtime.
Untrusted users must be separated with distinct OS users, containers, or hosts.

| Mobile admin audit | Desktop user management |
| --- | --- |
| ![Mobile admin console with session audit](docs/assets/readme/mobile-admin-audit.png) | ![Desktop admin console with user and role management](docs/assets/readme/admin-user-management.png) |

- Multi-user mode, project management, role management, and user management for
  a fully trusted group.
- Web-layer RBAC for project access, admin operations, and observer mode.
- Session audit views for reviewing activity across users, projects, and
  sessions.

## What It Does

- Password-protected single-host Codex web console.
- PWA-friendly mobile UI with persistent per-device browser sessions.
- Project-first responsive workspace: wide landscape desktops use a project
  rail, session list, and chat pane; narrow or portrait desktops use a focused
  single-session layout with a desktop-sized composer; phones use a project
  drawer.
- Weak-network resilience with cached session summaries, bounded conversation
  histories for the five most recently used sessions, and locally persisted
  optimistic and queued text messages.
- Earlier exchanges expand when you scroll upward at the top of a desktop
  conversation or pull down at the top of the timeline in the installed PWA.
- Live Codex turn stream with assistant deltas, final answers, command batches,
  file-change batches, approval requests, and runtime errors.
- Multi-user/RBAC facade for fully trusted users, project access, admin
  management, and observer mode.
- Optional read-only share links open a dedicated conversation page. Public
  sharing is disabled by default and must be explicitly enabled by the operator.
- File and image attachments for turns, including direct clipboard paste on
  desktop browsers. The backend stores files locally and passes safe local
  paths to Codex.
- Model and reasoning choices from the active Codex CLI, with current-session
  controls kept separate from per-browser defaults for new sessions.
- Session-scoped file previews for Markdown, HTML, PDF, common images, web
  links, and retained attachments directly from the conversation.
- A bundled `codex-web-user-context` skill for discovering the current Codex
  Web user/project context from a server-projected runtime file.
- macOS launchd service helpers and Linux systemd setup instructions.
- English and Simplified Chinese UI language setting, plus a backend-managed
  site title for admins/single-user installs.
- Six contrast-checked themes with Sunlit yellow as the first-run default,
  including Paper, Graphite, Nordic, Forest, and Rose alternatives.

## Repository Layout

```text
packages/codex-native-api   reusable Codex app-server integration
packages/codex-web          HTTP API, auth, runtime bridge, and web UI
scripts/install             AI-guided installer scripts
scripts/service             launchd service helpers
skills/codex-web-user-context current Codex Web user/project context skill
docs/superpowers/specs      design docs
docs/superpowers/plans      implementation plans
docs/rendering              local Markdown/file rendering fixtures
```

This repository was split out from `CodexBridge-main`.

## Requirements

- Node.js `>=24`
- npm
- local Codex CLI installed
- local Codex login at `~/.codex/auth.json` or `CODEX_HOME/auth.json`

## Quick Start

Install dependencies:

```bash
npm install
```

Set the web password:

```bash
npm run codex-web -- auth set-password
```

Start the web service:

```bash
npm run serve
```

By default the service listens on `0.0.0.0:43210`, so phones on the same LAN can
reach it. `http://127.0.0.1:43210` is reachable only from the host machine.
Before entering a password from another device, put the service behind your own
HTTPS reverse proxy, tunnel, or private-network HTTPS endpoint; bearer tokens
and passwords are not protected on plain LAN HTTP, and Service Workers require
a secure context.

Run checks:

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

The browser suite uses Playwright and its local fixture server:

```bash
npx playwright install chromium
npm run test:browser
```

## AI Install

Use the root [install.md](install.md) when asking Codex or another coding agent
to install this project from a GitHub blob link or local checkout.

Example Codex request:

```text
Help me install https://github.com/chenyanshan/codex-web/blob/main/README.md
```

Expected agent behavior:

- If the user provides a GitHub `README.md` or `install.md` blob link, derive
  the repo root and follow `install.md`.
- If the user says "help me install this project" from inside a local checkout,
  find the repo root and follow `install.md`.
- On macOS, ask whether launchd autostart should be installed. Never ask the
  user to send a password in agent chat; the installer opens a hidden terminal
  prompt directly.
- On Windows, stop and report that this repository does not provide a Windows
  installer.

The automated macOS flow uses:

```text
install.md
scripts/install/install-codex-web-macos.sh
```

The installer handles dependency install, password setup, service start,
optional launchd autostart, and installation of the bundled user-context skill.

## Configuration

Runtime state lives outside the repo.

Default paths:

```text
~/.config/codex-web/service.env
~/.codex-web/auth.json
~/.codex-web/identity.json
~/.codex-web/session-settings.json
~/.codex-web/session-timeline.json
~/.codex-web/logs/
~/.codex-web/reports/
~/.codex-web/report-index.json
~/.codex-web/uploads/
~/.codex-web/tasks/
```

`reports/` and `report-index.json` are retained only so links created by older
Codex Web versions keep working. New session files stay in their current
project or attachment storage; Codex Web no longer uses a global Reports area.

`auth.json` stores single-user password and session-token hashes.
`identity.json` stores multi-user password, session-token, and share-capability
hashes together with Web-layer authorization metadata. Neither file stores
plaintext passwords or bearer tokens. For authentication, the browser stores
only an opaque session token. Do not store `CODEX_WEB_PASSWORD` in
`service.env`.

For non-interactive first setup, the one-time `CODEX_WEB_PASSWORD` environment
variable is supported, but it should only be injected by a local secret manager.
Do not put a literal password in shell history or a service env file.

The generated service env includes these core defaults:

```env
CODEX_WEB_HOST=0.0.0.0
CODEX_WEB_PORT=43210
CODEX_WEB_DEFAULT_CWD=/Users/you/path/to/codex-web
CODEX_REAL_BIN=codex
CODEX_WEB_DEBUG=0
CODEX_WEB_PUBLIC_SHARES_ENABLED=false
CODEX_WEB_PUBLIC_SHARE_TTL_SECONDS=86400
```

Edit `~/.config/codex-web/service.env` to change host, port, default working
directory, or Codex binary. To restrict access to the local machine only:

```env
CODEX_WEB_HOST=127.0.0.1
```

Public share capabilities stay hidden and all `/api/share/*` routes return not
found unless `CODEX_WEB_PUBLIC_SHARES_ENABLED=true`. When enabled, new links
default to a 24-hour TTL set by `CODEX_WEB_PUBLIC_SHARE_TTL_SECONDS` and are
capped at seven days. A share is also invalid after revocation or after
multi-user mode is disabled. Treat a share URL as a bearer capability.

### Browser cache and weak networks

Codex Web shows cached session summaries immediately and then refreshes them
from the host in the background. It also keeps bounded conversation data for up
to five recently used sessions in browser-local storage. Stable sessions can
therefore reopen quickly on a slow link, while newer server state is still
reconciled when connectivity allows.

An optimistic user message is persisted before its turn request completes.
Plain-text follow-up messages queued while a turn is running also survive a
reload and are retried after the active turn is reconciled. Attachments cannot
be queued while a turn is running.

This is weak-network recovery, not a fully offline Codex runtime. Starting
turns, uploading files, and refreshing server state still require connectivity
to the host; the Service Worker caches only the static application shell. The
browser cache can contain conversation text, so use trusted browser profiles
and clear site data when retiring a device.

### Storage lifecycle

Codex Web cleans only files it owns by managed filename or legacy report
extension; it does not follow symlinks or delete unrelated project files.
Cleanup runs at startup, before managed writes, and before legacy report
access. Files opened from a project by the session viewer are not managed or
deleted by Codex Web. When a quota is full, expired managed files go first,
then the oldest managed files.

| Managed data | Default policy | Configuration |
| --- | --- | --- |
| State uploads, turn snapshots, legacy reports, runtime context | 2 GiB total | `CODEX_WEB_MANAGED_STORAGE_MAX_BYTES` |
| Project-local uploads | 512 MiB per project | `CODEX_WEB_PROJECT_UPLOAD_MAX_BYTES` |
| Uploaded source files | 7-day TTL | `CODEX_WEB_UPLOAD_TTL_SECONDS` |
| Turn attachment snapshots | 30-day TTL | `CODEX_WEB_TURN_ATTACHMENT_TTL_SECONDS` |
| Legacy reports | 365-day TTL | `CODEX_WEB_REPORT_TTL_SECONDS` |
| Runtime context files | 30-day TTL | `CODEX_WEB_RUNTIME_CONTEXT_TTL_SECONDS` |
| App timeline | 500 entries per session, 16 MiB total | `CODEX_WEB_TIMELINE_MAX_ENTRIES_PER_SESSION`, `CODEX_WEB_TIMELINE_MAX_BYTES` |

Legacy files under `~/.codex-web/reports/` remain subject to their configured
retention and quota. This policy exists for backward compatibility and does not
apply to files in a session's project directory.

## Attachments

The composer can upload files and images for the next Codex turn. On desktop
browsers, clipboard files and images can also be pasted directly into the
composer. All upload routes require authentication.

Writable project directory:

```text
<project-cwd>/uploads/<user-id>/
```

Fallback storage:

```text
~/.codex-web/uploads/projects/<project-key>/<user-id>/
```

The backend returns the actual `localPath` and validates attachment paths
against allowed upload roots before starting a turn. Images are passed to Codex
as local images; other files are listed in the turn prompt with local paths.

Upload limits:

```text
32 MiB request body
25 MiB per file
```

Uploaded source files and immutable turn snapshots are also subject to the
storage lifecycle policy above.

Attachments shown in existing session history remain clickable while their
stored source or immutable turn snapshot still exists. An attachment already
removed by its retention policy cannot be reconstructed and is shown as
unavailable.

## Session File Viewer

Files are part of the conversation rather than a separate Reports product. When
the assistant links a file in the current project, the link opens directly from
that session. Relative paths resolve from the session project root, and access
is restricted to that project and the session's authorized attachment roots.

- Markdown renders with the conversation Markdown renderer.
- Self-contained static HTML renders in a sandboxed viewer; scripts and
  relative or remote subresources are blocked.
- PDF and common image formats open in the in-app viewer.
- HTTP and HTTPS links open as normal web links and are not proxied by the
  backend.

New installs do not ship or install a report-generation skill. Existing links
under `~/.codex-web/reports/` remain readable through authenticated compatibility
routes, but there is no global Reports list or favorite workflow. An existing
`~/.codex/skills/codex-mobile-report` directory is outside this repository and
is not modified during upgrades; remove it manually if it is no longer needed.

## User Context Skill

The Codex Web user-context skill lives at:

```text
skills/codex-web-user-context
```

Install it into local Codex skills:

```bash
mkdir -p ~/.codex/skills
mkdir -p ~/.codex/skills/codex-web-user-context
cp -R skills/codex-web-user-context/. ~/.codex/skills/codex-web-user-context/
```

For active development, symlink it instead:

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/codex-web-user-context" ~/.codex/skills/codex-web-user-context
```

This skill is bundled in the repository and should be installed into the local
system Codex skills directory at `~/.codex/skills/` like the other shipped
skills. During Codex Web turns, the server projects a small runtime context
file and injects its absolute path into the turn instructions so the skill can
discover the current authenticated Codex Web user, email, and project context.

## Runtime Status

The status above the composer is the runtime state, not a request spinner. It is
reconciled from live turn events and refreshed session history.

- Active turns show `Running`.
- A recoverable stream interruption shows `Reconnecting` while the turn remains
  active.
- Idle sessions and successful terminal turns show `Ready`.
- Interrupted, cancelled, or aborted turns show `Stopped`.
- Provider/runtime failures show `Failed`; details such as `401`, `403`, `429`,
  or unexpected provider statuses are rendered as red system messages in the
  conversation timeline.

If the Codex Web service restarts while a turn is in progress, Codex may mark
that turn as `interrupted` without an error payload. The UI shows `Stopped`
instead of a red error because the turn ended due to service lifecycle
interruption.

## Updating An Existing macOS LaunchAgent Install

Repository updates do not hot-reload the running Codex Web backend. For an
existing macOS install managed by the user LaunchAgent, run the following from
the repository checkout to pull the update, install dependencies, and restart
the service:

```bash
git pull --ff-only
npm install
scripts/service/restart-codex-web-launchd-user.sh
```

After the restart, reopen or refresh the installed PWA.

The model catalog, configuration defaults, and advertised reasoning choices
shown by Codex Web come from the Codex CLI selected by `CODEX_REAL_BIN`. Unless
the browser has an explicit override for new sessions, the UI follows those
defaults instead of a fixed legacy `gpt-5.4` / `xhigh` pair. The selected model
must advertise `ultra` for that choice to appear. Pulling this repository does
not upgrade the Codex CLI or add capabilities to the selected runtime.

## Service Install

### macOS launchd

Install the user LaunchAgent:

```bash
scripts/service/install-codex-web-launchd-user.sh
```

Service helpers:

```bash
scripts/service/status-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user-detached.sh
scripts/service/logs-codex-web-launchd-user.sh
scripts/service/rotate-codex-web-logs.sh
scripts/service/stop-codex-web-launchd-user.sh
scripts/service/uninstall-codex-web-launchd-user.sh
```

Use the detached restart helper when Codex Web needs to restart itself from a
running Codex-controlled session. Uninstalling preserves both
`~/.config/codex-web/service.env` and `~/.codex-web/`. Set
`CODEX_WEB_LAUNCHD_LABEL` when a deployment needs a custom service label.
The installer also creates an hourly `${CODEX_WEB_LAUNCHD_LABEL}.logrotate`
LaunchAgent. It copy-truncates logs without restarting the running service,
keeps five private generations at 10 MiB each by default, and reads
`CODEX_WEB_LOG_MAX_BYTES` plus `CODEX_WEB_LOG_GENERATIONS` from `service.env`.

### Linux systemd

Create the service environment:

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

Create and start a user service:

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

Read logs:

```bash
journalctl --user -u codex-web.service -f
```

## Install As PWA

After the server is running, open Codex Web from your phone browser and log in
once.

On iPhone or iPad: open in Safari, tap `Share`, then `Add to Home Screen`.

On Android: open in Chrome, open the browser menu, then tap `Install app` or
`Add to Home screen`.

More notes: [docs/pwa-setup.md](docs/pwa-setup.md).

## Design Docs

Design and implementation notes are listed below. For file workflows, the
Session File Viewer design is authoritative; Report requirements in earlier
documents are historical compatibility context.

```text
docs/superpowers/specs/2026-05-17-codex-web-design.md
docs/superpowers/specs/2026-07-17-session-file-viewer-design.md
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

Visual reference:

```text
docs/assets/codex-web-reference.jpg
```
