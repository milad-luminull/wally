# ADR-0026: A new Google Cloud project for Wally, created with Terraform

- **Status:** accepted
- **Date:** 2026-11-01
- **Deciders:** Milad Rezazadeh

## Context and problem statement

Wally's Google Cloud resources live in `luminull-wally`, a project that was set up as a
Firebase project. Firebase was retired there on 2026-11-01 (workstream 6, part 1 of
[RFC-0011](../rfcs/RFC-0011-platform-migration.md); [DEPLOY.md](../DEPLOY.md#firebase-retired)),
but it cannot be removed from the project: Google documents that "once you 'add Firebase' to an
existing Google Cloud project, it can't be undone"
([existing Cloud project](https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project)).
What remains costs nothing, but one part of it is a trap. The Firebase plan is the project's
billing link, and switching it from Blaze to Spark on 2026-11-01 unlinked billing and stopped
Cloud Run from 20:49 to 21:20 UTC. The question is whether Wally should keep living in this
project.

## Considered options

1. **Keep `luminull-wally`:** good, because it needs no work; bad, because the Firebase
   leftovers and the plan switch that unlinks billing stay for good.
2. **Move to a new project now, by hand:** good, because it removes the leftovers at once;
   bad, because the move is manual, can't be reproduced, and repeats work that Terraform will
   redo anyway.
3. **Move to a new project created with Terraform, when Terraform is adopted:** good, because
   the new project starts clean and is described in code from day one; bad, because the
   leftovers stay until then.

## Decision outcome

Chosen option: **3**. When Terraform is adopted for the Google Cloud side, it creates a new
project that has never been linked to Firebase, and Wally moves to it. `luminull-wally` stays in
service until that cutover, and is retired after it. RFC-0011 decided on Terraform (section 8)
and left its scope open; this project is part of that scope.

Everything Wally uses in `luminull-wally` moves:

- the Cloud Run service and its runtime account;
- the Artifact Registry repository;
- Secret Manager;
- Workload Identity Federation and the deploy account;
- Vertex AI access;
- billing alerts.

The cutover points the `wally-api-proxy` Worker at the new Cloud Run service. The public
hostnames, the Supabase database and the Cloudflare edge do not change.

### Consequences

- Good: the project holds only what Wally uses, and it can be rebuilt from code.
- Good: no Firebase plan switch that can unlink billing.
- Bad: a cutover with its own checks. The new Cloud Run service gets a new `run.app` address, so
  the proxy's origin and the release's variables (`GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`,
  `GCP_DEPLOY_SA`) change.
- Bad: the organization's policies apply again. Domain-restricted sharing blocks public IAM
  bindings, so Cloud Run's public access has to be set up the same way as before (DEPLOY §9c).
- Bad: model availability has to be re-checked. Gemini 3.8 Flash on the `eu` endpoint was
  verified for `luminull-wally` specifically.
- Neutral: until the move, DEPLOY's warning stands. Never unlink billing on `luminull-wally`,
  and never switch its Firebase plan to Spark.

## More information

- Unverified, to be checked in the Terraform design: how the existing resources are best
  recreated and how long the old project should be kept after the cutover; whether Vertex AI
  quotas carry over to a new project.
- [RFC-0011](../rfcs/RFC-0011-platform-migration.md) sections 2 and 8;
  [DEPLOY.md, Firebase retired](../DEPLOY.md#firebase-retired).
