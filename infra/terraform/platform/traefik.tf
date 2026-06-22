# Ingress: Traefik v3 (Swarm provider + automatic TLS). Discovers every service by its
# deploy labels — adding a tenant needs no edit here. Host-mode :80/:443 on the manager.
resource "docker_volume" "traefik_acme" {
  name = "keasy-base-traefik-acme"
}

resource "docker_service" "traefik" {
  name = "keasy-base-traefik"

  task_spec {
    container_spec {
      image = var.traefik_image
      # v3.3's swarm provider talks Docker API 1.24 (rejected by Docker 25+); pin 1.44.
      env = {
        DOCKER_API_VERSION = "1.44"
      }
      args = [
        "--providers.swarm=true",
        "--providers.swarm.exposedByDefault=false",
        "--providers.swarm.network=keasy-edge",
        "--entrypoints.web.address=:80",
        "--entrypoints.web.http.redirections.entrypoint.to=websecure",
        "--entrypoints.web.http.redirections.entrypoint.scheme=https",
        "--entrypoints.websecure.address=:443",
        "--certificatesresolvers.le.acme.email=${var.acme_email}",
        "--certificatesresolvers.le.acme.storage=/letsencrypt/acme.json",
        "--certificatesresolvers.le.acme.tlschallenge=true",
      ]
      mounts {
        type      = "bind"
        source    = "/var/run/docker.sock"
        target    = "/var/run/docker.sock"
        read_only = true
      }
      mounts {
        type   = "volume"
        source = docker_volume.traefik_acme.name
        target = "/letsencrypt"
      }
    }
    restart_policy {
      condition = "any"
    }
    placement {
      constraints = ["node.role==manager"]
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

  endpoint_spec {
    ports {
      target_port    = 80
      published_port = 80
      publish_mode   = "host"
    }
    ports {
      target_port    = 443
      published_port = 443
      publish_mode   = "host"
    }
  }
}
