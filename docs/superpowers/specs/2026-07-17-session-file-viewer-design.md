# Session File Viewer Design

Status: current

Supersedes `2026-05-19-codex-mobile-reports-design.md` for new file workflows.

## Product Model

The session is the only user-facing context. Files created by Codex, files
uploaded to the conversation, and normal web links appear where they were
mentioned in the timeline. There is no global Reports page, report project
index, favorite workflow, or report-generation skill.

Opening a file must preserve the active session, timeline position, draft, and
turn state so closing the viewer returns to the same conversation context.

## Supported Resources

- Markdown files in the current session project
- self-contained static HTML files in the current session project
- PDF files in the current session project
- common image files in the current session project
- current and historical session attachments whose retained files still exist
- HTTP and HTTPS links, opened as normal browser links
- legacy files under `~/.codex-web/reports/`, for compatibility only

Unknown local file types may be downloaded but are not rendered as trusted
content. A missing or retention-expired file produces an explicit unavailable
state rather than an empty viewer.

## Link Resolution

Assistant Markdown links and recognized local paths are resolved in the active
session. Relative paths use the session project root. Absolute paths are
accepted only when they are inside that project, an attachment root authorized
for that session and principal, or an allowed legacy report root.

The backend returns an opaque, short-lived file identifier instead of exposing
an arbitrary filesystem read endpoint. The identifier is bound to the
authenticated principal and session and is revalidated when content is read.

The first-version API shape is:

```text
POST /api/sessions/:sessionId/files/resolve
GET  /api/sessions/:sessionId/files/:fileId/content
```

## Viewer Behavior

- Markdown uses the existing Markdown renderer.
- HTML uses a sandboxed iframe without script permissions or relative/remote
  subresource access.
- PDF uses the browser or in-app PDF surface without executing document code.
- Images use a contained preview that can open the original resolution.
- HTTP and HTTPS destinations are not proxied by the backend.
- Other local file types use a download response with a safe filename.

Mobile uses a full-screen viewer. Desktop keeps the project/session workspace
visible and opens the viewer in the conversation pane. In both layouts, pending
approvals and active-turn status remain reachable.

## Security

- Every private resolve and content request requires the existing bearer token.
- Multi-user requests require session ownership and read access to its project.
- Resolution rejects traversal, symlink escapes, directories, and special files.
- Reads recheck real paths and file identity and do not follow the final symlink.
- Browser responses do not disclose host absolute paths.
- HTML remains sandboxed and cannot access the Codex Web bearer token.
- Public shares do not expose current-project session files. During the legacy
  compatibility period, they may read only legacy report files explicitly
  referenced by public assistant answers in that session and still belonging
  to the same project.

## Attachments And Retention

New uploads and immutable turn snapshots are represented by the same file-view
interaction as project files. Historical attachment metadata is converted into
a clickable resource when its retained file still exists. Files already removed
by the configured retention policy cannot be recovered.

Project files are owned by the project and are never deleted by viewer storage
maintenance. Managed uploads and snapshots keep their existing quota and TTL
policies.

## Legacy Report Compatibility

Existing `~/.codex-web/reports/` links continue to resolve through authenticated
legacy endpoints. Existing capability-scoped public-share report URLs also
remain valid until their share expires or is revoked. New UI code does not list
legacy reports, preload a report index, mutate report favorites, or create new
report files.

The legacy report store, root, TTL, and read-only compatibility routes can be
removed only after a separately announced migration window. Existing
`report-index.json` metadata remains read-only during that period and is not
deleted automatically.

## Acceptance Criteria

- An assistant link to a supported current-project file opens in the session.
- A retained attachment in old session history opens through the same viewer.
- Closing the viewer restores the conversation position and draft.
- Cross-project, cross-session, traversal, and symlink-escape reads fail closed.
- Old report links and old public-share report URLs remain readable.
- Login no longer preloads a report list, and no Reports navigation remains.
- New installs do not install or instruct Codex to use a report skill.
