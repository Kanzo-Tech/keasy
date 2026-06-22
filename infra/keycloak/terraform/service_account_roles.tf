# Grant each client's service account the realm-management roles it needs. The roles
# come from the built-in `realm-management` client (we never define it — reference it
# as data). This is what the SA token must carry; missing any of these → 403 from the
# admin API (the same symptom the old realm-import bug produced, here keyed on the role
# set rather than a dropped scope).
data "keycloak_openid_client" "realm_management" {
  realm_id  = keycloak_realm.keasy.id
  client_id = "realm-management"
}

locals {
  cp_realm_mgmt_roles = [
    "manage-clients",
    "manage-organizations",
    "manage-users",
    "query-users",
    "view-clients",
    "view-organizations",
    "view-users",
  ]
  # keasy-server (dev path) needs the org/user roles but not manage-clients.
  server_realm_mgmt_roles = [
    "manage-organizations",
    "manage-users",
    "query-users",
    "view-clients",
    "view-organizations",
    "view-users",
  ]
}

resource "keycloak_openid_client_service_account_role" "control_plane" {
  for_each                = toset(local.cp_realm_mgmt_roles)
  realm_id                = keycloak_realm.keasy.id
  service_account_user_id = keycloak_openid_client.control_plane.service_account_user_id
  client_id               = data.keycloak_openid_client.realm_management.id
  role                    = each.value
}

resource "keycloak_openid_client_service_account_role" "server" {
  for_each                = toset(local.server_realm_mgmt_roles)
  realm_id                = keycloak_realm.keasy.id
  service_account_user_id = keycloak_openid_client.server.service_account_user_id
  client_id               = data.keycloak_openid_client.realm_management.id
  role                    = each.value
}
