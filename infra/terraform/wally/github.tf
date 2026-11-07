# The `production` environment and the release's variables, imported as they were on
# 2026-11-06, and the ruleset on `main`. The `infrastructure` and `infrastructure-plan`
# environments are Terraform's own access and stay outside it, and so do the E2E test
# fixtures and every secret value (docs/DEPLOY.md).

locals {
  repository = "wally"

  # Repository variables. The release deploys to the project and identity this root creates.
  repository_variables = {
    API_BASE_URL         = "https://api.wally.luminull.com"
    ASSISTANT_ENABLED    = "true"
    GCP_DEPLOY_SA        = google_service_account.deployer.email
    GCP_PROJECT_ID       = local.project_id
    GCP_REGION           = local.region
    GCP_WIF_PROVIDER     = google_iam_workload_identity_pool_provider.release.name
    VITE_AUTH0_CLIENT_ID = "Ck830qbC3GVTQDL3W3ku4yRA43O1R5hp"
    WEB_ORIGIN           = "https://wally.luminull.com"
  }

  # The `production` environment's variables, which override the repository's.
  production_variables = {
    AUTH0_MANAGEMENT_CLIENT_ID = "a7hTQAyJGPQWpTXdvn1BXA0STH8DoTmw"
    AUTH0_SIGNUP_ENABLED       = "true"
    CLOUDFLARE_ACCOUNT_ID      = "400311f4d8f3184112f4e9478c58535c"
    MCP_CLIENT_ID              = "tpc_oR2NUn5BAcms9r5Z5MhHVf"
    MCP_ENABLED                = "true"
    MCP_WRITES_ENABLED         = "true"
    VITE_AUTH0_CLIENT_ID       = "Ck830qbC3GVTQDL3W3ku4yRA43O1R5hp"
  }
}

# The release runs here: v* tags only, after the owner approves.
resource "github_repository_environment" "production" {
  repository          = local.repository
  environment         = "production"
  can_admins_bypass   = true
  prevent_self_review = false

  reviewers {
    users = [tonumber(local.github_owner_id)]
  }

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "production_tags" {
  repository  = local.repository
  environment = github_repository_environment.production.environment
  tag_pattern = "v*"
}

# `main` changes only through a pull request whose CI passed. Before this, nothing enforced
# the checks ci.yml calls required: `main` had no branch protection and no ruleset
# (2026-11-07). A job skipped by its condition reports success, so the Terraform-only and
# docs-only skips of ADR-0029 pass; `E2E gate` fails every other skip.
#
# - No approving review: the owner is the only person with write access and opens or merges
#   every pull request, and GitHub does not let an author approve their own. Code-owner
#   review stays off for the same reason (.github/CODEOWNERS names only the owner).
# - Checks need not be run against the latest `main` (strict off): Dependabot's pull requests
#   would each need a rebase and a new run after every merge. The push to `main` runs the
#   full CI again, and the release deploys only a commit whose push run passed (release.yml).
# - The checks must come from GitHub Actions (integration 15368), so a commit status of the
#   same name set through the API cannot satisfy them.
# - Bypass: repository admins, which is the owner alone, on pull requests only. When CI is
#   red for a reason outside the change (an Auth0 outage failing E2E), the owner can still
#   merge the fix by ticking the bypass box, and GitHub records it. Direct pushes and force
#   pushes to `main` stay blocked for everyone. Claude sessions use the owner's account, so
#   they could bypass too; that only the owner merges is a project rule, not this ruleset.
# - Tags are not covered: the release starts from a `v*` tag push, gated by the `production`
#   environment's approval. Dependabot works through pull requests and is unaffected.
resource "github_repository_ruleset" "main" {
  repository  = local.repository
  name        = "main"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/heads/main"]
      exclude = []
    }
  }

  bypass_actors {
    actor_id    = 5 # the repository role `admin`
    actor_type  = "RepositoryRole"
    bypass_mode = "pull_request"
  }

  rules {
    deletion         = true
    non_fast_forward = true

    pull_request {
      required_approving_review_count   = 0
      require_code_owner_review         = false
      dismiss_stale_reviews_on_push     = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
    }

    required_status_checks {
      strict_required_status_checks_policy = false

      dynamic "required_check" {
        for_each = toset(["E2E gate", "Lint & format", "Typecheck & build", "Unit & integration tests"])
        content {
          context        = required_check.value
          integration_id = 15368 # GitHub Actions
        }
      }
    }
  }
}

resource "github_actions_variable" "repository" {
  for_each = local.repository_variables

  repository    = local.repository
  variable_name = each.key
  value         = each.value
}

resource "github_actions_environment_variable" "production" {
  for_each = local.production_variables

  repository    = local.repository
  environment   = github_repository_environment.production.environment
  variable_name = each.key
  value         = each.value
}

# ─── imports ────────────────────────────────────────────────────────────────────────────────
# Each block adopts what already exists; the first plan must show no change to these.

import {
  to = github_repository_environment.production
  id = "wally:production"
}

import {
  to = github_repository_environment_deployment_policy.production_tags
  id = "wally:production:62822322"
}

import {
  for_each = local.repository_variables
  to       = github_actions_variable.repository[each.key]
  id       = "wally:${each.key}"
}

import {
  for_each = local.production_variables
  to       = github_actions_environment_variable.production[each.key]
  id       = "wally:production:${each.key}"
}
