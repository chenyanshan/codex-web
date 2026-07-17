# Codex Web Multi-User RBAC Design

## Goal

Add a single-host multi-user facade to Codex Web. Execution remains local and
single-user at the Codex runtime layer, but Codex Web gains user login,
project-scoped RBAC, admin audit/observer APIs, and read-only share links.

## Product Model

This is not a hosted SaaS or a separate Codex runtime per user. All users share
the same Mac, Codex login state, `CODEX_HOME`, and `codex app-server`.

This mode is only for users who fully trust one another with the host account.
Codex Web authorization protects application routes and hides internal ids; it
is not an OS, process, shell, or filesystem isolation boundary. Deploy separate
OS users, containers, VMs, or hosts before admitting mutually untrusted users.

The application authorization path is:

```text
browser
  -> token-authenticated Codex Web API
  -> principal + RBAC checks
  -> app-level project/session/share metadata
  -> CodexWebRuntime
  -> CodexAppClient
  -> local codex app-server
```

The browser never receives raw project cwd values or Codex thread ids for
ordinary user flows when multi-user mode is enabled.

## Compatibility

`multiUserEnabled` defaults to `false`. In that state the existing password
login and current single-user behavior remain valid. The backend treats the
legacy authenticated session as an implicit local admin principal.

When `multiUserEnabled` is set to `true`, username/password login is accepted
for users configured in the identity store. Legacy admin tokens may continue to
act as bootstrap admin tokens so an owner is not locked out immediately after
enabling the mode.

## Data Model

State remains outside the repo under `~/.codex-web/`.

`identity.json` stores:

- `settings.multiUserEnabled`
- `users[]` with salted password hashes, role ids, and direct project grants
- `roles[]` with admin flag and project grants
- `projects[]` with internal name, cwd, and user-facing display name
- `sessions[]` mapping app session id to Codex thread id, owner user id, and
  project id
- `shares[]` with hashed share tokens mapped to app session ids

Project grants support `canRead`, `canCreate`, and `canWrite`.

## Backend Authorization

All authenticated API requests produce a `Principal`:

```ts
type Principal = {
  userId: string;
  username: string;
  roleIds: string[];
  isAdmin: boolean;
  mode: 'single' | 'multi';
};
```

Session APIs use app session ids, not Codex thread ids. The server resolves:

```text
appSessionId -> AppSession -> projectId + ownerUserId + codexThreadId
```

Then it checks the effective permissions before calling `CodexWebRuntime`.

Ordinary users may:

- list sessions they own in projects with `canRead`
- read sessions they own in projects with `canRead`
- create sessions only for projects with `canCreate`
- write turns/settings/approvals only for sessions they own in projects with
  `canWrite`

Admins bypass project grants for audit and management APIs.

Ordinary multi-user session owners may choose the same read-only, approval, or
full-access runtime presets as the local admin. Full access is the default for
new sessions. This is intentional because multi-user mode is only for fully
trusted users sharing the host account; project grants remain an application
workflow boundary, not a shell or filesystem isolation boundary.

## Runtime Boundary

`CodexWebRuntime` remains unaware of users, roles, and projects. It receives
authorized Codex thread ids only.

The runtime exposes thread ownership lookups for active turn and approval ids
so the server can verify a turn or approval belongs to the authorized app
session before interrupting or resolving it.

## Project Display Names

Projects have a private `cwd` and public `displayName`. In multi-user mode:

- ordinary session create requests provide `projectId`
- the backend supplies `Project.cwd` to `runtime.createSession`
- ordinary session responses use `projectDisplayName`
- raw cwd is returned only to admin APIs

## Admin APIs

Admins receive an admin entry point and use `/api/admin/*` routes for:

- system settings
- users
- roles
- projects
- global session audit
- filtering sessions by user/project
- reading or streaming any session as observer

Observer mode is read-only at both layers. The frontend disables input, and the
backend rejects write operations unless the caller is operating through the
normal owner/write path.

## Share Links

Public sharing is disabled by default and must be explicitly enabled with
`CODEX_WEB_PUBLIC_SHARES_ENABLED=true`. An authorized session owner may create
a read-only capability link. The backend stores only its token hash, applies a
bounded TTL (24 hours by default, seven days maximum), and supports explicit
revocation.

When enabled, share routes use the unguessable capability token instead of a
bearer login and expose only:

- full session history
- live read-only event stream
- report files explicitly referenced by public assistant answers in that
  session, when the report still belongs to the same project

They never allow turns, approval decisions, settings writes, archive, or
favorite changes. Report reads revalidate the share TTL, revocation state,
multi-user mode, creator access, project ownership, and session reference on
every request.

## Testing

Focused tests cover:

- legacy single-user routes still work
- multi-user users cannot list/read/write sessions they do not own
- unmatched multi-user routes fail closed instead of falling back to legacy routes
- ordinary trusted users can persist each of the three runtime access presets
- project create requests use configured cwd and return display names
- admin can audit and observe any session but cannot inject via observer
- disabled, expired, revoked, or no-longer-authorized share links fail closed
- runtime turn/approval operations can be mapped back to their owning thread
