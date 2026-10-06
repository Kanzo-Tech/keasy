variable "kc_hostname" {
  type = string # Keycloak's public host, e.g. auth.keasy.example.com
}

variable "acme_email" {
  type = string # Let's Encrypt registration
}

variable "keycloak_image" {
  type    = string
  default = "quay.io/keycloak/keycloak:26.8.0"
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
# Env name => key, for every upstream ai-profile.yaml names
# (e.g. { ANTHROPIC_API_KEY = "…" }).
variable "ai_upstream_keys" {
  type      = map(string)
  sensitive = true
  default   = {}
}

# Tokens each organization may spend an hour, input and output together. Null = no budget.
variable "ai_tokens_per_hour" {
  type    = number
  default = null
}
