# ADR-0030: One approval for Terraform, in an environment that holds no credentials

- **Status:** accepted
- **Date:** 2026-11-07
- **Deciders:** Milad Rezazadeh
- **Supersedes:** none. It changes how the approval of
  [ADR-0026](ADR-0026-new-google-cloud-project-created-with-terraform.md) ("a plan is saved on
  `main` and applied after the owner approves it") is given, not whether.

## Context and problem statement

The Infrastructure workflow ran Plan and Apply in the `infrastructure` environment, which
requires the owner's approval. So every Terraform change needed two approvals, and the first
came before any plan existed, so it judged nothing. The environment also holds Terraform's
credentials: five variables and five secrets, and the Workload Identity provider in
`infra/terraform/bootstrap` accepts tokens only from jobs in that environment. The question is
how to approve once, after reading the plan, without copying those credentials.

## Decision drivers

- The owner approves once per change, after the plan is in the run summary.
- One set of Terraform credentials: a second copy means three new API tokens and a second
  GitHub App key to create, keep and revoke.
- No change the owner has to apply from their machine.

## Considered options

1. **Keep two approvals:** good, because nothing changes; bad, because the first approval
   judges nothing and every change costs two clicks.
2. **Plan in a second, unreviewed environment with a copy of the credentials:** good, because
   GitHub's environment rule guards Apply's credentials directly; bad, because every secret
   exists twice, and the bootstrap's provider must accept the second environment.
3. **An approval job in its own environment that holds nothing, between Plan and Apply:** good,
   because the credentials stay in one environment and the bootstrap is untouched; bad,
   because `infrastructure` loses its reviewer, so the approval is a `needs:` edge in the
   workflow rather than a rule on the credentials.

## Decision outcome

Chosen option: **3**. Plan runs in `infrastructure` without waiting. The job "Approve the
plan" runs in `infrastructure-approval`, which requires the owner, allows `main` only, and
holds no secret, variable or token permission. Apply needs it and runs in `infrastructure`
again, applying the saved plan. `infrastructure` keeps its `main`-only branch policy and no
longer has a reviewer.

### Consequences

- Good: one click per Terraform change, given with the plan in front of the owner.
- Bad: Plan, and any job on `main` that names `infrastructure`, gets credentials that can
  write without a click. Only code on `main` can do that, and such code could already rewrite
  the workflow to skip any approval, so the approval guards against applying an unread plan,
  not against code on `main`.
- Bad: if `infrastructure-approval` did not exist, GitHub would create it on first use with no
  protection, and Apply would run unapproved. It must exist before the workflow names it.
- Neutral: both environments stay outside Terraform, like `infrastructure` before.

### Confirmation

An Infrastructure run on `main` shows Plan done and "Approve the plan" waiting for the owner;
Apply starts only after the approval.

## More information

- Possible later hardening: the bootstrap's provider could also require
  `assertion.ref == "refs/heads/main"`, so Google enforces `main` independently of the
  environments' branch policies. GitHub's OIDC token carries the `ref` claim
  ([OpenID Connect](https://docs.github.com/en/actions/reference/security/oidc)).
- GitHub: a workflow that references an environment that does not exist creates it
  ([managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)).
- Setup and order: [`DEPLOY.md`](../DEPLOY.md#infrastructure-in-terraform), Bootstrap step 3.
