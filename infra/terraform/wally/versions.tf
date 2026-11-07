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
    auth0 = {
      source  = "auth0/auth0"
      version = "~> 1.60"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.11"
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

# The other providers read their credentials from the environment as well, so none reaches a
# saved plan: AUTH0_CLIENT_ID and AUTH0_CLIENT_SECRET (the `wally-terraform` application),
# CLOUDFLARE_API_TOKEN and SUPABASE_ACCESS_TOKEN.
provider "auth0" {
  domain = local.auth0_domain
}

provider "cloudflare" {}

provider "supabase" {}
