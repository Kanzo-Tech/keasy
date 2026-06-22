# Keycloak: authenticate as the bootstrap admin (creds in operator-local tfvars). A
# single-operator, TF-owns-everything model — no separate least-privilege client to mint.
provider "keycloak" {
  client_id = "admin-cli"
  username  = var.kc_admin_username
  password  = var.kc_admin_password
  url       = var.kc_url
  base_path = "/auth"
}

# Docker: the local manager's Engine (override with DOCKER_HOST for a remote manager).
provider "docker" {}
