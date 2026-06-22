# ── Keycloak connection (operator-local tfvars) ──────────────────────────────
variable "kc_url" {
  type    = string
  default = "http://keycloak:8080"
}
variable "kc_admin_username" {
  type    = string
  default = "admin"
}
variable "kc_admin_password" {
  type      = string
  sensitive = true
}

# Public Keycloak host (token issuer the tenant servers validate against).
variable "kc_hostname" {
  type = string # e.g. auth.keasy.example.com
}

variable "base_domain" {
  type = string # tenants served at <slug>.<base_domain>
}

# ── SSO identity provider (zero SMTP — users log in with their IdP) ───────────
variable "idp" {
  description = "Upstream OIDC IdP. Users authenticate here; Keycloak links to the pre-declared user by email."
  type = object({
    alias             = string
    display_name      = optional(string, "SSO")
    client_id         = string
    client_secret     = string
    authorization_url = string
    token_url         = string
    user_info_url     = optional(string, "")
    issuer            = optional(string, "")
    default_scopes    = optional(string, "openid email profile")
  })
}

# ── Fleet image defaults ─────────────────────────────────────────────────────
variable "server_image" {
  type = string
}
variable "web_image" {
  type = string
}

# ── The tenant fleet — the declarative registry (operator-local tfvars) ───────
variable "tenants" {
  description = "slug => tenant. owners/members are emails; they must exist at the IdP."
  type = map(object({
    display_name = string
    owners       = list(string)
    members      = optional(list(string), [])
    server_image = optional(string)
    web_image    = optional(string)
  }))
  default = {}
}

variable "network_name" {
  type    = string
  default = "keasy-edge"
}
