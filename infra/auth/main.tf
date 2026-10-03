module "keasy" {
  source = "git::https://github.com/Kanzo-Tech/ui.git//services/auth/modules/app?ref=v0.28.0"

  realm_id      = var.realm
  client_id     = "keasy"
  description   = "keasy: a Backend-For-Frontend. Confidential; the browser never holds a token."
  access_type   = "CONFIDENTIAL"
  client_secret = var.client_secret
  redirect_uris = var.redirect_uris
  audience      = "keasy-api"

  # The hierarchy, declared once. Tokens carry it expanded, and the server and the web
  # ask only whether a role is present (server/src/authentication/role.rs).
  roles = {
    reader = { description = "Reads everything in the workspace: jobs, outputs, connections." }
    editor = { description = "Builds jobs, connections and secrets; changes what they made.", composites = ["reader"] }
    admin  = { description = "Configures the workspace and changes anything in it.", composites = ["editor"] }
  }
}
