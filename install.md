---
ai_entrypoint: true
title: Codex Web AI Install Guide
supported_platforms:
  automated:
    - macOS
  manual:
    - Linux
unsupported_platforms:
  - Windows
primary_script: scripts/install/install-codex-web-macos.sh
required_questions:
  - autostart
---

# Codex Web Install

This file is the AI install entrypoint for this repository.

If a user shares a GitHub `README.md` or `install.md` blob URL such as:

- `https://github.com/<owner>/<repo>/blob/<ref>/README.md`
- `https://github.com/<owner>/<repo>/blob/<ref>/install.md`

the agent should derive the repository root from the URL, clone or update the
repository locally, then execute the install flow in this file from the repo
root.

If a user says "help me install this project" from inside a local checkout, the
agent should locate the repo root and use this `install.md` instead of trying to
infer steps from `README.md`.

## Platform Gate

- macOS: supported for automated install.
- Linux: use the manual setup in `README.md`.
- Windows: unsupported for this automated install flow.

If the host is Windows, stop after explaining that automated install is
unsupported and do not attempt to translate the steps.

## Questions The Agent Must Ask

Ask the user this question before running the installer:

1. Should it be installed as a macOS login/startup service?

Do not ask the user to send their password through agent chat and do not place a
password in a tool command, shell history, process argument, or environment
file. The installer prompts the user directly with terminal echo disabled.

## macOS Automated Install

From the repo root, run:

```bash
scripts/install/install-codex-web-macos.sh --autostart yes
```

or:

```bash
scripts/install/install-codex-web-macos.sh --autostart no
```

For non-interactive automation, `--password-stdin` reads exactly one line from
standard input. Feed it only from the deployment platform's secret channel;
never put a literal password in the command itself.

The installer script will:

- run `npm install`
- write the password via `npm run codex-web -- auth set-password`
- install the bundled report and user-context skills
- install or skip launchd based on `--autostart`
- install hourly private log rotation when launchd is enabled
- start the service
- print the local and LAN URLs when available

## Install The Report Skill

After the macOS installer succeeds, the agent should also install the bundled
report skill from:

```text
skills/codex-mobile-report
```

Run:

```bash
mkdir -p ~/.codex/skills
mkdir -p ~/.codex/skills/codex-mobile-report
cp -R skills/codex-mobile-report/. ~/.codex/skills/codex-mobile-report/
```

If the user plans to keep editing this repository locally, the agent may use a
symlink instead:

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/codex-mobile-report" ~/.codex/skills/codex-mobile-report
```

## Install The User Context Skill

When this repository is used with Codex Web multi-user turns, the agent should
also install the bundled user-context skill from:

```text
skills/codex-web-user-context
```

Run:

```bash
mkdir -p ~/.codex/skills
mkdir -p ~/.codex/skills/codex-web-user-context
cp -R skills/codex-web-user-context/. ~/.codex/skills/codex-web-user-context/
```

If the user plans to keep editing this repository locally, the agent may use a
symlink instead:

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/codex-web-user-context" ~/.codex/skills/codex-web-user-context
```

## How To Use After Install

After installation, the agent should explain the basic usage flow:

1. Open the printed local URL on the Mac, or the printed LAN URL on the phone.
2. Log in with the password that was set during install.
3. On iPhone or Android, follow `docs/pwa-setup.md` to add the app to the home
   screen.
4. In later Codex chats, the user can ask for a phone-readable report such as:
   `请用 codex-mobile-report 给我生成手机可读报告`
5. The report skill writes reports under:
   `~/.codex-web/reports/`
6. Codex Web lists those reports inside the mobile app.

The handoff must also state these deployment boundaries:

- Phone login and PWA use require the operator's HTTPS endpoint; plain LAN HTTP
  does not protect passwords or bearer tokens.
- Multi-user mode is a facade for fully trusted users, not tenant, OS-user, or
  filesystem isolation. Separate untrusted users by OS user, container, or host.
- Public share links are off by default. Enabling them requires
  `CODEX_WEB_PUBLIC_SHARES_ENABLED=true`; links use the configured TTL and must
  be treated as bearer capabilities.
- Managed uploads, attachment snapshots, reports, runtime context, timeline,
  and launchd logs use the quotas and retention defaults documented in
  `README.md`.

## Post-Install Handoff

After the installer succeeds, point the user to:

- `README.md` for the normal project overview
- `README.zh-CN.md` for Chinese instructions
- `docs/pwa-setup.md` for mobile PWA installation on iPhone or Android
- `skills/codex-mobile-report` for phone-readable report generation
- `skills/codex-web-user-context` for current Codex Web user/project context discovery
