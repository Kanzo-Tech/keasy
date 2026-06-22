# All inputs arrive as TF_VAR_* env from infra/stack/tf.sh (sourced from .env +
# versions.env). No terraform.tfvars file — secrets never land on disk in the repo.

variable "kc_url" {
  description = "Keycloak base URL reachable from the terraform runner (internal overlay address)."
  type        = string
  default     = "http://keycloak:8080"
}

variable "tf_client_id" {
  description = "Client id the provider authenticates as (the least-privilege keasy-terraform client)."
  type        = string
  default     = "keasy-terraform"
}

variable "tf_client_secret" {
  description = "Secret of the keasy-terraform client (minted by bootstrap via kcadm)."
  type        = string
  sensitive   = true
}

variable "cp_oidc_secret" {
  description = "Secret set on the keasy-control-plane client — the same value cp.sh passes to the CLI."
  type        = string
  sensitive   = true
}

variable "server_oidc_secret" {
  description = "Secret of the single-instance/dev keasy-server client."
  type        = string
  sensitive   = true
  default     = "keasy-dev-secret"
}

variable "smtp_host" {
  description = "SMTP relay host for Organization invitations. Empty disables SMTP on the realm."
  type        = string
  default     = ""
}

variable "smtp_port" {
  type    = string
  default = "587"
}

variable "smtp_from" {
  type    = string
  default = ""
}

variable "smtp_from_name" {
  type    = string
  default = "Keasy"
}

variable "smtp_ssl" {
  type    = bool
  default = false
}

variable "smtp_starttls" {
  description = "STARTTLS — true for a 587 relay; dev mailpit (1025) sets false."
  type        = bool
  default     = true
}

variable "smtp_user" {
  description = "SMTP auth user. Empty leaves the relay unauthenticated (auth block omitted)."
  type        = string
  default     = ""
}

variable "smtp_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "server_redirect_uris" {
  description = "Redirect URIs for the single-instance/dev keasy-server client."
  type        = list(string)
  default = [
    "http://localhost:8080/v1/auth/oidc-callback",
    "http://localhost:3000/v1/auth/oidc-callback",
  ]
}
