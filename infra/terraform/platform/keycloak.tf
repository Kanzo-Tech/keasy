resource "docker_service" "keycloak_postgres" {
  name = "keasy-base-keycloak-postgres"

  task_spec {
    container_spec {
      image = var.postgres_image
      env = {
        POSTGRES_DB            = "keycloak"
        POSTGRES_USER          = "keycloak"
        POSTGRES_PASSWORD_FILE = "/run/secrets/kc-db-password"
      }
      secrets {
        secret_id   = docker_secret.kc_db_password.id
        secret_name = docker_secret.kc_db_password.name
        file_name   = "/run/secrets/kc-db-password"
      }
      mounts {
        type   = "volume"
        source = docker_volume.keycloak_postgres.name
        target = "/var/lib/postgresql/data"
      }
      healthcheck {
        test         = ["CMD-SHELL", "pg_isready -U keycloak -d keycloak"]
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

  # Single-volume stateful service: never two postmasters on one data dir → stop-first.
  update_config {
    order = "stop-first"
  }
}

resource "docker_volume" "keycloak_postgres" {
  name = "keasy-base-keycloak-postgres"
}

# Keycloak boots EMPTY — the realm module configures it. The bootstrap admin is the
# realm module's provider identity (KC_BOOTSTRAP_ADMIN_*). KC_DB_PASSWORD is passed as
# env (no _FILE support); the value lives in state, same as base.yml interpolated it.
resource "docker_service" "keycloak" {
  name = "keasy-base-keycloak"

  task_spec {
    container_spec {
      image = var.keycloak_image
      args  = ["start"]
      env = {
        KC_DB                       = "postgres"
        KC_DB_URL                   = "jdbc:postgresql://keasy-base-keycloak-postgres:5432/keycloak"
        KC_DB_USERNAME              = "keycloak"
        KC_DB_PASSWORD              = random_password.kc_db.result
        KC_HOSTNAME                 = "https://${var.kc_hostname}/auth"
        KC_HTTP_ENABLED             = "true"
        KC_HTTP_RELATIVE_PATH       = "/auth"
        KC_HEALTH_ENABLED           = "true"
        KC_PROXY_HEADERS            = "xforwarded"
        KC_BOOTSTRAP_ADMIN_USERNAME = "admin"
        KC_BOOTSTRAP_ADMIN_PASSWORD = random_password.kc_admin.result
      }
      healthcheck {
        test         = ["CMD-SHELL", "exec 3<>/dev/tcp/127.0.0.1/9000 && echo -e 'GET /auth/health/ready HTTP/1.1\\r\\nhost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && cat <&3 | grep -q '200 OK'"]
        interval     = "10s"
        timeout      = "5s"
        retries      = 15
        start_period = "60s"
      }
    }
    restart_policy {
      condition = "any"
      delay     = "5s"
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

  # --import-realm is gone, but a single Postgres-backed identity service still must not
  # run two tasks at once → stop-first.
  update_config {
    order = "stop-first"
  }

  dynamic "labels" {
    for_each = {
      "traefik.enable"                                          = "true"
      "traefik.docker.network"                                  = docker_network.edge.name
      "traefik.http.routers.keycloak.rule"                      = "Host(`${var.kc_hostname}`)"
      "traefik.http.routers.keycloak.entrypoints"               = "websecure"
      "traefik.http.routers.keycloak.tls.certresolver"          = "le"
      "traefik.http.services.keycloak.loadbalancer.server.port" = "8080"
    }
    content {
      label = labels.key
      value = labels.value
    }
  }
}
