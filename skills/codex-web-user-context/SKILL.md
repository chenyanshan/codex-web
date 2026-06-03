---
name: codex-web-user-context
description: Use when a Codex turn needs to discover the current authenticated Codex Web user, their email, or the current Codex Web project context from a server-projected runtime context file.
---

# Codex Web User Context

## Overview

Read the Codex Web runtime context file when a task needs the current Codex Web
user or project context.

This skill is for convenience and coordination only. It is not an authorization
source.

## When To Use

Use this skill when the current turn needs details such as:

- which Codex Web user requested the work
- the user's email address
- the Codex Web app session id
- the current Codex Web project display name

The server injects a short `developerInstructions` hint with the context file
path for Codex Web turns.

## Workflow

1. Read the `developerInstructions` for the current turn.
2. Look for a line in the form:

```text
Codex Web context file: /absolute/path/to/.codex-web/runtime-context/sessions/<appSessionId>.json
```

3. Read that JSON file.
4. Use only the projected fields you need.

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

- Do not assume the file exists outside Codex Web started turns.
- Do not use this file for permission checks.
- Do not expect passwords, auth tokens, hashed secrets, or backend-only grants
  to be present.
- If the file is missing, say that the current turn does not expose Codex Web
  runtime context.
