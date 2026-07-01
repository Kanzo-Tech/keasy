# Per-tenant Kubernetes Secret. Holds the two TF-generated randoms — api-key +
# secret-key — and writes one Secret per tenant for the Argo-managed keasy-tenant chart
# to mount at /run/secrets (the server reads KEASY_*_FILE). No OIDC client_secret (the
# Keycloak client is public + PKCE) and no session key (the server self-generates it) —
# only these two remain, and both are the last TF→k8s tie pending a secrets mechanism.
#
# Namespace + Secret are owned here (they must exist before the pod can mount the
# Secret regardless); Argo's tenant Application targets the existing namespace with
# CreateNamespace=false. Skipped in dev (manage_tenant_secrets=false): the app runs
# via docker-compose, no cluster.

locals {
  k8s_tenants = var.manage_tenant_secrets ? local.tenants : {}
}

resource "random_password" "api_key" {
  for_each = local.k8s_tenants
  length   = 48
  special  = false
}
resource "random_password" "secret_key" {
  for_each = local.k8s_tenants
  length   = 48
  special  = false
}

resource "kubernetes_namespace" "tenant" {
  for_each = local.k8s_tenants
  metadata {
    name = "keasy-ws-${each.key}"
    labels = {
      "app.kubernetes.io/part-of" = "keasy"
      "com.keasy.workspace"       = "keasy-ws-${each.key}"
    }
  }
}

# The keys here are the filenames the chart mounts at /run/secrets/<key>, matching
# the server's KEASY_*_FILE env. The provider base64-encodes `data` values itself —
# pass plaintext (no base64encode, unlike the Swarm docker_secret).
resource "kubernetes_secret" "tenant" {
  for_each = local.k8s_tenants
  metadata {
    name      = "keasy-ws-${each.key}"
    namespace = kubernetes_namespace.tenant[each.key].metadata[0].name
    labels = {
      "com.keasy.workspace" = "keasy-ws-${each.key}"
    }
  }
  data = {
    "api-key"    = random_password.api_key[each.key].result
    "secret-key" = random_password.secret_key[each.key].result
  }
  type = "Opaque"
}

# Optional pull secret for private GHCR images, one per tenant namespace.
resource "kubernetes_secret" "pull" {
  # nonsensitive: the for_each only branches on whether a token was provided, not its value.
  for_each = nonsensitive(var.image_pull_dockerconfigjson != "") ? local.k8s_tenants : {}
  metadata {
    name      = "ghcr-pull"
    namespace = kubernetes_namespace.tenant[each.key].metadata[0].name
  }
  data = {
    ".dockerconfigjson" = var.image_pull_dockerconfigjson
  }
  type = "kubernetes.io/dockerconfigjson"
}
