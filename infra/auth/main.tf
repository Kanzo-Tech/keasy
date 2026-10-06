# The Rust API, as a resource server: the `aud` it validates and the scope the web exchanges for.
module "keasy_api" {
  source = "git::https://github.com/Kanzo-Tech/ui.git//services/auth/modules/api?ref=v0.31.0"

  realm_id    = var.realm
  client_id   = "keasy-api"
  description = "keasy's API: one server per organization, each validating aud and its organization."
}

module "keasy" {
  source = "git::https://github.com/Kanzo-Tech/ui.git//services/auth/modules/app?ref=v0.31.0"

  realm_id      = var.realm
  client_id     = "keasy"
  description   = "keasy: a Backend-For-Frontend for every organization. Confidential; the browser never holds a token."
  access_type   = "CONFIDENTIAL"
  client_secret = var.client_secret
  redirect_uris = var.redirect_uris
  # The one web that serves every organization, as Keycloak reaches it: a sign-out at Keycloak
  # ends the BFF's sessions too, whichever organization they were opened in.
  backchannel_logout_url = var.backchannel_logout_url
  # The web exchanges the session's token for one naming one API — keasy-api, or the platform's AI
  # gateway (registered by the realm) — and the one organization a request addresses (RFC 8693),
  # so the token it signs in with names no API.
  apis = [module.keasy_api.scope, "ai-gateway"]

  # The hierarchy, declared once. Tokens carry it expanded, and the server and the web
  # ask only whether a role is present (server/src/authentication/role.rs).
  roles = {
    reader = { description = "Reads everything in the workspace: graphs, outputs, connections." }
    editor = { description = "Builds graphs, connections and secrets; changes what they made.", composites = ["reader"] }
    admin  = { description = "Configures the workspace and changes anything in it.", composites = ["editor"] }
  }
}
