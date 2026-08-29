# Codex Web User Context Implementation Plan

> Updated after replacing the original file-projection design. The current
> architecture is defined in
> `docs/superpowers/specs/2026-06-03-codex-web-user-context-design.md`.

**Goal:** Let a bundled skill fetch the current Codex Web user/project context
on demand without adding identity data or instructions to ordinary turns.

**Architecture:** Codex Web passes a loopback HTTP origin into multi-user Codex
runtimes. The skill combines it with Codex's existing `CODEX_THREAD_ID` and
calls a loopback-only endpoint that returns a sanitized live projection.

### Task 1: Backend behavior

- [x] Add a loopback-only thread-context endpoint before bearer authentication.
- [x] Map the Codex thread id to the app session, owner, and project.
- [x] Return `404` for remote callers, unknown threads, and disabled multi-user
  mode.
- [x] Pass the actual listening port through `CODEX_WEB_LOCAL_API_URL`.
- [x] Stop generating context files and user-context turn instructions.

### Task 2: Skill

- [x] Add a cross-platform Node helper with loopback URL validation and timeout.
- [x] Limit skill triggering to tasks that explicitly need user/project context.
- [x] Validate the skill package and helper behavior.

### Task 3: Documentation and compatibility

- [x] Document the HTTP workflow in English and Chinese READMEs.
- [x] Warn existing users to reinstall the skill and restart Codex.
- [x] Keep TTL cleanup for context files left by older versions.

### Task 4: Verification

- [x] Cover endpoint access, owner isolation, environment forwarding, and clean
  turn instructions with focused tests.
- [x] Cover helper success and failure behavior.
- [x] Run the complete repository test and typecheck suites before release.
