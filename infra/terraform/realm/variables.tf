# ── Keycloak connection (operator-local tfvars) ──────────────────────────────
# Where this module reaches the admin API. Defaults to the public host; dev reaches
# the compose service.
variable "kc_url" {
  type    = string
  default = null
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

# Dev only: extra origins every tenant client accepts redirects to (the compose stack).
variable "dev_origins" {
  type    = list(string)
  default = []
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
  default = null
}

# Dev only: every declared user gets this password, so `make dev` logs in without an
# IdP. Prod leaves it null — users have no Keycloak password, only SSO.
variable "dev_user_password" {
  type    = string
  default = null
}

# ── Fleet image defaults ─────────────────────────────────────────────────────
variable "server_image" {
  type = string
}
variable "web_image" {
  type = string
}
variable "valkey_image" {
  type    = string
  default = "valkey/valkey:8.1-alpine"
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
    # Fixed OIDC client secret — leave null in prod (Keycloak generates it); dev sets a
    # known value so the compose server can use it without a state handoff.
    client_secret = optional(string)
  }))
  default = {}

  # The planes are disjoint, so `owners` and `members` are disjoint too. An email
  # in both used to resolve silently — `local.assignments` keys on "slug|email"
  # and merges members last, so member won and nobody was told — which is the
  # worst of the three possible outcomes: not the role the operator meant, and no
  # sign that a choice was made. Being in one workspace's `owners` and another's
  # `members` is fine and stays fine; this is about one workspace.
  validation {
    condition = alltrue([
      for t in values(var.tenants) :
      length(setintersection(toset(t.owners), toset(t.members))) == 0
    ])
    error_message = format(
      "A workspace grants one role or the other, never both: an owner administers people, identity and the catalog and has no data plane; a member runs jobs, holds the connections and administers nothing. Listed in owners AND members: %s.",
      join(", ", flatten([
        for slug, t in var.tenants : [
          for e in setintersection(toset(t.owners), toset(t.members)) : "${slug}/${e}"
        ]
      ]))
    )
  }
}

# Whether to create the per-tenant Swarm stacks (server/web docker_service + secrets).
# Prod: true. Dev: false — the identity (Keycloak) is provisioned by this module, but the
# app runs via docker-compose for a fast inner loop (dev/prod parity where it matters).
variable "deploy_stacks" {
  type    = bool
  default = true
}

variable "network_name" {
  type    = string
  default = "keasy-edge"
}
