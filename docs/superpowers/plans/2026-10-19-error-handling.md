# Error handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every failure is shown once, where it happened, with the next step; the server retries a temporary model failure once; the AI explains itself on its card; one release together with the switch to Gemini 3.8 Flash on `eu`.

**Architecture:** One error body (`packages/shared`), produced by the API's single error handler and read by one web classifier (`apps/web/src/lib/errors.ts`) that turns any failure into one of five kinds. Each surface maps a kind to its copy and action. The AI's outcomes become states of the existing suggestion and tidy controllers, drawn by the existing footers.

**Tech Stack:** Fastify + zod (API), React + TanStack Query v5 (web), Vitest, Playwright (CI).

**Spec:** `docs/superpowers/specs/2026-10-19-error-handling-design.md`

## Global Constraints

- Copy: "Couldn't …" (typographic apostrophe), "Try again", reason ≤ 8 words, no codes; en and de.
- The AI never shows a toast or modal (BRAND rule 5 as amended); its lines live on its card.
- No note text in any log line. No new dependency.
- Branch `fix/ai-reliability`; one PR; E2E in CI; CI green before "ready".

## Review Focus

1. A capture that fails while the person is editing the card in place: the outcome line must not steal focus or replace the editor.
2. "Try again" on a busy capture after the note changed meanwhile: the retry must ask about the note as it is now.
3. Offline, then a write, then reconnect: the write resumes once, no recovery entry, no toast.
4. A 401 during a write: sign-in opens once, the write is not lost silently (it stays in the pill).
5. The error boundary catching an error inside the sidebar: the board stays usable.

---

### Task 1: One error body, real codes, logged refusals (API)

**Files:** `packages/shared/src/schemas/error.ts` (+ index export), `apps/api/src/app.ts`, `apps/api/src/routes/assistant.ts` (the `refused` response schema), tests `apps/api/test/errors.test.ts`.

**Produces:** `apiErrorSchema = z.object({ error: z.string(), message: z.string(), retryable: z.boolean(), resetsAt: z.string().nullable().optional() })`, `type ApiErrorBody`; `RETRYABLE_CODES` (`INTERNAL_SERVER_ERROR`, `RATE_LIMITED`, `ASSISTANT_BUSY`, `ASSISTANT_PROVIDER_ERROR`, `ASSISTANT_TIMEOUT`); helper `errorBody(code, message, extra?)` in the API.

- Test first: 404 unknown route → `{ error: 'NOT_FOUND', retryable: false }`; a zod body error → 400 `BAD_REQUEST`; a forced 413 → `PAYLOAD_TOO_LARGE`; an AppError 5xx and an unknown error → `retryable: true`; a rate-limited request → `RATE_LIMITED`, `retryable: true`; every body parses with `apiErrorSchema`.
- Implement the mapping table from the spec; `setNotFoundHandler`; assistant AppErrors ≥ 400 logged at warn `{ type: 'request.refused', code, route }`.

### Task 2: One retry of a temporary model failure; a timeout is 504 (API)

**Files:** `apps/api/src/lib/assistant/model/retry.ts` (new), `model/suggest.ts`, `model/tidy.ts`, `model/runTurn.ts`, `lib/assistant/suggestions.ts`, `lib/assistant/tidy.ts`; tests `model/retry.test.ts`, route tests in `test/assistant-suggestions.test.ts`.

**Produces:** `withOneRetry<T>(attempt: () => Promise<T>, opts: { signal: AbortSignal; deadlineAt: number; minAttemptMs: number; delayMs: () => number }): Promise<T>` and `isTemporaryProviderError(error): boolean` (status 429, ≥ 500, network/fetch errors; never an abort).

- Test first: temporary error then success → result, two attempts; refused (400/403/404) → no retry; no room before the deadline → no retry; aborted → no retry; the fake runner in the route tests answers 429 once then succeeds → 200 with a suggestion and two settled reservations.
- Capture and tidy deadline → `AppError(504, 'ASSISTANT_TIMEOUT', …)`, log `assistant.timeout`.

### Task 3: The web classifier and request time limits

**Files:** `apps/web/src/lib/errors.ts` (new), `lib/apiClient.ts`, tests `lib/errors.test.ts`, `lib/apiClient.test.ts`.

**Produces:** `type FailureKind = 'temporary' | 'refused' | 'conflict' | 'session' | 'limit'`; `failureOf(error: unknown): { kind: FailureKind; code?: string; resetsAt?: string }`; `REQUEST_TIMEOUT_MS = 30_000`, `AI_REQUEST_TIMEOUT_MS = 45_000`; `ApiError` carries `retryable` and `resetsAt` from the body.

- Test first: each status/code → kind (401 session; 409 STALE_REVISION conflict; 429 DAILY_CAP limit; 429 RATE_LIMITED temporary; 502/504 temporary; 403/404/422 refused; `TypeError` from fetch temporary; a timeout abort temporary; the session-reset abort is not a failure); a request past its limit rejects as a timeout.

### Task 4: The AI on its card

**Files:** `features/board/Suggestions/useSuggestions.ts`, `Suggestions/ReviewFooter.tsx`, `NoteDetail/PendingReview.tsx`, `WallView/NoteCard.tsx`, `ListView/NoteRow.tsx`, `Tidy/useTidy.ts` + its status UI, `Ask/AskCard.tsx`, i18n; tests next to each.

**Produces:** `SuggestionMark.phase` gains `'outcome'` with `outcome: 'nothing' | 'busy' | 'limit' | 'saveFailed' | 'changed'`, `resetsAt?`, `retry?` (what Try again repeats); controller `dismissOutcome(noteId)`, `retryOutcome(noteId)`.

- Test first (controller): null answer → `nothing`, gone after 2 s; 502/504/network → `busy`, stays; Try again asks again with the same locks; 429 cap → `limit` with `resetsAt`; keep fails temporarily (after its one silent retry) → `saveFailed`, Try again resends the decision; refused decision → `changed`, gone after 2 s; an outcome never takes focus.
- Test first (footer/card/row/sidebar): each line's copy and button; × dismisses; reduced motion has no fade.
- Tidy: same kinds on its status line; a failed keep/undo says so. Ask: TIMEOUT and TOOL_LIMIT copy shown.

### Task 5: Board writes and safety nets

**Files:** `lib/queryClient.ts`, `lib/mutationQueue.ts`, `features/board/MutationRecovery.tsx`, `App.tsx` + `components/ErrorBoundary.tsx` (new), `features/board/AppShell.tsx` (notes error), `NoteDetail/NoteDetailPanel.tsx` (404), `Share/ShareSheet.tsx` (+ invite form), `features/auth/AuthProvider.tsx` (verification email), `components/OfflineBar.tsx` (new), `lib/apiClient.ts` (401 → sign-in with return path), routes; tests next to each.

- Test first: a refused write → one toast with its reason, rolled back, no recovery entry; a temporary write failure → one toast with Try again and one pill entry; an offline write pauses with no toast and no entry and resumes on reconnect; a render error shows "Something went wrong · Reload"; notes list 500 → "Couldn't load the notes · Try again"; note 404 → "This note was deleted or isn't shared with you"; share-link error → inline with Try again and no link created; clipboard failure → inline; verification email failure → inline with Resend; API 401 after refresh → sign-in route with `?next=`.

### Task 6: Copy, brand rule 5, model switch defaults

**Files:** `apps/web/src/i18n/en.ts`, `de.ts`, `docs/BRAND.md`, `docs/rfcs/WALLYBOT_INLINE.md`, `apps/api/src/env.ts`, `.github/workflows/release.yml`, `apps/api/src/lib/assistant/budget/prices.ts` (comment), `.env.example` if present.

- Copy: fold duplicate failure strings into the one voice; brandGuards test still green.
- Defaults: `ASSISTANT_MODEL` `vertex:gemini-3.8-flash`, `ASSISTANT_VERTEX_LOCATION` `eu`, in `env.ts` and in `release.yml`'s fallbacks; test that the env defaults parse and the price table has the default model.

### Task 7: E2E, suite, live check, review, PR

- `apps/web/e2e/error-states.spec.ts`: capture null → "Nothing to add"; capture 502 → "Busy right now · Try again" and Try again asks once more; notes list 500 → "Couldn't load the notes".
- Full suites (web, API with the emulator), typecheck, lint, format; live check on :5250; whole-branch review on a fresh Opus reviewer; one fix pass; PR; CI.
