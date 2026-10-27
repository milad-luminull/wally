# Error handling, technically and for the person — design

> **Status:** executed in PR #64.

Date: 2026-10-19. Approved by the owner 2026-10-19; built on `fix/ai-reliability`.

## Intent

The owner: "AI is often not doing anything or breaks", and "better error handling is required,
make sure it's applied in other places too; the application should have good error handling,
both technically and from a UX perspective." The production logs (2026-10-15 to 2026-10-19)
showed why it feels broken: the AI's failures and its "nothing to add" answers are silent by
design, and several non-AI failures look like something else (an empty board, an endless
skeleton, a blank page). This design makes every failure visible once, in the place it
happened, with the next step, and makes the server try harder before it fails.

It ships in one release with the model switch (below) and the capture outcome logging already
committed on `fix/ai-reliability` (715e7a2e), by the owner's decision.

## Goals

1. Nothing fails silently. Every failure is shown once, where it happened, in plain words,
   with the next step.
2. One behaviour per kind of failure, everywhere (the five kinds below).
3. The AI explains itself on its own card: nothing to add, busy, limit reached, couldn't save.
4. The server retries a temporary model failure once before it gives up, and reports a
   timeout as a timeout.
5. One error body shape from the API, with a flag that says whether a retry can help.
6. Safety nets in the web app: a crash screen, a real "couldn't load" state, a deleted-note
   state, an offline bar, request time limits, sign-in on an expired session.
7. One voice for error copy in English and German.

## Non-goals

- Editing offline across a reload (a persisted write queue).
- A client error-reporting service (the stack stays Firebase-only; see the memory note
  "no idle infrastructure cost").
- Provisioned Throughput or a different model provider.
- Changing rate limits or the assistant's budget caps.

## Anti-goals (it fails even if it works if…)

- An AI failure interrupts typing or takes focus, or appears as a toast or modal.
- A refused write (no permission, invalid, gone) is offered a Retry that cannot succeed.
- Two messages say the same thing at once.
- A person sees a code, a status number or a stack trace.
- Note text reaches a log line.

## Constraints

- Gemini 2.5 Flash, today's model, is retired by Google on 2026-10-20
  ([model page](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash));
  production AI calls are expected to fail from then until this release. The release switches
  to `vertex:gemini-3.8-flash` on the EU multi-region endpoint (`ASSISTANT_VERTEX_LOCATION=eu`),
  verified on 2026-10-19 with free `countTokens` probes (200 on `eu` for 3.8/3.7/3.6 Flash; 404
  in europe-west1/3/4) and the 40-fixture eval (66 of 69, no anti-goal failures). The
  [3.8 Flash page](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash)
  lists multi-region `eu` for ML processing, which keeps RFC decision D4 (processing in the EU).
- BRAND rules 2 (the AI has no name or pronoun) and 4 (every AI action reversible where it
  happened) stay. Rule 5 changes (below).
- No new dependency unless the plan names it and the owner agrees.

## The five kinds of failure

Every failure the person can meet is classified once, in one web module, from the API's error
body, the HTTP status, or the transport error:

| Kind          | Comes from                                                                                   | What the person sees                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Temporary** | network failure, request timeout, 5xx, 429 rate limit, AI busy or provider error, AI timeout | "Couldn't …" with **Try again**. Where a retry is safe, the app retries quietly first.                      |
| **Refused**   | 400, 403, 404, 422, any 4xx not listed elsewhere                                             | A short reason, no Retry: "This note was deleted or isn't shared with you", "You can only view this board". |
| **Conflict**  | 409 STALE_REVISION / MUTATION_BLOCKED                                                        | The existing review dialog (MutationRecovery), unchanged.                                                   |
| **Session**   | 401 after the one forced token refresh                                                       | The sign-in screen, then back to the page they were on.                                                     |
| **Limit**     | 429 DAILY_CAP / MONTHLY_CAP                                                                  | "Daily limit reached · back at 14:00" (the reset time, in the person's clock).                              |

## API

1. **One error body**, defined once in `packages/shared` as a zod schema and used by every
   handler and by the web client:
   `{ error: CODE, message: string, retryable: boolean, resetsAt?: ISO-8601 }`.
   `retryable` is true for 5xx, `RATE_LIMITED`, `BUSY`, `ASSISTANT_PROVIDER_ERROR` and
   `ASSISTANT_TIMEOUT`; false otherwise. `resetsAt` stays on the budget 429s.
2. **The handler maps every status to its own code**: today every non-AppError 4xx becomes
   `BAD_REQUEST` (`app.ts:90`). 400 → `BAD_REQUEST`, 404 → `NOT_FOUND`, 405 →
   `METHOD_NOT_ALLOWED`, 413 → `PAYLOAD_TOO_LARGE`, 415 → `UNSUPPORTED_MEDIA_TYPE`, 429 →
   `RATE_LIMITED`, any other 4xx → `REQUEST_FAILED`. Unknown routes get the same body through
   `setNotFoundHandler`.
3. **One retry of a temporary model failure** in the suggestion, tidy and turn runners: on a
   provider 429, a 5xx or a network error, wait 1–2 s (jittered) and try once more, only if the
   remaining deadline leaves room for a full attempt. Each attempt takes its own reservation
   through the existing `onAttempt` lease, so the budget ledger stays exact. The runners keep
   the AI SDK's own retries off (`maxRetries: 0`; the SDK's default is 2 —
   [settings](https://ai-sdk.dev/docs/ai-sdk-core/settings)), because the SDK's retries would
   bypass the lease. Google's guidance for a 429 on the shared pool is a retry with backoff
   ([Standard PayGo](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/dynamic-shared-quota),
   [error 429](https://cloud.google.com/vertex-ai/generative-ai/docs/provisioned-throughput/error-code-429)).
4. **A timeout is a timeout**: the capture and tidy deadlines answer 504 `ASSISTANT_TIMEOUT`
   (retryable) instead of 502 provider error, and log `assistant.timeout`.
5. **Logging**: every assistant refusal (AppError ≥ 400) is logged at warn with its code and
   route, no content; every 5xx at error with code and error name. The capture outcome line
   (715e7a2e) stays.

## The AI, on its own card

BRAND rule 5 becomes: "The AI never interrupts: no toasts, no modals, no badges. When it has
nothing to add or cannot help, it says so in one short line on its own card or answer, and
the person can dismiss it."

Capture (wall card, list row and sidebar — the shared `ReviewFooter`), after "Filling in":

| Outcome                                            | Footer line                                                      | Then                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Nothing to add                                     | "Nothing to add"                                                 | fades after 2 s; the card is ordinary again                                                                                  |
| Temporary (busy, provider error, timeout, network) | "Busy right now · **Try again**"                                 | stays until Try again (asks again with the same locks) or ×                                                                  |
| Limit                                              | "Daily limit reached · back at 14:00"                            | stays until ×                                                                                                                |
| Keep / Undo / discard failed                       | "Couldn't save · **Try again**"                                  | Try again resends the same decision; a refused decision (stale, settled) reads "This changed meanwhile" and closes after 2 s |
| Undo failed                                        | as above, and the kept values stay marked until it succeeds or × |                                                                                                                              |

Tidy shows the same lines where its own status shows today, and a failed keep or undo no
longer snaps the cards back without a word. Ask the wall keeps its answer card and starts
showing its TIMEOUT and TOOL_LIMIT copy (today unreachable, `AskCard.tsx:153-155, 225`).

## Board writes

- **Temporary**: one toast, "Couldn't save · Try again" (the action retries that write); the
  "Unsaved changes" pill stays the list of what is not saved yet. Paused while offline (below).
- **Refused**: one toast with the reason; the optimistic change is rolled back; it never enters
  the pill, so no Retry is offered for it.
- **Conflict**: the review dialog, as today.

## Safety nets

1. **Crash screen**: an error boundary at the app root and around the board
   ([React error boundaries](https://react.dev/reference/react/Component)) shows "Something went
   wrong · Reload". No blank page.
2. **Couldn't load**: the notes, members and share-link queries show their error with **Try
   again** instead of an empty board or an empty member list; a share-link error never creates
   a link.
3. **Deleted or hidden note**: the sidebar shows "This note was deleted or isn't shared with
   you · Close" instead of an endless skeleton.
4. **Offline**: a slim bar, "You're offline. Changes are saved when you're back." TanStack
   Query's default network mode already pauses queries and mutations while offline and resumes
   them on reconnect, driven by `onlineManager`
   ([network mode](https://tanstack.com/query/v5/docs/framework/react/guides/network-mode),
   [onlineManager](https://tanstack.com/query/v5/docs/reference/onlineManager)); the bar reads
   the same signal. The mutation lane (`lib/mutationQueue.ts`) must not turn an offline pause
   into a recovery entry.
5. **Request time limit**: 30 s for ordinary requests, 45 s for the AI routes (20 s deadline
   plus one retry); a timed-out request is Temporary.
6. **Session expired**: a 401 after the forced token refresh signs out and opens sign-in with
   the current path to return to.
7. **Small silent spots**: copying a link that fails says "Couldn't copy — select the link";
   a verification email that fails to send says so with Resend; the recovery dialog's own
   Retry shows its failure.

## Copy

One voice: "Couldn't …" (typographic apostrophe), "Try again" (no "please"), the reason in at
most eight words, no codes. German equivalents in the same pattern. Existing keys are reused
where they fit (`ask.limit.*`, `safety.*`, `common.retry`); duplicates are folded.

## Verification

- Unit: the error classifier (every status and code → kind), the API body schema and
  status-to-code mapping, the runner retry (temporary retried once within the deadline,
  refused never, lease per attempt), each card outcome, each safety net.
- E2E (CI, stubbed at the network like `capture-review.spec.ts`): a capture answering null
  shows "Nothing to add"; a capture answering 502 shows "Busy right now · Try again" and Try
  again asks once more; the notes list answering 500 shows "Couldn't load" with Try again.
- Live check on the preview, then CI green before the PR is marked ready.

## Left to the builder

The exact component split, the fade timing within 1.5–2.5 s, where the offline bar sits, and
the German wording, within the rules above.

## Unverified

- That Gemini 3.8 Flash on `eu` produces fewer 429s than europe-west1 for this project: Google
  documents single-region endpoints as the most likely to 429, but no measurement exists yet.

## Changed while building

- **Session expiry** (an automated security review): the API cannot tell a revoked session
  from its own token check failing, so a 401 that survives a fresh token is a temporary
  failure with Try again and never signs anyone out. A session that really ended is signed
  out by Firebase itself; the sign-in page then says the session ended (and how many unsaved
  changes went with it). No return path is kept across it, so nothing carries over to another
  account.
- **Turns are not retried**: a question to the wall may already have read or written before
  failing; replaying it could repeat a write. Capture and Tidy are retried once.
- **Tidy's Try again after a failed keep runs Tidy again**: the batch is gone once the cards
  are back.
