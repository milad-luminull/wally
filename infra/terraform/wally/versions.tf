terraform {
  required_version = "~> 1.17.1"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.10"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
  }

  backend "gcs" {
    bucket = "luminull-wally-prod-tfstate"
    prefix = "wally"
  }
}

provider "google" {
  project = local.project_id
  region  = local.region
}

# Authenticates as the Terraform GitHub App from GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID and
# GITHUB_APP_PEM_FILE, read from the environment so the key never reaches a saved plan
# (docs/DEPLOY.md, "Infrastructure in Terraform"). Without an app_auth block, v6.13 reads
# them in getAppAuth (github/provider.go); an empty block would fail `validate` in CI.
provider "github" {
  owner = "milad-luminull"
}
