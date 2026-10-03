# keasy, registered with the platform realm (kanzo-ui services/auth): its client,
# the audience its API validates, and its roles. The realm and the organizations are
# the platform's; this is all keasy declares there.
terraform {
  required_version = ">= 1.6.0"
  # The state's path is the caller's: `terraform init -backend-config=path=…`.
  backend "local" {}
  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = "~> 5.9"
    }
  }
}

provider "keycloak" {
  client_id = "admin-cli"
  username  = var.kc_admin_username
  password  = var.kc_admin_password
  url       = var.kc_url
}
