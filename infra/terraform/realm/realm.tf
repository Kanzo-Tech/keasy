# The keasy realm — minimal. No Organizations (instance-per-tenant makes membership a
# per-client role assignment), no SMTP (SSO means no password/invite emails). A realm
# created via the API auto-creates the built-in client scopes (roles, web-origins, …),
# so we reference them and never redefine them.
resource "keycloak_realm" "keasy" {
  realm   = "keasy"
  enabled = true

  registration_allowed     = false
  login_with_email_allowed = true
  access_token_lifespan    = "1h"
  sso_session_max_lifespan = "24h"
}
