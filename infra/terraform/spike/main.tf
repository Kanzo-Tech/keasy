locals {
  workspace_id = "keasy-ws-${var.slug}"
  host         = "${var.slug}.${var.base_domain}"

  server_labels = {
    "com.keasy.workspace"                                            = local.workspace_id
    "traefik.enable"                                                 = "true"
    "traefik.docker.network"                                         = var.network_name
    "traefik.http.routers.${var.slug}-api.rule"                      = "Host(`${local.host}`) && (PathPrefix(`/v1`) || PathPrefix(`/.well-known`))"
    "traefik.http.routers.${var.slug}-api.entrypoints"               = "websecure"
    "traefik.http.routers.${var.slug}-api.tls.certresolver"          = "le"
    "traefik.http.routers.${var.slug}-api.service"                   = "${var.slug}-api"
    "traefik.http.services.${var.slug}-api.loadbalancer.server.port" = "8080"
  }

  web_labels = {
    "com.keasy.workspace"                                            = local.workspace_id
    "traefik.enable"                                                 = "true"
    "traefik.docker.network"                                         = var.network_name
    "traefik.http.routers.${var.slug}-web.rule"                      = "Host(`${local.host}`)"
    "traefik.http.routers.${var.slug}-web.entrypoints"               = "websecure"
    "traefik.http.routers.${var.slug}-web.tls.certresolver"          = "le"
    "traefik.http.routers.${var.slug}-web.priority"                  = "1"
    "traefik.http.routers.${var.slug}-web.service"                   = "${var.slug}-web"
    "traefik.http.services.${var.slug}-web.loadbalancer.server.port" = "3000"
  }
}

# Generated per-tenant secrets (the OIDC one comes from Keycloak in the real module).
resource "random_password" "session" {
  length  = 48
  special = false
}
resource "random_password" "api_key" {
  length  = 48
  special = false
}
resource "random_password" "secret_key" {
  length  = 48
  special = false
}

resource "docker_secret" "oidc" {
  name = "${local.workspace_id}-oidc"
  data = base64encode(var.oidc_client_secret)
}
resource "docker_secret" "session" {
  name = "${local.workspace_id}-session"
  data = base64encode(random_password.session.result)
}
resource "docker_secret" "api_key" {
  name = "${local.workspace_id}-api-key"
  data = base64encode(random_password.api_key.result)
}
resource "docker_secret" "secret_key" {
  name = "${local.workspace_id}-secret-key"
  data = base64encode(random_password.secret_key.result)
}

resource "docker_volume" "data" {
  name = "${local.workspace_id}-data"
}

resource "docker_service" "server" {
  name = "${local.workspace_id}-server"

  task_spec {
    container_spec {
      image = var.server_image
      env = {
        KEASY_BASE_URL                = "https://${local.host}"
        KEASY_WORKSPACE_NAME          = var.slug
        KEASY_ORG_ALIAS               = var.slug
        KEASY_OIDC_ISSUER_URL         = var.oidc_issuer_url
        KEASY_OIDC_CLIENT_ID          = local.workspace_id
        KEASY_OIDC_INTERNAL_BASE_URL  = var.oidc_internal_base_url
        KEASY_OIDC_CLIENT_SECRET_FILE = "/run/secrets/oidc"
        KEASY_SESSION_SECRET_FILE     = "/run/secrets/session"
        KEASY_API_KEY_FILE            = "/run/secrets/api-key"
        KEASY_SECRET_KEY_FILE         = "/run/secrets/secret-key"
      }

      secrets {
        secret_id   = docker_secret.oidc.id
        secret_name = docker_secret.oidc.name
        file_name   = "/run/secrets/oidc"
      }
      secrets {
        secret_id   = docker_secret.session.id
        secret_name = docker_secret.session.name
        file_name   = "/run/secrets/session"
      }
      secrets {
        secret_id   = docker_secret.api_key.id
        secret_name = docker_secret.api_key.name
        file_name   = "/run/secrets/api-key"
      }
      secrets {
        secret_id   = docker_secret.secret_key.id
        secret_name = docker_secret.secret_key.name
        file_name   = "/run/secrets/secret-key"
      }

      mounts {
        type   = "volume"
        source = docker_volume.data.name
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
        nano_cpus    = 1000000000 # 1.0 CPU
        memory_bytes = 1073741824 # 1024 MiB
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
    for_each = local.server_labels
    content {
      label = labels.key
      value = labels.value
    }
  }
}

resource "docker_service" "web" {
  name = "${local.workspace_id}-web"

  task_spec {
    container_spec {
      image = var.web_image
    }

    resources {
      limits {
        nano_cpus    = 500000000 # 0.5 CPU
        memory_bytes = 536870912 # 512 MiB
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
    for_each = local.web_labels
    content {
      label = labels.key
      value = labels.value
    }
  }
}
