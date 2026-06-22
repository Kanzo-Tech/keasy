variable "slug" {
  type    = string
  default = "acme"
}

variable "base_domain" {
  type    = string
  default = "keasy.example.com"
}

variable "server_image" {
  type    = string
  default = "ghcr.io/kanzo-tech/keasy-server:0.0.3"
}

variable "web_image" {
  type    = string
  default = "ghcr.io/kanzo-tech/keasy-web:0.0.3"
}

variable "oidc_issuer_url" {
  type    = string
  default = "https://auth.keasy.example.com/auth/realms/keasy"
}

variable "oidc_internal_base_url" {
  type    = string
  default = "http://keycloak:8080/auth"
}

# In the real realm module this is keycloak_openid_client.<tenant>.client_secret.
variable "oidc_client_secret" {
  type      = string
  sensitive = true
  default   = "spike-oidc-secret"
}

variable "network_name" {
  type    = string
  default = "keasy-edge"
}
