# Codex Web User Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex Web user-context projection for skills and extend users with an email field in storage, API, and admin UI.

**Architecture:** Extend the existing identity store and admin surface with a normalized optional `email` field, then project a sanitized per-session context file from the authenticated server path before writable turns begin. Reuse the existing `developerInstructions` turn parameter to point Codex at the projected context and add a small repo-local skill describing how to consume it.

**Tech Stack:** Node.js, TypeScript, existing Codex Web server/runtime modules, browser-side vanilla JS admin UI, Node test runner.

---

### Task 1: Lock backend behavior with tests

**Files:**
- Modify: `packages/codex-web/test/identity_store.test.ts`
- Modify: `packages/codex-web/test/server_multi_user.test.ts`
- Modify: `packages/codex-web/test/runtime.test.ts`

- [ ] Add failing tests for normalized user email persistence and update behavior.
- [ ] Add failing tests for runtime forwarding `developerInstructions`.
- [ ] Add failing tests for multi-user turn start writing a runtime-context file and passing a context pointer into the turn.

### Task 2: Implement backend model and runtime-context projection

**Files:**
- Modify: `packages/codex-web/src/identity_store.ts`
- Modify: `packages/codex-web/src/runtime.ts`
- Modify: `packages/codex-web/src/server.ts`

- [ ] Extend user types and normalization with optional `email`.
- [ ] Allow admin create/update/list routes to accept and present `email`.
- [ ] Add runtime support for optional `developerInstructions` on turn input.
- [ ] Add server-side runtime-context file projection under `stateDir/runtime-context/sessions/`.

### Task 3: Lock admin UI behavior with tests

**Files:**
- Modify: `packages/codex-web/test/public_ui.test.ts`

- [ ] Add failing tests for rendering the admin user email field and submitting it in create/update requests.

### Task 4: Implement admin UI and repo skill

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Create: `skills/codex-web-user-context/SKILL.md`
- Create: `skills/codex-web-user-context/agents/openai.yaml`

- [ ] Add admin form and user-row email support.
- [ ] Add the Codex Web user-context skill metadata and usage instructions.

### Task 5: Verify

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `install.md`

- [ ] Document the new skill alongside the existing bundled skill docs.
- [ ] Run focused tests and `npm run typecheck`.
