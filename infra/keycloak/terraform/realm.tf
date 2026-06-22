# The keasy realm. Mirrors the settings the hand-written realm-import JSON carried,
# but as a Terraform-created realm so the built-in client scopes auto-exist.
resource "keycloak_realm" "keasy" {
  realm   = "keasy"
  enabled = true

  # Invitation-only: registration happens by accepting a Keycloak Organization invite.
  registration_allowed           = false
  registration_email_as_username = true
  login_with_email_allowed       = true
  reset_password_allowed         = true
  verify_email                   = false

  access_token_lifespan    = "1h"
  sso_session_max_lifespan = "24h"

  # Load-bearing: the entire tenant model is Keycloak Organizations.
  organizations_enabled = true

  # SMTP relay for Organization invitations. Omitted entirely when smtp_host is empty.
  dynamic "smtp_server" {
    for_each = var.smtp_host == "" ? [] : [1]
    content {
      host              = var.smtp_host
      port              = var.smtp_port
      from              = var.smtp_from
      from_display_name = var.smtp_from_name
      ssl               = var.smtp_ssl
      starttls          = var.smtp_starttls

      dynamic "auth" {
        for_each = var.smtp_user == "" ? [] : [1]
        content {
          username = var.smtp_user
          password = var.smtp_password
        }
      }
    }
  }
}
