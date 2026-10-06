# The fleet on Swarm: one server per organization, and one web for all of them —
# Keycloak's Organizations model, one `keasy` client shared by every organization.
#
# The **server** is per organization, and so is its data: KEASY_ORG_ALIAS says which, and a
# token's roles count only inside it. It holds no client secret and no session — it
# validates a bearer token against the realm's JWKS.
#
# The **web** is the relying party for every organization: it holds the client secret and
# the cookie-sealing secret, reads the organization from the host (<alias>.<base_domain>),
# and forwards /api/v1 to that organization's server. One web means one session store and
# one back-channel logout URL, which is all Keycloak calls per client.

locals {
  server_image = "ghcr.io/kanzo-tech/keasy-server:${var.release_version}"
  web_image    = "ghcr.io/kanzo-tech/keasy-web:${var.release_version}"
}

resource "random_password" "session" {
  length  = 48
  special = false
}
# The AEAD key for stored credentials: 32 random bytes, handed over in base64.
resource "random_bytes" "secret_key" {
  for_each = var.tenants
  length   = 32
}

# One client for the whole fleet, and one web that mounts its secret.
resource "docker_secret" "oidc" {
  name = "keasy-oidc"
  data = base64encode(var.oidc_client_secret)
}
resource "docker_secret" "ai_key" {
  for_each = var.tenants
  name     = "keasy-ws-${each.key}-ai-key"
  data     = base64encode(var.ai_keys[each.key])
}
resource "docker_secret" "session" {
  name = "keasy-session"
  data = base64encode(random_password.session.result)
}
resource "docker_secret" "secret_key" {
  for_each = var.tenants
  name     = "keasy-ws-${each.key}-secret-key"
  data     = base64encode(random_bytes.secret_key[each.key].base64)
}

# The tenant's branding — the theme generator's YAML, mounted as a file: CSS
# outgrows an env var. Swarm configs are immutable, so the name carries the
# content's hash and a change rolls a new config in before the old one goes.
resource "docker_config" "branding" {
  for_each = { for slug, t in var.tenants : slug => file(t.branding_file) if t.branding_file != null }
  name     = "keasy-ws-${each.key}-branding-${substr(sha256(each.value), 0, 12)}"
  data     = base64encode(each.value)
  lifecycle {
    create_before_destroy = true
  }
}

resource "docker_volume" "data" {
  for_each = var.tenants
  name     = "keasy-ws-${each.key}-data"
}

resource "docker_service" "server" {
  for_each = var.tenants
  name     = "keasy-ws-${each.key}-server"

  task_spec {
    container_spec {
      image = local.server_image
      env = merge({
        KEASY_DATA_DIR       = "/var/lib/keasy"
        KEASY_WORKSPACE_NAME = each.value.display_name
        KEASY_ORG_ALIAS      = each.key
        # What a token is validated against: the public issuer it must name and the
        # client it must have been issued to (the audience defaults to keasy-api).
        KEASY_OIDC_ISSUER_URL        = var.oidc_issuer_url
        KEASY_OIDC_CLIENT_ID         = "keasy"
        KEASY_OIDC_INTERNAL_BASE_URL = var.oidc_internal_base_url
        KEASY_SECRET_KEY_FILE        = "/run/secrets/secret-key"
        # The AI gateway on the overlay, and this workspace's key to it.
        KEASY_AI_URL      = "http://ai-gateway:4000"
        KEASY_AI_KEY_FILE = "/run/secrets/ai-key"
        }, contains(keys(docker_config.branding), each.key) ? {
        KEASY_BRANDING_FILE = "/etc/keasy/branding.yml"
      } : {})

      dynamic "configs" {
        for_each = contains(keys(docker_config.branding), each.key) ? [docker_config.branding[each.key]] : []
        content {
          config_id   = configs.value.id
          config_name = configs.value.name
          file_name   = "/etc/keasy/branding.yml"
        }
      }

      secrets {
        secret_id   = docker_secret.secret_key[each.key].id
        secret_name = docker_secret.secret_key[each.key].name
        file_name   = "/run/secrets/secret-key"
      }
      secrets {
        secret_id   = docker_secret.ai_key[each.key].id
        secret_name = docker_secret.ai_key[each.key].name
        file_name   = "/run/secrets/ai-key"
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

  # stop-first: the server owns a SQLite file, which takes one writer. A
  # start-first rollout has the old and the new task open it at once.
  update_config {
    order             = "stop-first"
    failure_action    = "rollback"
    monitor           = "30s"
    max_failure_ratio = "0.0"
    parallelism       = 1
  }
  rollback_config {
    order = "stop-first"
  }

  # No Traefik router, and that is the BFF: the API is reachable only from the
  # web service over the overlay network. `/api/v1` arrives at the web, which attaches
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

# The web's session store: tokens behind the cookie's ticket, for every organization (a
# cookie is per host, so each organization's sessions are its own tickets). Unrouted, on the
# overlay only. No volume — losing it signs people out, nothing more.
resource "docker_service" "sessions" {
  name = "keasy-sessions"

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
    label = "com.keasy.component"
    value = "sessions"
  }
}

resource "docker_service" "web" {
  name = "keasy-web"

  task_spec {
    container_spec {
      image = local.web_image
      env = {
        # The confidential client: this service is the relying party.
        KEASY_OIDC_ISSUER_URL         = var.oidc_issuer_url
        KEASY_OIDC_CLIENT_ID          = "keasy"
        KEASY_OIDC_CLIENT_SECRET_FILE = "/run/secrets/oidc"
        KEASY_OIDC_INTERNAL_BASE_URL  = var.oidc_internal_base_url
        # The organization is the host's subdomain: <alias>.<base_domain>.
        KEASY_BASE_DOMAIN = var.base_domain
        # Seals the session cookie, which carries only a ticket into Valkey.
        KEASY_SESSION_SECRET_FILE = "/run/secrets/session"
        KEASY_SESSION_STORE_URL   = "redis://keasy-sessions:6379"
        # Where the BFF forwards `/api/v1` once it has attached the bearer token: the server
        # of the organization the request addresses.
        KEASY_API_URL = "http://keasy-ws-{tenant}-server:8080"
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
      "com.keasy.component"                                      = "web"
      "traefik.enable"                                           = "true"
      "traefik.docker.network"                                   = var.network_name
      "traefik.http.routers.keasy-web.rule"                      = join(" || ", [for alias in keys(var.tenants) : "Host(`${alias}.${var.base_domain}`)"])
      "traefik.http.routers.keasy-web.entrypoints"               = "websecure"
      "traefik.http.routers.keasy-web.tls.certresolver"          = "le"
      "traefik.http.routers.keasy-web.service"                   = "keasy-web"
      "traefik.http.services.keasy-web.loadbalancer.server.port" = "3000"
    }
    content {
      label = labels.key
      value = labels.value
    }
  }
}
