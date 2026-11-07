# The values the cutover needs (RFC-0011 section 10, step 2).

output "api_url" {
  description = "The proxy's ORIGIN in apps/api-proxy/wrangler.jsonc after the cutover."
  value       = google_cloud_run_v2_service.api.uri
}

output "release_wif_provider" {
  value = google_iam_workload_identity_pool_provider.release.name
}

output "release_service_account" {
  value = google_service_account.deployer.email
}
