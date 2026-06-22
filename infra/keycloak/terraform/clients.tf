# ── keasy-control-plane ──────────────────────────────────────────────────────
# The provisioner authenticates as this client (client-credentials) and drives the
# admin API. Its service-account realm-management roles are in service_account_roles.tf.
# NOTE: we deliberately do NOT manage default/optional client scopes here — the realm's
# auto-created built-ins (incl. `roles`) stay as the client's defaults, so the SA token
# carries resource_access.realm-management.roles. Managing the scope list would re-open
# the exact "explicit list silently drops the rest" bug this migration removes.
resource "keycloak_openid_client" "control_plane" {
  realm_id    = keycloak_realm.keasy.id
  client_id   = "keasy-control-plane"
  name        = "Keasy Control Plane"
  description = "Provisioner service account — creates per-tenant OIDC clients via the admin API."
  enabled     = true

  access_type                  = "CONFIDENTIAL"
  client_secret                = var.cp_oidc_secret
  service_accounts_enabled     = true
  standard_flow_enabled        = false
  direct_access_grants_enabled = false
}

# ── keasy-server (single-instance / dev) ─────────────────────────────────────
# The OIDC relying party for the single-instance/dev server. Unused by the fleet
# (each tenant runs its own keasy-ws-{slug} client, created at runtime by the
# control-plane). Kept here because this is one realm for both paths.
resource "keycloak_openid_client" "server" {
  realm_id    = keycloak_realm.keasy.id
  client_id   = "keasy-server"
  name        = "Keasy Server"
  description = "Single-instance / dev OIDC relying party."
  enabled     = true

  access_type                  = "CONFIDENTIAL"
  client_secret                = var.server_oidc_secret
  service_accounts_enabled     = true
  standard_flow_enabled        = true
  direct_access_grants_enabled = false
  valid_redirect_uris          = var.server_redirect_uris
  web_origins                  = ["+"]
}

# owner/member client roles on keasy-server (the dev path's authorization). The fleet's
# per-tenant clients get their OWN owner/member roles at runtime (admin.rs ensure_client_roles).
resource "keycloak_role" "server_owner" {
  realm_id    = keycloak_realm.keasy.id
  client_id   = keycloak_openid_client.server.id
  name        = "owner"
  description = "Workspace owner — metadata plane"
}

resource "keycloak_role" "server_member" {
  realm_id    = keycloak_realm.keasy.id
  client_id   = keycloak_openid_client.server.id
  name        = "member"
  description = "Workspace member — data plane"
}

# Maps keasy-server client roles → the keasy:role ID-token claim. Attached directly to
# the client (always applies) rather than via a default client scope, so it can't drop
# the built-in scopes. Mirrors what admin.rs ensure_role_mapper does per-tenant at runtime.
resource "keycloak_generic_protocol_mapper" "server_keasy_role" {
  realm_id        = keycloak_realm.keasy.id
  client_id       = keycloak_openid_client.server.id
  name            = "keasy-role"
  protocol        = "openid-connect"
  protocol_mapper = "oidc-usermodel-client-role-mapper"
  config = {
    "usermodel.clientRoleMapping.clientId" = "keasy-server"
    "claim.name"                           = "keasy:role"
    "jsonType.label"                       = "String"
    "multivalued"                          = "true"
    "id.token.claim"                       = "true"
    "access.token.claim"                   = "false"
    "userinfo.token.claim"                 = "false"
  }
}
