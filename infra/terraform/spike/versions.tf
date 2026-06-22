# Spike — the docker_service gate (plan risk #1). Proves Terraform can express ONE
# tenant's server+web Swarm stack: external secrets, Traefik discovery labels, a
# health-gated start-first rolling update, a named data volume, and attachment to the
# shared keasy-edge overlay — i.e. everything control-plane/src/docker.rs render_stack
# produces today. Validate locally with `terraform validate`; run on a Swarm manager
# (`terraform apply`) to confirm rolling-update + secret mounts + routing at runtime.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "docker" {}
