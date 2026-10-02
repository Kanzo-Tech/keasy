# The AI gateway: LiteLLM, the platform's one door to models, as Keycloak is its one
# door to identity. Tenants reach it on the overlay as `ai-gateway`; each tenant's
# server holds a virtual key the realm module mints (team + budget per tenant). The
# profile — which upstream answers which alias — is infra/ai/litellm.prod.yaml.

resource "random_password" "ai_master" {
  length  = 48
  special = false
}

resource "random_password" "ai_db" {
  length  = 32
  special = false
}

resource "docker_secret" "ai_db_password" {
  name = "ai-db-password"
  data = base64encode(random_password.ai_db.result)
}

resource "docker_config" "ai" {
  name = "ai-gateway-${substr(sha256(file("${path.module}/../../ai/litellm.prod.yaml")), 0, 12)}"
  data = base64encode(file("${path.module}/../../ai/litellm.prod.yaml"))
  lifecycle {
    create_before_destroy = true
  }
}

resource "docker_volume" "ai_postgres" {
  name = "keasy-base-ai-postgres"
}

resource "docker_service" "ai_postgres" {
  name = "keasy-base-ai-postgres"

  task_spec {
    container_spec {
      image = var.postgres_image
      env = {
        POSTGRES_DB            = "litellm"
        POSTGRES_USER          = "litellm"
        POSTGRES_PASSWORD_FILE = "/run/secrets/ai-db-password"
      }
      secrets {
        secret_id   = docker_secret.ai_db_password.id
        secret_name = docker_secret.ai_db_password.name
        file_name   = "/run/secrets/ai-db-password"
      }
      mounts {
        type   = "volume"
        source = docker_volume.ai_postgres.name
        target = "/var/lib/postgresql/data"
      }
      healthcheck {
        test         = ["CMD-SHELL", "pg_isready -U litellm -d litellm"]
        interval     = "10s"
        timeout      = "5s"
        retries      = 5
        start_period = "30s"
      }
    }
    restart_policy {
      condition = "any"
    }
    placement {
      max_replicas = 1
    }
    networks_advanced {
      name = docker_network.edge.name
    }
  }

  mode {
    replicated {
      replicas = 1
    }
  }

  update_config {
    order = "stop-first"
  }
}

# Exact-match cache for `complete` (opted in per request). Losing it costs
# tokens, nothing else, so no volume.
resource "docker_service" "ai_cache" {
  name = "keasy-base-ai-cache"

  task_spec {
    container_spec {
      image = var.valkey_image
    }
    restart_policy {
      condition = "any"
    }
    networks_advanced {
      name = docker_network.edge.name
    }
  }

  mode {
    replicated {
      replicas = 1
    }
  }
}

# LiteLLM reads no `_FILE` variants, so the master key, the DB URL and the upstream
# keys are env — their values live in state, as Keycloak's admin password does.
resource "docker_service" "ai_gateway" {
  name = "keasy-base-ai-gateway"

  task_spec {
    container_spec {
      image = var.ai_gateway_image
      args  = ["--config", "/app/config.yaml", "--port", "4000"]
      env = merge(var.ai_upstream_keys, {
        LITELLM_MASTER_KEY = random_password.ai_master.result
        DATABASE_URL       = "postgresql://litellm:${random_password.ai_db.result}@keasy-base-ai-postgres:5432/litellm"
        REDIS_HOST         = "keasy-base-ai-cache"
        REDIS_PORT         = "6379"
        STORE_MODEL_IN_DB  = "False"
      })
      configs {
        config_id   = docker_config.ai.id
        config_name = docker_config.ai.name
        file_name   = "/app/config.yaml"
      }
      healthcheck {
        test         = ["CMD-SHELL", "python -c \"import urllib.request;urllib.request.urlopen('http://localhost:4000/health/liveliness')\""]
        interval     = "15s"
        timeout      = "5s"
        retries      = 5
        start_period = "60s"
      }
    }
    restart_policy {
      condition = "any"
      delay     = "5s"
    }
    networks_advanced {
      name    = docker_network.edge.name
      aliases = ["ai-gateway"]
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

  # The admin console (and the management API the realm module drives) on an
  # internal host, reachable only from `ai_admin_allow`. Tenants never use this route:
  # they reach `ai-gateway:4000` over the overlay.
  dynamic "labels" {
    for_each = var.ai_admin_hostname == null ? {} : {
      "traefik.enable"                                                  = "true"
      "traefik.docker.network"                                          = docker_network.edge.name
      "traefik.http.routers.ai-admin.rule"                              = "Host(`${var.ai_admin_hostname}`)"
      "traefik.http.routers.ai-admin.entrypoints"                       = "websecure"
      "traefik.http.routers.ai-admin.tls.certresolver"                  = "le"
      "traefik.http.routers.ai-admin.middlewares"                       = "ai-admin-allow"
      "traefik.http.middlewares.ai-admin-allow.ipallowlist.sourcerange" = join(",", var.ai_admin_allow)
      "traefik.http.services.ai-admin.loadbalancer.server.port"         = "4000"
    }
    content {
      label = labels.key
      value = labels.value
    }
  }
}
