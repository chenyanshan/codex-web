# App-server refactor: frontend design and preservation

Subsequent design review: the user has requested a complete redesign of the approval request component, an overall admin console redesign, and improvements to the global settings window. The [frontend design audit](2026-09-25-frontend-design-review.zh-CN.md) records the current direction and newly reproduced issues. The report below documents the earlier app-server behavior-preservation work, not acceptance of the approval component's visual design.

The existing approval card is the only visual change. A slow decision request currently leaves every decision enabled, and its late response can update a different session. Keep the recognizable console and make this action's progress explicit.

Color: reuse existing semantic variables, with fresh-light reference values background #f4f5f7, sidebar #eaecef, card #ffffff, text #1f2937, muted #6b7280, accent #10b981. Preserve retro, dark-gold, oled-black, fresh-light and terminal without overriding their tokens.

Type: existing system sans-serif with Chinese fallbacks; existing monospace for command details. No new font, size scale, animation, card or decoration.

Layout: retain current/console desktop columns and mobile drawer. Approval copy stays left aligned inside its current card; buttons retain their wrapping and touch targets.

```text
Desktop [projects] [sessions] [conversation / approval card]
                              [Sending approval…]
                              [Accept] [Allow for session] [Deny]
                              [composer and draft]
Mobile  [back / session / status]
        [conversation / same approval card]
        [composer and draft]
```

Principles: feedback belongs beside the decision it describes; disable all mutually exclusive decisions while the request is pending; never replay an uncertain approval automatically; ignore responses from an old identity or session. Retain drafts, upload state and the reading anchor through ordinary incremental rendering.

Pre-build critique: a new warning panel or spinner would add unrelated visual weight to this existing product. Reuse the card's meta text and disabled-button treatment instead. Only the pending/uncertain approval state changes; no theme or layout redesign is justified. Before screenshots use the browser fixture with identical language, viewport and theme, in a new dated evidence directory.

Affected preservation requirements: OPT-01, OPT-05, OPT-10, OPT-11, OPT-13, OPT-15, OPT-17 and OPT-21. Runtime history/state changes additionally affect OPT-02, OPT-08 and OPT-19; bounded compatibility reads and in-flight maps must retain OPT-20. Other mechanisms are left in place and require final regression verification by the coordinating task. No performance gain is claimed without a measurement.

## Implementation and review

The approval card adds local pending feedback, disables mutually exclusive decisions, holds uncertain delivery without replay, and ignores replies from an old session or authentication generation. Existing ordinary render/reading preservation remains in use. Pending approval identity is included in the timeline render fingerprint so the retained DOM cannot hide the new state. The existing composer status also shows “Working · Status awaiting sync” after app-server observation loss and clears that message when official progress resumes; it does not clear the turn, draft or outputs.

Web snapshots now use official items, including `agentMessage` final answers without an explicit role. The native client's negotiated `legacyRolloutRecovery` diagnostic gates the isolated rollout repair: initialized 0.156.1 and unknown newer servers never repair empty/missing snapshots from disk; the old 0.153.x/uninitialized fixture compatibility remains tested. The preexisting outer rollout turn boundary fix and regression test are preserved. Other archive-file compatibility remains unchanged and is not claimed retired.

The production build now marks the already-module `app.js` as ESM for minification. Classic script globals retain their previous build contract. Measured critical gzip bytes dropped from the coordinating task's baseline 145,497 to 134,115 after the complete changes, under the unchanged 143,360-byte budget. This measures transferred source size, not latency, memory or runtime speed.

## Visual evidence

[Evidence directory](2026-09-25-app-server-evidence/) contains before/after/pending approval screenshots for fresh-light and oled-black at 390×844 and 1440×900. The before assets were served directly from HEAD for app.js/ui-copy.js (both were clean at task entry), with the same current fixture and theme/viewport/language. This did not revert shared sources. Fresh-light resting screenshots are pixel-identical; OLED resting screenshots are visually unchanged apart from minor rasterization/timing pixels. Pending screenshots add one short meta line and the existing disabled-button appearance. The mobile light and desktop OLED pending screenshots were visually inspected: the action hierarchy, input area and column layout remain recognizable and readable.

The [matrix results](2026-09-25-app-server-evidence/approval-theme-layout-matrix.json) record 60 actual browser checks: five themes × two layouts × widths 320, 390, 844, 979, 980 and 1440, with representative heights 568, 844, 390 and 900. Every case had no document overflow or page exception, and all three approval choices were disabled while pending. Matrix screenshots cover all themes and layouts at 390, plus both layouts at 979/980 in fresh-light. This is a focused approval-state check, not complete flow coverage in all 60 combinations.

## Verification within this change set

- `npm run typecheck`: passed after the final runtime/UI changes.
- Focused 14-file unit run: 629 passed, including runtime/resolution/subscription, event projection/bounds, public UI, network, reading, history reconciliation, PWA cache, themes, build and the unchanged payload budget.
- New approval-delivery browser tests: 8 passed across mobile-portrait and desktop. They cover duplicate clicks, slow reply/draft retention, uncertain delivery without replay, late session reply isolation, and observation interruption/recovery. No project skip is present in these tests; the coordinating task reruns them across all five project viewports.
- Three old workspace failures reproduced with baseline HEAD frontend assets on an isolated fixture. Status badges are now accessible images, so stale text assertions were updated to exact role/name checks (including absence checks). The HTML preview's main-target CDP listener missed sandbox-frame CSP blocks in this Chromium; the test now requires actual frame CSP errors for both the stylesheet and image, while retaining zero-network, no-script and no-refresh assertions. No product CSP or storage expiry was changed. Targeted corrected mobile/desktop cases passed, including a final desktop workspace semantics rerun.
- `git diff --check`: passed.

The coordinating task owns the final full test/build/lint/browser run and actual deployment. These focused checks do not claim real-device backgrounding, universal browser coverage, full performance benchmarking, or online deployment.

## Preservation mapping for this subtask

| OPT | Preserved/verified within this subtask |
| --- | --- |
| 01, 02 | Observation loss is nonterminal; bounded event projection and recovered observer cooldown tests passed; existing network/event tests passed. |
| 03, 04, 05, 06, 07, 08 | Existing cache/outbox/draft/recovery/load code retained; public UI/network tests passed; approval slow/unknown delivery and draft browser checks passed. |
| 09, 10, 11, 12, 13 | Existing pagination/reading/render/debounce identity mechanisms retained; reading/history/UI tests passed; new navigation and auth generation fences prevent late approval mutation. |
| 14 | Upload code untouched; coordinating task owns broad attachment regression. |
| 15 | Existing static asset graph and cache update contract preserved; build/PWA cache tests passed. |
| 16 | Attention-dot code preserved except recognizing existing stale activity on an active selected session; public UI coverage passed. |
| 17 | Same fonts/CSS tokens/themes/layouts; 60 focused theme/layout/viewport checks passed, plus new mobile/desktop flow tests. |
| 18 | Existing compression/ETag implementation untouched; actual critical gzip payload is below unchanged budget. |
| 19 | Existing query caches retained; runtime tests verify official snapshot precedence and diagnostics-gated legacy reads. |
| 20 | Existing event byte/count limits retained and tested; observation projection occupies a stable key; pending approval entries clean up after requests. |
| 21 | Existing access checks retained; observation event presenter omits raw diagnostics in every audience; old-session approval responses are ignored. Full server authorization verification belongs to the coordinating task. |

Rollback consists of reverting this subtask's source/build/test changes while retaining the original rollout boundary correction and its test (now housed in the compatibility module), then rebuilding versioned public assets. No user runtime data or secret files were modified.
