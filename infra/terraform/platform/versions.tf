# Phase 1 of "Terraform owns everything": the shared platform — the keasy-edge overlay,
# base secrets, Traefik + Keycloak + Postgres, and the AI gateway (kanzo-ui services/ai)
# as Swarm services. Keycloak boots EMPTY; `make deploy-auth` configures it once healthy.
#
# One-time prerequisite (the docker provider can't init Swarm): `docker swarm init`.
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
