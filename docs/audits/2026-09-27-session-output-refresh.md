# Session output refresh recovery

A browser fixture reproduced a completed turn showing only the prompt. When the
reader was no longer following the latest output and persisted history replaced
the visible message ID, `refreshCurrentSessionMetadata` discarded incoming
history because its reading anchor was absent. Both completion reconciliation
and repeated manual session refresh retained the old cache; a page reload did
not use this branch.

The missing-anchor fallback now applies only to incomplete history windows
(`timelineComplete !== true` or `timelineHasNewer === true`). Complete history
can replace stale cached messages. Existing reading-position restoration and
partial-page handling remain in place. No styles or API contracts changed.

Affected preservation baseline: OPT-03 (cache calibration), OPT-07 (foreground
reconciliation), OPT-09 (partial history windows), OPT-10 (reading position),
OPT-11 (rendering). Original implementation and replacement are in
`packages/codex-web/public/app.js`, `refreshCurrentSessionMetadata`.
Other OPT capabilities retain their existing implementations; this change does
not alter transport, authentication, storage limits, submission, attachments,
service lifecycle, or static-resource delivery.

Validation:

- Before the fix, desktop completion/manual refresh tests with replaced anchors
  both failed because the answer never appeared; the existing completion test passed.
- `npm run typecheck`: passed.
- Desktop and mobile-portrait output recovery, session reading, and weak-network
  browser suites: 56 passed, 6 skipped by existing platform conditions.
- Final output-recovery suite including explicit incomplete-page protection:
  8 passed. Covers completion, replaced anchors, repeated manual refresh,
  no duplicate messages, and preserving partial history windows.
- Inspected the recovered mobile screenshot: both prompt and answer visible.
- `git diff --check`: passed.

These are fixture browser checks, not verification against the user's live
session or a physical phone. No service was restarted or deployed. The exact
trigger in the reported session was not observed live. Rollback consists of
reverting the fallback condition and its associated regression tests.
