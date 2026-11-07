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
the Action has its own Node test in `scripts/`. The same holds for a few files next to app
code that no CI job reads: the Infrastructure and Keepalive workflows, the web Worker's
`wrangler.jsonc` and `.gitignore`. Of the last 20 merged pull requests, #108, #110, #111 and
#112 ran in full only because they also touched one of these. Yet such a pull request waits
about five minutes for E2E and two and a half for the unit suites (main's CI run of
2026-11-07). The question is which files can skip which jobs without weakening the required
checks.

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
impact") diffs the merge commit against its first parent. The pull request has no app impact
when every changed file is one of:

- a `*.md` file, or a file under `docs/`;
- a file under `infra/terraform/`, or `infra/auth0-post-login.cjs`;
- `.github/workflows/infrastructure.yml` or `.github/workflows/keepalive.yml`;
- `apps/web/wrangler.jsonc` or `.gitignore`.

Then `Typecheck & build`, `Unit & integration tests` and `E2E (full stack)` are skipped.
`Lint & format` always runs; it checks formatting, which honours `.gitignore`, and runs
`node --test scripts/*.test.mjs`, which includes the Action's test. Any other file means a
full run, including `ci.yml`, `release.yml`, `.github/actions/` and
`apps/api-proxy/wrangler.jsonc`, which the proxy's build (`wrangler deploy --dry-run`) reads
in `Typecheck & build`.

Why the files next to the app are safe to skip: no CI job reads them. E2E runs the compose
stack, where the web app runs on Vite's dev server behind an nginx TLS proxy, never on the
Workers; the web build is Vite alone; the release, not CI, deploys the Workers and
smoke-tests their previews. And every push to
`main` still runs the full suite, which the release requires for the commit it deploys, so a
mistake shows on `main` before it can ship.

### Consequences

- Good: a Terraform or Action pull request is done when Lint & format is, in about a minute
  instead of six, and its own checks (`Format and validate` in the Infrastructure workflow,
  and the Action's test) still run.
- Bad: a listed file that a CI job starts to read would skip the suites that test it. Nothing
  does today; when one does, take it off the list in `.github/workflows/ci.yml`, as
  `apps/api-proxy/wrangler.jsonc` already is.
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
