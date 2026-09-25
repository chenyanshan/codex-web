# Retained compatibility paths

Primary generated protocol: Codex 0.156.1. The facade remains `CodexAppClient`;
transport, child lifecycle, request correlation, and official observation have one owner.

| Path | Reason and affected versions | Activation / exit |
| --- | --- | --- |
| `rollout.ts` | 0.153.x could expose interrupted/materializing snapshots before rollout task completion, omit native work items, and emit provider errors only in rollout. Preserves Responses raw transcript and legacy tool recovery. | `policy.ts` restricts disk recovery to initialized 0.153.x, or uninitialized injected legacy providers used by regression fixtures. Modern/unknown initialized servers use official turn/item events and snapshots. Remove when 0.153.x and legacy injected-provider support retire and parity fixtures pass. |
| `request_params.ts` | Removed `persistExtendedHistory` and resume `experimentalRawEvents` fields are retained for 0.153.x's permissive serde behavior. | No mutation probe or automatic replay. Remove with the old-version compatibility window. `thread/start` titles now use official `thread/name/set`. |
| Experimental initialization | Raw tool events and the existing plan/default `collaborationMode` field retain the experimental opt-in in `capabilities.ts`. Goals and plugins are present in the 0.156.1 stable schema and use those types; unknown versions are not rejected based on their number. | Remove an experimental dependency only after equivalent stable behavior is verified. |

Process stderr is **diagnostics only**. The removed global 403-to-turn attribution
is covered by a regression proving unrelated errors cannot fail a task and a
matching official failure still does. A lost transport observation is explicitly
uncertain, not an execution failure. Mutations and approval responses are never
replayed automatically. Approval IDs are invalidated on connection loss and scoped to a random client instance plus connection epoch, so reused wire IDs cannot receive stale browser decisions. Missing IDs raise `approval_not_found`.

Modern live observation first consumes identity-scoped `turn/completed`; empty
successful turns remain successful. Initial snapshots and sequential calibration
are retained, with intervals bounded at 30 seconds, read timeouts, and observer
lease limits on transient failures. Approved/officially active tasks retain their
observer lease. Early-event buffering remains bounded by both bytes and count.

Validation: `test/app_server_transport.test.ts` covers loss, timeout, unknown and
malformed messages, official no-text completion, observation wakeup, isolated
errors, typed-item Responses projections, approval uncertainty, and initialization
coalescing. `test/codex_app_client_work_events.test.ts` retains legacy recovery,
early events, work limits, approvals, stale interruption, and materialization checks.
Real model and candidate-version checks are recorded separately by the version runner.
