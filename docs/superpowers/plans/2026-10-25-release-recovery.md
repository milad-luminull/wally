# Auth0/MCP release recovery implementation plan

> For agentic workers: use superpowers:executing-plans to implement this plan task-by-task after owner review. This document does not authorize another release attempt by itself.

**Goal:** Complete the already-approved full Auth0/MCP release through a verified deployment path, without discovering prerequisites by repeatedly deploying production.

**Architecture:** Separate operator-managed infrastructure bootstrap from repeatable application release. The release verifies prerequisites with its actual GitHub workload identity before mutations, updates the candidate and worker image, then publishes only after candidate checks pass.

**Tech stack:** GitHub Actions, Cloud Run, Cloud Scheduler, Firestore, Firebase Hosting, Node test runner and shell scripts. No new runtime dependencies.

**Spec:** Owner-approved Auth0/full-MCP/account-controls release plan in this conversation; docs/superpowers/plans/2026-10-23-auth0-mcp-release.md. This plan repairs deployment mechanics, not feature scope.

## Constraints

- No further deployment retry, IAM changes, tag or application changes during this review.
- Preserve Auth0/MCP authorization, writes, revocation, private-note protection, idempotency and account controls.
- Preserve dirty original checkout and all running local sessions; never remove/recreate wally-api-1.
- No real-user data writes or deletion tests. Acceptance uses explicitly designated disposable fixtures.
- Do not grant broad Run Admin/Editor permissions to overcome individual errors.
- Do not claim automated tests establish real Auth0, ChatGPT or provider-deletion acceptance.

## Evidence and current state (25 October 2026, Europe/Berlin)

- v0.8.1 failed because the domain guard required an absent CLI beta component.
- 550e0fb8 added explicit beta installation. v0.8.2 setup and domain-guard tests subsequently passed.
- v0.8.2 attempt 1 failed on run.domainmappings.get. A role containing that permission alone was added to github-deployer.
- v0.8.2 attempt 2 passed the domain guard, rollout validation and rollback capture. Firestore deployment, image push, candidate API and cleanup job creation succeeded.
- Attempt 2 failed at google.cloud.run.v1.Jobs.SetIamPolicy, permission run.jobs.setIamPolicy denied. Both workflow and Cloud Audit Logs confirm this.
- The deployer has a custom get/set job IAM role with modifiedGrantsByRole restricted to roles/run.invoker. Its existence did not establish effective authorization. Google's current documentation lists Cloud Run as supporting the attribute: do not claim it is generally unsupported. Exact condition/request evaluation remains unresolved.
- Fresh Cloud Run read: wally-api-rel-0dece50 still serves 100%; wally-api-rel-550e0fb is ready and tagged with no percentage traffic. Tagged candidate is reachable separately; do not describe this as zero infrastructure change.
- Cleanup job exists and is Ready, with no execution shown in status. Its direct IAM policy has no bindings. Scheduler list is empty. accountDeletionJobs TTL is absent.
- Hosting publish and traffic shift were skipped in the run. Independent owner-token Hosting read returned 403; use successful workflow capture and repair read-only inspection before asserting a fresh Hosting version.
- Source review found index polling suppresses list failures and can interpret them as ready. Scheduler lookup treats every error as not-found.

## Review focus

1. Denied or unavailable preflight reads must stop before mutation, never count as missing/healthy.
2. A partially deployed candidate must be resumable without rebuilding a conflicting immutable revision.
3. Cleanup configuration must not start processing unexpectedly before release readiness.
4. Runtime worker identity must be checked separately from deployer identity.
5. Partial traffic/Hosting failures must restore the captured pair, with durable evidence.

## Task 1 — complete the dependency and permission inventory

- [ ] Map every command in .github/workflows/release.yml and scripts/deploy-account-cleanup.sh to its principal, resource, required permission, side effect and recovery action; save in docs/ACCOUNT_CONTROLS_RELEASE.md.
- [ ] Cover domain read, Artifact Registry, all three service-account attachments, job update/read, scheduler OAuth invocation, worker Firestore/Firebase/secret access, TTL, Hosting publication and both rollback operations.
- [ ] Use read-only policy inspection, audit logs and policy troubleshooting to explain the current conditional job-IAM denial; do not change its condition experimentally in production.
- [ ] Verify current Firebase rules/index changes against old production compatibility, serving API/Hosting pair and existing candidate digest.
- [ ] Record effective checks versus merely inferred permissions. Unverified entries block retry, not silently pass.

## Task 2 — separate bootstrap from ordinary deployment

Files: scripts/deploy-account-cleanup.sh; new scripts/bootstrap-account-cleanup.sh; docs/ACCOUNT_CONTROLS_RELEASE.md.

- [ ] Move one-time scheduler-to-job invocation grant and completed-job TTL setup into explicit operator bootstrap. Reuse the already-created job; do not delete/recreate it.
- [ ] Provision/verify the scheduler with the dedicated identity and exact job URL; keep it paused during preparation. Define release activation and failure pause behavior explicitly.
- [ ] Remove routine IAM policy mutation from deployment. After read-only verification of the replacement, remove the now-unneeded deployer job-policy mutation binding.
- [ ] Retain least-privilege deployment access for image/config updates. Verify dedicated worker secret, database and exact-identity deletion permissions without executing deletion on real accounts.
- [ ] Bootstrap must be idempotent, distinguish denied reads from not-found, and produce a redacted state report.

## Task 3 — fail-closed preflight and repeatable release

Files: .github/workflows/release.yml; new scripts/check-release-prerequisites.mjs; scripts/deploy-account-cleanup.sh.

- [ ] Run a read-only preflight under the actual GitHub WIF deployer before Firestore deployment. Check required configuration, resource readiness, accessible dependencies and available effective permission checks. Unknown results fail with actionable messages.
- [ ] Make this preflight independently runnable through a protected workflow path that cannot deploy or shift traffic. Do not relax existing WIF/environment protection to test it.
- [ ] Replace suppressed index errors with explicit command status and parsed states; distinguish empty successful lists from denied/failed calls.
- [ ] Replace scheduler existence guessing with explicit not-found handling; denied/unavailable responses must fail.
- [ ] Require both rollback targets and save them plus candidate/image identity as durable workflow evidence before mutation.
- [ ] Reuse a recorded image digest for a same-candidate retry or prove the existing revision matches; never rebuild an image and blindly reuse its immutable revision name. Shift traffic to the verified exact revision instead of --to-latest.
- [ ] Review failure conditions around traffic shifts and Hosting publication, including commands that mutate before returning failure. Inspect actual state and restore the pair when needed.

## Task 4 — focused regression tests and non-public verification

Files: new scripts/release-prerequisites.test.mjs and scripts/deploy-account-cleanup.test.mjs; existing scripts/check-api-domain.test.mjs.

- [ ] Before implementation, add failing cases for missing permission, failed index list, pending index, scheduler 403 versus 404, missing rollback target, mismatched retry digest, and partial traffic/Hosting failures.
- [ ] Use fake command/API adapters; assert no mutation runs after failed preflight and no IAM mutation occurs in ordinary deployment.
- [ ] Run node --test on the three scripts' test files; require all pass, then relevant workflow checks and exact-main CI after review.
- [ ] Run the independently invocable read-only preflight under actual WIF identity. Owner-credential success is not a substitute.
- [ ] Validate the existing no-traffic candidate and worker configuration; use disposable fixtures for any worker execution, explicitly reporting provider cleanup separately.

## Task 5 — one controlled release and acceptance

- [ ] Present the complete repair diff and preflight evidence before requesting another production deployment approval.
- [ ] Use a new reviewed main commit/tag if workflow code changed; preserve v0.8.1/v0.8.2 history. Record current rollback pair immediately before activation.
- [ ] Publish only after candidate, worker and web checks pass. Activate the verified scheduler deliberately; failure handling must account for it.
- [ ] Verify permanent-endpoint Auth0/login/signup and real ChatGPT reads/writes/retries/denial/revocation/widgets using disposable data; verify account controls and provider cleanup independently.
- [ ] Observe for 30 minutes and preserve release evidence. Roll back the API/Hosting pair for the agreed critical failures.

## Code-review corrections — 25 October 2026

This section supersedes vague or conflicting steps above. Reviewed release.yml, deploy-account-cleanup.sh, API Dockerfile, account-maintenance.ts, account cleanup/providers, environment validation, Firebase configuration and the existing domain-guard tests. This is a deployment-focused review, not a fresh audit of every MCP/account feature.

### Findings backed by code or reproduction

| Finding                                             | Evidence                                                                                                                      | Required correction                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Index-list errors report readiness                  | Exact pipeline reproduced with a fake gcloud exiting 1: exit 0, output `all indexes READY`                                    | Extract polling into a testable helper; check process status before parsing output                                            |
| Scheduler errors are treated as absence             | Running the actual cleanup script against fake gcloud with describe denied attempted scheduler create                         | Ordinary deploy only verifies existing scheduler; bootstrap handles explicit NOT_FOUND and fails on other errors              |
| Cleanup may start before publication                | Script creates an enabled five-minute schedule before TTL setup, candidate smoke and Hosting publication                      | Prepare scheduler paused; do not allow automatic execution during setup                                                       |
| Worker readiness does not validate provider access  | account-maintenance.ts constructs providers only when a non-complete job exists; provider token is requested only at deletion | Separate non-destructive credential checks from an explicit disposable-account cleanup acceptance test                        |
| API rollback misses partial shift failure           | rollback runs only if steps.shift.outcome is success                                                                          | Mark shift intent before call; inspect actual state on failure and restore captured revision even if command returned failure |
| Exact candidate is not selected                     | update-traffic uses --to-latest                                                                                               | Use recorded revision name explicitly                                                                                         |
| Missing Hosting rollback target is accepted         | Empty HV is written without assertion                                                                                         | Require nonempty version and preserve evidence before mutation                                                                |
| Existing preflight does not cover feature readiness | Candidate smoke checks health and unauthenticated /whiteboards only                                                           | Add MCP discovery/auth challenge and widget-resource/config checks; real OAuth/tool tests remain separate                     |
| Worker rollback state is absent                     | Existing workflow captures only API and Hosting                                                                               | Capture worker image/config and scheduler state; define restoration below                                                     |

### Scope and implementation decisions

1. Keep the existing domain guard and explicit beta installation; its 28 tests passed in this review. Do not replace this functioning check as part of the repair.
2. Keep the single-permission domain-read role. The current failure is unrelated. Do not broaden Cloud Run IAM access.
3. Move scheduler invocation IAM, scheduler provisioning and completed-job TTL into operator bootstrap. Before implementation, inspect the SDK/API for an atomic paused-create option. If unavailable, create against a non-executing target, pause and verify it, then configure the real target while paused. Never create an active real cleanup schedule and merely hope pause happens before its first tick.
4. Ordinary release verifies bootstrap state and updates the worker image/config. Its preflight needs reads, not general job policy administration. Remove the unused conditional job-policy grant only after the replacement path is verified. Explanation of the old denial remains an investigation item; it is not permission to silently remove an IAM restriction from a deployer grant.
5. Read-only preflight cannot prove every write permission or external provider operation. Record three evidence classes: actual read success, IAM evaluation, and fixture-backed execution. Never present mocked tests or owner access as proof of WIF deployment access. Use supported permission-testing APIs/policy troubleshooting where available; document their limits.
6. Put protected preflight in the existing release workflow with an explicitly read-only workflow_dispatch mode, preserving the production environment/WIF claims and branch restrictions. Every mutating step must be gated out in this mode; test that routing. Avoid an extra workflow identity or weakened trust policy. Confirm current WIF restrictions permit dispatch before implementing this decision; if not, surface the exact restriction for review.
7. Do not require yet-to-be-created indexes to be READY in pre-mutation preflight. Preflight checks access and inventories existing state; the post-index-deploy waiter requires all expected indexes READY and rejects errors. This avoids a circular prerequisite.
8. Keep build identity deterministic: record commit, digest, revision and relevant config hash. A retry uses the recorded artifact or stops with a clear mismatch; it does not silently rebuild into the same immutable revision name. Do not retarget failed release tags.
9. Move web build and configuration verification before publication. Check Auth0 provider/client settings as well as the production API URL; preserve the built-in assistant settings explicitly.

### Release state and rollback contract

- Before changes: save API revision, Hosting version, worker image/config, scheduler existence/state, candidate digest and commit in a durable access-controlled workflow artifact. Required artifact-save failure stops deployment. Do not place secrets or tokens in it.
- During candidate preparation: scheduler remains paused; verify no active cleanup execution before updating its job. Pause does not cancel an existing execution. For this first release the prior scheduler is absent; do not fabricate a prior worker version.
- Before activation: API/web candidate checks and worker checks pass. Verify the scheduler can execute only the intended job and the worker uses the intended database and secret reference.
- Activation: explicitly activate scheduler as part of the controlled publication sequence, recording each attempted mutation. If resume fails, do not publish account deletion functionality. A later failure triggers scheduler pause and verification alongside API/Hosting restoration.
- Recovery: reconcile actual traffic/Hosting state even after a failed command. Restore previous worker config if one existed; for this first release leave the prepared job dormant. Inspect running executions and pending deletion jobs before declaring rollback complete. Never claim software rollback reverses an account deletion or restore a deleted identity to undo a user request.
- An interrupted runner cannot guarantee automatic rollback. Persist a runnable operator recovery command and alert path; cancellation/timeout is a separate test case, not covered by `failure()` alone.

### Required test cases beyond the original plan

- Mocked permission-denied index lookup: nonzero exit, no READY result.
- Scheduler lookup denied/unavailable: no create/update call; explicit NOT_FOUND only allowed in bootstrap.
- Missing Hosting version: fail before any database or service mutation.
- Protected read-only mode: no deploy, IAM, schedule, TTL, traffic or Hosting writes on any branch.
- Existing candidate with matching digest/config: safe reuse; mismatch: stop before mutation.
- Traffic changed then command fails: recovery still targets captured revision.
- Hosting published then command fails: both captured versions restored and read back.
- Scheduler resume failure: no publication. Failed publication: pause verified; active executions reported.
- Empty worker queue: result explicitly not provider acceptance. Disposable fixture: exact provider identities deleted, retries remain idempotent, unrelated identities untouched.
- Preserve production build settings, test metadata/unauthenticated MCP behavior, and keep real ChatGPT acceptance clearly distinct.

### Verification actually performed during this review

- Actual script executed against local fake cloud commands: reproduced scheduler-create-after-denial behavior. No real cloud mutation.
- Exact index readiness pipeline executed against local fake cloud command: reproduced false success.
- `node --test scripts/check-api-domain.test.mjs`: 28 passed, 0 failed.
- `git diff 0dece50 550e0fb8 -- firestore.rules firestore.indexes.json firebase.json`: no differences. The successful Firestore deployment did not introduce source changes in these files relative to the serving commit; this does not independently attest remote drift.
- No repaired implementation exists yet. New regression tests, IAM evaluation, WIF preflight, recovery rehearsal and actual acceptance remain required evidence.

## Review conclusion

The two earlier patches addressed observed failures, but did not establish release readiness. The process error was using full production attempts to discover missing infrastructure prerequisites. The current failure is proven; the exact conditional IAM evaluation is still open. No further IAM change or deployment was made during this review.

Sources:

- https://github.com/milad-luminull/wally/actions/runs/40118381734/attempts/2
- https://docs.cloud.google.com/iam/docs/conditions-attribute-reference#api_attributes
- https://docs.cloud.google.com/run/docs/reference/iam/roles
- https://cloud.google.com/firestore/docs/ttl

## Implementation progress and reviewed decisions

- Independent review completed by a separate agent. Four findings accepted: pause failure must block worker replacement; already-paused recovery must be idempotent; worker acceptance must be enforced; reused candidate must match full commit/config identity.
- Recovery and candidate regressions failed before their fixes, then passed. Bootstrap tests verify no executing target exists before pause, denied reads do not cause mutations, and existing paused schedules are reused.
- Ruling: worker activation requires a fresh reviewed evidence record and uses its exact tested digest with matching source/config, instead of the newly rebuilt API image. Cost: changes to worker source/config require new fixture acceptance; workflow-only changes can preserve evidence.
- Ruling: a protected workflow_dispatch preflight must run from an allowed v* tag because production environment policy permits tags only. WIF already trusts this repository/environment without an event restriction; no trust policy widening is necessary. Creating a tag still triggers the separate release job, whose existing production approval must remain withheld until preflight and evidence pass.
- Ruling: production worker/schema/provider acceptance is not satisfied by mocked script tests. No success evidence file is created until real results exist.
- Still pending: operator bootstrap and narrowed cloud roles, runtime/provider fixture acceptance, actual WIF preflight, CI/release integration, final production acceptance. No release retry or cloud configuration mutation has been performed during this implementation pass.

### Live evidence update

Real read-only worker execution, targeted newly-created disposable fixture deletion and
completed-job replay succeeded. Execution IDs and evidence limits are recorded in
ACCOUNT_CONTROLS_RELEASE.md. Existing user/board/identity identifiers match the original
baseline. Bootstrap was applied with the scheduler remaining PAUSED; a CLI update-header
flag mismatch was caught and fixed with a failing regression before resumption. TTL
activation remains pending. No public API/Hosting switch or real-user deletion occurred.

Ruling: the acceptance record is valid for 24 hours and invalidated by changed worker
source/config. This keeps activation tied to recent evidence; cost is repeating fixture
acceptance if approval extends beyond that window. Evidence assertions are reviewed
records, not cryptographic proof of external effects.
