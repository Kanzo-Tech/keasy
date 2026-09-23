# The keasy realm — minimal. No Organizations (instance-per-tenant makes membership a
# per-client role assignment), no SMTP (SSO means no password/invite emails). A realm
# created via the API auto-creates the built-in client scopes (roles, web-origins, …),
# so we reference them and never redefine them.
resource "keycloak_realm" "keasy" {
  realm   = "keasy"
  enabled = true

  registration_allowed     = false
  login_with_email_allowed = true
  access_token_lifespan    = "1h"
  sso_session_max_lifespan = "24h"
}

# Keycloak 26 validates every user attribute against the realm's User Profile and
# silently drops the ones it does not declare — which is how `workspaces` came to
# be set on the user, mapped into the token, and absent from both. It is declared
# here rather than switched on wholesale through `unmanaged_attribute_policy`: a
# schema that names our one attribute beats a realm that accepts any.
#
# The other four are Keycloak's own built-ins, restated because this resource
# replaces the whole profile rather than adding to it. Their permissions and
# validators are the defaults; `firstName`/`lastName` stay required for `user`,
# which is what makes an account "fully set up" — the IdP supplies them on first
# broker login, and loosening it here would be changing the login flow sideways.
resource "keycloak_realm_user_profile" "keasy" {
  realm_id = keycloak_realm.keasy.id

  attribute {
    name         = "username"
    display_name = "$${username}"
    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
    validator {
      name   = "length"
      config = { min = "3", max = "255" }
    }
    validator { name = "username-prohibited-characters" }
    validator { name = "up-username-not-idn-homograph" }
  }

  attribute {
    name               = "email"
    display_name       = "$${email}"
    required_for_roles = ["user"]
    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
    validator { name = "email" }
    validator {
      name   = "length"
      config = { max = "255" }
    }
  }

  attribute {
    name               = "firstName"
    display_name       = "$${firstName}"
    required_for_roles = ["user"]
    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
    validator {
      name   = "length"
      config = { max = "255" }
    }
    validator { name = "person-name-prohibited-characters" }
  }

  attribute {
    name               = "lastName"
    display_name       = "$${lastName}"
    required_for_roles = ["user"]
    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
    validator {
      name   = "length"
      config = { max = "255" }
    }
    validator { name = "person-name-prohibited-characters" }
  }

  # Ours: the workspaces a person belongs to, which the switcher draws and the
  # server reads off the validated token. Admin-managed — it is a fact about the
  # fleet declared in `var.tenants`, never something a person edits about
  # themselves.
  attribute {
    name         = "workspaces"
    display_name = "Workspaces"
    multi_valued = true
    permissions {
      view = ["admin"]
      edit = ["admin"]
    }
  }
}
