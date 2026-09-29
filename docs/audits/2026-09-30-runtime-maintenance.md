# Runtime maintenance / S4a + S4b verification

Local verification date: 2026-09-30 (Asia/Shanghai). This is implementation and isolated verification evidence, not a production deployment or a completed host upgrade.

## Installation and official reference

The selected host binary is `/opt/homebrew/bin/codex`, resolving to the npm package entry `/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js`. A read-only `RuntimeUpdateService.refresh()` detected installed version **0.153.4** and exact selected-package/global-npm-root agreement. The generated protocol baseline remains **0.156.1**; it is not presented as the running version.

Official reference inspected: `codex-rs/tui/src/update_action.rs` in `/tmp/codex-official-retry-audit`. The npm action is preserved, with an explicit stable version pinned once and `https://registry.npmjs.org` selected. Unknown installation sources remain unsupported. No package-manager command was actually used to upgrade this host.

## Implementation behavior

- One atomic state file stores the current maintenance operation. Same current operation ID and parameters return the recorded result; uncertain install/initialize outcomes are not automatically replayed. Only waiting reservations can be cancelled.
- Session creation/start/steer use a maintenance admission lease. Read/pause/clear goal controls remain admitted only while waiting, so an existing goal can drain; goal set/resume cannot enter. Goal continuation and HTTP/Webhook paths pass through these entry points. Independent scheduled CLI runtimes take a bounded persistent execution lease under the same file lock before creating a runtime; they release it after owned-runtime stop.
- Global idle requires no active admissions, turns, goals, approvals, unanswered/uncertain questions, or external task leases. Every loaded thread page and its persisted goal are checked, with explicit idle required (an empty local goal map after restart does not imply no goal). Cyclic/incomplete/oversized inspection remains unknown and does not stop the process.
- A dead scheduled-process PID does not prove its child app-server stopped. Its lease is retained conservatively; after an abnormal crash an operator must inspect and reconcile `runtime-execution-leases.json`. This intentionally prevents an unsafe idle claim.
- The current npm installation is updated in place after idle. The old running process remains until the installed binary passes the existing isolated compatibility script. This is not an atomic side-by-side installation. No guaranteed package rollback or state downgrade is claimed.
- Applying clears volatile runtime caches and stale subscription timers, rotates stream epoch while retaining bounded confirmed history, initializes the owned app-server, and refreshes model/config state. A missing or mismatching running version cannot report success.
- Version GETs use cached disk-installation information; the running version comes from initialized-server metadata, never from disk. Explicit checks resolve a stable target. Operations are administrator-only and independent of HTTP connection lifetime.

## Verification

Passed:

- `npm run typecheck` across workspaces and compatibility scripts.
- Focused maintenance, updater, authorized route, idle/pagination, event bus and retention tests: 24 passed in the final focused run.
- Existing CLI tests including scheduled terminal/archive/stop ordering: 12 passed in the preceding combined CLI run.
- Follow-up create-session/goal admission and persisted-goal tests, plus maintenance and public-build tests: 14 passed. The lazy settings module uses the existing classic-global loading convention and all user-facing copy is translated through the existing `t` contract; this statement does not replace browser screenshot verification.
- Real **isolated** current-CLI compatibility: required stable schema methods, initialize, thread/start/read/list/unsubscribe, config/read, skills/list and MCP list.
- Real same-version **0.153.4 → 0.153.4** `applyInstalledRuntime()` on an isolated owned process: child PID changed, connection epoch changed from 1 to 2, event epoch rotated, one reset callback fired, model/config refresh completed and the returned running version was verified. This is a restart test, **not a package upgrade**. See [apply-same-version-current.json](2026-09-30-runtime-maintenance-evidence/apply-same-version-current.json).
- Real temporary-home/temporary-project maintenance idle inspection, including loaded-thread listing and persisted-goal lookup: initialized version 0.153.4, `idle: true`, no reasons. See [idle-current.json](2026-09-30-runtime-maintenance-evidence/idle-current.json).
- Desktop/mobile runtime settings browser regression: 8 passed (Chinese version labels, preserved owned subtree without repeat GET, discarded late response after leaving or switching identity, lost POST reconciled by original ID without automatic resend). This uncovered and fixed duplicate JSON encoding at the `apiFetch` boundary. Runtime-only translation copy loads lazily to retain the startup budget.
- Temporary-home experimental schema presence: requestUserInput, thread/status/changed, thread/tokenUsage/updated, turn/diff/updated, thread/loaded/list and thread/read.

Reports: [compatibility-current.json](2026-09-30-runtime-maintenance-evidence/compatibility-current.json), [feature-schema-current.json](2026-09-30-runtime-maintenance-evidence/feature-schema-current.json).

Not verified by this evidence: real npm installation, real maintenance of an existing live server, real provider inference, persisted-history resume after a model turn, live requestUserInput delivery after reconnect, installation rollback. Browser fixtures and screenshots do not prove live-host maintenance behavior. The compatibility report explicitly records model smoke and persisted-history resume as not run. Tests use injected installer/restart executors; no live tasks were stopped.

## Optimization preservation

- OPT-01/02/07: maintenance uncertainty remains separate from task terminal state; epoch change uses existing reset/reconnect semantics. Event bus retention tests pass. Final SSE/browser integration is verified by the root task, not claimed by these module tests.
- OPT-04/05: no chat, steer, question response or maintenance mutation is automatically repeated; pending maintenance identity is kept per identity in optional browser session storage.
- OPT-19/20: status is cached; no UI polling or unbounded job list; bounded loaded-thread inspection, state size, external lease count, subprocess duration and output. Existing event-memory tests pass.
- OPT-21: admin-only route tests cover every new maintenance endpoint before any installation inspection or mutation.
- OPT-15/18: the new lazy browser module must be included in the root integration's build/static/service-worker asset checks; browser/asset results are not claimed here.
- OPT-03/06/08–14/16/17 are otherwise unchanged by these backend modules; the settings module reuses the existing visual controls and does not touch chat caches, drafts, scrolling or attachments.

Rollback of this code can remove the new registration, settings integration and maintenance modules while preserving existing MCP reload semantics. Files recording uncertain maintenance or external task leases must be inspected rather than silently discarded as part of rollback.

## Follow-up: 0.159.0 and PATH-selected CLI verification

The observed mismatch was real: the running child started at 01:46 and still mapped the old npm binary under `.codex-QDftHxCm` (`lsof -p 7872 -a -d txt`); the installed binary changed at 02:09. A read-only initialize handshake reported 0.153.4 while the installed native executable reported 0.159.0. Installing a CLI cannot replace an already-running process image.

Fixed `RuntimeUpdateService.verifyInstalled`: resolve the configured `codex` through PATH before passing `--codex-bin` to the compatibility script, which requires an absolute path. Added a regression for the short-command configuration. Maintenance continues to wait for global idle and never replays an uncertain operation.

Regenerated stable/experimental contracts using installed official CLI 0.159.0; manifest and upstream hashes retained, source commit `687a119f0fcaace47e1f1abcc77cec6c813fd6da` verified from the release tag. Updated protocol version reporting and release evidence. Isolated real 0.159.0 compatibility checks passed without credentials/inference; real model-turn smoke was not run. Types, native/Web regressions, manifest tests, and built-public smoke checked. Generated changes are additive timestamps/cursor support and comments; adapters keep their existing behavior.

Affected OPT-01/02/07/08/13/20/21 protocol/lifecycle safeguards remain in place; no transport replacement or weakening of idle/authorization/replay checks. OPT-17: mobile settings header restores top/side safe-area insets; browser touch tests emulate a 47px top inset and assert hit-testing and successful close at 320px, 390px and landscape. OPT-18: 140KiB gzip startup budget retained. Other baseline capabilities unchanged. Physical iPhone testing remains for the user to confirm.

Deployment verified: launchd service PID 13110, app-server PID 13186; read-only initialize on its owned loopback endpoint now reports `codex-native-api/0.159.0`. Served build `a1821fd688dad4015a59` matches compiled app/settings/UI assets; unauthenticated runtime-status access still returns 401. Installed CLI and generated protocol baseline both report 0.159.0.
