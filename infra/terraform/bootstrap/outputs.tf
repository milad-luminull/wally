# The `infrastructure` environment's variables (docs/DEPLOY.md).

output "terraform_service_account" {
  value = google_service_account.terraform.email
}

output "terraform_wif_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}
