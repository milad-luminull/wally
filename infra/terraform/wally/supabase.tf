# Supabase trusts Auth0's ID tokens through Third-Party Auth (ADR-0027). The project itself
# stays outside Terraform: importing it would reset its database password (ADR-0026).

locals {
  supabase_project_ref = "jztzhyxshwgjrwscibly"
}

# The API cannot update a provider, so any change replaces it; prevent_destroy makes that a
# deliberate step rather than a plan line.
resource "supabase_third_party_auth" "auth0" {
  project_ref     = local.supabase_project_ref
  oidc_issuer_url = "https://login.luminull.com/"

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = supabase_third_party_auth.auth0
  id = "${local.supabase_project_ref}/9e4739aa-8579-4f52-9827-bfaf357212f5"
}
