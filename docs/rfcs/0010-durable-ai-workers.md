# Durable AI workers

- **Status:** proposed; not implemented. Revised 2026-10-26 for the new platform.
- **Date:** 2026-10-19
- **Context:** [Platform migration](0011-platform-migration.md), workstream 5

## Scope

Run longer AI work and other background work in a private Cloud Run service,
`wally-background`, in Belgium.

- It shares the API's image and domain code, with a different entry point.
- It is invoked only through IAM, never publicly.
- Its durable state (runs, outbox, checkpoints, idempotency keys) lives in Supabase
  PostgreSQL (ADR-0020).
- Separate queues for notifications and AI.

Preserve the existing [assistant controls](0003-wally-agent.md). Identity and external MCP
access are covered by the [Supabase Auth RFC](0012-supabase-auth-and-mcp.md).

Reminder schedules live in PostgreSQL, not as one Scheduler job per user. One recurring
Scheduler job counts as one job, and the first three per billing account are free (owner brief, citing
[Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing)). The
in-flight [reminder work](0011-platform-migration.md#9-in-flight-work-that-must-be-reconciled)
has to adopt this model.

## Execution

1. Record a run and outbox entry transactionally. Dispatch the run ID through Cloud Tasks
   to an authenticated worker; reconciliation recovers missed dispatches.
2. Save checkpoints, usage and completion. Retry temporary failures with backoff and
   bounded attempts; record terminal failures. Duplicate delivery cannot repeat effects.
3. Preserve approvals, cancellation, command receipts and audit attribution. Recheck
   current permissions, grants and assistant switches when resuming. Retries cannot
   approve writes; queue delivery is distinct from run completion.

Use bounded HTTP steps, or resumable steps/separately tracked Cloud Run Jobs for longer
work. Cloud Scheduler triggers recurring work and reconciliation. Do not add a second
queue for the same workflow.

Keep live voice on a realtime session path; queue post-call processing separately.
A managed agent runtime remains an option only if compatibility, recovery, EU behavior
and cost justify it. Model calls, audio, embeddings and tools must be metered separately.

## Done when

Tests cover missed/duplicate dispatch, restart recovery, retry exhaustion, cancellation,
revoked access, approvals and spending limits. Verify EU processing per model/feature;
never silently use a global fallback. Define recovery targets before launch.
