# Phase 1 of "Terraform owns everything": the shared platform — the keasy-edge overlay,
# base secrets, and Traefik + Keycloak + Postgres as Swarm services. Replaces
# infra/stack/base.yml and infra/stack/bootstrap.sh. Keycloak boots EMPTY; the realm
# module (phase 2) configures it once it is healthy.
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
