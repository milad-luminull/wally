# The owner applies this root from their machine, never the pipeline: it creates the project,
# links billing and defines Terraform's own identity. See docs/DEPLOY.md.

locals {
  project_id = "luminull-wally-prod"
  region     = "europe-west1"

  # Numeric IDs, not names: a released GitHub name can be re-registered, a numeric ID cannot.
  github_owner_id = "331026245"
  github_repo_id  = "1376336905"
  github_repo     = "milad-luminull/wally"

  services = [
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ]

  # What the wally root manages, and nothing more.
  terraform_roles = [
    "roles/artifactregistry.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.serviceAccountUser",
    "roles/iam.workloadIdentityPoolAdmin",
    "roles/run.admin",
    "roles/secretmanager.admin",
  ]

  # The only project roles the wally root grants. Terraform may grant these and no others, so
  # it cannot give itself, or anyone, a broader role.
  grantable_roles = [
    "roles/aiplatform.user",
    "roles/run.developer",
    "roles/serviceusage.serviceUsageConsumer",
  ]
}

provider "google" {
  region = local.region
}

# Budgets are called with the new project as the quota project, as the provider requires for
# user credentials.
provider "google" {
  alias                 = "billing"
  billing_project       = local.project_id
  user_project_override = true
}

# A project Firebase is never added to (ADR-0026). deletion_policy PREVENT is the default; it
# is written out because this is the one resource that must never be destroyed by a plan.
resource "google_project" "wally" {
  project_id      = local.project_id
  name            = "Wally"
  org_id          = var.org_id
  billing_account = var.billing_account
  deletion_policy = "PREVENT"
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  project            = google_project.wally.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_billing_budget" "wally" {
  provider = google.billing

  billing_account = var.billing_account
  display_name    = "Wally"

  budget_filter {
    projects = ["projects/${google_project.wally.number}"]
  }

  # In the billing account's currency, like the budget on luminull-wally (RFC-0011 section 9).
  amount {
    specified_amount {
      units = "10"
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket" "state" {
  project                     = google_project.wally.project_id
  name                        = "${local.project_id}-tfstate"
  location                    = upper(local.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.enabled]
}

# Terraform's identity for the wally root. It has no key: GitHub Actions reaches it through
# its own Workload Identity pool, which only the `infrastructure` environment can use.
resource "google_service_account" "terraform" {
  project      = google_project.wally.project_id
  account_id   = "terraform"
  display_name = "Terraform (wally root)"

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "terraform" {
  for_each = toset(local.terraform_roles)

  project = google_project.wally.project_id
  role    = each.value
  member  = google_service_account.terraform.member
}

# Google's documented limit on which roles a Project IAM Admin may grant:
# https://docs.cloud.google.com/iam/docs/setting-limits-on-granting-roles
resource "google_project_iam_member" "terraform_grants" {
  project = google_project.wally.project_id
  role    = "roles/resourcemanager.projectIamAdmin"
  member  = google_service_account.terraform.member

  condition {
    title      = "wally_root_roles_only"
    expression = "api.getAttribute('iam.googleapis.com/modifiedGrantsByRole', []).hasOnly(${jsonencode(local.grantable_roles)})"
  }
}

resource "google_storage_bucket_iam_member" "terraform_state" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectUser"
  member = google_service_account.terraform.member
}

# A pool of its own, so no token the release can get (pool `github`, wally root) can ever
# reach this identity.
resource "google_iam_workload_identity_pool" "terraform" {
  project                   = google_project.wally.project_id
  workload_identity_pool_id = "terraform"
  display_name              = "Terraform from GitHub Actions"

  depends_on = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = google_project.wally.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.terraform.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub: infrastructure"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # GitHub mints the environment claim only for a job that declares the environment, after
  # its protection rules (required reviewer, main only) have passed.
  attribute_condition = join(" && ", [
    "assertion.repository_owner_id == \"${local.github_owner_id}\"",
    "assertion.repository_id == \"${local.github_repo_id}\"",
    "assertion.environment == \"infrastructure\"",
  ])

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "terraform_from_github" {
  service_account_id = google_service_account.terraform.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.terraform.name}/attribute.repository/${local.github_repo}"
}
