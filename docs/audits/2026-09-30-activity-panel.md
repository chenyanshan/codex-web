# Activity panel and structured question UI implementation evidence

This audit covers local fixture rendering, not the deployed service or a physical phone. The running service was not changed. Evidence files are in `2026-09-30-activity-panel-evidence/`.

## Design and behavior

The existing phone bottom sheet / desktop dialog remains. Work rows use the existing icon library, a flexible two-line text column, and disclosure chevron. Type/status no longer consume fixed title columns. Normal execution uses neutral text; retries and failures use the existing semantic colors. The header shows one current state and one supporting line. Received activity count is separate from actual official plan-step completion.

Work detail DOM is created on disclosure, with a bounded 1,200-character preview. “View retained content” and “Back to preview” replace the same disclosure body and preserve the return offset. Full means the content currently retained by the existing data model; no request claims to recover discarded history. Diff retains line numbers and a local horizontal axis. Long output wraps without its own vertical scrollbar. Raw fields remain an optional diagnostic disclosure. The update affordance stays at the bottom of the activity list when old activity is being read.

Official retry/compaction/observation status, plans, agent state, tool status, token use, and available turn diff reuse the panel. Plans are optional and collapsed; no activity-count completion percentage is inferred. Token data distinguishes last response, thread total, and model context-window limit, with no invented occupancy percentage. Diff is fetched only after an explicit button click, preserves cached content across updates, and offers local retry. Its request is aborted on closing/replacing the dialog and detached or wrong-turn responses are ignored.

Structured questions mount in the conversation, outside the composer. A lazy module owns its keyed DOM subtree across both full application reconciliation and timeline refreshes. Focus and secret input remain in memory; nonsecret drafts retain the delivery module's identity/session scoping and coalescing. A failed module requires explicit retry. Unknown answer delivery only permits receipt checks for the original submission; the POST body has a browser assertion that it is an object rather than double-encoded JSON. Read-only/unverified/offline state cannot send an answer. Selected option descriptions wrap below the select so the native control's narrow text rendering does not conceal required detail.

## Browser evidence and correction loop

Rendered on the isolated test server at `http://127.0.0.1:41739`. Screenshots were actually opened and inspected at 390×844, 1440×900, 900×900, and 320×568; OLED and terminal theme images were also inspected. Automated checks additionally cover 768/900/901-width transitions, 844×390 landscape, all five themes, long diff lines, multiple disclosures, and content escaping.

The image review led to three concrete repairs: duplicate file-title output was removed when the file summary already exposes its full path; retry explanation uses warning rather than failure color; the new-activity action moved from the scrolling summary to a sticky list footer. A final viewport containment assertion accompanies the existing list containment assertion. Question screenshots were captured with the action area scrolled into view and show the full selected-option description.

Relevant evidence:

- `work-output-mobile-portrait.png`, `work-output-desktop.png`
- `work-width-768.png`, `work-width-900.png`, `work-width-901.png`
- `work-live-mobile-compact.png`, `work-live-mobile-landscape.png`
- `work-retry-plan-mobile-portrait.png`
- `work-theme-oled-black.png`, `work-theme-terminal.png`, `work-contrast.json`
- `question-mobile-portrait.png`, `question-desktop.png`

Before the final viewport-only assertion, the work browser cases passed 16 checks across four configured projects (12 intentional project skips). The question browser cases passed 3 checks on desktop/mobile (1 intentional skip). The root integration run owns the final all-project result after this audit. Lazy-module failure/retry, delayed loading, streamed row updates, numbered diffs, keyboard horizontal reading, focus restoration, long retained content, plan expansion, and on-demand diff retry are included. Page-error checks and resource behavior are part of these fixtures; intentionally failed lazy/API requests are asserted recovery scenarios.

## Recovery and preservation

- OPT-01/02/07/08/13: existing SSE, deadlines and session ownership remain. Oversized-event `snapshotRequired` uses lightweight metadata calibration, with a 30-second throttle and a single active request. Pending invalidation is eligible again after the throttle, independent of the ten-minute stall threshold. No new poller is introduced.
- OPT-03/09/10/11/12: cached activity and existing event windows remain bounded. Disclosure state, raw disclosure state, full-preview selection, horizontal reading offsets, supplementary sections, and keyboard focus are preserved. Existing incomplete-reset commentary merging is unchanged and regression-tested.
- OPT-15/17/18/20: detailed work CSS and display formatting are lazy; optional work translations live with their module. Startup payload and app-source budgets retain their original thresholds. The question host controller is also lazy. Existing preferences and theme tokens remain.
- OPT-21: question view ownership changes destroy old controls and pending requests; auth-pending state cannot expose an owned question mount. Sensitive diff responses require the original session/turn and connected container.
- OPT-04/05/06/14/16/19: existing composer/outbox/attachment/query-cache behavior is not replaced. Structured answers use their own native-backed receipt contract; they never reuse composer resend logic.

The existing recovery watchdog performs one calibration after ten minutes of unchanged parent progress. Known blocking questions, compaction, retry, and observed running tools take precedence over a generic no-progress label. The short status can explain a stall after three minutes without treating it as a failure. Activity/question mutations increment the existing UI mutation revision, preventing a status request started earlier from replacing a newer retry or resolved-question event. Terminal turns reject late working snapshots and late pending questions. Epoch/reset handling clears the old activity revision before replay and uses the existing snapshot recovery path.

## Checks and limits

Passed locally: `npm run typecheck`; original frontend budget test; 12 network-recovery unit checks (including stall, pending retry, inflight exclusion, and owner rotation); focused work/public UI checks; incomplete reset history preservation; late status versus activity/question race; changed-module ESLint. The root agent runs the final full build/test/PWA and broader browser suite.

Not claimed here: real iOS virtual-keyboard testing, physical-device rendering, browser 200% zoom, deployed-service behavior, or a before/after performance benchmark. Existing fixture cases cover viewport resizing and phone landscape, which are not substitutes for those device checks. No native clipboard-dependent copy control was added; retained output remains selectable.

## Final lazy-question recovery correction

The root's final five-project matrix found one real failure among 26 passing checks and 38 intentional skips: a JavaScript-load failure was represented only by the current DOM. An unrelated full render could erase that marker, automatically load again, and detach the explicit Retry action during a click.

The shared optional loader now has opt-in manual retry for questions. Its failure is retained by owner, and a generation guard ignores a rejection from an older retry attempt. Rendering a known failure restores its feedback without starting an import; only the explicit Retry action clears it. Repeated failure callbacks preserve the existing action node. The lazy question controller similarly retains its stylesheet-failure action across host rendering. Other optional features keep their existing retry-on-open behavior.

The strengthened browser check performs a full question update, verifies the Retry element is the same node, then streams another message and verifies the load count is still one. Clicking Retry is the only second attempt. JavaScript failure was repeated on desktop three times (6 total question checks passed), then desktop/mobile twice (6 passed, 2 intentional skips). JavaScript and stylesheet failure cases were subsequently repeated twice on desktop (4 passed). The original final matrix's other 26 passing checks remain valid; the failed case is covered by these targeted reruns. No further business-code changes followed this correction.

The original startup budget test passes after moving three work-only translations into the existing lazy work dictionary and removing the question module's redundant self-import. The root reports the final 1,207 tests, typecheck, build, and actual production-asset smoke all passing with this correction.

## Follow-up: pinned overview, assigned prompts and compact token metrics

User feedback after deployment exposed that following a growing activity log also scrolled away its summary and optional sections. The lazy work view now pins a height-bounded overview inside the existing scroll container; its long expanded content scrolls locally, while the modal title and close button remain outside that container. A flex layout explicitly bounds the content area. Desktop width is reduced to 880px. The existing event paging, follow/pause, focus, horizontal diff reading and return anchors remain; anchors exclude content obscured by the pinned overview. Overview scroll position and agent-ID disclosure are preserved across updates.

Official `collabAgentToolCall.prompt` is retained for the addressed `receiverThreadIds`, with the existing redaction and a 2 KiB per-prompt cap. Status-only and `subAgentActivity` events retain the last known prompt. Hydration inspects at most 128 recent items and carries forward already observed prompts, still enforcing the 32 KiB snapshot and 20-agent bounds. No child-thread request or subscription is added. Agent task text is primary; ID remains in a disclosure. Missing historical prompts are explicitly unavailable rather than invented.

Token usage uses decimal K/M/B units, rounded to at most two decimals with threshold promotion (999999 → 1M). The view separates cumulative usage, last response and context-window capacity, and shows input/output/cached input below. Missing values are not fabricated as zero; cumulative usage is not labeled context occupancy. Exact numbers remain in title attributes.

Verification after these changes: full npm test 85 native + 1121 Web + 5 protocol = 1211 passed; typecheck, production build and built-public HTTP/browser smoke passed. Work browser matrix: 20 passed, 12 viewport-specific skips, covering 320px/390px/desktop/landscape. New long-history fixture checks 38 activities, fixed header/overview containment, prompt display, K/M/B values, and top/bottom scrolling. Native tests cover prompt retention/redaction/hydration/bounds; unit tests cover numeric thresholds/unknowns. Final screenshots `refined-tokens-*` and `refined-agents-*` were visually reviewed. No physical-phone or virtual-keyboard claim is made.

Affected OPT: 02/03/09/10/11/13/17/19/20/21 retain their existing flow and resource/access boundaries; 15/18 retain existing lazy asset registration and pass production smoke/budget tests. Other OPT behavior is unchanged. No new dependency, polling loop, endpoint or database.

## Follow-up: compact global settings and shared close controls

- Global settings now reuse the session settings visual language: small headings, bordered cards, shared model/reasoning rows, horizontal scope navigation and a 680px desktop shell. Device/server/account ownership and all save handlers remain intact.
- A shared `CodexWebUi.closeButton` renders the same SVG x for global settings, session settings, activity, project drawer, sharing and file preview. Touch targets remain 44px and icon centers are checked in the browser. Confirmation cancel actions retain their action labels.
- Plan mode retained: native `serializeCollaborationMode` supplies the actual `turn/start.collaborationMode`; the inherited-model serialization regression covers plan mode.
- Affected preservation baseline: OPT-11 (owned runtime subtree/focus retained), OPT-17 (responsive controls/preferences), OPT-18 (unchanged resource delivery and enforced 140KiB startup gzip budget). OPT-01–10,12–16,19–21 transport/storage/auth logic unchanged in this refinement.
- Validation: typecheck and production build passed; native 85 tests passed; Web 1120 tests passed in the suite with the sole budget failure subsequently fixed and its focused regression passed. Five protocol tests passed. Built-public browser smoke passed without browser errors. Final settings/activity browser run: 28 passed, 12 viewport skips; earlier runtime/session-controls cases also passed (9 intended viewport skips). Settings screenshots for 320px, 390px, desktop and landscape are under `2026-09-30-activity-panel-evidence/settings-*.png`; desktop and 320px inspected directly.
- Browser fixtures validate geometry, persisted Plan default, navigation, masked-copy behavior and nested confirmation focus. No physical-phone or real weak-network test was repeated for this visual refinement. No dependencies or resource-budget increases. Rollback can revert this settings/shared-close refinement without changing persisted settings or runtime protocol.

Mobile safe-area follow-up: restored `env(safe-area-inset-top/left/right)` on the new global settings header. Browser CDP safe-area override and actual touch taps verify that the x remains below a 47px system inset, receives hit-testing and closes the page. Final settings/runtime browser regression: 19 passed, 9 intentional viewport skips. Shared button and session/activity appearance retained.
