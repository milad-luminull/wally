# Both come from a terraform.tfvars that stays on the owner's machine (*.tfvars is gitignored).

variable "org_id" {
  description = "The numeric ID of the Google Cloud organization that holds the project."
  type        = string
}

variable "billing_account" {
  description = "The Cloud Billing account ID the project is linked to (XXXXXX-XXXXXX-XXXXXX)."
  type        = string
}
