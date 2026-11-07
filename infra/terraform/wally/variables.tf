# Set by the Infrastructure workflow from the infrastructure environment's secret
# TERRAFORM_GOOGLE_OAUTH_CLIENT_SECRET. Ephemeral, so it is kept out of state and plan files.
variable "google_oauth_client_secret" {
  description = "The client secret of the Google OAuth client Auth0's Google connection uses."
  type        = string
  sensitive   = true
  ephemeral   = true
}
