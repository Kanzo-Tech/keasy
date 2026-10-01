variable "kc_hostname" {
  type = string # Keycloak's public host, e.g. auth.keasy.example.com
}

variable "acme_email" {
  type = string # Let's Encrypt registration
}

variable "keycloak_image" {
  type    = string
  default = "quay.io/keycloak/keycloak:26.2"
}

variable "traefik_image" {
  type    = string
  default = "traefik:v3.5"
}

variable "postgres_image" {
  type    = string
  default = "postgres:15"
}

# ── AI gateway ───────────────────────────────────────────────────────────────
variable "ai_gateway_image" {
  type = string
  # Pinned by digest: two LiteLLM releases (1.82.7, 1.82.8) shipped compromised.
  default = "ghcr.io/berriai/litellm-database:v1.103.0@sha256:f4f114b1996c5923c4d62a7bbdcecb2ccf9df17bdebce76050f609be97f75f5c"
}

variable "valkey_image" {
  type    = string
  default = "valkey/valkey:8.1-alpine"
}

# Env name => key, for every upstream infra/ai/litellm.prod.yaml names
# (e.g. { ANTHROPIC_API_KEY = "…" }).
variable "ai_upstream_keys" {
  type      = map(string)
  sensitive = true
  default   = {}
}

# The admin console's host, e.g. ai.internal.keasy.example.com. Null = no route.
variable "ai_admin_hostname" {
  type    = string
  default = null
}

# CIDRs allowed to reach the admin console (the operator's, a VPN's).
variable "ai_admin_allow" {
  type    = list(string)
  default = []
}
