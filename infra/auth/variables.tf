variable "kc_url" {
  description = "Keycloak as this module reaches it (no trailing slash)."
  type        = string
}

variable "kc_admin_username" {
  type    = string
  default = "admin"
}

variable "kc_admin_password" {
  type      = string
  sensitive = true
}

variable "realm" {
  type    = string
  default = "kanzo"
}

variable "redirect_uris" {
  description = "The web's callback at every organization's origin: one client serves them all."
  type        = list(string)
}

variable "client_secret" {
  description = "The BFF's secret. Null lets Keycloak generate one (read it from the output)."
  type        = string
  default     = null
  sensitive   = true
}

variable "backchannel_logout_url" {
  description = "The web's /api/auth/backchannel-logout as Keycloak reaches it. Null leaves back-channel logout off."
  type        = string
  default     = null
}
