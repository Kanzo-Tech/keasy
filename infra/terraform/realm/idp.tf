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

  # NOTE (plan risk #2): trust_email lets Keycloak match the IdP login to the pre-declared
  # user by email, but the DEFAULT first-broker-login flow still shows an "account exists"
  # confirmation. To link silently, point first_broker_login_flow_alias at a flow whose
  # "Confirm link existing account" execution is DISABLED — add a keycloak_authentication_flow
  # once verified live. Left default here so the resource applies cleanly.
}
