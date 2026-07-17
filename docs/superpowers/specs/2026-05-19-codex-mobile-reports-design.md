# Codex Mobile Reports Design

> Superseded on 2026-07-17 by
> `docs/superpowers/specs/2026-07-17-session-file-viewer-design.md`. This
> document is retained to describe legacy storage and API compatibility.
> Existing authenticated report links and capability-scoped public-share reads
> remain supported during the compatibility period; the Reports page, report
> favorites, and report-generation skill are no longer product features.

## Goal

Add a first-class reports area to Codex Web so any Codex session on this Mac can
save Markdown or self-contained HTML reports under the Codex Web state directory
and open them from the phone.

Reports are local Mac files. The phone remains a remote UI and must access
reports only through authenticated Codex Web APIs.

## Storage

Reports live outside all project repositories:

```text
~/.codex-web/reports/
```

Files are grouped by project slug and date:

```text
~/.codex-web/reports/
  codex-mobile-web-app/
    2026-05-19/
      design-summary.md
      ui-audit.html
```

Codex Web stores report UI state separately:

```text
~/.codex-web/report-index.json
```

The index stores favorites and optional metadata only. The report file remains
the source of truth for content.

## API

The standard report APIs require the existing bearer token. An enabled public
share may use its capability token to read only reports explicitly referenced
by public assistant answers in the shared session and belonging to that
session's project.

```text
GET   /api/reports
POST  /api/reports/resolve
GET   /api/reports/:reportId
PATCH /api/reports/:reportId/favorite
GET   /api/reports/:reportId/content
GET   /api/share/:capabilityToken/reports/:reportId/content
```

`reportId` is the report path relative to `~/.codex-web/reports/`, encoded as a
single path segment.

`POST /api/reports/resolve` accepts either an absolute path under the reports
root or a relative report path. It rejects paths outside the reports root.

## UI

Add a Reports page at the same navigation level as Sessions.

The Reports page shows:

- reports grouped by project
- favorite reports pinned first
- search by title, project, and file name
- favorite/unfavorite action
- tap to open report

Opening a report from the Reports page or from a chat message uses the same
viewer. The viewer has a back action that returns to the originating page.

Markdown reports render with the existing Markdown renderer. HTML reports render
inside a sandboxed iframe using `srcdoc`; first version treats HTML reports as
self-contained and does not proxy external assets.

## Chat Links

Assistant Markdown links that point to local `.md` or `.html` files are rendered
as in-app report links. When tapped, the app resolves the path through the
backend and opens the report viewer.

The global report skill should output links like:

```markdown
[Report](/Users/name/.codex-web/reports/project/2026-05-19/report.md)
```

## Security

Report access is limited to `~/.codex-web/reports/`.

The backend must:

- reject path traversal
- reject symlinks that escape the reports root
- read only `.md`, `.markdown`, `.html`, and `.htm`
- keep standard report APIs bearer-authenticated
- revalidate capability-scoped report reads against the share and session
  allowlist on every request

HTML is displayed in a sandboxed iframe without script permissions.

## Skill

Add a global `codex-mobile-report` skill. It tells future sessions to write
phone-readable reports to:

```text
~/.codex-web/reports/<project-slug>/<YYYY-MM-DD>/<short-name>.md|html
```

The final answer must include a Markdown link to the absolute report path so
Codex Web can make it tappable in chat.
