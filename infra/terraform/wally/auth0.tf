# The Auth0 tenant's configuration for Wally, imported as it was on 2026-11-07 (ADR-0026).
# Users stay in Auth0. Other apps in the tenant, Terraform's own among them, are not managed.

locals {
  auth0_domain = "dev-4tuhqfy0z1yepp5h.eu.auth0.com"
  # Shown on the sign-in and consent pages. Served by the web app (apps/web/public); Auth0
  # recommends 150 x 150, this one is 180 x 180.
  auth0_logo_url = "https://wally.luminull.com/apple-touch-icon.png"
}

# friendly_name and picture_url name the tenant on the sign-in pages; without them Auth0 shows
# the tenant ID ("…access to your dev-4tuhqfy0z1yepp5h account") and no logo of ours.
resource "auth0_tenant" "wally" {
  friendly_name                         = "Wally"
  picture_url                           = local.auth0_logo_url
  enabled_locales                       = ["en"]
  session_lifetime                      = 168
  idle_session_lifetime                 = 72
  ephemeral_session_lifetime            = 72
  idle_ephemeral_session_lifetime       = 24
  sandbox_version                       = "22"
  resource_parameter_profile            = "compatibility"
  client_id_metadata_document_supported = false

  flags {
    enable_dynamic_client_registration = false
  }
}

import {
  to = auth0_tenant.wally
  id = "wally"
}

# Identifier First (docs/AUTH0.md, "Sign-in methods").
resource "auth0_prompt" "wally" {
  universal_login_experience     = "new"
  identifier_first               = true
  webauthn_platform_first_factor = false
}

import {
  to = auth0_prompt.wally
  id = "wally"
}

resource "auth0_custom_domain" "login" {
  domain     = "login.luminull.com"
  type       = "auth0_managed_certs"
  tls_policy = "recommended"

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = auth0_custom_domain.login
  id = "cd_7vp16Uj8zpRpyybp"
}

# Email sign-in, with passkeys first and the password as fallback (ADR-0028). Every option the
# tenant holds is written out: an update sends `options` whole, and anything missing here would
# be reset to Auth0's default without showing in the plan.
resource "auth0_connection" "email" {
  name                 = "Username-Password-Authentication"
  strategy             = "auth0"
  is_domain_connection = true

  options {
    strategy_version               = 2
    brute_force_protection         = true
    requires_username              = false
    disable_signup                 = false
    import_mode                    = false
    enabled_database_customization = false

    authentication_methods {
      passkey {
        enabled = true
      }
      password {
        enabled         = true
        api_behavior    = "required"
        signup_behavior = "allow"
      }
    }

    passkey_options {
      challenge_ui                   = "both"
      local_enrollment_enabled       = true
      progressive_enrollment_enabled = true
    }

    password_options {
      complexity {
        min_length            = 15
        character_types       = []
        character_type_rule   = "all"
        identical_characters  = "allow"
        sequential_characters = "allow"
        max_length_exceeded   = "error"
      }
      dictionary {
        active  = false
        default = "en_10k"
        custom  = []
      }
      history {
        active = false
        size   = 5
      }
      profile_data {
        active         = false
        blocked_fields = []
      }
    }

    mfa {
      active                 = true
      return_enroll_settings = true
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = auth0_connection.email
  id = "con_Tedbh7n8BICpjEfw"
}

# Google sign-in, through the OAuth client in luminull-wally-prod (RFC-0011 section 10). The
# client secret is write-only: sent from the pipeline's secret, never read back or stored. Bump
# options_client_secret_wo_version to send a new one.
resource "auth0_connection" "google" {
  name                 = "google-oauth2"
  strategy             = "google-oauth2"
  is_domain_connection = true

  options_client_secret_wo         = var.google_oauth_client_secret
  options_client_secret_wo_version = 1

  options {
    client_id = "299735685184-9mvp3p834clnm95sl553e28dm0ks1r8p.apps.googleusercontent.com"
    scopes    = ["email", "profile"]
  }

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = auth0_connection.google
  id = "con_xzyPDBmxaJGgEUCH"
}

resource "auth0_resource_server" "api" {
  name                                            = "Wally API"
  identifier                                      = "https://api.wally.luminull.com"
  signing_alg                                     = "RS256"
  token_lifetime                                  = 900
  token_lifetime_for_web                          = 900
  allow_offline_access                            = true
  skip_consent_for_verifiable_first_party_clients = true

  subject_type_authorization {
    client {
      policy = "deny_all"
    }
    user {
      policy = "require_client_grant"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = auth0_resource_server.api
  id = "6ad68319f37d82a50cb203cb"
}

# docs/AUTH0.md, "MCP client".
resource "auth0_resource_server" "mcp" {
  name                                            = "Wally MCP"
  identifier                                      = "https://api.wally.luminull.com/mcp"
  signing_alg                                     = "RS256"
  token_lifetime                                  = 900
  token_lifetime_for_web                          = 900
  allow_offline_access                            = true
  skip_consent_for_verifiable_first_party_clients = false

  subject_type_authorization {
    client {
      policy = "deny_all"
    }
    user {
      policy = "require_client_grant"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = auth0_resource_server.mcp
  id = "6ad6853a16f4a318881ccea7"
}

resource "auth0_resource_server_scopes" "mcp" {
  resource_server_identifier = auth0_resource_server.mcp.identifier

  scopes {
    name        = "wally:read"
    description = "Read notes on boards explicitly approved in Wally"
  }

  scopes {
    name        = "wally:write"
    description = "Create and edit notes on approved boards; no deletion or sharing changes"
  }
}

import {
  to = auth0_resource_server_scopes.mcp
  id = "https://api.wally.luminull.com/mcp"
}

# The web app (VITE_AUTH0_CLIENT_ID). Local development uses it too (docs/AUTH0.md).
resource "auth0_client" "web" {
  name            = "Wally Web"
  app_type        = "spa"
  logo_uri        = local.auth0_logo_url
  is_first_party  = true
  oidc_conformant = true
  grant_types     = ["authorization_code", "implicit", "refresh_token"]

  callbacks           = ["https://wally.luminull.com/login", "http://localhost:5174/login"]
  allowed_logout_urls = ["https://wally.luminull.com/login", "http://localhost:5174/login"]
  web_origins         = ["https://wally.luminull.com", "http://localhost:5174"]

  jwt_configuration {
    alg = "RS256"
  }

  refresh_token {
    expiration_type     = "expiring"
    rotation_type       = "rotating"
    idle_token_lifetime = 604800
    token_lifetime      = 2592000
  }

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = auth0_client.web
  id = "Ck830qbC3GVTQDL3W3ku4yRA43O1R5hp"
}

resource "auth0_client_grant" "web_api" {
  client_id    = auth0_client.web.client_id
  audience     = auth0_resource_server.api.identifier
  subject_type = "user"
  scopes       = []
}

import {
  to = auth0_client_grant.web_api
  id = "cgr_PnWaIFeKuAam18JT"
}

# ChatGPT's public PKCE client (docs/AUTH0.md, "MCP client"). Port 6274 is the local MCP
# Inspector (docs/AUTH0.md, "Local MCP run").
resource "auth0_client" "chatgpt" {
  name                      = "Wally ChatGPT (PKCE)"
  app_type                  = "spa"
  is_first_party            = false
  third_party_security_mode = "strict"
  redirection_policy        = "open_redirect_protection"
  oidc_conformant           = true
  grant_types               = ["authorization_code", "refresh_token"]
  callbacks                 = ["https://chatgpt.com/connector_platform_oauth_redirect", "http://localhost:6274/oauth/callback"]

  jwt_configuration {
    alg = "RS256"
  }

  refresh_token {
    expiration_type     = "expiring"
    rotation_type       = "rotating"
    idle_token_lifetime = 604800
    token_lifetime      = 2592000
  }

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = auth0_client.chatgpt
  id = "tpc_oR2NUn5BAcms9r5Z5MhHVf"
}

resource "auth0_client_grant" "chatgpt_mcp" {
  client_id    = auth0_client.chatgpt.client_id
  audience     = auth0_resource_server.mcp.identifier
  subject_type = "user"
  scopes       = ["wally:read", "wally:write"]
}

import {
  to = auth0_client_grant.chatgpt_mcp
  id = "cgr_6tMyFmiBzEr6DJqz"
}

# Deletes Auth0 users for DELETE /me (docs/AUTH0.md, "Account deletion"). Its secret is set by
# hand in Secret Manager; auth0_client_credentials is not managed, so it never reaches state.
resource "auth0_client" "account_deletion" {
  name            = "Wally account deletion"
  app_type        = "non_interactive"
  is_first_party  = true
  oidc_conformant = true
  grant_types     = ["client_credentials"]

  jwt_configuration {
    alg = "RS256"
  }

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = auth0_client.account_deletion
  id = "a7hTQAyJGPQWpTXdvn1BXA0STH8DoTmw"
}

resource "auth0_client_grant" "account_deletion" {
  client_id    = auth0_client.account_deletion.client_id
  audience     = "https://${local.auth0_domain}/api/v2/"
  subject_type = "client"
  scopes       = ["delete:users"]
}

import {
  to = auth0_client_grant.account_deletion
  id = "cgr_AcRTbdwi32KjDurQ"
}

# Deployed on every change to infra/auth0-post-login.cjs, which starts the pipeline too.
# WEB_CLIENT_ID is write-only, so it is never read back or stored; bump secrets_wo_version to
# send it again. prevent_destroy: replacing the Action would drop the email_verified denial.
resource "auth0_action" "token_profile" {
  name    = "Wally token profile"
  runtime = "node22"
  code    = file("${path.module}/../../auth0-post-login.cjs")
  deploy  = true

  supported_triggers {
    id      = "post-login"
    version = "v3"
  }

  secrets_wo {
    name  = "WEB_CLIENT_ID"
    value = auth0_client.web.client_id
  }
  secrets_wo_version = 1

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = auth0_action.token_profile
  id = "df14f152-b4e9-4142-9187-2e387e74fb6f"
}

resource "auth0_trigger_actions" "post_login" {
  trigger = "post-login"

  actions {
    id           = auth0_action.token_profile.id
    display_name = auth0_action.token_profile.name
  }
}

import {
  to = auth0_trigger_actions.post_login
  id = "post-login"
}
