# Generated once, in state. The DB password is a Swarm secret (Postgres reads _FILE);
# the Keycloak admin password is passed as env (Keycloak does NOT honour _FILE for it)
# and exported for the realm module's provider auth.
resource "random_password" "kc_db" {
  length  = 32
  special = false
}

resource "random_password" "kc_admin" {
  length  = 32
  special = false
}

resource "docker_secret" "kc_db_password" {
  name = "kc-db-password"
  data = base64encode(random_password.kc_db.result)
}
