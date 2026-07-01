# Keycloak: authenticate as the bootstrap admin (creds in operator-local tfvars). A
# single-operator, TF-owns-everything model — no separate least-privilege client to mint.
provider "keycloak" {
  client_id = "admin-cli"
  username  = var.kc_admin_username
  password  = var.kc_admin_password
  url       = var.kc_url
  base_path = "/auth"
}

# Kubernetes: where the per-tenant Secrets land. The realm module holds every
# secret in state (the Keycloak-generated OIDC client_secret + the random
# session/api-key/secret-key) and materializes them as k8s Secrets that the
# keasy-tenant chart (Argo-managed) consumes — the cross-boundary replacement for
# the Swarm docker_secret. Defaults to the operator's kubeconfig.
provider "kubernetes" {
  # Only point at a kubeconfig when one is given. Dev (manage_tenant_secrets=false, no
  # cluster) sets kubeconfig_path="" → config_path=null, so the provider configures lazily
  # and never errors: with no kubernetes_* resources it is simply never used.
  config_path    = var.kubeconfig_path != "" ? var.kubeconfig_path : null
  config_context = var.kubeconfig_context != "" ? var.kubeconfig_context : null
}
