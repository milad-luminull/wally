# ADR-0026: Wally's infrastructure in Terraform, starting with a new Google Cloud project

- **Status:** accepted
- **Date:** 2026-11-01; scope widened from Google Cloud to every provider on 2026-11-05, and
  Supabase deferred on 2026-11-06, edited in place by the owner's decision rather than
  superseded
- **Deciders:** Milad Rezazadeh

## Context and problem statement

Wally's Google Cloud resources live in `luminull-wally`, a project that was set up as a
Firebase project. Firebase was retired there on 2026-11-01 (workstream 6 of
[RFC-0011](../rfcs/RFC-0011-platform-migration.md); [DEPLOY.md](../DEPLOY.md#firebase-retired)),
but it cannot be removed from the project: Google documents that "once you 'add Firebase' to an
existing Google Cloud project, it can't be undone"
([existing Cloud project](https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project)).
What remains costs nothing, but one part of it is a trap. The Firebase plan is the project's
billing link, and switching it from Blaze to Spark on 2026-11-01 unlinked billing and stopped
Cloud Run from 20:49 to 21:20 UTC.

Everything else outside the code is set by hand too: `gcloud` commands in DEPLOY, the Auth0 and
Cloudflare dashboards, and GitHub variables. Nothing shows when a setting drifts, and nothing
can be rebuilt from the repository. RFC-0011 chose Terraform (section 8) and left its scope open.

## Considered options

1. **Keep `luminull-wally` and the hand setup:** good, because it needs no work; bad, because the
   Firebase leftovers, the billing trap and the drift stay.
2. **Move to a new project by hand:** good, because it removes the leftovers at once; bad,
   because the move can't be reproduced.
3. **A new project created with Terraform, the other providers by hand:** good, because Google
   Cloud is rebuilt from code; bad, because Auth0, Cloudflare, Supabase and GitHub keep drifting.
4. **A new project created with Terraform, and every provider with an official Terraform
   provider managed by it:** good, because one plan shows all of Wally's infrastructure; bad,
   because Terraform needs a token for each provider.

## Decision outcome

Chosen option: **4**. The rules:

- **Rebuilt:** Google Cloud only, in a new project that Firebase is never added to. It holds the
  Cloud Run service and its runtime account, Artifact Registry, Secret Manager, Workload
  Identity Federation and the deploy account, Vertex AI access and the billing budget.
- **Imported, never recreated:** the Auth0 tenant's configuration, the Workers' Custom Domains,
  and the GitHub environment and variables. They hold users, passkeys or hostnames, and
  Terraform's `import` blocks adopt them as they are
  ([import](https://developer.hashicorp.com/terraform/language/import)). Supabase joins with
  Third-Party Auth (workstream 3).
- **One owner per setting:** Terraform owns the infrastructure; the release owns the API image,
  its environment and the Worker versions; the Drizzle migrations own the schema and pg_cron;
  `wrangler.jsonc` owns Worker settings. Terraform ignores what another owner sets
  ([lifecycle](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle)).
- **Secret values are never set by Terraform:** it creates each secret and its readers, and the
  value is added by hand, so it never reaches state
  ([sensitive data in state](https://developer.hashicorp.com/terraform/language/state/sensitive-data)).
- **What holds data, users or traffic is protected** from `terraform destroy`, with
  `prevent_destroy` or the resource's own deletion protection, as Google advises for stateful
  resources ([style](https://docs.cloud.google.com/docs/terraform/best-practices/general-style-structure)).
- **State** is in a versioned Cloud Storage bucket in the EU
  ([gcs backend](https://developer.hashicorp.com/terraform/language/backend/gcs)). A plan is
  saved on `main` and applied after the owner approves it, with Workload Identity Federation
  for Google Cloud ([operations](https://docs.cloud.google.com/docs/terraform/best-practices/operations)).
  A separate bootstrap root, which the owner applies from their machine, creates the project,
  the state bucket and Terraform's own identity. Terraform's identity may grant only the roles
  the pipeline's root grants
  ([limits on granting roles](https://docs.cloud.google.com/iam/docs/setting-limits-on-granting-roles)).
- **Not in Terraform:** creating the accounts themselves, Terraform's own access, secret values,
  data, zone-wide Cloudflare settings, organization policies and, for now, Supabase.
  [DEPLOY.md](../DEPLOY.md#infrastructure-in-terraform) lists each with how it is checked.

`luminull-wally` stays in service until the cutover and is deleted by hand after it. The
cutover points the `wally-api-proxy` Worker at the new Cloud Run service; the hostnames, the
Supabase database and the Auth0 tenant do not change.

### Consequences

- Good: Google Cloud can be rebuilt from code, and a plan shows drift on every provider.
- Good: no Firebase plan switch that can unlink billing.
- Bad: Supabase stays by hand until workstream 3. Importing its project leaves the password
  empty in state, so the next apply resets the live password, and the one setting Wally
  changed, the Data API switch, cannot be expressed (owner, 2026-11-06).
- Bad: Terraform holds long-lived credentials (a GitHub App key, and tokens for Auth0 and
  Cloudflare), stored as secrets of a protected GitHub environment, each scoped as narrowly as
  its provider allows. Access to the state bucket is limited to Terraform's identity and the
  owner ([security](https://docs.cloud.google.com/docs/terraform/best-practices/security)).
- Bad: a cutover with its own checks. The new Cloud Run service gets a new `run.app` address,
  so the proxy's origin and the release's variables (`GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`,
  `GCP_DEPLOY_SA`) change.
- Bad: the organization's policies apply again. Domain-restricted sharing blocks public IAM
  bindings, so Cloud Run's invoker check is turned off as before (DEPLOY §9c).
- Bad: Vertex AI quotas are per project, and Gemini 3.8 Flash on the `eu` endpoint was
  verified for `luminull-wally` only; both are re-checked in the new project
  ([quotas](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/quotas)).
- Bad: the state bucket costs a few cents a month. Cloud Storage's free tier covers US regions
  only ([free tier](https://docs.cloud.google.com/free/docs/free-cloud-features)); approved by
  the owner on 2026-11-05.
- Neutral: until the move, DEPLOY's warning stands. Never unlink billing on `luminull-wally`,
  and never switch its Firebase plan to Spark.

## More information

- Scope, ownership and the cutover order: [RFC-0011](../rfcs/RFC-0011-platform-migration.md)
  section 10. Commands go to [DEPLOY.md](../DEPLOY.md) as each part is built.
