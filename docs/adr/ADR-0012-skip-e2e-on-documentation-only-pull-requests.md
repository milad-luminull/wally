# ADR-0012: Skip E2E on documentation-only pull requests

- **Status:** proposed
- **Date:** 2026-10-14
- **Deciders:** Milad Rezazadeh
- **Supersedes:** ADR-0009, in part: its Confirmation, "CI runs every suite on every pull request"

## Context and problem statement

The E2E job builds the whole compose stack, installs browsers and runs Playwright on every pull
request. A pull request that changes only Markdown or files under `docs/` cannot change what
that job tests, yet it waits for the slowest check in CI. The question is how to skip that job
for documentation without weakening the `E2E gate` check that ADR-0009 relies on.

## Decision drivers

- `E2E gate` must keep failing when E2E did not run for any other reason, fork pull requests
  included.
- A docs-only pull request must never leave a check pending.
- `release.yml` reads `main`'s CI run for the tagged commit before deploying, so pushes to
  `main` must keep the full run.

## Considered options

1. **`paths-ignore` on the workflow trigger:** simplest; bad, because a skipped workflow
   leaves its checks pending and blocks merging once they are required, and a docs-only push
   to `main` would leave `release.yml` no CI run to read.
2. **A third-party path-filter action:** expressive; bad, because it adds a dependency to a
   workflow whose actions are pinned by commit for supply-chain reasons.
3. **A `changes` job with `git diff`, and an `if:` on the E2E job:** no dependency, and a job
   skipped by a condition reports success; bad, because one more job runs on every pull request.

## Decision outcome

Chosen option: **3**. On a pull request, the `changes` job diffs the merge commit against its
first parent. If every changed file is a `*.md` file or sits under `docs/`, the E2E job is
skipped and `E2E gate` passes with that reason. On any other event the job always reports code,
so pushes to `main` run E2E as before. Lint, format, typecheck and the unit suites still run on
every change.

### Consequences

- Good: documentation pull requests finish in minutes and stay mergeable.
- Bad: a Markdown file that something executes or bundles would skip E2E; none exists today,
  and adding one means narrowing the patterns in `.github/workflows/ci.yml`.
- Neutral: the classification lives in one shell `case` statement in the `changes` job.

### Confirmation

`E2E gate` passes only when E2E succeeded, or when it was skipped and the `changes` job found
documentation alone. If the `changes` job fails, the gate fails.

## More information

- GitHub: a job skipped by a condition reports success, even as a required check
  ([using conditions to control job execution](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/using-conditions-to-control-job-execution)).
- GitHub: a workflow skipped by path filtering leaves its checks pending, which blocks merging
  ([troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)).
- CI jobs and the gate: [`DEPLOY.md`](../DEPLOY.md), "Continuous integration".
