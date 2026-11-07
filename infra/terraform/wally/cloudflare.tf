# The Workers' Custom Domains, imported as they were on 2026-11-07 (ADR-0026). The release owns
# the Worker versions; wrangler.jsonc declares no routes. The zone's own settings stay outside
# Terraform (docs/DEPLOY.md, "Zone security for luminull.com").

locals {
  cloudflare_account_id = "400311f4d8f3184112f4e9478c58535c"
  cloudflare_zone_id    = "26fc82fbf84c5cd539c24f09c57c3124" # luminull.com
}

resource "cloudflare_workers_custom_domain" "api" {
  account_id = local.cloudflare_account_id
  zone_id    = local.cloudflare_zone_id
  hostname   = "api.wally.luminull.com"
  service    = "wally-api-proxy"

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_workers_custom_domain.api
  id = "${local.cloudflare_account_id}/348ad2aa0d94497236b0898cc07567fecb06511b"
}

resource "cloudflare_workers_custom_domain" "web" {
  account_id = local.cloudflare_account_id
  zone_id    = local.cloudflare_zone_id
  hostname   = "wally.luminull.com"
  service    = "wally-web"

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_workers_custom_domain.web
  id = "${local.cloudflare_account_id}/f0e6c4ac9931a36a156963e3661e0ca5d136dc26"
}
