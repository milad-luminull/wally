# ADR-0008: Tag-triggered release to Firebase Hosting and Cloud Run, keyless, with smoke test and rollback

- **Status:** accepted
- **Date:** 2026-09-20
- **Deciders:** Milad Rezazadeh

## Context and problem statement

The web app is static and the API is a long-running container; Firebase Hosting serves the first but cannot run the second. The first releases were made by hand with the commands in [`DEPLOY.md`](../DEPLOY.md). The Google Cloud organisation enforces `iam.disableServiceAccountKeyCreation`, so a CI runner cannot hold a service-account key. How does a release reach production, and what happens when it is bad?

## Decision drivers

- Scale to zero; nothing billed while idle.
- No long-lived cloud credential anywhere, because none can be created.
- A bad release must never be the version users see.

## Considered options

1. **A GitHub Actions workflow on a `v*` tag, authenticated by Workload Identity Federation, deploying the API as a no-traffic Cloud Run revision that is smoke-tested before traffic shifts:** good, because repeatable and keyless, with rollback built in; bad, because a release takes minutes and needs an approver.
2. **Manual `gcloud` and `firebase` commands from a laptop:** good, because nothing to build; bad, because it depends on one machine's credentials and memory, and skipping a step is easy.
3. **`gcloud run deploy --source`:** good, because one command; bad, because it expects the Dockerfile at the root of the source directory, and the API's Dockerfile needs the monorepo root as its build context (ADR-0002).

## Decision outcome

Chosen option: **the tagged release workflow**, [`.github/workflows/release.yml`](../../.github/workflows/release.yml), added in commit `b53a66d9`.

- A `v*` tag that is on `main` reuses the CI workflow, then waits for approval on the `production` GitHub environment.
- GitHub authenticates through Workload Identity Federation, set up once by [`scripts/bootstrap-gcp-cicd.sh`](../../scripts/bootstrap-gcp-cicd.sh), which binds the provider to numeric repository and owner ids rather than names.
- Order: Firestore rules and indexes first, and wait until every index is READY. Then the API image, pushed to Artifact Registry and deployed by digest as a no-traffic revision; the Cloud Run environment is asserted (`FIRESTORE_DATABASE_ID=wally`, `NODE_ENV=production`, no emulator host); the candidate is smoke-tested; traffic shifts. Then the web bundle, built in the job and checked for the production API URL, deployed to Firebase Hosting. Then a read-only smoke test of the live site.
- On a failed post-deploy smoke, both Cloud Run and Hosting are rolled back to the state captured at the start of the job.
- [`cloudbuild.yaml`](../../cloudbuild.yaml) and the commands in `DEPLOY.md` remain as the break-glass path.

### Consequences

- Good: no service-account key exists, in CI or on a laptop.
- Good: a failed candidate revision never served a user, so most failures need no rollback at all.
- Bad: a release takes several minutes and one person has to approve it.
- Bad: the manual path can drift from the workflow; `DEPLOY.md` has to be kept in step by hand.
- Bad: the `prod` stage of `apps/web/Dockerfile` builds an nginx image nothing deploys.
- Neutral: the bootstrap script hard-codes the project, region and repository ids; moving the project means editing it.

### Confirmation

The workflow is its own check: every step above is a job step that fails the release. The bootstrap script is idempotent and safe to re-run.

## More information

- Step-by-step commands, the database trap and the CI job layout: [`DEPLOY.md`](../DEPLOY.md), sections 1, 4, 13 and 17.
- Why Cloud Run rather than only Firebase: `DEPLOY.md`, section 1.
