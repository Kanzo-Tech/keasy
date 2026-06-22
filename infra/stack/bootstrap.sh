#!/usr/bin/env bash
# One-time, idempotent bootstrap of the keasy fleet base stack on a Swarm manager.
# Generates every secret itself (no hand-matching, no `change-me`). Brings up the base
# stack (Traefik + Keycloak + Postgres) with Keycloak EMPTY, then provisions the realm
# declaratively with Terraform (infra/keycloak/terraform via infra/stack/tf.sh) — the
# same generated secrets reach Keycloak (TF) and the CLI (cp.sh) from .env. Re-runnable:
# existing secrets are left as-is and `terraform apply` reconciles in place (no DB wipe).
# Reads/writes deploy/environments/prod/.env.
#
#   infra/stack/bootstrap.sh        # or: make deploy-base
set -euo pipefail
cd "$(dirname "$0")/../.."  # repo root (keasy/)

ENV_FILE="${KEASY_ENV_FILE:-deploy/environments/prod/.env}"
[ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE not found — copy deploy/environments/prod/.env.example"; exit 1; }
# .env carries operator secrets + hostnames; the fleet image pins are git-tracked
# fleet-config in the sibling versions.env (one pin, one place). Source both.
VERSIONS_FILE="$(dirname "$ENV_FILE")/versions.env"
set -a; . "$ENV_FILE"; [ -f "$VERSIONS_FILE" ] && . "$VERSIONS_FILE"; set +a

req() { eval "v=\${$1:-}"; [ -n "$v" ] || { echo "✗ missing required env: $1 (in $ENV_FILE)"; exit 1; }; }
for v in KC_HOSTNAME KEASY_BASE_DOMAIN ACME_EMAIL \
         KEASY_SERVER_IMAGE KEASY_WEB_IMAGE KEASY_CONTROL_PLANE_IMAGE KEASY_DEPLOY_DIR; do req "$v"; done

# Generate any secret the operator didn't pin, persisting it to .env so re-runs reuse
# the exact value (and so Terraform + cp.sh read the same value). Swarm secrets are
# write-only, so .env is our single source for the generated material.
gen() {  # <ENV_VAR>
  eval "cur=\${$1:-}"; [ -n "$cur" ] && return
  val="$(openssl rand -hex 24)"
  printf '%s=%s\n' "$1" "$val" >> "$ENV_FILE"
  export "$1=$val"
  echo "✓ generated $1"
}
gen KC_DB_PASSWORD
gen KC_ADMIN_PASSWORD
# The provisioner CLI authenticates as the keasy-control-plane client with this secret
# (cp.sh passes it from .env; Terraform sets the SAME value on the realm client). No
# Swarm secret: the CLI is not a service.
gen CP_OIDC_SECRET
# Terraform authenticates as the dedicated keasy-terraform client with this secret
# (kc-mint-tf-client.sh sets it on the client; tf.sh passes it to the provider).
gen KC_TF_CLIENT_SECRET

# 1. Swarm + the shared overlay (both idempotent). keasy-edge is created HERE, not
#    by base.yml, so it outlives `docker stack rm keasy-base` — tenants and cp.sh keep
#    reaching Keycloak across a base redeploy, and the stack never races the overlay GC.
docker info 2>/dev/null | grep -q 'Swarm: active' || docker swarm init
if docker network inspect keasy-edge >/dev/null 2>&1; then
  echo "• network keasy-edge exists"
else
  docker network create --driver overlay --attachable keasy-edge >/dev/null
  echo "✓ created network keasy-edge"
fi

# 2. Swarm secrets — created only if absent, from the (now-present) env value.
secret() {  # <secret-name> <env-var>
  docker secret inspect "$1" >/dev/null 2>&1 && { echo "• secret $1 exists"; return; }
  eval "val=\${$2}"
  printf '%s' "$val" | docker secret create "$1" - >/dev/null && echo "✓ created secret $1"
}
secret kc-db-password    KC_DB_PASSWORD
secret kc-admin-password KC_ADMIN_PASSWORD
if [ -n "${KEASY_LITESTREAM_REPLICA_BASE:-}" ] && ! docker secret inspect keasy-litestream >/dev/null 2>&1; then
  [ -n "${KEASY_LITESTREAM_CREDS:-}" ] || { echo "✗ KEASY_LITESTREAM_REPLICA_BASE set but KEASY_LITESTREAM_CREDS missing"; exit 1; }
  printf '%s' "$KEASY_LITESTREAM_CREDS" | docker secret create keasy-litestream - >/dev/null && echo "✓ created secret keasy-litestream"
fi

# 3. Deploy the base stack (Traefik + Keycloak [empty] + Postgres). Keycloak boots with
#    NO realm — Terraform provisions it next.
docker stack deploy --detach=false -c infra/stack/base.yml keasy-base
echo "✓ base stack up"

# 4. Mint the least-privilege keasy-terraform client (the only step that uses the master
#    admin), then apply the realm declaratively. tf.sh waits for Keycloak health first.
infra/stack/kc-mint-tf-client.sh
infra/stack/tf.sh
echo "✓ realm applied. Add a tenant: make tenant slug=acme name='Acme' owner=owner@acme.com"
