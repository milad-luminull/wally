terraform {
  required_version = "~> 1.17.1"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.10"
    }
  }

  # The state bucket is created by this root. The first apply runs with a local backend
  # (docs/DEPLOY.md, "Infrastructure in Terraform"), then moves its state here.
  backend "gcs" {
    bucket = "luminull-wally-prod-tfstate"
    prefix = "bootstrap"
  }
}
