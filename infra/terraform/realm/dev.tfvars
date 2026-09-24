# Dev registry for `make dev` — committed (no real PII or secrets). Applied by the compose
# `keycloak-realm` service with deploy_stacks=false: the app runs as compose services.
# Prod uses terraform.tfvars (gitignored).

kc_hostname = "localhost:3000"
base_domain = "localhost"

deploy_stacks = false
server_image  = "unused-in-dev"
web_image     = "unused-in-dev"

# No IdP: the declared users log in to Keycloak directly.
dev_user_password = "password"

# One dev workspace, two people, because the planes are disjoint: an owner administers
# members, identity and the catalog and has NO data plane; a member runs jobs, holds the
# connections and opens Discovery, and administers nothing. A single account cannot stand
# in for both — `workspaceRole()` returns the first role it finds and each plane's layout
# redirects the other one away.
#
# `dev@keasy.local` is the member on purpose: it is the account the README documents, and
# the data plane is what one opens keasy to do.
tenants = {
  dev = {
    display_name  = "Dev Workspace"
    owners        = ["owner@keasy.local"]
    members       = ["dev@keasy.local"]
    client_secret = "keasy-dev-secret" # fixed so the compose server can use it directly
  }
}
