# Phase 2 of "Terraform owns everything": the keasy realm (no Organizations, no SMTP),
# SSO via an upstream IdP, and every per-tenant resource — Keycloak client/roles/users/
# role-assignments AND the Swarm server+web services — driven by var.tenants. Replaces
# the Rust control-plane CLI and the per-tenant render in control-plane/src/docker.rs.
#
# Two-phase apply: the platform module brings Keycloak up first; this module configures
# it (the keycloak provider connects at apply time). Run after Keycloak is healthy.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = "~> 5.1"
    }
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
