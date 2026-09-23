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

  # email => the slugs that user belongs to (feeds the `workspaces` switcher claim).
  user_workspaces = {
    for e in local.all_emails : e => [
      for slug, t in var.tenants : slug if contains(concat(t.owners, t.members), e)
    ]
  }
}

# The API every tenant's server is. One bearer-only client for the whole realm:
# it never initiates a login, it only names an audience. Each tenant client's
# audience mapper below puts it in `aud`, and each tenant's Rust server refuses
# a token that does not carry it. Cross-tenant reuse is closed on the other side
# — the server also requires `azp` to be its own client.
resource "keycloak_openid_client" "api" {
  realm_id    = keycloak_realm.keasy.id
  client_id   = "keasy-api"
  name        = "Keasy API"
  description = "The resource server. Bearer tokens only; it starts no flow."
  enabled     = true
  access_type = "BEARER-ONLY"
}

resource "keycloak_openid_client" "tenant" {
  for_each              = var.tenants
  realm_id              = keycloak_realm.keasy.id
  client_id             = "keasy-ws-${each.key}"
  name                  = each.value.display_name
  enabled               = true
  access_type           = "CONFIDENTIAL"
  client_secret         = each.value.client_secret # null ⇒ Keycloak generates
  standard_flow_enabled = true
  # The relying party is the web BFF (`@kanzo-tech/auth/next`), mounted at
  # /api/auth — the Rust server no longer speaks OIDC at all.
  valid_redirect_uris = [
    "https://${each.key}.${var.base_domain}/api/auth/callback",
    "http://localhost:3000/api/auth/callback", # dev (compose)
  ]
  # RP-initiated logout comes back to the application's own origin.
  valid_post_logout_redirect_uris = [
    "https://${each.key}.${var.base_domain}/*",
    "http://localhost:3000/*", # dev (compose)
  ]
  web_origins = ["+"]
}

# The audience the API validates. Without it `aud` is whatever client asked for
# the token, which works only while the relying party and the resource server
# are the same process — and they stopped being that.
resource "keycloak_openid_audience_protocol_mapper" "api_audience" {
  for_each                 = var.tenants
  realm_id                 = keycloak_realm.keasy.id
  client_id                = keycloak_openid_client.tenant[each.key].id
  name                     = "keasy-api-audience"
  included_client_audience = keycloak_openid_client.api.client_id
  add_to_id_token          = true
  add_to_access_token      = true
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

# Client roles on each tenant client, under the name Keycloak already publishes
# them by: `resource_access.<client_id>.roles`. Scoped to THIS client, so a role
# held in another workspace leaks into nothing here.
#
# It used to be renamed to `keasy:role`, which bought a translation layer on both
# sides and lost the one `@kanzo-tech/auth` ships for free — its claim reader
# knows this name and no other, and a colon is not a JWT naming convention.
#
# On BOTH tokens, and both are load-bearing: the ID token is what the BFF holds
# and forwards, and the access token is what anything else validating this realm
# would be sent. Roles on one only is the failure mode that is quiet in both
# directions.
resource "keycloak_generic_protocol_mapper" "client_roles" {
  for_each        = var.tenants
  realm_id        = keycloak_realm.keasy.id
  client_id       = keycloak_openid_client.tenant[each.key].id
  name            = "client-roles"
  protocol        = "openid-connect"
  protocol_mapper = "oidc-usermodel-client-role-mapper"
  config = {
    "usermodel.clientRoleMapping.clientId" = "keasy-ws-${each.key}"
    # `$${client_id}` is Keycloak's own template, escaped for HCL — it is what
    # nests the roles under the client that holds them.
    "claim.name"           = "resource_access.$${client_id}.roles"
    "jsonType.label"       = "String"
    "multivalued"          = "true"
    "id.token.claim"       = "true"
    "access.token.claim"   = "true"
    "userinfo.token.claim" = "false"
  }
}

# Pre-declared users (linked from the IdP by email on first SSO login). The
# `workspaces` attribute (## = multivalued) lists every workspace they belong to —
# emitted into the token by the per-client mapper below to feed the switcher.
resource "keycloak_user" "u" {
  for_each       = local.all_emails
  realm_id       = keycloak_realm.keasy.id
  username       = each.value
  email          = each.value
  enabled        = true
  email_verified = true
  attributes = {
    workspaces = join("##", local.user_workspaces[each.value])
  }
  # The User Profile must know `workspaces` before a user can carry it —
  # Keycloak drops an undeclared attribute without saying so.
  depends_on = [keycloak_realm_user_profile.keasy]
}

# Emit the user's `workspaces` attribute as a multivalued token claim, per tenant client.
resource "keycloak_generic_protocol_mapper" "workspaces" {
  for_each        = var.tenants
  realm_id        = keycloak_realm.keasy.id
  client_id       = keycloak_openid_client.tenant[each.key].id
  name            = "workspaces"
  protocol        = "openid-connect"
  protocol_mapper = "oidc-usermodel-attribute-mapper"
  config = {
    "user.attribute"       = "workspaces"
    "claim.name"           = "workspaces"
    "jsonType.label"       = "String"
    "multivalued"          = "true"
    "id.token.claim"       = "true"
    "access.token.claim"   = "true"
    "userinfo.token.claim" = "false"
  }
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
