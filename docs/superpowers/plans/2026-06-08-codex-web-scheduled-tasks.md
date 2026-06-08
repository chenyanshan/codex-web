# Codex Web Scheduled Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local scheduled-task runner so OS timers can create a new Codex Web session and submit a configured prompt.

**Architecture:** Codex Web owns task configuration, execution, locking, session creation, turn start, and optional archival. macOS launchd and Linux systemd user timers only invoke `codex-web task run <taskId>`; no browser token or HTTP API call is required.

**Tech Stack:** Node 24, TypeScript, node:test, existing `CodexWebRuntime`, `FileIdentityStore`, launchd plists, systemd user service/timer files.

---

### Task 1: Task Store

**Files:**
- Create: `packages/codex-web/src/task_store.ts`
- Test: `packages/codex-web/test/task_store.test.ts`

- [ ] Write failing tests for loading `~/.codex-web/tasks/<taskId>/task.json` plus `prompt.md`, daily schedule normalization, default archive behavior, and invalid ids.
- [ ] Implement `FileScheduledTaskStore` with focused parsing and validation.
- [ ] Run `npm run test --workspace packages/codex-web -- task_store.test.ts`.

### Task 2: Task Runner

**Files:**
- Create: `packages/codex-web/src/task_runner.ts`
- Test: `packages/codex-web/test/task_runner.test.ts`

- [ ] Write failing tests for `runScheduledTask`: creates a titled session, sends the prompt, prevents overlapping runs with a lock file, and archives on completion by default.
- [ ] Implement `runScheduledTask` using injected runtime and optional identity store.
- [ ] Run `npm run test --workspace packages/codex-web -- task_runner.test.ts`.

### Task 3: Scheduler Adapters

**Files:**
- Create: `packages/codex-web/src/task_scheduler.ts`
- Test: `packages/codex-web/test/task_scheduler.test.ts`

- [ ] Write failing tests for macOS launchd plist rendering and Linux systemd service/timer rendering.
- [ ] Implement pure rendering helpers plus install/status/uninstall command plans.
- [ ] Run `npm run test --workspace packages/codex-web -- task_scheduler.test.ts`.

### Task 4: CLI Integration

**Files:**
- Modify: `packages/codex-web/src/cli.ts`
- Test: `packages/codex-web/test/cli.test.ts`

- [ ] Write failing tests for parsing `task run/install/uninstall/status <taskId>`.
- [ ] Implement CLI dispatch and dependency injection hooks for tests.
- [ ] Run `npm run test --workspace packages/codex-web -- cli.test.ts`.

### Task 5: Verification

**Files:**
- Modify as needed from Tasks 1-4.

- [ ] Run `npm run test --workspace packages/codex-web -- task_store.test.ts task_runner.test.ts task_scheduler.test.ts cli.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Commit the scheduled-task implementation.
