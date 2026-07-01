# Per-tenant Kubernetes Secret — the declarative replacement for tenants_docker.tf's
# docker_secret/docker_service. This module owns the cross-boundary handoff: it holds
# every tenant secret in state (the Keycloak-generated OIDC client_secret + three
# randoms) and writes one Secret per tenant. The workloads themselves (server/web/
# Ingress/PVC) are Argo's — the keasy-tenant Helm chart mounts this Secret at
# /run/secrets, so the server keeps reading KEASY_*_FILE exactly as on Swarm.
#
# Namespace + Secret are owned here (they must exist before the pod can mount the
# Secret regardless); Argo's tenant Application targets the existing namespace with
# CreateNamespace=false. Skipped in dev (manage_tenant_secrets=false): the app runs
# via docker-compose with a fixed client_secret, no cluster.

locals {
  k8s_tenants = var.manage_tenant_secrets ? local.tenants : {}
}

resource "random_password" "session" {
  for_each = local.k8s_tenants
  length   = 48
  special  = false
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
    "oidc"       = keycloak_openid_client.tenant[each.key].client_secret
    "session"    = random_password.session[each.key].result
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
