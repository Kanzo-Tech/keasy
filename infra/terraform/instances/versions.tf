# The instances: one keasy (server + web + sessions) per organization of the platform
# realm, as Swarm services on the platform's overlay. Identity and AI are applied
# before this (infra/auth, infra/ai); this module only consumes their outputs.
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

# The local manager's Engine (override with DOCKER_HOST for a remote manager).
provider "docker" {}
