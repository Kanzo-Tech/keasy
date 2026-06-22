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
