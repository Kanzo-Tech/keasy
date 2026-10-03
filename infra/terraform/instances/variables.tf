variable "base_domain" {
  type = string # instances served at <alias>.<base_domain>
}

# ── Identity (the platform realm, kanzo-ui services/auth/realm) ──────────────
# The public issuer every token names, e.g. https://auth.keasy.example.com/realms/kanzo.
variable "oidc_issuer_url" {
  type = string
}

# The ORIGIN the instances reach Keycloak at on the overlay; the issuer's path is its own.
variable "oidc_internal_base_url" {
  type    = string
  default = "http://keycloak:8080"
}

# The one `keasy` client's secret, shared by every instance's web:
#   terraform -chdir=infra/auth output -raw client_secret
variable "oidc_client_secret" {
  type      = string
  sensitive = true
}

# ── AI ───────────────────────────────────────────────────────────────────────
# Organization alias => that instance's gateway key:
#   terraform -chdir=infra/ai output -json keys
variable "ai_keys" {
  type      = map(string)
  sensitive = true
}

# ── Fleet image defaults ─────────────────────────────────────────────────────
# The release tag without its `v`: images.yml publishes keasy-server and keasy-web
# under it, and every instance runs that pair.
variable "release_version" {
  type = string
}
variable "valkey_image" {
  type    = string
  default = "valkey/valkey:8.1-alpine"
}

# ── The instances (operator-local tfvars) ────────────────────────────────────
# One per organization in the realm, keyed by its alias. Who belongs to it and with
# which role is the organization's, in Keycloak — not this module's.
variable "tenants" {
  description = "Organization alias => instance."
  type = map(object({
    display_name = string
    # How the workspace looks: the path to a YAML file holding exactly what the
    # theme generator emits (`branding:` with theme_css, families, default, lock;
    # optionally logo). Mounted into the server as-is and read at boot
    # (KEASY_BRANDING_FILE), which refuses an invalid one; served at GET /v1/branding.
    branding_file = optional(string)
  }))
  default = {}

  validation {
    condition = alltrue([
      for t in values(var.tenants) : t.branding_file == null ? true : fileexists(t.branding_file)
    ])
    error_message = "A tenant's branding_file must name an existing file (the theme generator's YAML)."
  }
}

variable "network_name" {
  type    = string
  default = "keasy-edge"
}
