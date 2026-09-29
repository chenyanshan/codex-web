# Portable activity and user input protocol mapping

Wire contract: generated stable tree from Codex CLI **0.159.0**, source commit
`687a119f0fcaace47e1f1abcc77cec6c813fd6da`; see generated/manifest.json.
The directory name `stable` does not mean every schema is stable:
`ToolRequestUserInput{Params,Question,Option,Answer,Response}` explicitly says
EXPERIMENTAL. capabilities.ts records that dependency. This document does not
claim that an existing running process has this version.

Behavior reference: official Codex `68e1a421f55ec8a0e900c5a250aa83c13727b671`,
`codex-rs/tui/src/chatwidget/protocol.rs`, notification routing for Error,
TurnCompleted, ItemStarted/Completed, TurnPlanUpdated, TokenUsageUpdated and
ServerRequestResolved. Local reducers are independently implemented against the
generated wire schema; no Rust source expression copied. Existing generated
code retains its Apache-2.0 license and source manifest.

| Official input | Local mapping | Verification |
| --- | --- | --- |
| error/willRetry | activity health and observed count, never transport retry | portable_activity retry/terminal test |
| item contextCompaction; deprecated thread/compacted | compaction state | compaction/token test |
| turn/plan/updated | bounded original step statuses | duplicate plan test |
| collabAgentToolCall agentsStates; subAgentActivity | recent observed agents, no subscriptions | retry/collab test |
| commandExecution/mcpToolCall/webSearch/imageGeneration | bounded recent tool summaries | bounded detail test |
| thread/tokenUsage/updated | separate total, last and context window | token semantics test |
| turn/diff/updated | bounded on-demand content, summary event only | large diff test |
| item/tool/requestUserInput | epoch-qualified requests, explicit blocking flag | request lifecycle tests |
| serverRequest/resolved | matching epoch/thread/typed RPC ID only | resolution test |
| thread/read and resume | latest official items without fabricated progress | snapshot reconstruction test |

Limits: 128 turn snapshots, 32 KiB each, 20 tool/agent/plan entries, per-field
limits at or below 2 KiB; separate diff capacity 128 KiB per retained turn.
128 user-input records, at most 32 KiB/request or response. Unknown delivery is
not retried. No timer interprets autoResolutionMs as authorization to answer.
MCP elicitation and other unknown requests remain explicitly rejected.

Affected preservation requirements: OPT-01/02/05/07/08/13/19/20/21. Existing
transport, turn lifecycle, stream cursor and observation recovery remain the
owners of their original behavior. Activity is a presentation projection only.
Web authorization, durable receipt ownership and SSE epoch/reset remain Web
responsibilities. No new model call, transport or background polling introduced.

Validation: native package typecheck and all 83 native tests passed for this
change. New Web receipt store focused tests: 3 passed. Real running app-server,
provider reasoning, disconnect timing and browser UI are integration checks;
these native fixture results do not claim those checks passed.

Installed-host schema check (2026-09-30): `/opt/homebrew/bin/codex --version`
reported **0.153.4**. Isolated `app-server generate-ts` confirmed all seven
question/answer/resolution/token-notification schemas are identical to generated
0.156.1 after ignoring `.js` import suffix transformation. In particular
`isBlocking: boolean` is required on both; no fallback inference from timeouts or
question text is necessary. See installed-portable-schema-evidence.json for
source hashes. This establishes disk binary compatibility, not running process
identity or a live user-input model round trip.
