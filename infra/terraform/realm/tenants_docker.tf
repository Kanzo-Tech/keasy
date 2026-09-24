# Per-tenant Swarm stack. One server + web docker_service per tenant, with the
# OIDC secret sourced from the tenant's Keycloak client (no hand-off, no minting).
# Skipped entirely in dev (deploy_stacks=false): the app runs via docker-compose there.
#
# The relying party lives in the **web** service: it holds the client secret and the
# cookie-sealing secret, and it is what the browser reaches. The **server** holds
# neither — it validates a bearer token against the realm's JWKS and needs only the
# issuer, its own client id and the audience to check.

locals {
  stack_tenants = var.deploy_stacks ? var.tenants : {}
}

resource "random_password" "session" {
  for_each = local.stack_tenants
  length   = 48
  special  = false
}
# The AEAD key for stored credentials: 32 random bytes, handed over in base64.
resource "random_bytes" "secret_key" {
  for_each = local.stack_tenants
  length   = 32
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
resource "docker_secret" "secret_key" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-secret-key"
  data     = base64encode(random_bytes.secret_key[each.key].base64)
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
        KEASY_WORKSPACE_NAME = each.value.display_name
        KEASY_ORG_ALIAS      = each.key
        # What a token is validated against: the public issuer it must name, the
        # audience it must carry, and the client it must have been issued to.
        KEASY_OIDC_ISSUER_URL = "https://${var.kc_hostname}/auth/realms/keasy"
        KEASY_OIDC_CLIENT_ID  = "keasy-ws-${each.key}"
        KEASY_OIDC_AUDIENCE   = keycloak_openid_client.api.client_id
        # The ORIGIN this process reaches Keycloak at; the issuer's path is its own.
        KEASY_OIDC_INTERNAL_BASE_URL = "http://keycloak:8080"
        KEASY_SECRET_KEY_FILE        = "/run/secrets/secret-key"
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

  # No Traefik router, and that is the BFF: the API is reachable only from the
  # web service over the overlay network. `/v1` arrives at the web, which attaches
  # the bearer token and forwards it here — a token the browser never held, at an
  # address the browser cannot reach.
  dynamic "labels" {
    for_each = {
      "com.keasy.workspace" = "keasy-ws-${each.key}"
    }
    content {
      label = labels.key
      value = labels.value
    }
  }
}

# The web's session store: tokens behind the cookie's ticket. Unrouted, on the
# overlay only. No volume — losing it signs people out, nothing more.
resource "docker_service" "sessions" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-sessions"

  task_spec {
    container_spec {
      image = var.valkey_image
    }
    resources {
      limits {
        nano_cpus    = 250000000
        memory_bytes = 134217728
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

  labels {
    label = "com.keasy.workspace"
    value = "keasy-ws-${each.key}"
  }
}

resource "docker_service" "web" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-web"

  task_spec {
    container_spec {
      image = coalesce(each.value.web_image, var.web_image)
      env = {
        # The confidential client: this service is the relying party.
        KEASY_OIDC_ISSUER_URL         = "https://${var.kc_hostname}/auth/realms/keasy"
        KEASY_OIDC_CLIENT_ID          = "keasy-ws-${each.key}"
        KEASY_OIDC_CLIENT_SECRET_FILE = "/run/secrets/oidc"
        KEASY_OIDC_INTERNAL_BASE_URL  = "http://keycloak:8080"
        # Seals the session cookie, which carries only a ticket into Valkey.
        KEASY_SESSION_SECRET_FILE = "/run/secrets/session"
        KEASY_SESSION_STORE_URL   = "redis://keasy-ws-${each.key}-sessions:6379"
        # Where the BFF forwards `/v1` once it has attached the bearer token.
        KEASY_API_URL = "http://keasy-ws-${each.key}-server:8080"
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
      "traefik.http.routers.${each.key}-web.service"                   = "${each.key}-web"
      "traefik.http.services.${each.key}-web.loadbalancer.server.port" = "3000"
    }
    content {
      label = labels.key
      value = labels.value
    }
  }
}
