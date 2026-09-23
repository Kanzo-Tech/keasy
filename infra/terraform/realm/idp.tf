# SSO: users authenticate at their upstream IdP; Keycloak links to the pre-declared
# keycloak_user by email (trust_email). No passwords, no SMTP. `provider_id` left at the
# default ("oidc") so any OIDC IdP works; for Google set idp.authorization_url/token_url
# to Google's endpoints.
resource "keycloak_oidc_identity_provider" "sso" {
  realm             = keycloak_realm.keasy.id
  alias             = var.idp.alias
  display_name      = var.idp.display_name
  enabled           = true
  client_id         = var.idp.client_id
  client_secret     = var.idp.client_secret
  authorization_url = var.idp.authorization_url
  token_url         = var.idp.token_url
  user_info_url     = var.idp.user_info_url
  issuer            = var.idp.issuer
  default_scopes    = var.idp.default_scopes
  trust_email       = true
  store_token       = false
  sync_mode         = "IMPORT"

  # Without this, the DEFAULT first-broker-login flow stops at "An account already
  # exists with this email" — a dead end here, since the declared account has no
  # password and there is no SMTP. See idp_flow.tf, including its security note:
  # auto-link makes the IdP the entire trust boundary.
  #
  # Bound EXPLICITLY for a second reason: the attribute is Optional+Computed, so left
  # unset Terraform never owns it and whatever an old apply wrote into Keycloak
  # outlives every apply since — which is how a flow this config had already deleted
  # stayed bound here and made Keycloak answer its own DELETE with a 500.
  first_broker_login_flow_alias = keycloak_authentication_flow.sso_silent_link.alias
}
