# Phase 2 of "Terraform owns everything": the keasy realm (no Organizations, no SMTP),
# SSO via an upstream IdP, and every per-tenant Keycloak resource — client/roles/users/
# role-assignments — driven by var.tenants, plus the per-tenant k8s Secret that hands the
# minted OIDC client_secret to the Argo-managed workloads. Replaces the Rust control-plane.
#
# Two-phase apply: the platform (Keycloak via Helm/Argo) comes up first; this module
# configures it (the keycloak provider connects at apply time). Run after Keycloak is healthy.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = "~> 5.1"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.31"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
