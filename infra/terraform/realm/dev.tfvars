# Dev registry for `make dev` — committed (no real PII/secrets; the user is a static Dex
# account). Applied by the docker-compose `keycloak-realm` service with deploy_stacks=false
# (the app runs via compose, not docker_service). Prod uses terraform.tfvars (gitignored).

kc_hostname = "localhost:3000"
base_domain = "localhost"

deploy_stacks = false
server_image  = "unused-in-dev"
web_image     = "unused-in-dev"

# Federate to the local Dex container (offline SSO).
idp = {
  alias             = "dex"
  display_name      = "Dev (Dex)"
  client_id         = "keycloak"
  client_secret     = "keycloak-dex-secret"
  authorization_url = "http://localhost:5556/dex/auth" # browser-facing
  token_url         = "http://dex:5556/dex/token"      # Keycloak server-side
  user_info_url     = "http://dex:5556/dex/userinfo"
  issuer            = "http://localhost:5556/dex"
}

# One dev workspace; the owner email matches the Dex static user.
tenants = {
  dev = {
    display_name  = "Dev Workspace"
    owners        = ["dev@keasy.local"]
    client_secret = "keasy-dev-secret" # fixed so the compose server can use it directly
  }
}
