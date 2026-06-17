#!/usr/bin/env bash
# One-time, idempotent bootstrap of the keasy fleet base stack on a Swarm manager.
# Re-runnable: inits Swarm if needed, creates only missing secrets, (re)deploys
# the base stack. Reads deploy/environments/prod/.env (see .env.example).
#
#   infra/stack/bootstrap.sh        # or: make deploy-base
set -euo pipefail
cd "$(dirname "$0")/../.."  # repo root (keasy/)

ENV_FILE="${KEASY_ENV_FILE:-deploy/environments/prod/.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

req() { eval "v=\${$1:-}"; [ -n "$v" ] || { echo "✗ missing required env: $1 (set it in $ENV_FILE)"; exit 1; }; }
for v in KC_HOSTNAME KEASY_BASE_DOMAIN ACME_EMAIL \
         KEASY_SERVER_IMAGE KEASY_WEB_IMAGE KEASY_CONTROL_PLANE_IMAGE KEASY_DEPLOY_DIR; do req "$v"; done

# 1. Swarm (idempotent).
if ! docker info 2>/dev/null | grep -q 'Swarm: active'; then docker swarm init; fi

# 2. Secrets — created only if absent, from the matching env var.
secret() {  # <secret-name> <env-var>
  if docker secret inspect "$1" >/dev/null 2>&1; then echo "• secret $1 exists"; return; fi
  eval "val=\${$2:-}"; [ -n "$val" ] || { echo "✗ set $2 to create secret $1"; exit 1; }
  printf '%s' "$val" | docker secret create "$1" - >/dev/null && echo "✓ created secret $1"
}
secret kc-db-password    KC_DB_PASSWORD
secret kc-admin-password KC_ADMIN_PASSWORD
secret cp-oidc-secret    CP_OIDC_SECRET
# Optional Litestream creds (KEY=value lines), only when durability is configured.
if [ -n "${KEASY_LITESTREAM_REPLICA_BASE:-}" ] && ! docker secret inspect keasy-litestream >/dev/null 2>&1; then
  [ -n "${KEASY_LITESTREAM_CREDS:-}" ] || { echo "✗ KEASY_LITESTREAM_REPLICA_BASE set but KEASY_LITESTREAM_CREDS missing"; exit 1; }
  printf '%s' "$KEASY_LITESTREAM_CREDS" | docker secret create keasy-litestream - >/dev/null && echo "✓ created secret keasy-litestream"
fi

# 3. Deploy the base stack (Traefik + Keycloak + control-plane).
docker stack deploy --detach=false -c infra/stack/base.yml keasy-base
echo "✓ base stack deployed. Add a tenant: make tenant slug=acme name='Acme' owner=<keycloak-sub>"
