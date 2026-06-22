# Realm-as-code for the keasy Keycloak realm. Replaces the hand-written
# realm-import JSON + `--import-realm`: a realm CREATED via the admin API auto-creates
# the built-in client scopes (roles, web-origins, profile, email), so we reference
# them and never redefine them — which is what kills the recurring "missing `roles`
# scope → token has no realm-management roles → 403" class of bug.
#
# Applied by infra/stack/tf.sh as a one-shot `hashicorp/terraform` container against
# http://keycloak:8080 over the keasy-edge overlay. State is local (single manager).

terraform {
  # `organizations_enabled` on keycloak_realm requires provider >= 5.1 — Organizations
  # is load-bearing (the whole tenant model). If a pinned version lacks it, `apply`
  # errors on an unknown argument; bump the pin (see README) rather than work around it.
  required_version = ">= 1.6.0"
  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = "~> 5.1"
    }
  }
}
