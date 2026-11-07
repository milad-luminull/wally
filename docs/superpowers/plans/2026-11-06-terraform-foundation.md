# Terraform foundation Implementation Plan

**Status:** in progress on branch `claude/infra-as-code-rfc-ed34cc`.

**Goal:** Slice 1 of RFC-0011 workstream 7 ([section 10](../../rfcs/RFC-0011-platform-migration.md#10-infrastructure-in-terraform-workstream-7)):
the Terraform code for the new Google Cloud project `luminull-wally-prod` and for GitHub, the
pipeline that plans and applies it, and the manual parts documented. Nothing is applied by this
PR; the owner bootstraps.

**Architecture:** two root modules, as Google's example foundation separates its bootstrap
stage:

- `infra/terraform/bootstrap`, applied only by the owner from their machine: the project, its
  billing link and budget, its APIs, the state bucket, and Terraform's own identity (a service
  account and a Workload Identity pool that only the `infrastructure` GitHub environment can use).
- `infra/terraform/wally`, applied by GitHub Actions after the owner approves a saved plan:
  everything else on Google Cloud (the release's identity, Artifact Registry, secrets without
  values, the Cloud Run service's shell) and the `production` GitHub environment and variables,
  imported as they are.

**Tech stack:** Terraform 1.17.1, `hashicorp/google` 8.10, `integrations/github` 6.13
(GitHub App auth), state in a versioned GCS bucket in `europe-west1`.

## Owner decisions this plan follows (2026-11-05 and 2026-11-06)

- ADR-0026 edited in place; state in the EU (approved spend); apply from GitHub Actions after
  approval; a GitHub App for Terraform's GitHub access; project ID `luminull-wally-prod`.
- **The Supabase project stays out of Terraform** (2026-11-06): importing it would reset its
  database password on the next apply, and nothing Wally changed there is expressible.
  Replaces the 2026-11-05 "import it now".
- **Auth0, Cloudflare and Supabase's Third-Party Auth provider are imported in slice 2,** from
  config generated with the owner's credentials, cleaned by hand.

## Tasks

1. `.gitignore` entries for Terraform; the bootstrap root; the `wally` root (Google, GitHub
   with import blocks); `.terraform.lock.hcl` for linux_amd64 and darwin_arm64.
2. `.github/workflows/infrastructure.yml`: format and validate on pull requests (no
   credentials); on `main`, a saved plan, then apply after approval.
3. DEPLOY.md "Infrastructure in Terraform": bootstrap, the pipeline, and every manual part with
   how it is checked. ADR-0026 and RFC-0011 section 10 updated to the 2026-11-06 decisions.
4. `terraform fmt -check` and `validate` on both roots; one whole-branch review.

Slice 2 imports Auth0, the Cloudflare Custom Domains and Supabase's Third-Party Auth provider. Slice 3 is the cutover (RFC-0011
section 10).
