# AGENTS.md

## Project Purpose

This repository builds a self-hosted mobile web app for controlling Codex from a
phone while all execution remains on the current Mac. Single-user mode is the
default; optional multi-user mode is only for fully trusted users sharing that
host account and is not a tenant-isolation boundary.

The phone is only a remote UI. The backend owns Codex access, local filesystem
access, shell execution, authentication, account/session state, and service
lifecycle.

## Current Baseline

The project was split out from `CodexBridge-main`.

Imported core:

```text
packages/codex-native-api
```

This package is the current reusable Codex integration layer. It talks to the
local `codex app-server` and reuses the host's local Codex login state.

Primary design doc:

```text
docs/superpowers/specs/2026-05-17-codex-web-design.md
```

Visual reference:

```text
docs/assets/codex-web-reference.jpg
```

## Product Boundaries

Do:

- Build a self-hosted mobile web console with a single-user default and an
  explicitly trusted-team multi-user facade.
- Keep Codex credentials and local execution on the Mac.
- Require password login for remote access.
- Store browser session tokens per device so returning devices stay logged in.
- Provide launchd startup support on macOS.
- Provide systemd user-service startup support on Linux.
- Keep tunnel/reverse-proxy setup outside this project.
- Reuse `codex-native-api` and `CodexAppClient` rather than reimplementing Codex
  JSON-RPC.

Do not:

- Turn this into a hosted multi-user SaaS or claim shared-host RBAC provides OS,
  shell, or filesystem isolation.
- Store plaintext passwords.
- Expose unauthenticated APIs. The only exception is the explicitly enabled
  public-share capability flow described below; its URL token is authentication,
  not an anonymous route.
- Put Codex credentials in the browser.
- Couple the mobile UI to WeChat slash-command UX.
- Move or delete files from `CodexBridge-main` unless explicitly requested.

## Architecture Direction

Use this high-level shape:

```text
phone browser / PWA
  -> Codex Web HTTP API + SSE/WebSocket stream
  -> Codex Web backend
  -> CodexAppClient / codex-native-api runtime
  -> local codex app-server
  -> local Codex auth under CODEX_HOME or ~/.codex
```

The web backend should normalize Codex app-server events into UI events for:

- turn lifecycle
- assistant deltas
- final answers
- command batches
- file-change batches
- approval requests
- approval decisions
- errors

Prefer SSE for first-version event streaming unless a concrete requirement
needs bidirectional WebSocket behavior.

## Security Requirements

Default service binding is LAN-facing so phones on the same network can reach
the Mac without extra flags:

```text
0.0.0.0
```

All API and event-stream routes must still require authentication before
serving private Codex or local-machine state.

Authentication model:

- each user has a username, role, and salted password hash
- session tokens are random and stored hashed on the backend
- browser stores only the opaque session token
- all API and event-stream routes require a valid bearer token, except the
  opt-in `/api/share/<capability-token>/...` read-only routes
- public shares default to disabled, require
  `CODEX_WEB_PUBLIC_SHARES_ENABLED=true`, and authenticate with a random URL
  capability token that is stored hashed, expires by TTL, can be revoked, and
  becomes invalid when multi-user mode is disabled
- non-admin users can only see their own sessions, turns, approvals, and reports
- admins can manage users and inspect the aggregate chat prompt log

State should live outside the repo:

```text
~/.codex-web/
```

Service env should live outside the repo:

```text
~/.config/codex-web/service.env
```

## Engineering Rules

- Keep files focused and small.
- Prefer adapting existing `codex-native-api` interfaces over duplicating
  Codex app-server transport logic.
- Add tests with each behavioral change.
- Run `npm run typecheck` before claiming TypeScript work is valid.
- Run focused tests for changed modules before claiming behavior is working.
- Do not commit generated secrets, runtime state, logs, or local env files.

## Preserve Existing Optimizations

The user requires the 21 existing optimization capabilities in
[the preservation baseline](docs/architecture/2026-09-25-existing-optimizations-baseline.zh-CN.md)
to survive future changes, including the app-server refactor.

- Read the baseline before changes to runtime/protocol integration, networking,
  caching, rendering, attachments, storage, or service lifecycle.
- Preserve user-visible behavior, failure handling, resource bounds, and access
  controls. Internal implementations may be replaced with verified equivalents.
- Map affected changes to `OPT-01` through `OPT-21` and run relevant regression
  checks. Report unverified cases; do not remove safeguards or weaken assertions
  merely to simplify code or make a refactor pass.
- For frontend work, use the project `frontend-design` skill, retain the current
  visual style, and improve usability where justified without losing weak-network,
  draft, reading-position, or recovery behavior.

## Useful Commands

Install:

```bash
npm install
```

Typecheck imported core:

```bash
npm run typecheck
```

Run imported core tests:

```bash
npm test
```

## Current Linux Host Deployment

This checkout is installed on the Linux host at:

```text
/home/ubuntu/workspace/codex-mobile-web-app
```

The persistent service config is:

```text
/home/ubuntu/.config/codex-web/service.env
```

Runtime state and logs live under:

```text
/home/ubuntu/.codex-web/
```

Linux should run Codex Web through the user `systemd` service:

```bash
scripts/service/install-codex-web-systemd-user.sh
scripts/service/status-codex-web-systemd-user.sh
scripts/service/restart-codex-web-systemd-user.sh
scripts/service/logs-codex-web-systemd-user.sh
```

This host has Node 24 installed at:

```text
/home/ubuntu/workspace/.local/node-v24.16.0/bin/node
```

The `codex-web.service` unit must keep that directory at the front of `PATH`.
Using `/usr/bin/node` currently resolves to Node 20, which does not provide the
global WebSocket API needed by `CodexAppClient` to connect to `codex
app-server`.

If a future session finds `systemctl --user status codex-web.service` missing
but `pgrep -a -f "npm run serve|src/cli.ts serve"` shows Codex Web running, that
is an old manual process. Stop it and install the systemd service instead of
starting another manual `nohup npm run serve`.
