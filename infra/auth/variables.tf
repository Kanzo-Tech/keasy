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
  description = "Every instance's callback: one client serves them all, one origin per organization."
  type        = list(string)
}

variable "client_secret" {
  description = "The BFF's secret. Null lets Keycloak generate one (read it from the output)."
  type        = string
  default     = null
  sensitive   = true
}
