# Per-tenant Keycloak resources — the declarative replacement for the Rust control-plane's
# create_client / ensure_client_roles / ensure_role_mapper, plus declarative membership
# (keycloak_user + keycloak_user_roles) which removes Organizations, invites, AND the
# app-side first-login role grant (the role is in the token from the first login).

locals {
  # One keycloak_user per UNIQUE email across the whole fleet (Keycloak emails are realm-unique).
  all_emails = toset(flatten([for t in var.tenants : concat(t.owners, t.members)]))

  # One role assignment per (tenant, email, role). Key is "slug|email".
  assignments = merge([
    for slug, t in var.tenants : merge(
      { for e in t.owners : "${slug}|${e}" => { slug = slug, email = e, role = "owner" } },
      { for e in t.members : "${slug}|${e}" => { slug = slug, email = e, role = "member" } },
    )
  ]...)
}

resource "keycloak_openid_client" "tenant" {
  for_each              = var.tenants
  realm_id              = keycloak_realm.keasy.id
  client_id             = "keasy-ws-${each.key}"
  name                  = each.value.display_name
  enabled               = true
  access_type           = "CONFIDENTIAL"
  standard_flow_enabled = true
  valid_redirect_uris   = ["https://${each.key}.${var.base_domain}/v1/auth/oidc-callback"]
  web_origins           = ["+"]
}

resource "keycloak_role" "owner" {
  for_each    = var.tenants
  realm_id    = keycloak_realm.keasy.id
  client_id   = keycloak_openid_client.tenant[each.key].id
  name        = "owner"
  description = "Workspace owner — metadata plane"
}

resource "keycloak_role" "member" {
  for_each    = var.tenants
  realm_id    = keycloak_realm.keasy.id
  client_id   = keycloak_openid_client.tenant[each.key].id
  name        = "member"
  description = "Workspace member — data plane"
}

# keasy:role mapper on each tenant client (scoped to THIS client → no role leakage).
resource "keycloak_generic_protocol_mapper" "keasy_role" {
  for_each        = var.tenants
  realm_id        = keycloak_realm.keasy.id
  client_id       = keycloak_openid_client.tenant[each.key].id
  name            = "keasy-role"
  protocol        = "openid-connect"
  protocol_mapper = "oidc-usermodel-client-role-mapper"
  config = {
    "usermodel.clientRoleMapping.clientId" = "keasy-ws-${each.key}"
    "claim.name"                           = "keasy:role"
    "jsonType.label"                       = "String"
    "multivalued"                          = "true"
    "id.token.claim"                       = "true"
    "access.token.claim"                   = "false"
    "userinfo.token.claim"                 = "false"
  }
}

# Pre-declared users (linked from the IdP by email on first SSO login).
resource "keycloak_user" "u" {
  for_each       = local.all_emails
  realm_id       = keycloak_realm.keasy.id
  username       = each.value
  email          = each.value
  enabled        = true
  email_verified = true
}

# owner/member role on the tenant client — the declarative membership.
resource "keycloak_user_roles" "assign" {
  for_each = local.assignments
  realm_id = keycloak_realm.keasy.id
  user_id  = keycloak_user.u[each.value.email].id
  role_ids = [
    each.value.role == "owner"
    ? keycloak_role.owner[each.value.slug].id
    : keycloak_role.member[each.value.slug].id
  ]
}
