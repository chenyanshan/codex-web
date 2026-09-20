# Submission acknowledgement recovery

## Confirmed cause and limits

The durable browser outbox treated a missing acknowledgement (timeout, network
failure, or gateway 5xx) as a failed submission. After three attempts it stopped
recovering, even when the backend had accepted the message. This explains how a
red send-failure indicator could coexist with an active session or an answer.

The backend already deduplicated requests by submission ID and held operation
locks. Ordinary same-ID retries were not inherently duplicate execution. However,
the old receipt GET advanced submissions, and restart recovery could start again
when incomplete history did not contain the accepted turn. Missing history is
not evidence that execution never started.

The screenshots do not establish which network/runtime error occurred on the
other machine. This fix addresses the verified state/recovery defects; it does
not claim to diagnose a command's own error or delete historical sessions.

## Changes

- Keep uncertain outcomes in `outcome_unknown`; show “确认发送结果” and query the
  original receipt with backoff, without consuming POST retry attempts.
- Make receipt GET non-executing and independent of an in-flight POST. Persisted
  accepted receipts remain readable while runtime history is unavailable.
- Never replay uncertain execution after restart just because history is missing.
  Recover the original turn when evidence becomes available.
- Migrate legacy uncertain failures, merge known session identities, preserve
  drafts, and avoid reactivating completed turns when their receipt is recovered.
- Require explicit retry if a receipt is missing/expired. A receipt that remains
  uncertain continues checking; no new turn is started on that basis.
- Extract delivery handling into a focused module and remove the unused legacy
  send/recovery path, keeping the existing frontend payload budget unchanged.

## Verification

- `npm run typecheck`
- All `packages/codex-web/test/*.test.ts` tests
- Nine Playwright regressions across desktop, 390px phone, and 320px phone,
  including 504 → confirmation → reload → receipt recovery with exactly one POST
- `npm run build`
- `npm run test:built-public --workspace packages/codex-web` (no browser errors)

Browser fixtures and runtime stubs were used; no real user turn was submitted.
