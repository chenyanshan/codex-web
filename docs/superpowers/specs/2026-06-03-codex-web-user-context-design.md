# Codex Web User Context Design

## Goal

Provide the current authenticated Codex Web user and project to a Codex skill
only when a task explicitly needs that information. Ordinary turns must not
receive identity metadata or user-context instructions.

Codex Web users retain the optional `email` field exposed in the admin console.

## Scope

- Keep `email` in the persisted user model and admin APIs/UI.
- Expose a read-only loopback HTTP endpoint keyed by Codex thread id.
- Pass only the loopback API origin to multi-user Codex runtimes.
- Provide a cross-platform skill helper that fetches the current context on
  demand.

## Non-Goals

- Do not use this context as an authorization source.
- Do not return passwords, tokens, hashes, grants, project paths, or other
  backend-only metadata.
- Do not inject the context, endpoint instructions, or skill hints into normal
  turn prompts.
- Do not provide a session enumeration endpoint.
- Do not create a tenant or host-user isolation boundary.

## Design

The authoritative user, project, and app-session records remain in
`identity.json`. Codex already exposes the current `CODEX_THREAD_ID` to tools,
so Codex Web adds only this runtime environment value:

```text
CODEX_WEB_LOCAL_API_URL=http://127.0.0.1:<listening-port>
```

When explicitly invoked, `codex-web-user-context` runs its Node helper. The
helper validates the loopback origin and requests:

```http
GET /api/local/thread-context/<CODEX_THREAD_ID>
```

The server handles this route before bearer authentication because the real
socket peer must be `127.0.0.1`, `::1`, or IPv4-mapped `127.0.0.1`. It does not
trust `Host`, forwarded headers, or proxy metadata. Unknown threads, disabled
multi-user mode, non-loopback callers, and malformed paths return `404`.

The response uses `Cache-Control: no-store` and includes only:

- schema version
- app session id
- Codex thread id
- owner user id, username, and optional email
- project id and display name
- response timestamp

Codex Web no longer writes runtime-context files. Storage cleanup retains the
old runtime-context TTL temporarily so files created by older versions expire.

## Testing

- identity store persists and normalizes `email`
- admin user create/list/update include `email`
- loopback requests resolve distinct thread owners and projects without bearer
  authentication
- non-loopback address validation is strict and forwarded headers are ignored
- unknown threads and disabled multi-user mode return `404`
- new sessions and turns receive the actual loopback origin, including when the
  configured test port is `0`
- turns receive no user-context `developerInstructions` and no context file
- the skill helper validates its environment and fetches the expected JSON
