## What and why

<!-- What changes, and what problem it solves. Link the requirement if there is one. -->

## Definition of done

From `docs/SETUP.md` — CI enforces the first three; the rest are yours to confirm.

- [ ] `make test` and `make lint` pass
- [ ] Types check with no errors
- [ ] Formatting is clean (`pnpm format:check`)
- [ ] `make up` starts clean from an empty checkout
- [ ] No console errors in the browser
- [ ] Verified in the running app, not just in tests

## Anything reviewers should know

<!-- Trade-offs, things deliberately left out, follow-ups worth filing. -->

<!--
Reminder: a PR from a fork cannot reach the E2E credentials, so the E2E job is skipped and
the "E2E gate" check fails on purpose. A maintainer has to push the branch to this repository
and merge from there.
-->
