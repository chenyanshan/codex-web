---
name: codex-web-user-context
description: Use only when a task explicitly needs the current authenticated Codex Web user, their email, the Codex Web app session id, or the current Codex Web project. Fetches this context on demand from the local Codex Web service.
---

# Codex Web User Context

## Overview

Fetch the current Codex Web user and project only when the task actually needs
that information. Ordinary coding turns do not need this skill.

This context is for convenience and coordination. It is not an authorization
source.

## When To Use

Use this skill only when the task explicitly requires one or more of:

- the Codex Web user who requested the work
- the user's email address
- the Codex Web app session id
- the current Codex Web project id or display name

Do not use it merely because a turn is running under Codex Web.

## Workflow

1. Locate this skill's `scripts/read-context.mjs` file.
2. Run it with Node:

```text
node <absolute-skill-directory>/scripts/read-context.mjs
```

3. Read the JSON printed to stdout.
4. Use only the fields required by the task.

The helper reads `CODEX_THREAD_ID` and `CODEX_WEB_LOCAL_API_URL` from the turn's
runtime environment. It validates that the API URL uses loopback HTTP before
requesting the context for exactly the current Codex thread.

## Expected Context Shape

```json
{
  "schemaVersion": 1,
  "appSessionId": "app_alice",
  "codexThreadId": "thread_alice",
  "owner": {
    "userId": "user_alice",
    "username": "alice",
    "email": "alice@example.com"
  },
  "project": {
    "id": "project_allowed",
    "displayName": "Allowed Project"
  },
  "updatedAt": "2026-06-03T00:00:00.000Z"
}
```

## Constraints

- Do not use this context for permission checks.
- Do not expect passwords, auth tokens, hashed secrets, or backend-only grants.
- Do not call a non-loopback URL or replace `CODEX_THREAD_ID` with another id.
- Do not probe or enumerate other sessions.
- If the helper reports that context is unavailable, say so instead of guessing.
