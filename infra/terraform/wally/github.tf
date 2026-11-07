# The `production` environment and the release's variables, imported as they were on
# 2026-11-06. The `infrastructure` environment is Terraform's own gate and stays outside it,
# and so do the E2E test fixtures and every secret value (docs/DEPLOY.md).

locals {
  repository = "wally"

  # Repository variables. The four GCP_* values still name luminull-wally; the cutover
  # points them at luminull-wally-prod (RFC-0011 section 10, step 2).
  repository_variables = {
    API_BASE_URL         = "https://api.wally.luminull.com"
    ASSISTANT_ENABLED    = "true"
    GCP_DEPLOY_SA        = "github-deployer@luminull-wally.iam.gserviceaccount.com"
    GCP_PROJECT_ID       = "luminull-wally"
    GCP_REGION           = "europe-west1"
    GCP_WIF_PROVIDER     = "projects/128432325938/locations/global/workloadIdentityPools/github/providers/wally-prod"
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
