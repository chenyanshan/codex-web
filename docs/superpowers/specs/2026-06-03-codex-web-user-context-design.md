# Codex Web User Context Design

## Goal

Add a small Codex Web specific user-context bridge so Codex skills can discover
the currently logged-in Codex Web user when a turn needs that information.

At the same time, extend Codex Web users with an `email` field and expose it in
the admin console.

## Scope

- Add `email` to the persisted user model and admin APIs/UI.
- Write a sanitized runtime context file for writable Codex Web turns.
- Pass a short `developerInstructions` pointer so Codex can discover the
  runtime context on demand.
- Add a repository skill that explains how to read the projected context.

## Non-Goals

- Do not treat projected context as an authorization source.
- Do not project passwords, tokens, hashes, grants, cwd secrets, or other
  backend-only metadata into Codex-readable files.
- Do not build full per-user prompt-profile editing in this change.

## Design

Persist the authoritative user record in `identity.json` as before, now with an
optional normalized `email` field.

For each writable turn started through the authenticated Codex Web session path,
the server writes a sanitized projection under:

```text
~/.codex-web/runtime-context/sessions/<appSessionId>.json
```

The file includes:

- schema version
- app session id
- Codex thread id
- owner username
- owner email when configured
- owner display label derived from username for now
- project id and display name
- updated timestamp

The server also passes a short `developerInstructions` string into the turn:

- identify that the turn originated from Codex Web
- include the runtime-context file path
- tell Codex to use the `codex-web-user-context` skill when the current web
  user context is needed

The runtime keeps treating this as optional behavior layered on top of normal
turn input. If the skill is never used, the turn still behaves normally.

## Testing

- identity store persists and normalizes `email`
- admin user create/list/update include `email`
- admin UI renders and submits an email field
- server start-turn writes the projected runtime context file
- runtime forwards `developerInstructions` to the native client
