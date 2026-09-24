# First-broker-login flow that links SILENTLY to the pre-declared user.
#
# Users are declared in Terraform and authenticate at the upstream IdP; Keycloak
# is supposed to match them by email (trust_email = true). But the DEFAULT
# first-broker-login flow still stops at "An account already exists with this
# email" and asks the user to confirm — and here that dead-ends: the declared
# account has no password to re-authenticate with, and there is no SMTP to verify
# by email. So the documented login could not complete at all.
#
# This flow replaces the confirmation with `idp-auto-link`:
#   idp-create-user-if-unique (ALTERNATIVE)  → new email: create the user
#   handle-existing-account   (ALTERNATIVE)  → known email: link, no prompt
#     └── idp-auto-link       (REQUIRED)
#
# ⚠️ SECURITY: auto-link plus trust_email means "whoever controls an account at
# the IdP with email X logs in as X". That is safe when the IdP is authoritative
# over the domain (a Google Workspace, a single-tenant Entra) and an ESCALATION
# if it is not (public Google). The IdP is the entire trust boundary here.
#
# ⚠️ Execution order comes from `depends_on` — Keycloak has no reliable priority
# field on these resources, and reordering them silently changes behaviour.

resource "keycloak_authentication_flow" "sso_silent_link" {
  count       = local.sso
  realm_id    = keycloak_realm.keasy.id
  alias       = "sso-silent-link"
  description = "First broker login: link to the pre-declared user by email, without prompting."
}

resource "keycloak_authentication_execution" "create_user_if_unique" {
  count             = local.sso
  realm_id          = keycloak_realm.keasy.id
  parent_flow_alias = keycloak_authentication_flow.sso_silent_link[0].alias
  authenticator     = "idp-create-user-if-unique"
  requirement       = "ALTERNATIVE"
}

resource "keycloak_authentication_subflow" "handle_existing" {
  count             = local.sso
  realm_id          = keycloak_realm.keasy.id
  alias             = "handle-existing-account"
  parent_flow_alias = keycloak_authentication_flow.sso_silent_link[0].alias
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"

  depends_on = [keycloak_authentication_execution.create_user_if_unique]
}

resource "keycloak_authentication_execution" "auto_link" {
  count             = local.sso
  realm_id          = keycloak_realm.keasy.id
  parent_flow_alias = keycloak_authentication_subflow.handle_existing[0].alias
  authenticator     = "idp-auto-link"
  requirement       = "REQUIRED"
}
