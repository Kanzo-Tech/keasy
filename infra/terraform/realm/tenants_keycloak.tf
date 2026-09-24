# Per-tenant Keycloak resources: client, roles and declarative membership
# (keycloak_user + keycloak_user_roles), so the role is in the token from the first login.

locals {
  # One keycloak_user per UNIQUE email across the whole fleet (Keycloak emails are realm-unique).
  all_emails = toset(flatten([for t in var.tenants : concat(t.owners, t.members)]))

  # One role assignment per (tenant, email). Key is "slug|email", and the two
  # halves of this merge can no longer collide on one: `var.tenants` refuses an
  # email listed in a workspace's `owners` and its `members`, because the planes
  # are disjoint and a silent winner is not an answer.
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
    for o in concat(["https://${each.key}.${var.base_domain}"], var.dev_origins) : "${o}/api/auth/callback"
  ]
  # RP-initiated logout comes back to the application's own origin.
  valid_post_logout_redirect_uris = [
    for o in concat(["https://${each.key}.${var.base_domain}"], var.dev_origins) : "${o}/*"
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
  add_to_id_token          = false
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
# On BOTH tokens, and both are load-bearing: the BFF reads the session's role
# from the ID token, and the API authorizes the access token the BFF forwards.
# Roles on one only is the failure mode that is quiet in both directions.
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
  dynamic "initial_password" {
    for_each = var.dev_user_password == null ? [] : [var.dev_user_password]
    content {
      value     = initial_password.value
      temporary = false
    }
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
#
# `exhaustive = false` is the whole of this resource's correctness. The
# provider's default is `true`, meaning "these are ALL the roles this user has,
# remove the rest" — and the resource is keyed by (slug, email) while its
# `user_id` is keyed by email alone. One person in two workspaces is therefore
# two of these pointing at the same Keycloak user, each claiming to be the
# complete list, each apply erasing the other's grant. It has not bitten yet
# only because dev declares a single workspace; the fleet it was written for is
# the case that breaks it.
#
# Non-exhaustive is also the honest statement: this resource declares one
# workspace's role for one person, which is exactly what it knows about.
resource "keycloak_user_roles" "assign" {
  for_each   = local.assignments
  realm_id   = keycloak_realm.keasy.id
  user_id    = keycloak_user.u[each.value.email].id
  exhaustive = false
  role_ids = [
    each.value.role == "owner"
    ? keycloak_role.owner[each.value.slug].id
    : keycloak_role.member[each.value.slug].id
  ]
}
