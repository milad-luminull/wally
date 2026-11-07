locals {
  project_id = "luminull-wally-prod"
  region     = "europe-west1"

  # Secrets stay in the EU, in the region the current ones use (docs/DEPLOY.md section 7).
  secret_region = "europe-west3"

  github_owner_id = "331026245"
  github_repo_id  = "1376336905"
  github_repo     = "milad-luminull/wally"
}
