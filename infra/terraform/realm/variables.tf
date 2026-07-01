# ── Keycloak connection (operator-local tfvars) ──────────────────────────────
# Default is the dev compose service (make dev relies on it). Prod sets this to the
# public Keycloak ingress in terraform.tfvars (the operator applies from outside the cluster).
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

# ── The tenant fleet ──────────────────────────────────────────────────────────
# Prod defines the fleet in git (infra/k8s/tenants/*.yaml → Argo ApplicationSet + this
# module reads the same files); `tenant_membership` joins by slug. Dev defines its single
# static workspace inline in `tenants` (tenants_from_git=false). See tenants.tf.

# Dev-only inline fleet. Prod leaves this empty.
variable "tenants" {
  description = "Dev-only inline tenants. slug => {displayName, owners, members, client_secret?}."
  type = map(object({
    displayName = string
    owners      = list(string)
    members     = optional(list(string), [])
    # Fixed OIDC client secret so the compose server can use it without a state handoff.
    client_secret = optional(string)
  }))
  default = {}
}

# Prod membership + secrets, keyed by the same slug as the git topology files. Emails are
# PII and the client_secret is a secret → operator-local terraform.tfvars, never committed.
variable "tenant_membership" {
  description = "slug => {owners, members, client_secret?}. PII/secret → operator-local."
  type = map(object({
    owners        = list(string)
    members       = optional(list(string), [])
    client_secret = optional(string)
  }))
  default = {}
}

# Read the fleet from git (prod) vs the inline `tenants` map (dev/compose, no cluster).
variable "tenants_from_git" {
  type    = bool
  default = true
}

# Whether to materialize the per-tenant k8s Secrets (+ namespaces). Prod: true. Dev:
# false — identity (Keycloak) is still provisioned, but the app runs via docker-compose
# for a fast inner loop, with no cluster to write Secrets into.
variable "manage_tenant_secrets" {
  type    = bool
  default = true
}

# ── Kubernetes target for the per-tenant Secrets ─────────────────────────────
variable "kubeconfig_path" {
  type    = string
  default = "~/.kube/config"
}
variable "kubeconfig_context" {
  type    = string
  default = ""
}

# Optional: a docker-registry .dockerconfigjson for pulling private GHCR images. When
# set, a `ghcr-pull` Secret is created in each tenant namespace; reference it from the
# ApplicationSet (image.pullSecrets: [{name: ghcr-pull}]). Leave empty for public images.
variable "image_pull_dockerconfigjson" {
  type      = string
  default   = ""
  sensitive = true
}
