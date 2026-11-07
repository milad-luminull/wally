# ADR-0029: Skip the slow CI jobs on pull requests without app impact

- **Status:** accepted
- **Date:** 2026-11-07
- **Deciders:** Milad Rezazadeh
- **Supersedes:** [ADR-0012](ADR-0012-skip-e2e-on-documentation-only-pull-requests.md), in part:
  which files count as "no app impact", and its rule that typecheck and the unit suites run on
  every change

## Context and problem statement

Since ADR-0012, a pull request that changes only Markdown or `docs/` skips the E2E job. Every
other pull request runs the whole suite, including those that change only Terraform
(`infra/terraform/`) or the Auth0 post-login Action (`infra/auth0-post-login.cjs`). Neither is
part of anything CI builds or tests: the API, the web app and the Workers never read them, and
the Action has its own Node test in `scripts/`. Yet such a pull request waits about five minutes
for E2E and two and a half for the unit suites (main's CI run of 2026-11-07). The question is which files can skip which
jobs without weakening the required checks.

## Decision drivers

- A pull request that can change what the app builds or does must keep running every job.
- `E2E gate` must keep failing when E2E did not run for any other reason, fork pull requests
  included, and when the classification itself failed.
- `release.yml` reads `main`'s CI run for the tagged commit, so pushes to `main` keep the full
  run.
- No new dependency in the workflows (ADR-0012, option 2).

## Considered options

1. **Keep ADR-0012 as it is:** good, because nothing changes; bad, because every Terraform
   change waits for a suite that cannot fail because of it.
2. **Add Terraform and the Action to the docs-only list, skipping E2E only:** good, because one
   pattern changes; bad, because typecheck, build and the unit suites still run for nothing.
3. **Classify those files as having no app impact, and skip E2E, typecheck and build, and the
   unit suites for them:** good, because such a pull request finishes with Lint & format;
   bad, because three jobs now depend on the classification instead of one.

## Decision outcome

Chosen option: **3**. On a pull request, the `changes` job ("Detect changes without app
impact") diffs the merge commit against its first parent. If every changed file is a `*.md`
file, or sits under `docs/` or `infra/terraform/`, or is `infra/auth0-post-login.cjs`, the
pull request has no app impact: `Typecheck & build`, `Unit & integration tests` and
`E2E (full stack)` are skipped. `Lint & format` always runs; it checks formatting and runs
`node --test scripts/*.test.mjs`, which includes the Action's test. Any other file, including
anything under `.github/`, means a full run. Pushes to `main` always run everything.

### Consequences

- Good: a Terraform or Action pull request is done when Lint & format is, in about a minute
  instead of six, and its own checks (`Format and validate` in the Infrastructure workflow,
  and the Action's test) still run.
- Bad: a file under `infra/terraform/` that something in the app starts to read would skip the
  suites that test it. Nothing does today; adding one means narrowing the pattern in
  `.github/workflows/ci.yml`.
- Bad: when the `changes` job fails, the two skipped jobs report as passing. `E2E gate` fails
  then, and it is required, so the pull request still cannot merge.
- Neutral: the classification stays one shell `case` statement.

### Confirmation

`E2E gate` passes only when E2E succeeded, or when it was skipped and the `changes` job
succeeded and found no app impact. The repository ruleset on `main` requires it, with
`Lint & format`, `Typecheck & build` and `Unit & integration tests`
(`infra/terraform/wally/github.tf`).

## More information

- GitHub: a job skipped by a condition reports success, even as a required check
  ([using conditions to control job execution](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/using-conditions-to-control-job-execution)).
- CI jobs and the gate: [`DEPLOY.md`](../DEPLOY.md#17-continuous-integration).
