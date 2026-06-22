# Per-tenant Swarm stack — the declarative replacement for control-plane/src/docker.rs
# render_stack + create_secrets. One server + web docker_service per tenant, with the
# OIDC secret sourced from the tenant's Keycloak client (no hand-off, no minting).
# Skipped entirely in dev (deploy_stacks=false): the app runs via docker-compose there.

locals {
  stack_tenants = var.deploy_stacks ? var.tenants : {}
}

resource "random_password" "session" {
  for_each = local.stack_tenants
  length   = 48
  special  = false
}
resource "random_password" "api_key" {
  for_each = local.stack_tenants
  length   = 48
  special  = false
}
resource "random_password" "secret_key" {
  for_each = local.stack_tenants
  length   = 48
  special  = false
}

resource "docker_secret" "oidc" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-oidc"
  data     = base64encode(keycloak_openid_client.tenant[each.key].client_secret)
}
resource "docker_secret" "session" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-session"
  data     = base64encode(random_password.session[each.key].result)
}
resource "docker_secret" "api_key" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-api-key"
  data     = base64encode(random_password.api_key[each.key].result)
}
resource "docker_secret" "secret_key" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-secret-key"
  data     = base64encode(random_password.secret_key[each.key].result)
}

resource "docker_volume" "data" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-data"
}

resource "docker_service" "server" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-server"

  task_spec {
    container_spec {
      image = coalesce(each.value.server_image, var.server_image)
      env = {
        KEASY_BASE_URL                = "https://${each.key}.${var.base_domain}"
        KEASY_WORKSPACE_NAME          = each.value.display_name
        KEASY_ORG_ALIAS               = each.key
        KEASY_OIDC_ISSUER_URL         = "https://${var.kc_hostname}/auth/realms/keasy"
        KEASY_OIDC_CLIENT_ID          = "keasy-ws-${each.key}"
        KEASY_OIDC_INTERNAL_BASE_URL  = "http://keycloak:8080/auth"
        KEASY_OIDC_CLIENT_SECRET_FILE = "/run/secrets/oidc"
        KEASY_SESSION_SECRET_FILE     = "/run/secrets/session"
        KEASY_API_KEY_FILE            = "/run/secrets/api-key"
        KEASY_SECRET_KEY_FILE         = "/run/secrets/secret-key"
      }

      secrets {
        secret_id   = docker_secret.oidc[each.key].id
        secret_name = docker_secret.oidc[each.key].name
        file_name   = "/run/secrets/oidc"
      }
      secrets {
        secret_id   = docker_secret.session[each.key].id
        secret_name = docker_secret.session[each.key].name
        file_name   = "/run/secrets/session"
      }
      secrets {
        secret_id   = docker_secret.api_key[each.key].id
        secret_name = docker_secret.api_key[each.key].name
        file_name   = "/run/secrets/api-key"
      }
      secrets {
        secret_id   = docker_secret.secret_key[each.key].id
        secret_name = docker_secret.secret_key[each.key].name
        file_name   = "/run/secrets/secret-key"
      }

      mounts {
        type   = "volume"
        source = docker_volume.data[each.key].name
        target = "/var/lib/keasy"
      }

      healthcheck {
        test         = ["CMD", "curl", "-f", "http://localhost:8080/healthz/ready"]
        interval     = "10s"
        timeout      = "5s"
        retries      = 5
        start_period = "30s"
      }
    }

    resources {
      limits {
        nano_cpus    = 1000000000
        memory_bytes = 1073741824
      }
    }

    restart_policy {
      condition = "any"
    }

    networks_advanced {
      name = var.network_name
    }
  }

  mode {
    replicated {
      replicas = 1
    }
  }

  update_config {
    order             = "start-first"
    failure_action    = "rollback"
    monitor           = "30s"
    max_failure_ratio = "0.0"
    parallelism       = 1
  }
  rollback_config {
    order = "start-first"
  }

  dynamic "labels" {
    for_each = {
      "com.keasy.workspace"                                            = "keasy-ws-${each.key}"
      "traefik.enable"                                                 = "true"
      "traefik.docker.network"                                         = var.network_name
      "traefik.http.routers.${each.key}-api.rule"                      = "Host(`${each.key}.${var.base_domain}`) && (PathPrefix(`/v1`) || PathPrefix(`/.well-known`))"
      "traefik.http.routers.${each.key}-api.entrypoints"               = "websecure"
      "traefik.http.routers.${each.key}-api.tls.certresolver"          = "le"
      "traefik.http.routers.${each.key}-api.service"                   = "${each.key}-api"
      "traefik.http.services.${each.key}-api.loadbalancer.server.port" = "8080"
    }
    content {
      label = labels.key
      value = labels.value
    }
  }
}

resource "docker_service" "web" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-web"

  task_spec {
    container_spec {
      image = coalesce(each.value.web_image, var.web_image)
    }
    resources {
      limits {
        nano_cpus    = 500000000
        memory_bytes = 536870912
      }
    }
    restart_policy {
      condition = "any"
    }
    networks_advanced {
      name = var.network_name
    }
  }

  mode {
    replicated {
      replicas = 1
    }
  }

  update_config {
    order          = "start-first"
    failure_action = "rollback"
    monitor        = "30s"
  }

  dynamic "labels" {
    for_each = {
      "com.keasy.workspace"                                            = "keasy-ws-${each.key}"
      "traefik.enable"                                                 = "true"
      "traefik.docker.network"                                         = var.network_name
      "traefik.http.routers.${each.key}-web.rule"                      = "Host(`${each.key}.${var.base_domain}`)"
      "traefik.http.routers.${each.key}-web.entrypoints"               = "websecure"
      "traefik.http.routers.${each.key}-web.tls.certresolver"          = "le"
      "traefik.http.routers.${each.key}-web.priority"                  = "1"
      "traefik.http.routers.${each.key}-web.service"                   = "${each.key}-web"
      "traefik.http.services.${each.key}-web.loadbalancer.server.port" = "3000"
    }
    content {
      label = labels.key
      value = labels.value
    }
  }
}
