# Keycloak: authenticate as the bootstrap admin (creds in operator-local tfvars). A
# single-operator, TF-owns-everything model — no separate least-privilege client to mint.
provider "keycloak" {
  client_id = "admin-cli"
  username  = var.kc_admin_username
  password  = var.kc_admin_password
  url       = coalesce(var.kc_url, "https://${var.kc_hostname}")
}

# Docker: the local manager's Engine (override with DOCKER_HOST for a remote manager).
provider "docker" {}

# The AI gateway's management API: each tenant gets a team (its budget) and a key.
provider "litellm" {
  api_base = var.ai_url
  api_key  = var.ai_master_key
}
