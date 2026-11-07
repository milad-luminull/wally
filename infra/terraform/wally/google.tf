# Google Cloud in luminull-wally-prod. The project, its APIs and Terraform's own identity are
# in ../bootstrap. Nothing here serves traffic until the cutover (RFC-0011 section 10).

# ─── identities ─────────────────────────────────────────────────────────────────────────────

# The API's runtime identity. Cloud Run hands it to the container as Application Default
# Credentials, so the API holds no key.
resource "google_service_account" "api" {
  account_id   = "wally-api"
  display_name = "Wally API runtime"
}

resource "google_project_iam_member" "api_vertex" {
  project = local.project_id
  role    = "roles/aiplatform.user"
  member  = google_service_account.api.member
}

# The release's identity (.github/workflows/release.yml), reached only from the `production`
# environment.
resource "google_service_account" "deployer" {
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "release" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "wally-prod"
  display_name                       = "GitHub: production"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # The environment claim exists only after the `production` environment's rules (required
  # reviewer, v* tags only) have passed.
  attribute_condition = join(" && ", [
    "assertion.repository_owner_id == \"${local.github_owner_id}\"",
    "assertion.repository_id == \"${local.github_repo_id}\"",
    "assertion.environment == \"production\"",
  ])

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deployer_from_github" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${local.github_repo}"
}

# run.developer, not run.admin: the release never changes a service's IAM policy.
# serviceUsageConsumer is carried over from luminull-wally (scripts/bootstrap-gcp-cicd.sh).
resource "google_project_iam_member" "deployer" {
  for_each = toset(["roles/run.developer", "roles/serviceusage.serviceUsageConsumer"])

  project = local.project_id
  role    = each.value
  member  = google_service_account.deployer.member
}

# Scoped to the runtime account, not the project: the deployer may act as wally-api only.
resource "google_service_account_iam_member" "deployer_acts_as_api" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

# ─── images ─────────────────────────────────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "wally" {
  repository_id = "wally"
  location      = local.region
  format        = "DOCKER"
  description   = "Wally container images"
}

resource "google_artifact_registry_repository_iam_member" "deployer" {
  location   = google_artifact_registry_repository.wally.location
  repository = google_artifact_registry_repository.wally.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deployer.member
}

# ─── secrets ────────────────────────────────────────────────────────────────────────────────
# Terraform creates each secret and decides who reads it. The values are added by hand, so
# they never enter Terraform's state (docs/DEPLOY.md).

resource "google_secret_manager_secret" "database_url" {
  secret_id = "wally-database-url"

  replication {
    user_managed {
      replicas {
        location = local.secret_region
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Cloud Run reads it at instance start; the release reads it to run the migrations.
resource "google_secret_manager_secret_iam_member" "database_url" {
  for_each = {
    api      = google_service_account.api.member
    deployer = google_service_account.deployer.member
  }

  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value
}

resource "google_secret_manager_secret" "auth0_management_client_secret" {
  secret_id = "wally-auth0-management-client-secret"

  replication {
    user_managed {
      replicas {
        location = local.secret_region
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Read by the API only; the release never needs it.
resource "google_secret_manager_secret_iam_member" "auth0_management_client_secret" {
  secret_id = google_secret_manager_secret.auth0_management_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.api.member
}

# ─── the API service ────────────────────────────────────────────────────────────────────────

# Terraform owns the service; the release owns what runs in it. Every release replaces the
# template (image, variables, secrets) and moves traffic with gcloud, so Terraform ignores
# both. The first revision is Google's sample container until the first release.
resource "google_cloud_run_v2_service" "api" {
  name                = "wally-api"
  location            = local.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  # Public without an allUsers binding, which the organization's domain-restricted sharing
  # forbids. Wally checks an Auth0 token on every route (docs/DEPLOY.md section 9c).
  invoker_iam_disabled = true

  template {
    service_account = google_service_account.api.email

    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
    }
  }

  lifecycle {
    ignore_changes = [template, traffic, client, client_version]
  }
}
